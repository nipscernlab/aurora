// @vitest-environment happy-dom
//
// O project_manager: abrir um projeto (o loadProject, que orquestra a arvore,
// a barra, os recentes e o relatorio de arquivos faltando) e os eventos que
// ele liga (botoes de abrir, informacoes, pasta, e os pedidos do main).

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const disco = new Map();
const ipc = {};
const electronAPI = {
  openProject: vi.fn(),
  getProjectInfo: vi.fn(async () => ({ metadata: { projectName: 'p' } })),
  showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:\\p\\p.spf'] })),
  openFolder: vi.fn(),
  readFile: vi.fn(async (p) => disco.get(p) ?? ''),
  joinPath: vi.fn(async (...p) => p.join('\\')),
  writeFile: vi.fn(async (p, c) => { disco.set(p, c); }),
  fileExists: vi.fn(async (p) => disco.has(p)),
  deleteFile: vi.fn(async (p) => { disco.delete(p); }),
  onSimulateOpenProject: vi.fn((cb) => { ipc.simular = cb; }),
  onOpenLooseFile: vi.fn((cb) => { ipc.solto = cb; }),
  onOpenFileAt: vi.fn((cb) => { ipc.abrirEm = cb; }),
  onOpenWave: vi.fn((cb) => { ipc.onda = cb; }),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const TabManager = {
  tabs: new Map(), closeAllTabs: vi.fn(async () => {}), addTab: vi.fn(), activateTab: vi.fn(), closeTab: vi.fn(async () => {}),
};
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));
const vigia = { startWatching: vi.fn() };
vi.mock('../../js/tree/file_tree_manager.js', () => ({ fileTreeManager: { watcher: vigia } }));
const showDialog = vi.fn(async () => {});
vi.mock('../../js/ui/dialog_manager.js', () => ({ showDialog }));
const barra = { cmm: vi.fn(), toolbar: vi.fn(async () => {}) };
vi.mock('../../js/compilation/botoes_da_barra.js', () => ({
  syncCmmcompEnabled: () => barra.cmm(),
  syncToolbarEnabledState: () => barra.toolbar(),
}));

let pm;
let ProjectStore;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const $ = (id) => document.getElementById(id);

beforeAll(async () => {
  document.body.innerHTML = `
    <button id="openProjectBtn"></button><button id="openProjectBtnWelcome"></button>
    <button id="projectInfo"></button><button id="open-folder-button"></button>
    <span id="current-spf-name"></span>
    <div id="ready"><i></i><span id="status-text"></span></div>`;
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  ({ projectManager: pm } = await import('../../js/project/project_manager.js'));
  document.dispatchEvent(new Event('DOMContentLoaded'));
  pm.initialize();
});

let arvore;

beforeEach(() => {
  vi.clearAllMocks();
  disco.clear();
  TabManager.tabs = new Map();
  electronAPI.openProject.mockResolvedValue({ success: true, projectData: { structure: { processors: ['P'] }, metadata: { projectName: 'p' } } });
  arvore = { reset: vi.fn(), activateTree: vi.fn(async () => {}), refreshEditorFocusHighlight: vi.fn(), missingFiles: [] };
  window.projectTreeManager = arvore;
  window.recentProjectsManager = { addProject: vi.fn() };
  window.appInitializer = { saveCurrentProject: vi.fn() };
  window.SplitEditorManager = { refreshLayout: vi.fn() };
  window.gtkwPickerManager = { refresh: vi.fn() };
  window.showNotification = vi.fn();
  window.TabManager = TabManager;
  window.syncCmmcompEnabled = barra.cmm;
  window.syncToolbarEnabledState = barra.toolbar;
  ProjectStore.clearProject();
});

