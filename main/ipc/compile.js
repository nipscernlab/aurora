// TODO(types): opt this file into `// @ts-check` once exec-command is
// migrated to a typed [bin, args[]] IPC contract. Today the renderer
// composes raw shell strings, which tangles up the ChildProcess typings
// (shell:true/encoding narrowing) into errors that aren't worth solving
// with casts when the actual fix is the IPC redesign.
/**
 * Compilation + simulation execution: exec-command, launch-gtkwave-only,
 * cancel-vvp-process. All process management ends up here so cancellation
 * has a single source of truth. (The structured-spec executor in
 * main/compile/executor.js is the modern path; vvp now runs through it.)
 */

const { ipcMain } = require('electron');
const { exec, execFile, spawn } = require('child_process');
const log = require('electron-log');

const state = require('../state');
const {
  getCPUCount,
  killProcessSilently,
  killProcessesByName,
  checkProcessRunning,
} = require('../utils');

function register() {
  ipcMain.handle('exec-command', (_event, command, options = {}) => {
    return new Promise((resolve, reject) => {
      const performanceOptions = {
        maxBuffer: 1024 * 1024 * 50,
        windowsHide: true,
        env: {
          ...process.env,
          OMP_NUM_THREADS: getCPUCount().toString(),
          OMP_THREAD_LIMIT: getCPUCount().toString(),
          ...options.env,
        },
      };

      const child = exec(command, performanceOptions);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => (stdout += data.toString()));
      child.stderr.on('data', (data) => (stderr += data.toString()));
      child.on('close', (code) => resolve({ code, stdout, stderr, pid: child.pid }));
      child.on('error', (err) => reject(err));
    });
  });

  ipcMain.handle('check-process-running', async (_event, pid) => {
    // Coerce to integer: pid comes from the renderer; if it's not a clean
    // number we shouldn't shell anything out for it.
    const pidInt = Number.parseInt(pid, 10);
    if (!Number.isFinite(pidInt)) return false;
    return new Promise((resolve) => {
      execFile('tasklist', ['/FI', `PID eq ${pidInt}`], (error, stdout) => {
        if (error) resolve(false);
        else resolve(stdout.includes(String(pidInt)));
      });
    });
  });

  ipcMain.handle('launch-gtkwave-only', async (_event, options) => {
    const { gtkwaveBin, args, workingDir } = options;

    return new Promise((resolve) => {
      try {
        if (!gtkwaveBin || !Array.isArray(args)) {
          resolve({ success: false, message: 'launch-gtkwave-only requires { gtkwaveBin, args[] }' });
          return;
        }

        // GTKWave is launched detached and outlives the run; nothing in the
        // renderer consumes its stdout/stderr, so ignore them outright — an
        // unread pipe buffer could otherwise eventually block the process.
        //
        // windowsHide: false — quirk do gtkwave-nipscern (v0.1.1, GUI-subsystem):
        // se spawnado com CREATE_NO_WINDOW (== windowsHide:true) E recebe um VCD
        // pra carregar, o processo sobe mas a janela top-level nao e criada
        // (parser do VCD parece precisar de console handle). Sem VCD ou sem
        // CREATE_NO_WINDOW, abre normal. Como o exe e GUI-subsystem, nao ha
        // flash de console — windowsHide:false aqui e cosmeticamente equivalente
        // a true, mas evita esse quirk.
        const gtkwaveProcess = spawn(gtkwaveBin, args, {
          cwd: workingDir,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
          shell: false,
        });

        // An 'error' EventEmitter with no listener would throw; keep one so a
        // spawn failure (e.g. ENOENT) is reported instead of crashing main.
        gtkwaveProcess.on('error', (error) => {
          resolve({ success: false, message: `GTKWave error: ${error.message}` });
        });

        const gtkwavePid = gtkwaveProcess.pid;
        gtkwaveProcess.unref();
        resolve({ success: true, gtkwavePid, message: 'GTKWave launched successfully' });
      } catch (error) {
        resolve({ success: false, message: `Failed to launch GTKWave: ${error.message}` });
      }
    });
  });

  ipcMain.handle('cancel-vvp-process', async () => {
    try {
      const results = [];
      let hasActiveProcesses = false;

      if (state.currentVvpProcess && !state.currentVvpProcess.killed) {
        hasActiveProcesses = true;
        try {
          const killed = await killProcessSilently(state.currentVvpProcess.pid);
          if (killed) results.push('VVP process terminated');
        } catch (error) {
          log.error('Error killing specific VVP process:', error);
        } finally {
          state.currentVvpProcess = null;
          state.vvpProcessPid = null;
        }
      }

      const [vvpRunning, gtkwaveRunning] = await Promise.all([
        checkProcessRunning('vvp.exe'),
        checkProcessRunning('gtkwave.exe'),
      ]);

      if (vvpRunning || gtkwaveRunning) hasActiveProcesses = true;

      const killPromises = [];
      if (vvpRunning) {
        killPromises.push(
          killProcessesByName('vvp.exe').then((killed) => {
            if (killed) results.push('All VVP processes terminated');
          }),
        );
      }
      if (gtkwaveRunning) {
        killPromises.push(
          killProcessesByName('gtkwave.exe').then((killed) => {
            if (killed) results.push('GTKWave processes terminated');
          }),
        );
      }

      await Promise.all(killPromises);
      state.currentGtkwaveProcesses.clear();

      if (!hasActiveProcesses) {
        return { success: false, message: 'No compilation process is currently running.' };
      }

      return {
        success: results.length > 0,
        message:
          results.length > 0 ? `Compilation canceled: ${results.join(', ')}` : 'Process cancellation initiated',
      };
    } catch (error) {
      log.error('Error canceling processes:', error);
      return { success: false, message: `Error occurred while canceling processes: ${error.message}` };
    }
  });
}

module.exports = { register };
