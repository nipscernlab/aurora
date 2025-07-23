const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// Grouping functions by category
const fileOperations = {
    prismCompileWithPaths: (compilationPaths) => {
    console.log('prismCompileWithPaths called with paths:', compilationPaths);
    return ipcRenderer.invoke('prism-compile-with-paths', compilationPaths);
  },
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  saveFile: (data) => ipcRenderer.invoke('save-file', data),
  reloadApp: () => ipcRenderer.send('app:reload'),
  createDirectory: (dirPath) => ipcRenderer.invoke('create-directory', dirPath),
  directoryExists: (dirPath) => ipcRenderer.invoke('directory-exists', dirPath),
  mkdir: (dirPath) => ipcRenderer.invoke('mkdir', dirPath),
  copyFile: (src, dest) => ipcRenderer.invoke('copy-file', src, dest),
  getFolderFiles: (folderPath) => ipcRenderer.invoke('getFolderFiles', folderPath),
  isDirectory: (path) => ipcRenderer.invoke('isDirectory', path),
  openExternalLink: (url) => shell.openExternal(url),
  getFilesWithExtension: (folderPath, extension) => ipcRenderer.invoke('get-files-with-extension', folderPath, extension),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
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

  //watcher
  // Enhanced file watching methods
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  watchFile: (filePath) => ipcRenderer.invoke('watch-file', filePath),
  stopWatchingFile: (watcherId) => ipcRenderer.invoke('stop-watching-file', watcherId),
  forceCheckFile: (filePath) => ipcRenderer.invoke('force-check-file', filePath),
  
  // File change event listeners
  onFileChanged: (callback) => {
    ipcRenderer.on('file-changed', (event, filePath) => callback(filePath));
  },
  onFileWatcherError: (callback) => {
    ipcRenderer.on('file-watcher-error', (event, filePath, error) => callback(filePath, error));
  },

  // Remove listeners
  removeFileChangeListeners: () => {
    ipcRenderer.removeAllListeners('file-changed');
    ipcRenderer.removeAllListeners('file-watcher-error');
  },
 // PRISM compilation methods
     prismCompile: (compilationPaths) => {
    console.log('prismCompile called with paths:', compilationPaths);
    return ipcRenderer.invoke('prism-compile', compilationPaths);
  },
    
    // Check if PRISM window is open
    checkPrismWindowOpen: () => {
      console.log('checkPrismWindowOpen called');
      return ipcRenderer.invoke('is-prism-window-open');
    },
    
    // Listen for PRISM window status
    onPrismStatus: (callback) => {
      console.log('onPrismStatus listener registered');
      const handler = (event, isOpen) => {
        console.log('prism-status event received:', isOpen);
        callback(isOpen);
      };
      
      ipcRenderer.on('prism-status', handler);
      
      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('prism-status', handler);
      };
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
      const handler = (event, data) => {
        console.log('compilation-complete event received:', data);
        callback(data);
      };
      
      ipcRenderer.on('compilation-complete', handler);
      
      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('compilation-complete', handler);
      };
    },
    
    // CORREÇÃO: Listen for toggle UI state requests - corrigido
    onGetToggleUIState: (callback) => {
      console.log('onGetToggleUIState listener registered');
      const handler = (event) => {
        console.log('get-toggle-ui-state request received');
        // Get the current state of toggle UI button
        const toggleButton = document.getElementById('toggle-ui');
        const isActive = toggleButton ? toggleButton.classList.contains('active') : false;
        console.log('Current toggle UI state:', isActive);
        
        // Send response immediately
        ipcRenderer.send('toggle-ui-state-response', isActive);
        
        // Also call the callback if provided
        if (typeof callback === 'function') {
          callback(isActive);
        }
      };
      
      ipcRenderer.on('get-toggle-ui-state', handler);
      
      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('get-toggle-ui-state', handler);
      };
    },

      onTerminalLog: (callback) => ipcRenderer.on('terminal-log', callback),
      removeTerminalLog: (callback) => ipcRenderer.removeListener('terminal-log', callback),

          // Fix for the missing openPrismCompile function
    openPrismCompile: () => {
      console.log('openPrismCompile called');
      return ipcRenderer.invoke('open-prism-compile');
    },
     prismRecompile: (compilationPaths) => {
    console.log('prismRecompile called with paths:', compilationPaths);
    return ipcRenderer.invoke('prism-recompile', compilationPaths);
  },
    
    exportLog: (logData) => ipcRenderer.invoke('export-log', logData),
    
    // Send messages to main process
    send: (channel, data) => {
      console.log('send called:', channel, data);
      ipcRenderer.send(channel, data);
    },
    
    // Remove listeners (cleanup)
    removeAllListeners: (channel) => {
      console.log('removeAllListeners called:', channel);
      ipcRenderer.removeAllListeners(channel);
    },

    compileForPRISM: () => window.electron.invoke('prism-compile'),


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
readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  
  // File type detection
  getFileType: (filePath) => ipcRenderer.invoke('get-file-type', filePath),
  
  // Your existing file operations...
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),

};

