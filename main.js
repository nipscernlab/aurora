/*
 *    MAIN.JS FILE REQUIRED BY ELECTRON ƒ 
*/

/*
 * 
 *    START: ALL IMPORTS AND CONST ƒ 
 * 
 * -
*/ 

const { app, BrowserWindow, ipcMain, shell, Tray, nativeImage, dialog, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const { exec, spawn } = require('child_process');
const path = require('path');
const fse = require('fs-extra');
const fs = require('fs').promises;
const os = require('os');
const moment = require("moment");
const electronFs = require('original-fs');
const url = require('url');
const log = require('electron-log');
log.transports.file.level = 'debug';
const { promisify } = require('util');
const chokidar = require('chokidar'); // You'll need to install: npm install chokidar
require('./js/preload_prism.js');
require('./js/preload_prism.js');

const isDev = process.env.NODE_ENV === 'development';

const settingsPath = path.join(__dirname, 'saphoComponents', 'Scripts' ,'settings.json');


let progressWindow = null;
let downloadInProgress = false;
let updateCheckInProgress = false;
let updateAvailable = false;
let updateInfo = null;
let updateSystemInitialized = false;

// Configure auto-updater logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// Configure auto-updater settings
autoUpdater.autoDownload = false; // We want to ask user first
autoUpdater.autoInstallOnAppQuit = false; // We want to control installation

// Variable to track the current open project path
let currentOpenProjectPath = null;

// Global variables for app state
let tray = null;
let settingsWindow = null;
let isQuitting = false;

let mainWindow, splashWindow;


/*
 * 
 *    END: ALL IMPORTS AND CONST ƒ
 * 
 * 
*/


/*
 * 
 *    START: WINDOW CREATION ƒ
 * 
 * 
*/

// Function to create the main application window
async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: false,
    icon: path.join(__dirname, 'assets/icons/sapho_aurora_icon.ico'),
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
  app.on('before-quit', async () => {
  isQuitting = true;

  if (tray) {
    tray.destroy();
    tray = null;
  }

  try {
    const tempFolderPath = path.join(rootPath, 'saphoComponents', 'Temp');
    await fs.rm(tempFolderPath, { recursive: true, force: true });
    await fs.mkdir(tempFolderPath, { recursive: true });
    console.log('Temp folder successfully cleared before quitting.');
  } catch (error) {
    console.error('Failed to clear Temp folder on app exit:', error);
  }
});


  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    
    // Inicializar sistema de updates com delay
    setTimeout(() => {
      initializeUpdateSystem();
    }, 2000);
  });
}


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

/* Enhanced update checking with better error handling
function checkForUpdates(showNoUpdateDialog = false) {
  if (updateCheckInProgress) {
    log.info('Update check already in progress');
    return;
  }

  if (isDev) {
    log.info('Skipping update check in development mode');
    return;
  }

  updateCheckInProgress = true;
  log.info('Checking for updates...');

  autoUpdater.allowPrerelease = false;
  autoUpdater.channel = 'latest';
  autoUpdater.showNoUpdateDialog = showNoUpdateDialog;

  clearUpdateCache().then(() => {
    log.info('Cache cleared, starting update check...');
    autoUpdater.checkForUpdates().catch((error) => {
      log.error('Error during update check:', error);
      updateCheckInProgress = false;
    });
  }).catch((error) => {
    log.error('Failed to clear update cache:', error);
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('Error during update check after cache clear failure:', err);
      updateCheckInProgress = false;
    });
  });
}
*/
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
    
    log.info('Update cache cleared successfully');
  } catch (error) {
    log.error('Error clearing update cache:', error);
    throw error;
  }
}

