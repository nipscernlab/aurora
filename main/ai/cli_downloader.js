// @ts-check
/**
 * cli_downloader.js: fetches the Claude Code / Codex native CLIs on demand (B12).
 *
 * The subscription CLIs are no longer bundled in the installer (they were
 * ~460 MB). The first time a user actually runs a turn against Claude Code or
 * Codex, we download the pinned platform package from the npm registry, verify
 * its Subresource-Integrity hash, extract it into a per-user cache, and resolve
 * the native binary from there. Subsequent runs (and app restarts) hit the
 * cache with no network.
 *
 *   <userData>/cli-cache/<pkg>@<version>/<exe>      ← sentinel = the exe itself
 *
 * Design notes:
 *   - Integrity is verified BEFORE extraction (a mismatch aborts), mirroring the
 *     SHA-256 discipline of the components/Scripts/download-*.js bootstrappers.
 *   - Extraction uses the system `tar` (ships on Windows 10+, macOS and Linux);
 *     npm tarballs are gzip+tar with a leading `package/` dir → `--strip-components=1`.
 *   - Concurrent ensureCli() calls for the same CLI share one download (dedupe).
 *   - In dev / unit tests there is no Electron `app`; the cache root falls back
 *     to the OS temp dir, or an explicit `AURORA_CLI_CACHE` override.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { entryFor, platformKey } = require('./cli_manifest');

let log;
try { log = require('electron-log'); } catch (_) { log = console; }

/** Root dir for downloaded CLIs: <userData>/cli-cache, or an override. */
function cliCacheRoot() {
  if (process.env.AURORA_CLI_CACHE) return process.env.AURORA_CLI_CACHE;
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'cli-cache');
    }
  } catch (_) { /* not running under Electron (scripts / tests) */ }
  return path.join(os.tmpdir(), 'aurora-cli-cache');
}

function fileExists(/** @type {string | null | undefined} */ p) {
  try { return !!p && fs.statSync(p).isFile(); }
  catch (_) { return false; }
}

/**
 * Absolute paths for a CLI's cache install (whether present yet or not).
 * @param {'claude'|'codex'} kind
 * @returns {{entry:any, dir:string, exe:string, rgDir:string|null}|null}
 */
function installPaths(kind) {
  const entry = entryFor(kind);
  if (!entry) return null;
  // e.g. anthropic-ai-claude-code-win32-x64@2.1.144
  const safe = entry.pkg.replace(/^@/, '').replace(/\//g, '-');
  const dir = path.join(cliCacheRoot(), `${safe}@${entry.version}`);
  const exe = path.join(dir, ...entry.exe.split('/'));
  const rgDir = entry.rg ? path.join(dir, ...entry.rg.split('/')) : null;
  return { entry, dir, exe, rgDir };
}

/** True when this CLI has a download manifest entry for the current platform. */
function isDownloadable(/** @type {'claude'|'codex'} */ kind) {
  return !!entryFor(kind);
}

/**
 * Sync cache lookup, the resolved binary shape (same as cli_locator) if the
 * CLI is already downloaded, else null.
 * @param {'claude'|'codex'} kind
 * @returns {{exe:string, rgDir:string|null, viaShim:boolean}|null}
 */
function cachedLocation(kind) {
  const ip = installPaths(kind);
  if (ip && fileExists(ip.exe)) {
    return { exe: ip.exe, rgDir: ip.rgDir, viaShim: false };
  }
  return null;
}

/** Compare a download's bytes against a "sha512-<base64>" integrity string. */
function integrityMatches(/** @type {Buffer|string} */ digestBase64, /** @type {string} */ integrity) {
  const s = String(integrity || '');
  if (!s.startsWith('sha512-')) return false; // reject malformed / unprefixed integrity
  const expected = s.slice('sha512-'.length);
  return !!expected && String(digestBase64) === expected;
}

/**
 * Download `url` to `dest`, streaming through a SHA-512 hash. Follows redirects
 * (the registry CDN issues them). Resolves with the base64 SHA-512 of the body.
 *
 * @param {string} url
 * @param {string} dest
 * @param {(received:number, total:number)=>void} [onChunk]
 * @returns {Promise<{sha512:string}>}
 */
function downloadToFile(url, dest, onChunk) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const hash = crypto.createHash('sha512');
    let settled = false;
    const done = (/** @type {Error|null} */ err, /** @type {any} */ val) => {
      if (settled) return;
      settled = true;
      if (err) { try { fs.unlinkSync(dest); } catch (_) { /* best-effort */ } reject(err); }
      else resolve(val);
    };

    function request(/** @type {string} */ u, redirects = 0) {
      if (redirects > 5) { done(new Error('too many redirects')); return; }
      let parsed;
      try { parsed = new URL(u); }
      catch (e) { done(e instanceof Error ? e : new Error(String(e))); return; }

      const req = https.get({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': 'aurora-ide-cli-downloader', Accept: 'application/octet-stream' },
      }, (res) => {
        const code = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.resume();
          request(res.headers.location, redirects + 1);
          return;
        }
        if (code !== 200) {
          res.resume();
          done(new Error(`HTTP ${code} from ${u}`));
          return;
        }
        const total = parseInt(String(res.headers['content-length'] || '0'), 10);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          hash.update(chunk);
          if (onChunk) onChunk(received, total);
        });
        res.on('error', done);
        res.pipe(file);
      });
      req.on('error', done);
      // Idle-timeout the socket. A connection that stalls mid-body (captive
      // portal, dropped link that emits no socket 'error') would otherwise leave
      // the Promise unsettled forever, and a never-settled promise poisons the
      // in-flight dedupe Map, blocking every retry until the app restarts.
      // Destroying with an error settles `done` (reject), which unlinks the
      // partial file and lets ensureCli's .finally clear the dedupe entry.
      req.setTimeout(60000, () => req.destroy(new Error('download timed out (no data for 60s)')));
    }

    file.on('finish', () => file.close(() => done(null, { sha512: hash.digest('base64') })));
    file.on('error', done);
    request(url);
  });
}

