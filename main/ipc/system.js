// @ts-check
/**
 * Misc system IPC: components path, path utilities, relaunch.
 */

const path = require('path');
const { app, ipcMain } = require('electron');
const log = require('electron-log');

const { componentsPath, rootPath } = require('../paths');
const { getPythonStatus } = require('../compile/python_locator');

function register() {
  ipcMain.handle('get-components-path', () => componentsPath);
  ipcMain.handle('toolchain:python-status', () => getPythonStatus());

  ipcMain.handle('path-dirname', (_event, p) => {
    if (typeof p !== 'string' || !p) return '';
    return path.dirname(p);
  });

  // Special-case: callers asking for a 'components' path get the install-dir
  // root prepended. Everything else just joins as-is.
  ipcMain.handle('join-path', (_event, ...paths) => {
    if (!paths.every((p) => typeof p === 'string')) {
      throw new TypeError('All arguments to join-path must be strings');
    }
    if (paths[0] === 'components') return path.join(rootPath, ...paths);
    return path.join(...paths);
  });

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
