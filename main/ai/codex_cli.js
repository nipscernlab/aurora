// @ts-check
/**
 * codex_cli.js — OpenAI Codex CLI bridge for Aurora Intelligence.
 *
 * The "ChatGPT" provider in the AI panel. It is the OpenAI counterpart of
 * `claude_code.js`: instead of a metered API key it drives the user's
 * ChatGPT subscription (Plus / Pro / Business / Edu / Enterprise — and the
 * limited free tier) by shelling out to the locally-bundled `codex` CLI in
 * its non-interactive mode:
 *
 *     codex exec --json --skip-git-repo-check \
 *       --dangerously-bypass-approvals-and-sandbox -C <project> \
 *       -c mcp_servers.aurora.url="http://127.0.0.1:PORT/mcp" ...
 *
 * Auth is the CLI's own "Sign in with ChatGPT" OAuth (`codex login`);
 * Aurora never sees a token. We strip `OPENAI_API_KEY` from the child
 * environment so the CLI authenticates with the subscription and never
 * silently falls back to metered API billing.
 *
 * MCP / why `--dangerously-bypass-approvals-and-sandbox`
 * ------------------------------------------------------
 * Aurora's tools reach Codex through the same local MCP server the Claude
 * Code bridge uses (`aurora_mcp_server.js`); Codex sees them as
 * `mcp__aurora__<tool>`. Unlike the Claude Code CLI, Codex has no
 * `--disallowed-tools` switch — its shell tool is intrinsic. Worse: in
 * non-interactive `exec` mode every MCP tool call is auto-DECLINED ("user
 * cancelled MCP tool call") unless approvals are fully bypassed. Empirically
 * (`approval_policy=never`, `mcp_servers.*.auto_approved`, persistent
 * registration — all tried) the ONLY thing that lets MCP tools run is the
 * bypass flag, which also disables Codex's sandbox. So a hard read-only
 * sandbox is not achievable alongside MCP here; instead the system-prompt
 * rules below steer Codex firmly onto `mcp__aurora__*` and away from the
 * shell. This is a softer guarantee than the Claude Code bridge's hard
 * Bash block — a known, accepted limitation of the Codex integration.
 *
 * The stream-json events Codex emits (thread/turn/item model) are
 * translated into the SAME `ai:chat-event` packets `chat.js` and
 * `claude_code.js` produce, so the renderer's chat loop stays
 * transport-agnostic.
 */

'use strict';

