// @ts-check
/**
 * temp_gc.js — universal best-effort temp hygiene, run once at startup.
 *
 * Aurora scatters scratch in a few places. Most are already covered: the
 * components/Temp tree is wiped on quit (main/lifecycle.js), and the AI image
 * attachments are cleared at startup + TTL-pruned per write (main/ai/attachments).
 * The gap this closes is the per-turn MCP config files Claude Code writes —
 * `aurora-mcp-<pid>.json` in the OS temp dir — which were NEVER cleaned and piled
 * up across crashes / restarts. The attachment cleanup is driven from here too so
 * all startup temp GC lives in one place.
 *
 * Everything here is best-effort and non-blocking (queued off the boot path via
 * setImmediate); it must never delay boot/quit or throw.
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

/** Run every startup temp cleanup once, off the boot critical path. */
function runStartupGC() {
  setImmediate(() => {
    try { pruneMcpConfigs(); }
    catch (e) { log.warn('[temp-gc] mcp prune failed:', e instanceof Error ? e.message : e); }
    // AI image attachments are one-shot per turn — anything left is carry-over.
    try { require('./ai/attachments').cleanupTempImages(0); } catch (_) { /* best-effort */ }
  });
}

module.exports = { runStartupGC, pruneMcpConfigs };
