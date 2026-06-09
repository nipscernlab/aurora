// @ts-check
/**
 * binary_allowlist.js — the closed set of executables Aurora's
 * structured-spec executor will spawn.
 *
 * Why: the new `exec-spec` IPC lets the renderer (and through it,
 * Aurora Intelligence) pick {binary, args[]} for a toolchain step. The
 * AI's surface for editing command lines deliberately does NOT expose
 * a way to swap the binary — but a buggy or compromised renderer
 * could still send anything. This allowlist is the trust boundary:
 * any spec whose `binary` is not in the table is rejected with a clear
 * error, regardless of what the args say.
 *
 * The table is keyed by the BASENAME of the binary; each entry lists
 * the legal directories the binary must come from (resolved relative
 * to components/<componentsPath>). A spec's `binary` must therefore
 * end with one of the listed names AND live in one of the listed
 * directories under componentsPath.
 *
 * Adding a new toolchain binary: add it here. That's the whole gate.
 */

'use strict';

const path = require('path');
const { componentsPath } = require('../paths');
const {
  getBundledPythonPath,
  isBundledPythonPath,
} = require('./python_locator');

/**
 * Each entry: [basename, [allowed-subdirs-under-components]].
 * Subdir uses forward slashes; we normalize before comparing.
 */
const RAW_ALLOWLIST = [
  ['cmmcomp.exe',   ['bin']],
  ['appcomp.exe',   ['bin']],
  ['asmcomp.exe',   ['bin']],

  // Unified mingw bundle: iverilog, vvp, verilator, perl, g++, make, yosys
  // (+ python, handled by the python branch in isAllowed) all live in
  // Packages/msys/mingw64/bin.
  ['iverilog.exe',  ['Packages/msys/mingw64/bin']],
  ['vvp.exe',       ['Packages/msys/mingw64/bin']],
  ['verilator',     ['Packages/msys/mingw64/bin']],
  ['verilator.exe', ['Packages/msys/mingw64/bin']],
  ['perl.exe',      ['Packages/msys/mingw64/bin']],
  ['g++.exe',       ['Packages/msys/mingw64/bin']],
  ['make.exe',      ['Packages/msys/mingw64/bin']],
  ['yosys.exe',     ['Packages/msys/mingw64/bin']],

  // fst2vcd (and the display GTKWave) ship in the gtkwave-nipscern fork.
  ['gtkwave.exe',   ['Packages/gtkwave-nipscern']],
  ['fst2vcd.exe',   ['Packages/gtkwave-nipscern']],
  // (netlistsvg is no longer a bundled .exe — it runs in-process from
  //  @silimate/netlistsvg, so it needs no allowlist entry.)
];

/**
 * Verilator generates per-design native executables under
 * <componentsPath>/Temp/obj_dir_<simTop>/V<simTop>.exe. These aren't
 * shipped with Aurora, but the wave-flow's pass-1/pass-2 spawns them
 * directly. They're allowed only when they live under components/Temp.
 *
 * We special-case via prefix match in `isAllowed` below.
 */
const VERILATOR_GENERATED_PREFIX = path.posix.join(toPosix(componentsPath), 'Temp/');

function toPosix(p) {
  return String(p || '').replace(/\\/g, '/');
}

/**
 * @param {string} binaryPath  absolute path to the candidate binary
 * @returns {{ok:true} | {ok:false, error:string}}
 */
function isAllowed(binaryPath) {
  if (typeof binaryPath !== 'string' || !binaryPath) {
    return { ok: false, error: 'binary path must be a non-empty string' };
  }
  if (!path.isAbsolute(binaryPath)) {
    return { ok: false, error: `binary path must be absolute: ${binaryPath}` };
  }

  const normalized = toPosix(path.normalize(binaryPath));
  const baseName = path.basename(normalized);
  const dir = path.posix.dirname(normalized);

  if (/^python(3)?(\.exe)?$/i.test(baseName) || /^py(\.exe)?$/i.test(baseName)) {
    // The single bundled Python (components/Packages/msys) serves both cocotb
    // flows (Icarus + Verilator).
    if (isBundledPythonPath(binaryPath)) return { ok: true };
    return {
      ok: false,
      error: `python interpreter must be Aurora's bundled runtime: ${binaryPath}`,
    };
  }

  // Verilator-generated V<top>.exe under components/Temp/obj_dir_*/.
  if (
    normalized.startsWith(VERILATOR_GENERATED_PREFIX) &&
    /\/obj_dir[^/]*\/V[^/]+(\.exe)?$/.test(normalized)
  ) {
    return { ok: true };
  }

  // Static allowlist.
  for (const [allowedName, allowedDirs] of RAW_ALLOWLIST) {
    if (baseName.toLowerCase() !== allowedName.toLowerCase()) continue;
    for (const sub of allowedDirs) {
      const expected = path.posix.join(toPosix(componentsPath), sub);
      // Case-insensitive on Windows — paths from electronAPI.joinPath
      // can vary in drive-letter casing depending on how the user
      // launched the app.
      if (dir.toLowerCase() === expected.toLowerCase()) {
        return { ok: true };
      }
    }
    return {
      ok: false,
      error: `binary ${baseName} not in allowed directories (${allowedDirs.join(', ')}): ${binaryPath}`,
    };
  }

  return {
    ok: false,
    error: `binary not on toolchain allowlist: ${baseName} (${binaryPath})`,
  };
}

/** Read-only snapshot for diagnostics + AI listing tool. */
function listAllowedBinaries() {
  const staticRows = RAW_ALLOWLIST.map(([name, dirs]) => ({
    binary: name,
    allowedDirs: dirs.map((d) => path.posix.join(toPosix(componentsPath), d)),
  }));
  const bundledPython = getBundledPythonPath();
  const pythonRows = [{
    binary: path.basename(bundledPython),
    allowedDirs: [path.dirname(bundledPython)],
  }];
  return staticRows.concat(pythonRows);
}

module.exports = { isAllowed, listAllowedBinaries };
