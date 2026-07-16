// @ts-check
/**
 * claude_code.js — Claude Code CLI bridge for Aurora Intelligence.
 *
 * Lets the AI panel talk to the user's Claude Pro/MAX *subscription*
 * instead of a metered API key. It does this by shelling out to the
 * locally-installed `claude` CLI in print mode:
 *
 *     claude -p --output-format stream-json --verbose --include-partial-messages
 *
 * The CLI authenticates with the subscription via its own OAuth login
 * (`claude login`); Aurora never sees or stores a token. We deliberately
 * strip `ANTHROPIC_API_KEY` from the child environment so the CLI cannot
 * silently fall back to metered API billing.
 *
 * The stream-json events the CLI emits are translated into the *same*
 * `ai:chat-event` packets that `chat.js` produces, so the renderer's
 * chat loop is transport-agnostic:
 *
 *   { type:'text-delta',  delta }
 *   { type:'tool-call',   toolName, args }
 *   { type:'tool-result', toolName, result }
 *   { type:'finish',      text, usage }
 *   { type:'aborted',     text }
 *   { type:'error',       message }
 */

'use strict';

const { spawn, execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('electron-log');

const state = require('../state');
const auroraMcp = require('./aurora_mcp_server');
const cliLocator = require('./cli_locator');
const { locateClaude } = cliLocator;
const cliDownloader = require('./cli_downloader');
const attachments = require('./attachments');
const { CLI_INACTIVITY_MS, MCP_TOOL_CALL_MS, MCP_STARTUP_MS, ONESHOT_MS } = require('./timeouts');
// Agent SDK engine (ESTUDO §18.5 step 2) — preferred transport; this module's
// spawn path below remains as the automatic fallback (and the shim-binary path).
const claudeAgent = require('./claude_agent');

/** sessionId → { proc } for in-flight turns. */
const sessions = new Map();
/** conversationId → claude CLI session_id, so follow-up turns `--resume`. */
const convSessions = new Map();

/** Most recent rate-limit windows, keyed by type ('five_hour' | 'weekly' | …). */
let rateLimitWindows = {};
/** Tokens / cost tallied across every Claude Code turn this app run. */
let sessionTokens = 0;
let sessionCostUsd = 0;

// ---------------------------------------------------------------------------
//  Binary + credential discovery
// ---------------------------------------------------------------------------

/**
 * Locate the `claude` executable: the copy bundled with Aurora
 * (`@anthropic-ai/claude-code` dependency) first, then a global install
 * on PATH. See `cli_locator.js` — it owns the dev / packaged-app /
 * `.cmd`-shim resolution and caches the result.
 *
 * @returns {{exe:string, viaShim:boolean}|null}
 */
function resolveBinary() {
  return locateClaude();
}

/** Read the Claude Code OAuth credentials (subscription info), or null. */
function readCredentials() {
  try {
    const p = path.join(os.homedir(), '.claude', '.credentials.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return j && j.claudeAiOauth ? j.claudeAiOauth : null;
  } catch (_) {
    return null;
  }
}

function execFileText(/** @type {string} */ binPath, /** @type {string[]} */ args, timeoutMs = 6000) {
  // Same shim issue as spawn(): `.cmd` files require an explicit cmd.exe
  // invocation on Node >= 20.12. Without this, `claude --version` would
  // throw EINVAL even when the binary path exists. The bundled native
  // `.exe` is unaffected and runs directly.
  let cmd = binPath, finalArgs = args;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(binPath)) {
    cmd = 'cmd.exe';
    finalArgs = ['/d', '/s', '/c', binPath, ...args];
  }
  return new Promise((resolve, reject) => {
    execFile(cmd, finalArgs, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * Probe the local Claude Code install + subscription login. Cheap — it
 * reads the credentials file rather than spending tokens on a ping.
 *
 * @returns {Promise<{installed:boolean, path?:string, version?:string,
 *   authed?:boolean, plan?:string, rateLimitTier?:string, expiresAt?:number,
 *   expired?:boolean}>}
 */
async function detect() {
  const bin = resolveBinary();
  if (!bin) {
    // Not on disk yet. Report whether we CAN fetch it on demand (B12) and
    // whether the subscription is already signed in (creds are independent of
    // the binary — they come from the user's external `claude login`), so the
    // panel can offer "downloads on first use" instead of a dead "not installed".
    const creds = readCredentials();
    return {
      installed: false,
      downloadable: cliDownloader.isDownloadable('claude'),
      authed: !!(creds && creds.accessToken),
    };
  }

  let version = '';
  try { version = (await execFileText(bin.exe, ['--version'])).trim(); }
  catch (_) { /* version is best-effort */ }

  const creds = readCredentials();
  const expiresAt = creds && Number(creds.expiresAt) ? Number(creds.expiresAt) : 0;
  return {
    installed: true,
    path: bin.exe,
    version,
    authed: !!(creds && creds.accessToken),
    plan: (creds && creds.subscriptionType) || null,
    rateLimitTier: (creds && creds.rateLimitTier) || null,
    expiresAt: /** @type {any} */ (expiresAt || null),
    expired: expiresAt ? Date.now() > expiresAt : false,
  };
}

/** Snapshot of subscription usage for the panel's usage bars. */
function getUsage() {
  const creds = readCredentials();
  return {
    plan: (creds && creds.subscriptionType) || null,
    session: { tokens: sessionTokens, costUsd: sessionCostUsd },
    windows: Object.values(rateLimitWindows),
  };
}

// ---------------------------------------------------------------------------
//  Chat
// ---------------------------------------------------------------------------

function sendEvent(/** @type {any} */ webContents, /** @type {string} */ sessionId, /** @type {string} */ type, /** @type {any} */ data) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    webContents.send('ai:chat-event', { sessionId, type, ...(data || {}) });
  } catch (e) {
    log.warn('[ai.claude-code] send failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * AURORA permission mode → `claude --permission-mode` value.
 *
 * AURORA's mcp__aurora__* tools are gated on the renderer side: every
 * call round-trips through tool_bridge.runTool → tool_runner →
 * aiAssistantManager.confirmToolCall, which shows the inline Allow/Deny
 * card the user actually sees. Whatever the CLI does on top of that
 * MUST not pre-deny a call before it reaches us.
 *
 * The CLI's `default` mode does exactly that in `-p` (non-interactive)
 * print mode: it auto-DENIES writes and bash because it has no TTY to
 * prompt on. So if we mapped 'ask' → 'default', every MCP write tool
 * (create_file, set_top_level, …) would be silently dropped and the
 * user's inline card would never appear. That's the bug we're fixing.
 *
 * Resolution: always pass `bypassPermissions` to the CLI. The CLI's
 * own permission UI doesn't fit in our headless flow anyway — let the
 * renderer's inline card be the single source of truth.
 */
function permissionFlag(/** @type {any} */ _mode) {
  return 'bypassPermissions';
}

/** Directory the CLI should treat as the workspace (the open project). */
function workspaceDir() {
  const spf = state.currentOpenProjectPath;
  if (spf) {
    try {
      const stat = fs.statSync(spf);
      return stat.isDirectory() ? spf : path.dirname(spf);
    } catch (_) { /* fall through */ }
  }
  return os.homedir();
}

/** A neutral scratch directory for the CLI's working dir — deliberately NOT the
 *  project folder. On Windows a process whose cwd is a folder LOCKS it, so with
 *  the project as cwd a `rename_project` couldn't complete until the turn ended.
 *  The project stays fully readable via --add-dir, and every Aurora tool uses
 *  absolute paths, so cwd need not be the project. */
function agentScratchDir() {
  const dir = path.join(os.tmpdir(), 'aurora-ai-cwd');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* best-effort */ }
  return dir;
}

// ---------------------------------------------------------------------------
//  Aurora tool bridge (MCP)
// ---------------------------------------------------------------------------

/**
 * Reinforcement injected into the first user turn. The MCP server
 * already advertises Aurora's tools to the CLI via `tools/list`, so the
 * model *sees* them regardless — this text tells it to PREFER them and
 * never shell out to the SAPHO toolchain. Without it, a model used to
 * running compilers from a terminal will reach for the (now disabled)
 * Bash tool first.
 */
const MCP_TOOL_RULES = [
  'You are running inside the Aurora IDE. Aurora exposes its own IDE and',
  'compiler tools through an MCP server registered as "aurora"; they appear',
  'to you as `mcp__aurora__<name>`. You MUST use these tools for every',
  'Aurora-specific action instead of shelling out.',
  '',
  'Compilation & simulation — NEVER call any YANC binary (cmmcomp, cppcomp,',
  'cpppp, appcomp, asmcomp), nor yanc, iverilog, vvp, verilator or gtkwave',
  'from a shell. The Bash tool is disabled on purpose. Use:',
  '  - mcp__aurora__compile_all — full pipeline (CMM, ASM, Verilog, wave, PRISM)',
  '  - mcp__aurora__compile_step({step:"cmm"|"verilog"|"wave"|"prism"}) — one',
  '    step; "wave" opens GTKWave, "prism" opens the PRISM RTL viewer',
  '  - mcp__aurora__cancel_compilation',
  '',
  'Reading compiler results — Aurora streams every compiler into its own',
  'terminal panels; read those instead of capturing shell output:',
  '  - mcp__aurora__get_terminal_output({terminalId:"tcmm"|"tasm"|"tveri"|"twave"|"tprism"})',
  '  - mcp__aurora__read_all_terminals',
  '',
  'Project, files & processors:',
  '  - mcp__aurora__get_project_tree, read_file, create_file, refresh_file_tree',
  '  - mcp__aurora__set_top_level, set_testbench_top',
  '  - mcp__aurora__list_processors, get_processor_config, set_processor_config',
  '',
  'Waveforms:',
  '  - mcp__aurora__list_wave_signals, select_wave_signals, open_wave_config',
  '  - mcp__aurora__list_gtkw_files, add_gtkw_file, set_active_gtkw_file',
  '',
  'Asking the user — your built-in AskUserQuestion tool is DISABLED here.',
  'Whenever you need a decision, clarification or a choice between options,',
  'call mcp__aurora__ask_user_question — it renders an interactive card in',
  'the IDE and returns the selected answer. Never guess when you could ask.',
  '',
  'If a task seems to need a shell command, you are missing an Aurora tool —',
  'inspect the available mcp__aurora__* tools or ask the user. Do not',
  'improvise with PowerShell or raw filesystem calls for SAPHO work.',
].join('\n');

/**
 * Tool names removed from the CLI:
 *  - Bash/BashOutput/KillShell/KillBash → can't run SAPHO compilers via a shell.
 *  - Edit/Write/MultiEdit/NotebookEdit (V4) → can't write files directly,
 *    bypassing the renderer's Allow/Deny card. File writes must go through
 *    mcp__aurora__create_file, which IS gated. (Read stays enabled — the image
 *    attachment flow writes a temp file in main and the model reads it.)
 *  - AskUserQuestion → the CLI's NATIVE question tool cannot reach a human
 *    here: we run `-p` + bypassPermissions with no TTY and no canUseTool
 *    callback, so a native AskUserQuestion self-resolves CLI-side and Aurora
 *    only ever saw an inert chip — the "no question card in bypass mode"
 *    bug. Disallowing it forces the model onto mcp__aurora__ask_user_question
 *    (also steered by MCP_TOOL_RULES), which renders the real interactive
 *    card and pipes the answer back through the MCP bridge.
 */
// Shared with the Agent SDK engine (claude_agent.js) — one list, two consumers.
// Two hand-kept copies is exactly how AskUserQuestion drifted back on over
// there and silently stopped rendering its card. See native_tools.js.
const { NATIVE_TOOLS, DISALLOWED_TOOLS } = require('./native_tools');

/**
 * Ensure the Aurora MCP server is up and (re)write the `--mcp-config`
 * file the CLI consumes. The file is tiny and the port is stable for
 * the app's lifetime, but we rewrite each turn so a deleted temp file
 * or a restarted server self-heals.
 *
 * @returns {Promise<string>} absolute path to the mcp-config JSON
 */
async function ensureMcpConfig() {
  const url = await auroraMcp.ensureStarted();
  const cfgPath = path.join(os.tmpdir(), `aurora-mcp-${process.pid}.json`);
  const config = { mcpServers: { aurora: { type: 'http', url } } };
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8');
  return cfgPath;
}

/**
 * Run one chat turn through the Claude Code CLI.
 *
 * @param {object} payload
 * @param {string} payload.sessionId           per-turn id (renderer-generated)
 * @param {string} [payload.conversationId]    stable id → enables --resume
 * @param {{role:string,content:string}[]} payload.messages
 * @param {string} [payload.system]
 * @param {string} [payload.modelId]           'default' | 'sonnet' | 'opus' | …
 * @param {string} [payload.effort]            low | medium | high | xhigh | max
 * @param {string} [payload.permission]        ask | writes | allow
 * @param {Electron.WebContents} webContents
 */
async function start(payload, webContents) {
  const {
    sessionId, conversationId, messages,
    system, modelId, effort, permission,
  } = payload || {};

  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('sessionId is required');
  }
  if (sessions.has(sessionId)) {
    throw new Error(`session already active: ${sessionId}`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  // Sign-in is checked first: the OAuth credentials come from the user's
  // external `claude login` and are independent of where the binary lives, so
  // there's no point downloading ~230 MB only to bounce off a missing login.
  if (!readCredentials()) {
    sendEvent(webContents, sessionId, 'error', {
      message: 'Claude Code is not signed in. Run `claude login` in a terminal, then reconnect.',
    });
    return;
  }

  let bin = resolveBinary();
  if (!bin) {
    // B12: the installer no longer bundles the CLI — fetch it on first use.
    if (!cliDownloader.isDownloadable('claude')) {
      sendEvent(webContents, sessionId, 'error', {
        message: 'Claude Code CLI not found. Install it, then reopen this panel.',
      });
      return;
    }
    try {
      bin = await cliDownloader.ensureCli('claude', {
        onProgress: (p) => sendEvent(webContents, sessionId, 'cli-download', { ...p, cli: 'Claude Code' }),
      });
      cliLocator.invalidate(); // so detect()/usage see the freshly-installed CLI
    } catch (e) {
      sendEvent(webContents, sessionId, 'error', {
        message: `Could not download Claude Code: ${e instanceof Error ? e.message : e}`,
      });
      return;
    }
  }

  // ---- Agent SDK engine (preferred) ----------------------------------------
  // Drives the SAME native binary through @anthropic-ai/claude-agent-sdk:
  // clean aborts, no argv limits, and canUseTool — which is what lets the
  // native AskUserQuestion render Aurora's interactive card even under
  // bypassPermissions. Returns false (→ fall through to the legacy spawn)
  // when the SDK can't run: import failure, .cmd-shim-only binary, or the
  // AURORA_CLAUDE_LEGACY_CLI=1 escape hatch.
  try {
    const handled = await claudeAgent.tryStart(
      { sessionId, conversationId, messages, system, modelId, effort, bin },
      webContents,
      {
        sendEvent,
        convSessions,
        sessions,
        addUsage: (t, c) => { sessionTokens += t; sessionCostUsd += c; },
        setRateLimit: (info) => { /** @type {Record<string, any>} */ (rateLimitWindows)[info.rateLimitType] = info; },
        workspaceDir,
      },
    );
    if (handled) return;
    log.info('[ai.claude-code] Agent SDK unavailable — using legacy CLI spawn');
  } catch (e) {
    // tryStart reports its own TURN errors as chat-events; reaching here
    // means the engine wiring itself blew up — surface it rather than
    // double-running the turn through the legacy path.
    sendEvent(webContents, sessionId, 'error', {
      message: `Claude engine error: ${e instanceof Error ? e.message : e}`,
    });
    return;
  }

  // ---- legacy CLI spawn (fallback) ------------------------------------------

  // Resume the CLI-side conversation when we already have its id; that
  // keeps prompt-cache hits and means we only send the new user turn.
  const resumeId = conversationId ? convSessions.get(conversationId) : null;
  const last = messages[messages.length - 1];
  let prompt = (last && last.content) || '';
  // Composer attachments: inline file text; write images to temp files and
  // reference their paths — Claude Code reads images natively with its Read tool.
  prompt += attachments.buildPromptSuffix(last && last.attachments, { imagesAsFiles: true });

  // No CLI session to resume but the renderer handed us history (user
  // switched to Claude Code mid-thread, or the app restarted): fold the
  // prior turns into the prompt so context isn't lost.
  if (!resumeId && messages.length > 1) {
    const transcript = messages.slice(0, -1)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    prompt = `<conversation_context>\n${transcript}\n</conversation_context>\n\n${prompt}`;
  }

  // Large system prompts ride along inside the prompt body (the CLI
  // reads it via stdin, so it can be arbitrarily long). Resumed
  // sessions skip this — the prior turn already taught the model the
  // rules, sending them again costs tokens for no gain.
  // (Set below, after we know whether inlineSystem was deferred.)

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', permissionFlag(permission),
  ];
  if (modelId && modelId !== 'default') args.push('--model', modelId);
  if (effort) args.push('--effort', effort);
  if (resumeId) args.push('--resume', resumeId);

  // Aurora tool bridge
  // ------------------
  // Hand the CLI Aurora's own tool surface (compile_all, set_top_level,
  // select_wave_signals, get_terminal_output, …) as an MCP server, so
  // the model drives Aurora's pipeline instead of shelling out to
  // cmmcomp / iverilog / gtkwave. `--strict-mcp-config` makes the CLI
  // ignore any user/project .mcp.json — only Aurora's bridge is in
  // scope, so behaviour is deterministic across machines.
  //
  // If the MCP server fails to come up we deliberately DON'T disable
  // Bash: that would leave the CLI unable to do anything useful. The
  // turn just degrades to the old (shell-based) behaviour.
  let mcpReady = false;
  try {
    const cfgPath = await ensureMcpConfig();
    args.push('--mcp-config', cfgPath, '--strict-mcp-config');
    // --tools is the allowlist: the built-in surface is exactly this, and the
    // CLI's future additions stay off until someone adds them deliberately.
    // Comma-separated is the form `--help` documents for this flag.
    args.push('--tools', NATIVE_TOOLS.join(','));
    // Redundant with --tools, kept anyway: disallowed-tools wins over every
    // permission mode, including `bypassPermissions` — so even "allow" turns
    // cannot PowerShell their way around Aurora's compile pipeline. Space-
    // separated, which is what this flag has always been given here.
    args.push('--disallowed-tools', DISALLOWED_TOOLS.join(' '));
    mcpReady = true;
  } catch (e) {
    log.warn('[ai.claude-code] Aurora MCP bridge unavailable — falling back to shell tools:', e instanceof Error ? e.message : e);
  }

  // System prompt routing
  // ---------------------
  // On Windows, command-line args are capped at 32767 chars (cmd.exe is
  // even stricter at ~8191). Aurora's SYSTEM_PROMPT carries the full
  // SAPHO knowledge base — it overflows that cap and we hit
  // "The command line is too long" / ENAMETOOLONG. Anything past a
  // conservative threshold gets folded into the prompt body instead of
  // being passed through `--append-system-prompt`, so the shell never
  // touches it. Small system prompts still take the CLI flag (which is
  // slightly preferred because it stays out of the user-message
  // transcript on resume).
  const SYS_INLINE_THRESHOLD = 2048;
  let inlineSystem = '';
  if (system) {
    if (system.length > SYS_INLINE_THRESHOLD) {
      inlineSystem = system;
    } else {
      args.push('--append-system-prompt', system);
    }
  }

  // The CLI's working directory MUST NOT be the project folder: on Windows a
  // process whose cwd is a folder LOCKS it, so a project rename couldn't complete
  // until the turn ended. Run the agent from a neutral scratch dir; the project
  // stays readable via --add-dir, and every Aurora tool uses absolute paths.
  const projectDir = workspaceDir();
  const cwd = agentScratchDir();
  args.push('--add-dir', projectDir);            // project files stay readable (native Read)
  if (cwd !== projectDir) args.push('--add-dir', cwd);
  try { fs.mkdirSync(attachments.ATT_DIR, { recursive: true }); } catch (_) { /* best-effort */ }
  args.push('--add-dir', attachments.ATT_DIR);   // so native Read can open attached images

  // Stitch the deferred system prompt onto the user message so the
  // shell never sees its bulk. Only on a fresh session — resumed CLI
  // sessions already have the rules in context.
  if (inlineSystem && !resumeId) {
    prompt = `<aurora_system_rules>\n${inlineSystem}\n</aurora_system_rules>\n\n${prompt}`;
  }

  // Tell the model to prefer the mcp__aurora__* tools over the shell.
  // Fresh sessions only — a resumed CLI session already has this in
  // context, and re-sending it would cost a prompt-cache miss.
  if (mcpReady && !resumeId) {
    prompt = `<aurora_mcp_tools>\n${MCP_TOOL_RULES}\n</aurora_mcp_tools>\n\n${prompt}`;
  }

  // Strip API-key env vars so the CLI authenticates with the *subscription*
  // (OAuth) and never silently falls back to metered API billing.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  // MCP tool-call read timeout.
  // ---------------------------
  // The CLI's MCP client cuts a `tools/call` off after 120s by default and
  // reports `timed out awaiting tools/call after 120s` to the model — which
  // then marks the tool FAILED even when Aurora's side finished the work.
  // That's the "rename_project failed but the project actually got renamed"
  // bug: rename_project / rename_processor release watchers → move the folder
  // → rewrite the .spf → reopen, and on a large project or busy disk that
  // runs past 120s. tool_bridge already gives those tools a 5-min leash
  // (SLOW_TIMEOUT_MS), so the renderer resolves correctly — the CLI was just
  // hanging up first. Raise MCP_TOOL_TIMEOUT above that bridge ceiling so the
  // CLI waits for tool_bridge to settle (success or its own timeout) instead
  // of inventing a false failure. Respect an explicit user override if set.
  if (!env.MCP_TOOL_TIMEOUT) env.MCP_TOOL_TIMEOUT = String(MCP_TOOL_CALL_MS);
  if (!env.MCP_TIMEOUT) env.MCP_TIMEOUT = String(MCP_STARTUP_MS); // server startup

  let proc;
  try {
    // On Windows, npm installs the CLI as `claude.cmd` (a batch shim).
    // Since Node v20.12 (CVE-2024-27980) `.bat`/`.cmd` files cannot be
    // launched directly via `spawn(bin, args)` — they need `shell:true`
    // OR you have to invoke cmd.exe explicitly. We pick the explicit
    // route because it sidesteps the per-arg shell-quoting hazard:
    // arguments stay as a real array (not concatenated into a single
    // shell command), so values containing spaces / special chars
    // (e.g. `system` prompt text, `cwd` paths with spaces) reach the
    // CLI verbatim.
    if (bin.viaShim && process.platform === 'win32') {
      proc = spawn('cmd.exe', ['/d', '/s', '/c', bin.exe, ...args], {
        cwd, env, windowsHide: true, windowsVerbatimArguments: false,
      });
    } else {
      proc = spawn(bin.exe, args, { cwd, env, windowsHide: true });
    }
  } catch (e) {
    sendEvent(webContents, sessionId, 'error', { message: `Failed to launch Claude Code: ${e instanceof Error ? e.message : e}` });
    return;
  }

  let stdoutBuf = '';
  let stderrBuf = '';
  let fullText = '';
  let finished = false;
  let aborted = false;
  const seenToolCalls = new Set();
  // tool_use_id → toolName, so when the CLI replies with a `tool_result`
  // user-block we can re-attach the original tool name + emit a
  // tool-result event the renderer can actually correlate. Without this
  // map every chip would stay in the "running…" state forever because
  // we used to emit `toolName: 'tool'` (literal) on every result.
  const toolUseNames = new Map();

  // Anti-freeze: if the CLI goes silent for this long with NO tool call in
  // flight, treat it as wedged and kill it so the renderer isn't left spinning.
  // The CLI's own tools and Aurora's MCP tools populate pendingTools, so a long
  // compile or an open ask card (an outstanding tool) never trips it. A Set
  // (keyed by tool-use id), not a counter, so a duplicate/out-of-order tool
  // event can't desync it (which would pause the timer forever or fire it
  // during a legit tool).
  const INACTIVITY_MS = CLI_INACTIVITY_MS;
  const pendingTools = new Set();
  let stalled = false;

  // Tree-kill the CLI + its children (MCP client, any grandchildren). Shared by
  // the inactivity reaper, the absolute-ceiling reaper, and a hard-stop. The
  // `close` handler still fires after this, so callers don't double-handle.
  const killProcTree = () => {
    try {
      if (process.platform === 'win32' && proc.pid) {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
      } else { proc.kill('SIGTERM'); }
    } catch (_) { /* the close handler still fires */ }
  };

  /** @type {ReturnType<typeof setTimeout>|null} */
  let inactivityTimer = null;
  const armInactivity = () => {
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    if (finished || aborted || pendingTools.size > 0) return;
    const t = setTimeout(() => {
      if (t !== inactivityTimer) return; // a newer arm (or cleanup) superseded us
      stalled = true;
      killProcTree();
    }, INACTIVITY_MS);
    inactivityTimer = t;
  };

  // NB: there is deliberately NO absolute per-turn time limit. A real agentic
  // task (a large refactor, several slow compiles, deep reasoning) can run for a
  // long time and must NOT be cut off by an arbitrary clock. Orphans are handled
  // by OWNERSHIP instead (see killAll / the renderer-reload reaper in
  // windows.js): a turn is reaped when nobody is listening for it anymore — the
  // panel was abandoned, the renderer reloaded, or the app is quitting — never
  // because it "took too long". The inactivity reaper above only fires on pure
  // silence with no tool in flight (a genuinely wedged CLI), which is a liveness
  // signal, not a deadline.
  sessions.set(sessionId, { proc, markAborted: () => { aborted = true; } });

  try { proc.stdin.write(prompt); proc.stdin.end(); }
  catch (_) { /* the CLI may have exited already; close path handles it */ }
  armInactivity();

  const handleObject = (/** @type {any} */ obj) => {
    if (!obj || typeof obj !== 'object') return;
    switch (obj.type) {
      case 'system':
        if (obj.subtype === 'init' && obj.session_id && conversationId) {
          convSessions.set(conversationId, obj.session_id);
        }
        break;

      case 'rate_limit_event': {
        const info = obj.rate_limit_info;
        if (info && info.rateLimitType) /** @type {Record<string, any>} */ (rateLimitWindows)[info.rateLimitType] = info;
        break;
      }

      case 'stream_event': {
        const ev = obj.event || {};
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            fullText += ev.delta.text;
            sendEvent(webContents, sessionId, 'text-delta', { delta: ev.delta.text });
          }
        }
        break;
      }

      case 'assistant': {
        // Tool calls (Claude Code's own Read/Edit/Bash/… tools). Text is
        // already streamed via stream_event deltas, so only chips here.
        const blocks = (obj.message && obj.message.content) || [];
        for (const b of blocks) {
          if (b && b.type === 'tool_use' && !seenToolCalls.has(b.id)) {
            seenToolCalls.add(b.id);
            const toolName = b.name || 'tool';
            toolUseNames.set(b.id, toolName);
            sendEvent(webContents, sessionId, 'tool-call', {
              toolUseId: b.id,
              toolName,
              args: b.input || {},
            });
            pendingTools.add(b.id);
          }
        }
        break;
      }

      case 'user': {
        // Results of the CLI's own tool runs. Each tool_result block
        // carries a `tool_use_id` that points back to the matching
        // tool_use block from the prior assistant turn — we look up the
        // original toolName from that map so the renderer's chip can
        // close on the right one. Content of the result is forwarded
        // so the saved conversation preserves the full transcript.
        const blocks = (obj.message && obj.message.content) || [];
        for (const b of blocks) {
          if (b && b.type === 'tool_result') {
            const id = b.tool_use_id || null;
            const name = (id && toolUseNames.get(id)) || 'tool';
            // CLI puts result text in `b.content`. It can be a string or
            // an array of content-blocks ([{type:'text',text:'…'}]).
            let resultText = '';
            if (typeof b.content === 'string') {
              resultText = b.content;
            } else if (Array.isArray(b.content)) {
              resultText = b.content
                .map((/** @type {any} */ c) => (c && c.type === 'text' ? c.text : ''))
                .filter(Boolean).join('\n');
            }
            sendEvent(webContents, sessionId, 'tool-result', {
              toolUseId: id,
              toolName: name,
              result: {
                ok: !b.is_error,
                content: resultText,
                ...(b.is_error ? { error: resultText || 'tool reported an error' } : {}),
              },
            });
            pendingTools.delete(id);
          }
        }
        break;
      }

      case 'result': {
        finished = true;
        const text = typeof obj.result === 'string' && obj.result ? obj.result : fullText;
        const u = obj.usage || {};
        const totalTokens =
          (u.input_tokens || 0) + (u.output_tokens || 0) +
          (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        sessionTokens += totalTokens;
        sessionCostUsd += Number(obj.total_cost_usd) || 0;
        if (obj.is_error) {
          // A failed --resume usually means the CLI-side session is gone;
          // drop the mapping so the next turn starts a fresh conversation.
          if (resumeId && conversationId) convSessions.delete(conversationId);
          sendEvent(webContents, sessionId, 'error', {
            message: text || obj.api_error_status || 'Claude Code reported an error.',
          });
        } else {
          sendEvent(webContents, sessionId, 'finish', {
            text,
            usage: { totalTokens },
          });
        }
        break;
      }

      default:
        break;
    }
  };

  proc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      try { handleObject(JSON.parse(line)); }
      catch (_) { /* non-JSON noise — ignore */ }
    }
    armInactivity();
  });

  proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

  proc.on('error', (err) => {
    sessions.delete(sessionId);
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    if (!finished) {
      sendEvent(webContents, sessionId, 'error', { message: `Claude Code failed to start: ${err instanceof Error ? err.message : err}` });
    }
  });

  proc.on('close', (code) => {
    sessions.delete(sessionId);
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    if (stalled) {
      sendEvent(webContents, sessionId, 'error', { message: 'Claude Code stopped responding (no output). Please try again.' });
      return;
    }
    if (aborted) {
      sendEvent(webContents, sessionId, 'aborted', { text: fullText });
      return;
    }
    if (finished) return;          // a `result` event already closed the turn
    if (fullText) {
      sendEvent(webContents, sessionId, 'finish', { text: fullText, usage: null });
    } else {
      // Crash before any output — a stale --resume target is the usual
      // cause; clear it so a retry starts clean.
      if (resumeId && conversationId) convSessions.delete(conversationId);
      const msg = stderrBuf.trim() || `Claude Code exited (code ${code}) without a response.`;
      sendEvent(webContents, sessionId, 'error', { message: msg });
    }
  });
}

/** Stop one session handle — SDK turns expose stop() (AbortController);
 *  legacy spawns expose proc (tree-killed via taskkill on Windows). */
function stopSession(/** @type {any} */ s) {
  if (!s) return false;
  if (s.markAborted) s.markAborted();
  if (typeof s.stop === 'function') {
    try { s.stop(); } catch (_) { /* the stream loop settles the turn */ }
    return true;
  }
  if (!s.proc) return false;
  try {
    if (process.platform === 'win32' && s.proc.pid) {
      spawn('taskkill', ['/pid', String(s.proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      s.proc.kill('SIGTERM');
    }
  } catch (_) { /* the close handler still fires */ }
  return true;
}

/** Abort an in-flight turn. Returns true if a session was stopped. */
function abort(/** @type {string} */ sessionId) {
  return stopSession(sessions.get(sessionId));
}

/**
 * Push a follow-up into a LIVE turn so it runs in the same CLI session instead
 * of waiting for a fresh dispatch. Only the Agent SDK engine registers a
 * `pushUserMessage` (claude_agent.js) — the legacy spawn path has no input
 * channel once `-p` is running, so this returns false there and the renderer
 * falls back to its own follow-up queue. Also returns false once the turn is
 * winding down, which is what keeps a late message from vanishing.
 *
 * @param {string} sessionId
 * @param {string} content
 * @returns {boolean} true when the live turn accepted it
 */
function pushUserMessage(sessionId, content) {
  const s = sessions.get(sessionId);
  if (!s || typeof s.pushUserMessage !== 'function') return false;
  try { return !!s.pushUserMessage(content); }
  catch (e) {
    log.warn('[ai.claude-code] pushUserMessage failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

/** Kill every in-flight session. Called on app quit so Claude Code CLI
 *  subprocesses (and their children, via taskkill /T) aren't orphaned —
 *  abort() only ever fired for a single renderer-requested session. */
function killAll() {
  for (const [, s] of sessions) stopSession(s);
  sessions.clear();
}

/** Drop the cached CLI-side session for a conversation (e.g. on "new chat"). */
function forgetConversation(/** @type {string} */ conversationId) {
  if (conversationId) convSessions.delete(conversationId);
}

/**
 * One-shot text generation via the Claude Code CLI (subscription) in print
 * mode — no streaming, no Aurora MCP/tool bridge, no session. Lets the AI
 * harness generator use the subscription instead of requiring an API key.
 * The prompt rides on stdin (it can be large). Same shape as
 * provider.generateOneshot: { ok, text, finishReason } or { ok:false, error }.
 *
 * @param {{ system?:string, prompt:string, model?:string }} opts
 */
async function generateOneshot({ system, prompt, model } = /** @type {any} */ ({})) {
  if (!readCredentials()) return { ok: false, error: 'Claude Code is not signed in. Run `claude login` in a terminal.' };

  let bin = resolveBinary();
  if (!bin) {
    // B12: fetch the CLI on first use here too (no progress channel on the
    // one-shot path — the harness generator already shows its own pending UI).
    if (!cliDownloader.isDownloadable('claude')) {
      return { ok: false, error: 'Claude Code CLI not found. Install it, or pick an API provider.' };
    }
    try {
      bin = await cliDownloader.ensureCli('claude');
      cliLocator.invalidate();
    } catch (e) {
      return { ok: false, error: `Could not download Claude Code: ${e instanceof Error ? e.message : e}` };
    }
  }

  const args = ['-p', '--output-format', 'text'];
  if (model && model !== 'default') args.push('--model', model);
  if (system) args.push('--append-system-prompt', system);

  // .cmd shim needs cmd.exe on Windows (same as execFileText/start).
  let cmd = bin.exe;
  let finalArgs = args;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin.exe)) {
    cmd = 'cmd.exe';
    finalArgs = ['/d', '/s', '/c', bin.exe, ...args];
  }

  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (/** @type {any} */ r) => { if (!done) { done = true; resolve(r); } };
    let proc;
    try {
      proc = spawn(cmd, finalArgs, { windowsHide: true });
    } catch (e) {
      finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    // The CLI in text mode is slow (it returns only after the whole answer is
    // generated — measured ~4 min for a harness). Generous timeout so a real
    // hang doesn't wait forever, without cutting a legitimate generation.
    const TIMEOUT_MS = ONESHOT_MS; // 7 min
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) { /* already gone */ }
      finish({ ok: false, error: 'Claude Code timed out (no answer in 7 min). It is much slower than an API provider — try gemini/openai for faster iteration.' });
    }, TIMEOUT_MS);
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.stderr.on('data', (c) => { err += c.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: e instanceof Error ? e.message : String(e) }); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) finish({ ok: true, text: out, finishReason: 'stop' });
      else finish({ ok: false, error: `claude CLI exited ${code}: ${(err || out).slice(-500)}` });
    });
    try {
      proc.stdin.write(String(prompt || ''));
      proc.stdin.end();
    } catch (e) {
      clearTimeout(timer);
      finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

module.exports = { detect, getUsage, start, abort, pushUserMessage, killAll, forgetConversation, generateOneshot };
