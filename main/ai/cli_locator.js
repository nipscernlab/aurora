// @ts-check
/**
 * cli_locator.js: locates the Claude Code and Codex CLI executables.
 *
 * The CLIs are resolved across three runtime layouts, in priority order:
 *
 *   0. On-demand download cache (B12): the packaged installer no longer bundles
 *      these ~460 MB binaries. `cli_downloader` fetches the pinned platform
 *      package on first use into `<userData>/cli-cache/…`; once present it wins,
 *      so a downloaded CLI resolves with no further network on later runs.
 *
 *   1. Development (`electron .`): the CLIs live under the repo's
 *      `node_modules/` (still declared dependencies), reachable straight
 *      through `require.resolve`.
 *
 *   2. Packaged build with the dependency present (dev builds that skipped the
 *      B12 exclusion): code runs from inside `app.asar`. Native executables
 *      cannot be launched from an asar archive, so electron-builder unpacks
 *      them into a sibling `app.asar.unpacked/` tree. `require.resolve` and
 *      `fs` see the in-asar path transparently, but `child_process.spawn` does
 *      NOT, it needs the real on-disk path. `toUnpacked()` performs that rewrite.
 *
 *   3. A global install on PATH, last-resort fallback (covers a dev with their
 *      own `npm i -g` copy).
 *
 * Results are cached: resolution touches the filesystem and spawns `where`,
 * neither of which changes during an app run. `invalidate()` clears that cache
 * after a successful on-demand download so the freshly-installed CLI is seen.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Rewrite an `app.asar` path to its `app.asar.unpacked` sibling. No-op when
 * the path is not inside an asar archive (i.e. in development).
 */
function toUnpacked(/** @type {string} */ p) {
  if (!p) return p;
  const marker = `app.asar${path.sep}`;
  return p.includes(marker)
    ? p.replace(marker, `app.asar.unpacked${path.sep}`)
    : p;
}

function fileExists(/** @type {string | null | undefined} */ p) {
  try { return !!p && fs.statSync(p).isFile(); }
  catch (_) { return false; }
}

/** First hit for `name` on PATH via `where`/`which`, or null. */
function onPath(/** @type {string} */ name) {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(finder, [name], { encoding: 'utf-8' });
    const hits = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (process.platform !== 'win32') return hits[0] || null;
    // On Windows `where` lists every match; a `.cmd`/`.exe` shim is
    // spawnable, the bare POSIX shell-script shim is not, rank accordingly.
    const score = (/** @type {string} */ p) => {
      const l = p.toLowerCase();
      if (l.endsWith('.exe')) return 4;
      if (l.endsWith('.cmd')) return 3;
      if (l.endsWith('.bat')) return 2;
      if (l.endsWith('.ps1')) return 1;
      return 0;
    };
    let best = null, bestScore = -1;
    for (const h of hits) {
      const s = score(h);
      if (s > bestScore) { best = h; bestScore = s; }
    }
    return best;
  } catch (_) {
    return null;
  }
}

/**
 * Sync lookup in the on-demand download cache (B12), or null. Lazily required
 * so this module stays loadable without the downloader (and without Electron).
 * @param {'claude'|'codex'} kind
 * @returns {{exe:string, rgDir:string|null, viaShim:boolean}|null}
 */
function downloadedLocation(kind) {
  try { return require('./cli_downloader').cachedLocation(kind); }
  catch (_) { return null; }
}

// --- Claude Code -----------------------------------------------------------

/** @type {{exe:string, viaShim:boolean}|null|undefined} */
let claudeCache;

/**
 * Locate the Claude Code CLI. Prefers the copy bundled with Aurora.
 *
 * @returns {{exe:string, viaShim:boolean}|null}
 *   `exe`, path to spawn. `viaShim`, true when it is a `.cmd`/`.bat`/`.ps1`
 *   shim that must be launched through `cmd.exe` rather than directly.
 */
