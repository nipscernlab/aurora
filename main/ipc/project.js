/**
 * Project lifecycle (open/close/create), processor CRUD, and per-project
 * config (processorConfig.json) load/save.
 */

const path = require('path');
const fs = require('fs').promises;
const fse = require('fs-extra');
const os = require('os');
const { app, BrowserWindow, ipcMain } = require('electron');
const log = require('electron-log');

const state = require('../state');

// ---- ProjectFile schema ----

class ProjectFile {
  constructor(projectPath) {
    this.metadata = {
      projectName: path.basename(projectPath),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      computerName: process.env.COMPUTERNAME || os.hostname(),
      appVersion: app.getVersion(),
      projectPath,
    };
    this.structure = {
      basePath: projectPath,
      processors: [],
      folders: [],
    };
  }

  toJSON() {
    return {
      metadata: this.metadata,
      structure: this.structure,
    };
  }
}

function updateProjectState(window, projectPath, spfPath) {
  if (window && window.webContents) {
    window.webContents.send('project:stateUpdate', {
      projectPath,
      spfPath,
      isOpen: !!projectPath,
    });
  }
}

function getProjectConfigPath(projectPath) {
  if (!projectPath) throw new Error('Project path is required for configuration operations');
  return path.join(projectPath, 'processorConfig.json');
}

