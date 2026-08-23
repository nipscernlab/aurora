// @ts-check
/**
 * Misc system IPC: components path, path utilities, relaunch.
 */

const path = require('path');
const { app, ipcMain } = require('electron');
const log = require('electron-log');

const { componentsPath, rootPath } = require('../paths');
const { getPythonStatus } = require('../compile/python_locator');
const { joinAppPath } = require('../utils');

function register() {
  ipcMain.handle('get-components-path', () => componentsPath);

  // A maquina esta na bateria? O powerMonitor responde direto e sem
  // permissao especial; num desktop ele devolve false e o aviso nunca sai.
  // Consultado no INICIO de cada simulacao, e nao vigiado com evento: a
  // pergunta so importa naquele momento, e um vigia permanente seria um
  // processo acordando a toa.
  // A pagina de energia do proprio Windows: e la que o usuario escolhe modo
  // de desempenho e tempos de tela/suspensao. A AURORA leva ate a porta e
  // NAO mexe em nada, porque plano de energia e escolha do dono da maquina.
  ipcMain.handle('system:open-power-settings', async () => {
    try {
      const { shell } = require('electron');
      await shell.openExternal('ms-settings:powersleep');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('system:on-battery', () => {
    try {
      const { powerMonitor } = require('electron');
      return typeof powerMonitor.isOnBatteryPower === 'function'
        ? !!powerMonitor.isOnBatteryPower()
        : false;
    } catch (_e) { return false; }
  });
  ipcMain.handle('toolchain:python-status', () => getPythonStatus());

  ipcMain.handle('path-dirname', (_event, p) => {
    if (typeof p !== 'string' || !p) return '';
    return path.dirname(p);
  });

  // A regra (incluindo o caso especial do 'components') vive em main/utils.js,
  // onde da para prova-la sem subir o Electron.
  ipcMain.handle('join-path', (_event, ...paths) => joinAppPath(rootPath, paths));

  ipcMain.on('app:reload', () => {
    app.relaunch();
    app.exit(0);
  });

  // Renderer error boundary forwards uncaught errors/rejections here so they
  // persist in the main log alongside main-process errors. One-way, defensive.
  ipcMain.on('renderer:error', (_event, payload) => {
    const { kind, message, stack } = payload || {};
    log.error(`[renderer] ${kind || 'error'}: ${message || 'unknown'}`, stack || '');
  });
}

module.exports = { register };
