// @vitest-environment happy-dom
//
// O Icarus no botao Wave, e o preparo que vem antes de qualquer simulador.
//
// Preparo: a selecao de sinais (quem manda no $dumpvars), o testbench
// instrumentado numa copia na Temp (sem reescrever o que nao mudou, para o make
// do Verilator nao recompilar tudo), o aviso de testbench que nunca termina, e
// a conferencia dos $fopen de leitura antes de simular. Icarus: o build do
// .vvp, a simulacao na pasta do projeto com o fluxo filtrado, e cada
// desistencia com a sua mensagem.
//
// A decisao de quem manda no $dumpvars tem teste proprio (wave_signal_validator)
// e aqui e falsa; o instrumentador e o de verdade. `chamar` e o unico ponto que
// sabe onde cada peca mora.

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
vi.mock('../../js/compilation/wave_signal_validator.js', async (original) => ({
    ...(await original()),
    resolveWaveSelection: vi.fn(),
}));

import { runSpec, runSpecStreamed } from '../../js/compilation/spec_runner.js';
import { TabManager } from '../../js/tabs/tab_manager.js';
import { statusUpdater } from '../../js/ui/status_updater.js';
import { resolveWaveSelection } from '../../js/compilation/wave_signal_validator.js';
import { pedirCancelamento, iniciarRodada } from '../../js/compilation/cancelamento.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';
import { prepararWave, instrumentarTestbench } from '../../js/compilation/preparo_da_onda.js';
import { construirNoIcarus, construirEConferirVvp, simularNoIcarus } from '../../js/compilation/icarus_da_onda.js';

const chamar = {
    preparar: (mod, ...a) => prepararWave(mod, ...a),
    instrumentar: (mod, ...a) => instrumentarTestbench(mod, ...a),
    construir: (mod) => construirNoIcarus(mod),
    construirEConferir: (mod, ...a) => construirEConferirVvp(mod, ...a),
    simular: (mod, ...a) => simularNoIcarus(mod, ...a),
};

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';
const MINGW = COMP + '/Packages/msys/mingw64/bin';
const TB = PROJ + '/Simulation/filtro_tb.v';
const DUT = PROJ + '/Hardware/filtro.v';
const TOP = 'filtro_tb';
const INSTR = `${TEMP}/instr_filtro_tb.v`;
const VVP = `${TEMP}/${TOP}.vvp`;
const TOOLS = { tempBaseDir: TEMP, vvpBin: MINGW + '/vvp.exe' };
const TB_SIMPLES = 'module filtro_tb; reg clk; filtro dut(); initial #100 $finish; endmodule';

function makeTerminal() {
    const calls = [];
    return {
        calls,
        barras: [],
        appendToTerminal: (term, msg, level, opts) => calls.push({ term, msg, level, opts }),
        processExecutableOutput: vi.fn(),
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

const CONFIG_SPF = {
    synthesizableFiles: [{ path: DUT, name: 'filtro.v', isTopLevel: true }],
    testbenchFile: TB,
};
const CONFIG = { topLevelFile: DUT, testbenchFile: TB, synthesizableFiles: [DUT] };

async function novoModulo(config = CONFIG_SPF) {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    mod.projectConfig = config;
    return mod;
}

function decidir(decisao) {
    resolveWaveSelection.mockResolvedValue({
        signalsToDump: [], overrideUserDumpvars: false, source: 'default', tbKey: TOP,
        monitorScopes: [], hierarchyTree: null, ...decisao,
    });
}

/** O iverilog falso escreve o .vvp; o vvp falso emite o que mandarem. */
function ligarIcarus({ buildCode = 0, runCode = 0, escreveVvp = true, saida = [] } = {}) {
    const passos = [];
    const executar = async (spec) => {
        passos.push(spec);
        if (spec.step === 'iverilog-build') {
            if (buildCode === 0 && escreveVvp) api._arquivos.set(spec.args[spec.args.indexOf('-o') + 1], 'vvp');
            return { code: buildCode };
        }
        if (spec.step === 'vvp-run') {
            for (const d of saida) api._emitir(d);
            return { code: runCode };
        }
        throw new Error('passo inesperado ' + spec.step);
    };
    runSpec.mockImplementation(executar);
    runSpecStreamed.mockImplementation(executar);
    return passos;
}

const msgs = () => terminal.calls.map((c) => c.msg);
const visiveis = () => terminal.calls.filter((c) => !c.opts?.internal).map((c) => [c.term, c.msg, c.level]);

beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
    window.t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
    for (const [p, c] of [
        [MINGW + '/iverilog.exe', 'MZ'],
        [COMP + '/HDL/processor.v', 'module processor; endmodule'],
        [COMP + '/HDL/core_tb.v', 'module core_tb; endmodule'],
        [TB, TB_SIMPLES],
        [DUT, 'module filtro; endmodule'],
    ]) api._arquivos.set(p, c);
    decidir({});
});

