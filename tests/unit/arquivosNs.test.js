// @vitest-environment happy-dom
//
// Os arquivos do projeto (js/api/arquivos_ns): ler, criar, apagar, renomear,
// importar para o .spf, os que sumiram do disco, repintar e trocar de vista.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const disco = new Map();
const electronAPI = {
  readFile: vi.fn(async (p) => { if (!disco.has(p)) throw new Error('ENOENT'); return disco.get(p); }),
  writeFile: vi.fn(async (p, c) => { disco.set(p, c); }),
  mkdir: vi.fn(async () => {}),
  copyFile: vi.fn(async (a, b) => { disco.set(b, disco.get(a)); }),
  deleteFileOrDirectory: vi.fn(async (p) => { disco.delete(p); }),
  triggerFileTreeRefresh: vi.fn(async () => {}),
  getFolderFiles: vi.fn(async (d) => [...disco.keys()]
    .filter((k) => k.startsWith(`${d}\\`) && !k.slice(d.length + 1).includes('\\'))
    .map((k) => ({ path: k }))
    .concat(d === 'C:\\p' ? [{ path: 'C:\\p\\sub', isDirectory: true }] : [])),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const modelos = new Map();
vi.mock('../../js/editor/shared_models.js', () => ({ SharedModelRegistry: { getModel: (p) => modelos.get(p) ?? null } }));
const EditorManager = { activeEditor: null };
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: {} }));
let cfg;
const SpfStore = { update: vi.fn(async (_p, fn) => { fn(cfg); return cfg; }) };
vi.mock('../../js/project/spf_store.js', () => ({ SpfStore }));

let arq;
let ProjectStore;
let api;
const msg = (r) => r.error?.message;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  disco.clear();
  modelos.clear();
  cfg = {};
  EditorManager.activeEditor = null;
  document.body.innerHTML = '';
  for (const k of ['projectTreeManager', 'fileTreeViewController']) delete window[k];
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  api = await import('../../js/api/api_core.js');
  ({ arquivosDoProjeto: arq } = await import('../../js/api/arquivos_ns.js'));
  ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
  disco.set('C:\\p\\top.v', 'module top;');
  disco.set('C:\\p\\sub\\fundo.v', 'module fundo;');
});

describe('readFile', () => {
  it('le relativo ou absoluto dentro do projeto', async () => {
    expect((await arq.readFile('top.v')).data).toEqual({ filePath: 'C:\\p\\top.v', content: 'module top;', length: 11, truncated: false });
    expect((await arq.readFile('C:\\p\\top.v')).data.filePath).toBe('C:\\p\\top.v');
  });

  it('recusa sem caminho, sem projeto, com .. ou fora do projeto', async () => {
    expect(msg(await arq.readFile())).toBe('filePath required');
    expect(msg(await arq.readFile('..\\x'))).toMatch(/must not contain/);
    expect(msg(await arq.readFile('C:\\p2\\top.v'))).toBe('file is outside the open project folder');
    ProjectStore.clearProject();
    expect(msg(await arq.readFile('top.v'))).toBe('No project open');
  });

  it('o que esta aberto vem do editor, e o que e grande vem cortado', async () => {
    modelos.set('C:\\p\\top.v', { getValue: () => 'novo' });
    expect((await arq.readFile('top.v')).data).toMatchObject({ content: 'novo', fromEditor: true, truncated: false });
    const grande = 'x'.repeat(300 * 1024);
    modelos.set('C:\\p\\top.v', { getValue: () => grande });
    expect((await arq.readFile('top.v')).data).toMatchObject({ truncated: true, fromEditor: true, length: grande.length });
    modelos.clear();
    disco.set('C:\\p\\g.v', grande);
    const r = (await arq.readFile('g.v')).data;
    expect(r.truncated).toBe(true);
    expect(r.content).toHaveLength(256 * 1024);
  });

  it('caminho que erra procura pelo nome; sem achar, explica; leitura vazia vira texto vazio', async () => {
    expect((await arq.readFile('fundo.v')).data.filePath).toBe('C:\\p\\sub\\fundo.v');
    expect(msg(await arq.readFile('sumiu.v'))).toMatch(/File not found: "sumiu.v"/);
    electronAPI.readFile.mockResolvedValueOnce(null);
    expect((await arq.readFile('top.v')).data.content).toBe('');
  });
});

