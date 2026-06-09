// @ts-check
/**
 * Locate a Python interpreter suitable for the cocotb flow.
 *
 * Preference order:
 *   1. components/Packages/msys/mingw64/bin/python.exe (unified bundle)
 *   2. AURORA_PYTHON / PYTHON environment variable
 *   3. Active Conda prefix
 *   4. Python discovered on PATH
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { componentsPath } = require('../paths');

const EXPECTED_COCOTB_VERSION = '2.0.1';

let cachedCandidates = null;

function norm(p) {
  return path.normalize(String(p || ''));
}

/**
 * Both cocotb flows (Icarus and Verilator) run on the ONE Python inside
 * the unified mingw bundle (components/Packages/msys/mingw64/bin/python.exe).
 * Its cocotb carries BOTH VPIs (libcocotbvpi_icarus.vpl + the static
 * libcocotbvpi_verilator.a) — built by the nipscernlab/aurora-toolchain
 * repo. The old standalone Packages/python (native MSVC) runtime is gone.
 */
function getBundledPythonPath() {
  return path.join(
    componentsPath, 'Packages', 'msys', 'mingw64', 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python3',
  );
}

function samePath(a, b) {
  return norm(a).toLowerCase() === norm(b).toLowerCase();
}

function addCandidate(out, seen, p) {
  if (!p || typeof p !== 'string') return;
  const n = norm(p.replace(/^"|"$/g, ''));
  if (!n || seen.has(n.toLowerCase())) return;
  if (!fs.existsSync(n)) return;
  seen.add(n.toLowerCase());
  out.push(n);
}

function splitPathList(value) {
  return String(value || '').split(path.delimiter).filter(Boolean);
}

function findOnPathSync() {
  const names = process.platform === 'win32'
    ? ['python.exe', 'python3.exe', 'py.exe']
    : ['python3', 'python'];
  const out = [];
  for (const name of names) {
    try {
      const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
      const result = execFileSync(cmd, [name], { encoding: 'utf8', windowsHide: true });
      for (const line of result.split(/\r?\n/)) {
        if (line.trim()) out.push(line.trim());
      }
    } catch (_e) { /* not found */ }
  }
  return out;
}

function addIfDirectoryPython(out, seen, dir) {
  if (!dir || !fs.existsSync(dir)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!/^Python\d+/i.test(name) && !/^python-\d+/i.test(name)) continue;
    addCandidate(out, seen, path.join(dir, name, process.platform === 'win32' ? 'python.exe' : 'bin/python'));
  }
}

function addCommonWindowsCandidates(out, seen) {
  if (process.platform !== 'win32') return;
  const userProfile = process.env.USERPROFILE
    || (process.env.HOMEDRIVE && process.env.HOMEPATH
      ? path.join(process.env.HOMEDRIVE, process.env.HOMEPATH)
      : '');
  const localAppData = process.env.LOCALAPPDATA
    || (userProfile ? path.join(userProfile, 'AppData', 'Local') : '');

  for (const root of [
    userProfile,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramW6432,
  ]) {
    if (!root) continue;
    addCandidate(out, seen, path.join(root, 'miniconda3', 'python.exe'));
    addCandidate(out, seen, path.join(root, 'anaconda3', 'python.exe'));
    addCandidate(out, seen, path.join(root, 'mambaforge', 'python.exe'));
    addCandidate(out, seen, path.join(root, 'miniforge3', 'python.exe'));
  }

  addIfDirectoryPython(out, seen, path.join(localAppData, 'Programs', 'Python'));
  addCandidate(out, seen, path.join(localAppData, 'Programs', 'Python', 'Launcher', 'py.exe'));
  addCandidate(out, seen, path.join(process.env.SystemRoot || 'C:\\Windows', 'py.exe'));
}

