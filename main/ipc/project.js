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

/**
 * Remap a single absolute path that lived under a processor's working
 * directory when that processor is renamed `oldName` → `newName`.
 *
 * Only paths *inside* `<projectDir>/<oldName>/` are touched. The directory
 * prefix is rewritten, and the basename is swapped only when it is one of
 * SAPHO's processor-named build artifacts (`<old>.cmm`, `<old>.asm`,
 * `<old>.v`, `<old>_tb.v`). User-named files inside the folder keep their
 * basename — they just follow the folder to its new location. Paths outside
 * the processor folder are returned unchanged.
 */
function remapProcessorPath(p, projectDir, oldName, newName) {
  if (!p || typeof p !== 'string') return p;
  const toNative = (s) => s.replace(/\//g, path.sep);
  const native = toNative(p);
  const oldDir = toNative(path.join(projectDir, oldName));
  const lower = native.toLowerCase();
  const oldLower = oldDir.toLowerCase();
  const inside = lower === oldLower || lower.startsWith(oldLower + path.sep.toLowerCase());
  if (!inside) return p;

  const rest = native.slice(oldDir.length); // '' or '\Hardware\old.v'
  let out = path.join(projectDir, newName) + rest;

  // Swap the proc-named SAPHO artifacts in the basename only.
  const dir = path.dirname(out);
  const base = path.basename(out);
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const swapped = base.replace(
    new RegExp(`^${escaped}(_tb)?(\\.v|\\.sv|\\.asm|\\.cmm)$`, 'i'),
    (_m, tb, ext) => `${newName}${tb || ''}${ext}`,
  );
  return out === native && swapped === base ? out : path.join(dir, swapped);
}

/**
 * Rewrite an absolute path that lived under `oldRoot` to sit under
 * `newRoot` instead. Case-insensitive prefix match (Windows). Anything
 * outside `oldRoot` is returned verbatim. Used when a whole project folder
 * is renamed.
 */
function remapRootPath(p, oldRoot, newRoot) {
  if (!p || typeof p !== 'string') return p;
  const native = p.replace(/\//g, path.sep);
  const oldN = oldRoot.replace(/\//g, path.sep);
  const lower = native.toLowerCase();
  const oldLower = oldN.toLowerCase();
  if (lower === oldLower) return newRoot;
  if (lower.startsWith(oldLower + path.sep.toLowerCase())) {
    return newRoot + native.slice(oldN.length);
  }
  return p;
}

/**
 * Deep-walk an object and remap every string value that points inside
 * `oldRoot` to `newRoot`. Catches every persisted absolute path in the
 * .spf (file lists, command-override cwd/env, …) so a project rename
 * leaves no stale path behind — "em todos os lugares necessários".
 */
function deepRemapPaths(obj, oldRoot, newRoot) {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') obj[i] = remapRootPath(obj[i], oldRoot, newRoot);
      else deepRemapPaths(obj[i], oldRoot, newRoot);
    }
  } else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'string') obj[k] = remapRootPath(obj[k], oldRoot, newRoot);
      else deepRemapPaths(obj[k], oldRoot, newRoot);
    }
  }
}

/**
 * Close every chokidar watcher (directory + per-file) rooted inside
 * `rootDir` so the OS doesn't keep a handle on the folder we're about to
 * rename. Without this, a directory rename fails with EPERM/EBUSY on
 * Windows. The renderer re-establishes its watchers when it reopens the
 * project at the new path.
 */
