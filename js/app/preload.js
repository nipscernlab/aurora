/**
 * preload.js — Electron context bridge para o renderer principal.
 *
 * Este arquivo expõe apenas as APIs IPC que o renderer realmente consome.
 * Funções não utilizadas foram removidas (auditoria automática contra
 * todas as chamadas `electronAPI.X` em js/*.js, html/*.html e index.html).
 *
 * Ao adicionar novas APIs, agrupe pela seção correspondente e mantenha o
 * mapeamento 1:1 com `ipcMain.handle/on` em main.js.
 *
 * Type-checked via `// @ts-check` above. Run `npx tsc --noEmit` (or wait
 * for CI) to validate the IPC surface.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/* ============================================================================
 *  FILE OPERATIONS
 * ========================================================================= */
const fileOperations = {
  readFile:        (p) => ipcRenderer.invoke('read-file', p),
  readFileBuffer:  (p) => ipcRenderer.invoke('read-file-buffer', p),
  writeFile:       (p, content) => ipcRenderer.invoke('write-file', p, content),
  copyFile:        (src, dest) => ipcRenderer.invoke('copy-file', src, dest),

  getFileStats:    (p) => ipcRenderer.invoke('get-file-stats', p),
  getFileSizeLive: (p) => ipcRenderer.invoke('get-file-size-live', p),
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
  // Prism (janela separada) pede pra abrir source via right-click numa
  // cell do SVG. Aqui o renderer principal escuta, le, abre tab e pula
  // pra linha. Sempre callbacks com {filePath, line, column}.
  onOpenFileAt:         (cb) => ipcRenderer.on('aurora:open-file-at', (_, data) => cb(data)),
};

/* ============================================================================
 *  COMPILATION & SIMULATION
 * ========================================================================= */
const compilationOperations = {
  execCommand: (cmd, options = {}) => ipcRenderer.invoke('exec-command', cmd, options),
  execVvpOptimized: (cmd, workingDir, options = {}) =>
    ipcRenderer.invoke('exec-vvp-optimized', cmd, workingDir, options),
  // Streamed vvp run: stdout/stderr chunks arrive live via `vvp-stream`
  // events while the simulation runs (instead of one lump at the end).
  // The caller registers a listener with onVvpStream and the cleanup
  // function it returns must be invoked when the run finishes.
  execVvpStreamed: (vvpBin, vvpFile, extraArgs, workingDir) =>
    ipcRenderer.invoke('exec-vvp-streamed', vvpBin, vvpFile, extraArgs, workingDir),
  onVvpStream: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('vvp-stream', handler);
    return () => ipcRenderer.removeListener('vvp-stream', handler);
  },

  cancelVvpProcess:    () => ipcRenderer.invoke('cancel-vvp-process'),
  isProcessRunning:    (pid) => ipcRenderer.invoke('check-process-running', pid),

  launchGtkwaveOnly: (opts) => ipcRenderer.invoke('launch-gtkwave-only', opts),

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
  selectDirectory:   (opts) => ipcRenderer.invoke('dialog:openDirectory', opts),
  // Forward the caller's options so per-call filters (e.g. .gtkw only)
  // actually reach the main process — without this, the IPC handler
  // falls back to its "All Files" default no matter what the renderer
  // asked for.
  showOpenDialogImport: (opts) => ipcRenderer.invoke('dialog:show-open-import', opts),
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

  // One-shot signal fired by the renderer once Monaco + the UI have
  // finished booting. The splash coordinator (main/windows.js) listens
  // for it to advance the real progress bar to 100% and hand off.
  splashNotifyReady: () => ipcRenderer.send('app:renderer-ready'),
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

  // One-shot at renderer boot: did this launch follow a successful
  // self-update? Main compares the persisted version to app.getVersion()
  // and returns { justUpdated, previousVersion, currentVersion }. The
  // renderer uses it to surface a "you're up to date" toast.
  getPostUpdateStatus: () => ipcRenderer.invoke('updates:post-update-status'),
};

/* ============================================================================
 *  AURORA INTELLIGENCE (chat provider + key management)
 *
 *  Separate contextBridge namespace so the chat surface stays out of
 *  `electronAPI`'s already-large grab bag. Plaintext API keys travel
 *  renderer → main only — there is intentionally no `getKey` channel,
 *  since the keystore lives entirely in the main process and reading
 *  decrypted bytes from the renderer would defeat the whole point.
 * ========================================================================= */
