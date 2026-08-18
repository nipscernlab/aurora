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

/** Conta cor e duração cravadas num arquivo. */
function count(rel) {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const hex = TOKEN_FILES.has(rel) ? 0 : (src.match(HEX) || []).length;

  let duration = 0;
  for (const decl of (src.match(DURATION_DECL) || [])) {
    const semTokens = decl.replace(/var\([^)]*\)/g, '');
    duration += (semTokens.match(DURATION_LITERAL) || []).length;
  }
  return { hex, duration };
}

function medir() {
  const atual = {};
  for (const rel of targets()) {
    const c = count(rel);
    if (c.hex || c.duration) atual[rel] = c;
  }
  return atual;
}

const atual = medir();

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(atual, null, 2)}\n`);
  const totals = Object.values(atual).reduce(
    (a, c) => ({ hex: a.hex + c.hex, duration: a.duration + c.duration }), { hex: 0, duration: 0 });
  console.log(`[design-tokens] catraca regravada: ${totals.hex} cores e ${totals.duration} durações cravadas em ${Object.keys(atual).length} arquivos.`);
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
  const b = base[rel] || { hex: 0, duration: 0 };
  for (const tipo of ['hex', 'duration']) {
    if (c[tipo] > b[tipo]) piorou.push({ rel, tipo, de: b[tipo], para: c[tipo] });
    else if (c[tipo] < b[tipo]) melhorou.push({ rel, tipo, de: b[tipo], para: c[tipo] });
  }
}
// Arquivo que sumiu da medição e ainda está na catraca também é melhora.
for (const [rel, b] of Object.entries(base)) {
  if (atual[rel]) continue;
  for (const tipo of ['hex', 'duration']) {
    if (b[tipo] > 0) melhorou.push({ rel, tipo, de: b[tipo], para: 0 });
  }
}

const nome = { hex: 'cor cravada', duration: 'duração cravada' };

if (piorou.length) {
  console.error('[design-tokens] o desenho derivou:\n');
  for (const p of piorou) {
    console.error(`  ${p.rel}: ${nome[p.tipo]} passou de ${p.de} para ${p.para}`);
  }
  console.error('\nUse os tokens: as cores estão em css/base/brand_tokens.css e as durações');
  console.error('em css/base/theme_variables.css (--motion-*). Se o valor novo for mesmo');
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

const totals = Object.values(atual).reduce(
  (a, c) => ({ hex: a.hex + c.hex, duration: a.duration + c.duration }), { hex: 0, duration: 0 });
console.log(`[design-tokens] OK — ${totals.hex} cores e ${totals.duration} durações cravadas, nenhuma nova.`);
