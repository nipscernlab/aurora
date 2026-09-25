// A arvore do projeto (js/api/arvore_do_projeto): a lista plana de arquivos e
// a busca de um arquivo pelo nome que a IA deu.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const pastas = new Map();
const arquivos = new Set();
const electronAPI = {
  getFolderFiles: vi.fn(async (d) => pastas.get(d) ?? []),
  readFile: vi.fn(async (p) => { if (!arquivos.has(p)) throw new Error('ENOENT'); return ''; }),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

let arv;
let ProjectStore;

function montar(estrutura, raiz = 'C:\\p') {
  for (const [rel, filhos] of Object.entries(estrutura)) {
    const dir = rel ? `${raiz}\\${rel}` : raiz;
    pastas.set(dir, filhos.map((f) => {
      const abs = `${dir}\\${f.replace(/\/$/, '')}`;
      if (!f.endsWith('/')) arquivos.add(abs);
      return { path: abs, isDirectory: f.endsWith('/') };
    }));
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  pastas.clear();
  arquivos.clear();
  globalThis.window = {};
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  arv = await import('../../js/api/arvore_do_projeto.js');
  ProjectStore.clearProject();
  montar({
    '': ['top.v', 'P/', 'Sim/'],
    P: ['Software/', 'Hardware/'],
    'P\\Software': ['P.cmm', 'util.cmm'],
    'P\\Hardware': ['P.v'],
    Sim: ['tb.v', 'Deep/'],
    'Sim\\Deep': ['util.cmm'],
  });
});

describe('listarArquivosDoProjeto', () => {
  it('sem raiz e sem projeto, recusa; com projeto aberto, lista a partir dele', async () => {
    expect((await arv.listarArquivosDoProjeto()).error.message).toBe('No project open');
    ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
    expect((await arv.listarArquivosDoProjeto()).data).toEqual([
      'top.v', 'P/Software/P.cmm', 'P/Software/util.cmm', 'P/Hardware/P.v', 'Sim/tb.v', 'Sim/Deep/util.cmm',
    ]);
  });

  it('pasta que nao se le, ou que volta sem entradas, e pulada', async () => {
    electronAPI.getFolderFiles.mockImplementation(async (d) => {
      if (d === 'C:\\p\\P') throw new Error('negado');
      if (d === 'C:\\p\\Sim') return null;
      return pastas.get(d) ?? [];
    });
    expect((await arv.listarArquivosDoProjeto('C:\\p')).data).toEqual(['top.v']);
    electronAPI.getFolderFiles.mockImplementation(async (d) => pastas.get(d) ?? []);
  });

  it('nao desce mais que oito pastas', async () => {
    pastas.clear();
    let dir = 'C:\\q';
    for (let i = 0; i < 12; i++) {
      pastas.set(dir, [{ path: `${dir}\\f${i}.v` }, { path: `${dir}\\d`, isDirectory: true }]);
      dir = `${dir}\\d`;
    }
    const lista = (await arv.listarArquivosDoProjeto('C:\\q')).data;
    expect(lista).toHaveLength(9);
  });
});

describe('acharArquivoNoProjeto', () => {
  const ROOT = 'C:\\p';

  it('sem caminho ou sem raiz, null', async () => {
    expect(await arv.acharArquivoNoProjeto('', ROOT)).toBeNull();
    expect(await arv.acharArquivoNoProjeto('top.v', null)).toBeNull();
  });

  it('o caminho como veio, relativo ou absoluto, quando existe', async () => {
    expect(await arv.acharArquivoNoProjeto('top.v', ROOT)).toBe('C:\\p\\top.v');
    expect(await arv.acharArquivoNoProjeto('/P/Hardware/P.v', ROOT)).toBe('C:\\p\\P\\Hardware\\P.v');
    expect(await arv.acharArquivoNoProjeto('C:\\p\\Sim\\tb.v', ROOT)).toBe('C:\\p\\Sim\\tb.v');
  });

  it('absoluto que nao existe nao procura', async () => {
    expect(await arv.acharArquivoNoProjeto('C:\\p\\nada.v', ROOT)).toBeNull();
    expect(electronAPI.getFolderFiles).not.toHaveBeenCalled();
  });

  it('procura na arvore: caminho exato sem caixa, pedaco final, e nome solto (o mais raso vence)', async () => {
    expect(await arv.acharArquivoNoProjeto('p/software/p.CMM', ROOT)).toBe('C:\\p\\P\\Software\\P.cmm');
    expect(await arv.acharArquivoNoProjeto('Deep/util.cmm', ROOT)).toBe('C:\\p\\Sim\\Deep\\util.cmm');
    expect(await arv.acharArquivoNoProjeto('UTIL.cmm', ROOT)).toBe('C:\\p\\P\\Software\\util.cmm');
    expect(await arv.acharArquivoNoProjeto('sumiu.v', ROOT)).toBeNull();
  });
});