const aiAPI = {
  /** List of supported providers + their default model IDs. */
  listProviders: () => ipcRenderer.invoke('ai:list-providers'),

  /** Snapshot of which providers currently have a key configured. */
  getKeyStatus: () => ipcRenderer.invoke('ai:get-key-status'),

  /** Persist `apiKey` for `provider` (encrypted via OS keychain). */
  setKey: (provider, apiKey) => ipcRenderer.invoke('ai:set-key', { provider, apiKey }),

  /** Remove the stored key for `provider`. Resolves with { ok, removed }. */
  clearKey: (provider) => ipcRenderer.invoke('ai:clear-key', { provider }),

  /**
   * Override the model used for `provider` (empty string clears the
   * override, reverting to the built-in default). Resolves with the
   * effective `{ model }`.
   */
  setModel: (provider, model) => ipcRenderer.invoke('ai:set-model', { provider, model }),

  /**
   * Run a minimal generateText() against the stored key for `provider`
   * (optionally overriding the default model). Returns a structured
   * result — `{ ok, sample, latencyMs, usage }` on success, or
   * `{ ok:false, error }` on any failure.
   */
  testConnection: (provider, modelId) =>
    ipcRenderer.invoke('ai:test-connection', { provider, modelId }),

  /**
   * Kick off a streaming chat. The renderer must subscribe to chat
   * events via `onChatEvent` *before* calling startChat so it doesn't
   * miss early text-delta packets. Returns immediately with the
   * sessionId — the actual streaming work runs detached on main.
   *
   * `conversationId`, `effort` and `permission` are only consumed by
   * the `claude-code` provider (the CLI bridge); API providers ignore
   * them harmlessly.
   */
  startChat: ({ sessionId, conversationId, provider, modelId, messages, system, effort, permission }) =>
    ipcRenderer.invoke('ai:chat-start', {
      sessionId, conversationId, provider, modelId, messages, system, effort, permission,
    }),

  /** Abort an in-flight session. Resolves with `{ ok, stopped: bool }`. */
  abortChat: (sessionId) => ipcRenderer.invoke('ai:chat-abort', { sessionId }),

  /* ---- Claude Code (subscription) bridge ---- */

  /**
   * Probe the local Claude Code CLI: install status, version, whether
   * the user is signed in, and the subscription plan. Resolves with
   * `{ ok, status: { installed, authed, plan, … } }`.
   */
  getClaudeCodeStatus: () => ipcRenderer.invoke('ai:claude-code-status'),

  /**
   * Live subscription usage — accumulated session tokens/cost plus the
   * latest rate-limit windows reported by the CLI. Resolves with
   * `{ ok, usage: { plan, session, windows } }`.
   */
  getClaudeCodeUsage: () => ipcRenderer.invoke('ai:claude-code-usage'),

  /**
   * Subscribe to chat events (text-delta, tool-call, tool-result,
   * finish, aborted, error). Events from *every* session are broadcast
   * — filter by sessionId in your handler. Returns an unsubscribe fn.
   */
  onChatEvent: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on('ai:chat-event', handler);
    return () => ipcRenderer.removeListener('ai:chat-event', handler);
  },

  /* ---- tool execution (renderer runs the AuroraAPI calls) ---- */

  /** The tool manifest — names, descriptions, schemas, access level. */
  getToolManifest: () => ipcRenderer.invoke('ai:get-tool-manifest'),

  /**
   * Subscribe to tool execution requests from main. The handler
   * receives `{ requestId, toolName, args }` and must eventually call
   * `sendToolResult(requestId, ...)`. Returns an unsubscribe fn.
   */
  onToolExec: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on('ai:tool-exec', handler);
    return () => ipcRenderer.removeListener('ai:tool-exec', handler);
  },

  /** Report a tool call's result back to main, settling the SDK loop. */
  sendToolResult: (requestId, result) =>
    ipcRenderer.send('ai:tool-result', { requestId, result }),

  /* ---- conversation history (persistent chats) ---- */

  /** Lightweight metadata for every saved chat, newest first. */
  listConversations: () => ipcRenderer.invoke('ai:conv-list'),

  /** Full document for one chat, including every message. */
  readConversation: (id) => ipcRenderer.invoke('ai:conv-read', { id }),

  /** Upsert a chat. Returns the persisted document. */
  saveConversation: (chat) => ipcRenderer.invoke('ai:conv-save', chat),

  /** Delete a chat permanently. Resolves with `{ ok: bool }`. */
  deleteConversation: (id) => ipcRenderer.invoke('ai:conv-delete', { id }),

  /** Rename a chat. Resolves with `{ ok, chat? }`. */
  renameConversation: (id, title) =>
    ipcRenderer.invoke('ai:conv-rename', { id, title }),

  /** Hand out a fresh, unique conversation id. */
  newConversationId: () => ipcRenderer.invoke('ai:conv-new-id'),
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

contextBridge.exposeInMainWorld('aiAPI', aiAPI);

/* ============================================================================
 *  GLOBAL EVENT FORWARDERS
 *  Re-emite eventos IPC como window.postMessage para componentes legados que
 *  ouvem `message`. Mantido apenas para o terminal-log (único usado).
 * ========================================================================= */
ipcRenderer.on('terminal-log', (_e, terminal, message, type) => {
  window.postMessage({ type: 'terminal-log', terminal, message, logType: type }, '*');
});
