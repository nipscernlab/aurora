// @vitest-environment happy-dom
//
// A vista de pastas da arvore (js/tree/standard_tree_render): lista a raiz do
// projeto aberto, desce nas pastas abertas, esconde o que o .inv manda, e abre
// arquivos no editor.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const pastas = new Map();
const arquivos = new Map();
const electronAPI = {
  getFolderFiles: vi.fn(async (d) => pastas.get(d) ?? []),
  joinPath: vi.fn(async (...p) => p.join('\\')),
  fileExists: vi.fn(async (p) => arquivos.has(p)),
  readFile: vi.fn(async (p) => { if (!arquivos.has(p)) throw new Error('ENOENT'); return arquivos.get(p); }),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const TabManager = {
  tabs: new Map(), addTab: vi.fn(), activateTab: vi.fn(), promotePreviewToPermanent: vi.fn(),
  getEditingFilePath: vi.fn(() => null),
};
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));
vi.mock('../../js/tree/standard_tree_crud.js', () => ({}));
// O manifesto de icones viria pela rede; aqui ele volta vazio, e os icones
// ficam os padrao.
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));

let r;
let ProjectStore;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const container = () => document.querySelector('#file-tree > .tree-view-standard');
const nomes = () => [...container().querySelectorAll('.file-item-name')].map((e) => e.textContent);
const linha = (p) => container().querySelector(`.file-tree-item[data-path="${window.CSS.escape(p)}"]`);

const e = (path, isDirectory = false) => ({ path, name: path.split('\\').pop(), isDirectory });

beforeAll(async () => {
  document.body.innerHTML = '<div id="scroll" style="overflow-y:auto"><div id="file-tree"></div></div>';
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  ({ standardTreeRenderer: r } = await import('../../js/tree/standard_tree_render.js'));
});

beforeEach(() => {
  vi.clearAllMocks();
  pastas.clear();
  arquivos.clear();
  TabManager.tabs = new Map();
  delete window.SplitEditorManager;
  delete window.fileTreeViewController;
  window.TabManager = TabManager;
  r._expanded.clear();
  ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
  pastas.set('C:\\p', [
    e('C:\\p\\top.v'), e('C:\\p\\sim', true), e('C:\\p\\.inv'), e('C:\\p\\p.spf'),
    e('C:\\p\\projectOriented.json'), e('C:\\p\\Build', true), e('C:\\p\\a.cmm'),
  ]);
  pastas.set('C:\\p\\sim', [e('C:\\p\\sim\\tb.v'), e('C:\\p\\sim\\deep', true)]);
  pastas.set('C:\\p\\sim\\deep', [e('C:\\p\\sim\\deep\\x.v')]);
  pastas.set('C:\\p\\Build', [e('C:\\p\\Build\\o.bin')]);
});

