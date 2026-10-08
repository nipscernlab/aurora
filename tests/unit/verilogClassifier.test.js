import { describe, it, expect } from 'vitest';
import { classifyVerilogContent } from '../../js/project/verilog_classifier.ts';

describe('classifyVerilogContent', () => {
    it('classifies a ported RTL module as synthesizable', () => {
        const src = `
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
        `;
        expect(classifyVerilogContent(src, 'counter.v')).toBe('synthesizable');
    });

    it('classifies a portless module as testbench', () => {
        const src = `
            module tb_counter;
                reg clk = 0;
                always #5 clk = ~clk;
                counter dut (.clk(clk));
            endmodule
        `;
        expect(classifyVerilogContent(src, 'tb_counter.v')).toBe('testbench');
    });

    it('classifies on $finish / $dumpvars even with ports', () => {
        const src = `
            module harness (input clk);
                initial begin
                    $dumpfile("out.vcd");
                    $dumpvars(0, harness);
                    #100 $finish;
                end
            endmodule
        `;
        expect(classifyVerilogContent(src, 'harness.v')).toBe('testbench');
    });

    it('does not flip synthesizable RTL that has an initial reg-init block', () => {
        const src = `
            module ram (input clk, input [7:0] addr, output reg [7:0] data);
                reg [7:0] mem [0:255];
                initial $readmemh("init.hex", mem);
                always @(posedge clk) data <= mem[addr];
            endmodule
        `;
        expect(classifyVerilogContent(src, 'ram.v')).toBe('synthesizable');
    });

    it('does not count #( ) parameter overrides as procedural delays', () => {
        const src = `
            module top (input clk, output [7:0] q);
                counter #(.WIDTH(8)) u_counter (.clk(clk), .q(q));
            endmodule
        `;
        expect(classifyVerilogContent(src, 'top.v')).toBe('synthesizable');
    });

    it('ignores keywords that appear only inside comments', () => {
        const src = `
            // this testbench-looking comment mentions $finish and initial
            /* $dumpvars */
            module alu (input [3:0] a, input [3:0] b, output [3:0] y);
                assign y = a + b;
            endmodule
        `;
        expect(classifyVerilogContent(src, 'alu.v')).toBe('synthesizable');
    });

    // O caso do hits (08/10/2026): rng_xoshiro.v, rng_leap.v e
    // rng_round_robin.v conferem os parametros num initial com $display e
    // $finish. Somava 6 e virava testbench; ao abrir o projeto a Aurora
    // tirava os tres de synthesizableFiles e o iverilog parava em
    // "Unknown module type: rng_xoshiro".
    it('a verificacao de parametro num initial nao faz de RTL com portas um testbench', () => {
        const src = `
            module rng_xoshiro #(parameter [31:0] SEED0 = 1, parameter RAND_OUT_SIZE = 32) (
                input  wire clk,
                output wire [RAND_OUT_SIZE-1:0] rand_out
            );
                initial begin
                    if (SEED0 == 0) begin
                        $display("ERROR: rng_xoshiro %m has an all-zero state");
                        $finish;
                    end
                    if (RAND_OUT_SIZE > 32) begin
                        $display("ERROR: RAND_OUT_SIZE %0d > 32", RAND_OUT_SIZE);
                        $stop;
                    end
                end
                reg [31:0] s0 = SEED0;
                always @(posedge clk) s0 <= s0 ^ (s0 << 9);
                assign rand_out = s0[RAND_OUT_SIZE-1:0];
            endmodule
        `;
        expect(classifyVerilogContent(src, 'rng_xoshiro.v')).toBe('synthesizable');
    });

    it('a mesma verificacao com initial for, como no rng_round_robin.v', () => {
        const src = `
            module rng_round_robin #(parameter N_LFSR = 4) (input clk, output [31:0] r);
                integer k;
                initial for (k = 0; k < N_LFSR; k = k + 1)
                    if (0) begin $display("ERROR: rng %m has a zero SEED%0d", k); $finish; end
            endmodule
        `;
        expect(classifyVerilogContent(src, 'rng_round_robin.v')).toBe('synthesizable');
    });

    it('com portas, mas avancando o tempo ate o $finish, continua testbench', () => {
        const src = `
            module harness (input clk);
                initial begin
                    $display("inicio");
                    #500 $finish;
                end
            endmodule
        `;
        expect(classifyVerilogContent(src, 'harness.v')).toBe('testbench');
    });

    it('defaults empty / unreadable content to synthesizable', () => {
        expect(classifyVerilogContent('', 'empty.v')).toBe('synthesizable');
        expect(classifyVerilogContent(null, 'x.v')).toBe('synthesizable');
    });
});
