// @vitest-environment happy-dom
//
// O cocotb, no Wave e no Fast Sim: quem e o DUT, o Python e o pacote, as
// fontes, as memorias do processador, o runner, a execucao e a adocao da onda.
//
// O mundo e montado inteiro (o Python do pacote, o cocotb instalado, a
// biblioteca HDL, o dump que o runner grava), e so o que tem regra propria e
// falso no nivel do modulo: a selecao validada (wave_signal_validator) e as
// regras de escopo do Verilator. Trava o que vai ao runner (o ambiente, o
// perfil de cada simulador, o .vlt com a selecao do picker), o fluxo da saida,
// a defesa do dump, e as duas saidas diferentes de proposito: teste que falha
// continua e mostra a onda; falha de infraestrutura para.
//
// `chamar` e o unico ponto que sabe onde cada peca mora, para o mesmo arquivo
// provar o comportamento antes e depois de elas sairem do compilation_module.

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
    resolveCocotbWaveSelection: vi.fn(async () => []),
}));

import { runSpecStreamed } from '../../js/compilation/spec_runner.js';
import { TabManager } from '../../js/tabs/tab_manager.js';
import { statusUpdater } from '../../js/ui/status_updater.js';
import { verilatorTraceRules } from '../../js/wave/verilator_trace_rules.js';
import { buildHierarchyFromFiles, resolveCocotbWaveSelection } from '../../js/compilation/wave_signal_validator.js';
import { COCOTB_RUNNER_SOURCE } from '../../js/compilation/cocotb_runner_source.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';

const chamar = {
    validar: (mod, config) => mod._waveValidateCocotbConfig(config),
    rodar: (mod, ...a) => mod._waveRunCocotbSimulation(...a),
};

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';
const MINGW = COMP + '/Packages/msys/mingw64/bin';
const USR = COMP + '/Packages/msys/usr/bin';
const PY = PROJ + '/Simulation/test_filtro.py';
const DUT = PROJ + '/Hardware/filtro.v';
const BUILD = TEMP + '/cocotb_test_filtro';
const RUNNER = TEMP + '/aurora_cocotb_runner.py';
const TOOLS = { tempBaseDir: TEMP };
const CTX = {
    tbKey: 'test_filtro', hdlTopModule: 'filtro', testModule: 'test_filtro', testbenchFile: PY,
};
const CONFIG = { testbenchFile: PY, topLevelFile: DUT, synthesizableFiles: [DUT, PROJ + '/leia.txt'] };
const FONTES = [DUT, COMP + '/HDL/processor.v', COMP + '/HDL/ula.v'];

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
        joinPath: vi.fn(async (...partes) => {
            if (!partes.every((p) => typeof p === 'string')) throw new TypeError('join-path');
            return partes.join('/').replace(/\/+/g, '/');
        }),
        dirname: vi.fn(async (p) => p.split('/').slice(0, -1).join('/')),
        fileExists: vi.fn(async (p) => arquivos.has(p)),
        readFile: vi.fn(async (p) => {
            if (!arquivos.has(p)) throw new Error('ENOENT ' + p);
            return arquivos.get(p);
        }),
        writeFile: vi.fn(async (p, c) => { arquivos.set(p, c); }),
        copyFile: vi.fn(async (de, para) => { arquivos.set(para, arquivos.get(de)); }),
        mkdir: vi.fn(async () => {}),
        listFilesInDirectory: vi.fn(async (dir) => {
            const d = dir + '/';
            return [...arquivos.keys()].filter((p) => p.startsWith(d) && !p.slice(d.length).includes('/'))
                .map((p) => p.slice(d.length));
        }),
        getFileStats: vi.fn(async () => ({ size: 1 })),
        checkFileWritable: vi.fn(async () => ({ exists: false, writable: true })),
        isOnBattery: vi.fn(async () => false),
        getPythonStatus: vi.fn(async () => ({ ok: true, hasCocotb: true })),
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

async function novoModulo(config = CONFIG) {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    mod.projectConfig = config;
    return mod;
}

