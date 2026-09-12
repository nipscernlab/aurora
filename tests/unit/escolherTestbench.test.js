/**
 * Qual testbench a simulacao usa (js/compilation/compilation_helpers.ts).
 *
 * Esta funcao existe para que o BOTAO de onda e o ALVO da compilacao
 * respondam a mesma pergunta. Eram duas regras: o botao olhava so o campo
 * escalar `testbenchFile`, e o alvo ja aceitava tambem a lista
 * `testbenchFiles`. Um projeto que guardasse o testbench apenas na forma de
 * lista ficava com o botao apagado para sempre, sem nada na tela explicando o
 * porque, enquanto a compilacao por outro caminho encontrava o arquivo.
 */

import { describe, expect, it, vi } from 'vitest';

import { escolherTestbench } from '../../js/compilation/compilation_helpers.ts';

const A = 'C:/p/Testbench/a_tb.v';
const B = 'C:/p/Testbench/b_tb.v';

describe('escolherTestbench', () => {
    it('o campo escalar ganha de tudo', () => {
        expect(escolherTestbench({
            testbenchFile: A,
            testbenchFiles: [{ path: B, isTopLevel: true }],
        })).toBe(A);
    });

    it('sem escalar, vale a entrada marcada como topo', () => {
        expect(escolherTestbench({
            testbenchFile: '',
            testbenchFiles: [{ path: A }, { path: B, isTopLevel: true }],
        })).toBe(B);
    });

    it('sem marca nenhuma, vale a primeira valida', () => {
        expect(escolherTestbench({
            testbenchFiles: [{ path: '   ' }, { path: A }, { path: B }],
        })).toBe(A);
    });

    it('escalar em branco nao conta como escolha', () => {
        expect(escolherTestbench({ testbenchFile: '   ', testbenchFiles: [{ path: A }] })).toBe(A);
    });

    it('sem testbench nenhum, null', () => {
        expect(escolherTestbench({ testbenchFile: '', testbenchFiles: [] })).toBeNull();
        expect(escolherTestbench({})).toBeNull();
        expect(escolherTestbench(null)).toBeNull();
        expect(escolherTestbench({ testbenchFiles: [{ path: '' }, { name: 'sem caminho' }] })).toBeNull();
    });

    it('duas marcadas: avisa quem chamou e fica com a primeira', () => {
        const aviso = vi.fn();
        const escolhido = escolherTestbench({
            testbenchFiles: [{ path: A, isTopLevel: true }, { path: B, isTopLevel: true }],
        }, aviso);
        expect(escolhido).toBe(A);
        expect(aviso).toHaveBeenCalledTimes(1);
        expect(aviso.mock.calls[0][0].map((f) => f.path)).toEqual([A, B]);
    });

    it('uma marcada so nao e empate, e ninguem e avisado', () => {
        const aviso = vi.fn();
        escolherTestbench({ testbenchFiles: [{ path: A, isTopLevel: true }, { path: B }] }, aviso);
        expect(aviso).not.toHaveBeenCalled();
    });

    it('sem quem avisar, o empate nao quebra nada', () => {
        expect(escolherTestbench({
            testbenchFiles: [{ path: A, isTopLevel: true }, { path: B, isTopLevel: true }],
        })).toBe(A);
    });
});
