// @ts-check
/**
 * verible_lsp.js: minimal stdio Language Server bridge for Verilog (O2).
 *
 * Spawns a single long-lived `verible-verilog-ls` (bundled in
 * components/Packages/verible/bin via download-verible.js) and speaks
 * Content-Length-framed JSON-RPC with it over stdio. Renderer-facing IPC
 * (`lsp:*`) lets the Monaco editor (js/editor/lsp_integration.js) get
 * live diagnostics, formatting, outline symbols, hover and
 * definition/references, the full set of capabilities Verible advertises.
 *
 * Why a hand-rolled bridge instead of monaco-languageclient: AURORA's IPC
 * is already hand-rolled (no vscode-jsonrpc/monaco-languageclient deps to
 * pull in), the editor runs through the AMD/vendor Monaco build, and a
 * single Verilog backend needs only a thin transport. This module IS that
 * transport + lifecycle.
 *
 * Resilience: everything is best-effort. If the binary isn't installed
 * (bootstrap skipped/failed) every call no-ops and the editor behaves as
 * before. If the server dies it is respawned on the next request and the
 * docs the renderer had open are re-`didOpen`ed transparently, so
 * diagnostics keep flowing without the renderer noticing.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const log = require('electron-log');

const state = require('../state');
const { componentsPath } = require('../paths');
const { spawnTracked } = require('../process_registry');
const { isAllowed } = require('../compile/binary_allowlist');

// ── Configuration ────────────────────────────────────────────────────────────

const LS_BIN = path.join(componentsPath, 'Packages', 'verible', 'bin', 'verible-verilog-ls.exe');

// `--lsp_enable_hover` turns on the (experimental) hover provider;
// `--rules_config_search` makes Verible look upward for a project's
// `.rules.verible_lint` so per-project lint config just works.
const LS_ARGS = ['--lsp_enable_hover', '--rules_config_search'];

// A single request (format/symbols/hover/...) that gets no reply in this
// window is rejected so the renderer's provider falls back to empty
// instead of hanging the editor.
const REQUEST_TIMEOUT_MS = 15000;

// ── State ────────────────────────────────────────────────────────────────────

/** @type {import('child_process').ChildProcess | null} */
let proc = null;
let ready = false;
/** @type {Promise<void> | null} */
let startPromise = null;
let nextId = 1;
/** @type {Map<number, {resolve:(v:any)=>void, reject:(e:any)=>void, timer:NodeJS.Timeout}>} */
const pending = new Map();
/**
 * The renderer's view of open buffers, kept across server restarts so a
 * respawned server can be re-seeded transparently.
 * @type {Map<string, {version:number, text:string, languageId:string}>}
 */
const openDocs = new Map();
let stdoutBuf = Buffer.alloc(0);

// ── Helpers ──────────────────────────────────────────────────────────────────

function binInstalled() {
  try { return fs.existsSync(LS_BIN); } catch { return false; }
}

function sendMain(/** @type {string} */ channel, /** @type {any} */ payload) {
  const w = state.mainWindow;
  if (w && !w.isDestroyed()) {
    try { w.webContents.send(channel, payload); } catch { /* window tearing down */ }
  }
}

function writeMessage(/** @type {any} */ msg) {
  if (!proc || !proc.stdin || !proc.stdin.writable) return;
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  try {
    proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    proc.stdin.write(body);
  } catch (e) {
    log.warn('[verible-ls] write failed:', e instanceof Error ? e.message : e);
  }
}

function notify(/** @type {string} */ method, /** @type {any} */ params) {
  writeMessage({ jsonrpc: '2.0', method, params });
}

function request(/** @type {string} */ method, /** @type {any} */ params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }
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
  if (msg.method === 'textDocument/publishDiagnostics' && msg.params) {
    sendMain('lsp:diagnostics', {
      uri: msg.params.uri,
      diagnostics: Array.isArray(msg.params.diagnostics) ? msg.params.diagnostics : [],
    });
    return;
  }
  // Server → client request (e.g. window/workDoneProgress/create). We don't
  // implement these, reply with a null result so the server isn't left
  // waiting. Notifications we don't care about (with no id) are ignored.
  if (msg.id !== undefined && msg.id !== null && typeof msg.method === 'string') {
    writeMessage({ jsonrpc: '2.0', id: msg.id, result: null });
  }
}

function onStdout(/** @type {Buffer} */ chunk) {
  stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
  // Drain every complete Content-Length frame currently buffered.
  for (;;) {
    const sep = stdoutBuf.indexOf('\r\n\r\n');
    if (sep < 0) break;
    const header = stdoutBuf.slice(0, sep).toString('ascii');
    const m = /content-length:\s*(\d+)/i.exec(header);
    if (!m) { stdoutBuf = stdoutBuf.slice(sep + 4); continue; }
    const len = parseInt(m[1], 10);
    if (stdoutBuf.length < sep + 4 + len) break; // body not fully arrived yet
    const body = stdoutBuf.slice(sep + 4, sep + 4 + len).toString('utf8');
    stdoutBuf = stdoutBuf.slice(sep + 4 + len);
    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    try { handleMessage(msg); } catch (e) {
      log.warn('[verible-ls] message handler error:', e instanceof Error ? e.message : e);
    }
  }
}

/** Tear down all live-process state and reject anything in flight. */
function handleProcessGone() {
  ready = false;
  proc = null;
  startPromise = null;
  stdoutBuf = Buffer.alloc(0);
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    try { entry.reject(new Error('verible-verilog-ls stopped')); } catch { /* ignore */ }
  }
  pending.clear();
  // NB: openDocs is intentionally kept so a respawn can re-seed the docs.
}

