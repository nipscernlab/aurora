// @vitest-environment happy-dom
//
// O registro de execucoes (js/compilation/registro_de_execucao): o que cada
// clique de compilar grava, e no projeto de quem.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const electronAPI = { runLogGravar: vi.fn(async () => {}) };
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const spf = { read: vi.fn() };
vi.mock('../../js/project/spf_store.js', () => ({ SpfStore: spf }));
// O executor real so avisa quando roda um binario; aqui o teste avisa na mao.
const observadores = new Set();
vi.mock('../../js/compilation/spec_runner.js', () => ({
  addRunObserver: (fn) => { observadores.add(fn); return () => observadores.delete(fn); },
}));
const rodou = (obs) => { for (const fn of observadores) fn(obs); };

let reg;
let ProjectStore;
let cancelamento;
let problemStore;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  electronAPI.runLogGravar.mockResolvedValue(undefined);
  spf.read.mockResolvedValue({
    topLevelFile: 'C:/p/top.v',
    testbenchFile: 'C:/p/tb.v',
    synthesizableFiles: ['C:/p/b.v', { path: 'C:/p/a.v' }, {}],
  });
  localStorage.clear();
  window.availableProcessors = ['P2', 'P1'];
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  cancelamento = await import('../../js/compilation/cancelamento.js');
  ({ problemStore } = await import('../../js/terminal/problem_store.js'));
  reg = await import('../../js/compilation/registro_de_execucao.js');
  ProjectStore.setProject('C:/p/p.spf', 'C:/p');
});

const gravado = () => electronAPI.runLogGravar.mock.calls[0];

describe('comRegistro', () => {
  it('grava no projeto aberto, com o retrato do .spf e das preferencias', async () => {
    const r = await reg.comRegistro('wave', async () => 42);
    expect(r).toBe(42);
    const [projeto, exec] = gravado();
    expect(projeto).toBe('C:/p');
    expect(spf.read).toHaveBeenCalledWith('C:/p/p.spf');
    expect(exec.pedido).toBe('wave');
    expect(exec.ok).toBe(true);
    expect(exec.estado).toEqual({
      topoSintese: 'C:/p/top.v',
      topoSimulacao: 'C:/p/tb.v',
      fontes: ['C:/p/a.v', 'C:/p/b.v'],
      simulador: 'iverilog',
      visualizador: 'gtkwave',
      processadores: ['P1', 'P2'],
    });
  });

  it('.spf que nao se le deixa o retrato sem arquivos, mas com as preferencias', async () => {
    spf.read.mockRejectedValue(new Error('corrompido'));
    await reg.comRegistro('wave', async () => {});
    const [, exec] = gravado();
    expect(exec.estado.fontes).toEqual([]);
    expect(exec.estado.topoSintese).toBeNull();
    expect(exec.estado.simulador).toBe('iverilog');
  });

  it('sem projeto aberto roda, mas nao grava', async () => {
    ProjectStore.clearProject();
    await reg.comRegistro('cmm', async () => {});
    expect(electronAPI.runLogGravar).not.toHaveBeenCalled();
    expect(spf.read).not.toHaveBeenCalled();
  });

  it('a falha reportada pelo funil de erro vira "falhou", mesmo com o corpo resolvendo', async () => {
    await reg.comRegistro('cmm', async () => {
      reg.reportarFalhaNaExecucao({ cancelada: false, mensagem: 'cmmcomp code 1' }, 'cmm');
    });
    const [, exec] = gravado();
    expect(exec.ok).toBe(false);
    expect(exec.erro).toBe('cmmcomp code 1');
  });

  it('a falha reportada como cancelamento vira "cancelada"', async () => {
    await reg.comRegistro('cmm', async () => {
      reg.reportarFalhaNaExecucao({ cancelada: true, mensagem: null }, 'cmm');
    });
    expect(gravado()[1].cancelada).toBe(true);
  });

  it('corpo que lanca grava a falha e relanca', async () => {
    await expect(reg.comRegistro('all', async () => { throw new Error('quebrou'); })).rejects.toThrow('quebrou');
    const [, exec] = gravado();
    expect(exec.ok).toBe(false);
    expect(exec.erro).toBe('quebrou');
  });

  it('corpo que lanca depois de o usuario cancelar grava cancelada', async () => {
    cancelamento.pedirCancelamento();
    await expect(reg.comRegistro('all', async () => { throw new Error('morto'); })).rejects.toThrow();
    expect(gravado()[1].cancelada).toBe(true);
  });

  it('os problemas do compilador vao junto', async () => {
    await reg.comRegistro('cmm', async () => {
      problemStore.registrarLinha('x', {
        problemasNaLinha: () => [{ arquivo: 'C:/p/P.cmm', linha: 3, mensagem: 'erro aqui', severidade: 'erro' }],
      });
    });
    expect(gravado()[1].problemas).toEqual([
      expect.objectContaining({ arquivo: 'C:/p/P.cmm', linha: 3, mensagem: 'erro aqui' }),
    ]);
    problemStore.limpar();
  });

  it('gravar que falha so avisa, e a execucao sai das abertas', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    electronAPI.runLogGravar.mockRejectedValue(new Error('disco cheio'));
    await reg.comRegistro('cmm', async () => {});
    expect(aviso).toHaveBeenCalled();
    expect(reg.execucoesAbertas()).toEqual([]);
    aviso.mockRestore();
  });
});

