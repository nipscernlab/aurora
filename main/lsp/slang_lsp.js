// @ts-check
/**
 * slang_lsp.js — SystemVerilog SEMANTIC language server bridge (O11).
 *
 * Spawns a single long-lived `slang-server` (hudson-trading/slang-server,
 * bundled in components/Packages/slang-server/bin via
 * download-slang-server.js) and speaks Content-Length-framed JSON-RPC over
 * stdio. Unlike Verible (O2, syntactic + per-file), slang ELABORATES the
 * whole design, so it catches semantic errors Verible can't (undeclared
 * identifiers, type/port mismatches, unused signals, …) and offers
 * symbol completion.
 *
 * Per the chosen split ("meio-termo"), the renderer
 * (js/editor/slang_integration.js) only consumes slang's DIAGNOSTICS
 * (owner 'slang', coexisting with Verible's) and COMPLETION — hover,
 * definition, references, outline and formatting stay with Verible. slang
 * can be toggled off (it elaborates on every change and can be noisy on
 * incomplete designs).
 *
 * slang is WORKSPACE-coupled: it indexes the open project's tree, so this
 * bridge starts it with the project dir as rootUri and transparently
 * restarts it when the project changes. Everything is best-effort: if the
 * binary is missing or the toggle is off, calls no-op and the editor
 * behaves as before.
 *
 * The transport mirrors verible_lsp.js on purpose; slang's extras live
 * here (workspace rootUri, server→client request replies, enable/disable,
 * project-change restart, completion) so the live-validated O2 bridge is
 * left untouched.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { ipcMain } = require('electron');
const log = require('electron-log');

const state = require('../state');
const { componentsPath } = require('../paths');
const { spawnTracked } = require('../process_registry');
const { isAllowed } = require('../compile/binary_allowlist');

// ── Configuration ────────────────────────────────────────────────────────────

const LS_BIN = path.join(componentsPath, 'Packages', 'slang-server', 'bin', 'slang-server.exe');
const REQUEST_TIMEOUT_MS = 20000; // elaboration can be heavier than a lint

// ── State ────────────────────────────────────────────────────────────────────

/** @type {import('child_process').ChildProcess | null} */
let proc = null;
let ready = false;
let enabled = true; // toggle; the renderer syncs the persisted state at boot
/** @type {Promise<void> | null} */
let startPromise = null;
let nextId = 1;
/** @type {Map<number, {resolve:(v:any)=>void, reject:(e:any)=>void, timer:NodeJS.Timeout}>} */
const pending = new Map();
/** @type {Map<string, {version:number, text:string, languageId:string}>} */
const openDocs = new Map();
let stdoutBuf = Buffer.alloc(0);
/** Project dir the live server was started for (null = none / not started). */
let currentProjectDir = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function binInstalled() {
  try { return fs.existsSync(LS_BIN); } catch { return false; }
}

/** The open project's root dir (parent of the .spf), or null. */
function projectDirNow() {
  const spf = state.currentOpenProjectPath;
  return spf ? path.dirname(spf) : null;
}

function sendMain(/** @type {string} */ channel, /** @type {any} */ payload) {
  const w = state.mainWindow;
  if (w && !w.isDestroyed()) {
    try { w.webContents.send(channel, payload); } catch { /* tearing down */ }
  }
}

function writeMessage(/** @type {any} */ msg) {
  if (!proc || !proc.stdin || !proc.stdin.writable) return;
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  try {
    proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    proc.stdin.write(body);
  } catch (e) {
    log.warn('[slang-ls] write failed:', e instanceof Error ? e.message : e);
  }
}

function notify(/** @type {string} */ method, /** @type {any} */ params) {
  writeMessage({ jsonrpc: '2.0', method, params });
}

function request(/** @type {string} */ method, /** @type {any} */ params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`LSP request timed out: ${method}`)); }
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    writeMessage({ jsonrpc: '2.0', id, method, params });
  });
}

