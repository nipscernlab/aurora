// @ts-check
/**
 * native_tools.js — which of the CLI's BUILT-IN tools Aurora's assistant may use.
 *
 * Single source of truth for both Claude Code engines: claude_agent.js (Agent
 * SDK, `tools` option) and claude_code.js (legacy spawn, `--tools`). They used
 * to keep two hand-maintained copies — an array and a space-separated string —
 * and they drifted: the SDK path quietly re-enabled AskUserQuestion on a false
 * premise and the question card silently stopped rendering. One list, two
 * consumers, no drift.
 *
 * WHY AN ALLOWLIST AND NOT A BLOCKLIST
 * ------------------------------------
 * The old list named what to BLOCK (Bash, Edit, Write, …). That was written
 * when the CLI shipped a handful of tools, and it fails open by construction:
 * every tool the CLI adds later is enabled in Aurora automatically, silently,
 * on upgrade. It had already drifted badly — a probe against the live CLI found
 * these on, none of them gated by Aurora's Allow/Deny card:
 *
 *   Task, Workflow      — spawn subagents; burn the user's subscription with no
 *                         ceiling, and their inner steps are invisible to
 *                         Aurora's tool chips, so the panel shows a black box.
 *   Artifact            — PUBLISHES a local file as a page hosted on claude.ai.
 *                         Outward distribution, from an offline-first local IDE.
 *   Cron{Create,Delete,List}, ScheduleWakeup, RemoteTrigger
 *                       — schedule/launch work that runs with nobody watching.
 *   EnterWorktree, ExitWorktree
 *                       — create and switch git worktrees, moving the user's
 *                         files under the IDE with no card. Aurora has its own
 *                         git surface.
 *   PushNotification    — sends to the user's phone.
 *   SendMessage         — only addresses Task/Workflow subagents.
 *   Monitor             — its job is watching background Bash, which is off.
 *   ReportFindings      — renders into a host UI Aurora does not implement, so
 *                         a review reported through it would vanish on the way.
 *   DesignSync          — undocumented in the SDK; nothing to do with SAPHO.
 *
 * Inverting it makes the failure mode "a new tool is unavailable until someone
 * adds it here", which is a bug report — not "a new tool is live in everyone's
 * IDE", which is a surprise.
 *
 * MCP is unaffected: `tools` covers built-ins only, so every mcp__aurora__*
 * tool stays available and keeps going through the renderer's permission card.
 */

'use strict';

/**
 * The built-ins the assistant gets. Each one is here for a stated reason;
 * anything not listed does not exist for the model.
 */
const NATIVE_TOOLS = [
  // Required, not optional: the image-attachment flow writes a temp file in
  // main and the model reads it back (see claude_code.js's tool notes).
  'Read',
  // Read-only search, and scoped — the CLI can only reach cwd plus
  // additionalDirectories (the project, the attachment dir, the scratch cwd).
  'Glob',
  'Grep',
  // Read-only research. A hardware project lives on datasheets and standards
  // (IEEE/IEC), and offline-first means the IDE must not REQUIRE the network —
  // not that the assistant may never read it.
  'WebFetch',
  'WebSearch',
  // Private scratchpad for the model's own plan. No side effects outside it.
  'TodoWrite',
  // Infrastructure: how the model discovers the mcp__aurora__* surface when it
  // is deferred. Dropping this can leave Aurora's own tools unreachable.
  'ToolSearch',
];

/**
 * Hard deny for the destructive built-ins. Redundant with the allowlist above
 * (a tool absent from `tools` does not exist) and kept anyway for two reasons:
 * `disallowedTools` outranks every permission mode, and it also blocks
 * harness-internal invocation, not just model `tool_use` blocks. Cheap, and it
 * fails safe if `tools` semantics ever shift under us.
 *
 * AskUserQuestion is on the list because it cannot reach a human here: under
 * bypassPermissions the CLI self-resolves it with no card. Asking goes through
 * mcp__aurora__ask_user_question. See claude_agent.js's header.
 */
const DISALLOWED_TOOLS = [
  'Bash', 'BashOutput', 'KillShell', 'KillBash',
  'Edit', 'Write', 'MultiEdit', 'NotebookEdit',
  'AskUserQuestion',
];

module.exports = { NATIVE_TOOLS, DISALLOWED_TOOLS };
