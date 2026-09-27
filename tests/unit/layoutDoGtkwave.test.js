// @vitest-environment happy-dom
//
// Qual `.gtkw` o GTKWave abre depois do passo Wave: o que o usuario marcou
// como ativo (conferido contra o dump, para avisar de sinal que sumiu), ou um
// gerado a partir do cabecalho do dump e da selecao do picker. Os avisos de
// sinal selecionado que nao chegou ao dump separam o esperado (os monitores do
// processador sob Verilator) do que e erro.
//
// O construtor do `.gtkw` e a deteccao de processadores tem teste proprio e
// aqui sao falsos. `chamar` e o unico ponto que sabe onde cada peca mora.

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
vi.mock('../../js/wave/wave_state_store.js', () => ({
    WaveStore: { STATE_DIRNAME: '.aurora/testbench', get: vi.fn(), update: vi.fn() },
}));
vi.mock('../../js/wave/gtkw_proc_writer.js', async (original) => ({
    ...(await original()),
    buildAuroraGtkw: vi.fn(),
    detectProcessors: vi.fn(() => []),
}));
vi.mock('../../js/compilation/wave_signal_validator.js', async (original) => ({
    ...(await original()),
    parseProjectSources: vi.fn(async () => null),
}));

import { WaveStore } from '../../js/wave/wave_state_store.js';
import { buildAuroraGtkw, detectProcessors } from '../../js/wave/gtkw_proc_writer.js';
import { parseProjectSources } from '../../js/compilation/wave_signal_validator.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';

const chamar = {
    resolver: (mod, ...a) => mod._waveResolveGtkwSaveFile(...a),
    conferir: (mod, ...a) => mod._waveValidateUserGtkwAgainstVcd(...a),
};

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';
const TB = PROJ + '/Simulation/filtro_tb.v';
const TOP = 'filtro_tb';
const FST = PROJ + '/filtro_tb.fst';
const HEADER = PROJ + '/filtro_tb.header.vcd';
const AUTO = `${TEMP}/${TOP}.gtkw`;

const CABECALHO = '$timescale 1ns $end\n'
    + `$scope module ${TOP} $end\n$var wire 1 ! clk $end\n`
    + '$scope module proc $end\n$var wire 8 " saida $end\n$upscope $end\n'
    + '$upscope $end\n$enddefinitions $end\n';

function makeTerminal() {
    const calls = [];
    return { calls, appendToTerminal: (term, msg, level) => calls.push({ term, msg, level }) };
}

let api;
function makeFakeApi() {
    const arquivos = new Map();
    return {
        _arquivos: arquivos,
        joinPath: vi.fn(async (...partes) => partes.join('/').replace(/\/+/g, '/')),
        fileExists: vi.fn(async (p) => arquivos.has(p)),
        readFile: vi.fn(async (p) => {
            if (!arquivos.has(p)) throw new Error('ENOENT ' + p);
            return arquivos.get(p);
        }),
        writeFile: vi.fn(async (p, c) => { arquivos.set(p, c); }),
        getComponentsPath: vi.fn(async () => COMP),
    };
}

async function novoModulo(config = { testbenchFile: TB }) {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    mod.projectConfig = config;
    return mod;
}

const msgs = () => terminal.calls.map((c) => c.msg);
const niveis = () => terminal.calls.map((c) => [c.msg, c.level]);

beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
    window.t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
    localStorage.clear();
    api._arquivos.set(FST, 'FST');
    api._arquivos.set(HEADER, CABECALHO);
    WaveStore.get.mockResolvedValue(null);
    buildAuroraGtkw.mockReturnValue({ content: '[*] gtkw', processorCount: 0 });
    detectProcessors.mockReturnValue([]);
});

afterEach(() => {
    delete window.electronAPI;
    delete window._latestCompilationModule;
    delete window.t;
    vi.clearAllMocks();
});

describe('o .gtkw do usuario', () => {
    const MEU = PROJ + '/layouts/meu.gtkw';

    it('o ativo ganha, e e conferido contra o dump', async () => {
        WaveStore.get.mockResolvedValue({ gtkwFiles: [{ path: 'x.gtkw' }, { path: MEU, isActive: true }] });
        api._arquivos.set(MEU, 'filtro_tb.clk\nfiltro_tb.sumiu\n');
        const mod = await novoModulo();

        expect(await chamar.resolver(mod, TOP, FST, TEMP)).toBe(MEU);

        expect(WaveStore.get).toHaveBeenCalledWith(PROJ, 'filtro_tb');
        expect(niveis()).toEqual([
            ['terminal.wave.usingGtkwFile {"name":"meu.gtkw"}', 'info'],
            ['terminal.wave.gtkwStaleVcdOne {"preview":"\\"filtro_tb.sumiu\\"","file":"meu.gtkw"}', 'warning'],
        ]);
        expect(buildAuroraGtkw).not.toHaveBeenCalled();
    });

    it('lista sem ativo, ou vazia, cai no gerado', async () => {
        const mod = await novoModulo();
        WaveStore.get.mockResolvedValue({ gtkwFiles: [{ path: MEU }] });
        expect(await chamar.resolver(mod, TOP, FST, TEMP)).toBe(AUTO);
        WaveStore.get.mockResolvedValue({ gtkwFiles: [] });
        expect(await chamar.resolver(mod, TOP, FST, TEMP)).toBe(AUTO);
    });
});

