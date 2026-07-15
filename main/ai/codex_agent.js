// @ts-check
/**
 * codex_agent.js — Codex SDK engine for the ChatGPT/Codex bridge.
 *
 * Modernization step 3 of the AI-system roadmap (ESTUDO §18.5): instead of
 * shelling out to `codex exec --json` and re-parsing JSONL, this engine
 * drives the SAME native codex binary through the official
 * `@openai/codex-sdk` (Thread API), which owns the process, the flag
 * mapping and the event parsing. What that buys us:
 *
 *   - Clean aborts via AbortSignal (TurnOptions.signal — no taskkill trees).
 *   - Incremental assistant text when the CLI emits `item.updated` for
 *     agent messages (the engine diffs and streams real deltas; whole-message
 *     turns degrade to exactly the legacy behaviour).
 *   - `resumeThread(id)` instead of hand-rolled `exec resume` argv juggling.
 *   - Typed thread options (sandboxMode/approvalPolicy) instead of the
 *     monolithic --dangerously-bypass-approvals-and-sandbox flag — same
 *     effective posture (see below), but explicit.
 *
 * The engine keeps FULL event parity with the legacy spawn path in
 * codex_cli.js — same `ai:chat-event` packets, same convThreads / usage
 * bookkeeping (shared via the `host` bag codex_cli passes in).
 * codex_cli.start() calls tryStart() first and falls back to the legacy
 * spawn when the SDK is unavailable (import failure, shim-only binary) or
 * when AURORA_CODEX_LEGACY_CLI=1 is set.
 *
 * Sandbox/approvals posture — unchanged from the legacy path on purpose:
 * `approvalPolicy:'never'` + `sandboxMode:'danger-full-access'` is what the
 * legacy `--dangerously-bypass-approvals-and-sandbox` flag expands to, and
 * it remains the ONLY combination where mcp__aurora__* calls run at all in
 * non-interactive mode (anything else auto-declines them). Aurora's real
 * guard-rails live in the renderer's permission gate for MCP tools.
 *
 * NOTE (kept in sync with codex_cli.js): MCP_TOOL_RULES and the
 * model-not-supported rewrite below mirror the legacy constants verbatim.
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');

const auroraMcp = require('./aurora_mcp_server');
const attachments = require('./attachments');
const { CLI_INACTIVITY_MS, MCP_TOOL_CALL_MS } = require('./timeouts');
const { TRANSIENT_MAX_ATTEMPTS, isTransientAiError, backoffDelay, sleep } = require('./retry');

// ---------------------------------------------------------------------------
//  SDK loading (ESM-only package — dynamic import from CJS, memoized)
// ---------------------------------------------------------------------------

/** @type {Promise<any>|null} */
let _sdkPromise = null;
function loadSdk() {
  if (!_sdkPromise) {
    _sdkPromise = import('@openai/codex-sdk').catch((e) => {
      _sdkPromise = null; // allow a retry on the next turn
      throw e;
    });
  }
  return _sdkPromise;
}

// ---------------------------------------------------------------------------
//  Constants (kept in sync with codex_cli.js — see module header)
// ---------------------------------------------------------------------------

const MCP_TOOL_RULES = [
  'You are running inside the Aurora IDE. Aurora exposes its own IDE and',
  'compiler tools through an MCP server registered as "aurora"; they appear',
  'to you as `mcp__aurora__<name>`. For every Aurora-specific action you',
  'MUST use these tools — do NOT run shell commands for them.',
  '',
  'Compilation & simulation — NEVER invoke any YANC binary (cmmcomp, cppcomp,',
  'cpppp, appcomp, asmcomp), nor yanc, iverilog, vvp, verilator or gtkwave',
  'from a shell command. Use:',
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
  'Asking the user — you have NO way to prompt a human directly in this',
  'non-interactive mode. Whenever you need a decision, clarification or a',
  'choice between options, call mcp__aurora__ask_user_question — it renders',
  'an interactive card in the IDE and returns the selected answer. Never',
  'guess when you could ask.',
  '',
  'The shell tool exists only for incidental, read-only inspection. Any time',
  'a task touches SAPHO compilation, the project tree, processors or',
  'waveforms, the matching mcp__aurora__* tool is mandatory — never the',
  'shell, never raw filesystem writes.',
].join('\n');

const INACTIVITY_MS = CLI_INACTIVITY_MS; // shared table — see timeouts.js
const VALID_EFFORT = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** Same neutral scratch cwd rationale as the legacy path (folder locking). */
function agentScratchDir() {
  const dir = path.join(os.tmpdir(), 'aurora-ai-cwd');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* best-effort */ }
  return dir;
}

