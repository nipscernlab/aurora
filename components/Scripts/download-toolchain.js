// @ts-check
/**
 * Aurora IDE - Toolchain bootstrap
 *
 * Downloads the unified mingw toolchain bundle (aurora-msys-v1.zip) from
 * GitHub Releases and extracts it into components/Packages/ if not already
 * present. The bundle is a pinned MSYS2/mingw64 snapshot carrying the whole
 * FOSS toolchain in ONE place:
 *
 *   components/Packages/msys/
 *     mingw64/bin/   iverilog, vvp, yosys, verilator, perl, g++, make,
 *                    ccache, python + shared DLLs
 *     mingw64/lib/   ivl/ (iverilog backends), python3.12/ (+ cocotb with
 *                    both VPIs: libcocotbvpi_icarus.vpl + the static
 *                    libcocotbvpi_verilator.a), gcc/
 *     mingw64/share/ verilator/, yosys/
 *     usr/bin/       bash + coreutils (verilated.mk)
 *
 * This replaces the old split (toolchain-v2 = iverilog/7-Zip/PRISM, plus a
 * separate verilator-v2). iverilog/yosys/verilator/python all live here now;
 * netlistsvg runs in-process from node_modules (@silimate/netlistsvg);
 * gtkwave-nipscern and the YANC compilers are separate downloads.
 *
 * Usage:  node components/scripts/download-toolchain.js [--force]
 *   --force   re-download even if the bundle is already present
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
// extract.js precisa vir antes de qualquer I/O: e ele que dimensiona o pool
// de threads do Node pelo numero de nucleos, e o pool nasce no primeiro uso.
const { extractZip: extrairZip } = require('./lib/extract');
const { escreverCarimbo, decidir, NOME_PADRAO } = require('./lib/version_stamp');
const { verifyChecksum } = require('./lib/checksum');

// ── Configuration ────────────────────────────────────────────────────────────

// Pin the artifact's SHA-256 to enforce integrity (publish a SHA256SUMS per
// release). null = compute + log only (no enforcement yet).
const EXPECTED_SHA256 = null;

const MSYS_TAG      = 'msys-v1';
const MSYS_FILENAME = 'aurora-msys-v1.zip';
const GITHUB_OWNER  = 'nipscernlab';
// The bundle is built + published by the dedicated, reproducible pipeline in
// nipscernlab/aurora-toolchain (CI: pinned MSYS2 → cocotb VPI → assemble → trim
// → 4-flow smoke → release). To evolve it, bump manifest.txt there and re-run.
const GITHUB_REPO   = 'aurora-toolchain';

const MSYS_DOWNLOAD_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${MSYS_TAG}/${MSYS_FILENAME}`;

const ROOT_DIR     = path.join(__dirname, '..', '..');
const PACKAGES_DIR = path.join(ROOT_DIR, 'components', 'Packages');
// Sentinel: a binary deep in the bundle, proving a full extraction.
const MSYS_SENTINEL = path.join(PACKAGES_DIR, 'msys', 'mingw64', 'bin', 'verilator_bin.exe');
const TMP_ZIP       = path.join(ROOT_DIR, MSYS_FILENAME);
// O carimbo da versao instalada (lib/version_stamp.js). O catalogo do main
// (main/components/registry.js) le este mesmo arquivo para dizer "atualizacao
// disponivel"; os dois caminhos sao amarrados por teste.
const VERSION_STAMP = path.join(PACKAGES_DIR, 'msys', NOME_PADRAO);

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(/** @type {string} */ msg) { console.log(`[toolchain] ${msg}`); }
function err(/** @type {string} */ msg) { console.error(`[toolchain] ERROR: ${msg}`); }

function bundleInstalled(sentinelPath = MSYS_SENTINEL) {
    return fs.existsSync(sentinelPath);
}

