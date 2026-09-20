/**
 * processor_dispatch.ts: qual front end compila cada processador.
 *
 * Extraido do compilation_flow.js (god file, que nao se converte inteiro)
 * quando o C++ entrou como segunda linguagem. Ate entao o fluxo montava
 * `${nome}.cmm` em tres literais, pulava em silencio o processador que nao
 * tivesse esse arquivo, e chamava cmmCompilation sem perguntar nada. Aqui
 * mora a pergunta, feita uma vez:
 *
 *   - locateProcessorSource: qual e o fonte deste processador, no disco. Se
 *     o .spf declara (sourceFile, cmmFile ou language), vale o declarado. Se
 *     nao declara, o que existe em Software/ decide, na ordem das
 *     linguagens: <nome>.cmm, depois <nome>.cpp. Um projeto antigo, so com
 *     `{ name }`, continua achando o .cmm exatamente como antes; um projeto
 *     com so o .cpp passa a ser achado em vez de pulado.
 *   - compileProcessorSource: chama o passo certo do CompilationModule para
 *     a linguagem resolvida. Do asmCompilation em diante ninguem sabe qual.
 *
 * E logica pura com I/O injetado (joinPath/fileExists), para o teste de
 * unidade cobrir a ordem de busca sem disco. O compilation_flow passa o
 * electronAPI.
 *
 * Compilado por `tsc` (npm run build:ts) num processor_dispatch.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import {
  extensionForLanguage,
  resolveProcessorLanguage,
  resolveProcessorSource,
  sourceExtensions,
  type EntradaDeProcessador,
  type ProcessorLanguage,
} from './processor_source.js';

/** O I/O que a busca no disco precisa, na forma do electronAPI. */
export interface DiscoDoProjeto {
  joinPath(...parts: string[]): Promise<string>;
  fileExists(path: string): Promise<boolean>;
}

/** O fonte de um processador, achado no disco ou declarado no .spf. */
export interface FonteLocalizado {
  language: ProcessorLanguage;
  /** nome do arquivo, dentro de Software/ */
  sourceFile: string;
  /** caminho absoluto, <projeto>/<proc>/Software/<sourceFile> */
  sourcePath: string;
}

/** A ordem em que as linguagens sao tentadas quando o .spf nao declara. */
export function languagesInSearchOrder(): ProcessorLanguage[] {
  return sourceExtensions().map((ext) =>
    (ext === extensionForLanguage('cmm') ? 'cmm' : 'cpp'));
}

/**
 * Qual e o fonte deste processador, e onde ele esta.
 *
 * Declarado no .spf: devolve o declarado, exista ou nao no disco. Quem chama
 * decide o que fazer com um declarado ausente (o compilador vai falhar com a
 * mensagem certa). Nao declarado: o primeiro `<nome>.<ext>` que existir em
 * Software/, na ordem das linguagens; `null` se nenhum existir, que e o caso
 * "pular este processador" do pre-flight.
 */
export async function locateProcessorSource(
  projectPath: string,
  proc: EntradaDeProcessador,
  disco: DiscoDoProjeto,
): Promise<FonteLocalizado | null> {
  const declarou = !!(proc.sourceFile || proc.cmmFile || proc.language);
  if (declarou) {
    const fonte = resolveProcessorSource(proc);
    const sourcePath = await disco.joinPath(projectPath, proc.name, 'Software', fonte.sourceFile);
    return { language: fonte.language, sourceFile: fonte.sourceFile, sourcePath };
  }
  for (const language of languagesInSearchOrder()) {
    const sourceFile = `${proc.name}${extensionForLanguage(language)}`;
    const sourcePath = await disco.joinPath(projectPath, proc.name, 'Software', sourceFile);
    if (await disco.fileExists(sourcePath)) return { language, sourceFile, sourcePath };
  }
  return null;
}

/** O que o despacho precisa do CompilationModule: os dois front ends. */
export interface FrontEnds {
  cmmCompilation(processor: EntradaDeProcessador): Promise<string>;
  cppCompilation(processor: EntradaDeProcessador): Promise<string>;
}

/**
 * Roda o front end da linguagem do processador e devolve o caminho do .asm.
 * A entrada ja vem com o fonte dentro (sourceFile/cmmFile), montada por quem
 * chama; a linguagem e derivada dela.
 */
export function compileProcessorSource(compiler: FrontEnds, processor: EntradaDeProcessador): Promise<string> {
  return resolveProcessorLanguage(processor) === 'cpp'
    ? compiler.cppCompilation(processor)
    : compiler.cmmCompilation(processor);
}
