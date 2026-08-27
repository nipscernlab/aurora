import { describe, it, expect } from 'vitest';
import {
    instrumentTestbenchSource,
} from '../../js/wave/testbench_instrumenter.ts';

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
        // Two modules in one file, instrumentation goes in the second
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
        // Helper's endmodule appears before the injection, proving the
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

// ─── monitores do processador no $dumpvars ───────────────────────────────────
describe('instrumentTestbenchSource: monitorScopes', () => {
    const tb = 'module tb; reg clk; endmodule\n';

    it('injeta o dumpvars dos monitores junto do principal', () => {
        const r = instrumentTestbenchSource({
            originalContent: tb,
            tbModule: 'tb',
            selectedSignals: ['tb.u.sig'],
            monitorScopes: [
                { ref: 'u.p_x.core.sp.fl_max', mirror: 'aurora_sp_fl_max__u_p_x_core', kind: 'integer' },
                { ref: 'u.p_x.core.ula.delta_int', mirror: 'aurora_ula_delta_int__u_p_x_core', kind: 'real' },
            ],
        });
        expect(r.needsWrite).toBe(true);
        expect(r.content).toContain('$dumpvars(0, tb.u.sig);');
        // Declaracoes-espelho no corpo do modulo + a lista deles no dumpvars.
        expect(r.content).toContain(
            'integer aurora_sp_fl_max__u_p_x_core; always @ (*) aurora_sp_fl_max__u_p_x_core = u.p_x.core.sp.fl_max;',
        );
        expect(r.content).toContain(
            'real aurora_ula_delta_int__u_p_x_core; always @ (*) aurora_ula_delta_int__u_p_x_core = u.p_x.core.ula.delta_int;',
        );
        expect(r.content).toContain(
            '$dumpvars(0, aurora_sp_fl_max__u_p_x_core, aurora_ula_delta_int__u_p_x_core); // SAPHO stack/ULA monitors',
        );
    });

    it('sem monitores, o bloco fica exatamente como era', () => {
        const r = instrumentTestbenchSource({
            originalContent: tb,
            tbModule: 'tb',
            selectedSignals: [],
        });
        expect(r.content).not.toContain('SAPHO stack/ULA monitors');
    });

    it('dump do usuario continua intocado mesmo com monitores', () => {
        const userTb = 'module tb; initial begin $dumpfile("x.vcd"); $dumpvars(0, tb); end endmodule\n';
        const r = instrumentTestbenchSource({
            originalContent: userTb,
            tbModule: 'tb',
            monitorScopes: [{ ref: 'p.core.sp.fl_full', mirror: 'aurora_sp_fl_full__p_core', kind: 'reg' }],
        });
        expect(r.needsWrite).toBe(false);
    });
});
