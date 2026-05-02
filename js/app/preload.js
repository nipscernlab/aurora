/**
 * preload.js — Electron context bridge para o renderer principal.
 *
 * Este arquivo expõe apenas as APIs IPC que o renderer realmente consome.
 * Funções não utilizadas foram removidas (auditoria automática contra
 * todas as chamadas `electronAPI.X` em js/*.js, html/*.html e index.html).
 *
 * Ao adicionar novas APIs, agrupe pela seção correspondente e mantenha o
 * mapeamento 1:1 com `ipcMain.handle/on` em main.js.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');

/* ============================================================================
 *  FILE OPERATIONS
 * ========================================================================= */
const fileOperations = {
  readFile:        (p) => ipcRenderer.invoke('read-file', p),
  readFileBuffer:  (p) => ipcRenderer.invoke('read-file-buffer', p),
  writeFile:       (p, content) => ipcRenderer.invoke('write-file', p, content),
  copyFile:        (src, dest) => ipcRenderer.invoke('copy-file', src, dest),

  getFileStats:    (p) => ipcRenderer.invoke('get-file-stats', p),
  fileExists:      (p) => ipcRenderer.invoke('file-exists', p),

  createDirectory: (p) => ipcRenderer.invoke('create-directory', p),
  mkdir:           (p) => ipcRenderer.invoke('mkdir', p),

  getFolderFiles:  (p) => ipcRenderer.invoke('getFolderFiles', p),
  listFilesInDirectory: (p) => ipcRenderer.invoke('list-files-directory', p),
  refreshFolder:   (p) => ipcRenderer.invoke('refreshFolder', p),
  refreshFileTree: () => ipcRenderer.invoke('refresh-file-tree'),
  triggerFileTreeRefresh: () => ipcRenderer.invoke('trigger-file-tree-refresh'),

  deleteFile:             (p) => ipcRenderer.invoke('delete-file', p),
  deleteFileOrDirectory:  (p) => ipcRenderer.invoke('file:delete', p),

  pathExists:      (p) => ipcRenderer.invoke('path-exists', p),
  joinPath:        (...parts) => ipcRenderer.invoke('join-path', ...parts),
  dirname:         (p) => ipcRenderer.invoke('path-dirname', p),

  openFolder:      (p) => ipcRenderer.invoke('folder:open', p),
  openExternal:    (url) => ipcRenderer.invoke('open-external', url),
  showItemInFolder:(p) => ipcRenderer.invoke('shell:show-item', p),

  selectFilesWithPath: (options) => ipcRenderer.invoke('select-files-with-path', options),
};

/* ============================================================================
 *  FILE WATCHING
 * ========================================================================= */
const fileWatchingOperations = {
  watchFile:           (p) => ipcRenderer.invoke('watch-file', p),
  stopWatchingFile:    (id) => ipcRenderer.invoke('stop-watching-file', id),
  watchDirectory:      (p) => ipcRenderer.invoke('watch-directory', p),
  stopWatchingDirectory:(p) => ipcRenderer.invoke('stop-watching-directory', p),

  onFileChanged: (cb) => {
    ipcRenderer.on('file-changed', (_e, filePath) => cb(filePath));
  },
  onFileWatcherError: (cb) => {
    ipcRenderer.on('file-watcher-error', (_e, filePath, error) => cb(filePath, error));
  },
  onDirectoryChanged: (cb) => {
    ipcRenderer.on('directory-changed', (_e, directoryPath, files) => cb(directoryPath, files));
  },
};

/* ============================================================================
 *  PROJECT OPERATIONS
 * ========================================================================= */
const projectOperations = {
  openProject:    (p) => ipcRenderer.invoke('project:open', p),
  closeProject:   () => ipcRenderer.invoke('project:close'),
  createProjectStructure: (projectPath, spfPath) =>
    ipcRenderer.invoke('project:createStructure', projectPath, spfPath),

  getProjectInfo:    (p) => ipcRenderer.invoke('project:getInfo', p),
  getCurrentProject: () => ipcRenderer.invoke('get-current-project'),
  loadConfigFromPath:(p) => ipcRenderer.invoke('load-config-from-path', p),
  saveConfig:        (config) => ipcRenderer.invoke('save-config', config),

  createProcessorProject: (formData) =>
    ipcRenderer.invoke('create-processor-project', formData),
  getAvailableProcessors: (projectPath) =>
    ipcRenderer.invoke('get-available-processors', projectPath),
  deleteProcessor: (name) => ipcRenderer.invoke('delete-processor', name),

  restoreOriginalTestbench: (...args) =>
    ipcRenderer.invoke('restore-original-testbench', ...args),

  createBackup: (folderPath) => ipcRenderer.invoke('create-backup', folderPath),

  // Listeners
  onProjectOpen:        (cb) => ipcRenderer.on('project:opened', (_, data) => cb(data)),
  onProcessorCreated:   (cb) => ipcRenderer.on('processor:created', (_, data) => cb(data)),
  onProcessorHubState:  (cb) => ipcRenderer.on('project:processorHubState', cb),
  onProcessorsUpdated:  (cb) => ipcRenderer.on('project:processors', (_, data) => cb(data)),
  onSimulateOpenProject:(cb) => ipcRenderer.on('open-spf-file', (_, result) => cb(result)),
};

/* ============================================================================
 *  COMPILATION & SIMULATION
 * ========================================================================= */
