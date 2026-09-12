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
 * @property {Map<number, import('electron').WebContents>} prismTabContents - O <webview> do PRISM de CADA janela (chave: webContents.id da anfitria), para os comandos da AuroraAPI acharem a pagina nos dois modos sem uma janela roubar a aba da outra.
 * @property {boolean} isQuitting
 * @property {boolean} downloadInProgress
 * @property {boolean} updateCheckInProgress
 * @property {boolean} updateAvailable
 * @property {boolean} updateDownloaded
 * @property {unknown} updateInfo - electron-updater's UpdateInfo; opaque here.
 * @property {boolean} updateSystemInitialized
 * @property {number | null} prismDono - webContents.id da janela principal que abriu o PRISM; ver main/ipc/prism.js.
 * @property {Set<any>} mainWindows - toda janela principal viva; `mainWindow` e so a mais recente. Ver main/main_windows.js.
 * @property {string | null} currentOpenProjectPath
 * @property {Map<number, string>} projectPathsBySender - .spf aberto POR JANELA, chaveado pelo id do webContents. O global acima continua existindo como "o último aberto" para quem não tem janela no contexto (LSP, IA); handlers de IPC usam spfDaJanela(event) em main/ipc/project_paths.js, senão apagar um processador na janela A remove pasta do projeto da janela B.
 * @property {string | null} fileToOpen
 * @property {Set<string>} projectTempDirs - pastas <projeto>/.aurora/Temp usadas por algum spawn nesta sessao; varridas ao cancelar e ao sair.
 * @property {ChildProcess | ChildProcessIO | null} currentVvpProcess
 * @property {number | null} vvpProcessPid
 * @property {Set<ChildProcess | ChildProcessIO>} currentGtkwaveProcesses
 * @property {Set<ChildProcess | ChildProcessIO>} childProcesses - Every live toolchain child (compilers, simulators, yosys, gtkwave, cocotb). Tree-killed on window close / quit.
 * @property {Map<string, { id: string, watcher: import('chokidar').FSWatcher, filePath: string, lastCheck: number, senders: Set<import('electron').WebContents> }>} activeWatchers
 * @property {Map<string, unknown>} fileStatsCache
 * @property {Map<string, { id: string, watcher: import('chokidar').FSWatcher, path: string, senders: Set<import('electron').WebContents> }>} activeDirectoryWatchers
 * @property {Map<string, unknown>} directoryStatsCache
 * @property {Set<string>} grantedWritePaths - Arquivos avulsos que o usuário escolheu por dialogo do main (abrir/salvar/importar) ou associação de arquivo; a escrita neles é permitida mesmo fora do projeto. Ver main/ipc/fs_guard.js.
 * @property {Set<string>} grantedWriteRoots - Pastas escolhidas pelo usuário (local de projeto novo); escrita liberada na subárvore.
 */

/** @type {AppState} */
const state = {
  // Windows
  mainWindow: null,
  splashWindow: null,
  updateWindow: null,
  prismWindow: null,
  prismTabContents: new Map(),

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

  // TODAS as janelas principais vivas. `mainWindow` acima e a mais recente e
  // continua existindo para quem so precisa de "uma janela"; o conjunto e
  // quem sabe responder "qual delas", em main/main_windows.js.
  mainWindows: new Set(),

  // O webContents.id da janela principal que mandou o PRISM abrir. A pagina
  // do PRISM tambem fala com a interface (abrir o fonte de um modulo, abrir
  // a onda da simulacao) e o remetente dela nao e janela principal nenhuma;
  // e por aqui que essas mensagens voltam para quem abriu.
  prismDono: null,

  // Project
  currentOpenProjectPath: null,
  projectPathsBySender: new Map(),
  fileToOpen: null,

  // As pastas <projeto>/.aurora/Temp em que a toolchain rodou nesta sessao.
  // O V<top>.exe do Verilator nasce dentro delas; a varredura que mata
  // orfaos por prefixo de caminho (process_registry) precisa saber onde olhar.
  projectTempDirs: new Set(),

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

  // Concessoes de escrita fora das raizes fixas (fs_guard.js)
  grantedWritePaths: new Set(),
  grantedWriteRoots: new Set(),
};

module.exports = state;
