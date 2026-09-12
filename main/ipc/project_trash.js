// @ts-check
/**
 * project_trash.js: a parte da exclusao de projeto que se prova sem disco.
 *
 * Excluir um projeto e mandar a PASTA inteira para a Lixeira, nunca apagar de
 * vez: `shell.trashItem` tem volta pelo Windows, e um aluno que se arrepende
 * dez segundos depois precisa dessa volta. O que mora aqui sao as duas
 * decisoes que dao para errar em silencio, separadas do IPC para terem teste:
 *
 *   - QUEM pode excluir O QUE. So a janela que acabou de FECHAR o projeto pode
 *     manda-lo para a Lixeira, e so aquele projeto. O fechar e feito pelo
 *     renderer antes (abas, vigias, interface), entao no momento do pedido a
 *     janela ja nao tem projeto registrado; a autorizacao e a lembranca de
 *     qual projeto ela acabou de fechar. Um renderer comprometido nao ganha
 *     com isso uma "apaga qualquer pasta": so pode excluir o que a propria
 *     pessoa tinha aberto naquela janela e mandou fechar.
 *
 *   - INSISTIR. No Windows uma pasta com um processo dentro nao se move: o
 *     terminal PowerShell com diretorio de trabalho no projeto, o servidor de
 *     linguagem, um vigia de pasta soltando descritores. Quem chama solta o
 *     que conhece e depois tenta algumas vezes com uma pausa, porque os
 *     descritores caem de forma assincrona. Desistir na primeira tentativa
 *     daria "acesso negado" a quem fez tudo certo.
 */

/**
 * O que a janela acabou de fechar.
 * @typedef {Map<number, string>} UltimosFechados chave: webContents.id, valor: caminho do .spf
 */

/**
 * Autoriza (e consome) a exclusao do projeto que esta janela acabou de fechar.
 *
 * Consome de proposito: a autorizacao vale para UM pedido. Se a exclusao
 * falhar, quem chama fecha e reabre para tentar de novo, com a pessoa olhando.
 *
 * @param {UltimosFechados} ultimos
 * @param {number | null | undefined} senderId
 * @param {string | null | undefined} spfPedido
 * @param {(a: string, b: string) => boolean} [mesmoCaminho] comparador de caminho (padrao: caixa ignorada, barras normalizadas)
 * @returns {{ ok: true, spf: string } | { ok: false, motivo: string }}
 */
function autorizarExclusao(ultimos, senderId, spfPedido, mesmoCaminho = caminhosIguais) {
  if (senderId == null) return { ok: false, motivo: 'no window in the request' };
  const fechado = ultimos.get(senderId);
  if (!fechado) return { ok: false, motivo: 'this window has not just closed a project' };
  if (typeof spfPedido !== 'string' || !spfPedido) return { ok: false, motivo: 'spf path required' };
  if (!mesmoCaminho(fechado, spfPedido)) {
    return { ok: false, motivo: 'only the project this window just closed can be deleted' };
  }
  ultimos.delete(senderId);
  return { ok: true, spf: fechado };
}

/** Igualdade de caminho como o Windows ve: barras iguais, caixa ignorada, sem barra final. */
function caminhosIguais(/** @type {string} */ a, /** @type {string} */ b) {
  const n = (/** @type {string} */ p) => String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return n(a) === n(b);
}

/** `alvo` esta dentro de `base`, ou e a propria. Mesma regra de caixa e barras. */
function dentroDe(/** @type {string} */ alvo, /** @type {string} */ base) {
  const n = (/** @type {string} */ p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const a = n(alvo);
  const b = n(base);
  return !!a && !!b && (a === b || a.startsWith(b + '\\'));
}

/**
 * Monta a funcao que manda uma pasta para a Lixeira insistindo.
 *
 * @param {{
 *   trashItem: (p: string) => Promise<void>,
 *   sleep?: (ms: number) => Promise<void>,
 *   tentativas?: number,
 *   esperaMs?: number,
 * }} deps
 * @returns {(dir: string) => Promise<{ success: boolean, tentativas: number, message?: string }>}
 */
function criarLixeiraDeProjeto({ trashItem, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tentativas = 6, esperaMs = 400 }) {
  return async function mandarParaLixeira(dir) {
    /** @type {unknown} */
    let ultimoErro = null;
    for (let i = 1; i <= tentativas; i++) {
      try {
        await trashItem(dir);
        return { success: true, tentativas: i };
      } catch (e) {
        ultimoErro = e;
        if (i < tentativas) await sleep(esperaMs);
      }
    }
    const msg = ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro);
    return { success: false, tentativas, message: msg };
  };
}

module.exports = { autorizarExclusao, caminhosIguais, dentroDe, criarLixeiraDeProjeto };
