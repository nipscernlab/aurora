// @vitest-environment happy-dom
//
// O Verilator no botao Wave e no Fast Sim.
//
// Wave: o build com o testbench instrumentado e o `.vlt` que expoe os monitores
// e traduz o pedido de sinais em regras de escopo, depois a simulacao na pasta
// do projeto com o fluxo filtrado. Fast Sim: o mesmo testbench sem dump e sem
// trace, e o caminho cocotb quando o testbench e Python.
//
// Os casos entram pelo que o fluxo chama. `chamar` e o unico ponto que sabe
// onde cada peca mora, para o mesmo arquivo provar o comportamento antes e
// depois de ela sair do compilation_module.js. As regras de escopo do
// Verilator tem teste proprio (verilatorTraceRules); aqui sao falsas.

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
    verilatorTraceRules: vi.fn(() => ['tracing_off', 'tracing_on -scope "tb.dut"']),
    rulesFromDumpvars: vi.fn(() => ['tracing_on -scope "tb"']),
    defaultScopeRules: vi.fn(() => []),
    contarEscopos: vi.fn(() => ({ ligados: 1, desligados: 3 })),
}));

import { runSpec, runSpecStreamed } from '../../js/compilation/spec_runner.js';
import { TabManager } from '../../js/tabs/tab_manager.js';
import { statusUpdater } from '../../js/ui/status_updater.js';
import {
    verilatorTraceRules, rulesFromDumpvars, defaultScopeRules,
} from '../../js/wave/verilator_trace_rules.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';

const chamar = {
    buildDaOnda: (mod, ...a) => mod._waveBuildVerilator(...a),
    simulacao: (mod, ...a) => mod._waveRunVerilatorSimulation(...a),
    fastSim: (mod) => mod.runFastSim(),
};

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';
const TOP = 'filtro_tb';
const TB = PROJ + '/Simulation/filtro_tb.v';
const TB_INSTR = TEMP + '/aurora_filtro_tb.v';
const DUT = PROJ + '/Hardware/filtro.v';
const OBJ = `${TEMP}/obj_dir_${TOP}`;
const OBJ_FAST = `${TEMP}/obj_dir_fast_${TOP}`;
const VLT = TEMP + '/aurora_monitors.vlt';
const MINGW = COMP + '/Packages/msys/mingw64/bin';
const TOOLS = {
    tempBaseDir: TEMP,
    perlExe: MINGW + '/perl.exe',
    verilatorScript: MINGW + '/verilator',
    mingwBin: MINGW,
    usrBin: COMP + '/Packages/msys/usr/bin',
};

function makeTerminal() {
    const calls = [];
    return {
        calls,
        barras: [],
        appendToTerminal: (term, msg, level, opts) => calls.push({ term, msg, level, opts }),
        processExecutableOutput: vi.fn(),
        renderHardwareProgress: function (term, p) { this.barras.push([term, p]); },
        renderDumpSize: vi.fn(),
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
        mkdir: vi.fn(async () => {}),
        copyFile: vi.fn(async (de, para) => { arquivos.set(para, arquivos.get(de)); }),
        getFileStats: vi.fn(async () => ({ size: 1, mtime: 1 })),
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

/** O Verilator falso: o build escreve o exe; cada passo emite o que mandarem. */
function ligarVerilator({ buildCode = 0, runCode = 0, exe = 'exe', buildSaida = [], runSaida = [] } = {}) {
    const passos = [];
    const executar = async (spec) => {
        passos.push(spec);
        if (spec.step === 'verilator-build') {
            for (const d of buildSaida) api._emitir(d);
            if (buildCode === 0 && exe) {
                const objDir = spec.args[spec.args.indexOf('-Mdir') + 1];
                api._arquivos.set(exe === 'exe' ? `${objDir}/V${TOP}.exe` : `${objDir}/V${TOP}`, 'MZ');
            }
            return { code: buildCode };
        }
        if (spec.step === 'verilator-run') {
            for (const d of runSaida) api._emitir(d);
            return { code: runCode };
        }
        throw new Error('passo inesperado ' + spec.step);
    };
    runSpec.mockImplementation(executar);
    runSpecStreamed.mockImplementation(executar);
    return passos;
}

async function novoModulo(config = { testbenchFile: TB, synthesizableFiles: [{ path: DUT, isTopLevel: true }] }) {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    mod.projectConfig = config;
    return mod;
}

/** O preparo do Wave (instrumentar o testbench, resolver a selecao) tem teste proprio. */
function prepararWave(mod, decision, instrumentado = TB_INSTR) {
    mod._prepareWaveBuildInputs = vi.fn(async () => ({
        instrumentedTbPath: instrumentado,
        fileSet: new Set([DUT, instrumentado]),
        decision,
    }));
}

const CONFIG_WAVE = { testbenchFile: TB, synthesizableFiles: [DUT], topLevelFile: DUT };
const msgs = () => terminal.calls.map((c) => c.msg);

beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
    localStorage.clear();
    api._arquivos.set(TB, 'module filtro_tb; initial begin $dumpfile("x.vcd"); $dumpvars(0, filtro_tb); end endmodule');
    api._arquivos.set(TB_INSTR, 'module filtro_tb; initial $dumpvars(1, filtro_tb); endmodule');
    api._arquivos.set(MINGW + '/verilator', '#!perl');
    api._arquivos.set(MINGW + '/perl.exe', 'MZ');
});