/** Friendly rewrite for plan-model mismatches (kept in sync with codex_cli.js). */
function rewriteModelError(/** @type {string} */ msg) {
  if (/model is not supported when using Codex with a ChatGPT account/i.test(msg)) {
    return msg.replace(/\s*$/, '') +
      "\n\nFix: open the model menu next to the composer and pick " +
      "**Default** (the CLI chooses a model your plan covers) or one of " +
      "the GPT-5.6 presets — Sol / Terra / Luna (Plus and Pro). " +
      "Spark requires ChatGPT Pro.";
  }
  return msg;
}

// ---------------------------------------------------------------------------
//  Engine
// ---------------------------------------------------------------------------

/**
 * Try to run one chat turn through the Codex SDK.
 *
 * @param {object} p
 * @param {string} p.sessionId
 * @param {string} [p.conversationId]
 * @param {{role:string,content:string,attachments?:any[]}[]} p.messages
 * @param {string} [p.system]
 * @param {string} [p.modelId]
 * @param {string} [p.effort]
 * @param {{exe:string, rgDir:string|null, viaShim:boolean}} p.bin
 * @param {Electron.WebContents} webContents
 * @param {object} host  shared bookkeeping owned by codex_cli.js
 * @param {(wc:any, sid:string, type:string, data:any)=>void} host.sendEvent
 * @param {Map<string,string>} host.convThreads
 * @param {Map<string,any>} host.sessions
 * @param {(tokens:number)=>void} host.addTokens
 * @returns {Promise<boolean>} true when the turn was handled here (success
 *   OR failure-with-error-event); false → caller falls back to legacy spawn.
 */