describe('loadProject', () => {
  it('abre: a raiz e a pasta do .spf, e a arvore, a barra, os recentes e o layout sao avisados', async () => {
    const avisos = vi.fn();
    window.addEventListener('aurora:spf-changed', avisos);
    await pm.loadProject('C:\\p\\p.spf');
    window.removeEventListener('aurora:spf-changed', avisos);
    expect(ProjectStore.getProjectPath()).toBe('C:\\p');
    expect(ProjectStore.getSpfPath()).toBe('C:\\p\\p.spf');
    expect(window.availableProcessors).toEqual(['P']);
    expect($('current-spf-name').textContent).toBe('p.spf');
    expect(arvore.reset).toHaveBeenCalled();
    expect(TabManager.closeAllTabs).toHaveBeenCalled();
    expect(arvore.activateTree).toHaveBeenCalled();
    expect(vigia.startWatching).toHaveBeenCalledWith('C:\\p');
    expect(window.recentProjectsManager.addProject).toHaveBeenCalledWith('C:\\p\\p.spf');
    expect(window.appInitializer.saveCurrentProject).toHaveBeenCalledWith('C:\\p\\p.spf');
    expect(window.SplitEditorManager.refreshLayout).toHaveBeenCalled();
    expect(window.gtkwPickerManager.refresh).toHaveBeenCalled();
    expect(avisos.mock.calls[0][0].detail).toEqual({ spfPath: 'C:\\p\\p.spf', source: 'project-loaded' });
    expect(arvore.refreshEditorFocusHighlight).toHaveBeenCalled();
    expect(barra.cmm).toHaveBeenCalled();
    expect($('status-text').textContent).toBe('p');
  });

  it('sem os gerenciadores da janela, abre do mesmo jeito', async () => {
    for (const k of ['projectTreeManager', 'recentProjectsManager', 'appInitializer', 'SplitEditorManager', 'gtkwPickerManager']) delete window[k];
    electronAPI.openProject.mockResolvedValue({ success: true, data: {} });
    await pm.loadProject('C:\\q\\q.spf');
    expect(ProjectStore.getProjectPath()).toBe('C:\\q');
    expect(showDialog).not.toHaveBeenCalled();
  });

  it('sem o caminho do .spf, a raiz vem do que o .spf diz', async () => {
    electronAPI.openProject.mockResolvedValue({ success: true, projectData: { structure: { basePath: 'D:\\base' } } });
    await pm.loadProject(null);
    expect(ProjectStore.getProjectPath()).toBe('D:\\base');
    electronAPI.openProject.mockResolvedValue({ success: true, projectData: { basePath: 'D:\\b2' } });
    await pm.loadProject(undefined);
    expect(ProjectStore.getProjectPath()).toBe('D:\\b2');
    electronAPI.openProject.mockResolvedValue({ success: true, projectData: { metadata: { projectPath: 'D:\\b3' } } });
    await pm.loadProject(undefined);
    expect(ProjectStore.getProjectPath()).toBe('D:\\b3');
  });

  it('com arquivos faltando: avisa, e abre o relatorio; sem, apaga o relatorio antigo', async () => {
    arvore.missingFiles = [{ name: 'a.v', path: 'C:\\p\\a.v', category: 'synthesizable' }];
    await pm.loadProject('C:\\p\\p.spf');
    expect(window.showNotification).toHaveBeenCalledWith(expect.any(String), 'warning', 5000);
    expect(TabManager.addTab).toHaveBeenCalledWith('C:\\p\\.aurora-missing-files.log', expect.stringContaining('a.v'), { preview: true });
    arvore.missingFiles = [];
    await pm.loadProject('C:\\p\\p.spf');
    expect(disco.has('C:\\p\\.aurora-missing-files.log')).toBe(false);
  });

  it('falhar ao escrever ou apagar o relatorio so avisa no console', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    arvore.missingFiles = [{ name: 'a.v', path: 'x' }];
    delete window.showNotification;
    electronAPI.writeFile.mockRejectedValueOnce(new Error('protegido'));
    await pm.loadProject('C:\\p\\p.spf');
    arvore.missingFiles = [];
    electronAPI.joinPath.mockRejectedValueOnce(new Error('ipc'));
    await pm.loadProject('C:\\p\\p.spf');
    expect(aviso).toHaveBeenCalledTimes(2);
    aviso.mockRestore();
  });

  it('o main que recusa, ou nenhuma raiz, vira o dialogo de erro', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    electronAPI.openProject.mockResolvedValueOnce({ success: false, message: 'spf corrompido' });
    await pm.loadProject('C:\\p\\p.spf');
    expect(showDialog.mock.calls[0][0].message).toContain('dialog.project.loadErrorMessage');
    electronAPI.openProject.mockResolvedValueOnce(null);
    await pm.loadProject('C:\\p\\p.spf');
    electronAPI.openProject.mockResolvedValueOnce({ success: true });
    await pm.loadProject(null);
    expect(showDialog).toHaveBeenCalledTimes(3);
    showDialog.mockRejectedValueOnce(new Error('sem dialogo'));
    electronAPI.openProject.mockResolvedValueOnce(null);
    await pm.loadProject('C:\\p\\p.spf');
    expect(erro).toHaveBeenCalledWith('showDialog failed:', expect.any(Error));
    erro.mockRestore();
  });
});

