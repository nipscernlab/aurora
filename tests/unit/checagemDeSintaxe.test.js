// @vitest-environment happy-dom
//
// As duas checagens de sintaxe pelo iverilog -tnull (elabora sem gerar .vvp):
//
//   - verilogSyntaxCheck, o botao Verilog: so as fontes sintetizaveis, com o
//     topo do .spf, e depois a hierarquia do projeto pelo Yosys;
//   - syntaxCheck, a porta da Wave Configuration: o design inteiro com o
//     testbench cru, para o seletor de sinais nao abrir sobre codigo que o
//     iverilog nem le. Nunca lanca: devolve { success, message }.
//
// A geracao da hierarquia tem teste proprio (hierarquiaDoProjeto) e aqui e
// falsa. `chamar` e o unico ponto que sabe onde cada peca mora.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/compilation/spec_runner.js', () => ({
    runSpec: vi.fn(), runSpecStreamed: vi.fn(), setAuditHook: vi.fn(), setTerminalHook: vi.fn(), resolveSpec: vi.fn(),
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
vi.mock('../../js/compilation/hierarquia_do_projeto.js', () => ({
    gerarHierarquiaDoProjeto: vi.fn(async () => true),
}));

import { runSpec } from '../../js/compilation/spec_runner.js';
import { TabManager } from '../../js/tabs/tab_manager.js';
import { statusUpdater } from '../../js/ui/status_updater.js';
import { gerarHierarquiaDoProjeto } from '../../js/compilation/hierarquia_do_projeto.js';
import { pedirCancelamento, iniciarRodada } from '../../js/compilation/cancelamento.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';

const chamar = {
    doBotao: (mod) => mod.verilogSyntaxCheck(),
    daWaveConfig: (mod) => mod.syntaxCheck(),
};

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';
const IVERILOG = COMP + '/Packages/msys/mingw64/bin/iverilog.exe';
const DUT = PROJ + '/Hardware/filtro.v';
const SUB = PROJ + '/Hardware/soma.v';
const TB = PROJ + '/Simulation/filtro_tb.v';

function makeTerminal() {
    const calls = [];
    return {
        calls,
        appendToTerminal: (term, msg, level, opts) => calls.push({ term, msg, level, opts }),
        processExecutableOutput: vi.fn(),
    };
}

let api;
function makeFakeApi() {
    const arquivos = new Map();
    return {
        _arquivos: arquivos,
        joinPath: vi.fn(async (...partes) => {
            if (!partes.every((p) => typeof p === 'string')) throw new TypeError('join-path');
            return partes.join('/').replace(/\/+/g, '/');
        }),
        fileExists: vi.fn(async (p) => arquivos.has(p)),
        mkdir: vi.fn(async () => {}),
        getComponentsPath: vi.fn(async () => COMP),
    };
}

const SPF = {
    synthesizableFiles: [{ path: DUT, name: 'filtro.v', isTopLevel: true }, { path: SUB, name: 'soma.v' }],
    testbenchFile: TB,
};

async function novoModulo(config = SPF) {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    mod.projectConfig = config;
    return mod;
}

function ligarIverilog(code = 0) {
    const passos = [];
    runSpec.mockImplementation(async (spec) => { passos.push(spec); return { code }; });
    return passos;
}

const visiveis = () => terminal.calls.filter((c) => !c.opts?.internal).map((c) => [c.msg, c.level]);

beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
    window.t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
    api._arquivos.set(IVERILOG, 'MZ');
});

afterEach(() => {
    delete window.electronAPI;
    delete window._latestCompilationModule;
    delete window.t;
    iniciarRodada();
    vi.clearAllMocks();
});

