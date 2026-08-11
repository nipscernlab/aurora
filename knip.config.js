// knip.config.js — dead-code gate (run via `npx knip`).
//
// Aurora's renderer is NOT a bundled import graph: index.html pulls in
// classic <script> tags that share state through window globals, and the
// main process + preloads are reached by path/require — none of which knip
// can infer on its own. So we hand it every real entry point explicitly.
// The renderer entries are READ FROM index.html at runtime, so adding or
// removing a <script src> keeps this config correct with zero edits.
//
// What's trustworthy here: `files` (unused modules) and `dependencies`
// (unused npm packages) — that's what CI gates on (`--include files,deps`).
// `exports`/`types` stay noisy because the window-global renderer code has
// no import edges for knip to follow, so we don't gate on them.

const fs = require('node:fs');
const path = require('node:path');

// Every <script src="…/foo.js"> in index.html is a renderer entry.
function rendererEntriesFromIndexHtml() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  return [...html.matchAll(/src="\.?\/?([^"]+\.js)"/g)].map((m) => m[1]);
}

/** @type {import('knip').KnipConfig} */
module.exports = {
  entry: [
    'main.js',                 // Electron main process (package.json "main")
    'js/app/preload*.js',      // 4 contextBridge preloads, loaded by path
    'html/prism/prism.js',     // PRISM window renderer (<script> in prism.html)
    'js/components/design-lab.js', // Design Lab page entry (imports every Lit component)
    'scripts/*.js',            // npm-run build/release/bootstrap helpers
    'components/Scripts/*.js', // toolchain download/copy (npm run bootstrap)
    ...rendererEntriesFromIndexHtml(),
  ],
  // Analyse only our own source. components/Packages is the downloaded
  // third-party toolchain; node_modules is excluded by knip's defaults.
  project: [
    'main.js',
    'main/**/*.js',
    'js/**/*.js',
    'scripts/*.js',
    'components/Scripts/*.js',
    'html/prism/prism.js',
  ],
  // All flagged "unused" deps are reached in ways static analysis can't see:
  ignoreDependencies: [
    'monaco-editor',                 // loaded via its own AMD loader path
    '@ai-sdk/anthropic',             // resolved by string in main/ai/provider.js
    '@ai-sdk/deepseek',              //   (tryRequire('@ai-sdk/…'))
    '@ai-sdk/google',
    '@ai-sdk/groq',
    '@ai-sdk/openai',
    '@openai/codex',                 // bundled CLI, spawned as a subprocess
    '@phosphor-icons/web',           // <link> straight to node_modules in index.html (icons)
    'katex',                         // <link> + <script> straight to node_modules (AI-chat math)
    'material-icon-theme',           // vendored at BUILD time by vite-plugin-static-copy
                                     //   (vite.config.mjs -> dist/vendor/material-icons/);
                                     //   js/tree/material_icons.js then fetches it by URL, so
                                     //   there is no import edge for knip to follow.
    'app-builder-lib',               // scripts/patch-latest-yml.js reaches into it for
                                     //   electron-builder's own buildBlockMap, to rebuild the
                                     //   .blockmap from the SIGNED installer. Deliberately NOT
                                     //   declared as a dependency: it must be exactly the copy
                                     //   electron-builder just used, and pinning our own would
                                     //   let the two drift into different blockmap formats —
                                     //   a delta that fails only on the user's machine. The
                                     //   script runs in CI moments after electron-builder, and
                                     //   degrades with a warning if the internal path moves.
  ],
};