function listPythonCandidatesSync() {
  if (cachedCandidates) return cachedCandidates.slice();
  const out = [];
  const seen = new Set();

  addCandidate(out, seen, getBundledPythonPath());
  addCandidate(out, seen, process.env.AURORA_PYTHON);
  addCandidate(out, seen, process.env.PYTHON);
  if (process.env.CONDA_PREFIX) {
    addCandidate(out, seen, path.join(process.env.CONDA_PREFIX, process.platform === 'win32' ? 'python.exe' : 'bin/python'));
  }
  addCommonWindowsCandidates(out, seen);
  for (const dir of splitPathList(process.env.PATH)) {
    addCandidate(out, seen, path.join(dir, process.platform === 'win32' ? 'python.exe' : 'python3'));
    addCandidate(out, seen, path.join(dir, process.platform === 'win32' ? 'python3.exe' : 'python'));
  }
  for (const p of findOnPathSync()) addCandidate(out, seen, p);

  cachedCandidates = out;
  return out.slice();
}

function runPythonProbe(pythonPath) {
  const code = [
    'import importlib.util, json, sys',
    'try:',
    '    import importlib.metadata as md',
    'except Exception:',
    '    md = None',
    'spec = importlib.util.find_spec("cocotb")',
    'version = None',
    'if spec is not None and md is not None:',
    '    try:',
    '        version = md.version("cocotb")',
    '    except Exception:',
    '        version = None',
    'print(json.dumps({"executable": sys.executable, "version": sys.version.split()[0], "hasCocotb": spec is not None, "cocotbVersion": version}))',
  ].join('\n');

  return new Promise((resolve) => {
    execFile(pythonPath, ['-c', code], { windowsHide: true, timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          pythonPath,
          error: stderr || error.message || String(error),
        });
        return;
      }
      try {
        const parsed = JSON.parse(String(stdout || '').trim());
        resolve({ ok: true, pythonPath, executable: parsed.executable || pythonPath, ...parsed });
      } catch (parseError) {
        resolve({ ok: false, pythonPath, error: parseError.message || String(parseError) });
      }
    });
  });
}

function enrichStatus(status, candidates) {
  const bundledPath = getBundledPythonPath();
  const isBundled = samePath(status.pythonPath, bundledPath) || samePath(status.executable, bundledPath);
  return {
    ...status,
    candidates,
    isBundled,
    expectedCocotbVersion: EXPECTED_COCOTB_VERSION,
    isPinnedCocotb: status.cocotbVersion === EXPECTED_COCOTB_VERSION,
  };
}

async function getPythonStatus() {
  const candidates = listPythonCandidatesSync();
  const bundledCandidate = candidates.find((candidate) => samePath(candidate, getBundledPythonPath()));
  if (bundledCandidate) {
    return enrichStatus(await runPythonProbe(bundledCandidate), candidates);
  }

  let firstWorking = null;
  for (const candidate of candidates) {
    const status = await runPythonProbe(candidate);
    if (status.ok) {
      const enriched = enrichStatus(status, candidates);
      if (status.hasCocotb) return enriched;
      if (!firstWorking) firstWorking = enriched;
    }
  }
  if (firstWorking) return firstWorking;
  return {
    ok: false,
    pythonPath: '',
    candidates,
    isBundled: false,
    expectedCocotbVersion: EXPECTED_COCOTB_VERSION,
    isPinnedCocotb: false,
    error: candidates.length
      ? 'No discovered Python interpreter could execute a probe script.'
      : 'No Python interpreter was found on PATH or in components/Packages/msys.',
  };
}

function isBundledPythonPath(binaryPath) {
  return samePath(binaryPath, getBundledPythonPath());
}

function isKnownPythonPath(binaryPath) {
  if (!binaryPath) return false;
  const target = norm(binaryPath).toLowerCase();
  return listPythonCandidatesSync().some((p) => norm(p).toLowerCase() === target);
}

module.exports = {
  EXPECTED_COCOTB_VERSION,
  getBundledPythonPath,
  getPythonStatus,
  isBundledPythonPath,
  isKnownPythonPath,
  listPythonCandidatesSync,
};
