// @ts-check
/**
 * Project lifecycle (open/close/create) e processor CRUD (main process).
 *
 * Per-project config: o .spf e a fonte canonica unica. Este modulo
 * cuida do lifecycle (open/close/create-project, create/delete-
 * processor) e reescreve o .spf nesses eventos. Mudancas de tree/
 * picker (synth files, top, testbench top) vivem no renderer via
 * SpfStore.update.
 */

const path = require('path');
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
      topLevelFile: '',
      testbenchFile: '',
      synthesizableFiles: [],
      testbenchFiles: [],
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
      focusedWindow?.webContents.send('simulateOpenProject', {
        canceled: false,
        filePaths: [projectPath],
      });

      // Newly-created project lands in the jumplist's Recent Projects
      // category too. Same path the open IPC takes; sharing it here
      // keeps "I just made a project, it should be in recents now"
      // working without an extra app launch.
      try {
        if (process.platform === 'win32') {
          if (typeof app.addRecentDocument === 'function') app.addRecentDocument(spfPath);
          const recents = require('../recents');
          recents.push(spfPath);
          const { rebuildJumpList } = require('../windows');
          rebuildJumpList();
        }
      } catch (e) {
        log.warn('jumplist refresh (createStructure) failed:', e);
      }

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

      // Track in our own recents store + refresh the Windows jumplist.
      // We don't use Windows' shell-managed `frequent`/`recent` lists
      // anymore (they surfaced stale "Electron" entries from earlier
      // dev runs) — instead `main/recents.js` owns the list and
      // `rebuildJumpList()` re-renders the "Recent Projects" custom
      // category every time a project opens. `addRecentDocument` is
      // still called so the file shows up in Win+E and File Explorer's
      // own recents.
      try {
        if (process.platform === 'win32') {
          if (typeof app.addRecentDocument === 'function') {
            app.addRecentDocument(spfPath);
          }
          const recents = require('../recents');
          recents.push(spfPath);
          const { rebuildJumpList } = require('../windows');
          rebuildJumpList();
        }
      } catch (e) {
        log.warn('jumplist refresh failed:', e);
      }
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
      if (!focusedWindow) {
        log.warn('open-spf-project: no focused window to send IPC events to');
        return projectData;
      }
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

        // Garante array antes do push e dedup case-insensitive: bugs
        // anteriores podiam acumular o mesmo nome multiplas vezes no
        // .spf, e da pra ainda haver arquivos no disco que escapem o
        // check de fs.access la em cima (race com criar manual).
        if (!Array.isArray(spfData.structure.processors)) {
          spfData.structure.processors = [];
        }
        const targetLower = formData.processorName.toLowerCase();
        const already = spfData.structure.processors.some(
          (p) => (typeof p === 'string' ? p : p?.name)?.toLowerCase() === targetLower
        );
        if (!already) {
          spfData.structure.processors.push({
            name: formData.processorName,
          });
        }

        await fse.writeFile(spfPath, JSON.stringify(spfData, null, 2));

        if (state.mainWindow) {
          // Channel `processor:created` — preload.js (onProcessorCreated)
          // escuta com esse nome (colon-separated, mesmo padrao de
          // `project:opened` e `project:processors`). O nome anterior
          // `processor-created` era um typo: o listener nunca disparava,
          // entao um novo processador so era refletido em
          // window.availableProcessors / file tree apos restart do app.
          state.mainWindow.webContents.send('processor:created', {
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
    // Parse #DIRECTIVE value lines from a .cmm file header.
    async function parseCmmHeader(projectDir, procName) {
      const cmmPath = path.join(projectDir, procName, 'Software', `${procName}.cmm`);
      try {
        const raw = await fse.readFile(cmmPath, 'utf8');
        const header = {};
        for (const line of raw.split('\n')) {
          const m = line.match(/^#([A-Z_]+)\s+(.+)/);
          if (m) header[m[1]] = m[2].trim();
        }
        return header;
      } catch (_) {
        return {};
      }
    }

    // Enrich the raw SPF processors array with clk/numClocks and CMM directives.
    async function enrichProcessors(procs, projectDir) {
      return Promise.all(procs.map(async (p) => {
        const name = typeof p === 'string' ? p : p.name;
        const cfg  = typeof p === 'object' && p !== null ? p : {};
        const clk       = Number.isFinite(cfg.clk)       ? cfg.clk       : 100;
        const numClocks = Number.isFinite(cfg.numClocks)  ? cfg.numClocks : 2000;
        const header = await parseCmmHeader(projectDir, name);
        return {
          name,
          clk,
          numClocks,
          showArrays: !!cfg.showArrays,
          simTime_us: numClocks / clk,
          header,
        };
      }));
    }

    try {
      // Prefer the currently open project — most reliable source of truth.
      if (state.currentOpenProjectPath && (await fse.pathExists(state.currentOpenProjectPath))) {
        const spfData = await fse.readFile(state.currentOpenProjectPath, 'utf8');
        const projectData = JSON.parse(spfData);
        if (projectData.structure && projectData.structure.processors) {
          return enrichProcessors(
            projectData.structure.processors,
            projectData.structure.basePath,
          );
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
            return enrichProcessors(
              projectData.structure.processors,
              projectData.structure.basePath,
            );
          }
        }
      }

      return [];
    } catch (error) {
      log.error('Error getting available processors:', error);
      return [];
    }
  });

  /**
   * Recently-opened projects. Pulls from `main/recents.js` (already
   * persisted on every project:open), prunes stale entries whose .spf
   * has been deleted, and returns the absolute paths so the renderer
   * (and Aurora Intelligence) can list them with a single round-trip.
   */
  ipcMain.handle('list-recent-projects', async () => {
    try {
      const recents = require('../recents');
      return recents.prune();
    } catch (e) {
      log.warn('list-recent-projects failed:', e?.message || e);
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

}

module.exports = { register, ProjectFile, updateProjectState };
