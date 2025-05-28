const { app, BrowserWindow, ipcMain, shell, Tray, nativeImage, dialog, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const { exec } = require('child_process');
const path = require('path');
const fse = require('fs-extra');
const fs = require('fs').promises;
const os = require('os');
const { spawn } = require('child_process');
const moment = require("moment");
const electronFs = require('original-fs');
const url = require('url');
const log = require('electron-log');
log.transports.file.level = 'debug';
const { promisify } = require('util');

const settingsPath = path.join(__dirname, 'saphoComponents', 'Scripts' ,'settings.json');

let progressWindow = null;
let updateCheckInProgress = false;
let downloadInProgress = false;

// Variable to track the current open project path
let currentOpenProjectPath = null;

// Global variables for app state
let tray = null;
let settingsWindow = null;
let isQuitting = false;

let mainWindow, splashWindow;

// Function to create the main application window
async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: false,
    icon: path.join(__dirname, 'assets/icons/aurora_borealis-2.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: true,
      webviewTag: true,
      preload: path.join(__dirname, 'js', 'preload.js'),
    },
    backgroundColor: '#1e1e1e',
    show: false,
  });

  mainWindow.loadFile('index.html');

   // Verificar se há um arquivo .spf para abrir
   mainWindow.webContents.on('did-finish-load', () => {
    if (fileToOpen) {
      mainWindow.webContents.send('open-spf-file', { filePaths: [fileToOpen] });
    }
  });

  // Registrar o protocolo sapho: e a extensão .spf
if (process.platform === 'win32') {
  app.setAsDefaultProtocolClient('sapho');
  app.setAppUserModelId(process.execPath);
}

  // Load user settings
  const settings = await loadSettings();
  
  // Apply auto-start setting
  applyAutoStartSettings(settings.startWithWindows);

  // Create tray icon
  createTray();

  // Handle window close
  mainWindow.on('close', async (event) => {
    if (isQuitting) return;
  
    try {
      const settings = await loadSettings();
      
      if (settings.minimizeToTray) {
        event.preventDefault();
        mainWindow.hide();
        return;
      }
    } catch (error) {
      console.error('Error checking settings:', error);
    }
  });
  
  // Handle app quit
  app.on('before-quit', () => {
    isQuitting = true;
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    initializeUpdateSystem();
  });
}

// Handle app quit event
app.on('before-quit', () => {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// Create a modern progress window for updates
function createProgressWindow() {
  if (progressWindow) {
    progressWindow.close();
    progressWindow = null;
  }

  progressWindow = new BrowserWindow({
    width: 500,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'js', 'preload.js')
    },
  });

  // Load the progress HTML file
  progressWindow.loadFile(path.join(__dirname, 'html', 'progress.html'));

  // Show window when ready to prevent flash
  progressWindow.once('ready-to-show', () => {
    progressWindow.show();
    progressWindow.focus();
  });

  // Handle window closed event
  progressWindow.on('closed', () => {
    progressWindow = null;
  });

  // Prevent the window from being closed during download
  progressWindow.on('close', (event) => {
    if (downloadInProgress) {
      event.preventDefault();
      dialog.showMessageBox(progressWindow, {
        type: 'warning',
        title: 'Download in Progress',
        message: 'Please wait for the update download to complete.',
        buttons: ['OK']
      });
    }
  });
}

// Enhanced update checking with better error handling
function checkForUpdates() {
  if (updateCheckInProgress) {
    console.log('Update check already in progress');
    return;
  }

  updateCheckInProgress = true;
  console.log('Checking for updates...');

  // Clear cache before checking for updates
  clearUpdateCache().then(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }).catch((error) => {
    console.error('Failed to clear update cache:', error);
    autoUpdater.checkForUpdatesAndNotify();
  });
}

// Clear update cache for fresh downloads
async function clearUpdateCache() {
  try {
    const { session } = require('electron');
    const ses = session.defaultSession;
    
    // Clear HTTP cache
    await ses.clearCache();
    
    // Clear storage data related to updates
    await ses.clearStorageData({
      storages: ['cachestorage', 'filesystem', 'localstorage', 'sessionstorage']
    });
    
    console.log('Update cache cleared successfully');
  } catch (error) {
    console.error('Error clearing update cache:', error);
    throw error;
  }
}

// Setup auto-updater event listeners with improved handling
function setupAutoUpdaterEvents() {
  // Update available event
  autoUpdater.on('update-available', async (info) => {
    updateCheckInProgress = false;
    
    console.log(`New version available: ${info.version}, current version: ${app.getVersion()}`);
    
    const releaseNotes = info.releaseNotes || 'No release notes available';
    const updateSize = info.files && info.files[0] ? 
      `(${(info.files[0].size / 1048576).toFixed(1)} MB)` : '';
    
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `A new version is available!`,
      detail: `Current Version: ${app.getVersion()}\nNew Version: ${info.version} ${updateSize}\n\nWould you like to download and install it now?`,
      buttons: ['Download Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      icon: null
    });

    if (response === 0) {
      startUpdateDownload();
    }
  });

  // No update available event
  autoUpdater.on('update-not-available', (info) => {
    updateCheckInProgress = false;
    console.log('No updates available');
  });

  // Download progress event with enhanced tracking
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    const transferred = (progress.transferred / 1048576).toFixed(1);
    const total = (progress.total / 1048576).toFixed(1);
    const speed = (progress.bytesPerSecond / 1048576).toFixed(1);
    
    console.log(`Download progress: ${percent}% (${transferred}/${total} MB) at ${speed} MB/s`);
    
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.webContents.send('update-progress', {
        percent,
        transferred,
        total,
        speed
      });
    }
  });

  // Update downloaded event
  autoUpdater.on('update-downloaded', async (info) => {
    downloadInProgress = false;
    
    console.log('Update downloaded successfully');
    
    // Close progress window
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.close();
      progressWindow = null;
    }

    // Show install confirmation dialog
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready to Install',
      message: 'The update has been downloaded successfully!',
      detail: `Version ${info.version} is ready to be installed. The application will restart to complete the installation.`,
      buttons: ['Install Now', 'Install Later'],
      defaultId: 0,
      cancelId: 1
    });

    if (response === 0) {
      // Install update immediately
      setImmediate(() => {
        autoUpdater.quitAndInstall(false, true);
      });
    }
  });

  // Error handling with user notification
  autoUpdater.on('error', async (error) => {
    updateCheckInProgress = false;
    downloadInProgress = false;
    
    console.error('Update error:', error);
    
    // Close progress window if open
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.close();
      progressWindow = null;
    }

    // Show user-friendly error message
    let errorMessage = 'An error occurred while checking for updates.';
    
    if (error.message.includes('net::')) {
      errorMessage = 'Unable to connect to the update server. Please check your internet connection.';
    } else if (error.message.includes('signature')) {
      errorMessage = 'Update verification failed. Please try again later.';
    } else if (error.message.includes('ENOSPC')) {
      errorMessage = 'Not enough disk space to download the update.';
    }

    await dialog.showMessageBox({
      type: 'error',
      title: 'Update Error',
      message: 'Update Failed',
      detail: `${errorMessage}\n\nError details: ${error.message}`,
      buttons: ['OK']
    });
  });

  // Before quit for update event
  autoUpdater.on('before-quit-for-update', () => {
    console.log('Application will quit for update installation');
  });
}

// Start the update download process
function startUpdateDownload() {
  if (downloadInProgress) {
    console.log('Download already in progress');
    return;
  }

  downloadInProgress = true;
  console.log('Starting update download...');
  
  // Create and show progress window
  createProgressWindow();
  
  // Start the download
  autoUpdater.downloadUpdate().catch((error) => {
    console.error('Failed to start download:', error);
    downloadInProgress = false;
    
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.close();
      progressWindow = null;
    }
  });
}