describe('createFile', () => {
  it('escreve, repinta e avisa', async () => {
    const ouvinte = vi.fn();
    api.on('project:file-created', ouvinte);
    expect((await arq.createFile('C:\\p\\n.txt', 'oi')).data).toEqual({ filePath: 'C:\\p\\n.txt' });
    expect(disco.get('C:\\p\\n.txt')).toBe('oi');
    expect(electronAPI.triggerFileTreeRefresh).toHaveBeenCalled();
    expect(ouvinte).toHaveBeenCalled();
    await arq.createFile('C:\\p\\vazio.txt', null);
    expect(disco.get('C:\\p\\vazio.txt')).toBe('');
  });

  it('Verilog novo entra nos sintetizaveis do .spf, uma vez so', async () => {
    cfg = { synthesizableFiles: [], testbenchFiles: [{ path: 'C:/p/tb.v' }] };
    await arq.createFile('C:\\p\\alu.v', 'module alu;');
    expect(cfg.synthesizableFiles).toEqual([{ name: 'alu.v', path: 'C:\\p\\alu.v', isTopLevel: false }]);
    await arq.createFile('C:\\p\\ALU.v', 'module alu;');
    await arq.createFile('C:\\p\\tb.v', 'module tb;');
    expect(cfg.synthesizableFiles).toHaveLength(1);
    cfg = {};
    await arq.createFile('C:\\p\\x.sv', '');
    expect(cfg.synthesizableFiles).toHaveLength(1);
  });

  it('Verilog sem projeto aberto e so escrito e repintado', async () => {
    ProjectStore.clearProject();
    await arq.createFile('C:\\p\\alu.v', 'x');
    expect(SpfStore.update).not.toHaveBeenCalled();
    expect(electronAPI.triggerFileTreeRefresh).toHaveBeenCalled();
  });

  it('reescrever o arquivo aberto troca o buffer e passa a varinha', async () => {
    const setValue = vi.fn();
    EditorManager.activeEditor = {
      getModel: () => ({ uri: { fsPath: 'c:/p/n.txt' }, setValue, getLineCount: () => 1 }),
      getDomNode: () => null,
      deltaDecorations: vi.fn(() => []),
    };
    await arq.createFile('C:\\p\\n.txt', 'novo');
    expect(setValue).toHaveBeenCalledWith('novo');
    EditorManager.activeEditor = { getModel: () => { throw new Error('x'); } };
    expect((await arq.createFile('C:\\p\\n.txt', 'a')).ok).toBe(true);
    EditorManager.activeEditor = { getModel: () => ({ uri: { path: '/outro' }, setValue }) };
    setValue.mockClear();
    await arq.createFile('C:\\p\\n.txt', 'b');
    expect(setValue).not.toHaveBeenCalled();
  });

  it('recusa sem caminho, e devolve a falha de escrita', async () => {
    expect(msg(await arq.createFile())).toBe('filePath required');
    electronAPI.writeFile.mockRejectedValueOnce(new Error('protegido'));
    expect(msg(await arq.createFile('C:\\p\\a'))).toBe('protegido');
    electronAPI.writeFile.mockRejectedValueOnce({});
    expect(msg(await arq.createFile('C:\\p\\a'))).toBe('createFile failed');
  });
});

describe('pasta, apagar e renomear', () => {
  it('cria pasta, apaga e renomeia, repintando e avisando', async () => {
    expect((await arq.createFolder('C:\\p\\d')).data).toEqual({ dirPath: 'C:\\p\\d' });
    const apagou = vi.fn();
    api.on('project:file-deleted', apagou);
    expect((await arq.deleteFile('C:\\p\\top.v')).data).toEqual({ filePath: 'C:\\p\\top.v' });
    expect(disco.has('C:\\p\\top.v')).toBe(false);
    expect(apagou).toHaveBeenCalled();
    const renomeou = vi.fn();
    api.on('project:file-renamed', renomeou);
    expect((await arq.renameFile('C:\\p\\sub\\fundo.v', 'C:\\p\\f.v')).data).toEqual({ fromPath: 'C:\\p\\sub\\fundo.v', toPath: 'C:\\p\\f.v' });
    expect(disco.get('C:\\p\\f.v')).toBe('module fundo;');
    expect(renomeou).toHaveBeenCalled();
  });

  it('recusas e falhas', async () => {
    expect(msg(await arq.createFolder())).toBe('dirPath required');
    expect(msg(await arq.deleteFile())).toBe('filePath required');
    expect(msg(await arq.renameFile('a'))).toBe('fromPath and toPath required');
    electronAPI.mkdir.mockRejectedValueOnce({});
    expect(msg(await arq.createFolder('d'))).toBe('createFolder failed');
    electronAPI.deleteFileOrDirectory.mockRejectedValueOnce({});
    expect(msg(await arq.deleteFile('a'))).toBe('deleteFile failed');
    electronAPI.copyFile.mockRejectedValueOnce(new Error('disco cheio'));
    expect(msg(await arq.renameFile('a', 'b'))).toBe('disco cheio');
    electronAPI.copyFile.mockRejectedValueOnce({});
    expect(msg(await arq.renameFile('a', 'b'))).toBe('renameFile failed');
  });
});

