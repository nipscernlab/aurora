/**
 * problem_store.ts: os problemas da ultima compilacao, guardados por arquivo.
 *
 * O QUE ESTAVA ERRADO. O compilador diz onde esta o erro, e a AURORA mostrava
 * isso so como texto no terminal. Dentro do editor o arquivo ficava limpo:
 * nenhum rabisco, nenhuma marca na barra de rolagem, nada na visao geral. Quem
 * fechasse o terminal (ou so rolasse ele) perdia o erro de vista, e um erro num
 * arquivo que nao estava aberto era invisivel do comeco ao fim. O editor ja
 * rabisca o que o LSP encontra; o que TRAVA A COMPILACAO nao aparecia.
 *
 * A LEITURA E DA SAIDA, e nao de um canal novo. Mexer no yanc para ele emitir
 * erro estruturado esta fora de escopo agora (o debug interativo vem depois, e
 * ai sim os dois lados mudam juntos). Entao aqui se le o texto que as
 * ferramentas ja imprimem, com o mesmo reconhecedor por ferramenta que o
 * terminal usa para os links (error_locations.js): uma so descricao de como
 * cada ferramenta fala, servindo os dois usos.
 *
 * DOIS DONOS, DUAS CAMADAS. O marcador entra com dono proprio, `toolchain`,
 * separado dos donos `verible` e `slang`. Sao coisas diferentes: o LSP diz o
 * que ele acha do codigo enquanto se digita, e a toolchain diz o que aconteceu
 * quando se mandou compilar. Limpar um nunca apaga o outro, e cada um se
 * atualiza no seu tempo.
 *
 * ARQUIVO FECHADO CONTINUA CONTANDO. Marcador so existe em modelo aberto, e o
 * erro mais facil de perder e justamente o do arquivo que ninguem abriu. Entao
 * o deposito guarda TODOS, aplica nos que estao abertos, e reaplica quando um
 * arquivo e aberto depois. A lista inteira fica disponivel para o painel de
 * problemas, que e quem mostra o que nao cabe no editor.
 */

import type * as Monaco from 'monaco-editor';

// O Monaco chega como global do carregador AMD, e nao por import: aqui so o tipo.
declare const monaco: typeof Monaco;

type Modelo = Monaco.editor.ITextModel;

/** Um problema lido da saida de uma ferramenta (error_locations.problemasNaLinha). */
export interface Problema {
  arquivo: string;
  linha: number;
  coluna?: number | null;
  severidade?: string;
  mensagem: string;
  ferramenta?: string;
}

const DONO = 'toolchain';

/** chave normalizada -> problemas */
const porArquivo: Map<string, Problema[]> = new Map();
/** chave normalizada -> caminho como veio */
const caminhoOriginal: Map<string, string> = new Map();
const ouvintes: Set<() => void> = new Set();
let ligado = false;

/**
 * A chave de comparacao de caminho.
 *
 * O Verilator mistura as barras na mesma linha (`C:/proj/Sim\tb.v`) porque
 * junta o que recebeu com o que descobriu, e o Windows nao distingue caixa.
 * Comparar o texto cru faria o mesmo arquivo virar duas entradas, e o marcador
 * nunca acharia o modelo.
 */
function chaveDe(caminho: string | null | undefined): string {
  return String(caminho || '').replace(/\\/g, '/').toLowerCase();
}

function avisarOuvintes(): void {
  for (const cb of ouvintes) {
    try { cb(); } catch (e) { console.warn('[problemas] ouvinte falhou:', e); }
  }
}

/** O modelo do Monaco desse arquivo, ou null. */
function modeloDe(caminho: string): Modelo | null {
  if (typeof monaco === 'undefined') return null;
  const alvo = chaveDe(caminho);
  for (const model of monaco.editor.getModels()) {
    if (chaveDe(model.uri.fsPath) === alvo) return model;
  }
  return null;
}

/** Um problema vira marcador. A coluna e opcional: o Icarus nao da nenhuma. */
function paraMarcador(p: Problema, model: Modelo): Monaco.editor.IMarkerData {
  const linha = Math.max(1, Math.min(p.linha, model.getLineCount()));
  const maxCol = model.getLineMaxColumn(linha);
  // Sem coluna, o marcador cobre a LINHA inteira. Escolher a coluna 1 poria um
  // rabisco de um caractere no comeco da linha, que e mais facil de nao ver do
  // que de ver.
  const de = p.coluna ? Math.max(1, Math.min(p.coluna, maxCol)) : 1;
  const ate = p.coluna ? Math.min(de + 1, maxCol) : maxCol;
  return {
    severity: p.severidade === 'aviso'
      ? monaco.MarkerSeverity.Warning
      : monaco.MarkerSeverity.Error,
    message: p.mensagem,
    source: p.ferramenta,
    startLineNumber: linha,
    startColumn: de,
    endLineNumber: linha,
    endColumn: Math.max(ate, de + 1),
  };
}

