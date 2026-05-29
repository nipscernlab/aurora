// @ts-check
/**
 * Aurora IDE - bundled Python + cocotb bootstrap
 *
 * Downloads the official CPython NuGet package and installs it into
 * components/Packages/python. cocotb is then installed into that same
 * private runtime, so cocotb simulations do not depend on a global Python
 * installation on the user's machine.
 *
 * Usage: node components/Scripts/download-python.js [--force]
 *   --force   re-download Python even if the pinned runtime is present
 */

'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PYTHON_VERSION = '3.13.13';
const COCOTB_VERSION = '2.0.1';
const COCOTB_SPEC = `cocotb==${COCOTB_VERSION}`;
const PYTHON_NUGET_ID = 'python';
const PYTHON_NUGET_FILENAME = `${PYTHON_NUGET_ID}.${PYTHON_VERSION}.nupkg`;
const PYTHON_NUGET_URL = `https://www.nuget.org/api/v2/package/${PYTHON_NUGET_ID}/${PYTHON_VERSION}`;

const ROOT_DIR = path.join(__dirname, '..', '..');
const PACKAGES_DIR = path.join(ROOT_DIR, 'components', 'Packages');
const PYTHON_DIR = path.join(PACKAGES_DIR, 'python');
const PYTHON_EXE = path.join(PYTHON_DIR, 'python.exe');
const MANIFEST_FILE = path.join(PYTHON_DIR, '.aurora-python.json');
const PACKAGED_7ZIP = path.join(PACKAGES_DIR, '7-Zip', '7z.exe');

function log(msg) { console.log(`[python] ${msg}`); }
function err(msg) { console.error(`[python] ERROR: ${msg}`); }

