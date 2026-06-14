// @ts-check
/**
 * Project lifecycle IPC: open / close / create-structure / getInfo /
 * get-current-project, plus the recents listing. These read and rewrite the
 * .spf on open (basePath reconciliation + deep path remap for a moved copy)
 * and broadcast processor/file-tree state to the renderer.
 *
 * Split out of project.js (2026-06); see ./index.js for the orchestrator.
 */

const path = require('path');
const fse = require('fs-extra');
const { app, BrowserWindow, ipcMain } = require('electron');
const log = require('electron-log');

const state = require('../../state');
const { ProjectFile, deepRemapPaths } = require('./helpers');

function registerLifecycle() {
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

      // Newly-created project lands in the jumplist's Recent Projects
      // category too. Same path the open IPC takes; sharing it here
      // keeps "I just made a project, it should be in recents now"
      // working without an extra app launch.
      try {
        if (process.platform === 'win32') {
          if (typeof app.addRecentDocument === 'function') app.addRecentDocument(spfPath);
          const recents = require('../../recents');
          recents.push(spfPath);
          const { rebuildJumpList } = require('../../windows');
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
      /** @type {any} */ (global).currentProjectPath = projectDirPath;

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
          const recents = require('../../recents');
          recents.push(spfPath);
          const { rebuildJumpList } = require('../../windows');
          rebuildJumpList();
        }
      } catch (e) {
        log.warn('jumplist refresh failed:', e);
      }
      if (!/** @type {any} */ (global).currentProject) /** @type {any} */ (global).currentProject = {};
      /** @type {any} */ (global).currentProject.path = projectDirPath;

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
          projectData.structure.processors.map(async (/** @type {any} */ processor) => {
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
        targetWindow.webContents.send('project:processorHubState', { enabled: true });
        targetWindow.webContents.send('project:processors', {
          processors: projectData.structure.processors.map((/** @type {any} */ p) => p.name),
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
      if (!state.currentOpenProjectPath && !/** @type {any} */ (global).currentProjectPath) {
        return { success: true, message: 'No project to close' };
      }

      state.currentOpenProjectPath = null;
      /** @type {any} */ (global).currentProjectPath = null;
      if (/** @type {any} */ (global).currentProject) /** @type {any} */ (global).currentProject = {};

      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow && !focusedWindow.isDestroyed()) {
        const notifications = [
          { channel: 'project:processorHubState', data: { enabled: false } },
          { channel: 'project:processors', data: { processors: [], projectPath: null } },
          { channel: 'project:fileTree', data: { files: [], projectPath: null } },
          { channel: 'project:closed', data: { success: true } },
        ];
        notifications.forEach(({ channel, data }) => focusedWindow.webContents.send(channel, data));
      }

      return { success: true };
    } catch (error) {
      log.error('Error closing project:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
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
        processors: projectData.structure.processors.map((/** @type {any} */ p) => p.name),
      };
    } catch (error) {
      log.error('Error getting current project:', error);
      return { projectOpen: false };
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
      const recents = require('../../recents');
      return recents.prune();
    } catch (e) {
      log.warn('list-recent-projects failed:', e instanceof Error ? e.message : e);
      return [];
    }
  });
}

module.exports = { registerLifecycle };