describe('passos, execucoes abertas e avisos', () => {
  it('cada ferramenta que roda entra como passo e avisa a tela; no fim o observador sai', async () => {
    const avisos = vi.fn();
    window.addEventListener('aurora:run-log-changed', avisos);
    await reg.comRegistro('cmm', async () => {
      rodou({ step: 'cmm', binary: 'C:/comp/bin/cmmcomp.exe', args: ['-a'], code: 0, ms: 12 });
    });
    window.removeEventListener('aurora:run-log-changed', avisos);
    expect(avisos).toHaveBeenCalledTimes(3);   // abriu, rodou, gravou
    expect(gravado()[1].passos).toEqual([
      { step: 'cmm', ferramenta: 'cmmcomp.exe', args: ['-a'], code: 0, ms: 12 },
    ]);
    expect(observadores.size).toBe(0);
  });

  it('passo com duas execucoes no ar sai marcado como concorrente nas duas', async () => {
    let soltarA; let soltarB;
    const a = reg.comRegistro('wave', () => new Promise((r) => { soltarA = r; }));
    const b = reg.comRegistro('prism', () => new Promise((r) => { soltarB = r; }));
    await new Promise((r) => setTimeout(r, 5));
    rodou({ step: 'prism-yosys', binary: 'yosys.exe', code: 0, ms: 1 });
    soltarA(); soltarB();
    await Promise.all([a, b]);
    for (const [, e] of electronAPI.runLogGravar.mock.calls) {
      expect(e.passos[0].concorrente).toBe(true);
    }
  });

  it('com duas no ar, a mais nova vem primeiro e a falha vai para a do pedido ativo', async () => {
    let soltarA; let soltarB;
    const a = reg.comRegistro('wave', () => new Promise((r) => { soltarA = r; }));
    await new Promise((r) => setTimeout(r, 5));
    const b = reg.comRegistro('prism', () => new Promise((r) => { soltarB = r; }));
    await new Promise((r) => setTimeout(r, 5));
    expect(reg.execucoesAbertas().map((e) => e.pedido)).toEqual(['prism', 'wave']);
    expect(reg.execucoesAbertas().every((e) => e.andando)).toBe(true);
    reg.reportarFalhaNaExecucao({ cancelada: false, mensagem: 'yosys' }, 'prism');
    soltarA(); soltarB();
    await Promise.all([a, b]);
    const porPedido = Object.fromEntries(electronAPI.runLogGravar.mock.calls.map(([, e]) => [e.pedido, e]));
    expect(porPedido.wave.ok).toBe(true);
    expect(porPedido.prism.ok).toBe(false);
  });

  it('falha sem pedido reconhecivel marca todas as abertas', async () => {
    let soltarA; let soltarB;
    const a = reg.comRegistro('wave', () => new Promise((r) => { soltarA = r; }));
    const b = reg.comRegistro('prism', () => new Promise((r) => { soltarB = r; }));
    await new Promise((r) => setTimeout(r, 5));
    reg.reportarFalhaNaExecucao({ cancelada: false, mensagem: 'x' }, null);
    soltarA(); soltarB();
    await Promise.all([a, b]);
    expect(electronAPI.runLogGravar.mock.calls.every(([, e]) => e.ok === false)).toBe(true);
  });

  it('falha sem nenhuma aberta nao faz nada', () => {
    expect(() => reg.reportarFalhaNaExecucao({ cancelada: false, mensagem: 'x' }, 'cmm')).not.toThrow();
  });
});