function doStart() {
  return new Promise((resolve, reject) => {
    if (!binInstalled()) { reject(new Error('verible-verilog-ls not installed')); return; }

    // Defense in depth: the same allowlist that gates the toolchain executor
    // must also vouch for the LS path before we spawn it.
    const verdict = isAllowed(LS_BIN);
    if (!verdict.ok) { reject(new Error(verdict.error)); return; }

    let initSettled = false;
    let child;
    try {
      child = spawnTracked(LS_BIN, LS_ARGS, { windowsHide: true });
    } catch (e) { reject(e); return; }
    proc = child;

    child.stdout.on('data', onStdout);
    child.stderr.on('data', () => { /* startup banner + noise */ });
    child.on('error', (err) => {
      log.error('[verible-ls] process error:', err);
      if (!initSettled) { initSettled = true; reject(err); }
      handleProcessGone();
    });
    child.on('exit', (code, sig) => {
      log.info(`[verible-ls] exited (code=${code} sig=${sig})`);
      if (!initSettled) { initSettled = true; reject(new Error(`verible-verilog-ls exited (code ${code})`)); }
      handleProcessGone();
    });

    request('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          publishDiagnostics: {},
        },
      },
      clientInfo: { name: 'Aurora', version: '1' },
    }).then(() => {
      notify('initialized', {});
      ready = true;
      initSettled = true;
      // Respawn case: re-seed every doc the renderer still has open so
      // diagnostics resume without the renderer doing anything.
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
  // If the start fails, clear the memo so a later call retries from scratch.
  startPromise.catch(() => {}).then(() => { if (!ready) startPromise = null; });
  return startPromise;
}

async function ensureReady() {
  if (ready) return true;
  try { await start(); } catch { return false; }
  return ready;
}

// ── Document lifecycle (renderer-driven) ──────────────────────────────────────

async function didOpen(/** @type {string} */ uri, /** @type {string} */ text, /** @type {string} */ languageId) {
  if (typeof uri !== 'string' || typeof text !== 'string') return;
  const lang = languageId || 'verilog';
  if (!(await ensureReady())) return;
  if (openDocs.has(uri)) {
    // Already open (e.g. renderer reload), refresh the buffer instead of
    // re-opening, which some servers reject.
    return didChange(uri, text);
  }
  openDocs.set(uri, { version: 1, text, languageId: lang });
  notify('textDocument/didOpen', { textDocument: { uri, languageId: lang, version: 1, text } });
}

async function didChange(/** @type {string} */ uri, /** @type {string} */ text) {
  if (typeof uri !== 'string' || typeof text !== 'string') return;
  if (!(await ensureReady())) return;
  const doc = openDocs.get(uri);
  if (!doc) {
    // Server (re)started or change arrived before open, open it.
    openDocs.set(uri, { version: 1, text, languageId: 'verilog' });
    notify('textDocument/didOpen', { textDocument: { uri, languageId: 'verilog', version: 1, text } });
    return;
  }
  doc.version += 1;
  doc.text = text;
  // Full-document sync: a single change with no `range` is the LSP's
  // whole-buffer replacement form, valid regardless of the server's
  // advertised sync kind, and Verible re-parses the whole file anyway.
  notify('textDocument/didChange', {
    textDocument: { uri, version: doc.version },
    contentChanges: [{ text }],
  });
}

async function didClose(/** @type {string} */ uri) {
  if (typeof uri !== 'string') return;
  openDocs.delete(uri);
  if (ready) notify('textDocument/didClose', { textDocument: { uri } });
  // Drop any markers the renderer is still showing for this buffer.
  sendMain('lsp:diagnostics', { uri, diagnostics: [] });
}

// ── On-demand requests ────────────────────────────────────────────────────────

async function safeRequest(/** @type {string} */ method, /** @type {any} */ params, /** @type {any} */ fallback) {
  if (!(await ensureReady())) return fallback;
  try { return await request(method, params); }
  catch (e) {
    log.warn(`[verible-ls] ${method} failed:`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

function format(/** @type {string} */ uri) {
  return safeRequest('textDocument/formatting', {
    textDocument: { uri },
    options: { tabSize: 2, insertSpaces: true },
  }, null);
}

function documentSymbols(/** @type {string} */ uri) {
  return safeRequest('textDocument/documentSymbol', { textDocument: { uri } }, null);
}

function hover(/** @type {string} */ uri, /** @type {any} */ position) {
  return safeRequest('textDocument/hover', { textDocument: { uri }, position }, null);
}

function definition(/** @type {string} */ uri, /** @type {any} */ position) {
  return safeRequest('textDocument/definition', { textDocument: { uri }, position }, null);
}

function references(/** @type {string} */ uri, /** @type {any} */ position) {
  return safeRequest('textDocument/references', {
    textDocument: { uri }, position, context: { includeDeclaration: true },
  }, null);
}

// ── IPC registration ──────────────────────────────────────────────────────────

function register() {
  ipcMain.handle('lsp:status', () => ({ installed: binInstalled(), ready }));
  ipcMain.handle('lsp:did-open', (_e, { uri, text, languageId } = {}) => didOpen(uri, text, languageId));
  ipcMain.handle('lsp:did-change', (_e, { uri, text } = {}) => didChange(uri, text));
  ipcMain.handle('lsp:did-close', (_e, { uri } = {}) => didClose(uri));
  ipcMain.handle('lsp:format', (_e, { uri } = {}) => format(uri));
  ipcMain.handle('lsp:document-symbols', (_e, { uri } = {}) => documentSymbols(uri));
  ipcMain.handle('lsp:hover', (_e, { uri, position } = {}) => hover(uri, position));
  ipcMain.handle('lsp:definition', (_e, { uri, position } = {}) => definition(uri, position));
  ipcMain.handle('lsp:references', (_e, { uri, position } = {}) => references(uri, position));
}

module.exports = { register };
