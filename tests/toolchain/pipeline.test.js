// tests/toolchain/pipeline.test.js
//
// Integration test for the SAPHO compile + simulate pipeline, against the REAL
// toolchain binaries. This is the only test in the repo that proves the
// product's core promise end to end: a C± source becomes a synthesisable
// Verilog processor, and that processor actually simulates.
//
// Why it exists
// -------------
// Before this file, the automated suites covered the shell (editor, tabs,
// terminal, split panes) and the pure helpers, but nothing of the compiler
// pipeline — not even the argument builders. For a course on programmable
// logic devices the pipeline IS the product, so a broken flag or a toolchain
// bump could ship without a single test going red.
//
// What makes it trustworthy
// -------------------------
// The commands are NOT hardcoded here. Each step is assembled with the SAME
// builder the application calls (`buildCmmSpec`, `buildAsmPreSpec`,
// `buildAsmSpec`, `buildIverilogBuildSpec`, `buildVvpRunSpec`), so if someone
// reorders an argument or renames a flag, this test executes the changed
// command and fails. A test that re-declared the command lines would happily
// keep passing while the app broke.
//
// Where it runs
// -------------
// NOT part of `npm test`: it needs `components/` populated by `npm run
// bootstrap` (~1 GB), which CI deliberately skips for unit tests. Run it with
// `npm run test:toolchain`, and in the release workflow, where the toolchain
// is bootstrapped anyway. If the binaries are absent the suite skips with a
// message instead of failing, so a fresh clone is not punished for it.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildCmmSpec } from '../../js/compilation/builders/cmm.js';
import { buildAsmPreSpec, buildAsmSpec } from '../../js/compilation/builders/asm.js';
import { buildIverilogBuildSpec } from '../../js/compilation/builders/iverilog.js';
import { buildVvpRunSpec } from '../../js/compilation/builders/vvp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const COMPONENTS = path.join(REPO, 'components');
const MINGW_BIN = path.join(COMPONENTS, 'Packages', 'msys', 'mingw64', 'bin');

const PROC = 'mediamovel';

/** Everything this test shells out to. Missing any of them means "skip". */
const REQUIRED_BINARIES = {
  cmmcomp: path.join(COMPONENTS, 'bin', 'cmmcomp.exe'),
  appcomp: path.join(COMPONENTS, 'bin', 'appcomp.exe'),
  asmcomp: path.join(COMPONENTS, 'bin', 'asmcomp.exe'),
  iverilog: path.join(MINGW_BIN, 'iverilog.exe'),
  vvp: path.join(MINGW_BIN, 'vvp.exe'),
};

const missing = Object.entries(REQUIRED_BINARIES)
  .filter(([, p]) => !fs.existsSync(p))
  .map(([name]) => name);

const toolchainReady = missing.length === 0;

/**
 * Run a CommandSpec the way main/compile/executor.js does: the binary, its
 * argv array, a cwd, and the MinGW bin dir prepended to PATH when the spec
 * asks for it (iverilog dlopens its target modules from there).
 *
 * Returns stdout+stderr so assertions can read compiler diagnostics.
 */
function runSpec(spec) {
  const env = { ...process.env };
  // `prependPath` is a string[] (see prependBinDir in builders/iverilog.ts),
  // folded onto PATH the same way main/compile/executor.js does it.
  if (Array.isArray(spec.prependPath) && spec.prependPath.length) {
    env.PATH = `${spec.prependPath.join(path.delimiter)}${path.delimiter}${env.PATH}`;
  }
  return execFileSync(spec.binary, spec.args, {
    cwd: spec.cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  });
}

