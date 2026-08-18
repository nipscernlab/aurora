// @ts-check
/**
 * search.js: project-wide "Find in Files" IPC (VS Code's Search panel).
 *
 * A dependency-free, synchronous recursive scan rooted at the OPEN PROJECT'S
 * directory (state.currentOpenProjectPath, the single source of truth, see A4).
 * Synchronous fs is fine at project scale and keeps the walk simple; the caps
 * below bound the worst case so a huge tree can never freeze the main process.
 *
 * Channel: ipcMain.handle('search:in-project', (_e, payload) => …)
 *   payload: { query, caseSensitive?, wholeWord?, regex? }
 *   resolves: { ok:true, results, total, truncated } | { ok:false, error }
 */

const path = require('path');
const fs = require('fs');

const state = require('../state');

/** The open project's directory, or null when no project is open. */
function projectDir() {
  return state.currentOpenProjectPath ? path.dirname(state.currentOpenProjectPath) : null;
}

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
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the search RegExp from the user's query + toggles.
 * Throws on an invalid user-supplied pattern (regex mode), the caller turns
 * that into { ok:false, error }.
 */
function buildRegex(query, { caseSensitive, wholeWord, regex }) {
  let body = regex ? String(query) : escapeRegExp(query);
  if (wholeWord) body = `\\b${body}\\b`;
  const flags = 'g' + (caseSensitive ? '' : 'i');
  return new RegExp(body, flags);
}

/** Heuristic binary sniff: a NUL byte in the first 4 KB ⇒ treat as binary. */
function looksBinary(absPath) {
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

function register() {
  const { ipcMain } = require('electron');

  ipcMain.handle('search:in-project', async (_e, payload) => {
    const { query, caseSensitive, wholeWord, regex } = payload || {};
    if (!query || typeof query !== 'string') {
      return { ok: true, results: [], total: 0, truncated: false };
    }

    const rootDir = projectDir();
    if (!rootDir || !fs.existsSync(rootDir)) {
      return { ok: false, error: 'No project open' };
    }

    let re;
    try {
      re = buildRegex(query, { caseSensitive: !!caseSensitive, wholeWord: !!wholeWord, regex: !!regex });
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
  });
}

// buildRegex e escapeRegExp sao exportados para teste. Eles transformam o que o
// usuario digita na caixa de busca em RegExp, e sao o ponto onde um caractere
// especial vira comportamento inesperado. Ver tests/unit/searchQuery.test.js.
module.exports = { register, buildRegex, escapeRegExp };
