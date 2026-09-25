// @vitest-environment happy-dom
//
// O file_tree_manager: o vigia da pasta do projeto, o botao de atualizar, o
// aviso de pasta sumida, e o cartao de "nenhum projeto" na arvore.

import { describe, it, expect, vi } from 'vitest';

const ouvintes = {};
const electronAPI = {
  watchDirectory: vi.fn(async () => {}),
  stopWatchingDirectory: vi.fn(async () => {}),
  onDirectoryChanged: vi.fn((cb) => { ouvintes.mudou = cb; }),
  onDirectoryGone: vi.fn((cb) => { ouvintes.sumiu = cb; }),
  onDirectoryWatcherError: vi.fn((cb) => { ouvintes.erro = cb; }),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const showCardNotification = vi.fn();
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification }));
vi.mock('../../js/components/aurora-tree.js', () => ({}));
const ligarMenuDoCabecalho = vi.fn();
vi.mock('../../js/tree/tree_header_menu.js', () => ({ ligarMenuDoCabecalho }));
// O controlador de vistas e a vista de pastas: os mesmos falsos por import e
// por window, para o teste valer antes e depois de o manager importar os dois.
const ctl = {
  vista: 'verilog',
  isShowingHierarchy: () => ctl.vista === 'hierarchy',
  isShowingStandard: () => ctl.vista === 'standard',
  showFileMode: vi.fn(() => { ctl.vista = 'verilog'; }),
  showHierarchyMode: vi.fn(),
  getHierarchyData: () => null,
  setHierarchyData: vi.fn(),
};
const pastas = { render: vi.fn() };
vi.mock('../../js/tree/file_tree_view_controller.js', () => ({ fileTreeViewController: ctl }));
vi.mock('../../js/tree/standard_tree_render.js', () => ({ standardTreeRenderer: pastas }));

let m;
let ProjectStore;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const cartao = () => document.querySelector('#file-tree .tree-view-verilog .tree-empty-no-project');

async function carregar({ projeto = null, restaurando = false } = {}) {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="file-tree"></div><button id="refresh-button"></button><button id="newProjectBtn"></button>';
  localStorage.clear();
  if (restaurando) localStorage.setItem('aurora-last-project-path', 'C:\\p\\p.spf');
  ctl.vista = 'verilog';
  window.fileTreeViewController = ctl;
  window.standardTreeRenderer = pastas;
  delete window.currentProjectPath;
  delete window.t;
  window.projectTreeManager = { refreshTree: vi.fn(), activateTree: vi.fn(async () => {}), initPromise: Promise.resolve() };
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  if (projeto) ProjectStore.setProject(`${projeto}\\p.spf`, projeto);
  await import('../../js/tree/tree_view.js');
  m = await import('../../js/tree/file_tree_manager.js');
  await flush();
}

describe('cartao de nenhum projeto', () => {
  it('sem projeto e sem restauracao, o cartao aparece na hora e leva ao projeto novo', async () => {
    await carregar();
    expect(cartao()).not.toBeNull();
    const novo = vi.fn();
    document.getElementById('newProjectBtn').addEventListener('click', novo);
    cartao().click();
    expect(novo).toHaveBeenCalled();
  });

  it('o texto do cartao vem traduzido e escapado', async () => {
    await carregar({ projeto: 'C:\\p' });
    window.t = (k) => (k === 'fileTree.empty.noProjectTitle' ? '<b>Sem</b> projeto' : k);
    window.renderTreeEmptyState();
    expect(cartao().querySelector('.tree-empty-state-title').innerHTML).toBe('&lt;b&gt;Sem&lt;/b&gt; projeto');
  });

  it('restaurando um projeto, espera o fim da restauracao; se nao abriu nada, mostra o cartao', async () => {
    await carregar({ restaurando: true });
    expect(cartao()).toBeNull();
    document.dispatchEvent(new Event('aurora:session-restore-settled'));
    expect(cartao()).not.toBeNull();
  });

  it('restauracao que abriu o projeto nao mostra o cartao', async () => {
    await carregar({ restaurando: true });
    ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
    document.dispatchEvent(new Event('aurora:session-restore-settled'));
    expect(cartao()).toBeNull();
  });

  it('com projeto aberto no inicio, nada de cartao; abrir redesenha a arvore, fechar mostra o cartao', async () => {
    await carregar({ projeto: 'C:\\p' });
    expect(cartao()).toBeNull();
    ProjectStore.clearProject();
    expect(cartao()).not.toBeNull();
    ProjectStore.setProject('C:\\q\\q.spf', 'C:\\q');
    expect(window.projectTreeManager.refreshTree).toHaveBeenCalled();
  });

  it('sem a arvore na pagina, o cartao nao tem onde entrar', async () => {
    await carregar({ projeto: 'C:\\p' });
    document.getElementById('file-tree').remove();
    m.fileTreeManager; // o modulo segue carregado
    expect(() => window.renderTreeEmptyState()).not.toThrow();
  });
});

