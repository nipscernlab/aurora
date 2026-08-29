// @ts-check
/**
 * render_loader.js: picks the renderer source for any first-party window.
 *
 * Every BrowserWindow that loads an in-repo HTML page (main, splash, update,
 * PRISM) routes through loadPage so the dev/prod/raw selection lives in one
 * place:
 *
 *   • Dev (Vite): when AURORA_RENDERER_URL is set AND the app is not packaged,
 *     load the page from the Vite dev server (HMR). `npm run dev` sets the env.
 *     The page path is appended to the dev server origin, so the multi-page
 *     dev server serves /html/splash.html, /html/prism/prism.html, etc.
 *   • Prod / built: load the bundled page from dist/ via file://.
 *
 * There is NO raw-source fallback. Post-Lit migration the raw index.html
 * carries bare `lit` imports that only resolve through the bundler, so a
 * missing dist/ is a build error, not a degraded-but-usable state. We surface
 * it loudly (an explicit error page) instead of silently loading a broken UI.
 * Every real flow builds dist/ first: `npm run dev` (Vite), `npm start`
 * (prestart → build:renderer), the e2e harness (pretest:e2e), and packaging.
 *
 * loadFile/loadURL do NOT trigger 'will-navigate', so a window's navigation
 * lockdown does not block the dev URL.
 */
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * @param {import('electron').BrowserWindow} win
 * @param {string} relPath POSIX-style page path relative to the repo/dist root,
 *   e.g. 'index.html', 'html/splash.html', 'html/prism/prism.html'.
 * @returns {Promise<void>}
 */
function loadPage(win, relPath) {
  const segments = relPath.split('/');
  const devUrl = process.env.AURORA_RENDERER_URL;
  if (devUrl && !app.isPackaged) {
    const origin = new URL(devUrl).origin;
    return win.loadURL(`${origin}/${relPath}`);
  }
  const distPage = path.join(app.getAppPath(), 'dist', ...segments);
  if (fs.existsSync(distPage)) {
    return win.loadFile(distPage);
  }
  // No raw fallback (see header): a missing bundle is a build error.
  const msg = `Renderer bundle not found: ${distPage}. Build it with `
    + '`npm run build:renderer` (or run `npm run dev`).';
  console.error(`[render_loader] ${msg}`);
  const errHtml = '<body style="background:#0A0D14;color:#e6e6e6;'
    + 'font:14px system-ui,sans-serif;padding:2.5rem;line-height:1.6">'
    + '<h2 style="color:#5FE0B0">AURORA — renderer bundle missing</h2>'
    + `<p>${msg}</p></body>`;
  return win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errHtml));
}

/**
 * A URL que loadPage carregaria, para quem carrega por atributo e nao por
 * chamada: o <webview> da aba do PRISM recebe `src`, nao um `loadFile`. A
 * escolha dev/dist e a MESMA de loadPage, por construcao; duas regras aqui
 * seriam duas chances de a aba e a janela abrirem paginas diferentes.
 *
 * @param {string} relPath
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
function pageUrl(relPath) {
  const segments = relPath.split('/');
  const devUrl = process.env.AURORA_RENDERER_URL;
  if (devUrl && !app.isPackaged) {
    return { ok: true, url: `${new URL(devUrl).origin}/${relPath}` };
  }
  const distPage = path.join(app.getAppPath(), 'dist', ...segments);
  if (fs.existsSync(distPage)) {
    return { ok: true, url: require('url').pathToFileURL(distPage).href };
  }
  return { ok: false, error: `Renderer bundle not found: ${distPage}. Build it with npm run build:renderer` };
}

module.exports = { loadPage, pageUrl };
