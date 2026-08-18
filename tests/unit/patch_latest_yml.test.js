import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

// scripts/patch-latest-yml.js repairs the auto-updater manifest after SignPath
// replaces the installer's bytes. It runs on exactly one occasion, a signed
// release, and everything it gets wrong is invisible until the whole lab is
// updating at once:
//
//   a stale sha512   -> every machine refuses the update ("checksum mismatch")
//   a stale blockmap -> the delta assembles a file that fails its own hash
//   a deleted blockmap -> a ~500 MB full download per machine, per release,
//                         and the release workflow's integrity gate fails
//                         because it requires that asset to exist.
//
// So the assertions below are about the two artefacts agreeing with the bytes
// on disk, not about the script's internals.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const script = path.join(repoRoot, 'scripts', 'patch-latest-yml.js');

const EXE = 'sapho-aurora-Setup-v6.4.0.exe';
// Small enough to keep the suite fast, large enough to span many blockmap
// chunks (the builder's window is ~16-32 KB).
const UNSIGNED_BYTES = 256 * 1024;
const SIGNATURE_BYTES = 4096;

let workspace;

function makeDist(name = 'dist') {
  const dist = path.join(workspace, `${name}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dist, { recursive: true });
  return dist;
}

/** Writes an installer whose bytes are deterministic but not compressible. */
function writeInstaller(dist, size = UNSIGNED_BYTES) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i + 4 <= buf.length; i += 4) buf.writeUInt32LE((i * 2654435761) >>> 0, i);
  fs.writeFileSync(path.join(dist, EXE), buf);
  return buf;
}

function sha512Of(file) {
  return createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

/** The subset of latest.yml that electron-builder writes for an NSIS target. */
function writeManifest(dist, buf) {
  const sha = createHash('sha512').update(buf).digest('base64');
  fs.writeFileSync(path.join(dist, 'latest.yml'),
    `version: 6.4.0\n`
    + `files:\n`
    + `  - url: ${EXE}\n`
    + `    sha512: ${sha}\n`
    + `    size: ${buf.length}\n`
    + `path: ${EXE}\n`
    + `sha512: ${sha}\n`
    + `releaseDate: '2026-08-11T00:00:00.000Z'\n`);
  return sha;
}

/** Appends bytes the way an Authenticode signature grows a PE file. */
function sign(dist) {
  fs.appendFileSync(path.join(dist, EXE), Buffer.alloc(SIGNATURE_BYTES, 0xab));
}

function run(dist, exeName = EXE) {
  return execFileSync(process.execPath, [script, dist, exeName], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readManifest(dist) {
  return yaml.load(fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8'));
}

/** Sum of every chunk length in a .blockmap, must equal the file it describes. */
function blockmapCoverage(blockmapPath) {
  const map = JSON.parse(gunzipSync(fs.readFileSync(blockmapPath)).toString());
  return map.files.reduce((total, f) => total + f.sizes.reduce((a, b) => a + b, 0), 0);
}

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-latest-yml-'));
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('patch-latest-yml', () => {
  it('rewrites sha512 and size to match the signed installer', () => {
    const dist = makeDist();
    const unsigned = writeInstaller(dist);
    const unsignedSha = writeManifest(dist, unsigned);
    sign(dist);

    run(dist);

    const signedSha = sha512Of(path.join(dist, EXE));
    const doc = readManifest(dist);

    expect(signedSha).not.toBe(unsignedSha);
    // Both places electron-updater reads a hash from have to agree with the file.
    expect(doc.sha512).toBe(signedSha);
    expect(doc.files[0].sha512).toBe(signedSha);
    expect(doc.files[0].size).toBe(UNSIGNED_BYTES + SIGNATURE_BYTES);
  });

  it('rebuilds the blockmap so it describes the signed bytes, not the built ones', () => {
    const dist = makeDist();
    const unsigned = writeInstaller(dist);
    writeManifest(dist, unsigned);
    // Stand in for the blockmap electron-builder emits next to the installer.
    const blockmap = path.join(dist, `${EXE}.blockmap`);
    run(dist);
    const coverageBeforeSigning = blockmapCoverage(blockmap);

    sign(dist);
    run(dist);

    // The asset must still exist: the release workflow fails without it, and a
    // missing blockmap is what turns every update into a full download.
    expect(fs.existsSync(blockmap)).toBe(true);
    expect(coverageBeforeSigning).toBe(UNSIGNED_BYTES);
    expect(blockmapCoverage(blockmap)).toBe(UNSIGNED_BYTES + SIGNATURE_BYTES);
  });

  it('leaves the rest of the manifest alone', () => {
    const dist = makeDist();
    writeManifest(dist, writeInstaller(dist));
    sign(dist);

    run(dist);

    const doc = readManifest(dist);
    expect(doc.version).toBe('6.4.0');
    expect(doc.path).toBe(EXE);
    expect(String(doc.releaseDate)).toContain('2026-08-11');
  });

  it('fails loudly when the signed installer is missing', () => {
    const dist = makeDist();
    writeManifest(dist, writeInstaller(dist));
    fs.rmSync(path.join(dist, EXE));

    expect(() => run(dist)).toThrow();
  });

  it('fails rather than publishing a manifest it did not recognise', () => {
    const dist = makeDist();
    writeInstaller(dist);
    // A manifest describing some other installer: silently "succeeding" here
    // would ship a latest.yml pointing at bytes nobody verified.
    fs.writeFileSync(path.join(dist, 'latest.yml'),
      'version: 6.4.0\nfiles:\n  - url: something-else.exe\n    sha512: AAAA\n    size: 1\n'
      + 'path: something-else.exe\nsha512: AAAA\n');
    sign(dist);

    expect(() => run(dist)).toThrow();
  });

  it('refuses arguments it cannot act on', () => {
    expect(() => execFileSync(process.execPath, [script], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })).toThrow();
  });
});
