// @ts-check
/**
 * claude_agent.js: Claude Agent SDK engine for the Claude Code bridge.
 *
 * Modernization step 2 of the AI-system roadmap (ESTUDO §18.5): instead of
 * shelling out to `claude -p --output-format stream-json` and re-parsing
 * NDJSON, this engine drives the SAME native CLI binary through the official
 * `@anthropic-ai/claude-agent-sdk` (`query()`), which owns the process,
 * the control protocol and the message parsing. What that buys us:
 *
 *   - Clean aborts via AbortController (no taskkill trees).
 *   - No Windows argv-length limits for the system prompt (it rides the
 *     SDK's control channel, not the command line).
 *   - Structured SDKMessages (same shapes as stream-json, pre-parsed).
 *
 * The engine keeps FULL event parity with the legacy spawn path in
 * claude_code.js: same `ai:chat-event` packets, same convSessions /
 * usage / rate-limit bookkeeping (shared via the `host` bag claude_code
 * passes in). claude_code.start() calls tryStart() first and falls back
 * to the legacy spawn when the SDK is unavailable (import failure,
 * shim-only binary) or when AURORA_CLAUDE_LEGACY_CLI=1 is set.
 *
 * NOTE (kept in sync with claude_code.js): the disallowed-tools list and the
 * MCP rules text below MIRROR the legacy constants. They used to differ on
 * AskUserQuestion, this engine kept the native tool enabled on the premise
 * that `canUseTool` still fires for interaction-required tools under
 * bypassPermissions. That premise is FALSE, and the SDK says so out loud:
 *
 *   [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] canUseTool will not be invoked:
 *   permissionMode 'bypassPermissions' auto-approves every tool call
 *   (except explicit deny rules) before the callback is consulted.
 *
 * So the native question tool self-resolved CLI-side with no human involved
 * and Aurora only ever saw an inert chip, exactly the "no question card in
 * bypass mode" bug the legacy path had already diagnosed and fixed by
 * disallowing it (see claude_code.js). This engine now does the same, and
 * asking is routed through mcp__aurora__ask_user_question, which reaches the
 * renderer and renders a real card. bypassPermissions stays: Aurora gates its
 * own MCP tools in the renderer and deliberately does not want the CLI's
 * permission system on top of that.
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');

const auroraMcp = require('./aurora_mcp_server');
const attachments = require('./attachments');
const { CLI_INACTIVITY_MS, MCP_TOOL_CALL_MS, MCP_STARTUP_MS } = require('./timeouts');
const { TRANSIENT_MAX_ATTEMPTS, isTransientAiError, backoffDelay, sleep } = require('./retry');

// ---------------------------------------------------------------------------
//  SDK loading (ESM-only package, dynamic import from CJS, memoized)
// ---------------------------------------------------------------------------

/** @type {Promise<any>|null} */
let _sdkPromise = null;
function loadSdk() {
  if (!_sdkPromise) {
    _sdkPromise = import('@anthropic-ai/claude-agent-sdk').catch((e) => {
      _sdkPromise = null; // allow a retry on the next turn
      throw e;
    });
  }
  return _sdkPromise;
}

// ---------------------------------------------------------------------------
//  Constants (SDK-path variants, see module header note)
// ---------------------------------------------------------------------------

// Both lists now live in native_tools.js, one source of truth shared with the
// legacy engine, which is what stops the two from drifting apart again.
const { NATIVE_TOOLS, DISALLOWED_TOOLS } = require('./native_tools');

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

const INACTIVITY_MS = CLI_INACTIVITY_MS; // shared table — see timeouts.js

// ---------------------------------------------------------------------------
//  Engine
// ---------------------------------------------------------------------------

/** Same neutral scratch cwd rationale as the legacy path (folder locking). */
function agentScratchDir() {
  const dir = path.join(os.tmpdir(), 'aurora-ai-cwd');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* best-effort */ }
  return dir;
}

