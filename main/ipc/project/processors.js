// @ts-check
/**
 * Processor CRUD IPC: create / list-available / delete. Each reads and
 * rewrites the open project's .spf processors[] array and broadcasts the
 * updated list to the renderer. Processor *rename* lives in ./rename.js
 * because it shares the watcher-release / move-with-retry machinery with
 * project rename.
 *
 * Split out of project.js (2026-06); see ./index.js for the orchestrator.
 */

const path = require('path');
const fse = require('fs-extra');
const { BrowserWindow, ipcMain } = require('electron');
const log = require('electron-log');

const state = require('../../state');

function registerProcessors() {
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
        if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;

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
          (/** @type {any} */ p) => (typeof p === 'string' ? p : p?.name)?.toLowerCase() === targetLower
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
    async function parseCmmHeader(/** @type {any} */ projectDir, /** @type {any} */ procName) {
      const cmmPath = path.join(projectDir, procName, 'Software', `${procName}.cmm`);
      try {
        const raw = await fse.readFile(cmmPath, 'utf8');
        /** @type {Record<string, any>} */
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
    async function enrichProcessors(/** @type {any} */ procs, /** @type {any} */ projectDir) {
      return Promise.all(procs.map(async (/** @type {any} */ p) => {
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
          (/** @type {any} */ processor) => processor.name !== processorName,
        );
        await fse.writeFile(state.currentOpenProjectPath, JSON.stringify(projectData, null, 2));
      }

      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
        focusedWindow.webContents.send('project:processors', {
          processors: projectData.structure.processors.map((/** @type {any} */ p) => p.name),
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

module.exports = { registerProcessors };
