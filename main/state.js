// @ts-check
/**
 * Shared mutable state for the main process.
 *
 * Every module imports the same object reference, so writes here are visible
 * to all handlers. This replaces the top-level `let` variables that used to
 * live at file scope in main.js.
 */

/** @typedef {import('electron').BrowserWindow} BrowserWindow */
/** @typedef {import('child_process').ChildProcess} ChildProcess */
/** @typedef {import('child_process').ChildProcessByStdio<null, import('stream').Readable, import('stream').Readable>} ChildProcessIO */

/**
 * @typedef {object} AppState
 * @property {BrowserWindow | null} mainWindow
 * @property {BrowserWindow | null} splashWindow
 * @property {BrowserWindow | null} updateWindow
 * @property {BrowserWindow | null} prismWindow
 * @property {import('electron').WebContents | null} prismTabContents - O <webview> do PRISM quando ele abre numa aba do editor, para os comandos da AuroraAPI acharem a pagina nos dois modos.
 * @property {boolean} isQuitting
 * @property {boolean} downloadInProgress
 * @property {boolean} updateCheckInProgress
 * @property {boolean} updateAvailable
 * @property {boolean} updateDownloaded
 * @property {unknown} updateInfo - electron-updater's UpdateInfo; opaque here.
 * @property {boolean} updateSystemInitialized
 * @property {string | null} currentOpenProjectPath
 * @property {string | null} fileToOpen
 * @property {ChildProcess | ChildProcessIO | null} currentVvpProcess
 * @property {number | null} vvpProcessPid
 * @property {Set<ChildProcess | ChildProcessIO>} currentGtkwaveProcesses
 * @property {Set<ChildProcess | ChildProcessIO>} childProcesses - Every live toolchain child (compilers, simulators, yosys, gtkwave, cocotb). Tree-killed on window close / quit.
 * @property {Map<string, { id: string, watcher: import('chokidar').FSWatcher, filePath: string, lastCheck: number }>} activeWatchers
 * @property {Map<string, unknown>} fileStatsCache
 * @property {Map<string, { id: string, watcher: import('chokidar').FSWatcher, path: string }>} activeDirectoryWatchers
 * @property {Map<string, unknown>} directoryStatsCache
 */

/** @type {AppState} */
const state = {
  // Windows
  mainWindow: null,
  splashWindow: null,
  updateWindow: null,
  prismWindow: null,
  prismTabContents: null,

  // Updater
  isQuitting: false,
  downloadInProgress: false,
  updateCheckInProgress: false,
  updateAvailable: false,
  // Atualizacao baixada, esperando a saida do aplicativo para se instalar. O
  // encerramento le isto: com update pendente ele NAO pode forcar a saida,
  // porque quem instala e o electron-updater, no caminho normal de quit.
  updateDownloaded: false,
  updateInfo: null,
  updateSystemInitialized: false,

  // Project
  currentOpenProjectPath: null,
  fileToOpen: null,

  // Simulation processes
  currentVvpProcess: null,
  vvpProcessPid: null,
  currentGtkwaveProcesses: new Set(),
  // Central registry of EVERY toolchain child Aurora spawns, so closing the
  // main interface can tree-kill all of them (see main/process_registry.js).
  childProcesses: new Set(),

  // File / directory watchers
  activeWatchers: new Map(),
  fileStatsCache: new Map(),
  activeDirectoryWatchers: new Map(),
  directoryStatsCache: new Map(),
};

module.exports = state;
