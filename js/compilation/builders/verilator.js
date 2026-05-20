/**
 * builders/verilator.js — CommandSpec builders for the Verilator
 * pipeline (build + 2-pass run).
 *
 * The verilator script is Perl; we always invoke it as
 *   perl.exe verilator <args>
 * with the bundle's mingw64/bin + usr/bin prepended onto PATH so
 * perl, g++, make, and the verilated.mk's bash/coreutils all
 * resolve. PATH manipulation rides through CommandSpec.prependPath
 * (the executor in main builds the child env from it) — no more
 * `cmd.exe && set "PATH=..."` shell trickery.
 *
 * The generated V<top>.exe is allowed by binary_allowlist's
 * Verilator-generated prefix rule (it lives under components/Temp/
 * obj_dir_* directories, which the allowlist accepts).
 */

/**
 * @typedef {Object} VerilatorBuildBuilderCtx
 * @property {string}   perlExe
 * @property {string}   verilatorScript
 * @property {string}   mingwBin
 * @property {string}   usrBin
 * @property {string}   hdlPath
 * @property {string}   simTopModule
 * @property {string}   objDir
 * @property {string[]} sourceFiles
 * @property {string}   cwd
 * @property {string[]} [extraWarnings]    e.g. ['-Wno-fatal', '-Wno-TIMESCALEMOD']
 */

/** @param {VerilatorBuildBuilderCtx} ctx */
export function buildVerilatorBuildSpec(ctx) {
  const warnings = ctx.extraWarnings || [
    '-Wno-fatal',
    '-Wno-TIMESCALEMOD',
    '-Wno-DECLFILENAME',
    '-Wno-STMTDLY',
  ];

  // -CFLAGS takes ONE token per occurrence — wrapping "-O3 -fstrict-
  // aliasing" in quotes is lost by cmd.exe and Verilator misreads
  // -fstrict-aliasing as its own flag. So we pass two -CFLAGS pairs.
  const args = [
    ctx.verilatorScript,
    '--binary',
    '--main',
    '--trace-fst',
    '-j', '0',
    ...warnings,
    '--timing',
    '--x-assign', 'fast',
    '--no-trace-top',
    '-CFLAGS', '-O3',
    '-CFLAGS', '-fstrict-aliasing',
    '--top-module', ctx.simTopModule,
    '-Mdir', ctx.objDir,
    '-y', ctx.hdlPath,
    ...ctx.sourceFiles,
  ];

  return {
    step: 'verilator-build',
    binary: ctx.perlExe,
    args,
    cwd: ctx.cwd,
    prependPath: [ctx.mingwBin, ctx.usrBin],
    label: `verilator build --top-module ${ctx.simTopModule}`,
  };
}

/**
 * @typedef {Object} VerilatorRunBuilderCtx
 * @property {string}   exePath
 * @property {string}   cwd               components/Temp
 * @property {string}   mingwBin
 * @property {string}   usrBin
 */

/** @param {VerilatorRunBuilderCtx} ctx */
export function buildVerilatorHeaderSpec(ctx) {
  return {
    step: 'verilator-header',
    binary: ctx.exePath,
    args: ['+AURORA_HEADER_ONLY'],
    cwd: ctx.cwd,
    prependPath: [ctx.mingwBin, ctx.usrBin],
    label: 'V<top>.exe pass-1 (header capture)',
  };
}

/** @param {VerilatorRunBuilderCtx} ctx */
export function buildVerilatorRunSpec(ctx) {
  return {
    step: 'verilator-run',
    binary: ctx.exePath,
    args: [],
    cwd: ctx.cwd,
    prependPath: [ctx.mingwBin, ctx.usrBin],
    label: 'V<top>.exe pass-2 (full FST)',
  };
}
