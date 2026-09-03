// @ts-check
/**
 * search_core.js: a varredura da busca no projeto, sem Electron e sem IPC.
 *
 * Extraida de search.js em 03/09/2026 para rodar num worker thread: a
 * varredura era sincrona no processo principal, e regex vinda do usuario ia
 * direto para `new RegExp`, entao um padrao com retrocesso catastrofico (ou um
 * projeto grande) congelava TODAS as janelas ate terminar. Aqui dentro tudo
 * continua sincrono de proposito, porque simples e rapido; quem paga o preco
 * agora e o thread do worker, que o search.js encerra se passar do prazo.
 *
 * As pecas puras (buildRegex, escapeRegExp) continuam exportadas pelo
 * search.js para o teste que ja existia.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ── walk limits ─────────────────────────────────────────────────────────────
const MAX_DEPTH = 12;
const MAX_FILE_BYTES = 1.5 * 1024 * 1024; // ~1.5 MB — skip anything bigger
const BINARY_SNIFF_BYTES = 4096;          // read first 4 KB to detect NUL bytes
const PREVIEW_MAX = 240;                  // trim each preview line to ~240 chars
const MAX_MATCHES = 2000;                 // stop after this many matches total
const MAX_FILES = 500;                    // …or after this many matching files

// Directories we never descend into, VCS, deps, build output, vendored assets.
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'components', 'Temp', 'Backup', '.vite',
]);

/** Escape a string so it matches literally inside a RegExp. */
function escapeRegExp(/** @type {unknown} */ s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the search RegExp from the user's query + toggles.
 * Throws on an invalid user-supplied pattern (regex mode), the caller turns
 * that into { ok:false, error }.
 * @param {string} query
 * @param {{ caseSensitive?: boolean, wholeWord?: boolean, regex?: boolean }} opts
 */
function buildRegex(query, { caseSensitive, wholeWord, regex }) {
  let body = regex ? String(query) : escapeRegExp(query);
  if (wholeWord) body = `\\b${body}\\b`;
  const flags = 'g' + (caseSensitive ? '' : 'i');
  return new RegExp(body, flags);
}

/** Heuristic binary sniff: a NUL byte in the first 4 KB ⇒ treat as binary. */
function looksBinary(/** @type {string} */ absPath) {
  let fd = -1;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
    const read = fs.readSync(fd, buf, 0, BINARY_SNIFF_BYTES, 0);
    for (let i = 0; i < read; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch (_) {
    return true; // unreadable — safest to skip
  } finally {
    if (fd >= 0) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
  }
}

/**
 * Scan one file's text for matches. `re` is reused across lines; we reset
 * lastIndex per line because it carries the global flag.
 * @param {string} absPath
 * @param {RegExp} re
 * @param {{ matches: number, truncated: boolean }} budget
 * @returns {Array<{line:number,col:number,preview:string}>}
 */
function scanFile(absPath, re, budget) {
  let text;
  try { text = fs.readFileSync(absPath, 'utf8'); } catch (_) { return []; }
  const out = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(line)) !== null) {
      out.push({
        line: i + 1,
        col: m.index + 1,
        preview: line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX)}…` : line,
      });
      budget.matches += 1;
      if (budget.matches >= MAX_MATCHES) { budget.truncated = true; return out; }
      // Zero-width match (e.g. an empty-alternation regex): advance manually so
      // we don't spin forever on the same index.
      if (m.index === re.lastIndex) re.lastIndex += 1;
      if (++guard > 5000) break; // pathological line guard
    }
  }
  return out;
}

/**
 * Recursive directory walk. Mutates `results` and `budget`. Stops early once a
 * cap is hit (budget.truncated flips true).
 * @param {string} dir
 * @param {string} rootDir
 * @param {number} depth
 * @param {RegExp} re
 * @param {any[]} results
 * @param {{ matches: number, truncated: boolean }} budget
 */
function walk(dir, rootDir, depth, re, results, budget) {
  if (depth > MAX_DEPTH || budget.truncated) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const ent of entries) {
    if (budget.truncated) return;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(abs, rootDir, depth + 1, re, results, budget);
      continue;
    }
    if (!ent.isFile()) continue;

    let st;
    try { st = fs.statSync(abs); } catch (_) { continue; }
    if (st.size > MAX_FILE_BYTES) continue;
    if (looksBinary(abs)) continue;

    const matches = scanFile(abs, re, budget);
    if (matches.length) {
      const rel = path.relative(rootDir, abs).split(path.sep).join('/');
      results.push({ file: rel, abs, matches });
      if (results.length >= MAX_FILES) { budget.truncated = true; return; }
    }
  }
}

/**
 * A busca inteira, sincrona: monta o RegExp e varre `rootDir`.
 * @param {string} rootDir
 * @param {{ query: string, caseSensitive?: boolean, wholeWord?: boolean, regex?: boolean }} payload
 * @returns {{ ok: true, results: any[], total: number, truncated: boolean } | { ok: false, error: string }}
 */
function buscar(rootDir, payload) {
  const { query, caseSensitive, wholeWord, regex } = payload || {};
  let re;
  try {
    re = buildRegex(String(query), { caseSensitive: !!caseSensitive, wholeWord: !!wholeWord, regex: !!regex });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const results = [];
  const budget = { matches: 0, truncated: false };
  try {
    walk(rootDir, rootDir, 0, re, results, budget);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, results, total: budget.matches, truncated: budget.truncated };
}

module.exports = { buscar, buildRegex, escapeRegExp };