// IPC handlers for renderer process communication
function setupIpcHandlers() {
  // Handle manual update check from renderer
  ipcMain.handle('check-for-updates', () => {
    checkForUpdates();
  });

  // Handle cancel download request
  ipcMain.handle('cancel-update-download', () => {
    if (downloadInProgress && progressWindow) {
      downloadInProgress = false;
      progressWindow.close();
      progressWindow = null;
      // Note: electron-updater doesn't have a direct cancel method
      // The download will continue in background but UI will be hidden
    }
  });

  // Get current app version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });
}

// Initialize the update system
function initializeUpdateSystem() {
  console.log('Initializing update system...');
  
  setupAutoUpdaterEvents();
  setupIpcHandlers();
  
  // Check for updates on app start (with delay to let app fully load)
  setTimeout(() => {
    if (process.env.NODE_ENV !== 'development') {
      checkForUpdates();
    }
  }, 2000);
}

// Function to create the settings window
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 520,  // Largura do modal original
    height: 450, // Altura ajustada para o conteúdo
    parent: mainWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'Settings'
  });

  settingsWindow.loadFile(path.join(__dirname, 'html', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// Function to load user settings from a file
async function loadSettings() {
  try {
    try {
      await fs.access(settingsPath); // Check if the settings file exists
      const data = await fs.readFile(settingsPath, 'utf8'); // Read the settings file
      return JSON.parse(data); // Parse and return the settings
    } catch (err) {
      // If the file doesn't exist, return default settings
      return {
        startWithWindows: false,
        minimizeToTray: true,
        theme: 'dark'
      };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    // Return default settings in case of an error
    return {
      startWithWindows: false,
      minimizeToTray: true,
      theme: 'dark'
    };
  }
}

// Function to save user settings to a file
async function saveSettings(settings) {
  try {
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8'); // Write settings to file
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

// Function to apply auto-start settings for the application
function applyAutoStartSettings(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath
    });
    return true;
  } catch (error) {
    console.error('Error setting login item:', error);
    return false;
  }
}

// Function to create a system tray icon and menu
function createTray() {
  if (tray !== null) return; // Avoid duplicate tray creation

  const iconPath = path.join(__dirname, 'assets', 'icons', 'aurora_borealis-2.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 });
  tray = new Tray(trayIcon);

  const openIconPath = path.join(__dirname, 'assets', 'icons', 'open.png');
  const settingsIconPath = path.join(__dirname, 'assets', 'icons', 'settings.png');
  const quitIconPath = path.join(__dirname, 'assets', 'icons', 'close.png');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open App',
      icon: nativeImage.createFromPath(openIconPath).resize({ width: 16, height: 16 }),
      click: () => {
        mainWindow.show();
      }
    },
    {
      label: 'Settings',
      icon: nativeImage.createFromPath(settingsIconPath).resize({ width: 16, height: 16 }),
      click: () => {
        createSettingsWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      icon: nativeImage.createFromPath(quitIconPath).resize({ width: 16, height: 18 }),
      click: () => {
        isQuitting = true;
        if (tray) {
          tray.destroy();
          tray = null;
        }
        app.quit();
      }
    }
  ]);

  tray.setToolTip('AURORA IDE');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
  });
}

// IPC handlers for settings management
ipcMain.handle('get-settings', async () => {
  return await loadSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
  const success = await saveSettings(settings); // Save settings to file
  applyAutoStartSettings(settings.startWithWindows); // Apply auto-start configuration
  return success;
});

ipcMain.on('close-settings-modal', () => {
  if (settingsWindow) settingsWindow.close(); // Close settings window if open
});

ipcMain.on('open-settings', () => {
  createSettingsWindow(); // Open settings window
});

// Function to create a splash screen
function createSplashScreen() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 500,
    icon: path.join(__dirname, 'assets/icons/aurora_borealis-2.ico'),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true },
  });

  splashWindow.loadFile(path.join(__dirname, 'html', 'splash.html'));
  setTimeout(() => {
    splashWindow.close(); // Close splash screen
    createMainWindow(); // Create main application window
    setTimeout(checkForUpdates, 2000); // Check for updates after a delay
  }, 4000);
}

// Initialize the application when ready
app.whenReady().then(createSplashScreen);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit(); // Quit app if not on macOS
});

ipcMain.handle('open-folder', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (!result.canceled) {
      const folderPath = result.filePaths[0];
      if (!folderPath) {
        throw new Error('No folder selected.');
      }
      global.currentFolderPath = folderPath; // Store the current folder path
      const files = await listFiles(folderPath); // List files in the folder
      return { folderPath, files };
    }
    return null; // No folder selected
  } catch (error) {
    console.error('Error opening folder:', error.message);
    throw error; // Propagate error to renderer.js
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8'); // Read file content
    return content;
  } catch (error) {
    console.error(`Error reading file: ${error.message}`);
    throw error;
  }
});

ipcMain.handle('save-file', async (event, { filePath, content }) => {
  try {
    await fs.writeFile(filePath, content, 'utf8'); // Save file content
    return true;
  } catch (error) {
    console.error('Error saving file:', error.message);
    return false;
  }
});

// Function to list files in a directory recursively
async function listFiles(dir) {
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    const items = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(dir, file.name);
        if (file.isDirectory()) {
          const children = await listFiles(filePath); // Recursively list subdirectories
          return { name: file.name, path: filePath, type: 'directory', children };
        }
        return { name: file.name, path: filePath, type: 'file' };
      })
    );
    return items;
  } catch (error) {
    console.error('Error listing files:', error.message);
    throw error; // Propagate error to be handled in `ipcMain.handle`
  }
}

// IPC handler to get the current folder path
ipcMain.handle('getCurrentFolder', () => {
  return global.currentFolderPath || null;
});

// Function to scan a directory recursively
async function scanDirectory(dirPath) {
  const items = await fse.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    items.map(async item => {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        const children = await scanDirectory(fullPath); // Recursively scan subdirectories
        return {
          name: item.name,
          path: fullPath,
          type: 'directory',
          children
        };
      }
      return {
        name: item.name,
        path: fullPath,
        type: 'file'
      };
    })
  );
  return files;
}
// Context: IPC handlers for various functionalities in an Electron application

// Handler to refresh the folder structure
ipcMain.handle('refreshFolder', async (event, projectPath) => {
  try {
    if (!projectPath) {
      throw new Error('No project path provided');
    }
    const files = await scanDirectory(projectPath);
    return { files };
  } catch (error) {
    console.error('Error scanning directory:', error);
    throw error;
  }
});

// Handler to compile a file using a specified compiler
ipcMain.handle('compile', async (event, { compiler, content, filePath, workingDir, outputPath }) => {
  return new Promise((resolve, reject) => {
    const compilerPath = path.join(__dirname, compiler);
    const options = {
      cwd: workingDir,
      maxBuffer: 1024 * 1024, // Increase buffer size to handle large outputs
    };

    try {
      require('fs').writeFileSync(filePath, content); // Save the file before compilation
    } catch (error) {
      reject(error);
      return;
    }

    const compileCommand = `"${compilerPath}" "${filePath}" "${outputPath}"`;
    console.log('Compilation command:', compileCommand);

    const process = exec(compileCommand, options, (error, stdout, stderr) => {
      if (error) {
        reject({ stdout, stderr, error: error.message });
        return;
      }
      resolve({ stdout, stderr });
    });

    process.stdout.on('data', (data) => {
      console.log(data);
    });

    process.stderr.on('data', (data) => {
      console.error(data);
    });
  });
});