afterEach(() => {
    delete window.electronAPI;
    delete window._latestCompilationModule;
    delete window.isCompilationCanceled;
    vi.clearAllMocks();
});

describe('o build do Verilator no Wave', () => {
    it('leva o testbench instrumentado e o .vlt, e devolve o exe', async () => {
        const mod = await novoModulo();
        prepararWave(mod, { source: 'wc', hierarchyTree: { t: 1 }, signalsToDump: ['filtro_tb.dut.y'] });
        const passos = ligarVerilator({
            buildSaida: [
                { type: 'stdout', data: '[ 42%] Building CXX\ng++ -c x.cpp\n\n' },
                null,
                { type: 'stdout' },
            ],
        });

        const r = await chamar.buildDaOnda(mod, TOP, TEMP, CONFIG_WAVE, TOOLS);

        expect(r).toEqual({ exePath: `${OBJ}/V${TOP}.exe`, objDir: OBJ });
        expect(api.mkdir).toHaveBeenCalledWith(OBJ);
        expect(passos).toHaveLength(1);
        const args = passos[0].args;
        expect(args).toEqual(expect.arrayContaining([DUT, TB_INSTR, VLT, '-Wno-fatal', '-Wno-TIMESCALEMOD',
            '-Wno-DECLFILENAME', '-Wno-STMTDLY', '--top-module', TOP, '-y', COMP + '/HDL']));
        expect(args).toContain('--trace-fst');

        // O .vlt expoe os cinco monitores e traz o pedido do usuario por escopo.
        const vlt = api._arquivos.get(VLT).split('\n');
        expect(vlt[0]).toBe('`verilator_config');
        expect(vlt.filter((l) => l.startsWith('public_flat_rd'))).toHaveLength(5);
        expect(vlt.slice(-3)).toEqual(['tracing_off', 'tracing_on -scope "tb.dut"', '']);
        expect(verilatorTraceRules).toHaveBeenCalledWith({ t: 1 }, ['filtro_tb.dut.y']);

        expect(msgs()).toEqual([
            'terminal.wave.buildingVerilator',
            'terminal.veri.autoInstrTb',
            'terminal.wave.verilatorScopeRules',
            expect.stringContaining('perl'),
            'g++ -c x.cpp',
        ]);
        expect(terminal.calls.at(-1).level).toBe('raw');
        expect(terminal.calls[3].opts).toEqual({ internal: true });
        expect(terminal.barras).toHaveLength(1);
        expect(api._ouvintes).toHaveLength(0);
    });

    it('.gtkw ativo usa as mesmas regras do picker', async () => {
        const mod = await novoModulo();
        prepararWave(mod, { source: 'gtkw', hierarchyTree: {}, signalsToDump: ['a'] });
        ligarVerilator();
        await chamar.buildDaOnda(mod, TOP, TEMP, CONFIG_WAVE, TOOLS);
        expect(verilatorTraceRules).toHaveBeenCalledWith({}, ['a']);
    });

    it('pedido do proprio testbench: as regras saem dos $dumpvars dele', async () => {
        const mod = await novoModulo();
        prepararWave(mod, { source: 'tb', hierarchyTree: { t: 2 } });
        ligarVerilator();
        await chamar.buildDaOnda(mod, TOP, TEMP, CONFIG_WAVE, TOOLS);
        expect(rulesFromDumpvars).toHaveBeenCalledWith({ t: 2 }, api._arquivos.get(TB_INSTR));
        expect(api._arquivos.get(VLT)).toContain('tracing_on -scope "tb"');
    });

    it.each([
        ['padrao sem regras', { source: 'default', hierarchyTree: {} }],
        ['sem decisao', undefined],
        ['fonte desconhecida', { source: 'outra' }],
    ])('%s: so os monitores, sem a mensagem de escopo', async (_nome, decisao) => {
        const mod = await novoModulo();
        prepararWave(mod, decisao, TB);
        ligarVerilator();
        await chamar.buildDaOnda(mod, TOP, TEMP, CONFIG_WAVE, TOOLS);
        expect(api._arquivos.get(VLT)).not.toContain('tracing');
        expect(msgs()).not.toContain('terminal.wave.verilatorScopeRules');
        // Testbench sem instrumentar: nada a anunciar.
        expect(msgs()).not.toContain('terminal.veri.autoInstrTb');
        if (decisao?.source === 'default') expect(defaultScopeRules).toHaveBeenCalled();
    });

    it('sem conseguir gravar o .vlt, o build segue sem ele', async () => {
        const mod = await novoModulo();
        prepararWave(mod, { source: 'wc', hierarchyTree: {}, signalsToDump: [] });
        api.writeFile.mockRejectedValueOnce(new Error('EPERM'));
        const passos = ligarVerilator();
        await chamar.buildDaOnda(mod, TOP, TEMP, CONFIG_WAVE, TOOLS);
        expect(passos[0].args).not.toContain(VLT);
    });

    it('sem fluxo ao vivo, o build roda do mesmo jeito', async () => {
        delete api.onExecSpecStream;
        const mod = await novoModulo();
        prepararWave(mod, { source: 'default', hierarchyTree: {} });
        ligarVerilator();
        await expect(chamar.buildDaOnda(mod, TOP, TEMP, CONFIG_WAVE, TOOLS)).resolves.toMatchObject({ objDir: OBJ });
    });

    it('exe sem extensao serve; sem exe nenhum, erro com o caminho', async () => {
        window.t = (k, p) => (p ? `${k} ${Object.values(p).join(' ')}` : k);
        try {
            const mod = await novoModulo();
            prepararWave(mod, { source: 'default', hierarchyTree: {} });
            ligarVerilator({ exe: 'sem-extensao' });
            expect((await chamar.buildDaOnda(mod, TOP, TEMP, CONFIG_WAVE, TOOLS)).exePath).toBe(`${OBJ}/V${TOP}`);

            api._arquivos.delete(`${OBJ}/V${TOP}`);
            ligarVerilator({ exe: null });
            await expect(chamar.buildDaOnda(mod, TOP, TEMP, CONFIG_WAVE, TOOLS))
                .rejects.toThrow(`error.compilation.verilatorExeMissing ${OBJ}/V${TOP}.exe`);
        } finally {
            delete window.t;
        }
    });

    it('build que falha sobe o codigo e desliga o ouvinte', async () => {
        window.t = (k, p) => (p ? `${k} ${p.code}` : k);
        try {
            const mod = await novoModulo();
            prepararWave(mod, { source: 'default', hierarchyTree: {} });
            ligarVerilator({ buildCode: 2 });
            await expect(chamar.buildDaOnda(mod, TOP, TEMP, CONFIG_WAVE, TOOLS))
                .rejects.toThrow('error.compilation.verilatorFailed 2');
            expect(api._ouvintes).toHaveLength(0);
        } finally {
            delete window.t;
        }
    });
});

