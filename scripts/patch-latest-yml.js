// patch-latest-yml.js — fix the auto-updater manifest after an installer was
// re-signed OUTSIDE electron-builder (e.g. by SignPath, post-build).
//
// electron-builder writes `dist/latest.yml` with the sha512 + size of the
// installer bytes it produced, and `dist/<installer>.blockmap` describing those
// same bytes chunk by chunk. Signing after the build replaces the bytes, so BOTH
// artefacts stop matching the file they describe:
//
//   latest.yml  — electron-updater verifies sha512 before running the installer,
//                 so a stale hash fails every auto-update with "checksum
//                 mismatch", and the only fix is a new release.
//   .blockmap   — the updater fetches the old and the new blockmap to work out
//                 which chunks to download. A blockmap describing pre-signature
//                 bytes yields a file that fails the final hash check, and the
//                 update falls back to downloading the whole ~500 MB.
//
// This script recomputes both from the SIGNED file. The blockmap is rebuilt with
// electron-builder's own implementation, not a reimplementation, so the format
// is whatever the installed electron-builder produces.
//
// An earlier version deleted the blockmap instead of rebuilding it. That was
// wrong twice over: it turned EVERY signed release into a full download for the
// whole lab, not just the first one, and it deleted an asset that the release
// workflow's own integrity gate requires, so the release would have failed at
// the last step. Neither would have shown up before the first signed release.
//
// Not needed if you sign DURING the build (electron-builder `win.sign` hook) —
// only for the post-build SignPath-Action flow. See TODO.md, section 3.
//
// Usage:  node scripts/patch-latest-yml.js <distDir> <signedExeName>
//   e.g.  node scripts/patch-latest-yml.js dist sapho-aurora-Setup-v6.4.0.exe

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// js-yaml is a real devDependency of this repo. It used to be undeclared, and
// this require only resolved because npm happened to hoist the copy that
// electron-updater/electron-builder pull in. Any hoisting change would have
// broken this script — on the signing path, where the failure mode is a
// latest.yml that no longer matches the signed installer.
const yaml = require('js-yaml');

// Rebuilding the blockmap ourselves would mean reimplementing Rabin
// fingerprinting and matching electron-builder's chunking exactly; get it subtly
// wrong and the updater downloads a corrupt delta. Borrow the real one instead.
// It is a deep path into a transitive dependency, so it is loaded defensively:
// this script only ever runs in CI moments after electron-builder itself ran,
// so the package is guaranteed to be there, but the internal layout can move
// between majors and the failure must be legible rather than a stack trace.
function loadBlockMapBuilder() {
  try {
    return require('app-builder-lib/out/targets/blockmap/blockmap').buildBlockMap;
  } catch (err) {
    return null;
  }
}

async function main() {
  const [distDir, exeName] = process.argv.slice(2);
  if (!distDir || !exeName) {
    console.error('usage: node scripts/patch-latest-yml.js <distDir> <signedExeName>');
    process.exit(2);
  }

  const ymlPath = path.join(distDir, 'latest.yml');
  const exePath = path.join(distDir, exeName);

  if (!fs.existsSync(exePath)) {
    console.error(`[patch-latest-yml] signed installer not found: ${exePath}`);
    process.exit(1);
  }

  const buildBlockMap = loadBlockMapBuilder();
  let sha512;
  let size;

  if (buildBlockMap) {
    // Writes <exe>.blockmap and returns the hash/size of the file as it is now,
    // which is the signed file — the two can never disagree.
    const info = await buildBlockMap(exePath, 'gzip', `${exePath}.blockmap`);
    sha512 = info.sha512;
    size = info.size;
    console.log(`[patch-latest-yml] blockmap rebuilt from the signed installer`);
  } else {
    // Degrade loudly. A full download is a bad update; a wrong hash is a broken
    // one, so keep latest.yml honest and drop the map the updater must not trust.
    const buf = fs.readFileSync(exePath);
    sha512 = crypto.createHash('sha512').update(buf).digest('base64');
    size = buf.length;
    const stale = `${exePath}.blockmap`;
    if (fs.existsSync(stale)) fs.unlinkSync(stale);
    console.log('::warning::[patch-latest-yml] could not load electron-builder\'s blockmap '
      + 'builder (app-builder-lib layout changed?). latest.yml is correct, but the stale '
      + 'blockmap was deleted, so this release is a FULL download for every client.');
  }

  const doc = yaml.load(fs.readFileSync(ymlPath, 'utf8'));

  // Update the files[] entry that points at this installer.
  let patched = false;
  if (Array.isArray(doc.files)) {
    for (const f of doc.files) {
      if (f && f.url === exeName) {
        f.sha512 = sha512;
        f.size = size;
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

  console.log(`[patch-latest-yml] ${exeName}: sha512=${sha512.slice(0, 12)}… size=${size} — latest.yml refreshed`);
}

main().catch((err) => {
  console.error(`[patch-latest-yml] ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
