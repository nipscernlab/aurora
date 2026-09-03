// @ts-check
/**
 * The `aurora-preview://` protocol, backs the editor's rendered-HTML preview
 * (the magnifier button on an .html tab).
 *
 * WHY A CUSTOM PROTOCOL AND NOT A blob: URL
 * -----------------------------------------
 * The preview iframe used to load a blob: URL built from the file's text. That
 * renders a blank page for most real-world HTML, because blob: (like data: and
 * srcdoc) is a *local scheme*: per CSP3 its document INHERITS the embedding
 * page's policy instead of getting its own. So the app's renderer CSP:
 * `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:`, deliberately tight:
 * applied inside the preview and blocked every CDN <script>. A Plotly/Bokeh/
 * pandas export loads its library from a CDN, so the library never arrived, the
 * inline bootstrap that calls into it threw, and the pane stayed white.
 *
 * A real (non-local) scheme is fetched through the network stack, so it carries
 * the CSP *we* send with it and inherits nothing. That buys three things:
 *
 *   1. The preview gets its own policy (PREVIEW_CSP), permissive enough to
 *      render a normal web page, while the app's own CSP stays untouched.
 *   2. Relative references resolve. The URL path mirrors the filesystem, so a
 *      page's ./style.css or ./data.json is a real sibling lookup; under a blob:
 *      URL every relative reference resolved against the blob and 404'd.
 *   3. The preview is cross-origin to the app. A blob: URL inherits the app's
 *      origin, so `sandbox=allow-same-origin` let previewed markup reach into
 *      the real renderer's DOM. Here the origin is `aurora-preview://<id>`:
 *      a different scheme, so that reach is gone.
 *
 * SCOPE
 * -----
 * Each open preview registers its source file and gets a random single-use host
 * id mapped to that file's DIRECTORY; the handler serves that subtree and
 * nothing else. The id is dropped when the preview tab closes. Three fences on
 * top of the subtree (see regrasDePreview/temSegmentoOculto):
 *   - se a pasta do arquivo e a HOME do usuario ou a raiz de uma unidade, so o
 *     proprio documento e servido, porque "os vizinhos" ali sao o perfil
 *     inteiro (AppData, .ssh) e o connect-src https: deixaria exfiltrar;
 *   - segmento oculto (.ssh, .git, .env) nunca e servido como vizinho;
 *   - o teste de raiz usa dentroDe (fs_guard), que trata raiz de unidade e
 *     caixa do Windows; a comparacao manual de antes respondia 403 para TUDO
 *     quando o arquivo morava em `C:\`.
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const crypto = require('crypto');
const { protocol, ipcMain } = require('electron');
const log = require('electron-log');

const { safePath } = require('../utils');
const { dentroDe } = require('./fs_guard');

const SCHEME = 'aurora-preview';

/**
 * Live previews: URL host id → what it may serve.
 * @type {Map<string, { root: string, doc: string, override: string|null, docOnly: boolean }>}
 */
const previews = new Map();

/**
 * Decide a raiz servida para um documento e se ela deve encolher para o
 * documento sozinho.
 *
 * A raiz e a pasta do arquivo, que e o que faz `./style.css` resolver. Mas ha
 * pastas em que "a pasta do arquivo" e a vida inteira do usuario: a home (um
 * .html solto ali serviria AppData, .ssh e tudo o mais, e o connect-src https:
 * do preview deixaria a pagina exfiltrar o que leu) e a raiz de uma unidade.
 * Nesses dois casos o preview serve SO o proprio documento: a pagina renderiza,
 * CDN carrega, e um vizinho local responde 404, que e o custo certo.
 *
 * @param {string} doc caminho absoluto do arquivo visualizado.
 * @param {string} [home] os.homedir(), injetavel para teste.
 * @param {NodeJS.Platform} [plataforma]
 * @returns {{ root: string, docOnly: boolean }}
 */
