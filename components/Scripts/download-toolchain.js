/**
 * Aurora IDE - Toolchain bootstrap
 *
 * Downloads aurora-toolchain-v1.zip from GitHub Releases and extracts it
 * into components/Packages/ if the toolchain is not already present.
 *
 * Usage:  node components/scripts/download-toolchain.js [--force]
 *   --force   re-download even if the toolchain is already present
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

// ── Configuration ────────────────────────────────────────────────────────────

const TOOLCHAIN_TAG      = 'toolchain-v1';
const TOOLCHAIN_FILENAME = 'aurora-toolchain-v1.zip';
const GITHUB_OWNER       = 'nipscernlab';
const GITHUB_REPO        = 'Aurora';

const DOWNLOAD_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${TOOLCHAIN_TAG}/${TOOLCHAIN_FILENAME}`;

const ROOT_DIR      = path.join(__dirname, '..', '..');
const PACKAGES_DIR  = path.join(ROOT_DIR, 'components', 'Packages');
const SENTINEL_FILE = path.join(PACKAGES_DIR, 'iverilog', 'bin', 'iverilog.exe');
const TMP_ZIP       = path.join(ROOT_DIR, TOOLCHAIN_FILENAME);

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[toolchain] ${msg}`); }
function err(msg) { console.error(`[toolchain] ERROR: ${msg}`); }

function alreadyInstalled() {
    return fs.existsSync(SENTINEL_FILE);
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        log(`Downloading ${url}`);

        const file = fs.createWriteStream(dest);
        let total = 0;
        let received = 0;

        function doRequest(requestUrl, redirectCount = 0) {
            if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }

            const parsedUrl = new URL(requestUrl);
            const opts = {
                hostname: parsedUrl.hostname,
                path:     parsedUrl.pathname + parsedUrl.search,
                headers:  { 'User-Agent': 'aurora-ide-toolchain-bootstrap' }
            };

            https.get(opts, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    doRequest(res.headers.location, redirectCount + 1);
                    res.resume();
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} from ${requestUrl}`));
                    res.resume();
                    return;
                }

                total = parseInt(res.headers['content-length'] || '0', 10);
                res.on('data', (chunk) => {
                    received += chunk.length;
                    if (total > 0) {
                        const pct = Math.round((received / total) * 100);
                        process.stdout.write(`\r[toolchain] ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
                    }
                });

                res.pipe(file);
                res.on('end', () => process.stdout.write('\n'));
                res.on('error', reject);
            }).on('error', reject);
        }

        // Resolve only after the file is fully flushed and closed — otherwise
        // PowerShell's Expand-Archive races us and hits the zip while it's
        // still locked by this writer (silent corruption: the zip vanishes,
        // Packages/ ends up empty).
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
        doRequest(url);
    });
}

function extractZip(zipPath, destDir) {
    // Try PowerShell Expand-Archive (always available on Win 10+)
    log(`Extracting ${path.basename(zipPath)} → ${destDir}`);
    fs.mkdirSync(destDir, { recursive: true });

    // First try 7-Zip if already present (faster)
    const sevenZip = path.join(PACKAGES_DIR, '7-Zip', '7z.exe');
    if (fs.existsSync(sevenZip)) {
        execSync(`"${sevenZip}" x "${zipPath}" -o"${destDir}" -y`, { stdio: 'inherit' });
        return;
    }

    // Fall back to PowerShell. Use $ErrorActionPreference = 'Stop' so a
    // cmdlet failure propagates as a non-zero exit code from powershell.exe
    // (otherwise execSync sees success and we delete the zip + falsely log
    // "installed successfully" before the sentinel check trips).
    execSync(
        `powershell -NoProfile -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`,
        { stdio: 'inherit' }
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const force = process.argv.includes('--force');

    if (alreadyInstalled() && !force) {
        log('Toolchain already present — skipping download.');
        log('(Run with --force to re-download.)');
        return;
    }

    if (!alreadyInstalled()) {
        log('Toolchain not found in components/Packages/.');
    }

    try {
        await downloadFile(DOWNLOAD_URL, TMP_ZIP);
        extractZip(TMP_ZIP, PACKAGES_DIR);

        // Clean up the zip
        fs.unlinkSync(TMP_ZIP);
        log('Toolchain installed successfully.');

        if (!alreadyInstalled()) {
            err(`Sentinel file not found after extraction: ${SENTINEL_FILE}`);
            err('The ZIP may have a different internal structure. Check components/Packages/ manually.');
            process.exit(1);
        }
    } catch (e) {
        err(e.message);
        err(`\nCould not download toolchain automatically.`);
        err(`Please download manually from:`);
        err(`  ${DOWNLOAD_URL}`);
        err(`Extract the ZIP contents into:  components/Packages/`);
        // Exit with 0 so prestart doesn't block `npm start`
        process.exit(0);
    }
}

main();