async function releaseWatchersUnder(rootDir) {
  const sep = path.sep.toLowerCase();
  const r = rootDir.replace(/\//g, path.sep).toLowerCase();
  const under = (p) => {
    const n = String(p || '').replace(/\//g, path.sep).toLowerCase();
    return n === r || n.startsWith(r + sep);
  };
  // chokidar's close() can hang on Windows while the watched tree is mid-change;
  // if it wedges, a rename would stall until the IPC's tool timeout (the
  // "renomeação excedeu o tempo limite" symptom). Bound each close so handle
  // release is best-effort but never blocks the rename — moveWithRetry below
  // absorbs a lock that wasn't quite released in time.
  const closeBounded = (watcher) => Promise.race([
    Promise.resolve().then(() => watcher.close()).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  // Close ALL matching watchers concurrently. Awaiting them one-at-a-time
  // serialized N watchers into N×1.5s of wedge time — on a project with many
  // files that alone overran the tool timeout, so the rename only "finished"
  // around the 120s mark and its success reply lost the race to the timer
  // (the "spins forever / false timeout" symptom). Firing them together
  // collapses the whole release to ~one 1.5s bound. Each map entry is deleted
  // only after its own close settles, so the maps stay consistent.
  const jobs = [];
  for (const [dirPath, info] of [...state.activeDirectoryWatchers.entries()]) {
    if (under(dirPath)) {
      jobs.push(closeBounded(info.watcher).then(() => {
        state.activeDirectoryWatchers.delete(dirPath);
        state.directoryStatsCache.delete(dirPath);
      }));
    }
  }
  for (const [filePath, info] of [...state.activeWatchers.entries()]) {
    if (under(info.filePath || filePath)) {
      jobs.push(closeBounded(info.watcher).then(() => {
        state.activeWatchers.delete(filePath);
      }));
    }
  }
  await Promise.all(jobs);
}

/** fse.move with a few quick retries — Windows AV/indexer can briefly lock. */
async function moveWithRetry(from, to, options = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fse.move(from, to, options);
      return;
    } catch (err) {
      lastErr = err;
      if (err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'ENOTEMPTY')) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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

  ipcMain.handle('project:open', async (event, spfPath) => {
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

      // basePath SEMPRE alinha com dirname(spfPath). Antes checavamos so
      // existence (oldBasePath nao existe -> reconcilia); mas isso falhava
      // quando o user copiava o projeto pra outra pasta no MESMO PC -
      // oldBasePath ainda existia (apontando pro projeto original), nao
      // reconciliava, e os paths relativos do .spf eram resolvidos contra
      // o basePath errado. Comparar com dirname(spfPath) trata os 2 casos
      // (outro PC E mesma maquina) de forma uniforme. Trade-off: se algum
      // user mantiver basePath propositalmente diferente do dirname do
      // .spf, ele e sobrescrito (cenario muito improvavel).
      const oldBasePath = projectData.structure.basePath;
      const expectedBasePath = path.dirname(spfPath);
      if (oldBasePath !== expectedBasePath) {
        // Relocate every absolute path the .spf still pins to the OLD root so a
        // copied/backed-up project keeps working. The file lists are stored
        // relative (untouched here), but command overrides keep freeform
        // absolutes — appendArgs/prependArgs tokens, envSet values — that the
        // relative-on-disk scheme can't safely round-trip (it can't tell a path
        // from `-O2` or `2`). A root prefix-swap can: remapRootPath only rewrites
        // strings genuinely under oldRoot, leaving flags and out-of-project paths
        // alone. Same transform the rename flow applies, run here on move/copy.
        if (oldBasePath && path.isAbsolute(oldBasePath)) {
          deepRemapPaths(projectData.structure, oldBasePath, expectedBasePath);
        }
        projectData.metadata.projectPath = expectedBasePath;
        projectData.structure.basePath = expectedBasePath;
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

      // Prefer the window that actually sent the request. During a startup
      // auto-open the main window isn't focused yet — the splash is still on
      // top and the main window is created hidden (deferShow) — so
      // getFocusedWindow() returns null. Falling back to the sender keeps the
      // processor list flowing AND, crucially, keeps the return shape
      // consistent: the renderer reads result.projectData.structure.processors
      // to group the file tree by processor. The old `return projectData`
      // early-exit returned a different shape, so on auto-open the renderer
      // saw no processors and rendered every file in one flat, ungrouped list.
      const targetWindow = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow();
      if (targetWindow && !targetWindow.isDestroyed()) {
        updateProjectState(targetWindow, projectData.structure.basePath, spfPath);
        targetWindow.webContents.send('project:processorHubState', { enabled: true });
        targetWindow.webContents.send('project:processors', {
          processors: projectData.structure.processors.map((p) => p.name),
          projectPath: projectData.structure.basePath,
        });
      } else {
        log.warn('open-spf-project: no window to send IPC events to');
      }

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

  /**
   * Rename a processor across every SAPHO-internal surface:
   *   - the processor working directory  <root>/<old>  →  <root>/<new>
   *   - the source file  Software/<old>.cmm  →  Software/<new>.cmm
   *   - the `#PRNAME` directive inside that .cmm (directive line ONLY —
   *     user comments and code are never touched)
   *   - the auto-generated build artifacts (asm / Hardware .v / Simulation
   *     _tb.v) so stale-named files don't linger; they regenerate on the
   *     next compile anyway
   *   - the .spf: the processors[] entry (clk/numClocks/showArrays config is
   *     preserved) and any path reference (topLevelFile / testbenchFile /
   *     synthesizableFiles / testbenchFiles) that pointed inside the folder.
   *
   * Custom user toplevels / testbenches that live at the project root are
   * intentionally left alone — the user renames those explicitly.
   */
  ipcMain.handle('rename-processor', async (_event, oldName, newName) => {
    try {
      if (!state.currentOpenProjectPath) throw new Error('No open project');

      const oldNm = String(oldName || '').trim();
      const newNm = String(newName || '').trim();
      if (!oldNm) throw new Error('Current processor name is required');
      if (!newNm) throw new Error('New processor name is required');
      if (!/^[A-Za-z0-9_-]+$/.test(newNm)) {
        throw new Error('Processor name may contain only letters, numbers, underscore or hyphen');
      }

      const spfData = JSON.parse(await fse.readFile(state.currentOpenProjectPath, 'utf8'));
      const projectDir = spfData.structure.basePath;
      const procs = Array.isArray(spfData.structure.processors)
        ? spfData.structure.processors : [];

      const nameOf = (p) => (typeof p === 'string' ? p : p?.name);
      const idx = procs.findIndex((p) => nameOf(p)?.toLowerCase() === oldNm.toLowerCase());
      if (idx === -1) throw new Error(`Processor "${oldNm}" not found in this project`);

      // Canonical current casing (the .spf entry, not what the caller typed).
      const currentName = nameOf(procs[idx]);
      const caseOnly = currentName.toLowerCase() === newNm.toLowerCase();

      if (!caseOnly) {
        const clash = procs.some(
          (p, i) => i !== idx && nameOf(p)?.toLowerCase() === newNm.toLowerCase(),
        );
        if (clash) throw new Error(`A processor named "${newNm}" already exists`);
      }

      const oldDir = path.join(projectDir, currentName);
      const newDir = path.join(projectDir, newNm);

      if (!(await fse.pathExists(oldDir))) {
        throw new Error(`Processor folder not found: ${oldDir}`);
      }
      if (!caseOnly && (await fse.pathExists(newDir))) {
        throw new Error(`A folder named "${newNm}" already exists in the project`);
      }

      // Release the project's file/dir watchers FIRST. chokidar
      // (ReadDirectoryChangesW) keeps a handle on the watched tree, so moving
      // a watched subfolder otherwise fails with EPERM ("operation not
      // permitted") — exactly the processor-rename failure. The renderer
      // re-establishes watching after the rename.
      await releaseWatchersUnder(projectDir);

      // 1. Move the processor directory. A case-only rename on a
      //    case-insensitive FS (Windows) needs a temp hop so the OS
      //    actually re-cases the folder. moveWithRetry rides out a brief
      //    residual lock (AV / indexer / a just-released watcher handle).
      if (caseOnly) {
        const tmpDir = path.join(projectDir, `__rename_${Date.now()}__`);
        await moveWithRetry(oldDir, tmpDir, { overwrite: false });
        await moveWithRetry(tmpDir, newDir, { overwrite: false });
      } else {
        await moveWithRetry(oldDir, newDir, { overwrite: false });
      }

      // 2. Rename the SAPHO-managed files that carry the processor name.
      const artifactRenames = [
        ['Software',   `${currentName}.cmm`,   `${newNm}.cmm`],
        ['Software',   `${currentName}.asm`,   `${newNm}.asm`],
        ['Hardware',   `${currentName}.v`,     `${newNm}.v`],
        ['Simulation', `${currentName}_tb.v`,  `${newNm}_tb.v`],
      ];
      for (const [sub, fromF, toF] of artifactRenames) {
        if (fromF === toF) continue;
        const fromP = path.join(newDir, sub, fromF);
        const toP = path.join(newDir, sub, toF);
        if (await fse.pathExists(fromP)) {
          await fse.move(fromP, toP, { overwrite: true });
        }
      }

      // 3. Patch the #PRNAME directive in the .cmm — directive line ONLY.
      const cmmPath = path.join(newDir, 'Software', `${newNm}.cmm`);
      if (await fse.pathExists(cmmPath)) {
        const raw = await fse.readFile(cmmPath, 'utf8');
        const patched = raw.replace(/^([ \t]*#PRNAME[ \t]+)\S+/m, `$1${newNm}`);
        if (patched !== raw) await fse.writeFile(cmmPath, patched, 'utf8');
      }

      // 4. Update the processors[] entry, preserving per-processor config.
      procs[idx] = typeof procs[idx] === 'string'
        ? { name: newNm }
        : { ...procs[idx], name: newNm };
      spfData.structure.processors = procs;

      // 5. Remap any .spf path reference that lived under the old folder.
      spfData.structure.topLevelFile =
        remapProcessorPath(spfData.structure.topLevelFile, projectDir, currentName, newNm);
      spfData.structure.testbenchFile =
        remapProcessorPath(spfData.structure.testbenchFile, projectDir, currentName, newNm);
      for (const key of ['synthesizableFiles', 'testbenchFiles']) {
        const arr = Array.isArray(spfData.structure[key]) ? spfData.structure[key] : [];
        for (const f of arr) {
          if (f && typeof f === 'object' && f.path) {
            const np = remapProcessorPath(f.path, projectDir, currentName, newNm);
            if (np !== f.path) {
              f.path = np;
              f.name = path.basename(np);
            }
          }
        }
      }

      if (spfData.metadata) spfData.metadata.lastModified = new Date().toISOString();
      await fse.writeFile(state.currentOpenProjectPath, JSON.stringify(spfData, null, 2));

      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
        focusedWindow.webContents.send('project:processors', {
          processors: spfData.structure.processors.map((p) => p.name),
          projectPath: projectDir,
        });
        focusedWindow.webContents.send('processor:renamed', {
          oldName: currentName, newName: newNm, projectPath: projectDir, oldDir, newDir,
        });
      }

      return { success: true, oldName: currentName, newName: newNm, oldDir, newDir };
    } catch (error) {
      log.error('Error renaming processor:', error);
      throw error;
    }
  });

  /**
   * Rename the currently open project. This renames BOTH the project root
   * folder (<location>/<old> → <location>/<new>) and the project file
   * (<old>.spf → <new>.spf), updates the .spf metadata (projectName,
   * projectPath, basePath) and deep-remaps every absolute path stored in
   * the .spf (synth/testbench file lists, top-level/testbench pointers,
   * command-override cwd/env, …) from the old root to the new one.
   *
   * Open chokidar watchers under the old root are released first so the
   * folder rename can't fail with EPERM/EBUSY on Windows. Main-process
   * state + the recents/jumplist are updated to the new .spf path; the
   * renderer reopens the project there.
   *
   * Processor folders are subdirectories of the root, so they move with it
   * — their #PRNAME directives and per-processor names are unaffected by a
   * project rename (use rename_processor for those).
   */
  ipcMain.handle('rename-project', async (_event, newName) => {
    try {
      if (!state.currentOpenProjectPath) throw new Error('No open project');

      const newNm = String(newName || '').trim();
      if (!newNm) throw new Error('New project name is required');
      if (!/^[A-Za-z0-9_-]+$/.test(newNm)) {
        throw new Error('Project name may contain only letters, numbers, underscore or hyphen');
      }

      const oldSpfPath = state.currentOpenProjectPath;
      const oldRoot = path.dirname(oldSpfPath);
      const parent = path.dirname(oldRoot);
      const oldFolderName = path.basename(oldRoot);
      const oldSpfBase = path.basename(oldSpfPath);

      const spfData = JSON.parse(await fse.readFile(oldSpfPath, 'utf8'));
      const oldName = spfData.metadata?.projectName
        || path.basename(oldSpfPath, '.spf');

      const newRoot = path.join(parent, newNm);
      const folderCaseOnly = oldFolderName.toLowerCase() === newNm.toLowerCase();
      const needFolderMove = oldFolderName !== newNm;

      if (needFolderMove && !folderCaseOnly && (await fse.pathExists(newRoot))) {
        throw new Error(`A folder named "${newNm}" already exists at ${parent}`);
      }

      // 1. Release watchers so the folder isn't locked during the move.
      await releaseWatchersUnder(oldRoot);

      // 2. Rename the project root folder (temp hop for a case-only change).
      let movedRoot = oldRoot;
      if (needFolderMove) {
        if (folderCaseOnly) {
          const tmp = path.join(parent, `__aurora_rename_${Date.now()}__`);
          await moveWithRetry(oldRoot, tmp);
          await moveWithRetry(tmp, newRoot);
        } else {
          await moveWithRetry(oldRoot, newRoot);
        }
        movedRoot = newRoot;
      }

      // 3. Rename the .spf inside the (possibly moved) root.
      const currentSpfInRoot = path.join(movedRoot, oldSpfBase);
      const newSpfPath = path.join(movedRoot, `${newNm}.spf`);
      if (currentSpfInRoot.toLowerCase() !== newSpfPath.toLowerCase()) {
        if (await fse.pathExists(currentSpfInRoot)) {
          await moveWithRetry(currentSpfInRoot, newSpfPath, { overwrite: false });
        }
      } else if (currentSpfInRoot !== newSpfPath) {
        const tmp = path.join(movedRoot, `__aurora_rename_${Date.now()}__.spf`);
        await moveWithRetry(currentSpfInRoot, tmp);
        await moveWithRetry(tmp, newSpfPath);
      }

      // 4. Update metadata + deep-remap every absolute path old → new.
      spfData.metadata = spfData.metadata || {};
      spfData.metadata.projectName = newNm;
      spfData.metadata.projectPath = movedRoot;
      spfData.metadata.lastModified = new Date().toISOString();
      spfData.structure = spfData.structure || {};
      spfData.structure.basePath = movedRoot;
      // Remap the ENTIRE .spf — not just structure — so no absolute path
      // anywhere is left pointing at the old root: the synth/testbench file
      // lists, the top-level/testbench pointers, per-processor entries,
      // persisted command-override cwd/env (structure.commandOverrides),
      // gtkw save files, AND any future top-level field. metadata.projectName
      // (a name, not a path) and the already-updated projectPath/basePath are
      // safe: remapRootPath only rewrites strings that sit under oldRoot.
      deepRemapPaths(spfData, oldRoot, movedRoot);

      await fse.writeFile(newSpfPath, JSON.stringify(spfData, null, 2));

      // 5. Re-sync main-process state + recents/jumplist to the new path.
      state.currentOpenProjectPath = newSpfPath;
      global.currentProjectPath = movedRoot;
      if (!global.currentProject) global.currentProject = {};
      global.currentProject.path = movedRoot;
      try {
        if (process.platform === 'win32') {
          if (typeof app.addRecentDocument === 'function') app.addRecentDocument(newSpfPath);
          const recents = require('../recents');
          recents.push(newSpfPath);
          recents.prune();
          const { rebuildJumpList } = require('../windows');
          rebuildJumpList();
        }
      } catch (e) {
        log.warn('jumplist refresh (rename-project) failed:', e);
      }

      return {
        success: true,
        oldName,
        newName: newNm,
        oldRoot,
        newRoot: movedRoot,
        oldSpfPath,
        newSpfPath,
      };
    } catch (error) {
      log.error('Error renaming project:', error);
      throw error;
    }
  });

}

module.exports = { register, ProjectFile, updateProjectState };