afterEach(() => {
    delete window.electronAPI;
    delete window._latestCompilationModule;
    delete window.t;
    iniciarRodada();
    vi.clearAllMocks();
});

describe('o preparo do Wave', () => {
    it('resolve a selecao com as fontes e a HDL, instrumenta e monta as fontes', async () => {
        decidir({ source: 'wc', signalsToDump: ['filtro_tb.clk'], overrideUserDumpvars: true });
        const mod = await novoModulo();

        const r = await chamar.preparar(mod, CONFIG, TOP, TEMP);

        expect(resolveWaveSelection).toHaveBeenCalledWith(
            expect.objectContaining({ projectPath: PROJ }),
            { config: CONFIG, simTopModule: TOP, filePaths: [DUT, TB, COMP + '/HDL/processor.v'] },
        );
        expect(r.instrumentedTbPath).toBe(INSTR);
        expect([...r.fileSet]).toEqual([DUT, INSTR]);
        expect(r.decision.source).toBe('wc');
        expect(api._arquivos.get(INSTR)).toContain('$dumpvars(0, filtro_tb.clk)');
        expect(mod._validatedWaveSelection).toEqual(['filtro_tb.clk']);
        expect(visiveis()).toEqual([['twave', 'terminal.wave.waveSource {"label":"terminal.wave.sourceLabelWc {\\"count\\":1}"}', 'info']]);
    });

    it.each([
        ['gtkw', 'terminal.wave.sourceLabelGtkw {\\"count\\":0}'],
        ['tb', 'terminal.wave.sourceLabelTb'],
        ['default', 'terminal.wave.sourceLabelDefault'],
        ['outra', 'outra'],
    ])('a linha da fonte da selecao: %s', async (source, rotulo) => {
        decidir({ source });
        const mod = await novoModulo();
        await chamar.preparar(mod, CONFIG, TOP, TEMP);
        expect(msgs()[0]).toBe(`terminal.wave.waveSource {"label":"${rotulo}"}`);
    });

    it('testbench com $dumpvars proprio: manda ele, e a selecao do layout fica vazia', async () => {
        api._arquivos.set(TB, 'module filtro_tb; initial begin $dumpfile("a.vcd"); $dumpvars(0, filtro_tb); #9 $finish; end endmodule');
        decidir({ source: 'tb', signalsToDump: ['x'] });
        const mod = await novoModulo();
        const r = await chamar.preparar(mod, CONFIG, TOP, TEMP);
        expect(r.instrumentedTbPath).toBe(TB);
        expect(mod._validatedWaveSelection).toEqual([]);
    });

    it('com a Wave Configuration por cima do $dumpvars do testbench, avisa', async () => {
        api._arquivos.set(TB, 'module filtro_tb; initial begin $dumpfile("a.vcd"); $dumpvars(0, filtro_tb); #9 $finish; end endmodule');
        decidir({ source: 'wc', signalsToDump: ['filtro_tb.clk'], overrideUserDumpvars: true });
        const mod = await novoModulo();
        await chamar.preparar(mod, CONFIG, TOP, TEMP);
        expect(visiveis().at(-1)).toEqual(['twave', 'terminal.wave.overrideUserDumpvars', 'tips']);
    });

    it('$fopen de leitura de arquivo que nao existe vira aviso antes de simular', async () => {
        api._arquivos.set(TB, 'module filtro_tb; integer f; initial begin f = $fopen("C:/antiga/entrada.txt", "r"); '
            + 'g = $fopen("C:/proj/ok.txt", "r"); #9 $finish; end endmodule');
        api._arquivos.set('C:/proj/ok.txt', '1');
        const mod = await novoModulo();
        await chamar.preparar(mod, CONFIG, TOP, TEMP);
        expect(visiveis()).toContainEqual(['twave', 'terminal.wave.fopenMissing {"path":"C:/antiga/entrada.txt"}', 'warning']);
        expect(msgs().filter((m) => m.startsWith('terminal.wave.fopenMissing'))).toHaveLength(1);
    });

    it('sem a biblioteca HDL, e sem conseguir reler o testbench, segue', async () => {
        const mod = await novoModulo();
        const ler = api.readFile.getMockImplementation();
        let leituras = 0;
        api.readFile.mockImplementation(async (p, o) => {
            if (p === TB && ++leituras > 1) throw new Error('sumiu');
            return ler(p, o);
        });
        api.listFilesInDirectory.mockRejectedValueOnce(new Error('EACCES'));
        const r = await chamar.preparar(mod, CONFIG, TOP, TEMP);
        expect(resolveWaveSelection.mock.calls[0][1].filePaths).toEqual([DUT, TB]);
        expect(r.instrumentedTbPath).toBe(INSTR);
    });

    it('lista da HDL que nao e lista: segue so com as fontes', async () => {
        api.listFilesInDirectory.mockResolvedValueOnce(null);
        const mod = await novoModulo();
        await chamar.preparar(mod, { ...CONFIG, testbenchFile: TB }, TOP, TEMP);
        expect(resolveWaveSelection.mock.calls[0][1].filePaths).toEqual([DUT, TB]);
    });
});

