// spec_factory: de onde sai o projeto aberto. O previa do comando tem de usar
// o mesmo projeto e o mesmo .spf que o ProjectStore diz estarem abertos.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const electronAPI = {
  getComponentsPath: async () => 'C:/comp',
  joinPath: async (...p) => p.join('/'),
  dirname: async (p) => p.split('/').slice(0, -1).join('/'),
};
const lidos = [];
const estrutura = {
  processors: [{ name: 'P', clk: 10, numClocks: 5 }],
  synthesizableFiles: ['C:/p/top.v'],
  topLevelFile: 'C:/p/top.v',
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
vi.mock('../../js/project/spf_store.js', () => ({
  SpfStore: { read: async (p) => { lidos.push(p); return estrutura; } },
}));

let buildSpecForStep;
let ProjectStore;

beforeEach(async () => {
  vi.resetModules();
  lidos.length = 0;
  globalThis.window = {};
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  ({ buildSpecForStep } = await import('../../js/compilation/spec_factory.js'));
});

describe('buildSpecForStep e o projeto aberto', () => {
  it('sem projeto aberto, recusa', async () => {
    await expect(buildSpecForStep('cmm', 'P')).rejects.toThrow('No project is open');
  });

  it('passo do processador le o .spf aberto e monta dentro da pasta do projeto', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    const spec = await buildSpecForStep('cmm', 'P');
    expect(lidos).toContain('C:/p/p.spf');
    expect(JSON.stringify(spec)).toContain('C:/p/P');
  });

  it('passo do fluxo inteiro le o .spf aberto e roda na pasta do projeto', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    const spec = await buildSpecForStep('iverilog-check');
    expect(lidos).toEqual(['C:/p/p.spf']);
    expect(spec.cwd).toBe('C:/p');
  });
});
