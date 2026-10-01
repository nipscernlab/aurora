/**
 * O bench (scripts/bench) rodado como programa, com o Playwright falso: as
 * medidas de cada repeticao, a mediana, a linha do CSV e as quedas. As pecas
 * puras (mediana, campo, argumentos) tem o teste delas em bench.test.js.
 *
 * Nada abre de verdade: o `_electron` do playwright e falso (no cache do
 * require nativo) e o execFileSync do git e travado antes de o script carregar.
 * O CSV vai sempre para uma pasta temporaria (--out) ou nao e gravado (--seco),
 * para nunca tocar o docs/bench/medidas.csv do repositorio.
 */
import Module, { createRequire, syncBuiltinESMExports } from 'node:module';
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── a trava do execFileSync, antes de qualquer carga do script ───────────────
const gitFalso = vi.fn();
cp.execFileSync = gitFalso;
syncBuiltinESMExports();

const req = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'bench.js');
const DIST = path.join(RAIZ, 'dist', 'index.html');
const ASSETS = path.join(RAIZ, 'dist', 'assets');
const PLAYWRIGHT = req.resolve('playwright');

/** O unico ponto que sabe como o script e rodado como programa. */
const chamar = {
  rodar: () => {
    const mainOriginal = process.mainModule;
    delete req.cache[SCRIPT];
    try {
      Module._load(SCRIPT, null, true);
    } finally {
      process.mainModule = mainOriginal;
    }
  },
};

beforeAll(async () => {
  expect(req('child_process').execFileSync).toBe(gitFalso);
  const { execFileSync } = await import('node:child_process');
  expect(execFileSync).toBe(gitFalso);
});

let mundo;
let log;
let erros;
let exit;
let tmp;
const argvOriginal = process.argv;
const playwrightOriginal = req.cache[PLAYWRIGHT];
const pastasDoBench = () => new Set(fs.readdirSync(os.tmpdir()).filter((n) => /^aurora-bench-/.test(n)));
let pastasAntes;

/** Roda um callback do renderer com `window`, `document` e `performance` de mentira. */
async function comJanela(fn) {
  const antes = { w: globalThis.window, d: globalThis.document, p: performance.memory };
  globalThis.window = mundo.janela;
  globalThis.document = mundo.documento;
  performance.memory = mundo.memoria;
  try { return await fn(); } finally {
    globalThis.window = antes.w; globalThis.document = antes.d; performance.memory = antes.p;
  }
}

function mundoPadrao() {
  const gestos = [];
  const modelos = [];
  const pagina = {
    url: () => 'file:///C:/aurora/dist/index.html',
    async waitForFunction(fn) {
      gestos.push('espera');
      if (!(await comJanela(fn))) throw new Error('Timeout');
    },
    async evaluate(fn, arg) { gestos.push('evaluate'); return comJanela(() => fn(arg)); },
    async waitForSelector(sel) { gestos.push(`seletor ${sel}`); },
    async click(sel) {
      gestos.push(`clique ${sel}`);
      if (sel === '#cmmcomp') mundo.documento.terminal.innerText = mundo.saidaDaCompilacao;
    },
    async waitForTimeout() { gestos.push('pausa'); },
    locator: () => ({
      filter: ({ hasText }) => ({
        first: () => ({ click: async () => { gestos.push(`abrir ${hasText}`); modelos.push({ uri: { path: `/c/x/${hasText}` } }); } }),
      }),
    }),
  };
  return {
    gestos,
    pagina,
    janelaDemora: 0,
    lancamentos: [],
    fechamentos: 0,
    temPlaywright: true,
    temDist: true,
    assets: { 'a.js': 2048, 'b.css': 1024, 'c.map': 999999 },
    git: { hash: 'abc1234\n', status: '' },
    memoria: { usedJSHeapSize: 50 * 1048576 },
    saidaDaCompilacao: 'Compilacao finalizada',
    marcadores: 1,
    janela: {
      monaco: { editor: { getModels: () => modelos, getModelMarkers: ({ owner }) => (owner === 'slang' ? new Array(mundo.marcadores) : []) } },
      electronAPI: { openProject: vi.fn(async () => {}) },
      projectTreeManager: { refreshTree: vi.fn(async () => {}) },
    },
    documento: {
      terminal: { innerText: '' },
      getElementById(id) {
        if (id === 'monaco-editor') return {};
        if (id === 'cmmcomp') return { disabled: false };
        if (id === 'terminal-tcmm') return mundo.semTerminal ? null : this.terminal;
        return null;
      },
      querySelectorAll: () => ({ length: 1234 }),
    },
  };
}

