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

const { ipcMain, app, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const log = require('electron-log');

const state = require('../state');
const {
  killProcessSilently,
  killProcessesByName,
  checkProcessRunning,
} = require('../utils');
const { trackChild } = require('../process_registry');

// Surfer has no "maximize" CLI flag and its state file carries no window
// geometry, so to avoid a tiny top-left window we write a CENTERED, screen-
// adaptive geometry into Surfer's (global) config — the only place it reads
// window size/pos (the cwd-local .surfer/ override is broken on Windows in
// v0.7.0). We read the real primary-display work area (nothing hardcoded) and
// size a centered ~85% rectangle; the user maximizes from there. A marker
// guards a hand-authored config so it is never clobbered.
function writeSurferCenteredWindowConfig() {
  try {
    const wa = screen.getPrimaryDisplay().workArea; // logical (DIP) units
    const w = Math.max(800, Math.round(wa.width * 0.85));
    const h = Math.max(600, Math.round(wa.height * 0.85));
    const x = wa.x + Math.round((wa.width - w) / 2);
    const y = wa.y + Math.round((wa.height - h) / 2);
    const dir = path.join(app.getPath('appData'), 'surfer-project', 'surfer', 'config');
    const file = path.join(dir, 'config.toml');
    const MARKER = '# Managed by AURORA';
    if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(MARKER)) {
      return; // respect a hand-authored Surfer config
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file,
      `${MARKER} — Surfer opens centered on your screen; maximize it yourself.\n` +
      '# Delete this file (or remove the line above) to manage the window yourself.\n' +
      '[layout]\n' +
      `window_width = ${w}\n` +
      `window_height = ${h}\n` +
      `window_x_position = ${x}\n` +
      `window_y_position = ${y}\n`,
      'utf8');
  } catch (error) {
    log.warn('Surfer window-config write skipped:', error?.message);
  }
}

// Write the per-processor "mapping translator" files (Assembly/source-line
// decode for valr2/linetabs) into Surfer's GLOBAL mappings dir — the only
// place Surfer reliably discovers them on Windows (the cwd-local .surfer/
// walk-up is broken in v0.7.0). Surfer reads these at launch and uses the
// `Name =` header as the translator name the .surf.ron references via
// `format`. Names are aurora_*-prefixed so user mappings are never touched;
// each launch overwrites the active project's set (idempotent). Best-effort:
// a failure here must not block opening the waveform.
function writeSurferMappings(mappings) {
  const result = { written: 0, failed: [] };
  try {
    if (!Array.isArray(mappings) || mappings.length === 0) return result;
    const dir = path.join(app.getPath('appData'), 'surfer-project', 'surfer', 'config', 'mappings');
    fs.mkdirSync(dir, { recursive: true });
    for (const m of mappings) {
      if (!m || typeof m.name !== 'string' || typeof m.content !== 'string') continue;
      // The name is already FS-safe (built by mappingName), but harden against
      // path separators so a name can never escape the mappings dir.
      const safe = m.name.replace(/[^A-Za-z0-9_.-]/g, '_');
      if (!safe) continue;
      try {
        fs.writeFileSync(path.join(dir, safe), m.content, 'utf8');
        result.written++;
      } catch (e) {
        // Per-mapping failure (permission/IO) — record so the renderer can warn
        // the user that those tracks open as raw decimal, instead of silent.
        result.failed.push({ name: m.name, error: e?.message || String(e) });
      }
    }
  } catch (error) {
    log.warn('Surfer mappings write skipped:', error?.message);
    result.failed.push({ name: '*', error: error?.message || String(error) });
  }
  return result;
}

