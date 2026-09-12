// @ts-check
/**
 * main_windows.js: quais janelas principais existem, e qual delas e a certa
 * para receber uma mensagem.
 *
 * O processo principal guardava uma janela so, `state.mainWindow`, sobrescrita
 * a cada `createMainWindow`. Como abrir a AURORA de novo cria outra janela no
 * MESMO processo (main/lifecycle.js pega o bloqueio de instancia unica e trata
 * a segunda abertura como janela nova), a variavel ficava com a ULTIMA criada.
 * Tudo o que o main mandava para a interface ia para essa: a saida do PRISM,
 * o "Top-level: x.v", os diagnosticos do servidor de linguagem, o aviso de
 * processador criado. Quem estava trabalhando na primeira janela via a segunda
 * responder por ela.
 *
 * Aqui as janelas principais viram um conjunto, e a escolha do destino passa a
 * ser explicita. Sao tres perguntas, nesta ordem de preferencia:
 *
 *   1. `doSender` — quem PEDIU. E a resposta certa sempre que existe um
 *      `event`, e e a unica que nunca erra.
 *   2. `doProjeto` — quem abriu ESTE `.spf`. E a resposta para o que chega
 *      tarde, de um processo filho ou de um servidor que nao guardou o
 *      pedido, mas sabe de que projeto esta falando.
 *   3. `principal` — a primeira janela viva. Ultimo recurso, para o que nao
 *      tem pedido nem projeto (uma atualizacao, por exemplo).
 *
 * Sem Electron importado de proposito: trabalha sobre os objetos de janela que
 * recebe, entao um teste passa janelas de mentira e exercita a escolha inteira.
 */

const state = require('./state');

/** @typedef {{ webContents?: { id?: number }, isDestroyed?: () => boolean }} JanelaLike */

/**
 * @param {JanelaLike | null | undefined} w
 * @returns {boolean}
 */
function viva(w) {
  if (!w) return false;
  try { return typeof w.isDestroyed === 'function' ? !w.isDestroyed() : true; }
  catch (_) { return false; }
}

/**
 * Passa a conhecer esta janela principal, e a esquece quando ela fecha.
 *
 * `state.mainWindow` continua sendo escrito por quem cria a janela: ha codigo
 * antigo demais lendo aquela variavel para troca-la de uma vez, e ela vale
 * como "a mais recente", que e o que ela sempre foi.
 *
 * @param {JanelaLike & { on?: (ev: string, fn: () => void) => void }} win
 */
function registrar(win) {
  if (!win) return;
  state.mainWindows.add(win);
  if (typeof win.on === 'function') {
    win.on('closed', () => { state.mainWindows.delete(win); });
  }
}

/** Todas as janelas principais vivas, na ordem em que foram criadas. */
function todas() {
  const vivas = [...state.mainWindows].filter(viva);
  // Uma janela destruida sem evento `closed` (crash do renderer) ficaria no
  // conjunto para sempre, e seria escolhida como destino de mensagens.
  for (const w of state.mainWindows) if (!viva(w)) state.mainWindows.delete(w);
  return vivas;
}

/**
 * A janela cujo webContents fez o pedido.
 *
 * Aceita um `event` de IPC, um `webContents`, ou a propria janela. Devolve
 * null quando o pedido nao veio de uma janela principal (a janela do PRISM,
 * a de atualizacao, um `<webview>`).
 *
 * @param {any} origem event de IPC, webContents ou janela
 * @returns {JanelaLike | null}
 */
function doSender(origem) {
  const id = origem?.sender?.id ?? origem?.webContents?.id ?? origem?.id;
  if (id == null) return null;
  return todas().find((w) => w.webContents?.id === id) || null;
}

/**
 * A janela que abriu este `.spf`.
 *
 * Para o que chega tarde: um servidor de linguagem que so sabe o projeto, um
 * processo filho que terminou, uma sintese que rodou em segundo plano. Se
 * duas janelas abriram o mesmo projeto, ganha a primeira; esse caso e raro e
 * as duas mostram a mesma coisa.
 *
 * @param {string | null | undefined} spfPath
 * @returns {JanelaLike | null}
 */
function doProjeto(spfPath) {
  if (!spfPath) return null;
  const alvo = String(spfPath).toLowerCase();
  return todas().find((w) => {
    const id = w.webContents?.id;
    if (id == null) return false;
    const spf = state.projectPathsBySender.get(id);
    return typeof spf === 'string' && spf.toLowerCase() === alvo;
  }) || null;
}

/**
 * Uma janela principal qualquer, para o que nao tem pedido nem projeto.
 * Prefere a mais recente (`state.mainWindow`) quando ela ainda esta viva,
 * que e o comportamento que o codigo antigo tinha.
 */
function principal() {
  if (viva(state.mainWindow)) return state.mainWindow;
  return todas()[0] || null;
}

/**
 * A melhor janela para esta mensagem, tentando as tres perguntas em ordem.
 *
 * @param {{ origem?: any, spf?: string | null, reserva?: boolean }} pistas
 *   `reserva: false` recusa a ultima pergunta: a mensagem nao vai para uma
 *   janela qualquer se ninguem souber de quem ela e. Use assim tudo o que
 *   carrega conteudo de um projeto, porque mostrar o projeto errado e pior do
 *   que nao mostrar nada.
 * @returns {JanelaLike | null}
 */
function escolher({ origem = null, spf = null, reserva = true } = {}) {
  return doSender(origem) || doProjeto(spf) || (reserva ? principal() : null);
}

/**
 * Manda `canal` para a janela escolhida. Devolve true se foi.
 *
 * @param {{ origem?: any, spf?: string | null, reserva?: boolean }} pistas
 * @param {string} canal
 * @param {...any} args
 */
function mandar(pistas, canal, ...args) {
  const w = escolher(pistas);
  const wc = /** @type {any} */ (w)?.webContents;
  if (!wc || typeof wc.send !== 'function') return false;
  try {
    if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return false;
    wc.send(canal, ...args);
    return true;
  } catch (_) {
    // Janela fechando no meio do envio. Nao ha o que fazer e nao ha o que
    // dizer: quem receberia a mensagem nao existe mais.
    return false;
  }
}

module.exports = { registrar, todas, doSender, doProjeto, principal, escolher, mandar };
