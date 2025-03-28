const { app, BrowserWindow, ipcMain, shell,  Tray, nativeImage, dialog, Menu} = require('electron');
const { autoUpdater } = require('electron-updater');
const { exec } = require('child_process');
const path = require('path');
const fse = require('fs-extra'); // fs-extra makes it easier to copy directories
const fs = require('fs').promises;
const os = require('os');
const { spawn } = require('child_process'); // Importa spawn corretamente 
const moment = require("moment"); // Para gerar a data e hora
const electronFs = require('original-fs'); // Use original-fs instead of fs
const url = require('url');


const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let tray = null;
let settingsWindow = null;
let isQuitting = false;  // Flag para controlar o fechamento do app

let mainWindow, splashWindow;

async function loadSettings() {
  try {
    // Use await com fs.promises
    try {
      await fs.access(settingsPath);
      const data = await fs.readFile(settingsPath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      // Arquivo não existe, retorne as configurações padrão
      return {
        startWithWindows: false,
        minimizeToTray: true,
        theme: 'dark'
      };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    // Retornar configurações padrão em caso de erro
    return {
      startWithWindows: false,
      minimizeToTray: true,
      theme: 'dark'
    };
  }
}


async function saveSettings(settings) {
  try {
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

// Aplicar configuração de inicialização automática
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

function createTray() {
  // Evitar duplicação do tray
  if (tray !== null) return;

  // Caminho para o ícone principal
  const iconPath = path.join(__dirname, 'assets','icons', 'aurora_borealis-2.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  
  // Caminhos para os ícones do menu
  const openIconPath = path.join(__dirname, 'assets', 'icons', 'open.png');
  const settingsIconPath = path.join(__dirname, 'assets','icons', 'settings.png');
  const quitIconPath = path.join(__dirname, 'assets','icons', 'close.png');
  
  // Criar menu de contexto com ícones
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
        isQuitting = true;  // Marcar que está saindo
        if (tray) {
          tray.destroy();  // Destruir o tray antes de sair
          tray = null;
        }
        app.quit();  // Sair do aplicativo
      } 
    }
  ]);
  
  tray.setToolTip('AURORA IDE');
  tray.setContextMenu(contextMenu);
  
  // Clique duplo para mostrar app
  tray.on('double-click', () => {
    mainWindow.show();
  });
}

// Create the settings window
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

function updatePathInElectron() {
  console.log("Atualizando o PATH no Electron...");
  exec('powershell -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'Machine\')"', (error, stdout) => {
      if (!error) {
          process.env.PATH = stdout.trim();
          console.log("PATH atualizado no Electron:", process.env.PATH);
      } else {
          console.error("Erro ao atualizar o PATH:", error);
      }
  });
}

updatePathInElectron();

// Primeiro, vamos criar uma função para gerenciar a janela de progresso
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

ipcMain.handle("load-svg-file", async (event, svgPath) => {
  try {
      console.log("Tentando carregar SVG:", svgPath);

      // Verifica se o arquivo existe de forma assíncrona
      await fs.access(svgPath);

      const svgContent = await fs.readFile(svgPath, "utf-8");
      console.log("SVG carregado com sucesso!");
      return { 
          content: svgContent, 
          filename: path.basename(svgPath) 
      };
  } catch (error) {
      console.error("Erro ao carregar SVG:", error);
      return { error: error.message };
  }
});

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
    autoHideMenuBar: false,
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

// Modifique a função checkForUpdates
function checkForUpdates() {
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', async (info) => {
    console.log(`Nova versão disponível: ${info.version}, versão atual: ${app.getVersion()}`);
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Atualização Disponível',
      message: `Versão Atual: ${app.getVersion()}\nNova Versão: ${info.version}\nDeseja baixar agora?`,
      buttons: ['Sim', 'Depois'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      console.log('Iniciando o download da atualização...');
      createProgressWindow();
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    const transferred = (progress.transferred / 1048576).toFixed(2); // Converter para MB
    const total = (progress.total / 1048576).toFixed(2); // Converter para MB
    
    if (progressWindow) {
      progressWindow.webContents.send('update-progress', {
        percent,
        transferred,
        total,
        speed: (progress.bytesPerSecond / 1048576).toFixed(2) // Velocidade em MB/s
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
      title: 'Instalar Atualização',
      message: 'A atualização foi baixada. Instalar agora?',
      buttons: ['Sim', 'Depois'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      autoUpdater.quitAndInstall(true, true);
      installExecutables();
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Erro na atualização:', err);
    if (progressWindow) {
      progressWindow.close();
      progressWindow = null;
    }
  });
}

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

  // Load settings
  const settings = await loadSettings();
  
  // Apply auto-start setting
  applyAutoStartSettings(settings.startWithWindows);

  // Create tray icon
  createTray();

   // Handle window close
   mainWindow.on('close', async (event) => {
    // Verifica se já está marcado para sair
    if (isQuitting) return;
  
    try {
      // Carrega as configurações atuais
      const settings = await loadSettings();
      
      // Se a opção de minimizar para bandeja estiver ativada
      if (settings.minimizeToTray) {
        event.preventDefault(); // Impede o fechamento padrão
        mainWindow.hide(); // Minimiza para a bandeja
        return; // Sai do manipulador de evento
      }
    } catch (error) {
      console.error('Erro ao verificar configurações:', error);
    }
  });
  
  // Modifique também o evento de 'before-quit'
  app.on('before-quit', () => {
    isQuitting = true;
  });

  mainWindow.once('ready-to-show', () => {
    updatePathInElectron();
    mainWindow.show();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
});


// Manipuladores IPC para configurações
ipcMain.handle('get-settings', async () => {
  return await loadSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
  // Salvar configurações no arquivo
  const success = await saveSettings(settings);
  
  // Aplicar configuração de inicialização automática
  applyAutoStartSettings(settings.startWithWindows);
  
  return success;
});

ipcMain.on('close-settings-modal', () => {
  if (settingsWindow) settingsWindow.close();
});

// Manipulador IPC para abrir janela de configurações
ipcMain.on('open-settings', () => {
  createSettingsWindow();
});

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
    splashWindow.close();
    createMainWindow();
    setTimeout(checkForUpdates, 2000);
  }, 2000);
}


function clearCache() {
  const cachePath = app.getPath('userData');
  fs.removeSync(path.join(cachePath, 'Cache'));
  fs.removeSync(path.join(cachePath, 'GPUCache'));
}

app.whenReady().then(createSplashScreen);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


ipcMain.handle('open-folder', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (!result.canceled) {
      const folderPath = result.filePaths[0];
      if (!folderPath) {
        throw new Error('Nenhuma pasta selecionada.');
      }
      global.currentFolderPath = folderPath; // Armazena o caminho da pasta atual
      const files = await listFiles(folderPath); // Chama a função listFiles
      return { folderPath, files };
    }
    return null; // Nenhuma pasta selecionada
  } catch (error) {
    console.error('Erro ao abrir a pasta:', error.message);
    throw error; // Lança o erro para o renderer.js
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8'); // fs.promises
    return content;
  } catch (error) {
    console.error(`Erro ao ler o arquivo: ${error.message}`);
    throw error;
  }
});