/** Extract an npm .tgz into destDir, stripping the leading `package/` dir. */
function extractTgz(/** @type {string} */ tgz, /** @type {string} */ destDir) {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', tgz, '--strip-components=1', '-C', destDir], { windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) reject(new Error(`tar extract failed: ${String(stderr || err.message).trim()}`));
        else resolve(undefined);
      });
  });
}

function rmrf(/** @type {string} */ p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

/**
 * Best-effort sweep of stale version dirs for the same package after a fresh
 * install. The cache dir embeds the version (`<safe-pkg>@<version>`), so a
 * manifest bump orphans the old extracted tree (~70–240 MB). Never throws, a
 * locked old exe on Windows is fine to leave for the next run.
 */
function pruneStaleVersions(/** @type {string} */ keepDir) {
  try {
    const root = cliCacheRoot();
    const keep = path.basename(keepDir);
    const prefix = keep.replace(/@[^@]*$/, '@'); // "<safe-pkg>@"
    if (prefix === keep) return;                 // no version segment — bail, don't over-match
    for (const name of fs.readdirSync(root)) {
      if (name !== keep && name.startsWith(prefix)) rmrf(path.join(root, name));
    }
  } catch (_) { /* best-effort */ }
}

/** @type {Map<string, Promise<any>>} */
const inFlight = new Map();

/**
 * Ensure the CLI is present, downloading + extracting it on first use. Returns
 * the resolved binary shape (same as cli_locator), or throws on failure.
 *
 * @param {'claude'|'codex'} kind
 * @param {{onProgress?: (p:{kind:string, phase:string, pct:number, received?:number, total?:number})=>void}} [opts]
 * @returns {Promise<{exe:string, rgDir:string|null, viaShim:boolean}>}
 */
async function ensureCli(kind, opts = {}) {
  const hit = cachedLocation(kind);
  if (hit) return hit;
  const pending = inFlight.get(kind);
  if (pending) return pending;
  const job = _download(kind, opts).finally(() => inFlight.delete(kind));
  inFlight.set(kind, job);
  return job;
}

async function _download(/** @type {'claude'|'codex'} */ kind, /** @type {any} */ opts) {
  const ip = installPaths(kind);
  if (!ip) throw new Error(`no on-demand CLI for "${kind}" on ${platformKey()}`);
  const { entry, dir, exe, rgDir } = ip;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  fs.mkdirSync(cliCacheRoot(), { recursive: true });
  const tmpTgz = path.join(cliCacheRoot(), `.${entry.pkg.replace(/[^\w.-]/g, '_')}-${entry.version}.${process.pid}.tgz`);

  try {
    onProgress({ kind, phase: 'download', pct: 0, received: 0, total: 0 });
    const { sha512 } = await downloadToFile(entry.tarball, tmpTgz, (received, total) => {
      const pct = total > 0 ? Math.round((received / total) * 100) : 0;
      onProgress({ kind, phase: 'download', pct, received, total });
    });

    onProgress({ kind, phase: 'verify', pct: 100 });
    if (!integrityMatches(sha512, entry.integrity)) {
      throw new Error(`integrity mismatch for ${entry.pkg}@${entry.version}`);
    }

    onProgress({ kind, phase: 'extract', pct: 100 });
    rmrf(dir);                                   // never extract over a partial install
    fs.mkdirSync(dir, { recursive: true });
    await extractTgz(tmpTgz, dir);

    if (!fileExists(exe)) {
      throw new Error(`extracted ${entry.pkg} but expected binary "${entry.exe}" is missing`);
    }

    pruneStaleVersions(dir); // drop superseded version dirs from earlier bumps
    onProgress({ kind, phase: 'done', pct: 100 });
    log.info(`[cli-downloader] installed ${entry.pkg}@${entry.version} → ${dir}`);
    return { exe, rgDir, viaShim: false };
  } finally {
    try { fs.unlinkSync(tmpTgz); } catch (_) { /* best-effort */ }
  }
}

module.exports = {
  ensureCli,
  cachedLocation,
  installPaths,
  isDownloadable,
  cliCacheRoot,
  integrityMatches,
};
