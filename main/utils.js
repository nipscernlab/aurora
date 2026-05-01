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

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.v': 'text/x-verilog',
    '.gtkw': 'application/x-gtkwave',
    '.txt': 'text/plain',
    '.sv': 'text/x-systemverilog',
    '.vh': 'text/x-verilog-header',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

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

function getExecutablePath(executableName, appRoot) {
  if (executableName === 'yosys') {
    return path.join(appRoot, 'components', 'Packages', 'PRISM', 'yosys', 'yosys.exe');
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
  getMimeType,
  filterGtkWaveOutput,
  killProcessSilently,
  killProcessesByName,
  checkProcessRunning,
  getExecutablePath,
};
