/**
 * builders/asm.ts, o CommandSpec do passo de montagem (TASM).
 *
 * Desde o yanc v7.1 o appcomp virou a primeira passada do asmcomp, e a AURORA
 * chama os dois pelo driver `yanc`, dando o .asm:
 *
 *   yanc -f <MHz> -c <clocks> --lang=pt|en <pasta de saida>/<nome>.asm
 *
 * Tudo sai na pasta do .asm: <nome>.v, os .mif, <nome>_tb.v, app_log.txt e
 * trad_opcode.txt. O yanc recusa `-o` com um .asm, e acha Macros/ e SAPHO/
 * sozinho ao lado de bin/.
 *
 * Compilado por `tsc` (npm run build:ts) num asm.js ao lado, é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

import type { CommandSpec } from '../command_spec.js';

export interface AsmBuilderCtx {
  /** caminho absoluto de components/bin/yanc.exe */
  yancPath: string;
  /** caminho absoluto do .asm, na pasta de saida */
  asmFile: string;
  /** a pasta do .asm, onde a montagem escreve: e o cwd */
  outputDir: string;
  /** -f, clock do testbench em MHz (inteiro positivo) */
  freq: number;
  /** -c, quantos clocks o testbench simula (inteiro positivo) */
  clocks: number;
  processorName: string;
  lang: 'pt' | 'en';
}

export function buildAsmSpec(ctx: AsmBuilderCtx): CommandSpec {
  const args = [
    '-f', String(ctx.freq),
    '-c', String(ctx.clocks),
    `--lang=${ctx.lang}`,
    ctx.asmFile,
  ];

  return {
    step: 'asm',
    binary: ctx.yancPath,
    args,
    cwd: ctx.outputDir,
    processorName: ctx.processorName,
    label: `asm: ${ctx.processorName}`,
  };
}
