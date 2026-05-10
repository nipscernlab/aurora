/**
 * testbench_instrumenter.js — Decide whether to inject
 * `$dumpfile` + `$dumpvars` into a Verilog-only testbench source, and
 * if so, build the instrumented text.
 *
 * Pure: takes the original .v contents + selection, returns the new
 * text (or null if no instrumentation needed). The compilation flow
 * handles the actual file reads/writes.
 *
 * Intent:
 *   - User testbenches that already have $dumpfile or $dumpvars are
 *     left alone — the user knows what they want; don't second-guess.
 *   - Otherwise we inject one initial-block before the last
 *     `endmodule`. The argument list comes from `selectedSignals`:
 *       - non-empty → `$dumpvars(0, sig1, sig2, ...)` — exactly the
 *         signals the user picked in the Wave Configuration modal.
 *       - empty (default) → `$dumpvars(1, <tb>)` — signals at the
 *         testbench-module scope only.
 */

/**
 * @typedef {object} InstrumentResult
 * @property {boolean} needsWrite       Whether the original differs from `content`.
 *                                      If false, content === original.
 * @property {string} content           Instrumented (or original) Verilog.
 * @property {('user-defined'|'malformed'|'auto'|'auto-selection')} reason
 *                                      Diagnostic — caller can log it.
 */

/**
 * @param {object} input
 * @param {string} input.originalContent  Source .v as-is from disk.
 * @param {string} input.tbModule         Testbench module name.
 * @param {string[]} [input.selectedSignals]  Picker selection.
 * @returns {InstrumentResult}
 */
export function instrumentTestbenchSource({ originalContent, tbModule, selectedSignals = [] }) {
    if (/\$dumpfile/.test(originalContent) || /\$dumpvars/.test(originalContent)) {
        return { needsWrite: false, content: originalContent, reason: 'user-defined' };
    }

    const lastEndmodule = originalContent.lastIndexOf('endmodule');
    if (lastEndmodule === -1) {
        // Malformed testbench — bail and let iverilog produce its own
        // syntax error rather than us silently corrupting the file.
        return { needsWrite: false, content: originalContent, reason: 'malformed' };
    }

    const dumpvarsArgs = selectedSignals.length > 0
        ? `0, ${selectedSignals.join(', ')}`
        : `1, ${tbModule}`;
    const note = selectedSignals.length > 0
        ? `Signal list comes from the Wave Configuration picker (${selectedSignals.length} signals).`
        : 'Default: signals at the testbench module scope; configure via the Wave Configuration modal.';

    const injection = `
// --- AURORA AUTO-INSTRUMENTATION ---
// $dumpfile / $dumpvars added because the testbench did not declare
// any. ${note}
initial begin
    $dumpfile("${tbModule}.vcd");
    $dumpvars(${dumpvarsArgs});
end
// --------------------------------------------------
`;

    const content = originalContent.slice(0, lastEndmodule)
        + injection
        + originalContent.slice(lastEndmodule);

    return {
        needsWrite: true,
        content,
        reason: selectedSignals.length > 0 ? 'auto-selection' : 'auto',
    };
}