// Handler to get the current working directory
ipcMain.handle('get-current-folder', async () => {
  return process.cwd();
});

// Handler to open a folder in the system's file explorer
ipcMain.handle('open-in-explorer', async (event, folderPath) => {
  try {
    await shell.openPath(folderPath);
    return true;
  } catch (error) {
    console.error('Error opening explorer:', error);
    return false;
  }
});

// Handler to open an external URL in the default browser
ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return true;
  } catch (error) {
    console.error('Error opening external link:', error);
    return false;
  }
});

// Handler to select a directory
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });

  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// Add this to your main.js where your other IPC handlers are defined



// Handler to delete a processor
ipcMain.handle('delete-processor', async (event, processorName) => {
  try {
    // Check if we have an open project
    if (!currentOpenProjectPath) {
      throw new Error('No open project');
    }
    
    // Get the project directory
    const spfData = await fse.readFile(currentOpenProjectPath, 'utf8');
    const projectData = JSON.parse(spfData);
    const projectDir = projectData.structure.basePath;
    
    // Path to the processor directory
    const processorDir = path.join(projectDir, processorName);
    
    // Check if processor directory exists
    const dirExists = await fse.pathExists(processorDir);
    
    if (dirExists) {
      // Delete processor directory
      await fse.remove(processorDir);
    }
    
    // Update project file - Remove processor from structure
    if (projectData.structure.processors) {
      projectData.structure.processors = projectData.structure.processors.filter(
        processor => processor.name !== processorName
      );
      
      // Write updated project file
      await fse.writeFile(currentOpenProjectPath, JSON.stringify(projectData, null, 2));
    }
    
    // Notify the renderer about the processor list update
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.webContents.send('project:processors', { 
        processors: projectData.structure.processors.map(p => p.name),
        projectPath: projectData.structure.basePath
      });
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting processor:', error);
    throw error;
  }
});

// Add a new IPC handler to check current open project
ipcMain.handle('get-current-project', async () => {
  if (!currentOpenProjectPath) {
    return { projectOpen: false };
  }
  
  try {
    const spfData = await fse.readFile(currentOpenProjectPath, 'utf8');
    const projectData = JSON.parse(spfData);
    
    return { 
      projectOpen: true, 
      projectPath: projectData.structure.basePath,
      spfPath: currentOpenProjectPath,
      processors: projectData.structure.processors.map(p => p.name)
    };
  } catch (error) {
    console.error('Error getting current project:', error);
    return { projectOpen: false };
  }
});

// Handler to create a processor project
ipcMain.handle('create-processor-project', async (event, formData) => {
  try {
    if (!formData.projectLocation) {
      throw new Error('Project location is required');
    }

    const processorPath = path.join(formData.projectLocation, formData.processorName);
    const softwarePath = path.join(processorPath, 'Software');
    const hardwarePath = path.join(processorPath, 'Hardware');
    const simulationPath = path.join(processorPath, 'Simulation');

    try {
      await fse.access(processorPath);
      throw new Error(`A processor with name "${formData.processorName}" already exists`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        await fse.mkdir(processorPath, { recursive: true });
        await fse.mkdir(softwarePath, { recursive: true });
        await fse.mkdir(hardwarePath, { recursive: true });
        await fse.mkdir(simulationPath, { recursive: true });

        const cmmContent = `#PRNAME ${formData.processorName}
#NUBITS ${formData.nBits}
#NDSTAC ${formData.dataStackSize}
#SDEPTH ${formData.instructionStackSize}
#NUIOIN ${formData.inputPorts}
#NUIOOU ${formData.outputPorts}
#NBMANT ${formData.nbMantissa}
#NBEXPO ${formData.nbExponent}
#NUGAIN ${formData.gain}

void main() 
{

}`;

        const cmmFilePath = path.join(softwarePath, `${formData.processorName}.cmm`);
        await fse.writeFile(cmmFilePath, cmmContent, 'utf8');

        const spfPath = path.join(formData.projectLocation, `${path.basename(formData.projectLocation)}.spf`);
        const spfContent = await fse.readFile(spfPath, 'utf8');
        const spfData = JSON.parse(spfContent);

        spfData.structure.processors.push({
          name: formData.processorName,
          config: {
            pointType: formData.pointType,
            nBits: formData.nBits,
            nbMantissa: formData.nbMantissa,
            nbExponent: formData.nbExponent,
            dataStackSize: formData.dataStackSize,
            instructionStackSize: formData.instructionStackSize,
            inputPorts: formData.inputPorts,
            outputPorts: formData.outputPorts,
            gain: formData.gain,
          },
        });

        await fse.writeFile(spfPath, JSON.stringify(spfData, null, 2));

        if (mainWindow) {
          mainWindow.webContents.send('processor-created', {
            processorName: formData.processorName,
            projectPath: formData.projectLocation
          });
        }

        return { success: true, path: processorPath };
      } else {
        throw err;
      }
    }

    
  } catch (error) {
    console.error('Error in create-processor-project:', error);
    throw error;
  }
});

// Método para obter a lista de processadores disponíveis
ipcMain.handle('get-available-processors', async (event, projectPath) => {
  try {
    // First try to use currentOpenProjectPath (most reliable)
    if (currentOpenProjectPath && await fse.pathExists(currentOpenProjectPath)) {
      const spfData = await fse.readFile(currentOpenProjectPath, 'utf8');
      const projectData = JSON.parse(spfData);
      
      if (projectData.structure && projectData.structure.processors) {
        return projectData.structure.processors.map(p => p.name);
      }
    }
    
    // If that fails, try to find the SPF file using the provided projectPath
    if (projectPath) {
      // Check if projectPath is a directory or an SPF file
      const stats = await fse.stat(projectPath);
      let spfPath;
      
      if (stats.isDirectory()) {
        // Find SPF file in the directory
        const files = await fse.readdir(projectPath);
        const spfFile = files.find(file => file.endsWith('.spf'));
        if (spfFile) {
          spfPath = path.join(projectPath, spfFile);
        }
      } else if (projectPath.endsWith('.spf')) {
        spfPath = projectPath;
      }
      
      if (spfPath && await fse.pathExists(spfPath)) {
        const spfData = await fse.readFile(spfPath, 'utf8');
        const projectData = JSON.parse(spfData);
        
        if (projectData.structure && projectData.structure.processors) {
          return projectData.structure.processors.map(p => p.name);
        }
      }
    }
    
    return [];
  } catch (error) {
    console.error('Error getting available processors:', error);
    return [];
  }
});


// Handler to get the hardware folder path
ipcMain.handle('get-hardware-folder-path', async (event, processorName, inputDir) => {
  const processorDir = path.join(inputDir, '..');
  const hardwareFolderPath = path.join(processorDir, 'Hardware');
  return hardwareFolderPath;
});

// Handler to get the hardware folder path
ipcMain.handle('get-simulation-folder-path', async (event, processorName, inputDir) => {
  const processorDir = path.join(inputDir);
  const simulationFolderPath = path.join(processorDir,processorName, 'Simulation');
  return simulationFolderPath;
});

ipcMain.handle('list-files-directory', async (event, directoryPath) => {
  try {
    const files = await fs.readdir(directoryPath);
    return files;
  } catch (error) {
    console.error('Error listing files:', error);
    return [];
  }
});



