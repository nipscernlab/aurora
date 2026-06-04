/**
 * builders/vvp.js — CommandSpec builder for the vvp simulation Aurora
 * runs during the Wave flow.
 *
 *   vvp-run : "<vvpBin>" <vvpFile> -fst
 *             A single full simulation, FST output. The VCD header is no
 *             longer captured by a separate header-only pass — it is pulled
 *             straight from the finished FST (_extractFstHeaderVcd), so one
 *             run produces everything the Wave Config picker + auto-gtkw need.
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
export function buildVvpRunSpec(ctx) {
  return {
    step: 'vvp-run',
    binary: ctx.vvpBin,
    args: [ctx.vvpFile, '-fst'],
    cwd: ctx.cwd,
    label: 'vvp (full FST)',
  };
}