function register() {
  // ---- project lifecycle ----

  ipcMain.handle('project:getInfo', async (_event, spfPath) => {
    if (!spfPath) throw new Error('No project file path provided');
    const exists = await fse.pathExists(spfPath);
    if (!exists) throw new Error(`Project file not found at: ${spfPath}`);
    return fse.readJSON(spfPath);
  });

  ipcMain.handle('project:createStructure', async (_event, projectPath, spfPath) => {
    try {
      await fse.mkdir(projectPath, { recursive: true });
      const projectFile = new ProjectFile(projectPath);
      await fse.writeFile(spfPath, JSON.stringify(projectFile.toJSON(), null, 2));

      await new Promise((resolve) => setTimeout(resolve, 0));

      const projectExists = await fse.pathExists(projectPath);
      const spfExists = await fse.pathExists(spfPath);
      if (!projectExists || !spfExists) {
        throw new Error('Failed to create project structure or .spf file');
      }

      const files = await fse.readdir(projectPath, { withFileTypes: true });
      const fileList = files.map((file) => ({
        name: file.name,
        isDirectory: file.isDirectory(),
        path: path.join(projectPath, file.name),
      }));

      const focusedWindow = BrowserWindow.getFocusedWindow();
      focusedWindow.webContents.send('simulateOpenProject', {
        canceled: false,
        filePaths: [projectPath],
      });

      return {
        success: true,
        projectData: projectFile.toJSON(),
        files: fileList,
        spfPath,
        projectPath,
      };
    } catch (error) {
      log.error('Error creating project structure:', error);
      throw error;
    }
  });

  ipcMain.handle('project:open', async (_event, spfPath) => {
    try {
      if (typeof spfPath !== 'string' || !spfPath.trim()) {
        return { success: false, message: 'No project path provided.' };
      }

      // Try to correct the path if the .spf doesn't exist (older formats placed
      // the file in <root>/<name>.spf vs <root>/<name>/<name>.spf).
      if (!(await fse.pathExists(spfPath))) {
        const projectName = path.basename(spfPath, '.spf');
        const correctedSpfPath = path.join(path.dirname(spfPath), projectName, `${projectName}.spf`);
        spfPath = correctedSpfPath;
        if (!(await fse.pathExists(spfPath))) {
          throw new Error('SPF file not found at both original and corrected paths.');
        }
      }

      state.currentOpenProjectPath = spfPath;
      const projectDirPath = path.dirname(spfPath);
      global.currentProjectPath = projectDirPath;
      if (!global.currentProject) global.currentProject = {};
      global.currentProject.path = projectDirPath;

      const spfContent = await fse.readFile(spfPath, 'utf8');
      const projectData = JSON.parse(spfContent);
      projectData.metadata.lastOpened = new Date().toISOString();

      const oldBasePath = projectData.structure.basePath;
      const basePathExists = await fse.pathExists(oldBasePath);
      if (!basePathExists) {
        const newBasePath = path.dirname(spfPath);
        projectData.metadata.projectPath = newBasePath;
        projectData.structure.basePath = newBasePath;
      }

      if (projectData.structure.processors) {
        projectData.structure.processors = await Promise.all(
          projectData.structure.processors.map(async (processor) => {
            const processorPath = path.join(projectData.structure.basePath, processor.name);
            const exists = await fse.pathExists(processorPath);
            return { ...processor, exists };
          }),
        );
      } else {
        projectData.structure.processors = [];
      }

      if (!projectData.structure.folders) projectData.structure.folders = [];

      await fse.writeFile(spfPath, JSON.stringify(projectData, null, 2));

      const files = await fse.readdir(projectData.structure.basePath, { withFileTypes: true });
      const fileList = files.map((file) => ({
        name: file.name,
        isDirectory: file.isDirectory(),
        path: path.join(projectData.structure.basePath, file.name),
      }));

      const focusedWindow = BrowserWindow.getFocusedWindow();
      updateProjectState(focusedWindow, projectData.structure.basePath, spfPath);

      focusedWindow.webContents.send('project:processorHubState', { enabled: true });
      focusedWindow.webContents.send('project:processors', {
        processors: projectData.structure.processors.map((p) => p.name),
        projectPath: projectData.structure.basePath,
      });

      return { projectData, files: fileList, spfPath };
    } catch (error) {
      log.error('Error opening project file:', error);
      throw error;
    }
  });

  ipcMain.handle('project:close', async () => {
    try {
      if (!state.currentOpenProjectPath && !global.currentProjectPath) {
        return { success: true, message: 'No project to close' };
      }

      state.currentOpenProjectPath = null;
      global.currentProjectPath = null;
      if (global.currentProject) global.currentProject = {};

      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow && !focusedWindow.isDestroyed()) {
        const notifications = [
          { channel: 'project:processorHubState', data: { enabled: false } },
          { channel: 'project:processors', data: { processors: [], projectPath: null } },
          { channel: 'project:fileTree', data: { files: [], projectPath: null } },
          { channel: 'project:closed', data: { success: true } },
        ];
        notifications.forEach(({ channel, data }) => focusedWindow.webContents.send(channel, data));
        updateProjectState(focusedWindow, null, null);
      }

      return { success: true };
    } catch (error) {
      log.error('Error closing project:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-current-project', async () => {
    if (!state.currentOpenProjectPath) return { projectOpen: false };
    try {
      const spfData = await fse.readFile(state.currentOpenProjectPath, 'utf8');
      const projectData = JSON.parse(spfData);
      return {
        projectOpen: true,
        projectPath: projectData.structure.basePath,
        spfPath: state.currentOpenProjectPath,
        processors: projectData.structure.processors.map((p) => p.name),
      };
    } catch (error) {
      log.error('Error getting current project:', error);
      return { projectOpen: false };
    }
  });

  // ---- processors ----

  ipcMain.handle('create-processor-project', async (_event, formData) => {
    try {
      if (!formData.projectLocation) throw new Error('Project location is required');

      const processorPath = path.join(formData.projectLocation, formData.processorName);
      const softwarePath = path.join(processorPath, 'Software');
      const hardwarePath = path.join(processorPath, 'Hardware');
      const simulationPath = path.join(processorPath, 'Simulation');

      try {
        await fse.access(processorPath);
        throw new Error(`A processor with name "${formData.processorName}" already exists`);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;

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
    // Øk. Você criou um processador em C±, mas e agora?
}`;

        const cmmFilePath = path.join(softwarePath, `${formData.processorName}.cmm`);
        await fse.writeFile(cmmFilePath, cmmContent, 'utf8');

        const spfPath = path.join(
          formData.projectLocation,
          `${path.basename(formData.projectLocation)}.spf`,
        );
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

        if (state.mainWindow) {
          state.mainWindow.webContents.send('processor-created', {
            processorName: formData.processorName,
            projectPath: formData.projectLocation,
          });
        }

        return { success: true, path: processorPath };
      }
    } catch (error) {
      log.error('Error in create-processor-project:', error);
      throw error;
    }
  });

  ipcMain.handle('get-available-processors', async (_event, projectPath) => {
    try {
      // Prefer the currently open project — most reliable source of truth.
      if (state.currentOpenProjectPath && (await fse.pathExists(state.currentOpenProjectPath))) {
        const spfData = await fse.readFile(state.currentOpenProjectPath, 'utf8');
        const projectData = JSON.parse(spfData);
        if (projectData.structure && projectData.structure.processors) {
          return projectData.structure.processors.map((p) => p.name);
        }
      }

      if (projectPath) {
        const stats = await fse.stat(projectPath);
        let spfPath;

        if (stats.isDirectory()) {
          const files = await fse.readdir(projectPath);
          const spfFile = files.find((file) => file.endsWith('.spf'));
          if (spfFile) spfPath = path.join(projectPath, spfFile);
        } else if (projectPath.endsWith('.spf')) {
          spfPath = projectPath;
        }

        if (spfPath && (await fse.pathExists(spfPath))) {
          const spfData = await fse.readFile(spfPath, 'utf8');
          const projectData = JSON.parse(spfData);
          if (projectData.structure && projectData.structure.processors) {
            return projectData.structure.processors.map((p) => p.name);
          }
        }
      }

      return [];
    } catch (error) {
      log.error('Error getting available processors:', error);
      return [];
    }
  });

  ipcMain.handle('delete-processor', async (_event, processorName) => {
    try {
      if (!state.currentOpenProjectPath) throw new Error('No open project');

      const spfData = await fse.readFile(state.currentOpenProjectPath, 'utf8');
      const projectData = JSON.parse(spfData);
      const projectDir = projectData.structure.basePath;

      const processorDir = path.join(projectDir, processorName);
      if (await fse.pathExists(processorDir)) await fse.remove(processorDir);

      if (projectData.structure.processors) {
        projectData.structure.processors = projectData.structure.processors.filter(
          (processor) => processor.name !== processorName,
        );
        await fse.writeFile(state.currentOpenProjectPath, JSON.stringify(projectData, null, 2));
      }

      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
        focusedWindow.webContents.send('project:processors', {
          processors: projectData.structure.processors.map((p) => p.name),
          projectPath: projectData.structure.basePath,
        });
      }

      return { success: true };
    } catch (error) {
      log.error('Error deleting processor:', error);
      throw error;
    }
  });

  // ---- per-project config ----

  ipcMain.handle('save-config', async (_event, data) => {
    try {
      if (!state.currentOpenProjectPath) throw new Error('No project is currently open');

      const spfData = await fse.readFile(state.currentOpenProjectPath, 'utf8');
      const projectData = JSON.parse(spfData);
      const projectPath = projectData.structure.basePath;

      // Ensure exactly one processor is active.
      if (data.processors && data.processors.length > 0) {
        let hasActive = false;
        data.processors = data.processors.map((proc) => {
          if (proc.isActive === true && !hasActive) {
            hasActive = true;
            return { ...proc, isActive: true };
          }
          return { ...proc, isActive: false };
        });
        if (!hasActive) data.processors[0].isActive = true;
      }

      const configFilePath = getProjectConfigPath(projectPath);
      await fs.writeFile(configFilePath, JSON.stringify(data, null, 2));
      return { success: true };
    } catch (error) {
      log.error('Failed to save configuration file:', error);
      throw error;
    }
  });

  ipcMain.handle('load-config-from-path', async (_event, configFilePath) => {
    try {
      try {
        await fs.access(configFilePath);
      } catch {
        const defaultConfig = {
          processors: [],
          iverilogFlags: [],
          cmmCompFlags: [],
          asmCompFlags: [],
          testbenchFile: 'standard',
          gtkwFile: 'standard',
        };
        await fs.writeFile(configFilePath, JSON.stringify(defaultConfig, null, 2));
        return defaultConfig;
      }

      const fileContent = await fs.readFile(configFilePath, 'utf-8');
      const config = JSON.parse(fileContent);

      config.processors = config.processors.map((proc, index) => {
        let isActive = false;
        if (proc.isActive !== undefined) {
          isActive = proc.isActive === true || proc.isActive === 'true';
        } else if (index === 0) {
          isActive = true;
        }
        return { ...proc, isActive };
      });

      const hasActiveProcessor = config.processors.some((p) => p.isActive === true);
      if (!hasActiveProcessor && config.processors.length > 0) {
        config.processors[0].isActive = true;
      }

      return config;
    } catch (error) {
      log.error('Failed to read configuration file:', error);
      return {
        processors: [],
        iverilogFlags: [],
        cmmCompFlags: [],
        asmCompFlags: [],
        testbenchFile: 'standard',
        gtkwFile: 'standard',
      };
    }
  });
}

module.exports = { register, ProjectFile, updateProjectState, getProjectConfigPath };
