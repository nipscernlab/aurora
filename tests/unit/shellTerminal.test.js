// @vitest-environment happy-dom
//
// O terminal real da aba TCMD (js/terminal/shell_terminal): liga o xterm ao PTY
// do processo principal. O que se confere aqui e a cola: em que pasta o shell
// nasce, o que vai para o PTY, o que a ferramenta run_in_terminal da IA recebe
// de volta, copiar e colar, e os caminhos clicaveis. O xterm e a ponte sao
// simulados; o comportamento na tela esta no E2E (tests/e2e, shell-terminal).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── xterm simulado ──────────────────────────────────────────────────────────
class FakeTerminal {
  constructor(opts) {
    this.opts = opts;
    this.addons = [];
    this.escrito = [];
    this.cols = 100;
    this.rows = 30;
    this.selecao = '';
    this.linhas = [];
    this.buffer = { active: { getLine: (i) => (this.linhas[i] === undefined ? undefined : { translateToString: () => this.linhas[i] }) } };
    FakeTerminal.ultimo = this;
  }
  loadAddon(a) { this.addons.push(a); }
  open(el) { this.montado = el; }
  onData(cb) { this.aoDigitar = cb; }
  onResize(cb) { this.aoRedimensionar = cb; }
  write(s) { this.escrito.push(s); }
  focus() { this.focado = true; }
  clear() { this.limpo = (this.limpo || 0) + 1; }
  dispose() { this.descartado = true; }
  getSelection() { return this.selecao; }
  clearSelection() { this.selecao = ''; }
  attachCustomKeyEventHandler(fn) { this.teclas = fn; }
  registerLinkProvider(p) { this.links = p; }
}
vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() { FitCount.n += 1; } } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class { constructor(cb) { this.cb = cb; } } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
const FitCount = { n: 0 };

// ── ponte simulada ──────────────────────────────────────────────────────────
const ouvintesDados = new Set();
const ouvintesFim = new Set();
const electronAPI = {
  shellStart: vi.fn(async () => ({ ok: true })),
  shellInput: vi.fn(),
  shellResize: vi.fn(),
  shellKill: vi.fn(),
  openExternal: vi.fn(),
  fileExists: vi.fn(async () => true),
  readFile: vi.fn(async () => 'conteudo'),
  onShellData: vi.fn((fn) => { ouvintesDados.add(fn); return () => ouvintesDados.delete(fn); }),
  onShellExit: vi.fn((fn) => { ouvintesFim.add(fn); return () => ouvintesFim.delete(fn); }),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

const dados = (id, data) => [...ouvintesDados].forEach((fn) => fn({ id, data }));
const fim = (id, code) => [...ouvintesFim].forEach((fn) => fn({ id, code }));
const esperar = () => new Promise((r) => setTimeout(r, 0));

let st;
let ProjectStore;

function montarDom({ oculto = true } = {}) {
  document.body.innerHTML = `
    <div class="tab" data-terminal="tcmd"></div>
    <div id="terminal-tcmd" class="${oculto ? 'hidden' : ''}"><div class="tcmd-xterm"></div></div>`;
}

async function carregar(opts) {
  vi.resetModules();
  montarDom(opts);
  ({ ProjectStore } = await import('../../js/project/project_store.ts'));
  await import('../../js/terminal/shell_terminal.js');
  return window.shellTerminal;
}

beforeEach(async () => {
  vi.clearAllMocks();
  ouvintesDados.clear();
  ouvintesFim.clear();
  FitCount.n = 0;
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() {} disconnect() { this.desligado = true; } };
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
  electronAPI.shellStart.mockImplementation(async () => ({ ok: true }));
  st = await carregar();
});

afterEach(() => {
  vi.useRealTimers();
  ProjectStore?.clearProject();
  delete window.TabManager;
});

