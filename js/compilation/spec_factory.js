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
  buildCocotbRunSpec,
  buildVerilatorBuildSpec, buildVerilatorHeaderSpec, buildVerilatorRunSpec,
  buildFst2VcdSpec, buildGtkwaveSpec,
  buildYosysHierarchySpec,
} from './builders/index.js';

function moduleStem(filePath) {
  return String(filePath || '').split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
}

function isPythonFile(filePath) {
  return /\.py$/i.test(String(filePath || ''));
}

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
      processorName: proc.name,
      lang,
    });
  }

  const iveriCompPath = await joinComponents('Packages', 'msys', 'mingw64', 'bin', 'iverilog.exe');
  const vvpBin        = await joinComponents('Packages', 'msys', 'mingw64', 'bin', 'vvp.exe');
  const gtkwaveBin    = await joinComponents('Packages', 'gtkwave-nipscern', 'gtkwave.exe');
  const fst2vcdBin    = await joinComponents('Packages', 'gtkwave-nipscern', 'fst2vcd.exe');

  const structure = await SpfStore.read(window.currentSpfPath);
  const synth = (structure.synthesizableFiles || []).map((f) => f?.path || f).filter(Boolean);
  const tb = structure.testbenchFile
    || (structure.testbenchFiles && structure.testbenchFiles[0]?.path)
    || null;
  const topLevelFile = structure.topLevelFile || null;
  const topLevelModuleName = topLevelFile ? moduleStem(topLevelFile) : null;
  const tbIsPython = isPythonFile(tb);
  const simTopModule = tb
    ? moduleStem(tb)
    : topLevelModuleName;
  const fileSet = new Set(synth);
  if (tb && !tbIsPython) fileSet.add(tb);
  const sources = [...fileSet];

  if (step === 'cocotb-run') {
    if (!tb || !tbIsPython) throw new Error('cocotb-run needs a Python .py testbench');
    if (!topLevelFile || !topLevelModuleName) throw new Error('cocotb-run needs a Verilog top-level set');
    const pyStatus = await window.electronAPI.getPythonStatus();
    if (!pyStatus?.ok) throw new Error('Python was not found');
    if (!pyStatus.isBundled) throw new Error('cocotb-run requires Aurora bundled Python');
    if (!pyStatus.hasCocotb) throw new Error('Aurora bundled Python is missing cocotb');
    const expectedCocotbVersion = pyStatus.expectedCocotbVersion || '2.0.1';
    if (pyStatus.cocotbVersion !== expectedCocotbVersion) {
      throw new Error(`Aurora bundled Python has cocotb ${pyStatus.cocotbVersion || 'not installed'}, expected ${expectedCocotbVersion}`);
    }
    const runnerScript = await window.electronAPI.joinPath(tempBaseDir, 'aurora_cocotb_runner.py');
    const buildDir = await window.electronAPI.joinPath(tempBaseDir, `cocotb_${simTopModule || 'test'}`);
    const tbDir = await window.electronAPI.dirname(tb);
    // The bundle Python is mingw: point PYTHONHOME at <bundle>/mingw64 so it
    // finds its stdlib/platform libs (pythonPath = .../msys/mingw64/bin/python.exe).
    const pythonHome = await window.electronAPI.dirname(
      await window.electronAPI.dirname(pyStatus.pythonPath),
    );
    return buildCocotbRunSpec({
      pythonPath: pyStatus.pythonPath,
      runnerScript,
      cwd: buildDir,
      env: {
        AURORA_COCOTB_SOURCES_JSON: JSON.stringify(sources),
        AURORA_COCOTB_TOP: topLevelModuleName,
        AURORA_COCOTB_TEST_MODULE: moduleStem(tb),
        AURORA_COCOTB_BUILD_DIR: buildDir,
        AURORA_COCOTB_TEST_DIR: tbDir,
        AURORA_COCOTB_PYTHONPATH: [tbDir, projectPath, buildDir].filter(Boolean).join(';'),
        AURORA_COCOTB_BUILD_ARGS_JSON: JSON.stringify(['-g2012']),
        AURORA_COCOTB_TEST_ARGS_JSON: JSON.stringify([]),
        SIM: 'icarus',
        TOPLEVEL_LANG: 'verilog',
        WAVES: '1',
        PYTHONHOME: pythonHome,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      prependPath: [
        await window.electronAPI.dirname(iveriCompPath),
        await window.electronAPI.dirname(gtkwaveBin),
      ],
    });
  }

  const verilogSimTopModule = tb && !tbIsPython ? simTopModule : topLevelModuleName;

  if (step === 'iverilog-check') {
    return buildIverilogCheckSpec({
      iveriCompPath, hdlPath,
      simTopModule: verilogSimTopModule || 'top',
      sourceFiles: sources, cwd: projectPath,
    });
  }

  if (step === 'iverilog-build') {
    if (tbIsPython) throw new Error('iverilog-build cannot use a Python testbench; use cocotb-run');
    if (!simTopModule) throw new Error('iverilog-build needs a testbench or top-level set');
    const outputFile = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);
    return buildIverilogBuildSpec({
      iveriCompPath, hdlPath, simTopModule, outputFile,
      sourceFiles: sources, cwd: projectPath,
    });
  }

  if (step === 'vvp-header' || step === 'vvp-run') {
    if (tbIsPython) throw new Error(`${step} cannot use a Python testbench; use cocotb-run`);
    if (!simTopModule) throw new Error(`${step} needs a testbench`);
    const vvpFile = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);
    return step === 'vvp-header'
      ? buildVvpHeaderSpec({ vvpBin, vvpFile, cwd: tempBaseDir })
      : buildVvpRunSpec({ vvpBin, vvpFile, cwd: tempBaseDir });
  }

  if (step === 'verilator-build' || step === 'verilator-header' || step === 'verilator-run') {
    const mingwBin = await joinComponents('Packages', 'msys', 'mingw64', 'bin');
    const usrBin   = await joinComponents('Packages', 'msys', 'usr', 'bin');
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
    return buildGtkwaveSpec({ gtkwaveBin, vcdFile, cwd: tempBaseDir });
  }

  if (step === 'yosys-hierarchy' || step === 'prism-yosys') {
    const yosysPath = await joinComponents('Packages', 'msys', 'mingw64', 'bin', 'yosys.exe');
    // Preview uses a placeholder script path — the real path is built
    // by the runtime invoker since the script is freshly emitted per run.
    const scriptPath = await window.electronAPI.joinPath(tempBaseDir, step === 'prism-yosys' ? 'yosys_script.ys' : 'hierarchy_gen.ys');
    return buildYosysHierarchySpec({ yosysPath, scriptPath, cwd: tempBaseDir });
  }

  throw new Error(`Unknown step: ${step}`);
}
