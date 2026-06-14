import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

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
  root: import.meta.dirname,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Electron 39 ships a modern Chromium; chrome130 is a safe floor.
    target: 'chrome130',
    rollupOptions: {
      // Stage 1: only the main window. splash/update/prism stay on loadFile of
      // their original HTML until a later stage adds them as inputs.
      input: { index: 'index.html' },
    },
  },
  plugins: [
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
      ],
    }),
  ],
  server: {
    port: 5273,
    strictPort: true,
  },
});
