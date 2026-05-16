/**
 * Auto-updater wiring for SAPHO.
 *
 * Flow (production only — skipped in dev):
 *   1. ~8 s after the main window appears, silently check GitHub
 *      releases of nipscernlab/sapho.
 *   2. On `update-available`, open the custom update window
 *      (html/update-notification.html) showing the bilingual
 *      changelog and a Download choice — never a native dialog.
 *   3. The user starts the download; `download-progress` drives a
 *      real progress bar in that same window.
 *   4. On `update-downloaded`, the window switches to the
 *      "Restart & Install" state.
 *   5. `quitAndInstall(false, true)` installs and relaunches straight
 *      into the new version.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const state = require('./state');
const { isDev } = require('./paths');
const { createUpdateWindow } = require('./windows');

const REPO_OWNER = 'nipscernlab';
const REPO_NAME = 'sapho';

autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

// Last "available" payload — kept so we can re-send it once the update
// window's renderer has finished loading (the event can fire before the
// window's webContents is ready to receive IPC).
let pendingPayload = null;

/* ============================================================
 *  Helpers
 * ========================================================== */

/** electron-updater's `releaseNotes` may be a string, an array, or null. */
function normalizeNotes(notes) {
  if (!notes) return '';
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === 'string' ? n : n && n.note ? n.note : ''))
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

/**
 * Fallback: pull the release body straight from the GitHub API when
 * electron-updater didn't surface release notes. Resolves to '' on any
 * failure — the update flow must never block on this.
 */