function setupAutoUpdaterEvents() {
  // CORREÇÃO: Limpar listeners existentes
  autoUpdater.removeAllListeners();
  
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    updateCheckInProgress = true;
  });

  autoUpdater.on('update-available', async (info) => {
    updateCheckInProgress = false;
    updateAvailable = true;
    updateInfo = info;
    
    log.info(`New version available: ${info.version}, current version: ${app.getVersion()}`);
    
    if (!mainWindow || mainWindow.isDestroyed()) {
      log.error('Main window not available for update dialog');
      return;
    }

    const releaseNotes = info.releaseNotes || 'No release notes available';
    const updateSize = info.files && info.files[0] ? 
      `(${(info.files[0].size / 1048576).toFixed(1)} MB)` : '';
    
    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version is available!`,
        detail: `Current Version: ${app.getVersion()}\nNew Version: ${info.version} ${updateSize}\n\nWould you like to download and install it now?\n\nRelease Notes:\n${typeof releaseNotes === 'string' ? releaseNotes : 'Check GitHub for details'}`,
        buttons: ['Download Now', 'Download Later'],
        defaultId: 0,
        cancelId: 1,
        icon: path.join(__dirname, 'assets/icons/sapho_aurora_icon.ico')
      });

      if (response === 0) {
        startUpdateDownload();
      } else {
        log.info('User chose to download update later');
      }
    } catch (error) {
      log.error('Error showing update dialog:', error);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    updateCheckInProgress = false;
    updateAvailable = false;
    log.info('No updates available');
    
    if (autoUpdater.showNoUpdateDialog && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'No Updates Available',
        message: 'Aurora IDE is up to date!',
        detail: `You are running the latest version (${app.getVersion()}).`,
        buttons: ['OK'],
        icon: path.join(__dirname, 'assets/icons/sapho_aurora_icon.ico')
      }).catch((error) => {
        log.error('Error showing no update dialog:', error);
      });
    }
    autoUpdater.showNoUpdateDialog = false;
  });

  // Download progress event with enhanced tracking
   autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    const transferred = (progressObj.transferred / 1048576).toFixed(1);
    const total = (progressObj.total / 1048576).toFixed(1);
    const bytesPerSecond = progressObj.bytesPerSecond || 0;
    const speed = (bytesPerSecond / 1048576).toFixed(1);
    
    log.info(`Download progress: ${percent}% (${transferred}/${total} MB) at ${speed} MB/s`);
    
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.webContents.send('update-progress', {
        percent: percent,
        transferred: transferred,
        total: total,
        speed: parseFloat(speed),
        bytesPerSecond: bytesPerSecond
      });
    }
  });

  // Update downloaded event
  autoUpdater.on('update-downloaded', async (info) => {
    downloadInProgress = false;
    
    log.info('Update downloaded successfully');
    
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.close();
      progressWindow = null;
    }

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready to Install',
      message: 'The update has been downloaded successfully!',
      detail: `Version ${info.version} is ready to be installed. Aurora IDE will restart to complete the installation.`,
      buttons: ['Install Now', 'Install Later'],
      defaultId: 0,
      cancelId: 1,
      icon: path.join(__dirname, 'assets/icons/sapho_aurora_icon.ico')
    });

    if (response === 0) {
      log.info('User chose to install update now');
      setImmediate(() => {
        autoUpdater.quitAndInstall(false, true);
      });
    } else {
      log.info('User chose to install update later');
    }
  });

  autoUpdater.on('error', async (error) => {
    updateCheckInProgress = false;
    downloadInProgress = false;
    
    log.error('Update error:', error);
    
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.close();
      progressWindow = null;
    }

    let errorMessage = 'An error occurred while checking for updates.';
    
    if (error.message.includes('net::')) {
      errorMessage = 'Unable to connect to the update server. Please check your internet connection.';
    } else if (error.message.includes('signature')) {
      errorMessage = 'Update verification failed. Please try again later.';
    } else if (error.message.includes('ENOSPC')) {
      errorMessage = 'Not enough disk space to download the update.';
    } else if (error.message.includes('EACCES')) {
      errorMessage = 'Permission denied. Please run as administrator or check file permissions.';
    }

    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Update Error',
      message: 'Update Failed',
      detail: `${errorMessage}\n\nError details: ${error.message}`,
      buttons: ['OK'],
      icon: path.join(__dirname, 'assets/icons/sapho_aurora_icon.ico')
    });
  });

  autoUpdater.on('before-quit-for-update', () => {
    log.info('Application will quit for update installation');
  });
}

// Start the update download process
function startUpdateDownload() {
  if (downloadInProgress) {
    log.info('Download already in progress');
    return;
  }
  
  if (!updateAvailable) {
    log.info('No update available to download');
    return;
  }

  downloadInProgress = true;
  log.info('Starting update download...');
  
  createProgressWindow();
  
  autoUpdater.downloadUpdate().catch((error) => {
    log.error('Failed to start download:', error);
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
    //checkForUpdates(true); // Show "no update" dialog for manual checks
  });

  // Handle cancel download request
  ipcMain.handle('cancel-update-download', () => {
    if (downloadInProgress && progressWindow) {
      downloadInProgress = false;
      progressWindow.close();
      progressWindow = null;
      log.info('Update download cancelled by user');
      // Note: electron-updater doesn't have a direct cancel method
      // The download will continue in background but UI will be hidden
    }
  });

  // Get current app version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Get update status
  ipcMain.handle('get-update-status', () => {
    return {
      updateAvailable,
      updateInfo,
      downloadInProgress,
      updateCheckInProgress
    };
  });

  // Force download update (if available)
  ipcMain.handle('download-update', () => {
    if (updateAvailable && !downloadInProgress) {
      startUpdateDownload();
      return { success: true };
    }
    return { success: false, reason: 'No update available or download in progress' };
  });
}

function initializeUpdateSystem() {
  if (updateSystemInitialized) {
    log.info('Update system already initialized');
    return;
  }
  updateSystemInitialized = true;
  
  log.info('Initializing update system...');
  
  // Configurar o autoUpdater ANTES de configurar os eventos
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  
  // CORREÇÃO: Remover autoUpdater.removeAllListeners() se existir
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'nipscernlab',
    repo: 'Aurora',
    releaseType: 'release'
  });
  
  setupAutoUpdaterEvents();
  setupIpcHandlers();
  
  // CORREÇÃO: Verificar se já foi inicializado antes de fazer check
  setTimeout(() => {
    if (!isDev && !updateCheckInProgress) {
      log.info('Starting initial update check...');
     // checkForUpdates(false);
    } else {
      log.info('Skipping update check - dev mode or already in progress');
    }
  }, 5000);
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

  function handleZoom(mainWindow, factorChange) {
  if (mainWindow) {
    const webContents = mainWindow.webContents;
    const currentZoom = webContents.getZoomFactor();
    const newZoom = Math.max(0.2, currentZoom + factorChange); // Impede zoom menor que 20%
    webContents.setZoomFactor(newZoom);
  }
}


ipcMain.on('zoom-in', () => {
  handleZoom(mainWindow, 0.1); // Aumenta o zoom em 10%
});

ipcMain.on('zoom-out', () => {
  handleZoom(mainWindow, -0.1); // Diminui o zoom em 10%
});

ipcMain.on('zoom-reset', () => {
  if (mainWindow) {
    mainWindow.webContents.setZoomFactor(1.0); // Reseta para 100%
  }
});
// Function to create a splash screen
function createSplashScreen() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 500,
    icon: path.join(__dirname, 'assets/icons/sapho_aurora_icon.ico'),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true },
  });

  splashWindow.loadFile(path.join(__dirname, 'html', 'splash.html'));
  setTimeout(() => {
    splashWindow.close(); // Close splash screen
    createMainWindow(); // Create main application window
    //setTimeout(checkForUpdates, 2000); // Check for updates after a delay
  }, 4000);
}

// Initialize the application when ready
app.whenReady().then(createSplashScreen);

/*
 * 
 *    END: WINDOW CREATION ƒ
 * 
 * 
*/

/*
 * 
 *    START: COMPILATION ƒ
 * 
 * 
*/

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

// Get system capabilities
const getCPUCount = () => os.cpus().length;
const getTotalMemory = () => Math.floor(os.totalmem() / (1024 * 1024 * 1024)); // GB

// Enhanced exec-command handler with performance optimization
ipcMain.handle('exec-command', (event, command, options = {}) => {
  return new Promise((resolve, reject) => {
    const performanceOptions = {
      maxBuffer: 1024 * 1024 * 50, // 50MB buffer (increased)
      windowsHide: true, // Hide window on Windows for better performance
      env: {
        ...process.env,
        // Set environment variables for better performance
        OMP_NUM_THREADS: getCPUCount().toString(),
        OMP_THREAD_LIMIT: getCPUCount().toString(),
        IVERILOG_DUMPER: 'fst', // Use FST format for better performance
        ...options.env
      }
    };

    const child = exec(command, performanceOptions);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
    });

    child.stderr.on('data', (data) => {
      const errorOutput = data.toString();
      stderr += errorOutput;
    });

    child.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr,
        pid: child.pid
      });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
});

// High-performance VVP execution handler
ipcMain.handle('exec-vvp-optimized', (event, command, workingDir, options = {}) => {
  return new Promise((resolve, reject) => {
    const cpuCount = getCPUCount();
    const totalMemory = getTotalMemory();
    
    // Enhanced environment variables for maximum performance
    const performanceEnv = {
      ...process.env,
      // Threading and parallel processing
      OMP_NUM_THREADS: cpuCount.toString(),
      OMP_THREAD_LIMIT: cpuCount.toString(),
      OMP_DYNAMIC: 'true',
      OMP_NESTED: 'true',
      
      // Memory optimization
      OMP_STACKSIZE: '64M',
      
      // Verilog-specific optimizations
      IVERILOG_DUMPER: 'fst',
      VVP_PARALLEL: '1',
      VVP_THREADS: cpuCount.toString(),
      
      // System-level optimizations
      MALLOC_ARENA_MAX: '1',
      MALLOC_MMAP_THRESHOLD: '131072',
      
      // Windows-specific optimizations
      PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE,
      NUMBER_OF_PROCESSORS: cpuCount.toString(),
      
      ...options.env
    };

    // Enhanced exec options for maximum performance
    const execOptions = {
      cwd: workingDir,
      env: performanceEnv,
      maxBuffer: 1024 * 1024 * 50, // 50MB buffer
      windowsHide: true,
      encoding: 'utf8'
    };

    console.log(`Starting VVP with optimized settings:`);
    console.log(`- CPU Cores: ${cpuCount}`);
    console.log(`- Memory: ${totalMemory}GB`);
    console.log(`- Working Directory: ${workingDir}`);
    console.log(`- Command: ${command}`);

    const child = exec(command, execOptions);

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';

    // Send process info immediately
    event.sender.send('command-output-stream', { 
      type: 'pid', 
      pid: child.pid,
      cpuCount: cpuCount,
      memory: totalMemory
    });

    const processOutput = (buffer, type) => {
      const lines = buffer.split('\n');
      
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (line.trim()) {
          event.sender.send('command-output-stream', { 
            type: type, 
            data: line + '\n'
          });
        }
      }
      
      return lines[lines.length - 1];
    };

    child.stdout.on('data', (data) => {
      const output = data.toString('utf8');
      stdout += output;
      stdoutBuffer += output;
      
      stdoutBuffer = processOutput(stdoutBuffer, 'stdout');
      
      // Immediate progress reporting
      if (output.includes('Progress:') || output.includes('%') || 
          output.includes('complete') || output.includes('VCD')) {
        if (stdoutBuffer.trim()) {
          event.sender.send('command-output-stream', { 
            type: 'stdout', 
            data: stdoutBuffer 
          });
          stdoutBuffer = '';
        }
      }
    });

    child.stderr.on('data', (data) => {
      const errorOutput = data.toString('utf8');
      stderr += errorOutput;
      stderrBuffer += errorOutput;
      
      stderrBuffer = processOutput(stderrBuffer, 'stderr');
    });

    child.on('close', (code) => {
      // Send any remaining buffered output
      if (stdoutBuffer.trim()) {
        event.sender.send('command-output-stream', { 
          type: 'stdout', 
          data: stdoutBuffer 
        });
      }
      if (stderrBuffer.trim()) {
        event.sender.send('command-output-stream', { 
          type: 'stderr', 
          data: stderrBuffer 
        });
      }
      
      resolve({ 
        code, 
        stdout, 
        stderr, 
        pid: child.pid,
        performance: {
          cpuCount: cpuCount,
          memory: totalMemory
        }
      });
    });

    child.on('error', (err) => {
      reject(err);
    });

    // Set process priority to high (Windows)
    if (process.platform === 'win32') {
      setTimeout(() => {
        try {
          const { exec } = require('child_process');
          exec(`wmic process where processid=${child.pid} CALL setpriority "high priority"`);
        } catch (priorityError) {
          console.warn('Could not set high priority:', priorityError);
        }
      }, 100);
    }
  });
});

// Enhanced exec-command-stream with performance optimizations
ipcMain.handle('exec-command-stream', (event, command, workingDir = null, options = {}) => {
  return new Promise((resolve, reject) => {
    const cpuCount = getCPUCount();
    const totalMemory = getTotalMemory();
    
    const performanceOptions = {
      maxBuffer: 1024 * 1024 * 100, // 100MB buffer
      encoding: 'utf8',
      cwd: workingDir,
      env: {
        ...process.env,
        OMP_NUM_THREADS: cpuCount.toString(),
        OMP_THREAD_LIMIT: cpuCount.toString(),
        OMP_DYNAMIC: 'true',
        IVERILOG_DUMPER: 'fst',
        VVP_PARALLEL: '1',
        VVP_THREADS: cpuCount.toString(),
        NUMBER_OF_PROCESSORS: cpuCount.toString(),
        ...options.env
      },
      windowsHide: true,
      ...options
    };

    const child = exec(command, performanceOptions);
    
    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';

    // Send performance info
    event.sender.send('command-output-stream', { 
      type: 'performance', 
      data: {
        pid: child.pid,
        cpuCount: cpuCount,
        memory: totalMemory,
        command: command
      }
    });

    const processOutput = (buffer, type) => {
      const lines = buffer.split('\n');
      
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (line.trim()) {
          event.sender.send('command-output-stream', { 
            type: type, 
            data: line + '\n'
          });
        }
      }
      
      return lines[lines.length - 1];
    };

    child.stdout.on('data', (data) => {
      const output = data.toString('utf8');
      stdout += output;
      stdoutBuffer += output;
      
      stdoutBuffer = processOutput(stdoutBuffer, 'stdout');
      
      // Enhanced progress detection
      if (output.includes('Progress:') || output.includes('%') || 
          output.includes('complete') || output.includes('VCD') ||
          output.includes('Writing') || output.includes('Compiling')) {
        if (stdoutBuffer.trim()) {
          event.sender.send('command-output-stream', { 
            type: 'stdout', 
            data: stdoutBuffer 
          });
          stdoutBuffer = '';
        }
      }
    });

    child.stderr.on('data', (data) => {
      const errorOutput = data.toString('utf8');
      stderr += errorOutput;
      stderrBuffer += errorOutput;
      
      stderrBuffer = processOutput(stderrBuffer, 'stderr');
    });

    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        event.sender.send('command-output-stream', { 
          type: 'stdout', 
          data: stdoutBuffer 
        });
      }
      if (stderrBuffer.trim()) {
        event.sender.send('command-output-stream', { 
          type: 'stderr', 
          data: stderrBuffer 
        });
      }
      
      resolve({ 
        code, 
        stdout, 
        stderr, 
        pid: child.pid,
        performance: {
          cpuCount: cpuCount,
          memory: totalMemory
        }
      });
    });

    child.on('error', (err) => {
      reject(err);
    });

    // Set high priority on Windows
    if (process.platform === 'win32') {
      setTimeout(() => {
        try {
          const { exec } = require('child_process');
          exec(`wmic process where processid=${child.pid} CALL setpriority "high priority"`);
        } catch (priorityError) {
          console.warn('Could not set high priority:', priorityError);
        }
      }, 100);
    }
  });
});

// Process priority management
ipcMain.handle('set-process-priority', (event, pid, priority = 'high') => {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      const priorityMap = {
        'low': 'idle',
        'normal': 'normal',
        'high': 'high priority',
        'realtime': 'realtime'
      };

      const wmicPriority = priorityMap[priority] || 'high priority';
      const command = `wmic process where processid=${pid} CALL setpriority "${wmicPriority}"`;
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ success: true, stdout, stderr });
        }
      });
    } else {
      resolve({ success: false, message: 'Priority setting only supported on Windows' });
    }
  });
});

// System performance monitoring
ipcMain.handle('get-system-performance', (event) => {
  return {
    cpuCount: getCPUCount(),
    totalMemory: getTotalMemory(),
    freeMemory: Math.floor(os.freemem() / (1024 * 1024 * 1024)),
    loadAverage: os.loadavg(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime()
  };
});

// Handler for killing process by PID - Enhanced version
ipcMain.handle('kill-process', async (event, pid) => {
  return new Promise((resolve, reject) => {
    console.log(`Attempting to kill process with PID: ${pid}`);
    
    // First try to kill the process tree (including child processes)
    exec(`taskkill /F /T /PID ${pid}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error killing process tree ${pid}:`, error);
        // If tree kill fails, try individual process kill
        exec(`taskkill /F /PID ${pid}`, (error2, stdout2, stderr2) => {
          if (error2) {
            console.error(`Error killing individual process ${pid}:`, error2);
            reject(error2);
          } else {
            console.log(`Process ${pid} killed successfully (individual)`);
            resolve({ stdout: stdout2, stderr: stderr2 });
          }
        });
      } else {
        console.log(`Process tree ${pid} killed successfully`);
        resolve({ stdout, stderr });
      }
    });
  });
});

// Alternative handler for killing process by name (backup method)
ipcMain.handle('kill-process-by-name', async (event, processName) => {
  return new Promise((resolve, reject) => {
    console.log(`Attempting to kill process by name: ${processName}`);
    
    exec(`taskkill /F /IM ${processName}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error killing process ${processName}:`, error);
        reject(error);
      } else {
        console.log(`Process ${processName} killed successfully`);
        resolve({ stdout, stderr });
      }
    });
  });
});

// Handler for checking if process is still running
ipcMain.handle('check-process-running', async (event, pid) => {
  return new Promise((resolve) => {
    exec(`tasklist /FI "PID eq ${pid}"`, (error, stdout, stderr) => {
      if (error) {
        resolve(false);
      } else {
        const isRunning = stdout.includes(pid.toString());
        resolve(isRunning);
      }
    });
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
#PIPELN ${formData.pipeln}
#NUGAIN ${formData.gain}

void main() 
{
    // Øk. Você criou um processador em C±, mas e agora?
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
ipcMain.handle('get-simulation-folder-path', async (event, processorName, inputDir) => {
  const processorDir = path.join(inputDir);
  const simulationFolderPath = path.join(processorDir,processorName, 'Simulation');
  return simulationFolderPath;
});


/*
 * 
 *    END: COMPILATION ƒ
 * 
 * 
*/


/*
 * 
 *    START: FILE OPERATION ƒ
 * 
 * 
*/


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

/*
 * 
 *    END: FILE OPERATION ƒ
 * 
 * 
*/

/*
 * 
 *    START: FILE TREE ƒ
 * 
 * 
*/

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

/*
 * 
 *    END: FILE TREE ƒ
 * 
 * 
*/

/*
 * 
 *    START: SIDEBAR MENU ƒ
 * 
 * 
*/

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


/*
 * 
 *    END: SIDEBAR MENU ƒ
 * 
 * 
*/




ipcMain.handle('list-files-directory', async (event, directoryPath) => {
  try {
    const files = await fs.readdir(directoryPath);
    return files;
  } catch (error) {
    console.error('Error listing files:', error);
    return [];
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


// Update the project:open handler to also set the global project path
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
    
    // Also set the global project path for other handlers
    const projectDirPath = path.dirname(spfPath);
    global.currentProjectPath = projectDirPath;
    
    // Update the currentProject object if it exists
    if (!global.currentProject) {
      global.currentProject = {};
    }
    global.currentProject.path = projectDirPath;
    
    console.log(`Global project path set to: ${projectDirPath}`);

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

// Adicione este handler IPC no main.js
ipcMain.handle('project:close', async () => {
  try {
    console.log('Closing project...');
    
    // Limpar as variáveis globais do projeto
    currentOpenProjectPath = null;
    global.currentProjectPath = null;
    
    if (global.currentProject) {
      global.currentProject = {};
    }
    
    // Resetar o estado do projeto
    projectState = {
      spfLoaded: false,
      projectPath: null
    };
    
    // Obter a janela focada
    const focusedWindow = BrowserWindow.getFocusedWindow();
    
    if (focusedWindow) {
      // Notificar o renderer para desabilitar o Processor Hub
      focusedWindow.webContents.send('project:processorHubState', { enabled: false });
      
      // Limpar a lista de processors
      focusedWindow.webContents.send('project:processors', { 
        processors: [],
        projectPath: null
      });
      
      // Atualizar o estado do projeto na interface
      updateProjectState(focusedWindow, null, null);
      
      // Limpar a árvore de arquivos
      focusedWindow.webContents.send('project:fileTree', { 
        files: [],
        projectPath: null
      });
      
      // Notificar que o projeto foi fechado
      focusedWindow.webContents.send('project:closed', { success: true });
    }
    
    console.log('Project closed successfully');
    
    return { success: true };
    
  } catch (error) {
    console.error('Error closing project:', error);
    return { success: false, error: error.message };
  }
});

// Função auxiliar para atualizar o estado do projeto (caso não exista)
function updateProjectState(window, projectPath, spfPath) {
  if (window && window.webContents) {
    window.webContents.send('project:stateUpdate', {
      projectPath,
      spfPath,
      isOpen: !!projectPath
    });
  }
}

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

// IPC handler to refresh the file tree
ipcMain.on('refresh-file-tree', (event) => {
  event.sender.send('trigger-refresh-file-tree'); // Notify renderer to refresh the file tree
});

function getProjectConfigPath(projectPath) {
  if (!projectPath) {
    throw new Error('Project path is required for configuration operations');
  }
  return path.join(projectPath, 'processorConfig.json');
}

// Define paths for configuration management
const appPath = app.getAppPath();
const rootPath = path.join(appPath, '..', '..'); // Navigate to the installation directory
ipcMain.handle('load-config', async (event, projectPath) => {
  try {
    // Se projectPath não foi fornecido, usar o projeto atual
    let configFilePath;
    if (projectPath) {
      configFilePath = getProjectConfigPath(projectPath);
    } else {
      // Extrair o projectPath do arquivo .spf atual
      if (!currentOpenProjectPath) {
        throw new Error('No project is currently open and no project path provided');
      }
      const spfData = await fse.readFile(currentOpenProjectPath, 'utf8');
      const projectData = JSON.parse(spfData);
      configFilePath = getProjectConfigPath(projectData.structure.basePath);
    }
    
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
        testbenchFile: "standard",
        gtkwFile: "standard"
      };
      await fs.writeFile(configFilePath, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }

    const fileContent = await fs.readFile(configFilePath, 'utf-8');
    const config = JSON.parse(fileContent);
    
    config.processors = config.processors.map((proc, index) => {
      let isActive = false;
      
      if (proc.isActive !== undefined) {
        isActive = proc.isActive === true || proc.isActive === "true";
      } else if (index === 0) {
        isActive = true;
      }
      
      return {
        ...proc,
        isActive: isActive
      };
    });

    const hasActiveProcessor = config.processors.some(p => p.isActive === true);
    if (!hasActiveProcessor && config.processors.length > 0) {
      config.processors[0].isActive = true;
    }
    
    return config;
  } catch (error) {
    console.error('Failed to read configuration file:', error);
    return { 
      processors: [], 
      iverilogFlags: [],
      cmmCompFlags: [],
      asmCompFlags: [],
      testbenchFile: "standard",
      gtkwFile: "standard"
    };
  }
});

ipcMain.handle('save-config', async (event, data) => {
  try {
    if (!currentOpenProjectPath) {
      throw new Error('No project is currently open');
    }
    
    // Extrair o projectPath do arquivo .spf
    const spfData = await fse.readFile(currentOpenProjectPath, 'utf8');
    const projectData = JSON.parse(spfData);
    const projectPath = projectData.structure.basePath;

    // Garantir que os processadores têm a propriedade isActive corretamente definida
if (data.processors && data.processors.length > 0) {
  // Garantir que apenas um processador está ativo
  let hasActive = false;
  data.processors = data.processors.map(proc => {
    if (proc.isActive === true && !hasActive) {
      hasActive = true;
      return { ...proc, isActive: true };
    }
    return { ...proc, isActive: false };
  });
  
  // Se nenhum processador estava ativo, ativar o primeiro
  if (!hasActive) {
    data.processors[0].isActive = true;
  }
}
    
    const configFilePath = getProjectConfigPath(projectPath);
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

// Update the default config structure in main.js
ipcMain.handle('load-config-from-path', async (event, configFilePath) => {
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
        testbenchFile: "standard",
        gtkwFile: "standard"
      };
      await fs.writeFile(configFilePath, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }

    const fileContent = await fs.readFile(configFilePath, 'utf-8');
    const config = JSON.parse(fileContent);
    
    // Ensure processors have isActive property
    config.processors = config.processors.map((proc, index) => {
  // Garantir que isActive é sempre um booleano
      let isActive = false;
      
      if (proc.isActive !== undefined) {
        // Se já existe, converter para booleano se necessário
        isActive = proc.isActive === true || proc.isActive === "true";
      } else if (index === 0) {
        // Se não existe, o primeiro processador é ativo
        isActive = true;
      }
      
      return {
        ...proc,
        isActive: isActive
      };
    });

    // Garantir que pelo menos um processador está ativo
    const hasActiveProcessor = config.processors.some(p => p.isActive === true);
    if (!hasActiveProcessor && config.processors.length > 0) {
      config.processors[0].isActive = true;
    }
    
    return config;
  } catch (error) {
    console.error('Failed to read configuration file:', error);
    return { 
      processors: [], 
      iverilogFlags: [],
      cmmCompFlags: [],
      asmCompFlags: [],
      testbenchFile: "standard",
      gtkwFile: "standard"
    };
  }
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

ipcMain.handle('export-log', async (_, logData) => {
  try {
    // Descobrir o projeto aberto. Ajuste conforme sua lógica:
    // Exemplo:
    const projectPath = global.currentProjectPath || global.currentOpenProjectPath || (global.currentProject && global.currentProject.path);
    if (!projectPath) {
      return { success: false, message: 'Nenhum projeto aberto. Não foi possível exportar o log.' };
    }

    // Pasta de backup dentro do projeto:
    const backupDir = path.join(projectPath, 'Backup');
    // Garante existência:
    await fse.ensureDir(backupDir);

    // Caminho do arquivo:
    const reportFilename = 'house_report.json';
    const reportFilePath = path.join(backupDir, reportFilename);

    // Escreve JSON com identação de 2 espaços:
    await fse.writeJson(reportFilePath, logData, { spaces: 2 });
    ipcMain.on('refresh-file-tree', (event) => {
      event.sender.send('trigger-refresh-file-tree'); // Notify renderer to refresh the file tree
    });
  } catch (error) {
    console.error('Erro ao exportar log:', error);
    return { success: false, message: 'Erro ao exportar log: ' + error.message };
  }
});

// Context: IPC handlers for app information, folder operations, Verilog file creation, terminal interaction, and external links

// Handler for getting application information
ipcMain.handle('get-app-info', async () => {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    osInfo: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    totalMemory: os.totalmem(),
    buildDate: new Date().toLocaleDateString(),
    environment: process.env.NODE_ENV || 'production'
  };
});

// Handler for getting performance statistics
ipcMain.handle('get-performance-stats', async () => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  return {
    uptime: process.uptime(),
    memoryUsage: memUsage.heapUsed,
    cpuUsage: Math.round((cpuUsage.user + cpuUsage.system) / 1000000), // Convert to percentage approximation
    heapTotal: memUsage.heapTotal,
    heapUsed: memUsage.heapUsed,
    external: memUsage.external,
    rss: memUsage.rss
  };
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


// Add this variable to track PRISM window
let prismWindow = null;

async function createPrismWindow(compilationData = null) {
  // If already open, just focus and update content if data provided
  if (prismWindow && !prismWindow.isDestroyed()) {
    prismWindow.focus();
    
    // If compilation data is provided, send it to existing window
    if (compilationData) {
      console.log('Updating existing PRISM window with new compilation data:', compilationData);
      // Check if the window is ready before sending data
      if (!prismWindow.webContents.isLoading()) {
        prismWindow.webContents.send('compilation-complete', compilationData);
      } else {
        prismWindow.webContents.once('did-finish-load', () => {
          if (prismWindow && !prismWindow.isDestroyed()) {
            prismWindow.webContents.send('compilation-complete', compilationData);
          }
        });
      }
    }
    return prismWindow;
  }

  // Ensure preload script exists
  const preloadPath = path.join(__dirname, 'js', 'preload_prism.js');
  console.log('Preload script path:', preloadPath);
  
  if (!require('fs').existsSync(preloadPath)) {
    console.error('Preload script not found at:', preloadPath);
    throw new Error(`Preload script not found: ${preloadPath}`);
  }

  console.log('Creating new PRISM window...');

  prismWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: false,
    icon: path.join(__dirname, 'assets', 'icons', 'sapho_aurora_icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      webSecurity: false,
      allowRunningInsecureContent: true
    },
    backgroundColor: '#17151f',
    show: false, // Inicialmente oculta
    titleBarStyle: 'default'
  });

  // Load the HTML file
  const prismHtmlPath = path.join(__dirname, 'html', 'prism.html');
  console.log('Loading PRISM HTML from:', prismHtmlPath);
  
  // CORREÇÃO PRINCIPAL: Verificar se o arquivo existe antes de tentar carregar
  if (!require('fs').existsSync(prismHtmlPath)) {
    console.error('PRISM HTML file not found at:', prismHtmlPath);
    if (prismWindow) {
      prismWindow.destroy();
      prismWindow = null;
    }
    throw new Error(`PRISM HTML file not found: ${prismHtmlPath}`);
  }
  
  try {
    // Carregar o arquivo HTML
    await prismWindow.loadFile(prismHtmlPath);
    console.log('PRISM HTML loaded successfully');
    
    // CORREÇÃO: Mostrar a janela imediatamente após carregar, sem esperar pelo evento
    prismWindow.maximize();
    prismWindow.show();
    console.log('PRISM window shown');
    
    // Notificar a janela principal que PRISM está aberto
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('prism-status', true);
    }
    
    // Se há dados de compilação, enviar após um pequeno delay para garantir que o DOM está pronto
    if (compilationData) {
      console.log('Scheduling compilation data send...');
      setTimeout(() => {
        if (prismWindow && !prismWindow.isDestroyed()) {
          console.log('Sending compilation data to PRISM window:', compilationData);
          prismWindow.webContents.send('compilation-complete', compilationData);
        }
      }, 1000); // Delay de 1 segundo para garantir que a página está totalmente carregada
    }
    
  } catch (error) {
    console.error('Failed to load prism.html:', error);
    
    // Mostrar erro em dialog
    const { dialog } = require('electron');
    await dialog.showMessageBox({
      type: 'error',
      title: 'PRISM Load Error',
      message: 'Failed to load PRISM viewer',
      detail: `Error: ${error.message}\nPath: ${prismHtmlPath}`
    });
    
    if (prismWindow) {
      prismWindow.destroy();
      prismWindow = null;
    }
    throw error;
  }

  // Handle window closed
  prismWindow.on('closed', () => {
    console.log('PRISM window closed');
    prismWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('prism-status', false);
    }
  });

  // Enhanced error handling
  prismWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`PRISM viewer failed to load (code ${errorCode}): ${errorDescription}`);
    console.error(`Failed URL: ${validatedURL}`);
    
    // Mostrar erro específico
    const { dialog } = require('electron');
    dialog.showMessageBox({
      type: 'error',
      title: 'PRISM Load Failed',
      message: `Failed to load PRISM viewer (Error ${errorCode})`,
      detail: `${errorDescription}\nURL: ${validatedURL}`
    });
  });

  prismWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('PRISM viewer renderer process crashed:', details);
  });

  // Adicionar log quando o conteúdo terminar de carregar
  prismWindow.webContents.on('did-finish-load', () => {
    console.log('PRISM window content finished loading');
  });

  // Adicionar log quando começar a carregar
  prismWindow.webContents.on('did-start-loading', () => {
    console.log('PRISM window started loading');
  });

  console.log('PRISM window created successfully');
  return prismWindow;
}


ipcMain.handle('prism-compile-with-paths', async (event, compilationPaths) => {
  try {
    console.log('=== STARTING PRISM COMPILATION WITH PROVIDED PATHS ===');
    
    if (!compilationPaths || !compilationPaths.projectPath) {
      throw new Error('Invalid compilation paths provided');
    }
    
    // This function contains the core compilation logic
    const compilationResult = await performPrismCompilationWithPaths(compilationPaths);
    
    if (!compilationResult.success) {
      throw new Error(compilationResult.message);
    }
    
    // This function creates the PRISM window
    const window = await createPrismWindow(compilationResult);
    
    if (!window) {
      throw new Error('Failed to create PRISM window');
    }
    
    console.log('=== PRISM COMPILATION WITH PATHS COMPLETED SUCCESSFULLY ===');
    return compilationResult;
    
  } catch (error) {
    console.error('=== PRISM COMPILATION WITH PATHS FAILED ===');
    console.error('Error:', error);
    return { success: false, message: error.message };
  }
});

function getExecutablePath(executableName) {
  console.log(`Main executable directory: ${__dirname}`);
  
  if (executableName === 'yosys') {
    const yosysPath = path.join(__dirname, '..' , '..' ,'saphoComponents', 'Packages', 'PRISM', 'yosys', 'yosys.exe');
    console.log(`Yosys path: ${yosysPath}`);
    return yosysPath;
  } else if (executableName === 'netlistsvg') {
    const netlistsvgPath = path.join(__dirname, '..' , '..' , 'saphoComponents', 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe');
    console.log(`Netlistsvg path: ${netlistsvgPath}`);
    return netlistsvgPath;
  }
  
  console.log(`Using fallback for: ${executableName}`);
  return executableName; // fallback
}

// Handler to request toggle UI state from main window
ipcMain.on('get-toggle-ui-state', (event) => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('request-toggle-ui-state');
  } else {
    // Default to false if main window is not available
    event.sender.send('toggle-ui-state-response', false);
  }
});

// Handler for toggle UI state response
ipcMain.on('toggle-ui-state-response', (event, isActive) => {
  // Store the response for the waiting function
  event.sender.send('toggle-ui-state-response', isActive);
});



// Alternative simpler approach - get toggle state directly
ipcMain.handle('get-toggle-ui-state-direct', async (event) => {
  try {
    if (mainWindow && mainWindow.webContents) {
      // Send request and wait for response
      return new Promise((resolve) => {
        const responseHandler = (_, isActive) => {
          ipcMain.removeListener('toggle-ui-state-response', responseHandler);
          resolve(isActive);
        };
        
        ipcMain.once('toggle-ui-state-response', responseHandler);
        mainWindow.webContents.send('request-toggle-ui-state');
        
        // Timeout after 5 seconds
        setTimeout(() => {
          ipcMain.removeListener('toggle-ui-state-response', responseHandler);
          resolve(false); // Default to false
        }, 5000);
      });
    }
    return false; // Default if no main window
  } catch (error) {
    console.error('Error getting toggle UI state:', error);
    return false;
  }
});

// IPC handler for PRISM compilation
ipcMain.handle('prism-compile', async (event, compilationPaths) => {
  try {
    if (!compilationPaths) {
      throw new Error("Compilation paths are required.");
    }
    
    const compilationResult = await performPrismCompilationWithPaths(compilationPaths);
    
    if (!compilationResult.success) {
      throw new Error(compilationResult.message);
    }
    
    const window = await createPrismWindow(compilationResult);
    
    if (!window) {
      throw new Error('Failed to create PRISM window');
    }
    
    return compilationResult;
    
  } catch (error) {
    console.error('PRISM compilation error:', error);
    return { success: false, message: error.message };
  }
});

// IPC handler to check if PRISM window is open
ipcMain.handle('is-prism-window-open', async (event) => {
  return prismWindow && !prismWindow.isDestroyed();
});


// IPC handler for generating SVG from module click
ipcMain.handle('generate-svg-from-module', async (event, moduleName, tempDir) => {
  try {
    console.log(`Generating SVG for clicked module: ${moduleName}`);
    
    // Check if module JSON exists
    const cleanModuleName = sanitizeFileName(moduleName);
    const moduleJsonPath = path.join(tempDir, `${cleanModuleName}.json`);
    
    if (!await fse.pathExists(moduleJsonPath)) {
      throw new Error(`Module JSON not found for: ${moduleName}`);
    }
    
    // Generate SVG for the module
    const svgPath = await generateModuleSVGWithPaths(moduleName, tempDir);
    
    return { 
      success: true, 
      svgPath,
      moduleName,
      moduleJsonPath
    };
  } catch (error) {
    console.error('SVG generation from module click error:', error);
    return { success: false, message: error.message };
  }
});

// IPC handler to get available modules in temp directory
ipcMain.handle('get-available-modules', async (event, tempDir) => {
  try {
    const files = await fse.readdir(tempDir);
    const jsonFiles = files.filter(file => file.endsWith('.json') && file !== 'hierarchy.json');
    const modules = jsonFiles.map(file => path.basename(file, '.json'));
    
    return { success: true, modules };
  } catch (error) {
    console.error('Error getting available modules:', error);
    return { success: false, message: error.message };
  }
});

// Handler for toggle UI state requests
ipcMain.on('request-toggle-ui-state', (event) => {
  console.log('Received request for toggle UI state');
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Send request to main window
    mainWindow.webContents.send('get-toggle-ui-state');
    
    // Listen for response from main window
    const responseHandler = (responseEvent, isActive) => {
      console.log('Received toggle UI state response:', isActive);
      // Forward response to requesting window (PRISM window)
      event.sender.send('toggle-ui-state-response', isActive);
      // Remove listener after use
      ipcMain.removeListener('toggle-ui-state-response', responseHandler);
    };
    
    ipcMain.once('toggle-ui-state-response', responseHandler);
  } else {
    console.warn('Main window not available, sending default false');
    event.sender.send('toggle-ui-state-response', false);
  }
});

ipcMain.handle('open-prism-compile', async (event, compilationPaths) => {
  try {
    console.log('=== STARTING PRISM COMPILATION ===');
    
    if (!compilationPaths) {
        throw new Error("Compilation paths are required.");
    }

    const compilationResult = await performPrismCompilationWithPaths(compilationPaths);
    
    if (!compilationResult.success) {
      console.error('Compilation failed:', compilationResult.message);
      throw new Error(compilationResult.message);
    }
    
    console.log('Compilation successful, creating PRISM window...');
    
    const window = await createPrismWindow(compilationResult);
    
    if (!window) {
      throw new Error('Failed to create PRISM window');
    }
    
    console.log('=== PRISM WINDOW CREATED SUCCESSFULLY ===');
    return { success: true, message: 'PRISM window opened successfully' };
    
  } catch (error) {
    console.error('=== PRISM COMPILATION/WINDOW CREATION FAILED ===');
    console.error('Error:', error);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', `Failed to open PRISM: ${error.message}`, 'error');
    }
    
    return { success: false, message: error.message };
  }
});


// Helper function to filter and group log messages
function shouldLogMessage(message, source) {
  const message_lower = message.toLowerCase();
  
  // Skip verbose parameter messages from Yosys
  if (source === 'yosys' && message_lower.includes('parameter \\')) {
    return false;
  }
  
  // Skip repetitive module processing messages
  if (source === 'yosys' && (
    message_lower.includes('executing ') ||
    message_lower.includes('found and queued') ||
    message_lower.includes('queued cell') ||
    message_lower.includes('updating $') ||
    message_lower.includes('importing module')
  )) {
    return false;
  }
  
  // Skip verbose netlistsvg output
  if (source === 'netlistsvg' && (
    message_lower.includes('processing') ||
    message_lower.includes('node ') ||
    message_lower.includes('edge ')
  )) {
    return false;
  }
  
  return true;
}

// Function to get toggle state from main window
async function getToggleUIStateFromMain() {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.warn('Main window not available, defaulting to false');
      resolve(false);
      return;
    }
    
    const timeout = setTimeout(() => {
      console.warn('Timeout getting toggle UI state, defaulting to false');
      ipcMain.removeListener('toggle-ui-state-response', responseHandler);
      resolve(false);
    }, 5000);
    
    const responseHandler = (event, isActive) => {
      clearTimeout(timeout);
      console.log('Received toggle UI state:', isActive);
      resolve(isActive);
    };
    
    ipcMain.once('toggle-ui-state-response', responseHandler);
    
    try {
      console.log('Requesting toggle UI state from main window');
      mainWindow.webContents.send('get-toggle-ui-state');
    } catch (error) {
      clearTimeout(timeout);
      ipcMain.removeListener('toggle-ui-state-response', responseHandler);
      console.error('Error requesting toggle UI state:', error);
      resolve(false);
    }
  });
}

// Updated performPrismCompilation - only generates SVG once
async function performPrismCompilationWithPaths(compilationPaths) {
  try {
    console.log('=== PERFORMING PRISM COMPILATION WITH PROVIDED PATHS ===');
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', 'Starting PRISM compilation process', 'info');
    }
    
    // Use provided paths instead of resolving them here
    const projectPath = compilationPaths.projectPath;
    const hdlPath = compilationPaths.hdlPath;
    const tempDir = compilationPaths.tempPath;
    const yosysPath = compilationPaths.yosysPath;
    const netlistsvgPath = compilationPaths.netlistsvgPath;
    
    console.log(`Using project path: ${projectPath}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', `Project: ${path.basename(projectPath)}`, 'info');
    }
    
    // Create temp directory
    await fse.ensureDir(tempDir);
    
    // Get toggle state from main window
    const isProjectOriented = await getToggleUIStateFromMain();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', `Mode: ${isProjectOriented ? 'Project Oriented' : 'Processor Oriented'}`, 'info');
    }
    
    let topLevelModule, configData;
    
    if (isProjectOriented) {
      console.log('Running in Project Oriented mode...');
      const projectConfigPath = compilationPaths.projectOrientedConfigPath;
      
      if (!await fse.pathExists(projectConfigPath)) {
        const errorMsg = 'projectOriented.json not found in project root';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal-log', 'tprism', `${errorMsg}`, 'error');
        }
        throw new Error(errorMsg);
      }
      
      configData = await fse.readJson(projectConfigPath);
      topLevelModule = path.basename(configData.topLevelFile, '.v');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-log', 'tprism', `Top level module: ${topLevelModule}`, 'info');
      }
    } else {
      console.log('Running in Processor Oriented mode...');
      const processorConfigPath = compilationPaths.processorConfigPath;
      
      if (!await fse.pathExists(processorConfigPath)) {
        const errorMsg = 'processorConfig.json not found in project root';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal-log', 'tprism', `${errorMsg}`, 'error');
        }
        throw new Error(errorMsg);
      }
      
      configData = await fse.readJson(processorConfigPath);
      const activeProcessor = configData.processors.find(proc => proc.isActive === true);
      if (!activeProcessor) {
        const errorMsg = 'No active processor found in processorConfig.json';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal-log', 'tprism', `${errorMsg}`, 'error');
        }
        throw new Error(errorMsg);
      }
      
      topLevelModule = activeProcessor.name;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-log', 'tprism', `Active processor: ${topLevelModule}`, 'info');
      }
    }
    
    // Run Yosys compilation with provided paths
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', 'Starting Yosys synthesis...', 'info');
    }
    const hierarchyJsonPath = await runYosysCompilationWithPaths(
      compilationPaths, 
      topLevelModule, 
      tempDir, 
      isProjectOriented
    );
    
    // Split JSON into individual module files
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', 'Processing module hierarchy...', 'info');
    }
    await splitHierarchyJson(hierarchyJsonPath, tempDir);
    
    // Generate SVG for the top level module
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', `Generating SVG diagram...`, 'info');
    }
    const svgPath = await generateModuleSVGWithPaths(topLevelModule, tempDir, netlistsvgPath);
    
    console.log('PRISM compilation with paths completed successfully');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', 'PRISM compilation completed successfully', 'success');
    }
    
    return { 
      success: true, 
      message: 'PRISM compilation completed successfully',
      topLevelModule,
      svgPath,
      tempDir,
      isProjectOriented
    };
    
  } catch (error) {
    console.error('PRISM compilation with paths error:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', `Compilation failed: ${error.message}`, 'error');
    }
    return { success: false, message: error.message };
  }
}