describe('o botao Verilog', () => {
    it('checa so as sintetizaveis com o topo do .spf e regenera a hierarquia', async () => {
        const mod = await novoModulo();
        const passos = ligarIverilog();

        await chamar.doBotao(mod);

        expect(statusUpdater.startCompilation).toHaveBeenCalledWith('verilog');
        expect(api.mkdir).toHaveBeenCalledWith(TEMP);
        expect(TabManager.saveAllFiles).toHaveBeenCalled();
        expect(passos).toHaveLength(1);
        expect(passos[0]).toMatchObject({ binary: IVERILOG, cwd: PROJ });
        expect(passos[0].args).toEqual(expect.arrayContaining(['-tnull', '-s', 'filtro', '-y', COMP + '/HDL', DUT, SUB]));
        expect(passos[0].args).not.toContain(TB);
        expect(visiveis()).toEqual([
            ['terminal.veri.phaseCheck', 'info'],
            ['terminal.veri.topLevel {"name":"filtro.v"}', 'tips'],
            ['terminal.veri.synthFiles {"count":2}', 'info'],
            ['terminal.veri.checking', 'info'],
            ['terminal.veri.checkSuccess', 'success'],
        ]);
        expect(terminal.calls.filter((c) => c.opts?.internal)[0].msg).toBe('terminal.veri.checkCmd');
        expect(terminal.processExecutableOutput).toHaveBeenCalledWith('tveri', { code: 0 });
        expect(statusUpdater.compilationSuccess).toHaveBeenCalledWith('verilog');
        expect(gerarHierarquiaDoProjeto).toHaveBeenCalledTimes(1);
    });

    it('iverilog que acusa erro: banner de falha, erro para cima, sem hierarquia', async () => {
        const mod = await novoModulo();
        ligarIverilog(1);
        const erro = await chamar.doBotao(mod).catch((e) => e);
        expect(erro.message).toBe('error.compilation.iverilogFailedCheck {"code":1}');
        expect(erro.jaNoTerminal).toBe(true);
        expect(visiveis().slice(-2)).toEqual([
            ['terminal.veri.bannerFailed', 'error'],
            ['terminal.common.error {"message":"error.compilation.iverilogFailedCheck {\\"code\\":1}"}', 'error'],
        ]);
        expect(statusUpdater.compilationError).toHaveBeenCalledWith('verilog', erro.message);
        expect(gerarHierarquiaDoProjeto).not.toHaveBeenCalled();
    });

    it.each([
        ['sem sintetizaveis', { synthesizableFiles: [] }, 'error.config.noSynth'],
        ['sem topo marcado', { synthesizableFiles: [{ path: DUT }] }, 'error.config.noTopLevel'],
        ['sem configuracao', null, 'Project configuration not loaded'],
    ])('%s: recusa antes do iverilog', async (_nome, config, mensagem) => {
        const mod = await novoModulo(config);
        const passos = ligarIverilog();
        await expect(chamar.doBotao(mod)).rejects.toThrow(mensagem);
        expect(passos).toHaveLength(0);
    });

    it('sem o iverilog empacotado, recusa nomeando o caminho', async () => {
        api._arquivos.delete(IVERILOG);
        const mod = await novoModulo();
        await expect(chamar.doBotao(mod)).rejects.toThrow(`error.toolchain.iverilogNotFound {"path":"${IVERILOG}"}`);
    });

    it('cancelado pelo usuario: sem banner de falha', async () => {
        pedirCancelamento();
        const mod = await novoModulo();
        ligarIverilog(1);
        const erro = await chamar.doBotao(mod).catch((e) => e);
        expect(erro.jaNoTerminal).toBeUndefined();
        expect(visiveis().map(([m]) => m)).not.toContain('terminal.veri.bannerFailed');
    });
});

describe('a porta da Wave Configuration', () => {
    it('checa o design inteiro com o testbench cru como topo', async () => {
        const mod = await novoModulo();
        const passos = ligarIverilog();

        expect(await chamar.daWaveConfig(mod)).toEqual({ success: true });

        expect(passos[0].args).toEqual(expect.arrayContaining(['-tnull', '-s', 'filtro_tb', DUT, SUB, TB]));
        expect(visiveis()).toEqual([
            ['terminal.veri.bannerSyntaxWc', 'info'],
            ['terminal.veri.simTop {"name":"filtro_tb"}', 'info'],
            ['terminal.veri.bannerSyntaxPassed', 'success'],
        ]);
        expect(terminal.processExecutableOutput).toHaveBeenCalledWith('tveri', { code: 0 });
        expect(api.mkdir).not.toHaveBeenCalled();
    });

    it('testbench Python fica fora, e o topo e o do .spf', async () => {
        const mod = await novoModulo({ ...SPF, testbenchFile: PROJ + '/test_filtro.py' });
        const passos = ligarIverilog();
        await chamar.daWaveConfig(mod);
        expect(passos[0].args).toEqual(expect.arrayContaining(['-s', 'filtro']));
        expect(passos[0].args).not.toContain(PROJ + '/test_filtro.py');
    });

    it('iverilog que acusa erro: banner de falha e success false', async () => {
        const mod = await novoModulo();
        ligarIverilog(2);
        expect(await chamar.daWaveConfig(mod)).toEqual({
            success: false, message: 'Iverilog reported errors (exit 2). See terminal.',
        });
        expect(visiveis().at(-1)).toEqual(['terminal.veri.bannerSyntaxFailed', 'error']);
    });

    it('sem o iverilog: mensagem com o caminho, no terminal e na resposta', async () => {
        api._arquivos.delete(IVERILOG);
        const mod = await novoModulo();
        const msg = `error.toolchain.iverilogNotFound {"path":"${IVERILOG}"}`;
        expect(await chamar.daWaveConfig(mod)).toEqual({ success: false, message: msg });
        expect(visiveis()).toEqual([[msg, 'error']]);
    });

    it('configuracao que nao passa: nunca lanca', async () => {
        const mod = await novoModulo({ synthesizableFiles: [] });
        expect(await chamar.daWaveConfig(mod)).toEqual({ success: false, message: 'error.config.noSynth' });
        expect(visiveis()).toEqual([['terminal.veri.syntaxError {"message":"error.config.noSynth"}', 'error']]);
    });

    it('espera a pasta de componentes quando ela ainda nao chegou', async () => {
        const mod = await novoModulo();
        mod.componentsPath = null;
        mod._componentsPathPronto = null;
        ligarIverilog();
        expect(await chamar.daWaveConfig(mod)).toEqual({ success: true });
        expect(api.getComponentsPath).toHaveBeenCalledTimes(2);
    });
});
