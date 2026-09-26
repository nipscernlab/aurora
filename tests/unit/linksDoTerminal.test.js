// @vitest-environment happy-dom
/**
 * Os links que o terminal poe na saida das ferramentas: o `arquivo:linha` que
 * abre o editor na linha, o "Abrir Componentes" e o "Abrir o manual". Tres
 * passos: reconhecer (texto -> HTML com os links), ligar o clique, e levar o
 * editor ate a linha. O reconhecimento em si mora no error_locations, que tem
 * teste proprio; aqui se confere o que o terminal faz com ele.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// O tab_manager se inicializa ao carregar e pede a ponte ali mesmo, entao a
// ponte tem de existir antes dos imports (ver problemaChegaAoPainel.test.js).
vi.hoisted(() => {
  globalThis.window = globalThis.window || {};
  globalThis.window.electronAPI = new Proxy({}, { get: () => () => {} });
});

const TabManager = vi.hoisted(() => ({ tabs: new Map(), addTab: vi.fn(), activateTab: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));
const EditorManager = vi.hoisted(() => ({ activeEditor: null }));
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager }));
const abrirAjudaDe = vi.hoisted(() => vi.fn());
vi.mock('../../js/ui/help_link.js', async (orig) => ({ ...(await orig()), abrirAjudaDe }));

import { TerminalManager } from '../../js/terminal/terminal_module.js';
import { problemStore } from '../../js/terminal/problem_store.js';
import { ProjectStore } from '../../js/project/project_store.js';

let tm;
let api;

function montarDOM() {
  document.body.innerHTML = `
    <div class="terminal-container">
      <div class="terminal-tabs"><div class="terminal-tabs-list"></div></div>
      ${['tcmm', 'tasm', 'tveri', 'twave', 'thtest', 'tprism', 'tcmd']
        .map((id) => `<div id="terminal-${id}"><div class="terminal-body"></div></div>`)
        .join('')}
    </div>`;
}

/** Um bloco com o HTML dado, ligado aos cliques, dentro de um terminal. */
function bloco(html, { dentroDe } = {}) {
  const div = document.createElement('div');
  div.innerHTML = html;
  (dentroDe || document.body).appendChild(div);
  tm._attachLineLinkClicks(div);
  return div;
}

function editorFalso(linhas = ['a', 'bb', 'ccc']) {
  const model = {
    getLineCount: () => linhas.length,
    getLineMaxColumn: (n) => linhas[n - 1].length + 1,
  };
  return {
    getModel: () => model,
    setPosition: vi.fn(),
    revealLineInCenter: vi.fn(),
    focus: vi.fn(),
    setSelection: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  montarDOM();
  problemStore.limpar();
  TabManager.tabs = new Map();
  EditorManager.activeEditor = null;
  api = {
    fileExists: vi.fn(async () => true),
    readFile: vi.fn(async () => 'fonte'),
    joinPath: vi.fn(async (...p) => p.join('\\')),
  };
  // O resto da ponte (o construtor pede os ouvintes de log) responde vazio.
  window.electronAPI = new Proxy(api, { get: (alvo, k) => (k in alvo ? alvo[k] : () => {}) });
  delete window.compilationManager;
  delete window._latestCompilationModule;
  delete window.t;
  tm = new TerminalManager();
  tm.goToLine = vi.fn();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  ProjectStore.clearProject();
  vi.restoreAllMocks();
});

