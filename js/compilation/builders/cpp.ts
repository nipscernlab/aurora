/**
 * builders/cpp.ts, o CommandSpec do passo de compilacao do C++ (TCMM).
 *
 * Desde o yanc v7.1 o C++ e um passo so, como o C±: o cppcomp pre-processa
 * o fonte em memoria (o cpppp deixou de existir), e a AURORA o chama pelo
 * driver `yanc`:
 *
 *   yanc -S -o <pasta de saida> -I <pasta>... --lang=pt|en <fonte.cpp>
 *
 * Um `#include "x"` e procurado na pasta do arquivo que inclui, depois nas
 * pastas -I, depois em Header/, que o yanc acha ao lado de bin/. As mensagens
 * de erro apontam para o arquivo e a linha que a pessoa escreveu
 * (`fonte.cpp:12`, `./h.hpp:3`), e nao mais para um pp.cpp expandido. O
 * `--lang` vale para todo o yanc; o cppcomp aceita e continua em ingles.
 *
 * Compilado por `tsc` (npm run build:ts) num cpp.js ao lado, e esse .js que o
 * runtime carrega; os imports usam a extensao `.js`.
 */

import type { CommandSpec } from '../command_spec.js';

export interface CppBuilderCtx {
  /** caminho absoluto de components/bin/yanc.exe */
  yancPath: string;
  /** caminho absoluto do .cpp, na pasta do processador */
  sourcePath: string;
  /** <proj>/<proc>/<proc>, onde o yanc escreve o .asm e as tabelas */
  outputDir: string;
  /** <proj>/<proc>, a pasta do fonte: e o cwd, base dos caminhos dos erros */
  sourceDir: string;
  /** pastas extras de #include, na ordem; vazio no uso normal */
  includeDirs?: string[];
  processorName: string;
  lang: 'pt' | 'en';
}

export function buildCppSpec(ctx: CppBuilderCtx): CommandSpec {
  const args = ['-S', '-o', ctx.outputDir];
  for (const dir of ctx.includeDirs ?? []) args.push('-I', dir);
  args.push(`--lang=${ctx.lang}`, ctx.sourcePath);

  return {
    step: 'cpp',
    binary: ctx.yancPath,
    args,
    cwd: ctx.sourceDir,
    processorName: ctx.processorName,
    label: `cpp: ${ctx.processorName}`,
  };
}
