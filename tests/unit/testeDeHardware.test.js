// @vitest-environment happy-dom
//
// O teste de hardware: o processador ativo rodando no Verilator, com o harness
// C++ gerado a partir das portas e da fiacao de I/O do proprio <proc>.v. A saida
// vai para o terminal THTEST.
//
// Entra pelo CompilationModule.verilatorProcessorRun, que e o que o
// compilation_flow chama, para que o mesmo arquivo prove o comportamento antes e
// depois de esta parte sair do compilation_module.js. O que fica travado: os
// tres passos da toolchain e o que cada um recebe, o harness que vai para a
// Temp, a leitura do laco @fim no app_log.txt, o fluxo do executavel (barra,
// fim antecipado, PC invisivel, linhas comuns) e cada desistencia com a sua
// mensagem.
//
// O gerador do harness e os leitores de portas tem as suas regras em
// verilator_tb.ts; aqui sao falsos, porque o que interessa e o que o fluxo passa
// a eles e o que faz com a resposta.

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
let terminal;
vi.mock('../../js/terminal/terminal_module.js', () => ({
    TerminalManager: class {
        constructor() { return terminal; }
    },
}));
vi.mock('../../js/project/active_processor.js', () => ({ getActiveProcessorName: vi.fn() }));
vi.mock('../../js/compilation/verilator_tb.js', async (original) => ({
    ...(await original()),
    parseVerilatorPorts: vi.fn(),
    parseProcessorIO: vi.fn(),
    generateVerilatorProcTb: vi.fn(),
}));

import { runSpec, runSpecStreamed } from '../../js/compilation/spec_runner.js';
import { getActiveProcessorName } from '../../js/project/active_processor.js';
import {
    parseVerilatorPorts, parseProcessorIO, generateVerilatorProcTb,
} from '../../js/compilation/verilator_tb.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';
const PROC = 'fir';
const PROC_V = `${PROJ}/${PROC}/Hardware/${PROC}.v`;
const SIM = `${PROJ}/${PROC}/Simulation`;
const OBJ = `${TEMP}/obj_dir_proc_${PROC}`;
const EXE = `${OBJ}/V${PROC}.exe`;
const JSON_ARVORE = `${OBJ}/V${PROC}.tree.json`;
const CPP = `${TEMP}/tl_proc_${PROC}.cpp`;
const APP_LOG = `${TEMP}/${PROC}/app_log.txt`;
const MINGW = COMP + '/Packages/msys/mingw64/bin';
const T = 'thtest';

const PORTAS = [{ name: 'clk', dir: 'input', width: 1 }];
const FIACAO = {
    inputs: [{ file: 'entrada.txt', reqValue: 1 }],
    outputs: [{ file: 'saida.txt', enValue: 2 }, { file: 'log.txt', enValue: 3 }],
};

