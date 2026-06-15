// @ts-check
/**
 * Shared helpers for the project IPC handlers: the .spf `ProjectFile`
 * schema, the path-remapping functions used by the open/rename flows, and
 * the watcher-release / move-with-retry utilities the folder renames need.
 *
 * Split out of the old single-file project.js (2026-06) so the handler
 * groups (lifecycle / processors / rename) can share them without
 * duplication. Pure-ish: the remap functions are pure; releaseWatchersUnder
 * touches the shared watcher state, moveWithRetry hits the filesystem.
 */

const path = require('path');
const fse = require('fs-extra');
const os = require('os');
const { app } = require('electron');

const state = require('../../state');

// ---- ProjectFile schema ----

class ProjectFile {
  constructor(/** @type {any} */ projectPath) {
    this.metadata = {
      projectName: path.basename(projectPath),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      computerName: process.env.COMPUTERNAME || os.hostname(),
      appVersion: app.getVersion(),
      projectPath,
    };
    this.structure = {
      basePath: projectPath,
      processors: [],
      folders: [],
      topLevelFile: '',
      testbenchFile: '',
      synthesizableFiles: [],
      testbenchFiles: [],
    };
  }

  toJSON() {
    return {
      metadata: this.metadata,
      structure: this.structure,
    };
  }
}

/**
 * Remap a single absolute path that lived under a processor's working
 * directory when that processor is renamed `oldName` → `newName`.
 *
 * Only paths *inside* `<projectDir>/<oldName>/` are touched. The directory
 * prefix is rewritten, and the basename is swapped only when it is one of
 * SAPHO's processor-named build artifacts (`<old>.cmm`, `<old>.asm`,
 * `<old>.v`, `<old>_tb.v`). User-named files inside the folder keep their
 * basename — they just follow the folder to its new location. Paths outside
 * the processor folder are returned unchanged.
 */
function remapProcessorPath(/** @type {any} */ p, /** @type {any} */ projectDir, /** @type {any} */ oldName, /** @type {any} */ newName) {
  if (!p || typeof p !== 'string') return p;
  const toNative = (/** @type {any} */ s) => s.replace(/\//g, path.sep);
  const native = toNative(p);
  const oldDir = toNative(path.join(projectDir, oldName));
  const lower = native.toLowerCase();
  const oldLower = oldDir.toLowerCase();
  const inside = lower === oldLower || lower.startsWith(oldLower + path.sep.toLowerCase());
  if (!inside) return p;

  const rest = native.slice(oldDir.length); // '' or '\Hardware\old.v'
  let out = path.join(projectDir, newName) + rest;

  // Swap the proc-named SAPHO artifacts in the basename only.
  const dir = path.dirname(out);
  const base = path.basename(out);
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const swapped = base.replace(
    new RegExp(`^${escaped}(_tb)?(\\.v|\\.sv|\\.asm|\\.cmm)$`, 'i'),
    (_m, tb, ext) => `${newName}${tb || ''}${ext}`,
  );
  return out === native && swapped === base ? out : path.join(dir, swapped);
}

/**
 * Rewrite an absolute path that lived under `oldRoot` to sit under
 * `newRoot` instead. Case-insensitive prefix match (Windows). Anything
 * outside `oldRoot` is returned verbatim. Used when a whole project folder
 * is renamed.
 */
function remapRootPath(/** @type {any} */ p, /** @type {any} */ oldRoot, /** @type {any} */ newRoot) {
  if (!p || typeof p !== 'string') return p;
  const native = p.replace(/\//g, path.sep);
  const oldN = oldRoot.replace(/\//g, path.sep);
  const lower = native.toLowerCase();
  const oldLower = oldN.toLowerCase();
  if (lower === oldLower) return newRoot;
  if (lower.startsWith(oldLower + path.sep.toLowerCase())) {
    return newRoot + native.slice(oldN.length);
  }
  return p;
}

/**
 * Deep-walk an object and remap every string value that points inside
 * `oldRoot` to `newRoot`. Catches every persisted absolute path in the
 * .spf (file lists, command-override cwd/env, …) so a project rename
 * leaves no stale path behind — "em todos os lugares necessários".
 */
function deepRemapPaths(/** @type {any} */ obj, /** @type {any} */ oldRoot, /** @type {any} */ newRoot) {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') obj[i] = remapRootPath(obj[i], oldRoot, newRoot);
      else deepRemapPaths(obj[i], oldRoot, newRoot);
    }
  } else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'string') obj[k] = remapRootPath(obj[k], oldRoot, newRoot);
      else deepRemapPaths(obj[k], oldRoot, newRoot);
    }
  }
}

/**
 * Close every chokidar watcher (directory + per-file) rooted inside
 * `rootDir` so the OS doesn't keep a handle on the folder we're about to
 * rename. Without this, a directory rename fails with EPERM/EBUSY on
 * Windows. The renderer re-establishes its watchers when it reopens the
 * project at the new path.
 */
async function releaseWatchersUnder(/** @type {any} */ rootDir) {
  const sep = path.sep.toLowerCase();
  const r = rootDir.replace(/\//g, path.sep).toLowerCase();
  const under = (/** @type {any} */ p) => {
    const n = String(p || '').replace(/\//g, path.sep).toLowerCase();
    return n === r || n.startsWith(r + sep);
  };
  // chokidar's close() can hang on Windows while the watched tree is mid-change;
  // if it wedges, a rename would stall until the IPC's tool timeout (the
  // "renomeação excedeu o tempo limite" symptom). Bound each close so handle
  // release is best-effort but never blocks the rename — moveWithRetry below
  // absorbs a lock that wasn't quite released in time.
  const closeBounded = (/** @type {any} */ watcher) => Promise.race([
    Promise.resolve().then(() => watcher.close()).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  // Close ALL matching watchers concurrently. Awaiting them one-at-a-time
  // serialized N watchers into N×1.5s of wedge time — on a project with many
  // files that alone overran the tool timeout, so the rename only "finished"
  // around the 120s mark and its success reply lost the race to the timer
  // (the "spins forever / false timeout" symptom). Firing them together
  // collapses the whole release to ~one 1.5s bound. Each map entry is deleted
  // only after its own close settles, so the maps stay consistent.
  const jobs = [];
  for (const [dirPath, info] of [...state.activeDirectoryWatchers.entries()]) {
    if (under(dirPath)) {
      jobs.push(closeBounded(info.watcher).then(() => {
        state.activeDirectoryWatchers.delete(dirPath);
        state.directoryStatsCache.delete(dirPath);
      }));
    }
  }
  for (const [filePath, info] of [...state.activeWatchers.entries()]) {
    if (under(info.filePath || filePath)) {
      jobs.push(closeBounded(info.watcher).then(() => {
        state.activeWatchers.delete(filePath);
      }));
    }
  }
  await Promise.all(jobs);
}

/** fse.move with a few quick retries — Windows AV/indexer can briefly lock. */
async function moveWithRetry(/** @type {any} */ from, /** @type {any} */ to, options = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fse.move(from, to, options);
      return;
    } catch (err) {
      lastErr = err;
      const ec = /** @type {NodeJS.ErrnoException} */ (err);
      if (ec && (ec.code === 'EPERM' || ec.code === 'EBUSY' || ec.code === 'ENOTEMPTY')) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

module.exports = {
  ProjectFile,
  remapProcessorPath,
  remapRootPath,
  deepRemapPaths,
  releaseWatchersUnder,
  moveWithRetry,
};
