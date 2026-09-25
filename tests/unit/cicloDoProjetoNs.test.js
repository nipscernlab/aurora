// @vitest-environment happy-dom
//
// O ciclo do projeto (js/api/ciclo_do_projeto_ns): fechar, o projeto atual,
// criar, abrir, recentes, backup e marcar os dois topos.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const electronAPI = {
  getProjectInfo: vi.fn(async () => ({ name: 'p' })),
  createProjectStructure: vi.fn(async () => ({ success: true })),
  openProject: vi.fn(async () => {}),
  listRecentProjects: vi.fn(async () => ['C:\\a\\a.spf', 'D:/b/b.spf']),
  createBackup: vi.fn(async () => ({ success: true, message: 'Backup created at: C:\\p\\Backup\\p.zip' })),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
let cfg;
const SpfStore = { update: vi.fn(async (_p, fn) => { fn(cfg); return cfg; }) };
vi.mock('../../js/project/spf_store.js', () => ({ SpfStore }));

let ciclo;
let ProjectStore;
let api;
const msg = (r) => r.error?.message;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  cfg = {};
  document.body.innerHTML = '';
  localStorage.clear();
  delete window.projectManager;
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  api = await import('../../js/api/api_core.js');
  ({ cicloDoProjeto: ciclo } = await import('../../js/api/ciclo_do_projeto_ns.js'));
  ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
});

describe('fechar e o projeto atual', () => {
  it('fechar clica no botao da interface, que pergunta ao usuario', async () => {
    expect(msg(await ciclo.close())).toBe('Close-project control not available');
    document.body.innerHTML = '<button id="close-button"></button>';
    const clique = vi.fn();
    document.getElementById('close-button').addEventListener('click', clique);
    expect((await ciclo.close()).data.requested).toBe(true);
    expect(clique).toHaveBeenCalled();
    ProjectStore.clearProject();
    expect(msg(await ciclo.close())).toBe('No project open');
  });

  it('o projeto atual vem com a informacao do main, ou com o erro dela', async () => {
    expect((await ciclo.getCurrent()).data).toEqual({ path: 'C:\\p', info: { name: 'p' } });
    electronAPI.getProjectInfo.mockResolvedValueOnce(null);
    expect((await ciclo.getCurrent()).data.info).toBeNull();
    electronAPI.getProjectInfo.mockRejectedValueOnce(new Error('spf ilegivel'));
    expect((await ciclo.getCurrent()).data).toEqual({ path: 'C:\\p', info: null, infoError: 'spf ilegivel' });
    electronAPI.getProjectInfo.mockRejectedValueOnce('texto');
    expect((await ciclo.getCurrent()).data.infoError).toBe('texto');
    ProjectStore.clearProject();
    expect((await ciclo.getCurrent()).data).toBeNull();
  });
});

describe('criar e abrir', () => {
  it('cria a estrutura, abre pelo gerenciador e avisa', async () => {
    window.projectManager = { loadProject: vi.fn(async () => {}) };
    const criou = vi.fn();
    api.on('project:created', criou);
    const r = await ciclo.createProject({ name: 'Novo', location: 'C:\\proj' });
    expect(r.data).toEqual({ name: 'Novo', projectPath: 'C:\\proj\\Novo', spfPath: 'C:\\proj\\Novo\\Novo.spf' });
    expect(electronAPI.createProjectStructure).toHaveBeenCalledWith('C:\\proj\\Novo', 'C:\\proj\\Novo\\Novo.spf', 'Novo');
    expect(window.projectManager.loadProject).toHaveBeenCalledWith('C:\\proj\\Novo\\Novo.spf');
    expect(criou).toHaveBeenCalled();
    delete window.projectManager;
    expect((await ciclo.createProject({ name: 'Outro', location: 'C:\\proj' })).ok).toBe(true);
  });

  it('criar recusa sem nome/local, com nome ruim, e devolve a falha', async () => {
    expect(msg(await ciclo.createProject())).toBe('name and location required');
    expect(msg(await ciclo.createProject({ name: 'a b', location: 'C:' }))).toMatch(/only contain/);
    electronAPI.createProjectStructure.mockResolvedValueOnce({ success: false, message: 'ja existe' });
    expect(msg(await ciclo.createProject({ name: 'a', location: 'C:' }))).toBe('ja existe');
    electronAPI.createProjectStructure.mockResolvedValueOnce(null);
    expect(msg(await ciclo.createProject({ name: 'a', location: 'C:' }))).toBe('createProject failed');
    electronAPI.createProjectStructure.mockRejectedValueOnce({});
    expect(msg(await ciclo.createProject({ name: 'a', location: 'C:' }))).toBe('createProject failed');
  });

  it('abrir pelo gerenciador, ou pelo main sem ele', async () => {
    expect(msg(await ciclo.openProject())).toBe('spfPath required');
    expect((await ciclo.openProject('C:\\a\\a.spf')).data).toEqual({ spfPath: 'C:\\a\\a.spf' });
    expect(electronAPI.openProject).toHaveBeenCalledWith('C:\\a\\a.spf');
    window.projectManager = { loadProject: vi.fn(async () => { throw new Error('spf ruim'); }) };
    expect(msg(await ciclo.openProject('C:\\a\\a.spf'))).toBe('spf ruim');
    window.projectManager.loadProject.mockRejectedValueOnce({});
    expect(msg(await ciclo.openProject('C:\\a\\a.spf'))).toBe('openProject failed');
  });
});

