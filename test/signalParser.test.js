import { describe, it, expect } from 'vitest';
import {
    parseVerilogModules,
    buildHierarchyTree,
} from '../js/wave/signal_parser.js';

describe('parseVerilogModules', () => {
    it('extracts a flat module with ANSI ports', () => {
        const files = [{
            path: 'counter.v',
            content: `
                module counter (
                    input  wire       clk,
                    input  wire       rst,
                    output reg  [3:0] q
                );
                    always @(posedge clk) begin
                        if (rst) q <= 4'b0;
                        else     q <= q + 1'b1;
                    end
                endmodule
            `,
        }];

        const { modules, errors } = parseVerilogModules(files);
        expect(errors).toEqual([]);
        expect(modules.has('counter')).toBe(true);

        const counter = modules.get('counter');
        const names = counter.signals.map((s) => s.name).sort();
        expect(names).toEqual(['clk', 'q', 'rst']);

        const q = counter.signals.find((s) => s.name === 'q');
        expect(q.kind).toBe('output');
        expect(q.range).toBe('3:0');
    });

    it('handles non-ANSI port style with separate input/output declarations', () => {
        const files = [{
            path: 'adder.v',
            content: `
                module adder (a, b, sum);
                    input  [3:0] a;
                    input  [3:0] b;
                    output [3:0] sum;
                    assign sum = a + b;
                endmodule
            `,
        }];

        const { modules } = parseVerilogModules(files);
        const adder = modules.get('adder');
        const names = adder.signals.map((s) => s.name).sort();
        expect(names).toEqual(['a', 'b', 'sum']);
    });

    it('strips block and line comments before parsing', () => {
        const files = [{
            path: 'commented.v',
            content: `
                /* module fake (input bogus); endmodule */
                module real (input wire x);
                    // wire fake_signal;
                    wire real_signal;
                endmodule
            `,
        }];

        const { modules } = parseVerilogModules(files);
        expect(modules.has('fake')).toBe(false);
        expect(modules.has('real')).toBe(true);
        const names = modules.get('real').signals.map((s) => s.name).sort();
        expect(names).toEqual(['real_signal', 'x']);
    });

    it('extracts comma-separated multi-name declarations', () => {
        const files = [{
            path: 'multi.v',
            content: `
                module multi;
                    wire a, b, c;
                    reg [7:0] x, y;
                endmodule
            `,
        }];

        const { modules } = parseVerilogModules(files);
        const names = modules.get('multi').signals.map((s) => s.name).sort();
        expect(names).toEqual(['a', 'b', 'c', 'x', 'y']);
    });

    it('detects module instantiations and skips behavioural keywords', () => {
        const files = [
            {
                path: 'tb.v',
                content: `
                    module tb_counter;
                        reg clk = 0;
                        reg rst = 1;
                        wire [3:0] q;
                        counter dut (.clk(clk), .rst(rst), .q(q));
                        always #5 clk = ~clk;
                        initial begin
                            #20 rst = 0;
                            #200 $finish;
                        end
                    endmodule
                `,
            },
            {
                path: 'counter.v',
                content: 'module counter (input clk, rst, output [3:0] q); endmodule',
            },
        ];

        const { modules } = parseVerilogModules(files);
        const tb = modules.get('tb_counter');
        expect(tb.instances).toHaveLength(1);
        expect(tb.instances[0]).toMatchObject({
            instanceName: 'dut',
            moduleType: 'counter',
        });
    });

    it('flags duplicate module names as a soft error', () => {
        const files = [
            { path: 'a.v', content: 'module dup; endmodule' },
            { path: 'b.v', content: 'module dup; endmodule' },
        ];

        const { errors } = parseVerilogModules(files);
        expect(errors).toEqual([
            { file: 'b.v', message: 'Duplicate module name: dup' },
        ]);
    });

    it('does not mistake function calls for instantiations', () => {
        const files = [{
            path: 'f.v',
            content: `
                module foo;
                    initial $display("hi");
                    initial $monitor("x = %d", x);
                endmodule
            `,
        }];

        const { modules } = parseVerilogModules(files);
        // Even though $display "looks like" an instance to a naive scan,
        // it's not in the known-modules set, so it's correctly skipped.
        expect(modules.get('foo').instances).toEqual([]);
    });
});

