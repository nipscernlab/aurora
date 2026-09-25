// @vitest-environment happy-dom
/**
 * O despacho de cada botao do compilation_flow: em que projeto ele compila e
 * que fases do CompilationModule ele chama, em que ordem. O modulo de
 * compilacao e falso e so anota; o que se confere e a costura, nao as
 * ferramentas.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const existe = new Set();
const electronAPI = {
  componentesListar: vi.fn(async () => ({ componentes: [] })),
  runLogGravar: vi.fn(async () => {}),
  joinPath: async (...p) => p.join('/'),
  fileExists: vi.fn(async (p) => existe.has(p)),
  getComponentsPath: vi.fn(async () => 'C:/comp'),
  prismCompileWithPaths: vi.fn(async () => ({ success: true })),
  onProcessorCreated: vi.fn(),
  onProcessorsUpdated: vi.fn(),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

const chamadas = [];
const config = { processors: [] };
vi.mock('../../js/compilation/compilation_module.js', () => ({
  CompilationModule: class {
    constructor(p) { this.projectPath = p; this.projectConfig = config; chamadas.push(`new:${p}`); }
    async loadConfig() { chamadas.push('loadConfig'); }
    async initializeComponentsPath() {}
    async ensureDirectories(n) { chamadas.push(`dirs:${n}`); }
    async cmmCompilation(p) { chamadas.push(`cmm:${p.sourceFile}`); return 'x.asm'; }
    async cppCompilation(p) { chamadas.push(`cpp:${p.sourceFile}`); return 'x.asm'; }
    async asmCompilation(p) { chamadas.push(`asm:${p.name}`); }
    async verilogSyntaxCheck() { chamadas.push('verilog'); }
    async runGtkWave() { chamadas.push('wave'); }
    async verilatorProcessorRun() { chamadas.push('verilator-proc'); }
    async runFastSim() { chamadas.push('fastsim'); }
  },
}));
const foco = { caminho: null };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { getEditingFilePath: () => foco.caminho } }));
vi.mock('../../js/terminal/terminal.js', () => ({ switchTerminal: vi.fn() }));
const override = { valor: null };
vi.mock('../../js/compilation/command_overrides.js', () => ({ resolveOverride: vi.fn(async () => override.valor) }));
const ativo = { nome: null };
vi.mock('../../js/project/active_processor.js', () => ({ getActiveProcessorName: () => ativo.nome }));
vi.mock('../../js/ai/rewind.js', () => ({ marcarPonto: vi.fn() }));
vi.mock('../../js/ui/status_updater.js', () => ({
  statusUpdater: {
    beginRun: vi.fn(), endRun: vi.fn(), cancelRun: vi.fn(),
    compilationError: vi.fn(), startCompilation: vi.fn(),
  },
}));
const barra = { cmm: vi.fn(), toolbar: vi.fn(async () => {}) };
vi.mock('../../js/compilation/botoes_da_barra.js', () => ({
  syncCmmcompEnabled: () => barra.cmm(),
  syncToolbarEnabledState: () => barra.toolbar(),
}));

const linhas = [];
const tm = {
  appendToTerminal: vi.fn((terminal, texto) => linhas.push({ terminal, texto })),
  clearTerminalImmediate: vi.fn(),
};
window.initializeGlobalTerminalManager = () => tm;
window.globalTerminalManager = tm;

const { ProjectStore } = await import('../../js/project/project_store.js');
const { compilationFlowManager: fm } = await import('../../js/compilation/compilation_flow.js');

beforeEach(() => {
  vi.clearAllMocks();
  chamadas.length = 0;
  linhas.length = 0;
  existe.clear();
  config.processors = [];
  foco.caminho = null;
  ativo.nome = null;
  override.valor = null;
  window.availableProcessors = [];
  ProjectStore.setProject('C:/p/p.spf', 'C:/p');
});

describe('cada botao compila no projeto aberto, nas fases certas', () => {
  it('Verilog, Wave, Verilator do processador e Fast Sim', async () => {
    for (const [passo, fase] of [['verilog', 'verilog'], ['wave', 'wave'], ['verilator-proc', 'verilator-proc'], ['verilator-fast', 'fastsim']]) {
      chamadas.length = 0;
      await fm.runSingleStep(passo);
      expect(chamadas).toEqual(['new:C:/p', 'loadConfig', fase]);
    }
  });

  it('ASM monta os processadores sem o front end e confere o Verilog', async () => {
    config.processors = [{ name: 'P' }];
    await fm.runSingleStep('asm');
    expect(chamadas).toEqual(['new:C:/p', 'loadConfig', 'dirs:P', 'asm:P', 'verilog']);
  });

  it('o pre-flight compila cada processador com fonte antes do passo', async () => {
    config.processors = [{ name: 'P' }];
    existe.add('C:/p/P/Software/P.cmm');
    await fm.runSingleStep('wave');
    expect(chamadas).toEqual(['new:C:/p', 'loadConfig', 'dirs:P', 'cmm:P.cmm', 'asm:P', 'wave']);
  });

  it('Full Build pre-compila e abre a onda', async () => {
    await fm.runAll();
    expect(chamadas).toEqual(['new:C:/p', 'loadConfig', 'wave']);
  });

  it('PRISM confere o Verilog e manda o yosys com os caminhos do projeto e o override', async () => {
    override.valor = { override: { appendArgs: ['-q'] } };
    await fm.runSingleStep('prism');
    expect(chamadas).toEqual(['new:C:/p', 'loadConfig', 'verilog']);
    const [paths] = electronAPI.prismCompileWithPaths.mock.calls[0];
    expect(paths.projectPath).toBe('C:/p');
    expect(paths.spfPath).toBe('C:/p/p.spf');
    expect(paths.topLevelPath).toBe('C:/p/TopLevel');
    expect(paths.yosysOverride).toEqual({ appendArgs: ['-q'] });
  });

  it('PRISM sem projeto aberto e erro fatal, sem chamar o yosys', async () => {
    ProjectStore.clearProject();
    await fm.runSingleStep('prism');
    expect(electronAPI.prismCompileWithPaths).not.toHaveBeenCalled();
    expect(linhas.some((l) => l.texto.startsWith('Erro Fatal'))).toBe(true);
  });

  it('PRISM que o main recusa e erro fatal com a mensagem dele', async () => {
    electronAPI.prismCompileWithPaths.mockResolvedValueOnce({ success: false, message: 'yosys caiu' });
    await fm.runSingleStep('prism');
    expect(linhas.map((l) => l.texto)).toContain('Erro Fatal: yosys caiu');
  });
});

describe('botao C±', () => {
  it('com o fonte em foco, compila o processador dele: front end e ASM', async () => {
    config.processors = [{ name: 'P' }];
    foco.caminho = 'C:/p/P/Software/P.cpp';
    await fm.runSingleStep('cmm');
    expect(chamadas).toEqual(['new:C:/p', 'loadConfig', 'dirs:P', 'cpp:P.cpp', 'asm:P']);
  });

  it('sem fonte em foco, mira o ultimo processador que esteve em foco', async () => {
    window.availableProcessors = ['A', 'B'];
    existe.add('C:/p/B/Software/B.cmm');
    fm.initialize();
    ativo.nome = 'B';
    document.dispatchEvent(new Event('aurora:editing-file-changed'));
    ativo.nome = null;
    await fm.runSingleStep('cmm');
    expect(chamadas).toContain('cmm:B.cmm');
  });

  it('sem fonte em foco e sem como inferir, explica no terminal e nao compila', async () => {
    window.availableProcessors = ['A', 'B'];
    fm.initialize();
    ativo.nome = null;
    await fm.runSingleStep('cmm');
    expect(chamadas).toEqual([]);
    expect(linhas[0].terminal).toBe('tcmm');
    expect(linhas[0].texto).toContain('varios');
  });

  it('sem projeto aberto, a explicacao e a de abrir um fonte', async () => {
    ProjectStore.clearProject();
    await fm.runSingleStep('cmm');
    expect(linhas[0].texto).toContain('No processor source');
  });

  it('fonte fora das pastas de um processador e erro fatal', async () => {
    foco.caminho = 'C:/p/Solto/P.cmm';
    await fm.runSingleStep('cmm');
    expect(linhas.some((l) => l.texto.includes('Cannot resolve a processor'))).toBe(true);
  });
});

describe('initialize', () => {
  it('os botoes vao pela API, e o projeto que muda re-sincroniza a barra', async () => {
    document.body.innerHTML = ['cmmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'verilatorproc', 'fastsim', 'allcomp', 'cancel-everything']
      .map((id) => `<button id="${id}"></button>`).join('');
    const compile = { compileStep: vi.fn(), compileAll: vi.fn(), cancel: vi.fn() };
    window.AuroraAPI = { compile };
    fm.initialize();
    for (const id of ['cmmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'verilatorproc', 'fastsim', 'allcomp', 'cancel-everything']) {
      document.getElementById(id).click();
    }
    expect(compile.compileStep.mock.calls.map(([s]) => s)).toEqual(['cmm', 'verilog', 'wave', 'prism', 'verilator-proc', 'verilator-fast']);
    expect(compile.compileAll).toHaveBeenCalled();
    expect(compile.cancel).toHaveBeenCalled();
    expect(document.getElementById('allcomp').disabled).toBe(false);

    barra.toolbar.mockClear();
    ProjectStore.setProject('C:/q/q.spf', 'C:/q');
    window.dispatchEvent(new Event('aurora:wave-simulator-changed'));
    window.dispatchEvent(new Event('aurora:spf-changed'));
    expect(barra.toolbar.mock.calls.length).toBeGreaterThanOrEqual(3);
    delete window.AuroraAPI;
  });
});