const { spawn, execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('electron-log');

const state = require('../state');
const auroraMcp = require('./aurora_mcp_server');
const { locateCodex } = require('./cli_locator');

/** sessionId → { proc, markAborted } for in-flight turns. */
const sessions = new Map();
/** conversationId → Codex `thread_id`, so follow-up turns `exec resume`. */
const convThreads = new Map();

/** Tokens tallied across every Codex turn this app run. */
let sessionTokens = 0;

/** @type {{exe:string, rgDir:string|null, viaShim:boolean}|null|undefined} */
let cachedBin;

// ---------------------------------------------------------------------------
//  Binary + credential discovery
// ---------------------------------------------------------------------------

function resolveBinary() {
  if (cachedBin === undefined) cachedBin = locateCodex();
  return cachedBin;
}

/** Read the Codex OAuth credentials (`~/.codex/auth.json`), or null. */
function readCredentials() {
  try {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    return JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf-8'));
  } catch (_) {
    return null;
  }
}

/**
 * Best-effort ChatGPT plan extraction from the OAuth id_token. The token is
 * a JWT; its payload carries a `chatgpt_plan_type` claim ("plus", "pro",
 * "free", …). Decoding is read-only base64 — no verification, purely to
 * label the panel's status row. Any failure just yields null.
 */
function planFromIdToken(creds) {
  try {
    const idToken = creds && creds.tokens && creds.tokens.id_token;
    if (!idToken || typeof idToken !== 'string') return null;
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
    // The claim is namespaced under an auth object in current tokens.
    const auth = json['https://api.openai.com/auth'] || json;
    return auth.chatgpt_plan_type || auth.chatgpt_plan || null;
  } catch (_) {
    return null;
  }
}

function execFileText(bin, args, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * Probe the local Codex install + subscription login. Cheap — reads the
 * credentials file rather than spending tokens on a ping.
 *
 * @returns {Promise<{installed:boolean, path?:string, version?:string,
 *   authed?:boolean, plan?:string|null, authMode?:string|null}>}
 */
async function detect() {
  const bin = resolveBinary();
  if (!bin) return { installed: false };

  let version = '';
  try { version = (await execFileText(bin.exe, ['--version'])).trim(); }
  catch (_) { /* version is best-effort */ }

  const creds = readCredentials();
  const authed = !!(creds && creds.tokens && creds.tokens.access_token);
  return {
    installed: true,
    path: bin.exe,
    version,
    authed,
    plan: authed ? planFromIdToken(creds) : null,
    authMode: (creds && creds.auth_mode) || null,
  };
}

/** Snapshot of subscription usage for the panel's usage bars. */
function getUsage() {
  const creds = readCredentials();
  return {
    plan: creds ? planFromIdToken(creds) : null,
    session: { tokens: sessionTokens, costUsd: 0 },
    windows: [],
  };
}

// ---------------------------------------------------------------------------
//  Aurora tool bridge rules
// ---------------------------------------------------------------------------

/**
 * Prepended to the first user turn. Codex's shell tool cannot be removed,
 * so this has to do the heavy lifting of keeping Codex on Aurora's tools.
 */
const MCP_TOOL_RULES = [
  'You are running inside the Aurora IDE. Aurora exposes its own IDE and',
  'compiler tools through an MCP server registered as "aurora"; they appear',
  'to you as `mcp__aurora__<name>`. For every Aurora-specific action you',
  'MUST use these tools — do NOT run shell commands for them.',
  '',
  'Compilation & simulation — NEVER invoke cmmcomp, asmcomp, prismcomp,',
  'yanc, iverilog, vvp or gtkwave from a shell command. Use:',
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
  'The shell tool exists only for incidental, read-only inspection. Any time',
  'a task touches SAPHO compilation, the project tree, processors or',
  'waveforms, the matching mcp__aurora__* tool is mandatory — never the',
  'shell, never raw filesystem writes.',
].join('\n');

// ---------------------------------------------------------------------------
//  Chat
// ---------------------------------------------------------------------------

function sendEvent(webContents, sessionId, type, data) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    webContents.send('ai:chat-event', { sessionId, type, ...(data || {}) });
  } catch (e) {
    log.warn('[ai.codex] send failed:', e?.message || e);
  }
}

/** Directory the CLI should treat as the workspace (the open project). */
function workspaceDir() {
  const spf = state.currentOpenProjectPath || global.currentProjectPath;
  if (spf) {
    try {
      const stat = fs.statSync(spf);
      return stat.isDirectory() ? spf : path.dirname(spf);
    } catch (_) { /* fall through */ }
  }
  return os.homedir();
}

/** Map a Codex model alias to a `-m` value, or null to use the CLI default. */
function modelFlag(modelId) {
  if (!modelId || modelId === 'default') return null;
  return modelId;
}

/**
 * Run one chat turn through the Codex CLI.
 *
 * @param {object} payload
 * @param {string} payload.sessionId
 * @param {string} [payload.conversationId]
 * @param {{role:string,content:string}[]} payload.messages
 * @param {string} [payload.system]
 * @param {string} [payload.modelId]
 * @param {Electron.WebContents} webContents
 */
