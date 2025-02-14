const { app, BrowserWindow, ipcMain, shell, dialog, Menu} = require('electron');
const { autoUpdater } = require('electron-updater');
const { exec } = require('child_process');
const path = require('path');
const fse = require('fs-extra'); // fs-extra makes it easier to copy directories
const fs = require('fs').promises;
const { spawn } = require('child_process'); // Importa spawn corretamente 

let mainWindow, splashWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'assets/icons/aurora_borealis-2.ico'),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'js', 'preload.js'),
    },
    backgroundColor: '#1e1e1e',
    show: false,
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

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
    setTimeout(checkForUpdates, 4000);
  }, 4000);
}

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
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`Progresso do download: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', async () => {
    console.log('Download concluído. Perguntando ao usuário sobre a instalação.');
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Instalar Atualização',
      message: 'A atualização foi baixada. Instalar agora?',
      buttons: ['Sim', 'Depois'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      console.log('Fechando o aplicativo e instalando a atualização.');
      autoUpdater.quitAndInstall(true, true);
      installExecutables();
    }
  });
  

  autoUpdater.on('error', (err) => {
    console.error('Erro na atualização:', err);
  });
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
#DIRNAM "."
#DATYPE ${formData.pointType === 'fixed' ? '0' : '1'}
#NBMANT ${formData.nbMantissa}
#NUBITS ${formData.nBits}
#NUGAIN ${formData.gain}
#NDSTAC ${formData.dataStackSize}
#SDEPTH ${formData.instructionStackSize}
#NUIOIN ${formData.inputPorts}
#NUIOOU ${formData.outputPorts}

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
  try {
    await fse.mkdir(projectPath, { recursive: true });
    const projectFile = new ProjectFile(projectPath);
    await fse.writeFile(spfPath, JSON.stringify(projectFile.toJSON(), null, 2));

    const files = await fse.readdir(projectPath, { withFileTypes: true });
    const fileList = files.map(file => ({
      name: file.name,
      isDirectory: file.isDirectory(),
      path: path.join(projectPath, file.name)
    }));

    const focusedWindow = BrowserWindow.getFocusedWindow();
    updateProjectState(focusedWindow, projectPath, spfPath);

    // Enviar um evento específico para habilitar o Processor Hub
    focusedWindow.webContents.send('project:processorHubState', { enabled: true });

    // Enviar evento para carregar o projeto automaticamente
    focusedWindow.webContents.send('project:created', {
      projectData: projectFile.toJSON(),
      files: fileList,
      spfPath,
      projectPath
    });

    // Simular a abertura do projeto após a criação
    focusedWindow.webContents.send('project:open', {
      projectData: projectFile.toJSON(),
      files: fileList,
      spfPath,
      projectPath
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

// Caminho para o 7-Zip
const sevenZipPath = `"C:\\Program Files\\7-Zip\\7z.exe"`;

// Manipulador para criar backup com 7z
ipcMain.handle("create-backup", async (_, folderPath) => {
  if (!folderPath) {
    return { success: false, message: "Nenhuma pasta aberta para backup!" };
  }

  const folderName = path.basename(folderPath);
  const zipFileName = `${folderName}.7z`;

  // Define o caminho onde o backup será salvo (dentro da própria pasta do projeto)
  const zipFilePath = path.join(folderPath, zipFileName);

  // Comando atualizado com o caminho completo do arquivo
  const command = `${sevenZipPath} a "${zipFilePath}" "${folderPath}"`;

  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error("Erro ao criar backup:", stderr);
        resolve({ success: false, message: "Erro ao criar backup." });
      } else {
        console.log(`Backup criado com sucesso: ${zipFilePath}`);
        resolve({ success: true, message: `Backup criado em: ${zipFilePath}` });
      }
    });
  });
});


function installExecutables() {
  const iverilogPath = path.join(__dirname, 'saphoComponents', 'Packages', 'iverilog-v1.exe');
  const sevenZipPath = path.join(__dirname, 'saphoComponents', 'Packages', '7z-v1.exe');

  console.log("Iniciando instalação do Icarus Verilog...");

  execFile(iverilogPath, [], (error, stdout, stderr) => {
      if (error) {
          console.error(`Erro ao instalar Icarus Verilog: ${error.message}`);
          return;
      }
      console.log(`Icarus Verilog instalado com sucesso: ${stdout}`);

      console.log("Iniciando instalação do 7-Zip...");
      
      execFile(sevenZipPath, [], (error, stdout, stderr) => {
          if (error) {
              console.error(`Erro ao instalar 7-Zip: ${error.message}`);
              return;
          }
          console.log(`7-Zip instalado com sucesso: ${stdout}`);
      });
  });
}

// Função para criar o tcl_infox.txt
async function createTclInfoFile(tclInfoPath, processorType, tempPath, binPath) {
  try {
      // Certifique-se de que a pasta Temp existe antes de criar o arquivo
      await fs.mkdir(path.dirname(tclInfoPath), { recursive: true });

      // Conteúdo do arquivo
      const content = `${processorType}\n${tempPath}\n${binPath}`;

      // Cria o arquivo tcl_infox.txt
      await fs.writeFile(tclInfoPath, content, 'utf8');
      console.log(`Arquivo ${tclInfoPath} criado com sucesso.`);
  } catch (error) {
      console.error('Erro ao criar tcl_infox.txt:', error);
  }
}

// Expor a função para o Renderer usar
ipcMain.handle('createTclInfoFile', async (event, tclInfoPath, processorType, tempPath, binPath) => {
  await createTclInfoFile(tclInfoPath, processorType, tempPath, binPath);
});