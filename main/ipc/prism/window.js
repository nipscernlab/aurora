// @ts-check
/**
 * The PRISM BrowserWindow factory. Reuses the existing window if one is
 * open (and re-sends the compilation payload), otherwise creates the
 * frameless viewer, wires its window-state relays, loads prism.html, and
 * pushes prism-status to the main window.
 *
 * Split out of prism.js (2026-06); see ./index.js for the orchestrator.
 */

const path = require('path');
const { app, BrowserWindow, dialog } = require('electron');
const log = require('electron-log');

const state = require('../../state');

/**
 * @typedef {object} PrismCompilationResult
 * @property {boolean} success
 * @property {string} [message]
 * @property {string} [topLevelModule]
 * @property {string} [svgPath]
 * @property {string} [tempDir]
 */

/** @param {PrismCompilationResult | null} [compilationData] */
async function createPrismWindow(compilationData = null) {
  if (state.prismWindow && !state.prismWindow.isDestroyed()) {
    state.prismWindow.focus();
    if (compilationData) {
      if (!state.prismWindow.webContents.isLoading()) {
        state.prismWindow.webContents.send('compilation-complete', compilationData);
      } else {
        state.prismWindow.webContents.once('did-finish-load', () => {
          if (state.prismWindow && !state.prismWindow.isDestroyed()) {
            state.prismWindow.webContents.send('compilation-complete', compilationData);
          }
        });
      }
    }
    return state.prismWindow;
  }

  const preloadPath = path.join(app.getAppPath(), 'js', 'app', 'preload_prism.js');
  if (!require('fs').existsSync(preloadPath)) {
    throw new Error(`Preload script not found: ${preloadPath}`);
  }

  const prismWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'assets', 'icons', 'sapho_aurora_icon.ico'),
    // Frameless — custom titlebar rendered by the PRISM HTML (same
    // approach as the Aurora main window). thickFrame keeps Aero snap
    // and native edge-resize working on Windows.
    frame: false,
    thickFrame: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
    backgroundColor: '#0A0D14',
    show: false,
  });
  state.prismWindow = prismWindow;

  // Relay maximize / unmaximize to the renderer so the [□/⧉] icon updates.
  const sendPrismWindowState = () => {
    if (prismWindow.isDestroyed() || !prismWindow.webContents) return;
    try {
      prismWindow.webContents.send('prism:window-state', {
        isMaximized: prismWindow.isMaximized(),
        isFullScreen: prismWindow.isFullScreen(),
      });
    } catch (_) { /* ignore */ }
  };
  prismWindow.on('maximize',          sendPrismWindowState);
  prismWindow.on('unmaximize',        sendPrismWindowState);
  prismWindow.on('enter-full-screen', sendPrismWindowState);
  prismWindow.on('leave-full-screen', sendPrismWindowState);
  prismWindow.webContents.on('did-finish-load', sendPrismWindowState);

  const prismHtmlPath = path.join(app.getAppPath(), 'html', 'prism', 'prism.html');
  if (!require('fs').existsSync(prismHtmlPath)) {
    if (state.prismWindow) {
      state.prismWindow.destroy();
      state.prismWindow = null;
    }
    throw new Error(`PRISM HTML file not found: ${prismHtmlPath}`);
  }

  try {
    await prismWindow.loadFile(prismHtmlPath);

    prismWindow.maximize();
    prismWindow.show();

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('prism-status', true);
    }

    if (compilationData) {
      // Tiny delay so the renderer has DOM ready before processing the payload.
      setTimeout(() => {
        if (state.prismWindow && !state.prismWindow.isDestroyed()) {
          state.prismWindow.webContents.send('compilation-complete', compilationData);
        }
      }, 1000);
    }
  } catch (error) {
    log.error('Failed to load prism/prism.html:', error);
    await dialog.showMessageBox({
      type: 'error',
      title: 'PRISM Load Error',
      message: 'Failed to load PRISM viewer',
      detail: `Error: ${error instanceof Error ? error.message : String(error)}\nPath: ${prismHtmlPath}`,
    });
    if (state.prismWindow) {
      state.prismWindow.destroy();
      state.prismWindow = null;
    }
    throw error;
  }

  prismWindow.on('closed', () => {
    state.prismWindow = null;
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('prism-status', false);
    }
  });

  prismWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error(`PRISM viewer failed to load (code ${errorCode}): ${errorDescription}`);
    dialog.showMessageBox({
      type: 'error',
      title: 'PRISM Load Failed',
      message: `Failed to load PRISM viewer (Error ${errorCode})`,
      detail: `${errorDescription}\nURL: ${validatedURL}`,
    });
  });

  prismWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('PRISM viewer renderer process crashed:', details);
  });

  return prismWindow;
}

module.exports = { createPrismWindow };
