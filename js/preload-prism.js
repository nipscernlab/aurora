const { contextBridge, ipcRenderer } = require('electron');

// Expose PRISM-specific APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
       // Add these new functions to the electronAPI object:
     getPrismProjectInfo: async () => {
         // Primeiro tentar obter dos argumentos
         const projectInfo = getProjectInfoFromArgs();
         if (projectInfo) {
             return projectInfo;
         }
         
         // Se não conseguir, usar IPC
         return await ipcRenderer.invoke('get-prism-project-info');
     },
     
     generateModuleSVG: async (moduleName) => {
         return await ipcRenderer.invoke('generate-module-svg', moduleName);
     },
     openPrismWindow: () => ipcRenderer.invoke('open-prism-window'),
 
 
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

function getProjectInfoFromArgs() {
    try {
        const args = process.argv;
        const projectInfoArg = args.find(arg => arg.startsWith('--project-info='));
        
        if (projectInfoArg) {
            // Decodificar corretamente o URI antes de fazer parse do JSON
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