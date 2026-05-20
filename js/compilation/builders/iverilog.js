/**
 * builders/iverilog.js — CommandSpec builders for the two iverilog
 * invocations Aurora uses:
 *
 *   iverilog-check : -tnull (syntax + elab, no .vvp emitted)
 *                    used by the Verilog button + Wave-Config gate
 *   iverilog-build : -o <vvp> (full build, .vvp produced)
 *                    used by the Wave button before vvp runs
 *
 * Library resolution: components/HDL is always -y included so SAPHO
 * library modules (processor.v, ula.v, myFIFO.v, etc.) resolve
 * without the user listing them. See ARCHITECTURE.md.
 */

/**
 * @typedef {Object} IverilogCheckBuilderCtx
 * @property {string}   iveriCompPath
 * @property {string}   hdlPath
 * @property {string}   simTopModule        module name passed to -s
 * @property {string[]} sourceFiles         absolute paths (no quoting)
 * @property {string}   cwd
 */

/** @param {IverilogCheckBuilderCtx} ctx */
export function buildIverilogCheckSpec(ctx) {
  const args = [
    '-y', ctx.hdlPath,
    '-tnull',
    '-s', ctx.simTopModule,
    ...ctx.sourceFiles,
  ];
  return {
    step: 'iverilog-check',
    binary: ctx.iveriCompPath,
    args,
    cwd: ctx.cwd,
    label: `iverilog -tnull -s ${ctx.simTopModule}`,
  };
}

/**
 * @typedef {Object} IverilogBuildBuilderCtx
 * @property {string}   iveriCompPath
 * @property {string}   hdlPath
 * @property {string}   simTopModule
 * @property {string}   outputFile          absolute path to <simTop>.vvp
 * @property {string[]} sourceFiles
 * @property {string}   cwd
 */

/** @param {IverilogBuildBuilderCtx} ctx */
export function buildIverilogBuildSpec(ctx) {
  const args = [
    '-y', ctx.hdlPath,
    '-s', ctx.simTopModule,
    '-o', ctx.outputFile,
    ...ctx.sourceFiles,
  ];
  return {
    step: 'iverilog-build',
    binary: ctx.iveriCompPath,
    args,
    cwd: ctx.cwd,
    label: `iverilog -o ${ctx.outputFile.split(/[\\/]/).pop()} -s ${ctx.simTopModule}`,
  };
}
