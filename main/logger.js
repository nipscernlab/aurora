// @ts-check
/**
 * Central electron-log configuration.
 *
 * electron-log is a singleton: every `require('electron-log')` in the
 * codebase returns the same configured instance, so we only have to set
 * transports / levels / format once here and the whole main process
 * inherits it. This module is required exactly once from main.js at boot
 * to make the configuration deterministic — before that point `log.X(...)`
 * still works, just with the library defaults.
 *
 * Log file location. electron-log derives it from Electron's `app.getName()`,
 * which resolves to package.json `productName` ("SAPHO") — NOT to
 * `build.productName` ("Aurora-IDE"), which only names the installer and the
 * install directory. The two differ, so:
 *   Windows:  %APPDATA%/SAPHO/logs/main.log
 *   macOS:    ~/Library/Logs/SAPHO/main.log
 *   Linux:    ~/.config/SAPHO/logs/main.log
 *
 * (This block used to say Aurora-IDE, which sent bug reporters to a directory
 * that is either empty or holds logs from a build several renames old.)
 *
 * Bug reports: ask the user to attach `main.log` from the path above — or have
 * them click "Open log" in Settings → About, which reveals the real file and
 * cannot go stale.
 */

const log = require('electron-log');
const { isDev } = require('./paths');

function configureLogger() {
  // File transport — always on, used as the source of truth for bug reports.
  // `info` keeps the file useful without flooding it; switch to `debug` when
  // chasing a specific bug, then revert.
  log.transports.file.level = 'info';

  // Cap the file at ~5 MB; electron-log rotates the file when it exceeds
  // this (renames to `main.old.log` and starts a fresh one). Without this
  // a long-running install that hits a noisy code path could fill the disk.
  log.transports.file.maxSize = 5 * 1024 * 1024;

  // Console transport — debug in dev (handy when running `npm start`),
  // warn-and-up in production so we don't spam the user's terminal if they
  // launch the packaged exe from one.
  log.transports.console.level = isDev ? 'debug' : 'warn';

  // Compact format: `[2026-05-07 12:34:56.789] [info]  message`. Default is
  // similar but includes more whitespace; this is easier to grep.
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  log.info('Logger configured (file=' + log.transports.file.level
    + ', console=' + log.transports.console.level + ')');
}

module.exports = { configureLogger };