// Handler to move compiled files to the hardware folder, filtering only output files
ipcMain.handle('move-files-to-hardware-folder', async (event, inputDir, hardwareFolderPath) => {
  try {
    await fs.mkdir(hardwareFolderPath, { recursive: true }); // Ensure the Hardware folder exists

    const compiledFiles = await fs.readdir(inputDir); // Read files in the input directory

    if (!compiledFiles.length) {
      throw new Error('No compiled files found.');
    }

    const validExtensions = ['.mif', '.v']; // Define valid output file extensions

    // Filter and move files with valid extensions
    const movePromises = compiledFiles
      .filter(file => validExtensions.includes(path.extname(file).toLowerCase()))
      .map(async (file) => {
        const filePath = path.join(inputDir, file);
        const destPath = path.join(hardwareFolderPath, file);

        try {
          await fs.access(filePath); // Check if the file exists
          await fs.rename(filePath, destPath); // Move the file
        } catch (err) {
          throw new Error(`Error moving file: ${file}`);
        }
      });

    await Promise.all(movePromises); // Wait for all files to be moved
    return 'Files moved successfully';
  } catch (error) {
    throw new Error(`Error moving files: ${error.message}`);
  }
});

// Handler to show an open file dialog for selecting .spf files
ipcMain.handle('dialog:showOpen', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Sapho Project Files', extensions: ['spf'] }]
  });
  return result;
});

// Handler to get project information from a .spf file
ipcMain.handle('project:getInfo', async (_, spfPath) => {
  try {
    if (!spfPath) {
      throw new Error('No project file path provided');
    }

    const exists = await fse.pathExists(spfPath); // Check if the file exists
    if (!exists) {
      throw new Error(`Project file not found at: ${spfPath}`);
    }

    const projectData = await fse.readJSON(spfPath); // Read and parse the project file
    return projectData;
  } catch (error) {
    throw error;
  }
});

// Handler to open a directory dialog
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled) {
    return null; // Return null if the user cancels
  }
  return result.filePaths[0]; // Return the selected folder path
});

// Class representing the structure of a .spf project file
class ProjectFile {
  constructor(projectPath) {
    this.metadata = {
      projectName: path.basename(projectPath),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      computerName: process.env.COMPUTERNAME || os.hostname(),
      appVersion: app.getVersion(),
      projectPath: projectPath
    };
    
    this.structure = {
      basePath: projectPath,
      processors: [],
      folders: []
    };
  }

  toJSON() {
    return {
      metadata: this.metadata,
      structure: this.structure
    };
  }
}

// Function to update the project state and notify the renderer process
function updateProjectState(window, projectPath, spfPath) {
  window.webContents.send('project:stateChange', { projectPath, spfPath });
}
// Context: IPC handlers for project creation, opening, and folder operations in an Electron application

ipcMain.handle('project:createStructure', async (event, projectPath, spfPath) => {
  try {
    // Create the project structure
    await fse.mkdir(projectPath, { recursive: true });
    const projectFile = new ProjectFile(projectPath);
    await fse.writeFile(spfPath, JSON.stringify(projectFile.toJSON(), null, 2));

    // Wait briefly to ensure the file system syncs
    await new Promise(resolve => setTimeout(resolve, 0));

    // Verify if the files exist
    const projectExists = await fse.pathExists(projectPath);
    const spfExists = await fse.pathExists(spfPath);

    if (!projectExists || !spfExists) {
      throw new Error('Failed to create project structure or .spf file');
    }

    // Read the files to confirm accessibility
    const files = await fse.readdir(projectPath, { withFileTypes: true });
    const fileList = files.map(file => ({
      name: file.name,
      isDirectory: file.isDirectory(),
      path: path.join(projectPath, file.name)
    }));

    const focusedWindow = BrowserWindow.getFocusedWindow();

    // Simulate the response of the showOpenDialog event
    focusedWindow.webContents.send('simulateOpenProject', {
      canceled: false,
      filePaths: [projectPath]
    });

    return { 
      success: true, 
      projectData: projectFile.toJSON(), 
      files: fileList,
      spfPath,
      projectPath
    };
  } catch (error) {
    console.error('Error creating project structure:', error);
    throw error;
  }
});

ipcMain.handle('project:open', async (_, spfPath) => {
  try {
    console.log('Opening project from:', spfPath);

    // If the file does not exist, attempt to correct the path
    if (!(await fse.pathExists(spfPath))) {
      const projectName = path.basename(spfPath, '.spf');
      const correctedSpfPath = path.join(path.dirname(spfPath), projectName, `${projectName}.spf`);
      console.log(`SPF file not found at ${spfPath}. Trying corrected path: ${correctedSpfPath}`);
      spfPath = correctedSpfPath;
      if (!(await fse.pathExists(spfPath))) {
        throw new Error(`SPF file not found at both original and corrected paths.`);
      }
    }

    // Set the current open project path - IMPORTANT!
    currentOpenProjectPath = spfPath;

    const spfContent = await fse.readFile(spfPath, 'utf8');
    const projectData = JSON.parse(spfContent);
    
    projectData.metadata.lastOpened = new Date().toISOString();

    const oldBasePath = projectData.structure.basePath;
    const basePathExists = await fse.pathExists(oldBasePath);

    // Update the project state
    projectState = {
      spfLoaded: true,
      projectPath: path.dirname(spfPath)
    };

    if (!basePathExists) {
      const newBasePath = path.dirname(spfPath);
      projectData.metadata.projectPath = newBasePath;
      projectData.structure.basePath = newBasePath;
      console.log(`Updating project path from ${oldBasePath} to ${newBasePath}`);
    }

    if (projectData.structure.processors) {
      projectData.structure.processors = await Promise.all(
        projectData.structure.processors.map(async processor => {
          const processorPath = path.join(projectData.structure.basePath, processor.name);
          const exists = await fse.pathExists(processorPath);
          return { ...processor, exists };
        })
      );
    } else {
      projectData.structure.processors = [];
    }

    if (!projectData.structure.folders) {
      projectData.structure.folders = [];
    }

    await fse.writeFile(spfPath, JSON.stringify(projectData, null, 2));

    const files = await fse.readdir(projectData.structure.basePath, { withFileTypes: true });
    const fileList = files.map(file => ({
      name: file.name,
      isDirectory: file.isDirectory(),
      path: path.join(projectData.structure.basePath, file.name)
    }));

    const focusedWindow = BrowserWindow.getFocusedWindow();
    updateProjectState(focusedWindow, projectData.structure.basePath, spfPath);
    
    // Notify the renderer process to enable the Processor Hub
    focusedWindow.webContents.send('project:processorHubState', { enabled: true });
    
    // Send processor list to the renderer 
    focusedWindow.webContents.send('project:processors', { 
      processors: projectData.structure.processors.map(p => p.name),
      projectPath: projectData.structure.basePath
    });

    return {
      projectData,
      files: fileList,
      spfPath
    };
  } catch (error) {
    console.error('Error opening project file:', error);
    throw error;
  }
});

ipcMain.handle('isDirectory', async (_, path) => {
  try {
    const stats = await fse.stat(path);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
});

// Verificar se há um arquivo .spf nos argumentos de linha de comando
const fileToOpen = process.argv.find(arg => arg.endsWith('.spf'));

// Função para lidar com o single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Alguém tentou executar uma segunda instância com um arquivo .spf
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      // Procurar por arquivos .spf nos argumentos
      const spfFile = commandLine.find(arg => arg.endsWith('.spf'));
      if (spfFile) {
        mainWindow.webContents.send('open-spf-file', { filePaths: [spfFile] });
      }
    }
  });
}

