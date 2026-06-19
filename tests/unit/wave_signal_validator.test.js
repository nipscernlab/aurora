import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Os helpers extraidos tocam o filesystem so via window.electronAPI e o
// WaveStore real; o beforeEach stuba um fake fresh per-test. parseVerilogModules
// / validateSelection sao os modulos REAIS (ja testados a parte) — aqui exercito
// o deps-threading, a precedencia de fonte e o seam do _validatedWaveSelection.
import { WaveStore } from '../../js/wave/wave_state_store.ts';
import {
    validateWaveSelection, resolveWaveSelection,
    resolveCocotbWaveSelection, parseProjectSources,
} from '../../js/compilation/wave_signal_validator.js';

// --- fixtures verilog (parseadas pelo parser real) -----------------------
const COUNTER_V = `module counter (input wire clk, input wire rst, output reg [3:0] q);
  always @(posedge clk) if (rst) q <= 0; else q <= q + 1;
endmodule`;
const TB_V = `module tb_counter;
  reg clk; reg rst; wire [3:0] q;
  counter dut (.clk(clk), .rst(rst), .q(q));
endmodule`;
const TB_WITH_DUMP = `module tb_counter;
  reg clk; reg rst; wire [3:0] q;
  counter dut (.clk(clk), .rst(rst), .q(q));
  initial begin $dumpfile("d.vcd"); $dumpvars(0, tb_counter); end
endmodule`;

const SYNTH = '/proj/counter.v';
const TB = '/proj/tb_counter.v';

/**
 * In-memory fake do window.electronAPI — cobre os handles que WaveStore +
 * os helpers tocam (joinPath, fileExists, readFile, writeFile, mkdir,
 * listFilesInDirectory). Mesmo padrao do waveStateStore.test.js.
 */
function makeFakeElectronApi() {
    const files = new Map();
    const dirs = new Set(['']);
    const norm = (p) => p.replace(/\\/g, '/');
    const dirname = (p) => {
        const i = norm(p).lastIndexOf('/');
        return i === -1 ? '' : p.slice(0, i);
    };
    return {
        _files: files,
        joinPath: async (...parts) => parts.filter(Boolean).join('/'),
        fileExists: async (p) => files.has(norm(p)) || dirs.has(norm(p)),
        readFile: async (p) => {
            const c = files.get(norm(p));
            if (c === undefined) throw new Error(`ENOENT: ${p}`);
            return c;
        },
        writeFile: async (p, content) => {
            const np = norm(p);
            files.set(np, content);
            let d = dirname(np);
            while (d) { dirs.add(d); d = dirname(d); }
        },
        mkdir: async (p) => {
            const np = norm(p);
            let d = np;
            while (d) { dirs.add(d); d = dirname(d); }
        },
        listFilesInDirectory: async (p) => {
            const np = norm(p);
            const out = new Set();
            for (const file of files.keys()) {
                if (file.startsWith(np + '/')) {
                    const rest = file.slice(np.length + 1);
                    if (!rest.includes('/')) out.add(rest);
                }
            }
            return [...out].sort();
        },
    };
}

let termCalls;
function makeDeps({ projectConfig = {} } = {}) {
    termCalls = [];
    return {
        projectPath: '/proj',
        terminalManager: { appendToTerminal: (term, msg, level) => termCalls.push({ term, msg, level }) },
        projectConfig,
        componentsPath: '/comp',
    };
}
const warned = () => termCalls.some((c) => c.term === 'twave' && c.level === 'warning');

beforeEach(() => {
    globalThis.window = { electronAPI: makeFakeElectronApi() };
});
afterEach(() => {
    delete globalThis.window;
});

