// @ts-check
/**
 * PRISM compilation pipeline: gather the project's Verilog, synthesize with
 * Yosys into hierarchy.json, split it into per-module JSONs, and render the
 * top-level module to SVG. performPrismCompilationWithPaths is the entry
 * point the IPC handlers call; runYosys / splitHierarchy are its stages.
 *
 * Split out of prism.js (2026-06); see ./index.js for the orchestrator.
 */

const path = require('path');
const fse = require('fs-extra');
const { spawn } = require('child_process');
const log = require('electron-log');

const state = require('../../state');
const { sanitizeFileName } = require('../../utils');
const { trackChild } = require('../../process_registry');
const { cleanModuleName, isClickableModule } = require('./module_names');
const { generateModuleSVGWithPaths } = require('./svg');

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

module.exports = { performPrismCompilationWithPaths };
