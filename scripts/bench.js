// bench.js: mede a AURORA de verdade e guarda uma linha por medicao em
// docs/bench/medidas.csv, com o commit medido. Serve para responder, a cada
// correcao ou atualizacao, "ficou mais rapido ou mais leve?" com numero, e
// para o paper, onde a frase "a interface abre em X ms" precisa de origem.
//
// Ferramenta de manutencao, rodada a mao (nao esta em workflow: abre uma
// janela de verdade e leva perto de um minuto por repeticao):
//
//   npm run bench                       tres repeticoes, mediana, anexa ao CSV
//   node scripts/bench.js --runs 5      mais repeticoes
//   node scripts/bench.js --nota "antes do refreshTree novo"
//   node scripts/bench.js --seco        mede e imprime, nao grava no CSV
//   node scripts/bench.js --compilar    inclui a compilacao C+- (precisa da toolchain)
//
// O que e medido, e por que estas e nao outras:
//
//   boot_ms     do lancamento ate o Monaco existir na janela principal. E o
//               tempo que a pessoa espera olhando a splash.
//   projeto_ms  de openProject ate o primeiro item da arvore aparecer. E o
//               refreshTree inteiro, com leitura do .spf e classificacao.
//   editor_ms   do clique num .cmm ate o modelo do Monaco existir. E o
//               addTab com criacao de editor.
//   diag_ms     de abrir o top level .v ate o slang publicar o primeiro
//               diagnostico. E o custo do indice do LSP num projeto pequeno.
//               Fica vazio quando o slang-server nao esta instalado.
//   heap_mb     heap JS do renderer principal depois de tudo assentar.
//   nos_dom     nos do DOM da janela principal no mesmo instante. Cresceu sem
//               motivo, e vazamento de painel.
//   ws_mb       working set somado de TODOS os processos do app (main, GPU,
//               renderers, LSPs), pelo app.getAppMetrics(). E o que o gerente
//               de tarefas mostra.
//   dist_kb     bytes de js e css em dist/assets. Nao depende de rodar nada,
//               e a medida do que o Vite empacotou.
//   cmm_ms      compilacao C+- do processador de exemplo, so com --compilar.
//
// Cada repeticao sobe um perfil (user-data-dir) e um projeto descartaveis, os
// mesmos do capture-media.js, para a medida nao depender do que a pessoa tem
// aberto. A linha gravada e a MEDIANA das repeticoes: uma repeticao com o
// antivirus acordando no meio nao vira tendencia.
//
// A mesma armadilha do capture-media: o Playwright precisa de
// SAPHO_SKIP_SINGLE_INSTANCE e de --user-data-dir proprio, senao a segunda
// instancia esbarra no bloqueio de instancia unica e sai calada.

// Os globais abaixo so existem dentro de page.evaluate, que roda no renderer.
/* global window, document */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CSV_PADRAO = path.join(REPO_ROOT, 'docs', 'bench', 'medidas.csv');
const COLUNAS = ['data', 'commit', 'versao', 'runs', 'boot_ms', 'projeto_ms', 'editor_ms', 'diag_ms', 'heap_mb', 'nos_dom', 'ws_mb', 'dist_kb', 'cmm_ms', 'nota'];

function argumentos(argv) {
  const opts = { runs: 3, nota: '', seco: false, compilar: false, out: CSV_PADRAO };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') opts.runs = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (a === '--nota') opts.nota = String(argv[++i] || '');
    else if (a === '--seco') opts.seco = true;
    else if (a === '--compilar') opts.compilar = true;
    else if (a === '--out') opts.out = path.resolve(argv[++i] || CSV_PADRAO);
    else if (a === '--help' || a === '-h') { opts.ajuda = true; }
  }
  return opts;
}

function cleanEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) if (k !== 'ELECTRON_RUN_AS_NODE') out[k] = v;
  out.SAPHO_SKIP_SINGLE_INSTANCE = '1';
  return out;
}

/** Mediana de uma lista de numeros, ignorando o que nao e numero finito. */
function mediana(valores) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function tamanhoDoDist() {
  const dir = path.join(REPO_ROOT, 'dist', 'assets');
  let bytes = 0;
  try {
    for (const f of fs.readdirSync(dir)) if (/\.(js|css)$/.test(f)) bytes += fs.statSync(path.join(dir, f)).size;
  } catch { return NaN; }
  return Math.round(bytes / 1024);
}

function commitAtual() {
  try {
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const sujo = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    return sujo ? `${hash}+` : hash; // o "+" avisa que havia mudanca nao commitada
  } catch { return 'desconhecido'; }
}

