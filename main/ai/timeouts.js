// @ts-check
/**
 * timeouts.js — THE single source of truth for every AI-subsystem timeout
 * (ESTUDO §18.5 item 5).
 *
 * These constants used to live scattered across six files, kept coherent
 * only by "keep in sync with…" comments — and their HIERARCHY is load-bearing:
 * a client must always out-wait the layer it delegates to, otherwise the
 * outer layer "hangs up" first and reports a false failure while the inner
 * layer actually finishes (the historical "rename_project failed but the
 * rename landed" bug). Import from here; never inline a literal.
 *
 * The hierarchy (each line must out-wait the ones it wraps):
 *
 *   MCP_TOOL_CALL_MS (10 min)         — the CLIs' MCP-client ceiling per tools/call
 *     ≥ TOOL_INTERACTIVE_MS (10 min)  — tool_bridge leash for human-blocking tools
 *     >  TOOL_SLOW_MS (5 min)         — tool_bridge leash for rename_* style tools
 *     >  TOOL_DEFAULT_MS (2 min)      — tool_bridge backstop for ordinary tools
 *
 *   CLI_INACTIVITY_MS / STREAM_IDLE_MS (2 min) — pure-silence liveness reapers;
 *     they PAUSE while a tool is pending, so they never race the tool leashes.
 *
 *   Renderer watchdogs (js/ai/ai_metadata.js — renderer bundle, can't import
 *   this CJS module): STREAM_STALL_MS (3 min) > CLI_INACTIVITY_MS so main
 *   always reaps first and the UI self-heal is the last resort;
 *   STREAM_STALL_HARD_MS (12 min) > MCP_TOOL_CALL_MS so a stuck chip can
 *   never suppress the rescue past the longest legitimate tool.
 *
 * NB: values are milliseconds unless the name says otherwise.
 */

'use strict';

/** Vercel-AI-SDK path: end the turn if the model stream goes silent this long
 *  with no tool round-trip in flight (chat.js). */
const STREAM_IDLE_MS = 120_000;

/** CLI bridges (Claude Code / Codex, both engines): kill/abort a turn after
 *  this much pure silence with NO tool pending — a liveness signal, never a
 *  deadline (there is deliberately no absolute per-turn limit). */
const CLI_INACTIVITY_MS = 120_000;

/** tool_bridge backstop for ordinary tools (renderer alive but wedged). */
const TOOL_DEFAULT_MS = 120_000;

/** tool_bridge leash for filesystem-heavy tools (rename_project/_processor). */
const TOOL_SLOW_MS = 5 * 60_000;

/** tool_bridge leash for tools that block on a HUMAN (ask_user_question). */
const TOOL_INTERACTIVE_MS = 10 * 60_000;

/** MCP client ceiling the CLIs get for one tools/call — must out-wait every
 *  tool_bridge leash above so the bridge, not the CLI, is the authority.
 *  (Claude: MCP_TOOL_TIMEOUT env, ms. Codex: tool_timeout_sec config, s.) */
const MCP_TOOL_CALL_MS = 10 * 60_000;

/** MCP server startup handshake (Claude's MCP_TIMEOUT env). */
const MCP_STARTUP_MS = 30_000;

/** One-shot text generation via `claude -p` (harness generator) — the CLI
 *  only answers after the WHOLE generation, measured ~4 min for a harness. */
const ONESHOT_MS = 7 * 60_000;

// --- self-check: fail LOUDLY at load time if an edit breaks the hierarchy ---
if (MCP_TOOL_CALL_MS < TOOL_INTERACTIVE_MS) {
  throw new Error('timeouts.js: MCP_TOOL_CALL_MS must out-wait TOOL_INTERACTIVE_MS');
}
if (!(TOOL_INTERACTIVE_MS > TOOL_SLOW_MS && TOOL_SLOW_MS > TOOL_DEFAULT_MS)) {
  throw new Error('timeouts.js: tool leashes must be ordered interactive > slow > default');
}

module.exports = {
  STREAM_IDLE_MS,
  CLI_INACTIVITY_MS,
  TOOL_DEFAULT_MS,
  TOOL_SLOW_MS,
  TOOL_INTERACTIVE_MS,
  MCP_TOOL_CALL_MS,
  MCP_STARTUP_MS,
  ONESHOT_MS,
};
