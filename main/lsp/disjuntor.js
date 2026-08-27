// @ts-check
/**
 * disjuntor.js: para de insistir com um servidor de linguagem que esta falhando.
 *
 * O CASO QUE DEU ORIGEM
 * ---------------------
 * O slang responde `bad allocation` ao pedido de completar codigo quando o
 * buffer esta no meio de uma edicao e o desenho ainda nao fecha. Cada tecla
 * digitada dispara um pedido novo, cada pedido refaz a elaboracao do projeto
 * inteiro, e cada um falha do mesmo jeito. O log enchia de linhas identicas, o
 * servidor gastava folego numa pergunta que ele nao ia conseguir responder, e
 * quem digitava nao recebia sugestao nenhuma sem nunca saber por que.
 *
 * A falha em si e do servidor, escrita em C++, e nao ha o que corrigir daqui.
 * O que da para corrigir e a insistencia.
 *
 * COMO FUNCIONA
 * -------------
 * Conta falhas seguidas. Chegando ao limite, o disjuntor abre e as chamadas
 * seguintes voltam na hora, sem tocar no servidor, ate a pausa terminar. Uma
 * resposta boa fecha o disjuntor e zera a contagem, entao um problema
 * passageiro, que e o caso comum, se resolve sozinho.
 *
 * O RELOGIO VEM DE FORA
 * ---------------------
 * `agora()` e injetavel para o teste nao depender de espera real. Sem isso a
 * unica forma de exercitar a reabertura seria dormir na suite, que e como um
 * teste vira lento e intermitente.
 */

'use strict';

/** Quantas falhas seguidas antes de parar de perguntar. */
const LIMITE_PADRAO = 3;

/** Quanto tempo o disjuntor fica aberto antes de deixar tentar de novo. */
const PAUSA_PADRAO_MS = 60000;

/**
 * @param {{
 *   nome?: string,
 *   limite?: number,
 *   pausaMs?: number,
 *   agora?: () => number,
 *   aoAbrir?: (info: {nome: string, falhas: number, motivo: string, pausaMs: number}) => void,
 *   aoFechar?: (info: {nome: string}) => void,
 * }} [opcoes]
 */
function criarDisjuntor(opcoes = {}) {
  const nome = opcoes.nome || 'lsp';
  const limite = Number.isFinite(opcoes.limite) ? Number(opcoes.limite) : LIMITE_PADRAO;
  const pausaMs = Number.isFinite(opcoes.pausaMs) ? Number(opcoes.pausaMs) : PAUSA_PADRAO_MS;
  const agora = typeof opcoes.agora === 'function' ? opcoes.agora : Date.now;
  const aoAbrir = typeof opcoes.aoAbrir === 'function' ? opcoes.aoAbrir : () => {};
  const aoFechar = typeof opcoes.aoFechar === 'function' ? opcoes.aoFechar : () => {};

  let falhas = 0;
  let abertoAte = 0;
  let ultimoMotivo = null;

  return {
    /**
     * Da para perguntar agora?
     *
     * Passada a pausa, o disjuntor deixa UMA tentativa passar sem zerar a
     * contagem: se ela falhar de novo, `registrarFalha` reabre na hora, em vez
     * de gastar mais duas tentativas para redescobrir o que ja se sabia.
     */
    podeTentar() {
      if (abertoAte === 0) return true;
      if (agora() >= abertoAte) { abertoAte = 0; return true; }
      return false;
    },

    /** O disjuntor esta aberto neste instante? */
    get aberto() {
      return abertoAte !== 0 && agora() < abertoAte;
    },

    /** Quanto falta da pausa, em milissegundos. Zero quando fechado. */
    restanteMs() {
      const falta = abertoAte - agora();
      return falta > 0 ? falta : 0;
    },

    /** O motivo da ultima falha, para quem for relatar ao usuario. */
    get motivo() {
      return ultimoMotivo;
    },

    /**
     * Uma resposta boa. Fecha o disjuntor e zera a contagem.
     * @returns {boolean} true se ele estava contando falhas
     */
    registrarSucesso() {
      const estavaRuim = falhas > 0 || abertoAte !== 0;
      if (estavaRuim) aoFechar({ nome });
      falhas = 0;
      abertoAte = 0;
      ultimoMotivo = null;
      return estavaRuim;
    },

    /**
     * Uma falha. Chegando ao limite, abre e avisa UMA vez.
     * @param {unknown} erro
     * @returns {boolean} true se esta chamada abriu o disjuntor
     */
    registrarFalha(erro) {
      ultimoMotivo = erro instanceof Error ? erro.message : String(erro == null ? 'desconhecido' : erro);
      // Ja aberto e tentando de novo depois da pausa: reabre sem recontar.
      if (falhas >= limite) {
        abertoAte = agora() + pausaMs;
        return false;
      }
      falhas += 1;
      if (falhas < limite) return false;
      abertoAte = agora() + pausaMs;
      aoAbrir({ nome, falhas, motivo: ultimoMotivo, pausaMs });
      return true;
    },

    /** Volta ao estado inicial. Usado quando o servidor reinicia. */
    zerar() {
      falhas = 0;
      abertoAte = 0;
      ultimoMotivo = null;
    },
  };
}

module.exports = { criarDisjuntor, LIMITE_PADRAO, PAUSA_PADRAO_MS };