// Listar arquivos com uma extensão específica
ipcMain.handle('get-files-with-extension', async (event, folderPath, extension) => {
  try {
    // Verificar se o diretório existe
    const stats = await fs.stat(folderPath);
    if (!stats.isDirectory()) {
      throw new Error(`${folderPath} não é um diretório válido`);
    }

    // Ler os arquivos no diretório
    const files = await fs.readdir(folderPath);
    
    // Filtrar arquivos pela extensão e adicionar o caminho completo
    const filteredFiles = files
      .filter(file => file.toLowerCase().endsWith(extension.toLowerCase()))
      .map(file => path.join(folderPath, file));
    
    log.debug(`Arquivos com extensão ${extension} encontrados em ${folderPath}:`, filteredFiles);
    return filteredFiles;
  } catch (error) {
    log.error(`Erro ao obter arquivos com extensão ${extension}:`, error);
    throw error;
  }
});

// Verificar se um arquivo existe
ipcMain.handle('file-exists', async (event, filePath) => {
  try {
    await fs.access(filePath);
    log.debug(`Arquivo existe: ${filePath}`);
    return true;
  } catch (error) {
    log.debug(`Arquivo não existe: ${filePath}`);
    return false;
  }
});

// Handler for reading folder contents
ipcMain.handle('getFolderFiles', async (event, folderPath) => {
  try {
    if (!folderPath) {
      throw new Error('Folder path is required');
    }

    const files = await fse.readdir(folderPath, { withFileTypes: true });
    const fileList = files.map(file => ({
      name: file.name,
      isDirectory: file.isDirectory(),
      path: path.join(folderPath, file.name)
    }));

    return fileList;
  } catch (error) {
    console.error('Error reading folder:', error);
    throw new Error('Failed to read folder');
  }
});

//SAVE FILE

// In main.js
/*
ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
    return true;
  } catch (error) {
    throw error;
  }
});*/
// Context: IPC handlers for Verilog, BlockView, VCD, Icarus, and directory watching functionalities

// IPC handler to execute PowerShell commands for Verilog-related tasks
ipcMain.handle('execute-powershell', async () => {
  try {
    const commandsFolder = path.join(__dirname, 'commands');
    const commandFiles = [
      'command1.ps1', // Start WSL
      'command2.ps1', // Change directory
      'command3.ps1', // Display Verilator version
      'command4.ps1'  // Execute compilation
    ];

    let output = '';
    let errorOutput = '';

    for (const commandFile of commandFiles) {
      const commandPath = path.join(commandsFolder, commandFile);
      const commands = await fs.readFile(commandPath, 'utf8');
      const commandResult = await executePowerShell(commands);
      output += commandResult.output;
      errorOutput += commandResult.errorOutput;
    }

    return { output, errorOutput };
  } catch (error) {
    throw error;
  }
});

// Helper function to execute PowerShell commands
function executePowerShell(commands) {
  return new Promise((resolve, reject) => {
    const powershell = exec('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command -', (error) => {
      if (error) {
        reject(error);
      }
    });

    let output = '';
    let errorOutput = '';

    powershell.stdout.on('data', (data) => {
      output += data.toString();
    });

    powershell.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    powershell.on('close', () => {
      resolve({ output, errorOutput });
    });

    powershell.stdin.write(commands);
    powershell.stdin.end();
  });
}

// IPC handler to select a .cmm file
ipcMain.handle('select-cmm-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'CMM Files', extensions: ['cmm'] }]
  });

  return result.canceled ? null : result.filePaths[0];
});

// IPC handler to parse a .cmm file
ipcMain.handle('parse-cmm-file', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return parseProcessor(content);
  } catch (error) {
    console.error('Error reading file:', error);
    throw error;
  }
});

// Helper function to parse processor details from a .cmm file
function parseProcessor(content) {
  const lines = content.split('\n');
  const processor = {
    PRNAME: '',
    DIRNAM: '',
    NUBITS: 0,
    NDSTAC: 0,
    SDEPTH: 0,
    NUIOIN: 0,
    NUIOOU: 0,
    NBMANT: 0,
    NBEXPO: 0,
    FFTSIZ: 0,
    NUGAIN: 0,
    ITRAD: 0
  };

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('#')) {
      const [directive, ...valueParts] = trimmedLine.split(/\s+/);
      const directiveName = directive.substring(1);
      const value = valueParts[0];
      processor[directiveName] = isNaN(value) ? value : Number(value);
    }
  }

  return processor;
}

// IPC handler to open a dialog for selecting a .vcd file
ipcMain.handle('open-wave-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'VCD Files', extensions: ['vcd'] }]
  });

  return result.filePaths[0] || null;
});

// IPC handler to open GTKWave with a specified .vcd file
ipcMain.handle('open-gtkwave', async (event, filePath) => {
  if (!filePath) return;

  const command = `gtkwave "${filePath}"`;

  exec(command, (error) => {
    if (error) {
      console.error(`Error opening GTKWave: ${error.message}`);
    }
  });
});

// IPC handler to create a directory
ipcMain.handle('create-directory', async (event, dirPath) => {
  try {
    await fse.ensureDir(dirPath);
    return { success: true };
  } catch (error) {
    console.error('Error creating directory:', error);
    throw error;
  }
});

