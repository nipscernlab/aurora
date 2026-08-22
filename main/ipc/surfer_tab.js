// @ts-check
/**
 * surfer_tab.js: o Surfer dentro de uma aba do editor.
 *
 * COMO FUNCIONA
 * -------------
 * O Surfer e um binario nativo (Rust/egui) e nao ha como embutir uma janela
 * Win32 numa aba do Electron sem gambiarra. O caminho suportado pelo proprio
 * projeto e outro: ele compila tambem para WebAssembly (o upstream mantem
 * app.surfer-project.org rodando exatamente esse build), e o MESMO exe que ja
 * embarcamos tem um modo servidor headless (`surfer-aurora.exe server`) feito
 * para um cliente ver a onda que ele serve.
 *
 * A aba junta as pontas atraves de UM servidor HTTP local (Node, 127.0.0.1,
 * porta efemera), que serve tres coisas na MESMA origem:
 *
 *   /web/…          o bundle WASM do fork (cliente Surfer)
 *   /srv/<id>/…     proxy para o surver daquela aba (http://127.0.0.1:P/TOKEN/…)
 *   /layout/<id>    o .sucl ou .surf.ron curado daquela onda
 *
 * POR QUE UM SERVIDOR HTTP E NAO UM ESQUEMA CUSTOM (aurora-surfer://)
 * -------------------------------------------------------------------
 * A primeira versao servia o bundle por um protocol handler, como o
 * aurora-preview://. Quebrou no primeiro teste real, e quebrou por design: a
 * pagina em `aurora-surfer://web` buscando a onda em `http://127.0.0.1:P` e um
 * fetch ENTRE ORIGENS, o surver nao manda CORS nenhum, e o navegador corta com
 * "TypeError: Failed to fetch" antes de um byte sair do fio. Com tudo na mesma
 * origem http, o CORS deixa de existir por construcao — e o cliente Rust
 * (reqwest) fala http sem discussao, o que um esquema inventado nao garante.
 *
 * O parsing pesado do FST/VCD continua nativo no surver; o proxy so repassa
 * bytes na propria maquina. A latencia extra e local e irrelevante perto do
 * parse, e e o preco de nao precisar de um exe novo com CORS para a aba
 * funcionar com o binario v0.7.0-nips.7 ja embarcado.
 *
 * CICLO DE VIDA
 * -------------
 * O servidor HTTP nasce no primeiro serve e vive ate a IDE fechar; e um so
 * para todas as abas. Cada aba tem o SEU surver (spawnTracked, morre com a
 * aba via surfer-tab:stop e com a IDE via stopAllToolchain). Os ids de proxy
 * e de layout sao aleatorios por launch; fechar a aba os revoga.
 *
 * O token do surver importa mesmo em 127.0.0.1: qualquer processo local pode
 * falar com a porta, e o token (aleatorio, nunca logado) e o que impede um
 * processo qualquer de ler a onda. O proxy o mantem: o id aleatorio do path
 * cumpre o mesmo papel na porta do nosso servidor.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { ipcMain } = require('electron');
const log = require('electron-log');

const { componentsPath } = require('../paths');
const { isAllowed } = require('../compile/binary_allowlist');
const { spawnTracked } = require('../process_registry');
const { killProcessSilently } = require('../utils');
const { surferBootDeadlineMs } = require('../net/timeouts');

/** Raiz do bundle web do Surfer (cliente WASM). */
function webRoot() {
  return path.join(componentsPath, 'Packages', 'surfer', 'web');
}

/** O bundle web esta instalado? O renderer pergunta antes de abrir a aba. */
function hasWebBundle() {
  try {
    return fs.existsSync(path.join(webRoot(), 'index.html'));
  } catch (_) {
    return false;
  }
}

/**
 * A politica da pagina WASM. Vai como header em TUDO que o servidor local
 * responde. connect-src 'self' basta: com o proxy, o cliente nunca fala com
 * outra origem. 'wasm-unsafe-eval' instancia o .wasm; 'unsafe-inline' e o
 * script de boot que o trunk gera dentro do index.html.
 */
