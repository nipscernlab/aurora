// check-design-tokens.js: impede que o desenho volte a derivar.
//
// A AURORA tem uma paleta e uma escala de movimento em tokens, e mesmo assim
// cor cravada e duração cravada foram reaparecendo por anos, uma regra de cada
// vez. Foi assim que as três janelas terminaram com três céus noturnos
// diferentes, e ninguém percebeu até alguém medir.
//
// Este verificador é uma CATRACA, não uma barreira. Falhar de cara nas 226
// ocorrências que existem hoje só ensinaria a ignorar o CI, então cada arquivo
// carrega abaixo o número que ele tem agora, e o que quebra a construção é
// PASSAR desse número. Limpar um arquivo faz o verificador pedir que a linha
// dele desça junto, e é assim que o teto encolhe sem nenhuma força-tarefa.
//
// O que ele não faz: julgar se a cor está certa. Ele só sabe dizer que a cor
// não veio de um token, que é a única parte verificável por máquina.
//
// Uso:  node scripts/check-design-tokens.js
//       node scripts/check-design-tokens.js --update   (regrava a catraca)

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(__dirname, 'design-tokens-baseline.json');

// Os arquivos que DEFINEM tokens obviamente contêm hex: é o trabalho deles.
const TOKEN_FILES = new Set([
  'css/base/brand_tokens.css',
  'css/base/theme_variables.css',
  'css/base/semantic_tokens.css',
]);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
// Duração literal dentro de transition/animation. O `var(--…)` some antes da
// contagem, então uma regra que usa token não é contada.
const DURATION_DECL = /(transition|animation)[^;{}]*/g;
const DURATION_LITERAL = /(?<![-\w(])\d+(\.\d+)?m?s\b/g;

// Tamanho e peso de fonte cravados. Mesma ideia das cores: a escala inteira
// esta em tokens (--text-*, --font-*, em css/base/theme_variables.css) e cada
// valor solto e uma decisao que ninguem mais consegue seguir. Foram medidos
// 93 tamanhos e 41 pesos cravados quando esta contagem entrou, incluindo
// coisas que nem existem, como peso 800 e 900 numa fonte cujo eixo vai ate
// 700, e 15px entre dois degraus da escala.
//
// `inherit`, `normal` e `bold` nao contam: os dois primeiros sao reset
// legitimo e o terceiro e pego pela conta de peso mesmo assim (e 700 escrito
// em palavra). O `var(--…)` some antes da contagem, entao quem usa token nao
// e contado.
const FONT_SIZE_DECL = /font-size\s*:[^;{}]*/g;
const FONT_WEIGHT_DECL = /font-weight\s*:[^;{}]*/g;
const VALOR_CRAVADO = /(?<![-\w(])\d+(\.\d+)?(px|em|rem|pt|%|cqw|vw|vh)?\b|\bbold(er)?\b|\blighter\b/g;

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function targets() {
  const css = walk(path.join(REPO, 'css')).filter((f) => f.endsWith('.css'));
  const html = walk(path.join(REPO, 'html')).filter((f) => f.endsWith('.html'));
  return [...css, ...html].map((f) => path.relative(REPO, f).replace(/\\/g, '/')).sort();
}

/**
 * Conta os literais de uma declaracao, depois de tirar os `var(--…)` e as
 * palavras que sao reset legitimo.
 * @param {string} src
 * @param {RegExp} decl
 */
function cravados(src, decl) {
  let n = 0;
  for (const d of (src.match(decl) || [])) {
    const limpo = d
      .replace(/var\([^)]*\)/g, '')
      .replace(/\b(inherit|initial|unset|revert|normal)\b/g, '');
    n += (limpo.match(VALOR_CRAVADO) || []).length;
  }
  return n;
}

/** Conta cor, duração, tamanho e peso de fonte cravados num arquivo. */
function count(rel) {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const hex = TOKEN_FILES.has(rel) ? 0 : (src.match(HEX) || []).length;

  let duration = 0;
  for (const decl of (src.match(DURATION_DECL) || [])) {
    const semTokens = decl.replace(/var\([^)]*\)/g, '');
    duration += (semTokens.match(DURATION_LITERAL) || []).length;
  }
  // Os arquivos de token DEFINEM a escala; contar ali seria contar o proprio
  // dicionario, como ja se faz com as cores. O fonts.css entra na mesma
  // isencao para o PESO: os `font-weight: 400 700` dele sao os EIXOS que cada
  // arquivo de fonte oferece, nao uma escolha de desenho.
  const naEscala = TOKEN_FILES.has(rel);
  const ehFonts = rel === 'css/base/fonts.css';
  return {
    hex,
    duration,
    fontSize: naEscala ? 0 : cravados(src, FONT_SIZE_DECL),
    fontWeight: (naEscala || ehFonts) ? 0 : cravados(src, FONT_WEIGHT_DECL),
  };
}

