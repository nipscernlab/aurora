/**
 * Auto-updater wiring for SAPHO.
 *
 * Flow (production only — skipped in dev):
 *   1. ~6 s after the main window appears, silently check GitHub
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
 *
 * Why the check is scheduled rather than fired once
 * -------------------------------------------------
 * This used to be a single `checkForUpdates` 6 s after boot: one attempt,
 * and any failure was logged and forgotten until the next launch. That is
 * too fragile for the deployment this app is built for — a teaching lab
 * where a fleet of machines is installed once and updated only over the
 * network. Three ordinary situations defeated the single shot:
 *
 *   - the network is not ready 6 s into boot (captive portal, proxy,
 *     roaming Wi-Fi), so the one attempt fails and the session never
 *     sees the update;
 *   - the machine stays open for hours, long past the only check;
 *   - a transient 5xx or DNS blip reads exactly like "no update".
 *
 * So a failed silent check now backs off and retries, and a successful one
 * schedules a periodic re-check. Both are silent: nothing is shown to the
 * user until an update actually exists. `getDiagnostics()` exposes what the
 * schedule has been doing so a failure in the field is diagnosable without
 * physical access to the machine.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const state = require('./state');
const { isDev } = require('./paths');
const { createUpdateWindow } = require('./windows');

const {
  STARTUP_CHECK_DELAY_MS,
  PERIODIC_CHECK_MS,
  nextSilentCheckDelay,
  nextDownloadRetry,
} = require('./update_schedule');

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
 *  Silent-check scheduling state
 * ========================================================== */

/** Pending silent check, if any. Exactly one is ever outstanding. */
let checkTimer = null;
/** Consecutive silent-check failures; indexes SILENT_RETRY_SCHEDULE_MS. */
let silentFailureStreak = 0;
/** True while the in-flight check was started by the scheduler, not the user. */
let silentCheckInFlight = false;
/** Consecutive download failures; indexes DOWNLOAD_RETRY_DELAYS_MS. */
let downloadFailureStreak = 0;
/** Pending download retry, if any. */
let downloadRetryTimer = null;

/**
 * What the update system has been doing. Surfaced over IPC so a machine that
 * is not updating can be diagnosed from the About panel — the alternative is
 * walking to it and reading main.log by hand.
 *
 * @type {{
 *   lastCheckAt: number|null, lastCheckResult: 'available'|'up-to-date'|'error'|null,
 *   lastError: string|null, lastErrorAt: number|null, nextCheckAt: number|null,
 *   checksAttempted: number, consecutiveFailures: number,
 * }}
 */
const diagnostics = {
  lastCheckAt: null,
  lastCheckResult: null,
  lastError: null,
  lastErrorAt: null,
  nextCheckAt: null,
  checksAttempted: 0,
  consecutiveFailures: 0,
};

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

/* ============================================================
 *  Silent-check scheduler
 * ========================================================== */

/** Cancel the pending silent check, if any. */
function clearCheckTimer() {
  if (checkTimer) {
    clearTimeout(checkTimer);
    checkTimer = null;
  }
  diagnostics.nextCheckAt = null;
}

/**
 * Arm the next silent check. Replaces any pending one, so callers never
 * have to reason about overlapping timers.
 *
 * The timer is `unref`'d: a pending update check must never be the reason
 * the process stays alive at quit.
 *
 * @param {number} delayMs
 * @param {string} reason  short label, for the log only
 */
function scheduleSilentCheck(delayMs, reason) {
  clearCheckTimer();
  checkTimer = setTimeout(() => {
    checkTimer = null;
    runSilentCheck();
  }, delayMs);
  if (typeof checkTimer.unref === 'function') checkTimer.unref();
  diagnostics.nextCheckAt = Date.now() + delayMs;
  log.info(
    `Next update check in ${Math.round(delayMs / 1000)}s (${reason})`,
  );
}

/**
 * Run one silent check, unless something more important is already going on.
 *
 * Skipped (and re-armed on the periodic cadence) when an update is already
 * available or downloading — the user is looking at the update window, and a
 * background check would only race it.
 */
