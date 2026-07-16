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
  triggerFileTreeRefresh: () => ipcRenderer.invoke('trigger-file-tree-refresh'),

  deleteFile:             (p) => ipcRenderer.invoke('delete-file', p),
  deleteFileOrDirectory:  (p) => ipcRenderer.invoke('file:delete', p),

  // File-tree CRUD (js/tree/standard_tree_crud.js)
  renamePath:  (oldP, newP, opts) => ipcRenderer.invoke('file:rename', oldP, newP, opts),
  trashPath:   (p) => ipcRenderer.invoke('file:trash', p),
  copyAnyPath: (src, dest, opts) => ipcRenderer.invoke('file:copy-any', src, dest, opts),

  pathExists:      (p) => ipcRenderer.invoke('path-exists', p),
  joinPath:        (...parts) => ipcRenderer.invoke('join-path', ...parts),

  // Rendered-HTML preview (js/editor/split_editor.js). previewRegister opens an
  // `aurora-preview://` slot serving the file's own directory and returns
  // {id, url} for the iframe; previewUnregister closes it when the tab does.
  previewRegister:   (p, content) => ipcRenderer.invoke('preview:register', p, content),
  previewUnregister: (id) => ipcRenderer.invoke('preview:unregister', id),
  dirname:         (p) => ipcRenderer.invoke('path-dirname', p),

  openFolder:      (p) => ipcRenderer.invoke('folder:open', p),
  openTerminal:    (p) => ipcRenderer.invoke('shell:open-terminal', p),
  openExternal:    (url) => ipcRenderer.invoke('open-external', url),
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
  onDirectoryWatcherError: (cb) => {
    ipcRenderer.on('directory-watcher-error', (_e, directoryPath, error) => cb(directoryPath, error));
  },
};

/* ============================================================================
 *  PROJECT OPERATIONS
 * ========================================================================= */
const projectOperations = {
  openProject:    (p) => ipcRenderer.invoke('project:open', p),
  closeProject:   () => ipcRenderer.invoke('project:close'),
  renameProject:  (newName) => ipcRenderer.invoke('rename-project', newName),
  createProjectStructure: (projectPath, spfPath) =>
    ipcRenderer.invoke('project:createStructure', projectPath, spfPath),

  getProjectInfo:    (p) => ipcRenderer.invoke('project:getInfo', p),
  getCurrentProject: () => ipcRenderer.invoke('get-current-project'),

  createProcessorProject: (formData) =>
    ipcRenderer.invoke('create-processor-project', formData),
  getAvailableProcessors: (projectPath) =>
    ipcRenderer.invoke('get-available-processors', projectPath),
  deleteProcessor: (name) => ipcRenderer.invoke('delete-processor', name),
  renameProcessor: (oldName, newName) =>
    ipcRenderer.invoke('rename-processor', oldName, newName),

  createBackup: (folderPath) => ipcRenderer.invoke('create-backup', folderPath),
  listRecentProjects: () => ipcRenderer.invoke('list-recent-projects'),

  // Listeners
  onProcessorCreated:   (cb) => ipcRenderer.on('processor:created', (_, data) => cb(data)),
  onProcessorRenamed:   (cb) => ipcRenderer.on('processor:renamed', (_, data) => cb(data)),
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
  // Structured-spec executor. The renderer builds a CommandSpec
  // (js/compilation/command_spec.js + builders/*), the main process
  // validates {binary, args} against the toolchain allowlist and
  // spawns with shell:false. This is the path Aurora Intelligence's
  // command-override system rides on — overrides mutate the spec
  // before it crosses this IPC.
  execSpec: (payload) => ipcRenderer.invoke('exec-spec', payload),
  execSpecStreamed: (payload) => ipcRenderer.invoke('exec-spec-streamed', payload),
  onExecSpecStream: (callback) => {
    const handler = (_event, p) => callback(p);
    ipcRenderer.on('exec-spec-stream', handler);
    return () => ipcRenderer.removeListener('exec-spec-stream', handler);
  },
  listAllowedBinaries: () => ipcRenderer.invoke('exec-spec-allowed-binaries'),
  getProtectedFlags: (step) => ipcRenderer.invoke('exec-spec-protected-flags', step),
  getPythonStatus: () => ipcRenderer.invoke('toolchain:python-status'),

  cancelVvpProcess:    () => ipcRenderer.invoke('cancel-vvp-process'),
  killCurrentSpecProcess: () => ipcRenderer.invoke('kill-current-spec-process'),
  isProcessRunning:    (pid) => ipcRenderer.invoke('check-process-running', pid),

  launchGtkwaveOnly: (opts) => ipcRenderer.invoke('launch-gtkwave-only', opts),
  launchSurfer: (opts) => ipcRenderer.invoke('launch-surfer', opts),
  writeSurferMappings: (mappings) => ipcRenderer.invoke('write-surfer-mappings', mappings),
  decodeComplex: (payload) => ipcRenderer.invoke('decode-complex', payload),
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
  openDesignLab: () => ipcRenderer.invoke('open-design-lab'), // DESIGN §11 component gallery

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

  // Embedded interactive shell (TCMD tab). Human-driven only — NOT wired to the
  // AI tool bridge. start streams `shell:data` / `shell:exit`; input feeds stdin.
  shellStart: (opts) => ipcRenderer.invoke('shell:start', opts || {}),
  shellInput: (id, data) => ipcRenderer.invoke('shell:input', { id, data }),
  shellResize: (id, cols, rows) => ipcRenderer.invoke('shell:resize', { id, cols, rows }),
  shellKill:  (id) => ipcRenderer.invoke('shell:kill', { id }),
  // Push app context (active processor) into the aurora terminal prompt. Cheap,
  // fire-and-forget; the prompt re-reads it on its next render.
  shellSetContext: (ctx) => ipcRenderer.invoke('shell:context', ctx || {}),
  onShellData: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('shell:data', h);
    return () => ipcRenderer.removeListener('shell:data', h);
  },
  onShellExit: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('shell:exit', h);
    return () => ipcRenderer.removeListener('shell:exit', h);
  },
};

