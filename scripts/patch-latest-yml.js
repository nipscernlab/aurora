// patch-latest-yml.js — fix the auto-updater manifest after an installer was
// re-signed OUTSIDE electron-builder (e.g. by SignPath, post-build).
//
// electron-builder writes `dist/latest.yml` with the sha512 + size of the
// installer bytes it produced. If the .exe is signed AFTER that (SignPath's
// submit-signing-request returns new bytes), the hash in latest.yml no longer
// matches the file, so electron-updater rejects every auto-update with a
// "checksum mismatch". This recomputes sha512 (base64) + size for the SIGNED
// .exe and rewrites latest.yml, and drops the now-stale .blockmap so the updater
// falls back to a full (always-valid) download instead of a broken delta.
//
// Not needed if you sign DURING the build (electron-builder `win.sign` hook) —
// only for the post-build SignPath-Action flow. See docs/CODE_SIGNING.md.
//
// Usage:  node scripts/patch-latest-yml.js <distDir> <signedExeName>
//   e.g.  node scripts/patch-latest-yml.js dist sapho-aurora-Setup-v6.4.0.exe

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

const [distDir, exeName] = process.argv.slice(2);
if (!distDir || !exeName) {
  console.error('usage: node scripts/patch-latest-yml.js <distDir> <signedExeName>');
  process.exit(2);
}

const ymlPath = path.join(distDir, 'latest.yml');
const exePath = path.join(distDir, exeName);

const buf = fs.readFileSync(exePath);
const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
const size = buf.length;

const doc = yaml.load(fs.readFileSync(ymlPath, 'utf8'));

// Update the files[] entry that points at this installer.
let patched = false;
if (Array.isArray(doc.files)) {
  for (const f of doc.files) {
    if (f && f.url === exeName) {
      f.sha512 = sha512;
      f.size = size;
      delete f.blockMapSize; // the .blockmap is stale after a re-sign
      patched = true;
    }
  }
}
// Update the top-level path/sha512 — the primary file electron-updater verifies.
if (!doc.path || doc.path === exeName) {
  doc.path = exeName;
  doc.sha512 = sha512;
  patched = true;
}

if (!patched) {
  console.error(`[patch-latest-yml] no entry for "${exeName}" in ${ymlPath} — nothing changed`);
  process.exit(1);
}

fs.writeFileSync(ymlPath, yaml.dump(doc, { lineWidth: -1 }));

// Remove the stale delta-update map so the updater never trusts an old hash.
const blockmap = exePath + '.blockmap';
if (fs.existsSync(blockmap)) fs.unlinkSync(blockmap);

console.log(`[patch-latest-yml] ${exeName}: sha512=${sha512.slice(0, 12)}… size=${size} — latest.yml refreshed`);
