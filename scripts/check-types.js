// @ts-check
// check-types.js: catraca de tipos.
//
// O tsconfig.json enxerga todo .js que abre com `// @ts-check` (main/, os
// scripts, os downloaders de componentes, o PRISM), em strict. Ate 19/09/2026
// o `tsc --noEmit` do CI so via os 32 .ts do include, e os 132 .js que se
// declaravam verificados nunca tinham sido lidos por ninguem alem do VS Code,
// que os le sem strict. Ligar tudo revelou 961 erros em 66 arquivos, quase
// todos parametro sem JSDoc e nulo sem tratamento, e 409 deles num arquivo so
// (html/prism/prism.js).
//
// Este verificador e uma CATRACA, como o check-design-tokens.js: cada arquivo
// carrega em scripts/types-baseline.json quantos erros de cada codigo ele tem
// hoje, e o que quebra a construcao e PASSAR desse numero, ou um arquivo novo
// aparecer com erro. Limpar um arquivo faz o verificador pedir que a linha
// dele desca junto, e e assim que o teto encolhe sem forca-tarefa. A lista
// inteira continua em `npx tsc --noEmit`.
//
// Le a saida de texto do proprio tsc (--pretty false) porque o TypeScript 7,
// nativo, nao expoe mais a API JavaScript do compilador (createProgram).
//
// Uso:  node scripts/check-types.js
//       node scripts/check-types.js --update   (regrava a catraca)

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(__dirname, 'types-baseline.json');
const TSC = path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');

/** Quantas linhas de erro mostrar por (arquivo, codigo) que piorou. */
const MAX_LINHAS = 20;

/** @typedef {{ file: string, line: number, col: number, code: string, message: string }} Diag */
/** @typedef {Record<string, Record<string, number>>} Catraca arquivo -> codigo -> quantos */

/**
 * Roda o tsc sobre o tsconfig.json e devolve um diagnostico por linha no
 * formato `arquivo(linha,coluna): error TSnnnn: mensagem`. Erro sem arquivo
 * (config quebrada, tipo global ausente) derruba na hora: nao ha catraca
 * para isso.
 * @returns {Diag[]}
 */
function diagnosticos() {
  if (!fs.existsSync(TSC)) {
    console.error(`[check-types] tsc nao encontrado em ${TSC}. Rode: npm ci`);
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [TSC, '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) {
    console.error('[check-types] nao consegui rodar o tsc:', r.error.message);
    process.exit(1);
  }
  const saida = `${r.stdout || ''}\n${r.stderr || ''}`;
  /** @type {Diag[]} */
  const diags = [];
  /** @type {string[]} */
  const globais = [];
  for (const linha of saida.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(linha);
    if (m) {
      diags.push({
        file: m[1].replace(/\\/g, '/'),
        line: Number(m[2]),
        col: Number(m[3]),
        code: m[4],
        message: m[5],
      });
      continue;
    }
    if (/^error TS\d+: /.test(linha)) globais.push(linha);
  }
  if (globais.length) {
    console.error('[check-types] o tsc falhou antes de chegar aos arquivos:\n');
    for (const g of globais) console.error(`  ${g}`);
    process.exit(1);
  }
  // Saiu com erro e nao disse qual: binario que caiu, saida truncada. Nao
  // fingir que esta tudo limpo.
  if (r.status !== 0 && diags.length === 0) {
    console.error(`[check-types] o tsc saiu com codigo ${r.status} sem nenhum diagnostico legivel:\n`);
    console.error(saida.trim().slice(0, 4000));
    process.exit(1);
  }
  return diags;
}

/**
 * Conta os erros por arquivo e por codigo, em ordem estavel, para o JSON so
 * mudar quando o conteudo muda.
 * @param {Diag[]} diags
 * @returns {Catraca}
 */
function medir(diags) {
  /** @type {Catraca} */
  const bruto = {};
  for (const d of diags) {
    const porCodigo = bruto[d.file] || (bruto[d.file] = {});
    porCodigo[d.code] = (porCodigo[d.code] || 0) + 1;
  }
  /** @type {Catraca} */
  const ordenado = {};
  for (const file of Object.keys(bruto).sort()) {
    ordenado[file] = {};
    for (const code of Object.keys(bruto[file]).sort()) ordenado[file][code] = bruto[file][code];
  }
  return ordenado;
}

/** @param {Catraca} c */
function total(c) {
  let n = 0;
  for (const codes of Object.values(c)) for (const k of Object.values(codes)) n += k;
  return n;
}

const diags = diagnosticos();
const atual = medir(diags);

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(atual, null, 2)}\n`);
  console.log(`[check-types] catraca regravada: ${total(atual)} erros de tipo em ${Object.keys(atual).length} arquivos.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_FILE)) {
  console.error('[check-types] baseline ausente. Rode: node scripts/check-types.js --update');
  process.exit(1);
}
/** @type {Catraca} */
const base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));

/** @type {{ file: string, code: string, de: number, para: number }[]} */
const piorou = [];
/** @type {{ file: string, code: string, de: number, para: number }[]} */
const melhorou = [];
const arquivos = [...new Set([...Object.keys(atual), ...Object.keys(base)])].sort();
for (const file of arquivos) {
  const a = atual[file] || {};
  const b = base[file] || {};
  const codigos = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const code of codigos) {
    const de = b[code] || 0;
    const para = a[code] || 0;
    if (para > de) piorou.push({ file, code, de, para });
    else if (para < de) melhorou.push({ file, code, de, para });
  }
}

if (piorou.length) {
  console.error('[check-types] entraram erros de tipo novos:\n');
  for (const p of piorou) {
    console.error(`  ${p.file}: ${p.code} passou de ${p.de} para ${p.para}`);
    // As linhas em si, para nao obrigar a rodar o tsc de novo a procura delas.
    const linhas = diags.filter((d) => d.file === p.file && d.code === p.code);
    for (const d of linhas.slice(0, MAX_LINHAS)) {
      console.error(`      ${d.file}(${d.line},${d.col}): ${d.message}`);
    }
    if (linhas.length > MAX_LINHAS) console.error(`      ... e mais ${linhas.length - MAX_LINHAS}`);
  }
  console.error('\nCorrija (JSDoc resolve quase tudo: @param, @type, @returns). Se o erro for do');
  console.error('TypeScript e nao do codigo, explique no arquivo e rode --update para mover a catraca.');
  process.exit(1);
}
if (melhorou.length) {
  console.log('[check-types] limpou, e a catraca pode descer:\n');
  for (const m of melhorou) console.log(`  ${m.file}: ${m.code} caiu de ${m.de} para ${m.para}`);
  console.log('\nRode: node scripts/check-types.js --update');
  process.exit(1);
}
console.log(`[check-types] OK — ${total(atual)} erros de tipo conhecidos em ${Object.keys(atual).length} arquivos, nenhum novo.`);