describe('inicio do shell', () => {
  it('nasce na pasta do projeto aberto, com o tamanho do terminal', async () => {
    ProjectStore.setProject('C:/p/proj.spf', 'C:/p');
    document.querySelector('.tab[data-terminal="tcmd"]').click();
    await esperar();
    expect(electronAPI.shellStart).toHaveBeenCalledWith({ id: 'tcmd', cwd: 'C:/p', cols: 100, rows: 30 });
    expect(FakeTerminal.ultimo.focado).toBe(true);
    expect(FakeTerminal.ultimo.montado).toBe(document.querySelector('.tcmd-xterm'));
  });

  it('a pasta vem do ProjectStore, nao de uma global que alguem sobrescreveu', async () => {
    ProjectStore.setProject('C:/p/proj.spf', 'C:/p');
    window.currentProjectPath = 'C:/outra-janela';
    await st._onActivate();
    expect(electronAPI.shellStart.mock.calls[0][0].cwd).toBe('C:/p');
  });

  it('sem projeto, o shell nasce na pasta padrao do processo', async () => {
    await st._onActivate();
    expect(electronAPI.shellStart.mock.calls[0][0].cwd).toBeUndefined();
  });

  it('o clique e a primeira tecla esperam o mesmo inicio', async () => {
    await Promise.all([st._onActivate(), st._send('a')]);
    expect(electronAPI.shellStart).toHaveBeenCalledOnce();
    expect(electronAPI.shellInput).toHaveBeenCalledWith('tcmd', 'a');
  });

  it('se o shell nao sobe, escreve o motivo e tenta de novo na proxima vez', async () => {
    electronAPI.shellStart.mockResolvedValueOnce({ ok: false, error: 'sem pwsh' });
    await st._onActivate();
    expect(FakeTerminal.ultimo.escrito.join('')).toContain('sem pwsh');
    await st._send('x');
    expect(electronAPI.shellStart).toHaveBeenCalledTimes(2);
    expect(electronAPI.shellInput).toHaveBeenCalledWith('tcmd', 'x');
  });

  it('se o inicio lanca, escreve o erro e nao manda nada ao PTY', async () => {
    electronAPI.shellStart.mockRejectedValueOnce(new Error('ipc caiu'));
    st._ensureTerm();
    await st._send('x');
    expect(FakeTerminal.ultimo.escrito.join('')).toContain('ipc caiu');
    expect(electronAPI.shellInput).not.toHaveBeenCalled();
  });

  it('com a aba ja visivel no carregamento, abre sozinho', async () => {
    await carregar({ oculto: false });
    await esperar();
    expect(electronAPI.shellStart).toHaveBeenCalledOnce();
  });

  it('sem o painel no DOM, nao faz nada', async () => {
    vi.resetModules();
    document.body.innerHTML = '';
    await import('../../js/terminal/shell_terminal.js');
    window.shellTerminal.init();
    expect(electronAPI.shellStart).not.toHaveBeenCalled();
  });
});

describe('fluxo com o PTY', () => {
  it('o que o PTY manda para esta sessao vai para a tela, o das outras nao', async () => {
    await st._onActivate();
    dados('outra', 'nao');
    dados('tcmd', 'sim');
    expect(FakeTerminal.ultimo.escrito).toEqual(['sim']);
  });

  it('tecla e redimensionamento vao ao PTY', async () => {
    await st._onActivate();
    FakeTerminal.ultimo.aoDigitar('ls');
    await esperar();
    expect(electronAPI.shellInput).toHaveBeenCalledWith('tcmd', 'ls');
    FakeTerminal.ultimo.aoRedimensionar({ cols: 90, rows: 20 });
    expect(electronAPI.shellResize).toHaveBeenCalledWith('tcmd', 90, 20);
  });

  it('quando o shell termina, avisa e a proxima ativacao abre outro', async () => {
    await st._onActivate();
    fim('outra', 1);
    fim('tcmd', 3);
    expect(FakeTerminal.ultimo.escrito.join('')).toContain('código 3');
    fim('tcmd', undefined);
    expect(FakeTerminal.ultimo.escrito.join('')).toContain('código 0');
    await st._onActivate();
    expect(electronAPI.shellStart).toHaveBeenCalledTimes(2);
  });

  it('o tema vem das variaveis de CSS, com padrao quando faltam', () => {
    document.documentElement.style.setProperty('--bg', '#123456');
    const tema = st._theme();
    expect(tema.background).toBe('#123456');
    expect(tema.foreground).toBe('#E8ECF3');
    document.documentElement.style.removeProperty('--bg');
  });

  it('o ajuste de tamanho que falha antes do layout nao derruba nada', () => {
    st._ensureTerm();
    st.fit.fit = () => { throw new Error('sem layout'); };
    expect(() => st._fit()).not.toThrow();
  });

  it('o link http abre no navegador', () => {
    st._ensureTerm();
    const web = FakeTerminal.ultimo.addons.find((a) => a.cb);
    web.cb(null, 'https://nipscern.com');
    expect(electronAPI.openExternal).toHaveBeenCalledWith('https://nipscern.com');
  });
});