ipcMain.handle('save-file', async (event, { filePath, content }) => {
  try {
    await fs.writeFile(filePath, content, 'utf8'); // fs.promises
    return true;
  } catch (error) {
    console.error('Erro ao salvar o arquivo:', error.message);
    return false;
  }
});



async function listFiles(dir) {
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    const items = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(dir, file.name);
        if (file.isDirectory()) {
          const children = await listFiles(filePath); // Recursão para subdiretórios
          return { name: file.name, path: filePath, type: 'directory', children };
        }
        return { name: file.name, path: filePath, type: 'file' };
      })
    );
    return items;
  } catch (error) {
    console.error('Erro ao listar arquivos:', error.message);
    throw error; // Lança o erro para ser tratado no `ipcMain.handle`
  }
}


// Add this to your existing IPC handlers
ipcMain.handle('getCurrentFolder', () => {
  return global.currentFolderPath || null;
});


// Add this function to scan directory recursively
async function scanDirectory(dirPath) {
  const items = await fse.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    items.map(async item => {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        const children = await scanDirectory(fullPath);
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

// Update the refreshFolder handler
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



ipcMain.handle('compile', async (event, { compiler, content, filePath, workingDir, outputPath }) => {
  return new Promise((resolve, reject) => {
    const compilerPath = path.join(__dirname, compiler);
    
    const options = {
      cwd: workingDir, // Diretório de trabalho
      maxBuffer: 1024 * 1024 // Aumenta o buffer para 1MB para lidar com saídas grandes
    };
    
    // Primeiro salva o arquivo para garantir que está atualizado
    try {
      require('fs').writeFileSync(filePath, content);
    } catch (error) {
      reject(error);
      return;
    }
    
    // Comando de compilação
    const compileCommand = `"${compilerPath}" "${filePath}" "${outputPath}"`;
    console.log('Comando de compilação:', compileCommand); // Debug: Verifique o comando gerado

    // Executa o compilador
    const process = exec(compileCommand, options, (error, stdout, stderr) => {
      if (error) {
        reject({ stdout, stderr, error: error.message });
        return;
      }
      resolve({ stdout, stderr });
    });

    // Captura a saída em tempo real
    process.stdout.on('data', (data) => {
      console.log(data);
    });

    process.stderr.on('data', (data) => {
      console.error(data);
    });
  });
});

ipcMain.handle('get-current-folder', async () => {
  // Return the current working directory or stored folder path
  return process.cwd(); 
});

ipcMain.handle('open-in-explorer', async (event, folderPath) => {
  try {
    await shell.openPath(folderPath);
    return true;
  } catch (error) {
    console.error('Error opening explorer:', error);
    return false;
  }
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return true;
  } catch (error) {
    console.error('Erro ao abrir o link externo:', error);
    return false;
  }
});


// IPC Handler for directory selection
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });
  
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// Modified create-processor-project handler
ipcMain.handle('create-processor-project', async (event, formData) => {
  try {
    if (!formData.projectLocation) {
      throw new Error('Project location is required');
    }

    // Create processor base directory
    const processorPath = path.join(formData.projectLocation, formData.processorName);
    const softwarePath = path.join(processorPath, 'Software');
    const hardwarePath = path.join(processorPath, 'Hardware');
    const SimulationPath = path.join(processorPath, 'Simulation');

    // Check if processor folder already exists
    try {
      await fse.access(processorPath);
      throw new Error(`A processor with name "${formData.processorName}" already exists`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Create directories
        await fse.mkdir(processorPath, { recursive: true });
        await fse.mkdir(softwarePath, { recursive: true });
        await fse.mkdir(hardwarePath, { recursive: true });
        await fse.mkdir(SimulationPath, { recursive: true });

        // Create the CMM file content
        const cmmContent = `#PRNAME ${formData.processorName}
#DATYPE ${formData.pointType === 'fixed' ? '0' : '1'}
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

        // Create the CMM file
        const cmmFilePath = path.join(softwarePath, `${formData.processorName}.cmm`);
        await fse.writeFile(cmmFilePath, cmmContent, 'utf8');

        // Update the SPF file with the new processor
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
            gain: formData.gain
          }
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

// Função para obter o caminho da pasta Hardware, corrigido para ser no nível da pasta Software
ipcMain.handle('get-hardware-folder-path', async (event, processorName, inputDir) => {
  // Calculate the processor folder path (going up from Software folder)
  const processorDir = path.join(inputDir, '..');  // Go up from Software folder to processor folder
  const hardwareFolderPath = path.join(processorDir, 'Hardware');
  return hardwareFolderPath;
});

// Função para mover os arquivos compilados para a pasta Hardware, filtrando apenas os arquivos de saída
ipcMain.handle('move-files-to-hardware-folder', async (event, inputDir, hardwareFolderPath) => {
  try {
    // Cria a pasta Hardware, se não existir
    await fs.mkdir(hardwareFolderPath, { recursive: true });

    console.log(`Verificando arquivos em: ${inputDir}`);

    // Lê os arquivos gerados na pasta de entrada (inputDir)
    const compiledFiles = await fs.readdir(inputDir);

    if (!compiledFiles.length) {
      console.error('Nenhum arquivo encontrado em', inputDir);
      throw new Error('Nenhum arquivo compilado encontrado.');
    }

    // Definir as extensões dos arquivos de saída que você deseja mover
    const validExtensions = ['.mif', '.v'];

    // Filtra os arquivos que possuem as extensões válidas
    const movePromises = compiledFiles
      .filter(file => validExtensions.includes(path.extname(file).toLowerCase())) // Filtra pelos arquivos de saída
      .map(async (file) => {
        const filePath = path.join(inputDir, file);
        const destPath = path.join(hardwareFolderPath, file);

        try {
          console.log(`Tentando mover: ${filePath} -> ${destPath}`);

          // Verifica se o arquivo existe antes de mover
          await fs.access(filePath);
          
          // Tenta mover o arquivo
          await fs.rename(filePath, destPath);  // Move o arquivo para a pasta desejada
          console.log(`Arquivo movido: ${file}`);
        } catch (err) {
          console.error(`Erro ao mover o arquivo: ${file}`, err);
          throw new Error(`Erro movendo o arquivo: ${file}`);
        }
      });

    // Aguarda mover todos os arquivos filtrados
    await Promise.all(movePromises);

    console.log('Arquivos de saída movidos com sucesso.');
    return 'Files moved successfully';
  } catch (error) {
    console.error('Erro ao mover arquivos:', error);
    throw new Error(`Erro ao mover arquivos: ${error.message}`);
  }
});


ipcMain.handle('dialog:showOpen', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Sapho Project Files', extensions: ['spf'] }
    ]
  });
  return result;
});

// Handler for getting project info
ipcMain.handle('project:getInfo', async (_, spfPath) => {
  try {
    // Debug log
    console.log('Attempting to read project info from:', spfPath);

    if (!spfPath) {
      throw new Error('No project file path provided');
    }

    // Ensure the path exists
    const exists = await fse.pathExists(spfPath);
    if (!exists) {
      throw new Error(`Project file not found at: ${spfPath}`);
    }

    // Read and parse the project file
    const projectData = await fse.readJSON(spfPath);
    console.log('Successfully read project data');
    
    return projectData;
  } catch (error) {
    console.error('Error reading project info:', error);
    throw error;
  }
});

// Manipulador para abrir o explorador de arquivos
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled) {
    return null; // Se o usuário cancelar
  }
  return result.filePaths[0]; // Caminho da pasta selecionada
});

// ProjectFile class for .spf structure
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

function updateProjectState(window, projectPath, spfPath) {
  window.webContents.send('project:stateChange', { projectPath, spfPath });
}

ipcMain.handle('project:createStructure', async (event, projectPath, spfPath) => {
  updatePathInElectron();
  try {
    // 1. Criar a estrutura do projeto
    await fse.mkdir(projectPath, { recursive: true });
    const projectFile = new ProjectFile(projectPath);
    await fse.writeFile(spfPath, JSON.stringify(projectFile.toJSON(), null, 2));

    // 2. Aguardar um pouco para garantir que o sistema de arquivos sincronizou
    await new Promise(resolve => setTimeout(resolve, 0));

    // 3. Verificar se os arquivos existem
    const projectExists = await fse.pathExists(projectPath);
    const spfExists = await fse.pathExists(spfPath);

    if (!projectExists || !spfExists) {
      throw new Error('Failed to create project structure or .spf file');
    }

    // 4. Ler os arquivos para confirmar que estão acessíveis
    const files = await fse.readdir(projectPath, { withFileTypes: true });
    const fileList = files.map(file => ({
      name: file.name,
      isDirectory: file.isDirectory(),
      path: path.join(projectPath, file.name)
    }));

    const focusedWindow = BrowserWindow.getFocusedWindow();

    // 5. Opcional: Enviar um evento simulando a resposta do showOpenDialog
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

    // Se o arquivo não existir, tenta corrigir o caminho:
    if (!(await fse.pathExists(spfPath))) {
      // Supondo que o nome do projeto seja igual ao nome do arquivo (sem a extensão)
      const projectName = path.basename(spfPath, '.spf');
      // Monta o caminho esperado: pasta do projeto + nome do projeto + ".spf"
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
    
    // Enviar evento para habilitar o Processor Hub
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

//VERILOG
ipcMain.handle('execute-powershell', async () => {
  try {
      // Caminho para a pasta de comandos
      const commandsFolder = path.join(__dirname, 'commands');
      
      // Nome dos arquivos de comandos (ordem que devem ser executados)
      const commandFiles = [
          'command1.ps1', // Inicia WSL
          'command2.ps1', // Muda de diretório
          'command3.ps1', // Exibe versão do Verilator
          'command4.ps1'  // Executa a compilação
      ];

      let output = '';
      let errorOutput = '';

      // Executando os arquivos de comandos em sequência
      for (const commandFile of commandFiles) {
          const commandPath = path.join(commandsFolder, commandFile);

          // Lê o conteúdo do arquivo de comando
          const commands = await fs.readFile(commandPath, 'utf8');
          
          // Executa o comando no PowerShell
          const commandResult = await executePowerShell(commands);

          // Acumula as saídas
          output += commandResult.output;
          errorOutput += commandResult.errorOutput;
      }

      // Retorna o resultado final
      return { output, errorOutput };

  } catch (error) {
      throw error;
  }
});

// Função auxiliar para executar o comando no PowerShell
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

//BLOCKVIEW
ipcMain.handle('select-cmm-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'CMM Files', extensions: ['cmm'] }
    ]
  });
  
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('parse-cmm-file', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return parseProcessor(content);
  } catch (error) {
    console.error('Error reading file:', error);
    throw error;
  }
});

function parseProcessor(content) {
  const lines = content.split('\n');
  const processor = {
    PRNAME: '',
    DIRNAM: '',
    DATYPE: '',
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
      const directiveName = directive.substring(1); // Remove the # symbol
      const value = valueParts[0];
      
      if (processor.hasOwnProperty(directiveName)) {
        // Convert to number if it's a numeric field
        processor[directiveName] = isNaN(value) ? value : Number(value);
      }
    }
  }

  return processor;
}


//VCD
ipcMain.handle('open-wave-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'VCD Files', extensions: ['vcd'] }],
  });

  return result.filePaths[0] || null;
});

ipcMain.handle('open-gtkwave', async (event, filePath) => {
  if (!filePath) return;

  const command = `gtkwave "${filePath}"`;

  exec(command, (error) => {
    if (error) {
      console.error(`Erro ao abrir GTKWave: ${error.message}`);
    }
  });
});

//ICARUS
ipcMain.handle('create-directory', async (event, dirPath) => {
  try {
      await fse.ensureDir(dirPath); // usando fse ao invés de fs
      return { success: true };
  } catch (error) {
      console.error('Error creating directory:', error);
      throw error;
  }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
      await fse.writeFile(filePath, content); // usando fse ao invés de fs
      return { success: true };
  } catch (error) {
      console.error('Error writing file:', error);
      throw error;
  }
});

//WATCH
let watcher = null;

// Função para lidar com a leitura recursiva de diretórios
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

// Configurar IPC handlers
ipcMain.handle('watchFolder', async (event, folderPath) => {
  // Limpar watcher anterior se existir
  if (watcher) {
    await watcher.close();
  }

  // Configurar novo watcher
  watcher = chokidar.watch(folderPath, {
    ignored: /(^|[\/\\])\../, // ignorar arquivos ocultos
    persistent: true
  });

  // Enviar eventos para o renderer process
  watcher
    .on('add', path => event.sender.send('fileChanged', { type: 'add', path }))
    .on('unlink', path => event.sender.send('fileChanged', { type: 'unlink', path }))
    .on('addDir', path => event.sender.send('fileChanged', { type: 'addDir', path }))
    .on('unlinkDir', path => event.sender.send('fileChanged', { type: 'unlinkDir', path }))
    .on('change', path => event.sender.send('fileChanged', { type: 'change', path }));
});

//Refresh
ipcMain.on('refresh-file-tree', (event) => {
  // Envia o evento de volta para o renderer para atualizar o file tree
  event.sender.send('trigger-refresh-file-tree');
});

// Use app.getPath('userData') para garantir que o caminho seja correto após o empacotamento
const configDir = path.join(app.getPath('userData'), 'saphoComponents', 'Scripts');
const configFilePath = path.join(configDir, 'processorConfig.json');

// Função para garantir que o diretório exista antes de ler ou escrever o arquivo
async function ensureConfigDir() {
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch (error) {
    console.error('Falha ao criar diretório de configuração:', error);
  }
}

// Lendo a configuração
ipcMain.handle('load-config', async () => {
  await ensureConfigDir();
  try {
    const fileContent = await fs.readFile(configFilePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error('Falha ao ler o arquivo de configuração:', error);
    return { processors: [], iverilogFlags: [] };
  }
});

// Salvando a configuração
ipcMain.on('save-config', async (event, data) => {
  await ensureConfigDir();
  try {
    await fs.writeFile(configFilePath, JSON.stringify(data, null, 2));
    console.log('Configuração salva em:', configFilePath);
  } catch (error) {
    console.error('Falha ao salvar o arquivo:', error);
  }
});
// Adicione junto aos outros handlers no main.js
ipcMain.handle('join-path', (event, ...paths) => {
  return path.join(...paths);
});

// Handlers adicionais necessários para a compilação
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

ipcMain.handle('mkdir', (event, dirPath) => {
  return fs.mkdir(dirPath, { recursive: true });
});

ipcMain.handle('copy-file', (event, src, dest) => {
  return fs.copyFile(src, dest);
});

ipcMain.handle('directory-exists', async (event, dirPath) => {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
});

  // Manipulador para a chamada getAppPath
  ipcMain.handle('getAppPath', () => {
    return app.getAppPath(); // Retorna o caminho do app
  });

  ipcMain.handle('readDir', async (event, dirPath) => {
    try {
      const files = await fs.readdir(dirPath)
      return files
    } catch (error) {
      console.error('Error reading directory:', error)
      throw error
    }
  })

  ipcMain.handle('folder:open', async (_, folderPath) => {
    try {
        await shell.openPath(folderPath);
        return { success: true };
    } catch (error) {
        console.error('Error opening folder:', error);
        return { success: false, error: error.message };
    }
});

//ZIP
// Caminho do 7-Zip já garantido no PATH, não há necessidade de verificação
const sevenZipPath = "7z";

// Manipulador para criar backup com 7z
ipcMain.handle("create-backup", async (_, folderPath) => {
  if (!folderPath) {
    return { success: false, message: "Nenhuma pasta aberta para backup!" };
  }

  const folderName = path.basename(folderPath);
  const backupFolderPath = path.join(folderPath, "Backup"); // Caminho da pasta Backup
  const timestamp = moment().format("YYYY-MM-DD_HH-mm-ss"); // Data e hora no formato adequado
  const tempBackupFolderName = `backup_${timestamp}`; // Nome da pasta temporária
  const tempBackupFolderPath = path.join(folderPath, tempBackupFolderName); // Caminho da pasta temporária de backup
  const zipFileName = `${folderName}_${timestamp}.7z`; // Nome do arquivo compactado
  const zipFilePath = path.join(backupFolderPath, zipFileName); // Caminho completo do arquivo zip

  try {
    // Garantir que a pasta Backup exista
    await fse.ensureDir(backupFolderPath);
    console.log(`Pasta Backup criada ou já existe: ${backupFolderPath}`);

    // Criar a pasta temporária backup_[data]_[hora]
    await fse.ensureDir(tempBackupFolderPath);
    console.log(`Pasta temporária de backup criada: ${tempBackupFolderPath}`);

    // Copiar todos os arquivos, exceto a própria pasta Backup
    const files = await fse.readdir(folderPath);
    for (let file of files) {
      const sourcePath = path.join(folderPath, file);
      const destPath = path.join(tempBackupFolderPath, file);
      if (file !== "Backup" && file !== tempBackupFolderName) {
        await fse.copy(sourcePath, destPath);
        console.log(`Arquivo copiado: ${file}`);
      }
    }

    // Comando com 7-Zip, para compactar a pasta temporária
    // A mudança-chave é aqui - vamos para o diretório do projeto e comprimir a partir dali
    const command = `"${sevenZipPath}" a "${zipFilePath}" "${tempBackupFolderName}"`;

    return new Promise((resolve) => {
      // Execute o comando a partir do diretório do projeto
      exec(command, { cwd: folderPath }, async (error, stdout, stderr) => {
        if (error) {
          console.error("Erro ao criar backup:", stderr);
          resolve({ success: false, message: "Erro ao criar backup." });
        } else {
          console.log(`Backup criado com sucesso: ${zipFilePath}`);

          // Excluir a pasta temporária de backup após a compactação
          try {
            await fse.remove(tempBackupFolderPath);
            console.log(`Pasta temporária de backup excluída: ${tempBackupFolderPath}`);
          } catch (deleteError) {
            console.error("Erro ao excluir a pasta temporária:", deleteError);
          }

          resolve({ success: true, message: `Backup criado em: ${zipFilePath}` });
        }
      });
    });

  } catch (error) {
    console.error("Erro ao criar backup:", error);
    return { success: false, message: "Erro ao criar backup." };
  }
});

// Handler para limpar a pasta Temp
ipcMain.handle('clear-temp-folder', async () => {
  try {
    // Obtém o caminho base (mesmo usado para os arquivos TCL)
    const appPath = app.getAppPath();
    const basePath = path.join(appPath, '..', '..');
    const tempFolder = path.join(basePath, 'saphoComponents', 'Temp');
    // Remove a pasta Temp recursivamente, se existir
    await fs.rm(tempFolder, { recursive: true, force: true });
    console.log("Pasta Temp excluída:", tempFolder);
    return true;
  } catch (error) {
    console.error("Erro ao excluir a pasta Temp:", error);
    throw error;
  }
});

ipcMain.handle('create-tcl-info-file', async (event, { path: filePath, processorType, tempPath, binPath }) => {
  try {
    // Garante que a pasta do processador exista
    await fs.mkdir(tempPath, { recursive: true });
    const content = `${processorType}\n${tempPath}\n${binPath}\n`;
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`tcl_infos.txt criado em: ${filePath}`);
    return true;
  } catch (error) {
    console.error('Falha ao criar tcl_infos.txt:', error);
    throw error;
  }
});

ipcMain.handle('delete-tcl-file', async (event, filePath) => {
  try {
    await fs.unlink(filePath);
    console.log(`tcl_infos.txt deletado em: ${filePath}`);
    return true;
  } catch (error) {
    // Se o erro for "arquivo não encontrado", ignore
    if (error.code !== 'ENOENT') {
      console.error('Falha ao deletar tcl_infos.txt:', error);
      throw error;
    }
    return false;
  }
});

// Handler para obter informações do app
ipcMain.handle('get-app-info', () => {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    osInfo: `${os.type()} ${os.release()} (${os.arch()})`
  };
});


// Handler para deletar pasta
ipcMain.handle('delete-folder', async (_, folderPath) => {
  try {
    await fs.rm(folderPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error('Error deleting folder:', error);
    throw error;
  }
});