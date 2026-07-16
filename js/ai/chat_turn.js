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
    const mapped = messages
        .filter((m) => m.role !== 'tool')
        .map((m) => (m.attachments && m.attachments.length
            ? { role: m.role, content: m.content, attachments: m.attachments.map((a) => ({ ...a })) }
            : { role: m.role, content: m.content }));
    // A single turn can now store several assistant segments (interleaved with
    // the display-only `tool` entries just filtered out) so a reloaded chat
    // reproduces the live layout. But the Anthropic API — and others — require
    // roles to ALTERNATE, so merge adjacent same-role messages back into one
    // before sending. Alternating histories are unaffected (no adjacency).
    const out = [];
    for (const m of mapped) {
        const prev = out[out.length - 1];
        if (prev && prev.role === m.role) {
            const sep = prev.content && m.content ? '\n\n' : '';
            prev.content = `${prev.content || ''}${sep}${m.content || ''}`;
            if (m.attachments) prev.attachments = [...(prev.attachments || []), ...m.attachments];
        } else {
            out.push({ ...m });
        }
    }
    return out;
}

// Total budget for the injected memory block. A memory is meant to be a short
// fact, but the model writes them, so the block is bounded rather than trusted:
// past this we stop and say how many were dropped (silently truncating would
// read as "that is all of them").
const MEMORY_BUDGET = 6000;

/**
 * Render the project-memory block, or '' when there is nothing remembered.
 *
 * Conditional on purpose. This context is rebuilt EVERY turn, so anything here
 * is paid for on every turn — and an empty "memories: none" line would be pure
 * waste on the common path. It also sits AFTER the static SYSTEM_PROMPT, which
 * is what keeps the big cacheable prefix stable while this part varies.
 *
 * @param {Array<{name:string, content:string}>} memories
 */
function buildMemoryBlock(memories) {
    if (!Array.isArray(memories) || memories.length === 0) return '';
    let out = `\nPROJECT MEMORY — facts you were told to remember about THIS project (<root>/.aurora/memory/).\n` +
              `They are already here; do NOT call list_memories just to read them. If one contradicts what you\n` +
              `see in the code, the code wins — the memory went stale, so fix it with remember() or drop it with forget().\n`;
    let used = 0;
    let shown = 0;
    for (const m of memories) {
        const entry = `\n[${m.name}]\n${String(m.content || '').trim()}\n`;
        if (used + entry.length > MEMORY_BUDGET) break;
        out += entry;
        used += entry.length;
        shown++;
    }
    const dropped = memories.length - shown;
    if (dropped > 0) out += `\n(+${dropped} more memory/memories not shown — over the context budget. Call list_memories to read them.)\n`;
    return out;
}

// The per-turn project context appended to SYSTEM_PROMPT. Injecting the active
// project paths every turn saves the model a get_current_project tool-call and
// stops it hallucinating paths from earlier projects; rebuilt each turn so
// switching projects mid-chat just works. (Text is model-facing — keep verbatim.)
export function buildProjectContext(projectPath, spfPath, memories) {
    return projectPath
        ? `\n\nACTIVE AURORA PROJECT — single source of truth, refreshed every turn:\n` +
          `  project_root: ${projectPath}\n` +
          (spfPath ? `  spf_file:     ${spfPath}\n` : '') +
          `Use these exact paths when calling tools (read_file, create_file, set_top_level, …).\n` +
          `Do not hallucinate a different root, do not assume cwd. If you need the full file list, call get_project_tree.\n` +
          buildMemoryBlock(memories)
        : '\n\nNO PROJECT IS CURRENTLY OPEN — ask the user to open one before running any project-scoped tool.\n';
}
