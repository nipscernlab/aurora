/**
 * Os blocos `generate if` nomeados, e quando eles existem.
 *
 * O erro que isto tem que evitar não é um teste vermelho: é uma simulação que
 * não elabora. Se a condição for julgada verdadeira quando não é, o testbench
 * ganha um espelho apontando para um escopo que não existe, e o Icarus falha
 * em "Unable to bind" longe da mudança que causou. Por isso o caso mais
 * importante aqui é o do "não sei": indecidível tem que continuar indecidível,
 * nunca virar palpite.
 */

import { describe, it, expect } from 'vitest';

import {
    extractNamedGenerates, parseIntLiteral, declaredParams, overriddenParams,
    resolveParamValue, evaluateCondition,
} from '../../js/wave/generate_blocks.js';

// O bloco real do core.v do SAPHO, onde vive a pilha de instrução.
const ISP = `
wire [MINSTW-1:0] stack_out;

generate
\tif (CAL) begin : isp_blk
\t\tstack #($clog2(SDEPTH), SDEPTH, MINSTW) isp(clk, rst, pf_isp_push, pf_isp_pop, pc_addr, stack_out);
\t\tassign pc_lval = (pf_isp_pop) ? stack_out : instr[MINSTW-1:0];
\tend else begin : isp_blk
\t\tassign pc_lval = instr[MINSTW-1:0];
\tend
endgenerate
`;

describe('extractNamedGenerates', () => {
    it('pega os dois ramos do isp, com o mesmo rótulo e a mesma condição', () => {
        const ramos = extractNamedGenerates(ISP);
        expect(ramos).toHaveLength(2);
        expect(ramos[0]).toMatchObject({ label: 'isp_blk', condition: 'CAL', negated: false });
        expect(ramos[1]).toMatchObject({ label: 'isp_blk', condition: 'CAL', negated: true });
        // Só o ramo verdadeiro instancia a pilha; é essa a diferença que decide
        // se o monitor pode existir.
        expect(ramos[0].body).toContain('isp(');
        expect(ramos[1].body).not.toContain('isp(');
    });

    it('lê a forma de uma linha só, que o core.v também usa', () => {
        const um = 'generate if (TOAQUIADDR>0) begin : toaqui_pin assign cheguei = 1; '
            + 'end else begin : toaqui_pin assign cheguei = 0; end endgenerate';
        const ramos = extractNamedGenerates(um);
        expect(ramos.map((r) => r.label)).toEqual(['toaqui_pin', 'toaqui_pin']);
        expect(ramos[0].condition).toBe('TOAQUIADDR>0');
    });

    it('conta begin e end aninhados, senão o ramo terminaria cedo', () => {
        const aninhado = `generate if (X) begin : blk
            always @(*) begin
                if (y) begin z = 1; end
            end
            outro inst(a);
        end endgenerate`;
        const [r] = extractNamedGenerates(aninhado);
        expect(r.label).toBe('blk');
        expect(r.body).toContain('outro inst(a)');
    });

    it('ignora ramo sem rótulo, porque sem nome ele não é escopo', () => {
        expect(extractNamedGenerates('generate if (X) begin assign a = 1; end endgenerate')).toEqual([]);
    });

    it('ignora generate for, que elabora sempre e é outro problema', () => {
        expect(extractNamedGenerates('generate for (i=0;i<4;i=i+1) begin : g x u(a); end endgenerate')).toEqual([]);
    });

    it('não quebra com parêntese ou begin sem fechar', () => {
        expect(extractNamedGenerates('generate if (X begin : a end endgenerate')).toEqual([]);
        expect(extractNamedGenerates('generate if (X) begin : a')).toEqual([]);
        expect(extractNamedGenerates('')).toEqual([]);
    });

    it('condição com parênteses aninhados sai inteira', () => {
        const [r] = extractNamedGenerates('generate if ((CAL) != 0) begin : b x u(a); end endgenerate');
        expect(r.condition).toBe('(CAL) != 0');
    });
});

describe('parseIntLiteral', () => {
    it('entende decimal e as bases do Verilog', () => {
        expect(parseIntLiteral('42')).toBe(42);
        expect(parseIntLiteral('-3')).toBe(-3);
        expect(parseIntLiteral("8'd12")).toBe(12);
        expect(parseIntLiteral("4'b1010")).toBe(10);
        expect(parseIntLiteral("32'hFF")).toBe(255);
        expect(parseIntLiteral("16'h1_F")).toBe(31);
    });

    it('devolve undefined para o que não é inteiro', () => {
        for (const v of ['', 'CAL', 'N*2', '"texto"', null, undefined, '1.5']) {
            expect(parseIntLiteral(v), String(v)).toBeUndefined();
        }
    });
});

