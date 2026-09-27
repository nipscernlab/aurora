// @vitest-environment happy-dom
//
// A ultima etapa do botao Wave e da onda do PRISM: abrir o visualizador.
//
// Entra pelo CompilationModule, como o compilationWaveFlow, para que o mesmo
// arquivo prove o comportamento antes e depois de esta parte sair do
// compilation_module.js. O que fica travado:
//
//   - GTKWave: o comando que vai ao main e a falha que sobe como erro;
//   - Surfer: aba ou janela conforme as preferencias, o que cada um recebe, e
//     a queda para a janela e dela para o GTKWave, para o botao nunca ficar
//     sem visualizador;
//   - o "salvar" de dentro da aba, que registra o estado no WaveStore;
//   - a onda do PRISM, com o layout do monitor gravado ao lado do .vcd;
//   - o layout automatico do Surfer (o que entra no buildSurferLayout, o que
//     e gravado, o aviso de tradutor mais novo que o dump);
//   - a decodificacao dos complexos, com o fst2vcd em fluxo.
//
// Os construtores de layout (buildSurferLayout, detectProcessors) tem teste
// proprio e aqui sao falsos: o que interessa e o que o fluxo passa a eles e o
// que faz com a resposta.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// O ouvinte do "salvar" da aba e registrado no import do modulo, entao a ponte
// precisa existir antes dele.
const ponte = vi.hoisted(() => {
    const estado = { aoSalvarEstado: null };
    window.electronAPI = { onSurferTabStateSaved: (cb) => { estado.aoSalvarEstado = cb; } };
    return estado;
});

vi.mock('../../js/compilation/spec_runner.js', () => ({
    runSpec: vi.fn(),
    runSpecStreamed: vi.fn(),
    setAuditHook: vi.fn(),
    setTerminalHook: vi.fn(),
    resolveSpec: vi.fn(),
}));
vi.mock('../../js/tabs/tab_manager.js', () => ({
    TabManager: { saveAllFiles: vi.fn(async () => {}), tabs: new Map(), openSurferWave: vi.fn() },
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
vi.mock('../../js/wave/surfer_layout_writer.js', async (original) => ({
    ...(await original()),
    buildSurferLayout: vi.fn(),
}));
vi.mock('../../js/wave/gtkw_proc_writer.js', async (original) => ({
    ...(await original()),
    detectProcessors: vi.fn(() => []),
    resolveScopeModules: vi.fn(() => new Map()),
}));

import { runSpecStreamed } from '../../js/compilation/spec_runner.js';
import { TabManager } from '../../js/tabs/tab_manager.js';
import { WaveStore } from '../../js/wave/wave_state_store.js';
import { buildSurferLayout } from '../../js/wave/surfer_layout_writer.js';
import { detectProcessors, resolveScopeModules } from '../../js/wave/gtkw_proc_writer.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';
import { abrirAbaDoSurfer } from '../../js/compilation/abrir_onda.js';
import { mapeamentoDosComplexos } from '../../js/compilation/layout_do_surfer.js';

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';
const TB = PROJ + '/Simulation/filtro_tb.v';
const TOP = 'filtro_tb';
const FST = PROJ + '/filtro_tb.fst';
const HEADER = PROJ + '/filtro_tb.header.vcd';
const FST2VCD = COMP + '/Packages/gtkwave-nipscern/fst2vcd.exe';
const COMP2GTKW = COMP + '/bin/comp2gtkw.exe';
const TOOLS = {
    gtkwaveBin: COMP + '/Packages/gtkwave-nipscern/gtkwave.exe',
    surferBin: COMP + '/Packages/surfer/surfer-aurora.exe',
    tempBaseDir: TEMP,
};

// O cabecalho de um dump com um sinal comum e um complexo de 4 bits.
const CABECALHO = '$timescale 1ns $end\n'
    + `$scope module ${TOP} $end\n`
    + '$var wire 1 ! clk $end\n'
    + '$var wire 4 " comp_me3_z $end\n'
    + '$upscope $end\n$enddefinitions $end\n';

/** FNV-1a do caminho do projeto, o prefixo dos mapeamentos do Surfer. */
function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0');
}
const NS = fnv(PROJ);

function makeTerminal() {
    const calls = [];
    return { calls, appendToTerminal: (term, msg, level) => calls.push({ term, msg, level }) };
}

let api;
function makeFakeApi() {
    const arquivos = new Map();
    const norm = (p) => String(p).replace(/\\/g, '/');
    const a = {
        _arquivos: arquivos,
        _escrever(p, conteudo, mtime = 1_000_000) { arquivos.set(norm(p), { conteudo, mtime }); },
        joinPath: vi.fn(async (...partes) => {
            if (!partes.every((p) => typeof p === 'string')) throw new TypeError('join-path');
            return partes.join('/').replace(/\/+/g, '/');
        }),
        fileExists: vi.fn(async (p) => arquivos.has(norm(p))),
        readFile: vi.fn(async (p) => {
            const x = arquivos.get(norm(p));
            if (!x) throw new Error('ENOENT ' + p);
            return x.conteudo;
        }),
        writeFile: vi.fn(async (p, c) => { a._escrever(p, c); return { success: true }; }),
        getFileStats: vi.fn(async (p) => {
            const x = arquivos.get(norm(p));
            if (!x) throw new Error('ENOENT ' + p);
            return { mtime: x.mtime, size: String(x.conteudo).length };
        }),
        getComponentsPath: vi.fn(async () => COMP),
        launchGtkwaveOnly: vi.fn(async () => ({ success: true, gtkwavePid: 11 })),
        launchSurfer: vi.fn(async () => ({ success: true, surferPid: 12 })),
        surferTabAvailable: vi.fn(async () => true),
        surferTabServe: vi.fn(async () => ({ success: true, pageUrl: 'http://127.0.0.1:9/' })),
        writeSurferMappings: vi.fn(async () => ({ failed: [] })),
        decodeComplex: vi.fn(async ({ values }) => ({ success: true, decoded: values.map((v) => `z${v}`) })),
        killCurrentSpecProcess: vi.fn(),
        _ouvintes: [],
        onExecSpecStream: vi.fn((cb) => {
            a._ouvintes.push(cb);
            return () => { a._ouvintes = a._ouvintes.filter((o) => o !== cb); };
        }),
        _emitir(payload) { for (const o of [...a._ouvintes]) o(payload); },
    };
    return a;
}

async function novoModulo(config = { testbenchFile: TB }) {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    mod.projectConfig = config;
    return mod;
}

const msgs = () => terminal.calls.map((c) => c.msg);
const ultima = () => terminal.calls.at(-1);

beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
    localStorage.clear();
    WaveStore.get.mockResolvedValue(null);
    WaveStore.update.mockResolvedValue(undefined);
    buildSurferLayout.mockReturnValue({ content: 'ESTADO', processorCount: 0, mappings: [] });
    detectProcessors.mockReturnValue([]);
    resolveScopeModules.mockReturnValue(new Map());
});

