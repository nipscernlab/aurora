// O que a API pede ao editor e a arvore (js/api/abas_e_arvore): arquivos
// abertos em qualquer painel, fechar um arquivo em todo lugar, repintar.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const electronAPI = { triggerFileTreeRefresh: vi.fn(async () => {}) };
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const TabManager = { tabs: new Map(), closeTab: vi.fn(async (p) => { TabManager.tabs.delete(p); }) };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));

let m;

beforeEach(async () => {
  vi.clearAllMocks();
  TabManager.tabs = new Map([['C:/p/a.v', {}], ['C:/p/b.v', {}]]);
  globalThis.window = {};
  m = await import('../../js/api/abas_e_arvore.js');
});

function painel(caminhos) {
  const tabs = new Map(caminhos.map((c) => [c, {}]));
  return { tabs, _closeFile: vi.fn(async (p) => { tabs.delete(p); }) };
}

describe('abas e arvore', () => {
  it('arquivos abertos: os dos paineis divididos e os da barra principal, sem repetir', () => {
    window.SplitEditorManager = { panes: [painel(['C:/p/c.v', 'C:/p/a.v']), {}] };
    expect(m.arquivosAbertos()).toEqual(['C:/p/c.v', 'C:/p/a.v', 'C:/p/b.v']);
    delete window.SplitEditorManager;
    TabManager.tabs = undefined;
    expect(m.arquivosAbertos()).toEqual([]);
  });

  it('fechar em todo lugar: na barra e em cada painel que mostra o arquivo', async () => {
    const p1 = painel(['C:/p/a.v']);
    const p2 = painel(['C:/p/z.v']);
    window.SplitEditorManager = { panes: [p1, p2, { tabs: new Map([['C:/p/a.v', {}]]) }] };
    await m.fecharEmTodoLugar('C:/p/a.v');
    expect(TabManager.closeTab).toHaveBeenCalledWith('C:/p/a.v');
    expect(p1._closeFile).toHaveBeenCalledWith('C:/p/a.v');
    expect(p2._closeFile).not.toHaveBeenCalled();
  });

  it('fechar nao para por causa de uma aba que falha, nem sem paineis', async () => {
    TabManager.closeTab.mockRejectedValueOnce(new Error('x'));
    const p = painel(['C:/p/a.v']);
    p._closeFile.mockRejectedValueOnce(new Error('y'));
    window.SplitEditorManager = { panes: [p] };
    await expect(m.fecharEmTodoLugar('C:/p/a.v')).resolves.toBeUndefined();
    delete window.SplitEditorManager;
    await expect(m.fecharEmTodoLugar('C:/p/b.v')).resolves.toBeUndefined();
  });

  it('repintar a arvore e melhor esforco', async () => {
    await m.atualizarArvore();
    expect(electronAPI.triggerFileTreeRefresh).toHaveBeenCalled();
    electronAPI.triggerFileTreeRefresh.mockRejectedValueOnce(new Error('ipc'));
    await expect(m.atualizarArvore()).resolves.toBeUndefined();
  });
});
