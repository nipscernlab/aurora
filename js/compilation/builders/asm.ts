/**
 * builders/asm.ts, CommandSpec builders for the two ASM steps:
 * appcomp (macro preprocessor) and asmcomp (final compiler).
 *
 * Mirror the call sites in compilation_module.js asmCompilation().
 * Lang flag (-pt/-en) goes first; the rest are named options
 * (APP/Sources/args.c and ASM/Sources/args.c).
 *
 * Compilado por `tsc` (npm run build:ts) num asm.js ao lado, é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

import type { CommandSpec } from '../command_spec.js';

export interface AsmPreBuilderCtx {
  /** absolute path to appcomp.exe */
  appCompPath: string;
  /** input .asm path */
  asmFile: string;
  /** components/Temp/<processor> */
  tempPath: string;
  processorName: string;
  lang: 'pt' | 'en';
}

export function buildAsmPreSpec(ctx: AsmPreBuilderCtx): CommandSpec {
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

export interface AsmBuilderCtx {
  asmCompPath: string;
  asmFile: string;
  /** per-processor project dir */
  projectPath: string;
  /** components/HDL */
  hdlPath: string;
  /** components/Macros */
  macrosPath: string;
  tempPath: string;
  /** -f (positive int) */
  freq: number;
  /** -c (positive int) */
  clocks: number;
  processorName: string;
  lang: 'pt' | 'en';
}

export function buildAsmSpec(ctx: AsmBuilderCtx): CommandSpec {
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
