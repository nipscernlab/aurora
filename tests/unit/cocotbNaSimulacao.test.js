// @vitest-environment happy-dom
//
// A execucao de um testbench Python pelo cocotb, no Wave e no Fast Sim.
//
// Trava o que vai ao runner (o ambiente que ele le, o perfil do simulador, o
// .vlt com a selecao do picker no Verilator), o fluxo da saida, a defesa do
// dump, e as duas saidas diferentes de proposito: teste que falha continua e
// mostra a onda; falha de infraestrutura para.
//
// As pecas em volta (perfil do simulador, fontes, selecao, runner, adocao da
// onda) sao metodos da instancia com logica propria e aqui sao falsas; o que
// interessa e o que a execucao faz com elas. `chamar` e o unico ponto que sabe
// onde a execucao mora.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/compilation/spec_runner.js', () => ({
    runSpec: vi.fn(),
    runSpecStreamed: vi.fn(),
    setAuditHook: vi.fn(),
    setTerminalHook: vi.fn(),
    resolveSpec: vi.fn(),
}));
vi.mock('../../js/tabs/tab_manager.js', () => ({
    TabManager: { saveAllFiles: vi.fn(async () => {}), tabs: new Map() },
}));
vi.mock('../../js/ui/status_updater.js', () => ({
    statusUpdater: { startCompilation: vi.fn(), compilationSuccess: vi.fn(), compilationError: vi.fn() },
}));
let terminal;
vi.mock('../../js/terminal/terminal_module.js', () => ({
    TerminalManager: class {
        constructor() { return terminal; }
    },
}));
vi.mock('../../js/wave/verilator_trace_rules.js', async (original) => ({
    ...(await original()),
    verilatorTraceRules: vi.fn(() => ['tracing_off', 'tracing_on -scope "filtro.dut"']),
    contarEscopos: vi.fn(() => ({ ligados: 1, desligados: 2 })),
}));
vi.mock('../../js/compilation/wave_signal_validator.js', async (original) => ({
    ...(await original()),
    buildHierarchyFromFiles: vi.fn(async () => ({ arvore: true })),
}));

import { runSpecStreamed } from '../../js/compilation/spec_runner.js';
import { TabManager } from '../../js/tabs/tab_manager.js';
import { statusUpdater } from '../../js/ui/status_updater.js';
import { verilatorTraceRules } from '../../js/wave/verilator_trace_rules.js';
import { buildHierarchyFromFiles } from '../../js/compilation/wave_signal_validator.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';

const chamar = {
    rodar: (mod, ...a) => mod._waveRunCocotbSimulation(...a),
};

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';
const PY = PROJ + '/Simulation/test_filtro.py';
const BUILD = TEMP + '/cocotb_test_filtro';
const RUNNER = TEMP + '/aurora_cocotb_runner.py';
const TOOLS = { tempBaseDir: TEMP };
const CTX = {
    tbKey: 'test_filtro', hdlTopModule: 'filtro', testModule: 'test_filtro', testbenchFile: PY,
};
const FONTES = [PROJ + '/Hardware/filtro.v'];

function makeTerminal() {
    const calls = [];
    return {
        calls,
        barras: [],
        appendToTerminal: (term, msg, level, opts) => calls.push({ term, msg, level, opts }),
        renderHardwareProgress: function (term, p) { this.barras.push([term, p]); },
    };
}

let api;
function makeFakeApi() {
    const arquivos = new Map();
    const a = {
        _arquivos: arquivos,
        joinPath: vi.fn(async (...partes) => partes.join('/').replace(/\/+/g, '/')),
        dirname: vi.fn(async (p) => p.split('/').slice(0, -1).join('/')),
        fileExists: vi.fn(async (p) => arquivos.has(p)),
        writeFile: vi.fn(async (p, c) => { arquivos.set(p, c); }),
        mkdir: vi.fn(async () => {}),
        getFileStats: vi.fn(async () => ({ size: 1 })),
        checkFileWritable: vi.fn(async () => ({ exists: false, writable: true })),
        isOnBattery: vi.fn(async () => false),
        getComponentsPath: vi.fn(async () => COMP),
        _ouvintes: [],
        onExecSpecStream: vi.fn((cb) => {
            a._ouvintes.push(cb);
            return () => { a._ouvintes = a._ouvintes.filter((o) => o !== cb); };
        }),
        _emitir(payload) { for (const o of [...a._ouvintes]) o(payload); },
    };
    return a;
}

const PERFIL_ICARUS = {
    sim: 'icarus', buildArgs: ['-g2012'], pythonPath: COMP + '/python.exe',
    prependPath: [COMP + '/bin'], extraEnv: { EXTRA: 'x' },
};
const PERFIL_VERILATOR = { ...PERFIL_ICARUS, sim: 'verilator', buildArgs: ['--timing', '--trace-fst'], extraEnv: {} };

