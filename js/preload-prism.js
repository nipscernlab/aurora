const { contextBridge, ipcRenderer } = require('electron');

// Expose PRISM-specific APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  getPrismProjectInfo: () => ipcRenderer.invoke('get-prism-project-info'),
  generateModuleSVG: (moduleName) => ipcRenderer.invoke('generate-module-svg', moduleName),
  
  // Add any other APIs you need for PRISM
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
});