describe('abrir o terminal numa pasta', () => {
  it('manda cd com as aspas do caminho dobradas', async () => {
    await st.openAt('C:\\a "b"');
    expect(electronAPI.shellInput).toHaveBeenCalledWith('tcmd', 'cd "C:\\a ""b"""\r');
  });

  it('sem pasta, ou com o shell que nao sobe, nao manda nada', async () => {
    await st.openAt('');
    electronAPI.shellStart.mockResolvedValueOnce({ ok: false });
    await st.openAt('C:\\a');
    expect(electronAPI.shellInput).not.toHaveBeenCalled();
  });
});

describe('run_in_terminal da IA', () => {
  it('comando vazio e recusado', async () => {
    expect(await st.runCommand('  ')).toEqual({ ok: false, error: 'empty command' });
    expect(await st.runCommand(undefined)).toEqual({ ok: false, error: 'empty command' });
  });

  it('shell que nao sobe e erro', async () => {
    electronAPI.shellStart.mockResolvedValueOnce({ ok: false });
    expect(await st.runCommand('dir')).toEqual({ ok: false, error: 'shell could not start' });
  });

  it('sem executar, so digita o comando, sem Enter', async () => {
    expect(await st.runCommand('dir', { execute: false })).toEqual({ ok: true, executed: false, command: 'dir' });
    expect(electronAPI.shellInput).toHaveBeenCalledWith('tcmd', 'dir');
  });

  it('executando, devolve a saida sem ANSI quando o shell fica quieto', async () => {
    const p = st.runCommand('dir', { idleMs: 5, maxMs: 1000 });
    await vi.waitFor(() => expect(electronAPI.shellInput).toHaveBeenCalledWith('tcmd', 'dir\r'));
    dados('outra', 'ignorar');
    dados('tcmd', '\x1b]0;titulo\x07\x1b[32mok\x1b[0m\x01\n');
    dados('tcmd', 'fim');
    expect(await p).toEqual({ ok: true, executed: true, complete: true, command: 'dir', output: 'ok\nfim' });
    expect(ouvintesDados.size).toBe(1); // so o da tela sobra
  });

  it('se o shell nao para de falar, corta no limite e diz que esta incompleto', async () => {
    const p = st.runCommand('ping -t x', { idleMs: 1000, maxMs: 5 });
    await vi.waitFor(() => expect(electronAPI.shellInput).toHaveBeenCalled());
    const r = await p;
    expect(r).toMatchObject({ ok: true, executed: true, complete: false, output: '' });
  });
});