afterEach(() => {
    delete window._latestCompilationModule;
    vi.clearAllMocks();
});

describe('_waveLaunchGtkwave', () => {
    it('manda o binario, o dump e o layout ao main, e avisa que abriu', async () => {
        const mod = await novoModulo();
        await mod._waveLaunchGtkwave(FST, TEMP + '/filtro_tb.gtkw', TOOLS);

        const [pedido] = api.launchGtkwaveOnly.mock.calls[0];
        expect(pedido.gtkwaveBin).toBe(TOOLS.gtkwaveBin);
        expect(pedido.workingDir).toBe(TEMP);
        expect(pedido.args).toContain(FST);
        expect(pedido.args).toContain(TEMP + '/filtro_tb.gtkw');
        expect(msgs()).toEqual(['terminal.wave.launching', 'terminal.wave.launched']);
    });

    it('falha do main sobe como erro, com a mensagem dele', async () => {
        window.t = (k, p) => (p ? `${k}: ${p.message}` : k);
        try {
            api.launchGtkwaveOnly.mockResolvedValueOnce({ success: false, message: 'sem binario' });
            const mod = await novoModulo();
            await expect(mod._waveLaunchGtkwave(FST, null, TOOLS))
                .rejects.toThrow('error.compilation.gtkwaveFailed: sem binario');
        } finally {
            delete window.t;
        }
    });
});

