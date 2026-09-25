// A pre-compilacao dos processadores (js/compilation/precompilacao): quais
// processadores entram, em que projeto se procura o fonte, e o que se pula.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const existe = new Set();
const electronAPI = {
  joinPath: async (...p) => p.join('/'),
  fileExists: vi.fn(async (p) => existe.has(p)),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

let pre;
let ProjectStore;
let cancelamento;

function compilador(processors, projectPath = 'C:/p') {
  const feito = [];
  return {
    feito,
    projectPath,
    projectConfig: processors === undefined ? null : { processors },
    initializeComponentsPath: vi.fn(async () => {}),
    ensureDirectories: vi.fn(async (n) => { feito.push(`dirs:${n}`); }),
    cmmCompilation: vi.fn(async (p) => { feito.push(`cmm:${p.name}:${p.sourceFile}`); return 'x.asm'; }),
    cppCompilation: vi.fn(async (p) => { feito.push(`cpp:${p.name}:${p.sourceFile}`); return 'x.asm'; }),
    asmCompilation: vi.fn(async (p) => { feito.push(`asm:${p.name}:${p.clk}`); }),
  };
}

const linhas = [];
const tm = { appendToTerminal: (t, texto, tipo) => linhas.push({ t, texto, tipo }) };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  existe.clear();
  linhas.length = 0;
  globalThis.window = { availableProcessors: [] };
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  cancelamento = await import('../../js/compilation/cancelamento.js');
  pre = await import('../../js/compilation/precompilacao.js');
});

describe('findProcessorForPath', () => {
  const procs = ['Proc', { name: 'Outro', clk: 10 }];
  it('acha pelo segmento da pasta, sem caixa e com barra invertida', () => {
    expect(pre.findProcessorForPath('C:\\P\\proc\\Software\\proc.cmm', 'C:/p', procs)).toEqual({ name: 'Proc' });
    expect(pre.findProcessorForPath('C:/p/outro/Hardware/o.v', 'C:/p', procs)).toEqual({ name: 'Outro', clk: 10 });
  });
  it('fora do projeto, fora das tres subpastas, raso demais ou sem par, null', () => {
    expect(pre.findProcessorForPath('D:/x/Proc/Software/a.cmm', 'C:/p', procs)).toBeNull();
    expect(pre.findProcessorForPath('C:/p/Proc/Docs/a.cmm', 'C:/p', procs)).toBeNull();
    expect(pre.findProcessorForPath('C:/p/Proc/a.cmm', 'C:/p', procs)).toBeNull();
    expect(pre.findProcessorForPath('C:/p/Nada/Software/a.cmm', 'C:/p', procs)).toBeNull();
    expect(pre.findProcessorForPath(null, 'C:/p', procs)).toBeNull();
    expect(pre.findProcessorForPath('C:/p/Proc/Software/a.cmm', 'C:/p', null)).toBeNull();
  });
});

describe('collectProcessors', () => {
  it('le a lista do projeto, aceitando nome ou objeto, e descarta o vazio', () => {
    window.availableProcessors = ['A', { name: 'B' }, '', null, {}];
    expect(pre.collectProcessors()).toEqual([{ name: 'A' }, { name: 'B' }]);
  });
});

