/**
 * Shared mutable state for the main process.
 *
 * Every module imports the same object reference, so writes here are visible
 * to all handlers. This replaces the top-level `let` variables that used to
 * live at file scope in main.js.
 */

module.exports = {
  // Windows
  mainWindow: null,
  splashWindow: null,
  progressWindow: null,
  prismWindow: null,

  // Updater
  isQuitting: false,
  downloadInProgress: false,
  updateCheckInProgress: false,
  updateAvailable: false,
  updateInfo: null,
  updateSystemInitialized: false,

  // Project
  currentOpenProjectPath: null,
  fileToOpen: null,

  // Simulation processes
  currentVvpProcess: null,
  vvpProcessPid: null,
  currentGtkwaveProcesses: new Set(),

  // File / directory watchers
  activeWatchers: new Map(),
  fileStatsCache: new Map(),
  activeDirectoryWatchers: new Map(),
  directoryStatsCache: new Map(),
};
