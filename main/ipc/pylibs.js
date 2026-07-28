// @ts-check
/**
 * pylibs.js — IPC do painel de bibliotecas Python.
 *
 * Canais enumerados, um por acao. O progresso volta pelo evento
 * `pylibs:progress`, no mesmo formato que o resto da AURORA ja usa para
 * download longo (ver `git:clone-progress` e o `cli-download` da IA):
 *
 *   { id, phase: 'download'|'verify'|'extract'|'done', pct, detail? }
 *
 * O evento vai para o webContents que PEDIU a operacao, nao em broadcast — duas
 * janelas nao se confundem com o progresso uma da outra.
 */

'use strict';

const { ipcMain, shell } = require('electron');
const log = require('electron-log');

const pylibs = require('../python/pylib_manager');
const watch = require('../python/pylib_watch');

/** Envia progresso de volta para quem pediu, ignorando janela ja fechada. */
function progressSender(/** @type {any} */ event) {
  return (/** @type {any} */ payload) => {
    try {
      if (!event.sender.isDestroyed()) event.sender.send('pylibs:progress', payload);
    } catch (_) { /* janela fechou no meio — nada a fazer */ }
  };
}

/** Normaliza a falha para o renderer: nunca lanca, sempre {ok, error}. */
async function guard(/** @type {() => Promise<any>} */ fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error('[pylibs]', message);
    return { ok: false, error: message };
  }
}

function register() {
  // Estado completo do painel numa chamada so: catalogo + instalado + saude.
  ipcMain.handle('pylibs:state', () => guard(async () => pylibs.getState()));

  ipcMain.handle('pylibs:install', (event, id) =>
    guard(async () => {
      const res = await pylibs.install(String(id), { onProgress: progressSender(event) });
      // Verifica JA, sem esperar a ronda periodica: o antivirus costuma agir
      // sobre arquivo recem-escrito, entao o minuto seguinte a instalacao e
      // quando o estrago tem mais chance de acontecer.
      watch.sweep({ reason: 'post-install' });
      return res;
    }));

  ipcMain.handle('pylibs:uninstall', (_event, id) =>
    guard(async () => pylibs.uninstall(String(id))));

  ipcMain.handle('pylibs:repair', (event, id) =>
    guard(async () => {
      const res = await pylibs.repair(String(id), { onProgress: progressSender(event) });
      watch.sweep({ reason: 'post-repair' });
      return res;
    }));

  // Segundo nivel: qualquer biblioteca da PyPI. `resolve` responde se da ou nao
  // ANTES de baixar qualquer coisa.
  ipcMain.handle('pylibs:resolve-external', (_event, name) =>
    guard(() => pylibs.resolveExternal(String(name))));

  ipcMain.handle('pylibs:install-external', (event, name) =>
    guard(() => pylibs.installExternal(String(name), { onProgress: progressSender(event) })));

  ipcMain.handle('pylibs:list-external', () => guard(async () => pylibs.listExternal()));

  // Diagnostico rapido (so stat) — e o que o painel pede ao abrir.
  ipcMain.handle('pylibs:doctor', () => guard(async () => watch.latest()));

  // Verificacao completa: le cada arquivo e compara o sha256 do RECORD da
  // wheel. Custa I/O, entao e sempre uma acao explicita do usuario.
  ipcMain.handle('pylibs:verify-deep', () => guard(async () => watch.sweep({ reason: 'manual-deep', deep: true })));

  // Abrir a pagina do projeto no navegador do sistema. Restrito a https para o
  // painel nao virar um vetor de abertura de esquema arbitrario.
  ipcMain.handle('pylibs:open-homepage', (_event, url) => guard(async () => {
    const u = String(url || '');
    if (!/^https:\/\//i.test(u)) throw new Error('apenas https');
    await shell.openExternal(u);
    return true;
  }));
}

module.exports = { register };