function medir() {
  const atual = {};
  for (const rel of targets()) {
    const c = count(rel);
    if (c.hex || c.duration || c.fontSize || c.fontWeight) atual[rel] = c;
  }
  return atual;
}

/** Os quatro eixos que a catraca mede. */
const TIPOS = ['hex', 'duration', 'fontSize', 'fontWeight'];
const nome = {
  hex: 'cor cravada',
  duration: 'duração cravada',
  fontSize: 'tamanho de fonte cravado',
  fontWeight: 'peso de fonte cravado',
};

const atual = medir();

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(atual, null, 2)}\n`);
  const totals = Object.values(atual).reduce((a, c) => ({
    hex: a.hex + c.hex,
    duration: a.duration + c.duration,
    fontSize: a.fontSize + c.fontSize,
    fontWeight: a.fontWeight + c.fontWeight,
  }), { hex: 0, duration: 0, fontSize: 0, fontWeight: 0 });
  console.log(`[design-tokens] catraca regravada: ${totals.hex} cores, ${totals.duration} durações, `
    + `${totals.fontSize} tamanhos e ${totals.fontWeight} pesos de fonte cravados `
    + `em ${Object.keys(atual).length} arquivos.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_FILE)) {
  console.error('[design-tokens] baseline ausente. Rode: node scripts/check-design-tokens.js --update');
  process.exit(1);
}

const base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));

const piorou = [];
const melhorou = [];

for (const [rel, c] of Object.entries(atual)) {
  const b = { hex: 0, duration: 0, fontSize: 0, fontWeight: 0, ...(base[rel] || {}) };
  for (const tipo of TIPOS) {
    if (c[tipo] > b[tipo]) piorou.push({ rel, tipo, de: b[tipo], para: c[tipo] });
    else if (c[tipo] < b[tipo]) melhorou.push({ rel, tipo, de: b[tipo], para: c[tipo] });
  }
}
// Arquivo que sumiu da medição e ainda está na catraca também é melhora.
for (const [rel, b] of Object.entries(base)) {
  if (atual[rel]) continue;
  for (const tipo of TIPOS) {
    if ((b[tipo] || 0) > 0) melhorou.push({ rel, tipo, de: b[tipo], para: 0 });
  }
}


if (piorou.length) {
  console.error('[design-tokens] o desenho derivou:\n');
  for (const p of piorou) {
    console.error(`  ${p.rel}: ${nome[p.tipo]} passou de ${p.de} para ${p.para}`);
  }
  console.error('\nUse os tokens: as cores estão em css/base/brand_tokens.css; as durações');
  console.error('(--motion-*), os tamanhos (--text-*) e os pesos (--font-*) estão em');
  console.error('css/base/theme_variables.css. Se o valor novo for mesmo');
  console.error('necessário e local, explique no código e rode --update para mover a catraca.');
  process.exit(1);
}

if (melhorou.length) {
  console.log('[design-tokens] limpou, e a catraca pode descer:\n');
  for (const m of melhorou) {
    console.log(`  ${m.rel}: ${nome[m.tipo]} caiu de ${m.de} para ${m.para}`);
  }
  console.log('\nRode: node scripts/check-design-tokens.js --update');
  process.exit(1);
}

const totals = Object.values(atual).reduce((a, c) => ({
  hex: a.hex + c.hex,
  duration: a.duration + c.duration,
  fontSize: a.fontSize + c.fontSize,
  fontWeight: a.fontWeight + c.fontWeight,
}), { hex: 0, duration: 0, fontSize: 0, fontWeight: 0 });
console.log(`[design-tokens] OK — ${totals.hex} cores, ${totals.duration} durações, `
  + `${totals.fontSize} tamanhos e ${totals.fontWeight} pesos de fonte cravados, nenhum novo.`);
