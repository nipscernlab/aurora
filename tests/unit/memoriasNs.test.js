// As memorias do projeto (js/api/memorias_ns): listar, gravar e esquecer, em
// <projeto>/.aurora/memory, sempre no projeto que o ProjectStore diz aberto.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const disco = new Map();
const electronAPI = {
  joinPath: vi.fn(async (...p) => p.join('/')),
  fileExists: vi.fn(async (p) => disco.has(p) || [...disco.keys()].some((k) => k.startsWith(`${p}/`))),
  listFilesInDirectory: vi.fn(async (d) => [...disco.keys()].filter((k) => k.startsWith(`${d}/`)).map((k) => k.slice(d.length + 1))),
  readFile: vi.fn(async (p) => disco.get(p)),
  createDirectory: vi.fn(async () => {}),
  writeFile: vi.fn(async (p, c) => { disco.set(p, c); }),
  deleteFile: vi.fn(async (p) => { disco.delete(p); }),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

let mem;
let ProjectStore;
let api;
const DIR = 'C:/p/.aurora/memory';
const msg = (r) => r.error?.message;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  disco.clear();
  globalThis.window = globalThis.window || {};
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  api = await import('../../js/api/api_core.js');
  ({ memoriasDoProjeto: mem } = await import('../../js/api/memorias_ns.js'));
  ProjectStore.setProject('C:/p/p.spf', 'C:/p');
});

describe('memorias do projeto', () => {
  it('sem projeto aberto, as tres recusam', async () => {
    ProjectStore.clearProject();
    for (const r of [await mem.listMemories(), await mem.remember('a', 'b'), await mem.forget('a')]) {
      expect(msg(r)).toBe('No project open');
    }
  });

  it('sem a pasta, lista vazia', async () => {
    expect((await mem.listMemories()).data).toEqual({ count: 0, memories: [] });
  });

  it('grava com o nome virado slug, avisa, e lista so os .md', async () => {
    const ouvinte = vi.fn();
    api.on('project:memory-written', ouvinte);
    const r = await mem.remember('Clock do Processador!', '  100 MHz  ');
    expect(r.data).toEqual({ name: 'clock-do-processador', path: `${DIR}/clock-do-processador.md` });
    expect(disco.get(`${DIR}/clock-do-processador.md`)).toBe('100 MHz\n');
    expect(electronAPI.createDirectory).toHaveBeenCalledWith(DIR);
    expect(ouvinte).toHaveBeenCalledWith({ name: 'clock-do-processador', path: `${DIR}/clock-do-processador.md` });
    disco.set(`${DIR}/notas.txt`, 'fora');
    disco.set(`${DIR}/vazia.md`, '');
    const l = await mem.listMemories();
    expect(l.data).toEqual({
      count: 2,
      memories: [{ name: 'clock-do-processador', content: '100 MHz\n' }, { name: 'vazia', content: '' }],
    });
  });

  it('entrada de listagem como objeto, e memoria que nao se le fica de fora', async () => {
    electronAPI.fileExists.mockResolvedValueOnce(true);
    electronAPI.listFilesInDirectory.mockResolvedValueOnce([{ name: 'a.md' }, { name: 'b.md' }, {}]);
    electronAPI.readFile.mockResolvedValueOnce('fato').mockRejectedValueOnce(new Error('trancado'));
    expect((await mem.listMemories()).data).toEqual({ count: 1, memories: [{ name: 'a', content: 'fato' }] });
    electronAPI.fileExists.mockResolvedValueOnce(true);
    electronAPI.listFilesInDirectory.mockResolvedValueOnce(null);
    expect((await mem.listMemories()).data.count).toBe(0);
  });

  it('gravar recusa nome sem nada aproveitavel e conteudo vazio', async () => {
    expect(msg(await mem.remember('../', 'x'))).toBe('name required');
    expect(msg(await mem.remember(42, 'x'))).toBe('name required');
    expect(msg(await mem.remember('a', '   '))).toBe('content required');
    expect(msg(await mem.remember('a', 7))).toBe('content required');
  });

  it('esquecer apaga e avisa; o que nao existe volta removed:false', async () => {
    await mem.remember('a', 'x');
    const ouvinte = vi.fn();
    api.on('project:memory-forgotten', ouvinte);
    expect((await mem.forget('a')).data).toEqual({ name: 'a', removed: true });
    expect(disco.has(`${DIR}/a.md`)).toBe(false);
    expect(ouvinte).toHaveBeenCalledWith({ name: 'a' });
    expect((await mem.forget('a')).data).toEqual({ name: 'a', removed: false });
    expect(msg(await mem.forget('///'))).toBe('name required');
  });

  it('falha de disco vira erro com a mensagem, ou a do metodo', async () => {
    electronAPI.joinPath.mockRejectedValueOnce(new Error('ipc'));
    expect(msg(await mem.listMemories())).toBe('ipc');
    electronAPI.joinPath.mockRejectedValueOnce({});
    expect(msg(await mem.listMemories())).toBe('listMemories failed');
    electronAPI.writeFile.mockRejectedValueOnce(new Error('cheio'));
    expect(msg(await mem.remember('a', 'x'))).toBe('cheio');
    electronAPI.writeFile.mockRejectedValueOnce({});
    expect(msg(await mem.remember('a', 'x'))).toBe('remember failed');
    electronAPI.joinPath.mockRejectedValueOnce(new Error('ipc'));
    expect(msg(await mem.forget('a'))).toBe('ipc');
    electronAPI.joinPath.mockRejectedValueOnce({});
    expect(msg(await mem.forget('a'))).toBe('forget failed');
  });
});
