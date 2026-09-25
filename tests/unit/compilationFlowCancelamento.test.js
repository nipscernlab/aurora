// @vitest-environment happy-dom
/**
 * O compilation_flow por fora: cancelar, recusar a segunda execucao e deixar
 * o registro da execucao no projeto aberto. Escrito antes de o cancelamento e
 * o registro sairem para modulos proprios, para a mudanca ter com o que ser
 * comparada.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const electronAPI = {
  componentesListar: vi.fn(async () => ({ componentes: [] })),
  cancelVvpProcess: vi.fn(async () => ({ success: true })),
  runLogGravar: vi.fn(async () => {}),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

// O passo Verilog segura ate o teste soltar, para dar tempo de cancelar no meio.
const passo = { soltar: null, falhar: null };
class CompilationModuleFalso {
  constructor(projeto) { this.projeto = projeto; this.projectConfig = { processors: [] }; }
  async loadConfig() {}
  async initializeComponentsPath() {}
  verilogSyntaxCheck() {
    return new Promise((resolve, reject) => { passo.soltar = resolve; passo.falhar = reject; });
  }
}
const construidos = [];
vi.mock('../../js/compilation/compilation_module.js', () => ({
  CompilationModule: class extends CompilationModuleFalso {
    constructor(p) { super(p); construidos.push(p); }
  },
}));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { getEditingFilePath: () => null } }));
vi.mock('../../js/terminal/terminal.js', () => ({ switchTerminal: vi.fn() }));
vi.mock('../../js/compilation/command_overrides.js', () => ({ resolveOverride: vi.fn() }));
vi.mock('../../js/wave/simulator_preference.js', () => ({ getSimulator: () => 'iverilog' }));
vi.mock('../../js/project/active_processor.js', () => ({ getActiveProcessorName: () => null }));
vi.mock('../../js/utils/path_utils.js', () => ({ toForwardSlashes: (x) => x }));
vi.mock('../../js/ai/rewind.js', () => ({ marcarPonto: vi.fn() }));
vi.mock('../../js/ui/status_updater.js', () => ({
  statusUpdater: {
    beginRun: vi.fn(), endRun: vi.fn(), cancelRun: vi.fn(),
    compilationError: vi.fn(), startCompilation: vi.fn(),
  },
}));

const linhas = [];
const tm = {
  appendToTerminal: vi.fn((terminal, texto, tipo) => linhas.push({ terminal, texto, tipo })),
  clearTerminalImmediate: vi.fn(),
  clearHardwareProgress: vi.fn(),
};
window.initializeGlobalTerminalManager = () => tm;
window.globalTerminalManager = tm;

const { ProjectStore } = await import('../../js/project/project_store.js');
const flow = await import('../../js/compilation/compilation_flow.js');
const { compilationFlowManager: fm } = flow;
const { execucoesAbertas } = await import('../../js/compilation/registro_de_execucao.js');

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const textos = () => linhas.map((l) => l.texto);

beforeEach(async () => {
  vi.clearAllMocks();
  linhas.length = 0;
  construidos.length = 0;
  delete window.t;
  document.body.innerHTML = '<div class="tab active" data-terminal="tveri"></div>';
  ProjectStore.setProject('C:/p/p.spf', 'C:/p');
  // Nenhum teste deixa a bandeira de cancelado ligada para o proximo: quem a
  // zera no aplicativo e o inicio da compilacao seguinte.
  if (fm.wasCancelled()) {
    const r = fm.runSingleStep('verilog');
    await flush();
    passo.soltar();
    await r;
  }
  vi.clearAllMocks();
  electronAPI.cancelVvpProcess.mockResolvedValue({ success: true });
  linhas.length = 0;
});

describe('cancelar', () => {
  it('sem nada rodando, diz que nao ha o que cancelar e desliga a bandeira', async () => {
    electronAPI.cancelVvpProcess.mockResolvedValue({ success: false });
    fm.cancelAll();
    expect(fm.wasCancelled()).toBe(true);
    expect(window.isCompilationCanceled()).toBe(true);
    await flush();
    expect(textos()).toEqual(['compilation.cancelRequested', 'compilation.nothingToCancel']);
    expect(linhas.every((l) => l.terminal === 'tveri')).toBe(true);
    expect(fm.wasCancelled()).toBe(false);
  });

  it('segundo clique enquanto cancela so confirma que ja esta cancelando', async () => {
    fm.cancelAll();
    fm.cancelAll();
    await flush();
    expect(textos()).toEqual(['compilation.cancelRequested', 'compilation.cancelInProgress']);
    expect(electronAPI.cancelVvpProcess).toHaveBeenCalledTimes(1);
    expect(tm.clearHardwareProgress).toHaveBeenCalledTimes(1);
  });

  it('avisa a IA que o usuario cancelou', async () => {
    const emit = vi.fn();
    window.AuroraAPI = { events: { emit } };
    fm.cancelAll();
    expect(emit).toHaveBeenCalledWith('compile:cancelled', { by: 'user' });
    delete window.AuroraAPI;
  });

  it('cancelar no meio de um passo escreve um cartao so, e o registro sai cancelado', async () => {
    const rodando = fm.runSingleStep('verilog');
    await flush();
    expect(fm.isRunning()).toBe(true);
    expect(execucoesAbertas().map((e) => e.pedido)).toEqual(['verilog']);
    fm.cancelAll();
    passo.falhar(new Error('iverilog saiu com codigo 1'));
    await rodando;
    expect(fm.isRunning()).toBe(false);
    expect(textos().filter((t) => t === 'compilation.cancelledByUser')).toHaveLength(1);
    expect(textos().some((t) => t.startsWith('Erro Fatal'))).toBe(false);
    const [projeto, exec] = electronAPI.runLogGravar.mock.calls[0];
    expect(projeto).toBe('C:/p');
    expect(exec.cancelada).toBe(true);
    expect(execucoesAbertas()).toEqual([]);
  });

  it('a compilacao seguinte comeca sem a bandeira de cancelado', async () => {
    fm.cancelAll();
    const rodando = fm.runSingleStep('verilog');
    await flush();
    expect(fm.wasCancelled()).toBe(false);
    passo.soltar();
    await rodando;
  });
});

describe('uma execucao por vez, com registro', () => {
  it('segundo pedido com um em curso e recusado com aviso', async () => {
    const primeiro = fm.runSingleStep('verilog');
    await flush();
    expect(await fm.runSingleStep('wave')).toBe(false);
    expect(await fm.runAll()).toBe(false);
    expect(textos().filter((t) => t === 'compilation.alreadyRunning')).toHaveLength(2);
    passo.soltar();
    expect(await primeiro).toBe(true);
  });

  it('o passo roda no projeto aberto e o registro sai OK', async () => {
    const rodando = fm.runSingleStep('verilog');
    await flush();
    passo.soltar();
    await rodando;
    expect(construidos).toEqual(['C:/p']);
    const [projeto, exec] = electronAPI.runLogGravar.mock.calls[0];
    expect(projeto).toBe('C:/p');
    expect(exec.pedido).toBe('verilog');
    expect(exec.ok).toBe(true);
  });

  it('falha de verdade aparece como Erro Fatal e o registro sai com a falha', async () => {
    const rodando = fm.runSingleStep('verilog');
    await flush();
    passo.falhar(new Error('sem top-level'));
    await rodando;
    expect(textos()).toContain('Erro Fatal: sem top-level');
    const [, exec] = electronAPI.runLogGravar.mock.calls[0];
    expect(exec.ok).toBe(false);
    expect(exec.cancelada).toBeFalsy();
  });

  it('sem projeto aberto nao grava registro', async () => {
    ProjectStore.clearProject();
    const rodando = fm.runSingleStep('verilog');
    await flush();
    passo.soltar();
    await rodando;
    expect(electronAPI.runLogGravar).not.toHaveBeenCalled();
  });

  it('passo desconhecido e erro fatal no terminal do C±', async () => {
    await fm.runSingleStep('nao-existe');
    expect(linhas.find((l) => l.texto.includes('Unknown compilation step')).terminal).toBe('tcmm');
  });
});
