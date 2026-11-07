// tool_permission.ts: pure tool-permission logic for the AI assistant,
// extracted from ai_assistant_manager.js (A2 god-file decomposition).
//
// Pure: no DOM, no instance state. The class keeps confirmToolCall (the public
// gate called by tool_runner.js) and showInlineConfirm (the DOM card); it just
// asks decideToolPermission whether a call auto-approves or needs the card.
// The permission DATA (modes, store key) already lives in ai_metadata.js.

// Writes high-blast-radius enough to ALWAYS show the confirm card, even in
// `allow` mode. set_command_override rewrites a toolchain command line (wide,
// AI-driven surface) so it always gets an explicit human OK (V11).
/** O que a decisao le de uma ferramenta (main/ai/tools.js). */
export interface DefDaFerramenta { name: string; access?: string; description?: string }

/** Um campo de prosa tirado dos argumentos, para ler como texto. */
export interface ProsaDoArgumento { key: string; text: string }

const ALWAYS_CONFIRM = new Set(['set_command_override']);

// How much of the args JSON the card and the chip show by default.
const PREVIEW_CAP = 500;

// Pre-authorized tools, never routed through the blocking card.
// get_rename_status is the harmless poll the model runs after a rename.
//
// rename_project and rename_processor used to be here too, skipping the card
// even in "ask every time". They are writes that move the project folder, so
// they now follow the mode like any write. The card waits inside the tool
// call, whose leash for renames is TOOL_SLOW_MS (main/ai/timeouts.js), and
// the rename itself still runs in the background once allowed.
const PRE_AUTHORIZED = new Set(['get_rename_status']);

// Tools whose arguments the card shows whole, never cut at PREVIEW_CAP: the
// command typed into the user's real shell, and what goes out to the web. A
// cut command can hide its dangerous tail past the 500th character.
const SEM_CORTE = new Set(['run_in_terminal', 'WebFetch', 'WebSearch']);

/** Quantos caracteres do JSON dos argumentos o cartao mostra desta ferramenta. */
export function limiteDaPrevia(def: DefDaFerramenta | null | undefined): number {
    return def && SEM_CORTE.has(def.name) ? Infinity : PREVIEW_CAP;
}

// Decide a tool call's fate from the def + current permission mode. Returns
// 'allow' (auto-approve, resolve true) or 'confirm' (show the inline card).
// `allow` mode auto-approves everything; `writes` mode auto-approves reads.
// `foraDoProjeto` forces the card in every mode: import_file reading a file
// outside the open project (perguntas_inline.ts decides it).
export function decideToolPermission(
    def: DefDaFerramenta | null | undefined,
    mode: string,
    { foraDoProjeto = false }: { foraDoProjeto?: boolean } = {},
): 'allow' | 'confirm' {
    if (def && ALWAYS_CONFIRM.has(def.name)) return 'confirm';
    if (foraDoProjeto) return 'confirm';
    if (def && PRE_AUTHORIZED.has(def.name)) return 'allow';
    if (mode === 'allow') return 'allow';
    if (mode === 'writes' && def && def.access === 'read') return 'allow';
    return 'confirm';
}

// Args the model writes as PROSE for the human reading the card, not as data:
// `note` (run_in_background, set_command_override) and `question`
// (ask_user_question). They used to go through previewArgs like everything
// else, which buried the one human-readable field in the JSON block, quoted,
// backslash-escaped (C:\\Users\\…) and broken mid-word by the code wrapping.
// splitArgs pulls them out so the card can render them as text.
const PROSE_ARGS = new Set(['note', 'question']);

// A note is meant to be read, so the cap is loose (the JSON's is 500), but
// still bounded, since the text comes from the model.
const PROSE_CAP = 1000;

/**
 * Split tool args into the prose a human should READ and the structural rest
 * that belongs in the JSON block. Returns `{ prose: [{key, text}], rest }`.
 * Non-string or blank prose fields fall through to `rest`, a `note: 42` is
 * data, whatever the schema says.
 */
export function splitArgs(args: unknown): { prose: ProsaDoArgumento[]; rest: Record<string, unknown> } {
    const prose: ProsaDoArgumento[] = [];
    const rest: Record<string, unknown> = {};
    if (!args || typeof args !== 'object') return { prose, rest };
    for (const [key, value] of Object.entries(args)) {
        if (PROSE_ARGS.has(key) && typeof value === 'string' && value.trim()) {
            const text = value.trim();
            prose.push({ key, text: text.length > PROSE_CAP ? text.slice(0, PROSE_CAP) + '…' : text });
        } else {
            rest[key] = value;
        }
    }
    return { prose, rest };
}

// Pretty-print tool args for the confirm card / tool chip, capped at `limite`
// chars (500 unless limiteDaPrevia says the tool is shown whole).
// Feed it splitArgs().rest, the prose fields render separately.
export function previewArgs(args: Record<string, unknown> | null | undefined, limite: number = PREVIEW_CAP): string {
    if (!args || Object.keys(args).length === 0) return '';
    let json;
    try { json = JSON.stringify(args, null, 2); }
    catch { json = String(args); }
    return json.length > limite ? json.slice(0, limite) + '\n…' : json;
}

// Radio-option markup for the permission picker. `modes` is PERMISSION_MODES;
// `currentMode` is the selected id. Labels/hints are trusted constants.
export function permissionOptionsHtml(modes: ReadonlyArray<{ id: string; label: string; hint: string }>, currentMode: string): string {
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