const terminalAPI = {};   // (terminalAPI separado mantido para compat futuro)

/* ============================================================================
 *  UPDATER
 * ========================================================================= */
const updateOperations = {
  getComponentsPath: () => ipcRenderer.invoke('get-components-path'),
  getAppVersion:     () => ipcRenderer.invoke('get-app-version'),

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
   * One-shot generation (prompt -> text, no tools/streaming). Resolves with
   * `{ ok, text, usage, model }` or `{ ok:false, error }`. Only API providers
   * (OpenAI/Anthropic/Google/DeepSeek/Groq/Ollama) — not the CLI bridges.
   */
  generateOneshot: ({ provider, model, system, prompt, maxOutputTokens }) =>
    ipcRenderer.invoke('ai:generate-oneshot', { provider, model, system, prompt, maxOutputTokens }),

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

  /* ---- Codex / ChatGPT (subscription) bridge ---- */

  /**
   * Probe the local Codex CLI: install status, version, whether the user
   * is signed in via ChatGPT, and the plan tier. Resolves with
   * `{ ok, status: { installed, authed, plan, … } }`.
   */
  getCodexStatus: () => ipcRenderer.invoke('ai:codex-status'),

  /**
   * Accumulated Codex token usage for this app run. Resolves with
   * `{ ok, usage: { plan, session, windows } }`.
   */
  getCodexUsage: () => ipcRenderer.invoke('ai:codex-usage'),

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

  /**
   * Fire-and-forget signal: a CommandSpec just ran with an override
   * applied. Main appends one entry to aurora-intelligence-log.jsonl
   * so the user has an audit trail of every override the AI fired,
   * not just the moment it was registered.
   */
  auditOverrideApplied: (payload) =>
    ipcRenderer.send('ai:audit-override-applied', payload),

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
 *  SEARCH (find in files) — backed by main/ipc/search.js
 * ========================================================================= */
const searchOperations = {
  /**
   * Project-wide text search. `payload` is
   * { query, caseSensitive?, wholeWord?, regex? }. Resolves with
   * { ok, results, total, truncated } or { ok:false, error }.
   */
  searchInProject: (payload) => ipcRenderer.invoke('search:in-project', payload),
};

/* ============================================================================
 *  VERILOG LSP (window.lspAPI) — backed by main/lsp/verible_lsp.js
 *
 *  Thin bridge to the bundled verible-verilog-ls. The renderer
 *  (js/editor/lsp_integration.js) drives the document lifecycle
 *  (open/change/close) and pulls on-demand features (format, symbols,
 *  hover, definition, references); diagnostics are pushed the other way
 *  via onDiagnostics. Every channel is best-effort — if Verible isn't
 *  installed the main side no-ops and these resolve to null/undefined.
 * ========================================================================= */
const lspOperations = {
  status:    () => ipcRenderer.invoke('lsp:status'),
  didOpen:   (uri, text, languageId) => ipcRenderer.invoke('lsp:did-open', { uri, text, languageId }),
  didChange: (uri, text) => ipcRenderer.invoke('lsp:did-change', { uri, text }),
  didClose:  (uri) => ipcRenderer.invoke('lsp:did-close', { uri }),

  format:          (uri) => ipcRenderer.invoke('lsp:format', { uri }),
  documentSymbols: (uri) => ipcRenderer.invoke('lsp:document-symbols', { uri }),
  hover:           (uri, position) => ipcRenderer.invoke('lsp:hover', { uri, position }),
  definition:      (uri, position) => ipcRenderer.invoke('lsp:definition', { uri, position }),
  references:      (uri, position) => ipcRenderer.invoke('lsp:references', { uri, position }),

  onDiagnostics: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('lsp:diagnostics', handler);
    return () => ipcRenderer.removeListener('lsp:diagnostics', handler);
  },
};

