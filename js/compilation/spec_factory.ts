/**
 * spec_factory.ts: build a base CommandSpec for any compile step
 * WITHOUT executing it.
 *
 * Powers the AI's `inspect_compile_command` / `preview_compile_command`
 * tools: the model asks "what WOULD you run for step X?", we build the
 * spec using the same builders the actual pipeline uses, layer
 * persisted/ephemeral overrides on top, and hand back the result for
 * display.
 *
 * For per-processor steps (cmm, cpp, asm), `processorName` is
 * required, otherwise we pick the first processor in the project (or
 * fail with a helpful message). For pipeline-wide steps (iverilog-*,
 * vvp-*, verilator-*, gtkwave, prism-yosys), processor is ignored.
 *
 * Compilado por `tsc` (npm run build:ts) num spec_factory.js ao lado, é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { projectTempDir } from '../project/project_temp.js';
import { diretorioDaSimulacao } from './arquivos_da_simulacao.js';
import { arquivosDaSaida, segmentosDaSaida, segmentosDoFonte } from './pastas_do_processador.js';
import {
  buildCmmSpec,
  buildCppSpec,
  buildAsmSpec,
  buildIverilogCheckSpec, buildIverilogBuildSpec,
  buildVvpRunSpec,
  buildCocotbRunSpec,
  buildVerilatorBuildSpec, buildVerilatorRunSpec,
  buildFst2VcdSpec, buildGtkwaveSpec,
  buildYosysHierarchySpec,
} from './builders/index.js';
import type { CommandSpec } from './command_spec.js';
import {
  resolveProcessorSource,
  type EntradaDeProcessador,
  type FonteDoProcessador,
} from './processor_source.js';

/** A processor entry as it appears in the .spf (string legacy or object). */
interface SpfProcessor extends EntradaDeProcessador {
  clk?: number | string;
  numClocks?: number | string;
  showArrays?: boolean;
}

/** Resolved processor preview context. */
interface ProcessorContext {
  name: string;
  clk: number;
  numClocks: number;
  showArrays: boolean;
  /** Linguagem, nome do fonte e base, por processor_source.ts. */
  source: FonteDoProcessador;
}

function moduleStem(filePath: string | null | undefined): string {
  return (String(filePath || '').split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/i, '');
}

function isPythonFile(filePath: string | null | undefined): boolean {
  return /\.py$/i.test(String(filePath || ''));
}

/** Best-effort lookup of a processor's config from the open project. */
async function findProcessor(processorName: string | null | undefined): Promise<SpfProcessor> {
  const spfPath = ProjectStore.getSpfPath();
  if (!spfPath) throw new Error('No project is open');
  const structure = await SpfStore.read(spfPath);
  const processors = (structure.processors || []) as unknown as Array<string | SpfProcessor>;
  if (processors.length === 0) {
    throw new Error('Project has no processors');
  }
  if (processorName) {
    const found = processors.find((p) => (typeof p === 'string' ? p : p?.name) === processorName);
    if (!found) throw new Error(`Processor ${processorName} not found`);
    return typeof found === 'string' ? { name: found } : found;
  }
  // Default to the first processor.
  const first = processors[0];
  return typeof first === 'string' ? { name: first } : first;
}

/**
 * Read a processor's clk/numClocks/showArrays + o fonte que ele compila
 * (nome e linguagem, por processor_source.ts),
 * mirroring the lookup CompilationModule does at runtime. Used so the
 * preview spec matches what would actually be executed.
 */
async function loadProcessorContext(processorName: string | null | undefined): Promise<ProcessorContext> {
  const proc = await findProcessor(processorName);
  // For preview purposes we just need name + best-effort clk/numClocks.
  // The actual values come from .spf or processor defaults.
  return {
    name: proc.name,
    clk: Number(proc.clk) || 50,
    numClocks: Number(proc.numClocks) || 1000,
    showArrays: !!proc.showArrays,
    source: resolveProcessorSource(proc),
  };
}

async function getComponentsPath(): Promise<string> {
  return electronAPI.getComponentsPath();
}

async function joinComponents(...parts: string[]): Promise<string> {
  const root = await getComponentsPath();
  let p = root;
  for (const part of parts) {
    p = await electronAPI.joinPath(p, part);
  }
  return p;
}

