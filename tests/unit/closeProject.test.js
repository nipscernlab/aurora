// @vitest-environment happy-dom
//
// Fechar o projeto (js/project/close_project): o botao pergunta; o fluxo avisa
// o main, fecha as abas, limpa a interface, esquece o projeto e o ultimo
// aberto, e reseta a arvore.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const electronAPI = { closeProject: vi.fn(async () => ({ success: true })) };
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const showDialog = vi.fn(async () => 'confirm');
vi.mock('../../js/ui/dialog_manager.js', () => ({ showDialog }));
const TabManager = { tabs: new Map(), closeTab: vi.fn(async (p) => { TabManager.tabs.delete(p); }) };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));
const vazio = vi.fn();
vi.mock('../../js/tree/file_tree_manager.js', () => ({ renderTreeEmptyState: vazio }));

let m;
let ProjectStore;
const $ = (id) => document.getElementById(id);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function montar() {
  document.body.innerHTML = `
    <button id="close-button"></button>
    <div id="file-tree"></div>
    <ul id="processor-list"><li>P</li></ul>
    <span id="current-spf-name">p.spf</span><span id="project-title">p</span>
    <div id="ready" class="is-ready" data-tooltip="C:\\p\\p.spf"><i class="ph ph-plugs-connected"></i><span id="status-text">p</span></div>
    <button class="project-action-button" disabled></button>`;
}

beforeAll(async () => {
  montar();
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  await import('../../js/tree/tree_view.js');
  m = await import('../../js/project/close_project.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
});

beforeEach(() => {
  vi.clearAllMocks();
  electronAPI.closeProject.mockResolvedValue({ success: true });
  showDialog.mockResolvedValue('confirm');
  TabManager.tabs = new Map([['C:\\p\\a.v', {}], ['C:\\p\\b.v', {}]]);
  window.renderTreeEmptyState = vazio;
  window.appInitializer = { clearLastProject: vi.fn() };
  window.projectTreeManager = { reset: vi.fn() };
  window.SplitEditorManager = { refreshLayout: vi.fn() };
  ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
});

describe('fecharProjetoAberto', () => {
  it('fecha: abas, interface, projeto, ultimo aberto, arvore e layout', async () => {
    montar();
    expect(await m.fecharProjetoAberto()).toBe(true);
    expect(TabManager.closeTab.mock.calls.map(([p]) => p)).toEqual(['C:\\p\\a.v', 'C:\\p\\b.v']);
    expect(ProjectStore.hasProject()).toBe(false);
    expect(window.appInitializer.clearLastProject).toHaveBeenCalled();
    expect(window.projectTreeManager.reset).toHaveBeenCalled();
    expect(window.SplitEditorManager.refreshLayout).toHaveBeenCalled();
    expect(vazio).toHaveBeenCalled();
    expect($('processor-list').innerHTML).toBe('');
    expect($('current-spf-name').getAttribute('data-i18n')).toBe('fileTree.noProject');
    expect($('current-spf-name').textContent).toBe('No project open');
    expect(document.querySelector('.project-action-button').disabled).toBe(false);
  });

  it('o indicador da barra volta a "sem projeto" quando a transicao termina', async () => {
    montar();
    await m.fecharProjetoAberto();
    const ready = $('ready');
    expect(ready.classList.contains('fading')).toBe(true);
    expect(ready.style.cursor).toBe('pointer');
    ready.dispatchEvent(new Event('transitionend'));
    expect(ready.classList.contains('is-ready')).toBe(false);
    expect(ready.classList.contains('fading')).toBe(false);
    expect(ready.querySelector('i').classList.contains('ph-plugs')).toBe(true);
    expect($('status-text').textContent).toBe('No project');
    expect($('status-text').getAttribute('data-i18n')).toBe('statusBar.notReady');
    expect(ready.hasAttribute('data-tooltip')).toBe(false);
  });

  it('com traducao, os rotulos saem traduzidos; sem os elementos, limpa o que houver', async () => {
    montar();
    window.t = (k) => ({ 'fileTree.noProject': 'Nenhum projeto', 'statusBar.notReady': 'Sem projeto' })[k] || k;
    await m.fecharProjetoAberto();
    $('ready').dispatchEvent(new Event('transitionend'));
    expect($('current-spf-name').textContent).toBe('Nenhum projeto');
    expect($('status-text').textContent).toBe('Sem projeto');
    delete window.t;
    document.body.innerHTML = '<div id="ready"></div>';
    await m.fecharProjetoAberto();
    $('ready').dispatchEvent(new Event('transitionend'));
    document.body.innerHTML = '';
    expect(await m.fecharProjetoAberto()).toBe(true);
  });

  it('o main que recusa mostra o motivo e nao fecha; o erro inesperado tambem vira dialogo', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    electronAPI.closeProject.mockResolvedValueOnce({ success: false, error: 'ocupado' });
    expect(await m.fecharProjetoAberto()).toBe(false);
    expect(showDialog.mock.calls[0][0].message).toBe('dialog.closeProject.errorMessage');
    expect(ProjectStore.hasProject()).toBe(true);
    electronAPI.closeProject.mockRejectedValueOnce(new Error('ipc'));
    expect(await m.fecharProjetoAberto()).toBe(false);
    expect(showDialog.mock.calls[1][0].title).toBe('dialog.closeProject.unexpectedTitle');
    erro.mockRestore();
  });

  it('sem os gerenciadores da janela, fecha do mesmo jeito', async () => {
    for (const k of ['appInitializer', 'projectTreeManager', 'SplitEditorManager']) delete window[k];
    expect(await m.fecharProjetoAberto()).toBe(true);
  });
});

describe('o botao de fechar', () => {
  it('pergunta; confirmado, fecha e trava o botao durante', async () => {
    montar();
    // o ouvinte foi ligado no DOMContentLoaded do beforeAll, noutro botao;
    // liga de novo neste
    document.dispatchEvent(new Event('DOMContentLoaded'));
    let soltar;
    electronAPI.closeProject.mockImplementationOnce(() => new Promise((r) => { soltar = r; }));
    $('close-button').click();
    await flush();
    expect($('close-button').disabled).toBe(true);
    soltar({ success: true });
    await flush();
    expect($('close-button').disabled).toBe(false);
    expect(ProjectStore.hasProject()).toBe(false);
  });

  it('desistir nao fecha', async () => {
    montar();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    showDialog.mockResolvedValueOnce('cancel');
    $('close-button').click();
    await flush();
    expect(electronAPI.closeProject).not.toHaveBeenCalled();
  });

  it('sem o botao na pagina, nada se liga', () => {
    document.body.innerHTML = '';
    expect(() => document.dispatchEvent(new Event('DOMContentLoaded'))).not.toThrow();
  });
});
