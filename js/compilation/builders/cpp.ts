/**
 * builders/cpp.ts, os dois CommandSpec do front end C++ do yanc.
 *
 * O C++ chega ao mesmo assembly que o C±, mas em dois passos em vez de um:
 *
 *   cpppp  -i <fonte.cpp> -o <temp>/pp.cpp -I <Header> -I <Software>
 *   cppcomp -i <temp>/pp.cpp -p <projectPath> -n <baseName> -t <temp>
 *
 * Espelha Scripts/single_proc_cpp.bat do yanc. Tres diferencas em relacao ao
 * cmmcomp valem ser ditas, porque nenhuma delas se adivinha do cmm.ts:
 *
 *  - o cppcomp NAO recebe `-m`: os macros (`Macros/`) sao do asmcomp e do
 *    cmmcomp; o lado C++ traz os proprios cabecalhos em `Header/`, e eles
 *    entram pelo `-I` do cpppp, nao do compilador;
 *  - o que o cppcomp compila e o `pp.cpp` que o cpppp deixou na Temp, nao o
 *    arquivo da pessoa. Por isso os erros do cppcomp apontam para esse
 *    pp.cpp: e o preco de ter `#include`, e o terminal avisa;
 *  - o cpppp recebe o fonte por caminho ABSOLUTO, enquanto o cmmcomp recebe
 *    so o nome e resolve contra o `-p`. Os dois `-I` sao a pasta dos
 *    cabecalhos e a pasta do proprio fonte, nessa ordem, para que um
 *    `#include "meu.h"` ao lado do .cpp seja achado.
 *
 * O `-pt` / `-en` NAO entra aqui: nenhum dos dois binarios do lado C++ tem a
 * parse_lang_flag que o cmmcomp e o asmcomp tem, e passar a bandeira faria o
 * cpppp reclamar de opcao desconhecida. As mensagens do lado C++ saem so em
 * ingles, e isso e divida registrada do yanc.
 *
 * Compilado por `tsc` (npm run build:ts) num cpp.js ao lado, e esse .js que o
 * runtime carrega; os imports usam a extensao `.js`.
 */

import type { CommandSpec } from '../command_spec.js';

/** O nome do arquivo que o cpppp escreve e o cppcomp le, dentro da Temp. */
export const ARQUIVO_PRE_PROCESSADO = 'pp.cpp';

export interface CppPpBuilderCtx {
  /** caminho absoluto de cpppp.exe */
  cppPpPath: string;
  /** caminho ABSOLUTO do .cpp da pessoa (o cpppp nao resolve contra -p) */
  inputFile: string;
  /** onde o pp.cpp vai ser escrito, e o -t do cppcomp: <projeto>/.aurora/Temp/<proc> */
  tempPath: string;
  /** components/Header, os cabecalhos C++ do yanc */
  headerPath: string;
  /** <projeto>/<proc>/Software, para um #include ao lado do fonte */
  softwarePath: string;
  processorName: string;
}

export interface CppBuilderCtx {
  /** caminho absoluto de cppcomp.exe */
  cppCompPath: string;
  /** a MESMA Temp que o cpppp usou: e de la que sai o pp.cpp */
  tempPath: string;
  /** pasta do processador, onde nascem Software/<base>.asm e Hardware/ */
  projectPath: string;
  /** nome do fonte sem extensao; vira o -n e o nome do .asm */
  baseName: string;
  processorName: string;
}

/** O caminho do pp.cpp dentro de uma Temp. Um so lugar decide esse nome. */
export function caminhoPreProcessado(tempPath: string, separador = '\\'): string {
  return `${tempPath}${separador}${ARQUIVO_PRE_PROCESSADO}`;
}

/** Passo 1: cpppp, o pre-processador (#include, #define, #if, #pragma once). */
export function buildCppPpSpec(ctx: CppPpBuilderCtx): CommandSpec {
  const args = [
    '-i', ctx.inputFile,
    '-o', caminhoPreProcessado(ctx.tempPath),
    '-I', ctx.headerPath,
    '-I', ctx.softwarePath,
  ];

  return {
    step: 'cpp-pp',
    binary: ctx.cppPpPath,
    args,
    cwd: ctx.tempPath,
    processorName: ctx.processorName,
    label: `cpp-pp: ${ctx.processorName}`,
  };
}

/** Passo 2: cppcomp, que compila o pp.cpp no mesmo .asm do cmmcomp. */
export function buildCppSpec(ctx: CppBuilderCtx): CommandSpec {
  const args = [
    '-i', caminhoPreProcessado(ctx.tempPath),
    '-p', ctx.projectPath,
    '-n', ctx.baseName,
    '-t', ctx.tempPath,
  ];

  return {
    step: 'cpp',
    binary: ctx.cppCompPath,
    args,
    cwd: ctx.projectPath,
    processorName: ctx.processorName,
    label: `cpp: ${ctx.processorName}`,
  };
}
