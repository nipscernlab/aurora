// @ts-check
/**
 * claude_agent.js — Claude Agent SDK engine for the Claude Code bridge.
 *
 * Modernization step 2 of the AI-system roadmap (ESTUDO §18.5): instead of
 * shelling out to `claude -p --output-format stream-json` and re-parsing
 * NDJSON, this engine drives the SAME native CLI binary through the official
 * `@anthropic-ai/claude-agent-sdk` (`query()`), which owns the process,
 * the control protocol and the message parsing. What that buys us:
 *
 *   - `canUseTool`: tools flagged "requires user interaction" reach a real
 *     callback EVEN under bypassPermissions — so the CLI's native
 *     AskUserQuestion renders Aurora's interactive card and the chosen
 *     answer flows back to the model (the definitive fix for the
 *     "no question card in bypass mode" bug; the legacy path had to
 *     disallow the native tool entirely).
 *   - Clean aborts via AbortController (no taskkill trees).
 *   - No Windows argv-length limits for the system prompt (it rides the
 *     SDK's control channel, not the command line).
 *   - Structured SDKMessages (same shapes as stream-json, pre-parsed).
 *
 * The engine keeps FULL event parity with the legacy spawn path in
 * claude_code.js — same `ai:chat-event` packets, same convSessions /
 * usage / rate-limit bookkeeping (shared via the `host` bag claude_code
 * passes in). claude_code.start() calls tryStart() first and falls back
 * to the legacy spawn when the SDK is unavailable (import failure,
 * shim-only binary) or when AURORA_CLAUDE_LEGACY_CLI=1 is set.
 *
 * NOTE (kept in sync with claude_code.js): the disallowed-tools list and
 * the MCP rules text below are the SDK-path variants of the legacy
 * constants — the ONLY intended difference is AskUserQuestion, which is
 * blocked on the legacy path (unanswerable there) but ENABLED here
 * (answerable via canUseTool).
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');

const auroraMcp = require('./aurora_mcp_server');
const toolBridge = require('./tool_bridge');
const attachments = require('./attachments');

// ---------------------------------------------------------------------------
//  SDK loading (ESM-only package — dynamic import from CJS, memoized)
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
//  Constants (SDK-path variants — see module header note)
// ---------------------------------------------------------------------------

// Same list as the legacy path MINUS AskUserQuestion: here the native
// question tool is answerable (canUseTool → Aurora card), so it stays on.
const DISALLOWED_TOOLS = [
  'Bash', 'BashOutput', 'KillShell', 'KillBash',
  'Edit', 'Write', 'MultiEdit', 'NotebookEdit',
];

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
  'Asking the user — when you need a decision, clarification or a choice',
  'between options, use your AskUserQuestion tool (preferred) or',
  'mcp__aurora__ask_user_question; both render an interactive card in the',
  'IDE and return the selected answer. Never guess when you could ask.',
  '',
  'If a task seems to need a shell command, you are missing an Aurora tool —',
  'inspect the available mcp__aurora__* tools or ask the user. Do not',
  'improvise with PowerShell or raw filesystem calls for SAPHO work.',
].join('\n');

const INACTIVITY_MS = 120_000; // same liveness leash as the legacy path

// ---------------------------------------------------------------------------
//  AskUserQuestion → Aurora card
// ---------------------------------------------------------------------------

/**
 * Answer a native AskUserQuestion tool call by rendering Aurora's own
 * question card (one per question, sequentially) and mapping the answers
 * back into the tool input's `answers` field (the shape the CLI expects
 * from a canUseTool allow: { questions, answers: { [question]: answer } };
 * multiSelect questions answer with an array of labels).
 *
 * Card round-trip: toolBridge.runTool → renderer tool_runner →
 * AuroraAPI.ui.askUserQuestion → showAskUserQuestionInline. The renderer
 * resolves `{ ok:true, data:{ answer, selected } }` (aurora_api ok()),
 * or ok:false when the user dismissed the card / the turn aborted.
 *
 * @param {Electron.WebContents} webContents
 * @param {Record<string, unknown>} input  native tool input ({ questions })
 * @returns {Promise<{behavior:'allow', updatedInput:Record<string, unknown>}
 *                 | {behavior:'deny', message:string}>}
 */