describe('arquivos que sumiram do disco', () => {
  it('lista o que a arvore diz, ou nada sem arvore', async () => {
    expect((await arq.getMissingFiles()).data).toEqual({ count: 0, files: [] });
    window.projectTreeManager = { missingFiles: [{ name: 'a.v', path: 'C:/p/a.v', category: 'synth', extra: 1 }, { name: 'b.v', path: 'C:/p/b.v' }] };
    expect((await arq.getMissingFiles()).data).toEqual({
      count: 2,
      files: [{ name: 'a.v', path: 'C:/p/a.v', category: 'synth' }, { name: 'b.v', path: 'C:/p/b.v', category: null }],
    });
  });

  it('dispensar poda pelo gerenciador e avisa; sem ele, ou com falha, erro', async () => {
    expect(msg(await arq.dismissMissingFiles())).toBe('project tree not available');
    const ouvinte = vi.fn();
    api.on('project:missing-files-dismissed', ouvinte);
    window.projectTreeManager = { dismissMissingFiles: vi.fn(async () => 3) };
    expect((await arq.dismissMissingFiles()).data).toEqual({ removed: 3 });
    expect(ouvinte).toHaveBeenCalledWith({ removed: 3 });
    window.projectTreeManager.dismissMissingFiles.mockRejectedValueOnce({});
    expect(msg(await arq.dismissMissingFiles())).toBe('dismissMissingFiles failed');
  });
});

describe('importar, tirar e renomear no .spf', () => {
  it('importar de fora copia para a raiz e registra; .py vira testbench', async () => {
    disco.set('D:\\lib\\uart.v', 'module uart;');
    disco.set('D:\\lib\\test_top.py', 'import cocotb');
    cfg = { synthesizableFiles: [] };
    const ouvinte = vi.fn();
    api.on('project:file-imported', ouvinte);
    expect((await arq.importFile({ filePath: 'D:\\lib\\uart.v' })).data).toEqual({ filePath: 'C:\\p\\uart.v', kind: 'synthesizable' });
    expect(disco.get('C:\\p\\uart.v')).toBe('module uart;');
    expect(cfg.synthesizableFiles).toEqual([{ name: 'uart.v', path: 'C:\\p\\uart.v', isTopLevel: false }]);
    expect((await arq.importFile({ filePath: 'D:\\lib\\test_top.py' })).data.kind).toBe('testbench');
    expect(cfg.testbenchFiles).toHaveLength(1);
    expect(ouvinte).toHaveBeenCalledTimes(2);
  });

  it('importar o que ja esta no projeto nao copia nem duplica; tipo explicito vale', async () => {
    cfg = { testbenchFiles: [{ path: 'C:/p/top.v' }] };
    expect((await arq.importFile({ filePath: 'C:\\p\\top.v', kind: 'testbench' })).data.filePath).toBe('C:\\p\\top.v');
    expect(electronAPI.copyFile).not.toHaveBeenCalled();
    expect(cfg.testbenchFiles).toHaveLength(1);
    ProjectStore.setProject('C:/q/q.spf', 'C:/q');
    disco.set('D:/x.v', '');
    expect((await arq.importFile({ filePath: 'D:/x.v' })).data.filePath).toBe('C:/q/x.v');
  });

  it('tirar do .spf, e opcionalmente do disco', async () => {
    cfg = { synthesizableFiles: [{ path: 'C:\\p\\top.v' }, { path: 'C:\\p\\b.v' }] };
    const r = await arq.removeImportedFile({ filePath: 'c:/P/top.v' });
    expect(r.data).toEqual({ filePath: 'c:/P/top.v', removed: true, deletedFromDisk: false });
    expect(cfg.synthesizableFiles).toEqual([{ path: 'C:\\p\\b.v' }]);
    expect(cfg.testbenchFiles).toEqual([]);
    electronAPI.deleteFileOrDirectory.mockRejectedValueOnce(new Error('travado'));
    const r2 = await arq.removeImportedFile({ filePath: 'C:\\p\\b.v', deleteFromDisk: true });
    expect(r2.data).toEqual({ filePath: 'C:\\p\\b.v', removed: true, deletedFromDisk: true });
    expect((await arq.removeImportedFile({ filePath: 'C:\\p\\nada.v' })).data.removed).toBe(false);
  });

  it('renomear no disco e no .spf', async () => {
    cfg = { synthesizableFiles: [{ name: 'top.v', path: 'C:\\p\\top.v' }, { path: 'C:\\p\\b.v' }] };
    const r = await arq.renameImportedFile({ fromPath: 'C:\\p\\top.v', toPath: 'C:\\p\\topo.v' });
    expect(r.data).toEqual({ fromPath: 'C:\\p\\top.v', toPath: 'C:\\p\\topo.v' });
    expect(cfg.synthesizableFiles[0]).toEqual({ name: 'topo.v', path: 'C:\\p\\topo.v' });
    expect(cfg.testbenchFiles).toEqual([]);
    expect(disco.get('C:\\p\\topo.v')).toBe('module top;');
  });

  it('as tres recusam sem caminho ou sem projeto, e devolvem a falha', async () => {
    expect(msg(await arq.importFile())).toBe('filePath required');
    expect(msg(await arq.removeImportedFile())).toBe('filePath required');
    expect(msg(await arq.renameImportedFile({ fromPath: 'a' }))).toBe('fromPath and toPath required');
    SpfStore.update.mockRejectedValueOnce({});
    expect(msg(await arq.importFile({ filePath: 'C:\\p\\top.v' }))).toBe('importFile failed');
    SpfStore.update.mockRejectedValueOnce({});
    expect(msg(await arq.removeImportedFile({ filePath: 'a' }))).toBe('removeImportedFile failed');
    electronAPI.copyFile.mockRejectedValueOnce({});
    expect(msg(await arq.renameImportedFile({ fromPath: 'a', toPath: 'b' }))).toBe('renameImportedFile failed');
    ProjectStore.clearProject();
    for (const r of [
      await arq.importFile({ filePath: 'a' }), await arq.removeImportedFile({ filePath: 'a' }),
      await arq.renameImportedFile({ fromPath: 'a', toPath: 'b' }),
    ]) expect(msg(r)).toBe('No project open');
  });

  it('importar com o .spf aberto e sem a raiz do projeto recusa', async () => {
    const spy = vi.spyOn(ProjectStore, 'getProjectPath').mockReturnValue(null);
    expect(msg(await arq.importFile({ filePath: 'a.v' }))).toBe('Project root unavailable');
    spy.mockRestore();
  });
});

