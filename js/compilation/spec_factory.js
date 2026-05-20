/**
 * spec_factory.js — build a base CommandSpec for any compile step
 * WITHOUT executing it.
 *
 * Powers the AI's `inspect_compile_command` / `preview_compile_command`
 * tools: the model asks "what WOULD you run for step X?", we build the
 * spec using the same builders the actual pipeline uses, layer
 * persisted/ephemeral overrides on top, and hand back the result for
 * display.
 *
 * For per-processor steps (cmm, asm-pre, asm), `processorName` is
 * required — otherwise we pick the first processor in the project (or
 * fail with a helpful message). For pipeline-wide steps (iverilog-*,
 * vvp-*, verilator-*, gtkwave, prism-yosys), processor is ignored.
 */

import { SpfStore } from '../project/spf_store.js';
import {
  buildCmmSpec,
  buildAsmPreSpec, buildAsmSpec,
  buildIverilogCheckSpec, buildIverilogBuildSpec,
  buildVvpHeaderSpec, buildVvpRunSpec,
  buildVerilatorBuildSpec, buildVerilatorHeaderSpec, buildVerilatorRunSpec,
  buildFst2VcdSpec, buildGtkwaveSpec,
  buildYosysHierarchySpec,
} from './builders/index.js';

/** Best-effort lookup of a processor's config from the open project. */
async function findProcessor(processorName) {
  const spfPath = window.currentSpfPath;
  if (!spfPath) throw new Error('No project is open');
  const structure = await SpfStore.read(spfPath);
  if (!structure.processors || structure.processors.length === 0) {
    throw new Error('Project has no processors');
  }
  if (processorName) {
    const found = structure.processors.find((p) => (typeof p === 'string' ? p : p?.name) === processorName);
    if (!found) throw new Error(`Processor ${processorName} not found`);
    return typeof found === 'string' ? { name: found } : found;
  }
  // Default to the first processor.
  const first = structure.processors[0];
  return typeof first === 'string' ? { name: first } : first;
}

/**
 * Read a processor's clk/numClocks/showArrays + currently-active .cmm,
 * mirroring the lookup CompilationModule does at runtime. Used so the
 * preview spec matches what would actually be executed.
 */
async function loadProcessorContext(processorName) {
  const proc = await findProcessor(processorName);
  // For preview purposes we just need name + best-effort clk/numClocks.
  // The actual values come from .spf or processor defaults.
  return {
    name: proc.name,
    clk: Number(proc.clk) || 50,
    numClocks: Number(proc.numClocks) || 1000,
    showArrays: !!proc.showArrays,
    cmmFile: proc.cmmFile || `${proc.name}.cmm`,
  };
}

async function getComponentsPath() {
  return window.electronAPI.getComponentsPath();
}

async function joinComponents(...parts) {
  const root = await getComponentsPath();
  let p = root;
  for (const part of parts) {
    p = await window.electronAPI.joinPath(p, part);
  }
  return p;
}

async function getProjectPath() {
  return (
    window.currentProjectPath ||
    (window.currentOpenProjectPath
      ? await window.electronAPI.dirname(window.currentOpenProjectPath)
      : null)
  );
}

/**
 * Build a base spec for the given step. Throws for steps that need
 * runtime info the factory can't reconstruct (e.g., `verilator-run`
 * needs the per-build V<top>.exe that doesn't exist until build runs).
 *
 * @param {string} step
 * @param {string} [processorName]  required for per-processor steps
 * @returns {Promise<object>}        base CommandSpec
 */
