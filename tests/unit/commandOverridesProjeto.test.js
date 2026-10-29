// command_overrides: a camada persistida mora no .spf do projeto aberto, o
// que o ProjectStore diz estar aberto.

import { describe, expect, it, vi, beforeEach } from 'vitest';

let arquivos;
vi.mock('../../js/project/spf_store.js', () => ({
  SpfStore: {
    read: async (p) => arquivos[p] ?? {},
    update: async (p, fn) => { const s = arquivos[p] ?? (arquivos[p] = {}); fn(s); },
  },
}));

let co;
let ProjectStore;

beforeEach(async () => {
  vi.resetModules();
  arquivos = {};
  globalThis.window = {};
  // As decisoes de aceitar um override do .spf ficam no localStorage.
  const guardado = new Map();
  globalThis.localStorage = {
    getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
    setItem: (k, v) => { guardado.set(k, String(v)); },
  };
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  co = await import('../../js/compilation/command_overrides.js');
});

describe('overrides persistidos e o projeto aberto', () => {
  it('sem projeto, persistir recusa e a lista traz so os da memoria', async () => {
    await expect(co.setOverride({ step: 'cmm', override: { appendArgs: ['-x'] }, persist: true }))
      .rejects.toThrow('No project is open');
    await co.setOverride({ step: 'cmm', override: { appendArgs: ['-y'] } });
    const lista = await co.listOverrides();
    expect(lista.map((e) => e.scope)).toEqual(['ephemeral']);
  });

  it('com projeto, grava no .spf aberto e le de volta dele', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    await co.setOverride({ step: 'asm', processorName: 'P', override: { appendArgs: ['-z'] }, persist: true });
    expect(arquivos['C:/p/p.spf'].commandOverrides['asm:P'].appendArgs).toEqual(['-z']);
    const { override, sources } = await co.resolveOverride('asm', 'P');
    expect(override.appendArgs).toEqual(['-z']);
    expect(sources).toEqual([{ source: 'persisted:processor', key: 'asm:P' }]);
  });

  it('outro projeto aberto nao ve o override do anterior', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    await co.setOverride({ step: 'asm', override: { appendArgs: ['-z'] }, persist: true });
    ProjectStore.setProject('C:/q/q.spf', 'C:/q');
    expect(await co.listOverrides()).toEqual([]);
  });

  it('o override que veio no .spf so vale depois de aceito nesta maquina', async () => {
    arquivos['C:/p/p.spf'] = { commandOverrides: { 'vvp-run': { appendArgs: ['-m', 'C:/de/fora/vpi'], scope: 'persisted' } } };
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    expect((await co.resolveOverride('vvp-run', null)).override).toBeNull();
    expect(await co.listOverrides()).toEqual([]);

    const { decidir } = await import('../../js/compilation/overrides_aprovados.js');
    decidir([['vvp-run', arquivos['C:/p/p.spf'].commandOverrides['vvp-run']]], 'ignorar', 'C:/p');
    expect((await co.resolveOverride('vvp-run', null)).override).toBeNull();
    decidir([['vvp-run', arquivos['C:/p/p.spf'].commandOverrides['vvp-run']]], 'aplicar', 'C:/p');
    expect((await co.resolveOverride('vvp-run', null)).override.appendArgs).toEqual(['-m', 'C:/de/fora/vpi']);

    // Trocado no .spf depois de aceito: volta a nao valer.
    arquivos['C:/p/p.spf'].commandOverrides['vvp-run'].appendArgs = ['-m', 'C:/outro/vpi'];
    expect((await co.resolveOverride('vvp-run', null)).override).toBeNull();
  });

  it('o aceito continua valendo com o projeto em outra pasta', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    await co.setOverride({ step: 'cocotb-run', override: { envSet: { DADOS: 'C:/p/dados' } }, persist: true });
    // O main reescreve os caminhos do override quando o projeto muda de pasta.
    arquivos['D:/novo/p.spf'] = { commandOverrides: { 'cocotb-run': { envSet: { DADOS: 'D:\\novo\\dados' }, scope: 'persisted' } } };
    ProjectStore.setProject('D:/novo/p.spf', 'D:/novo');
    expect((await co.resolveOverride('cocotb-run', null)).override.envSet).toEqual({ DADOS: 'D:\\novo\\dados' });
  });
});
