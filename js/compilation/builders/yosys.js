/**
 * builders/yosys.js — CommandSpec builders for the two Yosys uses:
 * `yosys-hierarchy` (write_json for the renderer's hierarchy panel)
 * and `prism-yosys` (synthesis for the PRISM schematic).
 *
 * Both wrap `yosys.exe -s <script>`; the difference is which script
 * file the caller emits to disk first. The builder is unaware of the
 * script's contents — only of the path.
 */

/**
 * @typedef {Object} YosysHierarchyCtx
 * @property {string} yosysPath
 * @property {string} scriptPath
 * @property {string} cwd
 */

/** @param {YosysHierarchyCtx} ctx */
export function buildYosysHierarchySpec(ctx) {
  return {
    step: 'yosys-hierarchy',
    binary: ctx.yosysPath,
    args: ['-s', ctx.scriptPath],
    cwd: ctx.cwd,
    label: 'yosys -s (hierarchy)',
  };
}

/**
 * @typedef {Object} PrismYosysCtx
 * @property {string} yosysPath
 * @property {string} scriptPath
 * @property {string} cwd
 */

/** @param {PrismYosysCtx} ctx */
export function buildPrismYosysSpec(ctx) {
  return {
    step: 'prism-yosys',
    binary: ctx.yosysPath,
    args: ['-s', ctx.scriptPath],
    cwd: ctx.cwd,
    label: 'yosys -s (PRISM synth)',
  };
}
