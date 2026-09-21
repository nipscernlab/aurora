/**
 * editor_language.ts: a extensao de um arquivo vira a linguagem do Monaco.
 *
 * Uma pergunta, uma resposta. Ate aqui ela tinha TRES respostas, escritas a
 * mao em tres arquivos:
 *
 *   - `EditorManager.getLanguageFromPath`, no js/editor/monaco_editor.js, que
 *     e o editor principal;
 *   - `POR_EXTENSAO`, no js/editor/empty_placeholder.js, que escolhe o
 *     marcador de comentario da dica de arquivo vazio;
 *   - `_langFromPath`, no js/editor/split_editor.js, que e o painel dividido.
 *
 * As duas primeiras eram identicas, com 25 extensoes, e a do painel dividido
 * JA TINHA DIVERGIDO: 20 extensoes, faltando `jsx`, `tsx`, `cc`, `cxx`,
 * `hpp`, `hh`, `hxx`, `svh` e `m`, e sobrando `xml`, `yaml` e `yml`.
 *
 * O estrago nao era so estetico, porque o Monaco grava a linguagem NO MODELO,
 * na hora em que ele nasce (js/editor/shared_models.js, `createModel`), e
 * todos os paineis compartilham o mesmo modelo por arquivo. Entao o realce de
 * um `.hpp` dependia de QUAL PAINEL ABRIU O ARQUIVO PRIMEIRO: pelo editor
 * principal virava C++, por um painel dividido virava texto puro, e assim
 * ficava ate o modelo morrer. O mesmo ao contrario para `.xml` e `.yaml`.
 *
 * A tabela abaixo e a UNIAO das tres, entao nenhum dos tres lados perde o que
 * tinha e o `.hpp` passa a ser C++ nos dois, que e o unico jeito de a resposta
 * nao depender de por onde se pergunta.
 *
 * Compilado por `tsc` (npm run build:ts) num editor_language.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/** A linguagem de quem nao esta na tabela, e a do Monaco para "sem realce". */
export const LINGUAGEM_PADRAO = 'plaintext';

/**
 * Extensao (sem o ponto, minuscula) para o id de linguagem do Monaco.
 *
 * `spf` e JSON de proposito: o arquivo de projeto E um JSON, e assim ele ganha
 * chaves, textos, numeros e dobra de graca.
 */
export const LINGUAGEM_POR_EXTENSAO: Readonly<Record<string, string>> = Object.freeze({
  // Verilog e o resto da toolchain SAPHO
  v: 'verilog',
  vh: 'verilog',
  sv: 'systemverilog',
  svh: 'systemverilog',
  cmm: 'cmm',
  asm: 'asm',
  spf: 'json',

  // C e C++, que sao as duas linguagens de fonte de processador mais os headers
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',

  // script
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  m: 'matlab',

  // texto e dados
  css: 'css',
  html: 'html',
  md: 'markdown',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
});

/**
 * A extensao de um caminho, minuscula e sem o ponto.
 *
 * Um nome sem ponto nenhum devolve o nome inteiro, que e o que as tres copias
 * faziam e nao vale a pena mudar: o resultado cai no padrao do mesmo jeito.
 */
export function extensionOfPath(filePath: unknown): string {
  return String(filePath || '').split('.').pop()!.toLowerCase();
}

/**
 * A linguagem do Monaco para um caminho. `plaintext` para o que nao conhece,
 * inclusive para caminho vazio ou ausente.
 *
 * Duas das tres copias chamavam `.split` direto no argumento e estouravam com
 * `null`; aqui isso vira `plaintext`, que e o que elas ja devolviam para
 * qualquer outra entrada que nao reconhecessem.
 */
export function languageFromPath(filePath: unknown): string {
  return LINGUAGEM_POR_EXTENSAO[extensionOfPath(filePath)] || LINGUAGEM_PADRAO;
}
