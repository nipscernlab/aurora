// @ts-check
/**
 * Aurora IDE - YANC compiler bootstrap
 *
 * Baixa yanc-bin-vX.zip do release pinado em
 * github.com/nipscernlab/yanc e extrai em components/. O zip contem:
 *   - bin/  (cmmcomp.exe, cppcomp.exe, asmcomp.exe, cpppp.exe,
 *            appcomp.exe, comp2gtkw.exe — 6 binarios desde v4)
 *   - HDL/  (processor.v, core.v, addr_dec.v, instr_dec.v, ula.v,
 *            myFIFO.v — bibliotecas verilog do toolchain SAPHO, v2+)
 *   - Macros/ (Sin_LUT.txt, Arctan_LUT.txt, float_*.asm — LUTs e
 *              helpers de ponto flutuante, v2+)
 *   - Header/ (shims de C++ que .cpp programs incluem, v4+)
 *
 * Scripts/ NAO esta incluso porque o components/Scripts/ do Aurora
 * mistura scripts SAPHO com scripts proprios de build (este aqui,
 * copy-components.js, etc.) — overwrite wholesale quebraria o build.
 *
 * Roda no prestart, depois do download do toolchain principal e antes
 * do copy-components.
 *
 * Padrao seguido do download-toolchain.js — mesma logica de download
 * com retry de redirect, fallback PowerShell -> 7-Zip, e exit 0 em
 * falha pra nao bloquear `npm start` (devs offline ainda conseguem
 * iniciar a IDE).
 *
 * Pinning: a tag esperada vive em YANC_TAG abaixo. Pra subir uma
 * versao nova, atualizar a tag aqui e tambem gerar/publicar o release
 * correspondente em nipscernlab/yanc (workflow `release.yml`).
 *
 * Sentinel: usamos cppcomp.exe porque foi adicionado no v4 — devs com
 * instalacao v3 antiga (so 4 binarios) tem o sentinel falhando e o
 * script re-baixa v4 automaticamente, sem precisar de --force.
 *
 * Usage:  node components/Scripts/download-yanc.js [--force]
 *   --force   re-download even if components/bin/cppcomp.exe is present
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

// ── Configuration ────────────────────────────────────────────────────────────

const YANC_TAG      = 'v4';
const YANC_FILENAME = `yanc-bin-${YANC_TAG}.zip`;
const GITHUB_OWNER  = 'nipscernlab';
const GITHUB_REPO   = 'yanc';

const DOWNLOAD_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${YANC_TAG}/${YANC_FILENAME}`;

const ROOT_DIR      = path.join(__dirname, '..', '..');
const BIN_DIR       = path.join(ROOT_DIR, 'components', 'bin');
const SENTINEL_FILE = path.join(BIN_DIR, 'cppcomp.exe');
const TMP_ZIP       = path.join(ROOT_DIR, YANC_FILENAME);

// Aurora ja baixa um toolchain principal e se beneficia do 7-Zip que
// veio com ele — usar o mesmo binario aqui se ja esta presente.
const PACKAGED_7ZIP = path.join(ROOT_DIR, 'components', 'Packages', '7-Zip', '7z.exe');

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[yanc] ${msg}`); }
function err(msg) { console.error(`[yanc] ERROR: ${msg}`); }

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
                headers:  { 'User-Agent': 'aurora-ide-yanc-bootstrap' }
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
                        process.stdout.write(`\r[yanc] ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
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

function extractZip(zipPath, destDir) {
    log(`Extracting ${path.basename(zipPath)} → ${destDir}`);
    fs.mkdirSync(destDir, { recursive: true });

    if (fs.existsSync(PACKAGED_7ZIP)) {
        execSync(`"${PACKAGED_7ZIP}" x "${zipPath}" -o"${destDir}" -y`, { stdio: 'inherit' });
        return;
    }

    // Fallback: PowerShell Expand-Archive. ErrorActionPreference=Stop pra
    // que falha de cmdlet propague exit code != 0 (sem isso, execSync
    // pensa que deu certo e a gente apaga o zip antes do sentinel check).
    execSync(
        `powershell -NoProfile -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`,
        { stdio: 'inherit' }
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const force = process.argv.includes('--force');

    if (alreadyInstalled() && !force) {
        log(`YANC binaries already present in components/bin/ — skipping download.`);
        log(`(Run with --force to re-download.)`);
        return;
    }

    if (!alreadyInstalled()) {
        log(`YANC binaries not found in components/bin/.`);
    }

    try {
        await downloadFile(DOWNLOAD_URL, TMP_ZIP);
        // O zip empacota como bin/cmmcomp.exe etc. Extraindo em
        // components/ resulta em components/bin/cmmcomp.exe — perfeito.
        const COMPONENTS_DIR = path.join(ROOT_DIR, 'components');
        extractZip(TMP_ZIP, COMPONENTS_DIR);

        fs.unlinkSync(TMP_ZIP);
        log(`YANC binaries installed successfully.`);

        if (!alreadyInstalled()) {
            err(`Sentinel file not found after extraction: ${SENTINEL_FILE}`);
            err(`The ZIP may have a different internal structure. Check components/bin/ manually.`);
            process.exit(1);
        }
    } catch (e) {
        err(e.message);
        err(`\nCould not download YANC binaries automatically.`);
        err(`Please download manually from:`);
        err(`  ${DOWNLOAD_URL}`);
        err(`Extract the ZIP contents into:  components/  (so it produces components/bin/)`);
        // Exit 0 pra nao bloquear `npm start`. Quem nao tem cmmcomp/etc.
        // pode usar a IDE pro resto (editor, file tree, PRISM, etc.) sem
        // conseguir compilar C±/ASM. O botao C+- vai dar "system cannot
        // find the path specified" no terminal tcmm ate o setup ser feito.
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
    DOWNLOAD_URL,
    YANC_TAG,
    YANC_FILENAME,
    SENTINEL_FILE,
};