/** O runner falso: emite a saida e grava o dump onde o cocotb grava. */
function ligarRunner({ code = 0, saida = [], dump = BUILD + '/dump.fst' } = {}) {
    const passos = [];
    runSpecStreamed.mockImplementation(async (spec) => {
        passos.push(spec);
        for (const d of saida) api._emitir(d);
        if (dump) api._arquivos.set(dump, 'FST');
        return { code };
    });
    return passos;
}

const msgs = () => terminal.calls.map((c) => c.msg);
const argsDoBuild = (spec) => JSON.parse(spec.env.AURORA_COCOTB_BUILD_ARGS_JSON);

beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
    localStorage.clear();
    for (const [p, c] of [
        [MINGW + '/verilator', '#!perl'], [MINGW + '/perl.exe', 'MZ'], [MINGW + '/python.exe', 'MZ'],
        [COMP + '/HDL/processor.v', 'module processor; endmodule'],
        [COMP + '/HDL/ula.v', 'module ula; endmodule'],
        [COMP + '/HDL/processor_tb.v', 'module processor_tb; endmodule'],
        [COMP + '/HDL/leia.md', 'x'],
        [PY, 'import cocotb\n'],
        [DUT, 'module filtro; endmodule'],
    ]) api._arquivos.set(p, c);
});

afterEach(() => {
    delete window.electronAPI;
    delete window._latestCompilationModule;
    vi.clearAllMocks();
});

describe('quem e o DUT', () => {
    it('a diretiva do .py manda', async () => {
        api._arquivos.set(PY, 'import cocotb\n# aurora-toplevel: soma\n');
        const mod = await novoModulo();
        expect(await chamar.validar(mod, CONFIG)).toEqual({
            hdlTopFile: DUT, hdlTopModule: 'soma', testbenchFile: PY,
            testModule: 'test_filtro', tbKey: 'test_filtro', toplevelSource: 'directive',
        });
    });

    it('sem diretiva, ou com o .py ilegivel, vale o topo do .spf', async () => {
        const mod = await novoModulo();
        expect(await chamar.validar(mod, CONFIG)).toMatchObject({ hdlTopModule: 'filtro', toplevelSource: 'spf' });
        api._arquivos.delete(PY);
        expect(await chamar.validar(mod, CONFIG)).toMatchObject({ hdlTopModule: 'filtro', toplevelSource: 'spf' });
    });

    it.each([
        ['sem topo Verilog no .spf', { testbenchFile: PY }, 'error.compilation.cocotbRequiresTop'],
        ['testbench que nao e Python', { testbenchFile: PROJ + '/tb.v', topLevelFile: DUT }, 'error.compilation.cocotbRequiresPythonTb'],
        ['nome de arquivo que nao e modulo Python', { testbenchFile: PROJ + '/test-filtro.py', topLevelFile: DUT },
            'cocotb testbench file name must be a valid Python module name: test-filtro.py'],
    ])('%s: recusa', async (_nome, config, mensagem) => {
        const mod = await novoModulo();
        await expect(chamar.validar(mod, config)).rejects.toThrow(mensagem);
    });
});

