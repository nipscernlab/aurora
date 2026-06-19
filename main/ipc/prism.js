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
// @ts-ignore -- @silimate/netlistsvg ships no type declarations
const netlistsvgLib = require('@silimate/netlistsvg');

const state = require('../state');
const { componentsPath } = require('../paths');
const { sanitizeFileName } = require('../utils');
const { trackChild } = require('../process_registry');
const { loadPage } = require('../render_loader');

// ---------- helpers ----------

function cleanModuleName(/** @type {any} */ moduleName) {
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

function isClickableModule(/** @type {any} */ moduleName) {
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
      sandbox: true,
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

  try {
    // loadPage resolves dev-server → built dist → raw source. The catch below
    // plus the did-fail-load handler surface (and clean up) any real failure —
    // no manual pre-check, which could only validate the raw artifact and would
    // false-negative once dist is the canonical source.
    await loadPage(prismWindow, 'html/prism/prism.html');

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
      detail: `Error: ${error instanceof Error ? error.message : String(error)}\nPage: html/prism/prism.html`,
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
  /** @type {any} */ compilationPaths,
  /** @type {any} */ topLevelModule,
  /** @type {any} */ tempDir,
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

  // Resolve paths relativos contra basePath (formato novo do .spf — ver
  // js/project/spf_store.js). SpfStore do renderer expande na leitura,
  // mas aqui em main lemos .spf raw via fse.readJson e precisamos
  // expandir por conta propria. Paths absolutos passam direto.
  const spfBaseDir = spfStructure?.basePath || (spfPath ? path.dirname(spfPath) : '');
  const isAbs = (/** @type {any} */ p) => typeof p === 'string' && /^([a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(p);
  const resolveSpf = (/** @type {any} */ p) => (!p || isAbs(p) || !spfBaseDir) ? p : path.join(spfBaseDir, p);

  if (spfStructure && Array.isArray(spfStructure.synthesizableFiles)) {
    for (const f of spfStructure.synthesizableFiles) {
      const rawP = typeof f === 'string' ? f : f?.path;
      const p = resolveSpf(rawP);
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
  // duplo-clique (clique simples continua sendo navegacao entre modulos).
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
    // Track so closing the main window kills an in-flight PRISM synthesis —
    // yosys runs from the bundled mingw64/bin (not Temp/), so the path-prefix
    // sweep never caught it before.
    trackChild(yosysProcess);

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

async function splitHierarchyJson(/** @type {any} */ hierarchyJsonPath, /** @type {any} */ tempDir) {
  const hierarchyData = await fse.readJson(hierarchyJsonPath);
  if (!hierarchyData.modules) throw new Error('No modules found in hierarchy JSON');

  for (const [moduleName, moduleData] of Object.entries(hierarchyData.modules)) {
    if (!isClickableModule(moduleName)) continue;

    const cleanName = cleanModuleName(moduleName);
    const sanitizedName = sanitizeFileName(cleanName);
    const moduleFilePath = path.join(tempDir, `${sanitizedName}.json`);

    const cleanModuleData = JSON.parse(JSON.stringify(moduleData));

    if (cleanModuleData.cells) {
      /** @type {Record<string, any>} */
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
function extractTopLevelGBlocks(/** @type {any} */ svgText) {
  const blocks = [];
  const tagRe = /<g\b[^>]*>|<\/g>/g;
  /** @type {any[]} */
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

async function loadCustomSkinBlocks(/** @type {any} */ customSkinDir) {
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
      log.warn(`[PRISM] Skipping malformed custom skin ${file}:`, err instanceof Error ? err.message : String(err));
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
function buildInstanceTypeMap(/** @type {any} */ netlistJson) {
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
function xmlAttrEscape(/** @type {any} */ s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

// Injeta data-cell-type=<tipo> em cada <g id="cell_<inst>"> do SVG.
// Regex em vez de parse XML real porque (a) overkill, (b) a forma do
// output do netlistsvg e' previsivel (id="cell_..." sempre em <g>).
function injectCellTypesIntoSvg(/** @type {any} */ svgString, /** @type {any} */ instanceTypeMap) {
  if (instanceTypeMap.size === 0) return svgString;
  return svgString.replace(
    /<g\b([^>]*?)\sid="cell_([^"]+)"([^>]*?)(\/?>)/g,
    (/** @type {any} */ match, /** @type {any} */ before, /** @type {any} */ instName, /** @type {any} */ after, /** @type {any} */ close) => {
      const type = instanceTypeMap.get(instName);
      if (!type) return match;
      return `<g${before} id="cell_${instName}"${after} data-cell-type="${xmlAttrEscape(type)}"${close}`;
    },
  );
}

// Mapa tipo-de-cell -> Set de portas (s:pid) que a skin custom desenha.
// Uma skin custom tem um conjunto FIXO de portas; netlistsvg so cria a
// shape das portas que a skin declara.
function buildSkinPortMap(/** @type {any} */ skinData) {
  const map = new Map();
  for (const block of extractTopLevelGBlocks(skinData)) {
    if (!block.type) continue;
    const pids = new Set();
    for (const m of block.content.matchAll(/\bs:pid="([^"]+)"/g)) pids.add(m[1]);
    map.set(block.type, pids);
  }
  return map;
}

// Remove de cada cell as conexoes cujo port NAO existe na skin custom do
// seu tipo. Sem isso, uma porta presente no RTL mas ausente da skin (ex:
// o core ganhou `cheguei` mas core.svg nao tem o anchor) faz o netlistsvg
// gerar uma ARESTA pra uma shape de porta que ele nunca desenhou — e o ELK
// aborta com "Referenced shape does not exist: <cell>.<port>", derrubando
// TODO o render do modulo. Podar alinha o JSON ao que a skin sabe desenhar:
// a porta extra apenas nao aparece (com aviso), em vez de quebrar a tela.
// Cells de tipo generico (sem skin) nao sao tocadas — la o netlistsvg cria
// as portas a partir das proprias conexoes, entao nunca ficam penduradas.
function pruneNetlistToSkinPorts(/** @type {any} */ netlistJson, /** @type {any} */ skinPortMap) {
  if (!netlistJson?.modules) return;
  for (const moduleData of Object.values(netlistJson.modules)) {
    for (const [cellName, cell] of Object.entries(moduleData.cells || {})) {
      const allowed = skinPortMap.get(cell.type);
      if (!allowed || !cell.connections) continue;
      for (const port of Object.keys(cell.connections)) {
        if (allowed.has(port)) continue;
        delete cell.connections[port];
        if (cell.port_directions) delete cell.port_directions[port];
        log.warn(
          `[PRISM] cell "${cellName}" (${cell.type}): porta "${port}" nao esta na skin ` +
          `assets/prism-skins/${cell.type}.svg — omitida do esquematico ` +
          `(adicione um <g s:pid="${port}"/> na skin pra desenha-la).`,
        );
      }
    }
  }
}

async function generateModuleSVGWithPaths(/** @type {any} */ moduleName, /** @type {any} */ tempDir) {
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

  // Alinha o netlist ao que as skins custom conseguem desenhar (ver
  // pruneNetlistToSkinPorts) ANTES de renderizar — evita o abort do ELK
  // "Referenced shape does not exist" quando o RTL tem porta que a skin nao.
  pruneNetlistToSkinPorts(netlistJson, buildSkinPortMap(skinData));

  // lib.render usa callback (err, svgString) — wrap em Promise. Sem spawn
  // de processo, sem .exe externo: fica tudo in-process.
  const rawSvg = await new Promise((resolve, reject) => {
    netlistsvgLib.render(skinData, netlistJson, (/** @type {any} */ err, /** @type {any} */ svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });

  // Defensivo: se o layout falhar de outra forma e devolver vazio, falha
  // com mensagem clara em vez de estourar um TypeError no inject (.replace
  // de undefined) — esse era o sintoma "clicar no modulo nao faz nada".
  if (typeof rawSvg !== 'string' || !rawSvg) {
    throw new Error(`netlistsvg nao produziu SVG para o modulo "${moduleName}" (falha de layout)`);
  }

  const svgString = injectCellTypesIntoSvg(rawSvg, buildInstanceTypeMap(netlistJson));
  await fse.writeFile(outputSvgPath, svgString, 'utf-8');
  return outputSvgPath;
}

async function performPrismCompilationWithPaths(/** @type {any} */ compilationPaths) {
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
      state.mainWindow.webContents.send('terminal-log', 'tveri', `Compilation failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// ---------- DigitalJS interactive simulation (O9) ----------

// Gather every synthesizable .v for a design: the SAPHO HDL library + the
// .spf's synthesizableFiles + an optional TopLevel/ + each processor's
// Hardware/. Same sources as runYosysCompilationWithPaths, kept lean and
// standalone so the DigitalJS build never perturbs the schematic path.
async function collectSynthFiles(/** @type {any} */ compilationPaths) {
  const fileSet = new Set();
  const addV = (/** @type {string} */ p) => { if (p && p.toLowerCase().endsWith('.v')) fileSet.add(p); };

  const hdlPath = compilationPaths.hdlPath;
  if (hdlPath && await fse.pathExists(hdlPath)) {
    for (const f of await fse.readdir(hdlPath)) {
      if (f.endsWith('.v') && !f.includes('_tb') && !f.toLowerCase().includes('test')) addV(path.join(hdlPath, f));
    }
  }

  const spfPath = compilationPaths.spfPath;
  let spfStructure = null;
  if (spfPath && await fse.pathExists(spfPath)) {
    try { spfStructure = (await fse.readJson(spfPath))?.structure ?? null; } catch (_e) { /* parse fail tolerated */ }
  }

  // Resolve .spf-relative paths against basePath (new .spf format); absolute paths pass through.
  const spfBaseDir = spfStructure?.basePath || (spfPath ? path.dirname(spfPath) : '');
  const isAbs = (/** @type {any} */ p) => typeof p === 'string' && /^([a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(p);
  const resolveSpf = (/** @type {any} */ p) => (!p || isAbs(p) || !spfBaseDir) ? p : path.join(spfBaseDir, p);

  if (Array.isArray(spfStructure?.synthesizableFiles)) {
    for (const f of spfStructure.synthesizableFiles) addV(resolveSpf(typeof f === 'string' ? f : f?.path));
  }

  const topLevelDir = compilationPaths.topLevelPath;
  if (topLevelDir && await fse.pathExists(topLevelDir)) {
    for (const f of await fse.readdir(topLevelDir)) {
      if (f.endsWith('.v') && !f.includes('_tb')) addV(path.join(topLevelDir, f));
    }
  }

  const projectPath = compilationPaths.projectPath;
  const procNames = new Set();
  if (Array.isArray(spfStructure?.processors)) {
    for (const p of spfStructure.processors) { const n = typeof p === 'string' ? p : p?.name; if (n) procNames.add(n); }
  }
  for (const procName of procNames) {
    const hwDir = path.join(projectPath, procName, 'Hardware');
    if (!(await fse.pathExists(hwDir))) continue;
    for (const f of await fse.readdir(hwDir)) {
      if (f.endsWith('.v') && !f.includes('_tb')) addV(path.join(hwDir, f));
    }
  }

  return [...fileSet];
}

// Synthesize the design with a digitaljs-friendly yosys script, then convert
// the JSON with yosys2digitaljs into the DigitalJS circuit format. We run
// AURORA's own (allowlisted) yosys and feed its JSON to the converter's pure
// function, so nothing needs yosys on PATH and the schematic flow is untouched.
async function buildDigitalJSCircuit(
  /** @type {any} */ compilationPaths,
  /** @type {string} */ topLevelModule,
  /** @type {string} */ tempDir,
) {
  const fileList = await collectSynthFiles(compilationPaths);
  if (fileList.length === 0) throw new Error('No Verilog files found for the simulation');

  // Per-phase progress to the terminal so a slow/stuck build is diagnosable
  // (which phase — yosys, convert, or the renderer — is the bottleneck).
  const tlog = (/** @type {string} */ m, /** @type {string} */ t = 'info') => {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('terminal-log', 'tveri', m, t);
    }
  };
  const t0 = Date.now();

  const jsonPath = path.join(tempDir, 'digitaljs.json');
  const readCommands = fileList.map((f) => `read_verilog "${f}"`).join('\n');
  // Word-level synthesis the yosys2digitaljs converter expects (no abc/techmap,
  // so $add/$mux/$dff stay as DigitalJS cells rather than being mapped to gates).
  const script = `
${readCommands}
hierarchy -top ${topLevelModule}
proc
opt_clean
memory -nomap
wreduce -memx
opt_clean
write_json "${jsonPath}"
`;
  const scriptPath = path.join(tempDir, 'digitaljs_yosys.ys');
  await fse.writeFile(scriptPath, script);

  tlog(`DigitalJS: synthesizing with Yosys (${fileList.length} files)…`);
  await new Promise((resolve, reject) => {
    const proc = spawn(compilationPaths.yosysPath, ['-s', scriptPath], {
      cwd: tempDir, env: process.env, windowsHide: true,
    });
    trackChild(proc);
    let stderr = '';
    let settled = false;
    const finish = (/** @type {Error|null} */ err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(undefined);
    };
    // Cap a runaway synthesis so the user gets a clear error instead of an
    // endless "Building simulation…" spinner.
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) { /* already gone */ }
      finish(new Error('Yosys synthesis timed out (45s) — the design is likely too large/complex for interactive simulation. Use the schematic view.'));
    }, 45000);
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e))));
    proc.on('close', (/** @type {number} */ code) => {
      finish(code === 0 ? null : new Error(`yosys exited ${code}${stderr ? `: ${stderr.slice(-400)}` : ''}`));
    });
  });

  tlog(`DigitalJS: Yosys done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const yosysJson = await fse.readJson(jsonPath);

  // DigitalJS is an interactive teaching simulator, not a viewer for big
  // designs: the converter below runs SYNCHRONOUSLY on the main process and the
  // in-browser layout/render bog down past a few thousand cells. Refuse an
  // oversized netlist up front with clear guidance instead of freezing the app
  // on an endless spinner (the static PRISM schematic already handles big RTL).
  const cellCount = Object.values(yosysJson.modules || {}).reduce(
    (/** @type {number} */ n, /** @type {any} */ m) => n + Object.keys((m && m.cells) || {}).length, 0);
  const MAX_CELLS = 3000;
  if (cellCount > MAX_CELLS) {
    throw new Error(`Design too large for interactive simulation (${cellCount} cells, limit ${MAX_CELLS}). ` +
      'DigitalJS is best for small modules — use the schematic view for large designs.');
  }
  tlog(`DigitalJS: netlist ${cellCount} cells — converting…`);

  // Pure convert: takes an existing yosys JSON object, returns the DigitalJS
  // TopModule directly (no yosys spawn — we already ran ours). Required lazily
  // so the (Node-only) converter isn't loaded until the user enters Sim mode.
  const tConv = Date.now();
  const { yosys2digitaljs } = require('yosys2digitaljs/core');
  const circuit = yosys2digitaljs(yosysJson, {});
  tlog(`DigitalJS: converted to ${Object.keys(circuit.devices || {}).length} devices ` +
    `in ${((Date.now() - tConv) / 1000).toFixed(1)}s — rendering in PRISM…`, 'success');
  return circuit;
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
      // A4: project dir derived from the open .spf (single source of truth).
      const projectPath = state.currentOpenProjectPath
        ? path.dirname(state.currentOpenProjectPath)
        : null;
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

  // O9: build the DigitalJS interactive-simulation circuit for the current
  // top-level. Same paths/top as the schematic flow, different yosys script.
  ipcMain.handle('prism:build-digitaljs', async (_event, compilationPaths) => {
    try {
      if (!compilationPaths) throw new Error('Compilation paths are required.');
      const tempDir = compilationPaths.tempPath;
      await fse.ensureDir(tempDir);

      const spfPath = compilationPaths.spfPath;
      if (!spfPath || !(await fse.pathExists(spfPath))) throw new Error('.spf not found');
      const spfData = await fse.readJson(spfPath);
      const topLevelModule = path.basename(spfData?.structure?.topLevelFile || '', '.v');
      if (!topLevelModule) throw new Error('No top-level module set in the .spf');

      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('terminal-log', 'tveri', 'Building DigitalJS simulation…', 'info');
      }
      const circuit = await buildDigitalJSCircuit(compilationPaths, topLevelModule, tempDir);
      return { ok: true, circuit, topLevelModule };
    } catch (error) {
      log.error('DigitalJS build error:', error);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = { register, createPrismWindow };
