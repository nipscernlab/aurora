// @ts-check
/**
 * search.js: project-wide "Find in Files" IPC (VS Code's Search panel).
 *
 * A varredura mora em search_core.js e roda num WORKER THREAD, um por busca:
 * ela era sincrona no processo principal, com a regex do usuario direto em
 * `new RegExp`, e um padrao com retrocesso catastrofico (ou um projeto grande
 * demais) congelava todas as janelas ate acabar. No worker o thread principal
 * segue livre, e se a busca passar do prazo o worker e ENCERRADO, que e a
 * unica forma de interromper um RegExp que nao volta. O codigo do worker vai
 * como texto (`eval: true`), pelo motivo explicado em search_worker.js.
 *
 * Channel: ipcMain.handle('search:in-project', (event, payload) => …)
 *   payload: { query, caseSensitive?, wholeWord?, regex? }
 *   resolves: { ok:true, results, total, truncated } | { ok:false, error }
 */

const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');

const { spfDaJanela } = require('./project_paths');
const { buildRegex, escapeRegExp } = require('./search_core');

/** Prazo de uma busca. Folgado para um projeto real; curto para um RegExp que nao volta. */
const PRAZO_MS = 30000;

/**
 * The open project's directory, or null when no project is open. O da JANELA
 * que pediu: contra o global, a busca da janela A varria o projeto da B.
 * @param {any} event
 */
function projectDir(event) {
  const spf = spfDaJanela(event);
  return spf ? path.dirname(spf) : null;
}

/** O codigo do worker: core + corpo, lidos uma vez. */
let codigoDoWorker = '';
function obterCodigoDoWorker() {
  if (!codigoDoWorker) {
    const core = fs.readFileSync(path.join(__dirname, 'search_core.js'), 'utf8');
    const corpo = fs.readFileSync(path.join(__dirname, 'search_worker.js'), 'utf8');
    // O `module.exports` do core nao atrapalha: no worker eval ele existe e
    // e ignorado. As funcoes ficam no mesmo escopo que o corpo usa.
    codigoDoWorker = `${core}\n${corpo}`;
  }
  return codigoDoWorker;
}

/**
 * Roda a busca num worker e devolve o resultado, ou {ok:false} no prazo.
 * @param {string} rootDir
 * @param {any} payload
 * @returns {Promise<any>}
 */
function buscarNoWorker(rootDir, payload) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(obterCodigoDoWorker(), { eval: true, workerData: { rootDir, payload } });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    let terminou = false;
    const fim = (/** @type {any} */ r) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      fim({ ok: false, error: `search timed out after ${Math.round(PRAZO_MS / 1000)}s; try a narrower pattern` });
      worker.terminate().catch(() => {});
    }, PRAZO_MS);
    worker.once('message', (r) => { fim(r); worker.terminate().catch(() => {}); });
    worker.once('error', (e) => fim({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    worker.once('exit', (code) => {
      if (!terminou) fim({ ok: false, error: `search worker exited (code ${code})` });
    });
  });
}

function register() {
  const { ipcMain } = require('electron');

  ipcMain.handle('search:in-project', async (event, payload) => {
    const { query, caseSensitive, wholeWord, regex } = payload || {};
    if (!query || typeof query !== 'string') {
      return { ok: true, results: [], total: 0, truncated: false };
    }

    const rootDir = projectDir(event);
    if (!rootDir || !fs.existsSync(rootDir)) {
      return { ok: false, error: 'No project open' };
    }

    // Padrao invalido e recusado aqui, na hora, sem subir worker: compilar o
    // RegExp e barato; o que custa (e o que o worker isola) e executa-lo.
    try {
      buildRegex(query, { caseSensitive: !!caseSensitive, wholeWord: !!wholeWord, regex: !!regex });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    return buscarNoWorker(rootDir, {
      query, caseSensitive: !!caseSensitive, wholeWord: !!wholeWord, regex: !!regex,
    });
  });
}

// buildRegex e escapeRegExp sao exportados para teste. Eles transformam o que o
// usuario digita na caixa de busca em RegExp, e sao o ponto onde um caractere
// especial vira comportamento inesperado. Ver tests/unit/searchQuery.test.js.
module.exports = { register, buildRegex, escapeRegExp, buscarNoWorker };
