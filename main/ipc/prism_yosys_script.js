// @ts-check
/**
 * prism_yosys_script.js: the Yosys script PRISM synthesises with.
 *
 * Split out of prism.js so the toolchain integration test can run the SAME
 * script the viewer runs, instead of a copy that would silently drift from
 * it. Pure string assembly: no I/O, no Electron.
 */

'use strict';

/**
 * Build the PRISM synthesis script.
 *
 * Every pass here is load-bearing:
 *
 * - `read_verilog -setattr src` records `src="file.v:line.col-line.col"` on
 *   each cell derived from the source. The @silimate/netlistsvg fork reads
 *   that attribute and emits an `onclick="gotosrc(...)"` per cell, which is
 *   what lets a double-click in the schematic open the right source line.
 * - `setundef -zero` replaces don't-care (x) values with constant 0. Without
 *   it, a `$pmux` with `full_case` yields `A=[x,x]` as an unreachable default
 *   branch, and netlistsvg draws those don't-cares as diagonal "ghost lines"
 *   (an invisible constant with fanout feeding several muxes). The default
 *   branch is unreachable, so substituting 0 does not change semantics.
 * - `opt_clean -purge` drops the wires and cells left dangling by that
 *   substitution.
 *
 * @param {string[]} fileList          absolute .v paths, forward slashes preferred
 * @param {string} topLevelModule      module name for `hierarchy -top`
 * @param {string} hierarchyJsonPath   where `write_json` should write
 * @returns {string} the .ys script contents
 */
function buildPrismYosysScript(fileList, topLevelModule, hierarchyJsonPath) {
  const readCommands = fileList
    .map((file) => `read_verilog -setattr src "${file}"`)
    .join('\n');

  return `
${readCommands}
hierarchy -top ${topLevelModule}
proc
setundef -zero
opt_clean -purge
write_json "${hierarchyJsonPath}"
`;
}

module.exports = { buildPrismYosysScript };
