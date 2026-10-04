// @vitest-environment happy-dom
//
// O namespace compile da AuroraAPI, pela API montada, que e por onde a IA
// compila, simula, cancela e mexe nos comandos de cada passo. Escrito contra o
// aurora_api.js antes de o namespace sair para compile_ns.ts. Erro sai como
// { ok: false, error: { message, code } } (api_core.ts).

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: {} }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: {} }));
vi.mock('../../js/editor/shared_models.js', () => ({ SharedModelRegistry: {} }));
vi.mock('../../js/processors/processor_config_panel.js', () => ({ processorConfigPanel: {} }));
const electronAPI = {
  getProtectedFlags: vi.fn(async (step) => [`--${step}`]),
  listAllowedBinaries: vi.fn(async () => ['cmmcomp.exe']),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const overrides = {
  listOverrides: vi.fn(async () => [{ key: 'cmm' }]),
  setOverride: vi.fn(async (a) => ({ key: a.step, scope: a.persist ? 'persisted' : 'ephemeral' })),
  clearOverride: vi.fn(async (a) => ({ key: a.step, ephemeral: true, persisted: false })),
};
vi.mock('../../js/compilation/command_overrides.js', () => overrides);
const resolveSpec = vi.fn(async (base, extra) => ({
  appliedSpec: { ...base, extra }, formatted: 'f', formattedBase: 'fb', diff: ['d'], sources: ['s'],
  override: extra || null,
}));
vi.mock('../../js/compilation/spec_runner.js', () => ({ resolveSpec }));
const buildSpecForStep = vi.fn(async (step, proc) => ({ step, proc }));
vi.mock('../../js/compilation/spec_factory.js', () => ({ buildSpecForStep }));
// O fluxo de compilacao vem por import (compile_ns.ts); o objeto e trocado a
// cada caso, por isso o mock entrega um getter.
const fluxoAtual = { cf: null };
vi.mock('../../js/compilation/compilation_flow.js', () => ({
  get compilationFlowManager() { return fluxoAtual.cf; },
}));

let API;
let eventos;

beforeAll(async () => {
  const { initAuroraAPI } = await import('../../js/api/aurora_api.js');
  API = initAuroraAPI();
});

beforeEach(() => {
  vi.clearAllMocks();
  eventos = [];
  for (const nome of ['compile:started', 'compile:override-set', 'compile:override-cleared']) {
    API.events.on(nome, (p) => eventos.push([nome, p]));
  }
});

const fluxo = (extra = {}) => {
  fluxoAtual.cf = {
    runAll: vi.fn(async () => undefined),
    runSingleStep: vi.fn(async () => undefined),
    cancelAll: vi.fn(),
    ...extra,
  };
  return fluxoAtual.cf;
};

describe('compile: rodar', () => {
  it('compileAll avisa o inicio e roda tudo; recusa quando ja ha uma corrida', async () => {
    const cf = fluxo();
    expect(await API.compile.compileAll()).toEqual({ ok: true, data: null });
    expect(cf.runAll).toHaveBeenCalled();
    expect(eventos.at(-1)).toEqual(['compile:started', { scope: 'all' }]);
    cf.runAll.mockResolvedValue(false);
    expect((await API.compile.compileAll()).error.message).toMatch(/already running/);
    cf.runAll.mockRejectedValue(new Error('caiu'));
    expect((await API.compile.compileAll()).error.message).toBe('caiu');
  });

  it('compileStep aceita os passos da API, inclusive cpp, e recusa o resto', async () => {
    const cf = fluxo();
    expect((await API.compile.compileStep('nada')).error.message).toBe('unknown compile step: nada');
    expect(eventos).toEqual([]);
    expect(await API.compile.compileStep('cpp')).toEqual({ ok: true, data: { step: 'cpp' } });
    expect(cf.runSingleStep).toHaveBeenCalledWith('cpp');
    expect(eventos.at(-1)).toEqual(['compile:started', { scope: 'cpp' }]);
    cf.runSingleStep.mockResolvedValue(false);
    expect((await API.compile.compileStep('asm')).error.message).toMatch(/already running/);
    cf.runSingleStep.mockRejectedValue(new Error('x'));
    expect((await API.compile.compileStep('wave')).error.message).toBe('x');
  });

  it('runVerilatorProc e runFastSim sao o compileStep do botao, chamados soltos como a IA faz', async () => {
    const cf = fluxo();
    const { runVerilatorProc, runFastSim } = API.compile;
    expect((await runVerilatorProc()).data).toEqual({ step: 'verilator-proc' });
    expect((await runFastSim()).data).toEqual({ step: 'verilator-fast' });
    expect(cf.runSingleStep.mock.calls).toEqual([['verilator-proc'], ['verilator-fast']]);
  });

  it('cancel pede ao fluxo, sem emitir evento daqui', async () => {
    const cf = fluxo();
    expect((await API.compile.cancel()).ok).toBe(true);
    expect(cf.cancelAll).toHaveBeenCalled();
    expect(eventos).toEqual([]);
    cf.cancelAll.mockImplementation(() => { throw new Error('preso'); });
    expect((await API.compile.cancel()).error.message).toBe('preso');
  });

  it('runStatus diz rodando, cancelada ou parada, e explica o cancelamento', async () => {
    const cf = fluxo({ isRunning: vi.fn(() => true), wasCancelled: vi.fn(() => false) });
    expect((await API.compile.runStatus()).data).toEqual({ running: true, cancelled: false, state: 'running', note: undefined });
    cf.isRunning.mockReturnValue(false);
    cf.wasCancelled.mockReturnValue(true);
    const r = (await API.compile.runStatus()).data;
    expect(r).toMatchObject({ running: false, cancelled: true, state: 'cancelled' });
    expect(r.note).toMatch(/^The user cancelled/);
    fluxo();
    expect((await API.compile.runStatus()).data.state).toBe('idle');
  });
});

describe('compile: comandos de cada passo', () => {
  it('listSteps da cada passo com a descricao', async () => {
    const { steps } = (await API.compile.listSteps()).data;
    expect(steps.length).toBeGreaterThan(5);
    expect(steps[0]).toEqual({ id: expect.any(String), description: expect.any(String) });
  });

  it('inspectCommand monta o comando base e aplica o override ativo', async () => {
    const r = (await API.compile.inspectCommand('cmm', 'proc')).data;
    expect(buildSpecForStep).toHaveBeenCalledWith('cmm', 'proc');
    expect(resolveSpec).toHaveBeenCalledWith({ step: 'cmm', proc: 'proc' });
    expect(r).toEqual({
      step: 'cmm', processorName: 'proc', base: { step: 'cmm', proc: 'proc' },
      applied: { step: 'cmm', proc: 'proc', extra: undefined }, formatted: 'f', formattedBase: 'fb',
      diff: ['d'], sources: ['s'], hasOverride: false,
    });
    expect((await API.compile.inspectCommand('asm')).data.processorName).toBeNull();
    buildSpecForStep.mockRejectedValueOnce(new Error('sem processador'));
    expect((await API.compile.inspectCommand('cmm')).error.message).toBe('sem processador');
  });

  it('previewCommand aplica o override extra sem registrar', async () => {
    const r = (await API.compile.previewCommand('asm', { appendArgs: ['-v'] }, 'p')).data;
    expect(resolveSpec).toHaveBeenLastCalledWith({ step: 'asm', proc: 'p' }, { appendArgs: ['-v'] });
    expect(r).not.toHaveProperty('sources');
    expect(r.applied.extra).toEqual({ appendArgs: ['-v'] });
    await API.compile.previewCommand('asm');
    expect(resolveSpec).toHaveBeenLastCalledWith({ step: 'asm', proc: undefined }, null);
    expect(overrides.setOverride).not.toHaveBeenCalled();
    resolveSpec.mockRejectedValueOnce(new Error('ruim'));
    expect((await API.compile.previewCommand('asm')).error.message).toBe('ruim');
  });

  it('listOverrides, setOverride e clearOverride falam com o registro e avisam', async () => {
    expect((await API.compile.listOverrides()).data).toEqual({ overrides: [{ key: 'cmm' }] });

    const r = await API.compile.setOverride({ step: 'cmm', processorName: 'p', persist: 1, note: 'n', appendArgs: ['-O'] });
    expect(r.data).toEqual({ key: 'cmm', scope: 'persisted' });
    expect(overrides.setOverride).toHaveBeenCalledWith({
      step: 'cmm', processorName: 'p', override: { appendArgs: ['-O'] }, persist: true, note: 'n',
    });
    expect(eventos.at(-1)).toEqual(['compile:override-set', { step: 'cmm', processorName: 'p', persist: true }]);

    expect((await API.compile.clearOverride('cmm', 'p')).ok).toBe(true);
    expect(overrides.clearOverride).toHaveBeenCalledWith({ step: 'cmm', processorName: 'p', scope: 'both' });
    expect(eventos.at(-1)).toEqual(['compile:override-cleared', { step: 'cmm', processorName: 'p' }]);
    await API.compile.clearOverride('cmm', 'p', 'persisted');
    expect(overrides.clearOverride).toHaveBeenLastCalledWith({ step: 'cmm', processorName: 'p', scope: 'persisted' });
  });

  it('os erros do registro voltam como erro, sem evento', async () => {
    overrides.listOverrides.mockRejectedValueOnce(new Error('a'));
    overrides.setOverride.mockRejectedValueOnce(new Error('b'));
    overrides.clearOverride.mockRejectedValueOnce(new Error('c'));
    expect((await API.compile.listOverrides()).error.message).toBe('a');
    expect((await API.compile.setOverride(null)).error.message).toBe('b');
    expect((await API.compile.clearOverride('x')).error.message).toBe('c');
    expect(eventos).toEqual([]);
  });

  it('as flags protegidas e os binarios permitidos vem do processo principal', async () => {
    expect((await API.compile.listProtectedFlags('asm')).data).toEqual({ step: 'asm', protected: ['--asm'] });
    expect((await API.compile.listProtectedFlags()).data.step).toBeNull();
    expect((await API.compile.listAllowedBinaries()).data).toEqual({ binaries: ['cmmcomp.exe'] });
    electronAPI.getProtectedFlags.mockRejectedValueOnce(new Error('ipc'));
    electronAPI.listAllowedBinaries.mockRejectedValueOnce(new Error('ipc2'));
    expect((await API.compile.listProtectedFlags('asm')).error.message).toBe('ipc');
    expect((await API.compile.listAllowedBinaries()).error.message).toBe('ipc2');
  });
});
