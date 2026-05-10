/**
 * gtkw_writer.js — Build a minimal GTKWave save-file (.gtkw) text from
 * a list of VCD scopes + an optional user selection.
 *
 * Pure: takes inputs, returns a string. The compilation flow handles
 * the actual disk write — keeping this module IO-free makes testing
 * trivial (feed scopes, assert text).
 *
 * Format kept intentionally minimal — `[dumpfile]` pointer + `@28`
 * (hex) header + one dotted-name per line. GTKWave fills in zoom /
 * position / etc. from defaults; the user can right-click inside
 * GTKWave to override any single trace's format. Anything fancier
 * means the user should curate their own .gtkw and import it via
 * Project Settings.
 */

/**
 * @typedef {{ name: string, path: string, signals: Array<{name, range, width, type}> }} VcdScope
 */

/**
 * Decide which scope.signal entries land in the save-file. Two modes:
 *   - selection non-empty: emit exactly those that exist in the VCD.
 *     Selections that point at signals NOT in the VCD (renamed
 *     hierarchy, removed signal, stale projectOriented.json) are
 *     reported back to the caller as `dropped` so the user gets a
 *     warning instead of a silent empty trace.
 *   - selection empty: emit EVERY signal in the VCD, across all
 *     scope depths. The VCD itself reflects whatever the running
 *     `$dumpvars` chose to dump — hand-written `$dumpvars(0, ...)`
 *     pulls submodules in, and Aurora's own instrumenter only dumps
 *     the testbench scope. Either way, mirroring the VCD wholesale
 *     is the safe default: anything in the VCD is something the
 *     user wants visible. `tbModule` is kept in the signature for
 *     backward compat but no longer affects the filter.
 *
 * The VCD is the ground truth — anything we emit must be present in
 * `scopes`, regardless of which upstream path (Wave Config picker,
 * default, etc.) populated `selectedSignals`.
 *
 * @param {VcdScope[]} scopes
 * @param {string} _tbModule  unused in default mode (signature kept stable)
 * @param {string[]} selectedSignals
 * @returns {{ emit: Array<{ fullName: string, range: string|null }>, dropped: string[] }}
 */
export function pickSignalsToEmit(scopes, _tbModule, selectedSignals) {
    const flatten = [];
    const inVcd = new Set();
    for (const scope of scopes) {
        for (const sig of scope.signals) {
            const fullName = `${scope.path}.${sig.name}`;
            flatten.push({ fullName, range: sig.range });
            inVcd.add(fullName);
        }
    }

    if (selectedSignals.length > 0) {
        const picks = new Set(selectedSignals);
        return {
            emit: flatten.filter((s) => picks.has(s.fullName)),
            dropped: selectedSignals.filter((s) => !inVcd.has(s)),
        };
    }

    // No selection → mirror the entire VCD. Submodule signals
    // included; the user can right-click in GTKWave to delete what
    // they don't want.
    return { emit: flatten, dropped: [] };
}

/**
 * Extract dotted signal references from a .gtkw file. Used to detect
 * stale paths in a user-curated layout (signal renamed since the file
 * was saved).
 *
 * .gtkw is a line-oriented format with several decoration kinds:
 *   - `[*]` / `[dumpfile]` / `[savefile]` / `[timestart]` — headers
 *   - `@<hex>` — format codes (radix, color, etc.)
 *   - `-<name>` — group open marker
 *   - `[group_close]` / `[group_end]` — group close
 *   - `<dotted.path>[range]?` — actual signal reference
 *
 * The signal lines we care about are: starts with a letter or
 * underscore, contains at least one dot. Strip a trailing `[a:b]`
 * range to get the bare path. Everything else is decoration we
 * don't validate.
 *
 * @param {string} gtkwContent
 * @returns {string[]}  unique dotted paths referenced by the file
 */
export function extractSignalRefs(gtkwContent) {
    if (typeof gtkwContent !== 'string' || gtkwContent.length === 0) return [];
    const paths = new Set();
    for (const rawLine of gtkwContent.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        // Decoration / metadata: skip.
        if (line.startsWith('[') || line.startsWith('@') || line.startsWith('-')
            || line.startsWith('*') || line.startsWith('#')) continue;
        // Signal candidate: must start with [a-zA-Z_], contain at least one
        // `.`, and use a dotted-identifier shape. Strip a trailing range.
        const noRange = line.replace(/\[[^\]]*\]\s*$/, '').trim();
        if (!/^[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)+$/.test(noRange)) continue;
        paths.add(noRange);
    }
    return [...paths];
}

/**
 * Render the .gtkw file content.
 *
 * @param {object} input
 * @param {string} input.vcdPath        Absolute path to the .vcd, used
 *                                      verbatim in [dumpfile].
 * @param {string} input.gtkwPath       Absolute path the save-file
 *                                      will live at; written into
 *                                      [savefile] so GTKWave knows
 *                                      where it came from.
 * @param {VcdScope[]} input.scopes     Output of vcd_parser.
 * @param {string} input.tbModule       Testbench module name, used to
 *                                      pick the default top-scope set.
 * @param {string[]} [input.selectedSignals]  Picker selection.
 *                                            Empty = use default.
 * @returns {{ content: string|null, dropped: string[] }}
 *      content: save-file text, or null if there's nothing to display
 *      (empty scopes / no signals matched / no selection in VCD).
 *      dropped: full-names from `selectedSignals` that weren't found
 *      in the VCD; caller should surface them to the user.
 */
export function buildGtkwContent({ vcdPath, gtkwPath, scopes, tbModule, selectedSignals = [] }) {
    if (!Array.isArray(scopes) || scopes.length === 0) {
        return { content: null, dropped: [] };
    }

    const { emit, dropped } = pickSignalsToEmit(scopes, tbModule, selectedSignals);
    if (emit.length === 0) return { content: null, dropped };

    const slashed = (p) => p.replace(/\\/g, '/');
    const lines = [
        '[*]',
        '[*] Generated by Aurora',
        '[*]',
        `[dumpfile] "${slashed(vcdPath)}"`,
        `[savefile] "${slashed(gtkwPath)}"`,
        '[timestart] 0',
        '@28',
    ];
    for (const s of emit) {
        lines.push(s.range ? `${s.fullName}[${s.range}]` : s.fullName);
    }
    return { content: lines.join('\n') + '\n', dropped };
}