describe('reconhecer: texto da ferramenta vira HTML com links', () => {
  it('arquivo:linha:coluna vira link com os dados do destino, e o resto sai escapado', () => {
    const html = tm.makeLineNumbersClickable('C:/p/top.v:5: error: <b>nome</b>');
    expect(html).toContain('class="line-link"');
    expect(html).toContain('data-line="5"');
    expect(html).toContain('data-file="C:/p/top.v"');
    expect(html).toContain('&lt;b&gt;');
  });

  it('a mesma linha vai para o painel de problemas, com o .cmm da ultima compilacao', () => {
    window.compilationManager = { lastCompiledCmmPath: 'C:/p/Software/a.cmm' };
    tm.makeLineNumbersClickable('Erro na linha 3: falta ponto e virgula');
    expect(problemStore.listar()[0].arquivo).toBe('C:/p/Software/a.cmm');
  });

  it('o .cmm pode vir do ultimo CompilationModule', () => {
    window._latestCompilationModule = { lastCompiledCmmPath: 'C:/p/Software/b.cmm' };
    tm.makeLineNumbersClickable('Erro na linha 3: x');
    expect(problemStore.listar()[0].arquivo).toBe('C:/p/Software/b.cmm');
  });

  it('se o painel de problemas falhar, a linha sai do mesmo jeito', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(problemStore, 'registrarLinha').mockImplementation(() => { throw new Error('x'); });
    expect(tm.makeLineNumbersClickable('texto')).toBe('texto');
    expect(aviso).toHaveBeenCalled();
  });

  it('componente ausente ganha o botao de abrir Componentes, traduzido quando ha traducao', () => {
    expect(tm.makeLineNumbersClickable('O Verilator não está instalado nesta máquina'))
      .toContain('<span class="componente-link" role="button" tabindex="0">Abrir Componentes</span>');
    window.t = (k) => (k === 'terminal.openComponents' ? 'Open Components' : k);
    expect(tm.makeLineNumbersClickable('Verilator is not installed on this machine'))
      .toContain('>Open Components</span>');
  });

  it('o marcador [[ajuda:chave]] sai do texto e vira o botao do manual', () => {
    const html = tm.makeLineNumbersClickable('Erro de onda [[ajuda:waveConfigHelp]]');
    expect(html).not.toContain('[[ajuda');
    expect(html).toContain('data-ajuda="waveConfigHelp"');
    expect(html).toContain('>Abrir o manual</span>');
    window.t = (k) => (k === 'terminal.openManual' ? 'Open the manual' : k);
    expect(tm.makeLineNumbersClickable('x [[ajuda:waveConfigHelp]]')).toContain('>Open the manual</span>');
  });

  it('chave de ajuda que nao existe some sem botao', () => {
    const html = tm.makeLineNumbersClickable('Erro [[ajuda:naoExiste]]');
    expect(html).toBe('Erro');
  });
});

