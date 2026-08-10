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
