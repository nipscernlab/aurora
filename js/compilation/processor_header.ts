/**
 * processor_header.ts: os parametros de hardware que um processador declara
 * no proprio fonte, lidos igual nas duas linguagens.
 *
 * As duas dizem a mesma coisa de jeitos diferentes:
 *
 *   C+- : `#NUBITS 32`, uma diretiva por linha, no topo do arquivo.
 *   C++ : `#pragma yanc nubits 32`, em qualquer lugar do arquivo.
 *
 * Este modulo existe porque essa leitura estava escrita A MAO EM DOIS LUGARES,
 * com a mesma expressao regular copiada:
 *
 *   - `parseCmmHeader`, dentro do handler `get-available-processors` do
 *     main/ipc/project.js, que enriquece a lista de processadores;
 *   - um laco solto dentro do `getProcessorConfig` do js/api/aurora_api.js,
 *     que e por onde a IA pergunta a configuracao de um processador.
 *
 * As duas copias ja tinham divergido no caminho: uma monta com `path.join` e a
 * outra com barras invertidas escritas na mao. E NENHUMA DAS DUAS entendia
 * C++, entao um processador C++ aparecia com cabecalho vazio nos dois lugares,
 * calado, como se nao declarasse nada.
 *
 * A CHAVE SAI SEMPRE EM MAIUSCULA, nas duas linguagens. Quem consome pergunta
 * por `NUBITS` sem precisar saber em que linguagem o processador foi escrito,
 * que e a mesma forma que o `rules.getDirective` da API ja normalizava.
 *
 * E logica pura: recebe texto, devolve objeto. Quem le o disco e quem chama,
 * porque no processo principal isso e `fs` e no renderer e a ponte do Electron.
 *
 * Compilado por `tsc` (npm run build:ts) num processor_header.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import type { ProcessorLanguage } from './processor_source.js';

/** Diretiva em MAIUSCULA para o valor declarado, ja sem espaco nas pontas. */
export type CabecalhoDoProcessador = Record<string, string>;

/**
 * C+-: `#NUBITS 32`.
 *
 * Copiada letra por letra das duas copias que este modulo substitui, para a
 * leitura do C+- continuar exatamente a mesma. Repare no que ela NAO tem: nao
 * ha `\s*` antes do `#`, entao diretiva indentada nao vale, e nao ha ancora no
 * fim, entao o resto da linha inteiro e o valor.
 */
const DIRETIVA_CMM = /^#([A-Z_]+)\s+(.+)/;

/**
 * C++: `#pragma yanc nubits 32`, no molde do lexer do cppcomp
 * (Compilers/CPPComp/Sources/CPPComp.l, regra `"#pragma"[ \t]+"yanc"...`).
 *
 * Tres escolhas vem de la, e nao de gosto:
 *
 *   - so espaco e tabulacao separam os tres pedacos, porque e `[ \t]+` no
 *     lexer;
 *   - a chave e MINUSCULA, porque o cppcomp compara com `strcmp` contra nomes
 *     minusculos: `#pragma yanc NUBITS 32` e lexado, avisa "unknown setting" e
 *     NAO e aplicado. Ler aqui o que la nao vale seria mostrar na tela um
 *     parametro que o compilador ignora;
 *   - o pragma pode vir indentado, porque no lexer o espaco do comeco da linha
 *     e comido pela regra de espaco antes desta casar.
 */
const PRAGMA_CPP = /^[ \t]*#[ \t]*pragma[ \t]+yanc[ \t]+([a-z_][a-z0-9_]*)[ \t]+(.+)/;

/**
 * Le o cabecalho de um fonte de processador.
 *
 * A linguagem e pedida, e nao adivinhada das duas formas de uma vez, de
 * proposito: cada compilador so honra a forma dele, e um cabecalho que
 * mostrasse `#pragma yanc` encontrado num `.cmm` estaria prometendo um
 * parametro que o cmmcomp nunca vai aplicar.
 *
 * @param texto o conteudo do arquivo, como veio do disco
 * @param language a linguagem do fonte (`processor_source.ts` a resolve)
 */
export function parseProcessorHeader(
  texto: unknown,
  language: ProcessorLanguage,
): CabecalhoDoProcessador {
  const padrao = language === 'cpp' ? PRAGMA_CPP : DIRETIVA_CMM;
  const cabecalho: CabecalhoDoProcessador = {};
  for (const linha of String(texto || '').split('\n')) {
    const m = linha.match(padrao);
    if (m) cabecalho[m[1].toUpperCase()] = m[2].trim();
  }
  return cabecalho;
}
