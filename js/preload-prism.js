const { contextBridge, ipcRenderer } = require('electron');

console.log('PRISM Preload script loading...');

try {
  // Expose protected methods that allow the renderer process to use
  // the ipcRenderer without exposing the entire object
  contextBridge.exposeInMainWorld('electronAPI', {
    // PRISM compilation methods
    compileForPRISM: () => {
      console.log('compileForPRISM called');
      return ipcRenderer.invoke('prism-compile');
    },
    
    // SVG generation from module
    generateSVGFromModule: (moduleName, tempDir) => {
      console.log('generateSVGFromModule called:', moduleName);
      return ipcRenderer.invoke('generate-svg-from-module', moduleName, tempDir);
    },
    
    // Get available modules
    getAvailableModules: (tempDir) => {
      console.log('getAvailableModules called');
      return ipcRenderer.invoke('get-available-modules', tempDir);
    },
    
    // Listen for compilation complete events
    onCompilationComplete: (callback) => {
      console.log('onCompilationComplete listener registered');
      ipcRenderer.on('compilation-complete', (event, data) => {
        console.log('compilation-complete event received:', data);
        callback(data);
      });
    },
    
    // Send messages to main process
    send: (channel, data) => {
      console.log('send called:', channel, data);
      ipcRenderer.send(channel, data);
    },
    
    // Remove listeners (cleanup)
    removeAllListeners: (channel) => {
      console.log('removeAllListeners called:', channel);
      ipcRenderer.removeAllListeners(channel);
    }
  });

  // Also expose the electron object for backward compatibility
  contextBridge.exposeInMainWorld('electron', {
    invoke: (channel, ...args) => {
      console.log('electron.invoke called:', channel, args);
      return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel, callback) => {
      console.log('electron.on called:', channel);
      ipcRenderer.on(channel, callback);
    },
    send: (channel, data) => {
      console.log('electron.send called:', channel, data);
      ipcRenderer.send(channel, data);
    },
    removeAllListeners: (channel) => {
      console.log('electron.removeAllListeners called:', channel);
      ipcRenderer.removeAllListeners(channel);
    }
  });

  console.log('PRISM Preload script loaded successfully');

} catch (error) {
  console.error('Error in PRISM preload script:', error);
}