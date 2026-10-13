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

  it('os tres passos do processador sao o yanc, com as pastas do yanc v7.1', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    const cmm = await buildSpecForStep('cmm', 'P');
    expect(cmm).toMatchObject({
      step: 'cmm', binary: 'C:/comp/bin/yanc.exe', cwd: 'C:/p/P',
      args: ['-S', '-o', 'C:/p/P/P', '--lang=pt', 'C:/p/P/P.cmm'],
    });
    const cpp = await buildSpecForStep('cpp', 'P');
    expect(cpp).toMatchObject({ step: 'cpp', args: ['-S', '-o', 'C:/p/P/P', '--lang=pt', 'C:/p/P/P.cmm'] });
    const asm = await buildSpecForStep('asm', 'P');
    expect(asm).toMatchObject({
      step: 'asm', binary: 'C:/comp/bin/yanc.exe', cwd: 'C:/p/P/P',
      args: ['-f', '10', '-c', '5', '--lang=pt', 'C:/p/P/P/P.asm'],
    });
  });

  it('o idioma do toggle vira o --lang da previa', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    window.getYancLang = () => 'en';
    expect((await buildSpecForStep('asm', 'P')).args).toContain('--lang=en');
  });

  it('passo do fluxo inteiro le o .spf aberto e roda na pasta do projeto', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    const spec = await buildSpecForStep('iverilog-check');
    expect(lidos).toEqual(['C:/p/p.spf']);
    expect(spec.cwd).toBe('C:/p');
  });
});
