// gen-installer-license.js — produce the text the installer's licence page
// shows, at build time.
//
// Wired into `build.beforePack` in package.json, so it runs on EVERY
// electron-builder invocation — the release workflow calls electron-builder
// directly (`npx electron-builder`, not `npm run build`), which is exactly why
// this is an electron-builder hook and not an npm `prebuild` step: the npm
// hook would fire locally and silently never fire in CI.
//
// What it writes: `build/license.txt` = LICENSE + the SAPHO annex, verbatim.
// The two files are concatenated instead of committed as a third copy because
// the base licence's own terms require it to be reproduced "sem alterar uma
// vírgula" — a hand-maintained copy for the installer is how a comma drifts.
// The output is generated, therefore gitignored.
//
// Why the BOM: electron-builder hands this file to NSIS's licence page, and
// Unicode NSIS decides the encoding by sniffing the file — without a BOM it
// assumes the system ANSI codepage and every accented character in the
// Portuguese text renders as mojibake. The BOM makes it unambiguous UTF-8.
//
// The licence page itself does not touch elevation: the installer stays
// per-user `oneClick` with no admin prompt (TODO.md section 2 depends on
// that), the page is just an accept/decline gate shown before the copy runs.

'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async function genInstallerLicense() {
  const root = path.join(__dirname, '..');
  const licence = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  const annex = fs.readFileSync(path.join(root, 'LICENSE-SAPHO.md'), 'utf8');

  const out = '\uFEFF' + licence.trimEnd() + '\n\n\n' + annex.trimEnd() + '\n';
  const dest = path.join(root, 'build', 'license.txt');
  fs.writeFileSync(dest, out, 'utf8');
  console.log(`  • licence page: wrote ${path.relative(root, dest)} ` +
    `(LICENSE + LICENSE-SAPHO.md, ${out.length} chars)`);
};
