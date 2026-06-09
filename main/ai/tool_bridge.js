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
 * Completion is event-driven, not clock-driven: a call settles when the
 * renderer actually replies on `ai:tool-result` (`resolveToolResult`), and
 * a renderer that dies mid-call (window closed, render process gone) settles
 * the call at once via webContents events — no waiting for a timer. The
 * timeout below is therefore a pure last-resort backstop for the one case
 * events can't catch: a renderer that is still ALIVE but wedged (a tool_runner
 * deadlock that never replies and never crashes). That's why it can be
 * generous without making slow-but-healthy tools (renames) falsely "fail".
 */

'use strict';

const log = require('electron-log');

/** requestId → { settle } — settle() clears the timer, detaches the death
 *  listeners, removes the entry, and resolves the runTool promise exactly once. */
const pending = new Map();
let seq = 0;

// Backstop only (see header): long enough that a slow-but-healthy tool or a
// human reading an ask-before-write card is never cut off, since a genuinely
// dead renderer is now caught by events rather than by this timer.
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

    // Single settle point: whichever of the three outcomes fires first
    // (renderer reply, renderer death, or the backstop timer) tears down the
    // other two and resolves the promise once.
    let done = false;
    const settle = (/** @type {any} */ result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        webContents.removeListener('destroyed', onGone);
        webContents.removeListener('render-process-gone', onGone);
      } catch (_) { /* webContents already gone */ }
      pending.delete(requestId);
      resolve(result);
    };
    // Event-driven failure: the renderer that owns this call vanished, so the
    // reply will never come. Don't wait out the backstop — fail immediately.
    const onGone = () => {
      log.warn(`[ai.tool_bridge] ${toolName} (${requestId}) renderer gone before reply`);
      settle({ ok: false, error: 'renderer closed before the tool finished' });
    };
    const timer = setTimeout(() => {
      log.warn(`[ai.tool_bridge] ${toolName} (${requestId}) hit the ${timeoutMs}ms backstop`);
      settle({ ok: false, error: 'tool execution timed out' });
    }, timeoutMs);

    webContents.once('destroyed', onGone);
    webContents.once('render-process-gone', onGone);

    pending.set(requestId, { settle });
    webContents.send('ai:tool-exec', { requestId, toolName, args });
  });
}

/**
 * Settle a pending tool call with the renderer's result.
 * @param {string} requestId
 * @param {any} result
 */
function resolveToolResult(requestId, result) {
  const entry = pending.get(requestId);
  if (!entry) return;
  entry.settle(result === undefined ? { ok: true } : result);
}

module.exports = { runTool, resolveToolResult };
