// Os processadores do projeto (js/api/processadores_ns): listar, criar,
// apagar, renomear, e a config de simulacao, no projeto do ProjectStore.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const disco = new Map();
const electronAPI = {
  joinPath: vi.fn(async (...p) => p.join('/')),
  pathExists: vi.fn(async (p) => disco.has(p)),
  readFile: vi.fn(async (p) => { if (!disco.has(p)) throw new Error('ENOENT'); return disco.get(p); }),
  getAvailableProcessors: vi.fn(async () => ['P']),
  createProcessorProject: vi.fn(async () => ({ success: true })),
  deleteProcessor: vi.fn(async () => ({ success: true })),
  renameProcessor: vi.fn(async () => ({ success: true })),
  watchDirectory: vi.fn(async () => {}),
  triggerFileTreeRefresh: vi.fn(async () => {}),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const TabManager = { tabs: new Map(), saveAllFiles: vi.fn(async () => {}), closeTab: vi.fn(async () => {}), addTab: vi.fn() };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));
const painel = { refresh: vi.fn() };
vi.mock('../../js/processors/processor_config_panel.js', () => ({ processorConfigPanel: painel }));
let estrutura;
const SpfStore = {
  read: vi.fn(async () => estrutura),
  update: vi.fn(async (_p, fn) => { fn(estrutura); return estrutura; }),
};
vi.mock('../../js/project/spf_store.js', () => ({ SpfStore }));

let pr;
let ProjectStore;
let api;
const msg = (r) => r.error?.message;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  disco.clear();
  estrutura = { processors: ['P', { name: 'Q', clk: 50, numClocks: 100, language: 'cpp' }] };
  TabManager.tabs = new Map();
  globalThis.window = {};
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  api = await import('../../js/api/api_core.js');
  ({ processadoresDoProjeto: pr } = await import('../../js/api/processadores_ns.js'));
  ProjectStore.setProject('C:/p/p.spf', 'C:/p');
});

describe('listar e criar', () => {
  it('sem projeto, recusam', async () => {
    ProjectStore.clearProject();
    expect(msg(await pr.listProcessors())).toBe('No project open');
    expect(msg(await pr.createProcessor({ processorName: 'X' }))).toBe('No project open');
    expect(msg(await pr.renameProcessor({ processorName: 'P', newName: 'R' }))).toBe('No project open');
    expect(msg(await pr.getProcessorConfig())).toBe('No project open');
    expect(msg(await pr.setProcessorConfig({ processorName: 'P', clk: 1 }))).toBe('No project open');
  });

  it('lista os processadores do projeto aberto', async () => {
    expect((await pr.listProcessors()).data).toEqual(['P']);
    expect(electronAPI.getAvailableProcessors).toHaveBeenCalledWith('C:/p');
    electronAPI.getAvailableProcessors.mockResolvedValueOnce(null);
    expect((await pr.listProcessors()).data).toEqual([]);
    electronAPI.getAvailableProcessors.mockRejectedValueOnce({});
    expect(msg(await pr.listProcessors())).toBe('listProcessors failed');
  });

  it('cria no projeto, repinta e avisa; revive referencia morta do .spf', async () => {
    const ouvinte = vi.fn();
    api.on('project:processor-created', ouvinte);
    const r = await pr.createProcessor({ processorName: 'p', inputPorts: 2 });
    expect(r.data).toEqual({ name: 'p', revivedDanglingReference: true });
    expect(electronAPI.createProcessorProject).toHaveBeenCalledWith({ projectLocation: 'C:/p', processorName: 'p', inputPorts: 2 });
    expect(electronAPI.triggerFileTreeRefresh).toHaveBeenCalled();
    expect(ouvinte).toHaveBeenCalledWith({ name: 'p' });
    electronAPI.getAvailableProcessors.mockRejectedValueOnce(new Error('x'));
    expect((await pr.createProcessor({ processorName: 'Novo' })).data.revivedDanglingReference).toBe(false);
    electronAPI.getAvailableProcessors.mockResolvedValueOnce(null);
    expect((await pr.createProcessor({ processorName: 'Novo' })).data.revivedDanglingReference).toBe(false);
  });

  it('criar recusa sem nome, com pasta existente, e devolve a falha do main', async () => {
    expect(msg(await pr.createProcessor())).toBe('processorName required');
    disco.set('C:/p/P', true);
    expect(msg(await pr.createProcessor({ processorName: 'P' }))).toMatch(/already exists on disk/);
    electronAPI.createProcessorProject.mockResolvedValueOnce({ success: false, message: 'yanc caiu' });
    expect(msg(await pr.createProcessor({ processorName: 'X' }))).toBe('yanc caiu');
    electronAPI.createProcessorProject.mockResolvedValueOnce(null);
    expect(msg(await pr.createProcessor({ processorName: 'X' }))).toBe('createProcessor failed');
    electronAPI.pathExists.mockRejectedValueOnce({});
    expect(msg(await pr.createProcessor({ processorName: 'X' }))).toBe('createProcessor failed');
  });
});

