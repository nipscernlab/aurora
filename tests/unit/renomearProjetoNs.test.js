// @vitest-environment happy-dom
//
// Renomear o projeto (js/api/renomear_projeto_ns): o pedido volta na hora com
// um jobId, o renomear roda em segundo plano, e o status conta cada passo e o
// veredito.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const electronAPI = {
  renameProject: vi.fn(),
  openProject: vi.fn(async () => {}),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const TabManager = { saveAllFiles: vi.fn(async () => {}), closeAllTabs: vi.fn(async () => {}) };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));

let ren;
let ProjectStore;
let api;
const msg = (r) => r.error?.message;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  for (const k of ['SplitEditorManager', 'projectManager', 'recentProjectsManager', 'showNotification', 't']) delete window[k];
  window.showNotification = vi.fn();
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  api = await import('../../js/api/api_core.js');
  ({ renomearProjeto: ren } = await import('../../js/api/renomear_projeto_ns.js'));
  ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
});

afterEach(() => vi.useRealTimers());

async function renomear(novo = 'Novo') {
  const r = await ren.renameProject({ newName: novo });
  await flush();
  return r.data.jobId;
}

describe('renameProject', () => {
  it('valida o nome, o projeto e o canal', async () => {
    expect(msg(await ren.renameProject())).toBe('newName required');
    expect(msg(await ren.renameProject({ newName: 'com espaco' }))).toMatch(/only contain/);
    const canal = electronAPI.renameProject;
    delete electronAPI.renameProject;
    expect(msg(await ren.renameProject({ newName: 'X' }))).toBe('rename-project IPC unavailable');
    electronAPI.renameProject = canal;
    ProjectStore.clearProject();
    expect(msg(await ren.renameProject({ newName: 'X' }))).toBe('No project open');
  });

  it('volta na hora com o jobId e avisa o usuario que comecou', async () => {
    electronAPI.renameProject.mockReturnValue(new Promise(() => {}));
    const r = await ren.renameProject({ newName: ' Novo ' });
    expect(r.data).toMatchObject({ jobId: 'rename-1', status: 'running' });
    expect(window.showNotification).toHaveBeenCalledWith(expect.stringContaining('Novo'), 'info');
    await flush();
    const st = await ren.getRenameStatus({ jobId: 'rename-1' });
    expect(st.data).toMatchObject({ status: 'running', done: false });
    expect(st.data.message).toMatch(/1 step\(s\) done, last: "prepare"/);
  });

  it('sucesso: prepara, renomeia no disco, reabre pelo gerenciador e tira o velho dos recentes', async () => {
    const fechar = vi.fn();
    window.SplitEditorManager = { panes: [{ paneIndex: 1 }, { paneIndex: 2 }], closePane: fechar };
    window.projectManager = { loadProject: vi.fn(async () => {}) };
    window.recentProjectsManager = { removeProject: vi.fn() };
    window.t = (k, p) => (k === 'rename.success' ? `ok ${p.name}` : k);
    const renomeou = vi.fn();
    api.on('project:renamed', renomeou);
    electronAPI.renameProject.mockResolvedValue({
      success: true, oldName: 'p', newName: 'Novo', newSpfPath: 'C:\\Novo\\Novo.spf', steps: [{ step: 'move', ok: true }],
    });
    const id = await renomear();
    expect(TabManager.saveAllFiles).toHaveBeenCalled();
    expect(fechar.mock.calls).toEqual([[1], [2]]);
    expect(TabManager.closeAllTabs).toHaveBeenCalled();
    expect(window.projectManager.loadProject).toHaveBeenCalledWith('C:\\Novo\\Novo.spf');
    expect(window.recentProjectsManager.removeProject).toHaveBeenCalledWith('C:\\p\\p.spf');
    expect(window.showNotification).toHaveBeenLastCalledWith('ok Novo', 'success');
    expect(renomeou).toHaveBeenCalledWith({ oldName: 'p', newName: 'Novo', spfPath: 'C:\\Novo\\Novo.spf' });
    const st = (await ren.getRenameStatus({ jobId: id })).data;
    expect(st.status).toBe('done');
    expect(st.steps.map((s) => s.step)).toEqual(['prepare', 'move', 'disk-rename', 'reopen']);
    expect(st.result).toEqual({ ok: true, oldName: 'p', newName: 'Novo', newSpfPath: 'C:\\Novo\\Novo.spf', warning: null });
    expect(st.message).toBe('Rename succeeded: project renamed to "Novo".');
  });

  it('sem gerenciador de projeto, reabre pelo main; sem .spf novo, nao reabre', async () => {
    electronAPI.renameProject.mockResolvedValue({ success: true, newSpfPath: 'C:\\N\\N.spf' });
    await renomear('N');
    expect(electronAPI.openProject).toHaveBeenCalledWith('C:\\N\\N.spf');
    electronAPI.openProject.mockClear();
    electronAPI.renameProject.mockResolvedValue({ success: true });
    const id = await renomear('M');
    expect(electronAPI.openProject).not.toHaveBeenCalled();
    expect((await ren.getRenameStatus({ jobId: id })).data.result.newName).toBe('M');
  });

  it('reabrir que falha nao desfaz o renomear: vira aviso', async () => {
    window.projectManager = { loadProject: vi.fn(async () => { throw new Error('arvore'); }) };
    electronAPI.renameProject.mockResolvedValue({ success: true, newName: 'N', newSpfPath: 'C:\\N\\N.spf' });
    TabManager.saveAllFiles.mockRejectedValueOnce(new Error('x'));
    TabManager.closeAllTabs.mockRejectedValueOnce(new Error('x'));
    window.SplitEditorManager = { panes: [{ paneIndex: 0 }], closePane: () => { throw new Error('x'); } };
    const id = await renomear('N');
    const st = (await ren.getRenameStatus({ jobId: id })).data;
    expect(st.status).toBe('done');
    expect(st.result.warning).toMatch(/could not auto-reload/);
    expect(st.message).toMatch(/Warning:/);
    expect(window.showNotification).toHaveBeenLastCalledWith(expect.stringContaining('reabra-o'), 'warning', 8000);
  });

  it('o canal que lanca, ou o main que recusa, vira falha com o passo e o motivo', async () => {
    electronAPI.renameProject.mockRejectedValueOnce(new Error('ipc caiu'));
    let id = await renomear();
    let st = (await ren.getRenameStatus({ jobId: id })).data;
    expect(st.result).toEqual({ ok: false, failedStep: 'disk-rename', reason: 'ipc caiu' });
    expect(st.message).toBe('Rename FAILED at step "disk-rename": ipc caiu');
    electronAPI.renameProject.mockRejectedValueOnce({});
    id = await renomear();
    expect((await ren.getRenameStatus({ jobId: id })).data.result.reason).toBe('rename IPC failed');

    electronAPI.renameProject.mockResolvedValueOnce({ success: false, failedStep: 'move', message: 'pasta travada', steps: [{ step: 'move', ok: false }] });
    id = await renomear();
    st = (await ren.getRenameStatus({ jobId: id })).data;
    expect(st.result).toMatchObject({ ok: false, failedStep: 'move' });
    expect(st.result.reason).toMatch(/pasta travada/);
    electronAPI.renameProject.mockResolvedValueOnce(null);
    id = await renomear();
    expect((await ren.getRenameStatus({ jobId: id })).data.result.failedStep).toBe('disk-rename');
    expect(window.showNotification).toHaveBeenLastCalledWith(expect.any(String), 'error', 8000);
  });

  it('erro inesperado no meio vira falha no passo "unexpected"', async () => {
    electronAPI.renameProject.mockResolvedValueOnce({ success: true, get newSpfPath() { throw new Error('quebrou'); } });
    const id = await renomear();
    const st = (await ren.getRenameStatus({ jobId: id })).data;
    expect(st.result).toEqual({ ok: false, failedStep: 'unexpected', reason: 'quebrou' });
    electronAPI.renameProject.mockResolvedValueOnce({ success: true, get newSpfPath() { throw 'texto'; } });
    const id2 = await renomear();
    expect((await ren.getRenameStatus({ jobId: id2 })).data.result.reason).toBe('texto');
  });

  it('o aviso que lanca nao muda o veredito', async () => {
    window.showNotification = () => { throw new Error('sem toast'); };
    window.t = () => { throw new Error('sem i18n'); };
    electronAPI.renameProject.mockResolvedValueOnce({ success: true });
    const id = await renomear();
    expect((await ren.getRenameStatus({ jobId: id })).data.status).toBe('done');
    electronAPI.renameProject.mockResolvedValueOnce({ success: false });
    const id2 = await renomear();
    expect((await ren.getRenameStatus({ jobId: id2 })).data.status).toBe('failed');
    electronAPI.renameProject.mockRejectedValueOnce(new Error('x'));
    const id3 = await renomear();
    expect((await ren.getRenameStatus({ jobId: id3 })).data.status).toBe('failed');
    window.projectManager = { loadProject: vi.fn(async () => { throw new Error('x'); }) };
    electronAPI.renameProject.mockResolvedValueOnce({ success: true, newSpfPath: 'C:\\N.spf' });
    const id4 = await renomear();
    expect((await ren.getRenameStatus({ jobId: id4 })).data.result.warning).toBeTruthy();
    electronAPI.renameProject.mockResolvedValueOnce({ success: true, get newSpfPath() { throw new Error('y'); } });
    const id5 = await renomear();
    expect((await ren.getRenameStatus({ jobId: id5 })).data.status).toBe('failed');
  });
});

describe('getRenameStatus', () => {
  it('sem id, ou id que nao existe ou ja expirou', async () => {
    expect(msg(await ren.getRenameStatus())).toBe('jobId required');
    expect(msg(await ren.getRenameStatus({ jobId: 'rename-99' }))).toMatch(/No rename job with id "rename-99"/);
    electronAPI.renameProject.mockResolvedValueOnce({ success: true });
    const id = await renomear();
    expect((await ren.getRenameStatus({ jobId: id })).ok).toBe(true);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(msg(await ren.getRenameStatus({ jobId: id }))).toMatch(/No rename job/);
  });

  it('em curso sem passo nenhum ainda', async () => {
    let soltar;
    TabManager.saveAllFiles.mockImplementationOnce(() => new Promise((r) => { soltar = r; }));
    const r = await ren.renameProject({ newName: 'X' });
    const st = (await ren.getRenameStatus({ jobId: r.data.jobId })).data;
    expect(st.message).toBe('Rename in progress — 0 step(s) done. Poll again.');
    soltar();
  });
});