function runSilentCheck() {
  if (isDev) return;
  if (state.downloadInProgress || state.updateAvailable) {
    scheduleSilentCheck(PERIODIC_CHECK_MS, 'update already pending');
    return;
  }
  if (state.updateCheckInProgress) {
    // A user-driven check is already running. Don't stack a second one — but
    // DO re-arm, or this silent tick would be the last one ever scheduled and
    // the update system would go quiet for the rest of the session.
    scheduleSilentCheck(PERIODIC_CHECK_MS, 'a check was already running');
    return;
  }
  silentCheckInFlight = true;
  checkForUpdates(false);
}

/**
 * Terminal handler for a silent check. Advances the backoff on failure and
 * returns to the periodic cadence on success.
 *
 * @param {boolean} failed
 */
function onSilentCheckSettled(failed) {
  if (!silentCheckInFlight) return;
  silentCheckInFlight = false;

  if (failed) {
    const delay = nextSilentCheckDelay('failed', silentFailureStreak);
    silentFailureStreak += 1;
    diagnostics.consecutiveFailures = silentFailureStreak;
    scheduleSilentCheck(delay, `retry after failure #${silentFailureStreak}`);
    return;
  }

  silentFailureStreak = 0;
  diagnostics.consecutiveFailures = 0;
  scheduleSilentCheck(nextSilentCheckDelay('ok', 0), 'periodic');
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
    diagnostics.lastCheckAt = Date.now();
    diagnostics.checksAttempted += 1;
  });

  autoUpdater.on('update-available', async (info) => {
    state.updateCheckInProgress = false;
    state.updateAvailable = true;
    state.updateInfo = info;
    diagnostics.lastCheckResult = 'available';
    // An update was found: stop polling. The update window owns the flow now,
    // and re-checking behind it would only race the download.
    silentCheckInFlight = false;
    silentFailureStreak = 0;
    diagnostics.consecutiveFailures = 0;
    clearCheckTimer();
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
    diagnostics.lastCheckResult = 'up-to-date';
    onSilentCheckSettled(false);
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
    // Bytes are moving again — a retry that got this far has recovered, so
    // don't hold its failures against the next hiccup.
    downloadFailureStreak = 0;
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
    // Snapshot before resetting: which phase failed decides how we recover.
    const wasDownloading = state.downloadInProgress;
    state.updateCheckInProgress = false;
    state.downloadInProgress = false;

    diagnostics.lastError = (error && error.message) || String(error);
    diagnostics.lastErrorAt = Date.now();
    log.error('Update error:', error);

    if (wasDownloading) {
      // The user already opted in and bytes were moving; a transient network
      // fault should not cost them the whole download. Retry a couple of
      // times before admitting failure.
      const plan = nextDownloadRetry(downloadFailureStreak);
      if (plan.shouldRetry) {
        downloadFailureStreak += 1;
        log.warn(
          `Download failed (attempt ${plan.attempt}/${plan.ofAttempts}) — retrying in ${plan.delayMs / 1000}s`,
        );
        sendToUpdateWindow('update:retrying', {
          attempt: plan.attempt,
          ofAttempts: plan.ofAttempts,
          inSeconds: Math.round(plan.delayMs / 1000),
        });
        if (downloadRetryTimer) clearTimeout(downloadRetryTimer);
        downloadRetryTimer = setTimeout(() => {
          downloadRetryTimer = null;
          startUpdateDownload({ isRetry: true });
        }, plan.delayMs);
        if (typeof downloadRetryTimer.unref === 'function') downloadRetryTimer.unref();
        return;
      }
      log.error('Download failed after all retries — surfacing to the user');
      downloadFailureStreak = 0;
      sendToUpdateWindow('update:error', { message: friendlyError(error) });
      return;
    }

    diagnostics.lastCheckResult = 'error';
    // A silent check that failed backs off and tries again; a user-driven one
    // is reported by `checkForUpdates`'s own catch, so only tell the update
    // window if it is actually open.
    onSilentCheckSettled(true);
    sendToUpdateWindow('update:error', { message: friendlyError(error) });
  });

  autoUpdater.on('before-quit-for-update', () => {
    log.info('Quitting to install update...');
  });
}

/* ============================================================
 *  Download / check
 * ========================================================== */

/**
 * Begin (or resume) downloading the available update.
 *
 * electron-updater resumes a partial download from its cache, so a retry is
 * not necessarily a restart from zero.
 *
 * @param {{isRetry?: boolean}} [opts]
 */
