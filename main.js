// Importing necessary modules from Electron
const { app, BrowserWindow, ipcMain, shell, Tray, nativeImage, dialog, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const { exec } = require('child_process');
const path = require('path');
const fse = require('fs-extra'); // Provides extended file system methods
const fs = require('fs').promises; // Promisified file system module
const os = require('os');
const { spawn } = require('child_process'); // Used for spawning child processes
const moment = require("moment"); // For generating timestamps
const electronFs = require('original-fs'); // Original file system module for Electron
const url = require('url');

// Path to store user settings
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// Global variables for app state
let tray = null; // Tray icon instance
let settingsWindow = null; // Settings window instance
let isQuitting = false; // Flag to control app exit behavior
let projectState = {
  spfLoaded: false, // Indicates if a project file is loaded
  projectPath: null // Path to the currently loaded project
};
let mainWindow, splashWindow; // Main and splash window instances
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
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
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
      icon: nativeImage.createFromPath(quitIconPath).resize({ width: 16, height: 16 }),
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

// Function to create the settings window
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 490,
    height: 505,
    parent: mainWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'Settings'
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// Function to update the PATH environment variable in Electron
function updatePathInElectron() {
  console.log("Updating PATH in Electron...");
  exec('powershell -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'Machine\')"', (error, stdout) => {
    if (!error) {
      process.env.PATH = stdout.trim();
      console.log("PATH updated in Electron:", process.env.PATH);
    } else {
      console.error("Error updating PATH:", error);
    }
  });
}

updatePathInElectron();

// Function to create a progress window for updates
let progressWindow = null;

function createProgressWindow() {
  progressWindow = new BrowserWindow({
    width: 400,
    height: 150,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'js', 'preload.js')
    },
  });

  progressWindow.loadFile(path.join(__dirname, 'html', 'progress.html'));
}
// IPC handler to load an SVG file
ipcMain.handle("load-svg-file", async (event, svgPath) => {
  try {
      console.log("Attempting to load SVG:", svgPath);

      // Check if the file exists asynchronously
      await fs.access(svgPath);

      const svgContent = await fs.readFile(svgPath, "utf-8");
      console.log("SVG loaded successfully!");
      return { 
          content: svgContent, 
          filename: path.basename(svgPath) 
      };
  } catch (error) {
      console.error("Error loading SVG:", error);
      return { error: error.message };
  }
});

// IPC handler to open a new window for Prism visualization
ipcMain.on("open-prism-window", (event, svgPath) => {
  let prismWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "assets/icons/prism.png"),
    webPreferences: {
      preload: path.join(__dirname, 'js', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true,
    frame: true
  });

  // Construct URL with SVG path as a query parameter
  const prismUrl = url.format({
    pathname: path.join(__dirname, 'html/prism.html'),
    protocol: 'file:',
    slashes: true,
    search: `?svgPath=${encodeURIComponent(svgPath)}`
  });

  prismWindow.loadURL(prismUrl);

  prismWindow.once("ready-to-show", () => {
    prismWindow.show();
  });

  prismWindow.on("closed", () => {
    prismWindow = null;
  });
});