describe('a simulacao do Verilator', () => {
    const EXE = `${OBJ}/V${TOP}.exe`;

    it('roda na pasta do projeto, filtra o fluxo e vigia o dump', async () => {
        api._arquivos.set(TB, '$readmemb("pesos.txt", m);');
        api._arquivos.set(PROJ + '/Simulation/pesos.txt', '0101');
        const mod = await novoModulo();
        const passos = ligarVerilator({
            runSaida: [{
                type: 'stdout',
                data: [
                    'FST info: dumpfile x opened',
                    'VCD info: y',
                    '- tb.v:9: Verilog $finish called at 100',
                    '$stop called at 5',
                    'progress: 5/10',
                    '- Verilator: $finish at 1us; walltime 0.01 s',
                    '- S i m u l a t i o n   R e p o r t: Verilator 5.024',
                    '- lista de compras',
                    'saida = 3',
                    '',
                ].join('\n'),
            }, null],
        });

        expect(await chamar.simulacao(mod, TOP, TOOLS, EXE)).toBe(PROJ);

        expect(passos[0]).toMatchObject({ step: 'verilator-run', binary: EXE, cwd: PROJ });
        expect(api._arquivos.get(PROJ + '/pesos.txt')).toBe('0101');
        expect(api.checkFileWritable).toHaveBeenCalledWith(`${PROJ}/${TOP}.fst`);
        expect(api.checkFileWritable).toHaveBeenCalledWith(`${PROJ}/${TOP}.vcd`);
        expect(terminal.calls.map((c) => [c.msg, c.level])).toEqual([
            ['terminal.wave.runningVerilator', 'plain'],
            ['- Verilator: $finish at 1us; walltime 0.01 s', 'plain'],
            ['- S i m u l a t i o n   R e p o r t: Verilator 5.024', 'plain'],
            ['- lista de compras', 'raw'],
            ['saida = 3', 'raw'],
        ]);
        expect(terminal.barras).toEqual([
            ['twave', { pct: 50, cyc: 5, total: 10, reads: null, label: 'progress', done: false }],
        ]);
        // O vigia fecha com a ultima leitura quando a simulacao termina.
        expect(terminal.renderDumpSize).not.toHaveBeenCalled();
        expect(api._ouvintes).toHaveLength(0);
    });

    it('dump travado para escrita para antes de simular', async () => {
        api.checkFileWritable.mockResolvedValue({ exists: true, writable: false, code: 'EBUSY' });
        const mod = await novoModulo();
        const passos = ligarVerilator();
        await expect(chamar.simulacao(mod, TOP, TOOLS, EXE)).rejects.toThrow('error.compilation.dumpLockedBusy');
        expect(passos).toHaveLength(0);
    });

    it('simulacao que sai com erro sobe o codigo', async () => {
        window.t = (k, p) => (p ? `${k} ${p.code}` : k);
        try {
            const mod = await novoModulo();
            ligarVerilator({ runCode: 3221225781 });
            await expect(chamar.simulacao(mod, TOP, TOOLS, EXE))
                .rejects.toThrow('error.compilation.verilatorRunFailed 3221225781');
            expect(api._ouvintes).toHaveLength(0);
        } finally {
            delete window.t;
        }
    });

    it('sem testbench no .spf nao ha dado a copiar; sem fluxo ao vivo roda igual', async () => {
        delete api.onExecSpecStream;
        const mod = await novoModulo({ synthesizableFiles: [] });
        ligarVerilator();
        expect(await chamar.simulacao(mod, TOP, TOOLS, EXE)).toBe(PROJ);
        expect(api.dirname).not.toHaveBeenCalled();
    });
});

