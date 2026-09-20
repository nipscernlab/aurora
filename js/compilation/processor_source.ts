/**
 * processor_source.ts: qual e o fonte de um processador SAPHO, e em que
 * linguagem ele esta escrito.
 *
 * Por que existe: ate aqui a resposta a essas duas perguntas estava
 * espalhada. O nome do arquivo era remontado como `${nome}.cmm` em nove
 * lugares independentes (compilation_flow, spec_factory, tab_manager,
 * active_processor, main/ipc/project.js, aurora_api), e "isto e fonte de
 * processador?" era um `endsWith('.cmm')` em outros oito. Enquanto houve uma
 * linguagem so, as duas perguntas tinham a mesma resposta em todo lugar e a
 * duplicacao nao doia. Com o front end C++ do yanc (cpppp + cppcomp, que
 * converge no mesmo .asm), cada uma dessas copias vira um lugar onde um
 * processador C++ e tratado como se nao existisse. Este modulo e o unico
 * lugar que responde, e os outros passam a perguntar aqui.
 *
 * E LOGICA PURA de proposito: so nomes de arquivo, nenhum acesso a disco,
 * nenhum electronAPI. Montar o caminho e com quem chama, que e quem sabe se
 * esta no main ou no renderer.
 *
 * O `.spf` NAO e migrado. Um projeto antigo traz `{ name }` e nada mais, e
 * continua valendo: sem campo nenhum a linguagem e C±, exatamente como era.
 * O campo legado `cmmFile` continua sendo lido; `sourceFile` e o nome novo e
 * tem precedencia quando os dois aparecem.
 *
 * Compilado por `tsc` (npm run build:ts) num processor_source.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/** As linguagens de fonte de processador que a toolchain yanc compila. */
export type ProcessorLanguage = 'cmm' | 'cpp';

/**
 * Extensao canonica de cada linguagem, com o ponto. E a unica tabela: tudo
 * mais neste modulo deriva dela, entao uma terceira linguagem entra aqui.
 */
const EXTENSAO: Readonly<Record<ProcessorLanguage, string>> = Object.freeze({
  cmm: '.cmm',
  cpp: '.cpp',
});

/** A linguagem assumida quando nada no `.spf` diz qual e. Ver o cabecalho. */
export const LINGUAGEM_PADRAO: ProcessorLanguage = 'cmm';

/** Entrada de processador como ela aparece no `.spf`. */
export interface EntradaDeProcessador {
  name: string;
  /** Nome novo do campo. Tem precedencia sobre `cmmFile`. */
  sourceFile?: string | null;
  /** Nome legado, de quando so havia C±. Continua sendo lido. */
  cmmFile?: string | null;
  /** Gravado por quem cria o processador; derivado da extensao se ausente. */
  language?: string | null;
  [key: string]: unknown;
}

/** O que o resto da AURORA precisa saber sobre o fonte de um processador. */
export interface FonteDoProcessador {
  language: ProcessorLanguage;
  /** Nome do arquivo dentro de `<proc>/Software/`, com extensao. */
  sourceFile: string;
  /** O mesmo nome sem a extensao de linguagem. Base do `.asm` e do `_tb.v`. */
  baseName: string;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * A linguagem de um nome de arquivo ou caminho, pela extensao. `null` quando
 * a extensao nao e de nenhuma linguagem de processador, o que inclui o `.asm`
 * (que e gerado, nao fonte).
 */
export function languageFromFileName(fileName: unknown): ProcessorLanguage | null {
  const nome = texto(fileName).toLowerCase();
  for (const [linguagem, ext] of Object.entries(EXTENSAO) as Array<[ProcessorLanguage, string]>) {
    if (nome.endsWith(ext)) return linguagem;
  }
  return null;
}

/**
 * Um caminho e fonte de processador? Substitui os `endsWith('.cmm')`
 * espalhados pelos portoes de botao, foco do editor e arvore de arquivos.
 */
export function isProcessorSourcePath(filePath: unknown): boolean {
  return languageFromFileName(filePath) !== null;
}

/**
 * Tira a extensao de linguagem de um nome de arquivo.
 *
 * Tira SO extensao de linguagem conhecida, nunca uma qualquer: o codigo que
 * havia antes era `replace(/\.cmm$/i, '')`, e um nome sem `.cmm` saia
 * intacto. Uma remocao generica (`/\.[^.]+$/`) mudaria esse caso calado, e a
 * diferenca apareceria como um `.asm` procurado com o nome errado.
 */
export function stripSourceExtension(fileName: unknown): string {
  const nome = texto(fileName);
  const linguagem = languageFromFileName(nome);
  return linguagem ? nome.slice(0, -EXTENSAO[linguagem].length) : nome;
}

/** A extensao canonica de uma linguagem, com o ponto. */
export function extensionForLanguage(language: ProcessorLanguage): string {
  return EXTENSAO[language];
}

/** Todas as extensoes de fonte de processador, com o ponto. */
export function sourceExtensions(): string[] {
  return Object.values(EXTENSAO);
}

/**
 * A linguagem de uma entrada do `.spf`, na ordem: campo `language` quando ele
 * nomeia uma linguagem conhecida, senao a extensao do arquivo declarado,
 * senao C±.
 */
export function resolveProcessorLanguage(entrada: EntradaDeProcessador | null | undefined): ProcessorLanguage {
  const declarada = texto(entrada?.language).toLowerCase();
  if (declarada && Object.prototype.hasOwnProperty.call(EXTENSAO, declarada)) {
    return declarada as ProcessorLanguage;
  }
  const arquivo = texto(entrada?.sourceFile) || texto(entrada?.cmmFile);
  return languageFromFileName(arquivo) ?? LINGUAGEM_PADRAO;
}

/**
 * Linguagem, nome do fonte e base, de uma entrada do `.spf`.
 *
 * Para toda entrada que existe hoje (so `name`, ou `name` mais um `cmmFile`
 * `.cmm`) o resultado e identico ao que as copias espalhadas calculavam:
 * `cmmFile || \`${name}.cmm\`` e a mesma string sem o `.cmm`. O teste de
 * unidade prova isso sobre um corpus, comparando com a formula antiga.
 */
export function resolveProcessorSource(entrada: EntradaDeProcessador | null | undefined): FonteDoProcessador {
  const nome = texto(entrada?.name);
  const language = resolveProcessorLanguage(entrada);
  const declarado = texto(entrada?.sourceFile) || texto(entrada?.cmmFile);
  const sourceFile = declarado || `${nome}${EXTENSAO[language]}`;
  return { language, sourceFile, baseName: stripSourceExtension(sourceFile) };
}