describe('a execucao do cocotb', () => {
    it('Wave no Icarus: o runner recebe o ambiente, a saida vira barra ou linha, e a onda e adotada', async () => {
        api._arquivos.set(TEMP + '/pc_fir_mem.txt', '0101');
        api._arquivos.set(TEMP + '/outra.txt', 'x');
        const mod = await novoModulo();
        const passos = ligarRunner({
            saida: [{ type: 'stdout', data: 'filtro: 2/4 samples processed\n  PASS test_a\n\n' }, null],
        });

        const r = await chamar.rodar(mod, CTX, TOOLS, CONFIG);

        expect(r).toBe(TEMP + '/filtro.fst');
        expect(api._arquivos.get(TEMP + '/filtro.fst')).toBe('FST');
        expect(TabManager.saveAllFiles).toHaveBeenCalled();
        expect(api.mkdir).toHaveBeenCalledWith(BUILD);
        // As memorias do processador vao para a pasta do build, onde o simulador procura.
        expect(api._arquivos.get(BUILD + '/pc_fir_mem.txt')).toBe('0101');
        expect(api._arquivos.has(BUILD + '/outra.txt')).toBe(false);
        expect(api._arquivos.get(RUNNER)).toBe(COCOTB_RUNNER_SOURCE);
        expect(resolveCocotbWaveSelection).toHaveBeenCalledWith(
            expect.objectContaining({ projectPath: PROJ }), CTX, CONFIG, FONTES);
        expect(mod._validatedWaveSelection).toEqual([]);

        expect(passos).toHaveLength(1);
        const spec = passos[0];
        expect(spec).toMatchObject({
            step: 'cocotb-run', binary: MINGW + '/python.exe', args: [RUNNER], cwd: BUILD, prependPath: [MINGW, USR],
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
            PYTHONHOME: COMP + '/Packages/msys/mingw64',
        });

        expect(api.checkFileWritable).toHaveBeenCalledWith(PROJ + '/dump.fst');
        expect(api.checkFileWritable).toHaveBeenCalledWith(PROJ + '/dump.vcd');
        expect(terminal.calls.filter((c) => !c.opts?.internal).map((c) => [c.msg, c.level])).toEqual([
            ['terminal.wave.runningCocotb', 'info'],
            ['  PASS test_a', 'raw'],
            ['terminal.wave.cocotbVcd', 'info'],
        ]);
        expect(terminal.barras).toHaveLength(1);
        expect(api._ouvintes).toHaveLength(0);
        expect(buildHierarchyFromFiles).not.toHaveBeenCalled();
    });

    it('Verilator: o perfil leva os avisos, o YANC_TRACE, o -O3 e o FST', async () => {
        localStorage.setItem('aurora.waveSimulator', 'verilator');
        const mod = await novoModulo();
        const passos = ligarRunner();

        await chamar.rodar(mod, CTX, TOOLS, CONFIG);

        expect(passos[0].env.SIM).toBe('verilator');
        expect(argsDoBuild(passos[0])).toEqual([
            '-Wno-fatal', '-Wno-TIMESCALEMOD', '-Wno-DECLFILENAME', '-Wno-STMTDLY', '-Wno-WIDTHTRUNC',
            '-Wno-WIDTHEXPAND', '+define+YANC_TRACE', '-CFLAGS', '-O3', '-CFLAGS', '-march=native', '--trace-fst',
        ]);
    });

    it('Verilator com selecao: as regras de escopo entram por um .vlt na frente dos argumentos', async () => {
        localStorage.setItem('aurora.waveSimulator', 'verilator');
        resolveCocotbWaveSelection.mockResolvedValue(['filtro.dut.y']);
        const mod = await novoModulo();
        const passos = ligarRunner();

        await chamar.rodar(mod, CTX, TOOLS, CONFIG);

        const vlt = BUILD + '/aurora_scopes.vlt';
        expect(mod._validatedWaveSelection).toEqual(['filtro.dut.y']);
        expect(buildHierarchyFromFiles).toHaveBeenCalledWith(FONTES, 'filtro');
        expect(verilatorTraceRules).toHaveBeenCalledWith({ arvore: true }, ['filtro.dut.y']);
        expect(api._arquivos.get(vlt)).toBe('`verilator_config\n'
            + '// Gerado pela AURORA a cada build: a selecao do picker por escopo.\n'
            + 'tracing_off\ntracing_on -scope "filtro.dut"\n');
        expect(argsDoBuild(passos[0])[0]).toBe(vlt);
        expect(msgs()).toContain('terminal.wave.verilatorScopeRules');
    });

    it('Verilator com selecao mas sem regras, ou com a arvore falhando: o dump sai inteiro', async () => {
        localStorage.setItem('aurora.waveSimulator', 'verilator');
        resolveCocotbWaveSelection.mockResolvedValue(['x']);
        verilatorTraceRules.mockReturnValueOnce([]);
        const mod = await novoModulo();
        const passos = ligarRunner();
        await chamar.rodar(mod, CTX, TOOLS, CONFIG);
        expect(argsDoBuild(passos[0]).at(0)).toBe('-Wno-fatal');

        buildHierarchyFromFiles.mockRejectedValueOnce(new Error('parse'));
        await chamar.rodar(mod, CTX, TOOLS, CONFIG);
        expect(argsDoBuild(passos[1]).at(0)).toBe('-Wno-fatal');
        expect(msgs()).not.toContain('terminal.wave.verilatorScopeRules');
    });

    it('Fast Sim: sem onda, sem FST, sem defesa do dump, sem adotar nada', async () => {
        localStorage.setItem('aurora.waveSimulator', 'verilator');
        resolveCocotbWaveSelection.mockResolvedValue(['x']);
        const mod = await novoModulo();
        const passos = ligarRunner({ dump: null });

        expect(await chamar.rodar(mod, CTX, TOOLS, CONFIG, { wave: false })).toBeNull();

        expect(passos[0].env.WAVES).toBe('0');
        expect(argsDoBuild(passos[0])).not.toContain('--trace-fst');
        expect(buildHierarchyFromFiles).not.toHaveBeenCalled();
        expect(api.checkFileWritable).not.toHaveBeenCalled();
        expect(msgs()).not.toContain('terminal.wave.cocotbVcd');
    });

    it('teste que falha: avisa em vermelho e ainda abre a onda', async () => {
        const mod = await novoModulo();
        ligarRunner({ code: 2 });

        expect(await chamar.rodar(mod, CTX, TOOLS, CONFIG)).toBe(TEMP + '/filtro.fst');

        expect(msgs()).toContain('terminal.wave.cocotbTestsFailed');
        expect(statusUpdater.compilationError).toHaveBeenCalledWith('verilog', 'cocotb tests failed');
    });

    it('falha de infraestrutura para, com o codigo', async () => {
        window.t = (k, p) => (p ? `${k} ${p.code}` : k);
        try {
            const mod = await novoModulo();
            ligarRunner({ code: 1 });
            await expect(chamar.rodar(mod, CTX, TOOLS, CONFIG)).rejects.toThrow('error.compilation.cocotbFailed 1');
            expect(api._ouvintes).toHaveLength(0);
        } finally {
            delete window.t;
        }
    });

    it('dump travado para antes de rodar, sem deixar o ouvinte ligado', async () => {
        api.checkFileWritable.mockResolvedValue({ exists: true, writable: false, code: 'EPERM' });
        const mod = await novoModulo();
        const passos = ligarRunner();
        await expect(chamar.rodar(mod, CTX, TOOLS, CONFIG)).rejects.toThrow('error.compilation.dumpLockedDenied');
        expect(passos).toHaveLength(0);
        // A defesa vem antes de ligar o ouvinte do fluxo. Com ela depois, a
        // recusa deixava o ouvinte ligado, e toda saida em fluxo que viesse
        // depois, de qualquer passo, era repetida no TWAVE.
        expect(api._ouvintes).toHaveLength(0);
    });

    it('sem pasta de projeto, a do testbench faz as vezes; sem fluxo ao vivo roda igual', async () => {
        delete api.onExecSpecStream;
        const mod = await novoModulo();
        mod.projectPath = null;
        const passos = ligarRunner({ dump: PROJ + '/Simulation/dump.vcd' });

        expect(await chamar.rodar(mod, CTX, TOOLS, CONFIG)).toBe(TEMP + '/filtro.vcd');

        expect(passos[0].env.AURORA_COCOTB_TEST_DIR).toBe(PROJ + '/Simulation');
        expect(passos[0].env.AURORA_COCOTB_PYTHONPATH).toBe(`${PROJ}/Simulation;${BUILD}`);
        expect(api.checkFileWritable).toHaveBeenCalledWith(PROJ + '/Simulation/dump.fst');
    });

    describe('o Python do pacote', () => {
        it.each([
            ['sem o python.exe', () => api._arquivos.delete(MINGW + '/python.exe'), 'error.compilation.cocotbPythonMissing'],
            ['Python que nao responde', () => api.getPythonStatus.mockResolvedValue(null), 'error.compilation.cocotbPackageMissing'],
            ['Python sem o cocotb', () => api.getPythonStatus.mockResolvedValue({ ok: true }), 'error.compilation.cocotbPackageMissing'],
            ['sem o Verilator no pacote', () => api._arquivos.delete(MINGW + '/verilator'), 'error.toolchain.verilatorNotFound'],
        ])('%s: recusa antes de rodar', async (_nome, preparar, mensagem) => {
            preparar();
            const mod = await novoModulo();
            const passos = ligarRunner();
            await expect(chamar.rodar(mod, CTX, TOOLS, CONFIG)).rejects.toThrow(mensagem);
            expect(passos).toHaveLength(0);
        });
    });

    describe('as fontes e as memorias', () => {
        it('sem a biblioteca HDL, vao so as fontes do projeto; topo nao Verilog fica fora', async () => {
            api.listFilesInDirectory.mockImplementation(async (dir) => {
                if (dir === COMP + '/HDL') throw new Error('EACCES');
                return [];
            });
            const mod = await novoModulo();
            const passos = ligarRunner({ dump: null });
            await chamar.rodar(mod, CTX, TOOLS, { ...CONFIG, topLevelFile: PROJ + '/topo.vhd' }, { wave: false });
            expect(JSON.parse(passos[0].env.AURORA_COCOTB_SOURCES_JSON)).toEqual([DUT]);
        });

        it('HDL que nao lista como lista, ou pasta Temp que nao lista: segue sem', async () => {
            api.listFilesInDirectory.mockImplementation(async (dir) => {
                if (dir === COMP + '/HDL') return null;
                throw new Error('EACCES');
            });
            const mod = await novoModulo({ ...CONFIG, synthesizableFiles: undefined });
            const passos = ligarRunner({ dump: null });
            await chamar.rodar(mod, CTX, TOOLS, CONFIG, { wave: false });
            expect(JSON.parse(passos[0].env.AURORA_COCOTB_SOURCES_JSON)).toEqual([DUT]);
        });

        it('memoria que nao copia e nome estranho na Temp sao ignorados', async () => {
            api._arquivos.set(TEMP + '/pc_a_mem.txt', 'a');
            api.listFilesInDirectory.mockImplementation(async (dir) => (
                dir === TEMP ? [42, 'pc_a_mem.txt'] : []));
            api.copyFile.mockRejectedValueOnce(new Error('EPERM'));
            const mod = await novoModulo();
            ligarRunner({ dump: null });
            await expect(chamar.rodar(mod, CTX, TOOLS, CONFIG, { wave: false })).resolves.toBeNull();
        });
    });

    describe('adotar a onda', () => {
        it('dump na pasta do projeto, sob outro nome unico, tambem serve', async () => {
            const mod = await novoModulo();
            ligarRunner({ dump: PROJ + '/sessao.fst' });
            expect(await chamar.rodar(mod, CTX, TOOLS, CONFIG)).toBe(TEMP + '/filtro.fst');
        });

        it('dump que ja esta no lugar canonico nao e copiado', async () => {
            const mod = await novoModulo();
            ligarRunner({ dump: TEMP + '/filtro.fst' });
            const tools = { tempBaseDir: TEMP };
            // O build dir e a Temp: o candidato e o proprio alvo.
            const ctx = { ...CTX, tbKey: '' };
            api.joinPath.mockImplementation(async (...p) => {
                const j = p.join('/').replace(/\/+/g, '/');
                return j === `${TEMP}/cocotb_cocotb` ? TEMP : j;
            });
            expect(await chamar.rodar(mod, ctx, tools, CONFIG)).toBe(TEMP + '/filtro.fst');
            expect(api.copyFile).not.toHaveBeenCalledWith(TEMP + '/filtro.fst', TEMP + '/filtro.fst');
        });

        it('nenhum dump em lugar nenhum: erro que diz onde procurou', async () => {
            window.t = (k, p) => (p ? `${k} ${p.path}` : k);
            try {
                const mod = await novoModulo();
                ligarRunner({ dump: null });
                await expect(chamar.rodar(mod, CTX, TOOLS, CONFIG)).rejects.toThrow(`error.compilation.cocotbNoWave ${BUILD}`);
                mod.projectPath = null;
                await expect(chamar.rodar(mod, CTX, TOOLS, CONFIG)).rejects.toThrow('error.compilation.cocotbNoWave');
            } finally {
                delete window.t;
            }
        });

        it('copia que nao aparece no destino: o mesmo erro', async () => {
            api.copyFile.mockImplementation(async () => {});
            const mod = await novoModulo();
            ligarRunner();
            await expect(chamar.rodar(mod, CTX, TOOLS, CONFIG)).rejects.toThrow('error.compilation.cocotbNoWave');
        });
    });
});
