// @ts-check
/**
 * temp_gc.js: universal best-effort temp hygiene, run once at startup.
 *
 * Aurora scatters scratch in a few places. The components/Temp tree is wiped on
 * quit (main/lifecycle.js) AND on startup (clearTempFolderSync below), the quit
 * wipe is the common path; the startup wipe closes the crash gap, where a hard
 * crash leaves the last session's scratch behind until the next clean quit. The
 * AI image attachments are cleared at startup + TTL-pruned per write
 * (main/ai/attachments). This module also prunes the per-turn MCP config files
 * Claude Code writes, `aurora-mcp-<pid>.json` in the OS temp dir, which were
 * never cleaned and piled up. All startup temp GC lives here.
 *
 * pruneMcpConfigs / attachment cleanup are best-effort and non-blocking (queued
 * off the boot path via setImmediate). clearTempFolderSync is synchronous by
 * design: the caller runs it before the main window exists, so the wipe is
 * ordered strictly before any build can write into Temp (see main.js). It must
 * never throw, the caller wraps it best-effort.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('electron-log');

/**
 * Prune stale `aurora-mcp-<pid>.json` files in the OS temp dir. The
 * single-instance lock means any such file present at startup belongs to a dead
 * process; the TTL is a guard for the rare second-instance case.
 * @param {number} [maxAgeMs]
 */
function pruneMcpConfigs(maxAgeMs = 60 * 60 * 1000) {
  const dir = os.tmpdir();
  const now = Date.now();
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  for (const name of names) {
    if (!/^aurora-mcp-\d+\.json$/.test(name)) continue;
    const f = path.join(dir, name);
    try {
      if (now - fs.statSync(f).mtimeMs >= maxAgeMs) fs.unlinkSync(f);
    } catch (_) { /* skip a file we can't stat/remove */ }
  }
}

/**
 * Wipe and recreate the components/Temp scratch tree, synchronously.
 *
 * The quit-time wipe (main/lifecycle.js) is the normal path; this is the
 * crash net: on a clean quit Temp is already empty, so this is near-instant,
 * but after a hard crash it clears the survivors before anything reads them.
 *
 * MUST be called at startup BEFORE the main window exists, no build can be
 * running yet (single-instance lock held, renderer not created), so there are
 * no open handles to race and a synchronous wipe is safe and correctly ordered.
 * Recreates the empty dir so downstream code can assume Temp exists.
 *
 * @param {string} componentsPath
 */
function clearTempFolderSync(componentsPath) {
  if (!componentsPath) return;
  const tempFolderPath = path.join(componentsPath, 'Temp');
  try {
    fs.rmSync(tempFolderPath, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    log.warn('[temp-gc] startup Temp wipe failed:', e instanceof Error ? e.message : e);
  }
  try {
    fs.mkdirSync(tempFolderPath, { recursive: true });
  } catch (_) { /* best-effort: compile flows mkdir their subdirs anyway */ }
}

/** Run every startup temp cleanup once, off the boot critical path. */
function runStartupGC() {
  setImmediate(() => {
    try { pruneMcpConfigs(); }
    catch (e) { log.warn('[temp-gc] mcp prune failed:', e instanceof Error ? e.message : e); }
    // AI image attachments are one-shot per turn, anything left is carry-over.
    try { require('./ai/attachments').cleanupTempImages(0); } catch (_) { /* best-effort */ }
  });
}

module.exports = { runStartupGC, pruneMcpConfigs, clearTempFolderSync };
