/**
 * tool_runner.js — executes Aurora Intelligence tool calls in the renderer.
 *
 * The AI SDK runs in the main process, but the workspace the assistant
 * acts on (Monaco, the file tree, the terminals) lives here. Main ships
 * each tool call over `ai:tool-exec`; this module:
 *
 *   1. looks the tool up in the manifest pulled from main,
 *   2. asks the chat panel to clear it — the panel applies the user's
 *      permission mode (allow-all / ask-before-changes / ask-every-time)
 *      and shows an inline Allow/Deny card when needed,
 *   3. dispatches to the matching `window.AuroraAPI` method,
 *   4. reports the result back with `sendToolResult`.
 *
 * A denied call resolves as a normal `{ ok:false }` result so the model
 * is told "the user declined" rather than seeing a crash.
 */

import { aiAssistantManager } from '../ui/ai_assistant_manager.js';

/** toolName → manifest definition */
let manifest = new Map();
let unsubscribe = null;

/** Turn the JSON args object into the positional call arguments. */
function buildCallArgs(def, args) {
  if (def.argStyle === 'none') return [];
  if (def.argStyle === 'object') return [args || {}];
  return (def.argNames || []).map((name) => (args || {})[name]);
}

async function handleToolExec({ requestId, toolName, args }) {
  const reply = (result) => window.aiAPI?.sendToolResult?.(requestId, result);

  const def = manifest.get(toolName);
  if (!def) {
    reply({ ok: false, error: `unknown tool: ${toolName}` });
    return;
  }

  // Permission gate — the chat panel applies the user's permission
  // mode and, when needed, shows an inline Allow/Deny card.
  let allowed = false;
  try { allowed = await aiAssistantManager.confirmToolCall(def, args); }
  catch { allowed = false; }
  if (!allowed) {
    reply({ ok: false, error: 'The user denied this action.' });
    return;
  }

  const ns = window.AuroraAPI?.[def.api?.[0]];
  const fn = ns?.[def.api?.[1]];
  if (typeof fn !== 'function') {
    reply({ ok: false, error: `AuroraAPI.${(def.api || []).join('.')} is unavailable` });
    return;
  }

  try {
    const result = await fn(...buildCallArgs(def, args));
    reply(result === undefined ? { ok: true } : result);
  } catch (e) {
    reply({ ok: false, error: e?.message || String(e) });
  }
}

/**
 * Load the tool manifest and start listening for tool-exec requests.
 * Safe to call once at renderer boot; a second call re-subscribes.
 */
export async function initToolRunner() {
  if (!window.aiAPI) return;
  try {
    const res = await window.aiAPI.getToolManifest();
    manifest = new Map((res?.tools || []).map((t) => [t.name, t]));
  } catch (e) {
    console.warn('[tool-runner] manifest load failed:', e);
    manifest = new Map();
  }
  if (unsubscribe) unsubscribe();
  unsubscribe = window.aiAPI.onToolExec((payload) => handleToolExec(payload));
}