describe('_waveLaunchSurfer', () => {
    it('com a aba ligada (o padrao), abre na aba e nao sobe a janela', async () => {
        const mod = await novoModulo();
        await mod._waveLaunchSurfer(FST, null, TOOLS);

        expect(api.surferTabServe).toHaveBeenCalledTimes(1);
        expect(api.launchSurfer).not.toHaveBeenCalled();
        expect(msgs()).toEqual(['terminal.wave.surferLaunching', 'terminal.wave.surferTabOpened']);
    });

    it.each([
        ['estado salvo vai por -s', TEMP + '/x.surf.ron', [FST, '-s', TEMP + '/x.surf.ron']],
        ['arquivo de comandos vai por -c', TEMP + '/x.SUCL', [FST, '-c', TEMP + '/x.SUCL']],
        ['sem layout, so o dump', null, [FST]],
    ])('na janela: %s', async (_nome, layout, args) => {
        localStorage.setItem('aurora.surferInTab', 'false');
        const mod = await novoModulo();
        await mod._waveLaunchSurfer(FST, layout, TOOLS);

        expect(api.surferTabServe).not.toHaveBeenCalled();
        expect(api.launchSurfer).toHaveBeenCalledWith({
            surferBin: TOOLS.surferBin, args, workingDir: TEMP, multiWindow: false,
        });
        expect(ultima()).toEqual({ term: 'twave', msg: 'terminal.wave.surferLaunched', level: 'success' });
    });

    it('a preferencia de varias janelas chega ao main', async () => {
        localStorage.setItem('aurora.surferInTab', 'false');
        localStorage.setItem('aurora.surferMultiWindow', 'true');
        const mod = await novoModulo();
        await mod._waveLaunchSurfer(FST, null, TOOLS);
        expect(api.launchSurfer.mock.calls[0][0].multiWindow).toBe(true);
    });

    it('aba que nao abre cai para a janela', async () => {
        localStorage.setItem('aurora.surferMode', 'window');
        const mod = await novoModulo();
        await mod._waveLaunchSurfer(FST, null, TOOLS);

        expect(api.surferTabServe).not.toHaveBeenCalled();
        expect(api.launchSurfer).toHaveBeenCalledTimes(1);
        expect(msgs()).toContain('terminal.wave.surferWindowByChoice');
    });

    it('sem o Surfer, abre o GTKWave sem layout e diz o que faltou', async () => {
        localStorage.setItem('aurora.surferInTab', 'false');
        api.launchSurfer.mockResolvedValueOnce({ success: false, message: 'ENOENT' });
        const mod = await novoModulo();
        await mod._waveLaunchSurfer(FST, TEMP + '/x.surf.ron', TOOLS);

        const aviso = terminal.calls.find((c) => c.level === 'tips');
        expect(aviso.msg).toMatch(/^Surfer unavailable \(ENOENT\) — opening GTKWave instead\./);
        expect(api.launchGtkwaveOnly).toHaveBeenCalledTimes(1);
        expect(api.launchGtkwaveOnly.mock.calls[0][0].args).not.toContain(TEMP + '/x.surf.ron');
        expect(ultima().msg).toBe('terminal.wave.launched');
    });
});

describe('abrirAbaDoSurfer', () => {
    it('serve a onda com o estado a salvar por testbench e abre a aba', async () => {
        const mod = await novoModulo();
        mod._surferTabMappings = [{ name: 'm', content: 'c' }];

        expect(await abrirAbaDoSurfer(mod, FST, TEMP + '/x.surf.ron', TOOLS)).toBe(true);

        expect(api.surferTabServe).toHaveBeenCalledWith({
            surferBin: TOOLS.surferBin,
            waveFile: FST,
            tabId: 'wave:' + FST,
            suclFile: null,
            stateFile: TEMP + '/x.surf.ron',
            mappings: [{ name: 'm', content: 'c' }],
            stateSavePath: PROJ + '/.aurora/testbench/filtro_tb.tab.surf.ron',
        });
        expect(TabManager.openSurferWave).toHaveBeenCalledWith(FST, 'http://127.0.0.1:9/', 'wave:' + FST);
    });

    it('arquivo de comandos vai como sucl, e sem mapeamentos vai lista vazia', async () => {
        const mod = await novoModulo();
        await abrirAbaDoSurfer(mod, FST, TEMP + '/x.sucl', TOOLS);
        expect(api.surferTabServe.mock.calls[0][0]).toMatchObject({
            suclFile: TEMP + '/x.sucl', stateFile: null, mappings: [],
        });
    });

    it.each([
        ['semEstado (a onda do PRISM)', { testbenchFile: TB }, { semEstado: true }],
        ['sem testbench no .spf', {}, {}],
        ['sem configuracao carregada', null, {}],
    ])('%s: nao ha onde salvar o estado', async (_nome, config, opts) => {
        const mod = await novoModulo(config);
        await abrirAbaDoSurfer(mod, FST, null, TOOLS, opts);
        expect(api.surferTabServe.mock.calls[0][0].stateSavePath).toBeNull();
    });

    it('sem o pacote web, avisa e devolve false', async () => {
        api.surferTabAvailable.mockResolvedValueOnce(false);
        const mod = await novoModulo();
        expect(await abrirAbaDoSurfer(mod, FST, null, TOOLS)).toBe(false);
        expect(msgs()).toEqual(['terminal.wave.surferTabNoBundle']);
        expect(api.surferTabServe).not.toHaveBeenCalled();
    });

    it('servidor que nao sobe: avisa com o motivo e devolve false', async () => {
        api.surferTabServe.mockResolvedValueOnce({ success: false, message: 'porta' });
        const mod = await novoModulo();
        expect(await abrirAbaDoSurfer(mod, FST, null, TOOLS)).toBe(false);
        expect(ultima().msg).toBe('Surfer tab unavailable (porta) — opening the window instead.');
        expect(TabManager.openSurferWave).not.toHaveBeenCalled();
    });

    it('resposta vazia do servidor conta como falha sem motivo', async () => {
        api.surferTabServe.mockResolvedValueOnce(undefined);
        const mod = await novoModulo();
        expect(await abrirAbaDoSurfer(mod, FST, null, TOOLS)).toBe(false);
        expect(ultima().msg).toBe('Surfer tab unavailable (unknown) — opening the window instead.');
    });
});

