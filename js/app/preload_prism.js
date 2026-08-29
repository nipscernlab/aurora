// PRELOAD SCRIPT, PRISM window
const { contextBridge, ipcRenderer } = require('electron');

try {
  contextBridge.exposeInMainWorld('electronAPI', {

    // Window controls (custom frameless titlebar)
    windowMinimize:        () => ipcRenderer.send('window:minimize'),
    windowMaximizeToggle:  () => ipcRenderer.send('window:maximize-toggle'),
    windowClose:           () => ipcRenderer.send('window:close'),
    onWindowState: (cb) => {
      ipcRenderer.on('prism:window-state', (_e, state) => cb(state));
      return () => ipcRenderer.removeAllListeners('prism:window-state');
    },

    // Reads a file via the main process so the renderer doesn't need
    // `fetch('file://...')` (which would require disabling webSecurity).
    // The main-side `read-file` handler runs the input through safePath().
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),

    joinPath: (...pathSegments) => ipcRenderer.invoke('join-path', pathSegments),

    getPrismCompilationPaths: () => ipcRenderer.invoke('get-prism-compilation-paths'),

    prismCompileWithPaths: (compilationPaths) =>
      ipcRenderer.invoke('prism-compile-with-paths', compilationPaths),

    prismRecompile: (compilationPaths) =>
      ipcRenderer.invoke('prism-recompile', compilationPaths),

    // O circuito interativo (DigitalJS) do modulo que esta NA TELA, e nao do
    // topo do projeto: e o que faz a simulacao caber onde o esquematico cabe.
    buildDigitalJS: (compilationPaths, moduleName) =>
      ipcRenderer.invoke('prism:build-digitaljs', compilationPaths, moduleName),

    onTerminalLog: (callback) => ipcRenderer.on('terminal-log', callback),
    removeTerminalLog: (callback) => ipcRenderer.removeListener('terminal-log', callback),

    // Listen for PRISM window status
    onPrismStatus: (callback) => {
      ipcRenderer.on('prism-status', (_event, isOpen) => callback(isOpen));
      return () => ipcRenderer.removeAllListeners('prism-status');
    },

    // Right-click numa cell do SVG abre o .v na linha exata no editor
    // principal do Aurora. O main faz o encaminhamento + foco da janela.
    openSourceFile: ({ filePath, line, column }) =>
      ipcRenderer.invoke('prism:open-source-file', { filePath, line, column }),

    // SVG generation from module
    generateSVGFromModule: (moduleName, tempDir) =>
      ipcRenderer.invoke('generate-svg-from-module', moduleName, tempDir),

    // Listen for compilation complete events
    onCompilationComplete: (callback) => {
      ipcRenderer.on('compilation-complete', (_event, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('compilation-complete');
    },
    // NOTE: deliberately NO generic `send` / `removeAllListeners` here. Every
    // channel the PRISM window uses has an explicit wrapper above, so the
    // enumerated-channel allowlist stays intact, a generic passthrough would
    // let this renderer reach ANY ipc channel (the escape this preload avoids).
  });

  // Forward terminal-log events to the page as postMessage.
  ipcRenderer.on('terminal-log', (_event, terminal, message, type) => {
    window.postMessage({ type: 'terminal-log', terminal, message, logType: type }, '*');
  });

} catch (error) {
  console.error('Error in preload script:', error);
}
