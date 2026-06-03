/**
 * Tests for the toolchain bootstrap script. Covers the bits that don't
 * require touching the network:
 *   • `alreadyInstalled(path)` — sentinel file detection.
 *   • `extractZip(zip, dest)` — round-trip a known-good fixture zip.
 *   • Constants — DOWNLOAD_URL points at the pinned release.
 *
 * downloadFile() is deliberately not exercised here — it would need an
 * HTTP mock (nock) which is overkill for the first test pass. It's the
 * obvious next test to add when we have a proper integration suite.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bundleInstalled,
  extractZip,
  MSYS_DOWNLOAD_URL,
  MSYS_TAG,
  MSYS_FILENAME,
} from '../../components/Scripts/download-toolchain.js';

// Per-test scratch dir under the OS tmp; cleaned up after each test so
// nothing leaks between cases or onto the dev's disk.
let scratch;
beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-toolchain-test-'));
});
afterEach(() => {
  if (scratch && fs.existsSync(scratch)) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

describe('bundleInstalled', () => {
  it('returns false when the sentinel does not exist', () => {
    const fakeSentinel = path.join(scratch, 'msys', 'mingw64', 'bin', 'verilator_bin.exe');
    expect(bundleInstalled(fakeSentinel)).toBe(false);
  });

  it('returns true when the sentinel exists', () => {
    const sentinel = path.join(scratch, 'msys', 'mingw64', 'bin', 'verilator_bin.exe');
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, 'fake binary');
    expect(bundleInstalled(sentinel)).toBe(true);
  });

  it('returns false when the parent dir exists but the sentinel does not', () => {
    const sentinel = path.join(scratch, 'msys', 'mingw64', 'bin', 'verilator_bin.exe');
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    expect(bundleInstalled(sentinel)).toBe(false);
  });
});

describe('MSYS_DOWNLOAD_URL', () => {
  it('is an HTTPS URL', () => {
    expect(MSYS_DOWNLOAD_URL.startsWith('https://')).toBe(true);
  });

  it('points at the GitHub release for the pinned tag', () => {
    expect(MSYS_DOWNLOAD_URL).toContain(`/releases/download/${MSYS_TAG}/${MSYS_FILENAME}`);
  });

  it('targets the official nipscernlab/Aurora repo', () => {
    expect(MSYS_DOWNLOAD_URL).toContain('github.com/nipscernlab/Aurora/');
  });

  it('pinned tag matches the unified mingw bundle', () => {
    // The unified msys bundle replaces the old toolchain-v2 + verilator-v2
    // split. Asserting the tag here is a guardrail against reverting this file
    // without updating .github/workflows/release.yml's bundle download step.
    expect(MSYS_TAG).toBe('msys-v1');
    expect(MSYS_FILENAME).toBe('aurora-msys-v1.zip');
  });
});

describe('extractZip', () => {
  // Build a tiny known-good zip in the scratch dir, extract it, verify the
  // layout reaches disk. Uses PowerShell on Windows since that's where the
  // app runs; gates the suite on PowerShell being available.
  const hasPowerShell = (() => {
    try {
      execSync('powershell -NoProfile -Command "$null"', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasPowerShell)('round-trips a small fixture zip', () => {
    // 1. Build a fixture: scratch/src/{file.txt, sub/nested.txt}
    const src = path.join(scratch, 'src');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(src, 'file.txt'), 'top-level content');
    fs.writeFileSync(path.join(src, 'sub', 'nested.txt'), 'nested content');

    // 2. Compress contents (matches what the real toolchain bundle does:
    //    children at the zip's root, no wrapping dir).
    const zip = path.join(scratch, 'fixture.zip');
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${src}\\*' -DestinationPath '${zip}' -Force"`,
      { stdio: 'ignore' },
    );
    expect(fs.existsSync(zip)).toBe(true);

    // 3. Extract via the function under test.
    const dest = path.join(scratch, 'extracted');
    extractZip(zip, dest);

    // 4. Verify expected files landed at the expected paths with intact contents.
    expect(fs.readFileSync(path.join(dest, 'file.txt'), 'utf8')).toBe('top-level content');
    expect(fs.readFileSync(path.join(dest, 'sub', 'nested.txt'), 'utf8')).toBe('nested content');
  });

  it.skipIf(!hasPowerShell)('throws when given a non-existent zip', () => {
    const dest = path.join(scratch, 'extracted');
    expect(() => extractZip(path.join(scratch, 'does-not-exist.zip'), dest)).toThrow();
  });
});