async function tryStart(p, webContents, host) {
  const { sessionId, conversationId, messages, system, modelId, effort, bin } = p;
  const { sendEvent, convThreads, sessions, addTokens } = host;

  if (process.env.AURORA_CODEX_LEGACY_CLI === '1') return false;
  // The SDK spawns the executable directly; .cmd shims need cmd.exe
  // (CVE-2024-27980), which the legacy path handles.
  if (!bin || !bin.exe || bin.viaShim) return false;

  let sdk;
  try {
    sdk = await loadSdk();
  } catch (e) {
    log.warn('[ai.codex-agent] SDK import failed — using legacy CLI:',
      e instanceof Error ? e.message : e);
    return false;
  }

  // ---- prompt assembly (parity with the legacy path) -------------------------
  const resumeId = conversationId ? convThreads.get(conversationId) : null;
  const last = messages[messages.length - 1];
  let prompt = (last && last.content) || '';
  prompt += attachments.buildPromptSuffix(last && last.attachments, { imagesAsFiles: false });

  if (!resumeId && messages.length > 1) {
    const transcript = messages.slice(0, -1)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    prompt = `<conversation_context>\n${transcript}\n</conversation_context>\n\n${prompt}`;
  }

  // ---- MCP bridge -------------------------------------------------------------
  /** @type {Record<string, any>} */
  const config = {};
  let mcpReady = false;
  try {
    const url = await auroraMcp.ensureStarted();
    // Same values as the legacy `-c` overrides; the SDK flattens this
    // object into --config key=value TOML literals.
    config.mcp_servers = { aurora: { url, tool_timeout_sec: MCP_TOOL_CALL_MS / 1000 } };
    mcpReady = true;
  } catch (e) {
    log.warn('[ai.codex-agent] Aurora MCP bridge unavailable:',
      e instanceof Error ? e.message : e);
  }

  // Reasoning effort — via config (accepts `max` on the GPT-5.6 family,
  // which the SDK's narrower ThreadOptions type doesn't list yet).
  if (effort && VALID_EFFORT.has(String(effort))) {
    config.model_reasoning_effort = String(effort);
  }

  // Codex has no --append-system-prompt; fold system + rules into the prompt
  // on a fresh thread (resumed threads already carry them in context).
  if (!resumeId) {
    const preamble = [];
    if (mcpReady) preamble.push(`<aurora_mcp_tools>\n${MCP_TOOL_RULES}\n</aurora_mcp_tools>`);
    if (system) preamble.push(`<aurora_system_rules>\n${system}\n</aurora_system_rules>`);
    if (preamble.length) prompt = `${preamble.join('\n\n')}\n\n${prompt}`;
  }

  // ---- env ---------------------------------------------------------------------
  // CodexOptions.env REPLACES the child environment (no process.env
  // inheritance), so hand it the full sanitized clone: no OPENAI_API_KEY
  // (forces ChatGPT OAuth) + the bundled ripgrep on PATH (file search when
  // launching the native binary directly).
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  delete env.OPENAI_API_KEY;
  if (bin.rgDir) env.PATH = `${bin.rgDir}${path.delimiter}${env.PATH || ''}`;

  // ---- turn state ----------------------------------------------------------------
  const abortController = new AbortController();
  let fullText = '';
  let finished = false;
  let aborted = false;
  let stalled = false;
  // True once ANY event reached us this attempt — the retry gate: a turn
  // may only be replayed while the user has seen nothing (§18.5 item 4).
  let anyEvent = false;
  const itemTools = new Map();
  const pendingTools = new Set();
  /** Per-item text already streamed, so item.updated diffs into real deltas. */
  const emittedText = new Map();

  /** @type {ReturnType<typeof setTimeout>|null} */
  let inactivityTimer = null;
  const armInactivity = () => {
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    if (finished || aborted || pendingTools.size > 0) return;
    const t = setTimeout(() => {
      if (t !== inactivityTimer) return;
      stalled = true;
      try { abortController.abort(); } catch (_) { /* stream loop settles it */ }
    }, INACTIVITY_MS);
    inactivityTimer = t;
  };

  sessions.set(sessionId, {
    stop: () => { try { abortController.abort(); } catch (_) { /* noop */ } },
    markAborted: () => { aborted = true; },
  });

  // ---- event translation (mirrors legacy handleObject) -----------------------------

  /** Stream the not-yet-emitted tail of an agent message. */
  const emitAgentText = (/** @type {any} */ item, /** @type {boolean} */ isFinal) => {
    const text = String(item.text || '');
    const already = emittedText.get(item.id) || '';
    let delta = '';
    if (text.startsWith(already)) {
      delta = text.slice(already.length);
    } else if (isFinal && text) {
      // Rewritten wholesale (rare) — emit the final text as one block.
      delta = already ? `\n\n${text}` : text;
    }
    if (!delta) return;
    // Blank line between consecutive agent messages (legacy behaviour) —
    // only when this is a NEW item starting after prior text.
    if (!already && fullText && !fullText.endsWith('\n\n')) {
      delta = `\n\n${delta}`;
    }
    emittedText.set(item.id, text);
    fullText += delta;
    sendEvent(webContents, sessionId, 'text-delta', { delta });
  };

  const handleEvent = (/** @type {any} */ obj) => {
    if (!obj || typeof obj !== 'object') return;
    anyEvent = true;
    switch (obj.type) {
      case 'thread.started':
        if (obj.thread_id && conversationId) convThreads.set(conversationId, obj.thread_id);
        break;

      case 'item.started': {
        const item = obj.item || {};
        if (item.type === 'command_execution') {
          itemTools.set(item.id, 'shell');
          pendingTools.add(item.id);
          sendEvent(webContents, sessionId, 'tool-call', {
            toolUseId: item.id, toolName: 'shell', args: { command: item.command || '' },
          });
        } else if (item.type === 'mcp_tool_call') {
          const name = item.tool || 'tool';
          itemTools.set(item.id, name);
          pendingTools.add(item.id);
          sendEvent(webContents, sessionId, 'tool-call', {
            toolUseId: item.id, toolName: name, args: item.arguments || {},
          });
        } else if (item.type === 'agent_message') {
          emitAgentText(item, false);
        }
        break;
      }

      case 'item.updated': {
        const item = obj.item || {};
        // Incremental assistant text — the SDK-path upgrade over exec --json.
        if (item.type === 'agent_message') emitAgentText(item, false);
        break;
      }

      case 'item.completed': {
        const item = obj.item || {};
        if (item.type === 'agent_message') {
          emitAgentText(item, true);
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
          pendingTools.delete(item.id);
        } else if (item.type === 'mcp_tool_call') {
          const name = itemTools.get(item.id) || item.tool || 'tool';
          const isErr = item.status === 'failed' || !!item.error;
          // Unwrap the MCP envelope ({content:[{type:'text',text}]}) for the chip.
          const blocks = item.result && Array.isArray(item.result.content)
            ? item.result.content : [];
          const content = blocks
            .map((/** @type {any} */ b) => (b && b.type === 'text' ? b.text : ''))
            .filter(Boolean).join('\n');
          sendEvent(webContents, sessionId, 'tool-result', {
            toolUseId: item.id,
            toolName: name,
            result: {
              ok: !isErr,
              content,
              ...(isErr ? { error: (item.error && item.error.message) || 'tool reported an error' } : {}),
            },
          });
          pendingTools.delete(item.id);
        }
        break;
      }

      case 'turn.completed': {
        finished = true;
        const u = obj.usage || {};
        addTokens(
          (u.input_tokens || 0) + (u.cached_input_tokens || 0) +
          (u.output_tokens || 0) + (u.reasoning_output_tokens || 0),
        );
        sendEvent(webContents, sessionId, 'finish', {
          text: fullText,
          usage: { totalTokens: (u.input_tokens || 0) + (u.output_tokens || 0) },
        });
        break;
      }

      case 'turn.failed': {
        finished = true;
        const msg = rewriteModelError(String((obj.error && obj.error.message) || 'Codex turn failed'));
        // A failed resume usually means the thread is gone — start fresh next turn.
        if (resumeId && conversationId) convThreads.delete(conversationId);
        sendEvent(webContents, sessionId, 'error', { message: msg });
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
        // turn.started, reasoning/todo/web_search items — ignored (parity).
        break;
    }
    armInactivity();
  };

  // ---- run --------------------------------------------------------------------------
  const threadOptions = {
    // See the module header: identical posture to the legacy bypass flag.
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
    workingDirectory: agentScratchDir(),
    skipGitRepoCheck: true,
    ...(modelId && modelId !== 'default' ? { model: modelId } : {}),
  };

  try {
    // Attempt loop (§18.5 item 4): a TRANSIENT failure (429/5xx/network)
    // before ANYTHING was emitted replays the whole turn after a
    // full-jitter backoff. Once a single event reached the renderer,
    // retrying would duplicate output — so anyEvent gates it off.
    for (let attempt = 1; ; attempt++) {
      // Fresh per-attempt turn state (invisible: nothing was emitted yet).
      fullText = ''; finished = false; stalled = false; anyEvent = false;
      itemTools.clear(); pendingTools.clear(); emittedText.clear();
      armInactivity();
      try {
        const codex = new sdk.Codex({ codexPathOverride: bin.exe, env, config });
        const thread = resumeId
          ? codex.resumeThread(resumeId, threadOptions)
          : codex.startThread(threadOptions);

        const { events } = await thread.runStreamed(prompt, { signal: abortController.signal });
        for await (const ev of events) handleEvent(ev);

        // Thread id can also surface via the Thread object (belt & braces).
        if (!resumeId && conversationId && thread.id) convThreads.set(conversationId, thread.id);

        if (!finished) {
          if (aborted) {
            sendEvent(webContents, sessionId, 'aborted', { text: fullText });
          } else if (stalled) {
            sendEvent(webContents, sessionId, 'error', {
              message: 'Codex stopped responding (no output). Please try again.',
            });
          } else if (fullText) {
            sendEvent(webContents, sessionId, 'finish', { text: fullText, usage: null });
          } else {
            if (resumeId && conversationId) convThreads.delete(conversationId);
            sendEvent(webContents, sessionId, 'error', {
              message: 'Codex ended without a response.',
            });
          }
        }
        break;
      } catch (e) {
        const retryable = !finished && !aborted && !stalled && !anyEvent
          && attempt < TRANSIENT_MAX_ATTEMPTS && isTransientAiError(e);
        if (retryable) {
          const delayMs = backoffDelay(attempt);
          log.warn(`[ai.codex-agent] transient failure (attempt ${attempt}/${TRANSIENT_MAX_ATTEMPTS}) — retrying in ${delayMs}ms:`,
            e instanceof Error ? e.message : e);
          await sleep(delayMs);
          if (aborted) { sendEvent(webContents, sessionId, 'aborted', { text: fullText }); break; }
          continue;
        }
        if (!finished) {
          if (aborted) {
            sendEvent(webContents, sessionId, 'aborted', { text: fullText });
          } else if (stalled) {
            sendEvent(webContents, sessionId, 'error', {
              message: 'Codex stopped responding (no output). Please try again.',
            });
          } else {
            if (resumeId && conversationId) convThreads.delete(conversationId);
            sendEvent(webContents, sessionId, 'error', {
              message: rewriteModelError(`Codex failed: ${e instanceof Error ? e.message : e}`),
            });
          }
        } else {
          log.warn('[ai.codex-agent] post-finish stream error (ignored):',
            e instanceof Error ? e.message : e);
        }
        break;
      }
    }
  } finally {
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    sessions.delete(sessionId);
  }
  return true;
}

module.exports = { tryStart };
