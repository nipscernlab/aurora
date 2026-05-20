/**
 * builders/wave_tools.js — CommandSpec builders for fst2vcd (used to
 * extract a parseable text-VCD header out of the Verilator pass-1 FST)
 * and GTKWave launch.
 *
 * GTKWave is special: it's launched detached and monitored, not
 * exec'd-and-awaited. The renderer feeds the spec to the existing
 * `launch-gtkwave-only` IPC after rendering the args (the executor
 * doesn't support detached spawn). The override pipeline still runs
 * — only the actual spawn is different.
 */

/**
 * @typedef {Object} Fst2VcdBuilderCtx
 * @property {string} fst2vcdBin
 * @property {string} inputFile        FST (or FST-in-.vcd) to convert
 * @property {string} outputFile       text VCD destination
 * @property {string} cwd
 */

/** @param {Fst2VcdBuilderCtx} ctx */
export function buildFst2VcdSpec(ctx) {
  return {
    step: 'fst2vcd',
    binary: ctx.fst2vcdBin,
    args: ['-f', ctx.inputFile, '-o', ctx.outputFile],
    cwd: ctx.cwd,
    label: 'fst2vcd (Verilator pass-1 → text VCD)',
  };
}

/**
 * @typedef {Object} GtkwaveBuilderCtx
 * @property {string} gtkwaveBin
 * @property {string} vcdFile
 * @property {string} [gtkwSaveFile]      .gtkw companion file (-a)
 * @property {string} fixScript           gtk_almost_proj.tcl
 * @property {string} cwd
 */

/** @param {GtkwaveBuilderCtx} ctx */
export function buildGtkwaveSpec(ctx) {
  const args = ['--dark', ctx.vcdFile];
  if (ctx.gtkwSaveFile) {
    args.push('--rcvar', 'hide_sst on', '-a', ctx.gtkwSaveFile);
  }
  // GTKWave accepts `--script=PATH` as a single token (no space). Keep it
  // one token — the args array is passed straight to spawn(shell:false),
  // so it must already be split exactly as GTKWave expects.
  args.push(`--script=${ctx.fixScript}`);

  return {
    step: 'gtkwave',
    binary: ctx.gtkwaveBin,
    args,
    cwd: ctx.cwd,
    label: 'gtkwave --dark',
  };
}
