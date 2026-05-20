/**
 * builders/vvp.js — CommandSpec builders for the two-pass vvp
 * simulation Aurora runs during the Wave flow.
 *
 *   vvp-header : "<vvpBin>" <vvpFile> +AURORA_HEADER_ONLY
 *                The auto-instrumented testbench $finishes immediately
 *                after $dumpvars, producing a header-only VCD that
 *                Aurora parses to populate the Wave Config picker.
 *   vvp-run    : "<vvpBin>" <vvpFile> -fst
 *                The actual long simulation, FST output.
 *
 * No shell needed: cwd handles the relative-path resolution for
 * $readmemb / $fopen that the old `cd && vvp` idiom relied on.
 */

/**
 * @typedef {Object} VvpBuilderCtx
 * @property {string} vvpBin
 * @property {string} vvpFile      absolute path to the .vvp
 * @property {string} cwd          components/Temp (relative-path base for $readmemb)
 */

/** @param {VvpBuilderCtx} ctx */
export function buildVvpHeaderSpec(ctx) {
  return {
    step: 'vvp-header',
    binary: ctx.vvpBin,
    args: [ctx.vvpFile, '+AURORA_HEADER_ONLY'],
    cwd: ctx.cwd,
    label: 'vvp pass-1 (header capture)',
  };
}

/** @param {VvpBuilderCtx} ctx */
export function buildVvpRunSpec(ctx) {
  return {
    step: 'vvp-run',
    binary: ctx.vvpBin,
    args: [ctx.vvpFile, '-fst'],
    cwd: ctx.cwd,
    label: 'vvp pass-2 (full FST)',
  };
}
