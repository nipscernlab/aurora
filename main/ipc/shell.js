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
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const log = require('electron-log');

// Themed prompt for the TCMD shell (see main/shell/aurora-prompt.ps1) plus a tiny
// JSON file the prompt reads for the app's active-processor segment. The renderer
// keeps the file current via the `shell:context` IPC below.
const PROMPT_SCRIPT = path.join(__dirname, '..', 'shell', 'aurora-prompt.ps1');
const CONTEXT_FILE = path.join(os.tmpdir(), 'aurora-shell', 'context.json');

function ensureContextFile() {
  try {
    fs.mkdirSync(path.dirname(CONTEXT_FILE), { recursive: true });
    if (!fs.existsSync(CONTEXT_FILE)) fs.writeFileSync(CONTEXT_FILE, '{}', 'utf8');
  } catch (err) {
    log.warn('[shell] context file init failed:', err instanceof Error ? err.message : err);
  }
}

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
  if (process.platform === 'win32') {
    const base = ['-NoLogo'];
    // Load the aurora prompt into THIS session only. A -EncodedCommand bootstrap
    // reads the .ps1 as TEXT and dot-sources it as a scriptblock, so (a) the user's
    // global $PROFILE is untouched and (b) it sidesteps the script-file
    // ExecutionPolicy (Restricted/RemoteSigned machines still get the prompt).
    // -NoExit keeps the session interactive after the bootstrap runs.
    if (fs.existsSync(PROMPT_SCRIPT)) {
      const q = PROMPT_SCRIPT.replace(/'/g, "''");
      const bootstrap = `$p = '${q}'; if (Test-Path -LiteralPath $p) { . ([ScriptBlock]::Create((Get-Content -Raw -LiteralPath $p))) }`;
      const encoded = Buffer.from(bootstrap, 'utf16le').toString('base64');
      base.push('-NoExit', '-EncodedCommand', encoded);
    }
    return { file: 'powershell.exe', args: base };
  }
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
  ensureContextFile();

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
          // Where the aurora prompt reads the app's active-processor segment from.
          AURORA_SHELL_CONTEXT: CONTEXT_FILE,
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

  /**
   * Update the shell context the aurora prompt reads (currently the active
   * processor). Fire-and-forget from the renderer whenever the value changes;
   * the running prompt re-reads the file on its next render — no terminal noise,
   * no PTY writes. Payload: { processor? }.
   */
  ipcMain.handle('shell:context', (_event, payload = {}) => {
    ensureContextFile();
    const processor = typeof payload.processor === 'string' ? payload.processor : '';
    try {
      fs.writeFileSync(CONTEXT_FILE, JSON.stringify({ processor }), 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) };
    }
  });
}

module.exports = { register };
