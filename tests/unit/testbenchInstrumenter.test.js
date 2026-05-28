import { describe, it, expect } from 'vitest';
import {
    instrumentTestbenchSource,
    stripVerilatorIncompatibleLines,
} from '../../js/wave/testbench_instrumenter.js';

const TB_WITH_DUMP = `
module tb_counter;
    reg clk = 0;
    initial begin
        $dumpfile("tb_counter.vcd");
        $dumpvars(0, tb_counter);
        #100 $finish;
    end
endmodule
`;

const TB_WITHOUT_DUMP = `
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
`;

describe('instrumentTestbenchSource', () => {
    it('leaves user testbenches alone when $dumpfile is already present', () => {
        const r = instrumentTestbenchSource({
            originalContent: TB_WITH_DUMP,
            tbModule: 'tb_counter',
        });
        expect(r.needsWrite).toBe(false);
        expect(r.reason).toBe('user-defined');
        expect(r.content).toBe(TB_WITH_DUMP);
    });

    it('leaves the file alone when only $dumpvars is present (without $dumpfile)', () => {
        const r = instrumentTestbenchSource({
            originalContent: '$dumpvars(0, tb);\nmodule tb; endmodule',
            tbModule: 'tb',
        });
        expect(r.needsWrite).toBe(false);
        expect(r.reason).toBe('user-defined');
    });

    it('injects depth-1 dumpvars on the testbench module by default', () => {
        const r = instrumentTestbenchSource({
            originalContent: TB_WITHOUT_DUMP,
            tbModule: 'tb_counter',
        });
        expect(r.needsWrite).toBe(true);
        expect(r.reason).toBe('auto');
        expect(r.content).toContain('$dumpfile("tb_counter.vcd")');
        expect(r.content).toContain('$dumpvars(1, tb_counter)');
    });

    it('uses depth-0 with explicit signals when picker selection is non-empty', () => {
        const r = instrumentTestbenchSource({
            originalContent: TB_WITHOUT_DUMP,
            tbModule: 'tb_counter',
            selectedSignals: ['tb_counter.dut.q_next', 'tb_counter.clk'],
        });
        expect(r.needsWrite).toBe(true);
        expect(r.reason).toBe('auto-selection');
        expect(r.content).toContain('$dumpvars(0, tb_counter.dut.q_next, tb_counter.clk)');
        // The default depth-1 form must NOT appear when a selection is in play.
        expect(r.content).not.toContain('$dumpvars(1, tb_counter)');
    });

    it('inserts the injection block before the LAST endmodule', () => {
        // Two modules in one file — instrumentation goes in the second
        // (testbench) module, not the first.
        const src = `
            module helper;
                wire x;
            endmodule

            module tb_counter;
                reg clk = 0;
                initial #10 $finish;
            endmodule
        `;
        const r = instrumentTestbenchSource({
            originalContent: src,
            tbModule: 'tb_counter',
        });
        expect(r.needsWrite).toBe(true);
        const helperEnd = r.content.indexOf('endmodule');
        const injection = r.content.indexOf('AURORA AUTO-INSTRUMENTATION');
        // Helper's endmodule appears before the injection — proving the
        // injection landed inside tb_counter, not before helper.
        expect(helperEnd).toBeLessThan(injection);
    });

    it('returns the original unchanged when there is no endmodule', () => {
        const r = instrumentTestbenchSource({
            originalContent: 'module tb;\n    reg x;\n',  // no endmodule
            tbModule: 'tb',
        });
        expect(r.needsWrite).toBe(false);
        expect(r.reason).toBe('malformed');
        expect(r.content).toBe('module tb;\n    reg x;\n');
    });
});

// Replica do bloco que o asmcomp do yanc emite no _tb.v
// (hdl.c:697-701). Manter EXATO — se yanc mudar o handler, o regex
// nao casa e Verilator volta a falhar.
const ASMCOMP_VALR10_BLOCK =
`always @ (posedge clk) if (proc.valr10 == 123) begin
    $display("Info: end of program!");
    $fclose(progress);
    $finish;
end
`;

describe('stripVerilatorIncompatibleLines', () => {
    it('remove o handler proc.valr10 gerado pelo asmcomp', () => {
        const src = `module tb;\n${ASMCOMP_VALR10_BLOCK}\nendmodule\n`;
        const out = stripVerilatorIncompatibleLines(src);
        // O bloco always inteiro tem que sair (a string "proc.valr10"
        // ainda aparece dentro do comentario de substituicao — checamos
        // pela ausencia do CODIGO, nao da string solta).
        expect(out).not.toMatch(/always\s*@\s*\(\s*posedge\s+clk\s*\)\s*if\s*\(\s*proc\.valr10/);
        expect(out).not.toContain('$fclose(progress)');
        // Comentario de Aurora marca o local da remocao.
        expect(out).toContain('Aurora workaround');
    });

    it('NAO trunca o bloco no "end" dentro da string "end of program"', () => {
        // Bug que motivou o teste: o regex antigo `\\bend\\b` casava com a
        // palavra "end" dentro do $display("Info: end of program!"),
        // cortando o match no meio e quebrando o source.
        const src = `module tb;\n${ASMCOMP_VALR10_BLOCK}\nendmodule\n`;
        const out = stripVerilatorIncompatibleLines(src);
        // Resto do source intacto (o `endmodule` que vinha DEPOIS do
        // bloco tem que estar presente).
        expect(out).toContain('endmodule');
        // E o $fclose, $finish — que ficavam orfaos com o bug — somem
        // junto com o bloco.
        expect(out).not.toContain('$fclose');
        expect(out).not.toContain('$finish');
    });

    it('e idempotente (chamar 2x = chamar 1x)', () => {
        const src = `module tb;\n${ASMCOMP_VALR10_BLOCK}\nendmodule\n`;
        const once = stripVerilatorIncompatibleLines(src);
        const twice = stripVerilatorIncompatibleLines(once);
        expect(twice).toBe(once);
    });

    it('deixa testbench sem o bloco inalterado', () => {
        const src = `module tb;\n    reg clk = 0;\n    initial #10 $finish;\nendmodule\n`;
        expect(stripVerilatorIncompatibleLines(src)).toBe(src);
    });
});
