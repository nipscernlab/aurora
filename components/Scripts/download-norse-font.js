// @ts-check
/**
 * download-norse-font.js — fetch the "Norse" display font (Joël Carrouché) used
 * for the Dagr (Source Control) wordmark.
 *
 * The font is FREE for personal AND commercial use and MAY be embedded in
 * applications / web pages — but its license FORBIDS redistribution ("you may
 * not make the font available for download"). So Aurora does NOT commit it to
 * the repo; it is fetched from the ORIGINAL source (dafont) at bootstrap, just
 * like the toolchain binaries. The font is gitignored; the built app embeds it
 * (which the license permits). See assets/fonts/NORSE-LICENSE.txt.
 *
 * Exit 0 on any failure so it never blocks `npm start` — the Dagr wordmark just
 * falls back to the UI font until the font is present.
 *
 * Usage:  node components/Scripts/download-norse-font.js [--force]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DOWNLOAD_URL = 'https://dl.dafont.com/dl/?f=norse';

const ROOT_DIR = path.join(__dirname, '..', '..');
const FONTS_DIR = path.join(ROOT_DIR, 'assets', 'fonts');
const FONT_FILE = path.join(FONTS_DIR, 'Norse.otf');
const LICENSE_FILE = path.join(FONTS_DIR, 'NORSE-LICENSE.txt');
const TMP_ZIP = path.join(ROOT_DIR, '_norse-font.zip');
const TMP_DIR = path.join(ROOT_DIR, '_norse-font-tmp');

function log(/** @type {string} */ m) { console.log(`[norse-font] ${m}`); }
function err(/** @type {string} */ m) { console.error(`[norse-font] ERROR: ${m}`); }

function downloadFile(/** @type {string} */ url, /** @type {string} */ dest) {
  return new Promise((resolve, reject) => {
    log(`Downloading ${url}`);
    const file = fs.createWriteStream(dest);
    function doRequest(/** @type {any} */ requestUrl, redirectCount = 0) {
      if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }
      const u = new URL(requestUrl);
      https.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (aurora-ide-bootstrap)' },
      }, (res) => {
        const code = res.statusCode || 0;
        if (code === 301 || code === 302 || code === 307 || code === 308) {
          doRequest(res.headers.location, redirectCount + 1); res.resume(); return;
        }
        if (code !== 200) { reject(new Error(`HTTP ${code} from ${requestUrl}`)); res.resume(); return; }
        res.pipe(file);
        res.on('error', reject);
      }).on('error', reject);
    }
    file.on('finish', () => file.close(resolve));
    file.on('error', reject);
    doRequest(url);
  });
}

function extractZip(/** @type {string} */ zipPath, /** @type {string} */ destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`,
    { stdio: 'inherit' },
  );
}

async function main() {
  const force = process.argv.includes('--force');
  if (fs.existsSync(FONT_FILE) && !force) { log('Norse.otf already present — skipping download.'); return; }
  try {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
    await downloadFile(DOWNLOAD_URL, TMP_ZIP);
    extractZip(TMP_ZIP, TMP_DIR);
    fs.copyFileSync(path.join(TMP_DIR, 'Norse.otf'), FONT_FILE);
    try { fs.copyFileSync(path.join(TMP_DIR, 'freefont_license.txt'), LICENSE_FILE); } catch (_) { /* optional */ }
    fs.rmSync(TMP_ZIP, { force: true });
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    if (!fs.existsSync(FONT_FILE)) throw new Error('Norse.otf not found after extraction');
    log('Norse font installed (assets/fonts/Norse.otf).');
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    err('Could not fetch the Norse font automatically — the Dagr wordmark falls back to the UI font.');
    err('Get it manually from https://www.dafont.com/norse.font and drop Norse.otf into assets/fonts/.');
    process.exit(0); // never block bootstrap
  }
}

if (require.main === module) main();

module.exports = { downloadFile, extractZip, DOWNLOAD_URL, FONT_FILE };
