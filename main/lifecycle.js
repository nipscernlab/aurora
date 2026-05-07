// @ts-check
/**
 * App-wide lifecycle: single-instance lock, before-quit cleanup, activate
 * + window-all-closed, command-line .spf detection.
 */

const path = require('path');
const fs = require('fs').promises;
const { app, BrowserWindow } = require('electron');
const log = require('electron-log');

const state = require('./state');
const { componentsPath } = require('./paths');
const { killProcessSilently, killProcessesByName } = require('./utils');

function register() {
  // Detect a .spf passed on the command line; the main window will pick it
  // up after did-finish-load.
  state.fileToOpen = process.argv.find((arg) => arg.endsWith('.spf')) ?? null;

  // Single-instance lock — pass any .spf the second instance had to the
  // first, then quit the second instance.
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return false;
  }

  app.on('second-instance', (_event, commandLine) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();

    const spfFile = commandLine.find((arg) => arg.endsWith('.spf'));
    if (spfFile) win.webContents.send('open-spf-file', { filePaths: [spfFile] });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const { createMainWindow } = require('./windows');
      createMainWindow();
    }
  });

  // Comprehensive cleanup runs in parallel with a 5s safety timeout so a
  // hanging cleanup never blocks the app from quitting.
  app.on('before-quit', async () => {
    state.isQuitting = true;

    const cleanupPromises = [];

    // 1. Wipe Temp.
    cleanupPromises.push(
      (async () => {
        try {
          const tempFolderPath = path.join(componentsPath, 'Temp');
          await fs.rm(tempFolderPath, { recursive: true, force: true, maxRetries: 3 });
          await fs.mkdir(tempFolderPath, { recursive: true });
        } catch (error) {
          log.error('Failed to clear Temp folder on app exit:', error);
        }
      })(),
    );

    // 2. Close file watchers.
    cleanupPromises.push(
      (async () => {
        const watcherClosePromises = [];
        for (const [filePath, info] of state.activeWatchers.entries()) {
          watcherClosePromises.push(
            info.watcher
              .close()
              .catch((err) => log.error(`Error closing watcher for ${filePath}:`, err)),
          );
        }
        await Promise.all(watcherClosePromises);
        state.activeWatchers.clear();
        state.fileStatsCache.clear();
      })(),
    );

    // 3. Close directory watchers.
    cleanupPromises.push(
      (async () => {
        const dirWatcherClosePromises = [];
        for (const [directoryPath, info] of state.activeDirectoryWatchers.entries()) {
          dirWatcherClosePromises.push(
            info.watcher
              .close()
              .catch((err) => log.error(`Error closing directory watcher for ${directoryPath}:`, err)),
          );
        }
        await Promise.all(dirWatcherClosePromises);
        state.activeDirectoryWatchers.clear();
        state.directoryStatsCache.clear();
      })(),
    );

    // 4. Kill any leftover VVP/GTKWave processes.
    cleanupPromises.push(
      (async () => {
        const killPromises = [];
        if (state.currentVvpProcess && !state.currentVvpProcess.killed) {
          killPromises.push(killProcessSilently(state.currentVvpProcess.pid));
        }
        killPromises.push(killProcessesByName('vvp.exe'));
        killPromises.push(killProcessesByName('gtkwave.exe'));
        await Promise.all(killPromises);
        state.currentGtkwaveProcesses.clear();
      })(),
    );

    await Promise.race([
      Promise.all(cleanupPromises),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  });

  return true;
}

module.exports = { register };