/* ============================================================================
 *  SLANG (window.slangAPI) — backed by main/lsp/slang_lsp.js
 *
 *  SystemVerilog SEMANTIC language server (O11). The renderer
 *  (js/editor/slang_integration.js) drives the document lifecycle and
 *  pulls completion; semantic diagnostics are pushed back via
 *  onDiagnostics. setEnabled toggles the whole feature (it elaborates the
 *  project on every change). Best-effort — no-op when the binary is
 *  missing or the toggle is off. Complements Verible (window.lspAPI).
 * ========================================================================= */
const slangOperations = {
  status:     () => ipcRenderer.invoke('slang:status'),
  setEnabled: (on) => ipcRenderer.invoke('slang:set-enabled', on),
  didOpen:    (uri, text, languageId) => ipcRenderer.invoke('slang:did-open', { uri, text, languageId }),
  didChange:  (uri, text) => ipcRenderer.invoke('slang:did-change', { uri, text }),
  didClose:   (uri) => ipcRenderer.invoke('slang:did-close', { uri }),
  completion: (uri, position) => ipcRenderer.invoke('slang:completion', { uri, position }),

  onDiagnostics: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('slang:diagnostics', handler);
    return () => ipcRenderer.removeListener('slang:diagnostics', handler);
  },
};

/* ============================================================================
 *  CLANG-FORMAT (window.clangFormatAPI) — backed by main/format/clang_format.js
 *
 *  One-shot C/C++/CMM document formatter (Shift+Alt+F). The renderer
 *  (js/editor/clang_format_integration.js) sends the buffer + languageId +
 *  filePath; main pipes it through the bundled clang-format and returns the
 *  formatted text. Best-effort — resolves null if clang-format isn't
 *  installed or errors, leaving the buffer untouched.
 * ========================================================================= */
const clangFormatOperations = {
  status: () => ipcRenderer.invoke('format:clang-status'),
  format: (languageId, filePath, text) =>
    ipcRenderer.invoke('format:clang', { languageId, filePath, text }),
};

/* ============================================================================
 *  TREE-SITTER (window.treeSitterAPI) — backed by main/treesitter/grammars.js
 *
 *  Serves WASM bytes (web-tree-sitter runtime + grammar parsers) to the
 *  renderer's semantic highlighter (js/editor/treesitter_highlight.js),
 *  which feeds them into web-tree-sitter directly — no URL/fetch under the
 *  sandboxed file:// renderer. Best-effort: if a grammar isn't installed,
 *  the editor keeps Monaco's Monarch highlighting.
 * ========================================================================= */
