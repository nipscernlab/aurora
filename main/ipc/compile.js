// TODO(types): opt this file into `// @ts-check` once exec-command and
// exec-vvp-optimized are migrated to a typed [bin, args[]] IPC contract
// (PR 2.5). Today the renderer composes raw shell strings, which tangles
// up the ChildProcess typings (shell:true/encoding narrowing, child.pid
// undefined vs state.vvpProcessPid null) into ~15 errors that aren't
// worth solving with casts when the actual fix is the IPC redesign.
/**
 * Compilation + simulation execution: exec-command, exec-vvp-optimized,
 * exec-vvp-streamed, launch-gtkwave-only, cancel-vvp-process. All
 * process management ends up here so cancellation has a single source
 * of truth.
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

/**
 * Tokenize a GTKWave argument string into an array suitable for `spawn` with
 * `shell: false`. Handles three forms the renderer mixes freely:
 *   --rcvar "hide_sst on"     → ['--rcvar', 'hide_sst on']
 *   "C:/foo/bar.vcd"          → ['C:/foo/bar.vcd']
 *   --script="C:/foo/x.tcl"   → ['--script=C:/foo/x.tcl']   (quotes STRIPPED)
 *
 * The third form is the one that bit us: a naive `\S+` capture would push
 * `--script="C:/foo/x.tcl"` (quotes included) and GTKWave would then look for
 * a file literally named `"C:/foo/x.tcl"` (with the quote characters), fail
 * silently, and never run gtk_almost_proj.tcl — which is what kept fix.vcd
 * from opening in the second tab in Verilog-only mode.
 */
function parseGtkwaveArgs(argsString) {
  const args = [];
  // Match: bare quoted "..." OR --key="..." OR plain non-space token.
  const argRegex = /(--[\w-]+=)?(?:"([^"]*)"|(\S+))/g;
  let match;
  while ((match = argRegex.exec(argsString)) !== null) {
    const keyEq = match[1] || '';
    const quoted = match[2];
    const bare = match[3];
    if (quoted !== undefined) {
      args.push(keyEq + quoted);
    } else if (bare !== undefined) {
      // Strip a trailing quote that may have leaked from `--key="value"` when
      // the value itself contained spaces and the regex backtracked oddly.
      args.push(keyEq + bare.replace(/^"|"$/g, ''));
    }
  }
  return args;
}

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

  /**
   * Stream the output of a vvp run live to the renderer. Used by pass 2
   * of the wave pipeline so $display lines from the testbench show up
   * in twave as the simulation progresses (instead of arriving in one
   * lump when vvp finally exits). Uses spawn (no shell) so stdout/stderr
   * pipes go straight from vvp to us — no shell buffering layer between.
   *
   * Each chunk fires `vvp-stream` events tagged with stdout/stderr.
   * Resolves with { code } when the process exits.
   */
  ipcMain.handle('exec-vvp-streamed', (event, vvpBin, vvpFile, extraArgs, workingDir, options = {}) => {
    return new Promise((resolve, reject) => {
      // vvpFile may be '' when caller wants to spawn a self-contained binary
      // (Verilator-generated .exe) with no script argument.
      const args = [
        ...(vvpFile ? [vvpFile] : []),
        ...(Array.isArray(extraArgs) ? extraArgs : []),
      ];
      // options.prependPath: array of dirs to prepend to PATH. Verilator
      // pass-2 uses this so the .exe finds libstdc++-6.dll etc. from the
      // bundle's mingw64/bin; without it Windows kills the process with
      // STATUS_DLL_NOT_FOUND (0xC0000135 = 3221225781) before main() runs.
      // options.env: extra arbitrary env vars to inject.
      const spawnOpts = { cwd: workingDir, windowsHide: true };
      const prepend = Array.isArray(options?.prependPath) ? options.prependPath : null;
      if (prepend || options?.env) {
        const baseEnv = { ...process.env, ...(options?.env || {}) };
        if (prepend && prepend.length) {
          baseEnv.PATH = `${prepend.join(';')};${baseEnv.PATH || ''}`;
        }
        spawnOpts.env = baseEnv;
      }
      const child = spawn(vvpBin, args, spawnOpts);

      state.currentVvpProcess = child;
      state.vvpProcessPid = child.pid;

      child.stdout?.on('data', (data) => {
        event.sender.send('vvp-stream', { type: 'stdout', data: data.toString() });
      });
      child.stderr?.on('data', (data) => {
        event.sender.send('vvp-stream', { type: 'stderr', data: data.toString() });
      });
      child.on('close', (code) => {
        state.currentVvpProcess = null;
        state.vvpProcessPid = null;
        resolve({ code });
      });
      child.on('error', (err) => {
        state.currentVvpProcess = null;
        state.vvpProcessPid = null;
        reject({ code: -1, error: err.message });
      });
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
    const { gtkwCmd, gtkwaveBin, args: structuredArgs, workingDir } = options;

    return new Promise((resolve) => {
      try {
        let gtkwavePath;
        let args;

        if (gtkwaveBin && Array.isArray(structuredArgs)) {
          // Preferred: caller passes the CommandSpec's binary + already-
          // tokenized args. No string round-trip, so a space-free gtkwave
          // path can't be misread as "missing leading quote" — which is
          // exactly what broke the Verilator wave flow.
          gtkwavePath = gtkwaveBin;
          args = structuredArgs;
        } else {
          // Legacy string form: "C:/path/gtkwave.exe" --args "file.vcd" --script="script.tcl"
          const cmdMatch = String(gtkwCmd || '').match(/^"([^"]+)"\s*(.*)$/);
          if (!cmdMatch) {
            resolve({ success: false, message: 'Invalid GTKWave command format' });
            return;
          }
          gtkwavePath = cmdMatch[1];
          args = parseGtkwaveArgs(cmdMatch[2]);
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