describe('o "salvar" de dentro da aba do Surfer', () => {
    async function abrirAba() {
        const mod = await novoModulo();
        await abrirAbaDoSurfer(mod, FST, null, TOOLS);
        return mod;
    }
    const SALVO = PROJ + '/.aurora/testbench/filtro_tb.tab.surf.ron';

    it('registra o arquivo salvo como o layout ativo do testbench', async () => {
        await abrirAba();
        await ponte.aoSalvarEstado({ tabId: 'wave:' + FST, path: SALVO });

        expect(WaveStore.update).toHaveBeenCalledWith(PROJ, 'filtro_tb', expect.any(Function));
        const mutar = WaveStore.update.mock.calls[0][2];
        const cfg = { surferFiles: [{ name: 'antigo', path: 'a.surf.ron', isActive: true }] };
        mutar(cfg);
        expect(cfg.surferFiles).toEqual([
            { name: 'antigo', path: 'a.surf.ron', isActive: false },
            { name: 'filtro_tb.tab.surf.ron', path: SALVO, isActive: true },
        ]);
        // Salvar de novo o mesmo arquivo nao duplica a entrada.
        mutar(cfg);
        expect(cfg.surferFiles).toHaveLength(2);
        // Sem lista ainda, ela nasce com a entrada.
        const vazio = {};
        mutar(vazio);
        expect(vazio.surferFiles).toEqual([{ name: 'filtro_tb.tab.surf.ron', path: SALVO, isActive: true }]);
        expect(ultima()).toEqual({ term: 'twave', msg: 'terminal.wave.surferTabStateSaved', level: 'success' });
    });

    it('falha ao registrar diz que o arquivo esta salvo', async () => {
        await abrirAba();
        WaveStore.update.mockRejectedValueOnce(new Error('disco'));
        await ponte.aoSalvarEstado({ tabId: 'wave:' + FST, path: SALVO });
        expect(ultima()).toEqual({
            term: 'twave',
            msg: `Estado salvo em ${SALVO}, mas o registro no projeto falhou: disco`,
            level: 'error',
        });
    });

    it('aba que ninguem abriu e ignorada', async () => {
        await novoModulo();
        await ponte.aoSalvarEstado({ tabId: 'wave:outra', path: SALVO });
        expect(WaveStore.update).not.toHaveBeenCalled();
    });
});

