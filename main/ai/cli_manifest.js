// @ts-check
/**
 * cli_manifest.js: pinned download manifest for the on-demand AI CLIs (B12).
 *
 * Aurora used to BUNDLE the Claude Code and Codex native binaries inside the
 * installer (~460 MB unpacked between the two). They are now fetched on first
 * use instead: the installer ships without them and a user who never touches
 * the subscription CLIs never pays the download. This module pins exactly WHICH
 * npm platform package to fetch, its version, and its Subresource-Integrity
 * hash, per platform.
 *
 * Each platform package is the one that actually holds the native binary:
 *   - Claude:  @anthropic-ai/claude-code-win32-x64   → claude.exe at the root
 *   - Codex:   @openai/codex @ <ver>-win32-x64       → the alias target of the
 *              @openai/codex-win32-x64 optional dep; the native binary lives at
 *              vendor/<triple>/bin/codex.exe with bundled ripgrep em codex-path/.
 *
 * Versions MUST track the base packages declared in package.json
 * (@anthropic-ai/claude-code, @openai/codex). scripts/check-pinned-versions.js
 * fails CI if they drift. The `integrity` strings come straight from the npm
 * registry (`dist.integrity`); cli_downloader verifies the downloaded bytes
 * against them before extraction, so a tampered or truncated download aborts.
 *
 * To bump a CLI: change the base version in package.json and run `npm install`.
 * scripts/sync-cli-manifest.js (wired into `npm run bootstrap`, before the
 * check) rewrites the version constants and per-platform integrity hashes here
 * from package.json + package-lock.json automatically, so you normally don't
 * edit this file by hand. To do it manually, mirror the version and refresh the
 * tarball URL + integrity from the registry, e.g.
 *   npm view @anthropic-ai/claude-code-win32-x64@<ver> dist.integrity dist.tarball
 */

'use strict';

// Base versions, keep in lockstep with package.json dependencies.
const CLAUDE_VERSION = '2.1.226'; // @anthropic-ai/claude-code
const CODEX_VERSION = '0.149.1';  // @openai/codex

const REGISTRY = 'https://registry.npmjs.org';

/**
 * @typedef {Object} PlatformEntry
 * @property {string} pkg        Folder/dependency name of the platform package.
 * @property {string} version    Exact version to fetch.
 * @property {string} tarball    Full .tgz URL on the npm registry.
 * @property {string} integrity  Subresource-Integrity string ("sha512-…").
 * @property {string} exe        Executable path inside the extracted root (POSIX-relative).
 * @property {string|null} rg    ripgrep dir inside the extracted root, or null.
 * @property {string[]} [exeLegado]  Where `exe` lived in versions this AURORA
 *   already shipped. A cache folder of an older version is only recognised as
 *   "installed, but outdated" if the binary is found at one of these; without
 *   the list an old download reads as absent, and the panel offers a fresh
 *   download instead of an update while the old tree still sits on disk.
 */

/** @type {Record<'claude'|'codex', {base:string, baseVersion:string, platforms:Record<string, PlatformEntry>}>} */
const MANIFEST = {
  claude: {
    base: '@anthropic-ai/claude-code',
    baseVersion: CLAUDE_VERSION,
    platforms: {
      'win32:x64': {
        pkg: '@anthropic-ai/claude-code-win32-x64',
        version: CLAUDE_VERSION,
        tarball: `${REGISTRY}/@anthropic-ai/claude-code-win32-x64/-/claude-code-win32-x64-${CLAUDE_VERSION}.tgz`,
        integrity: 'sha512-GKsVA35zgwzoYNjZIlw09aaiBwlRp6e/EJxsGX6sTv2HQQ8r3JicQy1RS1bJUoMgb/J6c8W5lY25kEQQkbv/2g==',
        exe: 'claude.exe',
        rg: null,
      },
    },
  },
  codex: {
    base: '@openai/codex',
    baseVersion: CODEX_VERSION,
    platforms: {
      'win32:x64': {
        // The optional dep `@openai/codex-win32-x64` is an npm alias for
        // `@openai/codex@<ver>-win32-x64`; the registry path uses the real name.
        pkg: '@openai/codex-win32-x64',
        version: `${CODEX_VERSION}-win32-x64`,
        tarball: `${REGISTRY}/@openai/codex/-/codex-${CODEX_VERSION}-win32-x64.tgz`,
        integrity: 'sha512-G3QXGAg7nyyhqOeooAMUekBCeHd8a1QByhKcVAFyzNBaI06t6Ft7nsF+1SzFS0spuIdU4YyMi5YD26ukADBQUQ==',
        // O layout do pacote mudou na 0.147.0: o binario saiu de
        // vendor/<triple>/codex/ para vendor/<triple>/bin/, e o ripgrep de
        // vendor/<triple>/path/ para vendor/<triple>/codex-path/. Conferido no
        // tarball publicado, nao so no cache local. Como os dois caminhos vem
        // daqui, o download passava e a instalacao falhava depois, procurando
        // um arquivo que o upstream nao publica mais.
        exe: 'vendor/x86_64-pc-windows-msvc/bin/codex.exe',
        rg: 'vendor/x86_64-pc-windows-msvc/codex-path',
        // As releases ate a 6.4.0 fixavam o Codex em 0.131, 0.144 e 0.146,
        // todos com o binario no caminho antigo. Ha maquinas com esse cache.
        exeLegado: ['vendor/x86_64-pc-windows-msvc/codex/codex.exe'],
      },
    },
  },
};

/** `process.platform:process.arch`, the manifest's platform key. */
function platformKey() {
  return `${process.platform}:${process.arch}`;
}

/**
 * Manifest entry for a CLI on a platform (defaults to the current one), or null
 * when that CLI is not downloadable here.
 *
 * @param {'claude'|'codex'} kind
 * @param {string} [key]
 * @returns {(PlatformEntry & {kind:string, base:string, baseVersion:string})|null}
 */
function entryFor(kind, key = platformKey()) {
  const cli = MANIFEST[kind];
  if (!cli) return null;
  const p = cli.platforms[key];
  if (!p) return null;
  return { ...p, kind, base: cli.base, baseVersion: cli.baseVersion };
}

module.exports = { MANIFEST, entryFor, platformKey, CLAUDE_VERSION, CODEX_VERSION };
