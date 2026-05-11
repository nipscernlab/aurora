// @ts-check
/**
 * PRISM: Yosys/netlistsvg-driven schematic viewer.
 *
 * Owns the PRISM BrowserWindow plus all compilation steps (read Verilog,
 * synthesize with Yosys, split hierarchy.json into per-module JSONs, render
 * SVG with netlistsvg). Exposed via the renderer-facing `prism-compile-with-paths`,
 * `prism-recompile`, `generate-svg-from-module`, `get-prism-compilation-paths`.
 */

const path = require('path');
const fse = require('fs-extra');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { execFile, spawn } = require('child_process');
const log = require('electron-log');

const state = require('../state');
const { componentsPath } = require('../paths');
const { sanitizeFileName } = require('../utils');

// ---------- helpers ----------

function cleanModuleName(moduleName) {
  let cleanName = moduleName;

  if (cleanName.startsWith('$paramod')) {
    if (cleanName.includes('\\\\')) {
      const parts = cleanName.split('\\\\');
      if (parts.length >= 2) {
        cleanName = parts[1];
        if (cleanName.includes('\\')) cleanName = cleanName.split('\\')[0];
      }
    } else if (cleanName.includes('\\')) {
      const parts = cleanName.split('\\');
      if (parts.length >= 2) cleanName = parts[1];
    }
  }

  cleanName = cleanName.replace(/\$[a-f0-9]{40,}/g, '');
  cleanName = cleanName.replace(/\\[A-Z_]+=.*$/g, '');
  cleanName = cleanName.replace(/^[$\\]+/, '');
  return cleanName;
}

function isClickableModule(moduleName) {
  const skipPatterns = [
    /^\$_/, /^\$dff/, /^\$mux/, /^\$add/, /^\$sub/, /^\$mul/, /^\$div/, /^\$mod/,
    /^\$eq/, /^\$ne/, /^\$lt/, /^\$le/, /^\$gt/, /^\$ge/, /^\$and/, /^\$or/,
    /^\$xor/, /^\$not/, /^\$reduce/, /^\$logic/, /^\$shift/, /^\$pmux/, /^\$lut/,
    /^\$assert/, /^\$assume/, /^\$cover/, /^\$specify/,
  ];
  for (const pattern of skipPatterns) if (pattern.test(moduleName)) return false;

  return (
    moduleName.startsWith('$paramod') ||
    (!moduleName.startsWith('$') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(moduleName))
  );
}

// ---------- window factory ----------

/**
 * @typedef {object} PrismCompilationResult
 * @property {boolean} success
 * @property {string} [message]
 * @property {string} [topLevelModule]
 * @property {string} [svgPath]
 * @property {string} [tempDir]
 */

/** @param {PrismCompilationResult | null} [compilationData] */
async function createPrismWindow(compilationData = null) {
  if (state.prismWindow && !state.prismWindow.isDestroyed()) {
    state.prismWindow.focus();
    if (compilationData) {
      if (!state.prismWindow.webContents.isLoading()) {
        state.prismWindow.webContents.send('compilation-complete', compilationData);
      } else {
        state.prismWindow.webContents.once('did-finish-load', () => {
          if (state.prismWindow && !state.prismWindow.isDestroyed()) {
            state.prismWindow.webContents.send('compilation-complete', compilationData);
          }
        });
      }
    }
    return state.prismWindow;
  }

  const preloadPath = path.join(app.getAppPath(), 'js', 'app', 'preload_prism.js');
  if (!require('fs').existsSync(preloadPath)) {
    throw new Error(`Preload script not found: ${preloadPath}`);
  }

  const prismWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'assets', 'icons', 'sapho_aurora_icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
    backgroundColor: '#17151f',
    show: false,
    titleBarStyle: 'default',
  });
  state.prismWindow = prismWindow;

  const prismHtmlPath = path.join(app.getAppPath(), 'html', 'prism.html');
  if (!require('fs').existsSync(prismHtmlPath)) {
    if (state.prismWindow) {
      state.prismWindow.destroy();
      state.prismWindow = null;
    }
    throw new Error(`PRISM HTML file not found: ${prismHtmlPath}`);
  }

  try {
    await prismWindow.loadFile(prismHtmlPath);

    prismWindow.maximize();
    prismWindow.show();

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('prism-status', true);
    }

    if (compilationData) {
      // Tiny delay so the renderer has DOM ready before processing the payload.
      setTimeout(() => {
        if (state.prismWindow && !state.prismWindow.isDestroyed()) {
          state.prismWindow.webContents.send('compilation-complete', compilationData);
        }
      }, 1000);
    }
  } catch (error) {
    log.error('Failed to load prism.html:', error);
    await dialog.showMessageBox({
      type: 'error',
      title: 'PRISM Load Error',
      message: 'Failed to load PRISM viewer',
      detail: `Error: ${error.message}\nPath: ${prismHtmlPath}`,
    });
    if (state.prismWindow) {
      state.prismWindow.destroy();
      state.prismWindow = null;
    }
    throw error;
  }

  prismWindow.on('closed', () => {
    state.prismWindow = null;
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('prism-status', false);
    }
  });

  prismWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error(`PRISM viewer failed to load (code ${errorCode}): ${errorDescription}`);
    dialog.showMessageBox({
      type: 'error',
      title: 'PRISM Load Failed',
      message: `Failed to load PRISM viewer (Error ${errorCode})`,
      detail: `${errorDescription}\nURL: ${validatedURL}`,
    });
  });

  prismWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('PRISM viewer renderer process crashed:', details);
  });

  return prismWindow;
}

