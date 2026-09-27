// @vitest-environment happy-dom
//
// O cabecalho de texto de um FST (a hierarquia de $scope/$var ate o
// $enddefinitions), que o seletor de sinais e o .gtkw automatico leem.
//
// O caminho de sempre le o fst2vcd em fluxo e o mata no $enddefinitions, sem
// converter o corpo do dump, que pode ter centenas de megabytes. A reserva, sem
// fluxo ou quando o cabecalho nao apareceu, converte o dump inteiro e avisa,
// porque a espera parece travamento. `chamar` e o unico ponto que sabe onde a
// extracao mora.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/compilation/spec_runner.js', () => ({
    runSpec: vi.fn(), runSpecStreamed: vi.fn(), setAuditHook: vi.fn(), setTerminalHook: vi.fn(), resolveSpec: vi.fn(),
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

import { runSpec, runSpecStreamed } from '../../js/compilation/spec_runner.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';
import { extrairCabecalhoDoFst } from '../../js/compilation/cabecalho_do_dump.js';

const chamar = {
    extrair: (mod, ...a) => extrairCabecalhoDoFst(mod.terminalManager, ...a),
};

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';
const FST = PROJ + '/tb.fst';
const HEADER = PROJ + '/tb.header.vcd';
const BIN = COMP + '/Packages/gtkwave-nipscern/fst2vcd.exe';
const CAB = '$timescale 1ns $end\n$scope module tb $end\n$var wire 1 ! clk $end\n$upscope $end\n$enddefinitions $end';

function makeTerminal() {
    const calls = [];
    return { calls, appendToTerminal: (term, msg, level) => calls.push({ term, msg, level }) };
}

let api;
function makeFakeApi() {
    const arquivos = new Map();
    const a = {
        _arquivos: arquivos,
        joinPath: vi.fn(async (...p) => p.join('/')),
        fileExists: vi.fn(async (p) => arquivos.has(p)),
        writeFile: vi.fn(async (p, c) => { arquivos.set(p, c); }),
        getFileStats: vi.fn(async (p) => ({ size: String(arquivos.get(p) ?? '').length })),
        getComponentsPath: vi.fn(async () => COMP),
        killCurrentSpecProcess: vi.fn(async () => ({ success: true })),
        _ouvintes: [],
        onExecSpecStream: vi.fn((cb) => {
            a._ouvintes.push(cb);
            return () => { a._ouvintes = a._ouvintes.filter((o) => o !== cb); };
        }),
        _emitir(payload) { for (const o of [...a._ouvintes]) o(payload); },
    };
    return a;
}

async function novoModulo() {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    return mod;
}

/** O fst2vcd em fluxo: emite os pedacos na ordem. */
function fluxo(pedacos, { lanca = false } = {}) {
    runSpecStreamed.mockImplementation(async (spec) => {
        expect(spec).toEqual({
            step: 'fst2vcd', binary: BIN, args: ['-f', FST], cwd: TEMP,
            label: 'fst2vcd (header only — cancelled at $enddefinitions)',
        });
        for (const p of pedacos) api._emitir(p);
        if (lanca) throw new Error('morto pelo kill');
        return { code: 0 };
    });
}

