/**
 * builders/cmm.ts, o CommandSpec do passo de compilacao do C± (TCMM).
 *
 * Desde o yanc v7.1 a AURORA chama so o driver `yanc`, que acha o cmmcomp ao
 * lado dele e repassa as mensagens sem mudanca:
 *
 *   yanc -S -o <pasta de saida> [--wave-arrays] --lang=pt|en <fonte.cmm>
 *
 * `-S` para no .asm: a montagem e o passo seguinte, no TASM (builders/asm.ts).
 * O nome do processador e o do arquivo, e as pastas Macros/ e SAPHO/ o yanc
 * acha sozinho ao lado de bin/; nao ha mais -i, -n, -p, -m nem -t.
 * `--wave-arrays` (antes -A) mostra cada elemento de vetor como sinal proprio
 * na forma de onda; so vale para o C±.
 *
 * Compilado por `tsc` (npm run build:ts) num cmm.js ao lado, é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

import type { CommandSpec } from '../command_spec.js';

export interface CmmBuilderCtx {
  /** caminho absoluto de components/bin/yanc.exe */
  yancPath: string;
  /** caminho absoluto do .cmm, na pasta do processador */
  sourcePath: string;
  /** <proj>/<proc>/<proc>, onde o yanc escreve o .asm e as tabelas */
  outputDir: string;
  /** <proj>/<proc>, a pasta do fonte: e o cwd, como no terminal */
  sourceDir: string;
  processorName: string;
  lang: 'pt' | 'en';
  showArrays: boolean;
}

export function buildCmmSpec(ctx: CmmBuilderCtx): CommandSpec {
  const args = ['-S', '-o', ctx.outputDir];
  if (ctx.showArrays) args.push('--wave-arrays');
  args.push(`--lang=${ctx.lang}`, ctx.sourcePath);

  return {
    step: 'cmm',
    binary: ctx.yancPath,
    args,
    cwd: ctx.sourceDir,
    processorName: ctx.processorName,
    label: `cmm: ${ctx.processorName}`,
  };
}