function regrasDePreview(doc, home = os.homedir(), plataforma = process.platform) {
  const root = path.dirname(doc);
  const ehRaizDeUnidade = path.parse(root).root === root;
  const norm = (/** @type {string} */ p) =>
    (plataforma === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const ehHome = norm(root) === norm(home);
  return { root, docOnly: ehRaizDeUnidade || ehHome };
}

/**
 * Um segmento oculto (comecando por ponto) no caminho pedido? `.ssh`, `.git`,
 * `.env` e afins nunca sao dependencia legitima de uma pagina visualizada, e
 * sao exatamente o que vale a pena exfiltrar. O proprio documento pode ser um
 * dotfile (a pessoa abriu, e escolha dela); os VIZINHOS ocultos nao.
 * @param {string} rel caminho relativo ja decodificado.
 */
function temSegmentoOculto(rel) {
  return String(rel).split(/[\\/]+/).some((s) => s.length > 1 && s.startsWith('.') && s !== '.' && s !== '..');
}

/**
 * The policy the previewed document runs under. It is deliberately close to
 * "an ordinary browser tab", the whole point is that a chart export renders
 * here exactly as it does in a browser or VS Code's Live Preview:
 *   https:            CDN <script>/<link>/fonts (Plotly, Bokeh, MathJax, ...).
 *   'unsafe-inline'   the inline bootstrap every such export emits.
 *   'unsafe-eval'     Plotly & friends compile with new Function.
 *   'self'            sibling files, scoped to the source file's directory.
 * `object-src 'none'`, `base-uri 'none'` and `form-action 'none'` keep the
 * page from loading plugins, retargeting relative URLs, or POSTing anywhere.
 *
 * frame-ancestors is deliberately ABSENT: it never falls back to default-src,
 * and any value would be checked against *this* document's origin, 'self'
 * here means `aurora-preview://<id>`, which would reject the app frame that
 * embeds it and break the preview outright.
 */
const PREVIEW_CSP = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' https: 'unsafe-inline' 'unsafe-eval' blob: data:",
  "style-src 'self' https: 'unsafe-inline' data:",
  "img-src 'self' https: data: blob:",
  "font-src 'self' https: data:",
  "media-src 'self' https: data: blob:",
  "connect-src 'self' https: data: blob:",
  "worker-src 'self' blob: data:",
  "frame-src 'self' https: data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Extensions a preview may legitimately pull in. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Tipo MIME pela extensao, com `application/octet-stream` como queda.
 * Exportado para teste: um MIME errado num esquema proprio muda como o
 * Chromium trata a resposta. Ver tests/unit/previewScheme.test.js.
 * @param {string} p @returns {string}
 */
function mimeFor(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

/** True for any URL served by this protocol. @param {string} url */
function isPreviewUrl(url) {
  return typeof url === 'string' && url.startsWith(`${SCHEME}://`);
}

/**
 * Declare the scheme's privileges. MUST run before `app.whenReady`, Chromium
 * reads the scheme registry once, at startup.
 *   standard       → real origins + relative-URL resolution (the whole point).
 *   secure         → a secure context, so the page isn't downgraded/mixed-content
 *                    blocked when it pulls https: assets.
 *   supportFetchAPI/corsEnabled/stream → fetch/XHR of sibling data files, which
 *                    plot exports routinely do.
 */
const SCHEME_SPEC = {
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

/**
 * Chromium le o registro de esquemas UMA vez, e a chamada seguinte SUBSTITUI a
 * lista em vez de somar. Todo esquema privilegiado do app entra portanto nesta
 * unica chamada: os specs dos demais modulos chegam por parametro.
 * @param {Electron.CustomScheme[]} [extraSpecs]
 */
function registerScheme(extraSpecs = []) {
  protocol.registerSchemesAsPrivileged([SCHEME_SPEC, ...extraSpecs]);
}

/** Install the protocol handler. Must run after `app.whenReady`. */
function installProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let entry;
    let target = '';
    try {
      const url = new URL(request.url);
      entry = previews.get(url.hostname);
      if (!entry) return new Response('Preview not registered', { status: 404 });

      // The URL path mirrors the filesystem under `root`, which is what makes
      // the page's own relative references resolve.
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      target = path.resolve(entry.root, rel);

      const ehODocumento = target === entry.doc;

      // Root-scoping via dentroDe (fs_guard): prefixo com separador e sem
      // diferenciar caixa no Windows. A comparacao manual de antes quebrava
      // com arquivo na raiz da unidade (`C:\` + sep nunca casava) e o preview
      // inteiro respondia 403.
      if (!ehODocumento && !dentroDe(entry.root, target)) {
        log.warn('[preview] refused out-of-root request:', target);
        return new Response('Forbidden', { status: 403 });
      }

      // Pasta sensivel (home, raiz de unidade): so o proprio documento sai.
      if (!ehODocumento && entry.docOnly) {
        log.warn('[preview] doc-only preview refused sibling:', target);
        return new Response('Forbidden', { status: 403 });
      }

      // Vizinho oculto (.ssh, .git, .env...) nunca e dependencia de pagina.
      if (!ehODocumento && temSegmentoOculto(rel)) {
        log.warn('[preview] refused hidden-path request:', target);
        return new Response('Forbidden', { status: 403 });
      }

      // The entry document is served from the snapshot the renderer passed in,
      // so a preview of an unsaved buffer shows the unsaved text. Everything
      // else (sibling css/js/data) comes off disk.
      const body = (target === entry.doc && entry.override !== null)
        ? entry.override
        : await fs.readFile(target);

      return new Response(body, {
        headers: {
          'Content-Type': mimeFor(target),
          'Content-Security-Policy': PREVIEW_CSP,
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      // A page asking for a file that isn't there is routine, not an app error.
      log.warn('[preview] cannot serve', target || request.url, '-', e?.message || e);
      return new Response('Not found', { status: 404 });
    }
  });
}

function register() {
  /**
   * Open a preview slot for `sourcePath`. `content` is the renderer's current
   * (possibly unsaved) text for that file; pass null to serve it from disk.
   * Returns the id (to release later) and the URL to point the iframe at.
   */
  ipcMain.handle('preview:register', (_e, sourcePath, content) => {
    const doc = safePath(sourcePath, 'preview source');
    const id = crypto.randomBytes(8).toString('hex');   // a valid, unguessable host
    const { root, docOnly } = regrasDePreview(doc);
    previews.set(id, {
      root,
      doc,
      docOnly,
      override: typeof content === 'string' ? content : null,
    });
    return { id, url: `${SCHEME}://${id}/${encodeURIComponent(path.basename(doc))}` };
  });

  /** Release a slot, the preview tab closed. */
  ipcMain.handle('preview:unregister', (_e, id) => previews.delete(id));
}

module.exports = {
  register, registerScheme, installProtocol, isPreviewUrl, mimeFor, SCHEME, PREVIEW_CSP,
  // Exportadas para teste: sao a fronteira entre "a pagina ve os vizinhos" e
  // "a pagina ve a home do usuario". Ver tests/unit/previewScheme.test.js.
  regrasDePreview, temSegmentoOculto,
};
