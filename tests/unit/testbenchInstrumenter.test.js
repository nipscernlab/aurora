import { describe, it, expect } from 'vitest';
import {
    instrumentTestbenchSource,
    mayRunForever,
    hasFreeRunningClock,
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

// A simulacao que nao termina. Nao ha timeout em lugar nenhum do caminho de
// simulacao (vvp e o binario do Verilator sao spawnados sem limite), entao um
// testbench com clock livre e sem $finish roda ate a pessoa apertar Cancelar.
// O aviso so vale quando as DUAS coisas acontecem: gerador livre de eventos e
// nenhum $finish/$stop. Sozinha, a falta de $finish nao e problema nenhum.
describe('mayRunForever: clock livre sem $finish', () => {
    const CLOCK_LIVRE = `
module tb;
    reg clk = 0;
    always #5 clk = ~clk;
    initial begin
        #100;
    end
endmodule`;

    it('clock livre e sem $finish: pode rodar para sempre', () => {
        expect(mayRunForever(CLOCK_LIVRE)).toBe(true);
    });

    it('com $finish, termina', () => {
        expect(mayRunForever(CLOCK_LIVRE.replace('#100;', '#100 $finish;'))).toBe(false);
    });

    it('com $stop, tambem termina', () => {
        expect(mayRunForever(CLOCK_LIVRE.replace('#100;', '#100 $stop;'))).toBe(false);
    });

    it('$finish so em comentario nao conta', () => {
        expect(mayRunForever(CLOCK_LIVRE.replace('#100;', '#100; // lembrar do $finish'))).toBe(true);
        expect(mayRunForever(CLOCK_LIVRE.replace('#100;', '#100; /* $finish */'))).toBe(true);
    });

    it('$finish dentro de uma string de $display nao conta', () => {
        const src = CLOCK_LIVRE.replace('#100;', '#100 $display("chame $finish aqui");');
        expect(mayRunForever(src)).toBe(true);
    });

    it('sem gerador livre, o testbench termina sozinho: nada a avisar', () => {
        const semClock = `
module tb;
    reg a = 0;
    initial begin
        #10 a = 1;
        #10 a = 0;
    end
endmodule`;
        expect(mayRunForever(semClock)).toBe(false);
        expect(hasFreeRunningClock(semClock)).toBe(false);
    });

    it('always @(posedge clk) nao e gerador livre: so acorda quando o clk mexe', () => {
        const so_sensivel = `
module tb;
    reg clk = 0;
    always @(posedge clk) $display("tick");
    initial #50 clk = 1;
endmodule`;
        expect(hasFreeRunningClock(so_sensivel)).toBe(false);
    });

    it('as outras grafias do gerador: always begin #, e forever', () => {
        expect(hasFreeRunningClock('always begin #5 clk = ~clk; end')).toBe(true);
        expect(hasFreeRunningClock('initial forever #5 clk = ~clk;')).toBe(true);
        expect(hasFreeRunningClock('always\n  #10 clk <= !clk;')).toBe(true);
    });

    it('o resultado da instrumentacao carrega a flag, nos tres caminhos', () => {
        const flag = (src) => instrumentTestbenchSource({ originalContent: src, tbModule: 'tb' }).mayRunForever;
        expect(flag(CLOCK_LIVRE)).toBe(true);                                  // auto
        expect(flag(CLOCK_LIVRE.replace('#100;', '#100 $finish;'))).toBe(false);
        // user-defined: tem $dumpvars proprio e ainda assim nao termina
        expect(flag(CLOCK_LIVRE.replace('#100;', '$dumpvars(0, tb); #100;'))).toBe(true);
        // malformed: sem endmodule, a flag ainda sai
        expect(flag(CLOCK_LIVRE.replace('endmodule', ''))).toBe(true);
    });
});