describe('declaredParams', () => {
    it('lê a lista ANSI do cabeçalho e as declarações do corpo', () => {
        const p = declaredParams('parameter NUBITS = 32, parameter CAL = 0', 'parameter SDEPTH = 4;');
        expect(p.get('NUBITS')).toBe(32);
        expect(p.get('CAL')).toBe(0);
        expect(p.get('SDEPTH')).toBe(4);
    });

    it('padrão que depende de outro parâmetro fica de fora, e vira indecidível', () => {
        const p = declaredParams('', 'parameter W = N*2;');
        expect(p.has('W')).toBe(false);
    });

    it('vários numa declaração só', () => {
        const p = declaredParams('', 'parameter A = 1, B = 2;');
        expect(p.get('A')).toBe(1);
        expect(p.get('B')).toBe(2);
    });
});

describe('overriddenParams', () => {
    it('lê a forma nomeada, que é a que o yanc gera, ainda como texto', () => {
        // Texto e não número porque o valor pode ser o nome de um parâmetro de
        // quem instancia; quem resolve isso é a hierarquia, que conhece os dois
        // escopos. Ver resolveParamValue.
        const p = overriddenParams('.NUBITS(16),\n.CAL(1),\n.IFILE("C:/x/y.mif")');
        expect(p.get('NUBITS')).toBe('16');
        expect(p.get('CAL')).toBe('1');
        expect(p.get('IFILE')).toBe('"C:/x/y.mif"');
    });

    it('guarda o repasse por nome, que é como o processor.v desce o CAL', () => {
        expect(overriddenParams('.CAL(CAL), .SDEPTH(SDEPTH)').get('CAL')).toBe('CAL');
    });

    it('parêntese aninhado no valor não confunde o fim do argumento', () => {
        const p = overriddenParams('.SDEPTH($clog2(4)), .DDEPTH(8)');
        expect(p.get('SDEPTH')).toBe('$clog2(4)');
        expect(p.get('DDEPTH')).toBe('8');
    });

    it('a forma posicional fica de fora de proposito', () => {
        expect(overriddenParams('16, 10, 5').size).toBe(0);
    });
});

describe('resolveParamValue', () => {
    const escopo = new Map([['CAL', 1], ['SDEPTH', 4]]);

    it('inteiro escrito direto vale por si', () => {
        expect(resolveParamValue('1', new Map())).toBe(1);
        expect(resolveParamValue("8'd12", new Map())).toBe(12);
    });

    it('nome de parâmetro sai do escopo de quem instancia', () => {
        // É este caso que faz o .CAL(1) do <proc>.v atravessar o .CAL(CAL) do
        // processor.v e chegar ao generate if (CAL) dentro do core.
        expect(resolveParamValue('CAL', escopo)).toBe(1);
        expect(resolveParamValue('SDEPTH', escopo)).toBe(4);
    });

    it('expressão e nome desconhecido viram indecidível, nunca palpite', () => {
        expect(resolveParamValue('$clog2(4)', escopo)).toBeUndefined();
        expect(resolveParamValue('N*2', escopo)).toBeUndefined();
        expect(resolveParamValue('DESCONHECIDO', escopo)).toBeUndefined();
        expect(resolveParamValue('"texto"', escopo)).toBeUndefined();
        expect(resolveParamValue('', escopo)).toBeUndefined();
    });
});

describe('evaluateCondition', () => {
    const params = new Map([['CAL', 1], ['ZERO', 0], ['ITRADD', 8]]);

    it('parâmetro sozinho: verdade quando diferente de zero', () => {
        expect(evaluateCondition('CAL', params)).toBe(true);
        expect(evaluateCondition('ZERO', params)).toBe(false);
    });

    it('o ramo else é a negação do mesmo teste', () => {
        expect(evaluateCondition('CAL', params, true)).toBe(false);
        expect(evaluateCondition('ZERO', params, true)).toBe(true);
    });

    it('as comparações que o HDL do SAPHO usa', () => {
        expect(evaluateCondition('(CAL) != 0', params)).toBe(true);
        expect(evaluateCondition('(ZERO) != 0', params)).toBe(false);
        expect(evaluateCondition('ITRADD>0', params)).toBe(true);
        expect(evaluateCondition('ZERO > 0', params)).toBe(false);
        expect(evaluateCondition('CAL == 1', params)).toBe(true);
    });

    it('literal direto decide sem parâmetro nenhum', () => {
        expect(evaluateCondition('1', new Map())).toBe(true);
        expect(evaluateCondition('0', new Map())).toBe(false);
    });

    it('o que não dá para decidir continua indecidível, e nunca vira palpite', () => {
        // Um palpite aqui produz espelho para escopo inexistente, e a
        // elaboração do Icarus falha longe da causa.
        expect(evaluateCondition('DESCONHECIDO', params)).toBeUndefined();
        expect(evaluateCondition('CAL && ITRADD', params)).toBeUndefined();
        expect(evaluateCondition('N*2 > 0', params)).toBeUndefined();
        expect(evaluateCondition('', params)).toBeUndefined();
        expect(evaluateCondition('DESCONHECIDO', params, true)).toBeUndefined();
    });
});
