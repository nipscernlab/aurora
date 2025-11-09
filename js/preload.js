/**
 * PRELOAD.JS - Electron Context Bridge
 * This file exposes secure APIs to the renderer process
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');

// Valid IPC channels for listeners
const VALID_LISTENER_CHANNELS = [
  'vvp-finished',
  'command-output-stream',
  'gtkwave-output',
  'terminal-log',
  'file-changed',
  'file-watcher-error',
  'directory-changed',
  'directory-watcher-error',
  'file-tree-refreshed',
  'compilation-complete',
  'get-toggle-ui-state',
  'toggle-ui-state-response',
  'prism-status',
  'project-opened',
  'processor-created',
  'project:stateChange',
  'project:created',
  'project:processorHubState',
  'project:processors',
  'update-progress',
  'update-available',
  'update-downloaded',
  'update-error',
  'open-spf-file',
  'terminal-data',
  'terminal-error'
];

// ============================================================================
// FILE OPERATIONS
// ============================================================================

const fileOperations = {
  // Basic file operations
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  saveFile: (data) => ipcRenderer.invoke('save-file', data),
  copyFile: (src, dest) => ipcRenderer.invoke('copy-file', src, dest),
  
  // File information
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
  getFileType: (filePath) => ipcRenderer.invoke('get-file-type', filePath),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
  
  // Directory operations
  createDirectory: (dirPath) => ipcRenderer.invoke('create-directory', dirPath),
  mkdir: (dirPath) => ipcRenderer.invoke('mkdir', dirPath),
  directoryExists: (dirPath) => ipcRenderer.invoke('directory-exists', dirPath),
  isDirectory: (path) => ipcRenderer.invoke('isDirectory', path),
  getFolderFiles: (folderPath) => ipcRenderer.invoke('getFolderFiles', folderPath),
  getFilesWithExtension: (folderPath, extension) => 
    ipcRenderer.invoke('get-files-with-extension', folderPath, extension),
  
  // File tree operations
  refreshFolder: (path) => ipcRenderer.invoke('refreshFolder', path),
  triggerFileTreeRefresh: () => ipcRenderer.invoke('trigger-file-tree-refresh'),
  
  // File/Directory CRUD operations
  createFile: (filePath) => ipcRenderer.invoke('file:create', filePath),
  createDirectory: (dirPath) => ipcRenderer.invoke('directory:create', dirPath),
  renameFileOrDirectory: (oldPath, newPath) => ipcRenderer.invoke('file:rename', oldPath, newPath),
  deleteFileOrDirectory: (path) => ipcRenderer.invoke('file:delete', path),
  getParentDirectory: (filePath) => ipcRenderer.invoke('file:get-parent', filePath),
  
  // Path operations
  pathExists: (filePath) => ipcRenderer.invoke('path-exists', filePath),
  validatePath: (filePath) => ipcRenderer.invoke('validate-path', filePath),
  ensureDir: (dirPath) => ipcRenderer.invoke('ensure-dir', dirPath),
  joinPath: (...paths) => ipcRenderer.invoke('join-path', ...paths),
  
  // External operations
  openFolder: (folderPath) => ipcRenderer.invoke('folder:open', folderPath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // File selection
  selectFilesWithPath: (options) => ipcRenderer.invoke('select-files-with-path', options),
  
  // Export operations
  exportLog: (logData) => ipcRenderer.invoke('export-log', logData)
};

// ============================================================================
// FILE WATCHING OPERATIONS
// ============================================================================

const fileWatchingOperations = {
  // File watching
  watchFile: (filePath) => ipcRenderer.invoke('watch-file', filePath),
  stopWatchingFile: (watcherId) => ipcRenderer.invoke('stop-watching-file', watcherId),
  forceCheckFile: (filePath) => ipcRenderer.invoke('force-check-file', filePath),
  
  // Directory watching
  watchDirectory: (directoryPath) => ipcRenderer.invoke('watch-directory', directoryPath),
  stopWatchingDirectory: (directoryPath) => ipcRenderer.invoke('stop-watching-directory', directoryPath),
  
  // File change listeners
  onFileChanged: (callback) => {
    ipcRenderer.on('file-changed', (event, filePath) => callback(filePath));
  },
  onFileWatcherError: (callback) => {
    ipcRenderer.on('file-watcher-error', (event, filePath, error) => callback(filePath, error));
  },
  
  // Directory change listeners
  onDirectoryChanged: (callback) => {
    ipcRenderer.on('directory-changed', (event, directoryPath, files) => {
      callback(directoryPath, files);
    });
  },
  onDirectoryWatcherError: (callback) => {
    ipcRenderer.on('directory-watcher-error', (event, directoryPath, error) => {
      callback(directoryPath, error);
    });
  },
  
  // File tree listeners
  onFileTreeRefreshed: (callback) => {
    ipcRenderer.on('file-tree-refreshed', (event, data) => callback(data));
  },
  
  // Remove listeners
  removeFileChangeListeners: () => {
    ipcRenderer.removeAllListeners('file-changed');
    ipcRenderer.removeAllListeners('file-watcher-error');
  },
  removeDirectoryListeners: () => {
    ipcRenderer.removeAllListeners('directory-changed');
    ipcRenderer.removeAllListeners('directory-watcher-error');
  }
};

// ============================================================================
// PROJECT OPERATIONS
// ============================================================================

const projectOperations = {
  // Project lifecycle
  openProject: (spfPath) => ipcRenderer.invoke('project:open', spfPath),
  closeProject: () => ipcRenderer.invoke('project:close'),
  createProject: (projectPath, spfPath) => ipcRenderer.invoke('project:createStructure', projectPath, spfPath),
  createProjectStructure: (projectPath, spfPath) => ipcRenderer.invoke('project:createStructure', projectPath, spfPath),
  
  // Project information
  getProjectInfo: (path) => ipcRenderer.invoke('project:getInfo', path),
  getCurrentProject: () => ipcRenderer.invoke('get-current-project'),
  getProjectName: () => ipcRenderer.invoke('getProjectName'),
  setCurrentProject: (projectPath) => ipcRenderer.invoke('set-current-project', projectPath),
  
  // Processor operations
  createProcessorProject: (formData) => ipcRenderer.invoke('create-processor-project', formData),
  getAvailableProcessors: (projectPath) => ipcRenderer.invoke('get-available-processors', projectPath),
  deleteProcessor: (processorName) => ipcRenderer.invoke('delete-processor', processorName),
  
  // Configuration
  loadConfig: () => ipcRenderer.invoke('load-config'),
  loadConfigFromPath: (configPath) => ipcRenderer.invoke('load-config-from-path', configPath),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  
  // Backup operations
  createBackup: (folderPath) => ipcRenderer.invoke('create-backup', folderPath),
  deleteBackupFolder: (folderPath) => ipcRenderer.invoke('delete-backup-folder', folderPath),
  
  // Directory operations
  readDir: (dirPath) => ipcRenderer.invoke('readDir', dirPath),
  listFilesInDirectory: (directoryPath) => ipcRenderer.invoke('list-files-directory', directoryPath),
  scanTopLevelFolder: (projectPath) => ipcRenderer.invoke('scan-toplevel-folder', projectPath),
  
  // App information
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
  getSystemPerformance: () => ipcRenderer.invoke('get-system-performance'),
  
  // Path utilities
  getAppPath: () => ipcRenderer.invoke('getAppPath'),
  joinPath: (...args) => require('path').join(...args),
  
  // Listeners
  onProjectStateChange: (callback) => ipcRenderer.on('project:stateChange', callback),
  onProjectCreated: (callback) => ipcRenderer.on('project:created', callback),
  onProjectOpen: (callback) => ipcRenderer.on('project:opened', (_, data) => callback(data)),
  onProcessorHubStateChange: (callback) => ipcRenderer.on('project:processorHubState', callback),
  onProcessorHubState: (callback) => ipcRenderer.on('project:processorHubState', callback),
  onProcessorCreated: (callback) => ipcRenderer.on('processor:created', (_, data) => callback(data)),
  onProcessorsUpdated: (callback) => ipcRenderer.on('project:processors', (_, data) => callback(data)),
  onSimulateOpenProject: (callback) => {
    ipcRenderer.on('open-spf-file', (_, result) => callback(result));
  },
  onProjectPathUpdated: (callback) => ipcRenderer.on('project:pathUpdated', (event, data) => callback(data)),
  
  // Debug
  debugProjectPath: () => ipcRenderer.invoke('debug-project-path')
};

// ============================================================================
// COMPILATION & SIMULATION OPERATIONS
// ============================================================================

const compilationOperations = {
  // Compilation
  compile: (options) => ipcRenderer.invoke('compile', options),
  execCommand: (command, options = {}) => ipcRenderer.invoke('exec-command', command, options),
  execCommandStream: (command, workingDir = null, options = {}) => 
    ipcRenderer.invoke('exec-command-stream', command, workingDir, options),
  
  // VVP operations
  execVvpOptimized: (command, workingDir, options = {}) => 
    ipcRenderer.invoke('exec-vvp-optimized', command, workingDir, options),
  runVvpCommand: (vvpCmd, tempPath) => ipcRenderer.invoke('run-vvp-command', vvpCmd, tempPath),
  checkVvpRunning: () => ipcRenderer.invoke('check-vvp-running'),
  cancelVvpProcess: () => ipcRenderer.invoke('cancel-vvp-process'),
  
  // Simulation operations
  getSimulationFolderPath: (processorName, inputDir) => 
    ipcRenderer.invoke('get-simulation-folder-path', processorName, inputDir),
  saveCompilationResult: (hardwareFolderPath, fileName, content) => 
    ipcRenderer.invoke('save-compilation-result', hardwareFolderPath, fileName, content),
  
  // Simulation launchers
  launchGtkwaveOnly: (options) => ipcRenderer.invoke('launch-gtkwave-only', options),
  launchSerialSimulation: (options) => ipcRenderer.invoke('launch-serial-simulation', options),
  launchParallelSimulation: (options) => ipcRenderer.invoke('launch-parallel-simulation', options),
  launchPipedSimulation: (args) => ipcRenderer.invoke('launch-piped-simulation', args),
  
  // Process management
  setProcessPriority: (pid, priority = 'high') => 
    ipcRenderer.invoke('set-process-priority', pid, priority),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
  killProcessByName: (processName) => ipcRenderer.invoke('kill-process-by-name', processName),
  checkProcessRunning: (pid) => ipcRenderer.invoke('check-process-running', pid),
  
  // Output listeners
  onCommandOutputStream: (callback) => {
    ipcRenderer.on('command-output-stream', callback);
  },
  removeCommandOutputListener: (callback) => {
    ipcRenderer.removeListener('command-output-stream', callback);
  },
  onGtkwaveOutput: (callback) => {
    ipcRenderer.on('gtkwave-output', callback);
  },
  removeGtkwaveOutputListener: (callback) => {
    ipcRenderer.removeListener('gtkwave-output', callback);
  },
  
  // Generic listeners for VVP
  once: (channel, callback) => {
    const validChannels = ['vvp-finished'];
    if (validChannels.includes(channel)) {
      ipcRenderer.once(channel, (event, ...args) => callback(...args));
    }
  },
  removeListener: (channel, callback) => {
    const validChannels = ['vvp-finished'];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, callback);
    }
  }
};

// ============================================================================
// PRISM OPERATIONS
// ============================================================================

const prismOperations = {
  // PRISM compilation
  prismCompile: (compilationPaths) => {
    console.log('prismCompile called with paths:', compilationPaths);
    return ipcRenderer.invoke('prism-compile', compilationPaths);
  },
  prismCompileWithPaths: (compilationPaths) => {
    console.log('prismCompileWithPaths called with paths:', compilationPaths);
    return ipcRenderer.invoke('prism-compile-with-paths', compilationPaths);
  },
  prismRecompile: (compilationPaths) => {
    console.log('prismRecompile called with paths:', compilationPaths);
    return ipcRenderer.invoke('prism-recompile', compilationPaths);
  },
  openPrismCompile: () => {
    console.log('openPrismCompile called');
    return ipcRenderer.invoke('open-prism-compile');
  },
  
  // PRISM window management
  checkPrismWindowOpen: () => {
    console.log('checkPrismWindowOpen called');
    return ipcRenderer.invoke('is-prism-window-open');
  },
  
  // PRISM module operations
  generateSVGFromModule: (moduleName, tempDir) => {
    console.log('generateSVGFromModule called:', moduleName);
    return ipcRenderer.invoke('generate-svg-from-module', moduleName, tempDir);
  },
  getAvailableModules: (tempDir) => {
    console.log('getAvailableModules called');
    return ipcRenderer.invoke('get-available-modules', tempDir);
  },
  
  // PRISM listeners
  onPrismStatus: (callback) => {
    console.log('onPrismStatus listener registered');
    const handler = (event, isOpen) => {
      console.log('prism-status event received:', isOpen);
      callback(isOpen);
    };
    
    ipcRenderer.on('prism-status', handler);
    
    return () => {
      ipcRenderer.removeListener('prism-status', handler);
    };
  },
  onCompilationComplete: (callback) => {
    console.log('onCompilationComplete listener registered');
    const handler = (event, data) => {
      console.log('compilation-complete event received:', data);
      callback(data);
    };
    
    ipcRenderer.on('compilation-complete', handler);
    
    return () => {
      ipcRenderer.removeListener('compilation-complete', handler);
    };
  }
};

// ============================================================================
// DIALOG OPERATIONS
// ============================================================================

const dialogOperations = {
  showOpenDialog: () => ipcRenderer.invoke('dialog:showOpen'),
  showSaveDialog: () => ipcRenderer.invoke('dialog:showSave'),
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  showErrorDialog: (title, message) => ipcRenderer.send('show-error-dialog', title, message),
  showConfirmDialog: (title, message) => ipcRenderer.invoke('dialog:confirm', title, message),
  getBasename: (fullPath) => path.basename(fullPath)
};

// ============================================================================
// UI & WINDOW OPERATIONS
// ============================================================================

const uiOperations = {
  // Zoom operations
  zoomIn: () => ipcRenderer.send('zoom-in'),
  zoomOut: () => ipcRenderer.send('zoom-out'),
  zoomReset: () => ipcRenderer.send('zoom-reset'),
  
  // App control
  reloadApp: () => ipcRenderer.send('app:reload'),
  quitApp: () => ipcRenderer.send('app-quit'),
  
  // External applications
  openBrowser: () => ipcRenderer.send('open-browser'),
  openGithubDesktop: () => ipcRenderer.send('open-github-desktop'),
  
  // Toggle UI state
  getToggleUIState: () => {
    const toggleButton = document.getElementById('toggle-ui');
    if (toggleButton) {
      return toggleButton.classList.contains('active') || 
             toggleButton.getAttribute('aria-pressed') === 'true' ||
             toggleButton.hasAttribute('data-active');
    }
    return false;
  },
  onGetToggleUIState: (callback) => {
    console.log('onGetToggleUIState listener registered');
    const handler = (event) => {
      console.log('get-toggle-ui-state request received');
      const toggleButton = document.getElementById('toggle-ui');
      const isActive = toggleButton ? toggleButton.classList.contains('active') : false;
      console.log('Current toggle UI state:', isActive);
      
      ipcRenderer.send('toggle-ui-state-response', isActive);
      
      if (typeof callback === 'function') {
        callback(isActive);
      }
    };
    
    ipcRenderer.on('get-toggle-ui-state', handler);
    
    return () => {
      ipcRenderer.removeListener('get-toggle-ui-state', handler);
    };
  }
};

// ============================================================================
// TERMINAL OPERATIONS
// ============================================================================

const terminalOperations = {
  onTerminalLog: (callback) => ipcRenderer.on('terminal-log', callback),
  removeTerminalLog: (callback) => ipcRenderer.removeListener('terminal-log', callback),
  
  // Generic send/receive
  send: (channel, data) => {
    console.log('send called:', channel, data);
    ipcRenderer.send(channel, data);
  },
  removeAllListeners: (channel) => {
    console.log('removeAllListeners called:', channel);
    ipcRenderer.removeAllListeners(channel);
  }
};

// ============================================================================
// TERMINAL API (Separate Terminal System)
// ============================================================================

const terminalAPI = {
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
};

// ============================================================================
// UPDATE OPERATIONS
// ============================================================================

const updateOperations = {
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  cancelUpdateDownload: () => ipcRenderer.invoke('cancel-update-download'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  // Adicionar em fileOperations ou criar nova seção:
  getComponentsPath: () => ipcRenderer.invoke('get-components-path'),
  // Update listeners
  onUpdateProgress: (callback) => {
    const wrappedCallback = (event, data) => callback(data);
    ipcRenderer.on('update-progress', wrappedCallback);
    
    return () => {
      ipcRenderer.removeListener('update-progress', wrappedCallback);
    };
  },
  onUpdateAvailable: (callback) => {
    const wrappedCallback = (event, data) => callback(data);
    ipcRenderer.on('update-available', wrappedCallback);
    
    return () => {
      ipcRenderer.removeListener('update-available', wrappedCallback);
    };
  },
  onUpdateDownloaded: (callback) => {
    const wrappedCallback = (event, data) => callback(data);
    ipcRenderer.on('update-downloaded', wrappedCallback);
    
    return () => {
      ipcRenderer.removeListener('update-downloaded', wrappedCallback);
    };
  },
  onUpdateError: (callback) => {
    const wrappedCallback = (event, error) => callback(error);
    ipcRenderer.on('update-error', wrappedCallback);
    
    return () => {
      ipcRenderer.removeListener('update-error', wrappedCallback);
    };
  }
};

// ============================================================================
// UTILITY OPERATIONS
// ============================================================================

const utilityOperations = {
  // File utilities
  createFolder: async (folderPath) => {
    try {
      await fs.promises.mkdir(folderPath, { recursive: true });
      return { success: true };
    } catch (error) {
      console.error('Failed to create folder:', error);
      return { success: false, message: error.message };
    }
  },
  
  createFile: async (filePath, content = '') => {
    try {
      await fs.promises.writeFile(filePath, content, 'utf8');
      return { success: true };
    } catch (error) {
      console.error('Failed to create file:', error);
      return { success: false, message: error.message };
    }
  },
  
  deleteItem: async (itemPath, isDirectory) => {
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
  
  checkIfExists: async (itemPath) => {
    try {
      await fs.promises.access(itemPath);
      return { exists: true };
    } catch {
      return { exists: false };
    }
  },
  
  copyItem: async (sourcePath, destPath, isDirectory) => {
    try {
      if (isDirectory) {
        await copyDir(sourcePath, destPath);
      } else {
        await fs.promises.copyFile(sourcePath, destPath);
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to copy item:', error);
      return { success: false, message: error.message };
    }
  },
  
  moveItem: async (sourcePath, destPath) => {
    try {
      await fs.promises.rename(sourcePath, destPath);
      return { success: true };
    } catch (error) {
      try {
        const isDirectory = (await fs.promises.stat(sourcePath)).isDirectory();
        
        if (isDirectory) {
          await copyDir(sourcePath, destPath);
        } else {
          await fs.promises.copyFile(sourcePath, destPath);
        }
        
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
  
  renameItem: async (oldPath, newPath) => {
    try {
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
  
  // Path utilities
  getPathForFile: (file) => {
    try {
      if (webUtils && webUtils.getPathForFile) {
        return webUtils.getPathForFile(file);
      }
      return file.path || '';
    } catch (error) {
      console.error('Error getting file path:', error);
      return '';
    }
  },
  
  joinProjectPath: (...segments) => path.join(process.cwd(), ...segments)
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Helper function to recursively copy directory
async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

// ============================================================================
// EXPOSE MAIN API
// ============================================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // File Operations
  ...fileOperations,
  
  // File Watching
  ...fileWatchingOperations,
  
  // Project Operations
  ...projectOperations,
  
  // Compilation & Simulation
  ...compilationOperations,
  
  // PRISM Operations
  ...prismOperations,
  
  // Dialog Operations
  ...dialogOperations,
  
  // UI Operations
  ...uiOperations,
  
  // Terminal Operations
  ...terminalOperations,
  
  // Update Operations
  ...updateOperations,
  
  // Utility Operations
  ...utilityOperations
});

// ============================================================================
// EXPOSE TERMINAL API (Separate Namespace)
// ============================================================================

if (ipcRenderer) {
  contextBridge.exposeInMainWorld('terminalAPI', terminalAPI);
} else {
  console.error('ipcRenderer is not available');
}

// ============================================================================
// GLOBAL EVENT LISTENERS
// ============================================================================

// Listen for project opened events
ipcRenderer.on('project-opened', (event, projectPath) => {
  window.postMessage({ 
    type: 'project-opened', 
    projectPath 
  }, '*');
});

// Listen for terminal log events
ipcRenderer.on('terminal-log', (event, terminal, message, type) => {
  window.postMessage({ 
    type: 'terminal-log', 
    terminal, 
    message, 
    logType: type 
  }, '*');
});

// ============================================================================
// PROJECT INFO FROM ARGS
// ============================================================================

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

// ============================================================================
// CONSOLE INFO
// ============================================================================

console.log('Preload script loaded successfully');
console.log('Valid listener channels:', VALID_LISTENER_CHANNELS);