const projectOperations = {
  openProject: (spfPath) => ipcRenderer.invoke('project:open', spfPath),
  closeProject: (spfPath) => ipcRenderer.invoke('project:close'),
  createProjectStructure: (projectPath, spfPath) => ipcRenderer.invoke('project:createStructure', projectPath, spfPath),
  createProject: (projectPath, spfPath) => ipcRenderer.invoke('project:createStructure', projectPath, spfPath),
  getCurrentProject: () => ipcRenderer.invoke('get-current-project'),
  loadConfigFromPath: (configPath) => ipcRenderer.invoke('load-config-from-path', configPath),
  getProjectInfo: (path) => ipcRenderer.invoke('project:getInfo', path),
  createProcessorProject: (formData) => ipcRenderer.invoke('create-processor-project', formData),
  cancelVvpProcess: () => ipcRenderer.invoke('cancel-vvp-process'),
runVvpCommand: (vvpCmd, tempPath) => ipcRenderer.invoke('run-vvp-command', vvpCmd, tempPath),
checkVvpRunning: () => ipcRenderer.invoke('check-vvp-running'),
  getSimulationFolderPath: (processorName, inputDir) => ipcRenderer.invoke('get-simulation-folder-path', processorName, inputDir),
  saveCompilationResult: (hardwareFolderPath, fileName, content) => ipcRenderer.invoke('save-compilation-result', hardwareFolderPath, fileName, content),
  readDir: (dirPath) => ipcRenderer.invoke('readDir', dirPath),
  showSaveDialog: () => ipcRenderer.invoke('dialog:showSave'),
  onProjectStateChange: (callback) => ipcRenderer.on('project:stateChange', callback),
  onProjectCreated: (callback) => ipcRenderer.on('project:created', callback),
  onProcessorHubStateChange: (callback) => ipcRenderer.on('project:processorHubState', callback),
  onProcessorHubState: (callback) => ipcRenderer.on('project:processorHubState', callback),
  getProjectName: () => ipcRenderer.invoke("getProjectName"),
  createBackup: (folderPath) => ipcRenderer.invoke("create-backup", folderPath),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppInfo: async () => {
    try {
      return await ipcRenderer.invoke('get-app-info');
    } catch (error) {
      console.error('Error getting app info:', error);
      return {
        appVersion: 'Unknown',
        electronVersion: 'Unknown',
        chromeVersion: 'Unknown',
        nodeVersion: 'Unknown',
        osInfo: 'Unknown'
      };
    }
  },
  getPerformanceStats: () => ipcRenderer.invoke('get-performance-stats'),
  joinPath: (...args) => require('path').join(...args),
  onSimulateOpenProject: (callback) => {
    ipcRenderer.on('open-spf-file', (_, result) => callback(result));
  },

  execCommand: (command) => ipcRenderer.invoke('exec-command', command),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
  killProcessByName: (processName) => ipcRenderer.invoke('kill-process-by-name', processName),
  checkProcessRunning: (pid) => ipcRenderer.invoke('check-process-running', pid),    
  // Check if file/directory exists
  pathExists: (path) => ipcRenderer.invoke('path-exists', path),

  getAvailableProcessors: (projectPath) => ipcRenderer.invoke('get-available-processors', projectPath),
  deleteProcessor: (processorName) => ipcRenderer.invoke('delete-processor', processorName),
  deleteBackupFolder: (folderPath) => ipcRenderer.invoke('delete-backup-folder', folderPath),

  onProcessorCreated: (callback) => ipcRenderer.on('processor:created', (_, data) => callback(data)),
  onProjectOpen: (callback) => ipcRenderer.on('project:opened', (_, data) => callback(data)),
  onProcessorsUpdated: (callback) => ipcRenderer.on('project:processors', (_, data) => callback(data)),

    onUpdateProgress: (callback) => {
    const wrappedCallback = (event, data) => callback(data);
    ipcRenderer.on('update-progress', wrappedCallback);
    
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('update-progress', wrappedCallback);
    };
  },

  checkForUpdates: () => {
    return ipcRenderer.invoke('check-for-updates');
  },

  cancelUpdateDownload: () => {
    return ipcRenderer.invoke('cancel-update-download');
  },

  getAppVersion: () => {
    return ipcRenderer.invoke('get-app-version');
  },

   // Check for updates manually
  checkForUpdates: () => {
    return ipcRenderer.invoke('check-for-updates');
  },

  // Cancel update download
  cancelUpdateDownload: () => {
    return ipcRenderer.invoke('cancel-update-download');
  },

  // Get current app version
  getAppVersion: () => {
    return ipcRenderer.invoke('get-app-version');
  },

  // Get update status
  getUpdateStatus: () => {
    return ipcRenderer.invoke('get-update-status');
  },

  // Force download update if available
  downloadUpdate: () => {
    return ipcRenderer.invoke('download-update');
  },

  // Listen for update progress events
  onUpdateProgress: (callback) => {
    const wrappedCallback = (event, data) => callback(data);
    ipcRenderer.on('update-progress', wrappedCallback);
    
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('update-progress', wrappedCallback);
    };
  },

  // Listen for update available events
  onUpdateAvailable: (callback) => {
    const wrappedCallback = (event, data) => callback(data);
    ipcRenderer.on('update-available', wrappedCallback);
    
    return () => {
      ipcRenderer.removeListener('update-available', wrappedCallback);
    };
  },

  // Optimized VVP execution
  execVvpOptimized: (command, workingDir, options = {}) => 
    ipcRenderer.invoke('exec-vvp-optimized', command, workingDir, options),
  
  // Enhanced command execution with performance optimization
  execCommandStream: (command, workingDir = null, options = {}) => 
    ipcRenderer.invoke('exec-command-stream', command, workingDir, options),
  
  // Process priority management
  setProcessPriority: (pid, priority = 'high') => 
    ipcRenderer.invoke('set-process-priority', pid, priority),
  
  // System performance monitoring
  getSystemPerformance: () => 
    ipcRenderer.invoke('get-system-performance'),
  
  // Enhanced command output streaming
  onCommandOutputStream: (callback) => {
    ipcRenderer.on('command-output-stream', callback);
  },
  
  removeCommandOutputListener: (callback) => {
    ipcRenderer.removeListener('command-output-stream', callback);
  },

  // Listen for update downloaded events
  onUpdateDownloaded: (callback) => {
    const wrappedCallback = (event, data) => callback(data);
    ipcRenderer.on('update-downloaded', wrappedCallback);
    
    return () => {
      ipcRenderer.removeListener('update-downloaded', wrappedCallback);
    };
  },

  // Listen for update downloaded events
  onUpdateDownloaded: (callback) => {
    const wrappedCallback = (event, data) => callback(data);
    ipcRenderer.on('update-downloaded', wrappedCallback);
    
    return () => {
      ipcRenderer.removeListener('update-downloaded', wrappedCallback);
    };
  },

  // Listen for update errors
  onUpdateError: (callback) => {
    const wrappedCallback = (event, error) => callback(error);
    ipcRenderer.on('update-error', wrappedCallback);
    
    return () => {
      ipcRenderer.removeListener('update-error', wrappedCallback);
    };
  },

  listFilesInDirectory: (directoryPath) => ipcRenderer.invoke('list-files-directory', directoryPath), //Processor Config

  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, data) => callback(data));
  },
 
};

