// @ts-check
/**
 * Stateless helper functions used by multiple IPC modules.
 */

const path = require('path');
const os = require('os');
const { exec } = require('child_process');

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const getCPUCount = () => os.cpus().length;
const getTotalMemory = () => Math.floor(os.totalmem() / (1024 * 1024 * 1024));

function filterGtkWaveOutput(output) {
  const noisePrefixes = [
    'GTKWave Analyzer',
    'FSTLOAD |',
    'GTKWAVE |',
    'WM Destroy',
    '[0] start time',
    '[0] end time',
  ];
  return output
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !noisePrefixes.some((prefix) => trimmed.startsWith(prefix));
    })
    .join('\n');
}

function killProcessSilently(pid, timeout = 5000) {
  return new Promise((resolve) => {
    const killCmd = `taskkill /F /T /PID ${pid}`;
    const killProcess = exec(killCmd, { windowsHide: true, timeout });

    const timer = setTimeout(() => {
      killProcess.kill();
      resolve(false);
    }, timeout);

    killProcess.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 || code === 128);
    });

    killProcess.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function killProcessesByName(processName, timeout = 5000) {
  return new Promise((resolve) => {
    const killCmd = `taskkill /F /IM ${processName} 2>nul`;
    const killProcess = exec(killCmd, { windowsHide: true, timeout });

    const timer = setTimeout(() => {
      killProcess.kill();
      resolve(false);
    }, timeout);

    killProcess.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 || code === 128);
    });

    killProcess.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Kill every process whose executable path starts with `prefix`
 * (case-insensitive). Used to evict orphans launched from inside
 * `components/Temp/` — chiefly Verilator-built simulators like
 * `V<top>_tb.exe`, whose name varies per testbench so a `taskkill /IM`
 * filter can't target them safely. Path-prefix matching keeps the kill
 * scoped to Aurora's own scratch tree and won't touch unrelated
 * binaries that happen to share a name.
 *
 * Implementation note: spawned via PowerShell with `-EncodedCommand` so
 * the prefix (which contains backslashes, spaces, and possibly the
 * user's name) never has to be re-quoted at the shell level.
 *
 * @param {string} prefix - Absolute path prefix; processes whose
 *   ExecutablePath starts with this are killed.
 * @param {number} [timeout=5000]
 * @returns {Promise<boolean>} resolves true on successful PowerShell
 *   exit (still true when no matching process existed).
 */
function killProcessesByPathPrefix(prefix, timeout = 5000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !prefix) {
      resolve(false);
      return;
    }
    // Double single quotes for the PS literal; the rest survives because
    // -EncodedCommand sidesteps cmd.exe parsing entirely.
    const escaped = String(prefix).replace(/'/g, "''");
    const script =
      `$p = '${escaped}'; ` +
      `Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ` +
      `Where-Object { $_.ExecutablePath -and ` +
      `$_.ExecutablePath.StartsWith($p, [StringComparison]::OrdinalIgnoreCase) } | ` +
      `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const cmd = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
    const killProcess = exec(cmd, { windowsHide: true, timeout });

    const timer = setTimeout(() => {
      killProcess.kill();
      resolve(false);
    }, timeout);

    killProcess.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });

    killProcess.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function checkProcessRunning(processName) {
  return new Promise((resolve) => {
    const checkCmd = `tasklist /FI "IMAGENAME eq ${processName}" /NH /FO CSV`;
    exec(checkCmd, { windowsHide: true, timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      const isRunning = stdout.includes(processName) && !stdout.includes('INFO: No tasks');
      resolve(isRunning);
    });
  });
}

/**
 * Defensive path normalization for IPC inputs. Doesn't confine to any
 * specific root (the IDE legitimately reads from project roots, toolchain,
 * app paths, and user-picked imports), but does reject the obvious shapes
 * a malicious renderer would use to smuggle non-paths through:
 *   - non-strings (null, objects, arrays)
 *   - empty strings
 *   - null bytes (Node FS truncates at \0 on some platforms — classic bypass)
 *
 * @param {unknown} p - Untrusted path from an IPC caller.
 * @param {string} [label='path'] - Used in the thrown error message so
 *   callers like `safePath(p, 'src')` produce diagnosable failures.
 * @returns {string} An absolute, normalized path so downstream code never
 *   has to re-normalize.
 * @throws {TypeError} If `p` is not a string.
 * @throws {Error} If `p` is empty or contains a null byte.
 */
function safePath(p, label = 'path') {
  if (typeof p !== 'string') {
    throw new TypeError(`Invalid ${label}: expected string, got ${typeof p}`);
  }
  if (p.length === 0) {
    throw new Error(`Invalid ${label}: empty string`);
  }
  if (p.includes('\0')) {
    throw new Error(`Invalid ${label}: contains null byte`);
  }
  return path.resolve(p);
}

/**
 * Strips characters that would be illegal in a Windows filename plus the
 * low-ASCII control bytes (\x00..\x1f). Replaces them — and any run of
 * whitespace — with a single underscore so the result stays a valid path
 * segment. Used wherever user-supplied identifiers (module names, project
 * names) are spliced into filesystem paths.
 *
 * @param {string} fileName
 * @returns {string}
 */
function sanitizeFileName(fileName) {
  // The control-char range is intentional — it catches bytes that can sneak
  // in via copy-paste from PDFs/shells and which break path-handling code
  // downstream in inconsistent ways.
  // eslint-disable-next-line no-control-regex
  return fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_');
}

/**
 * Local-time timestamp suitable for embedding in a filesystem-safe folder
 * or file name (`YYYY-MM-DD_HH-mm-ss`). Replaces a moment().format() call;
 * format chosen to sort lexicographically.
 *
 * @param {Date} [now=new Date()] - Injected for tests; defaults to now.
 * @returns {string}
 */
function formatTimestamp(now = new Date()) {
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  );
}

function getExecutablePath(executableName, appRoot) {
  if (executableName === 'yosys') {
    return path.join(appRoot, 'components', 'Packages', 'msys', 'mingw64', 'bin', 'yosys.exe');
  }
  if (executableName === 'netlistsvg') {
    return path.join(appRoot, 'components', 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe');
  }
  return executableName;
}

module.exports = {
  debounce,
  getCPUCount,
  getTotalMemory,
  filterGtkWaveOutput,
  killProcessSilently,
  killProcessesByName,
  killProcessesByPathPrefix,
  checkProcessRunning,
  getExecutablePath,
  safePath,
  sanitizeFileName,
  formatTimestamp,
};
