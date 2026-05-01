/**
 * Misc system IPC: components path, system performance, path utilities,
 * relaunch.
 */

const path = require('path');
const os = require('os');
const { app, ipcMain } = require('electron');

const { componentsPath, rootPath } = require('../paths');
const { getCPUCount, getTotalMemory } = require('../utils');

function register() {
  ipcMain.handle('get-components-path', () => componentsPath);

  ipcMain.handle('get-system-performance', () => ({
    cpuCount: getCPUCount(),
    totalMemory: getTotalMemory(),
    freeMemory: Math.floor(os.freemem() / (1024 * 1024 * 1024)),
    loadAverage: os.loadavg(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
  }));

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
}

module.exports = { register };
