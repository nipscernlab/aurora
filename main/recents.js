// @ts-check
/**
 * recents.js — tiny persistent store for "recently opened .spf files",
 * driven by the project-open IPC and surfaced in the Windows jumplist.
 *
 * Why a dedicated store: localStorage in the renderer already tracks
 * recents for the welcome screen, but main can't reach localStorage, and
 * Windows' shell-managed `frequent`/`recent` jumplist categories surface
 * stale "Electron" entries left over from earlier dev runs (before the
 * AppUserModelID fix landed). Owning the list in main lets us:
 *   1. Show exactly what the user sees on the welcome screen.
 *   2. Wipe the "Electron" leftovers (we just don't include them).
 *   3. Re-render the jumplist whenever the list changes.
 *
 * Storage: a single JSON file in userData. Capped at 10 entries — more
 * than Windows shows in the jumplist anyway. Each entry is the .spf
 * absolute path; the human-friendly name shown in the jumplist is
 * derived from the file name minus extension at render time so a
 * rename on disk doesn't poison the cache.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('electron-log');

const MAX_RECENTS = 10;

function storePath() {
  return path.join(app.getPath('userData'), 'aurora-recents.json');
}

function read() {
  try {
    const buf = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(buf);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch (e) {
    if (e && e.code !== 'ENOENT') log.warn('recents read failed:', e);
    return [];
  }
}

function write(list) {
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(list.slice(0, MAX_RECENTS), null, 2));
  } catch (e) {
    log.warn('recents write failed:', e);
  }
}

/**
 * Push `spfPath` to the top of the recents list (deduped, normalized).
 * Returns the resulting list so callers can chain straight into a
 * jumplist rebuild without doing a second read.
 */
function push(spfPath) {
  if (!spfPath || typeof spfPath !== 'string') return read();
  const normalized = path.resolve(spfPath);
  const cur = read().filter((p) => path.resolve(p) !== normalized);
  cur.unshift(normalized);
  const next = cur.slice(0, MAX_RECENTS);
  write(next);
  return next;
}

/** Prune entries whose .spf no longer exists on disk. */
function prune() {
  const cur = read();
  const kept = cur.filter((p) => {
    try { return fs.existsSync(p); }
    catch { return false; }
  });
  if (kept.length !== cur.length) write(kept);
  return kept;
}

module.exports = { read, push, prune, MAX_RECENTS };
