/**
 * builders/cmm.ts, CommandSpec builder for the CMM compiler step.
 *
 * Mirrors the call site in compilation_module.js cmmCompilation():
 *   "<cmmCompPath>" -<lang> -i <input> -n <name> -p <projectPath>
 *                   -m <macrosPath> -t <tempPath> [-A]
 *
 * yanc consumes -pt / -en first (parse_lang_flag strips it before
 * cli_parse). Everything else is named options (CMMComp/Sources/args.c).
 * -A / --array toggles "show arrays" (yanc v4; renamed from v3's -P).
 *
 * Compilado por `tsc` (npm run build:ts) num cmm.js ao lado, é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

import type { CommandSpec } from '../command_spec.js';

export interface CmmBuilderCtx {
  /** absolute path to cmmcomp.exe */
  cmmCompPath: string;
  /** .cmm filename (relative, yanc resolves against -p) */
  inputFile: string;
  /** filename without .cmm */
  baseName: string;
  /** per-processor project dir */
  projectPath: string;
  /** components/Macros */
  macrosPath: string;
  /** components/Temp/<processor> */
  tempPath: string;
  processorName: string;
  lang: 'pt' | 'en';
  showArrays: boolean;
}

export function buildCmmSpec(ctx: CmmBuilderCtx): CommandSpec {
  const args = [
    `-${ctx.lang}`,
    '-i', ctx.inputFile,
    '-n', ctx.baseName,
    '-p', ctx.projectPath,
    '-m', ctx.macrosPath,
    '-t', ctx.tempPath,
  ];
  if (ctx.showArrays) args.push('-A');

  return {
    step: 'cmm',
    binary: ctx.cmmCompPath,
    args,
    cwd: ctx.projectPath,
    processorName: ctx.processorName,
    label: `cmm: ${ctx.processorName}`,
  };
}