beforeEach(() => {
  pastasAntes = pastasDoBench();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-benchcli-'));
  mundo = mundoPadrao();
  log = []; erros = [];
  const playwright = {
    get _electron() {
      if (!mundo.temPlaywright) throw new Error('Cannot find module playwright');
      return {
        launch: async (opts) => {
          mundo.lancamentos.push(opts);
          let consultas = 0;
          return {
            windows: () => (++consultas > mundo.janelaDemora ? [mundo.pagina] : []),
            evaluate: async (fn) => fn({ app: { getAppMetrics: () => [{ memory: { workingSetSize: 100 * 1024 } }, {}, { memory: { workingSetSize: 50 * 1024 } }] } }),
            close: async () => { mundo.fechamentos += 1; throw new Error('ja fechada'); },
          };
        },
      };
    },
  };
  req.cache[PLAYWRIGHT] = { id: PLAYWRIGHT, filename: PLAYWRIGHT, loaded: true, children: [], paths: [], exports: playwright };
  gitFalso.mockReset().mockImplementation((cmd, args) => {
    if (cmd !== 'git') throw new Error(`execFileSync inesperado: ${cmd}`);
    if (mundo.git === 'lanca') throw new Error('git ausente');
    return args[0] === 'rev-parse' ? mundo.git.hash : mundo.git.status;
  });
  const exists = fs.existsSync.bind(fs);
  const readdir = fs.readdirSync.bind(fs);
  const stat = fs.statSync.bind(fs);
  vi.spyOn(fs, 'existsSync').mockImplementation((p) => (p === DIST ? mundo.temDist : exists(p)));
  vi.spyOn(fs, 'readdirSync').mockImplementation((p, ...r) => {
    if (p === ASSETS) {
      if (mundo.assets === null) throw new Error('ENOENT');
      return Object.keys(mundo.assets);
    }
    return readdir(p, ...r);
  });
  vi.spyOn(fs, 'statSync').mockImplementation((p, ...r) => (typeof p === 'string' && p.startsWith(ASSETS) ? { size: mundo.assets[path.basename(p)] } : stat(p, ...r)));
  vi.spyOn(console, 'log').mockImplementation((...a) => { log.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { erros.push(a.join(' ')); });
  exit = vi.spyOn(process, 'exit').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.argv = argvOriginal;
  if (playwrightOriginal) req.cache[PLAYWRIGHT] = playwrightOriginal; else delete req.cache[PLAYWRIGHT];
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const n of pastasDoBench()) if (!pastasAntes.has(n)) fs.rmSync(path.join(os.tmpdir(), n), { recursive: true, force: true });
});

