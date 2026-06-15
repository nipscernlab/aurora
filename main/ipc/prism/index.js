// @ts-check
/**
 * PRISM: Yosys/netlistsvg-driven schematic viewer.
 *
 * Owns the PRISM BrowserWindow plus all compilation steps (read Verilog,
 * synthesize with Yosys, split hierarchy.json into per-module JSONs, render
 * SVG with netlistsvg). Exposed via the renderer-facing `prism-compile-with-paths`,
 * `prism-recompile`, `generate-svg-from-module`, `get-prism-compilation-paths`.
 *
 * Split by concern into sibling files — window.js (the BrowserWindow
 * factory), pipeline.js (yosys synthesis + orchestration), svg.js (skin
 * loading + netlistsvg render), module_names.js (yosys name cleanup) — with
 * this index wiring the IPC. `register()` and `createPrismWindow` keep the
 * same surface main.js consumes.
 */

const { ipcMain } = require('electron');
const path = require('path');
const fse = require('fs-extra');
const log = require('electron-log');

const state = require('../../state');
const { componentsPath } = require('../../paths');
const { sanitizeFileName } = require('../../utils');
const { performPrismCompilationWithPaths } = require('./pipeline');
const { generateModuleSVGWithPaths } = require('./svg');
const { createPrismWindow } = require('./window');

// ---------- IPC ----------

function register() {
  ipcMain.handle('prism-compile-with-paths', async (_event, compilationPaths) => {
    try {
      const result = await performPrismCompilationWithPaths(compilationPaths);
      if (!result.success) return result;
      await createPrismWindow(result);
      return result;
    } catch (error) {
      log.error('Fatal error in prism-compile-with-paths:', error);
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('generate-svg-from-module', async (_event, moduleName, tempDir) => {
    try {
      const cleanName = sanitizeFileName(moduleName);
      const moduleJsonPath = path.join(tempDir, `${cleanName}.json`);
      if (!(await fse.pathExists(moduleJsonPath))) {
        throw new Error(`Module JSON not found for: ${moduleName}`);
      }

      const svgPath = await generateModuleSVGWithPaths(moduleName, tempDir);
      return { success: true, svgPath, moduleName, moduleJsonPath };
    } catch (error) {
      log.error('SVG generation from module click error:', error);
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('get-prism-compilation-paths', async () => {
    try {
      let projectPath = /** @type {any} */ (global).currentProjectPath || state.currentOpenProjectPath;
      if (state.currentOpenProjectPath && !(/** @type {any} */ (global).currentProjectPath)) {
        projectPath = path.dirname(state.currentOpenProjectPath);
      }
      if (!projectPath) throw new Error('No project path available');

      return {
        projectPath,
        componentsPath,
        hdlPath: path.join(componentsPath, 'HDL'),
        tempPath: path.join(componentsPath, 'Temp', 'PRISM'),
        yosysPath: path.join(componentsPath, 'Packages', 'msys', 'mingw64', 'bin', 'yosys.exe'),
        // netlistsvg agora vem do node_modules (@silimate/netlistsvg) e
        // roda in-process — nao precisa mais expor binario pro renderer.
        spfPath: state.currentOpenProjectPath || '',
        topLevelPath: path.join(projectPath, 'TopLevel'),
      };
    } catch (error) {
      log.error('Failed to get compilation paths:', error);
      throw error;
    }
  });

  // Right-click numa cell do SVG do Prism pede pra abrir o source no
  // editor principal. Aqui validamos o payload e encaminhamos pra
  // mainWindow via webContents.send — o renderer principal escuta
  // 'aurora:open-file-at' e faz o resto (le, abre tab, posiciona
  // cursor). Tambem focamos a mainWindow pro usuario ver o resultado.
  ipcMain.handle('prism:open-source-file', async (_event, payload) => {
    try {
      if (!payload || typeof payload.filePath !== 'string') {
        return { success: false, message: 'invalid payload' };
      }
      const filePath = payload.filePath;
      const line = Number.isInteger(payload.line) && payload.line > 0 ? payload.line : 1;
      const column = Number.isInteger(payload.column) && payload.column > 0 ? payload.column : 1;
      if (!(await fse.pathExists(filePath))) {
        return { success: false, message: `source not found: ${filePath}` };
      }
      if (!state.mainWindow || state.mainWindow.isDestroyed()) {
        return { success: false, message: 'main window not available' };
      }
      state.mainWindow.webContents.send('aurora:open-file-at', { filePath, line, column });
      if (state.mainWindow.isMinimized()) state.mainWindow.restore();
      state.mainWindow.focus();
      return { success: true };
    } catch (error) {
      log.error('Failed to open source file from Prism:', error);
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('prism-recompile', async (_event, compilationPaths) => {
    try {
      if (!compilationPaths) throw new Error('Compilation paths are required for re-compilation.');

      const compilationResult = await performPrismCompilationWithPaths(compilationPaths);
      if (!compilationResult.success) throw new Error(compilationResult.message);

      if (state.prismWindow && !state.prismWindow.isDestroyed()) {
        if (!state.prismWindow.webContents.isLoading()) {
          state.prismWindow.webContents.send('compilation-complete', compilationResult);
        } else {
          state.prismWindow.webContents.once('did-finish-load', () => {
            if (state.prismWindow && !state.prismWindow.isDestroyed()) {
              state.prismWindow.webContents.send('compilation-complete', compilationResult);
            }
          });
        }
        state.prismWindow.focus();
      } else {
        await createPrismWindow(compilationResult);
      }
      return compilationResult;
    } catch (error) {
      log.error('PRISM recompilation error:', error);
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = { register, createPrismWindow };
