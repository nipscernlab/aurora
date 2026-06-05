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
 * iverilog.exe and the modules it dlopens are MinGW-linked and depend on the
 * runtime DLLs in mingw64/bin (where iverilog.exe itself lives). Returning
 * `{ prependPath: [mingw64/bin] }` keeps that dir on the child's PATH so those
 * loads resolve. Pure string op — no IO. Returns `{}` if the path is empty.
 * @param {string} binaryPath
 */
function prependBinDir(binaryPath) {
  const dir = String(binaryPath || '').replace(/[\\/][^\\/]*$/, '');
  return dir ? { prependPath: [dir] } : {};
}

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
    // mingw64/bin on PATH so iverilog's MinGW-linked target/preprocessor
    // modules (and their runtime DLLs) load — same reason as vvp/system.vpi.
    ...prependBinDir(ctx.iveriCompPath),
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
    // See buildIverilogCheckSpec: keep the MinGW bin dir on PATH for the
    // target/preprocessor modules iverilog dlopens during a real build.
    ...prependBinDir(ctx.iveriCompPath),
    label: `iverilog -o ${ctx.outputFile.split(/[\\/]/).pop()} -s ${ctx.simTopModule}`,
  };
}
