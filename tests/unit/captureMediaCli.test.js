/**
 * O capture-media (scripts/capture-media) rodado como programa, com o
 * Playwright falso: a sequencia de gestos de cada tomada, a montagem do GIF
 * pelo ffmpeg e as quedas quando falta ferramenta. A lista de tomadas tem o
 * teste dela em captureMedia.test.js.
 *
 * Nada abre de verdade: o `_electron` do playwright e falso (no cache do
 * require nativo), o spawnSync do ffmpeg e do ffprobe e travado antes de o
 * script carregar, e o fs e espionado em docs/media, para nenhuma imagem cair
 * no repositorio. O projeto descartavel e escrito de verdade numa pasta
 * temporaria, como o script faz.
 */
import Module, { createRequire, syncBuiltinESMExports } from 'node:module';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── a trava do spawnSync, antes de qualquer carga do script ──────────────────
const spawnFalso = vi.fn();
cp.spawnSync = spawnFalso;
syncBuiltinESMExports();

const req = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'capture-media.js');
const MEDIA = path.join(RAIZ, 'docs', 'media');
const DIST = path.join(RAIZ, 'dist', 'index.html');
const PLAYWRIGHT = req.resolve('playwright');

/** Os dois pontos que sabem como o script e carregado. */
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
  modulo: () => {
    delete req.cache[SCRIPT];
    return req(SCRIPT);
  },
};

beforeAll(async () => {
  expect(req('child_process').spawnSync).toBe(spawnFalso);
  const { spawnSync } = await import('node:child_process');
  expect(spawnSync).toBe(spawnFalso);
});

// ── o mundo ───────────────────────────────────────────────────────────────────
let mundo;
let log;
let avisos;
let erros;
let exit;
const argvOriginal = process.argv;
const playwrightOriginal = req.cache[PLAYWRIGHT];

/** Uma pagina do Playwright falsa; `quebrados` sao os seletores cujo clique falha. */
function paginaFalsa(url, gestos) {
  const pagina = {
    url: () => url,
    gestos,
    async waitForFunction(fn, arg) { gestos.push(['esperaFuncao']); await comJanela(() => fn(arg)); },
    async evaluate(fn, arg) { gestos.push(['evaluate', arg]); return comJanela(() => fn(arg)); },
    async waitForSelector(sel) { gestos.push(['esperaSeletor', sel]); },
    async click(sel) {
      gestos.push(['clique', sel]);
      if (mundo.quebrados.has(sel)) throw new Error(`sem ${sel}`);
      if (sel === '#prismcomp') mundo.cliquesNoPrism += 1;
    },
    async waitForTimeout(ms) { gestos.push(['espera', ms]); },
    async screenshot({ path: p }) {
      if (mundo.screenshotLanca) throw new Error('janela fechou');
      gestos.push(['foto', p.startsWith(MEDIA) ? path.relative(MEDIA, p) : 'quadro']);
    },
    locator(sel) {
      return {
        filter: ({ hasText }) => ({
          first: () => ({
            waitFor: async () => { if (mundo.arvoreSem.has(hasText)) throw new Error('nao apareceu'); },
            click: async () => { gestos.push(['abrir', sel, hasText]); },
          }),
        }),
      };
    },
    mouse: {
      move: async (x, y) => gestos.push(['mover', x, y]),
      wheel: async (dx, dy) => gestos.push(['roda', dy]),
      down: async () => gestos.push(['aperta']),
      up: async () => gestos.push(['solta']),
    },
  };
  return pagina;
}

/** Roda um callback de page.evaluate com um `window` e um `document` de mentira. */
async function comJanela(fn) {
  const antes = { w: globalThis.window, d: globalThis.document };
  globalThis.window = mundo.janela;
  globalThis.document = { getElementById: (id) => (id === 'monaco-editor' ? {} : null) };
  try { return await fn(); } finally { globalThis.window = antes.w; globalThis.document = antes.d; }
}

function mundoPadrao() {
  const gestos = [];
  const principal = paginaFalsa('file:///C:/aurora/dist/index.html', gestos);
  const prism = paginaFalsa('file:///C:/aurora/html/prism.html', []);
  const janelaNativa = { getURL: () => 'file:///x/index.html', isMaximized: () => true, unmaximize: vi.fn(), setBounds: vi.fn() };
  return {
    gestos,
    principal,
    prism,
    janelaNativa,
    janela: { monaco: {}, innerWidth: 1600, electronAPI: { openProject: vi.fn(async () => { throw new Error('ja aberto'); }) }, projectTreeManager: { refreshTree: vi.fn() } },
    quebrados: new Set(),
    arvoreSem: new Set(),
    cliquesNoPrism: 0,
    prismAbreNo: 1,               // o PRISM aparece depois deste clique; 0 = nunca
    janelaPrincipalDemora: 0,     // quantas consultas a janela principal leva para aparecer
    lancamentos: [],
    fechou: false,
    temPlaywright: true,
    temDist: true,
    ffmpeg: true,
    ffmpegStatus: 0,
    ffprobe: 'nb_read_frames=1\nduration=0.1\n',
    tamanhoKb: 300,
    screenshotLanca: false,
  };
}