async function novoModulo({ perfil = PERFIL_ICARUS, selecao = [] } = {}) {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    mod.projectConfig = { testbenchFile: PY };
    mod._resolveCocotbSimProfile = vi.fn(async () => perfil);
    mod._stageProcessorMemoryFilesForCocotb = vi.fn(async () => {});
    mod._collectCocotbSources = vi.fn(async () => FONTES);
    mod._resolveCocotbWaveSelection = vi.fn(async () => selecao);
    mod._writeCocotbRunnerScript = vi.fn(async () => RUNNER);
    mod._adoptCocotbWaveform = vi.fn(async () => PROJ + '/dump.fst');
    return mod;
}

function ligarRunner({ code = 0, saida = [] } = {}) {
    const passos = [];
    runSpecStreamed.mockImplementation(async (spec) => {
        passos.push(spec);
        for (const d of saida) api._emitir(d);
        return { code };
    });
    return passos;
}

const msgs = () => terminal.calls.map((c) => c.msg);

beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
});

afterEach(() => {
    delete window.electronAPI;
    delete window._latestCompilationModule;
    vi.clearAllMocks();
});

describe('_waveRunCocotbSimulation', () => {
    it('Wave no Icarus: o runner recebe o ambiente, a saida vira barra ou linha, e a onda e adotada', async () => {
        const mod = await novoModulo();
        const passos = ligarRunner({
            saida: [{ type: 'stdout', data: 'filtro: 2/4 samples processed\n  PASS test_a\n\n' }, null],
        });

        const r = await chamar.rodar(mod, CTX, TOOLS, { testbenchFile: PY });

        expect(r).toBe(PROJ + '/dump.fst');
        expect(TabManager.saveAllFiles).toHaveBeenCalled();
        expect(api.mkdir).toHaveBeenCalledWith(TEMP);
        expect(api.mkdir).toHaveBeenCalledWith(BUILD);
        expect(mod._resolveCocotbSimProfile).toHaveBeenCalledWith(true);
        expect(mod._stageProcessorMemoryFilesForCocotb).toHaveBeenCalledWith(TEMP, BUILD);
        expect(mod._adoptCocotbWaveform).toHaveBeenCalledWith(CTX, TOOLS, BUILD);

        expect(passos).toHaveLength(1);
        const spec = passos[0];
        expect(spec).toMatchObject({
            step: 'cocotb-run', binary: COMP + '/python.exe', args: [RUNNER], cwd: BUILD, prependPath: [COMP + '/bin'],
        });
        expect(spec.env).toEqual({
            AURORA_COCOTB_SOURCES_JSON: JSON.stringify(FONTES),
            AURORA_COCOTB_TOP: 'filtro',
            AURORA_COCOTB_TEST_MODULE: 'test_filtro',
            AURORA_COCOTB_BUILD_DIR: BUILD,
            AURORA_COCOTB_TEST_DIR: PROJ,
            AURORA_COCOTB_PYTHONPATH: `${PROJ}/Simulation;${PROJ};${BUILD}`,
            AURORA_COCOTB_BUILD_ARGS_JSON: '["-g2012"]',
            AURORA_COCOTB_TEST_ARGS_JSON: '[]',
            SIM: 'icarus',
            TOPLEVEL_LANG: 'verilog',
            WAVES: '1',
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
            COCOTB_TRUST_INERTIAL_WRITES: '1',
            EXTRA: 'x',
        });

        // A defesa do dump olha os nomes que o runner grava, na pasta do projeto.
        expect(api.checkFileWritable).toHaveBeenCalledWith(PROJ + '/dump.fst');
        expect(api.checkFileWritable).toHaveBeenCalledWith(PROJ + '/dump.vcd');
        expect(terminal.calls.filter((c) => !c.opts?.internal).map((c) => [c.msg, c.level])).toEqual([
            ['terminal.wave.runningCocotb', 'info'],
            ['  PASS test_a', 'raw'],
        ]);
        expect(terminal.barras).toHaveLength(1);
        expect(api._ouvintes).toHaveLength(0);
        // Na selecao do picker, fora do Verilator, nao ha .vlt.
        expect(buildHierarchyFromFiles).not.toHaveBeenCalled();
    });

    it('Verilator com selecao: as regras de escopo entram por um .vlt na frente dos argumentos', async () => {
        const mod = await novoModulo({ perfil: PERFIL_VERILATOR, selecao: ['filtro.dut.y'] });
        const passos = ligarRunner();

        await chamar.rodar(mod, CTX, TOOLS, { testbenchFile: PY });

        const vlt = BUILD + '/aurora_scopes.vlt';
        expect(buildHierarchyFromFiles).toHaveBeenCalledWith(FONTES, 'filtro');
        expect(verilatorTraceRules).toHaveBeenCalledWith({ arvore: true }, ['filtro.dut.y']);
        expect(api._arquivos.get(vlt)).toBe('`verilator_config\n'
            + '// Gerado pela AURORA a cada build: a selecao do picker por escopo.\n'
            + 'tracing_off\ntracing_on -scope "filtro.dut"\n');
        expect(JSON.parse(passos[0].env.AURORA_COCOTB_BUILD_ARGS_JSON)).toEqual([vlt, '--timing', '--trace-fst']);
        expect(passos[0].env.SIM).toBe('verilator');
        expect(msgs()).toContain('terminal.wave.verilatorScopeRules');
    });

    it('Verilator com selecao mas sem regras, ou com a arvore falhando: o dump sai inteiro', async () => {
        verilatorTraceRules.mockReturnValueOnce([]);
        const mod = await novoModulo({ perfil: PERFIL_VERILATOR, selecao: ['x'] });
        const passos = ligarRunner();
        await chamar.rodar(mod, CTX, TOOLS, { testbenchFile: PY });
        expect(JSON.parse(passos[0].env.AURORA_COCOTB_BUILD_ARGS_JSON)).toEqual(['--timing', '--trace-fst']);

        buildHierarchyFromFiles.mockRejectedValueOnce(new Error('parse'));
        await chamar.rodar(mod, CTX, TOOLS, { testbenchFile: PY });
        expect(JSON.parse(passos[1].env.AURORA_COCOTB_BUILD_ARGS_JSON)).toEqual(['--timing', '--trace-fst']);
        expect(msgs()).not.toContain('terminal.wave.verilatorScopeRules');
    });

    it('Fast Sim: sem onda, sem defesa do dump, sem adotar nada', async () => {
        const mod = await novoModulo({ perfil: PERFIL_VERILATOR, selecao: ['x'] });
        const passos = ligarRunner();

        expect(await chamar.rodar(mod, CTX, TOOLS, { testbenchFile: PY }, { wave: false })).toBeNull();

        expect(mod._resolveCocotbSimProfile).toHaveBeenCalledWith(false);
        expect(passos[0].env.WAVES).toBe('0');
        expect(buildHierarchyFromFiles).not.toHaveBeenCalled();
        expect(api.checkFileWritable).not.toHaveBeenCalled();
        expect(mod._adoptCocotbWaveform).not.toHaveBeenCalled();
    });

    it('teste que falha: avisa em vermelho e ainda abre a onda', async () => {
        const mod = await novoModulo();
        ligarRunner({ code: 2 });

        expect(await chamar.rodar(mod, CTX, TOOLS, { testbenchFile: PY })).toBe(PROJ + '/dump.fst');

        expect(terminal.calls.at(-1)).toMatchObject({ msg: 'terminal.wave.cocotbTestsFailed', level: 'error' });
        expect(statusUpdater.compilationError).toHaveBeenCalledWith('verilog', 'cocotb tests failed');
    });

    it('falha de infraestrutura para, com o codigo', async () => {
        window.t = (k, p) => (p ? `${k} ${p.code}` : k);
        try {
            const mod = await novoModulo();
            ligarRunner({ code: 1 });
            await expect(chamar.rodar(mod, CTX, TOOLS, { testbenchFile: PY }))
                .rejects.toThrow('error.compilation.cocotbFailed 1');
            expect(mod._adoptCocotbWaveform).not.toHaveBeenCalled();
            expect(api._ouvintes).toHaveLength(0);
        } finally {
            delete window.t;
        }
    });

    it('dump travado para antes de rodar', async () => {
        api.checkFileWritable.mockResolvedValue({ exists: true, writable: false, code: 'EPERM' });
        const mod = await novoModulo();
        const passos = ligarRunner();
        await expect(chamar.rodar(mod, CTX, TOOLS, { testbenchFile: PY })).rejects.toThrow('error.compilation.dumpLockedDenied');
        expect(passos).toHaveLength(0);
        // DEFEITO de hoje: o ouvinte do fluxo e ligado antes da defesa e fica
        // ligado quando ela recusa. Toda saida em fluxo que vier depois, de
        // qualquer passo, e repetida no TWAVE. Corrigido no commit seguinte.
        expect(api._ouvintes).toHaveLength(1);
    });

    it('sem pasta de projeto, a do testbench faz as vezes; sem fluxo ao vivo roda igual', async () => {
        delete api.onExecSpecStream;
        const mod = await novoModulo();
        mod.projectPath = null;
        const passos = ligarRunner();

        await chamar.rodar(mod, CTX, TOOLS, { testbenchFile: PY });

        expect(passos[0].env.AURORA_COCOTB_TEST_DIR).toBe(PROJ + '/Simulation');
        expect(passos[0].env.AURORA_COCOTB_PYTHONPATH).toBe(`${PROJ}/Simulation;${BUILD}`);
        expect(api.checkFileWritable).toHaveBeenCalledWith(PROJ + '/Simulation/dump.fst');
    });
});
