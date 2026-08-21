// @ts-check
/**
 * download-docs.js: traz o manual do SAPHO para dentro do build.
 *
 * A documentação é escrita e gerada em outro repositório
 * (nipscernlab/docs_aurora), que publica cada versão em dois lugares: o site em
 * nipscern.com/library/sapho e um pacote .zip anexado a uma Release. Aqui baixamos
 * esse pacote, para que o botão "documentação offline" funcione sem rede.
 *
 * O manifesto é a fonte da verdade sobre qual é a versão corrente. Ele também é
 * copiado para resources/docs, porque o aplicativo o relê em execução para
 * decidir se existe versão mais nova, assim uma publicação da documentação
 * chega às instalações já feitas, sem esperar uma release da AURORA.
 *
 * A pasta resources/docs é gitignorada: o conteúdo vem da origem a cada
 * bootstrap, como a toolchain.
 *
 * Sai com 0 em qualquer falha, para nunca travar o bootstrap, sem o pacote, o
 * aplicativo simplesmente mostra apenas o botão da documentação online.
 *
 * Uso:  node components/Scripts/download-docs.js [--force]
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractZip: extrairZip } = require('./lib/extract');

const MANIFEST_URL = 'https://nipscernlab.github.io/docs_aurora/docs-manifest.json';

const ROOT_DIR = path.join(__dirname, '..', '..');
const DOCS_DIR = path.join(ROOT_DIR, 'resources', 'docs');
const MANIFEST_FILE = path.join(DOCS_DIR, 'docs-manifest.json');
const INDEX_FILE = path.join(DOCS_DIR, 'index.html');
const TMP_ZIP = path.join(ROOT_DIR, '_sapho-docs.zip');

function log(/** @type {string} */ m) { console.log(`[docs] ${m}`); }
function err(/** @type {string} */ m) { console.error(`[docs] ERROR: ${m}`); }

/**
 * Remove um BOM inicial. JSON.parse o recusa, e ferramentas do Windows gravam
 * UTF-8 com BOM por padrão, como o arquivo vem da rede, toleramos aqui.
 */
function stripBom(/** @type {string} */ text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function get(/** @type {string} */ url, /** @type {(res: any) => void} */ onResponse) {
  return new Promise((resolve, reject) => {
    function doRequest(/** @type {string} */ requestUrl, redirectCount = 0) {
      if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }
      const u = new URL(requestUrl);
      https.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'aurora-ide-bootstrap' },
      }, (res) => {
        const code = res.statusCode || 0;
        if ([301, 302, 307, 308].includes(code) && res.headers.location) {
          res.resume();
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }
        if (code !== 200) { res.resume(); reject(new Error(`HTTP ${code} from ${requestUrl}`)); return; }
        onResponse(res);
        res.on('error', reject);
        res.on('end', resolve);
      }).on('error', reject);
    }
    doRequest(url);
  });
}

async function fetchJson(/** @type {string} */ url) {
  let body = '';
  await get(url, (res) => { res.setEncoding('utf8'); res.on('data', (c) => { body += c; }); });
  return JSON.parse(stripBom(body));
}

async function download(/** @type {string} */ url, /** @type {string} */ dest) {
  log(`Baixando ${url}`);
  const file = fs.createWriteStream(dest);
  try {
    await new Promise((resolve, reject) => {
      file.on('error', reject);
      file.on('finish', resolve);
      get(url, (res) => res.pipe(file)).catch(reject);
    });
  } finally {
    file.close();
  }
}

function sha256(/** @type {string} */ filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function extractZip(/** @type {string} */ zipPath, /** @type {string} */ destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  await extrairZip(zipPath, destDir, { log, tag: 'docs' });
}

function installedVersion() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')).version || '';
  } catch (_) {
    return '';
  }
}

async function main() {
  const force = process.argv.includes('--force');

  try {
    const manifest = await fetchJson(MANIFEST_URL);
    if (!manifest || !manifest.package || !manifest.sha256) {
      throw new Error('Manifesto sem package/sha256.');
    }

    const current = installedVersion();
    if (!force && current === manifest.version && fs.existsSync(INDEX_FILE)) {
      log(`Documentação ${current} já presente — nada a fazer.`);
      return;
    }

    await download(manifest.package, TMP_ZIP);

    // Sem esta conferência um download truncado viraria uma documentação
    // silenciosamente quebrada dentro do instalador.
    const got = sha256(TMP_ZIP);
    if (got !== String(manifest.sha256).toLowerCase()) {
      throw new Error(`SHA-256 nao confere: esperado ${manifest.sha256}, obtido ${got}`);
    }

    await extractZip(TMP_ZIP, DOCS_DIR);
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
    fs.rmSync(TMP_ZIP, { force: true });

    if (!fs.existsSync(INDEX_FILE)) throw new Error('index.html ausente após a extração.');
    log(`Documentação ${manifest.version} instalada em resources/docs.`);
  } catch (e) {
    fs.rmSync(TMP_ZIP, { force: true });
    err(e instanceof Error ? e.message : String(e));
    err('Sem o pacote, a AURORA mostra apenas o botao da documentacao online.');
    err(`Para tentar de novo: node components/Scripts/download-docs.js --force`);
    process.exit(0); // nunca bloqueia o bootstrap
  }
}

if (require.main === module) main();

module.exports = { MANIFEST_URL, DOCS_DIR, MANIFEST_FILE };