describe('Fast Sim', () => {
    it('Verilog: build sem trace com o testbench sem dump, e roda', async () => {
        const mod = await novoModulo();
        const passos = ligarVerilator();

        await chamar.fastSim(mod);

        expect(TabManager.saveAllFiles).toHaveBeenCalled();
        expect(statusUpdater.startCompilation).toHaveBeenCalledWith('verilator');
        expect(passos.map((p) => p.step)).toEqual(['verilator-build', 'verilator-run']);
        const fastTb = `${TEMP}/fast_${TOP}.v`;
        expect(passos[0].args).toEqual(expect.arrayContaining([DUT, fastTb, '-Mdir', OBJ_FAST]));
        expect(passos[0].args).not.toContain('--trace-fst');
        // Os $dumpfile/$dumpvars do testbench ficam comentados: sem trace eles
        // seriam peso morto ou erro de "tracing not configured".
        expect(api._arquivos.get(fastTb)).toBe('module filtro_tb; initial begin '
            + '/* Aurora: overridden by Wave Configuration ─ $dumpfile("x.vcd"); */ '
            + '/* Aurora: overridden by Wave Configuration ─ $dumpvars(0, filtro_tb); */ end endmodule');
        expect(passos[1]).toMatchObject({ binary: `${OBJ_FAST}/V${TOP}.exe`, cwd: PROJ });
        expect(terminal.processExecutableOutput).toHaveBeenCalledWith('twave', { code: 0 });
        expect(msgs()[0]).toBe('terminal.wave.fastBanner');
        expect(msgs()).toContain('terminal.wave.fastBuilding');
        expect(msgs().at(-1)).toBe('terminal.wave.fastDone');
    });

    it('exe sem extensao serve; sem exe, erro no terminal e para quem chamou', async () => {
        const mod = await novoModulo();
        ligarVerilator({ exe: 'sem-extensao' });
        await chamar.fastSim(mod);
        expect(runSpecStreamed.mock.calls[0][0].binary).toBe(`${OBJ_FAST}/V${TOP}`);

        api._arquivos.delete(`${OBJ_FAST}/V${TOP}`);
        terminal.calls.length = 0;
        ligarVerilator({ exe: null });
        const erro = await chamar.fastSim(mod).catch((e) => e);
        expect(erro.message).toBe('error.compilation.verilatorExeMissing');
        expect(erro.jaNoTerminal).toBe(true);
        expect(terminal.calls.at(-1)).toMatchObject({ msg: 'terminal.common.error', level: 'error' });
    });

    it('build que falha para antes de rodar', async () => {
        const mod = await novoModulo();
        const passos = ligarVerilator({ buildCode: 1 });
        await expect(chamar.fastSim(mod)).rejects.toThrow('error.compilation.verilatorFailed');
        expect(passos).toHaveLength(1);
    });

    it('sem testbench: erro no terminal', async () => {
        const mod = await novoModulo({ synthesizableFiles: [] });
        await expect(chamar.fastSim(mod)).rejects.toThrow('error.config.noTestbench');
        expect(terminal.calls.at(-1).level).toBe('error');
    });

    it('cancelado pelo usuario: sobe sem carimbar erro no terminal', async () => {
        window.isCompilationCanceled = () => true;
        const mod = await novoModulo();
        ligarVerilator({ buildCode: 1 });
        const erro = await chamar.fastSim(mod).catch((e) => e);
        expect(erro.jaNoTerminal).toBeUndefined();
        expect(terminal.calls.some((c) => c.level === 'error')).toBe(false);
    });

    describe('testbench Python (cocotb, sem onda)', () => {
        const PY = PROJ + '/Simulation/test_filtro.py';

        async function moduloCocotb(ctx) {
            const mod = await novoModulo({ testbenchFile: PY, synthesizableFiles: [{ path: DUT, isTopLevel: true }] });
            mod._waveValidateCocotbConfig = vi.fn(async () => ctx);
            mod._waveRunCocotbSimulation = vi.fn(async () => {});
            return mod;
        }

        it('topo por diretiva, no Icarus', async () => {
            const mod = await moduloCocotb({ toplevelSource: 'directive', hdlTopModule: 'filtro' });
            await chamar.fastSim(mod);

            expect(mod._waveRunCocotbSimulation).toHaveBeenCalledWith(
                { toplevelSource: 'directive', hdlTopModule: 'filtro' },
                expect.objectContaining({ tempBaseDir: TEMP }),
                expect.objectContaining({ testbenchFile: PY }),
                { wave: false },
            );
            expect(statusUpdater.startCompilation).toHaveBeenCalledWith('verilog');
            expect(terminal.calls.map((c) => [c.msg, c.level])).toEqual([
                ['terminal.wave.fastBanner', 'info'],
                ['terminal.wave.cocotbToplevelDirective', 'tips'],
                ['terminal.wave.cocotbSimulator', 'tips'],
                ['terminal.wave.fastDone', 'success'],
            ]);
            expect(runSpec).not.toHaveBeenCalled();
        });

        it('topo adivinhado, no Verilator: avisa e diz qual simulador', async () => {
            localStorage.setItem('aurora.waveSimulator', 'verilator');
            const traduzidas = [];
            window.t = (k, p) => { traduzidas.push([k, p]); return k; };
            try {
                const mod = await moduloCocotb({ toplevelSource: 'fallback', hdlTopModule: 'filtro' });
                await chamar.fastSim(mod);
                expect(terminal.calls[1]).toMatchObject({ msg: 'terminal.wave.cocotbToplevelFallback', level: 'warning' });
                expect(traduzidas.find(([k]) => k === 'terminal.wave.cocotbToplevelFallback')[1])
                    .toEqual({ file: 'test_filtro.py', module: 'filtro' });
                expect(traduzidas.find(([k]) => k === 'terminal.wave.cocotbSimulator')[1]).toEqual({ sim: 'Verilator' });
                expect(statusUpdater.startCompilation).toHaveBeenCalledWith('verilator');
            } finally {
                delete window.t;
            }
        });
    });
});
