// tool_permission.js — pure tool-permission logic for the AI assistant,
// extracted from ai_assistant_manager.js (A2 god-file decomposition).
//
// Pure: no DOM, no instance state. The class keeps confirmToolCall (the public
// gate called by tool_runner.js) and showInlineConfirm (the DOM card); it just
// asks decideToolPermission whether a call auto-approves or needs the card.
// The permission DATA (modes, store key) already lives in ai_metadata.js.

// Writes high-blast-radius enough to ALWAYS show the confirm card, even in
// `allow` mode. set_command_override rewrites a toolchain command line (wide,
// AI-driven surface) so it always gets an explicit human OK (V11).
const ALWAYS_CONFIRM = new Set(['set_command_override']);

// Pre-authorized tools — never routed through the blocking card. Renames are
// explicit (the user asked) and reversible, and run DECOUPLED from the AI (the
// tool dispatches the move + reopen in the background and returns at once); a
// blocking card would just hang the MCP call until timeout. get_rename_status
// is the harmless poll the model runs after a rename.
const PRE_AUTHORIZED = new Set(['rename_project', 'rename_processor', 'get_rename_status']);

// Decide a tool call's fate from the def + current permission mode. Returns
// 'allow' (auto-approve, resolve true) or 'confirm' (show the inline card).
// `allow` mode auto-approves everything; `writes` mode auto-approves reads.
export function decideToolPermission(def, mode) {
    if (def && ALWAYS_CONFIRM.has(def.name)) return 'confirm';
    if (def && PRE_AUTHORIZED.has(def.name)) return 'allow';
    if (mode === 'allow') return 'allow';
    if (mode === 'writes' && def && def.access === 'read') return 'allow';
    return 'confirm';
}

// Pretty-print tool args for the confirm card / tool chip, capped at 500 chars.
export function previewArgs(args) {
    if (!args || Object.keys(args).length === 0) return '';
    let json;
    try { json = JSON.stringify(args, null, 2); }
    catch { json = String(args); }
    return json.length > 500 ? json.slice(0, 500) + '\n…' : json;
}

// Radio-option markup for the permission picker. `modes` is PERMISSION_MODES;
// `currentMode` is the selected id. Labels/hints are trusted constants.
export function permissionOptionsHtml(modes, currentMode) {
    return modes.map((m) => `
      <label class="ai-mp-opt ai-mp-opt-perm">
        <input type="radio" name="ai-perm" value="${m.id}"${m.id === currentMode ? ' checked' : ''}>
        <span class="ai-mp-opt-text">
          <span class="ai-mp-opt-label">${m.label}</span>
          <span class="ai-mp-opt-hint">${m.hint}</span>
        </span>
      </label>
    `).join('');
}
