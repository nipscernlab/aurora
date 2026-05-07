/**
 * Compilation + simulation execution: exec-command, exec-vvp-optimized,
 * launch-gtkwave-only, launch-serial-simulation, launch-parallel-simulation,
 * cancel-vvp-process. All process management ends up here so cancellation
 * has a single source of truth.
 */

const { ipcMain } = require('electron');
const { exec, execFile, spawn } = require('child_process');
const log = require('electron-log');

const state = require('../state');
const {
  getCPUCount,
  filterGtkWaveOutput,
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

  ipcMain.handle('exec-vvp-optimized', (event, command, workingDir, options = {}) => {
    return new Promise((resolve, reject) => {
      const cpuCount = getCPUCount();
      const performanceEnv = {
        ...process.env,
        OMP_NUM_THREADS: cpuCount.toString(),
        OMP_THREAD_LIMIT: cpuCount.toString(),
        OMP_DYNAMIC: 'true',
        OMP_NESTED: 'false',
        OMP_STACKSIZE: '32M',
        VVP_PARALLEL: '1',
        VVP_THREADS: cpuCount.toString(),
        MALLOC_ARENA_MAX: '2',
        MALLOC_MMAP_THRESHOLD: '65536',
        NUMBER_OF_PROCESSORS: cpuCount.toString(),
        ...options.env,
      };

      const silentCommand = `start /b cmd /c "${command}"`;
      const execOptions = {
        cwd: workingDir,
        env: performanceEnv,
        maxBuffer: 1024 * 1024 * 50,
        windowsHide: true,
        encoding: 'utf8',
        shell: true,
      };

      state.currentVvpProcess = exec(silentCommand, execOptions);

      let stdout = '';
      let stderr = '';

      if (state.currentVvpProcess) {
        state.vvpProcessPid = state.currentVvpProcess.pid;
        event.sender.send('command-output-stream', { type: 'pid', pid: state.vvpProcessPid });
      }

      state.currentVvpProcess.stdout?.on('data', (data) => {
        stdout += data;
        event.sender.send('command-output-stream', { type: 'stdout', data });
      });

      state.currentVvpProcess.stderr?.on('data', (data) => {
        stderr += data;
        event.sender.send('command-output-stream', { type: 'stderr', data });
      });

      state.currentVvpProcess.on('close', (code) => {
        state.currentVvpProcess = null;
        state.vvpProcessPid = null;
        resolve({ code, stdout, stderr, performance: { cpuCount } });
      });

      state.currentVvpProcess.on('error', (err) => {
        state.currentVvpProcess = null;
        state.vvpProcessPid = null;
        reject({ code: -1, stdout: '', stderr: err.message || 'VVP process error', error: err.message });
      });
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

  ipcMain.handle('launch-gtkwave-only', async (event, options) => {
    const { gtkwCmd, workingDir } = options;

    return new Promise((resolve) => {
      try {
        // Format: "C:/path/gtkwave.exe" --args "file.vcd" --script="script.tcl"
        const cmdMatch = gtkwCmd.match(/^"([^"]+)"\s*(.*)$/);
        if (!cmdMatch) {
          resolve({ success: false, message: 'Invalid GTKWave command format' });
          return;
        }

        const gtkwavePath = cmdMatch[1];
        const argsString = cmdMatch[2];

        const args = [];
        const argRegex = /"([^"]+)"|(\S+)/g;
        let match;
        while ((match = argRegex.exec(argsString)) !== null) {
          args.push(match[1] || match[2]);
        }

        const gtkwaveProcess = spawn(gtkwavePath, args, {
          cwd: workingDir,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
        });

        const gtkwavePid = gtkwaveProcess.pid;

        gtkwaveProcess.stdout.on('data', (data) =>
          event.sender.send('gtkwave-output', { type: 'stdout', data: data.toString() }),
        );
        gtkwaveProcess.stderr.on('data', (data) =>
          event.sender.send('gtkwave-output', { type: 'stderr', data: data.toString() }),
        );

        gtkwaveProcess.on('error', (error) => {
          event.sender.send('gtkwave-output', { type: 'error', data: error.message });
          resolve({ success: false, message: `GTKWave error: ${error.message}` });
        });

        gtkwaveProcess.on('close', (code) => {
          event.sender.send('gtkwave-output', {
            type: 'completion',
            code,
            message: code === 0 ? 'GTKWave closed successfully' : `GTKWave exited with code ${code}`,
          });
        });

        gtkwaveProcess.unref();
        resolve({ success: true, gtkwavePid, message: 'GTKWave launched successfully' });
      } catch (error) {
        resolve({ success: false, message: `Failed to launch GTKWave: ${error.message}` });
      }
    });
  });

  ipcMain.handle('launch-serial-simulation', async (event, { vvpCmd, gtkwCmd, workingDir }) => {
    try {
      const vvpMatch = vvpCmd.match(/^"([^"]+)"\s+"([^"]+)"$/);
      if (!vvpMatch) throw new Error('Invalid VVP command format');

      const vvpPath = vvpMatch[1];
      const vvpFile = vvpMatch[2];

      // VVP first — wait for completion before launching GTKWave.
      await new Promise((resolve, reject) => {
        const vvpProcess = spawn(vvpPath, [vvpFile], {
          cwd: workingDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
          detached: false,
        });

        state.currentVvpProcess = vvpProcess;
        state.vvpProcessPid = vvpProcess.pid;

        vvpProcess.stdout.on('data', (data) =>
          event.sender.send('gtkwave-output', { type: 'stdout', data: data.toString() }),
        );
        vvpProcess.stderr.on('data', (data) =>
          event.sender.send('gtkwave-output', { type: 'stderr', data: data.toString() }),
        );

        vvpProcess.on('error', (error) => {
          state.currentVvpProcess = null;
          state.vvpProcessPid = null;
          reject(new Error(`VVP error: ${error.message}`));
        });

        vvpProcess.on('close', (code) => {
          state.currentVvpProcess = null;
          state.vvpProcessPid = null;
          event.sender.send('vvp-finished', { code });

          if (code !== 0) {
            reject(new Error(`VVP failed with code ${code}`));
          } else {
            event.sender.send('gtkwave-output', {
              type: 'completion',
              code: 0,
              message: 'VVP simulation completed successfully (100%)',
            });
            resolve();
          }
        });
      });

      event.sender.send('gtkwave-output', {
        type: 'stdout',
        data: 'VVP simulation complete (100%), launching GTKWave...\n',
      });

      // Silent batch wrapper to keep GTKWave's console window hidden.
      const silentGtkwCmd = `start /b cmd /c "${gtkwCmd}"`;
      const gtkwaveProcess = exec(silentGtkwCmd, {
        cwd: workingDir,
        windowsHide: true,
        shell: true,
        detached: true,
      });

      const gtkwavePid = gtkwaveProcess.pid;
      state.currentGtkwaveProcesses.add(gtkwavePid);

      if (gtkwaveProcess.stdout) {
        gtkwaveProcess.stdout.on('data', (data) => {
          const output = filterGtkWaveOutput(data.toString());
          if (output.trim()) event.sender.send('gtkwave-output', { type: 'stdout', data: output });
        });
      }
      if (gtkwaveProcess.stderr) {
        gtkwaveProcess.stderr.on('data', (data) => {
          const errorOut = filterGtkWaveOutput(data.toString());
          if (errorOut.trim())
            event.sender.send('gtkwave-output', { type: 'stderr', data: errorOut });
        });
      }

      gtkwaveProcess.on('close', (code) => {
        state.currentGtkwaveProcesses.delete(gtkwavePid);
        event.sender.send('gtkwave-output', { type: 'completion', code, message: 'GTKWave closed' });
      });

      gtkwaveProcess.on('error', (error) => {
        state.currentGtkwaveProcesses.delete(gtkwavePid);
        log.error('GTKWave error:', error);
      });

      gtkwaveProcess.unref();

      return { success: true, gtkwavePid, message: 'Serial simulation completed, GTKWave launched successfully' };
    } catch (error) {
      log.error('Serial simulation error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('launch-parallel-simulation', async (event, { vvpCmd, gtkwCmd, workingDir }) => {
    try {
      const vvpMatch = vvpCmd.match(/^"([^"]+)"\s+"([^"]+)"$/);
      if (!vvpMatch) throw new Error('Invalid VVP command format');

      const vvpPath = vvpMatch[1];
      const vvpFile = vvpMatch[2];

      const vvpProcess = spawn(vvpPath, [vvpFile], {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        detached: false,
      });

      state.currentVvpProcess = vvpProcess;
      state.vvpProcessPid = vvpProcess.pid;

      vvpProcess.stdout.on('data', (data) =>
        event.sender.send('gtkwave-output', { type: 'stdout', data: data.toString() }),
      );
      vvpProcess.stderr.on('data', (data) =>
        event.sender.send('gtkwave-output', { type: 'stderr', data: data.toString() }),
      );

      vvpProcess.on('error', (error) =>
        event.sender.send('gtkwave-output', { type: 'error', data: `VVP error: ${error.message}` }),
      );

      vvpProcess.on('close', (code) => {
        state.currentVvpProcess = null;
        state.vvpProcessPid = null;
        event.sender.send('vvp-finished', { code });
        event.sender.send('gtkwave-output', {
          type: 'completion',
          code,
          message: code === 0 ? 'VVP simulation completed' : `VVP exited with code ${code}`,
        });
      });

      // Give VVP a moment so the VCD starts writing.
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const silentGtkwCmd = `start /b cmd /c "${gtkwCmd}"`;
      const gtkwaveProcess = exec(silentGtkwCmd, {
        cwd: workingDir,
        windowsHide: true,
        shell: true,
        detached: true,
      });

      const gtkwavePid = gtkwaveProcess.pid;
      state.currentGtkwaveProcesses.add(gtkwavePid);

      if (gtkwaveProcess.stdout) {
        gtkwaveProcess.stdout.on('data', (data) => {
          const output = filterGtkWaveOutput(data.toString());
          if (output.trim()) event.sender.send('gtkwave-output', { type: 'stdout', data: output });
        });
      }
      if (gtkwaveProcess.stderr) {
        gtkwaveProcess.stderr.on('data', (data) => {
          const errorOut = filterGtkWaveOutput(data.toString());
          if (errorOut.trim())
            event.sender.send('gtkwave-output', { type: 'stderr', data: errorOut });
        });
      }

      gtkwaveProcess.on('close', (code) => {
        state.currentGtkwaveProcesses.delete(gtkwavePid);
        event.sender.send('gtkwave-output', { type: 'completion', code, message: 'GTKWave closed' });
      });

      gtkwaveProcess.on('error', (error) => {
        state.currentGtkwaveProcesses.delete(gtkwavePid);
        log.error('GTKWave error:', error);
      });

      gtkwaveProcess.unref();

      return {
        success: true,
        gtkwavePid,
        vvpPid: state.vvpProcessPid,
        message: 'Parallel simulation launched successfully',
      };
    } catch (error) {
      log.error('Parallel simulation error:', error);
      return { success: false, message: error.message };
    }
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
