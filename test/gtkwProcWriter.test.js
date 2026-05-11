import { describe, it, expect } from 'vitest';
import {
    detectProcessors,
    buildAuroraGtkw,
} from '../js/wave/gtkw_proc_writer.js';

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

    it('extrai procType do sub-scope p_<X>.core quando existe', () => {
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

    it('cai pro testbench top como procType quando p_<X>.core nao existe', () => {
        const scopes = [
            scope('ProcDTW_tb.proc', [
                { name: 'valr2' }, { name: 'linetabs' },
            ]),
        ];
        const procs = detectProcessors(scopes);
        expect(procs[0].procType).toBe('ProcDTW');
        expect(procs[0].corePath).toBeNull();
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
});