export async function buildSpecForStep(step, processorName) {
  const projectPath = await getProjectPath();
  if (!projectPath) throw new Error('No project is open');

  const lang = window.getYancLang?.() ?? 'pt';
  const macrosPath  = await joinComponents('Macros');
  const hdlPath     = await joinComponents('HDL');
  const tempBaseDir = await joinComponents('Temp');

  if (step === 'cmm') {
    const proc = await loadProcessorContext(processorName);
    const cmmCompPath = await joinComponents('bin', 'cmmcomp.exe');
    const procDir     = await window.electronAPI.joinPath(projectPath, proc.name);
    const tempPath    = await window.electronAPI.joinPath(tempBaseDir, proc.name);
    const baseName    = (proc.cmmFile || `${proc.name}.cmm`).replace(/\.cmm$/i, '');
    return buildCmmSpec({
      cmmCompPath,
      inputFile: proc.cmmFile,
      baseName,
      projectPath: procDir,
      macrosPath,
      tempPath,
      processorName: proc.name,
      lang,
      showArrays: proc.showArrays,
    });
  }

  if (step === 'asm-pre' || step === 'asm') {
    const proc = await loadProcessorContext(processorName);
    const appCompPath = await joinComponents('bin', 'appcomp.exe');
    const asmCompPath = await joinComponents('bin', 'asmcomp.exe');
    const procDir     = await window.electronAPI.joinPath(projectPath, proc.name);
    const tempPath    = await window.electronAPI.joinPath(tempBaseDir, proc.name);
    const softwareDir = await window.electronAPI.joinPath(procDir, 'Software');
    const baseName    = (proc.cmmFile || `${proc.name}.cmm`).replace(/\.cmm$/i, '');
    const asmFile     = await window.electronAPI.joinPath(softwareDir, `${baseName}.asm`);
    if (step === 'asm-pre') {
      return buildAsmPreSpec({ appCompPath, asmFile, tempPath, processorName: proc.name, lang });
    }
    return buildAsmSpec({
      asmCompPath,
      asmFile,
      projectPath: procDir,
      hdlPath,
      macrosPath,
      tempPath,
      freq: proc.clk,
      clocks: proc.numClocks,
      projectMode: true,
      processorName: proc.name,
      lang,
    });
  }

  const iveriCompPath = await joinComponents('Packages', 'iverilog', 'bin', 'iverilog.exe');
  const vvpBin        = await joinComponents('Packages', 'iverilog', 'bin', 'vvp.exe');
  const gtkwaveBin    = await joinComponents('Packages', 'iverilog', 'gtkwave', 'bin', 'gtkwave.exe');
  const fst2vcdBin    = await joinComponents('Packages', 'iverilog', 'gtkwave', 'bin', 'fst2vcd.exe');
  const scriptsPath   = await joinComponents('Scripts');
  const fixScript     = await window.electronAPI.joinPath(scriptsPath, 'gtk_almost_proj.tcl');

  const structure = await SpfStore.read(window.currentSpfPath);
  const synth = (structure.synthesizableFiles || []).map((f) => f?.path || f).filter(Boolean);
  const tb = structure.testbenchFile
    || (structure.testbenchFiles && structure.testbenchFiles[0]?.path)
    || null;
  const topLevelFile = structure.topLevelFile || null;
  const topLevelModuleName = topLevelFile ? topLevelFile.split(/[\\/]/).pop().replace(/\.v$/i, '') : null;
  const simTopModule = tb
    ? tb.split(/[\\/]/).pop().replace(/\.v$/i, '')
    : topLevelModuleName;
  const fileSet = new Set(synth);
  if (tb) fileSet.add(tb);
  const sources = [...fileSet];

  if (step === 'iverilog-check') {
    return buildIverilogCheckSpec({
      iveriCompPath, hdlPath,
      simTopModule: simTopModule || topLevelModuleName || 'top',
      sourceFiles: sources, cwd: projectPath,
    });
  }

  if (step === 'iverilog-build') {
    if (!simTopModule) throw new Error('iverilog-build needs a testbench or top-level set');
    const outputFile = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);
    return buildIverilogBuildSpec({
      iveriCompPath, hdlPath, simTopModule, outputFile,
      sourceFiles: sources, cwd: projectPath,
    });
  }

  if (step === 'vvp-header' || step === 'vvp-run') {
    if (!simTopModule) throw new Error(`${step} needs a testbench`);
    const vvpFile = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);
    return step === 'vvp-header'
      ? buildVvpHeaderSpec({ vvpBin, vvpFile, cwd: tempBaseDir })
      : buildVvpRunSpec({ vvpBin, vvpFile, cwd: tempBaseDir });
  }

  if (step === 'verilator-build' || step === 'verilator-header' || step === 'verilator-run') {
    const mingwBin = await joinComponents('Packages', 'verilator', 'mingw64', 'bin');
    const usrBin   = await joinComponents('Packages', 'verilator', 'usr', 'bin');
    const perlExe  = await window.electronAPI.joinPath(mingwBin, 'perl.exe');
    const verilatorScript = await window.electronAPI.joinPath(mingwBin, 'verilator');
    if (step === 'verilator-build') {
      if (!simTopModule) throw new Error('verilator-build needs a testbench or top-level set');
      const objDir = await window.electronAPI.joinPath(tempBaseDir, `obj_dir_${simTopModule}`);
      return buildVerilatorBuildSpec({
        perlExe, verilatorScript, mingwBin, usrBin, hdlPath,
        simTopModule, objDir, sourceFiles: sources, cwd: tempBaseDir,
      });
    }
    if (!simTopModule) throw new Error(`${step} needs a testbench`);
    const objDir = await window.electronAPI.joinPath(tempBaseDir, `obj_dir_${simTopModule}`);
    const exePath = await window.electronAPI.joinPath(objDir, `V${simTopModule}.exe`);
    return step === 'verilator-header'
      ? buildVerilatorHeaderSpec({ exePath, cwd: tempBaseDir, mingwBin, usrBin })
      : buildVerilatorRunSpec({ exePath, cwd: tempBaseDir, mingwBin, usrBin });
  }

  if (step === 'fst2vcd') {
    if (!simTopModule) throw new Error('fst2vcd needs a testbench');
    const pass1File = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.vcd`);
    const headerVcd = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.header.vcd`);
    return buildFst2VcdSpec({ fst2vcdBin, inputFile: pass1File, outputFile: headerVcd, cwd: tempBaseDir });
  }

  if (step === 'gtkwave') {
    if (!simTopModule) throw new Error('gtkwave needs a testbench');
    const vcdFile = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.vcd`);
    return buildGtkwaveSpec({ gtkwaveBin, vcdFile, fixScript, cwd: tempBaseDir });
  }

  if (step === 'yosys-hierarchy' || step === 'prism-yosys') {
    const yosysPath = await joinComponents('Packages', 'PRISM', 'yosys', 'yosys.exe');
    // Preview uses a placeholder script path — the real path is built
    // by the runtime invoker since the script is freshly emitted per run.
    const scriptPath = await window.electronAPI.joinPath(tempBaseDir, step === 'prism-yosys' ? 'yosys_script.ys' : 'hierarchy_gen.ys');
    return buildYosysHierarchySpec({ yosysPath, scriptPath, cwd: tempBaseDir });
  }

  throw new Error(`Unknown step: ${step}`);
}
