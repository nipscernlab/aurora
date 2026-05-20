/**
 * builders/cmm.js — CommandSpec builder for the CMM compiler step.
 *
 * Mirrors the call site in compilation_module.js cmmCompilation():
 *   "<cmmCompPath>" -<lang> -i <input> -n <name> -p <projectPath>
 *                   -m <macrosPath> -t <tempPath> [-P]
 *
 * yanc consumes -pt / -en first (parse_lang_flag strips it before
 * cli_parse). Everything else is named options (CMMComp/Sources/args.c).
 * -P toggles "show arrays" (cmmcomp slot d_array).
 */

/**
 * @typedef {Object} CmmBuilderCtx
 * @property {string}  cmmCompPath        absolute path to cmmcomp.exe
 * @property {string}  inputFile          .cmm filename (relative — yanc resolves against -p)
 * @property {string}  baseName           filename without .cmm
 * @property {string}  projectPath        per-processor project dir
 * @property {string}  macrosPath         components/Macros
 * @property {string}  tempPath           components/Temp/<processor>
 * @property {string}  processorName
 * @property {'pt'|'en'} lang
 * @property {boolean} showArrays
 */

/** @param {CmmBuilderCtx} ctx */
export function buildCmmSpec(ctx) {
  const args = [
    `-${ctx.lang}`,
    '-i', ctx.inputFile,
    '-n', ctx.baseName,
    '-p', ctx.projectPath,
    '-m', ctx.macrosPath,
    '-t', ctx.tempPath,
  ];
  if (ctx.showArrays) args.push('-P');

  return {
    step: 'cmm',
    binary: ctx.cmmCompPath,
    args,
    cwd: ctx.projectPath,
    processorName: ctx.processorName,
    label: `cmm: ${ctx.processorName}`,
  };
}
