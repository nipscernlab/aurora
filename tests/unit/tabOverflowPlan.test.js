/**
 * Testes do plano de excedente das abas do terminal.
 *
 * A regra que mais custa errar é a da aba ativa. Esconder justamente a aba que
 * a pessoa está usando é pior do que qualquer aperto de layout, e é o erro
 * clássico desta feature: a conta de espaço roda da esquerda para a direita e
 * a ativa, se estiver no fim, simplesmente some.
 */

import { describe, it, expect } from 'vitest';

import { planTabOverflow } from '../../js/terminal/tab_overflow_plan.js';

const BOTAO = 28;

describe('planTabOverflow', () => {
    it('cabendo tudo, nao esconde nada e nao pede o botao', () => {
        const r = planTabOverflow([100, 100, 100], 400, 0, BOTAO);
        expect(r.visiveis).toEqual([0, 1, 2]);
        expect(r.escondidas).toEqual([]);
    });

    it('nao cabendo, corta da direita', () => {
        // 300 de abas em 200: com o botao sobram 172, entao entra uma so.
        const r = planTabOverflow([100, 100, 100], 200, 0, BOTAO);
        expect(r.visiveis).toEqual([0]);
        expect(r.escondidas).toEqual([1, 2]);
    });

    it('desconta o botao ANTES de decidir', () => {
        // Sem descontar, 200 caberiam exatos em 200 e nada seria escondido;
        // o botao entraria depois e estouraria de novo.
        const r = planTabOverflow([100, 100, 100], 200, 0, BOTAO);
        expect(r.visiveis.length).toBe(1);
    });

    it('a aba ativa nunca e escondida, mesmo sendo a ultima', () => {
        const r = planTabOverflow([100, 100, 100], 200, 2, BOTAO);
        expect(r.visiveis).toContain(2);
        expect(r.escondidas).not.toContain(2);
    });

    it('ao trazer a ativa, tira outra em vez de somar', () => {
        // Sem tirar, caberiam duas de 100 em 172 e a conta ficaria mentirosa.
        const r = planTabOverflow([100, 100, 100], 200, 2, BOTAO);
        expect(r.visiveis).toEqual([2]);
        expect(r.escondidas).toEqual([0, 1]);
    });

    it('a ordem das visiveis e preservada', () => {
        const r = planTabOverflow([60, 60, 60, 60], 200, 3, BOTAO);
        const ordenado = [...r.visiveis].sort((a, b) => a - b);
        expect(r.visiveis).toEqual(ordenado);
    });

    it('sem aba ativa, so corta da direita', () => {
        const r = planTabOverflow([100, 100, 100], 200, -1, BOTAO);
        expect(r.visiveis).toEqual([0]);
    });

    it('espaco ridiculo ainda devolve a ativa, e nao uma barra vazia', () => {
        // Preferir mostrar uma aba estourando a mostrar nenhuma: sem aba
        // visivel a pessoa perde a referencia de onde esta.
        const r = planTabOverflow([100, 100], 10, 1, BOTAO);
        expect(r.visiveis).toEqual([1]);
        expect(r.escondidas).toEqual([0]);
    });

    it('lista vazia nao quebra', () => {
        expect(planTabOverflow([], 200, -1, BOTAO)).toEqual({ visiveis: [], escondidas: [] });
    });
});
