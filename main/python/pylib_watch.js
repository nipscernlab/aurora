// @ts-check
/**
 * pylib_watch.js — o vigia das bibliotecas Python instaladas.
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * Instalar e conferir o hash da wheel garante que os BYTES BAIXADOS estavam
 * certos. Nao garante nada sobre o que continua no disco depois. Entre a
 * instalacao e o momento em que o testbench importa a biblioteca, ela pode ter
 * sido mutilada por coisas que nao dependem de nos:
 *
 *   - o Windows Defender pos um arquivo (ou a pasta) em quarentena;
 *   - a limpeza de disco ou o usuario apagou algo;
 *   - o disco corrompeu um setor e o arquivo tem o tamanho certo com o
 *     conteudo errado;
 *   - a extracao parou no meio por falta de espaco.
 *
 * Sem verificacao, o sintoma disso e um ImportError no meio da simulacao, que
 * nao se parece em nada com a causa.
 *
 * QUANDO ELE RODA
 * ---------------
 * Rodar so na abertura do app nao basta: a corrupcao acontece com o app aberto
 * (inclusive durante o proprio download). Entao sao quatro gatilhos:
 *
 *   1. LOGO APOS INSTALAR — o antivirus costuma agir em cima de arquivo
 *      recem-escrito, entao esse e o momento de maior risco. Confere so o que
 *      acabou de ser instalado.
 *   2. PERIODICO — a cada 20 minutos, checagem rapida de tudo. So `stat`, sem
 *      ler conteudo: milhares de arquivos em milissegundos, custo despresivel.
 *   3. AO VOLTAR PARA A JANELA — quando o app recupera o foco depois de um
 *      tempo fora, que e quando uma varredura de antivirus costuma ter passado.
 *   4. ANTES DE SIMULAR — checagem de sentinela (poucos `stat`), no ponto em
 *      que o estrago apareceria de qualquer jeito, so que como erro obscuro.
 *
 * A verificacao FUNDA (le cada arquivo e compara o sha256 do RECORD) nunca roda
 * sozinha: custa I/O de verdade e e o botao de verificacao completa do painel.
 */

'use strict';

const { BrowserWindow, app } = require('electron');
const log = require('electron-log');

const pylibs = require('./pylib_manager');

/** Intervalo da ronda periodica. 20 min: frequente para pegar o estrago no
 *  mesmo dia de trabalho, raro para nunca disputar I/O com uma simulacao. */
const SWEEP_MS = 20 * 60 * 1000;

/** Depois de voltar o foco, so revarre se a ultima checagem ja tiver esta idade. */
const FOCUS_MIN_AGE_MS = 5 * 60 * 1000;

/** @type {NodeJS.Timeout|null} */
let timer = null;
let lastCheck = 0;
/** Resultado mais recente, servido ao painel sem refazer o trabalho. */
let lastResult = null;

/** Manda o veredito para todas as janelas abertas. */
function broadcast(/** @type {any} */ result) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send('pylibs:health', result);
    } catch (_) { /* janela fechando — ignora */ }
  }
}

/**
 * Uma ronda. Nunca lanca: um problema no proprio vigia nao pode derrubar o app
 * nem virar um dialogo no meio do trabalho de alguem.
 * @param {{reason?: string, deep?: boolean, silent?: boolean}} [opts]
 */
function sweep(opts = {}) {
  try {
    const result = pylibs.doctor({ deep: !!opts.deep });
    lastCheck = Date.now();
    lastResult = { ...result, reason: opts.reason || 'sweep' };

    if (!result.ok) {
      log.warn(`[pylibs] verificacao (${opts.reason || 'sweep'}): ${result.issues.length} problema(s)`);
      for (const i of result.issues) log.warn(`[pylibs]   ${i.message}`);
    }
    // O renderer recebe SEMPRE, inclusive quando esta tudo bem: e assim que o
    // painel apaga um aviso antigo depois de um reparo.
    if (!opts.silent) broadcast(lastResult);
    return lastResult;
  } catch (e) {
    log.error('[pylibs] vigia falhou:', e);
    return null;
  }
}

/** O ultimo veredito, ou uma ronda nova se ainda nao houver nenhum. */
function latest() {
  if (!lastResult) return sweep({ reason: 'first', silent: true });
  return lastResult;
}

/**
 * Checagem barata para o caminho de simulacao. Retorna a lista de bibliotecas
 * que parecem quebradas, ou lista vazia. Nao bloqueia nem interrompe nada:
 * quem chama decide o que fazer com a informacao.
 */
function preRunCheck() {
  try {
    const r = pylibs.sentinelCheck();
    if (!r.ok) {
      log.warn(`[pylibs] antes de simular: ${r.broken.join(', ')} parece(m) quebrada(s)`);
      broadcast({ ok: false, reason: 'pre-run', issues: r.broken.map((id) => ({
        kind: 'missing-files', id, message: `${id}: arquivos faltando. Use Reparar.`,
      })) });
    }
    return r;
  } catch (_) {
    return { ok: true, broken: [] };
  }
}

/** Liga o vigia. Idempotente. */
function start() {
  if (timer) return;

  // Reescreve a ligacao do PyLibs com o interpretador, se preciso. Roda aqui
  // porque uma re-instalacao da toolchain apaga o `.pth` junto com o bundle: sem
  // isto, as bibliotecas continuariam no disco e o Python pararia de ve-las, o
  // que apareceria como ImportError sem causa aparente.
  try {
    const r = pylibs.ensureSitePth();
    if (!r.ok && r.reason !== 'nenhuma biblioteca instalada') {
      log.warn(`[pylibs] nao deu para ligar o PyLibs ao interpretador: ${r.reason}`);
    }
  } catch (e) {
    log.error('[pylibs] falha ao ligar o PyLibs:', e);
  }

  // Primeira ronda um pouco depois da abertura, para nao disputar disco com o
  // carregamento da janela.
  setTimeout(() => sweep({ reason: 'startup' }), 8000).unref?.();

  timer = setInterval(() => sweep({ reason: 'periodic' }), SWEEP_MS);
  timer.unref?.(); // nunca segurar o processo vivo por causa do vigia

  // Voltar o foco depois de um tempo fora e o momento em que a varredura do
  // antivirus costuma ter passado.
  app.on('browser-window-focus', () => {
    if (Date.now() - lastCheck > FOCUS_MIN_AGE_MS) sweep({ reason: 'focus' });
  });
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, sweep, latest, preRunCheck, SWEEP_MS };