describe('validateWaveSelection', () => {
    it('short-circuita em selecao vazia (nao toca terminal/WaveStore)', async () => {
        const deps = makeDeps();
        expect(await validateWaveSelection(deps, [], [], 'tb_counter', null)).toEqual([]);
        expect(termCalls).toEqual([]);
    });

    it('poda sinal stale contra a hierarquia parseada e avisa em twave', async () => {
        const deps = makeDeps();
        window.electronAPI._files.set(SYNTH, COUNTER_V);
        window.electronAPI._files.set(TB, TB_V);
        const result = await validateWaveSelection(
            deps, ['tb_counter.clk', 'tb_counter.bogus'], [SYNTH, TB], 'tb_counter', null,
        );
        expect(result).toEqual(['tb_counter.clk']);
        expect(warned()).toBe(true);
    });

    it('persiste a selecao podada no WaveStore quando ha tbKey', async () => {
        const deps = makeDeps();
        window.electronAPI._files.set(SYNTH, COUNTER_V);
        window.electronAPI._files.set(TB, TB_V);
        await WaveStore.ensureRegistered('/proj', 'tb_counter', { tbPath: TB, tbModule: 'tb_counter' });
        await WaveStore.update('/proj', 'tb_counter', (cfg) => { cfg.waveSignals = ['tb_counter.clk', 'tb_counter.bogus']; });

        await validateWaveSelection(
            deps, ['tb_counter.clk', 'tb_counter.bogus'], [SYNTH, TB], 'tb_counter', 'tb_counter',
        );

        const state = await WaveStore.read('/proj', 'tb_counter');
        expect(state.waveSignals).toEqual(['tb_counter.clk']); // bogus auto-prunado
    });

    it('cai pro raw + warning quando o parse/IO falha (conservador)', async () => {
        const deps = makeDeps();
        // filePaths nao semeados → readFile lanca ENOENT → catch
        const result = await validateWaveSelection(deps, ['x.y'], ['/proj/missing.v'], 'top', null);
        expect(result).toEqual(['x.y']);
        expect(warned()).toBe(true);
    });
});

describe('resolveWaveSelection (precedencia de fonte)', () => {
    it('source=default quando nao ha gtkw ativo, WC nem $dumpvars', async () => {
        const deps = makeDeps();
        window.electronAPI._files.set(TB, TB_V);
        const d = await resolveWaveSelection(deps, { config: { testbenchFile: TB }, simTopModule: 'tb_counter', filePaths: [TB] });
        expect(d).toMatchObject({ source: 'default', signalsToDump: [], overrideUserDumpvars: false, tbKey: 'tb_counter' });
    });

    it('source=tb quando o testbench tem $dumpvars hand-written', async () => {
        const deps = makeDeps();
        window.electronAPI._files.set(TB, TB_WITH_DUMP);
        const d = await resolveWaveSelection(deps, { config: { testbenchFile: TB }, simTopModule: 'tb_counter', filePaths: [TB] });
        expect(d).toMatchObject({ source: 'tb', overrideUserDumpvars: false });
    });

    it('source=wc quando o Wave Config esta customizado (valida e override)', async () => {
        const deps = makeDeps();
        window.electronAPI._files.set(SYNTH, COUNTER_V);
        window.electronAPI._files.set(TB, TB_V);
        await WaveStore.ensureRegistered('/proj', 'tb_counter', { tbPath: TB, tbModule: 'tb_counter' });
        await WaveStore.update('/proj', 'tb_counter', (cfg) => {
            cfg.wcCustomized = true;
            cfg.waveSignals = ['tb_counter.clk', 'tb_counter.bogus'];
        });
        const d = await resolveWaveSelection(deps, { config: { testbenchFile: TB }, simTopModule: 'tb_counter', filePaths: [SYNTH, TB] });
        expect(d.source).toBe('wc');
        expect(d.overrideUserDumpvars).toBe(true);
        expect(d.signalsToDump).toEqual(['tb_counter.clk']); // bogus podado
    });

    it('source=gtkw vence: varre o .gtkw ativo, valida refs e avisa de stale', async () => {
        const deps = makeDeps();
        window.electronAPI._files.set(SYNTH, COUNTER_V);
        window.electronAPI._files.set(TB, TB_V);
        const GTKW = '/proj/layout.gtkw';
        // bit-select e stripado por extractSignalRefs; bogus nao existe na hierarquia.
        window.electronAPI._files.set(GTKW, '[*] Aurora\ntb_counter.clk\ntb_counter.q[3:0]\ntb_counter.bogus\n');
        await WaveStore.ensureRegistered('/proj', 'tb_counter', { tbPath: TB, tbModule: 'tb_counter' });
        await WaveStore.update('/proj', 'tb_counter', (cfg) => {
            cfg.gtkwFiles = [{ path: GTKW, isActive: true }];
        });
        const d = await resolveWaveSelection(deps, { config: { testbenchFile: TB }, simTopModule: 'tb_counter', filePaths: [SYNTH, TB] });
        expect(d.source).toBe('gtkw');
        expect(d.overrideUserDumpvars).toBe(true);
        expect(d.signalsToDump).toEqual(['tb_counter.clk', 'tb_counter.q']); // bogus podado
        expect(warned()).toBe(true);
    });
});