async function start(payload, webContents) {
  const { sessionId, conversationId, messages, system, modelId } = payload || {};

  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('sessionId is required');
  }
  if (sessions.has(sessionId)) {
    throw new Error(`session already active: ${sessionId}`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  const bin = resolveBinary();
  if (!bin) {
    sendEvent(webContents, sessionId, 'error', {
      message: 'Codex CLI not found. Reinstall Aurora, or run `npm i -g @openai/codex`.',
    });
    return;
  }
  if (!readCredentials()) {
    sendEvent(webContents, sessionId, 'error', {
      message: 'Codex is not signed in. Run `codex login` in a terminal, then reconnect.',
    });
    return;
  }

  // Resume the CLI-side thread when we already have its id; that keeps
  // Codex's own context and means we only send the new user turn.
  const resumeId = conversationId ? convThreads.get(conversationId) : null;
  const last = messages[messages.length - 1];
  let prompt = (last && last.content) || '';

  // No thread to resume but the renderer handed us history (user switched
  // to Codex mid-thread, or the app restarted): fold prior turns in.
  if (!resumeId && messages.length > 1) {
    const transcript = messages.slice(0, -1)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    prompt = `<conversation_context>\n${transcript}\n</conversation_context>\n\n${prompt}`;
  }

  const cwd = workspaceDir();

  // --- argv -----------------------------------------------------------------
  // The `exec` and `exec resume` subcommands accept DIFFERENT flag sets.
  // `resume` rejects `-C`, `--sandbox`, `--add-dir` ("unexpected argument
  // '-C' found") because the resumed thread restores its original cwd
  // and sandbox from disk. Push working-dir flags only on a fresh turn.
  const args = ['exec'];
  if (resumeId) args.push('resume', resumeId);
  args.push(
    '--json',
    '--skip-git-repo-check',
    // See the module header: required for mcp__aurora__* calls to run at
    // all in non-interactive exec mode.
    '--dangerously-bypass-approvals-and-sandbox',
  );
  if (!resumeId) args.push('-C', cwd);
  const model = modelFlag(modelId);
  if (model) args.push('-m', model);

  // Aurora tool bridge — register the MCP server so Codex gets the
  // mcp__aurora__* tools. If it fails to come up the turn still runs;
  // Codex just won't have Aurora's tools (degraded, shell-only).
  let mcpReady = false;
  try {
    const url = await auroraMcp.ensureStarted();
    args.push('-c', `mcp_servers.aurora.url="${url}"`);
    mcpReady = true;
  } catch (e) {
    log.warn('[ai.codex] Aurora MCP bridge unavailable:', e?.message || e);
  }

  // Codex has no `--append-system-prompt`; it reads instructions from the
  // prompt body. Fold the system prompt + tool rules into the prompt on a
  // fresh thread. Resumed threads already have them in context.
  if (!resumeId) {
    const preamble = [];
    if (mcpReady) preamble.push(`<aurora_mcp_tools>\n${MCP_TOOL_RULES}\n</aurora_mcp_tools>`);
    if (system) preamble.push(`<aurora_system_rules>\n${system}\n</aurora_system_rules>`);
    if (preamble.length) prompt = `${preamble.join('\n\n')}\n\n${prompt}`;
  }

  // Force subscription auth: with no API key in the environment Codex
  // falls through to its ChatGPT OAuth tokens.
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  // Prepend Codex's bundled ripgrep so its file search keeps working when
  // we launch the native binary directly (bypassing the npm JS launcher).
  if (bin.rgDir) {
    env.PATH = `${bin.rgDir}${path.delimiter}${env.PATH || ''}`;
  }

  let proc;
  try {
    if (bin.viaShim && process.platform === 'win32') {
      // Global-install fallback: a .cmd/.bat shim needs cmd.exe on
      // Node >= 20.12. Native-binary path skips this entirely.
      proc = spawn('cmd.exe', ['/d', '/s', '/c', bin.exe, ...args], {
        cwd, env, windowsHide: true,
      });
    } else {
      proc = spawn(bin.exe, args, { cwd, env, windowsHide: true });
    }
  } catch (e) {
    sendEvent(webContents, sessionId, 'error', { message: `Failed to launch Codex: ${e?.message || e}` });
    return;
  }

  let stdoutBuf = '';
  let stderrBuf = '';
  let fullText = '';
  let finished = false;
  let aborted = false;
  // Codex item.id → toolName, so a completed item can re-attach the name
  // of the tool/command its `item.started` opened.
  const itemTools = new Map();

  sessions.set(sessionId, { proc, markAborted: () => { aborted = true; } });

  try { proc.stdin.write(prompt); proc.stdin.end(); }
  catch (_) { /* the CLI may have exited already; close path handles it */ }

  // --- event translation ----------------------------------------------------

  const handleObject = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    switch (obj.type) {
      case 'thread.started':
        if (obj.thread_id && conversationId) convThreads.set(conversationId, obj.thread_id);
        break;

      case 'item.started': {
        const item = obj.item || {};
        if (item.type === 'command_execution') {
          itemTools.set(item.id, 'shell');
          sendEvent(webContents, sessionId, 'tool-call', {
            toolUseId: item.id,
            toolName: 'shell',
            args: { command: item.command || '' },
          });
        } else if (item.type === 'mcp_tool_call') {
          const name = item.tool || 'tool';
          itemTools.set(item.id, name);
          sendEvent(webContents, sessionId, 'tool-call', {
            toolUseId: item.id,
            toolName: name,
            args: item.arguments || {},
          });
        }
        break;
      }

      case 'item.completed': {
        const item = obj.item || {};
        if (item.type === 'agent_message') {
          // Codex delivers assistant text as whole messages (no token
          // deltas in exec --json). Stream each as one delta; separate
          // consecutive messages with a blank line.
          const text = item.text || '';
          if (text) {
            const delta = fullText ? `\n\n${text}` : text;
            fullText += delta;
            sendEvent(webContents, sessionId, 'text-delta', { delta });
          }
        } else if (item.type === 'command_execution') {
          const okExit = item.exit_code === 0;
          sendEvent(webContents, sessionId, 'tool-result', {
            toolUseId: item.id,
            toolName: itemTools.get(item.id) || 'shell',
            result: {
              ok: okExit,
              content: item.aggregated_output || '',
              exitCode: item.exit_code,
              ...(okExit ? {} : { error: `command exited with code ${item.exit_code}` }),
            },
          });
        } else if (item.type === 'mcp_tool_call') {
          const name = itemTools.get(item.id) || item.tool || 'tool';
          const isErr = item.status === 'failed' || !!item.error;
          // The Aurora tool's JSON result is wrapped in the MCP envelope
          // ({content:[{type:'text',text}]}); unwrap it for the chip.
          let content = '';
          const blocks = item.result && Array.isArray(item.result.content)
            ? item.result.content : [];
          content = blocks.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n');
          sendEvent(webContents, sessionId, 'tool-result', {
            toolUseId: item.id,
            toolName: name,
            result: {
              ok: !isErr,
              content,
              ...(isErr ? { error: (item.error && item.error.message) || 'tool reported an error' } : {}),
            },
          });
        }
        break;
      }

      case 'turn.completed': {
        finished = true;
        const u = obj.usage || {};
        const totalTokens = (u.input_tokens || 0) + (u.output_tokens || 0);
        sessionTokens += totalTokens;
        sendEvent(webContents, sessionId, 'finish', {
          text: fullText,
          usage: { totalTokens },
        });
        break;
      }

      case 'turn.failed': {
        finished = true;
        const msg = (obj.error && (obj.error.message || obj.error)) || 'Codex reported an error.';
        // A failed resume usually means the thread is gone — drop the
        // mapping so the next turn starts fresh.
        if (resumeId && conversationId) convThreads.delete(conversationId);
        sendEvent(webContents, sessionId, 'error', { message: String(msg) });
        break;
      }

      case 'error': {
        finished = true;
        sendEvent(webContents, sessionId, 'error', {
          message: String(obj.message || 'Codex stream error'),
        });
        break;
      }

      default:
        // thread.started handled above; turn.started, item.updated,
        // reasoning items, etc. — ignored.
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
  });

  proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

  proc.on('error', (err) => {
    sessions.delete(sessionId);
    if (!finished) {
      sendEvent(webContents, sessionId, 'error', { message: `Codex failed to start: ${err?.message || err}` });
    }
  });

  proc.on('close', (code) => {
    sessions.delete(sessionId);
    if (aborted) {
      sendEvent(webContents, sessionId, 'aborted', { text: fullText });
      return;
    }
    if (finished) return;          // a turn.completed / error closed the turn
    if (fullText) {
      sendEvent(webContents, sessionId, 'finish', { text: fullText, usage: null });
    } else {
      if (resumeId && conversationId) convThreads.delete(conversationId);
      const msg = stderrBuf.trim() || `Codex exited (code ${code}) without a response.`;
      sendEvent(webContents, sessionId, 'error', { message: msg });
    }
  });
}

