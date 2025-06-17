// PRELOAD SCRIPT - Fixed preload-prism.js
const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loading...');

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    // PRISM compilation methods
    prismCompile: () => {
      console.log('prismCompile called');
      return ipcRenderer.invoke('prism-compile');
    },
    
    // Fix for the missing openPrismCompile function
    openPrismCompile: () => {
      console.log('openPrismCompile called');
      return ipcRenderer.invoke('open-prism-compile');
    },
    
    // Check if PRISM window is open
    checkPrismWindowOpen: () => {
      console.log('checkPrismWindowOpen called');
      return ipcRenderer.invoke('is-prism-window-open');
    },

    onTerminalLog: (callback) => ipcRenderer.on('terminal-log', callback),
    removeTerminalLog: (callback) => ipcRenderer.removeListener('terminal-log', callback),
    
    // Listen for PRISM window status
    onPrismStatus: (callback) => {
      console.log('onPrismStatus listener registered');
      ipcRenderer.on('prism-status', (event, isOpen) => {
        console.log('prism-status event received:', isOpen);
        callback(isOpen);
      });
      
      // Remove listener cleanup
      return () => {
        ipcRenderer.removeAllListeners('prism-status');
      };
    },

    compileForPRISM: () => ipcRenderer.invoke('prism-compile'),
    
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
      
      // Return cleanup function
      return () => {
        ipcRenderer.removeAllListeners('compilation-complete');
      };
    },
    
    // Listen for toggle UI state requests
    onGetToggleUIState: (callback) => {
      console.log('onGetToggleUIState listener registered');
      ipcRenderer.on('get-toggle-ui-state', (event) => {
        console.log('get-toggle-ui-state request received');
        // Call the callback with a response function
        callback((isActive) => {
          console.log('Sending toggle UI state response:', isActive);
          ipcRenderer.send('toggle-ui-state-response', isActive);
        });
      });
      
      // Return cleanup function
      return () => {
        ipcRenderer.removeAllListeners('get-toggle-ui-state');
      };
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

  // Add to existing IPC handlers
  ipcRenderer.on('terminal-log', (event, terminal, message, type) => {
    window.postMessage({ 
      type: 'terminal-log', 
      terminal, 
      message, 
      logType: type 
    }, '*');
  });

  console.log('Preload script loaded successfully');

} catch (error) {
  console.error('Error in preload script:', error);
}