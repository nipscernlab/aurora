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
  // first, then quit the second instance. Tests run with their own
  // user-data-dir but Electron's lock is per app name, so a test instance
  // would still collide with a real Aurora the developer has open.
  // SAPHO_SKIP_SINGLE_INSTANCE=1 bypasses the lock for that case only.
  const skipLock = process.env.SAPHO_SKIP_SINGLE_INSTANCE === '1';
  const gotTheLock = skipLock ? true : app.requestSingleInstanceLock();
  if (!gotTheLock) {
    // Log loudly to BOTH the electron-log file AND stdout. Otherwise the
    // user just sees `npm start` return immediately with no explanation,
    // which is exactly what bug report #3 was: a leftover SAPHO/electron
    // process held the lock and the new instance vanished silently.
    const msg =
      'SAPHO is already running (single-instance lock held by another process). ' +
      'Close the existing window or kill leftover electron.exe / SAPHO.exe processes ' +
      '(Task Manager) and try again.';
    log.warn(msg);
    process.stderr.write(`[SAPHO] ${msg}\n`);
    app.quit();
    return false;
  }

  app.on('second-instance', (_event, commandLine) => {
    // Each subsequent SAPHO launch opens a NEW window in the same process
    // rather than just focusing the existing one. Users can have several
    // projects side-by-side without launching duplicate Electron processes
    // (which would race on the shared components/Temp folder and on the
    // single-instance lock anyway). Each window owns its own renderer state
    // and its own active editor; main-side resources (watchers, temp dir,
    // cleanup) stay coordinated under a single process lifecycle.
    const { createMainWindow } = require('./windows');
    const newWin = createMainWindow();

    const spfFile = commandLine.find((arg) => arg.endsWith('.spf'));
    if (spfFile && newWin) {
      newWin.webContents.once('did-finish-load', () => {
        newWin.webContents.send('open-spf-file', { filePaths: [spfFile] });
      });
    }
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

  // Cleanup em duas fases serializadas pra evitar EBUSY no rmdir de Temp:
  // file watchers do chokidar (ReadDirectoryChangesW no Windows) e vvp/
  // gtkwave seguram handles em Temp/ — se a fase 2 (rm) rodar antes da
  // fase 1 terminar, o Windows bloqueia o rmdir e a Temp/ acumula lixo
  // de runs anteriores. 5s de safety timeout por fase pra nao travar
  // quit em caso de hang.
  app.on('before-quit', async () => {
    state.isQuitting = true;

    // Fase 1: solta tudo que pode segurar handle em Temp/ — watchers
    // (file + dir) e processos filhos (vvp.exe, gtkwave.exe).
    const releasePromises = [];

    releasePromises.push(
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

    releasePromises.push(
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

    releasePromises.push(
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
      Promise.all(releasePromises),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);

    // Fase 2: agora que ninguem segura mais handle, apaga Temp/.
    try {
      const tempFolderPath = path.join(componentsPath, 'Temp');
      await fs.rm(tempFolderPath, { recursive: true, force: true, maxRetries: 3 });
      await fs.mkdir(tempFolderPath, { recursive: true });
    } catch (error) {
      log.error('Failed to clear Temp folder on app exit:', error);
    }
  });

  return true;
}

module.exports = { register };