/** Abort an in-flight turn. Returns true if a process was killed. */
function abort(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || !s.proc) return false;
  if (s.markAborted) s.markAborted();
  try {
    if (process.platform === 'win32' && s.proc.pid) {
      spawn('taskkill', ['/pid', String(s.proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      s.proc.kill('SIGTERM');
    }
  } catch (_) { /* the close handler still fires */ }
  return true;
}

/** Kill every in-flight session. Called on app quit so Codex CLI
 *  subprocesses (and their children, via taskkill /T) aren't orphaned —
 *  abort() only ever fired for a single renderer-requested session. */
function killAll() {
  for (const [, s] of sessions) {
    if (!s || !s.proc) continue;
    if (s.markAborted) s.markAborted();
    try {
      if (process.platform === 'win32' && s.proc.pid) {
        spawn('taskkill', ['/pid', String(s.proc.pid), '/T', '/F'], { windowsHide: true });
      } else {
        s.proc.kill('SIGTERM');
      }
    } catch (_) { /* the close handler still fires */ }
  }
  sessions.clear();
}

/** Drop the cached CLI-side thread for a conversation (e.g. on "new chat"). */
function forgetConversation(conversationId) {
  if (conversationId) convThreads.delete(conversationId);
}

module.exports = { detect, getUsage, start, abort, killAll, forgetConversation };
