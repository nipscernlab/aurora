const { contextBridge, ipcRenderer } = require('electron');

// Expose PRISM-specific APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  getPrismProjectInfo: () => ipcRenderer.invoke('get-prism-project-info'),
  generateModuleSVG: (moduleName) => ipcRenderer.invoke('generate-module-svg', moduleName),
  openPrismWindow: () => ipcRenderer.invoke('open-prism-window'),
  // Add any other APIs you need for PRISM
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
    getPrismProjectInfo: () => {
    // First try to get from arguments, then fallback to IPC
    const projectInfo = getProjectInfoFromArgs();
    if (projectInfo) {
      return Promise.resolve(projectInfo);
    }
    return ipcRenderer.invoke('get-prism-project-info');
  },
  generateModuleSVG: (moduleName) => ipcRenderer.invoke('generate-module-svg', moduleName),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  
});

const getProjectInfoFromArgs = () => {
  const args = process.argv;
  const projectInfoArg = args.find(arg => arg.startsWith('--project-info='));
  if (projectInfoArg) {
    try {
      return JSON.parse(projectInfoArg.replace('--project-info=', ''));
    } catch (error) {
      console.error('Failed to parse project info from arguments:', error);
    }
  }
  return null;
};