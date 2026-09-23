/**
 * file_ref.ts: a que arquivo do projeto uma referencia no texto da IA aponta.
 *
 * Quando o modelo escreve `proc/Software/proc.cmm:42`, o painel transforma
 * isso num link que abre o arquivo no editor. Decidir QUAL arquivo abrir e o
 * que mora aqui; abrir e do painel.
 *
 * Isto e uma regra de SANDBOX, e nao so de conveniencia. A lista de candidatos
 * e curta de proposito e nunca inclui um caminho que saia da pasta do projeto:
 * caminho absoluto nao e resolvido como absoluto, e referencia com `..` e
 * descartada em vez de normalizada. Um caminho absoluto so abre quando ele
 * aponta de volta para um arquivo que a arvore do projeto ja conhece, e ai ele
 * entra pelo nome do arquivo e nao pelo caminho que veio escrito. Quem chama
 * ainda confere no disco, entao so abre o que existe de verdade.
 *
 * Saiu do js/ui/ai_assistant_manager.js, a classe de 4081 linhas. La estas
 * funcoes liam dois globais do `window` por dentro, entao nao davam para
 * exercitar sem subir o painel: uma regra de sandbox sem teste. Aqui as duas
 * entradas sao argumentos, e o painel continua sendo quem le os globais.
 *
 * Compilado por `tsc` (npm run build:ts) num file_ref.js ao lado, e esse .js
 * que o runtime carrega; os imports usam a extensao `.js`.
 */

/** Um arquivo como a arvore do projeto o lista. */
export interface ArquivoDaArvore {
  name?: string;
  path?: string;
}

/**
 * O caminho de um arquivo que a arvore ja conhece, achado pelo NOME.
 *
 * Pelo nome, e nao pelo caminho, porque a referencia pode vir com qualquer
 * profundidade de pasta na frente, ou vir absoluta. `null` quando a arvore
 * nao conhece esse nome.
 */
export function resolveTrackedFile(
  fileName: unknown,
  trackedFiles: readonly ArquivoDaArvore[] | null | undefined,
): string | null {
  if (!fileName) return null;
  const base = String(fileName).split(/[\\/]/).pop()!.toLowerCase();
  if (!Array.isArray(trackedFiles)) return null;
  const hit = trackedFiles.find((f) => (f.name || '').toLowerCase() === base);
  return hit ? (hit.path ?? null) : null;
}

/** De onde as duas respostas vem. Os dois sao opcionais. */
export interface ContextoDoProjeto {
  /** Os arquivos que a arvore do projeto lista. */
  trackedFiles?: readonly ArquivoDaArvore[] | null;
  /** A pasta do projeto aberto. */
  projectRoot?: string | null;
}

/**
 * Os caminhos a tentar, em ordem, para uma referencia escrita no texto.
 *
 * Primeiro o arquivo que a arvore conhece pelo nome, depois a referencia
 * resolvida a partir da raiz do projeto. Nunca mais do que isso, e e essa
 * brevidade que faz a regra ser uma regra.
 *
 * A referencia chega suja do texto (`(proc.cmm)`, `"proc.cmm"`, `<proc.cmm>`),
 * entao os delimitadores das pontas saem antes.
 */
export function fileRefCandidates(ref: unknown, contexto: ContextoDoProjeto = {}): string[] {
  const raw = String(ref || '').trim().replace(/^[("'<]+|[)"'>]+$/g, '');
  if (!raw) return [];
  const out: string[] = [];
  const push = (p: string | null | undefined) => {
    if (p && !out.includes(p)) out.push(p);
  };

  push(resolveTrackedFile(raw, contexto.trackedFiles));

  const root = contexto.projectRoot;
  const isAbs = /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/');
  if (root && !isAbs) {
    const rel = raw.replace(/\\/g, '/');
    // `..` e descartado, e nao normalizado: normalizar seria decidir o que
    // fazer com uma referencia que pede para sair do projeto, e a resposta e
    // nao fazer nada.
    if (!rel.split('/').includes('..')) push(`${root}/${rel}`);
  }
  return out;
}
