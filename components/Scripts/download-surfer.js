// @ts-check
/**
 * Aurora IDE - Surfer bootstrap
 *
 * Baixa o build Windows do Surfer (waveform viewer em Rust) e extrai
 * surfer.exe em components/Packages/surfer/. Surfer e o viewer opt-in
 * (toggle GTKWave<->Surfer); sem ele, o botao Wave cai pro GTKWave.
 *
 * Fonte: registro de pacotes generico do GitLab do projeto Surfer.
 * Pinning: SURFER_TAG abaixo. Pra subir, atualizar a tag/URL.
 *
 * Licenca EUPL-1.2 — atribuicao no LICENSE da raiz; spawn arm's-length
 * (a AURORA so executa o .exe, nao linka) nao contamina a AURORA.
 *
 * Roda no bootstrap, depois do download-gtkwave-nipscern e antes do
 * copy-components. Best-effort: se falhar, sai com 0 (a AURORA ainda
 * compila/simula; so o Surfer fica indisponivel ate o setup).
 *
 * Usage:  node components/Scripts/download-surfer.js [--force]
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

// ── Configuration ────────────────────────────────────────────────────────────

const SURFER_TAG      = 'v0.7.0';
const SURFER_FILENAME = `surfer_win_${SURFER_TAG}.zip`;
// Registro de pacotes generico do GitLab (projeto Surfer, id 42073614).
const DOWNLOAD_URL    = `https://gitlab.com/api/v4/projects/42073614/packages/generic/surfer/${SURFER_TAG}/${SURFER_FILENAME}`;

const ROOT_DIR      = path.join(__dirname, '..', '..');
const INSTALL_DIR   = path.join(ROOT_DIR, 'components', 'Packages', 'surfer');
const SENTINEL_FILE = path.join(INSTALL_DIR, 'surfer.exe'); // NB: surfer.exe, nao surver.exe (helper)
const TMP_ZIP       = path.join(ROOT_DIR, SURFER_FILENAME);

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(/** @type {string} */ msg) { console.log(`[surfer] ${msg}`); }
function err(/** @type {string} */ msg) { console.error(`[surfer] ERROR: ${msg}`); }

function alreadyInstalled() {
    return fs.existsSync(SENTINEL_FILE);
}

function downloadFile(/** @type {string} */ url, /** @type {string} */ dest) {
    return new Promise((resolve, reject) => {
        log(`Downloading ${url}`);

        const file = fs.createWriteStream(dest);
        let total = 0;
        let received = 0;

        function doRequest(/** @type {any} */ requestUrl, redirectCount = 0) {
            if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }

            const parsedUrl = new URL(requestUrl);
            const opts = {
                hostname: parsedUrl.hostname,
                path:     parsedUrl.pathname + parsedUrl.search,
                headers:  { 'User-Agent': 'aurora-ide-surfer-bootstrap' }
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
                        process.stdout.write(`\r[surfer] ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
                    }
                });

                res.pipe(file);
                res.on('end', () => process.stdout.write('\n'));
                res.on('error', reject);
            }).on('error', reject);
        }

        // Resolve apenas depois que o stream e fechado — caso contrario
        // o extract roda em cima de um arquivo ainda em escrita.
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
        doRequest(url);
    });
}

function extractZip(/** @type {string} */ zipPath, /** @type {string} */ destDir) {
    if (!fs.existsSync(zipPath)) {
        throw new Error(`Zip file not found: ${zipPath}`);
    }
    log(`Extracting ${path.basename(zipPath)} → ${destDir}`);
    fs.mkdirSync(destDir, { recursive: true });

    // PowerShell Expand-Archive (ships on every Win 10+).
    execSync(
        `powershell -NoProfile -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`,
        { stdio: 'inherit' }
    );
}

// Se o zip trouxe surfer.exe dentro de uma subpasta (ex.: surfer/surfer.exe),
// sobe os arquivos um nivel pra o sentinel ficar em INSTALL_DIR/surfer.exe.
function flattenIfNested(/** @type {string} */ dir) {
    if (fs.existsSync(SENTINEL_FILE)) return;
    let found = null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(dir, entry.name, 'surfer.exe');
        if (fs.existsSync(candidate)) { found = path.join(dir, entry.name); break; }
    }
    if (!found) return;
    for (const name of fs.readdirSync(found)) {
        fs.renameSync(path.join(found, name), path.join(dir, name));
    }
    try { fs.rmdirSync(found); } catch { /* nao-vazia / em uso — ignora */ }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const force = process.argv.includes('--force');

    if (alreadyInstalled() && !force) {
        log(`surfer already present — skipping download.`);
        return;
    }

    if (!alreadyInstalled()) {
        log(`surfer not found in components/Packages/surfer/.`);
    }

    try {
        await downloadFile(DOWNLOAD_URL, TMP_ZIP);
        extractZip(TMP_ZIP, INSTALL_DIR);
        flattenIfNested(INSTALL_DIR);
        fs.unlinkSync(TMP_ZIP);
        log(`surfer installed successfully.`);

        if (!alreadyInstalled()) {
            err(`Sentinel file not found after extraction: ${SENTINEL_FILE}`);
            err(`The ZIP may have a different internal structure.`);
            process.exit(1);
        }
    } catch (e) {
        err(e instanceof Error ? e.message : String(e));
        err(`\nCould not download surfer automatically.`);
        err(`Please download manually from:`);
        err(`  ${DOWNLOAD_URL}`);
        err(`Extract surfer.exe into:  components/Packages/surfer/`);
        // Exit 0 pra nao bloquear npm start. Aurora ainda compila/simula;
        // so o botao Wave (com Surfer) que cai pro GTKWave ate o setup.
        process.exit(0);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    alreadyInstalled,
    downloadFile,
    extractZip,
    flattenIfNested,
    DOWNLOAD_URL,
    SURFER_TAG,
    SURFER_FILENAME,
    INSTALL_DIR,
    SENTINEL_FILE,
};
