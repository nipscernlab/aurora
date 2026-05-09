/**
 * selection_validator.js — Filter a saved Wave Configuration selection
 * against the current parsed Verilog hierarchy.
 *
 * The picker stores selections as dotted-path strings in
 * projectOriented.json (`waveSignals: ["tb.dut.q_next", ...]`). When
 * the user later renames an instance, removes a signal, or edits the
 * testbench, the saved entries can dangle. Feeding dangling paths
 * verbatim to `$dumpvars(0, ...)` makes iverilog fail with a cryptic
 * elaboration error — the user just sees "exit code 2".
 *
 * This validator runs before the instrumenter / .gtkw writer and
 * splits the selection into:
 *   - valid:    paths still present in the hierarchy
 *   - dropped:  paths that no longer resolve, so the caller can warn
 *               the user (and hopefully prompt them to re-open the
 *               picker to clean up).
 *
 * Pure: takes the parsed tree (from signal_parser.buildHierarchyTree),
 * returns plain arrays. No IO, trivial to unit-test.
 */

/**
 * @typedef {object} HierarchyNode
 * @property {string} name
 * @property {string} scopePath
 * @property {Array<{ name: string }>} signals
 * @property {HierarchyNode[]} children
 */

/**
 * Walk a hierarchy tree and collect every legal `{scopePath}.{signal}`.
 *
 * @param {HierarchyNode} node
 * @returns {Set<string>}
 */
function collectValidPaths(node) {
    const out = new Set();
    const walk = (n) => {
        for (const sig of n.signals) {
            out.add(`${n.scopePath}.${sig.name}`);
        }
        for (const child of n.children) walk(child);
    };
    if (node) walk(node);
    return out;
}

/**
 * Split a saved selection into still-valid and dropped subsets,
 * relative to the current hierarchy.
 *
 * @param {string[]} selectedSignals  Full dotted paths from waveSignals.
 * @param {HierarchyNode|null} hierarchyTree  Output of buildHierarchyTree.
 *      `null` = no hierarchy could be built (e.g. parse failed,
 *      missing top module). In that case we conservatively keep the
 *      selection as-is — better to let iverilog speak than to silently
 *      wipe the user's choices.
 * @returns {{ valid: string[], dropped: string[] }}
 */
export function validateSelection(selectedSignals, hierarchyTree) {
    if (!Array.isArray(selectedSignals) || selectedSignals.length === 0) {
        return { valid: [], dropped: [] };
    }
    if (!hierarchyTree) {
        return { valid: [...selectedSignals], dropped: [] };
    }
    const validPaths = collectValidPaths(hierarchyTree);
    const valid = [];
    const dropped = [];
    for (const sig of selectedSignals) {
        if (validPaths.has(sig)) valid.push(sig);
        else dropped.push(sig);
    }
    return { valid, dropped };
}
