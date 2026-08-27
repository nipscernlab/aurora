// chat_turn.js: pure request-shaping for an AI chat turn, extracted from
// ai_assistant_manager.js (A2 god-file decomposition).
//
// No DOM, no IPC, no instance state. The class keeps _dispatchTurn (session id,
// the startChat IPC, the stream wiring + the post-send memory-hygiene strip);
// these just shape the payload it sends, so they're unit-testable.

// Roles that exist ONLY to render in the panel. They carry no `content`, so
// letting one through would send the model `{role, content: undefined}`:
//   tool    , the collapsed "N actions" chips.
//   question, the record of an ask_user_question exchange. The model already
//              got the answer as that tool's return value; resending it here
//              would just repeat it back, in a role the API does not accept.
const DISPLAY_ONLY_ROLES = new Set(['tool', 'question']);

// Build the messages array sent to the model: drop display-only entries, and
// CLONE each attachment so the post-send memory-hygiene strip (which deletes
// `dataUrl` from the STORED history) can't also wipe the payload out of what we
// are sending this turn.
export function buildApiMessages(messages) {
    const mapped = messages
        .filter((m) => !DISPLAY_ONLY_ROLES.has(m.role))
        .map((m) => (m.attachments && m.attachments.length
            ? { role: m.role, content: m.content, attachments: m.attachments.map((a) => ({ ...a })) }
            : { role: m.role, content: m.content }));
    // A single turn can now store several assistant segments (interleaved with
    // the display-only `tool` entries just filtered out) so a reloaded chat
    // reproduces the live layout. But the Anthropic API, and others, require
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
 * is paid for on every turn, and an empty "memories: none" line would be pure
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

/**
 * Render the missing-components block, or '' when everything is installed.
 *
 * The gate that actually blocks a missing component lives in the main process
 * (main/compile/binary_allowlist.js), and it holds regardless of what the model
 * believes. This block exists so the model does not waste a turn proposing a
 * tool that is guaranteed to fail: without it, the first sign of a missing
 * component is a failed tool call, and a failed call invites a retry before a
 * report.
 *
 * Only the missing ones are listed. Naming the installed ones every turn would
 * cost tokens on the common path to say nothing.
 *
 * @param {Array<{nome:string, resumo:string, instalado:boolean}>} componentes
 */
function buildComponentsBlock(componentes) {
    if (!Array.isArray(componentes)) return '';
    const missing = componentes.filter((c) => c && !c.instalado);
    if (missing.length === 0) return '';
    return `\nCOMPONENTS NOT INSTALLED ON THIS MACHINE — tools that need them WILL fail:\n` +
        missing.map((c) => `  ${c.nome} — ${c.resumo}`).join('\n') +
        `\nDo not call tools that depend on these. If the user asks for one, say the component is\n` +
        `not installed and that it can be downloaded in Settings, Components. Do not retry.\n`;
}

// The per-turn project context appended to SYSTEM_PROMPT. Injecting the active
// project paths every turn saves the model a get_current_project tool-call and
// stops it hallucinating paths from earlier projects; rebuilt each turn so
// switching projects mid-chat just works. (Text is model-facing, keep verbatim.)
export function buildProjectContext(projectPath, spfPath, memories, componentes) {
    return (projectPath
        ? `\n\nACTIVE AURORA PROJECT — single source of truth, refreshed every turn:\n` +
          `  project_root: ${projectPath}\n` +
          (spfPath ? `  spf_file:     ${spfPath}\n` : '') +
          `Use these exact paths when calling tools (read_file, create_file, set_top_level, …).\n` +
          `Do not hallucinate a different root, do not assume cwd. If you need the full file list, call get_project_tree.\n` +
          buildMemoryBlock(memories)
        : '\n\nNO PROJECT IS CURRENTLY OPEN — ask the user to open one before running any project-scoped tool.\n')
        // Fora do bloco do projeto: um componente ausente atrapalha igual, com
        // projeto aberto ou fechado.
        + buildComponentsBlock(componentes);
}
