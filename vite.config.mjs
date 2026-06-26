import { defineConfig, createLogger } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Suppress the cosmetic "can't be bundled without type=module" warning emitted
// for the Monaco AMD loader and KaTeX UMD script. Both are vendored via
// viteStaticCopy and resolved correctly at runtime — Vite just can't analyse
// their AMD/UMD format, which is expected and harmless.
const logger = createLogger();
const _warn = logger.warn.bind(logger);
logger.warn = (msg, opts) => {
  if (msg.includes('without type=module')) return;
  _warn(msg, opts);
};

// Rewrite the node_modules/ asset paths in the HTML to the vendor/ trees that
// vite-plugin-static-copy stages. The SOURCE html keeps node_modules/ refs so
// the raw page still loads standalone over file:// at the repo root (where
// node_modules exists) — the raw-fallback safety net in main/windows.js. This
// transform repoints them to vendor/ for the dev-served and built renderer,
// where node_modules is not on the wire. Runs `order:'pre'` so it executes
// before Vite's own HTML asset analysis sees (and tries to resolve) the
// node_modules/ paths. Also covers the secondary pages (e.g. prism.html's
// Phosphor links) when they become inputs.
function rewriteVendorPaths() {
  const map = [
    ['node_modules/monaco-editor/min/vs', 'vendor/vs'],
    ['node_modules/katex/dist', 'vendor/katex/dist'],
    ['node_modules/@phosphor-icons/web/src', 'vendor/phosphor/src'],
  ];
  return {
    name: 'aurora-rewrite-vendor-paths',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let out = html;
        for (const [from, to] of map) out = out.split(from).join(to);
        return out;
      },
    },
  };
}

// Renderer-only Vite config for the AURORA Electron IDE.
//
// The main process and preloads are NOT bundled — they stay raw CommonJS,
// loaded directly by Electron. This config only owns the renderer (index.html
// and its module graph).
//
// `base: './'` is mandatory: the packaged app loads dist/index.html over
// file://, and the default base ('/') would emit absolute /assets/... URLs that
// resolve to the filesystem root under file:// and 404. './' makes every
// emitted asset URL relative to the HTML file.
//
// Monaco (AMD loader + window.monaco, pinned 0.52.2), KaTeX (global) and
// Phosphor (icon CSS) are vendored verbatim into dist/vendor/* by
// vite-plugin-static-copy — copied at build time and served by the dev server,
// so nothing 70 MB gets committed and index.html can reference stable relative
// `vendor/...` paths that work in both dev (vite origin) and prod (file://).
export default defineConfig({
  customLogger: logger,
  root: import.meta.dirname,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Electron 39 ships a modern Chromium; chrome130 is a safe floor.
    target: 'chrome130',
    // Keep every @font-face declaration so the bundled cascade matches the raw
    // page exactly. esbuild's CSS minifier collapses the redundant @font-face
    // rules our fonts.css declares per weight (the committed Inter / JetBrains
    // woff2 are byte-identical across weights — only 4 distinct files for 14
    // faces — so Vite dedupes them, and the minifier then merges the weight
    // declarations too, which can change weight resolution vs. the raw page).
    // The renderer loads CSS from local disk/asar, so minification saves nothing
    // meaningful — turn it off. JS is still minified.
    cssMinify: false,
    rollupOptions: {
      // Multi-page: the main window plus the three secondary BrowserWindows.
      // Vite emits each at its source-relative path (dist/index.html,
      // dist/html/splash.html, dist/html/prism/prism.html, …) and rewrites
      // their asset refs relative to that depth (base:'./').
      input: {
        index: 'index.html',
        splash: 'html/splash.html',
        update: 'html/update-notification.html',
        prism: 'html/prism/prism.html',
        'design-lab': 'html/design-lab.html', // DESIGN §11 — internal component gallery
      },
    },
  },
  plugins: [
    rewriteVendorPaths(),
    viteStaticCopy({
      // v4 preserves the full source path under dest by default, so we glob the
      // contents and strip the node_modules prefix via rename.stripBase (counts
      // leading path segments to drop) — landing the trees at exactly the paths
      // index.html references: vendor/vs/..., vendor/katex/dist/..., vendor/phosphor/src/...
      targets: [
        // strip node_modules/monaco-editor/min -> keeps vs/...  -> dist/vendor/vs/...
        { src: 'node_modules/monaco-editor/min/vs/**/*', dest: 'vendor', rename: { stripBase: 3 } },
        // strip node_modules/katex -> keeps dist/...  -> dist/vendor/katex/dist/...
        { src: 'node_modules/katex/dist/**/*', dest: 'vendor/katex', rename: { stripBase: 2 } },
        // strip node_modules/@phosphor-icons/web -> keeps src/...  -> dist/vendor/phosphor/src/...
        { src: 'node_modules/@phosphor-icons/web/src/**/*', dest: 'vendor/phosphor', rename: { stripBase: 3 } },

        // Material Icon Theme — the Folders (standard) file-tree view's icons
        // (js/tree/material_icons.js fetches the manifest, then sets each row's
        // background-image to a vendored SVG). strip node_modules/material-icon-theme/icons
        // -> keeps <name>.svg -> dist/vendor/material-icons/<name>.svg, and the
        // association manifest lands beside them as material-icons.json.
        { src: 'node_modules/material-icon-theme/icons/**/*', dest: 'vendor/material-icons', rename: { stripBase: 3 } },
        { src: 'node_modules/material-icon-theme/dist/material-icons.json', dest: 'vendor/material-icons', rename: { stripBase: 3 } },

        // App resources the renderer fetches by DOCUMENT-RELATIVE path at runtime
        // (not via the import graph, so Vite can't see them). The raw page lived
        // at the repo root where these resolved; the built page lives in dist/,
        // so mirror them into dist/ at the same paths the code requests:
        //   • i18n: fetch('./locales/<lng>.json')      (js/i18n/i18n.js)
        //   • SAPHO rules: fetch('./resources/sapho_rules.json') (js/api/aurora_api.js)
        //   • icons: img.src = './assets/icons/<name>'  (AI providers etc.)
        { src: 'locales/**/*', dest: 'locales', rename: { stripBase: 1 } },
        { src: 'resources/**/*', dest: 'resources', rename: { stripBase: 1 } },
        { src: 'assets/icons/**/*', dest: 'assets/icons', rename: { stripBase: 2 } },
      ],
    }),
  ],
  server: {
    port: 5273,
    strictPort: true,
  },
});