describe('resolveCocotbWaveSelection (retorna a selecao — nao muta campo)', () => {
    it('retorna [] quando nao ha sinais salvos', async () => {
        const deps = makeDeps();
        const ctx = { tbKey: 'tb_counter', testbenchFile: '/proj/tb.py', testModule: 'tb', hdlTopModule: 'counter' };
        const r = await resolveCocotbWaveSelection(deps, ctx, {}, [SYNTH]);
        expect(r).toEqual([]);
    });

    it('valida e RETORNA os sinais salvos (o delegador e quem cacheia o campo)', async () => {
        const deps = makeDeps();
        window.electronAPI._files.set(SYNTH, COUNTER_V);
        window.electronAPI._files.set(TB, TB_V);
        await WaveStore.ensureRegistered('/proj', 'tb_counter', { tbPath: TB, tbModule: 'tb_counter' });
        await WaveStore.update('/proj', 'tb_counter', (cfg) => { cfg.waveSignals = ['tb_counter.clk', 'tb_counter.bogus']; });
        const ctx = { tbKey: 'tb_counter', testbenchFile: '/proj/tb.py', testModule: 'tb', hdlTopModule: 'tb_counter' };
        const r = await resolveCocotbWaveSelection(deps, ctx, {}, [SYNTH, TB]);
        expect(r).toEqual(['tb_counter.clk']); // validado contra a hierarquia
        expect(termCalls.some((c) => c.term === 'twave' && c.level === 'info')).toBe(true); // loga "wave source"
    });
});

describe('parseProjectSources', () => {
    it('null quando nao ha fontes verilog', async () => {
        const deps = makeDeps({ projectConfig: {} });
        expect(await parseProjectSources(deps)).toBeNull();
    });

    it('devolve o modules map dos .v do projeto', async () => {
        const deps = makeDeps({
            projectConfig: { synthesizableFiles: [{ path: SYNTH }], testbenchFile: TB },
        });
        window.electronAPI._files.set(SYNTH, COUNTER_V);
        window.electronAPI._files.set(TB, TB_V);
        const modules = await parseProjectSources(deps);
        expect(modules).toBeTruthy();
        expect(modules.has('counter')).toBe(true);
        expect(modules.has('tb_counter')).toBe(true);
    });

    it('inclui os .v da biblioteca HDL SAPHO (components/HDL/*.v)', async () => {
        const deps = makeDeps({ projectConfig: { synthesizableFiles: [{ path: SYNTH }] } });
        window.electronAPI._files.set(SYNTH, COUNTER_V);
        window.electronAPI._files.set('/comp/HDL/core.v', 'module core; endmodule');
        window.electronAPI._files.set('/comp/HDL/core_tb.v', 'module core_tb; endmodule'); // _tb: ignorado
        const modules = await parseProjectSources(deps);
        expect(modules.has('core')).toBe(true);      // veio do HDL, nao do .spf
        expect(modules.has('core_tb')).toBe(false);  // *_tb excluido
    });
});