describe('recentes e backup', () => {
  it('recentes do main, ou da tela inicial sem o canal', async () => {
    expect((await ciclo.listRecents()).data).toEqual([{ spfPath: 'C:\\a\\a.spf', name: 'a' }, { spfPath: 'D:/b/b.spf', name: 'b' }]);
    electronAPI.listRecentProjects.mockResolvedValueOnce(null);
    expect((await ciclo.listRecents()).data).toEqual([]);
    const canal = electronAPI.listRecentProjects;
    delete electronAPI.listRecentProjects;
    localStorage.setItem('aurora-recent-projects', JSON.stringify(['C:\\c\\c.spf']));
    expect((await ciclo.listRecents()).data).toEqual([{ spfPath: 'C:\\c\\c.spf', name: 'c' }]);
    localStorage.setItem('aurora-recent-projects', '{}');
    expect((await ciclo.listRecents()).data).toEqual([]);
    localStorage.removeItem('aurora-recent-projects');
    expect((await ciclo.listRecents()).data).toEqual([]);
    localStorage.setItem('aurora-recent-projects', 'lixo');
    expect(msg(await ciclo.listRecents())).toBeTruthy();
    electronAPI.listRecentProjects = canal;
    electronAPI.listRecentProjects.mockRejectedValueOnce({});
    expect(msg(await ciclo.listRecents())).toBe('listRecents failed');
  });

  it('backup devolve o caminho do zip que o main escreveu', async () => {
    expect((await ciclo.backup()).data).toEqual({ archivePath: 'C:\\p\\Backup\\p.zip', message: 'Backup created at: C:\\p\\Backup\\p.zip' });
    expect(electronAPI.createBackup).toHaveBeenCalledWith('C:\\p');
    electronAPI.createBackup.mockResolvedValueOnce({ success: true });
    expect((await ciclo.backup()).data).toEqual({ archivePath: null, message: '' });
  });

  it('backup recusa sem projeto, sem canal, e devolve a falha', async () => {
    electronAPI.createBackup.mockResolvedValueOnce({ success: false, message: 'sem espaco' });
    expect(msg(await ciclo.backup())).toBe('sem espaco');
    electronAPI.createBackup.mockResolvedValueOnce(null);
    expect(msg(await ciclo.backup())).toBe('backup failed');
    electronAPI.createBackup.mockRejectedValueOnce({});
    expect(msg(await ciclo.backup())).toBe('createBackup failed');
    const canal = electronAPI.createBackup;
    delete electronAPI.createBackup;
    expect(msg(await ciclo.backup())).toBe('Backup IPC unavailable');
    electronAPI.createBackup = canal;
    ProjectStore.clearProject();
    expect(msg(await ciclo.backup())).toBe('No project is open');
  });
});

describe('os dois topos', () => {
  it('topo de sintese: sai dos testbenches, entra nos sintetizaveis e fica o unico marcado', async () => {
    cfg = {
      synthesizableFiles: [{ name: 'a.v', path: 'C:\\p\\a.v', isTopLevel: true }],
      testbenchFiles: [{ path: 'C:/p/top.v' }, { path: 'C:\\p\\tb.v' }],
      testbenchFile: 'c:/p/TOP.v',
    };
    expect((await ciclo.setTopLevel('top.v')).data).toEqual({ filePath: 'C:\\p\\top.v' });
    expect(cfg.testbenchFiles).toEqual([{ path: 'C:\\p\\tb.v' }]);
    expect(cfg.testbenchFile).toBe('');
    expect(cfg.synthesizableFiles).toEqual([
      { name: 'a.v', path: 'C:\\p\\a.v', isTopLevel: false },
      { name: 'top.v', path: 'C:\\p\\top.v', isTopLevel: true },
    ]);
    expect(cfg.topLevelFile).toBe('C:\\p\\top.v');
    await ciclo.setTopLevel('C:\\p\\a.v');
    expect(cfg.synthesizableFiles.map((f) => f.isTopLevel)).toEqual([true, false]);
  });

  it('topo de simulacao: o espelho, com o outro ponteiro', async () => {
    cfg = { synthesizableFiles: [{ path: 'C:\\p\\tb.v' }], topLevelFile: 'C:\\p\\tb.v' };
    expect((await ciclo.setTestbenchTop('\\tb.v')).data).toEqual({ filePath: 'C:\\p\\tb.v' });
    expect(cfg.synthesizableFiles).toEqual([]);
    expect(cfg.topLevelFile).toBe('');
    expect(cfg.testbenchFiles).toEqual([{ name: 'tb.v', path: 'C:\\p\\tb.v', isTopLevel: true }]);
    expect(cfg.testbenchFile).toBe('C:\\p\\tb.v');
    cfg = { synthesizableFiles: [{ path: 'C:\\p\\x.v' }], topLevelFile: 'C:\\p\\x.v' };
    await ciclo.setTestbenchTop('C:\\p\\tb.v');
    expect(cfg.topLevelFile).toBe('C:\\p\\x.v');
  });

  it('recusam sem projeto ou sem caminho, e devolvem a falha', async () => {
    expect(msg(await ciclo.setTopLevel())).toBe('filePath required');
    SpfStore.update.mockRejectedValueOnce({});
    expect(msg(await ciclo.setTopLevel('a.v'))).toBe('setTopLevel failed');
    SpfStore.update.mockRejectedValueOnce(new Error('spf travado'));
    expect(msg(await ciclo.setTestbenchTop('a.v'))).toBe('spf travado');
    SpfStore.update.mockRejectedValueOnce({});
    expect(msg(await ciclo.setTestbenchTop('a.v'))).toBe('setTestbenchTop failed');
    const spy = vi.spyOn(ProjectStore, 'getProjectPath').mockReturnValue(null);
    expect(msg(await ciclo.setTopLevel('a.v'))).toBe('No project open');
    spy.mockRestore();
    ProjectStore.clearProject();
    expect(msg(await ciclo.setTestbenchTop('a.v'))).toBe('No project open');
  });
});
