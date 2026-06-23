// Lint estrutural de LaTeX (sem compilar): casa \begin{X}/\end{X}, respeita
// ambientes verbatim (lstlisting/verbatim), checa placeholders e cabecalho.
// Uso: node _lint.js
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
function listTex(dir) {
  const p = path.join(ROOT, dir);
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p).filter(f => f.endsWith('.tex')).sort().map(f => path.join(dir, f));
}
const rootTex = ['main.tex', 'main-compacto.tex'].filter(f => fs.existsSync(path.join(ROOT, f)));
const files = [
  ...rootTex,
  ...listTex('capitulos'),
  ...listTex('secoes'),
  ...listTex('apendices'),
];

const VERBATIM = new Set(['lstlisting', 'verbatim', 'Verbatim', 'comment']);
let totalProblems = 0;

function stripComments(line) {
  // remove de um % nao-escapado ate o fim
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '%' && (i === 0 || line[i - 1] !== '\\')) break;
    out += line[i];
  }
  return out;
}

for (const rel of files) {
  const full = path.join(ROOT, rel);
  const raw = fs.readFileSync(full, 'utf8');
  const lines = raw.split(/\r?\n/);
  const problems = [];

  // placeholder pendente?
  if (/em geração|capítulo em geração/i.test(raw) || /^% placeholder/m.test(raw)) {
    problems.push('AINDA E PLACEHOLDER');
  }
  // cabecalho
  const isChapterFile = rel.startsWith('capitulos') || rel.startsWith('apendices');
  const isSectionFile = rel.startsWith('secoes');
  if (isChapterFile || isSectionFile) {
    if (!/^%\s*!TEX root/.test(lines[0] || '')) problems.push('linha 1 nao tem "% !TEX root"');
  }
  if (isChapterFile && !/\\chapter\{/.test(raw)) problems.push('sem \\chapter{...}');
  if (isSectionFile && !/\\section\{/.test(raw)) problems.push('sem \\section{...}');

  // stack de ambientes, respeitando verbatim
  const stack = [];
  let inVerb = null; // nome do ambiente verbatim ativo
  let lstOpen = 0, lstClose = 0;
  for (let ln = 0; ln < lines.length; ln++) {
    const line = inVerb ? lines[ln] : stripComments(lines[ln]);
    if (/\\begin\{lstlisting\}/.test(line)) lstOpen++;
    if (/\\end\{lstlisting\}/.test(line)) lstClose++;

    if (inVerb) {
      const re = new RegExp('\\\\end\\{' + inVerb + '\\}');
      if (re.test(line)) inVerb = null;
      continue;
    }
    const tokens = line.match(/\\(begin|end)\{([A-Za-z*]+)\}/g) || [];
    for (const tk of tokens) {
      const m = tk.match(/\\(begin|end)\{([A-Za-z*]+)\}/);
      const kind = m[1], env = m[2];
      if (kind === 'begin') {
        if (VERBATIM.has(env)) { inVerb = env; }
        else stack.push({ env, ln: ln + 1 });
      } else {
        if (stack.length === 0) problems.push(`\\end{${env}} sem \\begin (linha ${ln + 1})`);
        else {
          const top = stack.pop();
          if (top.env !== env) problems.push(`\\end{${env}} (linha ${ln + 1}) nao casa com \\begin{${top.env}} (linha ${top.ln})`);
        }
      }
    }
  }
  if (inVerb) problems.push(`ambiente verbatim "${inVerb}" nao fechado`);
  for (const s of stack) problems.push(`\\begin{${s.env}} (linha ${s.ln}) sem \\end`);
  if (lstOpen !== lstClose) problems.push(`lstlisting desbalanceado: ${lstOpen} begin vs ${lstClose} end`);

  // chaves (heuristica grosseira, ignorando verbatim e \{ \})
  let depth = 0, inV2 = null, braceProblem = false;
  for (let ln = 0; ln < lines.length; ln++) {
    const line = inV2 ? lines[ln] : stripComments(lines[ln]);
    if (inV2) { if (new RegExp('\\\\end\\{' + inV2 + '\\}').test(line)) inV2 = null; continue; }
    const bm = line.match(/\\begin\{([A-Za-z*]+)\}/);
    if (bm && VERBATIM.has(bm[1])) { inV2 = bm[1]; continue; }
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') { i++; continue; } // pula char escapado (\{ \} \\ etc.)
      if (line[i] === '{') depth++;
      else if (line[i] === '}') { depth--; if (depth < 0) { braceProblem = true; depth = 0; } }
    }
  }
  if (depth !== 0) problems.push(`chaves desbalanceadas (saldo ${depth})`);
  if (braceProblem) problems.push('fechou chave "}" sem abrir em algum ponto');

  const tag = problems.length ? `  [${problems.length} PROBLEMA(S)]` : '  ok';
  console.log(`${rel}${tag}`);
  for (const p of problems) console.log(`    - ${p}`);
  totalProblems += problems.length;
}

console.log(`\nTOTAL: ${totalProblems} problema(s) em ${files.length} arquivo(s).`);
process.exit(totalProblems ? 1 : 0);
