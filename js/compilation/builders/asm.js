/**
 * builders/asm.js — CommandSpec builders for the two ASM steps:
 * appcomp (macro preprocessor) and asmcomp (final compiler).
 *
 * Mirror the call sites in compilation_module.js asmCompilation().
 * Lang flag (-pt/-en) goes first; the rest are named options
 * (APP/Sources/args.c and ASM/Sources/args.c).
 */

/**
 * @typedef {Object} AsmPreBuilderCtx
 * @property {string}  appCompPath        absolute path to appcomp.exe
 * @property {string}  asmFile            input .asm path
 * @property {string}  tempPath           components/Temp/<processor>
 * @property {string}  processorName
 * @property {'pt'|'en'} lang
 */

/** @param {AsmPreBuilderCtx} ctx */
export function buildAsmPreSpec(ctx) {
  const args = [
    `-${ctx.lang}`,
    '-i', ctx.asmFile,
    '-t', ctx.tempPath,
  ];
  return {
    step: 'asm-pre',
    binary: ctx.appCompPath,
    args,
    cwd: ctx.tempPath,
    processorName: ctx.processorName,
    label: `asm-pre: ${ctx.processorName}`,
  };
}

/**
 * @typedef {Object} AsmBuilderCtx
 * @property {string}  asmCompPath
 * @property {string}  asmFile
 * @property {string}  projectPath        per-processor project dir
 * @property {string}  hdlPath            components/HDL
 * @property {string}  macrosPath         components/Macros
 * @property {string}  tempPath
 * @property {number}  freq               -f (positive int)
 * @property {number}  clocks             -c (positive int)
 * @property {string}  processorName
 * @property {'pt'|'en'} lang
 */

/** @param {AsmBuilderCtx} ctx */
export function buildAsmSpec(ctx) {
  const args = [
    `-${ctx.lang}`,
    '-i', ctx.asmFile,
    '-p', ctx.projectPath,
    '-d', ctx.hdlPath,
    '-m', ctx.macrosPath,
    '-t', ctx.tempPath,
    '-f', String(ctx.freq),
    '-c', String(ctx.clocks),
  ];

  return {
    step: 'asm',
    binary: ctx.asmCompPath,
    args,
    cwd: ctx.tempPath,
    processorName: ctx.processorName,
    label: `asm: ${ctx.processorName}`,
  };
}