describe('o testbench instrumentado', () => {
    it('conteudo igual ao que ja esta na Temp nao e reescrito', async () => {
        const mod = await novoModulo();
        await chamar.instrumentar(mod, TB, TOP, TEMP);
        expect(api.writeFile).toHaveBeenCalledTimes(1);
        api.writeFile.mockClear();

        expect(await chamar.instrumentar(mod, TB, TOP, TEMP)).toEqual({ path: INSTR, reason: 'auto' });
        expect(api.writeFile).not.toHaveBeenCalled();

        await chamar.instrumentar(mod, TB, TOP, TEMP, ['filtro_tb.clk']);
        expect(api.writeFile).toHaveBeenCalledTimes(1);
    });

    it('copia da Temp que existe mas nao se le: reescreve', async () => {
        api._arquivos.set(INSTR, 'x');
        const ler = api.readFile.getMockImplementation();
        api.readFile.mockImplementation(async (p, o) => {
            if (p === INSTR) throw new Error('EBUSY');
            return ler(p, o);
        });
        const mod = await novoModulo();
        await chamar.instrumentar(mod, TB, TOP, TEMP);
        expect(api.writeFile).toHaveBeenCalledWith(INSTR, expect.stringContaining('$dumpvars(1, filtro_tb)'));
    });

    it('testbench sem endmodule fica como esta, para o iverilog acusar o erro', async () => {
        api._arquivos.set(TB, 'module filtro_tb;');
        const mod = await novoModulo();
        expect(await chamar.instrumentar(mod, TB, TOP, TEMP)).toEqual({ path: TB, reason: 'malformed' });
    });

    it('testbench com clock livre e sem $finish: avisa uma vez por compilacao', async () => {
        api._arquivos.set(TB, 'module filtro_tb; reg clk; always #5 clk = ~clk; endmodule');
        const mod = await novoModulo();
        await chamar.instrumentar(mod, TB, TOP, TEMP);
        await chamar.instrumentar(mod, TB, TOP, TEMP);
        expect(visiveis()).toEqual([['twave', 'terminal.wave.noFinish {"file":"filtro_tb.v"}', 'warning']]);
    });
});

