'use strict';

/**
 * python_format.js: formatador de Python para o editor Monaco.
 *
 * Os outros idiomas já tinham dono: C, C++ e C± vão para o clang-format
 * empacotado (main/format/clang_format.js, com C± pegando as regras de C), e
 * Verilog vai para o Verible pelo LSP. Python era o único sem ninguém.
 *
 * Aqui não há binário empacotado. Usamos o black do interpretador que o
 * python_locator já descobre para o cocotb, chamando `python -m black -` com o
 * buffer na entrada padrão. Se o black não estiver instalado, dizemos isso ao
 * chamador em vez de falhar em silêncio: quem aperta a varinha merece saber
 * que falta uma dependência, e não que a formatação simplesmente não fez nada.
 *
 * A descoberta do interpretador é cara (roda scripts de sonda), então o
 * caminho fica em cache depois da primeira vez.
 */

const { ipcMain } = require('electron');
const log = require('electron-log');

const { spawnTracked } = require('../process_registry');
const { getPythonStatus, isKnownPythonPath } = require('../compile/python_locator');

// O black é rápido; isto só evita que um travamento patológico prenda a ação
// de formatar do editor.
const FORMAT_TIMEOUT_MS = 15000;

/** @type {string|null} caminho resolvido do interpretador, resolvido uma vez */
let cachedPython = null;

/**
 * Caminho do Python a usar, em cache. Devolve string vazia quando nenhum
 * interpretador utilizável foi encontrado.
 * @returns {Promise<string>}
 */
async function resolvePython() {
  if (cachedPython !== null) return cachedPython;
  try {
    const status = await getPythonStatus();
    cachedPython = status && status.ok && status.pythonPath ? status.pythonPath : '';
  } catch (e) {
    log.warn('[python-format] falha ao localizar o Python:', e instanceof Error ? e.message : e);
    cachedPython = '';
  }
  return cachedPython;
}

/**
 * O black avisa que falta o módulo com esta cara. Distinguir isto de um erro
 * de sintaxe é o que permite dar ao usuário a instrução certa.
 * @param {string} stderr
 */
function faltaOBlack(stderr) {
  return /No module named black/i.test(stderr);
}

/**
 * Formata um buffer de Python.
 *
 * @param {{text?: string}} payload
 * @returns {Promise<{ok: boolean, text?: string, reason?: string}>}
 *   `reason` é 'no-python', 'no-black' ou 'failed', para o chamador escolher a
 *   mensagem sem interpretar texto de erro.
 */
async function format({ text } = {}) {
  if (typeof text !== 'string') return { ok: false, reason: 'failed' };

  const python = await resolvePython();
  if (!python) return { ok: false, reason: 'no-python' };

  // Defesa em profundidade: só rodamos um interpretador que o localizador
  // reconhece, nunca um caminho vindo de fora.
  if (!isKnownPythonPath(python)) {
    log.warn('[python-format] interpretador fora da lista conhecida, ignorando:', python);
    return { ok: false, reason: 'no-python' };
  }

  // `-q` cala o resumo; `-` lê da entrada padrão e escreve na saída padrão.
  const args = ['-m', 'black', '-q', '-'];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnTracked(python, args, { windowsHide: true });
    } catch (e) {
      log.warn('[python-format] falha ao iniciar:', e instanceof Error ? e.message : e);
      resolve({ ok: false, reason: 'failed' });
      return;
    }

    let out = '';
    let errOut = '';
    let settled = false;
    const done = (/** @type {{ok: boolean, text?: string, reason?: string}} */ value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      log.warn('[python-format] tempo esgotado, encerrando');
      try { child.kill(); } catch { /* ignore */ }
      // 'timeout', e nao 'failed': o renderer avisa o usuario neste caso, e
      // calar deixava Shift+Alt+F parecendo que nao fez nada.
      done({ ok: false, reason: 'timeout' });
    }, FORMAT_TIMEOUT_MS);

    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { errOut += d.toString('utf8'); });
    child.on('error', (e) => {
      log.warn('[python-format] erro de processo:', e instanceof Error ? e.message : e);
      done({ ok: false, reason: 'failed' });
    });
    child.on('close', (code) => {
      if (code === 0 && out) { done({ ok: true, text: out }); return; }
      if (faltaOBlack(errOut)) { done({ ok: false, reason: 'no-black' }); return; }
      // Saída diferente de zero aqui costuma ser erro de sintaxe no próprio
      // arquivo; o black recusa formatar o que não consegue analisar.
      if (code !== 0) log.warn(`[python-format] saida ${code}: ${errOut.slice(0, 500)}`);
      done({ ok: false, reason: 'failed' });
    });

    try {
      child.stdin.on('error', () => { /* EPIPE tratado pelo close */ });
      child.stdin.write(text);
      child.stdin.end();
    } catch { /* resolvido por error/close */ }
  });
}

/**
 * O black está disponível? Usado pela varinha para não oferecer uma ação que
 * vai falhar, e pelo painel de bibliotecas para mostrar o estado.
 * @returns {Promise<{installed: boolean, reason?: string}>}
 */
async function status() {
  const r = await format({ text: 'x=1\n' });
  if (r.ok) return { installed: true };
  return { installed: false, reason: r.reason };
}

function register() {
  ipcMain.handle('format:python', (_e, payload) => format(payload));
  ipcMain.handle('format:python-status', () => status());
}

module.exports = { format, status, register };