// ---------- compilation pipeline ----------

async function runYosysCompilationWithPaths(
  compilationPaths,
  topLevelModule,
  tempDir,
) {
  const hierarchyJsonPath = path.join(tempDir, 'hierarchy.json');
  const hdlPath = compilationPaths.hdlPath;
  const yosysExe = compilationPaths.yosysPath;

  // Coleta unificada:
  //   1. components/HDL/*.v  — biblioteca SAPHO (processor, addr_dec,
  //      core, ula, myFIFO, instr_dec). Sempre incluida porque
  //      qualquer top que seja um processador SAPHO depende disso.
  //   2. projectOriented.synthesizableFiles[].path — fonte canonica
  //      de TODOS os .v do projeto (auto-descobertos pelo file
  //      tree + adicionados manualmente pelo usuario). Inclui o .v
  //      de cada processador SAPHO via _discoverProcessorFiles.
  //   3. <proj>/TopLevel/*.v se a pasta existir — wrapper top-level
  //      (raro mas possivel).
  //
  // Dedup por path absoluto pra evitar duplicate-module errors do
  // yosys quando o mesmo arquivo aparece em mais de uma fonte.
  const fileSet = new Set();

  if (await fse.pathExists(hdlPath)) {
    const hdlFiles = await fse.readdir(hdlPath);
    for (const f of hdlFiles) {
      if (f.endsWith('.v') && !f.includes('_tb') && !f.toLowerCase().includes('test')) {
        fileSet.add(path.join(hdlPath, f));
      }
    }
  }

  const projectOrientedConfigPath = compilationPaths.projectOrientedConfigPath;
  if (await fse.pathExists(projectOrientedConfigPath)) {
    try {
      const proj = await fse.readJson(projectOrientedConfigPath);
      if (Array.isArray(proj.synthesizableFiles)) {
        for (const f of proj.synthesizableFiles) {
          const p = typeof f === 'string' ? f : f?.path;
          if (p && p.toLowerCase().endsWith('.v')) fileSet.add(p);
        }
      }
      const topLevelDir = compilationPaths.topLevelPath;
      if (topLevelDir && await fse.pathExists(topLevelDir)) {
        const topLevelFiles = await fse.readdir(topLevelDir);
        for (const f of topLevelFiles) {
          if (f.endsWith('.v') && !f.includes('_tb')) {
            fileSet.add(path.join(topLevelDir, f));
          }
        }
      }
    } catch (_e) { /* JSON parse fail tolerado */ }
  }

  // Fallback defensivo: varre <proj>/<proc>/Hardware/*.v para todos os
  // processadores conhecidos (projectOriented + .spf). No happy-path
  // esses .v ja estao em synthesizableFiles via auto-descoberta — o
  // dedup faz isso ser no-op. Mas em projetos antigos onde
  // synthesizableFiles pode estar vazio, esse scan garante que os
  // modulos do processador entrem no yosys de qualquer jeito.
  const projectPath = compilationPaths.projectPath;
  const processorNames = new Set();
  if (projectOrientedConfigPath && await fse.pathExists(projectOrientedConfigPath)) {
    try {
      const cfg = await fse.readJson(projectOrientedConfigPath);
      const list = Array.isArray(cfg.processors) ? cfg.processors : [];
      for (const p of list) {
        const n = typeof p === 'string' ? p : p?.name;
        if (n) processorNames.add(n);
      }
    } catch (_e) { /* JSON parse fail tolerado */ }
  }
  if (state.currentOpenProjectPath && await fse.pathExists(state.currentOpenProjectPath)) {
    try {
      const spf = await fse.readJson(state.currentOpenProjectPath);
      const fromSpf = spf?.structure?.processors;
      if (Array.isArray(fromSpf)) {
        for (const p of fromSpf) {
          const n = typeof p === 'string' ? p : p?.name;
          if (n) processorNames.add(n);
        }
      }
    } catch (_e) { /* idem */ }
  }
  for (const procName of processorNames) {
    const hardwareDir = path.join(projectPath, procName, 'Hardware');
    if (!(await fse.pathExists(hardwareDir))) continue;
    const hardwareFiles = await fse.readdir(hardwareDir);
    for (const f of hardwareFiles) {
      if (f.endsWith('.v') && !f.includes('_tb')) {
        fileSet.add(path.join(hardwareDir, f));
      }
    }
  }

  const fileList = [...fileSet];
  if (fileList.length === 0) throw new Error('No Verilog files found for compilation');

  const readCommands = fileList.map((file) => `read_verilog "${file}"`).join('\n');
  // setundef -zero: substitui valores don't-care (x) por 0 constante.
  // Sem isso, $pmux com `full_case` produz A=[x,x] como ramo default
  // unreachable, e o netlistsvg renderiza esses don't-cares como
  // "linhas fantasma" diagonais (uma constante invisivel com fanout
  // alimentando varios muxes), confundindo o usuario. Trocar x por 0
  // nao muda a semantica porque o ramo default e unreachable.
  // opt_clean -purge: remove fios e celulas que sobraram desconectados
  // depois da substituicao.
  const yosysScript = `
${readCommands}
hierarchy -top ${topLevelModule}
proc
setundef -zero
opt_clean -purge
write_json "${hierarchyJsonPath}"
`;

  const yosysScriptPath = path.join(tempDir, 'yosys_script.ys');
  await fse.writeFile(yosysScriptPath, yosysScript);

  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    // 'tips' (azul) — mesmo tipo usado pela compilacao do botao Verilog
    // para a linha contextual "Top-level". Mantem a UX consistente entre
    // os dois fluxos (PRISM e iverilog).
    state.mainWindow.webContents.send('terminal-log', 'tveri', `Top-level: ${topLevelModule}.v`, 'tips');
    state.mainWindow.webContents.send('terminal-log', 'tveri', 'Running Yosys synthesis...', 'info');
  }

  return new Promise((resolve, reject) => {
    const yosysProcess = spawn(yosysExe, ['-s', yosysScriptPath], {
      cwd: tempDir,
      windowsHide: true,
    });

    let stderr = '';
    yosysProcess.stdout.on('data', (_data) => {});
    yosysProcess.stderr.on('data', (data) => (stderr += data.toString()));

    yosysProcess.on('close', async (code) => {
      if (code !== 0) {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('terminal-log', 'tveri', `Yosys error: ${stderr}`, 'error');
        }
        reject(new Error(`Yosys exited with code ${code}`));
      } else if (await fse.pathExists(hierarchyJsonPath)) {
        resolve(hierarchyJsonPath);
      } else {
        reject(new Error('hierarchy.json was not created'));
      }
    });

    yosysProcess.on('error', (error) => reject(error));
  });
}