// IPC handler to write content to a file (improved with better error handling)
ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    // Ensure the directory exists
    const dir = path.dirname(filePath);
    await fse.ensureDir(dir);
    
    // Write the file
    await fse.writeFile(filePath, content);
    console.log(`File written successfully: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.error('Error writing file:', error);
    throw new Error(`Failed to write file: ${error.message}`);
  }
});

// IPC handler to ensure directory exists
ipcMain.handle('ensure-dir', async (event, dirPath) => {
  try {
    await fse.ensureDir(dirPath);
    return { success: true };
  } catch (error) {
    console.error('Error ensuring directory:', error);
    throw new Error(`Failed to create directory: ${error.message}`);
  }
});


// IPC handler to validate path
ipcMain.handle('validate-path', async (event, filePath) => {
  try {
    // Check if path is valid and accessible
    await fse.access(filePath);
    const stats = await fse.lstat(filePath);
    
    return {
      exists: true,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      readable: true,
      writable: true // This is a simplified check
    };
  } catch (error) {
    return {
      exists: false,
      isDirectory: false,
      isFile: false,
      readable: false,
      writable: false,
      error: error.message
    };
  }
});

// Directory watcher instance
let watcher = null;

// Helper function to recursively read a directory
function readDirectoryRecursive(dirPath) {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  return items.map(item => {
    const path = `${dirPath}/${item.name}`;
    if (item.isDirectory()) {
      return {
        name: item.name,
        type: 'directory',
        path,
        children: readDirectoryRecursive(path)
      };
    }
    return {
      name: item.name,
      type: 'file',
      path
    };
  });
}
// Context: IPC handlers for folder watching, configuration management, and utility functions in an Electron application

// IPC handler to watch a folder for changes
ipcMain.handle('watchFolder', async (event, folderPath) => {
  if (watcher) {
    await watcher.close(); // Close the previous watcher if it exists
  }

  watcher = chokidar.watch(folderPath, {
    ignored: /(^|[\/\\])\../, // Ignore hidden files
    persistent: true
  });

  watcher
    .on('add', path => event.sender.send('fileChanged', { type: 'add', path }))
    .on('unlink', path => event.sender.send('fileChanged', { type: 'unlink', path }))
    .on('addDir', path => event.sender.send('fileChanged', { type: 'addDir', path }))
    .on('unlinkDir', path => event.sender.send('fileChanged', { type: 'unlinkDir', path }))
    .on('change', path => event.sender.send('fileChanged', { type: 'change', path }));
});

// IPC handler to refresh the file tree
ipcMain.on('refresh-file-tree', (event) => {
  event.sender.send('trigger-refresh-file-tree'); // Notify renderer to refresh the file tree
});

// Define paths for configuration management
const appPath = app.getAppPath();
const rootPath = path.join(appPath, '..', '..'); // Navigate to the installation directory
const configDir = path.join(rootPath, 'saphoComponents', 'Scripts');
const configFilePath = path.join(configDir, 'processorConfig.json');

// Ensure the configuration directory exists
async function ensureConfigDir() {
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create configuration directory:', error);
  }
}

// IPC handler to load configuration
ipcMain.handle('load-config', async () => {
  await ensureConfigDir();
  try {
    // Check if config file exists
    try {
      await fs.access(configFilePath);
    } catch (error) {
      // If file doesn't exist, create a default config
      const defaultConfig = { 
        processors: [], 
        iverilogFlags: [],
        cmmCompFlags: [],
        asmCompFlags: [],
        isActive: []            
      };
      await fs.writeFile(configFilePath, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }

    const fileContent = await fs.readFile(configFilePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error('Failed to read configuration file:', error);
    return { 
      processors: [], 
      iverilogFlags: [],
      cmmCompFlags: [],
      asmCompFlags: [],
    };
  }
});


// IPC handler to save configuration
ipcMain.handle('save-config', async (event, data) => {
  await ensureConfigDir();
  try {
    await fs.writeFile(configFilePath, JSON.stringify(data, null, 2));
    console.log('Configuration saved at:', configFilePath);
    return { success: true };
  } catch (error) {
    console.error('Failed to save configuration file:', error);
    throw error;
  }
});


// IPC handler to join paths
ipcMain.handle('join-path', (event, ...paths) => {
  console.log('join-path called with:', paths);
  if (!paths.every(p => typeof p === 'string')) {
    throw new TypeError('All arguments to join-path must be strings');
  }
  if (paths[0] === 'saphoComponents') {
    return path.join(rootPath, ...paths);
  }
  return path.join(...paths);
});

// IPC handler to execute a shell command
ipcMain.handle('exec-command', (event, command) => {
  return new Promise((resolve, reject) => {
    const child = exec(command, {
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data;
    });

    child.stderr.on('data', (data) => {
      stderr += data;
    });

    child.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr
      });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
});
// Context: IPC handlers for file and directory operations, backup creation, and temporary file management

// IPC handler to create a directory
ipcMain.handle('mkdir', (event, dirPath) => {
  return fs.mkdir(dirPath, { recursive: true });
});

// IPC handler to copy a file
ipcMain.handle('copy-file', (event, src, dest) => {
  return fs.copyFile(src, dest);
});

// IPC handler to check if a directory exists
ipcMain.handle('directory-exists', async (event, dirPath) => {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
});

// IPC handler to get the application path
ipcMain.handle('getAppPath', () => {
  return app.getAppPath();
});

// IPC handler to read a directory
ipcMain.handle('readDir', async (event, dirPath) => {
  try {
    const files = await fs.readdir(dirPath);
    return files;
  } catch (error) {
    console.error('Error reading directory:', error);
    throw error;
  }
});

// IPC handler to open a folder in the system's file explorer
ipcMain.handle('folder:open', async (_, folderPath) => {
  try {
    await shell.openPath(folderPath);
    return { success: true };
  } catch (error) {
    console.error('Error opening folder:', error);
    return { success: false, error: error.message };
  }
});

// Context: Backup creation using 7-Zip
// IPC handler to create a backup of a folder
ipcMain.handle("create-backup", async (_, folderPath) => {
  if (!folderPath) {
    return { success: false, message: "No folder open for backup!" };
  }

  const folderName = path.basename(folderPath);
  const backupFolderPath = path.join(folderPath, "Backup");
  const timestamp = moment().format("YYYY-MM-DD_HH-mm-ss");
  const tempBackupFolderName = `backup_${timestamp}`;
  const tempBackupFolderPath = path.join(folderPath, tempBackupFolderName);
  const zipFileName = `${folderName}_${timestamp}.7z`;
  const zipFilePath = path.join(backupFolderPath, zipFileName);

  try {
    await fse.ensureDir(backupFolderPath);
    await fse.ensureDir(tempBackupFolderPath);

    const files = await fse.readdir(folderPath);
    for (let file of files) {
      const sourcePath = path.join(folderPath, file);
      const destPath = path.join(tempBackupFolderPath, file);
      if (file !== "Backup" && file !== tempBackupFolderName) {
        await fse.copy(sourcePath, destPath);
      }
    }

    const command = `"${sevenZipPath}" a "${zipFilePath}" "${tempBackupFolderName}"`;

    return new Promise((resolve) => {
      exec(command, { cwd: folderPath }, async (error, stdout, stderr) => {
        if (error) {
          console.error("Error creating backup:", stderr);
          resolve({ success: false, message: "Error creating backup." });
        } else {
          try {
            await fse.remove(tempBackupFolderPath);
          } catch (deleteError) {
            console.error("Error deleting temporary backup folder:", deleteError);
          }
          resolve({ success: true, message: `Backup created at: ${zipFilePath}` });
        }
      });
    });

  } catch (error) {
    console.error("Error creating backup:", error);
    return { success: false, message: "Error creating backup." };
  }
});

// Path to 7-Zip executable
const sevenZipPath = "7z";

app.whenReady().then(() => {
  // Código existente...
  
  // Garantir que a pasta js existe para o gerenciador de blocos Verilog
  const jsDir = path.join(app.getAppPath(), 'js');
  if (!fs.existsSync(jsDir)) {
    fs.mkdirSync(jsDir, { recursive: true });
  }
  
  // Criar o arquivo verilog-block-manager.js se ele não existir
  const verilogBlockManagerPath = path.join(jsDir, 'verilog-block-manager.js');
  if (!fs.existsSync(verilogBlockManagerPath)) {
    fs.copyFileSync(
      path.join(app.getAppPath(), 'js', 'verilog-block-manager.js'),
      verilogBlockManagerPath
    );
  }
});

// IPC handler to clear the Temp folder
ipcMain.handle('clear-temp-folder', async () => {
  try {
    const tempFolderPath = path.join(rootPath, 'saphoComponents', 'Temp');
    await fs.rmdir(tempFolderPath, { recursive: true });
    await fs.mkdir(tempFolderPath, { recursive: true }); // Recreate the empty folder
    return { success: true };
  } catch (error) {
    console.error('Failed to clear temp folder:', error);
    throw error;
  }
});

// IPC handler to create a TCL info file
ipcMain.handle('create-tcl-info-file', async (event, { path: filePath, processorType, tempPath, binPath }) => {
  try {
    await fs.mkdir(tempPath, { recursive: true });
    const content = `${processorType}\n${tempPath}\n${binPath}\n`;
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    console.error('Failed to create tcl_infos.txt:', error);
    throw error;
  }
});

// IPC handler to delete a TCL info file
ipcMain.handle('delete-tcl-file', async (event, filePath) => {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to delete tcl_infos.txt:', error);
      throw error;
    }
    return false;
  }
});
// Context: IPC handlers for app information, folder operations, Verilog file creation, terminal interaction, and external links

// Handler to get app information
ipcMain.handle('get-app-info', () => {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    osInfo: `${os.type()} ${os.release()} (${os.arch()})`
  };
});

// Handler to delete a folder
ipcMain.handle('delete-folder', async (_, folderPath) => {
  return new Promise((resolve, reject) => {
    process.nextTick(async () => {
      try {
        await fs.rm(folderPath, { recursive: true, force: true });
        resolve(true);
      } catch (error) {
        log.error('Error deleting folder:', error);
        reject(error);
      }
    });
  });
});

// Handler to start a terminal (CMD) process
ipcMain.on('start-terminal', (event) => {
  const shell = spawn('cmd.exe', [], {
    env: process.env,
    cwd: process.env.USERPROFILE || process.env.HOME,
    windowsHide: true
  });

  const webContents = event.sender;
  const terminalId = Date.now().toString();

  shell.stdout.on('data', (data) => {
    webContents.send('terminal-output', { id: terminalId, data: data.toString() });
  });

  shell.stderr.on('data', (data) => {
    webContents.send('terminal-output', { id: terminalId, data: data.toString() });
  });

  shell.on('exit', (code) => {
    webContents.send('terminal-exit', { id: terminalId, code });
  });

  webContents.send('terminal-started', { id: terminalId });

  ipcMain.on('terminal-input', (event, data) => {
    if (data.id === terminalId && shell.stdin.writable) {
      shell.stdin.write(data.data);
    }
  });
});

// Electron app lifecycle events
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Handler to open a browser with a specific URL
ipcMain.on('open-browser', () => {
  const { shell } = require('electron');
  shell.openExternal('https://nipscern.com');
});

ipcMain.on('open-github-desktop', () => {
  const githubPath = path.join(
    process.env.LOCALAPPDATA,
    'GitHubDesktop',
    'GitHubDesktop.exe'
  );
  shell.openPath(githubPath);
});


// Handler to quit the app with a delay
ipcMain.on('quit-app', () => {
  setTimeout(() => {
    app.quit();
  }, 5000);
});


// Update the handler in the main process (main.js)
// Handler to get simulation files (.v and .gtkw) from the processor's Simulation folder
ipcMain.handle('get-simulation-files', async (_, processorName, projectPath) => {
  try {
    console.log('------- GET SIMULATION FILES -------');
    console.log(`Received parameters: processorName=${processorName}, projectPath=${projectPath}`);
    
    // Check if a valid project path was provided directly
    if (!projectPath) {
      console.warn("No project path provided in the function call");
      
      // Fall back to global variables
      if (global.currentProject && global.currentProject.path) {
        projectPath = global.currentProject.path;
        console.log(`Using global currentProject.path: ${projectPath}`);
      } else if (global.currentProjectPath) {
        projectPath = global.currentProjectPath;
        console.log(`Using global currentProjectPath: ${projectPath}`);
      } else {
        console.error("No project path available from any source");
        return { 
          success: false, 
          message: "No project path available", 
          testbenchFiles: [], 
          gtkwFiles: [] 
        };
      }
    }
    
    console.log(`Using project path: ${projectPath}`);
    
    if (!processorName) {
      console.warn("No processor name provided");
      return { 
        success: false, 
        message: "No processor name provided", 
        testbenchFiles: [], 
        gtkwFiles: [] 
      };
    }
    
    const processorPath = path.join(projectPath, processorName);
    console.log(`Processor path: ${processorPath}`);
    
    // Check if processor directory exists
    const processorExists = await fse.pathExists(processorPath);
    console.log(`Processor directory exists: ${processorExists}`);
    
    if (!processorExists) {
      console.warn(`Processor directory does not exist: ${processorPath}`);
      return { 
        success: false, 
        message: "Processor directory not found", 
        testbenchFiles: [], 
        gtkwFiles: [] 
      };
    }
    
    const simulationPath = path.join(processorPath, "Simulation");
    console.log(`Looking for simulation files in: ${simulationPath}`);
    
    // Check if Simulation directory exists
    const simulationExists = await fse.pathExists(simulationPath);
    console.log(`Simulation directory exists: ${simulationExists}`);
    
    if (!simulationExists) {
      console.warn(`Simulation directory does not exist: ${simulationPath}`);
      
      // Log all available directories in the processor folder to help with debugging
      const processorDirs = await fse.readdir(processorPath);
      console.log(`Available directories in processor folder: ${processorDirs.join(', ')}`);
      
      return { 
        success: false, 
        message: "Simulation directory not found", 
        testbenchFiles: [], 
        gtkwFiles: [] 
      };
    }
    
    // Read files in the Simulation directory
    const files = await fse.readdir(simulationPath);
    console.log(`All files in Simulation directory: ${files.join(', ')}`);
    
    // Filter by extension
    const testbenchFiles = files.filter(file => file.toLowerCase().endsWith('.v'));
    const gtkwFiles = files.filter(file => file.toLowerCase().endsWith('.gtkw'));
    
    console.log(`Found ${testbenchFiles.length} testbench files: ${testbenchFiles.join(', ')}`);
    console.log(`Found ${gtkwFiles.length} GTKWave files: ${gtkwFiles.join(', ')}`);
    
    return { 
      success: true, 
      processorPath,
      simulationPath,
      testbenchFiles,
      gtkwFiles
    };
  } catch (error) {
    console.error("Error getting simulation files:", error);
    return { 
      success: false, 
      message: `Error: ${error.message}`,
      testbenchFiles: [],
      gtkwFiles: []
    };
  }
});


// New handler to set current project path in the main process
ipcMain.handle('set-current-project', (_, projectPath) => {
  try {
    if (!projectPath) {
      console.warn("set-current-project: No project path provided");
      return { success: false, message: "No project path provided" };
    }
    
    console.log(`Setting current project path to: ${projectPath}`);
    
    // Update global variables
    global.currentProjectPath = projectPath;
    
    // Also update the currentProject object if it exists
    if (!global.currentProject) {
      global.currentProject = {};
    }
    global.currentProject.path = projectPath;
    
    // Store the path in a file for persistence
    const appDataPath = app.getPath('userData');
    fs.writeFileSync(
      path.join(appDataPath, 'lastProject.json'), 
      JSON.stringify({ path: projectPath }, null, 2)
    );
    
    console.log("Current project path successfully set");
    return { success: true };
  } catch (error) {
    console.error("Error setting current project path:", error);
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Helper function to recursively copy directories
async function copyDir(src, dest) {
  // Create destination directory
  await fs.promises.mkdir(dest, { recursive: true });
  
  // Read source directory contents
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  
  // Process each entry
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      // Recursively copy subdirectories
      await copyDir(srcPath, destPath);
    } else {
      // Copy files
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

ipcMain.handle('refactor-code', async (event, code) => {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');

    const clang = spawn('clang-format', ['-style=LLVM']);

    let formatted = '';
    let errorOutput = '';

    clang.stdout.on('data', (data) => {
      formatted += data.toString();
    });

    clang.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    clang.on('close', (code) => {
      if (code === 0) {
        resolve(formatted);
      } else {
        console.error('clang-format error:', errorOutput);
        reject(new Error('clang-format failed'));
      }
    });

    clang.stdin.write(code);
    clang.stdin.end();
  });
});

// Converte funções de callback do fs para Promise
const fsPromises = {
  mkdir: promisify(fs.mkdir),
  writeFile: promisify(fs.writeFile),
  rename: promisify(fs.rename),
  rm: promisify(fs.rm),
  stat: promisify(fs.stat)
};

// Handlers

// Create file handler
ipcMain.handle('file:create', async (event, filePath) => {
  try {
    console.log(`Creating file: ${filePath}`);
    
    // Normalize and resolve the path
    const normalizedPath = path.resolve(path.normalize(filePath));
    console.log(`Normalized path: ${normalizedPath}`);
    
    // Ensure parent directory exists
    const parentDir = path.dirname(normalizedPath);
    await fs.mkdir(parentDir, { recursive: true });
    
    // Create the file with empty content
    await fs.writeFile(normalizedPath, '', 'utf8');
    
    console.log(`File created successfully: ${normalizedPath}`);
    return { success: true, path: normalizedPath };
  } catch (error) {
    console.error('Error creating file:', error);
    throw new Error(`Failed to create file: ${error.message}`);
  }
});

// Create directory handler
ipcMain.handle('directory:create', async (event, dirPath) => {
  try {
    console.log(`Creating directory: ${dirPath}`);
    
    // Normalize and resolve the path
    const normalizedPath = path.resolve(path.normalize(dirPath));
    console.log(`Normalized path: ${normalizedPath}`);
    
    // Create directory recursively
    await fs.mkdir(normalizedPath, { recursive: true });
    
    console.log(`Directory created successfully: ${normalizedPath}`);
    return { success: true, path: normalizedPath };
  } catch (error) {
    console.error('Error creating directory:', error);
    throw new Error(`Failed to create directory: ${error.message}`);
  }
});

// Rename file or directory handler
ipcMain.handle('file:rename', async (event, oldPath, newPath) => {
  try {
    console.log(`Renaming from: ${oldPath} to: ${newPath}`);
    
    // Normalize and resolve paths
    const normalizedOldPath = path.resolve(path.normalize(oldPath));
    const normalizedNewPath = path.resolve(path.normalize(newPath));
    
    console.log(`Normalized old path: ${normalizedOldPath}`);
    console.log(`Normalized new path: ${normalizedNewPath}`);
    
    // Check if old path exists
    try {
      await fs.access(normalizedOldPath);
    } catch (error) {
      throw new Error(`Source path does not exist: ${normalizedOldPath}`);
    }
    
    // Check if new path already exists
    try {
      await fs.access(normalizedNewPath);
      throw new Error(`Destination path already exists: ${normalizedNewPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // ENOENT is expected - the new path should not exist
    }
    
    // Ensure parent directory exists for new path
    const parentDir = path.dirname(normalizedNewPath);
    await fs.mkdir(parentDir, { recursive: true });
    
    // Perform the rename
    await fs.rename(normalizedOldPath, normalizedNewPath);
    
    console.log(`Rename completed successfully`);
    return { success: true, oldPath: normalizedOldPath, newPath: normalizedNewPath };
  } catch (error) {
    console.error('Error renaming:', error);
    throw new Error(`Failed to rename: ${error.message}`);
  }
});