const SURFER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** So o que um bundle trunk contem de verdade, mais os layouts. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.sucl': 'text/plain; charset=utf-8',
  '.ron': 'text/plain; charset=utf-8',
};

/**
 * Surfers headless vivos: tabId → { child, proxyId }.
 * @type {Map<string, { child: import('child_process').ChildProcess, proxyId: string }>}
 */
const servers = new Map();

/**
 * Alvos do proxy: proxyId → base do surver (http://127.0.0.1:porta/token).
 * @type {Map<string, string>}
 */
const proxies = new Map();

/**
 * Layouts expostos: layoutId → caminho absoluto (.sucl ou .surf.ron).
 * @type {Map<string, string>}
 */
const layouts = new Map();

/**
 * Documentos servidos direto da memoria: id → texto. Carrega o arquivo de
 * comandos de startup composto por launch e os decode maps (trad_*.txt), que
 * chegam do renderer como {name, content} e nunca tocam o disco.
 * @type {Map<string, string>}
 */
const inlineDocs = new Map();

/** Origem do servidor local (http://127.0.0.1:porta), '' enquanto nao subiu.
 * O Server em si nao precisa de referencia: vive ate o processo main morrer,
 * e derrubar a IDE derruba a porta junto. */
let origin = '';

/** True para qualquer URL servida pelo nosso servidor local. @param {string} url */
function isSurferTabUrl(url) {
  return !!origin && typeof url === 'string' && url.startsWith(`${origin}/`);
}

/** Responde um arquivo estatico do bundle web. */
function serveWebFile(rel, res) {
  const root = webRoot();
  const target = path.resolve(root, rel);
  // path.resolve ja colapsou qualquer `..`; isto barra sair da raiz.
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.promises.readFile(target).then((body) => {
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Security-Policy': SURFER_CSP,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }).catch(() => { res.writeHead(404); res.end('Not found'); });
}

/**
 * Repassa uma requisicao ao surver da aba. So GET (e tudo que o protocolo do
 * surver usa) e so para o alvo REGISTRADO — o cliente nunca escolhe host nem
 * porta, so o resto do caminho depois do id.
 */
function serveProxy(proxyId, rest, res) {
  const base = proxies.get(proxyId);
  if (!base) { res.writeHead(404); res.end('Unknown proxy'); return; }
  const upstream = `${base}${rest}`;
  http.get(upstream, (up) => {
    // Os headers do surver passam adiante: o cliente identifica um surver
    // pelo header proprio dele (HTTP_SERVER_KEY), e sem repasse a deteccao
    // regrediria para "arquivo estatico" e o protocolo incremental sumiria.
    const headers = { ...up.headers, 'content-security-policy': SURFER_CSP };
    delete headers['access-control-allow-origin']; // mesma origem, sem CORS
    res.writeHead(up.statusCode || 502, headers);
    up.pipe(res);
  }).on('error', (e) => {
    log.warn('[surfer-tab] proxy falhou:', e?.message || e);
    res.writeHead(502); res.end('Bad gateway');
  });
}

/** Sobe o servidor local uma unica vez. @returns {Promise<string>} a origem */
function ensureHttpServer() {
  if (origin) return Promise.resolve(origin);
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const p = decodeURIComponent(url.pathname);
        if (p.startsWith('/web/')) { serveWebFile(p.slice('/web/'.length), res); return; }
        if (p.startsWith('/srv/')) {
          const [id, ...rest] = p.slice('/srv/'.length).split('/');
          serveProxy(id, rest.length ? `/${rest.join('/')}` : '', res);
          return;
        }
        if (p.startsWith('/doc/')) {
          // /doc/<id>/<resto>: o resto e ignorado aqui; ele existe para o
          // cliente — o fallback de nome do mapping translator e o ultimo
          // segmento da URL, entao /doc/<id>/<nome-do-mapping> registra o
          // tradutor com o nome que o .surf.ron referencia.
          const id = p.slice('/doc/'.length).split('/')[0];
          const doc = inlineDocs.get(id);
          if (doc === undefined) { res.writeHead(404); res.end('Doc not registered'); return; }
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Security-Policy': SURFER_CSP,
            'Cache-Control': 'no-store',
          });
          res.end(doc);
          return;
        }
        if (p.startsWith('/layout/')) {
          const found = layouts.get(p.slice('/layout/'.length));
          if (!found) { res.writeHead(404); res.end('Layout not registered'); return; }
          fs.promises.readFile(found).then((body) => {
            res.writeHead(200, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Security-Policy': SURFER_CSP,
              'Cache-Control': 'no-store',
            });
            res.end(body);
          }).catch(() => { res.writeHead(404); res.end('Not found'); });
          return;
        }
        res.writeHead(404); res.end('Not found');
      } catch (e) {
        log.warn('[surfer-tab] request invalida:', e?.message || e);
        res.writeHead(400); res.end('Bad request');
      }
    });
    srv.once('error', reject);
    // Porta efemera SO em 127.0.0.1: nada disto e visivel na rede.
    srv.listen(0, '127.0.0.1', () => {
      const addr = /** @type {import('net').AddressInfo} */ (srv.address());
      origin = `http://127.0.0.1:${addr.port}`;
      log.info('[surfer-tab] servidor local em', origin);
      resolve(origin);
    });
  });
}

