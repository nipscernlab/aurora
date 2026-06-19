// @ts-check
/**
 * Aurora IDE - slang-server bootstrap
 *
 * Baixa o build Windows do slang-server (LSP de SystemVerilog baseado na
 * lib slang, da Hudson River Trading) e extrai o slang-server.exe em
 * components/Packages/slang-server/bin/. E o motor do O11: analise
 * SEMANTICA (elaboracao completa) do design — pega erros que o lint
 * sintatico do Verible (O2) nao ve (sinal nao declarado, tipo errado,
 * porta errada, etc.) e oferece autocompletar. O renderer
 * (js/editor/slang_integration.js) liga via JSON-RPC stdio
 * (main/lsp/slang_lsp.js); coexiste com o Verible (cada um marca seus
 * diagnostics com a propria fonte).
 *
 * Fonte: GitHub releases do hudson-trading/slang-server (asset win64,
 * ~2.9MB). O zip traz slang-server.exe + README.txt; so o .exe e mantido.
 * Pinning: SLANG_SERVER_TAG + EXPECTED_SHA256 abaixo. Pra subir, atualizar
 * a tag/URL e recomputar o SHA-256.
 *
 * Licenca MIT — atribuicao no LICENSE da raiz; spawn arm's-length (a
 * AURORA so executa o .exe, nao linka) nao contamina a AURORA.
 *
 * Roda no bootstrap, depois do download-clang-format e antes do
 * copy-components. Best-effort: se falhar, sai com 0 (a AURORA ainda
 * compila/edita; so a analise semantica slang fica indisponivel ate o
 * setup — o Verilog ainda tem o Verible, que e independente).
 *
 * Usage:  node components/Scripts/download-slang-server.js [--force]
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');
const { verifyChecksum } = require('./lib/checksum');

// ── Configuration ────────────────────────────────────────────────────────────

// Pinned SHA-256 of slang-server-windows-x64.zip (GitHub release asset,
// immutable per tag). Verified before extraction; a mismatch aborts.
const EXPECTED_SHA256 = '4894aab4ed353aea0f8630690b3c8b387a81e43cad6f78d6d91e65b60d99c5ba';

const SLANG_SERVER_TAG      = 'v0.2.7';
const SLANG_SERVER_FILENAME = 'slang-server-windows-x64.zip';
const DOWNLOAD_URL          = `https://github.com/hudson-trading/slang-server/releases/download/${SLANG_SERVER_TAG}/${SLANG_SERVER_FILENAME}`;

const LS_EXE_NAME = 'slang-server.exe';

const ROOT_DIR      = path.join(__dirname, '..', '..');
const INSTALL_DIR   = path.join(ROOT_DIR, 'components', 'Packages', 'slang-server');
const BIN_DIR       = path.join(INSTALL_DIR, 'bin');
const SENTINEL_FILE = path.join(BIN_DIR, LS_EXE_NAME);
const TMP_ZIP       = path.join(ROOT_DIR, SLANG_SERVER_FILENAME);
const TMP_EXTRACT   = path.join(INSTALL_DIR, '_extract');

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(/** @type {string} */ msg) { console.log(`[slang-server] ${msg}`); }
function err(/** @type {string} */ msg) { console.error(`[slang-server] ERROR: ${msg}`); }

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
                headers:  { 'User-Agent': 'aurora-ide-slang-server-bootstrap' }
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
                        process.stdout.write(`\r[slang-server] ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
                    }
                });

                res.pipe(file);
                res.on('end', () => process.stdout.write('\n'));
                res.on('error', reject);
            }).on('error', reject);
        }

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

// O zip traz slang-server.exe (+ README.txt) na raiz; pode (em outras
// versoes) vir numa subpasta. Acha o .exe em ate 1 nivel e move SO ele
// pra bin/, descartando o README/restante.
function extractExeOnly() {
    let found = null;
    const direct = path.join(TMP_EXTRACT, LS_EXE_NAME);
    if (fs.existsSync(direct)) {
        found = direct;
    } else {
        for (const entry of fs.readdirSync(TMP_EXTRACT, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const candidate = path.join(TMP_EXTRACT, entry.name, LS_EXE_NAME);
            if (fs.existsSync(candidate)) { found = candidate; break; }
        }
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
        log(`slang-server already present — skipping download.`);
        return;
    }

    if (!alreadyInstalled()) {
        log(`slang-server not found in components/Packages/slang-server/bin/.`);
    }

    try {
        rmrf(TMP_EXTRACT);
        await downloadFile(DOWNLOAD_URL, TMP_ZIP);
        await verifyChecksum(TMP_ZIP, EXPECTED_SHA256, log);
        extractZip(TMP_ZIP, TMP_EXTRACT);
        extractExeOnly();
        rmrf(TMP_EXTRACT);
        fs.unlinkSync(TMP_ZIP);
        log(`slang-server installed successfully.`);

        if (!alreadyInstalled()) {
            err(`Sentinel file not found after extraction: ${SENTINEL_FILE}`);
            process.exit(1);
        }
    } catch (e) {
        rmrf(TMP_EXTRACT);
        try { if (fs.existsSync(TMP_ZIP)) fs.unlinkSync(TMP_ZIP); } catch { /* ignore */ }
        err(e instanceof Error ? e.message : String(e));
        err(`\nCould not download slang-server automatically.`);
        err(`Please download manually from:`);
        err(`  ${DOWNLOAD_URL}`);
        err(`Extract ${LS_EXE_NAME} into:  components/Packages/slang-server/bin/`);
        // Exit 0 pra nao bloquear npm start. Aurora ainda compila/edita; so a
        // analise semantica slang (O11) que fica indisponivel ate o setup.
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
    extractExeOnly,
    DOWNLOAD_URL,
    SLANG_SERVER_TAG,
    SLANG_SERVER_FILENAME,
    INSTALL_DIR,
    BIN_DIR,
    SENTINEL_FILE,
};