describe('copiar e colar', () => {
  const tecla = (key, extra = {}) => ({ type: 'keydown', key, ctrlKey: true, altKey: false, preventDefault: vi.fn(), ...extra });

  beforeEach(() => {
    navigator.clipboard.writeText = vi.fn(async () => {});
    navigator.clipboard.readText = vi.fn(async () => 'colado');
    st._ensureTerm();
  });

  it('Ctrl+C com selecao copia; sem selecao deixa o ^C ir ao shell', () => {
    const t = FakeTerminal.ultimo;
    t.selecao = 'texto';
    const e = tecla('c');
    expect(t.teclas(e)).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('texto');
    t.selecao = '';
    expect(t.teclas(tecla('C'))).toBe(true);
  });

  it('Ctrl+V cola uma vez so; outras teclas e o keyup passam', async () => {
    const t = FakeTerminal.ultimo;
    const e = tecla('V');
    expect(t.teclas(e)).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(electronAPI.shellInput).toHaveBeenCalledWith('tcmd', 'colado'));
    expect(t.teclas(tecla('a'))).toBe(true);
    expect(t.teclas({ type: 'keyup', key: 'v', ctrlKey: true })).toBe(true);
  });

  it('botao direito copia a selecao, ou cola quando nao ha selecao', async () => {
    const t = FakeTerminal.ultimo;
    const mount = document.querySelector('.tcmd-xterm');
    t.selecao = 'sel';
    mount.dispatchEvent(new Event('contextmenu'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sel');
    expect(t.selecao).toBe('');
    mount.dispatchEvent(new Event('contextmenu'));
    await vi.waitFor(() => expect(electronAPI.shellInput).toHaveBeenCalledWith('tcmd', 'colado'));
  });

  it('area de transferencia negada ou vazia nao manda nada', async () => {
    navigator.clipboard.readText = vi.fn(async () => { throw new Error('negado'); });
    await st._paste();
    navigator.clipboard.readText = vi.fn(async () => '');
    await st._paste();
    expect(electronAPI.shellInput).not.toHaveBeenCalled();
  });
});

describe('caminhos clicaveis', () => {
  beforeEach(() => st._ensureTerm());

  it('acha caminhos do Windows na linha, sem a pontuacao do fim', () => {
    const t = FakeTerminal.ultimo;
    t.linhas = ['erro em C:\\p\\a.v, e \\\\srv\\x\\b.txt. e C:\\ fim'];
    let achados;
    t.links.provideLinks(1, (l) => { achados = l; });
    expect(achados.map((l) => l.text)).toEqual(['C:\\p\\a.v', '\\\\srv\\x\\b.txt']);
    expect(achados[0].range).toEqual({ start: { x: 9, y: 1 }, end: { x: 16, y: 1 } });
  });

  it('linha sem caminho, ou que nao existe, nao da link', () => {
    const t = FakeTerminal.ultimo;
    t.linhas = ['nada aqui'];
    const cb = vi.fn();
    t.links.provideLinks(1, cb);
    t.links.provideLinks(5, cb);
    expect(cb.mock.calls).toEqual([[undefined], [undefined]]);
  });

  it('arquivo de texto abre numa aba; o resto abre com o programa do sistema', async () => {
    window.TabManager = { addTab: vi.fn() };
    await st._openPath('C:\\p\\a.v');
    expect(window.TabManager.addTab).toHaveBeenCalledWith('C:\\p\\a.v', 'conteudo');
    await st._openPath('C:\\p\\grafico.html');
    expect(electronAPI.openExternal).toHaveBeenCalledWith('file:///C:/p/grafico.html');
  });

  it('o activate do link abre o caminho', async () => {
    window.TabManager = { addTab: vi.fn() };
    const t = FakeTerminal.ultimo;
    t.linhas = ['C:\\p\\a.v'];
    let achados;
    t.links.provideLinks(1, (l) => { achados = l; });
    achados[0].activate();
    await vi.waitFor(() => expect(window.TabManager.addTab).toHaveBeenCalled());
  });

  it('caminho que nao existe, leitura que nao e texto ou que falha: nada acontece', async () => {
    window.TabManager = { addTab: vi.fn() };
    electronAPI.fileExists.mockResolvedValueOnce(false);
    await st._openPath('C:\\p\\a.v');
    electronAPI.readFile.mockResolvedValueOnce(null);
    await st._openPath('C:\\p\\a.v');
    electronAPI.readFile.mockRejectedValueOnce(new Error('x'));
    await st._openPath('C:\\p\\a.v');
    expect(window.TabManager.addTab).not.toHaveBeenCalled();
    expect(electronAPI.openExternal).not.toHaveBeenCalled();
  });
});

describe('limpar e descartar', () => {
  it('clear so limpa a tela; limpar tambem manda cls ao shell', async () => {
    st.clear();
    st._ensureTerm();
    st.clear();
    expect(FakeTerminal.ultimo.limpo).toBe(1);
    st.limpar();
    await vi.waitFor(() => expect(electronAPI.shellInput).toHaveBeenCalledWith('tcmd', 'cls\r'));
    expect(FakeTerminal.ultimo.limpo).toBe(2);
  });

  it('dispose solta os ouvintes, o observador, o PTY e o xterm', () => {
    st._ensureTerm();
    const ro = st._ro;
    st.dispose();
    expect(ouvintesDados.size).toBe(0);
    expect(ouvintesFim.size).toBe(0);
    expect(ro.desligado).toBe(true);
    expect(electronAPI.shellKill).toHaveBeenCalledWith('tcmd');
    expect(FakeTerminal.ultimo.descartado).toBe(true);
  });

  it('dispose sem terminal criado, e com o kill que falha, nao lanca', () => {
    electronAPI.shellKill.mockImplementationOnce(() => { throw new Error('x'); });
    expect(() => st.dispose()).not.toThrow();
  });
});