describe('apagar', () => {
  it('apaga pelo main, repinta e avisa', async () => {
    const ouvinte = vi.fn();
    api.on('project:processor-deleted', ouvinte);
    expect((await pr.deleteProcessor('P')).data).toEqual({ processorName: 'P' });
    expect(ouvinte).toHaveBeenCalledWith({ processorName: 'P' });
  });

  it('recusa sem nome, sem o canal, e devolve a falha', async () => {
    expect(msg(await pr.deleteProcessor())).toBe('processorName required');
    electronAPI.deleteProcessor.mockResolvedValueOnce({ success: false, message: 'em uso' });
    expect(msg(await pr.deleteProcessor('P'))).toMatch(/em uso/);
    electronAPI.deleteProcessor.mockRejectedValueOnce(new Error('ipc'));
    expect(msg(await pr.deleteProcessor('P'))).toBe('ipc');
    electronAPI.deleteProcessor.mockRejectedValueOnce({});
    expect(msg(await pr.deleteProcessor('P'))).toBe('deleteProcessor failed');
    const canal = electronAPI.deleteProcessor;
    delete electronAPI.deleteProcessor;
    expect(msg(await pr.deleteProcessor('P'))).toBe('delete-processor IPC unavailable');
    electronAPI.deleteProcessor = canal;
  });
});

describe('renomear', () => {
  it('valida o nome novo e o canal', async () => {
    expect(msg(await pr.renameProcessor())).toBe('processorName required');
    expect(msg(await pr.renameProcessor({ processorName: 'P' }))).toBe('newName required');
    expect(msg(await pr.renameProcessor({ processorName: 'P', newName: 'R 2' }))).toMatch(/only contain/);
    const canal = electronAPI.renameProcessor;
    delete electronAPI.renameProcessor;
    expect(msg(await pr.renameProcessor({ processorName: 'P', newName: 'R' }))).toBe('rename-processor IPC unavailable');
    electronAPI.renameProcessor = canal;
  });

  it('salva, fecha as abas da pasta velha, reabre o .cmm renomeado e religa o vigia', async () => {
    TabManager.tabs = new Map([['C:/p/P/Software/P.cmm', {}], ['C:/p/P/Hardware/P.v', {}], ['C:/p/top.v', {}]]);
    disco.set('C:/p/R/Software/R.cmm', 'codigo');
    const ouvinte = vi.fn();
    api.on('project:processor-renamed', ouvinte);
    const r = await pr.renameProcessor({ processorName: ' P ', newName: 'R' });
    expect(r.data).toEqual({ oldName: 'P', newName: 'R' });
    expect(TabManager.saveAllFiles).toHaveBeenCalled();
    expect(TabManager.closeTab.mock.calls.map(([p]) => p)).toEqual(['C:/p/P/Software/P.cmm', 'C:/p/P/Hardware/P.v']);
    expect(TabManager.addTab).toHaveBeenCalledWith('C:/p/R/Software/R.cmm', 'codigo');
    expect(electronAPI.watchDirectory).toHaveBeenCalledWith('C:/p');
    expect(ouvinte).toHaveBeenCalledWith({ oldName: 'P', newName: 'R' });
  });

  it('usa os nomes e pastas que o main devolve; .cmm que nao existe nao reabre', async () => {
    ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
    TabManager.tabs = new Map([['C:\\p\\p\\Software\\p.cmm', {}]]);
    electronAPI.renameProcessor.mockResolvedValueOnce({ oldName: 'p', newName: 'r', oldDir: 'C:\\p\\p', newDir: 'C:\\p\\r' });
    TabManager.saveAllFiles.mockRejectedValueOnce(new Error('x'));
    electronAPI.watchDirectory.mockRejectedValueOnce(new Error('x'));
    const r = await pr.renameProcessor({ processorName: 'P', newName: 'R' });
    expect(r.data).toEqual({ oldName: 'p', newName: 'r' });
    expect(TabManager.addTab).not.toHaveBeenCalled();
  });

  it('a falha do main volta como erro', async () => {
    electronAPI.renameProcessor.mockResolvedValueOnce({ success: false, message: 'pasta travada' });
    expect(msg(await pr.renameProcessor({ processorName: 'P', newName: 'R' }))).toMatch(/pasta travada/);
    electronAPI.renameProcessor.mockRejectedValueOnce({});
    expect(msg(await pr.renameProcessor({ processorName: 'P', newName: 'R' }))).toBe('renameProcessor failed');
  });
});

