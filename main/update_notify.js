/**
 * update_notify.js: as notificacoes do sistema operacional durante uma
 * atualizacao, e a barra de progresso no botao da barra de tarefas.
 *
 * Existe por causa de um pedido simples: o card de atualizacao fica sempre
 * no topo, no meio da tela, e quem precisa mexer no computador enquanto a
 * versao nova baixa nao tem para onde empurra-lo. Agora tem: o botao de
 * minimizar tira o card da tela. So que tirar o card sem por nada no lugar
 * trocaria um estorvo por um silencio, e ninguem saberia se a atualizacao
 * andou ou morreu. Entao minimizar e exatamente o gesto que LIGA este
 * modulo: dali em diante quem conta o andamento e o Windows.
 *
 * Sao duas falas, as duas que foram pedidas e nenhuma a mais: uma quando
 * comeca a baixar e uma quando termina. Notificacao de sistema interrompe,
 * e interromper tres vezes para dizer a mesma coisa e pior do que nao
 * avisar. O andamento continuo vai por um canal que nao interrompe: a barra
 * de progresso dentro do proprio botao do aplicativo na barra de tarefas.
 *
 * O idioma vem de fora, da janela que minimizou. O processo principal nao
 * tem i18n (o `updates:notice` manda CHAVES para o renderer traduzir), e
 * uma notificacao do sistema e escrita aqui, agora: a janela passa o idioma
 * em que a pessoa estava lendo o card, e o texto sai no mesmo.
 */

const { Notification } = require('electron');
const log = require('electron-log');

const state = require('./state');

/** Ligado pelo minimizar, desligado quando o card volta para a tela. */
let ligado = false;
let idioma = 'pt';
/** O que ja foi dito nesta atualizacao, para nao repetir a mesma fala. */
const jaDito = new Set();
/** A notificacao viva, para fecha-la quando ela deixar de valer. */
let viva = null;

const TEXTOS = {
  en: {
    baixando: (v) => ({
      title: 'Updating SAPHO',
      body: `Downloading version ${v}. Keep working, this runs in the background.`,
    }),
    concluido: (v) => ({
      title: 'SAPHO update ready',
      body: `Version ${v} finished downloading. Restart to use it, or it installs by itself the next time SAPHO opens.`,
    }),
  },
  pt: {
    baixando: (v) => ({
      title: 'Atualizando o SAPHO',
      body: `Baixando a versao ${v}. Pode continuar trabalhando, isto corre em segundo plano.`,
    }),
    concluido: (v) => ({
      title: 'Atualizacao do SAPHO pronta',
      body: `A versao ${v} terminou de baixar. Reinicie para usa-la, ou ela se instala sozinha na proxima vez que o SAPHO abrir.`,
    }),
  },
};

/**
 * Liga as notificacoes do sistema e fixa o idioma.
 *
 * `locale` vem da janela de atualizacao, que sabe em que idioma a pessoa
 * estava lendo. Qualquer coisa que nao seja 'en' cai no portugues, que e o
 * padrao do aplicativo.
 */
function ativar(locale) {
  ligado = true;
  idioma = locale === 'en' ? 'en' : 'pt';
}

/**
 * Desliga tudo: o card voltou para a tela e passa a contar a historia de
 * novo. Limpa o registro do que ja foi dito, porque uma atualizacao
 * minimizada outra vez merece as mesmas falas.
 */
function desativar() {
  ligado = false;
  jaDito.clear();
  fecharViva();
  progresso(null);
}

function estaLigado() {
  return ligado;
}

function fecharViva() {
  if (!viva) return;
  try { viva.close(); } catch (_) { /* ja foi embora sozinha */ }
  viva = null;
}

/**
 * Mostra uma das duas falas, uma unica vez por atualizacao.
 *
 * `aoClicar` traz o card de volta: uma notificacao que nao leva a lugar
 * nenhum deixa a pessoa sem saber onde ficam os botoes de reiniciar.
 */
function avisar(chave, versao, aoClicar) {
  if (!ligado || jaDito.has(chave)) return;
  if (!Notification.isSupported()) return;

  const monta = (TEXTOS[idioma] || TEXTOS.pt)[chave];
  if (!monta) return;
  jaDito.add(chave);

  try {
    fecharViva();
    const n = new Notification({ ...monta(versao || ''), silent: false });
    if (typeof aoClicar === 'function') n.on('click', aoClicar);
    n.on('close', () => { if (viva === n) viva = null; });
    n.show();
    viva = n;
  } catch (e) {
    log.warn('[updater] nao consegui notificar o sistema:', e);
  }
}

/**
 * Progresso no botao da barra de tarefas.
 *
 * `fracao` entre 0 e 1 pinta a barra; null a apaga. So vale enquanto as
 * notificacoes estao ligadas: com o card na tela a barra dele ja conta
 * isso, e duas barras para o mesmo download so confundem.
 *
 * Vai na janela PRINCIPAL de proposito. E o botao dela que fica na barra de
 * tarefas enquanto a pessoa trabalha; a janela de atualizacao esta escondida
 * justamente por ter sido minimizada.
 */
function progresso(fracao) {
  const w = state.mainWindow;
  if (!w || w.isDestroyed()) return;
  try {
    if (fracao === null || !ligado) w.setProgressBar(-1);
    else w.setProgressBar(Math.max(0, Math.min(1, fracao)));
  } catch (e) {
    log.warn('[updater] nao consegui pintar a barra de progresso:', e);
  }
}

module.exports = { ativar, desativar, estaLigado, avisar, progresso };
