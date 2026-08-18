/**
 * builders/iverilog.ts, CommandSpec builders for the two iverilog
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
 *
 * Compilado por `tsc` (npm run build:ts) num iverilog.js ao lado, é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

import type { CommandSpec } from '../command_spec.js';

/**
 * iverilog.exe and the modules it dlopens are MinGW-linked and depend on the
 * runtime DLLs in mingw64/bin (where iverilog.exe itself lives). Returning
 * `{ prependPath: [mingw64/bin] }` keeps that dir on the child's PATH so those
 * loads resolve. Pure string op, no IO. Returns `{}` if the path is empty.
 */
function prependBinDir(binaryPath: string): { prependPath?: string[] } {
  const dir = String(binaryPath || '').replace(/[\\/][^\\/]*$/, '');
  return dir ? { prependPath: [dir] } : {};
}

export interface IverilogCheckBuilderCtx {
  iveriCompPath: string;
  hdlPath: string;
  /** module name passed to -s */
  simTopModule: string;
  /** absolute paths (no quoting) */
  sourceFiles: string[];
  cwd: string;
}

export function buildIverilogCheckSpec(ctx: IverilogCheckBuilderCtx): CommandSpec {
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
    // modules (and their runtime DLLs) load, same reason as vvp/system.vpi.
    ...prependBinDir(ctx.iveriCompPath),
    label: `iverilog -tnull -s ${ctx.simTopModule}`,
  };
}

export interface IverilogBuildBuilderCtx {
  iveriCompPath: string;
  hdlPath: string;
  simTopModule: string;
  /** absolute path to <simTop>.vvp */
  outputFile: string;
  sourceFiles: string[];
  cwd: string;
}

export function buildIverilogBuildSpec(ctx: IverilogBuildBuilderCtx): CommandSpec {
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