/**
 * Try to run one chat turn through the Agent SDK.
 *
 * @param {object} p
 * @param {string} p.sessionId
 * @param {string} [p.conversationId]
 * @param {{role:string,content:string,attachments?:any[]}[]} p.messages
 * @param {string} [p.system]
 * @param {string} [p.modelId]
 * @param {string} [p.effort]
 * @param {{exe:string, viaShim:boolean}} p.bin  resolved native CLI binary
 * @param {Electron.WebContents} webContents
 * @param {object} host  shared bookkeeping owned by claude_code.js
 * @param {(wc:any, sid:string, type:string, data:any)=>void} host.sendEvent
 * @param {Map<string,string>} host.convSessions
 * @param {Map<string,any>} host.sessions
 * @param {(tokens:number, costUsd:number)=>void} host.addUsage
 * @param {(info:any)=>void} host.setRateLimit
 * @param {()=>string} host.workspaceDir
 * @returns {Promise<boolean>} true when the turn was handled here (success
 *   OR failure-with-error-event); false when the SDK is unavailable and the
 *   caller should fall back to the legacy spawn path.
 */
async function tryStart(p, webContents, host) {
  const { sessionId, conversationId, messages, system, modelId, effort, bin } = p;
  const { sendEvent, convSessions, sessions, addUsage, setRateLimit, workspaceDir } = host;

  if (process.env.AURORA_CLAUDE_LEGACY_CLI === '1') return false;
  // The SDK spawns the executable directly; a .cmd shim needs cmd.exe
  // (CVE-2024-27980) which the SDK doesn't do, legacy path handles shims.
  if (!bin || !bin.exe || bin.viaShim) return false;

  let sdk;
  try {
    sdk = await loadSdk();
  } catch (e) {
    log.warn('[ai.claude-agent] SDK import failed — using legacy CLI:',
      e instanceof Error ? e.message : e);
    return false;
  }

  // ---- prompt assembly (parity with the legacy path) -----------------------
  const resumeId = conversationId ? convSessions.get(conversationId) : null;
  const last = messages[messages.length - 1];
  let prompt = (last && last.content) || '';
  prompt += attachments.buildPromptSuffix(last && last.attachments, { imagesAsFiles: true });

  if (!resumeId && messages.length > 1) {
    const transcript = messages.slice(0, -1)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    prompt = `<conversation_context>\n${transcript}\n</conversation_context>\n\n${prompt}`;
  }

  // ---- MCP bridge -----------------------------------------------------------
  /** @type {Record<string, any>} */
  let mcpServers = {};
  let mcpReady = false;
  try {
    const url = await auroraMcp.ensureStarted();
    mcpServers = { aurora: { type: 'http', url } };
    mcpReady = true;
  } catch (e) {
    log.warn('[ai.claude-agent] Aurora MCP bridge unavailable:',
      e instanceof Error ? e.message : e);
  }
  if (mcpReady && !resumeId) {
    prompt = `<aurora_mcp_tools>\n${MCP_TOOL_RULES}\n</aurora_mcp_tools>\n\n${prompt}`;
  }

  // ---- env / dirs ------------------------------------------------------------
  // Subscription billing only: never let the CLI fall back to a metered key.
  const env = { ...process.env };
  // O Opus 5 delega a subagentes com gosto, e cada subagente e uma conta a
  // parte na assinatura da pessoa. Um nivel de profundidade e quatro ao mesmo
  // tempo cobrem o que a AURORA pede (explorar, revisar) sem virar arvore.
  // Documentado em code.claude.com/docs/en/agent-sdk/subagents.
  if (!env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH) env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = '1';
  if (!env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS) env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = '4';
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (!env.MCP_TOOL_TIMEOUT) env.MCP_TOOL_TIMEOUT = String(MCP_TOOL_CALL_MS); // see legacy note
  if (!env.MCP_TIMEOUT) env.MCP_TIMEOUT = String(MCP_STARTUP_MS);

  const projectDir = workspaceDir();
  const cwd = agentScratchDir();
  try { fs.mkdirSync(attachments.ATT_DIR, { recursive: true }); } catch (_) { /* best-effort */ }
  const additionalDirectories = [projectDir, attachments.ATT_DIR];
  if (cwd !== projectDir) additionalDirectories.push(cwd);

  // ---- turn state -------------------------------------------------------------
  const abortController = new AbortController();
  let fullText = '';
  let finished = false;
  let aborted = false;
  let stalled = false;
  // True once ANY message reached us this attempt, the retry gate: a turn
  // may only be replayed while the user has seen nothing (§18.5 item 4).
  let anyEvent = false;
  const seenToolCalls = new Set();
  const toolUseNames = new Map();
  const pendingTools = new Set();

  /** @type {ReturnType<typeof setTimeout>|null} */
  let inactivityTimer = null;
  const armInactivity = () => {
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    if (finished || aborted || pendingTools.size > 0) return;
    const t = setTimeout(() => {
      if (t !== inactivityTimer) return;
      stalled = true;
      try { abortController.abort(); } catch (_) { /* loop exit handles it */ }
      wakeInputNow();   // let promptStream return instead of awaiting forever
    }, INACTIVITY_MS);
    inactivityTimer = t;
  };

  // ---- mid-turn follow-ups -----------------------------------------------------
  // The user can send while a turn is running. Rather than parking the message
  // in the renderer until the turn ends, push it into the LIVE session: it is
  // already in the CLI's transcript, so it runs with no re-dispatch and no
  // context rebuild. Measured against the real CLI (see promptStream below).
  /** @type {string[]} */
  const followUps = [];
  /** @type {(() => void)|null} */
  let wakeInput = null;
  let inputClosed = false;
  // True while a user message is in flight (yielded, `result` not back yet).
  // Exactly ONE may be in flight, see promptStream for why that is load-bearing
  // and not just tidiness.
  let awaitingResult = false;
  const wakeInputNow = () => { const w = wakeInput; wakeInput = null; w?.(); };

  sessions.set(sessionId, {
    stop: () => {
      try { abortController.abort(); } catch (_) { /* noop */ }
      wakeInputNow();   // let promptStream return instead of awaiting forever
    },
    markAborted: () => { aborted = true; wakeInputNow(); },
    /**
     * Feed a follow-up into this live turn. Returns false once the turn is
     * winding down, so the renderer falls back to its own queue instead of
     * dropping the message.
     * @param {string} content
     */
    pushUserMessage: (content) => {
      if (inputClosed || finished || aborted || stalled) return false;
      if (typeof content !== 'string' || !content.trim()) return false;
      followUps.push(content);
      wakeInputNow();
      return true;
    },
  });

  // ---- message translation (mirrors legacy handleObject) ----------------------
  const handleMessage = (/** @type {any} */ obj) => {
    if (!obj || typeof obj !== 'object') return;
    anyEvent = true;
    switch (obj.type) {
      case 'system':
        if (obj.subtype === 'init' && obj.session_id && conversationId) {
          convSessions.set(conversationId, obj.session_id);
        }
        break;

      case 'rate_limit_event': {
        const info = obj.rate_limit_info;
        if (info && info.rateLimitType) setRateLimit(info);
        break;
      }

      case 'stream_event': {
        const ev = obj.event || {};
        if (ev.type === 'content_block_delta' && ev.delta
            && ev.delta.type === 'text_delta' && ev.delta.text) {
          fullText += ev.delta.text;
          sendEvent(webContents, sessionId, 'text-delta', { delta: ev.delta.text });
        }
        break;
      }

      case 'assistant': {
        const blocks = (obj.message && obj.message.content) || [];
        for (const b of blocks) {
          if (b && b.type === 'tool_use' && !seenToolCalls.has(b.id)) {
            seenToolCalls.add(b.id);
            const toolName = b.name || 'tool';
            toolUseNames.set(b.id, toolName);
            sendEvent(webContents, sessionId, 'tool-call', {
              toolUseId: b.id, toolName, args: b.input || {},
            });
            pendingTools.add(b.id);
          }
        }
        break;
      }

      case 'user': {
        const blocks = (obj.message && obj.message.content) || [];
        for (const b of blocks) {
          if (b && b.type === 'tool_result') {
            const id = b.tool_use_id || null;
            const name = (id && toolUseNames.get(id)) || 'tool';
            let resultText = '';
            if (typeof b.content === 'string') resultText = b.content;
            else if (Array.isArray(b.content)) {
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
        // One yield, one result (promptStream keeps a single message in flight).
        // Anything left in followUps means the CLI has another turn to run in
        // THIS session, so the UI turn is not over yet.
        awaitingResult = false;
        const more = !obj.is_error && !aborted && followUps.length > 0;
        finished = !more;
        const text = typeof obj.result === 'string' && obj.result ? obj.result : fullText;
        const u = obj.usage || {};
        const totalTokens =
          (u.input_tokens || 0) + (u.output_tokens || 0) +
          (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        addUsage(totalTokens, Number(obj.total_cost_usd) || 0);
        if (obj.is_error) {
          if (resumeId && conversationId) convSessions.delete(conversationId);
          sendEvent(webContents, sessionId, 'error', {
            message: text || obj.api_error_status || 'Claude Code reported an error.',
          });
          inputClosed = true;
        } else {
          // `more` tells the renderer to seal this segment but KEEP streaming:
          // a follow-up is waiting and answers next in this same session.
          sendEvent(webContents, sessionId, 'finish', { text, usage: { totalTokens }, more });
          if (!more) inputClosed = true;
        }
        // Always wake: either to release the next follow-up, or to let
        // promptStream see inputClosed and RETURN, which is the only thing
        // that ends the output stream and lets the for-await below exit.
        wakeInputNow();
        // Reset the per-segment accumulator so the next in-session turn does not
        // re-emit the previous one's prose as its own result text.
        if (more) fullText = '';
        break;
      }

      default:
        break;
    }
    armInactivity();
  };

  // ---- run ---------------------------------------------------------------------
  // Streaming-input prompt. This generator IS the input channel, and three
  // facts about it were measured against the real CLI, not assumed:
  //
  //  1. The SDK ends the output stream when this generator RETURNS, NOT at
  //     `result`. Left open with nothing to close it, the for-await below never
  //     exits, `finish` never reaches the renderer and the panel streams
  //     forever. Closing on the last outstanding result is what prevents that.
  //  2. priority:'next' lets the in-flight turn finish cleanly and runs the
  //     follow-up right after, in-session (measured: full output, result
  //     success, then a fresh turn for the follow-up).
  //  3. priority:'now' would ABORT the in-flight turn, it comes back
  //     `error_during_execution` and the work in progress is thrown away. That
  //     is an interrupt, not a follow-up, so it is deliberately not used here.
  //
  // Hence ONE message in flight at a time (`awaitingResult`), releasing the
  // next only once the previous result lands. Yielding them eagerly looks
  // fine and is not: the CLI COALESCES queued async messages into a single
  // turn, so three messages came back as two results, one answer silently
  // dropped, and the counter that was supposed to close the input never
  // reached zero, hanging the turn until the 60s backstop. Serialising costs
  // nothing (the user is typing far slower than a turn) and makes the
  // termination rule provable: one yield, one result, close when none queued.
  async function* promptStream() {
    awaitingResult = true;
    yield {
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
    };
    for (;;) {
      if (!awaitingResult && followUps.length) {
        const content = /** @type {string} */ (followUps.shift());
        awaitingResult = true;
        yield {
          type: 'user',
          message: { role: 'user', content },
          parent_tool_use_id: null,
          priority: 'next',
        };
        continue;
      }
      if (inputClosed || aborted || stalled) return;
      await new Promise((resolve) => { wakeInput = resolve; });
    }
  }

  /** @type {Record<string, unknown>} */
  const options = {
    pathToClaudeCodeExecutable: bin.exe,
    cwd,
    env,
    additionalDirectories,
    mcpServers,
    strictMcpConfig: true,
    // The built-in surface, as an ALLOWLIST, anything absent does not exist for
    // the model. MCP is untouched by this: mcp__aurora__* stays available and
    // keeps going through the renderer's card. See native_tools.js for why this
    // is not a blocklist.
    tools: NATIVE_TOOLS,
    disallowedTools: DISALLOWED_TOOLS,
    // Same posture as the legacy path: Aurora's renderer gates the MCP tools
    // (tool_runner → the Allow/Deny card) and native destructive tools are
    // disallowed above, so the CLI's own permission system is redundant here.
    //
    // No canUseTool: bypassPermissions auto-approves every call BEFORE the
    // callback is consulted, so one would be dead code that reads as a gate:
    // which is exactly how AskUserQuestion ended up silently broken. The SDK
    // warns about this (CLAUDE_SDK_CAN_USE_TOOL_SHADOWED). If a native tool
    // ever needs a human, disallow it here and expose an mcp__aurora__ tool.
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    abortController,
    ...(modelId && modelId !== 'default' ? { model: modelId } : {}),
    ...(effort ? { effort } : {}),
    ...(resumeId ? { resume: resumeId } : {}),
    // Small system prompts append to the CLI preset; the SDK control channel
    // has no argv limit, so unlike the legacy path there is no need to fold
    // large ones into the prompt body.
    ...(system ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: system } } : {}),
    stderr: (/** @type {string} */ data) => {
      // Surfaced only on failure paths; kept short.
      if (data) log.debug('[ai.claude-agent] stderr:', String(data).slice(0, 400));
    },
  };

  try {
    // Attempt loop (§18.5 item 4): a TRANSIENT failure (429/5xx/network)
    // before ANYTHING was emitted replays the whole turn after a
    // full-jitter backoff. Once a single event reached the renderer,
    // retrying would duplicate output, so anyEvent gates it off.
    for (let attempt = 1; ; attempt++) {
      // Fresh per-attempt turn state (invisible: nothing was emitted yet).
      fullText = ''; finished = false; stalled = false; anyEvent = false;
      seenToolCalls.clear(); toolUseNames.clear(); pendingTools.clear();
      // Fresh input channel per attempt (promptStream() is re-created below).
      // followUps is deliberately NOT cleared: a retry only happens when the
      // user has seen nothing, so anything they typed meanwhile still owes them
      // an answer and rides along on the replay.
      awaitingResult = false; inputClosed = false; wakeInput = null;
      armInactivity();
      try {
        for await (const message of sdk.query({ prompt: promptStream(), options })) {
          handleMessage(message);
        }
        // Stream ended. If no `result` closed the turn, mirror the legacy
        // close-handler semantics.
        if (!finished) {
          if (aborted) {
            sendEvent(webContents, sessionId, 'aborted', { text: fullText });
          } else if (stalled) {
            sendEvent(webContents, sessionId, 'error', {
              message: 'Claude Code stopped responding (no output). Please try again.',
            });
          } else if (fullText) {
            sendEvent(webContents, sessionId, 'finish', { text: fullText, usage: null });
          } else {
            if (resumeId && conversationId) convSessions.delete(conversationId);
            sendEvent(webContents, sessionId, 'error', {
              message: 'Claude Code ended without a response.',
            });
          }
        }
        break;
      } catch (e) {
        const retryable = !finished && !aborted && !stalled && !anyEvent
          && attempt < TRANSIENT_MAX_ATTEMPTS && isTransientAiError(e);
        if (retryable) {
          const delayMs = backoffDelay(attempt);
          log.warn(`[ai.claude-agent] transient failure (attempt ${attempt}/${TRANSIENT_MAX_ATTEMPTS}) — retrying in ${delayMs}ms:`,
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
              message: 'Claude Code stopped responding (no output). Please try again.',
            });
          } else {
            // A failed --resume usually means the CLI-side session is gone.
            if (resumeId && conversationId) convSessions.delete(conversationId);
            sendEvent(webContents, sessionId, 'error', {
              message: `Claude Code failed: ${e instanceof Error ? e.message : e}`,
            });
          }
        } else {
          log.warn('[ai.claude-agent] post-result stream error (ignored):',
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
