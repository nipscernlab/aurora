// @ts-check
/**
 * Rename IPC: rename-processor and rename-project. Grouped together because
 * both rename a watched folder on disk and so share the same machinery —
 * release chokidar watchers first (else Windows EPERM/EBUSY), move with
 * retry, then deep-remap every absolute path the .spf still pins to the old
 * location. The pure remap + watcher/move helpers live in ./helpers.js.
 *
 * Split out of project.js (2026-06); see ./index.js for the orchestrator.
 */

const path = require('path');
const fse = require('fs-extra');
const { app, BrowserWindow, ipcMain } = require('electron');
const log = require('electron-log');

const state = require('../../state');
const {
  remapProcessorPath,
  deepRemapPaths,
  releaseWatchersUnder,
  moveWithRetry,
} = require('./helpers');

function registerRename() {
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

      const nameOf = (/** @type {any} */ p) => (typeof p === 'string' ? p : p?.name);
      const idx = procs.findIndex((/** @type {any} */ p) => nameOf(p)?.toLowerCase() === oldNm.toLowerCase());
      if (idx === -1) throw new Error(`Processor "${oldNm}" not found in this project`);

      // Canonical current casing (the .spf entry, not what the caller typed).
      const currentName = nameOf(procs[idx]);
      const caseOnly = currentName.toLowerCase() === newNm.toLowerCase();

      if (!caseOnly) {
        const clash = procs.some(
          (/** @type {any} */ p, /** @type {any} */ i) => i !== idx && nameOf(p)?.toLowerCase() === newNm.toLowerCase(),
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
          processors: spfData.structure.processors.map((/** @type {any} */ p) => p.name),
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
      /** @type {any} */ (global).currentProjectPath = movedRoot;
      if (!/** @type {any} */ (global).currentProject) /** @type {any} */ (global).currentProject = {};
      /** @type {any} */ (global).currentProject.path = movedRoot;
      try {
        if (process.platform === 'win32') {
          if (typeof app.addRecentDocument === 'function') app.addRecentDocument(newSpfPath);
          const recents = require('../../recents');
          recents.push(newSpfPath);
          recents.prune();
          const { rebuildJumpList } = require('../../windows');
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

module.exports = { registerRename };
