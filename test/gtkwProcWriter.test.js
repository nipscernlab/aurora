import { describe, it, expect } from 'vitest';
import {
    detectProcessors,
    buildAuroraGtkw,
    buildSignedSet,
} from '../js/wave/gtkw_proc_writer.js';
import { parseVerilogModules } from '../js/wave/signal_parser.js';

/**
 * Scope shape esperado pelos helpers — espelha o que o vcd_parser
 * entrega: { name, path, signals: [{ name, width, range, type }, ...] }.
 */
function scope(path, signals) {
    return {
        name: path.split('.').pop(),
        path,
        signals: signals.map((s) => ({
            name: s.name,
            width: s.width ?? 1,
            range: s.range ?? null,
            type: s.type ?? 'wire',
        })),
    };
}

describe('detectProcessors', () => {
    it('reconhece um proc pelo par valr2 + linetabs', () => {
        const scopes = [
            scope('tb', [{ name: 'clk' }]),
            scope('tb.proc', [
                { name: 'valr2', width: 32, range: '31:0' },
                { name: 'linetabs', width: 16, range: '15:0' },
            ]),
        ];
        const procs = detectProcessors(scopes);
        expect(procs).toHaveLength(1);
        expect(procs[0]).toMatchObject({
            instancePath: 'tb.proc',
            instanceName: 'proc',
        });
    });

    it('extrai procType do sub-scope p_<X>.core quando existe (padrao SAPHO antigo)', () => {
        const scopes = [
            scope('tb.proc', [
                { name: 'valr2' }, { name: 'linetabs' },
            ]),
            scope('tb.proc.p_ProcDTW.core', [{ name: 'clk' }]),
        ];
        const procs = detectProcessors(scopes);
        expect(procs[0].procType).toBe('ProcDTW');
        expect(procs[0].corePath).toBe('tb.proc.p_ProcDTW.core');
    });

    it('extrai procType do parent _inst quando scope com valr2 ja eh o core (padrao SAPHO atual)', () => {
        // Cenario tipico no teste345: o scope com valr2/linetabs e o core
        // do processador, e o parent e o wrapper "<Proc>_inst".
        const scopes = [
            scope('top_level_tb.top_level_inst.ProcDTWv4_inst.DTWv4_inst', [
                { name: 'valr2' }, { name: 'linetabs' },
            ]),
        ];
        const procs = detectProcessors(scopes);
        expect(procs[0].procType).toBe('ProcDTWv4');
        expect(procs[0].corePath).toBe('top_level_tb.top_level_inst.ProcDTWv4_inst.DTWv4_inst');
    });

    it('cai pro testbench top como procType quando p_<X>.core nao existe (fallback historico)', () => {
        // Projeto antigo com um so processador: tb chama-se "<proc>_tb",
        // e o scope direto do proc tem valr2/linetabs sem parent _inst.
        const scopes = [
            scope('ProcDTW_tb.proc', [
                { name: 'valr2' }, { name: 'linetabs' },
            ]),
        ];
        const procs = detectProcessors(scopes);
        expect(procs[0].procType).toBe('ProcDTW');
    });

    it('retorna lista vazia quando nada bate', () => {
        const scopes = [scope('tb', [{ name: 'clk' }])];
        expect(detectProcessors(scopes)).toEqual([]);
    });
});