describe.skipIf(!toolchainReady)('SAPHO toolchain — C± to a simulated processor', () => {
  /** Throwaway project root; the pipeline writes into it. */
  let workdir;
  /** <workdir>/<PROC> — what the compilers receive as -p. */
  let projectPath;
  let softwarePath;
  let hardwarePath;
  /** components/Temp/<PROC> — the compilers' scratch dir. */
  let tempPath;
  let asmPath;

  beforeAll(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-toolchain-'));
    projectPath = path.join(workdir, PROC);
    softwarePath = path.join(projectPath, 'Software');
    hardwarePath = path.join(projectPath, 'Hardware');
    fs.mkdirSync(softwarePath, { recursive: true });
    fs.mkdirSync(hardwarePath, { recursive: true });

    // Scratch dir for the compilers. The app points this at
    // components/Temp/<proc>, but the path is a plain `-t` argument, not part
    // of any contract, so the test keeps it inside its own throwaway workdir.
    //
    // Two reasons. It does not clobber a developer's components/Temp, which
    // may hold artefacts they are mid-debug on. And deleting a shared
    // directory on Windows fails with EBUSY whenever anything still holds a
    // handle on it (an open shell, an editor, the app itself) — a flake that
    // would surface in CI as an unexplained failure of the whole suite.
    tempPath = path.join(workdir, 'Temp', PROC);
    fs.mkdirSync(tempPath, { recursive: true });

    fs.copyFileSync(
      path.join(HERE, 'fixtures', `${PROC}.cmm`),
      path.join(softwarePath, `${PROC}.cmm`),
    );
    asmPath = path.join(softwarePath, `${PROC}.asm`);
  });

  it('reports which binaries are missing rather than failing obscurely', () => {
    // Reached only when the toolchain IS ready, so this documents the
    // contract; the skip message below covers the other case.
    expect(missing).toEqual([]);
  });

  it('step 1 — cmmcomp turns the C± source into assembly', () => {
    const spec = buildCmmSpec({
      cmmCompPath: REQUIRED_BINARIES.cmmcomp,
      inputFile: `${PROC}.cmm`,
      baseName: PROC,
      projectPath,
      macrosPath: path.join(COMPONENTS, 'Macros'),
      tempPath,
      processorName: PROC,
      lang: 'pt',
      showArrays: false,
    });

    const out = runSpec(spec);

    expect(fs.existsSync(asmPath)).toBe(true);
    expect(fs.readFileSync(asmPath, 'utf8').trim().length).toBeGreaterThan(0);
    // The compiler announces how many instructions it emitted. Zero would mean
    // it "succeeded" on an empty program, which is the failure this catches.
    expect(out).toMatch(/instru/i);

    // cmm_log.txt is what the terminal's clickable "line N" links resolve
    // against, and what the wave translators read later.
    expect(fs.existsSync(path.join(tempPath, 'cmm_log.txt'))).toBe(true);
  });

  it('step 2 — appcomp expands macros and sizes the memories', () => {
    const spec = buildAsmPreSpec({
      appCompPath: REQUIRED_BINARIES.appcomp,
      asmFile: asmPath,
      tempPath,
      processorName: PROC,
      lang: 'pt',
    });

    const out = runSpec(spec);
    expect(out).toMatch(/instru/i);
    expect(fs.existsSync(path.join(tempPath, 'app_log.txt'))).toBe(true);
  });

  it('step 3 — asmcomp emits the Verilog processor, its memories and a testbench', () => {
    const spec = buildAsmSpec({
      asmCompPath: REQUIRED_BINARIES.asmcomp,
      asmFile: asmPath,
      projectPath,
      hdlPath: path.join(COMPONENTS, 'HDL'),
      macrosPath: path.join(COMPONENTS, 'Macros'),
      tempPath,
      // MHz, not Hz — `clk` in the .spf is megahertz (processor_config_panel
      // defaults to 100). Passing Hz here produces a testbench whose clock
      // half-period underflows the 1ps timescale to zero, and iverilog then
      // rejects it with "always process does not have any delay".
      freq: 100,
      clocks: 2000,
      processorName: PROC,
      lang: 'pt',
    });

    runSpec(spec);

    const verilog = path.join(hardwarePath, `${PROC}.v`);
    expect(fs.existsSync(verilog)).toBe(true);
    expect(fs.readFileSync(verilog, 'utf8')).toMatch(new RegExp(`module\\s+${PROC}`));

    // Instruction and data memories, loaded by the generated Verilog.
    expect(fs.existsSync(path.join(hardwarePath, `${PROC}_inst.mif`))).toBe(true);
    expect(fs.existsSync(path.join(hardwarePath, `${PROC}_data.mif`))).toBe(true);

    // Translation tables — GTKWave and Surfer decode Assembly/C± tracks with
    // these, so their absence silently degrades the wave view.
    expect(fs.existsSync(path.join(tempPath, 'trad_opcode.txt'))).toBe(true);
    expect(fs.existsSync(path.join(tempPath, 'trad_cmm.txt'))).toBe(true);

    // The auto-generated testbench, and the clock that broke when freq was
    // passed in the wrong unit. Guard the unit, not just the file's existence.
    const tb = fs.readFileSync(path.join(tempPath, `${PROC}_tb.v`), 'utf8');
    const halfPeriod = Number(/always\s+#([\d.]+)\s+clk/.exec(tb)?.[1]);
    expect(Number.isFinite(halfPeriod)).toBe(true);
    // timescale is 1ns/1ps, so anything below 0.001 rounds to a zero delay.
    expect(halfPeriod).toBeGreaterThanOrEqual(0.001);
    expect(halfPeriod).toBeCloseTo(5, 3); // 100 MHz -> 5 ns half period
  });

  it('step 4 — iverilog elaborates the processor with its testbench', () => {
    // Production copies the processor next to the generated testbench before
    // building; mirror that rather than inventing an include path.
    fs.copyFileSync(
      path.join(hardwarePath, `${PROC}.v`),
      path.join(tempPath, `${PROC}.v`),
    );

    const spec = buildIverilogBuildSpec({
      iveriCompPath: REQUIRED_BINARIES.iverilog,
      hdlPath: path.join(COMPONENTS, 'HDL'),
      simTopModule: `${PROC}_tb`,
      outputFile: `${PROC}_tb.vvp`,
      sourceFiles: [`${PROC}_tb.v`, `${PROC}.v`],
      cwd: tempPath,
    });

    runSpec(spec);
    expect(fs.existsSync(path.join(tempPath, `${PROC}_tb.vvp`))).toBe(true);
  });

  it('step 5 — vvp runs the simulation and produces a usable dump', () => {
    const spec = buildVvpRunSpec({
      vvpBin: REQUIRED_BINARIES.vvp,
      vvpFile: `${PROC}_tb.vvp`,
      cwd: tempPath,
    });

    // The builder passes `-fst`, which switches Icarus's dumper to the FST
    // container. THE FILE NAME STILL COMES FROM $dumpfile, and asmcomp writes
    // `$dumpfile("<top>.vcd")` into the generated testbench — so the artefact
    // is FST content inside a file named `.vcd`. The extension lies.
    //
    // That is not a bug to fix here; it is why `_extractFstHeaderVcd`
    // (ARCHITECTURE.md §9) magic-detects the format instead of trusting the
    // extension. This test pins the behaviour so a future change to either
    // side is caught rather than silently breaking the wave flow.
    expect(spec.args).toContain('-fst');

    const out = runSpec(spec);

    // $finish proves the testbench ran to completion instead of stalling.
    expect(out).toMatch(/\$finish/);

    const dump = path.join(tempPath, `${PROC}_tb.vcd`);
    expect(fs.existsSync(dump)).toBe(true);

    // FST magic: the container starts with a zero block type, which a text VCD
    // (which would begin with "$date") never does.
    const head = fs.readFileSync(dump).subarray(0, 8);
    expect(head[0]).toBe(0x00);
    expect(head.toString('utf8')).not.toMatch(/^\$date/);
  });

  it('step 6 — fst2vcd reconstructs a VCD with the real signal hierarchy', () => {
    // The step the wave flow performs before GTKWave opens. Running it here
    // proves the dump is not merely non-empty but actually decodable, and that
    // the signals the testbench asked for made it in. A dump that parses to a
    // header with no variables is the shape a silently-broken $dumpvars
    // produces, and it survives every cheaper check.
    const fst2vcd = path.join(COMPONENTS, 'Packages', 'gtkwave-nipscern', 'fst2vcd.exe');
    if (!fs.existsSync(fst2vcd)) return; // gtkwave fork not bootstrapped

    const vcd = execFileSync(fst2vcd, [path.join(tempPath, `${PROC}_tb.vcd`)], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });

    expect(vcd).toMatch(/\$enddefinitions/);
    // The processor instance must be in the hierarchy, not just the testbench.
    expect(vcd).toMatch(/\$scope\s+module\s+proc\s+\$end/);
    // And the clock, which every wave view keys off.
    expect(vcd).toMatch(/\$var\s+reg\s+1\s+\S+\s+clk\s+\$end/);

    // Value changes after the header — the point of the whole exercise.
    const body = vcd.slice(vcd.indexOf('$enddefinitions'));
    expect(body.split('\n').length).toBeGreaterThan(100);
  });
});

if (!toolchainReady) {
  describe('SAPHO toolchain', () => {
    it.skip(
      `skipped — missing ${missing.join(', ')}. Run "npm run bootstrap" to fetch the toolchain.`,
      () => {},
    );
  });
}
