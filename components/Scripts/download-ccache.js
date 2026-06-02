// @ts-check
/**
 * Aurora IDE — ccache bootstrap
 *
 * Downloads the official ccache Windows build and drops `ccache.exe` next to
 * g++/make inside the Verilator bundle (components/Packages/verilator/mingw64/
 * bin). The compile executor sets OBJCACHE=ccache for Verilator build steps
 * whenever it finds ccache.exe on that dir (see main/compile/executor.js), so
 * Verilator's generated Makefile routes every object compile through ccache —
 * repeat builds that only changed the .cmm/testbench become near-instant.
 *
 * Opt-in and fully non-fatal: if the download fails or the Verilator bundle
 * isn't installed, Aurora compiles exactly as before (the executor simply never
 * sets OBJCACHE). It only needs to live wherever `components/` goes, and the
 * bootstrap runs it before copy-components so the file propagates to the
 * electron dist (and the packaged build's extraResources) automatically.
 *
 * Usage:  node components/Scripts/download-ccache.js [--force]
 */

const fs = require('fs');
const path = require('path');
const { downloadFile, extractZip } = require('./download-toolchain');

// Pinned ccache release. Bump deliberately — newer ccache occasionally changes
// the Windows asset name, which the recursive ccache.exe search below tolerates.
const CCACHE_VERSION = '4.10.2';
const ASSET = `ccache-${CCACHE_VERSION}-windows-x86_64`;
const DOWNLOAD_URL = `https://github.com/ccache/ccache/releases/download/v${CCACHE_VERSION}/${ASSET}.zip`;

const ROOT_DIR = path.join(__dirname, '..', '..');
const VERILATOR_BIN = path.join(ROOT_DIR, 'components', 'Packages', 'verilator', 'mingw64', 'bin');
const TARGET = path.join(VERILATOR_BIN, 'ccache.exe');
const TMP_ZIP = path.join(ROOT_DIR, `${ASSET}.zip`);
const TMP_DIR = path.join(ROOT_DIR, '.ccache-tmp');

function log(msg) { console.log(`[ccache] ${msg}`); }
function err(msg) { console.error(`[ccache] ERROR: ${msg}`); }

/** Depth-first search for a file named `name` under `dir`. */
function findFile(dir, name) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return null; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

async function main() {
  const force = process.argv.includes('--force');

  // The Verilator bundle owns the mingw64/bin dir. Without it there's nowhere
  // useful to put ccache (and no Verilator builds to accelerate), so skip.
  if (!fs.existsSync(VERILATOR_BIN)) {
    log('Verilator bundle not present — skipping ccache (nothing to accelerate).');
    return;
  }
  if (fs.existsSync(TARGET) && !force) {
    log('ccache already present — skipping.');
    return;
  }

  try {
    await downloadFile(DOWNLOAD_URL, TMP_ZIP);
    extractZip(TMP_ZIP, TMP_DIR);
    const found = findFile(TMP_DIR, 'ccache.exe');
    if (!found) throw new Error('ccache.exe not found inside the downloaded archive');
    fs.copyFileSync(found, TARGET);
    log(`ccache ${CCACHE_VERSION} installed → ${TARGET}`);
  } catch (e) {
    err(`ccache install failed (non-fatal): ${e.message}`);
    err('Aurora will compile normally without object caching. To enable it,');
    err(`download ${DOWNLOAD_URL}`);
    err(`and place ccache.exe in: ${VERILATOR_BIN}`);
  } finally {
    try { fs.rmSync(TMP_ZIP, { force: true }); } catch { /* best-effort cleanup */ }
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

// Only run when invoked directly; importing for tests must not trigger a fetch.
if (require.main === module) {
  main();
}

module.exports = { main, DOWNLOAD_URL, CCACHE_VERSION, TARGET, VERILATOR_BIN };
