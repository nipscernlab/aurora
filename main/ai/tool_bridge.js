// @ts-check
/**
 * tool_bridge.js — round-trips a tool call from the main process to the
 * renderer that owns `window.AuroraAPI`, and back.
 *
 * The Vercel AI SDK invokes a tool's `execute()` inside the main
 * process, but the workspace it must act on (Monaco, the file tree,
 * the terminals) only exists in the renderer. So `execute()` calls
 * `runTool()` here: we `webContents.send('ai:tool-exec', ...)`, the
 * renderer's tool_runner does the work (including any ask-before-write
 * confirmation), and replies on `ai:tool-result` — which lands in
 * `resolveToolResult()` and settles the pending promise.
 *
 * A generous timeout guards against a renderer that never answers
 * (e.g. window closed mid-call) so the SDK's tool loop can't wedge.
 */

'use strict';

const log = require('electron-log');

/** requestId → { resolve, timer } */
const pending = new Map();
let seq = 0;

// Long enough for a human to read and answer an ask-before-write
// confirmation without rushing; short enough that a dead renderer
// doesn't pin the SDK's tool loop forever.
const TOOL_TIMEOUT_MS = 120_000;

// Tools that block on a deliberate human answer (the inline question card)
// need a far longer leash — 2 minutes routinely lapses while the user reads
// the options and types, which is why ask_user_question "always failed".
const INTERACTIVE_TOOLS = new Set(['ask_user_question']);
const INTERACTIVE_TIMEOUT_MS = 10 * 60_000;

// Renames touch the filesystem (release watchers → move the folder → rewrite
// the .spf → reopen) and can run well past 2 minutes on a large project or a
// busy machine. The renderer reopens in the background so it usually returns
// in seconds, but give these a long leash so a slow disk never produces a
// false "tool execution timed out" while the rename actually succeeds.
const SLOW_TOOLS = new Set(['rename_project', 'rename_processor']);
const SLOW_TIMEOUT_MS = 5 * 60_000;

/**
 * Dispatch `toolName(args)` to the renderer and resolve with whatever
 * the tool_runner reports. Never rejects — failures resolve as
 * `{ ok:false, error }` so the AI SDK feeds the error back to the
 * model instead of aborting the stream.
 *
 * @param {Electron.WebContents} webContents
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<unknown>}
 */
function runTool(webContents, toolName, args) {
  return new Promise((resolve) => {
    if (!webContents || webContents.isDestroyed()) {
      resolve({ ok: false, error: 'renderer is not available' });
      return;
    }
    const requestId = `tool-${Date.now()}-${++seq}`;
    const timeoutMs = INTERACTIVE_TOOLS.has(toolName) ? INTERACTIVE_TIMEOUT_MS
      : SLOW_TOOLS.has(toolName) ? SLOW_TIMEOUT_MS
      : TOOL_TIMEOUT_MS;
    const timer = setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        log.warn(`[ai.tool_bridge] ${toolName} (${requestId}) timed out`);
        resolve({ ok: false, error: 'tool execution timed out' });
      }
    }, timeoutMs);
    pending.set(requestId, { resolve, timer });
    webContents.send('ai:tool-exec', { requestId, toolName, args });
  });
}

/** Settle a pending tool call with the renderer's result. */
function resolveToolResult(requestId, result) {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(result === undefined ? { ok: true } : result);
}

module.exports = { runTool, resolveToolResult };