describe('precompileAllProcessors', () => {
  it('compila cada processador do .spf no projeto do compilador, com a config dele', async () => {
    existe.add('C:/p/A/Software/A.cmm');
    existe.add('C:/p/B/Software/B.cpp');
    ProjectStore.setProject('C:/outro/o.spf', 'C:/outro');   // aberto agora e outro: nao importa
    const c = compilador([{ name: 'A', clk: 20 }, 'B']);
    expect(await pre.precompileAllProcessors(c, 'tveri', tm)).toBe(2);
    expect(c.feito).toEqual(['dirs:A', 'cmm:A:A.cmm', 'asm:A:20', 'dirs:B', 'cpp:B:B.cpp', 'asm:B:100']);
    expect(c.initializeComponentsPath).toHaveBeenCalled();
    expect(linhas[0]).toEqual({ t: 'tveri', texto: 'Info: pre-compiling 2 processor(s) (source + ASM).', tipo: 'tips' });
  });

  it('sem entries no .spf, usa a lista de nomes do projeto', async () => {
    window.availableProcessors = ['A'];
    existe.add('C:/p/A/Software/A.cmm');
    const c = compilador(undefined);
    expect(await pre.precompileAllProcessors(c, 'twave', tm)).toBe(1);
  });

  it('processador sem fonte e pulado com aviso', async () => {
    const c = compilador(['A', { name: 'B', sourceFile: 'B.cpp' }]);
    expect(await pre.precompileAllProcessors(c, 'tveri', tm)).toBe(0);
    const avisos = linhas.filter((l) => l.tipo === 'warning').map((l) => l.texto);
    expect(avisos).toEqual([
      'Warning: no A.cmm / A.cpp in A/Software — skipping A.',
      'Warning: no B.cpp in B/Software — skipping B.',
    ]);
  });

  it('projeto sem processador nao faz nada', async () => {
    const c = compilador([]);
    expect(await pre.precompileAllProcessors(c, 'tveri', null)).toBe(0);
    expect(c.initializeComponentsPath).not.toHaveBeenCalled();
  });

  it('cancelado entre processadores, para', async () => {
    existe.add('C:/p/A/Software/A.cmm');
    cancelamento.pedirCancelamento();
    await expect(pre.precompileAllProcessors(compilador(['A']), 'tveri', tm)).rejects.toThrow();
  });
});

describe('precompileAsmOnly', () => {
  it('monta todos sem rodar o front end; sem fonte no disco, a base e <nome>.cmm', async () => {
    existe.add('C:/p/B/Software/B.cpp');
    const c = compilador(['A', 'B']);
    expect(await pre.precompileAsmOnly(c, 'tasm', tm)).toBe(2);
    expect(c.feito).toEqual(['dirs:A', 'asm:A:100', 'dirs:B', 'asm:B:100']);
    expect(c.asmCompilation.mock.calls.map(([p]) => p.sourceFile)).toEqual(['A.cmm', 'B.cpp']);
    expect(c.cmmCompilation).not.toHaveBeenCalled();
    expect(linhas[0].texto).toContain('without re-running cmmcomp');
  });

  it('projeto sem processador nao faz nada', async () => {
    expect(await pre.precompileAsmOnly(compilador([]), 'tasm', tm)).toBe(0);
  });

  it('cancelado, para', async () => {
    cancelamento.pedirCancelamento();
    await expect(pre.precompileAsmOnly(compilador(['A']), 'tasm', tm)).rejects.toThrow();
  });
});

describe('resolveFallbackCmmPath', () => {
  beforeEach(() => { ProjectStore.setProject('C:/p/p.spf', 'C:/p'); });

  it('sem projeto aberto, ou sem processador, null', async () => {
    window.availableProcessors = ['A'];
    ProjectStore.clearProject();
    expect(await pre.resolveFallbackCmmPath(null)).toBeNull();
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    window.availableProcessors = [];
    expect(await pre.resolveFallbackCmmPath(null)).toBeNull();
  });

  it('o ultimo processador em foco vence; com um so, e ele; com varios e nenhum em foco, null', async () => {
    window.availableProcessors = ['A', 'B'];
    existe.add('C:/p/A/Software/A.cmm');
    existe.add('C:/p/B/Software/B.cpp');
    expect(await pre.resolveFallbackCmmPath('B')).toBe('C:/p/B/Software/B.cpp');
    expect(await pre.resolveFallbackCmmPath(null)).toBeNull();
    expect(await pre.resolveFallbackCmmPath('Sumiu')).toBeNull();
    window.availableProcessors = ['A'];
    expect(await pre.resolveFallbackCmmPath(null)).toBe('C:/p/A/Software/A.cmm');
  });

  it('processador sem fonte no disco, null', async () => {
    window.availableProcessors = ['A'];
    expect(await pre.resolveFallbackCmmPath(null)).toBeNull();
  });
});
