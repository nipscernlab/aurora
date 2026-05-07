/**
 * electron-updater wiring: events, manual triggers, init.
 */

const path = require('path');
const { app, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const state = require('./state');
const { isDev } = require('./paths');
const { createProgressWindow } = require('./windows');

// One-time autoUpdater logger config.
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
log.transports.file.level = 'debug';

function setupAutoUpdaterEvents() {
  if (autoUpdater.listenerCount('checking-for-update') > 0) {
    log.info('Auto-updater events already configured');
    return;
  }

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    state.updateCheckInProgress = true;
  });

  autoUpdater.on('update-available', async (info) => {
    state.updateCheckInProgress = false;
    state.updateAvailable = true;
    state.updateInfo = info;

    log.info(`New version available: ${info.version}, current version: ${app.getVersion()}`);

    const mainWindow = state.mainWindow;
    if (!mainWindow || mainWindow.isDestroyed()) {
      log.error('Main window not available for update dialog');
      return;
    }

    const releaseNotes = info.releaseNotes || 'No release notes available';
    const updateSize =
      info.files && info.files[0] ? `(${(info.files[0].size / 1048576).toFixed(1)} MB)` : '';

    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version is available!`,
        detail: `Current Version: ${app.getVersion()}\nNew Version: ${info.version} ${updateSize}\n\nWould you like to download and install it now?\n\nRelease Notes:\n${typeof releaseNotes === 'string' ? releaseNotes : 'Check GitHub for details'}`,
        buttons: ['Download Now', 'Download Later'],
        defaultId: 0,
        cancelId: 1,
        icon: path.join(app.getAppPath(), 'assets/icons/sapho_aurora_icon.ico'),
      });

      if (response === 0) startUpdateDownload();
      else log.info('User chose to download update later');
    } catch (error) {
      log.error('Error showing update dialog:', error);
    }
  });

  autoUpdater.on('update-not-available', (_info) => {
    state.updateCheckInProgress = false;
    state.updateAvailable = false;
    log.info('No updates available');

    const mainWindow = state.mainWindow;
    if (autoUpdater.showNoUpdateDialog && mainWindow && !mainWindow.isDestroyed()) {
      dialog
        .showMessageBox(mainWindow, {
          type: 'info',
          title: 'No Updates Available',
          message: 'SAPHO is up to date!',
          detail: `You are running the latest version (${app.getVersion()}).`,
          buttons: ['OK'],
          icon: path.join(app.getAppPath(), 'assets/icons/sapho_aurora_icon.ico'),
        })
        .catch((error) => log.error('Error showing no update dialog:', error));
    }
    autoUpdater.showNoUpdateDialog = false;
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    const transferred = (progressObj.transferred / 1048576).toFixed(1);
    const total = (progressObj.total / 1048576).toFixed(1);
    const bytesPerSecond = progressObj.bytesPerSecond || 0;
    const speed = (bytesPerSecond / 1048576).toFixed(1);

    log.info(`Download progress: ${percent}% (${transferred}/${total} MB) at ${speed} MB/s`);

    const w = state.progressWindow;
    if (w && !w.isDestroyed()) {
      w.webContents.send('update-progress', {
        percent,
        transferred,
        total,
        speed: parseFloat(speed),
        bytesPerSecond,
      });
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    state.downloadInProgress = false;
    log.info('Update downloaded successfully');

    if (state.progressWindow && !state.progressWindow.isDestroyed()) {
      state.progressWindow.close();
      state.progressWindow = null;
    }

    const { response } = await dialog.showMessageBox(state.mainWindow, {
      type: 'info',
      title: 'Update Ready to Install',
      message: 'The update has been downloaded successfully!',
      detail: `Version ${info.version} is ready to be installed. SAPHO will restart to complete the installation.`,
      buttons: ['Install Now', 'Install Later'],
      defaultId: 0,
      cancelId: 1,
      icon: path.join(app.getAppPath(), 'assets/icons/sapho_aurora_icon.ico'),
    });

    if (response === 0) {
      log.info('User chose to install update now');
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    } else {
      log.info('User chose to install update later');
    }
  });

  autoUpdater.on('error', async (error) => {
    state.updateCheckInProgress = false;
    state.downloadInProgress = false;

    log.error('Update error:', error);

    if (state.progressWindow && !state.progressWindow.isDestroyed()) {
      state.progressWindow.close();
      state.progressWindow = null;
    }

    let errorMessage = 'An error occurred while checking for updates.';
    if (error.message.includes('net::')) {
      errorMessage = 'Unable to connect to the update server. Please check your internet connection.';
    } else if (error.message.includes('signature')) {
      errorMessage = 'Update verification failed. Please try again later.';
    } else if (error.message.includes('ENOSPC')) {
      errorMessage = 'Not enough disk space to download the update.';
    } else if (error.message.includes('EACCES')) {
      errorMessage = 'Permission denied. Please run as administrator or check file permissions.';
    }

    await dialog.showMessageBox(state.mainWindow, {
      type: 'error',
      title: 'Update Error',
      message: 'Update Failed',
      detail: `${errorMessage}\n\nError details: ${error.message}`,
      buttons: ['OK'],
      icon: path.join(app.getAppPath(), 'assets/icons/sapho_aurora_icon.ico'),
    });
  });

  autoUpdater.on('before-quit-for-update', () => {
    log.info('Application will quit for update installation');
  });
}

function startUpdateDownload() {
  if (state.downloadInProgress) {
    log.info('Download already in progress');
    return;
  }
  if (!state.updateAvailable) {
    log.info('No update available to download');
    return;
  }

  state.downloadInProgress = true;
  log.info('Starting update download...');
  createProgressWindow();

  autoUpdater.downloadUpdate().catch((error) => {
    log.error('Failed to start download:', error);
    state.downloadInProgress = false;
    if (state.progressWindow && !state.progressWindow.isDestroyed()) {
      state.progressWindow.close();
      state.progressWindow = null;
    }
  });
}

/**
 * Manually triggered update check. `interactive=true` shows the
 * "you're up to date" dialog when no update is found; the silent
 * background check on launch suppresses it.
 */
function checkForUpdates(interactive = false) {
  if (isDev) {
    log.info('Skipping update check — running in dev mode');
    if (interactive) {
      dialog.showMessageBox(state.mainWindow, {
        type: 'info',
        title: 'Updates Disabled',
        message: 'Update checks are disabled in development mode.',
        buttons: ['OK'],
      });
    }
    return;
  }
  if (state.updateCheckInProgress) {
    log.info('Update check already in progress');
    return;
  }
  autoUpdater.showNoUpdateDialog = !!interactive;
  autoUpdater.checkForUpdates().catch((err) => {
    state.updateCheckInProgress = false;
    log.error('Failed to start update check:', err);
    if (interactive) {
      dialog.showMessageBox(state.mainWindow, {
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: err.message,
        buttons: ['OK'],
      });
    }
  });
}

function registerIpc() {
  ipcMain.handle('get-app-version', () => app.getVersion());

  // Renderer can request a manual check (e.g. from a "Check for updates"
  // menu item or settings panel). `interactive=true` makes the no-update
  // dialog visible so the user gets visible feedback.
  ipcMain.handle('check-for-updates', () => {
    checkForUpdates(true);
    return { ok: true };
  });

  // Renderer can kick off the download once an update is known to be
  // available (e.g. user clicked "Download" in a custom in-app banner
  // instead of the native dialog).
  ipcMain.handle('download-update', () => {
    startUpdateDownload();
    return { ok: true };
  });

  // Renderer can request an immediate install once the download finished.
  ipcMain.handle('quit-and-install', () => {
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });
}

function initializeUpdateSystem() {
  if (state.updateSystemInitialized) {
    log.info('Update system already initialized');
    return;
  }
  state.updateSystemInitialized = true;
  log.info('Initializing update system...');

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Feed URL is also picked up from package.json#build.publish, but we
  // set it explicitly so the check works even if the packaged app's
  // app-update.yml gets out of sync.
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'nipscernlab',
    repo: 'Aurora',
    releaseType: 'release',
  });

  setupAutoUpdaterEvents();

  // Silent background check 10s after launch (gives the renderer time to
  // settle so the eventual "update available" dialog isn't competing with
  // the splash → main window transition).
  setTimeout(() => {
    if (isDev) {
      log.info('Skipping startup update check — dev mode');
      return;
    }
    if (state.updateCheckInProgress) {
      log.info('Skipping startup update check — already in progress');
      return;
    }
    log.info('Starting silent startup update check...');
    checkForUpdates(false);
  }, 10000);
}

module.exports = {
  setupAutoUpdaterEvents,
  startUpdateDownload,
  initializeUpdateSystem,
  registerIpc,
  checkForUpdates,
};