describe('desenhar', () => {
  it('pastas primeiro, depois arquivos, sem o .spf, os ocultos e os legados', async () => {
    await r.render();
    expect(nomes()).toEqual(['Build', 'sim', 'a.cmm', 'top.v']);
    expect(linha('C:\\p\\sim').dataset.isDir).toBe('1');
    expect(linha('C:\\p\\top.v').draggable).toBe(true);
  });

  it('o .inv esconde o que casa, relativo a raiz', async () => {
    arquivos.set('C:\\p\\.inv', 'Build/\n*.cmm\n');
    await r.render();
    expect(nomes()).toEqual(['sim', 'top.v']);
    arquivos.set('C:\\p\\.inv', null);
    electronAPI.readFile.mockRejectedValueOnce(new Error('trancado'));
    await r.render();
    expect(nomes()).toContain('Build');
  });

  it('sem projeto, esvazia; sem o container, nao faz nada', async () => {
    await r.render();
    ProjectStore.clearProject();
    await r.render();
    expect(container().innerHTML).toBe('');
    const tree = document.getElementById('file-tree');
    tree.remove();
    await expect(r.render()).resolves.toBeUndefined();
    document.getElementById('scroll').appendChild(tree);
  });

  it('pedidos durante um desenho viram uma passada extra so', async () => {
    let soltar;
    electronAPI.getFolderFiles.mockImplementationOnce(() => new Promise((res) => { soltar = res; }));
    const primeiro = r.render();
    await flush();
    r.render(); r.render(); r.render();
    soltar(pastas.get('C:\\p'));
    await primeiro;
    await flush();
    // raiz: 1 da primeira + 1 da passada extra
    expect(electronAPI.getFolderFiles.mock.calls.filter(([d]) => d === 'C:\\p')).toHaveLength(2);
  });

  it('o erro no meio do desenho so vai ao console', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    electronAPI.joinPath.mockRejectedValueOnce(new Error('x'));
    electronAPI.getFolderFiles.mockResolvedValueOnce(null);
    await r.render();
    expect(nomes()).toEqual([]);
    const container0 = container();
    const antes = container0.querySelectorAll;
    container0.querySelectorAll = () => { throw new Error('dom'); };
    await r.render();
    container0.querySelectorAll = antes;
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it('avisa a camada de edicao a cada desenho e guarda a rolagem', async () => {
    const aviso = vi.fn();
    document.addEventListener('aurora:standard-tree-rendered', aviso);
    const scroll = document.getElementById('scroll');
    await r.render();
    scroll.scrollTop = 40;
    await r.render();
    document.removeEventListener('aurora:standard-tree-rendered', aviso);
    expect(aviso).toHaveBeenCalledTimes(2);
    expect(scroll.scrollTop).toBe(40);
  });
});

describe('pastas', () => {
  it('clicar abre e le a pasta so na primeira vez; clicar de novo fecha', async () => {
    await r.render();
    linha('C:\\p\\sim').querySelector('.file-item').click();
    await flush();
    expect(r.isExpanded('C:\\p\\sim')).toBe(true);
    expect(r.hasExpanded()).toBe(true);
    expect(nomes()).toContain('tb.v');
    expect(linha('C:\\p\\sim').querySelector('.folder-toggle-icon').classList.contains('collapsed')).toBe(false);
    linha('C:\\p\\sim').querySelector('.file-item').click();
    await flush();
    expect(r.isExpanded('C:\\p\\sim')).toBe(false);
    expect(linha('C:\\p\\sim').querySelector('.folder-content').classList.contains('hidden')).toBe(true);
    const leituras = electronAPI.getFolderFiles.mock.calls.filter(([d]) => d === 'C:\\p\\sim').length;
    linha('C:\\p\\sim').querySelector('.file-item').click();
    await flush();
    expect(electronAPI.getFolderFiles.mock.calls.filter(([d]) => d === 'C:\\p\\sim')).toHaveLength(leituras);
  });

  it('as pastas abertas voltam abertas depois de redesenhar; fechar tudo e abrir tudo', async () => {
    r._expanded.add('C:\\p\\sim');
    r._expanded.add('D:\\outro\\projeto');
    await r.render();
    expect(nomes()).toContain('tb.v');
    expect(r.isExpanded('D:\\outro\\projeto')).toBe(false);
    r.collapseAll();
    expect(r.hasExpanded()).toBe(false);
    expect(container().querySelectorAll('.folder-content.hidden')).toHaveLength(container().querySelectorAll('.folder-content').length);
    await r.expandAll();
    expect(nomes()).toEqual(['Build', 'o.bin', 'sim', 'deep', 'x.v', 'tb.v', 'a.cmm', 'top.v']);
    ProjectStore.clearProject();
    await r.expandAll();
  });

  it('fechar tudo sem container nao quebra', () => {
    const tree = document.getElementById('file-tree');
    tree.remove();
    expect(() => r.collapseAll()).not.toThrow();
    document.getElementById('scroll').appendChild(tree);
  });

  it('revelar uma pasta abre o caminho ate ela, troca para a vista de pastas e pisca', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const troca = vi.fn();
    window.fileTreeViewController = { showStandardMode: troca };
    await r.revealFolder('C:\\p\\sim\\deep');
    expect(troca).toHaveBeenCalled();
    expect(r.isExpanded('C:\\p\\sim')).toBe(true);
    expect(r.isExpanded('C:\\p\\sim\\deep')).toBe(true);
    expect(linha('C:\\p\\sim\\deep').classList.contains('reveal-flash')).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(linha('C:\\p\\sim\\deep').classList.contains('reveal-flash')).toBe(false);
    vi.useRealTimers();
  });

  it('revelar fora do projeto, sem projeto, ou uma pasta que nao existe', async () => {
    await r.revealFolder('D:\\fora');
    await r.revealFolder('');
    await r.revealFolder('C:\\p\\sumiu');
    expect(r.hasExpanded()).toBe(false);
    ProjectStore.clearProject();
    await r.revealFolder('C:\\p\\sim');
  });
});