describe('arvore e vista', () => {
  it('repintar pede ao main e a arvore, e avisa', async () => {
    const recarregar = vi.fn(async () => {});
    window.projectTreeManager = { refreshTree: recarregar };
    const ouvinte = vi.fn();
    api.on('project:tree-refreshed', ouvinte);
    expect((await arq.refreshTree()).ok).toBe(true);
    expect(recarregar).toHaveBeenCalled();
    expect(ouvinte).toHaveBeenCalled();
    electronAPI.triggerFileTreeRefresh.mockRejectedValueOnce(new Error('x'));
    expect((await arq.refreshTree()).ok).toBe(true);
    recarregar.mockRejectedValueOnce(new Error('arvore quebrada'));
    expect(msg(await arq.refreshTree())).toBe('arvore quebrada');
    recarregar.mockRejectedValueOnce({});
    expect(msg(await arq.refreshTree())).toBe('refreshTree failed');
  });

  it('trocar de vista e ler a vista', async () => {
    expect(msg(await arq.setView('file'))).toBe('file tree controller not initialised');
    expect((await arq.getView()).data).toEqual({ view: 'unknown', hierarchyAvailable: false });
    const ctl = { showFileMode: vi.fn(), showHierarchyMode: vi.fn(() => true), getActiveView: vi.fn(() => 'hierarchy'), getHierarchyData: vi.fn(() => null) };
    window.fileTreeViewController = ctl;
    expect((await arq.setView('files')).data).toEqual({ view: 'hierarchy' });
    expect(msg(await arq.setView('hierarchy'))).toMatch(/only available after a successful Verilog compilation/);
    ctl.getHierarchyData.mockReturnValue({});
    expect((await arq.setView('hierarchical')).data).toEqual({ view: 'hierarchy' });
    ctl.showHierarchyMode.mockReturnValueOnce(false);
    expect(msg(await arq.setView('hierarchy'))).toBe('could not switch to hierarchy view');
    expect(msg(await arq.setView('lado'))).toMatch(/unknown view: lado/);
    expect((await arq.getView()).data).toEqual({ view: 'hierarchy', hierarchyAvailable: true });
    ctl.getActiveView.mockReturnValue(undefined);
    expect((await arq.setView('verilog')).data).toEqual({ view: 'verilog' });
    expect((await arq.getView()).data.view).toBe('verilog');
  });
});