function makeTerminal({ comLinkDePasta = true } = {}) {
    const calls = [];
    const t = {
        calls,
        barras: [],
        linhas: [],
        saidas: [],
        appendToTerminal: (term, msg, level, opts) => calls.push({ term, msg, level, opts }),
        processExecutableOutput: (term, r) => t.saidas.push([term, r]),
        renderHardwareProgress: (term, p) => t.barras.push([term, p]),
        processStreamedLine: (term, l) => t.linhas.push([term, l]),
    };
    if (comLinkDePasta) t.appendFolderLink = vi.fn((term, msg, pasta, level) => calls.push({ term, msg, level, pasta }));
    return t;
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
        fileExists: vi.fn(async (p) => arquivos.has(p)),
        readFile: vi.fn(async (p) => {
            if (!arquivos.has(p)) throw new Error('ENOENT ' + p);
            return arquivos.get(p);
        }),
        writeFile: vi.fn(async (p, c) => { arquivos.set(p, c); }),
        mkdir: vi.fn(async () => {}),
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

/**
 * A toolchain falsa: o --json-only escreve a arvore, o build escreve o exe, e o
 * executavel imprime o que `saida` mandar pelo fluxo.
 */
function ligarToolchain({ jsonCode = 0, buildCode = 0, runCode = 0, escreveJson = true, exe = EXE, saida = [] } = {}) {
    const passos = [];
    runSpec.mockImplementation(async (spec) => {
        passos.push(spec);
        if (spec.step === 'verilator-json') {
            if (jsonCode === 0 && escreveJson) api._arquivos.set(JSON_ARVORE, '{"modulesp":[]}');
            return { code: jsonCode };
        }
        if (spec.step === 'verilator-tb-build') {
            if (buildCode === 0 && exe) api._arquivos.set(exe, 'MZ');
            return { code: buildCode };
        }
        throw new Error('passo inesperado ' + spec.step);
    });
    runSpecStreamed.mockImplementation(async (spec) => {
        passos.push(spec);
        for (const data of saida) api._emitir(data);
        return { code: runCode };
    });
    return passos;
}

async function novoModulo(config) {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    mod.projectConfig = config;
    return mod;
}

const CONFIG = { processors: ['outro', { name: PROC, numClocks: 100 }] };
const msgs = () => terminal.calls.map((c) => c.msg);
const niveis = () => terminal.calls.filter((c) => !c.opts?.internal).map((c) => [c.msg, c.level]);

beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
    api._arquivos.set(PROC_V, 'module fir(); endmodule');
    api._arquivos.set(MINGW + '/verilator', '#!perl');
    api._arquivos.set(MINGW + '/perl.exe', 'MZ');
    api._arquivos.set(APP_LOG, 'algo\n@fim 42\nresto\n');
    getActiveProcessorName.mockReturnValue(PROC);
    parseVerilatorPorts.mockReturnValue(PORTAS);
    parseProcessorIO.mockReturnValue(FIACAO);
    generateVerilatorProcTb.mockReturnValue({ source: '// harness', hasItr: true });
});

afterEach(() => {
    delete window.electronAPI;
    delete window._latestCompilationModule;
    vi.clearAllMocks();
});

