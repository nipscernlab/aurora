const { contextBridge, ipcRenderer } = require('electron');

// Agrupamento de funções por categoria
const fileOperations = {
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  saveFile: (data) => ipcRenderer.invoke('save-file', data),
  createDirectory: (dirPath) => ipcRenderer.invoke('create-directory', dirPath),
  directoryExists: (dirPath) => ipcRenderer.invoke('directory-exists', dirPath),
  mkdir: (dirPath) => ipcRenderer.invoke('mkdir', dirPath),
  copyFile: (src, dest) => ipcRenderer.invoke('copy-file', src, dest),
  watchFolder: (path) => ipcRenderer.invoke('watchFolder', path),
  getFolderFiles: (folderPath) => ipcRenderer.invoke('getFolderFiles', folderPath),
  isDirectory: (path) => ipcRenderer.invoke('isDirectory', path),
  openExternalLink: (url) => shell.openExternal(url),
  openGitHubDesktop: () => {
      try {
          exec('github-desktop.exe', (error) => {
              if (error) {
                  console.error('Failed to open GitHub Desktop:', error);
                  ipcRenderer.send('show-error-dialog', 'GitHub Desktop', 'Could not launch GitHub Desktop');
              }
          });
      } catch (err) {
          console.error('Error opening GitHub Desktop:', err);
      }
  },
  quitApp: () => ipcRenderer.send('app-quit'),
  
  // Modal and dialog interactions
  showOpenDialog: () => ipcRenderer.invoke('dialog:openFile'),
  showErrorDialog: (title, message) => ipcRenderer.send('show-error-dialog', title, message),
};

const projectOperations = {
  openProject: (spfPath) => ipcRenderer.invoke('project:open', spfPath),
  createProjectStructure: (projectPath, spfPath) => ipcRenderer.invoke('project:createStructure', projectPath, spfPath),
  createProject: (projectPath, spfPath) => ipcRenderer.invoke('project:createStructure', projectPath, spfPath),
  getCurrentProject: () => ipcRenderer.invoke('project:getCurrent'),
  getProjectInfo: (path) => ipcRenderer.invoke('project:getInfo', path),
  createProcessorProject: (formData) => ipcRenderer.invoke('create-processor-project', formData),
  getHardwareFolderPath: (processorName, inputDir) => ipcRenderer.invoke('get-hardware-folder-path', processorName, inputDir),
  saveCompilationResult: (hardwareFolderPath, fileName, content) => ipcRenderer.invoke('save-compilation-result', hardwareFolderPath, fileName, content),
  moveFilesToHardwareFolder: (inputDir, hardwareFolderPath) => ipcRenderer.invoke('move-files-to-hardware-folder', inputDir, hardwareFolderPath),
  readDir: (dirPath) => ipcRenderer.invoke('readDir', dirPath),
  showSaveDialog: () => ipcRenderer.invoke('dialog:showSave'),
  createProcessor: (formData) => ipcRenderer.invoke('create-processor-project', formData),
  onProjectStateChange: (callback) => ipcRenderer.on('project:stateChange', callback),
  onProjectCreated: (callback) => ipcRenderer.on('project:created', callback),
  onProcessorHubStateChange: (callback) => ipcRenderer.on('project:processorHubState', callback),
  onProcessorHubState: (callback) => ipcRenderer.on('project:processorHubState', callback),
  getProjectName: () => ipcRenderer.invoke("getProjectName"),
  createBackup: (folderPath) => ipcRenderer.invoke("create-backup", folderPath),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  joinPath: (...args) => require('path').join(...args),
  deleteFolder: (path) => ipcRenderer.invoke('delete-folder', path),
  onSimulateOpenProject: (callback) => ipcRenderer.on('simulateOpenProject', (_, result) => callback(result)),
  createTclInfoFile: (tclInfoPath, processorType, tempPath, binPath) => ipcRenderer.invoke('createTclInfoFile', tclInfoPath, processorType, tempPath, binPath),
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, data) => callback(data));
  }

};

const dialogOperations = {
  showOpenDialog: () => ipcRenderer.invoke('dialog:showOpen'),
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openFolder: (folderPath) => ipcRenderer.invoke('folder:open', folderPath),
  selectCMMFile: () => ipcRenderer.invoke('select-cmm-file'),
  openWaveDialog: () => ipcRenderer.invoke('open-wave-dialog')
};

const compileOperations = {
  compile: (options) => ipcRenderer.invoke('compile', options),
  execCommand: (command) => ipcRenderer.invoke('exec-command', command),
  runCommand: (command) => ipcRenderer.invoke('run-command', command)
};

const pathOperations = {
  joinPath: (...paths) => ipcRenderer.invoke('join-path', ...paths)
};

// API exposta para o renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // File Operations
  ...fileOperations,
  
  // Project Operations
  ...projectOperations,
  
  // Dialog Operations
  ...dialogOperations,
  
  // Compile Operations
  ...compileOperations,
  
  // Path Operations
  ...pathOperations,
  
  // Store Operations
  getLastFolder: () => ipcRenderer.invoke('get-last-folder'),
  setLastFolder: (path) => ipcRenderer.invoke('set-last-folder', path),
  
  // Refresh Operations
  refreshFolder: (path) => ipcRenderer.invoke('refreshFolder', path),
  refreshFileTree: () => ipcRenderer.send('refresh-file-tree'),
  
  // External Tools
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openExe: () => ipcRenderer.invoke('open-exe'),
  executePowerShell: () => ipcRenderer.invoke('execute-powershell'),
  openGTKWave: (filePath) => ipcRenderer.invoke('open-gtkwave', filePath),
  
  // Config Operations
  saveConfig: (data) => ipcRenderer.send('save-config', data),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  
  // Update Operations 
  /*
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
  onDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
  startDownload: () => ipcRenderer.send('start-download'),
  installUpdate: () => ipcRenderer.send('install-update'),*/
  
  // File Parsing
  parseCMMFile: (filePath) => ipcRenderer.invoke('parse-cmm-file', filePath),
  
  // Event Listeners
  openFromSystem: (spfPath) => ipcRenderer.invoke('project:openFromSystem', spfPath),
  onOpenFromSystem: (callback) => ipcRenderer.on('project:openFromSystem', callback),

  getAppPath: () => ipcRenderer.invoke('getAppPath'), // Expondo o método para o renderer

});