function locateClaude() {
  if (claudeCache !== undefined) return claudeCache;

  // 0. On-demand download cache (packaged builds fetch the CLI on first use).
  const cached = downloadedLocation('claude');
  if (cached) { claudeCache = { exe: cached.exe, viaShim: false }; return claudeCache; }

  // 1. Bundled dependency. The package's own postinstall drops a native
  //    binary into `bin/` (e.g. bin/claude.exe on Windows).
  try {
    const pkgJsonPath = require.resolve('@anthropic-ai/claude-code/package.json');
    // @ts-ignore -- .json import; resolveJsonModule não está no tsconfig do projeto
    const pkg = require('@anthropic-ai/claude-code/package.json');
    const dir = path.dirname(pkgJsonPath);
    const candidates = [
      pkg && pkg.bin && pkg.bin.claude,
      'bin/claude.exe',
      'bin/claude',
    ].filter(Boolean);
    for (const rel of candidates) {
      const exe = toUnpacked(path.join(dir, rel));
      if (fileExists(exe)) {
        claudeCache = { exe, viaShim: false };
        return claudeCache;
      }
    }
  } catch (_) { /* dependency absent — fall through to PATH */ }

  // 2. Global install on PATH.
  const hit = onPath('claude');
  claudeCache = hit ? { exe: hit, viaShim: /\.(cmd|bat|ps1)$/i.test(hit) } : null;
  return claudeCache;
}

// --- Codex -----------------------------------------------------------------

// platform:arch → { triple, pkg }, mirrors @openai/codex's own bin/codex.js
// launcher so we can resolve the native binary without going through it.
const CODEX_TARGETS = {
  'linux:x64':    { triple: 'x86_64-unknown-linux-musl',  pkg: '@openai/codex-linux-x64' },
  'linux:arm64':  { triple: 'aarch64-unknown-linux-musl', pkg: '@openai/codex-linux-arm64' },
  'darwin:x64':   { triple: 'x86_64-apple-darwin',        pkg: '@openai/codex-darwin-x64' },
  'darwin:arm64': { triple: 'aarch64-apple-darwin',       pkg: '@openai/codex-darwin-arm64' },
  'win32:x64':    { triple: 'x86_64-pc-windows-msvc',     pkg: '@openai/codex-win32-x64' },
  'win32:arm64':  { triple: 'aarch64-pc-windows-msvc',    pkg: '@openai/codex-win32-arm64' },
};

/** @type {{exe:string, rgDir:string|null, viaShim:boolean}|null|undefined} */
let codexCache;

/**
 * Locate the Codex CLI. Prefers the bundled native binary.
 *
 * @returns {{exe:string, rgDir:string|null, viaShim:boolean}|null}
 *   `exe`, path to spawn. `rgDir`, directory holding Codex's bundled
 *   ripgrep, which must be prepended to PATH so Codex's file search works
 *   (null when resolved off PATH). `viaShim`, see locateClaude.
 */
function locateCodex() {
  if (codexCache !== undefined) return codexCache;

  // 0. On-demand download cache (packaged builds fetch the CLI on first use).
  const cached = downloadedLocation('codex');
  if (cached) { codexCache = { exe: cached.exe, rgDir: cached.rgDir, viaShim: false }; return codexCache; }

  // 1. Bundled platform package: <pkg>/vendor/<triple>/codex/codex(.exe)
  //    with ripgrep alongside at <pkg>/vendor/<triple>/path/.
  const target = CODEX_TARGETS[/** @type {keyof typeof CODEX_TARGETS} */ (`${process.platform}:${process.arch}`)];
  if (target) {
    try {
      const pkgJsonPath = require.resolve(`${target.pkg}/package.json`);
      const vendorRoot = path.join(path.dirname(pkgJsonPath), 'vendor', target.triple);
      const exeName = process.platform === 'win32' ? 'codex.exe' : 'codex';
      const exe = toUnpacked(path.join(vendorRoot, 'codex', exeName));
      const rgDir = toUnpacked(path.join(vendorRoot, 'path'));
      if (fileExists(exe)) {
        codexCache = { exe, rgDir, viaShim: false };
        return codexCache;
      }
    } catch (_) { /* platform package absent — fall through to PATH */ }
  }

  // 2. Global install on PATH.
  const hit = onPath('codex');
  codexCache = hit
    ? { exe: hit, rgDir: null, viaShim: /\.(cmd|bat|ps1)$/i.test(hit) }
    : null;
  return codexCache;
}

/**
 * Drop the cached resolutions so the next locate*() re-scans. Called after a
 * successful on-demand download so the freshly-installed CLI is picked up.
 */
function invalidate() {
  claudeCache = undefined;
  codexCache = undefined;
}

module.exports = { locateClaude, locateCodex, toUnpacked, invalidate };