/** A conversao inteira: escreve o que mandarem no -o. */
function conversao({ code = 0, conteudo = CAB } = {}) {
    runSpec.mockImplementation(async (spec) => {
        const saida = spec.args[spec.args.indexOf('-o') + 1];
        if (conteudo !== null) api._arquivos.set(saida, conteudo);
        return { code };
    });
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

describe('o cabecalho pelo fluxo', () => {
    it('para no $enddefinitions, mata o fst2vcd uma vez e grava so o cabecalho', async () => {
        fluxo([
            { type: 'stderr', data: 'aviso' },
            { type: 'stdout', data: '' },
            null,
            { type: 'stdout', data: CAB.slice(0, 20) },
            { type: 'stdout', data: CAB.slice(20) + '\n#0\n1!\n' },
            { type: 'stdout', data: '#5\n0!\n' },
        ]);
        const mod = await novoModulo();

        expect(await chamar.extrair(mod, FST, HEADER, BIN, TEMP)).toBe(true);

        expect(api._arquivos.get(HEADER)).toBe(CAB + '\n');
        expect(api.killCurrentSpecProcess).toHaveBeenCalledTimes(1);
        expect(runSpec).not.toHaveBeenCalled();
        expect(api._ouvintes).toHaveLength(0);
        expect(msgs()).toEqual([]);
    });

    it('fst2vcd que lanca depois do kill ainda entrega o cabecalho', async () => {
        fluxo([{ type: 'stdout', data: CAB }], { lanca: true });
        const mod = await novoModulo();
        expect(await chamar.extrair(mod, FST, HEADER, BIN, TEMP)).toBe(true);
        expect(api._ouvintes).toHaveLength(0);
    });

    it('kill que falha nao derruba a extracao', async () => {
        api.killCurrentSpecProcess.mockRejectedValueOnce(new Error('ja morreu'));
        fluxo([{ type: 'stdout', data: CAB }]);
        const mod = await novoModulo();
        expect(await chamar.extrair(mod, FST, HEADER, BIN, TEMP)).toBe(true);
    });

    it('fluxo que termina sem o $enddefinitions cai na conversao inteira, com aviso', async () => {
        fluxo([{ type: 'stdout', data: '$scope module tb $end\n' }]);
        conversao();
        const mod = await novoModulo();

        expect(await chamar.extrair(mod, FST, HEADER, BIN, TEMP)).toBe(true);

        expect(api.killCurrentSpecProcess).not.toHaveBeenCalled();
        expect(terminal.calls).toEqual([{ term: 'twave', msg: 'terminal.wave.headerFallback', level: 'tips' }]);
        expect(runSpec.mock.calls[0][0]).toMatchObject({ binary: BIN, cwd: TEMP });
        expect(runSpec.mock.calls[0][0].args).toEqual(expect.arrayContaining([FST, '-o', HEADER]));
    });
});

describe('a conversao inteira', () => {
    beforeEach(() => { delete api.onExecSpecStream; });

    it('sem fluxo ao vivo, converte, avisa e confere o arquivo', async () => {
        conversao();
        const mod = await novoModulo();
        expect(await chamar.extrair(mod, FST, HEADER, BIN, TEMP)).toBe(true);
        expect(runSpecStreamed).not.toHaveBeenCalled();
        expect(msgs()).toEqual(['terminal.wave.headerFallback']);
    });

    it('sem o kill direcionado tambem vai pela conversao', async () => {
        api.onExecSpecStream = vi.fn();
        delete api.killCurrentSpecProcess;
        conversao();
        const mod = await novoModulo();
        expect(await chamar.extrair(mod, FST, HEADER, BIN, TEMP)).toBe(true);
        expect(api.onExecSpecStream).not.toHaveBeenCalled();
    });

    it.each([
        ['fst2vcd que falha (entrada que nao e FST)', { code: 1 }, false],
        ['saida que nao aparece', { conteudo: null }, false],
        ['saida vazia', { conteudo: '' }, false],
        ['processo sem codigo de saida, com o arquivo la', { code: null }, true],
    ])('%s', async (_nome, opcoes, esperado) => {
        conversao(opcoes);
        const mod = await novoModulo();
        expect(await chamar.extrair(mod, FST, HEADER, BIN, TEMP)).toBe(esperado);
    });

    it('stat que falha depois de o arquivo existir deixa passar', async () => {
        conversao();
        api.getFileStats.mockRejectedValueOnce(new Error('EBUSY'));
        const mod = await novoModulo();
        expect(await chamar.extrair(mod, FST, HEADER, BIN, TEMP)).toBe(true);
    });

    it('stat vazio conta como falha', async () => {
        conversao();
        api.getFileStats.mockResolvedValueOnce(null);
        const mod = await novoModulo();
        expect(await chamar.extrair(mod, FST, HEADER, BIN, TEMP)).toBe(false);
    });
});