function register() {
  // NOTE: the legacy 'exec-command' handler (raw shell string from the
  // renderer via child_process.exec) was removed — it was a command-injection
  // sink with no remaining callers. All toolchain execution now goes through
  // the structured-spec executor (main/compile/executor.js), which validates
  // against a binary allowlist and protected flags and spawns with shell:false.

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
        // Track the detached GTKWave so closing the main interface tears it
        // down too — it's unref'd to outlive a single run, but must not
        // outlive the IDE itself.
        trackChild(gtkwaveProcess);

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

  // Surfer — the opt-in alternative viewer. Same detached-spawn contract as
  // launch-gtkwave-only, but pre-checks the binary with existsSync so a missing
  // Surfer (the default — it isn't bundled) returns a clean not-found the
  // renderer degrades on, instead of the false-success the GUI-subsystem
  // gtkwave path tolerates. Tracked via trackChild → torn down with the IDE.
  ipcMain.handle('launch-surfer', async (_event, options) => {
    const { surferBin, args, workingDir } = options;

    return new Promise((resolve) => {
      try {
        if (!surferBin || !Array.isArray(args)) {
          resolve({ success: false, message: 'launch-surfer requires { surferBin, args[] }' });
          return;
        }
        if (!fs.existsSync(surferBin)) {
          resolve({ success: false, message: `Surfer not found at ${surferBin}` });
          return;
        }

        // Center Surfer on the user's screen (it has no true maximize).
        writeSurferCenteredWindowConfig();

        const surferProcess = spawn(surferBin, args, {
          cwd: workingDir,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
          shell: false,
        });
        trackChild(surferProcess);

        // The GUI-subsystem race (pid set synchronously, ENOENT-style errors
        // arriving async) is the same as gtkwave; the existsSync guard above
        // already covers the realistic missing-binary case, and `settled`
        // keeps a late spawn error from double-resolving.
        let settled = false;
        surferProcess.on('error', (error) => {
          if (settled) return;
          settled = true;
          resolve({ success: false, message: `Surfer error: ${error.message}` });
        });

        const surferPid = surferProcess.pid;
        surferProcess.unref();
        if (!settled) {
          settled = true;
          resolve({ success: true, surferPid, message: 'Surfer launched successfully' });
        }
      } catch (error) {
        resolve({ success: false, message: `Failed to launch Surfer: ${error.message}` });
      }
    });
  });

  // Write the Surfer mapping translators (Assembly/source-line decode) the
  // auto-generated .surf.ron references. Called by the renderer right before a
  // Surfer launch so the files exist when Surfer scans its config/mappings dir
  // at startup. Best-effort (never rejects) — degrades to raw decimal tracks.
  ipcMain.handle('write-surfer-mappings', (_event, mappings) => {
    const r = writeSurferMappings(mappings);
    return { success: r.failed.length === 0, written: r.written, failed: r.failed };
  });

  // Decode complex-number bit patterns via the canonical comp2gtkw.exe (same
  // binary GTKWave pipes to as a process filter). The renderer extracts the
  // DISTINCT complex values from the dump and sends them here; we feed them on
  // stdin (one token per line — comp2gtkw reads whitespace-delimited tokens) and
  // return the "re imi" strings in order, to bake into a Surfer mapping. This is
  // the pre-pass that gives Surfer (which has no external process filter) the
  // same complex decode GTKWave gets live. Best-effort: failure → no decode.
  ipcMain.handle('decode-complex', async (_event, payload) => {
    return new Promise((resolve) => {
      try {
        const { exePath, values } = payload || {};
        if (!exePath || !Array.isArray(values) || values.length === 0 || !fs.existsSync(exePath)) {
          resolve({ success: false, decoded: [] });
          return;
        }
        const child = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true });
        let out = '';
        let settled = false;
        const done = (success) => { if (!settled) { settled = true; resolve({ success, decoded: out.split(/\r?\n/).filter((l) => l.length > 0) }); } };
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.on('error', () => done(false));
        child.on('close', () => done(true));
        child.stdin.on('error', () => { /* EPIPE if it exits early — close() still fires */ });
        child.stdin.write(values.join('\n') + '\n');
        child.stdin.end();
      } catch (error) {
        log.warn('decode-complex skipped:', error?.message);
        resolve({ success: false, decoded: [] });
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

  // Targeted stop: kill ONLY the currently parked streamed child (state.
  // currentVvpProcess) and nothing else. Unlike cancel-vvp-process this does
  // NOT sweep-and-kill vvp.exe/gtkwave.exe by name — that broad sweep would
  // race with, and kill, a GTKWave that the wave flow launches moments later.
  // Used by _extractFstHeaderVcd to stop fst2vcd once the header is captured.
  ipcMain.handle('kill-current-spec-process', async () => {
    const child = state.currentVvpProcess;
    if (!child || child.killed) return { success: false };
    try {
      await killProcessSilently(child.pid);
      return { success: true };
    } catch (error) {
      log.error('Error killing current spec process:', error);
      return { success: false, message: error.message };
    } finally {
      state.currentVvpProcess = null;
      state.vvpProcessPid = null;
    }
  });
}

module.exports = { register };