/** Uma porta livre para o surver, entregue pelo sistema. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = /** @type {import('net').AddressInfo} */ (srv.address());
      srv.close(() => resolve(addr.port));
    });
  });
}

/**
 * Espera o surver responder com a onda carregada. O get_status devolve
 * last_load_ok por arquivo; sem essa espera o iframe abriria antes do parse e
 * mostraria erro de conexao em vez de barra de progresso.
 * @param {number} port @param {string} token @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
function waitForServer(port, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: `/${token}/get_status`, timeout: 2000 },
        (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => {
            try {
              const status = JSON.parse(body);
              const info = status?.file_infos?.[0];
              if (info && info.last_load_ok === true && info.reloading !== true) {
                resolve({ ok: true });
                return;
              }
            } catch (_) { /* ainda subindo */ }
            retry();
          });
        },
      );
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        resolve({ ok: false, error: `surfer server did not load the wave within ${Math.round(timeoutMs / 1000)}s` });
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

/** Derruba o surver de uma aba e revoga os ids dela. @param {string} tabId */
async function stopServer(tabId) {
  const entry = servers.get(tabId);
  if (!entry) return;
  servers.delete(tabId);
  proxies.delete(entry.proxyId);
  const { child } = entry;
  if (child && child.exitCode === null && !child.killed && child.pid) {
    try { await killProcessSilently(child.pid); } catch (_) { /* best-effort */ }
  }
}

