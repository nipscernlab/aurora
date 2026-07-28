// @ts-check
/**
 * fetcher.js — o motor UNICO de download + verificacao + extracao da AURORA.
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * A AURORA baixava coisas em tres lugares diferentes, cada um com sua propria
 * copia da mesma logica (redirect, progresso, hash, extracao):
 *
 *   - components/Scripts/download-*.js  (bootstrap da toolchain, no npm)
 *   - main/ai/cli_downloader.js         (CLIs de IA sob demanda, em runtime)
 *   - e agora as bibliotecas Python do painel
 *
 * Uma quarta copia seria uma quarta chance de errar o mesmo bug (redirect nao
 * seguido, socket que trava sem 'error', arquivo parcial que fica no disco e
 * passa pela checagem de "ja existe"). Este modulo concentra isso: quem precisa
 * baixar algo em runtime chama daqui.
 *
 * O QUE ELE GARANTE
 * -----------------
 *   - Segue redirect (ate 5) — GitHub Releases e o CDN da PyPI usam.
 *   - Faz o hash em streaming, sem carregar o arquivo na memoria.
 *   - Verifica o hash ANTES de extrair. Byte errado nao vira arquivo instalado.
 *   - Timeout de ociosidade: conexao que trava no meio do corpo nao deixa a
 *     Promise pendurada para sempre (isso envenena mapas de dedupe).
 *   - Escreve em arquivo temporario e so promove no fim; download interrompido
 *     nao deixa arquivo pela metade se passando por completo.
 *
 * EXTRACAO
 * --------
 * Usa o bsdtar do Windows (System32/tar.exe, presente desde o Win10 1803), que
 * o libarchive por tras entende zip, tar.gz E tar.zst. Isso cobre de uma vez:
 *   .whl        -> wheel do Python (e um zip)
 *   .tgz        -> tarball do npm (CLIs de IA)
 *   .pkg.tar.zst-> pacote do MSYS2 (caminho futuro das libs compiladas)
 *
 * ATENCAO ao PATH: chamar 'tar' sem caminho absoluto pode resolver para o GNU
 * tar do Git for Windows, que NAO abre zip ("This does not look like a tar
 * archive"). Por isso resolvemos o System32 explicitamente no Windows.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

// Sem logger aqui de proposito: este modulo e a camada de transporte e nao
// conhece o contexto do que esta baixando. Quem chama (pylib_manager,
// cli_downloader) e que sabe dizer "instalada plotly 6.9.0" e loga.

/** Sem dados por este tempo, a conexao e considerada morta. */
const IDLE_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 5;

/**
 * Caminho do extrator. No Windows precisa ser o bsdtar do System32: o 'tar' do
 * PATH pode ser o GNU tar do Git, que nao abre zip. Fora do Windows, o tar do
 * sistema ja e o bsdtar (macOS) ou um GNU tar que resolve .tgz.
 * @returns {string}
 */
function tarBinary() {
  if (process.platform !== 'win32') return 'tar';
  const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const bsdtar = path.join(sysRoot, 'System32', 'tar.exe');
  return fs.existsSync(bsdtar) ? bsdtar : 'tar';
}

/**
 * Baixa `url` para `dest`, calculando o digest em streaming.
 *
 * @param {string} url
 * @param {string} dest                 caminho final do arquivo
 * @param {object} [opts]
 * @param {'sha256'|'sha512'} [opts.algorithm='sha256']
 * @param {'hex'|'base64'} [opts.encoding='hex']
 * @param {(received:number, total:number)=>void} [opts.onChunk]
 * @param {string} [opts.userAgent='aurora-ide']
 * @param {AbortSignal} [opts.signal]   cancelamento cooperativo
 * @returns {Promise<{digest:string, bytes:number}>}
 */