describe('verilatorProcessorRun', () => {
    it('portas, harness, build e execucao, nesta ordem, no terminal THTEST', async () => {
        const passos = ligarToolchain({
            saida: [
                { type: 'stdout', data: '@@AURORA_PROG 10 100 2\r\nsaida comum\n\n' },
                { type: 'stdout', data: 'progress: 50%\n@@AURORA_NOPC\n' },
                { type: 'stdout', data: '@@AURORA_CHEGUEI 57\n' },
                null,
                { type: 'stdout' },
            ],
        });
        const mod = await novoModulo(CONFIG);

        await mod.verilatorProcessorRun();

        expect(passos.map((p) => p.step)).toEqual(['verilator-json', 'verilator-tb-build', 'verilator-tb-run']);
        expect(api.mkdir).toHaveBeenCalledWith(OBJ);
        // O --json-only le so o <proc>.v; o build leva junto o harness.
        expect(passos[0].args).toContain(PROC_V);
        expect(passos[1].args).toContain(CPP);
        expect(passos[2]).toMatchObject({ binary: EXE, cwd: SIM });
        expect(passos[2].args).toEqual(['+cycles=100']);

        // A arvore do --json-only vira portas; o <proc>.v, a fiacao.
        expect(parseVerilatorPorts).toHaveBeenCalledWith({ modulesp: [] });
        expect(parseProcessorIO).toHaveBeenCalledWith('module fir(); endmodule');
        expect(generateVerilatorProcTb).toHaveBeenCalledWith({
            topModule: PROC, ports: PORTAS, inputs: FIACAO.inputs, outputs: FIACAO.outputs,
            numClocks: 100, fimAddr: 42,
        });
        expect(api._arquivos.get(CPP)).toBe('// harness');

        // A barra anda com o harness e fecha no clock em que o PC chegou ao @fim.
        expect(terminal.barras).toEqual([
            [T, { pct: 10, cyc: 10, total: 100, reads: 2, label: 'terminal.htest.exec' }],
            [T, { pct: 50, cyc: null, total: 100, reads: null, label: 'terminal.htest.exec' }],
            [T, { pct: 57, cyc: 57, total: 100, reads: 2, label: 'terminal.htest.exec', done: true }],
        ]);
        // So a linha comum chega ao terminal; o resto e barra ou sinal.
        expect(terminal.linhas).toEqual([[T, 'saida comum']]);
        expect(terminal.saidas.map(([t]) => t)).toEqual([T, T]);
        expect(api._ouvintes).toHaveLength(0);

        expect(niveis()).toEqual([
            ['terminal.htest.start', 'info'],
            ['terminal.wave.procPorts', 'info'],
            ['terminal.htest.genCpp', 'info'],
            ['terminal.wave.procWiring', 'info'],
            ['terminal.wave.procBuilding', 'info'],
            ['terminal.wave.procRunning', 'info'],
            ['terminal.htest.pcNotVisible', 'warning'],
            ['terminal.htest.chegueiEnd', 'success'],
            ['terminal.wave.procDone', 'success'],
        ]);
        // Os tres comandos vao ao terminal como linha interna.
        expect(terminal.calls.filter((c) => c.opts?.internal)).toHaveLength(3);
        expect(terminal.appendFolderLink).toHaveBeenCalledWith(T, 'terminal.wave.procDone', SIM, 'success');
    });

    it('a fiacao e o resumo final chegam com os nomes dos arquivos', async () => {
        const traduzidas = [];
        window.t = (k, p) => { traduzidas.push([k, p]); return k; };
        try {
            ligarToolchain();
            const mod = await novoModulo(CONFIG);
            await mod.verilatorProcessorRun();

            const de = (k) => traduzidas.find(([x]) => x === k)[1];
            expect(de('terminal.htest.start')).toEqual({ name: PROC, clocks: 100 });
            expect(de('terminal.wave.procWiring')).toEqual({
                inputs: 'entrada.txt@req1', outputs: 'saida.txt@en2, log.txt@en3', itr: 'itr=0',
            });
            expect(de('terminal.wave.procDone')).toEqual({ dir: SIM, outputs: 'saida.txt, log.txt' });
        } finally {
            delete window.t;
        }
    });

    it('sem portas de I/O nem itr: avisa e resume com travessoes', async () => {
        const traduzidas = [];
        window.t = (k, p) => { traduzidas.push([k, p]); return k; };
        try {
            parseProcessorIO.mockReturnValue({ inputs: [], outputs: [] });
            generateVerilatorProcTb.mockReturnValue({ source: '//', hasItr: false });
            ligarToolchain();
            const mod = await novoModulo(CONFIG);
            await mod.verilatorProcessorRun();

            expect(niveis()).toContainEqual(['terminal.wave.procNoPorts', 'warning']);
            const de = (k) => traduzidas.find(([x]) => x === k)[1];
            expect(de('terminal.wave.procWiring')).toEqual({ inputs: '—', outputs: '—', itr: 'sem itr' });
            expect(de('terminal.wave.procDone').outputs).toBe('—');
        } finally {
            delete window.t;
        }
    });

    it('rodada completa sem fluxo ao vivo: a barra fecha no teto de clocks', async () => {
        delete api.onExecSpecStream;
        ligarToolchain();
        const mod = await novoModulo({ processors: [{ name: PROC }] });

        await mod.verilatorProcessorRun();

        // Sem numClocks no .spf, o teto e 2000.
        expect(generateVerilatorProcTb.mock.calls[0][0].numClocks).toBe(2000);
        expect(terminal.barras).toEqual([
            [T, { pct: 100, cyc: 2000, total: 2000, reads: null, label: 'terminal.htest.exec', done: true }],
        ]);
        expect(msgs()).not.toContain('terminal.htest.chegueiEnd');
    });

    it('numClocks zero no .spf: a barra fecha em 100%', async () => {
        ligarToolchain();
        const mod = await novoModulo({ processors: [{ name: PROC, numClocks: 0 }] });
        await mod.verilatorProcessorRun();
        expect(terminal.barras.at(-1)[1]).toMatchObject({ pct: 100, cyc: 0, total: 0, done: true });
    });

    it('sem link de pasta no terminal, o fim vai como mensagem comum', async () => {
        terminal = makeTerminal({ comLinkDePasta: false });
        ligarToolchain();
        const mod = await novoModulo(CONFIG);
        await mod.verilatorProcessorRun();
        expect(terminal.calls.at(-1)).toMatchObject({ term: T, msg: 'terminal.wave.procDone', level: 'success' });
    });

    it.each([
        ['sem app_log.txt', () => api._arquivos.delete(APP_LOG)],
        ['app_log.txt sem a linha @fim', () => api._arquivos.set(APP_LOG, '@fimx 3\n@fim\n')],
    ])('%s: avisa que roda o teto e segue', async (_nome, preparar) => {
        preparar();
        ligarToolchain();
        const mod = await novoModulo(CONFIG);
        await mod.verilatorProcessorRun();
        expect(niveis()).toContainEqual(['terminal.htest.fimUnknown', 'warning']);
        expect(generateVerilatorProcTb.mock.calls[0][0].fimAddr).toBeNull();
    });

    it('exe sem extensao (build fora do Windows) tambem serve', async () => {
        const passos = ligarToolchain({ exe: `${OBJ}/V${PROC}` });
        const mod = await novoModulo(CONFIG);
        await mod.verilatorProcessorRun();
        expect(passos[2].binary).toBe(`${OBJ}/V${PROC}`);
    });

    describe('desistencias', () => {
        beforeEach(() => {
            window.t = (k, p) => (p ? `${k} ${Object.values(p).join(' ')}` : k);
        });
        afterEach(() => { delete window.t; });

        it.each([
            ['sem configuracao', null, () => {}, 'error.config.notLoaded'],
            ['sem processador ativo', CONFIG, () => getActiveProcessorName.mockReturnValue(''), 'error.compilation.noActiveProcessor'],
            ['ativo que nao esta no .spf', { processors: ['outro', null, {}] }, () => {}, 'error.compilation.noActiveProcessor'],
            ['.spf sem lista de processadores', { processors: 'fir' }, () => {}, 'error.compilation.noActiveProcessor'],
            ['sem o <proc>.v', CONFIG, () => api._arquivos.delete(PROC_V), `error.compilation.procVMissing ${PROC_V}`],
            ['sem o Verilator', CONFIG, () => api._arquivos.delete(MINGW + '/verilator'), 'error.toolchain.verilatorNotFound'],
        ])('%s', async (_nome, config, preparar, mensagem) => {
            preparar();
            const passos = ligarToolchain();
            const mod = await novoModulo(config);
            await expect(mod.verilatorProcessorRun()).rejects.toThrow(mensagem);
            expect(passos).toHaveLength(0);
        });

        it.each([
            ['--json-only falha', { jsonCode: 3 }, 'error.compilation.verilatorJsonFailed 3', 1],
            ['--json-only nao escreve a arvore', { escreveJson: false }, `error.compilation.verilatorJsonMissing ${JSON_ARVORE}`, 1],
            ['build falha', { buildCode: 2 }, 'error.compilation.verilatorTbBuildFailed 2', 2],
            ['build sem executavel', { exe: null }, `error.compilation.verilatorExeMissing ${EXE}`, 2],
            ['executavel sai com erro', { runCode: 1 }, 'error.compilation.verilatorTbRunFailed 1', 3],
        ])('%s', async (_nome, opcoes, mensagem, quantos) => {
            const passos = ligarToolchain(opcoes);
            const mod = await novoModulo(CONFIG);
            await expect(mod.verilatorProcessorRun()).rejects.toThrow(mensagem);
            expect(passos).toHaveLength(quantos);
            expect(api._ouvintes).toHaveLength(0);
        });

        it('executavel que lanca ainda desliga o ouvinte do fluxo', async () => {
            ligarToolchain();
            runSpecStreamed.mockRejectedValueOnce(new Error('morto'));
            const mod = await novoModulo(CONFIG);
            await expect(mod.verilatorProcessorRun()).rejects.toThrow('morto');
            expect(api._ouvintes).toHaveLength(0);
        });
    });
});
