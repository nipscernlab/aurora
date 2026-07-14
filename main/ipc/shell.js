// @ts-check
/**
 * shell.js — the embedded interactive shell behind the TCMD terminal tab.
 *
 * A persistent PowerShell (win32) / $SHELL (POSIX) driven over pipes: the
 * renderer writes the user's typed line to stdin and we stream stdout/stderr
 * back. No PTY, so no native modules — the shell itself echoes the command and
 * prints its own prompt (which tracks the cwd as `cd` runs), so the panel reads
 * like a real terminal without us re-implementing one. `cd` and env persist for
 * the life of the session; `PYTHONUNBUFFERED=1` makes `python` output stream
 * live instead of block-buffering because stdout isn't a TTY.
 *
 * SECURITY: this runs ARBITRARY commands the human types, so it is a separate,
 * human-only channel — deliberately NOT the toolchain `exec-spec` path and NOT
 * reachable from the AI tool bridge / MCP. The AI never gets a handle to it.
 *
 * Lifecycle is managed here (not via process_registry.spawnTracked) so opening
 * a shell doesn't arm the toolchain close-time WMI sweeps. We tree-kill the
 * shell (taskkill /F /T, so a running `python long.py` child dies too) when the
 * renderer reloads/closes, on restart, and on explicit kill.
 */

'use strict';

const os = require('os');
const { spawn } = require('child_process');
const { ipcMain } = require('electron');
const log = require('electron-log');
const { killProcessSilently } = require('../utils');

/** @type {Map<string, import('child_process').ChildProcess>} */
const sessions = new Map();

/** The shell binary + startup args for the current platform. */
function shellCommand() {
  if (process.platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] };
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-i'] };
}

/** Tree-kill and forget the session under `id` (safe if none exists). */
function killSession(id) {
  const child = sessions.get(id);
  if (!child) return;
  sessions.delete(id);
  try { child.stdin?.end(); } catch (_) { /* already gone */ }
  try {
    if (typeof child.pid === 'number') killProcessSilently(child.pid);
    else child.kill();
  } catch (err) {
    log.debug('[shell] kill failed:', err instanceof Error ? err.message : err);
  }
}

function register() {
  /**
   * Start (or restart) the interactive shell for a session id. Streams
   * `shell:data` { id, type:'stdout'|'stderr', data } events and, on exit,
   * `shell:exit` { id, code }. Payload: { id?, cwd? }.
   */
  ipcMain.handle('shell:start', (event, opts = {}) => {
    const id = String(opts.id || 'tcmd');
    killSession(id); // clean restart if one is already live

    const { file, args } = shellCommand();
    const cwd = (opts.cwd && typeof opts.cwd === 'string') ? opts.cwd : os.homedir();

    let child;
    try {
      child = spawn(file, args, {
        cwd,
        windowsHide: true,
        shell: false,
        env: {
          ...process.env,
          // python (and many tools) block-buffer stdout when it isn't a TTY;
          // force unbuffered so print() output streams live into the panel.
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      });
    } catch (err) {
      log.warn('[shell] spawn failed:', err instanceof Error ? err.message : err);
      return { ok: false, error: String(err instanceof Error ? err.message : err) };
    }

    sessions.set(id, child);
    const wc = event.sender;
    const send = (type, data) => { if (!wc.isDestroyed()) wc.send('shell:data', { id, type, data }); };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d) => send('stdout', d));
    child.stderr?.on('data', (d) => send('stderr', d));
    child.on('close', (code) => {
      if (sessions.get(id) === child) sessions.delete(id);
      if (!wc.isDestroyed()) wc.send('shell:exit', { id, code });
    });
    child.on('error', (err) => {
      send('stderr', `\n[shell error] ${err instanceof Error ? err.message : err}\n`);
    });

    // Don't leak the shell (or its python children) if the renderer goes away.
    wc.once('destroyed', () => killSession(id));

    return { ok: true, id, shell: file, cwd };
  });

  /** Write the user's keystrokes/line to the shell's stdin. Payload: { id?, data }. */
  ipcMain.handle('shell:input', (_event, payload = {}) => {
    const child = sessions.get(String(payload.id || 'tcmd'));
    if (!child || !child.stdin || child.stdin.destroyed) return { ok: false };
    try { child.stdin.write(String(payload.data ?? '')); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err instanceof Error ? err.message : err) }; }
  });

  /** Explicitly tree-kill a session. Payload: { id? }. */
  ipcMain.handle('shell:kill', (_event, payload = {}) => {
    killSession(String(payload.id || 'tcmd'));
    return { ok: true };
  });
}

module.exports = { register };