function fetchReleaseNotes(version) {
  return new Promise((resolve) => {
    const tag = String(version).startsWith('v') ? version : `v${version}`;
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${tag}`,
        headers: {
          'User-Agent': 'sapho-updater',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data).body || '');
          } catch (_) {
            resolve('');
          }
        });
      },
    );
    req.on('error', () => resolve(''));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve('');
    });
  });
}

/** Map a raw updater error to a short, human-readable message. */
function friendlyError(error) {
  const msg = (error && error.message) || String(error);
  if (msg.includes('net::') || msg.includes('ENOTFOUND')) {
    return 'Could not reach the update server. Check your internet connection.';
  }
  if (msg.includes('signature')) {
    return 'Update verification failed. Please try again later.';
  }
  if (msg.includes('ENOSPC')) {
    return 'Not enough disk space to download the update.';
  }
  if (msg.includes('EACCES') || msg.includes('EPERM')) {
    return 'Permission denied while installing the update.';
  }
  return msg;
}

/** Send an IPC message to the update window if it is alive. */
function sendToUpdateWindow(channel, payload) {
  const w = state.updateWindow;
  if (w && !w.isDestroyed()) {
    w.webContents.send(channel, payload);
  }
}

/** Open (or focus) the update window and deliver `pendingPayload`. */
function presentUpdateWindow() {
  const win = createUpdateWindow();
  const deliver = () => sendToUpdateWindow('update:state', pendingPayload);
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', deliver);
  } else {
    deliver();
  }
}

/* ============================================================
 *  autoUpdater events
 * ========================================================== */

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
    log.info(`Update available: ${info.version} (current ${app.getVersion()})`);

    let notes = normalizeNotes(info.releaseNotes);
    if (!notes || notes.trim().length < 4) {
      notes = await fetchReleaseNotes(info.version);
    }

    const sizeMB =
      info.files && info.files[0]
        ? (info.files[0].size / 1048576).toFixed(1)
        : '';

    pendingPayload = {
      state: 'available',
      currentVersion: app.getVersion(),
      newVersion: info.version,
      releaseName: info.releaseName || '',
      releaseNotes: notes,
      sizeMB,
    };

    presentUpdateWindow();
  });

  autoUpdater.on('update-not-available', () => {
    state.updateCheckInProgress = false;
    state.updateAvailable = false;
    log.info('No updates available');

    // Only surface "you're up to date" for an explicit, user-driven check.
    const mainWindow = state.mainWindow;
    if (autoUpdater.showNoUpdateDialog && mainWindow && !mainWindow.isDestroyed()) {
      dialog
        .showMessageBox(mainWindow, {
          type: 'info',
          title: 'No Updates Available',
          message: 'SAPHO is up to date',
          detail: `You are running the latest version (${app.getVersion()}).`,
          buttons: ['OK'],
        })
        .catch((e) => log.error('no-update dialog failed:', e));
    }
    autoUpdater.showNoUpdateDialog = false;
  });

  autoUpdater.on('download-progress', (p) => {
    const bps = p.bytesPerSecond || 0;
    sendToUpdateWindow('update:progress', {
      percent: Math.min(100, Math.max(0, p.percent || 0)),
      transferredMB: (p.transferred / 1048576).toFixed(1),
      totalMB: (p.total / 1048576).toFixed(1),
      speedMBs: (bps / 1048576).toFixed(1),
      etaSec: bps > 0 ? (p.total - p.transferred) / bps : null,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    state.downloadInProgress = false;
    log.info(`Update ${info.version} downloaded — ready to install`);
    sendToUpdateWindow('update:state', {
      state: 'downloaded',
      currentVersion: app.getVersion(),
      newVersion: info.version,
    });
  });

  autoUpdater.on('error', (error) => {
    state.updateCheckInProgress = false;
    state.downloadInProgress = false;
    log.error('Update error:', error);
    sendToUpdateWindow('update:error', { message: friendlyError(error) });
  });

  autoUpdater.on('before-quit-for-update', () => {
    log.info('Quitting to install update...');
  });
}

/* ============================================================
 *  Download / check
 * ========================================================== */

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
  autoUpdater.downloadUpdate().catch((error) => {
    state.downloadInProgress = false;
    log.error('Failed to start download:', error);
    sendToUpdateWindow('update:error', { message: friendlyError(error) });
  });
}

/**
 * Manually triggered check. `interactive=true` surfaces the "up to date"
 * dialog when nothing is found; the silent startup check suppresses it.
 */
function checkForUpdates(interactive = false) {
  if (isDev) {
    log.info('Skipping update check — dev mode');
    if (interactive && state.mainWindow && !state.mainWindow.isDestroyed()) {
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
    if (interactive && state.mainWindow && !state.mainWindow.isDestroyed()) {
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

/* ============================================================
 *  Post-update detection
 *
 *  We persist the running version to userData every time the app
 *  boots. On the *next* launch, a mismatch between stored and current
 *  means the user just updated — the renderer reads this status
 *  once at boot and surfaces a confirmation toast. Fresh installs
 *  have no stored version yet, so they never trigger a false
 *  "you've been updated" notification.
 *
 *  `justUpdated` is reported to the first caller and then cleared,
 *  so a second SAPHO window opened later in the same session does
 *  not re-show the toast.
 * ========================================================== */

function versionStorePath() {
  return path.join(app.getPath('userData'), 'aurora-version.json');
}

/** @type {{justUpdated:boolean, previousVersion:string|null, currentVersion:string}|null} */
let postUpdateStatus = null;

function reconcileVersion() {
  const currentVersion = app.getVersion();
  let previousVersion = null;
  try {
    const raw = fs.readFileSync(versionStorePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === 'string' && parsed.version) {
      previousVersion = parsed.version;
    }
  } catch (e) {
    if (e && e.code !== 'ENOENT') log.warn('version store read failed:', e);
  }
  try {
    fs.mkdirSync(path.dirname(versionStorePath()), { recursive: true });
    fs.writeFileSync(
      versionStorePath(),
      JSON.stringify({ version: currentVersion }, null, 2),
    );
  } catch (e) {
    log.warn('version store write failed:', e);
  }
  return {
    justUpdated: !!previousVersion && previousVersion !== currentVersion,
    previousVersion,
    currentVersion,
  };
}

function getPostUpdateStatus() {
  if (postUpdateStatus === null) postUpdateStatus = reconcileVersion();
  // Snapshot the current state, then clear the one-shot flag so a
  // second window opened later in the same session doesn't re-toast.
  const snapshot = { ...postUpdateStatus };
  postUpdateStatus.justUpdated = false;
  return snapshot;
}

/* ============================================================
 *  IPC
 * ========================================================== */

function registerIpc() {
  ipcMain.handle('get-app-version', () => app.getVersion());

  // One-shot: did SAPHO just relaunch into a newer version? The
  // renderer pulls this on boot and, if true, surfaces a toast.
  ipcMain.handle('updates:post-update-status', () => getPostUpdateStatus());

  // Manual "check for updates" affordance (menu / settings / About).
  ipcMain.handle('check-for-updates', () => {
    checkForUpdates(true);
    return { ok: true };
  });

  ipcMain.handle('download-update', () => {
    startUpdateDownload();
    return { ok: true };
  });

  ipcMain.handle('quit-and-install', () => {
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });

  // --- update window (html/update-notification.html) ---

  ipcMain.on('update:download', () => startUpdateDownload());

  ipcMain.on('update:install', () => {
    log.info('User chose to install the update');
    // isSilent=false, isForceRunAfter=true → relaunch into the new version.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });

  ipcMain.on('update:dismiss', () => {
    const w = state.updateWindow;
    if (w && !w.isDestroyed() && !state.downloadInProgress) w.close();
  });
}

/* ============================================================
 *  Init
 * ========================================================== */

function initializeUpdateSystem() {
  if (state.updateSystemInitialized) {
    log.info('Update system already initialized');
    return;
  }
  state.updateSystemInitialized = true;
  log.info('Initializing update system...');

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Set explicitly so checks work even if the packaged app-update.yml
  // ever drifts from package.json#build.publish.
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: REPO_OWNER,
    repo: REPO_NAME,
    releaseType: 'release',
  });

  setupAutoUpdaterEvents();

  // Silent background check a few seconds after the window settles, so
  // the update panel never competes with the splash → main handoff.
  setTimeout(() => {
    if (isDev) {
      log.info('Skipping startup update check — dev mode');
      return;
    }
    log.info('Starting silent startup update check...');
    checkForUpdates(false);
  }, 6000);
}

module.exports = {
  setupAutoUpdaterEvents,
  startUpdateDownload,
  initializeUpdateSystem,
  registerIpc,
  checkForUpdates,
};
