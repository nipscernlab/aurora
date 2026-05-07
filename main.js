// @ts-check
/**
 * Electron entry point.
 *
 * All real logic lives in main/. This file just wires modules together so
 * the boot order is: lifecycle → IPC handlers (incl. updater IPC) → splash.
 * The autoUpdater itself initializes lazily, ~2 s after the main window
 * shows; only the IPC handlers are registered eagerly here.
 */

const { app } = require('electron');

const { configureLogger } = require('./main/logger');
configureLogger(); // before anything else so all subsequent log calls use it

const lifecycle = require('./main/lifecycle');
const windows = require('./main/windows');
const updater = require('./main/updater');

const filesIpc = require('./main/ipc/files');
const projectIpc = require('./main/ipc/project');
const compileIpc = require('./main/ipc/compile');
const prismIpc = require('./main/ipc/prism');
const systemIpc = require('./main/ipc/system');

// Register lifecycle (single-instance lock, app events, cleanup). If we lost
// the lock, the function returns false after calling app.quit() — bail out so
// we don't keep registering handlers in a dying process.
const acquiredLock = lifecycle.register();
if (acquiredLock) {
  windows.registerWindowControls();
  filesIpc.register();
  projectIpc.register();
  compileIpc.register();
  prismIpc.register();
  systemIpc.register();
  // Updater IPC must be registered at boot, not lazily — the splash window
  // calls `getAppVersion()` before the autoUpdater itself is initialized.
  updater.registerIpc();

  app.whenReady().then(() => {
    windows.createSplashScreen(); // splash schedules createMainWindow itself
  });
}
