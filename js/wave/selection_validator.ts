/**
 * selection_validator.ts: Filter a saved Wave Configuration selection
 * against the current parsed Verilog hierarchy.
 *
 * The picker stores selections as dotted-path strings in the
 * per-testbench WaveStore (`waveSignals: ["tb.dut.q_next", ...]`). When
 * the user later renames an instance, removes a signal, or edits the
 * testbench, the saved entries can dangle. Feeding dangling paths
 * verbatim to `$dumpvars(0, ...)` makes iverilog fail with a cryptic
 * elaboration error, the user just sees "exit code 2".
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
 *
 * Compilado por `tsc` (npm run build:ts) num selection_validator.js ao lado:
 * é esse .js que o runtime carrega; os imports usam a extensão `.js`.
 */

import type { HierarchyNode } from './signal_parser.js';

/** A saved selection split against the current hierarchy. */
export interface SelectionSplit {
    valid: string[];
    dropped: string[];
}

/**
 * Walk a hierarchy tree and collect every legal `{scopePath}.{signal}`.
 */
function collectValidPaths(node: HierarchyNode | null): Set<string> {
    const out = new Set<string>();
    const walk = (n: HierarchyNode): void => {
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
 * `hierarchyTree === null` = no hierarchy could be built (e.g. parse
 * failed, missing top module). In that case we conservatively keep the
 * selection as-is, better to let iverilog speak than to silently wipe
 * the user's choices.
 */
export function validateSelection(
    selectedSignals: string[],
    hierarchyTree: HierarchyNode | null,
): SelectionSplit {
    if (!Array.isArray(selectedSignals) || selectedSignals.length === 0) {
        return { valid: [], dropped: [] };
    }
    if (!hierarchyTree) {
        return { valid: [...selectedSignals], dropped: [] };
    }
    const validPaths = collectValidPaths(hierarchyTree);
    const valid: string[] = [];
    const dropped: string[] = [];
    for (const sig of selectedSignals) {
        if (validPaths.has(sig)) valid.push(sig);
        else dropped.push(sig);
    }
    return { valid, dropped };
}