async function answerAskUserQuestion(webContents, input) {
  const questions = Array.isArray(/** @type {any} */ (input)?.questions)
    ? /** @type {any[]} */ (/** @type {any} */ (input).questions)
    : [];
  if (questions.length === 0) {
    return { behavior: 'deny', message: 'AskUserQuestion carried no questions.' };
  }

  /** @type {Record<string, string|string[]>} */
  const answers = {};
  for (const q of questions) {
    const question = String(q?.question || '').trim();
    if (!question) continue;
    const res = await toolBridge.runTool(webContents, 'ask_user_question', {
      question,
      options: Array.isArray(q?.options)
        ? q.options.map((/** @type {any} */ o) => ({
            label: String(o?.label ?? o ?? ''),
            ...(o?.description ? { description: String(o.description) } : {}),
          })).filter((/** @type {any} */ o) => o.label)
        : [],
      multiSelect: !!q?.multiSelect,
    });
    const data = res && res.ok ? (res.data || {}) : null;
    if (!data || (!data.answer && !(Array.isArray(data.selected) && data.selected.length))) {
      // Dismissed / aborted — tell the model instead of hanging the turn.
      return { behavior: 'deny', message: 'The user dismissed the question.' };
    }
    answers[question] = q?.multiSelect
      ? (Array.isArray(data.selected) && data.selected.length ? data.selected : [String(data.answer)])
      : String(data.answer ?? (Array.isArray(data.selected) ? data.selected[0] : ''));
  }

  return { behavior: 'allow', updatedInput: { ...input, answers } };
}

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
  // (CVE-2024-27980) which the SDK doesn't do — legacy path handles shims.
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
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (!env.MCP_TOOL_TIMEOUT) env.MCP_TOOL_TIMEOUT = '600000'; // see legacy note
  if (!env.MCP_TIMEOUT) env.MCP_TIMEOUT = '30000';

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
    }, INACTIVITY_MS);
    inactivityTimer = t;
  };

  sessions.set(sessionId, {
    stop: () => { try { abortController.abort(); } catch (_) { /* noop */ } },
    markAborted: () => { aborted = true; },
  });

  // ---- message translation (mirrors legacy handleObject) ----------------------
  const handleMessage = (/** @type {any} */ obj) => {
    if (!obj || typeof obj !== 'object') return;
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
        finished = true;
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
        } else {
          sendEvent(webContents, sessionId, 'finish', { text, usage: { totalTokens } });
        }
        break;
      }

      default:
        break;
    }
    armInactivity();
  };

  // ---- run ---------------------------------------------------------------------
  // Streaming-input prompt (an async generator with a single user message):
  // canUseTool rides the SDK's control protocol, which requires the
  // streaming input mode — a plain string prompt would disable it.
  async function* promptStream() {
    yield {
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
    };
  }

  /** @type {Record<string, unknown>} */
  const options = {
    pathToClaudeCodeExecutable: bin.exe,
    cwd,
    env,
    additionalDirectories,
    mcpServers,
    strictMcpConfig: true,
    disallowedTools: DISALLOWED_TOOLS,
    // Same posture as the legacy path: Aurora's renderer gates the MCP
    // tools; native destructive tools are disallowed above. Under bypass,
    // canUseTool still receives interaction-required tools (AskUserQuestion).
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    canUseTool: async (/** @type {string} */ toolName, /** @type {Record<string, unknown>} */ input) => {
      if (toolName === 'AskUserQuestion') {
        try {
          return await answerAskUserQuestion(webContents, input);
        } catch (e) {
          return { behavior: 'deny', message: `Question UI failed: ${e instanceof Error ? e.message : e}` };
        }
      }
      return { behavior: 'allow', updatedInput: input };
    },
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
  } catch (e) {
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
  } finally {
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    sessions.delete(sessionId);
  }
  return true;
}

module.exports = { tryStart, answerAskUserQuestion };
