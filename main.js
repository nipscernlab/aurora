/**
 * Electron entry point.
 *
 * All real logic lives in main/. This file just wires modules together so
 * the boot order is: lifecycle → IPC handlers → splash → updater (lazy).
 */

const { app } = require('electron');

const lifecycle = require('./main/lifecycle');
const windows = require('./main/windows');
require('./main/updater'); // side effect: configure autoUpdater logger

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

  app.whenReady().then(() => {
    windows.createSplashScreen(); // splash schedules createMainWindow itself
  });
}