// Delete file or directory handler
ipcMain.handle('file:delete', async (event, filePath) => {
  try {
    console.log(`Attempting to delete: ${filePath}`);
    
    // Normalize and resolve the path
    const normalizedPath = path.resolve(path.normalize(filePath));
    console.log(`Normalized path: ${normalizedPath}`);
    
    // Check if the path exists and get stats
    let stats;
    try {
      stats = await fs.stat(normalizedPath);
    } catch (statError) {
      if (statError.code === 'ENOENT') {
        console.log(`Path does not exist (already deleted?): ${normalizedPath}`);
        return { success: true, alreadyDeleted: true };
      }
      throw new Error(`Cannot access path: ${statError.message}`);
    }
    
    if (stats.isDirectory()) {
      console.log(`Deleting directory: ${normalizedPath}`);
      await fs.rm(normalizedPath, { 
        recursive: true, 
        force: true,
        maxRetries: 3,
        retryDelay: 100
      });
    } else {
      console.log(`Deleting file: ${normalizedPath}`);
      await fs.unlink(normalizedPath);
    }
    
    console.log(`Successfully deleted: ${normalizedPath}`);
    return { success: true, path: normalizedPath };
  } catch (error) {
    console.error(`Error deleting ${filePath}:`, error);
    throw new Error(`Failed to delete: ${error.message}`);
  }
});