function register() {
  /**
   * Sobe (ou troca) o surver de uma aba e devolve a URL da pagina.
   * { surferBin, waveFile, tabId, suclFile?, stateFile? } →
   * { success, pageUrl?, message? }
   */
  ipcMain.handle('surfer-tab:serve', async (_e, options) => {
    const { surferBin, waveFile, tabId, suclFile, stateFile, mappings } = options || {};
    if (!surferBin || !waveFile || !tabId) {
      return { success: false, message: 'surfer-tab:serve requires { surferBin, waveFile, tabId }' };
    }
    if (!hasWebBundle()) {
      return { success: false, message: 'surfer web bundle not installed (components/Packages/surfer/web)' };
    }
    // O mesmo portao do launch-surfer: binario do bundle, e de mais ninguem.
    const gate = isAllowed(surferBin);
    if (!gate.ok) {
      return { success: false, message: `Refused to serve: ${gate.error}` };
    }
    if (!fs.existsSync(surferBin)) {
      return { success: false, message: `Surfer not found at ${surferBin}` };
    }
    if (!fs.existsSync(waveFile)) {
      return { success: false, message: `Wave file not found at ${waveFile}` };
    }

    // Recompilou com a aba aberta: o surver anterior morre antes do novo
    // nascer, espelhando o "uma janela so" do modo janela.
    await stopServer(tabId);

    try {
      const base = await ensureHttpServer();
      const port = await freePort();
      const token = crypto.randomBytes(16).toString('hex');
      const child = spawnTracked(surferBin, [
        'server',
        '--file', waveFile,
        '--port', String(port),
        '--token', token,
        '--bind-address', '127.0.0.1',
      ], {
        cwd: path.dirname(waveFile),
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      const proxyId = crypto.randomBytes(8).toString('hex');
      servers.set(tabId, { child, proxyId });
      proxies.set(proxyId, `http://127.0.0.1:${port}/${token}`);

      // Prazo proporcional ao dump: o parse do FST cresce com o arquivo, e 30 s
      // fixos derrubavam um servidor que ainda estava subindo num dump grande.
      let tamanho = 0;
      try { tamanho = fs.statSync(waveFile).size; } catch (_) { /* fica o piso */ }
      const up = await waitForServer(port, token, surferBootDeadlineMs(tamanho));
      if (!up.ok) {
        await stopServer(tabId);
        return { success: false, message: up.error || 'surfer server did not come up' };
      }

      const params = new URLSearchParams();
      params.set('load_url', `${base}/srv/${proxyId}`);

      // Startup: UM arquivo de comandos composto aqui e servido da memoria.
      // Ordem importa e o batch do Surfer a respeita: primeiro os decode maps
      // (load_mapping_translator_from_url, comando NOSSO no fork) para os
      // tradutores existirem, depois o layout — .sucl como comandos, .surf.ron
      // como estado via load_state_from_url (tambem nosso; como comando de
      // batch, so roda depois de a onda carregar, que e o que o rebind dos
      // itens exige). Tudo na mesma origem, entao nenhum fetch e cortado.
      const startup = [];
      for (const m of Array.isArray(mappings) ? mappings : []) {
        if (!m || typeof m.name !== 'string' || typeof m.content !== 'string') continue;
        const docId = crypto.randomBytes(8).toString('hex');
        inlineDocs.set(docId, m.content);
        startup.push(`load_mapping_translator_from_url ${base}/doc/${docId}/${encodeURIComponent(m.name)}`);
      }
      if (suclFile && fs.existsSync(suclFile)) {
        const layoutId = crypto.randomBytes(8).toString('hex');
        layouts.set(layoutId, suclFile);
        startup.push(`run_command_file_from_url ${base}/layout/${layoutId}`);
      } else if (stateFile && fs.existsSync(stateFile)) {
        const layoutId = crypto.randomBytes(8).toString('hex');
        layouts.set(layoutId, stateFile);
        startup.push(`load_state_from_url ${base}/layout/${layoutId}`);
      }
      if (startup.length === 1) {
        params.set('startup_commands', startup[0]);
      } else if (startup.length > 1) {
        const cmdId = crypto.randomBytes(8).toString('hex');
        inlineDocs.set(cmdId, `${startup.join('\n')}\n`);
        params.set('startup_commands', `run_command_file_from_url ${base}/doc/${cmdId}/startup.sucl`);
      }
      // O #dev desliga o service worker do bundle (o index.html do trunk so
      // registra o sw.js sem essa ancora); num servidor efemero ele so
      // envenenaria o cache.
      return { success: true, pageUrl: `${base}/web/index.html?${params.toString()}#dev` };
    } catch (e) {
      await stopServer(tabId);
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('[surfer-tab] serve falhou:', msg);
      return { success: false, message: msg };
    }
  });

  /** Fecha o surver da aba. Chamado quando a aba fecha. */
  ipcMain.handle('surfer-tab:stop', async (_e, tabId) => {
    if (!tabId) return { success: false };
    await stopServer(tabId);
    return { success: true };
  });

  /** O renderer decide aba x janela sabendo se o bundle web existe. */
  ipcMain.handle('surfer-tab:available', () => hasWebBundle());
}

module.exports = { register, isSurferTabUrl, hasWebBundle };
