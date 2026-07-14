// @ts-check
/**
 * shell.js — the embedded interactive shell behind the TCMD terminal tab.
 *
 * Backed by a real pseudo-terminal (@lydell/node-pty — a ConPTY-only, prebuilt
 * fork, so there is NO native compilation in dev or when packaging). A true PTY
 * gives the renderer's xterm.js everything a terminal has: inline editing, the
 * shell's own Tab autocomplete, colours, cursor, and resize. `cd`/env persist;
 * python detects a TTY and streams live (PYTHONUNBUFFERED is set as a belt).
 *
 * SECURITY: this runs ARBITRARY commands the human types, so it is a separate,
 * human-only channel — deliberately NOT the toolchain `exec-spec` path and NOT
 * reachable from the AI tool bridge / MCP. The AI never gets a handle to it.
 *
 * Lifecycle: one PTY per session id; killed (which tears down its child tree,
 * e.g. a running `python long.py`, via ConPTY) when the renderer reloads/closes,
 * on restart, and on explicit kill.
 */

'use strict';

const os = require('os');
const { ipcMain } = require('electron');
const log = require('electron-log');

/** @type {import('@lydell/node-pty') | null} */
let pty = null;
try {
  pty = require('@lydell/node-pty');
} catch (err) {
  log.error('[shell] node-pty unavailable:', err instanceof Error ? err.message : err);
}

/** @type {Map<string, { proc: any, dispose: () => void }>} */
const sessions = new Map();

function shellCommand() {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] };
  return { file: process.env.SHELL || '/bin/bash', args: [] };
}

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try { s.dispose(); } catch (_) { /* listeners gone */ }
  try { s.proc.kill(); } catch (_) { /* already dead */ }
}

function register() {
  /**
   * Start (or restart) a PTY for a session id. Streams `shell:data` { id, data }
   * and, on exit, `shell:exit` { id, code }. Payload: { id?, cwd?, cols?, rows? }.
   */
  ipcMain.handle('shell:start', (event, opts = {}) => {
    if (!pty) return { ok: false, error: 'node-pty indisponível (binário nativo não carregou)' };
    const id = String(opts.id || 'tcmd');
    killSession(id); // clean restart if one is already live

    const { file, args } = shellCommand();
    const cwd = (opts.cwd && typeof opts.cwd === 'string') ? opts.cwd : os.homedir();
    const cols = Number.isFinite(opts.cols) ? Math.max(2, opts.cols | 0) : 80;
    const rows = Number.isFinite(opts.rows) ? Math.max(2, opts.rows | 0) : 24;

    let proc;
    try {
      proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols, rows, cwd,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          TERM: 'xterm-256color',
        },
      });
    } catch (err) {
      log.warn('[shell] spawn failed:', err instanceof Error ? err.message : err);
      return { ok: false, error: String(err instanceof Error ? err.message : err) };
    }

    const wc = event.sender;
    const onData = proc.onData((data) => { if (!wc.isDestroyed()) wc.send('shell:data', { id, data }); });
    const onExit = proc.onExit(({ exitCode }) => {
      if (sessions.get(id)?.proc === proc) sessions.delete(id);
      if (!wc.isDestroyed()) wc.send('shell:exit', { id, code: exitCode });
    });
    const dispose = () => {
      try { onData.dispose(); } catch (_) { /* noop */ }
      try { onExit.dispose(); } catch (_) { /* noop */ }
    };
    sessions.set(id, { proc, dispose });

    // Don't leak the shell (or its python children) if the renderer goes away.
    wc.once('destroyed', () => killSession(id));

    return { ok: true, id, shell: file, cwd, pid: proc.pid };
  });

  /** Feed the user's keystrokes to the PTY. Payload: { id?, data }. */
  ipcMain.handle('shell:input', (_event, payload = {}) => {
    const s = sessions.get(String(payload.id || 'tcmd'));
    if (!s) return { ok: false };
    try { s.proc.write(String(payload.data ?? '')); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err instanceof Error ? err.message : err) }; }
  });

  /** Resize the PTY to match xterm's grid. Payload: { id?, cols, rows }. */
  ipcMain.handle('shell:resize', (_event, payload = {}) => {
    const s = sessions.get(String(payload.id || 'tcmd'));
    if (!s) return { ok: false };
    const cols = Math.max(2, (payload.cols | 0) || 80);
    const rows = Math.max(2, (payload.rows | 0) || 24);
    try { s.proc.resize(cols, rows); return { ok: true }; }
    catch (_) { return { ok: false }; }
  });

  /** Explicitly kill a session. Payload: { id? }. */
  ipcMain.handle('shell:kill', (_event, payload = {}) => {
    killSession(String(payload.id || 'tcmd'));
    return { ok: true };
  });
}

module.exports = { register };