// Function to check for application updates
function checkForUpdates() {
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', async (info) => {
    console.log(`New version available: ${info.version}, current version: ${app.getVersion()}`);
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Current Version: ${app.getVersion()}\nNew Version: ${info.version}\nDo you want to download now?`,
      buttons: ['Yes', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      console.log('Starting update download...');
      createProgressWindow();
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    const transferred = (progress.transferred / 1048576).toFixed(2); // Convert to MB
    const total = (progress.total / 1048576).toFixed(2); // Convert to MB
    
    if (progressWindow) {
      progressWindow.webContents.send('update-progress', {
        percent,
        transferred,
        total,
        speed: (progress.bytesPerSecond / 1048576).toFixed(2) // Speed in MB/s
      });
    }
  });

  autoUpdater.on('update-downloaded', async () => {
    if (progressWindow) {
      progressWindow.close();
      progressWindow = null;
    }

    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Install Update',
      message: 'The update has been downloaded. Install now?',
      buttons: ['Yes', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      autoUpdater.quitAndInstall(true, true);
      installExecutables();
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
    if (progressWindow) {
      progressWindow.close();
      progressWindow = null;
    }
  });
}

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
    updatePathInElectron();
    mainWindow.show();
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
  }, 2000);
}

// Function to clear application cache
function clearCache() {
  const cachePath = app.getPath('userData');
  fs.removeSync(path.join(cachePath, 'Cache'));
  fs.removeSync(path.join(cachePath, 'GPUCache'));
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
// Context: IPC handlers for managing hardware folder paths, file movements, and project-related operations

// Handler to get the hardware folder path
ipcMain.handle('get-hardware-folder-path', async (event, processorName, inputDir) => {
  const processorDir = path.join(inputDir, '..');
  const hardwareFolderPath = path.join(processorDir, 'Hardware');
  return hardwareFolderPath;
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
  updatePathInElectron();
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

// Handle project opening from Windows double-click
app.on('second-instance', (event, commandLine) => {
  const spfPath = commandLine[commandLine.length - 1];
  if (spfPath.endsWith('.spf')) {
    mainWindow.webContents.send('project:openFromSystem', spfPath);
  }
});

// Handle file associations
app.setAsDefaultProtocolClient('spf');

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

// IPC handler to write content to a file
ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    await fse.writeFile(filePath, content);
    return { success: true };
  } catch (error) {
    console.error('Error writing file:', error);
    throw error;
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
    const fileContent = await fs.readFile(configFilePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error('Failed to read configuration file:', error);
    return { processors: [], iverilogFlags: [] };
  }
});

// IPC handler to save configuration
ipcMain.on('save-config', async (event, data) => {
  await ensureConfigDir();
  try {
    await fs.writeFile(configFilePath, JSON.stringify(data, null, 2));
    console.log('Configuration saved at:', configFilePath);
  } catch (error) {
    console.error('Failed to save configuration file:', error);
  }
});

// IPC handler to join paths
ipcMain.handle('join-path', (event, ...paths) => {
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

// Path to 7-Zip executable
const sevenZipPath = "7z";

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

// Context: Temporary folder management

// IPC handler to clear the Temp folder
ipcMain.handle('clear-temp-folder', async () => {
  try {
    const appPath = app.getAppPath();
    const basePath = path.join(appPath, '..', '..');
    const tempFolder = path.join(basePath, 'saphoComponents', 'Temp');
    await fs.rm(tempFolder, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error("Error deleting Temp folder:", error);
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
  try {
    await fs.rm(folderPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error('Error deleting folder:', error);
    throw error;
  }
});

// Handler to create a "TopLevel" folder and a Verilog (.v) file
ipcMain.handle("create-toplevel-folder", async (_, projectPath) => {
  if (!projectPath) {
    console.error("No project open");
    return { 
      success: false, 
      message: "No project open. Please open a project first." 
    };
  }

  try {
    const topLevelFolderPath = path.join(projectPath, "TopLevel");
    const topLevelExists = await fse.pathExists(topLevelFolderPath);

    if (!topLevelExists) {
      await fse.ensureDir(topLevelFolderPath);
    }

    const result = await dialog.showSaveDialog({
      title: 'Create Verilog File',
      defaultPath: path.join(topLevelFolderPath, ''),
      filters: [{ name: 'Verilog Files', extensions: ['v'] }]
    });

    if (!result.canceled && result.filePath) {
      await fse.writeFile(result.filePath, '');
      return { 
        success: true, 
        message: `Verilog file created at: ${result.filePath}`,
        filePath: result.filePath
      };
    } else {
      return { 
        success: false, 
        message: 'File creation canceled'
      };
    }

  } catch (error) {
    console.error("Error in process:", error);
    return { 
      success: false, 
      message: `Error: ${error.message}`
    };
  }
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

// Handler to open GitHub Desktop
ipcMain.on('open-github-desktop', () => {
  const { shell } = require('electron');
  shell.openExternal('github-desktop://');
});

// Handler to quit the app with a delay
ipcMain.on('quit-app', () => {
  setTimeout(() => {
    app.quit();
  }, 5000);
});
