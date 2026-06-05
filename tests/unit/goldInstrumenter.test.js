import { describe, it, expect } from 'vitest';
import {
    findDutInstance,
    instrumentGoldTestbench,
    parseKvDump,
    compareKvDumps,
    hashInputs,
} from '../../js/wave/gold_instrumenter.js';

// Espelha a forma do top_level_tb.v (teste345): saidas conectadas a wires de
// mesmo nome, mais uma instancia COMENTADA que nao deve contar.
const TB = `
\`timescale 1ns/1ps
module top_level_tb();
    reg clk, rst_geral, rst_proc;
    reg signed [15:0] data = 0;
    wire signed [31:0] out0, out1, out0_DTW;
    wire empty;
    always #2 clk <= ~clk;
    // FIFO16x32 FIFO16x32_inst ( .clock(clk) );   // comentada: nao conta
    top_level dut (
        .data(data),
        .clk(clk),
        .rst_geral(rst_geral),
        .rst_proc(rst_proc),
        .out0(out0),
        .out1(out1),
        .out0_DTW(out0_DTW),
        .empty(empty)
    );
    initial begin #100 $finish; end
endmodule
`;

describe('findDutInstance', () => {
    it('finds the instance name and port->expr connections', () => {
        const r = findDutInstance(TB, 'top_level');
        expect(r).not.toBeNull();
        expect(r.instName).toBe('dut');
        expect(r.conns.get('out0')).toBe('out0');
        expect(r.conns.get('clk')).toBe('clk');
        expect(r.conns.get('out0_DTW')).toBe('out0_DTW');
    });

    it('ignores a commented-out instance', () => {
        // se a regex pegasse o comentario, instName seria FIFO16x32_inst
        const r = findDutInstance(TB, 'top_level');
        expect(r.instName).toBe('dut');
    });

    it('returns null when the module is not instantiated', () => {
        expect(findDutInstance(TB, 'nonexistent_module')).toBeNull();
    });
});

describe('instrumentGoldTestbench', () => {
    it('injects a final block dumping the connected output ports by name', () => {
        const { content, dumped } = instrumentGoldTestbench({
            src: TB,
            topModule: 'top_level',
            outPorts: ['out0', 'out1', 'out0_DTW', 'empty', 'unconnected_out'],
            goldFile: 'aurora_gold.txt',
        });
        // so as portas conectadas entram (unconnected_out fica de fora)
        expect(dumped).toEqual(['out0', 'out1', 'out0_DTW', 'empty']);
        expect(content).toContain('final begin');
        expect(content).toContain('$fopen("aurora_gold.txt", "w")');
        expect(content).toContain('$fwrite(__aurora_gold_fd, "out0=%0d\\n", out0);');
        expect(content).toContain('$fwrite(__aurora_gold_fd, "empty=%0d\\n", empty);');
        expect(content).not.toContain('unconnected_out');
        // injetado ANTES do endmodule
        expect(content.indexOf('final begin')).toBeLessThan(content.lastIndexOf('endmodule'));
    });

    it('throws when the DUT instance is absent', () => {
        expect(() => instrumentGoldTestbench({
            src: 'module tb; initial $finish; endmodule',
            topModule: 'top_level', outPorts: ['out0'], goldFile: 'g.txt',
        })).toThrow(/instance/i);
    });

    it('throws when no output port is connected', () => {
        expect(() => instrumentGoldTestbench({
            src: TB, topModule: 'top_level', outPorts: ['none_a', 'none_b'], goldFile: 'g.txt',
        })).toThrow(/connected output/i);
    });
});

describe('parseKvDump / compareKvDumps', () => {
    it('parses name=value lines', () => {
        const m = parseKvDump('out0=1\nout1=-127\n\n out0_DTW = 36000 ');
        expect(m.get('out0')).toBe('1');
        expect(m.get('out1')).toBe('-127');
        expect(m.get('out0_DTW')).toBe('36000');
    });

    it('ok when all common keys match', () => {
        const r = compareKvDumps('out0=1\nout1=2\nempty=0', 'out0=1\nout1=2\nextra=9');
        expect(r.ok).toBe(true);
        expect(r.common).toBe(2); // out0, out1 (empty/extra nao sao comuns)
        expect(r.diffs).toEqual([]);
    });

    it('reports diffs and is not ok when a common key differs', () => {
        const r = compareKvDumps('out0=1\nout1=2', 'out0=1\nout1=99');
        expect(r.ok).toBe(false);
        expect(r.diffs).toEqual([{ name: 'out1', ref: '2', got: '99' }]);
    });

    it('not ok when there are no common keys', () => {
        expect(compareKvDumps('a=1', 'b=2').ok).toBe(false);
    });
});

describe('hashInputs', () => {
    it('is deterministic and 8 hex chars', () => {
        const a = hashInputs(['tb', 'harness', 'srcA']);
        expect(a).toMatch(/^[0-9a-f]{8}$/);
        expect(hashInputs(['tb', 'harness', 'srcA'])).toBe(a);
    });

    it('changes when any part changes', () => {
        const base = hashInputs(['tb', 'harness', 'srcA']);
        expect(hashInputs(['tb2', 'harness', 'srcA'])).not.toBe(base);
        expect(hashInputs(['tb', 'harness2', 'srcA'])).not.toBe(base);
        expect(hashInputs(['tb', 'harness', 'srcB'])).not.toBe(base);
    });

    it('is sensitive to part boundaries (length-prefixed)', () => {
        expect(hashInputs(['ab', 'c'])).not.toBe(hashInputs(['a', 'bc']));
    });
});
