/**
 * Aurora IDE - YANC compiler bootstrap
 *
 * Baixa yanc-bin-vX.zip do release pinado em
 * github.com/nipscernlab/yanc e extrai em components/. O zip contem:
 *   - bin/  (cmmcomp.exe, cppcomp.exe, asmcomp.exe, cpppp.exe,
 *            appcomp.exe, comp2gtkw.exe desde v4, mais gen_gtkw.exe
 *            desde v5.0: sao 7 binarios, nao 6)
 *   - SAPHO/ (processor.v, core.v, addr_dec.v, instr_dec.v, ula.v,
 *            myFIFO.v, o Verilog do processador SAPHO. Chamava-se HDL/
 *            ate a v5.5; a v5.6 entrega as duas, HDL/ como copia de
 *            transicao, e a Aurora le SAPHO/ desde entao. A v5.7 traz
 *            so SAPHO/.
 *            v5.4 acrescentou o parametro FROUND, o nivel de
 *            arredondamento do float, em processor/core/ula.
 *            v5.5 tirou LDA/STA do ISA e renumerou os opcodes, entao
 *            Verilog e asmcomp de versoes diferentes nao funcionam juntos.
 *            v5.6 fez do instr_dec uma function e corrigiu a inversao
 *            de bits da FFT no mem_ctrl; portas e parametros iguais.
 *            v5.7 calcula a profundidade das pilhas pelo programa quando
 *            #NDSTAC/#SDEPTH faltam, recusa recursao em C+-, tira o codigo
 *            morto do .asm e do hardware, e no C++ compila <cstring> e
 *            ponteiro de funcao. ISA e codificacao iguais aos da v5.5/v5.6.
 *            v6.0 poe dois registradores dentro de cada divisor (DIV, MOD,
 *            F_DIV): o resultado sai dois ciclos depois, toda divisao vira
 *            `DIV x; NOP; QUO` (REM, F_QUO), e o divisor deixa de limitar o
 *            relogio. SAPHO/ e asmcomp tem de vir da mesma release.
 *            v7.1 traz o driver yanc (a Aurora chama so ele), uma pasta de
 *            saida por processador (<proc>/<proc>/) no lugar de Software/,
 *            Hardware/, Simulation/ e Temp/, o nome do processador vindo do
 *            arquivo (#PRNAME vira erro), --lang em todas as ferramentas, o
 *            cpppp e o appcomp dentro do cppcomp e do asmcomp, UTF-8 e nenhum
 *            caminho absoluto no Verilog gerado, e os links toma/cade entre
 *            processadores (TOM e CAD nos opcodes 20 e 21).
 *            v8.0 corta os divisores em cinco estagios (DIV, MOD) e quatro
 *            (F_DIV): `DIV x; NOP; NOP; NOP; QUO` e `F_DIV x; NOP; NOP;
 *            F_QUO`; o asmcomp poe um NOP entre operacao float e JIZ/LDI/ILI
 *            logo depois; condicao float testa a mantissa, como no C; o
 *            sapho_all vai de 21,8 a 32,4 MHz na DE10-Nano e de 23,5 a 37,3
 *            na ZYBO. SAPHO/ e asmcomp tem de vir da mesma release.
 *            v9.0 traz perifericos em SAPHO/, ao lado do processador: o
 *            teclado PS/2 (myKeyPS2.v), lido com cade_sync(k); programa sem
 *            float dispensa #NBMANT/#NBEXPO; o numero de porta de IN/OUT
 *            deixa de ser cortado na largura do endereco; F_SCL corrigido.
 *            SAPHO/ e asmcomp tem de vir da mesma release.
 *            v9.1 traz a tela de texto VGA (myVGAText.v, escrita com
 *            toma_sync), o teclado revisado (Ctrl, tem_tecla), uma tabela de
 *            codigos comum aos dois, e no C++ os headers <iostream>,
 *            <cstdio> e um <cstring> completo sobre o teclado e a tela.)
 *   - Macros/ (float_*.asm, helpers de ponto flutuante. v5.1 trocou as
 *              LUTs Sin_LUT.txt/Arctan_LUT.txt por minimax; .txt removidos.)
 *   - Header/ (shims de C++ que .cpp programs incluem, v4+)
 *   - README.md e example/ na raiz, desde v5.6 (o que e cada pasta e um
 *     programa de exemplo em C++ e em C+-). Caem em components/ e ficam
 *     no .gitignore.
 *
 * Scripts/ NAO esta no zip a partir do v4.1, o yanc parou de empacotar
 * essa pasta (proc2rtl.ys / TCLs antigos). Aurora gerencia seus proprios
 * scripts em components/Scripts/ (copy-components, download-*).
 *
 * Roda no prestart, depois do download do toolchain principal e antes
 * do copy-components.
 *
 * Padrao seguido do download-toolchain.cts, mesma logica de download
 * com retry de redirect, extracao via PowerShell, e exit 0 em
 * falha pra nao bloquear `npm start` (devs offline ainda conseguem
 * iniciar a IDE).
 *
 * Pinning: a tag esperada vive em YANC_TAG abaixo. Pra subir uma
 * versao nova, atualizar a tag aqui e tambem gerar/publicar o release
 * correspondente em nipscernlab/yanc (workflow `release.yml`).
 *
 * Sentinel: usamos cppcomp.exe porque foi adicionado no v4, devs com
 * instalacao v3 antiga (so 4 binarios) tem o sentinel falhando e o
 * script re-baixa v4 automaticamente, sem precisar de --force.
 *
 * Usage:  node components/Scripts/download-yanc.cts [--force]
 *   --force   re-download even if components/bin/cppcomp.exe is present
 */