describe('config de simulacao', () => {
  it('le de todos, com o cabecalho do fonte quando ele existe', async () => {
    disco.set('C:/p/P/Software/P.cmm', '#NUBITS 32\n');
    const r = await pr.getProcessorConfig();
    expect(r.data.map((c) => c.name)).toEqual(['P', 'Q']);
    expect(r.data[0]).toMatchObject({ name: 'P', clk: 100, numClocks: 2000 });
    expect(r.data[0].header).toMatchObject({ NUBITS: '32' });
    expect(r.data[1]).toMatchObject({ name: 'Q', clk: 50, numClocks: 100, simTime_us: 2 });
    expect(r.data[1].header).toBeUndefined();
  });

  it('le um so pelo nome, e recusa o desconhecido', async () => {
    expect((await pr.getProcessorConfig('Q')).data.name).toBe('Q');
    expect(msg(await pr.getProcessorConfig('Z'))).toBe('unknown processor: Z');
    estrutura = {};
    expect((await pr.getProcessorConfig()).data).toEqual([]);
    SpfStore.read.mockRejectedValueOnce({});
    expect(msg(await pr.getProcessorConfig())).toBe('getProcessorConfig failed');
  });

  it('grava so os campos pedidos, redesenha o painel e avisa', async () => {
    const ouvinte = vi.fn();
    api.on('project:processor-config-changed', ouvinte);
    const r = await pr.setProcessorConfig({ processorName: 'P', clk: '25', numClocks: 99.6, showArrays: 1 });
    expect(r.data).toMatchObject({ name: 'P', clk: 25, numClocks: 100, showArrays: true });
    expect(estrutura.processors[0]).toEqual({ name: 'P', clk: 25, numClocks: 100, showArrays: true });
    expect(estrutura.processors[1]).toMatchObject({ name: 'Q', clk: 50 });
    expect(painel.refresh).toHaveBeenCalled();
    expect(ouvinte).toHaveBeenCalledWith({ processorName: 'P', clk: 25, numClocks: 100, showArrays: true });
    await pr.setProcessorConfig({ processorName: 'Q', clk: 10 });
    expect(estrutura.processors[1]).toMatchObject({ name: 'Q', clk: 10, numClocks: 100, language: 'cpp' });
  });

  it('entrada so com o nome vira objeto; campos ruins e nada a gravar sao recusados', async () => {
    estrutura = { processors: ['P', 'Q'] };
    await pr.setProcessorConfig({ processorName: 'Q', showArrays: false });
    expect(estrutura.processors).toEqual([{ name: 'P' }, { name: 'Q', showArrays: false }]);
    expect(msg(await pr.setProcessorConfig())).toBe('processorName required');
    expect(msg(await pr.setProcessorConfig({ processorName: 'P', clk: 0 }))).toMatch(/clk must be/);
    expect(msg(await pr.setProcessorConfig({ processorName: 'P', numClocks: 'x' }))).toMatch(/numClocks must be/);
    expect(msg(await pr.setProcessorConfig({ processorName: 'P' }))).toMatch(/nothing to update/);
    expect(msg(await pr.setProcessorConfig({ processorName: 'Z', clk: 1 }))).toBe('processor not in this project: Z');
    estrutura = {};
    expect(msg(await pr.setProcessorConfig({ processorName: 'Z', clk: 1 }))).toBe('processor not in this project: Z');
    SpfStore.update.mockRejectedValueOnce({});
    expect(msg(await pr.setProcessorConfig({ processorName: 'P', clk: 1 }))).toBe('setProcessorConfig failed');
  });
});
