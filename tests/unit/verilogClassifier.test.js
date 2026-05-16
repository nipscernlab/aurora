import { describe, it, expect } from 'vitest';
import { classifyVerilogContent } from '../../js/project/verilog_classifier.js';

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

    it('defaults empty / unreadable content to synthesizable', () => {
        expect(classifyVerilogContent('', 'empty.v')).toBe('synthesizable');
        expect(classifyVerilogContent(null, 'x.v')).toBe('synthesizable');
    });
});