describe('os eventos ligados', () => {
  it('os dois botoes de abrir mostram o seletor e abrem o escolhido; cancelar nao abre', async () => {
    $('openProjectBtn').click();
    await flush();
    expect(electronAPI.openProject).toHaveBeenCalledWith('C:\\p\\p.spf');
    electronAPI.openProject.mockClear();
    electronAPI.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    $('openProjectBtnWelcome').click();
    await flush();
    expect(electronAPI.openProject).not.toHaveBeenCalled();
    $('openProjectBtnWelcome').click();
    await flush();
    expect(electronAPI.openProject).toHaveBeenCalled();
  });

  it('informacoes do projeto: so com projeto, e o erro vai ao console', async () => {
    $('projectInfo').click();
    await flush();
    expect(electronAPI.getProjectInfo).not.toHaveBeenCalled();
    ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
    $('projectInfo').click();
    await flush();
    expect(electronAPI.getProjectInfo).toHaveBeenCalledWith('C:\\p\\p.spf');
    expect(document.querySelector('.aurora-modal-container')).not.toBeNull();
    document.querySelector('.aurora-modal-close').click();
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    electronAPI.getProjectInfo.mockRejectedValueOnce(new Error('x'));
    $('projectInfo').click();
    await flush();
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it('abrir a pasta do projeto, so com projeto', () => {
    $('open-folder-button').click();
    expect(electronAPI.openFolder).not.toHaveBeenCalled();
    ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
    $('open-folder-button').click();
    expect(electronAPI.openFolder).toHaveBeenCalledWith('C:\\p');
  });

  it('o main pede para abrir um projeto', async () => {
    await ipc.simular({ canceled: false, filePaths: ['C:\\z\\z.spf'] });
    expect(electronAPI.openProject).toHaveBeenCalledWith('C:\\z\\z.spf');
    electronAPI.openProject.mockClear();
    await ipc.simular({ canceled: true, filePaths: [] });
    expect(electronAPI.openProject).not.toHaveBeenCalled();
  });

  it('arquivo solto do Windows abre como aba, sem projeto', async () => {
    disco.set('C:\\solto.cmm', 'void main(){}');
    await ipc.solto({ filePath: 'C:\\solto.cmm' });
    expect(TabManager.addTab).toHaveBeenCalledWith('C:\\solto.cmm', 'void main(){}');
    await ipc.solto({});
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    electronAPI.readFile.mockRejectedValueOnce(new Error('negado'));
    await ipc.solto({ filePath: 'C:\\x' });
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
    electronAPI.readFile.mockResolvedValueOnce(null);
    await ipc.solto({ filePath: 'C:\\vazio' });
    expect(TabManager.addTab).toHaveBeenLastCalledWith('C:\\vazio', '');
  });

  it('abrir na linha (do PRISM): aba ja aberta pula direto; senao abre no painel certo', async () => {
    const editor = { layout: vi.fn(), setPosition: vi.fn(), revealLineInCenter: vi.fn(), focus: vi.fn() };
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => { f(); return 0; });
    TabManager.tabs = new Map([['C:\\p\\a.v', {}]]);
    window.EditorManager = { getEditorForFile: () => editor };
    await ipc.abrirEm({ filePath: 'C:\\p\\a.v', line: 7, column: 3 });
    expect(TabManager.activateTab).toHaveBeenCalledWith('C:\\p\\a.v');
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 7, column: 3 });
    expect(editor.revealLineInCenter).toHaveBeenCalledWith(7);

    const pane = { paneIndex: 2, tabs: new Map([['C:\\p\\b.v', { editor }]]) };
    window.SplitEditorManager = { focusedPane: 2, panes: [pane], openInFocusedPane: vi.fn(async () => {}) };
    await ipc.abrirEm({ filePath: 'C:\\p\\b.v', line: -1, column: 'x' });
    expect(window.SplitEditorManager.openInFocusedPane).toHaveBeenCalled();
    expect(editor.setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 1 });

    window.SplitEditorManager = { focusedPane: 0 };
    await ipc.abrirEm({ filePath: 'C:\\p\\c.v', line: 4, column: 2 });
    expect(TabManager.addTab).toHaveBeenCalledWith('C:\\p\\c.v', '', { preview: false, revealPosition: { line: 4, column: 2 } });

    delete window.EditorManager;
    TabManager.tabs = new Map([['C:\\p\\a.v', {}]]);
    await ipc.abrirEm({ filePath: 'C:\\p\\a.v', line: 1, column: 1 });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    TabManager.tabs = new Map();
    electronAPI.readFile.mockRejectedValueOnce(new Error('x'));
    await ipc.abrirEm({ filePath: 'C:\\p\\d.v', line: 1, column: 1 });
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
    raf.mockRestore();
  });

  it('a onda da simulacao do PRISM vai para o visualizador da casa', async () => {
    const abrir = vi.fn(async () => {});
    window.compilationModule = { abrirOndaExterna: abrir };
    await ipc.onda({ vcdPath: 'C:\\p\\w.vcd', modulo: 'top', sinais: ['a'] });
    expect(abrir).toHaveBeenCalledWith('C:\\p\\w.vcd', 'top', ['a']);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    abrir.mockRejectedValueOnce(new Error('sem gtkwave'));
    await ipc.onda({ vcdPath: 'x' });
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
    delete window.compilationModule;
    await ipc.onda({ vcdPath: 'x' });
  });

  it('o indicador da barra, sem projeto, abre o seletor', async () => {
    $('ready').classList.remove('is-ready');
    $('ready').click();
    await flush();
    expect(electronAPI.showOpenDialog).toHaveBeenCalled();
  });
});