const treeSitterOperations = {
  status: () => ipcRenderer.invoke('treesitter:status'),
  wasm:   (name) => ipcRenderer.invoke('treesitter:wasm', name),
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
/* ============================================================================
 *  GIT / SOURCE CONTROL  (window.gitAPI) — backed by main/ipc/git.js (simple-git)
 *  + main/ipc/github_auth.js (account connection). Enumerated channels only.
 * ========================================================================= */
const gitOperations = {
  isRepo:    (opts) => ipcRenderer.invoke('git:is-repo', opts),
  status:    (opts) => ipcRenderer.invoke('git:status', opts),
  ignored:   (opts) => ipcRenderer.invoke('git:ignored', opts),
  diff:      (opts) => ipcRenderer.invoke('git:diff', opts),
  log:       (opts) => ipcRenderer.invoke('git:log', opts),
  show:      (opts) => ipcRenderer.invoke('git:show', opts),
  commitFiles: (opts) => ipcRenderer.invoke('git:commit-files', opts),
  branches:  (opts) => ipcRenderer.invoke('git:branches', opts),
  remotes:   () => ipcRenderer.invoke('git:remotes'),
  info:      (opts) => ipcRenderer.invoke('git:info', opts),
  addRemote: (opts) => ipcRenderer.invoke('git:add-remote', opts),
  init:      () => ipcRenderer.invoke('git:init'),
  stage:     (files) => ipcRenderer.invoke('git:stage', files),
  stageAll:  () => ipcRenderer.invoke('git:stage-all'),
  unstage:   (files) => ipcRenderer.invoke('git:unstage', files),
  discard:   (files) => ipcRenderer.invoke('git:discard', files),
  commit:    (opts) => ipcRenderer.invoke('git:commit', opts),
  checkout:  (opts) => ipcRenderer.invoke('git:checkout', opts),
  merge:     (opts) => ipcRenderer.invoke('git:merge', opts),
  stash:     (opts) => ipcRenderer.invoke('git:stash', opts),
  stashList: () => ipcRenderer.invoke('git:stash-list'),
  stashPop:  () => ipcRenderer.invoke('git:stash-pop'),
  stashDrop: () => ipcRenderer.invoke('git:stash-drop'),
  undoLastCommit: () => ipcRenderer.invoke('git:undo-last-commit'),
  clone:     (opts) => ipcRenderer.invoke('git:clone', opts),
  onCloneProgress: (cb) => {
    const h = (_e, data) => { try { cb(data); } catch (_) { /* ignore */ } };
    ipcRenderer.on('git:clone-progress', h);
    return () => ipcRenderer.removeListener('git:clone-progress', h);
  },
  scanSpf:   (opts) => ipcRenderer.invoke('git:scan-spf', opts),
  fetch:     () => ipcRenderer.invoke('git:fetch'),
  pull:      () => ipcRenderer.invoke('git:pull'),
  push:      (opts) => ipcRenderer.invoke('git:push', opts),
  listRepos:        () => ipcRenderer.invoke('github:list-repos'),
  githubStatus:     () => ipcRenderer.invoke('github:status'),
  githubConnect:    (token) => ipcRenderer.invoke('github:connect', token),
  githubDisconnect: () => ipcRenderer.invoke('github:disconnect'),
  githubCreateRepo: (opts) => ipcRenderer.invoke('github:create-repo', opts),
  githubOauthConfigured: () => ipcRenderer.invoke('github:oauth-configured'),
  githubOauthLogin: () => ipcRenderer.invoke('github:oauth-login'),
  onGithubOauthCode: (cb) => {
    const h = (_e, data) => { try { cb(data); } catch (_) { /* ignore */ } };
    ipcRenderer.on('github:oauth-code', h);
    return () => ipcRenderer.removeListener('github:oauth-code', h);
  },
};

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
  ...searchOperations,
  ...utilityOperations,
  // Diagnostics: the renderer error boundary forwards uncaught errors here so
  // they land in the persistent electron-log file (one-way, fire-and-forget).
  logRendererError: (payload) => ipcRenderer.send('renderer:error', payload),
});

contextBridge.exposeInMainWorld('terminalAPI', terminalAPI);

contextBridge.exposeInMainWorld('aiAPI', aiAPI);

contextBridge.exposeInMainWorld('gitAPI', gitOperations);

contextBridge.exposeInMainWorld('lspAPI', lspOperations);

contextBridge.exposeInMainWorld('clangFormatAPI', clangFormatOperations);

contextBridge.exposeInMainWorld('slangAPI', slangOperations);

contextBridge.exposeInMainWorld('treeSitterAPI', treeSitterOperations);

/* ============================================================================
 *  GLOBAL EVENT FORWARDERS
 *  Re-emite eventos IPC como window.postMessage para componentes legados que
 *  ouvem `message`. Mantido apenas para o terminal-log (único usado).
 * ========================================================================= */
ipcRenderer.on('terminal-log', (_e, terminal, message, type) => {
  window.postMessage({ type: 'terminal-log', terminal, message, logType: type }, '*');
});
