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

// Toda página HTML do projeto, e todo módulo que ela carrega.
//
// Isto varre AS PÁGINAS, e não só o index.html, porque as secundárias também
// têm entradas próprias: prism.html, design-lab.html e splash.html. As duas
// primeiras estavam listadas à mão aqui embaixo; a splash não estava, e o
// resultado foi o CI vermelho por mais de um dia acusando `js/ui/aurora.js` e
// `js/ui/sky.js` como arquivos mortos. Eles não estão mortos: são o céu e a
// aurora da tela de abertura, e a splash é a única página que os importa.
//
// E varre os DOIS jeitos de carregar, porque as páginas não são uniformes: o
// index.html usa 39 `<script src>`, a splash usa `import` dentro de um
// `<script type="module">` inline, e knip não enxerga import dentro de HTML.
// Cobrir só um dos dois deixaria a mesma armadilha montada para a próxima
// página.
//
// Caminho é resolvido a partir da pasta da própria página, senão o `src="prism.js"`
// do html/prism/prism.html apontaria para a raiz do repositório.
function entradasDasPaginas() {
  const paginas = [];
  (function varrer(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) varrer(p);
      else if (e.name.endsWith('.html')) paginas.push(p);
    }
  })(path.join(__dirname, 'html'));
  paginas.push(path.join(__dirname, 'index.html'));

  const entradas = new Set();
  for (const pagina of paginas) {
    const html = fs.readFileSync(pagina, 'utf8');
    const refs = [
      ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ];
    for (const ref of refs) {
      if (!/\.(js|mjs)$/.test(ref)) continue;       // ignora ?inline, css, url externa
      if (/^https?:/.test(ref)) continue;
      const abs = path.resolve(path.dirname(pagina), ref);
      const rel = path.relative(__dirname, abs).split(path.sep).join('/');
      if (!rel.startsWith('..') && !rel.startsWith('node_modules/')) entradas.add(rel);
    }
  }
  return [...entradas];
}

/** @type {import('knip').KnipConfig} */
module.exports = {
  entry: [
    'main.js',                 // Electron main process (package.json "main")
    'js/app/preload*.js',      // 4 contextBridge preloads, loaded by path
    'scripts/*.js',            // npm-run build/release/bootstrap helpers
    'components/Scripts/*.js', // toolchain download/copy (npm run bootstrap)
    // prism.js e design-lab.js estavam aqui à mão e saíram: entradasDasPaginas
    // acha os dois lendo as páginas que os carregam, junto com todo o resto.
    ...entradasDasPaginas(),
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
