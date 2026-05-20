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
const { spawn } = require('child_process');
const log = require('electron-log');
const netlistsvgLib = require('@silimate/netlistsvg');

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
  // Tira prefixos `genblk<N>.` que o yosys adiciona em instancias
  // dentro de generate blocks. Sao so nomes de escopo hierarquico
  // gerados — o usuario quer ver so o nome real ("my_f2i" em vez
  // de "genblk27.my_f2i"). Global pra cobrir genblks aninhados.
  cleanName = cleanName.replace(/(?:\\?genblk\d+\.)+/g, '');
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
    // Frameless — custom titlebar rendered by the PRISM HTML (same
    // approach as the Aurora main window). thickFrame keeps Aero snap
    // and native edge-resize working on Windows.
    frame: false,
    thickFrame: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
    backgroundColor: '#0A0D14',
    show: false,
  });
  state.prismWindow = prismWindow;

  // Relay maximize / unmaximize to the renderer so the [□/⧉] icon updates.
  const sendPrismWindowState = () => {
    if (prismWindow.isDestroyed() || !prismWindow.webContents) return;
    try {
      prismWindow.webContents.send('prism:window-state', {
        isMaximized: prismWindow.isMaximized(),
        isFullScreen: prismWindow.isFullScreen(),
      });
    } catch (_) { /* ignore */ }
  };
  prismWindow.on('maximize',          sendPrismWindowState);
  prismWindow.on('unmaximize',        sendPrismWindowState);
  prismWindow.on('enter-full-screen', sendPrismWindowState);
  prismWindow.on('leave-full-screen', sendPrismWindowState);
  prismWindow.webContents.on('did-finish-load', sendPrismWindowState);

  const prismHtmlPath = path.join(app.getAppPath(), 'html', 'prism', 'prism.html');
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
    log.error('Failed to load prism/prism.html:', error);
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
  //   2. .spf structure.synthesizableFiles[].path — fonte canonica
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

  // Le o .spf uma unica vez — usado tanto pra synthesizableFiles
  // quanto pra lista de processadores (fallback Hardware/*.v).
  const spfPath = compilationPaths.spfPath;
  let spfStructure = null;
  if (spfPath && await fse.pathExists(spfPath)) {
    try {
      const spf = await fse.readJson(spfPath);
      spfStructure = spf?.structure ?? null;
    } catch (_e) { /* JSON parse fail tolerado */ }
  }

  if (spfStructure && Array.isArray(spfStructure.synthesizableFiles)) {
    for (const f of spfStructure.synthesizableFiles) {
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

  // Fallback defensivo: varre <proj>/<proc>/Hardware/*.v para todos os
  // processadores conhecidos do .spf. No happy-path esses .v ja estao
  // em synthesizableFiles via auto-descoberta — o dedup faz isso ser
  // no-op. Mas em projetos antigos onde synthesizableFiles pode estar
  // vazio, esse scan garante que os modulos do processador entrem no
  // yosys de qualquer jeito.
  const projectPath = compilationPaths.projectPath;
  const processorNames = new Set();
  if (spfStructure && Array.isArray(spfStructure.processors)) {
    for (const p of spfStructure.processors) {
      const n = typeof p === 'string' ? p : p?.name;
      if (n) processorNames.add(n);
    }
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

  // -setattr src faz o yosys gravar `src="arquivo.v:linha.col-linha.col"` em
  // cada celula derivada do source. O fork @silimate/netlistsvg le esse
  // atributo e emite um SVG com `onclick="gotosrc(...)"` por cell — o
  // renderer do Prism aproveita pra abrir o source no editor via
  // right-click (left-click continua sendo navegacao entre modulos).
  const readCommands = fileList.map((file) => `read_verilog -setattr src "${file}"`).join('\n');
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

  // PRISM yosys pode receber overrides da AI via compilationPaths.yosysOverride.
  // O renderer (compilation_flow.handlePrismStep) consulta o command_overrides
  // store antes de invocar prism-compile-with-paths e anexa o override
  // resolvido aqui. Mesmo contrato dos outros steps: appendArgs/prependArgs/
  // removeArgs/envSet/envUnset. Sem override, comportamento e identico ao
  // anterior.
  const overrideArgs = ['-s', yosysScriptPath];
  let finalArgs = overrideArgs.slice();
  const ov = compilationPaths?.yosysOverride;
  if (ov && typeof ov === 'object') {
    if (Array.isArray(ov.removeArgs) && ov.removeArgs.length) {
      const drop = new Set(ov.removeArgs);
      finalArgs = finalArgs.filter((a) => !drop.has(a));
    }
    if (Array.isArray(ov.prependArgs)) finalArgs = ov.prependArgs.concat(finalArgs);
    if (Array.isArray(ov.appendArgs))  finalArgs = finalArgs.concat(ov.appendArgs);
  }
  const childEnv = { ...process.env };
  if (ov?.envSet && typeof ov.envSet === 'object') Object.assign(childEnv, ov.envSet);
  if (Array.isArray(ov?.envUnset)) for (const k of ov.envUnset) delete childEnv[k];

  return new Promise((resolve, reject) => {
    const yosysProcess = spawn(yosysExe, finalArgs, {
      cwd: tempDir,
      env: childEnv,
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

// Skin default do pacote + merge de skins customizadas em assets/prism-skins/.
// Sem cache: re-le a cada compile pra que `Recompile` no PRISM ja mostre
// edicoes em SVGs custom sem precisar reiniciar o app (o cost de ler ~10
// arquivos pequenos por compile e' desprezivel).
//
// Por que merge em runtime em vez de editar node_modules/.../default.svg?
// `npm install` sobrescreve default.svg. Mantendo as customizacoes em
// assets/prism-skins/ a gente sobrevive a npm install e versionando no git.

// Extrai todo bloco `<g s:type="...">...</g>` de TOPO de um SVG, usando
// contagem de profundidade de tags `<g>` pra suportar `<g>` aninhados
// dentro de portas/labels (sem isso uma regex non-greedy quebraria em
// blocos como o `generic`, que tem `<g>...</g>` aninhados dentro).
function extractTopLevelGBlocks(svgText) {
  const blocks = [];
  const tagRe = /<g\b[^>]*>|<\/g>/g;
  const stack = []; // entradas: { type, startIdx }
  let m;
  while ((m = tagRe.exec(svgText)) !== null) {
    const tag = m[0];
    if (tag === '</g>') {
      const open = stack.pop();
      if (open && open.type && stack.length === 0) {
        blocks.push({
          type: open.type,
          content: svgText.slice(open.startIdx, m.index + 4),
        });
      }
    } else if (!tag.endsWith('/>')) {
      // Tag de abertura nao self-closing. Pega `s:type` se existir.
      const typeMatch = tag.match(/\bs:type="([^"]+)"/);
      stack.push({ type: typeMatch ? typeMatch[1] : null, startIdx: m.index });
    }
    // Self-closing (`<g .../>`) nao entra na pilha.
  }
  return blocks;
}

async function loadCustomSkinBlocks(customSkinDir) {
  if (!(await fse.pathExists(customSkinDir))) return [];
  const entries = (await fse.readdir(customSkinDir))
    .filter((f) => f.toLowerCase().endsWith('.svg') && !f.startsWith('_'))
    .sort();

  const merged = new Map(); // s:type -> content (ultimo arquivo a definir ganha)
  for (const file of entries) {
    try {
      const content = await fse.readFile(path.join(customSkinDir, file), 'utf-8');
      for (const block of extractTopLevelGBlocks(content)) {
        if (block.type) merged.set(block.type, block.content);
      }
    } catch (err) {
      log.warn(`[PRISM] Skipping malformed custom skin ${file}:`, err.message);
    }
  }
  return [...merged.entries()];
}

async function getDefaultSkinData() {
  const libIndex = require.resolve('@silimate/netlistsvg');
  const skinPath = path.join(path.dirname(libIndex), '..', 'lib', 'default.svg');
  let skin = await fse.readFile(skinPath, 'utf-8');

  const customSkinDir = path.join(app.getAppPath(), 'assets', 'prism-skins');
  const customBlocks = await loadCustomSkinBlocks(customSkinDir);
  if (customBlocks.length === 0) return skin;

  // Pra cada custom, remove `<g s:type="X">` existente na skin default e
  // injeta o customizado logo antes de `</svg>`.
  for (const [type, content] of customBlocks) {
    const existing = extractTopLevelGBlocks(skin).find((b) => b.type === type);
    if (existing) skin = skin.replace(existing.content, '');
    skin = skin.replace('</svg>', `\n  ${content.trim()}\n</svg>`);
  }
  return skin;
}

// Constroi um mapa instanceName -> moduleType a partir do JSON do
// yosys do modulo atual. netlistsvg renderiza o label de cada cell
// com s:attribute="ref" (o NOME DA INSTANCIA), nao com o tipo — entao
// o renderer nao consegue saber pra qual modulo navegar olhando so o
// SVG. O fix e' injetar data-cell-type=<tipo> em cada <g id="cell_<inst>">
// abaixo, antes de devolver o SVG.
function buildInstanceTypeMap(netlistJson) {
  const map = new Map();
  if (!netlistJson?.modules) return map;
  for (const moduleData of Object.values(netlistJson.modules)) {
    if (!moduleData?.cells) continue;
    for (const [instName, cellData] of Object.entries(moduleData.cells)) {
      if (cellData?.type) map.set(instName, cellData.type);
    }
  }
  return map;
}

// Escape minimo pra valor de atributo XML — basta cobrir `"`, `&` e `<`
// (path/identificador yosys raramente tem esses, mas defensivo).
function xmlAttrEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

// Injeta data-cell-type=<tipo> em cada <g id="cell_<inst>"> do SVG.
// Regex em vez de parse XML real porque (a) overkill, (b) a forma do
// output do netlistsvg e' previsivel (id="cell_..." sempre em <g>).
function injectCellTypesIntoSvg(svgString, instanceTypeMap) {
  if (instanceTypeMap.size === 0) return svgString;
  return svgString.replace(
    /<g\b([^>]*?)\sid="cell_([^"]+)"([^>]*?)(\/?>)/g,
    (match, before, instName, after, close) => {
      const type = instanceTypeMap.get(instName);
      if (!type) return match;
      return `<g${before} id="cell_${instName}"${after} data-cell-type="${xmlAttrEscape(type)}"${close}`;
    },
  );
}

async function generateModuleSVGWithPaths(moduleName, tempDir) {
  const cleanName = sanitizeFileName(moduleName);
  const inputJsonPath = path.join(tempDir, `${cleanName}.json`);
  const outputSvgPath = path.join(tempDir, `${cleanName}.svg`);

  if (!(await fse.pathExists(inputJsonPath))) {
    throw new Error(`Module JSON file not found: ${inputJsonPath}`);
  }

  const [skinData, netlistJson] = await Promise.all([
    getDefaultSkinData(),
    fse.readJson(inputJsonPath),
  ]);

  // lib.render usa callback (err, svgString) — wrap em Promise. Sem spawn
  // de processo, sem .exe externo: fica tudo in-process.
  const rawSvg = await new Promise((resolve, reject) => {
    netlistsvgLib.render(skinData, netlistJson, (err, svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });

  const svgString = injectCellTypesIntoSvg(rawSvg, buildInstanceTypeMap(netlistJson));
  await fse.writeFile(outputSvgPath, svgString, 'utf-8');
  return outputSvgPath;
}

async function performPrismCompilationWithPaths(compilationPaths) {
  try {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('terminal-log', 'tveri', 'Starting PRISM compilation process', 'info');
    }

    const tempDir = compilationPaths.tempPath;
    await fse.ensureDir(tempDir);

    // Top-level vem sempre de spf.structure.topLevelFile.
    const spfPath = compilationPaths.spfPath;
    if (!spfPath || !(await fse.pathExists(spfPath))) {
      throw new Error('.spf not found');
    }
    const spfData = await fse.readJson(spfPath);
    const topLevelModule = path.basename(spfData?.structure?.topLevelFile || '', '.v');

    const hierarchyJsonPath = await runYosysCompilationWithPaths(
      compilationPaths,
      topLevelModule,
      tempDir,
    );
    await splitHierarchyJson(hierarchyJsonPath, tempDir);

    const svgPath = await generateModuleSVGWithPaths(topLevelModule, tempDir);

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

      const svgPath = await generateModuleSVGWithPaths(moduleName, tempDir);
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
      return { success: false, message: error.message };
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
