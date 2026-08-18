// @ts-check
/**
 * Aurora IDE - Verible bootstrap
 *
 * Baixa o build Windows do Verible (suite Verilog em C++) e extrai
 * APENAS o language server `verible-verilog-ls.exe` em
 * components/Packages/verible/bin/. O LS e o motor do O2 (LSP): ele faz
 * diagnostico (lint+sintaxe), formatacao, outline, hover e
 * definicao/referencias direto no editor Monaco, falando JSON-RPC por
 * stdio com main/lsp/verible_lsp.js.
 *
 * So o LS e mantido, os outros ~10 executaveis do zip (lint/format/
 * syntax standalone, kythe, etc.) nao sao usados pela AURORA, entao a
 * extracao poda tudo menos o LS pra manter o pacote enxuto (~3.5MB).
 *
 * Fonte: GitHub releases do chipsalliance/verible (asset win64,
 * estatico). Pinning: VERIBLE_TAG + EXPECTED_SHA256 abaixo. Pra subir,
 * atualizar a tag/URL e recomputar o SHA-256 do novo zip.
 *
 * Licenca Apache-2.0, atribuicao no LICENSE da raiz; spawn arm's-length
 * (a AURORA so executa o LS, nao linka) nao contamina a AURORA.
 *
 * Roda no bootstrap, depois do download-surfer e antes do
 * copy-components. Best-effort: se falhar, sai com 0 (a AURORA ainda
 * compila/simula/edita; so o LSP de Verilog fica indisponivel ate o
 * setup, o editor cai pro highlight estatico do Monaco, sem erros).
 *
 * Usage:  node components/Scripts/download-verible.js [--force]
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');
const { verifyChecksum } = require('./lib/checksum');

// ── Configuration ────────────────────────────────────────────────────────────

// Pinned SHA-256 of verible-v0.0-4135-g7807ee1a-win64.zip (GitHub release
// asset, immutable per tag). Verified before extraction; a mismatch aborts.
const EXPECTED_SHA256 = '2e7098e6e60783062edd10701f8a10620b226050caea39fe092e8fbd8f35e2c5';

const VERIBLE_TAG      = 'v0.0-4135-g7807ee1a';
const VERIBLE_FILENAME = `verible-${VERIBLE_TAG}-win64.zip`;
const DOWNLOAD_URL     = `https://github.com/chipsalliance/verible/releases/download/${VERIBLE_TAG}/${VERIBLE_FILENAME}`;

// O unico binario que a AURORA usa do zip.
const LS_EXE_NAME = 'verible-verilog-ls.exe';

const ROOT_DIR      = path.join(__dirname, '..', '..');
const INSTALL_DIR   = path.join(ROOT_DIR, 'components', 'Packages', 'verible');
const BIN_DIR       = path.join(INSTALL_DIR, 'bin');
const SENTINEL_FILE = path.join(BIN_DIR, LS_EXE_NAME);
const TMP_ZIP       = path.join(ROOT_DIR, VERIBLE_FILENAME);
const TMP_EXTRACT   = path.join(INSTALL_DIR, '_extract');

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(/** @type {string} */ msg) { console.log(`[verible] ${msg}`); }
function err(/** @type {string} */ msg) { console.error(`[verible] ERROR: ${msg}`); }

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
                headers:  { 'User-Agent': 'aurora-ide-verible-bootstrap' }
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
                        process.stdout.write(`\r[verible] ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
                    }
                });

                res.pipe(file);
                res.on('end', () => process.stdout.write('\n'));
                res.on('error', reject);
            }).on('error', reject);
        }

        // Resolve apenas depois que o stream e fechado, caso contrario
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

// O zip traz tudo numa subpasta `verible-<tag>-win64/`. Procura o
// verible-verilog-ls.exe (1 nivel abaixo), move SO ele pra bin/, e
// descarta o resto da extracao, a AURORA nao usa os outros binarios.
function extractLsOnly() {
    let found = null;
    for (const entry of fs.readdirSync(TMP_EXTRACT, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            // zip sem subpasta: o exe pode estar na raiz da extracao
            if (entry.name.toLowerCase() === LS_EXE_NAME) {
                found = path.join(TMP_EXTRACT, entry.name);
                break;
            }
            continue;
        }
        const candidate = path.join(TMP_EXTRACT, entry.name, LS_EXE_NAME);
        if (fs.existsSync(candidate)) { found = candidate; break; }
    }
    if (!found) {
        throw new Error(`${LS_EXE_NAME} not found inside the extracted archive.`);
    }
    fs.mkdirSync(BIN_DIR, { recursive: true });
    fs.copyFileSync(found, SENTINEL_FILE);
}

function rmrf(/** @type {string} */ p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const force = process.argv.includes('--force');

    if (alreadyInstalled() && !force) {
        log(`verible-verilog-ls already present — skipping download.`);
        return;
    }

    if (!alreadyInstalled()) {
        log(`verible-verilog-ls not found in components/Packages/verible/bin/.`);
    }

    try {
        rmrf(TMP_EXTRACT);
        await downloadFile(DOWNLOAD_URL, TMP_ZIP);
        await verifyChecksum(TMP_ZIP, EXPECTED_SHA256, log);
        extractZip(TMP_ZIP, TMP_EXTRACT);
        extractLsOnly();
        rmrf(TMP_EXTRACT);
        fs.unlinkSync(TMP_ZIP);
        log(`verible-verilog-ls installed successfully.`);

        if (!alreadyInstalled()) {
            err(`Sentinel file not found after extraction: ${SENTINEL_FILE}`);
            err(`The ZIP may have a different internal structure.`);
            process.exit(1);
        }
    } catch (e) {
        rmrf(TMP_EXTRACT);
        try { if (fs.existsSync(TMP_ZIP)) fs.unlinkSync(TMP_ZIP); } catch { /* ignore */ }
        err(e instanceof Error ? e.message : String(e));
        err(`\nCould not download verible automatically.`);
        err(`Please download manually from:`);
        err(`  ${DOWNLOAD_URL}`);
        err(`Extract ${LS_EXE_NAME} into:  components/Packages/verible/bin/`);
        // Exit 0 pra nao bloquear npm start. Aurora ainda compila/simula/edita;
        // so o LSP de Verilog (diagnostico/format/outline/hover) que fica
        // indisponivel ate o setup, o editor cai pro highlight estatico.
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
    extractLsOnly,
    DOWNLOAD_URL,
    VERIBLE_TAG,
    VERIBLE_FILENAME,
    INSTALL_DIR,
    BIN_DIR,
    SENTINEL_FILE,
};
