// @ts-check
/**
 * File system + dialogs + chokidar watchers.
 *
 * Most renderer-side file operations live here: read/write/delete/copy/mkdir,
 * watcher start/stop, and the generic open/save dialogs.
 */

const path = require('path');
const fs = require('fs').promises;
const fse = require('fs-extra');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const chokidar = require('chokidar');
const log = require('electron-log');
const { execFile } = require('child_process');

const state = require('../state');
const { debounce, safePath, formatTimestamp } = require('../utils');
const {
  compararEntradas,
  planoDeRenomear,
  comandoCompactar,
  nomesDoBackup,
  entraNoBackup,
  urlExternaPermitida,
  comandoTerminalNativo,
  pastaInicialDoDialogo,
  acharWatcher,
  ausenciaEsperada,
} = require('./files_ops');

// Recursively scan a directory and return a tree of {name, path, type, children?}.
async function scanDirectory(/** @type {string} */ dirPath) {
  /**
   * @param {string} currentPath
   * @returns {Promise<any[]>}
   */
  async function buildTree(currentPath, _isRoot = false, depth = 0) {
    const MAX_DEPTH = 20;
    if (depth > MAX_DEPTH) {
      log.warn(`Maximum depth reached at: ${currentPath}`);
      return [];
    }

    try {
      try {
        await fs.access(currentPath);
      } catch {
        log.warn(`Directory not accessible: ${currentPath}`);
        return [];
      }

      const items = await fs.readdir(currentPath, { withFileTypes: true });
      const result = [];

      items.sort(compararEntradas);

      for (const item of items) {
        if (item.isSymbolicLink()) continue;

        const fullPath = path.join(currentPath, item.name);
        const relativePath = path.relative(dirPath, fullPath);

        if (item.isDirectory()) {
          const children = await buildTree(fullPath, false, depth + 1);
          result.push({
            name: item.name,
            path: fullPath,
            relativePath,
            type: 'directory',
            children,
          });
        } else {
          result.push({
            name: item.name,
            path: fullPath,
            relativePath,
            type: 'file',
          });
        }
      }
      return result;
    } catch (error) {
      log.error(`Error scanning directory ${currentPath}:`, error);
      return [];
    }
  }

  return buildTree(dirPath, true, 0);
}

// Restart a file watcher in place. Used when chokidar errors out.
async function restartWatcher(/** @type {string} */ filePath, /** @type {any} */ event) {
  const existingWatcher = state.activeWatchers.get(filePath);
  if (existingWatcher) {
    try {
      await existingWatcher.watcher.close();
    } catch (closeError) {
      log.error(`Error closing existing watcher: ${closeError}`);
    }
    state.activeWatchers.delete(filePath);
  }
  return ipcMain.emit('watch-file', event, filePath);
}

