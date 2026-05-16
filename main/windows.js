// @ts-check
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
const recents = require('./recents');

/**
 * (Re)build the Windows taskbar jumplist for SAPHO.
 *
 * Layout (top → bottom, as Windows renders it):
 *   - Custom category "Recent Projects" — up to 5 most-recent .spf
 *     files, each launching SAPHO and opening the project.
 *   - Tasks — single "New SAPHO Window" entry that re-launches the app.
 *
 * Two important pieces:
 *
 * 1. We do NOT use the Windows-managed `frequent`/`recent` categories.
 *    Those pull from the shell's recent-documents list, which carries
 *    "Electron" leftovers from earlier dev runs (before AppUserModelID
 *    was nailed down). Owning the list in main keeps the jumplist
 *    clean.
 *
 * 2. In dev (`npm start`), `process.execPath` is `electron.exe` and
 *    just running it produces a blank Electron prompt. So when we're
 *    not packaged we hand the app path through as the first argv to
 *    electron.exe — that's exactly what `electron .` does manually, and
 *    it gets a real SAPHO window. Packaged builds skip the app-path
 *    arg because SAPHO.exe already knows where the bundle lives.
 */
function rebuildJumpList() {
  if (process.platform !== 'win32') return;

  try {
    const exe = process.execPath;
    const iconPath = path.join(app.getAppPath(), 'assets', 'icons', 'sapho_aurora_icon.ico');
    const isPackaged = app.isPackaged;
    const appPath = app.getAppPath();
    // Quoted so spaces in the app path survive Windows arg parsing.
    const baseArgs = isPackaged ? '' : `"${appPath}"`;
    const joinArgs = (...extra) => [baseArgs, ...extra].filter(Boolean).join(' ');

    // Recent projects, pruned to entries that still exist on disk. Max
    // 5 so the jumplist stays scannable on a single glance — Windows
    // would happily render 10 but it pushes "New SAPHO Window" off the
    // visible area.
    const recentSpfs = recents.prune().slice(0, 5);
    const recentItems = recentSpfs.map((spf) => ({
      type: 'task',
      title: path.basename(spf, '.spf'),
      description: spf,
      program: exe,
      args: joinArgs(`"${spf}"`),
      iconPath,
      iconIndex: 0,
    }));

    const categories = [];
    if (recentItems.length > 0) {
      categories.push({
        type: 'custom',
        name: 'Recent Projects',
        items: recentItems,
      });
    }
    categories.push({
      type: 'tasks',
      items: [
        {
          type: 'task',
          title: 'New SAPHO Window',
          description: 'Open a new SAPHO window',
          program: exe,
          args: joinArgs('--new-window'),
          iconPath,
          iconIndex: 0,
        },
      ],
    });

    // setJumpList returns a string status on Windows: 'ok' on success,
    // anything else (e.g. 'invalidSeparatorError', 'fileTypeRegistrationError',
    // 'customCategoryAccessDeniedError') signals which item Windows
    // rejected. Surface that in the log so a future "my jumplist is
    // empty" debugging session lands on the actual reason instead of
    // a silent miss.
    const status = app.setJumpList(categories);
    log.info('jumplist set:', {
      status: status || 'ok',
      isPackaged,
      execPath: exe,
      appPath,
      recentCount: recentItems.length,
      categories: categories.map((c) => ({ type: c.type, name: c.name, items: c.items?.length ?? 0 })),
    });
  } catch (e) {
    log.warn('rebuildJumpList failed:', e);
  }
}

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
  // AppUserModelID + initial jumplist are set in main.js / on
  // app-ready — too early for createMainWindow to be involved.
  if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient('sapho');
    // Rebuild on every window creation in case the recents list
    // changed since the initial render. Cheap; setJumpList is
    // a one-shot system call.
    rebuildJumpList();
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
//
// We support multiple SAPHO windows in the same process (see
// lifecycle.js — `second-instance` creates a new window instead of just
// focusing). So every window-scoped IPC routes to the window that sent
// it (BrowserWindow.fromWebContents), not the singleton `state.mainWindow`
// which only tracks the most recently created window. Without this fix,
// minimizing/closing the second window would have acted on the first.
function registerWindowControls() {
  const senderWin = (event) => {
    try {
      return BrowserWindow.fromWebContents(event.sender);
    } catch (_) {
      return null;
    }
  };

  ipcMain.on('window:minimize', (event) => {
    const w = senderWin(event) || state.mainWindow;
    if (w && !w.isDestroyed()) w.minimize();
  });

  ipcMain.on('window:maximize-toggle', (event) => {
    const w = senderWin(event) || state.mainWindow;
    if (!w || w.isDestroyed()) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });

  ipcMain.on('window:close', (event) => {
    const w = senderWin(event) || state.mainWindow;
    if (w && !w.isDestroyed()) w.close();
  });

  ipcMain.handle('window:get-state', (event) => {
    const w = senderWin(event) || state.mainWindow;
    if (!w || w.isDestroyed()) return { isMaximized: false, isFullScreen: false };
    return { isMaximized: w.isMaximized(), isFullScreen: w.isFullScreen() };
  });

  const handleZoom = (event, factorChange) => {
    const w = senderWin(event) || state.mainWindow;
    if (!w) return;
    const webContents = w.webContents;
    const currentZoom = webContents.getZoomFactor();
    const newZoom = Math.max(0.5, Math.min(2.0, currentZoom + factorChange));
    webContents.setZoomFactor(newZoom);
  };

  ipcMain.on('zoom-in', (event) => handleZoom(event, 0.1));
  ipcMain.on('zoom-out', (event) => handleZoom(event, -0.1));
  ipcMain.on('zoom-reset', (event) => {
    const w = senderWin(event) || state.mainWindow;
    if (w) w.webContents.setZoomFactor(1.0);
  });
}

module.exports = {
  createMainWindow,
  createSplashScreen,
  createProgressWindow,
  registerWindowControls,
  rebuildJumpList,
};
