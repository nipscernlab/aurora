/**
 * processor_rename.ts: o que muda de nome quando um processador e renomeado.
 *
 * Extraido do main/ipc/project.js (god file) quando o rename precisou conhecer
 * a segunda linguagem. Ate aqui o handler trazia a lista de artefatos e a
 * reescrita do cabecalho soltas no corpo, e as duas so sabiam de C+-: um
 * processador C++ renomeado ficava com o `.cpp` no nome antigo e com o
 * `#pragma yanc prname` apontando para um nome que nao existia mais, e parava
 * de compilar.
 *
 * E logica pura, sem disco: recebe nomes e texto, devolve nomes e texto.
 *
 * As extensoes aparecem aqui E no js/compilation/processor_source.ts, que e o
 * mesmo conhecimento nos dois lados da ponte. A duplicacao e deliberada e nao
 * tem saida barata: aquele modulo e ESM do renderer, este roda no processo
 * principal em CommonJS, e nao ha modulo compartilhado entre os dois hoje.
 * Quem acrescentar uma terceira linguagem mexe nos dois, e o teste de unidade
 * de cada lado cobra a sua metade.
 *
 * Compilado por `tsc` (npm run build:ts) num processor_rename.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/** As linguagens de fonte de processador, e a extensao de cada uma. */
const EXTENSAO_FONTE = Object.freeze({ cmm: '.cmm', cpp: '.cpp' });

export type LinguagemDoProcessador = keyof typeof EXTENSAO_FONTE;

/** Um arquivo a renomear: a subpasta do processador, o nome velho e o novo. */
export interface ArtefatoRenomeado {
  sub: 'Software' | 'Hardware' | 'Simulation';
  de: string;
  para: string;
}

/**
 * Tudo que o SAPHO nomeia a partir do processador.
 *
 * Os fontes das DUAS linguagens entram na lista, e nao so o da linguagem
 * declarada, de proposito: quem renomeia nao sabe (e nao deveria precisar
 * saber) o que existe no disco, e um processador que tenha os dois arquivos
 * por qualquer motivo nao pode sair do rename pela metade. Quem chama pula o
 * que nao existir.
 */
export function artefatosDoProcessador(nomeVelho: string, nomeNovo: string): ArtefatoRenomeado[] {
  const fontes = Object.values(EXTENSAO_FONTE).map((ext) => ({
    sub: 'Software' as const, de: `${nomeVelho}${ext}`, para: `${nomeNovo}${ext}`,
  }));
  return [
    ...fontes,
    { sub: 'Software', de: `${nomeVelho}.asm`, para: `${nomeNovo}.asm` },
    { sub: 'Hardware', de: `${nomeVelho}.v`, para: `${nomeNovo}.v` },
    { sub: 'Simulation', de: `${nomeVelho}_tb.v`, para: `${nomeNovo}_tb.v` },
  ];
}

/** O nome do fonte de cada linguagem, para quem precisa procurar no disco. */
export function fontesPossiveis(nome: string): Array<{ language: LinguagemDoProcessador, arquivo: string }> {
  return (Object.entries(EXTENSAO_FONTE) as Array<[LinguagemDoProcessador, string]>)
    .map(([language, ext]) => ({ language, arquivo: `${nome}${ext}` }));
}

/** A linguagem de um nome de arquivo, ou `null` se nao for fonte. */
export function linguagemDoArquivo(arquivo: string): LinguagemDoProcessador | null {
  const nome = String(arquivo || '').toLowerCase();
  for (const [lang, ext] of Object.entries(EXTENSAO_FONTE) as Array<[LinguagemDoProcessador, string]>) {
    if (nome.endsWith(ext)) return lang;
  }
  return null;
}

/**
 * Reescreve o nome do processador DENTRO do fonte, e so a linha da diretiva.
 *
 * C+- declara `#PRNAME <nome>`; C++ diz a mesma coisa com
 * `#pragma yanc prname <nome>`. Devolve o texto intacto quando a diretiva nao
 * esta la, que e o caso de um fonte que a pessoa escreveu sem ela.
 *
 * Comentarios e codigo nao sao tocados: uma busca-e-troca pelo nome antigo no
 * arquivo inteiro renomearia variavel, texto de comentario e o que mais
 * coincidisse.
 */
export function reescreverNomeNoFonte(
  texto: string, nomeNovo: string, language: LinguagemDoProcessador,
): string {
  const original = String(texto ?? '');
  if (language === 'cpp') {
    return original.replace(/^([ \t]*#[ \t]*pragma[ \t]+yanc[ \t]+prname[ \t]+)\S+/mi, `$1${nomeNovo}`);
  }
  return original.replace(/^([ \t]*#PRNAME[ \t]+)\S+/m, `$1${nomeNovo}`);
}
