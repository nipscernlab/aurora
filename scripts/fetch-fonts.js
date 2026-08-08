// @ts-check
/**
 * fetch-fonts.js — vendor the web fonts locally (regeneration tool).
 *
 * Aurora used to @import Inter / JetBrains Mono / Mrs Saint Delafield straight
 * from fonts.googleapis.com — a render-blocking network fetch on every launch
 * that left the UI on system fonts when offline. This script downloads the
 * woff2 files (latin + latin-ext subsets, which cover English and Portuguese)
 * into assets/fonts/ and writes css/base/fonts.css with @font-face rules that
 * point at the local files.
 *
 * The produced files are COMMITTED, so this is not part of the build — run it
 * by hand only to refresh the fonts:  node scripts/fetch-fonts.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const OUT_FONTS = path.join(__dirname, '..', 'assets', 'fonts');
const OUT_CSS = path.join(__dirname, '..', 'css', 'base', 'fonts.css');
const KEEP_SUBSETS = new Set(['latin', 'latin-ext']);

/** @type {{family:string, slug:string, css:string}[]} */
// Both are VARIABLE fonts. Request the weight RANGE (`wght@400..700`) so Google
// serves ONE variable woff2 per subset covering the whole axis, and emit a single
// @font-face per subset with a font-weight RANGE — real 400..700 from one file.
// (Requesting discrete weights `wght@400;500;...` returns one @font-face per weight
//  all pointing at the same variable file, which read as a single weight and
//  shipped byte-identical duplicates.)
//
// Metamorphous e Noto Sans Runic servem o letreiro "Dagr" do painel de git e
// substituem a Norse de Joel Carrouche. A Norse era gratuita para embutir mas
// PROIBIA redistribuir, e o instalador publicado carregava o arquivo dentro:
// manter fora do repositorio nao e o mesmo que manter fora da distribuicao.
// Ambas as novas sao SIL OFL 1.1, que permite redistribuir e embutir, entao o
// problema deixa de existir e o script de bootstrap que baixava do dafont pode
// sumir. Sao duas porque o painel usa a fonte para duas coisas: o letreiro em
// letras latinas e a runa Dagaz, e so a Noto Sans Runic cobre U+16A0-16F8.
const FAMILIES = [
  { family: 'Inter', slug: 'inter', css: 'Inter:wght@400..700' },
  { family: 'JetBrains Mono', slug: 'jetbrains-mono', css: 'JetBrains+Mono:wght@400..600' },
  { family: 'Metamorphous', slug: 'metamorphous', css: 'Metamorphous' },
  // So o bloco runico: o latino desta familia nao e usado e seriam bytes a toa.
  { family: 'Noto Sans Runic', slug: 'noto-sans-runic', css: 'Noto+Sans+Runic', subsets: ['runic'] },
];

function get(url, asBuffer) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': CHROME_UA } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(get(res.headers.location, asBuffer));
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(asBuffer ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(OUT_FONTS, { recursive: true });
  const faceBlocks = [];

  for (const fam of FAMILIES) {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${fam.css}&display=swap`;
    const css = String(await get(cssUrl, false));

    // Google emits  /* subset */  then an @font-face block. Split on the comment.
    const parts = css.split(/\/\*\s*([\w-]+)\s*\*\//).slice(1);
    for (let i = 0; i < parts.length; i += 2) {
      const subset = parts[i];
      const block = parts[i + 1] || '';
      // Uma familia pode pedir subsets proprios; sem isso a Noto Sans Runic
      // traria o latino, que ela nao serve aqui.
      const querSubset = fam.subsets ? new Set(fam.subsets) : KEEP_SUBSETS;
      if (!querSubset.has(subset)) continue;

      // A range request yields `font-weight: 400 700` — keep the whole range.
      const weight = ((block.match(/font-weight:\s*(\d+(?:\s+\d+)?)/) || [])[1] || '400').trim();
      const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1] || '';
      const woff2 = (block.match(/url\(([^)]+\.woff2)\)/) || [])[1];
      if (!woff2) continue;

      // One variable file per subset — the weight axis lives inside the file.
      const fileName = `${fam.slug}-${subset}.woff2`;
      const buf = /** @type {Buffer} */ (await get(woff2, true));
      fs.writeFileSync(path.join(OUT_FONTS, fileName), buf);

      faceBlocks.push(
        `@font-face {\n` +
        `  font-family: '${fam.family}';\n` +
        `  font-style: normal;\n` +
        `  font-weight: ${weight};\n` +
        `  font-display: swap;\n` +
        `  src: url('../../assets/fonts/${fileName}') format('woff2');\n` +
        (range ? `  unicode-range: ${range.trim()};\n` : '') +
        `}`,
      );
      console.log(`  OK  ${fileName} (${(buf.length / 1024).toFixed(1)} KB)`);
    }
  }

  const header =
    `/*\n` +
    ` * fonts.css — locally vendored web fonts (generated by scripts/fetch-fonts.js).\n` +
    ` * Replaces the render-blocking fonts.googleapis.com @imports so the UI keeps\n` +
    ` * its typography offline and never waits on the network at first paint.\n` +
    ` *\n` +
    ` * Inter e JetBrains Mono sao VARIAVEIS: um woff2 por subset cobre o eixo\n` +
    ` * de peso inteiro, entao cada @font-face declara um INTERVALO de peso e o\n` +
    ` * navegador interpola 400/500/600/700 dali. Metamorphous e Noto Sans Runic\n` +
    ` * tem peso unico e servem o letreiro "Dagr" do painel de git; as duas sao\n` +
    ` * SIL OFL 1.1, ao contrario da Norse que elas substituiram.\n` +
    ` *\n` +
    ` * Do not edit by hand; re-run the script to refresh.\n` +
    ` */\n\n`;
  fs.writeFileSync(OUT_CSS, header + faceBlocks.join('\n\n') + '\n');
  console.log(`\nWrote ${faceBlocks.length} @font-face rules to css/base/fonts.css`);
}

main().catch((err) => { console.error(err); process.exit(1); });
