/**
 * builders/wave_tools.ts — CommandSpec builders for fst2vcd (used to
 * extract a parseable text-VCD header out of the Verilator pass-1 FST)
 * and GTKWave launch.
 *
 * GTKWave is special: it's launched detached and monitored, not
 * exec'd-and-awaited. The renderer feeds the spec to the existing
 * `launch-gtkwave-only` IPC after rendering the args (the executor
 * doesn't support detached spawn). The override pipeline still runs
 * — only the actual spawn is different.
 *
 * Compilado por `tsc` (npm run build:ts) num wave_tools.js ao lado — é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */
export function buildFst2VcdSpec(ctx) {
    return {
        step: 'fst2vcd',
        binary: ctx.fst2vcdBin,
        args: ['-f', ctx.inputFile, '-o', ctx.outputFile],
        cwd: ctx.cwd,
        label: 'fst2vcd (Verilator pass-1 → text VCD)',
    };
}
export function buildGtkwaveSpec(ctx) {
    // gtkwave-nipscern fork: --dark + --zoom-fit + --left-justify; SST ja
    // vem removido da fork (sem necessidade de --rcvar hide_sst on).
    const args = ['--dark', '--zoom-fit', '--left-justify', ctx.vcdFile];
    if (ctx.gtkwSaveFile) {
        args.push('-a', ctx.gtkwSaveFile);
    }
    return {
        step: 'gtkwave',
        binary: ctx.gtkwaveBin,
        args,
        cwd: ctx.cwd,
        label: 'gtkwave --dark --zoom-fit --left-justify',
    };
}