// cocotb marker: the static Verilator VPI baked into the bundle's Python.
// Lives under msys/mingw64/lib/python3.<minor>/site-packages, scan for any
// python3.* so this survives a future Python minor bump. A bundle missing it
// (e.g. an older snapshot) triggers a re-download to upgrade in place.
function cocotbInstalled() {
    const libBase = path.join(PACKAGES_DIR, 'msys', 'mingw64', 'lib');
    let entries;
    try {
        entries = fs.readdirSync(libBase);
    } catch (_e) {
        return false;
    }
    return entries.some((name) =>
        /^python3\./i.test(name) &&
        fs.existsSync(path.join(
            libBase, name, 'site-packages', 'cocotb', 'libs', 'libcocotbvpi_verilator.a',
        )),
    );
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

        // Resolve only after the file is fully flushed and closed, otherwise
        // PowerShell's Expand-Archive races us and hits the zip while it's
        // still locked by this writer (silent corruption: the zip vanishes,
        // Packages/ ends up empty).
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
        doRequest(url);
    });
}

async function extractZip(/** @type {string} */ zipPath, /** @type {string} */ destDir) {
    // components/Scripts/lib/extract.js: paralelo, com CRC conferido, e com o
    // Expand-Archive de antes como reserva se algo sair do esperado. Levava
    // mais de dois minutos nos dezessete mil arquivos do bundle; agora sao
    // segundos, e a barra do painel anda durante a extracao.
    await extrairZip(zipPath, destDir, { log, tag: 'toolchain' });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const force = process.argv.includes('--force');

    const haveBundle = bundleInstalled();
    const haveCocotb = cocotbInstalled();
    const carimbo = decidir({ instalado: haveBundle && haveCocotb, carimbo: VERSION_STAMP, tag: MSYS_TAG });
    if (carimbo.pular && !force) {
        log(`Toolchain bundle ${MSYS_TAG} (with cocotb) already present — skipping download.`);
        log('(Run with --force to re-download.)');
        return;
    }
    if (carimbo.motivo === 'outra-versao') {
        log(`Toolchain bundle ${carimbo.gravada} installed but ${MSYS_TAG} is pinned — re-downloading.`);
    } else if (haveBundle && !haveCocotb) {
        log('Toolchain bundle present but missing cocotb support — upgrading.');
    } else if (!haveBundle) {
        log('Toolchain bundle not found in components/Packages/msys.');
    }

    try {
        await downloadFile(MSYS_DOWNLOAD_URL, TMP_ZIP);
        await verifyChecksum(TMP_ZIP, EXPECTED_SHA256, log);
        await extractZip(TMP_ZIP, PACKAGES_DIR);
        fs.unlinkSync(TMP_ZIP);
        log('Toolchain bundle installed successfully.');
        if (!bundleInstalled()) {
            err(`Sentinel not found after extraction: ${MSYS_SENTINEL}`);
            err('The ZIP may have an unexpected internal layout. Check components/Packages/msys/ manually.');
            process.exit(1);
        }
        // So depois de a sentinela confirmar: um zip truncado nao pode deixar no
        // disco uma promessa de versao que nao esta la.
        escreverCarimbo(VERSION_STAMP, MSYS_TAG);
        if (!cocotbInstalled()) {
            err('Bundle extracted but cocotb support is missing — the cocotb Wave flow will be unavailable.');
        }
    } catch (e) {
        err(e instanceof Error ? e.message : String(e));
        err('\nCould not download the toolchain bundle automatically.');
        err('Please download manually from:');
        err(`  ${MSYS_DOWNLOAD_URL}`);
        err('Extract the ZIP contents into:  components/Packages/');
        // Non-fatal: don't hard-block `npm start`. The IDE surfaces a clear
        // "run npm run bootstrap" error when a tool is actually invoked.
        process.exit(0);
    }
}

// Only run main when invoked directly (`node download-toolchain.js`).
// When imported by tests via require(), this is skipped.
if (require.main === module) {
    main();
}

module.exports = {
    bundleInstalled,
    cocotbInstalled,
    downloadFile,
    extractZip,
    MSYS_DOWNLOAD_URL,
    MSYS_TAG,
    MSYS_FILENAME,
    MSYS_SENTINEL,
    VERSION_STAMP,
};
