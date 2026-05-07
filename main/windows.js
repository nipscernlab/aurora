/**
 * Window factories: main, splash, progress.
 *
 * The PRISM window has its own module under ipc/prism.js because it owns a
 * lot of compilation logic.
 */

const path = require('path');
const fs = require('fs').promises;
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const log = require('electron-log');
const state = require('./state');
const { componentsPath } = require('./paths');

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: 'SAPHO',
    // Custom title bar — disable native chrome.
    // `frame: false` removes default frame; `thickFrame: true` keeps thick
    // borders so Aero snap, edge-resize, and animations still work on every
    // Windows version (Win7 → Win11). `titleBarStyle: 'hidden'` is a no-op
    // here but keeps macOS behaviour consistent if app ever runs there.
    frame: false,
    thickFrame: true,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'assets/icons/sapho_aurora_icon.ico'),
    webPreferences: {
      // Renderer must not have direct Node access. The preload script
      // exposes a curated `electronAPI` via contextBridge — that is the
      // only path the renderer can take to reach main-process capabilities.
      // Important defense in depth because `webviewTag: true` lets the AI
      // assistant load https://chatgpt.com inside a sub-frame.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: true,
      preload: path.join(app.getAppPath(), 'js', 'app', 'preload.js'),
      enableWebSQL: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
    backgroundColor: '#0A0D14',
    show: false,
  });

  state.mainWindow = mainWindow;

  mainWindow.loadFile('index.html');

  // Notify renderer of maximize/restore state so the [□] / [❐] icon updates.
  const sendWindowState = () => {
    if (mainWindow.isDestroyed() || !mainWindow.webContents) return;
    try {
      mainWindow.webContents.send('window-state', {
        isMaximized: mainWindow.isMaximized(),
        isFullScreen: mainWindow.isFullScreen(),
      });
    } catch (_) {
      /* no-op */
    }
  };
  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.on('enter-full-screen', sendWindowState);
  mainWindow.on('leave-full-screen', sendWindowState);
  mainWindow.webContents.on('did-finish-load', sendWindowState);

  // If the app was launched with an .spf file argument, ask the renderer to open it.
  mainWindow.webContents.on('did-finish-load', () => {
    if (state.fileToOpen) {
      mainWindow.webContents.send('open-spf-file', { filePaths: [state.fileToOpen] });
    }
  });

  // Register the sapho: protocol and .spf extension on Windows.
  if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient('sapho');
    app.setAppUserModelId(process.execPath);
  }

  mainWindow.on('close', async (_event) => {
    if (state.isQuitting) return;
  });

  // Wipe Temp on quit — handlers in lifecycle.js do the comprehensive cleanup,
  // but this listener is here for completeness when the window itself triggers quit.
  app.on('before-quit', async () => {
    state.isQuitting = true;
    try {
      const tempFolderPath = path.join(componentsPath, 'Temp');
      await fs.rm(tempFolderPath, { recursive: true, force: true });
      await fs.mkdir(tempFolderPath, { recursive: true });
    } catch (error) {
      log.error('Failed to clear Temp folder on app exit:', error);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    setTimeout(() => {
      const updater = require('./updater');
      updater.initializeUpdateSystem();
    }, 2000);
  });

  return mainWindow;
}

function createSplashScreen() {
  const splashWindow = new BrowserWindow({
    width: 560,
    height: 440,
    minWidth: 560,
    minHeight: 440,
    resizable: false,
    icon: path.join(app.getAppPath(), 'assets/icons/sapho_aurora_icon.ico'),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    center: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(app.getAppPath(), 'js', 'app', 'preload.js'),
    },
  });
  state.splashWindow = splashWindow;

  splashWindow.loadFile(path.join(app.getAppPath(), 'html', 'splash.html'));
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    createMainWindow();
  }, 2200);

  return splashWindow;
}

function createProgressWindow() {
  if (state.progressWindow) {
    state.progressWindow.close();
    state.progressWindow = null;
  }

  const progressWindow = new BrowserWindow({
    width: 500,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      preload: path.join(app.getAppPath(), 'js', 'app', 'preload.js'),
    },
  });
  state.progressWindow = progressWindow;

  progressWindow.loadFile(path.join(app.getAppPath(), 'html', 'progress.html'));

  progressWindow.once('ready-to-show', () => {
    progressWindow.show();
    progressWindow.focus();
  });

  progressWindow.on('closed', () => {
    state.progressWindow = null;
  });

  progressWindow.on('close', (event) => {
    if (state.downloadInProgress) {
      event.preventDefault();
      dialog.showMessageBox(progressWindow, {
        type: 'warning',
        title: 'Download in Progress',
        message: 'Please wait for the update download to complete.',
        buttons: ['OK'],
      });
    }
  });

  return progressWindow;
}

// Window controls used by the custom (frameless) title bar.
function registerWindowControls() {
  ipcMain.on('window:minimize', () => {
    const w = state.mainWindow;
    if (w && !w.isDestroyed()) w.minimize();
  });

  ipcMain.on('window:maximize-toggle', () => {
    const w = state.mainWindow;
    if (!w || w.isDestroyed()) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });

  ipcMain.on('window:close', () => {
    const w = state.mainWindow;
    if (w && !w.isDestroyed()) w.close();
  });

  ipcMain.handle('window:get-state', () => {
    const w = state.mainWindow;
    if (!w || w.isDestroyed()) return { isMaximized: false, isFullScreen: false };
    return { isMaximized: w.isMaximized(), isFullScreen: w.isFullScreen() };
  });

  const handleZoom = (factorChange) => {
    const w = state.mainWindow;
    if (!w) return;
    const webContents = w.webContents;
    const currentZoom = webContents.getZoomFactor();
    const newZoom = Math.max(0.5, Math.min(2.0, currentZoom + factorChange));
    webContents.setZoomFactor(newZoom);
  };

  ipcMain.on('zoom-in', () => handleZoom(0.1));
  ipcMain.on('zoom-out', () => handleZoom(-0.1));
  ipcMain.on('zoom-reset', () => {
    const w = state.mainWindow;
    if (w) w.webContents.setZoomFactor(1.0);
  });
}

module.exports = {
  createMainWindow,
  createSplashScreen,
  createProgressWindow,
  registerWindowControls,
};
