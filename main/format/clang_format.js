// @ts-check
/**
 * clang_format.js — C/C++/CMM document formatter for the Monaco editor.
 *
 * clang-format isn't a language server: it's a one-shot CLI that reads a
 * buffer on stdin and writes the formatted buffer on stdout. So this module
 * is much thinner than the Verible LSP bridge — per Shift+Alt+F, the
 * renderer (js/editor/clang_format_integration.js) sends the buffer here,
 * we spawn the bundled clang-format (components/Packages/clang-format/bin,
 * via download-clang-format.js), pipe the text through, and return the
 * formatted text for a full-document replace.
 *
 * Language handling via `-assume-filename`: CMM (a C-subset) is formatted
 * with C rules by claiming a `.c` filename; C/C++ use the real path so
 * clang-format detects the dialect AND finds a project `.clang-format`
 * upward (with `-style=file -fallback-style=LLVM`). Best-effort throughout:
 * if the binary is missing or clang-format errors, format() resolves null
 * and the editor leaves the buffer untouched.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const log = require('electron-log');

const { componentsPath } = require('../paths');
const { spawnTracked } = require('../process_registry');
const { isAllowed } = require('../compile/binary_allowlist');

const CF_BIN = path.join(componentsPath, 'Packages', 'clang-format', 'bin', 'clang-format.exe');

// clang-format is fast; this only guards against a pathological hang so a
// stuck format never wedges the editor's format action.
const FORMAT_TIMEOUT_MS = 15000;

function binInstalled() {
  try { return fs.existsSync(CF_BIN); } catch { return false; }
}

/**
 * The `-assume-filename` value: drives both dialect detection and the
 * upward `.clang-format` search. CMM borrows C rules via a `.c` extension.
 * @param {string} languageId
 * @param {string} filePath
 */
function assumeFilenameFor(languageId, filePath) {
  const dir = filePath ? path.dirname(filePath) : componentsPath;
  if (languageId === 'cmm') {
    const base = filePath ? path.basename(filePath, path.extname(filePath)) : 'buffer';
    return path.join(dir, `${base}.c`); // CMM → C rules
  }
  if (filePath) return filePath; // c / cpp: real path keeps the dialect + finds config
  return path.join(dir, languageId === 'cpp' ? 'buffer.cpp' : 'buffer.c');
}

/**
 * @param {{languageId?:string, filePath?:string, text?:string}} payload
 * @returns {Promise<string|null>} formatted text, or null on any failure
 */
function format({ languageId, filePath, text } = {}) {
  if (typeof text !== 'string') return Promise.resolve(null);
  if (!binInstalled()) return Promise.resolve(null);

  // Defense in depth: same allowlist gate the toolchain executor uses.
  const verdict = isAllowed(CF_BIN);
  if (!verdict.ok) { log.warn('[clang-format]', verdict.error); return Promise.resolve(null); }

  const assume = assumeFilenameFor(languageId || 'c', filePath || '');
  const args = [`-assume-filename=${assume}`, '-style=file', '-fallback-style=LLVM'];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnTracked(CF_BIN, args, { windowsHide: true });
    } catch (e) {
      log.warn('[clang-format] spawn failed:', e instanceof Error ? e.message : e);
      resolve(null);
      return;
    }

    let out = '';
    let errOut = '';
    let settled = false;
    const done = (/** @type {string|null} */ value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      log.warn('[clang-format] timed out — killing');
      try { child.kill(); } catch { /* ignore */ }
      done(null);
    }, FORMAT_TIMEOUT_MS);

    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { errOut += d.toString('utf8'); });
    child.on('error', (e) => {
      log.warn('[clang-format] process error:', e instanceof Error ? e.message : e);
      done(null);
    });
    child.on('close', (code) => {
      if (code === 0 && out) done(out);
      else {
        if (code !== 0) log.warn(`[clang-format] exit ${code}: ${errOut.slice(0, 500)}`);
        done(null);
      }
    });

    // Feed the buffer on stdin. Guard against EPIPE if clang-format bailed
    // before reading (e.g. bad args) — the 'error'/'close' path resolves it.
    try {
      child.stdin.on('error', () => { /* EPIPE handled via close */ });
      child.stdin.write(text);
      child.stdin.end();
    } catch { /* settled by error/close */ }
  });
}

function register() {
  ipcMain.handle('format:clang', (_e, payload) => format(payload));
  ipcMain.handle('format:clang-status', () => ({ installed: binInstalled() }));
}

module.exports = { register };