function handleMessage(/** @type {any} */ msg) {
  // Response to one of our requests.
  if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
    const entry = pending.get(msg.id);
    if (entry) {
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(msg.error.message || 'LSP error'));
      else entry.resolve(msg.result);
    }
    return;
  }
  // Server → client notification.
  if (typeof msg.method === 'string' && (msg.id === undefined || msg.id === null)) {
    if (msg.method === 'textDocument/publishDiagnostics' && msg.params) {
      sendMain('slang:diagnostics', {
        uri: msg.params.uri,
        diagnostics: Array.isArray(msg.params.diagnostics) ? msg.params.diagnostics : [],
      });
    }
    // Other notifications (window/logMessage, $/progress, telemetry, …) ignored.
    return;
  }
  // Server → client REQUEST (has id + method) — slang sends a few
  // (registerCapability, workspace/configuration, workDoneProgress/create).
  // We must reply so the server isn't left waiting.
  if (msg.id !== undefined && msg.id !== null && typeof msg.method === 'string') {
    let result = null;
    if (msg.method === 'workspace/configuration' && msg.params && Array.isArray(msg.params.items)) {
      result = msg.params.items.map(() => null); // no per-section overrides
    }
    writeMessage({ jsonrpc: '2.0', id: msg.id, result });
  }
}

function onStdout(/** @type {Buffer} */ chunk) {
  stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
  for (;;) {
    const sep = stdoutBuf.indexOf('\r\n\r\n');
    if (sep < 0) break;
    const header = stdoutBuf.slice(0, sep).toString('ascii');
    const m = /content-length:\s*(\d+)/i.exec(header);
    if (!m) { stdoutBuf = stdoutBuf.slice(sep + 4); continue; }
    const len = parseInt(m[1], 10);
    if (stdoutBuf.length < sep + 4 + len) break;
    const body = stdoutBuf.slice(sep + 4, sep + 4 + len).toString('utf8');
    stdoutBuf = stdoutBuf.slice(sep + 4 + len);
    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    try { handleMessage(msg); } catch (e) {
      log.warn('[slang-ls] message handler error:', e instanceof Error ? e.message : e);
    }
  }
}

/** Reset live-process state and reject anything in flight. Keeps openDocs. */
function handleProcessGone() {
  ready = false;
  proc = null;
  startPromise = null;
  stdoutBuf = Buffer.alloc(0);
  currentProjectDir = null;
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    try { entry.reject(new Error('slang-server stopped')); } catch { /* ignore */ }
  }
  pending.clear();
}

function doStart() {
  return new Promise((resolve, reject) => {
    if (!binInstalled()) { reject(new Error('slang-server not installed')); return; }
    const verdict = isAllowed(LS_BIN);
    if (!verdict.ok) { reject(new Error(verdict.error)); return; }

    const dir = projectDirNow();
    const rootUri = dir ? pathToFileURL(dir).toString() : null;

    let initSettled = false;
    let child;
    try {
      child = spawnTracked(LS_BIN, [], { windowsHide: true, cwd: dir || componentsPath });
    } catch (e) { reject(e); return; }
    proc = child;
    currentProjectDir = dir;

    child.stdout.on('data', onStdout);
    child.stderr.on('data', () => { /* slang logs banners/info to stderr */ });
    child.on('error', (err) => {
      log.error('[slang-ls] process error:', err);
      if (!initSettled) { initSettled = true; reject(err); }
      handleProcessGone();
    });
    child.on('exit', (code, sig) => {
      log.info(`[slang-ls] exited (code=${code} sig=${sig})`);
      if (!initSettled) { initSettled = true; reject(new Error(`slang-server exited (code ${code})`)); }
      handleProcessGone();
    });

    request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: dir ? [{ uri: rootUri, name: path.basename(dir) }] : null,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          publishDiagnostics: {},
          completion: {
            contextSupport: true,
            completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'] },
          },
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
      clientInfo: { name: 'Aurora', version: '1' },
    }).then(() => {
      notify('initialized', {});
      ready = true;
      initSettled = true;
      for (const [uri, doc] of openDocs) {
        doc.version = 1;
        notify('textDocument/didOpen', {
          textDocument: { uri, languageId: doc.languageId, version: 1, text: doc.text },
        });
      }
      resolve();
    }).catch((e) => {
      if (!initSettled) { initSettled = true; reject(e); }
    });
  });
}