/**
 * Build a base spec for the given step. Throws for steps that need
 * runtime info the factory can't reconstruct (e.g., `verilator-run`
 * needs the per-build V<top>.exe that doesn't exist until build runs).
 *
 * @param processorName  required for per-processor steps
 */
export async function buildSpecForStep(step: string, processorName?: string): Promise<CommandSpec> {
  const projectPath = ProjectStore.getProjectPath();
  if (!projectPath) throw new Error('No project is open');

  const lang = (window.getYancLang?.() ?? 'pt') as 'pt' | 'en';
  const hdlPath     = await joinComponents('SAPHO');
  // Intermediarios na Temp DO PROJETO, nunca na compartilhada (project_temp.js).
  const tempBaseDir = await projectTempDir(projectPath);

  // Os tres passos do processador passam pelo driver yanc, com as pastas do
  // yanc v7.1 (pastas_do_processador.ts). Os caminhos espelham os do
  // processor_compiler.ts, para a previa ser o que de fato roda.
  if (step === 'cmm' || step === 'cpp' || step === 'asm') {
    const proc = await loadProcessorContext(processorName);
    const yancPath   = await joinComponents('bin', 'yanc.exe');
    const sourceDir  = await electronAPI.joinPath(projectPath, ...segmentosDoFonte(proc.name));
    const outputDir  = await electronAPI.joinPath(projectPath, ...segmentosDaSaida(proc.name));
    if (step === 'asm') {
      const asmFile = await electronAPI.joinPath(outputDir, arquivosDaSaida(proc.source.baseName).asm);
      return buildAsmSpec({
        yancPath, asmFile, outputDir,
        freq: proc.clk, clocks: proc.numClocks,
        processorName: proc.name, lang,
      });
    }
    const sourcePath = await electronAPI.joinPath(sourceDir, proc.source.sourceFile);
    if (step === 'cpp') {
      return buildCppSpec({ yancPath, sourcePath, outputDir, sourceDir, processorName: proc.name, lang });
    }
    return buildCmmSpec({
      yancPath, sourcePath, outputDir, sourceDir,
      processorName: proc.name, lang, showArrays: proc.showArrays,
    });
  }

  const iveriCompPath = await joinComponents('Packages', 'msys', 'mingw64', 'bin', 'iverilog.exe');
  const vvpBin        = await joinComponents('Packages', 'msys', 'mingw64', 'bin', 'vvp.exe');
  const gtkwaveBin    = await joinComponents('Packages', 'gtkwave-nipscern', 'gtkwave.exe');
  const fst2vcdBin    = await joinComponents('Packages', 'gtkwave-nipscern', 'fst2vcd.exe');

  const structure = await SpfStore.read(ProjectStore.getSpfPath() ?? '');
  const synth = ((structure.synthesizableFiles || []) as unknown as Array<string | { path?: string }>)
    .map((f) => (typeof f === 'string' ? f : f?.path))
    .filter((p): p is string => Boolean(p));
  const tbFiles = structure.testbenchFiles as unknown as Array<{ path?: string }> | undefined;
  const tb = structure.testbenchFile
    || (tbFiles && tbFiles[0]?.path)
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
    const pyStatus = await electronAPI.getPythonStatus();
    if (!pyStatus?.ok) throw new Error('Python was not found');
    if (!pyStatus.isBundled) throw new Error('cocotb-run requires Aurora bundled Python');
    if (!pyStatus.hasCocotb) throw new Error('Aurora bundled Python is missing cocotb');
    const expectedCocotbVersion = pyStatus.expectedCocotbVersion || '2.0.1';
    if (pyStatus.cocotbVersion !== expectedCocotbVersion) {
      throw new Error(`Aurora bundled Python has cocotb ${pyStatus.cocotbVersion || 'not installed'}, expected ${expectedCocotbVersion}`);
    }
    const runnerScript = await electronAPI.joinPath(tempBaseDir, 'aurora_cocotb_runner.py');
    const buildDir = await electronAPI.joinPath(tempBaseDir, `cocotb_${simTopModule || 'test'}`);
    const tbDir = await electronAPI.dirname(tb);
    // The bundle Python is mingw: point PYTHONHOME at <bundle>/mingw64 so it
    // finds its stdlib/platform libs (pythonPath = .../msys/mingw64/bin/python.exe).
    const pythonHome = await electronAPI.dirname(
      await electronAPI.dirname(pyStatus.pythonPath),
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
        // Mirror of the wave flow: the simulation cwd (cocotb test_dir) is
        // the project folder, the uniform relative-path base.
        AURORA_COCOTB_TEST_DIR: projectPath || tbDir,
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
        await electronAPI.dirname(iveriCompPath),
        await electronAPI.dirname(gtkwaveBin),
      ],
    });
  }

  const verilogSimTopModule = tb && !tbIsPython ? simTopModule : topLevelModuleName;

  // Simulation-run cwd, mirror of diretorioDaSimulacao in the wave flow, so
  // the command preview / overrides match what actually runs: the project
  // folder (the .spf directory), where the processors' memory files are
  // staged before the run, or a processor's output folder when the testbench
  // is the <proc>_tb.v the yanc generated there.
  const simRunCwd = await diretorioDaSimulacao(
    projectPath, structure.processors, tb && !tbIsPython ? tb : null, tempBaseDir);

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
    const outputFile = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);
    return buildIverilogBuildSpec({
      iveriCompPath, hdlPath, simTopModule, outputFile,
      sourceFiles: sources, cwd: projectPath,
    });
  }

  if (step === 'vvp-run') {
    if (tbIsPython) throw new Error(`${step} cannot use a Python testbench; use cocotb-run`);
    if (!simTopModule) throw new Error(`${step} needs a testbench`);
    const vvpFile = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);
    return buildVvpRunSpec({ vvpBin, vvpFile, cwd: simRunCwd });
  }

  if (step === 'verilator-build' || step === 'verilator-run') {
    const mingwBin = await joinComponents('Packages', 'msys', 'mingw64', 'bin');
    const usrBin   = await joinComponents('Packages', 'msys', 'usr', 'bin');
    const perlExe  = await electronAPI.joinPath(mingwBin, 'perl.exe');
    const verilatorScript = await electronAPI.joinPath(mingwBin, 'verilator');
    if (step === 'verilator-build') {
      if (!simTopModule) throw new Error('verilator-build needs a testbench or top-level set');
      const objDir = await electronAPI.joinPath(tempBaseDir, `obj_dir_${simTopModule}`);
      return buildVerilatorBuildSpec({
        perlExe, verilatorScript, mingwBin, usrBin, hdlPath,
        simTopModule, objDir, sourceFiles: sources, cwd: tempBaseDir,
      });
    }
    if (!simTopModule) throw new Error(`${step} needs a testbench`);
    const objDir = await electronAPI.joinPath(tempBaseDir, `obj_dir_${simTopModule}`);
    const exePath = await electronAPI.joinPath(objDir, `V${simTopModule}.exe`);
    return buildVerilatorRunSpec({ exePath, cwd: simRunCwd, mingwBin, usrBin });
  }

  if (step === 'fst2vcd') {
    if (!simTopModule) throw new Error('fst2vcd needs a testbench');
    const pass1File = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.vcd`);
    const headerVcd = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.header.vcd`);
    return buildFst2VcdSpec({ fst2vcdBin, inputFile: pass1File, outputFile: headerVcd, cwd: tempBaseDir });
  }

  if (step === 'gtkwave') {
    if (!simTopModule) throw new Error('gtkwave needs a testbench');
    const vcdFile = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.vcd`);
    return buildGtkwaveSpec({ gtkwaveBin, vcdFile, cwd: tempBaseDir });
  }

  if (step === 'yosys-hierarchy' || step === 'prism-yosys') {
    const yosysPath = await joinComponents('Packages', 'msys', 'mingw64', 'bin', 'yosys.exe');
    // Preview uses a placeholder script path, the real path is built
    // by the runtime invoker since the script is freshly emitted per run.
    const scriptPath = await electronAPI.joinPath(tempBaseDir, step === 'prism-yosys' ? 'yosys_script.ys' : 'hierarchy_gen.ys');
    return buildYosysHierarchySpec({ yosysPath, scriptPath, cwd: tempBaseDir });
  }

  throw new Error(`Unknown step: ${step}`);
}
