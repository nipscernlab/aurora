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

// AppUserModelID must be registered as early as possible — before any
// BrowserWindow exists. Windows uses it to associate the running
// process with a stable jumplist identity, so setting it later (as we
// used to, from inside createMainWindow) meant the taskbar grouping
// was sometimes still bound to electron.exe's embedded "Electron"
// identity and the jumplist updates wouldn't land on the right
// shortcut. Moving the call here, before app.whenReady, fixes that.
if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.nipscern.sapho'); }
  catch (_) { /* setAppUserModelId is best-effort; failure here doesn't block boot */ }
}

const lifecycle = require('./main/lifecycle');
const windows = require('./main/windows');
const updater = require('./main/updater');

const filesIpc = require('./main/ipc/files');
const projectIpc = require('./main/ipc/project');
const compileIpc = require('./main/ipc/compile');
const prismIpc = require('./main/ipc/prism');
const systemIpc = require('./main/ipc/system');
const aiIpc = require('./main/ipc/ai');

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
  aiIpc.register();
  // Updater IPC must be registered at boot, not lazily — the splash window
  // calls `getAppVersion()` before the autoUpdater itself is initialized.
  updater.registerIpc();

  app.whenReady().then(() => {
    // Render the initial jumplist before the user has a chance to
    // right-click the taskbar icon. createMainWindow used to handle
    // this, but moving it here means the list is set even during the
    // splash-screen window (when no main window exists yet) — and the
    // very first taskbar interaction already shows our entries.
    try { windows.rebuildJumpList?.(); }
    catch (_) { /* jumplist is decorative on startup; rebuildJumpList logs internally */ }
    windows.createSplashScreen(); // splash schedules createMainWindow itself
  });
}