function app() {
  let consultas = 0;
  return {
    windows: () => {
      consultas += 1;
      const ws = consultas > mundo.janelaPrincipalDemora ? [mundo.principal] : [];
      if (mundo.prismAbreNo && mundo.cliquesNoPrism >= mundo.prismAbreNo) ws.push(mundo.prism);
      return ws;
    },
    evaluate: async (fn, arg) => fn({ BrowserWindow: { getAllWindows: () => [{ getURL: () => 'devtools://x' }, mundo.janelaNativa] } }, arg),
    close: async () => { mundo.fechou = true; throw new Error('ja fechada'); },
  };
}

beforeEach(() => {
  mundo = mundoPadrao();
  log = []; avisos = []; erros = [];
  const playwright = {
    get _electron() {
      if (!mundo.temPlaywright) throw new Error('Cannot find module playwright');
      return { launch: async (opts) => { mundo.lancamentos.push(opts); return app(); } };
    },
  };
  req.cache[PLAYWRIGHT] = { id: PLAYWRIGHT, filename: PLAYWRIGHT, loaded: true, children: [], paths: [], exports: playwright };

  spawnFalso.mockReset().mockImplementation((cmd, args) => {
    if (cmd === 'ffmpeg' && args[0] === '-version') {
      if (mundo.ffmpeg === 'lanca') throw new Error('ENOENT');
      return { status: mundo.ffmpeg ? 0 : 1 };
    }
    if (cmd === 'ffmpeg') { mundo.montagens = [...(mundo.montagens || []), args]; return { status: mundo.ffmpegStatus, stderr: Buffer.from('l1\nl2\nerro do ffmpeg') }; }
    if (cmd === 'ffprobe') {
      if (mundo.ffprobe === 'lanca') throw new Error('sem ffprobe');
      return mundo.ffprobe === null ? { status: 1 } : { status: 0, stdout: mundo.ffprobe };
    }
    throw new Error(`spawn inesperado: ${cmd}`);
  });
  const exists = fs.existsSync.bind(fs);
  const mkdir = fs.mkdirSync.bind(fs);
  const stat = fs.statSync.bind(fs);
  vi.spyOn(fs, 'existsSync').mockImplementation((p) => (p === DIST ? mundo.temDist : exists(p)));
  vi.spyOn(fs, 'mkdirSync').mockImplementation((p, o) => (p === MEDIA ? undefined : mkdir(p, o)));
  vi.spyOn(fs, 'statSync').mockImplementation((p, ...r) => (typeof p === 'string' && p.startsWith(MEDIA) ? { size: mundo.tamanhoKb * 1024 } : stat(p, ...r)));
  vi.spyOn(console, 'log').mockImplementation((...a) => { log.push(a.join(' ')); });
  vi.spyOn(console, 'warn').mockImplementation((...a) => { avisos.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { erros.push(a.join(' ')); });
  exit = vi.spyOn(process, 'exit').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.argv = argvOriginal;
  if (playwrightOriginal) req.cache[PLAYWRIGHT] = playwrightOriginal; else delete req.cache[PLAYWRIGHT];
});

async function rodar(args = []) {
  process.argv = [argvOriginal[0], SCRIPT, ...args];
  chamar.rodar();
  for (let i = 0; i < 400 && !mundo.fechou && !exit.mock.calls.length; i++) await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

const gestos = (tipo) => mundo.gestos.filter((g) => g[0] === tipo).map((g) => g.slice(1));
const todoAviso = () => avisos.join('\n');

describe('a ajuda e a linha de comando', () => {
  it('--help e -h so imprimem a ajuda', async () => {
    for (const flag of ['--help', '-h']) {
      log = [];
      process.argv = [argvOriginal[0], SCRIPT, flag];
      chamar.rodar();
      await new Promise((r) => setImmediate(r));
      expect(log[0]).toBe('capture-media: fotos e GIFs do README, tirados da aplicacao de verdade.\n');
      expect(log.join('\n')).toContain('  node scripts/capture-media.js [tomada...]\n');
      expect(log.join('\n')).toContain('  prism          prism.gif, a sintese e o esquematico do PRISM');
      expect(log.join('\n')).toContain('  tudo           todas as anteriores\n');
      expect(log.join('\n')).toContain('O GIF precisa do ffmpeg no PATH; sem ele, os quadros ficam no disco.');
    }
    expect(mundo.lancamentos).toEqual([]);
  });

  it('tomada desconhecida sai com 2 e lista as disponiveis', async () => {
    await rodar(['nada']);
    expect(erros[0]).toBe('capture-media: tomada desconhecida: nada');
    expect(erros[1]).toBe('  disponiveis: hero, split-editor, compile, prism, tudo');
    expect(exit.mock.calls[0]).toEqual([2]);
  });

  it('sem playwright ou sem dist/, para com a instrucao do que falta', async () => {
    mundo.temPlaywright = false;
    await rodar([]);
    expect(erros[0]).toBe('capture-media: playwright is not installed. Run `npm install` first.');
    expect(exit.mock.calls[0]).toEqual([1]);

    mundo = mundoPadrao();
    erros = [];
    exit.mockClear();
    mundo.temDist = false;
    await rodar([]);
    expect(erros[0]).toBe('capture-media: dist/index.html is missing. Run `npm run build:renderer` first.');
    expect(exit.mock.calls[0]).toEqual([1]);
  });
});

describe('o hero, que e o padrao', () => {
  it('abre o projeto descartavel, arruma a janela e tira a foto', async () => {
    await rodar([]);
    const [lanc] = mundo.lancamentos;
    expect(lanc.args[0]).toBe('.');
    expect(lanc.args[1]).toMatch(/^--user-data-dir=.*aurora-capture-/);
    expect(path.basename(lanc.args[2])).toBe('mediamovel.spf');
    expect(lanc).toMatchObject({ cwd: RAIZ, timeout: 60_000 });
    expect(lanc.env.SAPHO_SKIP_SINGLE_INSTANCE).toBe('1');
    expect(lanc.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');

    // O projeto foi escrito antes do lancamento e apagado depois.
    expect(fs.existsSync(lanc.args[2])).toBe(false);
    expect(fs.existsSync(lanc.args[1].slice('--user-data-dir='.length))).toBe(false);

    expect(mundo.janela.electronAPI.openProject).toHaveBeenCalledWith(lanc.args[2]);
    expect(mundo.janela.projectTreeManager.refreshTree).toHaveBeenCalled();
    expect(gestos('esperaSeletor')).toEqual([['.file-item, .verilog-file-item']]);
    expect(gestos('abrir')).toEqual([['.file-item, .verilog-file-item', 'mediamovel.cmm']]);
    expect(gestos('clique')).toEqual([['.tab[data-terminal="tcmd"]']]);
    expect(mundo.janelaNativa.unmaximize).toHaveBeenCalled();
    expect(mundo.janelaNativa.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1600, height: 1000 });
    expect(gestos('foto')).toEqual([['hero.png']]);
    expect(log).toContain('capture-media: tomadas pedidas: hero');
    expect(log).toContain('capture-media: hero.png written (1600x1000, 300 KB)');
    expect(mundo.fechou).toBe(true);
    expect(spawnFalso).not.toHaveBeenCalled();
  });

  it('o .spf do projeto descartavel aponta para o processador, o topo e o testbench', async () => {
    const { writeProject } = chamar.modulo();
    const raiz = fs.mkdtempSync(path.join(req('os').tmpdir(), 'aurora-cm-'));
    try {
      const p = writeProject(raiz);
      const spf = JSON.parse(fs.readFileSync(p.spfPath, 'utf8'));
      expect(spf.metadata).toMatchObject({ projectName: 'mediamovel', computerName: 'capture-media', projectPath: raiz, appVersion: req(path.join(RAIZ, 'package.json')).version });
      expect(spf.structure.processors[0]).toEqual({
        name: 'mediamovel', cmmFile: p.cmmPath,
        softwarePath: path.join(raiz, 'mediamovel', 'Software'), hardwarePath: path.join(raiz, 'mediamovel', 'Hardware'),
      });
      expect(spf.structure).toMatchObject({ topLevelFile: p.topPath, testbenchFile: p.tbPath });
      const cmm = fs.readFileSync(p.cmmPath, 'utf8');
      expect(cmm.startsWith('// Media movel de 4 amostras:')).toBe(true);
      expect(fs.readFileSync(p.topPath, 'utf8')).toContain('module top_mediamovel (');
      expect(fs.readFileSync(p.tbPath, 'utf8')).toContain('module tb_mediamovel;');
    } finally {
      fs.rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('sem a aba do terminal e sem o arquivo na arvore, avisa e fotografa assim mesmo', async () => {
    mundo.quebrados.add('.tab[data-terminal="tcmd"]');
    mundo.arvoreSem.add('mediamovel.cmm');
    mundo.janelaPrincipalDemora = 2;
    mundo.janelaNativa.isMaximized = () => false;
    await rodar(['hero']);
    expect(todoAviso()).toContain('capture-media: terminal tab not found; capturing without it.');
    expect(todoAviso()).toContain('capture-media: could not open mediamovel.cmm in the tree; capturing anyway.');
    expect(mundo.janelaNativa.unmaximize).not.toHaveBeenCalled();
    expect(gestos('foto')).toEqual([['hero.png']]);
  });

  it('a janela principal que nunca aparece derruba a captura com a mensagem', async () => {
    mundo.janelaPrincipalDemora = Infinity;
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    process.argv = [argvOriginal[0], SCRIPT];
    chamar.rodar();
    for (let i = 0; i < 50 && !exit.mock.calls.length; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(erros.join('\n')).toContain('capture-media: Error: Main window (index.html) did not appear.');
    expect(exit).toHaveBeenCalledWith(1);
    expect(mundo.fechou).toBe(true);
  });
});

describe('os GIFs', () => {
  it('split-editor: divide e leva o segundo arquivo; o GIF sai pelo ffmpeg e os quadros vao embora', async () => {
    await rodar(['split-editor']);
    expect(gestos('clique')).toContainEqual(['#split-editor-float-btn']);
    expect(gestos('abrir').map((g) => g[1])).toEqual(['mediamovel.cmm', 'top_mediamovel.v']);
    const [args] = mundo.montagens;
    expect(args.slice(0, 2)).toEqual(['-y', '-framerate']);
    expect(args[4]).toMatch(/aurora-gif-split-editor-.*q-%04d\.png$/);
    expect(args[6]).toBe('scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none');
    expect(args[7]).toBe(path.join(MEDIA, 'split-editor.gif'));
    expect(log).toContain('capture-media: split-editor.gif escrito (1 quadros, 0.1 s, 300 KB)');
    expect(fs.existsSync(path.dirname(args[4]))).toBe(false);
    expect(gestos('foto')).not.toContainEqual(['hero.png']);
  });

  it('compile: clica o botao do C+- e grava menor e mais devagar', async () => {
    await rodar(['compile']);
    expect(gestos('clique')).toContainEqual(['#cmmcomp']);
    const [args] = mundo.montagens;
    expect(args[6]).toMatch(/^scale=800:/);
    expect(Number(args[2])).toBeGreaterThanOrEqual(1);
    expect(Number(args[2])).toBeLessThanOrEqual(30);
  });

  it('botoes que nao existem viram aviso, e a gravacao segue', async () => {
    mundo.quebrados = new Set(['#split-editor-float-btn', '#cmmcomp']);
    await rodar(['split-editor', 'compile']);
    expect(todoAviso()).toContain('capture-media: botao de dividir nao encontrado.');
    expect(todoAviso()).toContain('capture-media: botao de compilar C+- nao encontrado.');
    expect(mundo.montagens).toHaveLength(2);
  });

  it('sem ffmpeg (ou com ele quebrando ao sondar), os quadros ficam e o comando sai pronto para colar', async () => {
    for (const estado of [false, 'lanca']) {
      mundo = mundoPadrao();
      mundo.ffmpeg = estado;
      avisos = [];
      await rodar(['compile']);
      const s = todoAviso();
      expect(s).toContain('capture-media: ffmpeg nao esta no PATH, entao compile.gif nao foi montado.');
      const dir = s.match(/Os 1 quadros ficaram em: (.*)/)[1];
      expect(fs.existsSync(dir)).toBe(true);
      expect(s).toMatch(/Para montar depois: {2}ffmpeg -y -framerate \d+\.\d\d -i ".*q-%04d\.png" -vf "scale=800:-1:flags=lanczos,split\[a\]\[b\];/);
      expect(s).toContain(`compile.gif`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('o ffmpeg que falha deixa os quadros e mostra o fim do erro', async () => {
    mundo.ffmpegStatus = 1;
    await rodar(['compile']);
    expect(erros[0]).toMatch(/^capture-media: ffmpeg falhou ao montar compile\.gif; os quadros ficaram em (.*)$/);
    expect(erros[1]).toBe('l1\nl2\nerro do ffmpeg');
    fs.rmSync(erros[0].split('ficaram em ')[1], { recursive: true, force: true });
  });

  it('a conferencia pelo ffprobe: duracao que nao bate, quadros perdidos, e GIF pesado', async () => {
    mundo.ffprobe = 'nb_read_frames=0\nduration=9.5\n';
    mundo.tamanhoKb = 3000;
    await rodar(['compile']);
    const s = todoAviso();
    expect(s).toMatch(/capture-media: compile\.gif dura 9\.5 s, mas a gravacao levou \d+\.\d s\./);
    expect(s).toContain('capture-media: o ffmpeg gravou 0 dos 1 quadros capturados.');
    const dir = s.match(/Os quadros ficaram para exame em: (.*)/)[1];
    expect(fs.existsSync(dir)).toBe(true);
    expect(s).toContain('capture-media: compile.gif esta pesado para um README (3000 KB).');
    expect(s).toContain('Encolha a tomada: menos segundos, menos quadros por segundo, ou menos largura.');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sem ffprobe, ou com saida que nao se le, o resumo conta o que foi capturado', async () => {
    for (const ffprobe of [null, 'lanca', 'lixo']) {
      mundo = mundoPadrao();
      mundo.ffprobe = ffprobe;
      log = [];
      await rodar(['compile']);
      expect(log).toContain('capture-media: compile.gif escrito (1 quadros capturados, 300 KB)');
    }
  });

  it('a janela que fecha no meio da gravacao: vale o que ja foi capturado', async () => {
    mundo.screenshotLanca = true;
    await rodar(['compile']);
    expect(mundo.montagens).toHaveLength(1);
  });

  it('sem tempo para nenhum quadro, avisa e nao monta nada', async () => {
    const { gravarGif } = chamar.modulo();
    expect(await gravarGif(mundo.principal, 'vazio', { segundos: 0 })).toBe(null);
    expect(todoAviso()).toContain('capture-media: nenhum quadro capturado para vazio.');
    expect(spawnFalso).not.toHaveBeenCalled();
  });

  it('temFfmpeg responde pela sonda', () => {
    const { temFfmpeg } = chamar.modulo();
    expect(temFfmpeg()).toBe(true);
    mundo.ffmpeg = false;
    expect(temFfmpeg()).toBe(false);
  });
});

describe('o PRISM', () => {
  it('sintetiza, abre o PRISM, ajusta e passeia pelo esquematico', async () => {
    await rodar(['prism']);
    expect(gestos('clique').map((g) => g[0])).toEqual(['.tab[data-terminal="tcmd"]', '#vericomp', '#prismcomp']);
    const noPrism = mundo.prism.gestos;
    expect(noPrism.filter((g) => g[0] === 'clique').map((g) => g[1])).toEqual(['#fitBtn', '#fitBtn']);
    expect(noPrism.filter((g) => g[0] === 'roda')).toEqual([['roda', -400]]);
    expect(noPrism.filter((g) => g[0] === 'mover')).toHaveLength(11);
    expect(noPrism.some((g) => g[0] === 'aperta') && noPrism.some((g) => g[0] === 'solta')).toBe(true);
    expect(mundo.montagens[0][7]).toBe(path.join(MEDIA, 'prism.gif'));
  });

  it('sem os botoes, avisa e segue', async () => {
    mundo.quebrados = new Set(['#vericomp', '#fitBtn']);
    await rodar(['prism']);
    expect(todoAviso()).toContain('capture-media: botao de sintetizar nao encontrado.');
    expect(todoAviso()).toContain('capture-media: botao de ajustar do PRISM nao encontrado.');
  });

  it('a janela que nunca abre: quatro tentativas, e o aviso de olhar o TVERI', async () => {
    mundo.prismAbreNo = 0;
    mundo.quebrados.add('#prismcomp');
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    process.argv = [argvOriginal[0], SCRIPT, 'prism'];
    chamar.rodar();
    for (let i = 0; i < 200 && !mundo.fechou; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(gestos('clique').filter((g) => g[0] === '#prismcomp')).toHaveLength(4);
    expect(todoAviso()).toContain('capture-media: a janela do PRISM nao apareceu; prism.gif nao foi gravado.');
    expect(todoAviso()).toContain('Olhe o terminal TVERI da janela: a sintese pode ter falhado antes.');
    expect(spawnFalso).not.toHaveBeenCalled();
  });
});

describe('carregado como modulo', () => {
  it('entrega as quatro funcoes e nao abre nada', () => {
    const mod = chamar.modulo();
    expect(Object.keys(mod).sort()).toEqual(['gravarGif', 'temFfmpeg', 'tomadasPedidas', 'writeProject']);
    expect(mundo.lancamentos).toEqual([]);
  });
});