function startUpdateDownload(opts = {}) {
  if (state.downloadInProgress) {
    log.info('Download already in progress');
    return;
  }
  if (!state.updateAvailable) {
    log.info('No update available to download');
    return;
  }
  // A fresh, user-initiated download starts from a clean retry budget; an
  // automatic retry keeps the streak so the budget can actually run out.
  if (!opts.isRetry) {
    downloadFailureStreak = 0;
    if (downloadRetryTimer) {
      clearTimeout(downloadRetryTimer);
      downloadRetryTimer = null;
    }
  }
  state.downloadInProgress = true;
  log.info(opts.isRetry ? 'Retrying update download...' : 'Starting update download...');
  autoUpdater.downloadUpdate().catch((error) => {
    // `downloadUpdate` rejecting and the 'error' event are two paths out of
    // the SAME failure — electron-updater usually does both. The event
    // handler owns recovery, and it clears `downloadInProgress` as its first
    // act, so a still-set flag here means the event did not fire and this is
    // the only report we will get. Otherwise the failure is already handled
    // and re-emitting would double-count the retry budget.
    if (!state.downloadInProgress) return;
    log.error('Failed to start download:', error);
    autoUpdater.emit('error', error);
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
    diagnostics.lastCheckResult = 'error';
    diagnostics.lastError = (err && err.message) || String(err);
    diagnostics.lastErrorAt = Date.now();
    // A rejection here can arrive WITHOUT the 'error' event (e.g. the feed URL
    // fails to resolve before the updater gets going). `onSilentCheckSettled`
    // is a no-op unless a silent check is actually in flight, and it is what
    // re-arms the schedule — without this call a silent check that failed this
    // way would never be retried.
    onSilentCheckSettled(true);
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

/**
 * A snapshot of what the update system has been doing, for the About panel.
 *
 * The point is remote diagnosis: when a machine in a lab is not updating, the
 * question is always one of "is it even checking?", "what did it check
 * against?", "what was the last error?". Reading that off the screen beats
 * walking to the machine and opening main.log.
 */
function getDiagnostics() {
  let logPath = null;
  try {
    logPath = log.transports.file.getFile().path;
  } catch (_) { /* the log path is a nicety, not a requirement */ }

  return {
    currentVersion: app.getVersion(),
    feed: `${REPO_OWNER}/${REPO_NAME}`,
    isDev,
    // Where the schedule stands right now.
    checking: !!state.updateCheckInProgress,
    downloading: !!state.downloadInProgress,
    updateAvailable: !!state.updateAvailable,
    lastCheckAt: diagnostics.lastCheckAt,
    lastCheckResult: diagnostics.lastCheckResult,
    lastError: diagnostics.lastError,
    lastErrorAt: diagnostics.lastErrorAt,
    nextCheckAt: diagnostics.nextCheckAt,
    checksAttempted: diagnostics.checksAttempted,
    consecutiveFailures: diagnostics.consecutiveFailures,
    logPath,
  };
}

function registerIpc() {
  ipcMain.handle('get-app-version', () => app.getVersion());

  // Update-system health, for the About panel. Read-only.
  ipcMain.handle('updates:diagnostics', () => getDiagnostics());

  // Reveal main.log in the file manager so a user can attach it to a report
  // without being told where Electron hides userData.
  ipcMain.handle('updates:open-log', () => {
    try {
      const p = log.transports.file.getFile().path;
      shell.showItemInFolder(p);
      return { ok: true, path: p };
    } catch (e) {
      log.warn('could not reveal the log file:', e);
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

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

  if (isDev) {
    log.info('Skipping update scheduling — dev mode');
    return;
  }

  // First silent check a few seconds after the window settles, so the update
  // panel never competes with the splash → main handoff. From there the
  // schedule is self-sustaining: every outcome arms the next check (periodic
  // on success, backoff on failure), so there is no path where the app stops
  // looking for updates while it is running.
  scheduleSilentCheck(STARTUP_CHECK_DELAY_MS, 'startup');
}

module.exports = {
  setupAutoUpdaterEvents,
  startUpdateDownload,
  initializeUpdateSystem,
  registerIpc,
  checkForUpdates,
  getDiagnostics,
};