function downloadToFile(url, dest, opts = {}) {
  const algorithm = opts.algorithm || 'sha256';
  const encoding = opts.encoding || 'hex';
  const userAgent = opts.userAgent || 'aurora-ide';
  const onChunk = typeof opts.onChunk === 'function' ? opts.onChunk : null;

  return new Promise((resolve, reject) => {
    // Baixa para um temporario ao lado do destino e so renomeia no fim. Assim
    // um download abortado nunca deixa um arquivo com o nome definitivo (que a
    // proxima execucao leria como "ja baixado").
    const tmp = `${dest}.${process.pid}.part`;
    const file = fs.createWriteStream(tmp);
    const hash = crypto.createHash(algorithm);
    let bytes = 0;
    let settled = false;
    /** @type {any} */
    let activeReq = null;

    const cleanupTmp = () => { try { fs.unlinkSync(tmp); } catch (_) { /* best-effort */ } };

    const done = (/** @type {Error|null} */ err, /** @type {any} */ val) => {
      if (settled) return;
      settled = true;
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      if (err) {
        try { file.destroy(); } catch (_) { /* best-effort */ }
        cleanupTmp();
        reject(err);
        return;
      }
      resolve(val);
    };

    function onAbort() {
      try { activeReq?.destroy(); } catch (_) { /* best-effort */ }
      done(new Error('download cancelado'));
    }
    if (opts.signal) {
      if (opts.signal.aborted) { done(new Error('download cancelado')); return; }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    function request(/** @type {string} */ u, redirects = 0) {
      if (redirects > MAX_REDIRECTS) { done(new Error('redirecionamentos demais')); return; }
      let parsed;
      try { parsed = new URL(u); }
      catch (e) { done(e instanceof Error ? e : new Error(String(e))); return; }
      if (parsed.protocol !== 'https:') { done(new Error(`apenas https e aceito: ${u}`)); return; }

      const req = https.get({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': userAgent, Accept: 'application/octet-stream' },
      }, (res) => {
        const code = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.resume();
          request(new URL(res.headers.location, u).href, redirects + 1);
          return;
        }
        if (code !== 200) {
          res.resume();
          done(new Error(`HTTP ${code} em ${u}`));
          return;
        }
        const total = parseInt(String(res.headers['content-length'] || '0'), 10);
        res.on('data', (chunk) => {
          bytes += chunk.length;
          hash.update(chunk);
          if (onChunk) onChunk(bytes, total);
        });
        res.on('error', done);
        res.pipe(file);
      });

      activeReq = req;
      req.on('error', done);
      // Conexao que para de entregar bytes (portal cativo, link caido que nao
      // emite 'error') deixaria a Promise pendurada. Destruir com erro resolve
      // o `done` e limpa o parcial.
      req.setTimeout(IDLE_TIMEOUT_MS, () => {
        req.destroy(new Error(`download expirou (sem dados por ${IDLE_TIMEOUT_MS / 1000}s)`));
      });
    }

    file.on('error', done);
    file.on('finish', () => file.close(() => {
      if (settled) return;
      try {
        fs.rmSync(dest, { force: true });
        fs.renameSync(tmp, dest);
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      done(null, { digest: hash.digest(encoding), bytes });
    }));

    request(url);
  });
}

/**
 * Compara um digest calculado com o esperado, sem vazar tempo.
 * Aceita 'abc123...' ou o formato SRI 'sha512-<base64>'.
 * @param {string} actual
 * @param {string} expected
 * @returns {boolean}
 */
function digestMatches(actual, expected) {
  const a = String(actual || '');
  const e = String(expected || '').replace(/^sha(256|512)-/, '');
  if (!a || !e || a.length !== e.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(e));
  } catch (_) {
    return false;
  }
}

/**
 * Extrai um arquivo (zip/whl, tgz, tar.zst) em destDir usando o bsdtar.
 *
 * @param {string} archive
 * @param {string} destDir
 * @param {object} [opts]
 * @param {number} [opts.stripComponents] remove N niveis de diretorio (tarball npm usa 1)
 * @returns {Promise<void>}
 */
function extractArchive(archive, destDir, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-xf', archive];
    if (opts.stripComponents) args.push(`--strip-components=${opts.stripComponents}`);
    args.push('-C', destDir);
    execFile(tarBinary(), args, { windowsHide: true }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`falha ao extrair ${path.basename(archive)}: ${String(stderr || err.message).trim()}`));
      else resolve();
    });
  });
}

/** Lista os caminhos dentro de um arquivo, sem extrair. */
function listArchive(/** @type {string} */ archive) {
  return new Promise((resolve, reject) => {
    execFile(tarBinary(), ['-tf', archive], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) { reject(new Error(`falha ao listar ${path.basename(archive)}: ${String(stderr || err.message).trim()}`)); return; }
        resolve(String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      });
  });
}

/**
 * GET de JSON (a API da PyPI, o catalogo remoto). Segue redirect, tem timeout
 * e limite de tamanho para nao engolir uma resposta gigante por engano.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.maxBytes=8388608]
 * @param {number} [opts.timeoutMs=20000]
 * @returns {Promise<any>}
 */
function getJson(url, opts = {}) {
  const maxBytes = opts.maxBytes || 8 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs || 20000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (/** @type {Error|null} */ err, /** @type {any} */ val) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(val);
    };

    function request(/** @type {string} */ u, redirects = 0) {
      if (redirects > MAX_REDIRECTS) { done(new Error('redirecionamentos demais')); return; }
      let parsed;
      try { parsed = new URL(u); }
      catch (e) { done(e instanceof Error ? e : new Error(String(e))); return; }
      if (parsed.protocol !== 'https:') { done(new Error(`apenas https e aceito: ${u}`)); return; }

      const req = https.get({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': 'aurora-ide', Accept: 'application/json' },
      }, (res) => {
        const code = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.resume();
          request(new URL(res.headers.location, u).href, redirects + 1);
          return;
        }
        if (code !== 200) { res.resume(); done(new Error(`HTTP ${code} em ${u}`)); return; }

        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) { req.destroy(new Error('resposta JSON grande demais')); return; }
          chunks.push(c);
        });
        res.on('end', () => {
          try { done(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (e) { done(new Error(`JSON invalido de ${u}: ${e instanceof Error ? e.message : String(e)}`)); }
        });
        res.on('error', done);
      });
      req.on('error', done);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('requisicao JSON expirou')));
    }

    request(url);
  });
}

/** Diretorio temporario da AURORA para downloads em andamento. */
function tempRoot() {
  const dir = path.join(os.tmpdir(), 'aurora-fetch');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** rm -rf que nunca lanca. Um arquivo travado pelo Windows fica para a proxima. */
function rmrf(/** @type {string} */ p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

module.exports = {
  downloadToFile,
  digestMatches,
  extractArchive,
  listArchive,
  getJson,
  tarBinary,
  tempRoot,
  rmrf,
  IDLE_TIMEOUT_MS,
};
