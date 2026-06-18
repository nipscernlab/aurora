/**
 * Unit tests for the on-demand AI CLI downloader (B12).
 *
 * The real network download is validated live (it pulls ~230 MB from the npm
 * registry), so here we cover the deterministic, offline surface: the pinned
 * manifest, the Subresource-Integrity comparison, and the userData cache logic
 * (path layout + cache-hit short-circuit). `AURORA_CLI_CACHE` redirects the
 * cache root into a throwaway temp dir so nothing touches the real userData.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  entryFor, CLAUDE_VERSION, CODEX_VERSION,
} from '../../main/ai/cli_manifest.js';
import {
  installPaths, cachedLocation, isDownloadable, ensureCli, integrityMatches,
} from '../../main/ai/cli_downloader.js';

describe('cli_manifest', () => {
  it('pins the Claude win32-x64 platform package', () => {
    const e = entryFor('claude', 'win32:x64');
    expect(e).toBeTruthy();
    expect(e.pkg).toBe('@anthropic-ai/claude-code-win32-x64');
    expect(e.version).toBe(CLAUDE_VERSION);
    expect(e.tarball).toBe(
      `https://registry.npmjs.org/@anthropic-ai/claude-code-win32-x64/-/claude-code-win32-x64-${CLAUDE_VERSION}.tgz`,
    );
    expect(e.integrity).toMatch(/^sha512-/);
    expect(e.exe).toBe('claude.exe');
    expect(e.rg).toBeNull();
  });

  it('pins the Codex win32-x64 package via the @openai/codex alias', () => {
    const e = entryFor('codex', 'win32:x64');
    expect(e).toBeTruthy();
    expect(e.version).toBe(`${CODEX_VERSION}-win32-x64`);
    expect(e.tarball).toBe(
      `https://registry.npmjs.org/@openai/codex/-/codex-${CODEX_VERSION}-win32-x64.tgz`,
    );
    expect(e.integrity).toMatch(/^sha512-/);
    expect(e.exe).toContain('codex.exe');
    expect(e.rg).toContain('vendor');
  });

  it('returns null for an unsupported platform or CLI', () => {
    expect(entryFor('claude', 'sunos:mips')).toBeNull();
    // @ts-expect-error — exercising the unknown-kind guard
    expect(entryFor('nope', 'win32:x64')).toBeNull();
  });
});

describe('integrityMatches', () => {
  it('accepts a matching sha512-<base64> string', () => {
    expect(integrityMatches('AbCd', 'sha512-AbCd')).toBe(true);
  });
  it('rejects a mismatch, a missing prefix, or empty integrity', () => {
    expect(integrityMatches('AbCd', 'sha512-EeFf')).toBe(false);
    expect(integrityMatches('AbCd', 'AbCd')).toBe(false); // no sha512- prefix
    expect(integrityMatches('AbCd', '')).toBe(false);
  });
});

describe('cli_downloader cache (no network)', () => {
  let cacheRoot;
  beforeEach(() => {
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-clitest-'));
    process.env.AURORA_CLI_CACHE = cacheRoot;
  });
  afterEach(() => {
    delete process.env.AURORA_CLI_CACHE;
    try { fs.rmSync(cacheRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  });

  // The download targets are win32:x64 today; on a non-Windows dev box those
  // entries are absent. Gate the path/cache assertions on real availability so
  // the suite is green everywhere (CI runs on windows-latest, so they DO run).
  const supported = isDownloadable('claude');

  it('isDownloadable agrees with the manifest for this platform', () => {
    expect(isDownloadable('claude')).toBe(!!entryFor('claude'));
    expect(isDownloadable('codex')).toBe(!!entryFor('codex'));
  });

  it.runIf(supported)('installPaths places the exe under the cache root', () => {
    const ip = installPaths('claude');
    expect(ip).toBeTruthy();
    expect(ip.dir.startsWith(cacheRoot)).toBe(true);
    expect(ip.exe.startsWith(ip.dir)).toBe(true);
    expect(path.basename(ip.exe)).toBe('claude.exe');
  });

  it.runIf(supported)('cachedLocation is null until the sentinel exists, then resolves it', async () => {
    expect(cachedLocation('claude')).toBeNull();

    const ip = installPaths('claude');
    fs.mkdirSync(path.dirname(ip.exe), { recursive: true });
    fs.writeFileSync(ip.exe, 'fake-binary');

    const hit = cachedLocation('claude');
    expect(hit).toBeTruthy();
    expect(hit.exe).toBe(ip.exe);
    expect(hit.viaShim).toBe(false);

    // With the sentinel present, ensureCli must short-circuit to the cache —
    // it never touches the network.
    const ensured = await ensureCli('claude');
    expect(ensured.exe).toBe(ip.exe);
  });

  it.runIf(supported)('codex cache exposes the bundled ripgrep dir alongside the exe', () => {
    const ip = installPaths('codex');
    fs.mkdirSync(path.dirname(ip.exe), { recursive: true });
    fs.writeFileSync(ip.exe, 'fake-binary');

    const hit = cachedLocation('codex');
    expect(hit).toBeTruthy();
    expect(hit.rgDir).toBe(ip.rgDir);
    expect(hit.rgDir).toContain('vendor');
  });
});
