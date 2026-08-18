/**
 * builders/vvp.ts, CommandSpec builder for the vvp simulation Aurora
 * runs during the Wave flow.
 *
 *   vvp-run : "<vvpBin>" <vvpFile> -fst
 *             A single full simulation, FST output. The VCD header is no
 *             longer captured by a separate header-only pass, it is pulled
 *             straight from the finished FST (_extractFstHeaderVcd), so one
 *             run produces everything the Wave Config picker + auto-gtkw need.
 *
 * No shell needed: cwd handles the relative-path resolution for
 * $readmemb / $fopen that the old `cd && vvp` idiom relied on.
 *
 * Compilado por `tsc` (npm run build:ts) num vvp.js ao lado, é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

import type { CommandSpec } from '../command_spec.js';

export interface VvpBuilderCtx {
  vvpBin: string;
  /** absolute path to the .vvp */
  vvpFile: string;
  /** components/Temp (relative-path base for $readmemb) */
  cwd: string;
}

export function buildVvpRunSpec(ctx: VvpBuilderCtx): CommandSpec {
  // vvp loads system.vpi (the $display/$finish/$readmem module) and friends
  // with LOAD_WITH_ALTERED_SEARCH_PATH, so Windows resolves each .vpi's
  // dependent MinGW runtime DLLs (libstdc++-6, libgcc_s_seh-1,
  // libwinpthread-1) relative to the .vpi's own dir (lib/ivl), NOT relative
  // to vvp.exe. Those DLLs live in mingw64/bin, so without it on PATH the load
  // fails with "error: Failed to open …\\lib\\ivl\\system.vpi because:".
  // vvp.exe itself sits in mingw64/bin, so its own directory is exactly the
  // dir to prepend (executor.buildChildEnv folds prependPath onto PATH).
  const binDir = String(ctx.vvpBin || '').replace(/[\\/][^\\/]*$/, '');
  return {
    step: 'vvp-run',
    binary: ctx.vvpBin,
    args: [ctx.vvpFile, '-fst'],
    cwd: ctx.cwd,
    ...(binDir ? { prependPath: [binDir] } : {}),
    label: 'vvp (full FST)',
  };
}