function register() {
  // ---------- file ops ----------

  ipcMain.handle('read-file', async (_event, filePath) => {
    filePath = safePath(filePath, 'filePath');
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      // "Nao existe" nao e erro do aplicativo: varios chamadores leem arquivo
      // opcional e tratam a ausencia. Registrar como erro enchia o log de linha
      // vermelha para condicao esperada e escondia a falha de verdade no meio.
      // O throw continua, porque quem chamou precisa saber; so o nivel muda.
      const msg = error instanceof Error ? error.message : String(error);
      if (ausenciaEsperada(error)) log.debug(`read-file: ausente (esperado em arquivo opcional): ${msg}`);
      else log.error(`Error reading file: ${msg}`);
      throw error;
    }
  });

  ipcMain.handle('read-file-buffer', async (_event, filePath) => {
    filePath = safePath(filePath, 'filePath');
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      log.error('Error reading binary file:', error);
      throw error;
    }
  });

  ipcMain.handle('write-file', async (_event, filePath, content) => {
    filePath = safePath(filePath, 'filePath');
    try {
      const dir = path.dirname(filePath);
      await fse.ensureDir(dir);
      await fse.writeFile(filePath, content);
      return { success: true };
    } catch (error) {
      log.error('Error writing file:', error);
      throw new Error(`Failed to write file: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });

  ipcMain.handle('file-exists', async (_event, filePath) => {
    try {
      await fs.access(safePath(filePath, 'filePath'));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('path-exists', async (_event, filePath) => {
    try {
      await fs.access(safePath(filePath, 'filePath'));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('mkdir', (_event, dirPath) =>
    fs.mkdir(safePath(dirPath, 'dirPath'), { recursive: true }),
  );

  ipcMain.handle('create-directory', async (_event, dirPath) => {
    dirPath = safePath(dirPath, 'dirPath');
    try {
      await fse.ensureDir(dirPath);
      return { success: true };
    } catch (error) {
      log.error('Error creating directory:', error);
      throw error;
    }
  });

  ipcMain.handle('copy-file', (_event, src, dest) =>
    fs.copyFile(safePath(src, 'src'), safePath(dest, 'dest')),
  );

  ipcMain.handle('delete-file', async (_event, filePath) => {
    filePath = safePath(filePath, 'filePath');
    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (error) {
      log.error('Error deleting file:', error);
      throw error;
    }
  });

  ipcMain.handle('file:delete', async (_event, filePath) => {
    try {
      const normalizedPath = safePath(filePath, 'filePath');
      let stats;
      try {
        stats = await fs.stat(normalizedPath);
      } catch (statError) {
        const se = /** @type {NodeJS.ErrnoException} */ (statError);
        if (se.code === 'ENOENT') {
          return { success: true, alreadyDeleted: true };
        }
        throw new Error(`Cannot access path: ${se.message}`, { cause: statError });
      }

      // fs.rm retenta automaticamente em EPERM/EBUSY/EMFILE/ENFILE/
      // ENOTEMPTY (lista do Node). Importante no Windows porque o
      // handle release de processos filhos (vvp.exe escrevendo
      // progress.txt, gtkwave segurando .fst) e do scanner de
      // antivirus pode demorar uns ms apos o processo sair, sem
      // retry, o primeiro unlink falha com EPERM. Funciona tanto pra
      // arquivo quanto pra diretorio (recursive flag so se aplica a
      // dir).
      await fs.rm(normalizedPath, {
        recursive: stats.isDirectory(),
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      return { success: true, path: normalizedPath };
    } catch (error) {
      log.error(`Error deleting ${filePath}:`, error);
      throw new Error(`Failed to delete: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });

  // ---------- file-tree CRUD (rename / trash / copy) ----------

  // Rename OR move a file/directory. `overwrite:false` (default) fails with
  // code EEXIST when the destination already exists, so the renderer can ask
  // the user (replace / keep both / cancel) instead of silently clobbering.
  // Windows case-only renames (README.md → readme.md) are the same path for
  // fs.stat, so they go through a two-step rename via a temp name.
  ipcMain.handle('file:rename', async (_event, oldPath, newPath, opts = {}) => {
    oldPath = safePath(oldPath, 'oldPath');
    newPath = safePath(newPath, 'newPath');
    const overwrite = !!(opts && opts.overwrite);
    try {
      const plano = planoDeRenomear(oldPath, newPath, overwrite);
      if (plano.via === 'temporario') {
        await fs.rename(oldPath, plano.tmp);
        await fs.rename(plano.tmp, newPath);
        return { success: true, path: newPath };
      }
      if (plano.checarDestino) {
        try {
          await fs.access(newPath);
          return { success: false, code: 'EEXIST', error: 'Destination already exists' };
        } catch { /* destination free — proceed */ }
      }
      // fse.move: rename when possible, copy+delete across devices (EXDEV).
      await fse.move(oldPath, newPath, { overwrite });
      return { success: true, path: newPath };
    } catch (error) {
      const e = /** @type {NodeJS.ErrnoException} */ (error);
      log.error(`Error renaming ${oldPath} → ${newPath}:`, error);
      return { success: false, code: e.code || 'ERENAME', error: e.message || String(error) };
    }
  });

  // Move to the OS trash (Recycle Bin), the default delete of the file-tree
  // CRUD, mirroring VS Code. Falls back to the caller to decide on permanent
  // deletion when trashing fails (e.g. network drives without a recycle bin).
  ipcMain.handle('file:trash', async (_event, targetPath) => {
    targetPath = safePath(targetPath, 'targetPath');
    try {
      await shell.trashItem(targetPath);
      return { success: true };
    } catch (error) {
      log.error(`Error trashing ${targetPath}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Copy a file OR a whole directory (fse.copy is recursive). Same EEXIST
  // contract as file:rename so paste conflicts surface as a user decision.
  ipcMain.handle('file:copy-any', async (_event, src, dest, opts = {}) => {
    src = safePath(src, 'src');
    dest = safePath(dest, 'dest');
    const overwrite = !!(opts && opts.overwrite);
    try {
      if (!overwrite) {
        try {
          await fs.access(dest);
          return { success: false, code: 'EEXIST', error: 'Destination already exists' };
        } catch { /* destination free — proceed */ }
      }
      await fse.copy(src, dest, { overwrite, errorOnExist: !overwrite });
      return { success: true, path: dest };
    } catch (error) {
      const e = /** @type {NodeJS.ErrnoException} */ (error);
      log.error(`Error copying ${src} → ${dest}:`, error);
      return { success: false, code: e.code || 'ECOPY', error: e.message || String(error) };
    }
  });

  ipcMain.handle('list-files-directory', async (_event, directoryPath) => {
    try {
      return await fs.readdir(safePath(directoryPath, 'directoryPath'));
    } catch (error) {
      // Mesmo raciocinio do read-file: diretorio que nao existe e resposta
      // valida (vetor vazio), nao falha. Este handler ja engolia o erro e
      // devolvia [], mas registrava como erro, o que enchia o log.
      if (ausenciaEsperada(error)) log.debug(`list-files-directory: ausente ${directoryPath}`);
      else log.error('Error listing files:', error);
      return [];
    }
  });

  ipcMain.handle('getFolderFiles', async (_event, folderPath) => {
    folderPath = safePath(folderPath, 'folderPath');
    try {
      const files = await fse.readdir(folderPath, { withFileTypes: true });
      return files.map((file) => ({
        name: file.name,
        isDirectory: file.isDirectory(),
        path: path.join(folderPath, file.name),
      }));
    } catch (error) {
      log.error('Error reading folder:', error);
      throw new Error('Failed to read folder', { cause: error });
    }
  });

  // ---------- dialogs ----------

  ipcMain.handle('dialog:showOpen', async () => {
    return dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Sapho Project Files', extensions: ['spf'] }],
    });
  });

  ipcMain.handle('dialog:openDirectory', async (_event, options = {}) => {
    // defaultPath is the directory the dialog opens at. Without it,
    // Windows falls back to the process's last-used directory, which
    // ends up being the currently-open project folder, and the user
    // accidentally nests new projects inside existing ones. Renderer
    // passes the last "new project location" from localStorage; we
    // fall back to the user's Documents folder when there isn't one.
    const defaultPath = pastaInicialDoDialogo(options, app.getPath('documents'));
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath,
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:show-open-import', async (_event, options = {}) => {
    try {
      const opts = {
        properties: options.properties || ['openFile'],
        filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
      };
      // Pass the main window as parent only if it exists; the no-parent
      // overload is fine and avoids passing `null` (undefined behavior).
      return await (state.mainWindow
        ? dialog.showOpenDialog(state.mainWindow, opts)
        : dialog.showOpenDialog(opts));
    } catch (err) {
      log.error('dialog:show-open-import failed:', err);
      return { canceled: true, filePaths: [] };
    }
  });

  ipcMain.handle('show-save-dialog', async (_event, options) => {
    const focused = BrowserWindow.getFocusedWindow();
    return focused
      ? dialog.showSaveDialog(focused, options)
      : dialog.showSaveDialog(options);
  });

  // ---------- shell ----------

  ipcMain.handle('open-external', async (_event, url) => {
    try {
      // A allowlist mora em files_ops.urlExternaPermitida, com teste em cima:
      // e o que separa abrir um link de entregar `file://` ou um esquema
      // registrado na maquina ao sistema, com a URL vindo do renderer.
      if (!urlExternaPermitida(url)) {
        log.warn('Blocked open-external for non-web URL:', url);
        return false;
      }
      await shell.openExternal(url);
      return true;
    } catch (error) {
      log.error('Error opening external link:', error);
      return false;
    }
  });

  ipcMain.handle('folder:open', async (_event, folderPath) => {
    try {
      await shell.openPath(folderPath);
      return { success: true };
    } catch (error) {
      log.error('Error opening folder:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Open a native terminal/command-prompt at a directory (cloned-projects menu).
  ipcMain.handle('shell:open-terminal', async (_event, dirPath) => {
    try {
      if (!dirPath || typeof dirPath !== 'string') throw new Error('dir required');
      if (!fse.existsSync(dirPath)) throw new Error('Directory not found');
      const cp = require('child_process');
      const { comando, args, usaCwd } = comandoTerminalNativo(
        process.platform, dirPath, process.env.TERMINAL,
      );
      cp.spawn(comando, args, {
        ...(usaCwd ? { cwd: dirPath } : {}),
        detached: true,
        stdio: 'ignore',
        ...(process.platform === 'win32' ? { windowsHide: false } : {}),
      }).unref();
      return { success: true };
    } catch (error) {
      log.error('Error opening terminal:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ---------- backups ----------

  ipcMain.handle('create-backup', async (_event, folderPath) => {
    folderPath = safePath(folderPath, 'folderPath');

    // Nomes, filtro e linha de comando em files_ops, com teste em cima. O zip
    // sai pelo Compress-Archive do PowerShell, que vem em toda instalacao do
    // Windows suportada; o `7z` de antes quase nunca estava no PATH e deixava
    // a pasta de preparo para tras sem arquivo nenhum ao lado.
    const {
      pastaBackup: backupFolderPath,
      nomePreparo: tempBackupFolderName,
      pastaPreparo: tempBackupFolderPath,
      zip: zipFilePath,
    } = nomesDoBackup(folderPath, formatTimestamp());

    try {
      await fse.ensureDir(backupFolderPath);
      await fse.ensureDir(tempBackupFolderPath);

      const entries = await fse.readdir(folderPath);
      for (const entry of entries) {
        if (!entraNoBackup(entry, tempBackupFolderName)) continue;
        await fse.copy(path.join(folderPath, entry), path.join(tempBackupFolderPath, entry));
      }

      const psCommand = comandoCompactar(tempBackupFolderPath, zipFilePath);

      return await new Promise((resolve) => {
        execFile(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-Command', psCommand],
          { cwd: folderPath, windowsHide: true },
          async (error, _stdout, stderr) => {
          // Always try to clean the staging folder, success or failure, so
          // we don't leave the user with a dangling backup_<timestamp>/.
          try {
            await fse.remove(tempBackupFolderPath);
          } catch (deleteError) {
            log.error('Error deleting temporary backup folder:', deleteError);
          }

          if (error) {
            log.error('Error creating backup:', stderr || error.message);
            resolve({
              success: false,
              message: `Could not create archive: ${error instanceof Error ? error.message : String(error)}`,
            });
          } else {
            resolve({ success: true, message: `Backup created at: ${zipFilePath}` });
          }
        });
      });
    } catch (error) {
      // Best-effort cleanup of the staging folder on any failure path.
      try { await fse.remove(tempBackupFolderPath); } catch (_) { /* ignore */ }
      log.error('Error creating backup:', error);
      return { success: false, message: `Error creating backup: ${error instanceof Error ? error.message : String(error)}` };
    }
  });

  // ---------- watchers (file + directory) ----------

  ipcMain.handle('watch-directory', async (event, directoryPath) => {
    try {
      const existing = state.activeDirectoryWatchers.get(directoryPath);
      if (existing) {
        return existing.id;
      }

      const debouncedChangeHandler = debounce(async () => {
        try {
          const files = await scanDirectory(directoryPath);
          event.sender.send('directory-changed', directoryPath, files);
        } catch (error) {
          log.error(`Error getting directory structure: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, 500);

      const watcher = chokidar.watch(directoryPath, {
        ignored: /[\\/]\./,
        persistent: true,
        ignoreInitial: true,
        depth: 10,
        usePolling: false,
        atomic: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      });

      const watcherId = `dir_watcher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      watcher.on('add', () => debouncedChangeHandler());
      watcher.on('unlink', () => debouncedChangeHandler());
      watcher.on('addDir', () => debouncedChangeHandler());
      watcher.on('unlinkDir', () => debouncedChangeHandler());

      watcher.on('error', (error) => {
        log.error(`Directory watcher error for ${directoryPath}:`, error);
        const message = error instanceof Error ? error.message : String(error);
        event.sender.send('directory-watcher-error', directoryPath, message);
      });

      state.activeDirectoryWatchers.set(directoryPath, {
        id: watcherId,
        watcher,
        path: directoryPath,
      });

      return watcherId;
    } catch (error) {
      throw new Error(`Failed to watch directory: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });

  ipcMain.handle('trigger-file-tree-refresh', async () => {
    try {
      // A4: project dir derived from the open .spf (single source of truth).
      const projectPath = state.currentOpenProjectPath
        ? path.dirname(state.currentOpenProjectPath)
        : null;
      if (!projectPath) throw new Error('No project path available for refresh');

      const files = await scanDirectory(projectPath);
      return { success: true, files };
    } catch (error) {
      log.error('Error triggering file tree refresh:', error);
      throw error;
    }
  });

  ipcMain.handle('stop-watching-directory', async (_event, directoryPath) => {
    try {
      const watcherInfo = state.activeDirectoryWatchers.get(directoryPath);
      if (watcherInfo) {
        await watcherInfo.watcher.close();
        state.activeDirectoryWatchers.delete(directoryPath);
        state.directoryStatsCache.delete(directoryPath);
        return true;
      }
      return false;
    } catch (error) {
      log.error('Error stopping directory watcher:', error);
      return false;
    }
  });

  ipcMain.handle('get-file-stats', async (_event, filePath) => {
    try {
      const stats = await fs.stat(filePath);
      const result = {
        mtime: stats.mtime.getTime(),
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
      };
      state.fileStatsCache.set(filePath, result);
      return result;
    } catch (error) {
      throw new Error(`Failed to get file stats: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });

  // Live file size, bypassa o cache de metadata do diretorio do Windows
  // abrindo um handle e usando fstat (GetFileInformationByHandle), que
  // reflete bytes ja escritos pelo writer mesmo sem close/flush dele.
  // Indispensavel pra observar arquivos ativos (ex: vvp escrevendo .fst
  // durante a simulacao); fs.stat normal so atualiza no close.
  ipcMain.handle('get-file-size-live', async (_event, filePath) => {
    let handle = null;
    try {
      handle = await fs.open(filePath, 'r');
      const stats = await handle.stat();
      return stats.size;
    } catch (error) {
      throw new Error(`Failed to get live file size: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    } finally {
      if (handle) {
        try { await handle.close(); } catch (_closeErr) { /* ignore */ }
      }
    }
  });

  ipcMain.handle('watch-file', async (event, filePath) => {
    try {
      const existing = state.activeWatchers.get(filePath);
      if (existing) {
        return existing.id;
      }

      const debouncedChangeHandler = debounce((/** @type {string} */ eventType) => {
        if (eventType === 'change') event.sender.send('file-changed', filePath);
      }, 150);

      const watcher = chokidar.watch(filePath, {
        ignoreInitial: true,
        persistent: true,
        usePolling: false,
        atomic: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
        alwaysStat: true,
        depth: 0,
        ignored: /[\\/]\./,
      });

      const watcherId = `watcher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      watcher.on('change', () => debouncedChangeHandler('change'));

      watcher.on('error', (error) => {
        log.error(`File watcher error for ${filePath}:`, error);
        setTimeout(async () => {
          try {
            await restartWatcher(filePath, event);
          } catch (restartError) {
            log.error(`Failed to restart watcher for ${filePath}:`, restartError);
            const message = error instanceof Error ? error.message : String(error);
            event.sender.send('file-watcher-error', filePath, message);
          }
        }, 1000);
      });

      watcher.on('ready', () => log.debug(`File watcher ready for: ${filePath}`));

      state.activeWatchers.set(filePath, {
        id: watcherId,
        watcher,
        filePath,
        lastCheck: Date.now(),
      });

      return watcherId;
    } catch (error) {
      throw new Error(`Failed to start file watcher: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });

  ipcMain.handle('stop-watching-file', async (_event, watcherIdOrPath) => {
    try {
      const watcherInfo = acharWatcher(state.activeWatchers, watcherIdOrPath);
      if (watcherInfo) {
        await watcherInfo.watcher.close();
        state.activeWatchers.delete(watcherInfo.filePath);
        state.fileStatsCache.delete(watcherInfo.filePath);
        return true;
      }
      return false;
    } catch (error) {
      log.error('Error stopping file watcher:', error);
      return false;
    }
  });

  // Periodic health check for file + directory watchers (every 30s). One timer
  // for both maps; it does NOTHING while idle (no watchers), so it only works
  // when there's something to check. unref()'d so it never keeps the process
  // alive at quit (P16: was two always-on intervals that were never cleared).
  const healthCheck = setInterval(async () => {
    if (!state.activeWatchers.size && !state.activeDirectoryWatchers.size) return;
    for (const [filePath, watcherInfo] of state.activeWatchers.entries()) {
      try {
        await fs.access(filePath);
        watcherInfo.lastCheck = Date.now();
      } catch {
        try {
          await watcherInfo.watcher.close();
        } catch (closeError) {
          log.error(`Error closing watcher for missing file: ${closeError}`);
        }
        state.activeWatchers.delete(filePath);
        state.fileStatsCache.delete(filePath);
      }
    }
    for (const [directoryPath, watcherInfo] of state.activeDirectoryWatchers.entries()) {
      try {
        await fs.access(directoryPath);
      } catch {
        try {
          await watcherInfo.watcher.close();
        } catch (closeError) {
          log.error(`Error closing directory watcher: ${closeError}`);
        }
        state.activeDirectoryWatchers.delete(directoryPath);
        state.directoryStatsCache.delete(directoryPath);
      }
    }
  }, 30000);
  healthCheck.unref?.();
}

module.exports = { register };