function cleanEnv(extra = {}) {
  const env = {
    ...process.env,
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_INPUT: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONUTF8: '1',
    ...extra,
  };
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  delete env.VIRTUAL_ENV;
  delete env.CONDA_PREFIX;
  return env;
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify path outside ${parent}: ${child}`);
  }
}

function ensureWindowsX64() {
  if (process.platform !== 'win32') {
    throw new Error('Bundled Python bootstrap currently supports Windows only.');
  }
  if (process.arch !== 'x64') {
    throw new Error(`Bundled Python package is x64; current architecture is ${process.arch}.`);
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    log(`Downloading ${url}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const file = fs.createWriteStream(dest);
    let total = 0;
    let received = 0;

    function fail(error) {
      file.destroy();
      reject(error);
    }

    function doRequest(requestUrl, redirectCount = 0) {
      if (redirectCount > 5) {
        fail(new Error('Too many redirects'));
        return;
      }

      const parsedUrl = new URL(requestUrl);
      const opts = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: { 'User-Agent': 'aurora-ide-python-bootstrap' },
      };

      https.get(opts, (res) => {
        const redirect = [301, 302, 307, 308].includes(res.statusCode || 0);
        if (redirect && res.headers.location) {
          const nextUrl = new URL(res.headers.location, requestUrl).toString();
          doRequest(nextUrl, redirectCount + 1);
          res.resume();
          return;
        }
        if (res.statusCode !== 200) {
          fail(new Error(`HTTP ${res.statusCode} from ${requestUrl}`));
          res.resume();
          return;
        }

        total = parseInt(res.headers['content-length'] || '0', 10);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.round((received / total) * 100);
            process.stdout.write(`\r[python] ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
          }
        });
        res.pipe(file);
        res.on('end', () => process.stdout.write('\n'));
        res.on('error', fail);
      }).on('error', fail);
    }

    file.on('finish', () => file.close(resolve));
    file.on('error', reject);
    doRequest(url);
  });
}

function extractArchive(archivePath, destDir) {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  log(`Extracting ${path.basename(archivePath)} -> ${destDir}`);
  fs.mkdirSync(destDir, { recursive: true });

  if (fs.existsSync(PACKAGED_7ZIP)) {
    execFileSync(PACKAGED_7ZIP, ['x', archivePath, `-o${destDir}`, '-y'], { stdio: 'inherit' });
    return;
  }

  const command = [
    "$ErrorActionPreference='Stop'",
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(destDir)} -Force`,
  ].join('; ');
  execFileSync('powershell', ['-NoProfile', '-Command', command], { stdio: 'inherit' });
}

function getRuntimeStatus(pythonExe = PYTHON_EXE) {
  if (!fs.existsSync(pythonExe)) {
    return { ok: false, pythonPath: pythonExe, error: 'python.exe not found' };
  }

  const code = [
    'import importlib.util, json, sys',
    'try:',
    '    import importlib.metadata as md',
    'except Exception:',
    '    md = None',
    'spec = importlib.util.find_spec("cocotb")',
    'cocotb_version = None',
    'if spec is not None and md is not None:',
    '    try:',
    '        cocotb_version = md.version("cocotb")',
    '    except Exception:',
    '        cocotb_version = None',
    'print(json.dumps({"pythonPath": sys.executable, "pythonVersion": sys.version.split()[0], "hasCocotb": spec is not None, "cocotbVersion": cocotb_version}))',
  ].join('\n');

  try {
    const stdout = execFileSync(pythonExe, ['-c', code], {
      encoding: 'utf8',
      env: cleanEnv(),
      windowsHide: true,
    });
    return { ok: true, ...JSON.parse(String(stdout || '').trim()) };
  } catch (error) {
    return {
      ok: false,
      pythonPath: pythonExe,
      error: error.message || String(error),
    };
  }
}

function isPinnedAndReady(status) {
  return !!(
    status &&
    status.ok &&
    status.pythonVersion === PYTHON_VERSION &&
    status.hasCocotb &&
    status.cocotbVersion === COCOTB_VERSION
  );
}

function alreadyInstalled(pythonExe = PYTHON_EXE) {
  return isPinnedAndReady(getRuntimeStatus(pythonExe));
}

function replacePythonRuntime(sourceToolsDir) {
  const sentinel = path.join(sourceToolsDir, 'python.exe');
  if (!fs.existsSync(sentinel)) {
    throw new Error(`NuGet package layout does not contain tools/python.exe: ${sourceToolsDir}`);
  }

  assertInside(PACKAGES_DIR, PYTHON_DIR);
  fs.mkdirSync(PACKAGES_DIR, { recursive: true });
  fs.rmSync(PYTHON_DIR, { recursive: true, force: true });
  fs.cpSync(sourceToolsDir, PYTHON_DIR, { recursive: true });
}

function installCocotb() {
  log(`Installing ${COCOTB_SPEC} into bundled Python`);
  execFileSync(PYTHON_EXE, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-warn-script-location',
    '--only-binary',
    ':all:',
    '--upgrade',
    COCOTB_SPEC,
  ], {
    stdio: 'inherit',
    env: cleanEnv(),
    windowsHide: true,
  });
}

function writeManifest(status) {
  const manifest = {
    pythonNuGetId: PYTHON_NUGET_ID,
    pythonNuGetUrl: PYTHON_NUGET_URL,
    pythonVersion: status.pythonVersion,
    cocotbVersion: status.cocotbVersion,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function installPythonRuntime(force) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-python-'));
  const archivePath = path.join(tempRoot, PYTHON_NUGET_FILENAME);
  const extractDir = path.join(tempRoot, 'extract');

  try {
    await downloadFile(PYTHON_NUGET_URL, archivePath);
    extractArchive(archivePath, extractDir);
    replacePythonRuntime(path.join(extractDir, 'tools'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (force) {
    log('Pinned Python runtime refreshed.');
  } else {
    log('Pinned Python runtime installed.');
  }
}

async function main() {
  const force = process.argv.includes('--force');

  try {
    ensureWindowsX64();

    let status = getRuntimeStatus();
    if (isPinnedAndReady(status) && !force) {
      log(`Bundled Python ${PYTHON_VERSION} with cocotb ${COCOTB_VERSION} already present.`);
      log('(Run with --force to re-download.)');
      return;
    }

    const needsRuntime = (
      force ||
      !status.ok ||
      status.pythonVersion !== PYTHON_VERSION
    );

    if (needsRuntime) {
      if (!status.ok) {
        log('Bundled Python runtime not found in components/Packages/python.');
      } else {
        log(`Bundled Python ${status.pythonVersion} differs from pinned ${PYTHON_VERSION}.`);
      }
      await installPythonRuntime(force);
      status = getRuntimeStatus();
    }

    if (!status.ok) {
      throw new Error(status.error || 'Bundled Python could not execute probe script.');
    }

    if (!status.hasCocotb || status.cocotbVersion !== COCOTB_VERSION) {
      installCocotb();
      status = getRuntimeStatus();
    }

    if (!isPinnedAndReady(status)) {
      throw new Error(`Bundled Python probe failed after install: ${JSON.stringify(status)}`);
    }

    writeManifest(status);
    log(`Ready: Python ${status.pythonVersion}, cocotb ${status.cocotbVersion}.`);
  } catch (error) {
    err(error.message || String(error));
    err('Aurora will still start, but cocotb mode needs the bundled runtime.');
    err(`Try again with: node components/Scripts/download-python.js --force`);
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  alreadyInstalled,
  cleanEnv,
  downloadFile,
  extractArchive,
  getRuntimeStatus,
  isPinnedAndReady,
  PYTHON_VERSION,
  COCOTB_VERSION,
  COCOTB_SPEC,
  PYTHON_NUGET_URL,
  PYTHON_NUGET_FILENAME,
  PYTHON_EXE,
  PYTHON_DIR,
};