async function rodar(args) {
  process.argv = [argvOriginal[0], SCRIPT, ...args];
  chamar.rodar();
  const fim = (s) => s.includes('bench: linha anexada') || s.includes('(--seco: nada gravado)');
  for (let i = 0; i < 400 && !log.some(fim) && !exit.mock.calls.length && !erros.length; i++) await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

const csv = () => fs.readFileSync(path.join(tmp, 'm.csv'), 'utf8');
const texto = () => log.join('\n');

describe('ajuda e quedas', () => {
  it('--help imprime o uso e o CSV padrao', async () => {
    await rodar(['--help']);
    expect(log[0]).toBe('bench: mede boot, abertura de projeto, editor, LSP, memoria e bundle da AURORA e anexa ao CSV.\n');
    expect(log[1]).toBe('  node scripts/bench.js [--runs N] [--nota texto] [--seco] [--compilar] [--out arquivo.csv]');
    expect(log[2]).toBe(`  CSV padrao: ${path.join('docs', 'bench', 'medidas.csv')}`);
    expect(mundo.lancamentos).toEqual([]);
  });

  it('sem playwright ou sem dist/, para com a instrucao', async () => {
    mundo.temPlaywright = false;
    await rodar(['--seco']);
    expect(erros[0]).toBe('bench: playwright nao esta instalado. Rode `npm install` primeiro.');
    expect(exit.mock.calls[0]).toEqual([1]);

    mundo = mundoPadrao();
    erros = [];
    exit.mockClear();
    mundo.temDist = false;
    await rodar(['--seco', '--runs', '1']);
    expect(erros[0]).toBe('bench: dist/index.html nao existe. Rode `npm run build:renderer` primeiro, senao mede o bundle velho.');
    expect(exit.mock.calls[0]).toEqual([1]);
  });
});

describe('uma medicao', () => {
  it('mede cada etapa, tira a mediana e anexa a linha com cabecalho no CSV novo', async () => {
    await rodar(['--runs', '2', '--nota', 'antes, do "x"', '--out', path.join(tmp, 'm.csv')]);
    const [lanc] = mundo.lancamentos;
    expect(lanc.args[0]).toBe('.');
    expect(lanc.args[1]).toMatch(/^--user-data-dir=.*aurora-bench-ud-/);
    expect(lanc).toMatchObject({ cwd: RAIZ, timeout: 90000 });
    expect(lanc.env.SAPHO_SKIP_SINGLE_INSTANCE).toBe('1');
    expect(lanc.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(mundo.lancamentos).toHaveLength(2);
    expect(mundo.fechamentos).toBe(2);
    expect(mundo.janela.electronAPI.openProject).toHaveBeenCalledWith(expect.stringMatching(/mediamovel\.spf$/));
    expect(mundo.gestos).toContain('abrir mediamovel.cmm');
    expect(mundo.gestos).toContain('abrir top_mediamovel.v');
    expect(mundo.gestos).not.toContain('clique #cmmcomp');

    expect(log[0]).toBe(`bench: 2 repeticao(oes) em abc1234 (v${req(path.join(RAIZ, 'package.json')).version})`);
    expect(log[1]).toMatch(/^ {2}#1: boot \d+ ms, projeto \d+ ms, editor \d+ ms, diag \d+ ms, heap 50 MB, dom 1234, ws 150 MB$/);
    expect(texto()).toContain('\nmediana:');
    expect(texto()).toMatch(/ {2}heap_mb {5}50/);
    expect(texto()).toMatch(/ {2}dist_kb {5}3/);
    expect(texto()).not.toContain('cmm_ms');
    expect(texto()).toContain(`bench: linha anexada em ${path.relative(RAIZ, path.join(tmp, 'm.csv'))}`);

    const [cab, linha, fim] = csv().split('\n');
    expect(cab).toBe('data,commit,versao,runs,boot_ms,projeto_ms,editor_ms,diag_ms,heap_mb,nos_dom,ws_mb,dist_kb,cmm_ms,nota');
    const campos = linha.split(',');
    expect(campos[1]).toBe('abc1234');
    expect(campos[3]).toBe('2');
    expect(campos.slice(8, 13)).toEqual(['50', '1234', '150', '3', '']);
    expect(linha.endsWith(',"antes, do ""x"""')).toBe(true);
    expect(fim).toBe('');
  });

  it('o CSV que ja existe ganha so a linha; arvore suja marca o commit com "+"', async () => {
    fs.writeFileSync(path.join(tmp, 'm.csv'), 'cabecalho\n');
    mundo.git.status = ' M x.js\n';
    await rodar(['--runs', '1', '--out', path.join(tmp, 'm.csv')]);
    const linhas = csv().split('\n');
    expect(linhas[0]).toBe('cabecalho');
    expect(linhas[1].split(',')[1]).toBe('abc1234+');
  });

  it('--seco mede e nao grava; sem git o commit e "desconhecido"; sem dist/assets o tamanho fica vazio', async () => {
    mundo.git = 'lanca';
    mundo.assets = null;
    await rodar(['--seco', '--runs', '1', '--out', path.join(tmp, 'm.csv')]);
    expect(log[0]).toMatch(/^bench: 1 repeticao\(oes\) em desconhecido /);
    expect(texto()).toContain('(--seco: nada gravado)');
    expect(texto()).not.toContain('dist_kb');
    expect(fs.existsSync(path.join(tmp, 'm.csv'))).toBe(false);
  });

  it('sem diagnostico do slang e sem performance.memory: diag n/d e heap vazio', async () => {
    mundo.marcadores = 0;
    mundo.memoria = undefined;
    await rodar(['--runs', '1', '--out', path.join(tmp, 'm.csv')]);
    expect(log[1]).toMatch(/diag n\/d, heap NaN MB/);
    const campos = csv().split('\n')[1].split(',');
    expect(campos[7]).toBe('');
    expect(campos[8]).toBe('');
  });

  it('--compilar volta ao .cmm, espera o botao e mede a compilacao; sem sucesso, fica vazio', async () => {
    await rodar(['--runs', '1', '--compilar', '--out', path.join(tmp, 'm.csv')]);
    const abertos = mundo.gestos.filter((g) => g.startsWith('abrir'));
    expect(abertos).toEqual(['abrir mediamovel.cmm', 'abrir top_mediamovel.v', 'abrir mediamovel.cmm']);
    expect(mundo.gestos).toContain('clique #cmmcomp');
    expect(log[1]).toMatch(/, cmm \d+ ms$/);
    expect(texto()).toMatch(/ {2}cmm_ms {6}\d+/);

    mundo = mundoPadrao();
    log = [];
    mundo.saidaDaCompilacao = 'erro de sintaxe';
    mundo.semTerminal = false;
    await rodar(['--runs', '1', '--compilar', '--seco']);
    expect(log[1]).toMatch(/, cmm NaN ms$/);

    mundo = mundoPadrao();
    log = [];
    mundo.semTerminal = true;
    await rodar(['--runs', '1', '--compilar', '--seco']);
    expect(log[1]).toMatch(/, cmm NaN ms$/);
  });

  it('a janela principal que nunca aparece derruba o bench com a mensagem', async () => {
    mundo.janelaDemora = Infinity;
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    process.argv = [argvOriginal[0], SCRIPT, '--seco', '--runs', '1'];
    chamar.rodar();
    for (let i = 0; i < 80 && !exit.mock.calls.length; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(erros.join('\n')).toContain('bench: Error: a janela principal (index.html) nao apareceu');
    expect(exit).toHaveBeenCalledWith(1);
    expect(mundo.fechamentos).toBe(1);
  });
});