/** Escreve (ou limpa) os marcadores de um modelo. */
function aplicarNoModelo(model: Modelo | null): void {
  if (!model || typeof monaco === 'undefined') return;
  if (model.isDisposed && model.isDisposed()) return;
  const lista = porArquivo.get(chaveDe(model.uri.fsPath)) || [];
  monaco.editor.setModelMarkers(model, DONO, lista.map((p) => paraMarcador(p, model)));
}

function aplicarEmTodos(): void {
  if (typeof monaco === 'undefined') return;
  for (const model of monaco.editor.getModels()) aplicarNoModelo(model);
}

export const problemStore = {
  /**
   * Comeca uma rodada. Os problemas da rodada anterior somem do editor na hora,
   * e nao quando os novos chegarem: durante uma compilacao longa, um rabisco
   * vermelho da rodada passada ao lado de uma barra de progresso e a interface
   * afirmando uma coisa que ela nao sabe mais.
   */
  limpar(): void {
    porArquivo.clear();
    caminhoOriginal.clear();
    aplicarEmTodos();
    avisarOuvintes();
  },

  /**
   * Le uma linha de saida da toolchain. Sem problema nela, nao faz nada.
   */
  registrarLinha(texto: string, { cmmPadrao = null, problemasNaLinha }: { cmmPadrao?: string | null; problemasNaLinha: (texto: string, o: { cmmPadrao?: string | null }) => Problema[] }): void {
    const achados = problemasNaLinha(texto, { cmmPadrao });
    if (!achados.length) return;

    let mudou = false;
    for (const p of achados) {
      const chave = chaveDe(p.arquivo);
      if (!porArquivo.has(chave)) {
        porArquivo.set(chave, []);
        caminhoOriginal.set(chave, p.arquivo);
      }
      const lista = porArquivo.get(chave) ?? [];
      // O mesmo erro sai duas vezes com frequencia: o Verilator repete o local
      // na linha de continuacao, e um build completo passa pelo mesmo arquivo
      // em etapas diferentes. Repetir viraria dois rabiscos sobrepostos e dois
      // itens na lista, para um problema so.
      const repetido = lista.some((q) => q.linha === p.linha
        && q.coluna === p.coluna
        && q.mensagem === p.mensagem);
      if (repetido) continue;
      lista.push(p);
      mudou = true;
    }
    if (!mudou) return;

    for (const p of achados) {
      const model = modeloDe(p.arquivo);
      if (model) aplicarNoModelo(model);
    }
    avisarOuvintes();
  },

  /** Tudo o que se sabe, para o painel: [{ arquivo, problemas }]. */
  listar(): Array<{ arquivo: string; problemas: Problema[] }> {
    const saida: Array<{ arquivo: string; problemas: Problema[] }> = [];
    for (const [chave, problemas] of porArquivo) {
      if (!problemas.length) continue;
      saida.push({ arquivo: caminhoOriginal.get(chave) || chave, problemas });
    }
    return saida;
  },

  /** Quantos erros e quantos avisos ha no total. */
  contagem(): { erros: number; avisos: number } {
    let erros = 0;
    let avisos = 0;
    for (const lista of porArquivo.values()) {
      for (const p of lista) {
        if (p.severidade === 'aviso') avisos += 1; else erros += 1;
      }
    }
    return { erros, avisos };
  },

  /** Avisa quando a lista muda. Devolve como cancelar. */
  aoMudar(cb: () => void): () => boolean {
    ouvintes.add(cb);
    return () => ouvintes.delete(cb);
  },

  /**
   * Liga o deposito ao ciclo de vida dos modelos.
   *
   * O arquivo que e aberto DEPOIS da compilacao precisa receber os marcadores
   * que ja estavam guardados. Sem isto, abrir o arquivo apontado pelo erro
   * mostraria o codigo limpo, que e o contrario do que se quer.
   */
  ligar(): void {
    if (ligado || typeof monaco === 'undefined') return;
    ligado = true;
    monaco.editor.onDidCreateModel((model) => aplicarNoModelo(model));
    aplicarEmTodos();
  },

  /** Exposto para teste: a normalizacao de caminho que decide tudo aqui. */
  _chaveDe: chaveDe,
};
