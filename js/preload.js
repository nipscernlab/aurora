const { contextBridge, ipcRenderer } = require('electron');

// Grouping functions by category
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

  start: () => ipcRenderer.send('terminal:start'),
  onStarted: (callback) => ipcRenderer.on('terminal:started', callback),
  onData: (callback) => ipcRenderer.on('terminal:data', (_, data) => callback(data)),
  write: (data) => ipcRenderer.send('terminal:input', data),
  resize: (cols, rows) => ipcRenderer.send('terminal:resize', cols, rows),
  clear: () => ipcRenderer.send('terminal:clear'),
  openBrowser: () => ipcRenderer.send('open-browser'),
  openGithubDesktop: () => ipcRenderer.send('open-github-desktop'),
  quitApp: () => ipcRenderer.send('quit-app'),


};

const projectOperations = {
  openProject: (spfPath) => ipcRenderer.invoke('project:open', spfPath),
  createProjectStructure: (projectPath, spfPath) => ipcRenderer.invoke('project:createStructure', projectPath, spfPath),
  createProject: (projectPath, spfPath) => ipcRenderer.invoke('project:createStructure', projectPath, spfPath),
  getCurrentProject: () => ipcRenderer.invoke('get-current-project'),
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
  createTclInfoFile: (filePath, processorType, tempPath, binPath) => ipcRenderer.invoke('create-tcl-info-file', { path: filePath, processorType, tempPath, binPath }),
  deleteTclFile: (filePath) => ipcRenderer.invoke('delete-tcl-file', filePath),
  getAvailableProcessors: (projectPath) => ipcRenderer.invoke('get-available-processors', projectPath),
  deleteProcessor: (processorName) => ipcRenderer.invoke('delete-processor', processorName),
  deleteBackupFolder: (folderPath) => ipcRenderer.invoke('delete-backup-folder', folderPath),

  onProcessorCreated: (callback) => ipcRenderer.on('processor:created', (_, data) => callback(data)),
  onProjectOpen: (callback) => ipcRenderer.on('project:opened', (_, data) => callback(data)),
  onProcessorsUpdated: (callback) => ipcRenderer.on('project:processors', (_, data) => callback(data)),
  saveConfig: (data) => ipcRenderer.send('save-config', data),


  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, data) => callback(data));
  },
  clearTempFolder: () => ipcRenderer.invoke('clear-temp-folder'),

  openPrismWindow: (svgPath) => {
    console.log("Opening PRISM with SVG:", svgPath);
    ipcRenderer.send("open-prism-window", svgPath);
  },
  loadPrismSvg: async (svgPath) => {
    console.log("Requesting SVG:", svgPath);
    return ipcRenderer.invoke("load-svg-file", svgPath);
  },
  createTopLevel: (folderPath) => ipcRenderer.invoke("create-toplevel-folder", folderPath),
};

const dialogOperations = {
  showOpenDialog: () => ipcRenderer.invoke('dialog:showOpen'),
  getBasename: (fullPath) => path.basename(fullPath),
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


// Exposing API to the renderer process
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
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  
  // File Parsing
  parseCMMFile: (filePath) => ipcRenderer.invoke('parse-cmm-file', filePath),
  
  // Event Listeners
  openFromSystem: (spfPath) => ipcRenderer.invoke('project:openFromSystem', spfPath),
  onOpenFromSystem: (callback) => ipcRenderer.on('project:openFromSystem', callback),

  getAppPath: () => ipcRenderer.invoke('getAppPath'),

  scanTopLevelFolder: (projectPath) => ipcRenderer.invoke('scan-toplevel-folder', projectPath),

   // Processor creation event listener
 onProcessorCreated: (callback) => {
  ipcRenderer.on('processor-created', (event, processorName) => callback(event, processorName));
}

});


if (ipcRenderer) {
  contextBridge.exposeInMainWorld('terminalAPI', {
    createTerminal: (terminalId) => ipcRenderer.invoke('create-terminal', terminalId),
    sendCommand: (terminalId, command) => {
      return new Promise((resolve, reject) => {
        try {
          ipcRenderer.send('terminal-command', terminalId, command);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    },
    destroyTerminal: (terminalId) => ipcRenderer.send('destroy-terminal', terminalId),
    onData: (callback) => ipcRenderer.on('terminal-data', callback),
    onError: (callback) => ipcRenderer.on('terminal-error', callback)
  });
} else {
  console.error('ipcRenderer is not available');
}


// Variável global para manter o caminho do projeto atual
let currentProjectPath = null;

// Adicione um listener para atualizar o caminho do projeto atual
ipcRenderer.on('project-opened', (event, projectPath) => {
  currentProjectPath = projectPath;
});

const VERILOG_PATH = path.join(__dirname, 'saphoComponents', 'Packages', 'modules', 'verilog');

contextBridge.exposeInMainWorld('verilogAPI', {
  loadVerilogFile: async (moduleName) => {
    try {
      const filePath = path.join(VERILOG_PATH, `${moduleName}.v`);
      const content = await fs.readFile(filePath, 'utf8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});