describe('abrirOndaExterna (a onda do PRISM)', () => {
    const VCD = PROJ + '/.aurora/prism/soma.vcd';
    const SINAIS = [
        { nome: 'clk', papel: 'clock' },
        { nome: 'a', bits: 8, base: 'dec', papel: 'input' },
    ];

    it('grava o layout do monitor ao lado do .vcd e abre no GTKWave', async () => {
        const mod = await novoModulo();
        await mod.abrirOndaExterna(VCD, 'soma', SINAIS);

        expect(api._arquivos.has(PROJ + '/.aurora/prism/soma.surf.ron')).toBe(true);
        expect(api._arquivos.has(PROJ + '/.aurora/prism/soma.gtkw')).toBe(true);
        const [pedido] = api.launchGtkwaveOnly.mock.calls[0];
        expect(pedido.args).toContain(VCD);
        expect(pedido.args.join(' ')).toContain(PROJ + '/.aurora/prism/soma.gtkw');
        expect(msgs()[0]).toBe('terminal.wave.prismWave');
    });

    it('com o Surfer escolhido, abre a aba sem estado de testbench', async () => {
        localStorage.setItem('aurora.waveViewer', 'surfer');
        const mod = await novoModulo();
        await mod.abrirOndaExterna(VCD, 'soma', SINAIS);

        expect(api.surferTabServe.mock.calls[0][0]).toMatchObject({
            stateFile: PROJ + '/.aurora/prism/soma.surf.ron',
            stateSavePath: null,
        });
    });

    it('sem sinais, abre a onda crua', async () => {
        const mod = await novoModulo();
        await mod.abrirOndaExterna(VCD, 'soma');
        expect(api.writeFile).not.toHaveBeenCalled();
        expect(api.launchGtkwaveOnly.mock.calls[0][0].args.join(' ')).not.toContain('.gtkw');
    });

    it('layout que nao grava: avisa e abre cru', async () => {
        api.writeFile.mockRejectedValue(new Error('EPERM'));
        const mod = await novoModulo();
        await mod.abrirOndaExterna(VCD, 'soma', SINAIS);

        expect(msgs()).toContain('PRISM: could not write soma.surf.ron (EPERM); opening the raw wave.');
        expect(msgs()).toContain('PRISM: could not write soma.gtkw (EPERM); opening the raw wave.');
        expect(api.launchGtkwaveOnly).toHaveBeenCalledTimes(1);
    });

    it('layout que nao monta: avisa e abre cru', async () => {
        const mod = await novoModulo();
        const quebrado = { get nome() { throw new Error('sinal ruim'); } };
        await mod.abrirOndaExterna(VCD, 'soma', [quebrado]);

        expect(msgs()).toContain('PRISM: could not build the wave layout (sinal ruim); opening the raw wave.');
        expect(api.launchGtkwaveOnly).toHaveBeenCalledTimes(1);
    });

    it('sem rotulo, o terminal usa o nome do arquivo; erro vai ao terminal e nao sobe', async () => {
        window.t = (k, p) => (p ? `${k} ${p.module ?? p.message}` : k);
        try {
            api.launchGtkwaveOnly.mockResolvedValueOnce({ success: false, message: 'x' });
            const mod = await novoModulo();
            await expect(mod.abrirOndaExterna(VCD, '')).resolves.toBeUndefined();
            expect(msgs()[0]).toBe('terminal.wave.prismWave soma.vcd');
            expect(ultima().level).toBe('error');
            expect(ultima().msg).toMatch(/^terminal\.common\.error /);
        } finally {
            delete window.t;
        }
    });
});