async function splitHierarchyJson(hierarchyJsonPath, tempDir) {
  const hierarchyData = await fse.readJson(hierarchyJsonPath);
  if (!hierarchyData.modules) throw new Error('No modules found in hierarchy JSON');

  for (const [moduleName, moduleData] of Object.entries(hierarchyData.modules)) {
    if (!isClickableModule(moduleName)) continue;

    const cleanName = cleanModuleName(moduleName);
    const sanitizedName = sanitizeFileName(cleanName);
    const moduleFilePath = path.join(tempDir, `${sanitizedName}.json`);

    const cleanModuleData = JSON.parse(JSON.stringify(moduleData));

    if (cleanModuleData.cells) {
      const cleanedCells = {};
      for (const [cellName, cellData] of Object.entries(cleanModuleData.cells)) {
        const cleanCellName = cleanModuleName(cellName);
        cleanedCells[cleanCellName] = cellData;
        if (cellData.type && isClickableModule(cellData.type)) {
          cellData.type = cleanModuleName(cellData.type);
        }
      }
      cleanModuleData.cells = cleanedCells;
    }

    const moduleJson = {
      creator: hierarchyData.creator || 'Yosys',
      modules: { [cleanName]: cleanModuleData },
    };

    await fse.writeJson(moduleFilePath, moduleJson, { spaces: 2 });
  }
}