describe('arquivos', () => {
  it('um clique abre como previa; duplo clique fixa a aba que ja existe, ou abre fixa', async () => {
    arquivos.set('C:\\p\\top.v', 'module top;');
    await r.render();
    linha('C:\\p\\top.v').querySelector('.file-item').click();
    await flush();
    expect(TabManager.addTab).toHaveBeenCalledWith('C:\\p\\top.v', 'module top;', { preview: true });
    TabManager.tabs.set('C:\\p\\top.v', {});
    linha('C:\\p\\top.v').querySelector('.file-item').dispatchEvent(new MouseEvent('dblclick'));
    expect(TabManager.promotePreviewToPermanent).toHaveBeenCalledWith('C:\\p\\top.v');
    expect(TabManager.activateTab).toHaveBeenCalledWith('C:\\p\\top.v');
    TabManager.tabs = new Map();
    linha('C:\\p\\top.v').querySelector('.file-item').dispatchEvent(new MouseEvent('dblclick'));
    await flush();
    expect(TabManager.addTab).toHaveBeenLastCalledWith('C:\\p\\top.v', 'module top;', { preview: false });
  });

  it('com o editor dividido em foco, abre no painel dele; Ctrl e Shift nao abrem', async () => {
    arquivos.set('C:\\p\\top.v', 'x');
    window.SplitEditorManager = { focusedPane: 1, openInFocusedPane: vi.fn(async () => {}) };
    await r.render();
    linha('C:\\p\\top.v').querySelector('.file-item').click();
    await flush();
    expect(window.SplitEditorManager.openInFocusedPane).toHaveBeenCalledWith('C:\\p\\top.v', 'x', { preview: true });
    linha('C:\\p\\top.v').querySelector('.file-item').dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
    linha('C:\\p\\sim').querySelector('.file-item').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    await flush();
    expect(window.SplitEditorManager.openInFocusedPane).toHaveBeenCalledTimes(1);
    expect(r.isExpanded('C:\\p\\sim')).toBe(false);
  });

  it('arquivo que nao se le so vai ao console', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    await r.render();
    linha('C:\\p\\top.v').querySelector('.file-item').click();
    await flush();
    expect(erro).toHaveBeenCalledWith('Error opening file:', expect.any(Error));
    erro.mockRestore();
  });

  it('o arquivo em foco no editor fica destacado, e segue quando o foco muda', async () => {
    await r.render();
    TabManager.getEditingFilePath.mockReturnValue('c:/p/top.v');
    document.dispatchEvent(new Event('aurora:editing-file-changed'));
    expect(linha('C:\\p\\top.v').querySelector('.file-item').classList.contains('editor-focused')).toBe(true);
    TabManager.getEditingFilePath.mockReturnValue(null);
    document.dispatchEvent(new Event('aurora:editing-file-changed'));
    expect(container().querySelector('.editor-focused')).toBeNull();
  });

  it('salvar o .inv redesenha; salvar outro arquivo nao', async () => {
    await r.render();
    const antes = electronAPI.getFolderFiles.mock.calls.length;
    window.dispatchEvent(new CustomEvent('aurora:file-saved', { detail: { path: 'C:\\p\\top.v' } }));
    window.dispatchEvent(new CustomEvent('aurora:file-saved', {}));
    await flush();
    expect(electronAPI.getFolderFiles.mock.calls.length).toBe(antes);
    document.dispatchEvent(new CustomEvent('aurora:file-saved', { detail: { path: 'C:\\p\\.inv' } }));
    await flush();
    expect(electronAPI.getFolderFiles.mock.calls.length).toBeGreaterThan(antes);
  });
});
