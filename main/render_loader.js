// @ts-check
/**
 * render_loader.js — picks the renderer source for any first-party window.
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
 *   • Raw fallback: if no built dist page exists, load the raw source page at
 *     the repo root. The raw HTML keeps node_modules/ asset refs (which resolve
 *     standalone), so this remains a working safety net. Keeps the migration
 *     reversible.
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
  return win.loadFile(path.join(app.getAppPath(), ...segments));
}

module.exports = { loadPage };
