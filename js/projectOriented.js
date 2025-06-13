const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // PRISM compilation methods
  compileForPRISM: () => ipcRenderer.invoke('prism-compile'),
  
  // SVG generation from module
  generateSVGFromModule: (moduleName, tempDir) => 
    ipcRenderer.invoke('generate-svg-from-module', moduleName, tempDir),
  
  // Get available modules
  getAvailableModules: (tempDir) => 
    ipcRenderer.invoke('get-available-modules', tempDir),
  
  // Listen for compilation complete events
  onCompilationComplete: (callback) => 
    ipcRenderer.on('compilation-complete', (event, data) => callback(data)),
  
  // Remove listeners (cleanup)
  removeAllListeners: (channel) => 
    ipcRenderer.removeAllListeners(channel)
});

// Also expose the electron object for backward compatibility
contextBridge.exposeInMainWorld('electron', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => ipcRenderer.on(channel, callback),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});