// .cts: TypeScript em CommonJS, que o Node 22 e o do Electron executam
// direto (sem build), e que quem le este modulo continua carregando com
// require. O `as typeof import(...)` so da os tipos; o Node o apaga.
const https = require('https') as typeof import('https');
const fs    = require('fs') as typeof import('fs');
const path  = require('path') as typeof import('path');
const { extractZip: extrairZip } = require('./lib/extract') as typeof import('./lib/extract.js');
const { escreverCarimbo } = require('./lib/version_stamp') as typeof import('./lib/version_stamp.js');
const { verifyChecksum } = require('./lib/checksum') as typeof import('./lib/checksum.js');

// ── Configuration ────────────────────────────────────────────────────────────

// Pin the artifact's SHA-256 to enforce integrity (publish a SHA256SUMS per
// release). null = compute + log only (no enforcement yet).
const EXPECTED_SHA256 = null;

const YANC_TAG      = 'v9.1';
const YANC_FILENAME = `yanc-bin-${YANC_TAG}.zip`;
const GITHUB_OWNER  = 'nipscernlab';
const GITHUB_REPO   = 'yanc';

const DOWNLOAD_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${YANC_TAG}/${YANC_FILENAME}`;

const ROOT_DIR      = path.join(__dirname, '..', '..');
const BIN_DIR       = path.join(ROOT_DIR, 'components', 'bin');
const SENTINEL_FILE = path.join(BIN_DIR, 'cppcomp.exe');
// Marker of the installed tag. Without it, bumping YANC_TAG does NOT update a
// dev who already has an older version: the sentinels (cppcomp.exe / core.v)
// exist in EVERY version, so the existence check alone skips the download.
// Written after a successful extract; compared against YANC_TAG to force a
// re-download on a version bump (e.g. v5.0 → v5.1, same binaries, new stdlib).
const VERSION_SENTINEL = path.join(BIN_DIR, '.yanc-version');
// The yanc release ships bin/ AND SAPHO/ (Verilog lib) AND Header/ (C++ shims)
// AND Macros/ (float-math .asm), all version-matched with the compilers. None
// of SAPHO/, Header/, Macros/ is committed to the Aurora repo anymore, so a dev
// who pulls the commit that untracked them ends up with bin/ present (gitignored,
// persists) but those folders deleted. Gate "already installed" on a sentinel
// from EACH so that case re-downloads instead of silently leaving the toolchain
// without its SAPHO library / C++ headers / float macros.
const HDL_SENTINEL    = path.join(ROOT_DIR, 'components', 'SAPHO', 'core.v');
const HEADER_SENTINEL = path.join(ROOT_DIR, 'components', 'Header', 'cmath');
const MACROS_SENTINEL = path.join(ROOT_DIR, 'components', 'Macros', 'float_sin.asm');
const TMP_ZIP       = path.join(ROOT_DIR, YANC_FILENAME);
const COMPONENTS_DIR = path.join(ROOT_DIR, 'components');
// As pastas que a release do yanc traz inteiras, e que por isso sao dela: a
// versao nova SUBSTITUI cada uma, nao se mistura com a anterior. Extrair por
// cima deixava o que a nova nao traz mais, e o appcomp e o cpppp, que sairam
// na v7.1, seguiam em bin/ respondendo `--version` 6.0 (issue 213). HDL/ e o
// nome antigo de SAPHO/, que nenhuma release traz desde a v5.7.
const PASTAS_DO_YANC = ['bin', 'SAPHO', 'Header', 'Macros', 'example', 'HDL'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string): void { console.log(`[yanc] ${msg}`); }
function err(msg: string): void { console.error(`[yanc] ERROR: ${msg}`); }

function binariesPresent(): boolean {
    return fs.existsSync(SENTINEL_FILE) && fs.existsSync(HDL_SENTINEL)
        && fs.existsSync(HEADER_SENTINEL) && fs.existsSync(MACROS_SENTINEL);
}

// Tag recorded by the last successful install, or null when absent (installed
// before this marker existed, or never installed).
function installedTag(): string | null {
    try {
        return fs.readFileSync(VERSION_SENTINEL, 'utf8').trim() || null;
    } catch {
        return null;
    }
}

// "Installed AND at the pinned version." Skipping the download only when BOTH
// hold is what makes a YANC_TAG bump actually reach devs who already had the
// previous version.
function alreadyInstalled(): boolean {
    return binariesPresent() && installedTag() === YANC_TAG;
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
                res.on('data', (chunk: Buffer) => {
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
    await extrairZip(zipPath, destDir, { log, tag: 'yanc' });
}

// Apaga as pastas do yanc que existirem em componentsDir e devolve quais.
// O resto de components/ (Packages, Scripts, PyLibs, projetos) nao e do yanc
// e fica.
function limparInstalacaoAnterior(componentsDir: string): string[] {
    const apagadas: string[] = [];
    for (const pasta of PASTAS_DO_YANC) {
        const alvo = path.join(componentsDir, pasta);
        if (!fs.existsSync(alvo)) continue;
        fs.rmSync(alvo, { recursive: true, force: true });
        apagadas.push(pasta);
    }
    return apagadas;
}

// Troca a instalacao anterior pela do zip. Chamada so depois de o zip estar
// baixado e conferido: uma falha de rede nao pode deixar o aluno sem o
// compilador que ele ja tinha.
async function substituirInstalacao(
    zipPath: string,
    componentsDir: string,
    extrair: (zip: string, destino: string) => Promise<void> = extractZip,
): Promise<void> {
    const apagadas = limparInstalacaoAnterior(componentsDir);
    if (apagadas.length) log(`Removed the previous YANC folders: ${apagadas.join(', ')}.`);
    await extrair(zipPath, componentsDir);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const force = process.argv.includes('--force');

    if (alreadyInstalled() && !force) {
        log(`YANC ${YANC_TAG} already installed in components/bin/ — skipping download.`);
        log(`(Run with --force to re-download.)`);
        return;
    }

    if (!binariesPresent()) {
        log(`YANC binaries not found in components/bin/.`);
    } else {
        // Binaries are there but the version doesn't match (or has no marker):
        // a tag bump. Re-download so the new compilers/SAPHO actually land.
        const have = installedTag() || 'unknown (pre-marker)';
        log(`YANC ${have} installed but ${YANC_TAG} is pinned — re-downloading.`);
    }

    try {
        await downloadFile(DOWNLOAD_URL, TMP_ZIP);
        await verifyChecksum(TMP_ZIP, EXPECTED_SHA256, log);
        // O zip empacota como bin/cmmcomp.exe etc. Extraindo em
        // components/ resulta em components/bin/cmmcomp.exe, perfeito.
        await substituirInstalacao(TMP_ZIP, COMPONENTS_DIR);

        fs.unlinkSync(TMP_ZIP);

        if (!binariesPresent()) {
            err(`Sentinel file not found after extraction: ${SENTINEL_FILE}`);
            err(`The ZIP may have a different internal structure. Check components/bin/ manually.`);
            process.exit(1);
        }

        // Record the installed tag ONLY after confirming the binaries, a
        // corrupt/partial download must not leave a marker claiming "v5.1 ok".
        escreverCarimbo(VERSION_SENTINEL, YANC_TAG);
        log(`YANC ${YANC_TAG} installed successfully.`);
    } catch (e) {
        err(e instanceof Error ? e.message : String(e));
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
    binariesPresent,
    installedTag,
    downloadFile,
    extractZip,
    limparInstalacaoAnterior,
    substituirInstalacao,
    PASTAS_DO_YANC,
    COMPONENTS_DIR,
    DOWNLOAD_URL,
    YANC_TAG,
    YANC_FILENAME,
    SENTINEL_FILE,
    VERSION_SENTINEL,
};