const dialogOperations = {
  showOpenDialog: () => ipcRenderer.invoke('dialog:showOpen'),
  getBasename: (fullPath) => path.basename(fullPath),
  openFolder: (folderPath) => ipcRenderer.invoke('folder:open', folderPath),
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
};

const compileOperations = {
  compile: (options) => ipcRenderer.invoke('compile', options),
  execCommand: (command) => ipcRenderer.invoke('exec-command', command),
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

  createFile: (filePath) => ipcRenderer.invoke('file:create', filePath),
  createDirectory: (dirPath) => ipcRenderer.invoke('directory:create', dirPath),
  renameFileOrDirectory: (oldPath, newPath) => ipcRenderer.invoke('file:rename', oldPath, newPath),
  deleteFileOrDirectory: (path) => ipcRenderer.invoke('file:delete', path),
  getParentDirectory: (filePath) => ipcRenderer.invoke('file:get-parent', filePath),
  isDirectory: (path) => ipcRenderer.invoke('file:is-directory', path),
  showConfirmDialog: (title, message) => ipcRenderer.invoke('dialog:confirm', title, message),
  fileExists: (path) => ipcRenderer.invoke('file:exists', path),
  

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
  prismCompileWithPaths: (compilationPaths) => {
    console.log('prismCompileWithPaths called with paths:', compilationPaths);
    return ipcRenderer.invoke('prism-compile-with-paths', compilationPaths);
  },
  // Config Operations
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  
  // Create a new folder
  async createFolder(folderPath) {
    try {
      await fs.promises.mkdir(folderPath, { recursive: true });
      return { success: true };
    } catch (error) {
      console.error('Failed to create folder:', error);
      return { success: false, message: error.message };
    }
  },
  
  // Delete a file or folder
  async deleteItem(itemPath, isDirectory) {
    try {
      if (isDirectory) {
        await fs.promises.rm(itemPath, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(itemPath);
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to delete item:', error);
      return { success: false, message: error.message };
    }
  },
  
  // Check if a file or directory exists
  async checkIfExists(itemPath) {
    try {
      await fs.promises.access(itemPath);
      return { exists: true };
    } catch {
      return { exists: false };
    }
  },
  
  // Copy a file or directory
  async copyItem(sourcePath, destPath, isDirectory) {
    try {
      if (isDirectory) {
        // For directories, we need to recursively copy
        await copyDir(sourcePath, destPath);
      } else {
        // For files, just copy the file
        await fs.promises.copyFile(sourcePath, destPath);
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to copy item:', error);
      return { success: false, message: error.message };
    }
  },
  
  // Move a file or directory
  async moveItem(sourcePath, destPath) {
    try {
      await fs.promises.rename(sourcePath, destPath);
      return { success: true };
    } catch (error) {
      // If rename fails (e.g., across devices), try copy & delete
      try {
        const isDirectory = (await fs.promises.stat(sourcePath)).isDirectory();
        
        if (isDirectory) {
          await copyDir(sourcePath, destPath);
        } else {
          await fs.promises.copyFile(sourcePath, destPath);
        }
        
        // Delete original after successful copy
        if (isDirectory) {
          await fs.promises.rm(sourcePath, { recursive: true, force: true });
        } else {
          await fs.promises.unlink(sourcePath);
        }
        
        return { success: true };
      } catch (copyError) {
        console.error('Failed to move item:', copyError);
        return { success: false, message: copyError.message };
      }
    }
    
  },

   async createFile(filePath, content = '') {
    try {
      await fs.promises.writeFile(filePath, content, 'utf8');
      return { success: true };
    } catch (error) {
      console.error('Failed to create file:', error);
      return { success: false, message: error.message };
    }
  },
  

  // Rename a file or folder
  async renameItem(oldPath, newPath) {
    try {
      // Check if destination already exists
      try {
        await fs.promises.access(newPath);
        return { 
          success: false, 
          message: 'A file or folder with that name already exists' 
        };
      } catch {
        // This is good - destination doesn't exist
      }
      
      await fs.promises.rename(oldPath, newPath);
      return { success: true };
    } catch (error) {
      console.error('Failed to rename item:', error);
      return { success: false, message: error.message };
    }
  },

  

// Debug project path
debugProjectPath: () => ipcRenderer.invoke('debug-project-path'),

// Toggle UI state methods
getToggleUIState: () => {
  const toggleButton = document.getElementById('toggle-ui');
  if (toggleButton) {
    return toggleButton.classList.contains('active') || 
           toggleButton.getAttribute('aria-pressed') === 'true' ||
           toggleButton.hasAttribute('data-active');
  }
  return false;
},

// Listen for toggle UI state requests from main process
onGetToggleUIState: (callback) => {
  ipcRenderer.on('get-toggle-ui-state', () => {
    // Get toggle UI state directly here instead of calling through window.electronAPI
    const toggleButton = document.getElementById('toggle-ui');
    let isActive = false;
    
    if (toggleButton) {
      isActive = toggleButton.classList.contains('active') || 
                 toggleButton.getAttribute('aria-pressed') === 'true' ||
                 toggleButton.hasAttribute('data-active');
    }
    
    ipcRenderer.send('toggle-ui-state-response', isActive);
  });
},

  setCurrentProject: (projectPath) => ipcRenderer.invoke('set-current-project', projectPath),
    
  // Event Listeners
  openFromSystem: (spfPath) => ipcRenderer.invoke('project:openFromSystem', spfPath),
  onOpenFromSystem: (callback) => ipcRenderer.on('project:openFromSystem', callback),

  getAppPath: () => ipcRenderer.invoke('getAppPath'),
  validatePath: (filePath) => ipcRenderer.invoke('validate-path', filePath),
  ensureDir: (dirPath) => ipcRenderer.invoke('ensure-dir', dirPath),


  onProjectPathUpdated: (callback) => ipcRenderer.on('project:pathUpdated', (event, data) => callback(data)),

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

// Add to existing IPC handlers
ipcRenderer.on('terminal-log', (event, terminal, message, type) => {
  window.postMessage({ 
    type: 'terminal-log', 
    terminal, 
    message, 
    logType: type 
  }, '*');
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

// Função para obter informações do projeto dos argumentos
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