describe('_waveResolveSurferSaveFile', () => {
    beforeEach(() => {
        api._escrever(FST, 'FST', 5_000_000);
        api._escrever(HEADER, CABECALHO);
    });

    it('layout ativo do usuario ganha, e zera os mapeamentos da corrida anterior', async () => {
        WaveStore.get.mockResolvedValue({
            surferFiles: [{ path: 'C:/l/velho.sucl' }, { path: 'C:/l/meu.surf.ron', isActive: true }],
        });
        const mod = await novoModulo();
        mod._surferTabMappings = [{ name: 'velho' }];

        expect(await mod._waveResolveSurferSaveFile(TOP, FST, TEMP)).toBe('C:/l/meu.surf.ron');
        expect(mod._surferTabMappings).toEqual([]);
        expect(msgs()).toEqual(['Surfer layout: meu.surf.ron']);
        expect(buildSurferLayout).not.toHaveBeenCalled();
    });

    it('gera o layout do cabecalho, com a selecao do picker e os tradutores', async () => {
        detectProcessors.mockReturnValue([
            { procType: 'proc_fir' }, { procType: 'proc_fir' }, { procType: 'proc_iir' }, null, {},
        ]);
        // proc_fir tem os dois tradutores, mais novos que o dump; proc_iir nenhum.
        api._escrever(TEMP + '/proc_fir/trad_opcode.txt', 'OP', 9_000_000);
        api._escrever(TEMP + '/proc_fir/trad_cmm.txt', 'CMM', 8_000_000);
        const MAPAS = [{ name: 'a', content: '1' }, { name: 'b', content: '2' }];
        buildSurferLayout.mockReturnValue({ content: 'ESTADO', processorCount: 2, mappings: MAPAS });
        const mod = await novoModulo();
        const modulos = new Map([['filtro', {}]]);
        mod._parseProjectSources = vi.fn(async () => modulos);
        mod._validatedWaveSelection = ['filtro_tb.clk', 'filtro_tb.a', 'filtro_tb.b'];

        expect(await mod._waveResolveSurferSaveFile(TOP, FST, TEMP)).toBe(TEMP + '/filtro_tb.surf.ron');

        expect(resolveScopeModules).toHaveBeenCalledWith(expect.any(Array), modulos);
        const [entrada] = buildSurferLayout.mock.calls[0];
        expect(entrada).toMatchObject({
            vcdPath: FST,
            tbModule: TOP,
            selectedSignals: ['filtro_tb.clk', 'filtro_tb.a', 'filtro_tb.b'],
            modules: modulos,
            tradByProcType: {
                proc_fir: { opcode: 'OP', cmm: 'CMM' },
                proc_iir: { opcode: null, cmm: null },
            },
            mappingNamespace: `${NS}_${TOP}`,
        });
        expect(entrada.scopes[0].signals.map((s) => s.name)).toEqual(['clk', 'comp_me3_z']);
        expect(api._arquivos.get(TEMP + '/filtro_tb.surf.ron').conteudo).toBe('ESTADO');
        expect(api.writeSurferMappings).toHaveBeenCalledWith(MAPAS);
        expect(mod._surferTabMappings).toBe(MAPAS);
        expect(msgs()).toContain(
            'Surfer: os tradutores Assembly/C+- sao mais novos que o dump — recompilou sem re-simular? O decode pode estar desatualizado; re-simule para alinhar.');
        expect(msgs().at(-1)).toBe('Surfer layout auto-generated (2 processors, 3 signals from picker, 2 decode maps).');
    });

    it('sem selecao validada, usa os sinais salvos do testbench', async () => {
        WaveStore.get.mockResolvedValue({ waveSignals: ['filtro_tb.clk'] });
        buildSurferLayout.mockReturnValue({ content: 'E', processorCount: 1, mappings: [] });
        const mod = await novoModulo();
        mod._parseProjectSources = vi.fn(async () => null);

        await mod._waveResolveSurferSaveFile(TOP, FST, TEMP);

        expect(buildSurferLayout.mock.calls[0][0].selectedSignals).toEqual(['filtro_tb.clk']);
        // Sem modulos do projeto nao ha como resolver o modulo de cada escopo.
        expect(resolveScopeModules).not.toHaveBeenCalled();
        expect(msgs().at(-1)).toBe('Surfer layout auto-generated (1 processor, 1 signal from picker).');
    });

    it('sem testbench, sem selecao: layout plano e sem aviso de tradutor', async () => {
        api._escrever(HEADER, CABECALHO.replace('comp_me3_z', 'z'));
        const mod = await novoModulo({});
        mod._parseProjectSources = vi.fn(async () => null);

        await mod._waveResolveSurferSaveFile(TOP, FST, TEMP);

        expect(WaveStore.get).not.toHaveBeenCalled();
        expect(buildSurferLayout.mock.calls[0][0].selectedSignals).toBeNull();
        expect(msgs()).toEqual(['Surfer layout auto-generated (flat layout).']);
    });

    it('mapeamento que nao grava vira aviso, e o layout segue', async () => {
        api.writeSurferMappings.mockResolvedValueOnce({ failed: [{ name: 'a' }] });
        buildSurferLayout.mockReturnValue({ content: 'E', processorCount: 0, mappings: [{ name: 'a' }] });
        const mod = await novoModulo();
        mod._parseProjectSources = vi.fn(async () => null);

        expect(await mod._waveResolveSurferSaveFile(TOP, FST, TEMP)).toBe(TEMP + '/filtro_tb.surf.ron');
        expect(msgs()).toContain('Surfer: 1 mapping translator(s) nao escritos — esses tracks abrem em decimal cru.');
        expect(msgs().at(-1)).toBe('Surfer layout auto-generated (flat layout, 1 decode map).');
    });

    it('.vcd sem cabecalho separado e lido direto', async () => {
        const VCD = PROJ + '/filtro_tb.vcd';
        api._arquivos.delete(HEADER);
        api._escrever(VCD, CABECALHO);
        const mod = await novoModulo();
        mod._parseProjectSources = vi.fn(async () => null);

        await mod._waveResolveSurferSaveFile(TOP, VCD, TEMP);
        expect(api.readFile).toHaveBeenCalledWith(VCD, { encoding: 'utf8' });
    });

    it('.fst sem cabecalho de texto: nao ha o que ler, Surfer abre cru', async () => {
        api._arquivos.delete(HEADER);
        const mod = await novoModulo();
        expect(await mod._waveResolveSurferSaveFile(TOP, FST, TEMP)).toBeNull();
        expect(buildSurferLayout).not.toHaveBeenCalled();
    });

    it('construtor sem conteudo: sem layout e sem gravar', async () => {
        buildSurferLayout.mockReturnValue({ content: null, processorCount: 0, mappings: [] });
        const mod = await novoModulo();
        mod._parseProjectSources = vi.fn(async () => null);
        expect(await mod._waveResolveSurferSaveFile(TOP, FST, TEMP)).toBeNull();
        expect(api._arquivos.has(TEMP + '/filtro_tb.surf.ron')).toBe(false);
    });

    it('falha no meio vira aviso e null', async () => {
        const mod = await novoModulo();
        mod._parseProjectSources = vi.fn(async () => { throw new Error('parser'); });
        expect(await mod._waveResolveSurferSaveFile(TOP, FST, TEMP)).toBeNull();
        expect(ultima()).toEqual({ term: 'twave', msg: 'Surfer auto-layout failed (parser) — opening raw VCD.', level: 'tips' });
    });

    it('tradutor sem stat e dump sem stat nao param o layout', async () => {
        detectProcessors.mockReturnValue([{ procType: 'proc_fir' }]);
        api._escrever(TEMP + '/proc_fir/trad_opcode.txt', 'OP', 9_000_000);
        const stats = api.getFileStats.getMockImplementation();
        api.getFileStats.mockImplementation(async (p) => {
            if (String(p).endsWith('trad_opcode.txt')) throw new Error('stat');
            return stats(p);
        });
        const mod = await novoModulo();
        mod._parseProjectSources = vi.fn(async () => null);
        expect(await mod._waveResolveSurferSaveFile(TOP, FST, TEMP)).toBe(TEMP + '/filtro_tb.surf.ron');

        // Agora o tradutor tem stat, mas o dump nao.
        api.getFileStats.mockImplementation(async (p) => {
            if (p === FST) throw new Error('stat');
            return stats(p);
        });
        terminal.calls.length = 0;
        expect(await mod._waveResolveSurferSaveFile(TOP, FST, TEMP)).toBe(TEMP + '/filtro_tb.surf.ron');
        expect(msgs().some((m) => m.includes('mais novos que o dump'))).toBe(false);
    });

    it('com sinal complexo no cabecalho, decodifica e passa o mapeamento', async () => {
        api._escrever(COMP2GTKW, 'MZ');
        api._escrever(FST2VCD, 'MZ');
        runSpecStreamed.mockImplementation(async () => {
            api._emitir({ type: 'stdout', data: CABECALHO + '#0\nb0001 "\n#5\nb10 "\n' });
            return { code: 0 };
        });
        const mod = await novoModulo();
        mod._parseProjectSources = vi.fn(async () => null);

        await mod._waveResolveSurferSaveFile(TOP, FST, TEMP);

        expect(buildSurferLayout.mock.calls[0][0].complexMapping).toEqual({
            name: `aurora_cpx_${NS}_${TOP}`,
            content: `Name = aurora_cpx_${NS}_${TOP}\n0b0001 z0001\n0b0010 z0010\n`,
        });
    });
});