describe('buildHierarchyTree', () => {
    const counterFiles = [
        {
            path: 'counter.v',
            content: `
                module counter (
                    input  wire       clk,
                    input  wire       rst,
                    output reg  [3:0] q
                );
                endmodule
            `,
        },
        {
            path: 'tb_counter.v',
            content: `
                module tb_counter;
                    reg clk = 0;
                    reg rst = 1;
                    wire [3:0] q;
                    counter dut (.clk(clk), .rst(rst), .q(q));
                endmodule
            `,
        },
    ];

    it('builds a two-level tree from testbench → DUT', () => {
        const { modules } = parseVerilogModules(counterFiles);
        const tree = buildHierarchyTree(modules, 'tb_counter');

        expect(tree.name).toBe('tb_counter');
        expect(tree.scopePath).toBe('tb_counter');
        expect(tree.children).toHaveLength(1);

        const dut = tree.children[0];
        expect(dut.name).toBe('counter');
        expect(dut.instanceName).toBe('dut');
        expect(dut.scopePath).toBe('tb_counter.dut');
        expect(dut.signals.map((s) => s.name).sort()).toEqual(['clk', 'q', 'rst']);
    });

    it('tolerates unknown module types as leaves', () => {
        const files = [{
            path: 'host.v',
            content: `
                module host;
                    external_ip u_ip ();
                endmodule
            `,
        }];
        const { modules } = parseVerilogModules(files);
        const tree = buildHierarchyTree(modules, 'host');
        // external_ip isn't declared anywhere, so the instance is dropped
        // (extractInstances filters by known names). The tree degrades to
        // a leaf with no children. This is fine — the user can still
        // pick host's own signals; the missing IP is a project setup
        // problem they'll see when iverilog complains.
        expect(tree.children).toEqual([]);
    });

    it('extractInstances lida com #(...) com parens aninhados + `ifdef no meio', () => {
        // Bug observado em ProcDTW.v: regex non-greedy `#\(.*?\)`
        // emparelhava `processor` (instancia parametrizada) com
        // `dec_in` (instancia diferente abaixo), saltando p_ProcDTW
        // que estava entre `ifdef/`endif. stripParamLists +
        // stripDirectives + dedup corrigem.
        const files = [{
            path: 'simple.v',
            content: `
                module addr_dec (input a, output b);
                endmodule

                module processor (input clk);
                endmodule

                module ProcDTW (input clk);
                    processor #(.WIDTH(32), .FILE("path/with(paren).txt"))
                    \`ifdef SIM
                    p_inst (clk);
                    \`else
                    p_inst (clk);
                    \`endif

                    addr_dec #(3) dec_in (clk, clk);
                    addr_dec #(3) dec_out(clk, clk);
                endmodule
            `,
        }];
        const { modules } = parseVerilogModules(files);
        const procDtwInstances = modules.get('ProcDTW').instances;
        const names = procDtwInstances.map((i) => i.instanceName + '(' + i.moduleType + ')').sort();
        // 3 instancias com tipos corretos, sem confusao entre elas
        expect(names).toEqual([
            'dec_in(addr_dec)',
            'dec_out(addr_dec)',
            'p_inst(processor)',
        ]);
    });

    it('captura tipos non-synth: real (C± float), integer, time', () => {
        // O .v gerado pelo asmcomp declara C± float como `real foo = 0.0;`.
        // Antes, signal_parser nao reconhecia `real` como kind, entao
        // essas vars sumiam do Wave Config picker — e por extensao do
        // $dumpvars, VCD, e .gtkw final. Mesma coisa pra `integer` e
        // `time`.
        const files = [{
            path: 'proc.v',
            content: `
                module proc;
                    real    me2_f_global_v_x_e_ = 0.0;
                    integer me1_f_global_v_count_e_;
                    time    me1_f_global_v_now_e_;
                endmodule
            `,
        }];
        const { modules } = parseVerilogModules(files);
        const names = modules.get('proc').signals.map((s) => s.name).sort();
        expect(names).toContain('me2_f_global_v_x_e_');
        expect(names).toContain('me1_f_global_v_count_e_');
        expect(names).toContain('me1_f_global_v_now_e_');

        const x = modules.get('proc').signals.find((s) => s.name === 'me2_f_global_v_x_e_');
        expect(x.kind).toBe('real');
    });
});