describe('ligar o clique', () => {
  it('sem bloco, nao faz nada', () => {
    expect(() => tm._attachLineLinkClicks(null)).not.toThrow();
  });

  it('Abrir Componentes abre as configuracoes na aba de componentes', () => {
    window.auroraAbrirConfiguracoes = vi.fn();
    bloco('<span class="componente-link">x</span>').querySelector('span').click();
    expect(window.auroraAbrirConfiguracoes).toHaveBeenCalledWith('componentes');
    delete window.auroraAbrirConfiguracoes;
  });

  it('Abrir o manual abre o capitulo da chave', () => {
    bloco('<span class="manual-link" data-ajuda="gitHelp">x</span>').querySelector('span').click();
    expect(abrirAjudaDe).toHaveBeenCalledWith('gitHelp');
  });

  it('arquivo relativo e resolvido contra a pasta do projeto, e abre numa aba nova', async () => {
    vi.useFakeTimers();
    ProjectStore.setProject('C:/p/p.spf', 'C:\\p');
    bloco('<span class="line-link" data-line="7" data-col="3" data-file="/Hardware/top.v">x</span>')
      .querySelector('span').click();
    await vi.waitFor(() => expect(TabManager.addTab).toHaveBeenCalledWith('C:\\p\\Hardware/top.v', 'fonte'));
    expect(api.readFile).toHaveBeenCalledWith('C:\\p\\Hardware/top.v', { encoding: 'utf8' });
    vi.advanceTimersByTime(100);
    expect(tm.goToLine).toHaveBeenCalledWith(7, 3);
  });

  it('a pasta do projeto vem do ProjectStore, nao de uma global sobrescrita', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:\\p');
    window.currentProjectPath = 'C:\\outra-janela';
    bloco('<span class="line-link" data-line="1" data-file="top.v">x</span>').querySelector('span').click();
    await vi.waitFor(() => expect(api.fileExists).toHaveBeenCalledWith('C:\\p\\top.v'));
  });

  it('sem projeto, o relativo segue como veio; absoluto e UNC seguem sempre', async () => {
    const abrir = async (arquivo) => {
      api.fileExists.mockClear();
      bloco(`<span class="line-link" data-line="1" data-file="${arquivo}">x</span>`).querySelector('span').click();
      await vi.waitFor(() => expect(api.fileExists).toHaveBeenCalled());
      return api.fileExists.mock.calls[0][0];
    };
    expect(await abrir('top.v')).toBe('top.v');
    ProjectStore.setProject('C:/p/p.spf', 'C:\\p');
    expect(await abrir('D:/x/top.v')).toBe('D:/x/top.v');
    expect(await abrir('\\\\srv\\top.v')).toBe('\\\\srv\\top.v');
  });

  it('arquivo ja aberto so ganha foco; sem coluna, o cursor vai para a coluna 1', async () => {
    vi.useFakeTimers();
    TabManager.tabs = new Map([['D:/top.v', {}]]);
    bloco('<span class="line-link" data-line="2" data-file="D:/top.v">x</span>').querySelector('span').click();
    await vi.waitFor(() => expect(TabManager.activateTab).toHaveBeenCalledWith('D:/top.v'));
    expect(TabManager.addTab).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(tm.goToLine).toHaveBeenCalledWith(2, 1);
  });

  it('linha do yanc sem arquivo abre o .cmm da ultima compilacao', async () => {
    window.compilationManager = { lastCompiledCmmPath: 'C:/p/Software/a.cmm' };
    bloco('<span class="line-link" data-line="4">x</span>').querySelector('span').click();
    await vi.waitFor(() => expect(TabManager.addTab).toHaveBeenCalledWith('C:/p/Software/a.cmm', 'fonte'));
  });

  it('ou do ultimo CompilationModule', async () => {
    window._latestCompilationModule = { lastCompiledCmmPath: 'C:/p/Software/b.cmm' };
    bloco('<span class="line-link" data-line="4">x</span>').querySelector('span').click();
    await vi.waitFor(() => expect(TabManager.addTab).toHaveBeenCalledWith('C:/p/Software/b.cmm', 'fonte'));
  });

  it('sem compilacao lembrada, acha o .cmm na linha de comando do cmmcomp mais recente do terminal', async () => {
    const term = document.createElement('div');
    term.className = 'terminal-content';
    term.innerHTML = `
      <div class="log-entry">cmmcomp.exe -i "velho.cmm" -p "C:\\velho"</div>
      <div class="log-entry">cmmcomp.exe -i "novo.cmm" -n "novo" -p "C:\\p\\proc"</div>
      <div class="log-entry">cmmcomp.exe sem os argumentos</div>`;
    document.body.appendChild(term);
    bloco('<span class="line-link" data-line="4">x</span>', { dentroDe: term }).querySelector('span').click();
    await vi.waitFor(() => expect(TabManager.addTab).toHaveBeenCalledWith('C:\\p\\proc\\Software\\novo.cmm', 'fonte'));
  });

  it('sem nenhum jeito de achar o arquivo, ou fora de um terminal, nao abre nada', async () => {
    const term = document.createElement('div');
    term.className = 'terminal-content';
    term.innerHTML = '<div class="log-entry">outra coisa</div>';
    document.body.appendChild(term);
    bloco('<span class="line-link" data-line="4">x</span>', { dentroDe: term }).querySelector('span').click();
    bloco('<span class="line-link" data-line="4">x</span>').querySelector('span').click();
    await new Promise((r) => setTimeout(r, 10));
    expect(api.fileExists).not.toHaveBeenCalled();
  });

  it('arquivo que nao existe nao abre', async () => {
    api.fileExists.mockResolvedValueOnce(false);
    bloco('<span class="line-link" data-line="1" data-file="D:/x.v">x</span>').querySelector('span').click();
    await vi.waitFor(() => expect(api.fileExists).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(TabManager.addTab).not.toHaveBeenCalled();
  });

  it('erro ao abrir fica no console e nao escapa', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.readFile.mockRejectedValueOnce(new Error('disco'));
    bloco('<span class="line-link" data-line="1" data-file="D:/x.v">x</span>').querySelector('span').click();
    await vi.waitFor(() => expect(erro).toHaveBeenCalled());
  });
});

describe('ir para a linha', () => {
  beforeEach(() => { tm = new TerminalManager(); });

  it('sem editor ou sem modelo, so avisa', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    tm.goToLine(1);
    EditorManager.activeEditor = { getModel: () => null };
    tm.goToLine(1);
    expect(aviso).toHaveBeenCalledTimes(2);
  });

  it('seleciona a linha inteira e poe o cursor na coluna', () => {
    const ed = editorFalso();
    EditorManager.activeEditor = ed;
    tm.goToLine(2, 2);
    expect(ed.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 2 });
    expect(ed.revealLineInCenter).toHaveBeenCalledWith(2);
    expect(ed.focus).toHaveBeenCalled();
    expect(ed.setSelection).toHaveBeenCalledWith({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 3 });
  });

  it('linha e coluna fora do arquivo sao trazidas para dentro', () => {
    const ed = editorFalso();
    EditorManager.activeEditor = ed;
    tm.goToLine(99, 50);
    expect(ed.setPosition).toHaveBeenCalledWith({ lineNumber: 3, column: 4 });
    tm.goToLine(-5, 0);
    expect(ed.setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 1 });
    tm.goToLine(1);
    expect(ed.setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 1 });
  });
});
