// @ts-check
// build-ts.js: `npm run build:ts`. Emite o .js de cada .ts do repositorio.
//
// Sao dois tsc porque sao dois mundos:
//
//   1. tsconfig.build.json: o renderer (js/). ESM, emitido no lugar, ao lado
//      de cada .ts, porque o index.html e o Vite carregam o .js por caminho.
//
//   2. tsconfig.main.json: o processo principal (main/). CommonJS, emitido
//      em node_modules/.cache/tsc-main, porque o tsc precisa ler os .js
//      vizinhos (allowJs) e se recusa a gravar um .js por cima do proprio
//      input (TS5055). Daqui se copia de volta para main/ so o .js que veio
//      de um .ts; os .js transpilados dos vizinhos ficam no cache e nunca
//      tocam o repositorio.
//
// Os .js emitidos estao no .gitignore e scripts/check-no-generated-js.js
// impede que entrem no git. Um .ts novo no main/ pede a linha dele la.
//
// Uso:  node scripts/build-ts.js

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const TSC = path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
const MAIN_DIR = path.join(REPO, 'main');
const MAIN_OUT = path.join(REPO, 'node_modules', '.cache', 'tsc-main', 'main');

/** @param {string} config */
function tsc(config) {
  const r = spawnSync(process.execPath, [TSC, '-p', config], { cwd: REPO, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[build-ts] tsc -p ${config} falhou (codigo ${r.status})`);
    process.exit(r.status || 1);
  }
}

/**
 * Todos os .ts sob main/ (sem os .d.ts, que nao emitem nada), relativos a main/.
 * @param {string} dir
 * @returns {string[]}
 */
function fontesTs(dir) {
  /** @type {string[]} */
  const achados = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) achados.push(...fontesTs(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) achados.push(path.relative(MAIN_DIR, p));
  }
  return achados;
}

function main() {
  tsc('tsconfig.build.json');

  const fontes = fontesTs(MAIN_DIR);
  if (fontes.length === 0) return; // sem .ts no main/ o tsc reclamaria de config sem inputs

  tsc('tsconfig.main.json');
  for (const rel of fontes) {
    const js = rel.slice(0, -3) + '.js';
    const origem = path.join(MAIN_OUT, js);
    if (!fs.existsSync(origem)) {
      console.error(`[build-ts] o tsc nao emitiu ${js} em ${MAIN_OUT}`);
      process.exit(1);
    }
    fs.copyFileSync(origem, path.join(MAIN_DIR, js));
  }
  console.log(`[build-ts] main/: ${fontes.length} .ts emitido(s) como CommonJS`);
}

main();
