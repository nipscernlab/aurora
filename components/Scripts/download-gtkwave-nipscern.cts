/**
 * Aurora IDE - GTKWave (nipscern fork) bootstrap
 *
 * Baixa o bundle Windows do gtkwave-nipscern e extrai em
 * components/Packages/gtkwave-nipscern/. O bundle e portatil, traz
 * gtkwave.exe + fst2vcd.exe + todas as DLLs do GTK runtime, sem
 * dependencia de MSYS2 instalado.
 *
 * Fork inclui: --zoom-fit, dark signal panel, SST removido,
 * --left-justify. Substitui o gtkwave do toolchain-v2.zip principal
 * (que continua sendo baixado pelo iverilog + yosys; so o gtkwave dele
 * vira codigo morto).
 *
 * Roda no prestart, depois do download-toolchain e antes do
 * copy-components.
 *
 * Pinning: tag em GTKWAVE_TAG abaixo. Pra subir uma versao nova,
 * atualizar a tag e o EXPECTED_SHA256 e publicar o release em
 * nipscernlab/gtkwave-nipscern.
 *
 * Usage:  node components/Scripts/download-gtkwave-nipscern.cts [--force]
 */

const https = require('https') as typeof import('https');
const fs    = require('fs') as typeof import('fs');
const path  = require('path') as typeof import('path');
const { extractZip: extrairZip } = require('./lib/extract') as typeof import('./lib/extract.js');
const { escreverCarimbo, decidir, NOME_PADRAO } = require('./lib/version_stamp') as typeof import('./lib/version_stamp.js');
const { verifyChecksum } = require('./lib/checksum') as typeof import('./lib/checksum.js');

// ── Configuration ────────────────────────────────────────────────────────────

// O SHA-256 do zip da release fixada em GTKWAVE_TAG. Sem ele, quem trocasse o
// arquivo da release (a tag e mutavel) entregaria outro binario a todo mundo
// que instalasse depois; com ele, lib/checksum.js recusa extrair. Muda junto
// com a tag: o sha256 vem do campo `digest` do asset na API do GitHub e se
// confere baixando o zip.
const EXPECTED_SHA256: string | null = '781e45f3af6d3bf68671496852c9ad56981ebc1cf0613da0b1e784bb3fcb7e60';

const GTKWAVE_TAG      = 'v0.1.2-nipscern';
const GTKWAVE_FILENAME = `gtkwave-nipscern-v0.1.2-win-x64.zip`;
const GITHUB_OWNER     = 'nipscernlab';
const GITHUB_REPO      = 'gtkwave-nipscern';

const DOWNLOAD_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${GTKWAVE_TAG}/${GTKWAVE_FILENAME}`;

const ROOT_DIR      = path.join(__dirname, '..', '..');
const INSTALL_DIR   = path.join(ROOT_DIR, 'components', 'Packages', 'gtkwave-nipscern');
const SENTINEL_FILE = path.join(INSTALL_DIR, 'gtkwave.exe');
const TMP_ZIP       = path.join(ROOT_DIR, GTKWAVE_FILENAME);
// Carimbo da versao instalada; o catalogo do main le o mesmo arquivo.
const VERSION_STAMP = path.join(INSTALL_DIR, NOME_PADRAO);

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string): void { console.log(`[gtkwave-nipscern] ${msg}`); }
function err(msg: string): void { console.error(`[gtkwave-nipscern] ERROR: ${msg}`); }

function alreadyInstalled(): boolean {
    return fs.existsSync(SENTINEL_FILE);
}

function downloadFile(url: string, dest: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        log(`Downloading ${url}`);

        const file = fs.createWriteStream(dest);
        let total = 0;
        let received = 0;

        function doRequest(requestUrl: string | undefined, redirectCount = 0): void {
            if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }

            const parsedUrl = new URL(String(requestUrl));
            const opts = {
                hostname: parsedUrl.hostname,
                path:     parsedUrl.pathname + parsedUrl.search,
                headers:  { 'User-Agent': 'aurora-ide-gtkwave-nipscern-bootstrap' }
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
                        process.stdout.write(`\r[gtkwave-nipscern] ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
                    }
                });

                res.pipe(file);
                res.on('end', () => process.stdout.write('\n'));
                res.on('error', reject);
            }).on('error', reject);
        }

        // Resolve apenas depois que o stream e fechado, caso contrario
        // o extract roda em cima de um arquivo ainda em escrita.
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
        doRequest(url);
    });
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
    // components/Scripts/lib/extract.js: paralelo, com CRC conferido, e com o
    // Expand-Archive de antes como reserva se algo sair do esperado.
    await extrairZip(zipPath, destDir, { log, tag: 'gtkwave-nipscern' });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const force = process.argv.includes('--force');

    const carimbo = decidir({ instalado: alreadyInstalled(), carimbo: VERSION_STAMP, tag: GTKWAVE_TAG });
    if (carimbo.pular && !force) {
        log(`gtkwave-nipscern ${GTKWAVE_TAG} already present — skipping download.`);
        return;
    }

    if (carimbo.motivo === 'outra-versao') {
        log(`gtkwave-nipscern ${carimbo.gravada} installed but ${GTKWAVE_TAG} is pinned — re-downloading.`);
    } else if (!alreadyInstalled()) {
        log(`gtkwave-nipscern not found in components/Packages/gtkwave-nipscern/.`);
    }

    try {
        await downloadFile(DOWNLOAD_URL, TMP_ZIP);
        await verifyChecksum(TMP_ZIP, EXPECTED_SHA256, log);
        // Zip nao tem prefixo de pasta (gtkwave.exe esta na raiz),
        // entao extraimos direto no INSTALL_DIR e fica
        // components/Packages/gtkwave-nipscern/gtkwave.exe.
        await extractZip(TMP_ZIP, INSTALL_DIR);
        fs.unlinkSync(TMP_ZIP);
        log(`gtkwave-nipscern installed successfully.`);

        if (!alreadyInstalled()) {
            err(`Sentinel file not found after extraction: ${SENTINEL_FILE}`);
            err(`The ZIP may have a different internal structure.`);
            process.exit(1);
        }
        // So depois de a sentinela confirmar.
        escreverCarimbo(VERSION_STAMP, GTKWAVE_TAG);
    } catch (e) {
        err(e instanceof Error ? e.message : String(e));
        err(`\nCould not download gtkwave-nipscern automatically.`);
        err(`Please download manually from:`);
        err(`  ${DOWNLOAD_URL}`);
        err(`Extract the ZIP contents into:  components/Packages/gtkwave-nipscern/`);
        // Exit 0 pra nao bloquear npm start. Aurora ainda compila/simula;
        // so o botao Wave que vai falhar ate o setup ser feito.
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
    GTKWAVE_TAG,
    GTKWAVE_FILENAME,
    INSTALL_DIR,
    SENTINEL_FILE,
    VERSION_STAMP,
};