// Check if file/directory exists
ipcMain.handle('file:exists', async (event, filePath) => {
  try {
    const normalizedPath = path.resolve(path.normalize(filePath));
    await fs.access(normalizedPath, fs.constants.F_OK);
    console.log(`File exists check: ${normalizedPath} - EXISTS`);
    return true;
  } catch (error) {
    console.log(`File exists check: ${filePath} - DOES NOT EXIST (${error.code})`);
    return false;
  }
});

// Get parent directory
ipcMain.handle('file:get-parent', async (event, filePath) => {
  const normalizedPath = path.resolve(path.normalize(filePath));
  const parentPath = path.dirname(normalizedPath);
  console.log(`Parent of ${normalizedPath} is ${parentPath}`);
  return parentPath;
});

// Check if path is directory
ipcMain.handle('file:is-directory', async (event, filePath) => {
  try {
    const normalizedPath = path.resolve(path.normalize(filePath));
    const stats = await fs.stat(normalizedPath);
    return stats.isDirectory();
  } catch (error) {
    console.error('Error checking if path is directory:', error);
    return false;
  }
});

// File path constants
const USER_DATA_PATH = app.getPath('userData');

// File read handler
ipcMain.handle('file:read', async (event, filePath) => {
  try {
    // Try first to read from project root
    const projectRoot = path.resolve(__dirname);
    const fullPath = path.join(projectRoot, filePath);
    
    console.log('Reading file from:', fullPath);
    
    const content = await fs.readFile(fullPath, 'utf8');
    return content;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet
      console.log('File not found, returning empty string');
      return '';
    }
    console.error('Error reading file:', error);
    throw error;
  }
});

// Adicione também o handler para o diálogo de confirmação
ipcMain.handle('dialog:confirm', async (event, title, message) => {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Não', 'Sim'],
    title: title,
    message: message
  });
  return response === 1; // Retorna true se o usuário clicar em "Sim"
});

ipcMain.on('app:reload', () => {
  app.relaunch();
  app.exit(0);
});



ipcMain.handle('save-theme', async (event, themeData) => {
  // Salvar themeData no arquivo CSS
});


//TESTE =====================================================================================
// Command execution handlers

// Alternative command execution with more control
ipcMain.handle('run-command', async (event, { command, args = [], options = {} }) => {
  return new Promise((resolve) => {
    console.log('Running command:', command, 'with args:', args);
    
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        code
      });
    });
    
    child.on('error', (error) => {
      resolve({
        success: false,
        stdout,
        stderr: stderr + error.message,
        code: 1,
        error: error.message
      });
    });
    
    // Set timeout
    setTimeout(() => {
      if (!child.killed) {
        child.kill();
        resolve({
          success: false,
          stdout,
          stderr: stderr + 'Command timed out',
          code: 1,
          error: 'Command execution timed out'
        });
      }
    }, options.timeout || 30000);
  });
});

ipcMain.handle('path-exists', async (event, filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// Temporary file operations
ipcMain.handle('get-temp-dir', async () => {
  return os.tmpdir();
});

ipcMain.handle('create-temp-file', async (event, content, extension) => {
  try {
    const tempDir = os.tmpdir();
    const fileName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
    const filePath = path.join(tempDir, fileName);
    
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  } catch (error) {
    throw new Error(`Failed to create temp file: ${error.message}`);
  }
});

ipcMain.handle('delete-temp-file', async (event, filePath) => {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    console.warn('Failed to delete temp file:', error.message);
    return false;
  }
});

// Enhanced file deletion
ipcMain.handle('delete-file-or-directory', async (event, itemPath) => {
  try {
    const stats = await fs.stat(itemPath);
    
    if (stats.isDirectory()) {
      await fs.rmdir(itemPath, { recursive: true });
    } else {
      await fs.unlink(itemPath);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Failed to delete item:', error);
    return { success: false, error: error.message };
  }
});