describe('initialize', () => {
  it('comeca na vista de arquivos, liga o menu do cabecalho e pinta a arvore', async () => {
    await carregar({ projeto: 'C:\\p' });
    ctl.vista = 'hierarchy';
    m.fileTreeManager.initialize();
    await flush();
    expect(ctl.showFileMode).toHaveBeenCalled();
    expect(ligarMenuDoCabecalho).toHaveBeenCalled();
    expect(window.projectTreeManager.activateTree).toHaveBeenCalled();
  });

  it('sem a arvore de projeto, nao pinta nada', async () => {
    await carregar({ projeto: 'C:\\p' });
    delete window.projectTreeManager;
    m.fileTreeManager.initialize();
    await flush();
  });

  it('atualizar: na vista de pastas redesenha ela; na de arquivos, a arvore; na hierarquia, nada', async () => {
    await carregar({ projeto: 'C:\\p' });
    m.fileTreeManager.initialize();
    const botao = document.getElementById('refresh-button');
    botao.click();
    expect(window.projectTreeManager.refreshTree).toHaveBeenCalledTimes(1);
    ctl.vista = 'standard';
    botao.click();
    expect(pastas.render).toHaveBeenCalledTimes(1);
    ctl.vista = 'hierarchy';
    botao.click();
    expect(pastas.render).toHaveBeenCalledTimes(1);
    expect(window.projectTreeManager.refreshTree).toHaveBeenCalledTimes(1);
  });

  it('mudanca na pasta vigiada redesenha a vista certa; noutra pasta, ou na hierarquia, ignora', async () => {
    await carregar({ projeto: 'C:\\p' });
    m.fileTreeManager.initialize();
    await m.fileTreeManager.watcher.startWatching('C:\\p');
    ouvintes.mudou('C:\\outra', []);
    expect(window.projectTreeManager.refreshTree).not.toHaveBeenCalled();
    ouvintes.mudou('C:\\p', []);
    expect(window.projectTreeManager.refreshTree).toHaveBeenCalledTimes(1);
    ctl.vista = 'standard';
    ouvintes.mudou('C:\\p', []);
    expect(pastas.render).toHaveBeenCalledTimes(1);
    ctl.vista = 'hierarchy';
    ouvintes.mudou('C:\\p', []);
    expect(pastas.render).toHaveBeenCalledTimes(1);
  });

  it('a pasta do projeto sumiu: um cartao que nao some sozinho; erro do vigia vai ao console', async () => {
    await carregar({ projeto: 'C:\\p' });
    m.fileTreeManager.initialize();
    await m.fileTreeManager.watcher.startWatching('C:\\p');
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ouvintes.sumiu('C:\\outra');
    expect(showCardNotification).not.toHaveBeenCalled();
    ouvintes.sumiu('C:\\p');
    expect(showCardNotification).toHaveBeenCalledWith('The project folder is no longer on disk.', 'error', 0, 'Project folder gone');
    aviso.mockRestore();
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    ouvintes.erro('C:\\p', new Error('EPERM'));
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe('o vigia da pasta', () => {
  it('trocar de pasta para de vigiar a anterior; sem pasta, so para', async () => {
    await carregar({ projeto: 'C:\\p' });
    const w = m.fileTreeManager.watcher;
    await w.startWatching('C:\\p');
    expect(electronAPI.watchDirectory).toHaveBeenCalledWith('C:\\p');
    await w.startWatching('C:\\q');
    expect(electronAPI.stopWatchingDirectory).toHaveBeenCalledWith('C:\\p');
    await w.startWatching(null);
    expect(w.isWatching).toBe(false);
    expect(electronAPI.watchDirectory).toHaveBeenCalledTimes(2);
  });

  it('falhas de ligar ou de parar vao ao console', async () => {
    await carregar({ projeto: 'C:\\p' });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = m.fileTreeManager.watcher;
    electronAPI.watchDirectory.mockRejectedValueOnce(new Error('x'));
    await w.startWatching('C:\\p');
    expect(w.isWatching).toBe(false);
    await w.startWatching('C:\\p');
    electronAPI.stopWatchingDirectory.mockRejectedValueOnce(new Error('y'));
    await w.stopWatching();
    expect(w.isWatching).toBe(true);
    expect(erro).toHaveBeenCalledTimes(2);
    erro.mockRestore();
  });
});