describe('o build do .vvp', () => {
    it('instrumenta, compila com a HDL e o topo do testbench, e confere o .vvp', async () => {
        decidir({ source: 'default' });
        const mod = await novoModulo();
        const passos = ligarIcarus();

        await chamar.construir(mod);

        expect(statusUpdater.startCompilation).toHaveBeenCalledWith('verilog');
        expect(TabManager.saveAllFiles).toHaveBeenCalled();
        expect(api.mkdir).toHaveBeenCalledWith(TEMP);
        expect(passos).toHaveLength(1);
        expect(passos[0]).toMatchObject({ step: 'iverilog-build', binary: MINGW + '/iverilog.exe', cwd: PROJ });
        expect(passos[0].args).toEqual(expect.arrayContaining(['-s', TOP, '-o', VVP, '-y', COMP + '/HDL', DUT, INSTR]));
        expect(resolveWaveSelection.mock.calls[0][1].filePaths).toEqual([DUT, TB, COMP + '/HDL/processor.v']);
        expect(mod._validatedWaveSelection).toEqual([]);
        expect(visiveis()).toEqual([
            ['tveri', 'terminal.veri.phaseBuild', 'info'],
            ['tveri', 'terminal.veri.topLevel {"name":"filtro.v"}', 'tips'],
            ['tveri', 'terminal.veri.testbench {"name":"filtro_tb.v"}', 'tips'],
            ['tveri', 'terminal.veri.synthFiles {"count":1}', 'info'],
            ['twave', 'terminal.wave.waveSource {"label":"terminal.wave.sourceLabelDefault"}', 'info'],
            ['tveri', 'terminal.veri.autoInstrTb {"name":"instr_filtro_tb.v"}', 'info'],
            ['tveri', 'terminal.veri.building', 'info'],
            ['tveri', 'terminal.veri.buildSuccess', 'success'],
        ]);
        // O rotulo e a linha de comando vao como linha interna.
        expect(terminal.calls.filter((c) => c.opts?.internal).map((c) => c.msg)[0]).toBe('terminal.veri.buildCmd');
        expect(terminal.processExecutableOutput).toHaveBeenCalledWith('tveri', { code: 0 });
        expect(statusUpdater.compilationSuccess).toHaveBeenCalledWith('verilog');
    });

    it('sem topo no .spf nao anuncia topo; com override, avisa; tb com $dumpvars proprio vai cru', async () => {
        api._arquivos.set(TB, 'module filtro_tb; initial begin $dumpfile("a.vcd"); $dumpvars(0, filtro_tb); #9 $finish; end endmodule');
        decidir({ source: 'tb' });
        const mod = await novoModulo({ synthesizableFiles: [{ path: DUT }], testbenchFile: TB });
        const passos = ligarIcarus();
        await chamar.construir(mod);
        expect(msgs().some((m) => m.startsWith('terminal.veri.topLevel'))).toBe(false);
        expect(msgs().some((m) => m.startsWith('terminal.veri.autoInstrTb'))).toBe(false);
        expect(passos[0].args).toContain(TB);

        terminal.calls.length = 0;
        decidir({ source: 'wc', signalsToDump: ['filtro_tb.clk'], overrideUserDumpvars: true });
        await chamar.construir(mod);
        expect(visiveis()).toContainEqual(['twave', 'terminal.wave.overrideUserDumpvars', 'tips']);
        expect(mod._validatedWaveSelection).toEqual(['filtro_tb.clk']);
    });

    it('lista da HDL que falha ou nao e lista: valida so com as fontes', async () => {
        const mod = await novoModulo();
        ligarIcarus();
        api.listFilesInDirectory.mockRejectedValueOnce(new Error('EACCES'));
        await chamar.construir(mod);
        api.listFilesInDirectory.mockResolvedValueOnce(null);
        await chamar.construir(mod);
        expect(resolveWaveSelection.mock.calls.map((c) => c[1].filePaths)).toEqual([[DUT, TB], [DUT, TB]]);
    });

    it.each([
        ['iverilog que falha', { buildCode: 2 }, 'error.compilation.iverilogFailedBuild {"code":2}'],
        ['iverilog que sai bem sem escrever o .vvp', { escreveVvp: false }, 'error.compilation.vvpNotGenerated'],
    ])('%s: banner de falha no TVERI e o erro para cima', async (_nome, opcoes, mensagem) => {
        const mod = await novoModulo();
        ligarIcarus(opcoes);
        const erro = await chamar.construir(mod).catch((e) => e);
        expect(erro.message).toBe(mensagem);
        expect(erro.jaNoTerminal).toBe(true);
        expect(visiveis().slice(-2)).toEqual([
            ['tveri', 'terminal.veri.bannerFailed', 'error'],
            ['tveri', `terminal.common.error {"message":${JSON.stringify(mensagem)}}`, 'error'],
        ]);
        expect(statusUpdater.compilationError).toHaveBeenCalledWith('verilog', mensagem);
    });

    it('sem o iverilog empacotado, recusa nomeando o caminho', async () => {
        api._arquivos.delete(MINGW + '/iverilog.exe');
        const mod = await novoModulo();
        await expect(chamar.construir(mod)).rejects.toThrow(`error.toolchain.iverilogNotFound {"path":"${MINGW}/iverilog.exe"}`);
    });

    it('sem testbench: recusa antes de qualquer ferramenta', async () => {
        const mod = await novoModulo({ synthesizableFiles: [] });
        const passos = ligarIcarus();
        await expect(chamar.construir(mod)).rejects.toThrow('error.config.noTestbench');
        expect(passos).toHaveLength(0);
    });

    it('cancelado pelo usuario: sobe sem banner de falha', async () => {
        pedirCancelamento();
        const mod = await novoModulo();
        ligarIcarus({ buildCode: 1 });
        const erro = await chamar.construir(mod).catch((e) => e);
        expect(erro.jaNoTerminal).toBeUndefined();
        expect(msgs()).not.toContain('terminal.veri.bannerFailed');
        expect(statusUpdater.compilationError).toHaveBeenCalled();
    });

    it('construir e conferir: o .vvp tem de estar onde o Wave espera', async () => {
        const mod = await novoModulo();
        ligarIcarus();
        await chamar.construirEConferir(mod, TOP, TEMP);
        expect(msgs()[0]).toBe('terminal.wave.buildingVvp');

        await expect(chamar.construirEConferir(mod, 'outro_tb', TEMP))
            .rejects.toThrow(`error.compilation.vvpNotProduced {"path":"${TEMP}/outro_tb.vvp"}`);
    });
});