describe('a conferencia do .gtkw do usuario', () => {
    const MEU = PROJ + '/meu.gtkw';

    it('muitos sinais que sumiram: um aviso so, com os cinco primeiros', async () => {
        api._arquivos.set(MEU, ['clk', 'a', 'b', 'c', 'd', 'e', 'f'].map((n) => `filtro_tb.${n}`).join('\n'));
        const mod = await novoModulo();
        await chamar.conferir(mod, MEU, FST);
        expect(niveis()).toEqual([[
            'terminal.wave.gtkwStaleVcdMany {"count":6,"file":"meu.gtkw",'
            + '"preview":"\\"filtro_tb.a\\", \\"filtro_tb.b\\", \\"filtro_tb.c\\", \\"filtro_tb.d\\", \\"filtro_tb.e\\"",'
            + '"more":" (+1 more)"}',
            'warning',
        ]]);
    });

    it('tudo presente, ou nenhum sinal citado: silencio', async () => {
        const mod = await novoModulo();
        api._arquivos.set(MEU, 'filtro_tb.clk\nfiltro_tb.proc.saida\n');
        await chamar.conferir(mod, MEU, FST);
        api._arquivos.set(MEU, '[*] vazio\n');
        await chamar.conferir(mod, MEU, FST);
        expect(terminal.calls).toEqual([]);
    });

    it('.vcd sem cabecalho separado e lido direto; .fst sem cabecalho nao da para conferir', async () => {
        const VCD = PROJ + '/filtro_tb.vcd';
        api._arquivos.delete(HEADER);
        api._arquivos.set(VCD, CABECALHO);
        api._arquivos.set(MEU, 'filtro_tb.clk\n');
        const mod = await novoModulo();
        await chamar.conferir(mod, MEU, VCD);
        expect(api.readFile).toHaveBeenCalledWith(VCD, { encoding: 'utf8' });

        api.readFile.mockClear();
        await chamar.conferir(mod, MEU, FST);
        expect(api.readFile).not.toHaveBeenCalled();
    });

    it('.gtkw que nao se le: um aviso, sem parar nada', async () => {
        const mod = await novoModulo();
        await chamar.conferir(mod, PROJ + '/sumiu.gtkw', FST);
        expect(terminal.calls).toHaveLength(1);
        expect(terminal.calls[0].msg).toMatch(/^terminal\.wave\.gtkwPreValidateFailed \{"file":"sumiu\.gtkw","message":"ENOENT/);
    });
});

describe('o .gtkw gerado', () => {
    it('usa a selecao validada, o cabecalho e os modulos do projeto', async () => {
        const modulos = new Map([['filtro', {}]]);
        parseProjectSources.mockResolvedValueOnce(modulos);
        buildAuroraGtkw.mockReturnValue({ content: '[*] gerado', processorCount: 2 });
        const mod = await novoModulo();
        mod._validatedWaveSelection = ['filtro_tb.clk', 'filtro_tb.proc.saida', 'filtro_tb.x'];

        expect(await chamar.resolver(mod, TOP, FST, TEMP)).toBe(AUTO);

        const [entrada] = buildAuroraGtkw.mock.calls[0];
        expect(entrada).toMatchObject({
            vcdPath: FST, gtkwPath: AUTO, tbModule: TOP, tempBaseDir: TEMP, binDir: COMP + '/bin',
            selectedSignals: ['filtro_tb.clk', 'filtro_tb.proc.saida', 'filtro_tb.x'], modules: modulos,
        });
        expect(entrada.scopes.map((s) => s.path)).toEqual(['filtro_tb', 'filtro_tb.proc']);
        expect(api._arquivos.get(AUTO)).toBe('[*] gerado');
        expect(niveis()).toEqual([
            ['terminal.wave.staleVcdSignalOne {"preview":"\\"filtro_tb.x\\""}', 'warning'],
            ['terminal.wave.autoGtkwLayout {"detail":"2 processors, 3 signals from picker"}', 'info'],
        ]);
    });

    it('sem selecao validada, le os sinais salvos; sem nada, layout plano', async () => {
        WaveStore.get.mockResolvedValue({ waveSignals: ['filtro_tb.clk'] });
        buildAuroraGtkw.mockReturnValue({ content: 'g', processorCount: 1 });
        const mod = await novoModulo();
        await chamar.resolver(mod, TOP, FST, TEMP);
        expect(buildAuroraGtkw.mock.calls[0][0].selectedSignals).toEqual(['filtro_tb.clk']);
        expect(msgs().at(-1)).toBe('terminal.wave.autoGtkwLayout {"detail":"1 processor, 1 signal from picker"}');

        WaveStore.get.mockResolvedValue({});
        buildAuroraGtkw.mockReturnValue({ content: 'g', processorCount: 0 });
        await chamar.resolver(mod, TOP, FST, TEMP);
        expect(buildAuroraGtkw.mock.calls[1][0].selectedSignals).toBeNull();
        expect(msgs().at(-1)).toBe('terminal.wave.autoGtkwLayout {"detail":"flat layout"}');
    });

    it('sem testbench no .spf, nem consulta o estado', async () => {
        const mod = await novoModulo({});
        await chamar.resolver(mod, TOP, FST, TEMP);
        expect(WaveStore.get).not.toHaveBeenCalled();
        expect(buildAuroraGtkw.mock.calls[0][0].selectedSignals).toBeNull();
    });

    it('sob o Verilator, sinal de monitor do processador que nao veio vira dica por processador', async () => {
        localStorage.setItem('aurora.waveSimulator', 'verilator');
        detectProcessors.mockReturnValue([
            { instancePath: 'filtro_tb.p0', procType: 'proc_fir', instanceName: 'p0' },
            { instancePath: 'filtro_tb.p1', procType: '', instanceName: 'p1' },
        ]);
        const mod = await novoModulo();
        mod._validatedWaveSelection = [
            'filtro_tb.p0.core.sp', 'filtro_tb.p0.core.ula', 'filtro_tb.p1.core.x',
            'filtro_tb.p2.core.y', 'a', 'b', 'c', 'd', 'e',
        ];

        await chamar.resolver(mod, TOP, FST, TEMP);

        expect(niveis().slice(0, 3)).toEqual([
            ['terminal.wave.verilatorNoProcSignals {"proc":"proc_fir"}', 'tips'],
            ['terminal.wave.verilatorNoProcSignals {"proc":"p1"}', 'tips'],
            ['terminal.wave.staleVcdSignalMany {"count":6,'
                + '"preview":"\\"filtro_tb.p2.core.y\\", \\"a\\", \\"b\\", \\"c\\", \\"d\\"","more":" (+1 more)"}', 'warning'],
        ]);
    });

    it('fora do Verilator, o mesmo sinal de monitor e aviso comum', async () => {
        const mod = await novoModulo();
        mod._validatedWaveSelection = ['filtro_tb.p0.core.sp'];
        await chamar.resolver(mod, TOP, FST, TEMP);
        expect(detectProcessors).not.toHaveBeenCalled();
        expect(terminal.calls[0].msg).toMatch(/^terminal\.wave\.staleVcdSignalOne/);
    });

    it('.vcd sem cabecalho separado e lido direto', async () => {
        const VCD = PROJ + '/filtro_tb.vcd';
        api._arquivos.delete(HEADER);
        api._arquivos.set(VCD, CABECALHO);
        const mod = await novoModulo();
        expect(await chamar.resolver(mod, TOP, VCD, TEMP)).toBe(AUTO);
        expect(buildAuroraGtkw.mock.calls[0][0].scopes).toHaveLength(2);
    });

    it('.fst sem cabecalho: dica e GTKWave sem layout', async () => {
        api._arquivos.delete(HEADER);
        const mod = await novoModulo();
        expect(await chamar.resolver(mod, TOP, FST, TEMP)).toBeNull();
        expect(niveis()).toEqual([[
            'terminal.wave.autoGtkwError {"message":"no parseable header (.header.vcd missing); GTKWave opens .fst without auto-gtkw"}',
            'tips',
        ]]);
    });

    it('construtor sem conteudo: sem layout e sem gravar', async () => {
        buildAuroraGtkw.mockReturnValue({ content: '', processorCount: 0 });
        const mod = await novoModulo();
        expect(await chamar.resolver(mod, TOP, FST, TEMP)).toBeNull();
        expect(api.writeFile).not.toHaveBeenCalled();
    });

    it('falha no meio vira aviso e null', async () => {
        buildAuroraGtkw.mockImplementation(() => { throw new Error('quebrou'); });
        const mod = await novoModulo();
        expect(await chamar.resolver(mod, TOP, FST, TEMP)).toBeNull();
        expect(niveis()).toEqual([['terminal.wave.autoGtkwError {"message":"quebrou"}', 'warning']]);
    });
});
