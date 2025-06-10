// Enhanced preload.js functions
const { contextBridge, ipcRenderer } = require('electron');

// Expose PRISM-specific APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Project information
  getPrismProjectInfo: async () => {
    const projectInfo = getProjectInfoFromArgs();
    if (projectInfo) {
      return projectInfo;
    }
    return await ipcRenderer.invoke('get-prism-project-info');
  },

  // SVG generation
  generateModuleSVG: async (moduleName) => {
    return await ipcRenderer.invoke('generate-module-svg', moduleName);
  },

  // Module validation and exploration
  validateModule: async (moduleName) => {
    return await ipcRenderer.invoke('validate-module', moduleName);
  },

  // Get available modules
  getAvailableModules: async (moduleName = null) => {
    return await ipcRenderer.invoke('get-available-modules', moduleName);
  },

  // Window management
  openPrismWindow: () => ipcRenderer.invoke('open-prism-window'),
  
  // Utility functions
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options)
});

function getProjectInfoFromArgs() {
  try {
    const args = process.argv;
    const projectInfoArg = args.find(arg => arg.startsWith('--project-info='));

    if (projectInfoArg) {
      const encodedJson = projectInfoArg.replace('--project-info=', '');
      const decodedJson = decodeURIComponent(encodedJson);
      return JSON.parse(decodedJson);
    }
    return null;
  } catch (error) {
    console.error('Failed to parse project info from arguments:', error);
    return null;
  }
}