function start() {
  if (ready) return Promise.resolve();
  if (startPromise) return startPromise;
  startPromise = doStart();
  startPromise.catch(() => {}).then(() => { if (!ready) startPromise = null; });
  return startPromise;
}

async function ensureReady() {
  if (!enabled) return false;
  if (ready) return true;
  try { await start(); } catch { return false; }
  return ready;
}

/** Kill the live server. clearDiag drops the markers the renderer shows. */
function stop(clearDiag) {
  if (clearDiag) {
    for (const uri of openDocs.keys()) sendMain('slang:diagnostics', { uri, diagnostics: [] });
  }
  const child = proc;
  handleProcessGone();
  if (child) { try { child.kill(); } catch { /* ignore */ } }
}

/** If the open project changed under us, restart so slang re-indexes it. */
function maybeRestartForProject() {
  if (ready && projectDirNow() !== currentProjectDir) {
    // Keep openDocs — the renderer disposes old-project models (didClose) and
    // opens the new ones, so openDocs already reflects the new set; doStart
    // re-seeds them against the new root.
    stop(false);
  }
}

// ── Document lifecycle (renderer-driven) ──────────────────────────────────────

async function didOpen(/** @type {string} */ uri, /** @type {string} */ text, /** @type {string} */ languageId) {
  if (!enabled || typeof uri !== 'string' || typeof text !== 'string') return;
  maybeRestartForProject();
  if (!(await ensureReady())) return;
  if (openDocs.has(uri)) return didChange(uri, text);
  openDocs.set(uri, { version: 1, text, languageId: languageId || 'systemverilog' });
  notify('textDocument/didOpen', { textDocument: { uri, languageId: languageId || 'systemverilog', version: 1, text } });
}

async function didChange(/** @type {string} */ uri, /** @type {string} */ text) {
  if (!enabled || typeof uri !== 'string' || typeof text !== 'string') return;
  if (!(await ensureReady())) return;
  const doc = openDocs.get(uri);
  if (!doc) {
    openDocs.set(uri, { version: 1, text, languageId: 'systemverilog' });
    notify('textDocument/didOpen', { textDocument: { uri, languageId: 'systemverilog', version: 1, text } });
    return;
  }
  doc.version += 1;
  doc.text = text;
  notify('textDocument/didChange', { textDocument: { uri, version: doc.version }, contentChanges: [{ text }] });
}

function didClose(/** @type {string} */ uri) {
  if (typeof uri !== 'string') return;
  openDocs.delete(uri);
  if (ready) notify('textDocument/didClose', { textDocument: { uri } });
  sendMain('slang:diagnostics', { uri, diagnostics: [] });
}

async function completion(/** @type {string} */ uri, /** @type {any} */ position) {
  if (!enabled) return null;
  if (!(await ensureReady())) return null;
  try {
    return await request('textDocument/completion', { textDocument: { uri }, position });
  } catch (e) {
    log.warn('[slang-ls] completion failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

function setEnabled(/** @type {boolean} */ on) {
  on = !!on;
  if (on === enabled) return { enabled };
  enabled = on;
  if (!on) stop(true); // disabling → kill + clear slang markers
  // enabling → lazy start on the next didOpen (the renderer re-opens its models)
  return { enabled };
}

// ── IPC registration ──────────────────────────────────────────────────────────

function register() {
  ipcMain.handle('slang:status', () => ({ installed: binInstalled(), ready, enabled }));
  ipcMain.handle('slang:set-enabled', (_e, on) => setEnabled(on));
  ipcMain.handle('slang:did-open', (_e, { uri, text, languageId } = {}) => didOpen(uri, text, languageId));
  ipcMain.handle('slang:did-change', (_e, { uri, text } = {}) => didChange(uri, text));
  ipcMain.handle('slang:did-close', (_e, { uri } = {}) => didClose(uri));
  ipcMain.handle('slang:completion', (_e, { uri, position } = {}) => completion(uri, position));
}

module.exports = { register };
