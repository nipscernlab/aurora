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
    guard(() => pylibs.install(String(id), { onProgress: progressSender(event) })));

  ipcMain.handle('pylibs:uninstall', (_event, id) =>
    guard(async () => pylibs.uninstall(String(id))));

  ipcMain.handle('pylibs:repair', (event, id) =>
    guard(() => pylibs.repair(String(id), { onProgress: progressSender(event) })));

  // Segundo nivel: qualquer biblioteca da PyPI. `resolve` responde se da ou nao
  // ANTES de baixar qualquer coisa.
  ipcMain.handle('pylibs:resolve-external', (_event, name) =>
    guard(() => pylibs.resolveExternal(String(name))));

  ipcMain.handle('pylibs:install-external', (event, name) =>
    guard(() => pylibs.installExternal(String(name), { onProgress: progressSender(event) })));

  ipcMain.handle('pylibs:list-external', () => guard(async () => pylibs.listExternal()));

  ipcMain.handle('pylibs:doctor', () => guard(async () => pylibs.doctor()));

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