describe('mapeamentoDosComplexos', () => {
    beforeEach(() => {
        api._escrever(COMP2GTKW, 'MZ');
        api._escrever(FST2VCD, 'MZ');
    });

    function fluxo(corpo, cabecalho = CABECALHO) {
        runSpecStreamed.mockImplementation(async (spec, opts) => {
            expect(spec).toMatchObject({ step: 'fst2vcd', binary: FST2VCD, args: ['-f', FST], cwd: TEMP });
            expect(opts).toEqual({ consumeEphemeral: true });
            api._emitir({ type: 'stderr', data: 'ruido' });
            api._emitir({ type: 'stdout', data: '' });
            api._emitir(null);
            api._emitir({ type: 'stdout', data: cabecalho + corpo });
            return { code: 0 };
        });
    }

    it('coleta os valores distintos, decodifica e monta o mapeamento', async () => {
        fluxo('#0\nb1 "\n#1\nb0001 "\nb1111 "\n');
        const mod = await novoModulo();

        const mapa = await mapeamentoDosComplexos(mod, FST, TOP, TEMP, 'ns');

        expect(api.decodeComplex).toHaveBeenCalledWith({ exePath: COMP2GTKW, values: ['0001', '1111'] });
        expect(mapa).toEqual({ name: `aurora_cpx_ns_${TOP}`, content: `Name = aurora_cpx_ns_${TOP}\n0b0001 z0001\n0b1111 z1111\n` });
        expect(ultima()).toEqual({ term: 'twave', msg: 'Surfer complex decode: 2 valores.', level: 'info' });
        // O ouvinte do fluxo sai quando o fst2vcd termina.
        expect(api._ouvintes).toHaveLength(0);
    });

    it('um valor so, no singular; nome sem namespace e limpo de caracteres', async () => {
        fluxo('#0\nb0001 "\n');
        const mod = await novoModulo();
        const mapa = await mapeamentoDosComplexos(mod, FST, 'tb-x', TEMP);
        expect(mapa.name).toBe('aurora_cpx__tb_x');
        expect(ultima().msg).toBe('Surfer complex decode: 1 valor.');
    });

    it('no limite de valores, mata o fst2vcd uma vez e avisa que limitou', async () => {
        const muitos = Array.from({ length: 16400 }, (_, i) => `b${i.toString(2)} "`).join('\n');
        // Um complexo de 32 bits, para caberem mais valores distintos que o limite.
        fluxo(`#0\n${muitos}\n`, CABECALHO.replace('wire 4', 'wire 32'));
        api.decodeComplex.mockImplementation(async ({ values }) => ({ success: true, decoded: values.map(() => 'v') }));
        const mod = await novoModulo();

        await mapeamentoDosComplexos(mod, FST, TOP, TEMP, 'ns');

        expect(api.killCurrentSpecProcess).toHaveBeenCalledTimes(1);
        expect(ultima().msg).toMatch(/ valores \(limitado\)\.$/);
    });

    it('fst2vcd que lanca no meio ainda aproveita o que coletou', async () => {
        runSpecStreamed.mockImplementation(async () => {
            api._emitir({ type: 'stdout', data: CABECALHO + '#0\nb0011 "' });
            throw new Error('morto');
        });
        const mod = await novoModulo();
        const mapa = await mapeamentoDosComplexos(mod, FST, TOP, TEMP, 'ns');
        expect(mapa.content).toContain('0b0011 z0011');
    });

    it.each([
        ['sem fluxo ao vivo na ponte', () => { delete api.onExecSpecStream; }, null],
        ['sem comp2gtkw', () => { api._arquivos.delete(COMP2GTKW); },
            'Surfer: comp2gtkw.exe nao encontrado em components/bin/ — numeros complexos abrem em Binary cru.'],
        ['sem fst2vcd', () => { api._arquivos.delete(FST2VCD); },
            'Surfer: fst2vcd.exe nao encontrado — decode de complexos pulado (Binary cru).'],
    ])('%s: null', async (_nome, preparar, aviso) => {
        preparar();
        const mod = await novoModulo();
        expect(await mapeamentoDosComplexos(mod, FST, TOP, TEMP, 'ns')).toBeNull();
        expect(runSpecStreamed).not.toHaveBeenCalled();
        expect(msgs()).toEqual(aviso ? [aviso] : []);
    });

    it.each([
        ['nenhum valor binario no dump', '#0\nbxx "\n', undefined],
        ['decodificador que falha', '#0\nb1 "\n', { success: false }],
        ['decodificador sem lista', '#0\nb1 "\n', { success: true, decoded: 'x' }],
        ['decodificador sem resposta', '#0\nb1 "\n', null],
        ['nada decodificado', '#0\nb1 "\n', { success: true, decoded: [''] }],
    ])('%s: null e sem mensagem', async (_nome, corpo, resposta) => {
        fluxo(corpo);
        if (resposta !== undefined) api.decodeComplex.mockResolvedValueOnce(resposta);
        const mod = await novoModulo();
        expect(await mapeamentoDosComplexos(mod, FST, TOP, TEMP, 'ns')).toBeNull();
        expect(msgs()).toEqual([]);
    });

    it('erro inesperado vira aviso e null', async () => {
        fluxo('#0\nb1 "\n');
        api.decodeComplex.mockRejectedValueOnce(new Error('pipe'));
        const mod = await novoModulo();
        expect(await mapeamentoDosComplexos(mod, FST, TOP, TEMP, 'ns')).toBeNull();
        expect(ultima()).toEqual({ term: 'twave', msg: 'Surfer complex decode skipped (pipe) — complexos em Binary.', level: 'tips' });
    });
});
