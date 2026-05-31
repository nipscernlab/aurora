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
    // YANC v4.3: liga o bloco de sim-visibility do harness (variaveis/arrays,
    // PC->C± line table, opcode tap, I/O mirrors) sob Verilator. O guard do
    // <proc>.v gerado e `ifdef YANC_SIM_VIS`, ativado por __ICARUS__ (Icarus)
    // OU por este define. Cada decl mirrored e /* verilator public_flat */,
    // entao proc.valr10 resolve hierarquicamente e o $finish de fim-de-programa
    // funciona — e por isso o strip workaround foi removido. Verilator-only:
    // o fluxo Icarus NAO recebe (ja liga via __ICARUS__ predefinido).
    '+define+YANC_TRACE',
    '-CFLAGS', '-O3',
    '-CFLAGS', '-fstrict-aliasing',
    // Silencia o ruido de g++ vindo dos headers DPI do proprio Verilator
    // (vltstd/svdpi.h, verilated_dpi.cpp): eles declaram as funcoes svDpi*
    // com __declspec(dllimport) (forma MSVC), e o g++/MinGW do bundle as
    // compila estatico -> dezenas de "'dllimport' attribute ignored
    // [-Wattributes]". Benigno (link estatico funciona); nao ha codigo de
    // projeto pra corrigir, entao silenciamos no compilador C++.
    '-CFLAGS', '-Wno-attributes',
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
    // LC_ALL=C silencia o "perl: warning: Setting locale failed" do perl
    // MSYS2 (LANG/LC_* do Windows nao resolvem) — e os mesmos avisos de
    // make/bash/g++. Locale C nao afeta a compilacao.
    env: { LC_ALL: 'C' },
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

// =====================================================================
// Top-level harness pipeline (botao "Verilator (top-level)").
//
// Diferente do fluxo Wave (--binary --main): aqui rodamos o Verilator
// em 3 passos —
//   1. --json-only   dumpa V<top>.tree.json (portas do top-level)
//   2. --cc --exe --build  compila NOSSO testbench C++ (gerado em
//      verilator_tb.js) junto com as fontes → V<top>.exe nativo
//   3. roda o V<top>.exe, que faz o loop de clock + I/O por arquivo
// =====================================================================

const TL_WARNINGS = Object.freeze([
  '-Wno-fatal',
  '-Wno-TIMESCALEMOD',
  '-Wno-DECLFILENAME',
  '-Wno-STMTDLY',
  '-Wno-WIDTHTRUNC',
  '-Wno-WIDTHEXPAND',
]);

/**
 * @typedef {Object} VerilatorTbBuildBuilderCtx
 * @property {string}   perlExe
 * @property {string}   verilatorScript
 * @property {string}   mingwBin
 * @property {string}   usrBin
 * @property {string}   hdlPath
 * @property {string}   topModule
 * @property {string}   objDir
 * @property {string[]} sourceFiles
 * @property {string}   cwd
 * @property {string[]} [extraWarnings]
 */

/**
 * Passo 1 — dumpa o AST (portas do top-level) com --json-only. Nenhum
 * C++ e gerado; so V<top>.tree.json no objDir. parseVerilatorPorts
 * (verilator_tb.js) consome esse arquivo.
 *
 * @param {VerilatorTbBuildBuilderCtx} ctx
 */
export function buildVerilatorJsonSpec(ctx) {
  const warnings = ctx.extraWarnings || TL_WARNINGS;
  return {
    step: 'verilator-json',
    binary: ctx.perlExe,
    args: [
      ctx.verilatorScript,
      '--json-only',
      ...warnings,
      '--top-module', ctx.topModule,
      '-Mdir', ctx.objDir,
      '-y', ctx.hdlPath,
      ...ctx.sourceFiles,
    ],
    cwd: ctx.cwd,
    prependPath: [ctx.mingwBin, ctx.usrBin],
    env: { LC_ALL: 'C' }, // silencia warning de locale do perl MSYS2
    label: `verilator --json-only --top-module ${ctx.topModule}`,
  };
}

/**
 * Passo 2 — compila o harness C++ manual (incluido em sourceFiles)
 * junto com as fontes. SEM --main / --binary: o main e o nosso .cpp.
 * `--cc --exe --build` faz o Verilator gerar C++, escrever o Makefile e
 * invocar o make → V<top>.exe.
 *
 * @param {VerilatorTbBuildBuilderCtx} ctx
 */
export function buildVerilatorTbBuildSpec(ctx) {
  const warnings = ctx.extraWarnings || TL_WARNINGS;
  return {
    step: 'verilator-tb-build',
    binary: ctx.perlExe,
    args: [
      ctx.verilatorScript,
      '--cc',
      '--exe',
      '--build',
      '-j', '0',
      ...warnings,
      '--timing',
      '--x-assign', 'fast',
      '-CFLAGS', '-O2',
      // Mesma supressao do fluxo Wave: os headers DPI do Verilator usam
      // __declspec(dllimport) e o g++/MinGW (link estatico) ignora ->
      // ruido -Wattributes inofensivo. Ver buildVerilatorBuildSpec.
      '-CFLAGS', '-Wno-attributes',
      '--top-module', ctx.topModule,
      '-Mdir', ctx.objDir,
      '-y', ctx.hdlPath,
      ...ctx.sourceFiles,
    ],
    cwd: ctx.cwd,
    prependPath: [ctx.mingwBin, ctx.usrBin],
    env: { LC_ALL: 'C' }, // silencia warning de locale do perl/make MSYS2
    label: `verilator --cc --exe --build --top-module ${ctx.topModule}`,
  };
}

/**
 * @typedef {Object} VerilatorTbRunBuilderCtx
 * @property {string} exePath
 * @property {string} cwd       diretorio de I/O (.in/.out vivem aqui)
 * @property {string} mingwBin
 * @property {string} usrBin
 * @property {number} [cycles]  teto de seguranca (+cycles=N); a sim
 *                              normalmente termina antes, no EOF da 1a entrada
 */

/**
 * Passo 3 — roda o V<top>.exe no diretorio de I/O. cwd e o dir onde os
 * <pino>.in vivem e onde os <pino>.out serao escritos. A simulacao
 * termina quando a 1a entrada se esgota; +cycles=N e so o teto.
 *
 * @param {VerilatorTbRunBuilderCtx} ctx
 */
export function buildVerilatorTbRunSpec(ctx) {
  const args = [];
  if (Number.isFinite(ctx.cycles)) args.push(`+cycles=${ctx.cycles}`);
  return {
    step: 'verilator-tb-run',
    binary: ctx.exePath,
    args,
    cwd: ctx.cwd,
    prependPath: [ctx.mingwBin, ctx.usrBin],
    label: 'V<top>.exe (top-level harness run)',
  };
}
