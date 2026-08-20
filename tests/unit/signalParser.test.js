import { describe, it, expect } from 'vitest';
import {
    parseVerilogModules,
    buildHierarchyTree,
    flattenSignalPaths,
    deriveMonitorScopes
} from '../../js/wave/signal_parser.ts';

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

    it('extracts ANSI ports with shared kind keyword (input a, b)', () => {
        // Em `module my_add(input a, b, output c)`, a vírgula entre `a`
        // e `b` separa NOMES, não declarações, ambos são input. Bug
        // anterior: split simples por `,` deixava `b` órfão (sem kind)
        // e extractSignals ignorava. Range também deve propagar:
        // `input [3:0] a, b` → ambos 4 bits.
        const files = [{
            path: 'ansi.v',
            content: `
                module my_add (
                    input  a, b,
                    input  [3:0] x, y,
                    output c
                );
                endmodule
            `,
        }];

        const { modules } = parseVerilogModules(files);
        const sigs = modules.get('my_add').signals;
        const byName = Object.fromEntries(sigs.map((s) => [s.name, s]));
        expect(Object.keys(byName).sort()).toEqual(['a', 'b', 'c', 'x', 'y']);
        expect(byName.a.kind).toBe('input');
        expect(byName.b.kind).toBe('input');
        expect(byName.x.range).toBe('3:0');
        expect(byName.y.range).toBe('3:0');
        expect(byName.c.kind).toBe('output');
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
        // a leaf with no children. This is fine, the user can still
        // pick host's own signals; the missing IP is a project setup
        // problem they'll see when iverilog complains.
        expect(tree.children).toEqual([]);
    });

    it('extractInstances pula instances dentro de `generate if`', () => {
        // Geracao condicional so elabora pra certos param values.
        // Capturar a instance como se sempre existisse faz iverilog
        // explodir com "Unable to bind" quando $dumpvars referencia
        // um path que so existe se XOR=1 (etc).
        const files = [{
            path: 'g.v',
            content: `
                module subm (input a, output b);
                endmodule

                module top (input clk);
                    generate if (COND_A) subm s_yes (clk, clk); else assign x = 0; endgenerate
                    generate if (COND_B) subm s_maybe (clk, clk); endgenerate
                    subm s_always (clk, clk);
                endmodule
            `,
        }];
        const { modules } = parseVerilogModules(files);
        const names = modules.get('top').instances.map((i) => i.instanceName).sort();
        // So a instance "sempre ativa" (fora do generate-if) sobrevive
        expect(names).toEqual(['s_always']);
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
        // essas vars sumiam do Wave Config picker, e por extensao do
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

describe('flattenSignalPaths', () => {
    // Achatar a hierarquia é o que decide QUAIS sinais a AURORA oferece para
    // dumpar. Errar aqui não dá erro: dá forma de onda com o sinal faltando, e o
    // usuário só descobre olhando. Vivia dentro do aurora_api.js, sem teste,
    // porque importar aquele arquivo inicializa a IDE inteira.
    const no = (scopePath, signals, children = []) => ({
        name: 'm', instanceName: null, scopePath,
        signals: signals.map((n) => ({ name: n })), children,
    });

    it('monta o caminho pontuado de cada sinal, na ordem da hierarquia', () => {
        const raiz = no('tb', ['clk', 'rst'], [
            no('tb.dut', ['pc'], [no('tb.dut.ula', ['a', 'b'])]),
        ]);
        expect(flattenSignalPaths(raiz)).toEqual([
            'tb.clk', 'tb.rst', 'tb.dut.pc', 'tb.dut.ula.a', 'tb.dut.ula.b',
        ]);
    });

    it('desce antes de passar para o irmao seguinte', () => {
        // A ordem importa para o usuário: é a ordem em que os sinais aparecem no
        // seletor, e ela precisa espelhar a árvore.
        const raiz = no('tb', [], [
            no('tb.a', ['x'], [no('tb.a.f', ['y'])]),
            no('tb.b', ['z']),
        ]);
        expect(flattenSignalPaths(raiz)).toEqual(['tb.a.x', 'tb.a.f.y', 'tb.b.z']);
    });

    it('aceita no sem sinais e no sem filhos', () => {
        // Os dois são normais: um módulo pode não declarar sinal nenhum, e folha
        // não tem filho. O buildHierarchyTree devolve `signals: []` justamente
        // para o módulo cujo corpo ele não achou, então uma recursão que assumisse
        // os campos presentes quebraria na primeira caixa-preta da hierarquia.
        expect(flattenSignalPaths(no('tb', []))).toEqual([]);
        expect(flattenSignalPaths({ scopePath: 'tb' })).toEqual([]);
        expect(flattenSignalPaths({ scopePath: 'tb', signals: [{ name: 'clk' }] })).toEqual(['tb.clk']);
    });

    it('devolve lista vazia para arvore ausente, em vez de lancar', () => {
        expect(flattenSignalPaths(null)).toEqual([]);
        expect(flattenSignalPaths(undefined)).toEqual([]);
    });

    it('acumula na lista que recebe, que e como os dois chamadores usam', () => {
        const fora = ['ja.estava.aqui'];
        const r = flattenSignalPaths(no('tb', ['clk']), fora);
        expect(r).toBe(fora);
        expect(fora).toEqual(['ja.estava.aqui', 'tb.clk']);
    });
});

// ─── deriveMonitorScopes ─────────────────────────────────────────────────────
//
// O contrato que importa proteger: TODO core na árvore rende exatamente os
// três escopos de monitor (sp, isp, ula), enraizados no caminho da instância —
// é o que o $dumpvars injetado usa, e um caminho errado aqui significa
// simulação sem os flags de pilha e sem o erro da ULA, silenciosamente.

describe('deriveMonitorScopes', () => {
    it('acha o core fundo na hierarquia real (tb -> wrapper -> p_tipo -> core)', () => {
        const files = [{
            path: 'all.v',
            content: `
module stack(input clk); reg fl_full; reg [3:0] fl_max; reg [3:0] pointeri; endmodule
module ula(input clk); real delta_int; real delta_float; endmodule
module core(input clk); stack sp(clk); ula ula(clk); endmodule
module cnn(input clk); core core(clk); endmodule
module cnn_wrap(input clk); cnn p_cnn(clk); endmodule
module tb; reg clk; cnn_wrap u_cnn(clk); endmodule
`,
        }];
        const { modules } = parseVerilogModules(files);
        const tree = buildHierarchyTree(modules, 'tb');
        // Espelhos: ref RELATIVA ao tb (vira o lado direito do always no
        // proprio tb) + nome deterministico + tipo da declaracao.
        expect(deriveMonitorScopes(tree)).toEqual([
            { ref: 'u_cnn.p_cnn.core.sp.pointeri', mirror: 'aurora_sp_pointeri__u_cnn_p_cnn_core', kind: 'integer' },
            { ref: 'u_cnn.p_cnn.core.sp.fl_max', mirror: 'aurora_sp_fl_max__u_cnn_p_cnn_core', kind: 'integer' },
            { ref: 'u_cnn.p_cnn.core.sp.fl_full', mirror: 'aurora_sp_fl_full__u_cnn_p_cnn_core', kind: 'reg' },
            { ref: 'u_cnn.p_cnn.core.ula.delta_int', mirror: 'aurora_ula_delta_int__u_cnn_p_cnn_core', kind: 'real' },
            { ref: 'u_cnn.p_cnn.core.ula.delta_float', mirror: 'aurora_ula_delta_float__u_cnn_p_cnn_core', kind: 'real' },
        ]);
    });

    it('NUNCA fabrica escopo que o parser nao viu (isp em generate quebrou o Icarus)', () => {
        // O caso real de 20/08: isp dentro de generate if(CAL) nao aparece no
        // parse; um $dumpvars com core.isp inventado e erro de elaboracao no
        // Icarus e derruba a compilacao inteira. So emite o que existe.
        const files = [{
            path: 'all.v',
            content: `
module stack(input clk); reg fl_full; reg [3:0] fl_max; reg [3:0] pointeri; endmodule
module core(input clk); stack sp(clk); endmodule
module tb; reg clk; core core(clk); endmodule
`,
        }];
        const { modules } = parseVerilogModules(files);
        const scopes = deriveMonitorScopes(buildHierarchyTree(modules, 'tb'));
        expect(scopes.map((s) => s.ref)).toEqual(['core.sp.pointeri', 'core.sp.fl_max', 'core.sp.fl_full']);
        const tudo = JSON.stringify(scopes);
        expect(tudo).not.toContain('isp');
        expect(tudo).not.toContain('ula');
    });

    it('multiplos processadores rendem monitores independentes', () => {
        const files = [{
            path: 'all.v',
            content: `
module stack(input clk); reg fl_full; reg [3:0] fl_max; reg [3:0] pointeri; endmodule
module ula(input clk); real delta_int; real delta_float; endmodule
module core(input clk); stack sp(clk); ula ula(clk); endmodule
module proc(input clk); core core(clk); endmodule
module tb; reg clk; proc p_a(clk); proc p_b(clk); endmodule
`,
        }];
        const { modules } = parseVerilogModules(files);
        const tree = buildHierarchyTree(modules, 'tb');
        const scopes = deriveMonitorScopes(tree);
        const refs = scopes.map((s) => s.ref);
        expect(refs).toContain('p_a.core.sp.fl_full');
        expect(refs).toContain('p_b.core.ula.delta_float');
        expect(scopes).toHaveLength(10);
        // Espelhos de procs diferentes nunca colidem em nome.
        const mirrors = scopes.map((s) => s.mirror);
        expect(new Set(mirrors).size).toBe(mirrors.length);
        expect(JSON.stringify(scopes)).not.toContain('undefined');
    });

    it('sem processador, lista vazia; arvore ausente nao lanca', () => {
        const files = [{ path: 'a.v', content: 'module tb; reg clk; endmodule' }];
        const { modules } = parseVerilogModules(files);
        expect(deriveMonitorScopes(buildHierarchyTree(modules, 'tb'))).toEqual([]);
        expect(deriveMonitorScopes(null)).toEqual([]);
    });
});
