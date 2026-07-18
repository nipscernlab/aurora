// @ts-check
/**
 * Aurora IDE - Surfer bootstrap
 *
 * Instala o build Windows do NOSSO fork do Surfer (waveform viewer em Rust)
 * como surfer-aurora.exe em components/Packages/surfer/. Surfer e o viewer
 * opt-in (toggle GTKWave<->Surfer); sem ele, o botao Wave cai pro GTKWave.
 *
 * Fork: gitlab.com/nips-cern/surfer-aurora (fork de surfer-project/surfer),
 * onde ficam as melhorias da NIPSCERN. Licenca EUPL-1.2 — atribuicao no
 * LICENSE da raiz; spawn arm's-length (a AURORA so executa o .exe, nao linka)
 * nao contamina a AURORA. O fork fica PUBLICO por exigencia da EUPL.
 *
 * PUBLICACAO DO ARTEFATO: enquanto o CI do fork nao publicar o zip do binario
 * (PUBLISHED=false abaixo), este script NAO baixa nada — deliberadamente. Ele
 * jamais baixa o surfer.exe do upstream pra renomear como nosso, o que
 * mascararia as melhorias do fork por um binario sem elas. Ate la, o
 * surfer-aurora.exe e provido pelo build local (cargo build --release no fork
 * -> target/release/surfer.exe, renomeado). Quando o CI publicar, vire
 * PUBLISHED=true e preencha FORK_ARTIFACT (URL + SHA-256 + tag) que a maquina
 * de download abaixo (intacta) passa a instalar automaticamente.
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
const { verifyChecksum } = require('./lib/checksum');

// ── Configuration ────────────────────────────────────────────────────────────

// Vira true quando o CI do fork (gitlab.com/nips-cern/surfer-aurora) publicar
// um zip do binario Windows no registro de pacotes. Enquanto false, o
// surfer-aurora.exe vem do build local — nunca do upstream (ver header).
const PUBLISHED = true;

// O pacote publicado pelo CI do fork (.gitlab-ci-aurora.yml). `url` aponta pro
// registro generico do FORK (projeto 84576006 = nips-cern/surfer-aurora, id
// numerico p/ ser estavel a renomeacoes); `sha256` e o hash imutavel do zip
// daquela tag (verificado antes de extrair). Pra subir de versao: nova tag ->
// CI publica -> atualizar tag/filename/sha256/url aqui.
/** @type {{ url: string, sha256: string, filename: string, tag: string } | null} */
const FORK_ARTIFACT = PUBLISHED ? {
    tag:      'v0.7.0-nips.1',
    filename: 'surfer-aurora_win_v0.7.0-nips.1.zip',
    sha256:   '5823ac77f0c7b9a9ba165f11c690c0e0490f7d03f8eb5ad7645c1e3ba6c66e15',
    url:      'https://gitlab.com/api/v4/projects/84576006/packages/generic/surfer-aurora/v0.7.0-nips.1/surfer-aurora_win_v0.7.0-nips.1.zip',
} : null;

const ROOT_DIR      = path.join(__dirname, '..', '..');
const INSTALL_DIR   = path.join(ROOT_DIR, 'components', 'Packages', 'surfer');
// O binario do fork. A AURORA resolve/allowlista EXATAMENTE este nome
// (wave_toolchain.js, binary_allowlist.js) — manter em sync.
const SENTINEL_FILE = path.join(INSTALL_DIR, 'surfer-aurora.exe');
const TMP_ZIP       = FORK_ARTIFACT ? path.join(ROOT_DIR, FORK_ARTIFACT.filename) : '';

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

// Se o zip do fork trouxe o binario dentro de uma subpasta, sobe os arquivos
// um nivel pra o sentinel ficar em INSTALL_DIR/surfer-aurora.exe.
function flattenIfNested(/** @type {string} */ dir) {
    if (fs.existsSync(SENTINEL_FILE)) return;
    const wanted = path.basename(SENTINEL_FILE); // surfer-aurora.exe
    let found = null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(dir, entry.name, wanted);
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
        log(`surfer-aurora already present — skipping.`);
        return;
    }

    // Ate o CI do fork publicar um artefato, NAO ha de onde baixar o binario
    // COM as melhorias do fork. Nao caimos pro upstream (isso instalaria um
    // Surfer sem as nossas mudancas, mascarado com o nosso nome). Instrui e sai
    // limpo — o build local prove o surfer-aurora.exe nesse meio-tempo.
    if (!FORK_ARTIFACT) {
        log(`surfer-aurora nao encontrado e o CI do fork ainda nao publica binario.`);
        log(`Providencie o build local:`);
        log(`  1) git clone https://gitlab.com/nips-cern/surfer-aurora.git`);
        log(`  2) cd surfer-aurora && cargo build --release`);
        log(`  3) copie target/release/surfer.exe -> components/Packages/surfer/surfer-aurora.exe`);
        log(`(Surfer e opt-in; sem ele o botao Wave usa o GTKWave.)`);
        return; // exit 0 implicito — nao bloqueia o bootstrap
    }

    try {
        await downloadFile(FORK_ARTIFACT.url, TMP_ZIP);
        await verifyChecksum(TMP_ZIP, FORK_ARTIFACT.sha256, log);
        extractZip(TMP_ZIP, INSTALL_DIR);
        flattenIfNested(INSTALL_DIR);
        fs.unlinkSync(TMP_ZIP);
        log(`surfer-aurora installed successfully.`);

        if (!alreadyInstalled()) {
            err(`Sentinel file not found after extraction: ${SENTINEL_FILE}`);
            err(`The ZIP may have a different internal structure.`);
            process.exit(1);
        }
    } catch (e) {
        err(e instanceof Error ? e.message : String(e));
        err(`\nCould not download surfer-aurora automatically.`);
        err(`Please download manually from:`);
        err(`  ${FORK_ARTIFACT.url}`);
        err(`Extract surfer-aurora.exe into:  components/Packages/surfer/`);
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
    PUBLISHED,
    FORK_ARTIFACT,
    INSTALL_DIR,
    SENTINEL_FILE,
};
