// chat_turn.js — pure request-shaping for an AI chat turn, extracted from
// ai_assistant_manager.js (A2 god-file decomposition).
//
// No DOM, no IPC, no instance state. The class keeps _dispatchTurn (session id,
// the startChat IPC, the stream wiring + the post-send memory-hygiene strip);
// these just shape the payload it sends, so they're unit-testable.

// Build the messages array sent to the model: drop display-only `tool` entries,
// and CLONE each attachment so the post-send memory-hygiene strip (which deletes
// `dataUrl` from the STORED history) can't also wipe the payload out of what we
// are sending this turn.
export function buildApiMessages(messages) {
    return messages
        .filter((m) => m.role !== 'tool')
        .map((m) => (m.attachments && m.attachments.length
            ? { role: m.role, content: m.content, attachments: m.attachments.map((a) => ({ ...a })) }
            : { role: m.role, content: m.content }));
}

// The per-turn project context appended to SYSTEM_PROMPT. Injecting the active
// project paths every turn saves the model a get_current_project tool-call and
// stops it hallucinating paths from earlier projects; rebuilt each turn so
// switching projects mid-chat just works. (Text is model-facing — keep verbatim.)
export function buildProjectContext(projectPath, spfPath) {
    return projectPath
        ? `\n\nACTIVE AURORA PROJECT — single source of truth, refreshed every turn:\n` +
          `  project_root: ${projectPath}\n` +
          (spfPath ? `  spf_file:     ${spfPath}\n` : '') +
          `Use these exact paths when calling tools (read_file, create_file, set_top_level, …).\n` +
          `Do not hallucinate a different root, do not assume cwd. If you need the full file list, call get_project_tree.\n`
        : '\n\nNO PROJECT IS CURRENTLY OPEN — ask the user to open one before running any project-scoped tool.\n';
}