/** Campo de CSV: aspas quando precisa, aspas internas dobradas. */
function campo(v) {
  const s = v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function esperarJanelaPrincipal(app, timeoutMs = 60000) {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    for (const w of app.windows()) if (/[\\/]index\.html$/.test(w.url())) return w;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('a janela principal (index.html) nao apareceu');
}

/** Uma repeticao completa; devolve as medidas dela. */
async function medirUmaVez(electron, opts) {
  const { writeProject } = require('./capture-media');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-bench-ud-'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-bench-prj-'));
  const projectDir = path.join(scratch, 'mediamovel');
  fs.mkdirSync(projectDir, { recursive: true });
  const projeto = writeProject(projectDir);
  const m = {};

  const t0 = Date.now();
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: REPO_ROOT, env: cleanEnv(), timeout: 90000 });
  try {
    const page = await esperarJanelaPrincipal(app);
    await page.waitForFunction(() => typeof window.monaco !== 'undefined' && !!document.getElementById('monaco-editor'), null, { timeout: 60000 });
    m.boot_ms = Date.now() - t0;

    const t1 = Date.now();
    await page.evaluate(async (spf) => { await window.electronAPI?.openProject?.(spf); await window.projectTreeManager?.refreshTree?.(); }, projeto.spfPath);
    await page.waitForSelector('.file-item, .verilog-file-item', { timeout: 60000 });
    m.projeto_ms = Date.now() - t1;

    const t2 = Date.now();
    await page.locator('.file-item, .verilog-file-item').filter({ hasText: 'mediamovel.cmm' }).first().click();
    await page.waitForFunction(() => window.monaco.editor.getModels().some((x) => /mediamovel\.cmm$/i.test(x.uri.path)), null, { timeout: 30000 });
    m.editor_ms = Date.now() - t2;

    const t3 = Date.now();
    await page.locator('.file-item, .verilog-file-item').filter({ hasText: 'top_mediamovel.v' }).first().click();
    try {
      await page.waitForFunction(() => window.monaco.editor.getModelMarkers({ owner: 'slang' }).length > 0, null, { timeout: 20000 });
      m.diag_ms = Date.now() - t3;
    } catch { m.diag_ms = NaN; } // slang ausente ou projeto sem diagnostico

    if (opts.compilar) {
      const t4 = Date.now();
      await page.click('#cmmcomp');
      try {
        await page.waitForFunction(() => /(Sucesso|Success|conclu|Compila[cç][aã]o finalizada)/i.test((document.getElementById('terminal-tcmm') || {}).innerText || ''), null, { timeout: 180000 });
        m.cmm_ms = Date.now() - t4;
      } catch { m.cmm_ms = NaN; }
    }

    await page.waitForTimeout(2000); // deixa observers e relayouts assentarem
    const r = await page.evaluate(() => ({
      heap_mb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : NaN,
      nos_dom: document.querySelectorAll('*').length,
    }));
    Object.assign(m, r);
    m.ws_mb = await app.evaluate(({ app: a }) => Math.round(a.getAppMetrics().reduce((s, p) => s + (p.memory ? p.memory.workingSetSize : 0), 0) / 1024));
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return m;
}

function ajuda() {
  console.log('bench: mede boot, abertura de projeto, editor, LSP, memoria e bundle da AURORA e anexa ao CSV.\n');
  console.log('  node scripts/bench.js [--runs N] [--nota texto] [--seco] [--compilar] [--out arquivo.csv]');
  console.log(`  CSV padrao: ${path.relative(REPO_ROOT, CSV_PADRAO)}`);
}

async function main() {
  const opts = argumentos(process.argv.slice(2));
  if (opts.ajuda) { ajuda(); return; }
  let electron;
  try { ({ _electron: electron } = require('playwright')); }
  catch { console.error('bench: playwright nao esta instalado. Rode `npm install` primeiro.'); process.exit(1); }
  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'index.html'))) {
    console.error('bench: dist/index.html nao existe. Rode `npm run build:renderer` primeiro, senao mede o bundle velho.');
    process.exit(1);
  }

  const versao = require(path.join(REPO_ROOT, 'package.json')).version;
  const commit = commitAtual();
  console.log(`bench: ${opts.runs} repeticao(oes) em ${commit} (v${versao})`);
  const repeticoes = [];
  for (let i = 0; i < opts.runs; i++) {
    const m = await medirUmaVez(electron, opts);
    repeticoes.push(m);
    console.log(`  #${i + 1}: boot ${m.boot_ms} ms, projeto ${m.projeto_ms} ms, editor ${m.editor_ms} ms, diag ${Number.isFinite(m.diag_ms) ? m.diag_ms + ' ms' : 'n/d'}, heap ${m.heap_mb} MB, dom ${m.nos_dom}, ws ${m.ws_mb} MB${opts.compilar ? `, cmm ${m.cmm_ms} ms` : ''}`);
  }

  const linha = {
    data: new Date().toISOString().slice(0, 16).replace('T', ' '),
    commit,
    versao,
    runs: opts.runs,
    nota: opts.nota,
    dist_kb: tamanhoDoDist(),
  };
  for (const k of ['boot_ms', 'projeto_ms', 'editor_ms', 'diag_ms', 'heap_mb', 'nos_dom', 'ws_mb', 'cmm_ms']) {
    linha[k] = mediana(repeticoes.map((r) => r[k]));
  }

  console.log('\nmediana:');
  for (const k of COLUNAS) if (k !== 'nota' && linha[k] !== '' && !(typeof linha[k] === 'number' && !Number.isFinite(linha[k]))) console.log(`  ${k.padEnd(11)} ${linha[k]}`);

  if (opts.seco) { console.log('\n(--seco: nada gravado)'); return; }
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  const novo = !fs.existsSync(opts.out);
  const texto = (novo ? COLUNAS.join(',') + '\n' : '') + COLUNAS.map((k) => campo(linha[k])).join(',') + '\n';
  fs.appendFileSync(opts.out, texto, 'utf8');
  console.log(`\nbench: linha anexada em ${path.relative(REPO_ROOT, opts.out)}`);
}

module.exports = { mediana, campo, argumentos, COLUNAS };

if (require.main === module) {
  main().catch((err) => { console.error(`bench: ${err && err.stack ? err.stack : err}`); process.exit(1); });
}