const compilationOperations = {
  execCommand: (cmd, options = {}) => ipcRenderer.invoke('exec-command', cmd, options),
  execVvpOptimized: (cmd, workingDir, options = {}) =>
    ipcRenderer.invoke('exec-vvp-optimized', cmd, workingDir, options),

  cancelVvpProcess:    () => ipcRenderer.invoke('cancel-vvp-process'),
  isProcessRunning:    (pid) => ipcRenderer.invoke('check-process-running', pid),

  launchGtkwaveOnly:        (opts) => ipcRenderer.invoke('launch-gtkwave-only', opts),
  launchSerialSimulation:   (opts) => ipcRenderer.invoke('launch-serial-simulation', opts),
  launchParallelSimulation: (opts) => ipcRenderer.invoke('launch-parallel-simulation', opts),

  onCommandOutputStream: (cb) => ipcRenderer.on('command-output-stream', cb),
  removeCommandOutputListener: (cb) => ipcRenderer.removeListener('command-output-stream', cb),

  onGtkwaveOutput: (cb) => ipcRenderer.on('gtkwave-output', cb),
  removeGtkwaveOutputListener: (cb) => ipcRenderer.removeListener('gtkwave-output', cb),
};

/* ============================================================================
 *  PRISM
 * ========================================================================= */
const prismOperations = {
  prismCompileWithPaths: (paths) => ipcRenderer.invoke('prism-compile-with-paths', paths),
  prismRecompile:        (paths) => ipcRenderer.invoke('prism-recompile', paths),
  getPrismCompilationPaths: () => ipcRenderer.invoke('get-prism-compilation-paths'),

  generateSVGFromModule: (moduleName, tempDir) =>
    ipcRenderer.invoke('generate-svg-from-module', moduleName, tempDir),

  onCompilationComplete: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('compilation-complete', handler);
    return () => ipcRenderer.removeListener('compilation-complete', handler);
  },
};

/* ============================================================================
 *  DIALOGS
 * ========================================================================= */
const dialogOperations = {
  showOpenDialog:    () => ipcRenderer.invoke('dialog:showOpen'),
  showSaveDialog:    (opts) => ipcRenderer.invoke('show-save-dialog', opts),
  selectDirectory:   () => ipcRenderer.invoke('dialog:openDirectory'),
  showOpenDialogImport: () => ipcRenderer.invoke('dialog:show-open-import'),
};

/* ============================================================================
 *  UI / WINDOW
 * ========================================================================= */
const uiOperations = {
  zoomIn:    () => ipcRenderer.send('zoom-in'),
  zoomOut:   () => ipcRenderer.send('zoom-out'),
  zoomReset: () => ipcRenderer.send('zoom-reset'),
  reloadApp: () => ipcRenderer.send('app:reload'),

  // Custom title bar — frameless window controls
  windowMinimize:       () => ipcRenderer.send('window:minimize'),
  windowMaximizeToggle: () => ipcRenderer.send('window:maximize-toggle'),
  windowClose:          () => ipcRenderer.send('window:close'),
  windowGetState:       () => ipcRenderer.invoke('window:get-state'),
  onWindowState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('window-state', handler);
    return () => ipcRenderer.removeListener('window-state', handler);
  },
};

/* ============================================================================
 *  TERMINAL
 * ========================================================================= */
const terminalOperations = {
  onTerminalLog: (cb) => ipcRenderer.on('terminal-log', cb),
};

const terminalAPI = {};   // (terminalAPI separado mantido para compat futuro)

/* ============================================================================
 *  UPDATER
 * ========================================================================= */
const updateOperations = {
  onUpdateProgress: (cb) => {
    const wrapped = (_e, data) => cb(data);
    ipcRenderer.on('update-progress', wrapped);
    return () => ipcRenderer.removeListener('update-progress', wrapped);
  },
  getComponentsPath: () => ipcRenderer.invoke('get-components-path'),
  getAppVersion:     () => ipcRenderer.invoke('get-app-version'),
  getSystemPerformance: () => ipcRenderer.invoke('get-system-performance'),

  // Manual control for the in-app "Check for updates" affordance. The
  // silent startup check still runs ~10 s after launch — these are for
  // explicit user-driven flows (e.g. settings panel, About dialog).
  checkForUpdates:  () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:   () => ipcRenderer.invoke('download-update'),
  quitAndInstall:   () => ipcRenderer.invoke('quit-and-install'),
};

/* ============================================================================
 *  UTILITIES (inline, sem IPC)
 * ========================================================================= */
const utilityOperations = {
  /**
   * Resolve o filesystem path de um File em drag&drop ou input[type=file].
   * Necessário em Electron 32+ que removeu file.path por padrão.
   */
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file);
      }
      return file?.path || '';
    } catch (err) {
      console.error('getPathForFile failed:', err);
      return '';
    }
  },
};

/* ============================================================================
 *  EXPOSE — bridge para o renderer
 * ========================================================================= */
contextBridge.exposeInMainWorld('electronAPI', {
  ...fileOperations,
  ...fileWatchingOperations,
  ...projectOperations,
  ...compilationOperations,
  ...prismOperations,
  ...dialogOperations,
  ...uiOperations,
  ...terminalOperations,
  ...updateOperations,
  ...utilityOperations,
});

contextBridge.exposeInMainWorld('terminalAPI', terminalAPI);

/* ============================================================================
 *  GLOBAL EVENT FORWARDERS
 *  Re-emite eventos IPC como window.postMessage para componentes legados que
 *  ouvem `message`. Mantido apenas para o terminal-log (único usado).
 * ========================================================================= */
ipcRenderer.on('terminal-log', (_e, terminal, message, type) => {
  window.postMessage({ type: 'terminal-log', terminal, message, logType: type }, '*');
});
