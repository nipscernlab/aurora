// verify-toolchain-sentinels.js: prove the bundled toolchain is on disk
// before a release is allowed to package it.
//
// The downloaders in components/Scripts exit 0 when they fail, on purpose: a
// developer offline should still get an IDE that starts, just without the
// compilers. A RELEASE must not ship on those terms, so something has to check
// afterwards, and this is it.
//
// It asks each downloader where its binary lands instead of repeating the
// paths. The release workflow used to carry its own hardcoded list, and that
// list said `surfer.exe` while the fork's binary has been called
// `surfer-aurora.exe` ever since it was renamed, the app, the binary
// allowlist and the downloader all agree on the new name, and only the
// workflow was left behind. The gate failed the 6.4.0 release twenty minutes
// into the build, for a file that was sitting right there under another name.
// Reading the sentinel from the module that creates it is what stops that
// happening again: rename a binary and this follows.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// Each entry names the downloader and the export that holds its sentinel.
// `download-docs.js` and `download-tree-sitter-grammars.js` are absent on
// purpose: neither installs an executable, and neither declares a single file
// that proves the install.
const COMPONENTS = [
  ['toolchain (msys)', 'download-toolchain.js', 'MSYS_SENTINEL'],
  ['yanc', 'download-yanc.js', 'SENTINEL_FILE'],
  ['gtkwave', 'download-gtkwave-nipscern.js', 'SENTINEL_FILE'],
  ['surfer', 'download-surfer.js', 'SENTINEL_FILE'],
  ['verible', 'download-verible.js', 'SENTINEL_FILE'],
  ['clang-format', 'download-clang-format.js', 'SENTINEL_FILE'],
  ['slang-server', 'download-slang-server.js', 'SENTINEL_FILE'],
];

function main() {
  const missing = [];
  const rows = [];

  for (const [name, file, exportName] of COMPONENTS) {
    const modulePath = path.join(REPO_ROOT, 'components', 'Scripts', file);
    let sentinel;
    try {
      sentinel = require(modulePath)[exportName];
    } catch (err) {
      missing.push(`${name}: cannot load ${file} — ${err.message}`);
      continue;
    }
    if (!sentinel) {
      // The export was renamed or dropped. Fail rather than skip: a silent
      // skip here is exactly the hole this script exists to close.
      missing.push(`${name}: ${file} no longer exports ${exportName}`);
      continue;
    }
    const rel = path.relative(REPO_ROOT, sentinel);
    if (fs.existsSync(sentinel)) {
      rows.push(`  ok       ${name.padEnd(18)} ${rel}`);
    } else {
      rows.push(`  MISSING  ${name.padEnd(18)} ${rel}`);
      missing.push(`${name}: ${rel}`);
    }
  }

  console.log(rows.join('\n'));

  if (missing.length) {
    console.error('\nBootstrap left the toolchain incomplete:');
    for (const m of missing) console.error(`  - ${m}`);
    console.error('\nA release must not ship without the toolchain. Re-run '
      + '`npm run bootstrap`, or the individual downloader with --force.');
    process.exit(1);
  }

  console.log(`\nAll ${COMPONENTS.length} toolchain components present.`);
}

main();