async function generateModuleSVGWithPaths(moduleName, tempDir, netlistsvgPath) {
  const cleanName = sanitizeFileName(moduleName);
  const inputJsonPath = path.join(tempDir, `${cleanName}.json`);
  const outputSvgPath = path.join(tempDir, `${cleanName}.svg`);

  if (!(await fse.pathExists(inputJsonPath))) {
    throw new Error(`Module JSON file not found: ${inputJsonPath}`);
  }

  return new Promise((resolve, reject) => {
    execFile(netlistsvgPath, [inputJsonPath, '-o', outputSvgPath], (error) => {
      if (error) {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send(
            'terminal-log',
            'tveri',
            `SVG generation failed: ${error.message}`,
            'error',
          );
        }
        reject(new Error(`SVG generation failed: ${error.message}`));
        return;
      }
      resolve(outputSvgPath);
    });
  });
}

async function performPrismCompilationWithPaths(compilationPaths) {
  try {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('terminal-log', 'tveri', 'Starting PRISM compilation process', 'info');
    }

    const tempDir = compilationPaths.tempPath;
    await fse.ensureDir(tempDir);

    // Top-level vem sempre de projectOriented.topLevelFile.
    const projectConfigPath = compilationPaths.projectOrientedConfigPath;
    if (!(await fse.pathExists(projectConfigPath))) {
      throw new Error('projectOriented.json not found in project root');
    }
    const configData = await fse.readJson(projectConfigPath);
    const topLevelModule = path.basename(configData.topLevelFile, '.v');

    const hierarchyJsonPath = await runYosysCompilationWithPaths(
      compilationPaths,
      topLevelModule,
      tempDir,
    );
    await splitHierarchyJson(hierarchyJsonPath, tempDir);

    const svgPath = await generateModuleSVGWithPaths(
      topLevelModule,
      tempDir,
      compilationPaths.netlistsvgPath,
    );

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send(
        'terminal-log',
        'tveri',
        'PRISM compilation completed successfully',
        'success',
      );
    }

    return {
      success: true,
      message: 'PRISM compilation completed successfully',
      topLevelModule,
      svgPath,
      tempDir,
    };
  } catch (error) {
    log.error('PRISM compilation error:', error);
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('terminal-log', 'tveri', `Compilation failed: ${error.message}`, 'error');
    }
    return { success: false, message: error.message };
  }
}

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
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('generate-svg-from-module', async (_event, moduleName, tempDir) => {
    try {
      const cleanName = sanitizeFileName(moduleName);
      const moduleJsonPath = path.join(tempDir, `${cleanName}.json`);
      if (!(await fse.pathExists(moduleJsonPath))) {
        throw new Error(`Module JSON not found for: ${moduleName}`);
      }

      const netlistsvgPath = path.join(componentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe');
      const svgPath = await generateModuleSVGWithPaths(moduleName, tempDir, netlistsvgPath);
      return { success: true, svgPath, moduleName, moduleJsonPath };
    } catch (error) {
      log.error('SVG generation from module click error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('get-prism-compilation-paths', async () => {
    try {
      let projectPath = global.currentProjectPath || state.currentOpenProjectPath;
      if (state.currentOpenProjectPath && !global.currentProjectPath) {
        projectPath = path.dirname(state.currentOpenProjectPath);
      }
      if (!projectPath) throw new Error('No project path available');

      return {
        projectPath,
        componentsPath,
        hdlPath: path.join(componentsPath, 'HDL'),
        tempPath: path.join(componentsPath, 'Temp', 'PRISM'),
        yosysPath: path.join(componentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe'),
        netlistsvgPath: path.join(componentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe'),
        projectOrientedConfigPath: path.join(projectPath, 'projectOriented.json'),
        topLevelPath: path.join(projectPath, 'TopLevel'),
      };
    } catch (error) {
      log.error('Failed to get compilation paths:', error);
      throw error;
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
      return { success: false, message: error.message };
    }
  });
}

module.exports = { register, createPrismWindow };