describe('buildAuroraGtkw', () => {
    it('emite secao top-level com todos sinais nao-processador', () => {
        // Projeto puramente verilog (zero processadores) — esperamos
        // so a secao top-level com tudo flat.
        const scopes = [
            scope('tb', [
                { name: 'clk' },
                { name: 'rst' },
                { name: 'q', width: 4, range: '3:0' },
            ]),
            scope('tb.dut', [{ name: 'state', width: 2, range: '1:0' }]),
        ];
        const { content, processorCount } = buildAuroraGtkw({
            vcdPath: 'C:/tmp/tb.vcd',
            gtkwPath: 'C:/tmp/tb.gtkw',
            scopes,
        });
        expect(processorCount).toBe(0);
        expect(content).toContain('[dumpfile] "C:/tmp/tb.vcd"');
        expect(content).toContain('###### Top-level');
        // Todos os sinais (top + submodule) aparecem
        expect(content).toContain('tb.clk');
        expect(content).toContain('tb.rst');
        expect(content).toContain('tb.q[3:0]');
        expect(content).toContain('tb.dut.state[1:0]');
    });

    it('combina secao top-level com secao do processador', () => {
        const scopes = [
            scope('tb', [{ name: 'clk' }, { name: 'rst' }]),
            scope('tb.proc', [
                { name: 'valr2' }, { name: 'linetabs' },
            ]),
        ];
        const { content, processorCount } = buildAuroraGtkw({
            vcdPath: 'C:/tmp/tb.vcd',
            gtkwPath: 'C:/tmp/tb.gtkw',
            scopes,
        });
        expect(processorCount).toBe(1);
        // Top-level antes da secao do proc
        expect(content.indexOf('###### Top-level')).toBeLessThan(
            content.indexOf('Instructions ****'),
        );
        // Top-level tem clk/rst, NAO tem sinais dentro de tb.proc
        const topLevelPart = content.slice(0, content.indexOf('Instructions'));
        expect(topLevelPart).toContain('tb.clk');
        expect(topLevelPart).toContain('tb.rst');
        expect(topLevelPart).not.toContain('tb.proc.valr2');
    });

    it('filter restringe a emissao a sinais selecionados', () => {
        const scopes = [
            scope('tb', [{ name: 'clk' }, { name: 'rst' }, { name: 'enable' }]),
        ];
        const { content } = buildAuroraGtkw({
            vcdPath: 'a', gtkwPath: 'b',
            scopes,
            selectedSignals: ['tb.clk'],
        });
        expect(content).toContain('tb.clk');
        expect(content).not.toContain('tb.rst');
        expect(content).not.toContain('tb.enable');
    });

    it('retorna content=null quando scopes esta vazio', () => {
        expect(buildAuroraGtkw({
            vcdPath: 'a', gtkwPath: 'b', scopes: [],
        })).toEqual({ content: null, processorCount: 0 });
    });

    it('usa FMT_SIGNED_DEC pra bus signed e FMT_DEC pra unsigned', () => {
        const scopes = [
            scope('tb', [
                { name: 'clk' },                               // 1-bit → FMT_BIN (0x28)
                { name: 'count', width: 8, range: '7:0' },     // bus unsigned → FMT_DEC (0x24)
                { name: 'delta', width: 8, range: '7:0' },     // bus signed → FMT_SIGNED_DEC (0x420)
            ]),
        ];
        const signedSet = new Set(['tb.delta']);
        const { content } = buildAuroraGtkw({
            vcdPath: 'a', gtkwPath: 'b', scopes, signedSet,
        });
        // clk vem antes, com FMT_BIN
        expect(content).toMatch(/@28\b[\s\S]*?tb\.clk/);
        // count vem depois com FMT_DEC (0x24)
        expect(content).toMatch(/@24\b[\s\S]*?tb\.count\[7:0\]/);
        // delta vem com FMT_SIGNED_DEC (0x420)
        expect(content).toMatch(/@420\b[\s\S]*?tb\.delta\[7:0\]/);
    });
});

describe('buildSignedSet', () => {
    it('marca sinais signed do source verilog', () => {
        const { modules } = parseVerilogModules([{
            path: 'foo.v',
            content: `
                module foo (
                    input wire clk,
                    output reg signed [7:0] delta,
                    output reg [7:0] count
                );
                endmodule
            `,
        }]);
        const scopes = [scope('foo', [
            { name: 'clk' },
            { name: 'delta', range: '7:0' },
            { name: 'count', range: '7:0' },
        ])];
        const set = buildSignedSet(scopes, modules);
        expect(set.has('foo.delta')).toBe(true);
        expect(set.has('foo.count')).toBe(false);
        expect(set.has('foo.clk')).toBe(false);
    });

    it('resolve module de sub-instancias via instances[]', () => {
        const { modules } = parseVerilogModules([{
            path: 'd.v',
            content: `
                module child (
                    output reg signed [3:0] s,
                    output reg [3:0] u
                );
                endmodule

                module parent (input wire clk);
                    child c_inst ();
                endmodule
            `,
        }]);
        const scopes = [
            scope('parent', [{ name: 'clk' }]),
            scope('parent.c_inst', [
                { name: 's', range: '3:0' },
                { name: 'u', range: '3:0' },
            ]),
        ];
        const set = buildSignedSet(scopes, modules);
        expect(set.has('parent.c_inst.s')).toBe(true);
        expect(set.has('parent.c_inst.u')).toBe(false);
    });

    it('devolve Set vazio se modules e vazio ou nulo', () => {
        const scopes = [scope('tb', [{ name: 'clk' }])];
        expect(buildSignedSet(scopes, new Map())).toEqual(new Set());
        expect(buildSignedSet(scopes, null)).toEqual(new Set());
    });
});
