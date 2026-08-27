// @ts-check
/**
 * Aurora IDE - clang-format bootstrap
 *
 * Baixa um build estatico do `clang-format` (LLVM) e o instala em
 * components/Packages/clang-format/bin/clang-format.exe. E o motor de
 * formatacao de C/C++/CMM no editor: o renderer
 * (js/editor/clang_format_integration.js) registra um provider de
 * formatacao do Monaco pra `c`/`cpp`/`cmm` que chama o clang-format via
 * IPC (main/format/clang_format.js) e troca o buffer inteiro pelo texto
 * formatado. CMM e formatado com regras de C (`-assume-filename=*.c`).
 *
 * Fonte: muttleyxd/clang-tools-static-binaries (repack estatico oficial
 * do LLVM, ~2.9MB). E um .exe avulso (sem zip). Pinning: CLANG_FORMAT_TAG
 * + CLANG_FORMAT_FILENAME + EXPECTED_SHA256 abaixo. Pra subir, atualizar
 * a tag/URL e recomputar o SHA-256.
 *
 * Licenca: Apache-2.0 with LLVM exception, atribuicao no LICENSE da raiz;
 * spawn arm's-length (a AURORA so executa o .exe, nao linka) nao contamina
 * a AURORA.
 *
 * Roda no bootstrap, depois do download-verible e antes do copy-components.
 * Best-effort: se falhar, sai com 0 (a AURORA ainda compila/edita; so a
 * formatacao de C/C++/CMM fica indisponivel ate o setup, Verilog usa o
 * Verible, que e independente).
 *
 * Usage:  node components/Scripts/download-clang-format.js [--force]
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { verifyChecksum } = require('./lib/checksum');
const { escreverCarimbo, decidir, NOME_PADRAO } = require('./lib/version_stamp');

// ── Configuration ────────────────────────────────────────────────────────────

// Pinned SHA-256 of clang-format-20_windows-amd64.exe (GitHub release asset,
// immutable per tag). Verified before install; a mismatch aborts.
const EXPECTED_SHA256 = '44011742f30b2ebfd9013aa2b07d802b1b474186fb7904a2f773296f27ff15f9';

const CLANG_FORMAT_TAG      = 'master-796e77c';
const CLANG_FORMAT_FILENAME = 'clang-format-20_windows-amd64.exe';
const DOWNLOAD_URL          = `https://github.com/muttleyxd/clang-tools-static-binaries/releases/download/${CLANG_FORMAT_TAG}/${CLANG_FORMAT_FILENAME}`;

const ROOT_DIR      = path.join(__dirname, '..', '..');
const INSTALL_DIR   = path.join(ROOT_DIR, 'components', 'Packages', 'clang-format');
const BIN_DIR       = path.join(INSTALL_DIR, 'bin');
const SENTINEL_FILE = path.join(BIN_DIR, 'clang-format.exe');
const TMP_FILE      = path.join(INSTALL_DIR, '_clang-format.download');
// Carimbo da versao instalada; o catalogo do main le o mesmo arquivo.
const VERSION_STAMP = path.join(INSTALL_DIR, NOME_PADRAO);

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(/** @type {string} */ msg) { console.log(`[clang-format] ${msg}`); }
function err(/** @type {string} */ msg) { console.error(`[clang-format] ERROR: ${msg}`); }

function alreadyInstalled() {
    return fs.existsSync(SENTINEL_FILE);
}

function downloadFile(/** @type {string} */ url, /** @type {string} */ dest) {
    return new Promise((resolve, reject) => {
        log(`Downloading ${url}`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        const file = fs.createWriteStream(dest);
        let total = 0;
        let received = 0;

        function doRequest(/** @type {any} */ requestUrl, redirectCount = 0) {
            if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }

            const parsedUrl = new URL(requestUrl);
            const opts = {
                hostname: parsedUrl.hostname,
                path:     parsedUrl.pathname + parsedUrl.search,
                headers:  { 'User-Agent': 'aurora-ide-clang-format-bootstrap' }
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
                        process.stdout.write(`\r[clang-format] ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
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

function rmf(/** @type {string} */ p) {
    try { fs.rmSync(p, { force: true }); } catch { /* best-effort */ }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const force = process.argv.includes('--force');

    const carimbo = decidir({ instalado: alreadyInstalled(), carimbo: VERSION_STAMP, tag: CLANG_FORMAT_TAG });
    if (carimbo.pular && !force) {
        log(`clang-format ${CLANG_FORMAT_TAG} already present — skipping download.`);
        return;
    }

    if (carimbo.motivo === 'outra-versao') {
        log(`clang-format ${carimbo.gravada} installed but ${CLANG_FORMAT_TAG} is pinned — re-downloading.`);
    } else if (!alreadyInstalled()) {
        log(`clang-format not found in components/Packages/clang-format/bin/.`);
    }

    try {
        rmf(TMP_FILE);
        await downloadFile(DOWNLOAD_URL, TMP_FILE);
        // Verify BEFORE promoting the temp file to the real binary, so a
        // tampered/truncated download is never executed.
        await verifyChecksum(TMP_FILE, EXPECTED_SHA256, log);
        fs.mkdirSync(BIN_DIR, { recursive: true });
        fs.renameSync(TMP_FILE, SENTINEL_FILE);
        log(`clang-format installed successfully.`);

        if (!alreadyInstalled()) {
            err(`Sentinel file not found after install: ${SENTINEL_FILE}`);
            process.exit(1);
        }
        // So depois de a sentinela confirmar.
        escreverCarimbo(VERSION_STAMP, CLANG_FORMAT_TAG);
    } catch (e) {
        rmf(TMP_FILE);
        err(e instanceof Error ? e.message : String(e));
        err(`\nCould not download clang-format automatically.`);
        err(`Please download manually from:`);
        err(`  ${DOWNLOAD_URL}`);
        err(`Save it as:  components/Packages/clang-format/bin/clang-format.exe`);
        // Exit 0 pra nao bloquear npm start. Aurora ainda compila/edita; so a
        // formatacao de C/C++/CMM (Shift+Alt+F) que fica indisponivel ate o setup.
        process.exit(0);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    alreadyInstalled,
    downloadFile,
    DOWNLOAD_URL,
    CLANG_FORMAT_TAG,
    CLANG_FORMAT_FILENAME,
    INSTALL_DIR,
    BIN_DIR,
    SENTINEL_FILE,
    VERSION_STAMP,
};
