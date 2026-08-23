// As regras de escopo que o pedido do usuario vira no .vlt do Verilator.
// A semantica que elas assumem (caminho completo, ultima regra vence, sem
// -levels) foi provada com build real em 22/08/2026; o que se garante aqui e
// o algoritmo: uma regra por mudanca de estado, em pre-ordem, raiz sempre
// ligada, e a leitura dos $dumpvars de um testbench.
import { describe, it, expect } from 'vitest';
import {
    verilatorTraceRules, defaultScopeRules, parseDumpvarsCalls, rulesFromDumpvars, contarEscopos,
} from '../../js/wave/verilator_trace_rules.js';

const no = (scopePath, children = [], signals = []) => ({ scopePath, children, signals: signals.map((name) => ({ name })) });

// tb
// +- proc
//    +- min (nao existe: min e array de proc, que o Verilator traca como sub-escopo)
//    +- core
//       +- sp
//       +- ula
const arvore = no('tb', [
    no('tb.proc', [
        no('tb.proc.core', [
            no('tb.proc.core.sp', [], ['pointeri', 'fl_max']),
            no('tb.proc.core.ula', [], ['delta_int']),
        ], ['pc']),
    ], ['valr2', 'req_in']),
], ['clk', 'rst']);

describe('verilatorTraceRules: selecao do picker', () => {
    it('sem selecao nao emite regra nenhuma', () => {
        expect(verilatorTraceRules(arvore, [])).toEqual([]);
        expect(verilatorTraceRules(arvore, {})).toEqual([]);
        expect(verilatorTraceRules(null, ['tb.proc.x'])).toEqual([]);
    });

    it('desliga o pai e religa o filho selecionado, nessa ordem', () => {
        expect(verilatorTraceRules(arvore, ['tb.proc.core.pc'])).toEqual([
            'tracing_off -scope "tb.proc"',
            'tracing_on -scope "tb.proc.core"',
            'tracing_off -scope "tb.proc.core.sp"',
            'tracing_off -scope "tb.proc.core.ula"',
        ]);
    });

    it('um pai selecionado mantem os filhos desligados', () => {
        expect(verilatorTraceRules(arvore, ['tb.proc.valr2'])).toEqual([
            'tracing_off -scope "tb.proc.core"',
        ]);
    });

    it('religa fundo na arvore atravessando pais desligados', () => {
        expect(verilatorTraceRules(arvore, ['tb.proc.core.ula.delta_int'])).toEqual([
            'tracing_off -scope "tb.proc"',
            'tracing_on -scope "tb.proc.core.ula"',
        ]);
    });

    it('nunca escreve regra para a raiz', () => {
        const regras = verilatorTraceRules(arvore, ['tb.clk']);
        expect(regras.some((r) => r.endsWith('"tb"'))).toBe(false);
        expect(regras).toEqual(['tracing_off -scope "tb.proc"']);
    });

    it('subtrees ligam tudo abaixo; scopes ligam so o escopo', () => {
        expect(verilatorTraceRules(arvore, { subtrees: ['tb.proc.core'] })).toEqual([
            'tracing_off -scope "tb.proc"',
            'tracing_on -scope "tb.proc.core"',
        ]);
        expect(verilatorTraceRules(arvore, { scopes: ['tb.proc.core'] })).toEqual([
            'tracing_off -scope "tb.proc"',
            'tracing_on -scope "tb.proc.core"',
            'tracing_off -scope "tb.proc.core.sp"',
            'tracing_off -scope "tb.proc.core.ula"',
        ]);
    });
});

describe('defaultScopeRules: o padrao $dumpvars(1, tb)', () => {
    it('desliga cada filho da raiz e nada mais', () => {
        expect(defaultScopeRules(arvore)).toEqual(['tracing_off -scope "tb.proc"']);
        expect(defaultScopeRules(null)).toEqual([]);
    });
});

describe('parseDumpvarsCalls', () => {
    it('le nivel e referencias de cada chamada', () => {
        const src = 'initial begin\n  $dumpfile("x.vcd");\n  $dumpvars(0, tb.clk);\n  $dumpvars(1,tb.proc , tb.proc.core);\nend';
        expect(parseDumpvarsCalls(src)).toEqual({
            bare: false,
            calls: [
                { level: 0, refs: ['tb.clk'] },
                { level: 1, refs: ['tb.proc', 'tb.proc.core'] },
            ],
        });
    });

    it('chamada sem argumentos, ou so com o nivel, significa tudo', () => {
        expect(parseDumpvarsCalls('$dumpvars;').bare).toBe(true);
        expect(parseDumpvarsCalls('$dumpvars();').bare).toBe(true);
        expect(parseDumpvarsCalls('$dumpvars(0);').bare).toBe(true);
    });
});

describe('rulesFromDumpvars: o testbench gerado pelo yanc', () => {
    it('sinais citados ligam o escopo deles; o resto desliga', () => {
        const src = [
            '$dumpvars(0,tb.clk);',
            '$dumpvars(0,tb.proc.valr2);',
            '$dumpvars(0,tb.proc.core.sp.pointeri);',
            '$dumpvars(0,tb.proc.core.ula.delta_int);',
        ].join('\n');
        expect(rulesFromDumpvars(arvore, src)).toEqual([
            'tracing_off -scope "tb.proc.core"',
            'tracing_on -scope "tb.proc.core.sp"',
            'tracing_on -scope "tb.proc.core.ula"',
        ]);
    });

    it('$dumpvars(0, escopo) liga a subarvore; (1, escopo) so o escopo', () => {
        expect(rulesFromDumpvars(arvore, '$dumpvars(0, tb.proc.core);')).toEqual([
            'tracing_off -scope "tb.proc"',
            'tracing_on -scope "tb.proc.core"',
        ]);
        expect(rulesFromDumpvars(arvore, '$dumpvars(1, tb.proc);')).toEqual([
            'tracing_off -scope "tb.proc.core"',
        ]);
    });

    it('desiste quando pede tudo ou cita o que a arvore nao conhece', () => {
        expect(rulesFromDumpvars(arvore, '$dumpvars(0, tb);')).toEqual([]);
        expect(rulesFromDumpvars(arvore, '$dumpvars;')).toEqual([]);
        expect(rulesFromDumpvars(arvore, '$dumpvars(0, tb.proc.nao_existe);')).toEqual([]);
        expect(rulesFromDumpvars(arvore, 'initial $finish;')).toEqual([]);
    });
});

describe('contarEscopos', () => {
    it('conta a partir das regras, com a raiz ligada', () => {
        const regras = verilatorTraceRules(arvore, ['tb.proc.core.ula.delta_int']);
        expect(contarEscopos(arvore, regras)).toEqual({ ligados: 2, desligados: 3 });
        expect(contarEscopos(arvore, [])).toEqual({ ligados: 5, desligados: 0 });
        expect(contarEscopos(null, [])).toEqual({ ligados: 0, desligados: 0 });
    });
});