// Add handler to get compilation paths for recompile
ipcMain.handle('get-prism-compilation-paths', async (event) => {
    try {
        console.log('Getting compilation paths for PRISM recompile...');
        
        // Get current project path
        let projectPath = currentProjectPath || currentOpenProjectPath;
        if (currentOpenProjectPath && !currentProjectPath) {
            projectPath = path.dirname(currentOpenProjectPath);
        }
        
        if (!projectPath) {
            throw new Error('No project path available. Please open a project first.');
        }
        
        // Build all required paths
        const compilationPaths = {
            projectPath,
            saphoComponentsPath: path.join(__dirname, 'saphoComponents'),
            hdlPath: path.join(__dirname, 'saphoComponents', 'HDL'),
            tempPath: path.join(__dirname, 'saphoComponents', 'Temp', 'PRISM'),
            yosysPath: path.join(__dirname, 'saphoComponents', 'Packages', 'PRISM', 'yosys', 'yosys.exe'),
            netlistsvgPath: path.join(__dirname, 'saphoComponents', 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe'),
            processorConfigPath: path.join(projectPath, 'processorConfig.json'),
            projectOrientedConfigPath: path.join(projectPath, 'projectOriented.json'),
            topLevelPath: path.join(projectPath, 'TopLevel')
        };
        
        console.log('Compilation paths acquired:', compilationPaths);
        return compilationPaths;
        
    } catch (error) {
        console.error('Failed to get compilation paths:', error);
        throw error;
    }
});

// Add recompile handler for existing PRISM window
ipcMain.handle('prism-recompile', async (event, compilationPaths) => {
  try {
    console.log('=== STARTING PRISM RECOMPILATION ===');
    
    if (!compilationPaths) {
        throw new Error("Compilation paths are required for re-compilation.");
    }

    const compilationResult = await performPrismCompilationWithPaths(compilationPaths);
    
    if (!compilationResult.success) {
      throw new Error(compilationResult.message);
    }
    
    if (prismWindow && !prismWindow.isDestroyed()) {
      console.log('Updating existing PRISM window with recompilation data');
      
      if (!prismWindow.webContents.isLoading()) {
        prismWindow.webContents.send('compilation-complete', compilationResult);
      } else {
        prismWindow.webContents.once('did-finish-load', () => {
          if (prismWindow && !prismWindow.isDestroyed()) {
            prismWindow.webContents.send('compilation-complete', compilationResult);
          }
        });
      }
      
      prismWindow.focus();
    } else {
      console.log('Creating new PRISM window for recompilation');
      await createPrismWindow(compilationResult);
    }
    
    console.log('=== PRISM RECOMPILATION COMPLETED ===');
    return compilationResult;
    
  } catch (error) {  
    console.error('=== PRISM RECOMPILATION FAILED ===');
    console.error('Error:', error);
    return { success: false, message: error.message };
  }
});

function debugPaths() {
  console.log('=== DEBUG: Checking PRISM paths ===');
  console.log('__dirname:', __dirname);
  
  const prismHtmlPath = path.join(__dirname, 'html', 'prism.html');
  const preloadPath = path.join(__dirname, 'js', 'preload_prism.js');
  
  console.log('PRISM HTML path:', prismHtmlPath);
  console.log('PRISM HTML exists:', require('fs').existsSync(prismHtmlPath));
  
  console.log('Preload path:', preloadPath);
  console.log('Preload exists:', require('fs').existsSync(preloadPath));
  
  // Listar conteúdo do diretório html
  const htmlDir = path.join(__dirname, 'html');
  if (require('fs').existsSync(htmlDir)) {
    console.log('HTML directory contents:', require('fs').readdirSync(htmlDir));
  } else {
    console.log('HTML directory does not exist:', htmlDir);
  }
  
  // Listar conteúdo do diretório js
  const jsDir = path.join(__dirname, 'js');
  if (require('fs').existsSync(jsDir)) {
    console.log('JS directory contents:', require('fs').readdirSync(jsDir));
  } else {
    console.log('JS directory does not exist:', jsDir);
  }
  
  console.log('=== END DEBUG ===');
}


ipcMain.handle('get-dirname', async (event, filePath) => {
  try {
    console.log('Getting dirname for:', filePath);
    const dirname = path.dirname(filePath);
    console.log('Dirname result:', dirname);
    return dirname;
  } catch (error) {
    console.error('Error getting dirname:', error);
    throw error;
  }
});

// Chamar debug na inicialização
debugPaths();

// Updated Yosys compilation function with optimized logging
async function runYosysCompilationWithPaths(compilationPaths, topLevelModule, tempDir, isProjectOriented) {
  console.log('=== RUNNING YOSYS COMPILATION WITH PROVIDED PATHS ===');
  
  const hierarchyJsonPath = path.join(tempDir, 'hierarchy.json');
  const projectPath = compilationPaths.projectPath;
  const hdlPath = compilationPaths.hdlPath;
  const yosysExe = compilationPaths.yosysPath;
  
  // Build file list for Yosys using provided paths
  let fileList = [];
  let hdlFileCount = 0, processorFileCount = 0, topLevelFileCount = 0;
  
  // Add HDL files using provided HDL path
  console.log('Scanning HDL directory:', hdlPath);
  if (await fse.pathExists(hdlPath)) {
    const hdlFiles = await fse.readdir(hdlPath);
    const vFiles = hdlFiles.filter(file => 
      file.endsWith('.v') && 
      !file.includes('_tb') && 
      !file.includes('_testbench') &&
      !file.toLowerCase().includes('test')
    );
    fileList = fileList.concat(vFiles.map(file => path.join(hdlPath, file)));
    hdlFileCount = vFiles.length;
    console.log(`Found ${hdlFileCount} HDL files`);
  } else {
    console.warn('HDL directory not found:', hdlPath);
  }
  
  // Add processor files from processorConfig.json
  const processorConfigPath = compilationPaths.processorConfigPath;
  console.log('Checking processor config:', processorConfigPath);
  if (await fse.pathExists(processorConfigPath)) {
    const processorConfig = await fse.readJson(processorConfigPath);
    
    if (processorConfig.processors && Array.isArray(processorConfig.processors)) {
      for (const processor of processorConfig.processors) {
        const processorName = processor.name;
        const processorHardwareDir = path.join(projectPath, processorName, 'Hardware');
        const processorVFile = path.join(processorHardwareDir, `${processorName}.v`);
        
        console.log(`Checking processor file: ${processorVFile}`);
        if (await fse.pathExists(processorVFile)) {
          fileList.push(processorVFile);
          processorFileCount++;
          console.log(`✓ Added processor file: ${processorVFile}`);
        } else {
          console.warn(`✗ Processor file not found: ${processorVFile}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal-log', 'tprism', `Missing: ${processorName}.v`, 'warning');
          }
        }
        
        // Also add other Hardware files from the processor directory
        if (await fse.pathExists(processorHardwareDir)) {
          const hardwareFiles = await fse.readdir(processorHardwareDir);
          const vFiles = hardwareFiles.filter(file => 
            file.endsWith('.v') && 
            !file.includes('_tb') && 
            !file.includes('_testbench') &&
            !file.toLowerCase().includes('test') &&
            file !== `${processorName}.v`
          );
          fileList = fileList.concat(vFiles.map(file => path.join(processorHardwareDir, file)));
          processorFileCount += vFiles.length;
        }
      }
    }
  }
  
  if (isProjectOriented) {
    // Project Oriented Mode: Include all TopLevel files except the top level file
    const topLevelDir = compilationPaths.topLevelPath;
    console.log('Scanning TopLevel directory:', topLevelDir);
    
    const projectConfigPath = compilationPaths.projectOrientedConfigPath;
    const projectConfig = await fse.readJson(projectConfigPath);
    const topLevelFileName = projectConfig.topLevelFile;
    
    if (await fse.pathExists(topLevelDir)) {
      const topLevelFiles = await fse.readdir(topLevelDir);
      const vFiles = topLevelFiles.filter(file => 
        file.endsWith('.v') && 
        !file.includes('_tb') && 
        !file.includes('_testbench') &&
        !file.toLowerCase().includes('test') &&
        file !== topLevelFileName
      );
      fileList = fileList.concat(vFiles.map(file => path.join(topLevelDir, file)));
      
      // Add the top level file last
      const topLevelFilePath = path.join(topLevelDir, topLevelFileName);
      if (await fse.pathExists(topLevelFilePath)) {
        fileList.push(topLevelFilePath);
        console.log(`✓ Added top level file: ${topLevelFilePath}`);
      }
      
      topLevelFileCount = vFiles.length + 1;
      console.log(`Found ${topLevelFileCount} TopLevel files`);
    }
  }
  
  // Summary log instead of listing all files
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal-log', 'tprism', 
      `Files found: ${hdlFileCount} HDL, ${processorFileCount} processor, ${topLevelFileCount} top-level (Total: ${fileList.length})`, 'info');
  }
  
  if (fileList.length === 0) {
    const errorMsg = 'No Verilog files found for compilation';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', `${errorMsg}`, 'error');
    }
    throw new Error(errorMsg);
  }
  
  // Continue with existing Yosys compilation logic using provided yosysExe path
  console.log('Using Yosys executable:', yosysExe);
  
  // First, clean up any old stub files
  await cleanupOldStubFiles(tempDir);
  
  // Then, try to analyze dependencies and create stub modules if needed
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal-log', 'tprism', 'Analyzing dependencies...', 'info');
  }
  await createStubModulesIfNeeded(fileList, tempDir);
  
  // Add any created stub modules to file list
  const stubFiles = await fse.readdir(tempDir);
  const stubVFiles = stubFiles.filter(file => file.endsWith('_stub.v'));
  fileList = fileList.concat(stubVFiles.map(file => path.join(tempDir, file)));
  
  if (stubVFiles.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal-log', 'tprism', `Created ${stubVFiles.length} stub modules`, 'info');
  }
  
  // Build Yosys command with proper Windows path escaping
  const readCommands = fileList.map(file => {
    const normalizedPath = path.normalize(file).replace(/\\/g, '/');
    return `read_verilog "${normalizedPath}"`;
  }).join('; ');
  
  const normalizedOutputPath = path.normalize(hierarchyJsonPath).replace(/\\/g, '/');
  
  // Try compilation with hierarchy check first
  let yosysCommand = `"${yosysExe}" -p "${readCommands}; hierarchy -check -top ${topLevelModule}; prep; setundef -undriven -zero; write_json \\"${normalizedOutputPath}\\""`; 

  console.log('Executing Yosys command with provided executable path');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal-log', 'tprism', 'Running Yosys synthesis...', 'info');
  }
  
  return new Promise((resolve, reject) => {
    let yosysOutputBuffer = [];
    let errorBuffer = [];
    
    const yosysProcess = exec(yosysCommand, { 
      shell: true, 
      maxBuffer: 1024 * 1024 * 10,
      cwd: tempDir
    }, (error, stdout, stderr) => {
      // Process and filter Yosys output
      if (stdout) {
        yosysOutputBuffer = stdout.split('\n').filter(line => line.trim());
      }
      
      if (stderr) {
        errorBuffer = stderr.split('\n').filter(line => line.trim());
      }
      
      // Send summary instead of all output
      const importantLines = yosysOutputBuffer.filter(line => {
        const lineLower = line.toLowerCase();
        return lineLower.includes('warning') || 
               lineLower.includes('error') || 
               lineLower.includes('synthesizing') ||
               lineLower.includes('top module') ||
               lineLower.includes('cells') ||
               lineLower.includes('memories') ||
               (lineLower.includes('executing') && !lineLower.includes('parameter'));
      });
      
      if (importantLines.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        // Group similar messages
        const moduleCount = yosysOutputBuffer.filter(line => line.includes('Synthesizing module')).length;
        const cellCount = yosysOutputBuffer.filter(line => line.includes('cells')).length;
        
        if (moduleCount > 0) {
          mainWindow.webContents.send('terminal-log', 'tprism', `Synthesized ${moduleCount} modules`, 'info');
        }
        
        // Show only critical warnings/errors
        importantLines.slice(0, 5).forEach(line => {
          if (shouldLogMessage(line, 'yosys')) {
            const logLevel = line.toLowerCase().includes('error') ? 'error' : 
                           line.toLowerCase().includes('warning') ? 'warning' : 'info';
            mainWindow.webContents.send('terminal-log', 'tprism', `Yosys: ${line.trim()}`, logLevel);
          }
        });
      }
      
      // Handle errors
      if (error && stderr.includes('is not part of the design')) {
        console.log('Hierarchy check failed, trying without strict checking...');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal-log', 'tprism', 'Retrying without strict hierarchy check...', 'warning');
        }
        
        // Try without hierarchy check if modules are missing
        const relaxedCommand = `"${yosysExe}" -p "${readCommands}; hierarchy -top ${topLevelModule}; proc; write_json \\"${normalizedOutputPath}\\""`;
        
        exec(relaxedCommand, {
          shell: true,
          maxBuffer: 1024 * 1024 * 10,
          cwd: tempDir
        }, (error2, stdout2, stderr2) => {
          if (error2) {
            console.error('Yosys execution error (relaxed):', error2);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('terminal-log', 'tprism', `Yosys synthesis failed: ${error2.message}`, 'error');
            }
            reject(new Error(`Yosys compilation failed: ${error2.message}`));
            return;
          }
          
          console.log('Yosys compilation succeeded with relaxed hierarchy checking');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal-log', 'tprism', 'Yosys synthesis completed (relaxed mode)', 'success');
          }
          
          resolve(hierarchyJsonPath);
        });
      } else if (error) {
        console.error('Yosys execution error:', error);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal-log', 'tprism', `Yosys synthesis failed: ${error.message}`, 'error');
        }
        reject(new Error(`Yosys compilation failed: ${error.message}`));
        return;
      } else {
        console.log('Yosys compilation succeeded');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal-log', 'tprism', 'Yosys synthesis completed successfully', 'success');
        }
        
        resolve(hierarchyJsonPath);
      }
    });
  });
}


// 2. Function to clean module names
function cleanModuleName(moduleName) {
  // Remove $paramod prefixes and hash suffixes
  let cleanName = moduleName;
  
  // Handle $paramod patterns
  if (cleanName.startsWith('$paramod')) {
    // Extract the actual module name from $paramod patterns
    if (cleanName.includes('\\\\')) {
      // Pattern: $paramod$hash\\moduleName or $paramod\\moduleName\\params
      const parts = cleanName.split('\\\\');
      if (parts.length >= 2) {
        cleanName = parts[1];
        // Remove parameter specifications if present
        if (cleanName.includes('\\')) {
          cleanName = cleanName.split('\\')[0];
        }
      }
    } else if (cleanName.includes('\\')) {
      // Pattern: $paramod\moduleName\params
      const parts = cleanName.split('\\');
      if (parts.length >= 2) {
        cleanName = parts[1];
      }
    }
  }
  
  // Remove hash patterns like $747e370037f20148f8b166e3c93decd0b83cff70
  cleanName = cleanName.replace(/\$[a-f0-9]{40,}/g, '');
  
  // Remove parameter specifications like NUBITS=s32'00000000000000000000000000100000
  cleanName = cleanName.replace(/\\[A-Z_]+=.*$/g, '');
  
  // Clean up any remaining backslashes or dollar signs at the beginning
  cleanName = cleanName.replace(/^[\\\$]+/, '');
  
  return cleanName;
}

// 3. Function to check if a module is clickable (actual module, not internal construct)
function isClickableModule(moduleName) {
  // Skip internal Yosys constructs and primitives
  const skipPatterns = [
    /^\$_/,           // Internal gates like $_AND_, $_OR_, etc.
    /^\$dff/,         // Flip-flop primitives
    /^\$mux/,         // Mux primitives
    /^\$add/,         // Arithmetic primitives
    /^\$sub/,         // Arithmetic primitives
    /^\$mul/,         // Arithmetic primitives
    /^\$div/,         // Arithmetic primitives
    /^\$mod/,         // Arithmetic primitives
    /^\$eq/,          // Comparison primitives
    /^\$ne/,          // Comparison primitives
    /^\$lt/,          // Comparison primitives
    /^\$le/,          // Comparison primitives
    /^\$gt/,          // Comparison primitives
    /^\$ge/,          // Comparison primitives
    /^\$and/,         // Logic primitives
    /^\$or/,          // Logic primitives
    /^\$xor/,         // Logic primitives
    /^\$not/,         // Logic primitives
    /^\$reduce/,      // Reduction operators
    /^\$logic/,       // Logic operators
    /^\$shift/,       // Shift operators
    /^\$pmux/,        // Priority mux
    /^\$lut/,         // LUT primitives
    /^\$assert/,      // Assertion primitives
    /^\$assume/,      // Assumption primitives
    /^\$cover/,       // Coverage primitives
    /^\$specify/      // Specify blocks
  ];
  
  // Check if module name matches any skip pattern
  for (const pattern of skipPatterns) {
    if (pattern.test(moduleName)) {
      return false;
    }
  }
  
  // Module is clickable if it starts with $paramod or is a user-defined module name
  return moduleName.startsWith('$paramod') || 
         (!moduleName.startsWith('$') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(moduleName));
}

// Function to analyze dependencies and create stub modules for missing ones
async function createStubModulesIfNeeded(fileList, tempDir) {
  console.log('Analyzing module dependencies...');
  
  const definedModules = new Set();
  const instantiatedModules = new Set();
  
  // Read all files and extract module definitions and instantiations
  for (const filePath of fileList) {
    try {
      const content = await fse.readFile(filePath, 'utf8');
      
      // Find module definitions
      const moduleDefMatches = content.match(/^\s*module\s+(\w+)\s*[\(\;]/gm);
      if (moduleDefMatches) {
        moduleDefMatches.forEach(match => {
          const moduleName = match.match(/module\s+(\w+)/)[1];
          definedModules.add(moduleName);
        });
      }
      
      // Find module instantiations with better pattern matching
      // Look for pattern: ModuleName instanceName(
      const instantiationMatches = content.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/gm);
      if (instantiationMatches) {
        instantiationMatches.forEach(match => {
          const moduleName = match.trim().split(/\s+/)[0];
          // Filter out Verilog keywords, built-in constructs, and common data types
          if (!isVerilogKeyword(moduleName) && 
              !definedModules.has(moduleName) && 
              !isCommonDataType(moduleName) &&
              moduleName.length > 0) {
            instantiatedModules.add(moduleName);
          }
        });
      }
    } catch (error) {
      console.warn(`Could not read file ${filePath}: ${error.message}`);
    }
  }
  
  // Find missing modules
  const missingModules = Array.from(instantiatedModules).filter(mod => !definedModules.has(mod));
  
  if (missingModules.length > 0) {
    console.log('Missing modules detected:', missingModules);
    
    // Create stub modules for missing ones
    for (const moduleName of missingModules) {
      await createStubModule(moduleName, tempDir);
    }
  }
}

// Create a stub module with basic I/O
async function createStubModule(moduleName, tempDir) {
  console.log(`Creating stub module for: ${moduleName}`);
  
  const stubContent = `// Auto-generated stub module for ${moduleName}
module ${moduleName}(
  input wire clk,
  input wire rst,
  input wire [31:0] in,
  output wire [31:0] out,
  output wire [2:0] req_in,
  output wire [2:0] out_en,
  input wire itr
);

// Stub implementation - all outputs are zero
assign out = 32'b0;
assign req_in = 3'b0;
assign out_en = 3'b0;

endmodule
`;
  
  const stubFilePath = path.join(tempDir, `${moduleName}_stub.v`);
  await fse.writeFile(stubFilePath, stubContent);
  console.log(`Created stub file: ${stubFilePath}`);
}

// Check if a word is a Verilog keyword
function isVerilogKeyword(word) {
  const verilogKeywords = [
    'always', 'assign', 'begin', 'case', 'default', 'else', 'end', 'endcase',
    'endmodule', 'for', 'if', 'initial', 'input', 'output', 'reg', 'wire',
    'posedge', 'negedge', 'or', 'and', 'not', 'parameter', 'localparam',
    'generate', 'endgenerate', 'genvar', 'integer', 'real', 'time', 'realtime',
    'supply0', 'supply1', 'tri', 'triand', 'trior', 'trireg', 'vectored',
    'scalared', 'signed', 'unsigned', 'small', 'medium', 'large', 'weak0',
    'weak1', 'pullup', 'pulldown', 'strong0', 'strong1', 'highz0', 'highz1',
    'module', 'endmodule', 'primitive', 'endprimitive', 'table', 'endtable',
    'task', 'endtask', 'function', 'endfunction', 'specify', 'endspecify',
    'macromodule', 'celldefine', 'endcelldefine', 'config', 'endconfig',
    'library', 'endlibrary', 'incdir', 'include', 'timescale', 'resetall',
    'unconnected_drive', 'nounconnected_drive', 'celldefine', 'endcelldefine',
    'default_nettype', 'ifdef', 'ifndef', 'elsif', 'endif', 'define', 'undef'
  ];
  return verilogKeywords.includes(word.toLowerCase());
}

// Check if a word is a common data type or built-in construct
function isCommonDataType(word) {
  const commonTypes = [
    'reg', 'wire', 'integer', 'real', 'time', 'realtime', 'parameter', 'localparam',
    'input', 'output', 'inout', 'signed', 'unsigned', 'generate', 'genvar'
  ];
  return commonTypes.includes(word.toLowerCase());
}

// Clean up old stub files
async function cleanupOldStubFiles(tempDir) {
  try {
    const files = await fse.readdir(tempDir);
    const stubFiles = files.filter(file => file.endsWith('_stub.v'));
    
    for (const stubFile of stubFiles) {
      const stubPath = path.join(tempDir, stubFile);
      await fse.remove(stubPath);
      console.log(`Removed old stub file: ${stubPath}`);
    }
  } catch (error) {
    console.warn(`Could not clean up old stub files: ${error.message}`);
  }
}

// Sanitize file names to remove invalid characters
function sanitizeFileName(fileName) {
  return fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_');
}

// 4. Updated split hierarchy function with module filtering
async function splitHierarchyJson(hierarchyJsonPath, tempDir) {
  console.log('Splitting hierarchy JSON into individual module files...');
  
  const hierarchyData = await fse.readJson(hierarchyJsonPath);
  
  if (!hierarchyData.modules) {
    throw new Error('No modules found in hierarchy JSON');
  }
  
  // Create individual JSON files for each clickable module
  for (const [moduleName, moduleData] of Object.entries(hierarchyData.modules)) {
    if (isClickableModule(moduleName)) {
      const cleanName = cleanModuleName(moduleName);
      const sanitizedName = sanitizeFileName(cleanName);
      const moduleFilePath = path.join(tempDir, `${sanitizedName}.json`);
      
      // Create a clean module entry with cleaned names
      const cleanModuleData = JSON.parse(JSON.stringify(moduleData));
      
      // Clean cell names in the module data
      if (cleanModuleData.cells) {
        const cleanedCells = {};
        for (const [cellName, cellData] of Object.entries(cleanModuleData.cells)) {
          const cleanCellName = cleanModuleName(cellName);
          cleanedCells[cleanCellName] = cellData;
          
          // Also clean the type if it's a module reference
          if (cellData.type && isClickableModule(cellData.type)) {
            cellData.type = cleanModuleName(cellData.type);
          }
        }
        cleanModuleData.cells = cleanedCells;
      }
      
      const moduleJson = {
        creator: hierarchyData.creator || "Yosys",
        modules: {
          [cleanName]: cleanModuleData
        }
      };
      
      await fse.writeJson(moduleFilePath, moduleJson, { spaces: 2 });
      console.log(`Created module file: ${moduleFilePath} (${cleanName})`);
    } else {
      console.log(`Skipped non-clickable module: ${moduleName}`);
    }
  }
}

// Updated SVG generation function with optimized logging
async function generateModuleSVGWithPaths(moduleName, tempDir) {
  console.log(`Generating SVG for module: ${moduleName}`);
  
  const cleanModuleName = sanitizeFileName(moduleName);
  const inputJsonPath = path.join(tempDir, `${cleanModuleName}.json`);
  const outputSvgPath = path.join(tempDir, `${cleanModuleName}.svg`);
  
  if (!await fse.pathExists(inputJsonPath)) {
    const errorMsg = `Module JSON file not found: ${inputJsonPath}`;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-log', 'tprism', `${errorMsg}`, 'error');
    }
    throw new Error(errorMsg);
  }
  
  const netlistsvgExe = getExecutablePath('netlistsvg');
  const netlistSvgCommand = `"${netlistsvgExe}" "${inputJsonPath}" -o "${outputSvgPath}"`;
  
  return new Promise((resolve, reject) => {
    exec(netlistSvgCommand, { shell: true }, (error, stdout, stderr) => {
      // Only log important netlistsvg messages
      if (stderr && stderr.toLowerCase().includes('error')) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal-log', 'tprism', `SVG generation error: ${stderr}`, 'error');
        }
      }
      
      if (error) {
        console.error('netlistsvg execution error:', error);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal-log', 'tprism', `SVG generation failed: ${error.message}`, 'error');
        }
        reject(new Error(`SVG generation failed: ${error.message}`));
        return;
      }
      
      console.log(`SVG generated: ${outputSvgPath}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-log', 'tprism', `SVG diagram generated successfully`, 'success');
      }
      
      resolve(outputSvgPath);
    });
  });
}


// Directory watcher for file tree updates
const activeDirectoryWatchers = new Map();
const directoryStatsCache = new Map();

// IPC handlers for directory watching
ipcMain.handle('watch-directory', async (event, directoryPath) => {
  try {
    if (activeDirectoryWatchers.has(directoryPath)) {
      return activeDirectoryWatchers.get(directoryPath).id;
    }

    const debouncedChangeHandler = debounce(async () => {
      try {
        const files = await getDirectoryStructure(directoryPath);
        event.sender.send('directory-changed', directoryPath, files);
      } catch (error) {
        console.error(`Error getting directory structure: ${error.message}`);
      }
    }, 500);

    const watcher = chokidar.watch(directoryPath, {
      ignored: /[\/\\]\./,
      persistent: true,
      ignoreInitial: true,
      depth: 10,
      usePolling: false,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    const watcherId = `dir_watcher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    watcher.on('add', (filePath) => {
      console.log(`File added: ${filePath}`);
      debouncedChangeHandler();
    });

    watcher.on('unlink', (filePath) => {
      console.log(`File removed: ${filePath}`);
      debouncedChangeHandler();
    });

    watcher.on('addDir', (dirPath) => {
      console.log(`Directory added: ${dirPath}`);
      debouncedChangeHandler();
    });

    watcher.on('unlinkDir', (dirPath) => {
      console.log(`Directory removed: ${dirPath}`);
      debouncedChangeHandler();
    });

    watcher.on('error', (error) => {
      console.error(`Directory watcher error for ${directoryPath}:`, error);
      event.sender.send('directory-watcher-error', directoryPath, error.message);
    });

    activeDirectoryWatchers.set(directoryPath, {
      id: watcherId,
      watcher: watcher,
      path: directoryPath
    });

    return watcherId;
  } catch (error) {
    throw new Error(`Failed to watch directory: ${error.message}`);
  }
});

ipcMain.handle('stop-watching-directory', async (event, directoryPath) => {
  try {
    const watcherInfo = activeDirectoryWatchers.get(directoryPath);
    if (watcherInfo) {
      await watcherInfo.watcher.close();
      activeDirectoryWatchers.delete(directoryPath);
      directoryStatsCache.delete(directoryPath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error stopping directory watcher:', error);
    return false;
  }
});

// Get directory structure function
async function getDirectoryStructure(basePath) {
  const files = [];
  
  async function scanDirectory(currentPath, relativePath = '') {
    try {
      const items = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(currentPath, item.name);
        const itemRelativePath = path.join(relativePath, item.name);
        
        if (item.isDirectory()) {
          files.push({
            name: item.name,
            path: fullPath,
            relativePath: itemRelativePath,
            isDirectory: true,
            children: []
          });
          
          await scanDirectory(fullPath, itemRelativePath);
        } else {
          files.push({
            name: item.name,
            path: fullPath,
            relativePath: itemRelativePath,
            isDirectory: false
          });
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${currentPath}:`, error);
    }
  }
  
  await scanDirectory(basePath);
  return files;
}

// Periodic health check for directory watchers
setInterval(async () => {
  for (const [directoryPath, watcherInfo] of activeDirectoryWatchers.entries()) {
    try {
      await fs.access(directoryPath);
    } catch (error) {
      console.log(`Directory no longer accessible: ${directoryPath}, removing watcher`);
      try {
        await watcherInfo.watcher.close();
      } catch (closeError) {
        console.error(`Error closing directory watcher: ${closeError}`);
      }
      activeDirectoryWatchers.delete(directoryPath);
      directoryStatsCache.delete(directoryPath);
    }
  }
}, 30000);

// Clean up directory watchers on app close
app.on('before-quit', async () => {
  console.log('Cleaning up directory watchers...');
  for (const [directoryPath, info] of activeDirectoryWatchers.entries()) {
    try {
      await info.watcher.close();
    } catch (error) {
      console.error(`Error closing directory watcher for ${directoryPath}:`, error);
    }
  }
  activeDirectoryWatchers.clear();
  directoryStatsCache.clear();
});

// Store active file watchers
const activeWatchers = new Map();
const fileStatsCache = new Map();

// Debounce function to prevent too many rapid calls
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// IPC handlers for file watching
ipcMain.handle('get-file-stats', async (event, filePath) => {
  try {
    const stats = await fs.stat(filePath);
    const result = {
      mtime: stats.mtime.getTime(),
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    };
    
    // Cache the stats
    fileStatsCache.set(filePath, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to get file stats: ${error.message}`);
  }
});

ipcMain.handle('watch-file', async (event, filePath) => {
  try {
    // Don't watch the same file twice
    if (activeWatchers.has(filePath)) {
      return activeWatchers.get(filePath).id;
    }

    // Create debounced change handler
    const debouncedChangeHandler = debounce((eventType) => {
      if (eventType === 'change') {
        // Send change event to renderer
        event.sender.send('file-changed', filePath);
      }
    }, 150); // 150ms debounce

    const watcher = chokidar.watch(filePath, {
      ignoreInitial: true,
      persistent: true,
      usePolling: false, // Use native events when possible
      atomic: true, // Handle atomic writes
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      },
      // Add these options for better reliability
      alwaysStat: true,
      depth: 0,
      ignored: /[\/\\]\./
    });

    const watcherId = `watcher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    watcher.on('change', (path, stats) => {
      console.log(`File changed: ${path}`);
      debouncedChangeHandler('change');
    });

    watcher.on('error', (error) => {
      console.error(`File watcher error for ${filePath}:`, error);
      
      // Try to restart the watcher after a short delay
      setTimeout(async () => {
        try {
          console.log(`Attempting to restart watcher for ${filePath}`);
          await restartWatcher(filePath, event);
        } catch (restartError) {
          console.error(`Failed to restart watcher for ${filePath}:`, restartError);
          event.sender.send('file-watcher-error', filePath, error.message);
        }
      }, 1000);
    });

    watcher.on('ready', () => {
      console.log(`File watcher ready for: ${filePath}`);
    });

    // Store watcher reference
    activeWatchers.set(filePath, {
      id: watcherId,
      watcher: watcher,
      filePath: filePath,
      lastCheck: Date.now()
    });

    return watcherId;
  } catch (error) {
    throw new Error(`Failed to start file watcher: ${error.message}`);
  }
});

// Function to restart a watcher
async function restartWatcher(filePath, event) {
  const existingWatcher = activeWatchers.get(filePath);
  if (existingWatcher) {
    try {
      await existingWatcher.watcher.close();
    } catch (closeError) {
      console.error(`Error closing existing watcher: ${closeError}`);
    }
    activeWatchers.delete(filePath);
  }
  
  // Start a new watcher
  return ipcMain.emit('watch-file', event, filePath);
}

ipcMain.handle('stop-watching-file', async (event, watcherIdOrPath) => {
  try {
    let watcherInfo = null;

    // Find watcher by ID or path
    for (const [filePath, info] of activeWatchers.entries()) {
      if (info.id === watcherIdOrPath || filePath === watcherIdOrPath) {
        watcherInfo = info;
        break;
      }
    }

    if (watcherInfo) {
      await watcherInfo.watcher.close();
      activeWatchers.delete(watcherInfo.filePath);
      fileStatsCache.delete(watcherInfo.filePath);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error stopping file watcher:', error);
    return false;
  }
});

// Periodic health check for watchers (every 30 seconds)
setInterval(async () => {
  for (const [filePath, watcherInfo] of activeWatchers.entries()) {
    try {
      // Check if file still exists
      await fs.access(filePath);
      watcherInfo.lastCheck = Date.now();
    } catch (error) {
      console.log(`File no longer accessible: ${filePath}, removing watcher`);
      try {
        await watcherInfo.watcher.close();
      } catch (closeError) {
        console.error(`Error closing watcher for missing file: ${closeError}`);
      }
      activeWatchers.delete(filePath);
      fileStatsCache.delete(filePath);
    }
  }
}, 30000);

// Manual check method for renderer to force check
ipcMain.handle('force-check-file', async (event, filePath) => {
  try {
    const currentStats = await fs.stat(filePath);
    const cachedStats = fileStatsCache.get(filePath);
    
    if (!cachedStats || currentStats.mtime.getTime() > cachedStats.mtime) {
      // File has been modified
      fileStatsCache.set(filePath, {
        mtime: currentStats.mtime.getTime(),
        size: currentStats.size,
        isFile: currentStats.isFile(),
        isDirectory: currentStats.isDirectory()
      });
      
      event.sender.send('file-changed', filePath);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`Error in force check for ${filePath}:`, error);
    return false;
  }
});

// Clean up all watchers when app is closing
app.on('before-quit', async () => {
  console.log('Cleaning up file watchers...');
  for (const [filePath, info] of activeWatchers.entries()) {
    try {
      await info.watcher.close();
    } catch (error) {
      console.error(`Error closing watcher for ${filePath}:`, error);
    }
  }
  activeWatchers.clear();
  fileStatsCache.clear();
});

/* VVP */
// Adicione estas variáveis no topo do seu main.js (após as outras declarações)
let currentVvpProcess = null;
let vvpProcessPid = null;

// Função auxiliar para matar processo por PID no Windows
function killProcessByPid(pid) {
  return new Promise((resolve, reject) => {
    const killCmd = `taskkill /F /PID ${pid}`;
    exec(killCmd, (error, stdout, stderr) => {
      if (error) {
        // Se o processo já não existe, consideramos como sucesso
        if (error.message.includes('not found') || error.message.includes('not running')) {
          resolve(true);
        } else {
          reject(error);
        }
      } else {
        resolve(true);
      }
    });
  });
}

// Função para matar todos os processos vvp.exe
function killAllVvpProcesses() {
  return new Promise((resolve, reject) => {
    const killCmd = 'taskkill /F /IM vvp.exe';
    exec(killCmd, (error, stdout, stderr) => {
      if (error) {
        // Se não encontrou processos, consideramos como sucesso
        if (error.message.includes('not found') || error.message.includes('not running')) {
          resolve(false); // Retorna false indicando que não havia processos rodando
        } else {
          reject(error);
        }
      } else {
        resolve(true); // Retorna true indicando que processos foram mortos
      }
    });
  });
}

// Função para verificar se existe processo vvp.exe rodando
function checkVvpProcessRunning() {
  return new Promise((resolve) => {
    const checkCmd = 'tasklist /FI "IMAGENAME eq vvp.exe" /FO CSV';
    exec(checkCmd, (error, stdout, stderr) => {
      if (error) {
        resolve(false);
        return;
      }
      
      // Verifica se há mais de uma linha (cabeçalho + processos)
      const lines = stdout.trim().split('\n');
      const hasProcesses = lines.length > 1 && !stdout.includes('No tasks are running');
      resolve(hasProcesses);
    });
  });
}

// Handler para cancelar processos VVP
// Handler para cancelar processos VVP (em inglês, sem criar ou renomear funções)
ipcMain.handle('cancel-vvp-process', async () => {
  try {
    // Primeiro verifica se há processos vvp.exe rodando
    const isRunning = await checkVvpProcessRunning();
    
    if (!isRunning) {
      return { success: false, message: 'No compilation process is currently running.' };
    }

    // Se temos referência do processo atual, tenta matar especificamente
    if (currentVvpProcess && !currentVvpProcess.killed) {
      try {
        // Kill the VVP process and its children
        if (process.platform === 'win32') {
          await killProcessByPid(currentVvpProcess.pid);
        } else {
          currentVvpProcess.kill('SIGKILL');
        }
        currentVvpProcess = null;
        vvpProcessPid = null;
      } catch (error) {
        console.error('Error killing specific VVP process:', error);
      }
    }

    // Como fallback, mata todos os processos vvp.exe
    const killed = await killAllVvpProcesses();

    // NOW: also kill any running GTKWave processes in the same function
    try {
      if (process.platform === 'win32') {
        // On Windows, kill all gtkwave.exe processes
        await new Promise((resolve, reject) => {
          const killGtkCmd = 'taskkill /F /IM gtkwave.exe';
          exec(killGtkCmd, (error, stdout, stderr) => {
            if (error) {
              // If no GTKWave processes found, consider as success
              if (error.message.includes('not found') || error.message.includes('not running')) {
                resolve(true);
              } else {
                console.error('Error killing GTKWave processes:', error);
                resolve(false);
              }
            } else {
              resolve(true);
            }
          });
        });
      } else {
        // On Unix-like systems, attempt to kill by name
        await new Promise((resolve) => {
          // Use pkill; ignore errors if no process found
          exec('pkill -f gtkwave', (error, stdout, stderr) => {
            // pkill returns non-zero if no process matched; ignore that
            resolve(true);
          });
        });
      }
    } catch (error) {
      console.error('Unexpected error killing GTKWave:', error);
    }
    
    if (killed) {
      return {
        success: true,
        message: 'Compilation process canceled by user. GTKWave processes (if any) also terminated.'
      };
    } else {
      // Even if no VVP was running, we still attempted to kill GTKWave above
      return {
        success: false,
        message: 'No compilation process was running. GTKWave kill attempted if any instances were open.'
      };
    }
    
  } catch (error) {
    console.error('Error canceling VVP process:', error);
    // Still attempt to kill GTKWave if an unexpected error occurred earlier
    try {
      if (process.platform === 'win32') {
        exec('taskkill /F /IM gtkwave.exe', () => {});
      } else {
        exec('pkill -f gtkwave', () => {});
      }
    } catch (_) {
      // ignore
    }
    return { success: false, message: 'Error occurred while trying to cancel the process.' };
  }
});


// Handler para executar comando VVP com streaming e gerenciamento de processo
ipcMain.handle('run-vvp-command', async (event, vvpCmd, tempPath) => {
  return new Promise((resolve, reject) => {
    // Se já existe um processo rodando, mate-o primeiro
    if (currentVvpProcess && !currentVvpProcess.killed) {
      try {
        currentVvpProcess.kill('SIGKILL');
      } catch (error) {
        console.error('Error killing existing VVP process:', error);
      }
    }

    // Execute o comando VVP com streaming
    currentVvpProcess = exec(vvpCmd, { 
      cwd: tempPath,
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      encoding: 'utf8'
    });

    // Armazena o PID para referência
    if (currentVvpProcess) {
      vvpProcessPid = currentVvpProcess.pid;
      
      // Envia PID para o renderer para tracking
      event.sender.send('command-output-stream', { 
        type: 'pid', 
        pid: vvpProcessPid 
      });
    }

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const processOutput = (buffer, type) => {
      const lines = buffer.split('\n');
      
      // Process all complete lines
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (line.trim()) {
          event.sender.send('command-output-stream', { 
            type: type, 
            data: line + '\n'
          });
        }
      }
      
      // Return the last partial line
      return lines[lines.length - 1];
    };

    currentVvpProcess.stdout.on('data', (data) => {
      const output = data.toString('utf8');
      stdout += output;
      stdoutBuffer += output;
      
      // Process complete lines and keep partial line in buffer
      stdoutBuffer = processOutput(stdoutBuffer, 'stdout');
      
      // Also send immediately if we detect progress indicators
      if (output.includes('Progress:') || output.includes('%') || output.includes('complete')) {
        if (stdoutBuffer.trim()) {
          event.sender.send('command-output-stream', { 
            type: 'stdout', 
            data: stdoutBuffer 
          });
          stdoutBuffer = '';
        }
      }
    });

    currentVvpProcess.stderr.on('data', (data) => {
      const errorOutput = data.toString('utf8');
      stderr += errorOutput;
      stderrBuffer += errorOutput;
      
      // Process stderr lines
      stderrBuffer = processOutput(stderrBuffer, 'stderr');
    });

    currentVvpProcess.on('close', (code) => {
      // Send any remaining buffered output
      if (stdoutBuffer.trim()) {
        event.sender.send('command-output-stream', { 
          type: 'stdout', 
          data: stdoutBuffer 
        });
      }
      if (stderrBuffer.trim()) {
        event.sender.send('command-output-stream', { 
          type: 'stderr', 
          data: stderrBuffer 
        });
      }
      
      // Limpa as referências do processo
      currentVvpProcess = null;
      vvpProcessPid = null;
      
      resolve({ 
        code, 
        stdout, 
        stderr
      });
    });

    currentVvpProcess.on('error', (err) => {
      // Limpa as referências do processo
      currentVvpProcess = null;
      vvpProcessPid = null;
      
      reject({
        code: -1,
        stdout: '',
        stderr: err.message || 'VVP process error',
        error: err.message || 'VVP process error'
      });
    });

    // Listener para quando o processo termina por signal
    currentVvpProcess.on('exit', (code, signal) => {
      currentVvpProcess = null;
      vvpProcessPid = null;
    });
  }); 
});

// Handler para verificar se VVP está rodando (opcional, para UI)
ipcMain.handle('check-vvp-running', async () => {
  return await checkVvpProcessRunning();
});

/* handle file */
// Handle binary file reading
ipcMain.handle('read-file-buffer', async (event, filePath) => {
  try {
    const buffer = await fs.readFile(filePath);
    return buffer;
  } catch (error) {
    console.error('Error reading binary file:', error);
    throw error;
  }
});

// Optional: Handle file type detection
ipcMain.handle('get-file-type', async (event, filePath) => {
  try {
    const extension = path.extname(filePath).toLowerCase().slice(1);
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'];
    const pdfExtensions = ['pdf'];
    
    if (imageExtensions.includes(extension)) {
      return 'image';
    } else if (pdfExtensions.includes(extension)) {
      return 'pdf';
    } else {
      return 'text';
    }
  } catch (error) {
    console.error('Error detecting file type:', error);
    return 'text';
  }
});