describe('a simulacao do vvp', () => {
    it('roda na pasta do projeto, filtra o ruido e explica o descritor invalido uma vez', async () => {
        api._arquivos.set(TB, '$readmemb("pesos.txt", m);');
        api._arquivos.set(PROJ + '/Simulation/pesos.txt', '01');
        const mod = await novoModulo();
        const passos = ligarIcarus({
            saida: [{
                type: 'stdout',
                data: ['LXT info: x', 'LXT2 info: y', 'VZT info: z', 'VCD info: w', '$stop called at 9',
                    'progress: 1/4', 'ERROR: invalid file descriptor', 'ERROR: invalid file descriptor', 'y = 1', ''].join('\n'),
            }, null],
        });

        expect(await chamar.simular(mod, TOP, TOOLS)).toBe(PROJ);

        expect(passos[0]).toMatchObject({ step: 'vvp-run', binary: TOOLS.vvpBin, cwd: PROJ });
        expect(passos[0].args).toContain(VVP);
        expect(api._arquivos.get(PROJ + '/pesos.txt')).toBe('01');
        expect(api.checkFileWritable).toHaveBeenCalledWith(`${PROJ}/${TOP}.fst`);
        expect(visiveis()).toEqual([
            ['twave', 'terminal.wave.runningVvp', 'info'],
            ['twave', 'terminal.wave.invalidFd', 'warning'],
            ['twave', 'ERROR: invalid file descriptor', 'raw'],
            ['twave', 'ERROR: invalid file descriptor', 'raw'],
            ['twave', 'y = 1', 'raw'],
        ]);
        expect(terminal.barras).toHaveLength(1);
        expect(api._ouvintes).toHaveLength(0);
    });

    it('vvp que sai com erro sobe o codigo e desliga o ouvinte', async () => {
        const mod = await novoModulo();
        ligarIcarus({ runCode: 1 });
        await expect(chamar.simular(mod, TOP, TOOLS)).rejects.toThrow('error.compilation.vvpFailed {"code":1}');
        expect(api._ouvintes).toHaveLength(0);
    });

    it('sem testbench nao ha dado a copiar; sem fluxo ao vivo roda igual; sem projeto, a Temp', async () => {
        delete api.onExecSpecStream;
        const mod = await novoModulo({ synthesizableFiles: [] });
        mod.projectPath = null;
        const passos = ligarIcarus();
        expect(await chamar.simular(mod, TOP, TOOLS)).toBe(TEMP);
        expect(passos[0].cwd).toBe(TEMP);
        expect(api.dirname).not.toHaveBeenCalled();
    });
});
