// As regras de escopo que a selecao do picker vira no .vlt do Verilator.
// A semantica que elas assumem (caminho completo, ultima regra vence, sem
// -levels) foi provada com build real em 22/08/2026; o que se garante aqui e
// o algoritmo: uma regra por mudanca de estado, em pre-ordem, raiz sempre
// ligada.
import { describe, it, expect } from 'vitest';
import { verilatorTraceRules, contarEscopos } from '../../js/wave/verilator_trace_rules.js';

const no = (scopePath, children = []) => ({ scopePath, children });

// tb
// +- proc
//    +- min
//    +- core
//       +- sp
//       +- ula
const arvore = no('tb', [
    no('tb.proc', [
        no('tb.proc.min'),
        no('tb.proc.core', [no('tb.proc.core.sp'), no('tb.proc.core.ula')]),
    ]),
]);

describe('verilatorTraceRules', () => {
    it('sem selecao nao emite regra nenhuma: o dump fica como o Verilator faz', () => {
        expect(verilatorTraceRules(arvore, [])).toEqual([]);
        expect(verilatorTraceRules(null, ['tb.proc.x'])).toEqual([]);
    });

    it('desliga o pai e religa o filho selecionado, nessa ordem', () => {
        expect(verilatorTraceRules(arvore, ['tb.proc.min.acc'])).toEqual([
            'tracing_off -scope "tb.proc"',
            'tracing_on -scope "tb.proc.min"',
        ]);
    });

    it('um pai selecionado mantem os filhos desligados um a um', () => {
        expect(verilatorTraceRules(arvore, ['tb.proc.clk'])).toEqual([
            'tracing_off -scope "tb.proc.min"',
            'tracing_off -scope "tb.proc.core"',
        ]);
    });

    it('so emite regra onde o estado muda: irmaos iguais nao repetem a do pai', () => {
        // core desligado cobre sp e ula; nenhuma regra para eles.
        expect(verilatorTraceRules(arvore, ['tb.proc.min.acc', 'tb.proc.min.q'])).toEqual([
            'tracing_off -scope "tb.proc"',
            'tracing_on -scope "tb.proc.min"',
        ]);
    });

    it('religa fundo na arvore atravessando pais desligados', () => {
        expect(verilatorTraceRules(arvore, ['tb.proc.core.ula.delta_int'])).toEqual([
            'tracing_off -scope "tb.proc"',
            'tracing_on -scope "tb.proc.core.ula"',
        ]);
    });

    it('nunca escreve regra para a raiz, que fica ligada com os espelhos', () => {
        const regras = verilatorTraceRules(arvore, ['tb.clk']);
        expect(regras.some((r) => r.endsWith('"tb"'))).toBe(false);
        expect(regras).toEqual(['tracing_off -scope "tb.proc"']);
    });

    it('ignora entradas que nao sao caminho', () => {
        expect(verilatorTraceRules(arvore, ['semponto', 42, null])).toEqual([
            'tracing_off -scope "tb.proc"',
        ]);
    });
});

describe('contarEscopos', () => {
    it('conta a raiz como ligada e o resto pela selecao', () => {
        expect(contarEscopos(arvore, ['tb.proc.min.acc'])).toEqual({ ligados: 2, desligados: 4 });
        expect(contarEscopos(arvore, [])).toEqual({ ligados: 1, desligados: 5 });
        expect(contarEscopos(null, [])).toEqual({ ligados: 0, desligados: 0 });
    });
});
