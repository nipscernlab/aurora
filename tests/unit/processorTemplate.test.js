/**
 * O fonte que nasce quando alguem cria um processador
 * (js/project/processor_defaults.ts).
 *
 * O que estes casos travam: o cabecalho C+- continua byte a byte o que o
 * handler escrevia antes da extracao, e o C++ diz a mesma coisa pela forma
 * que o cppcomp le, `#pragma yanc <chave> <valor>`. So tres pragmas, porque o
 * Processor Hub so pergunta nome e portas quando a linguagem e C++.
 */

import { describe, expect, it } from 'vitest';

import {
    PADROES_DO_CPPCOMP,
    cmmTemplate,
    cppTemplate,
    processorSourceFile,
} from '../../js/project/processor_defaults.ts';

const P = {
    processorName: 'procTest_00',
    nBits: 23, nbMantissa: 16, nbExponent: 6, gain: 128,
    dataStackSize: 5, instructionStackSize: 5,
    inputPorts: 2, outputPorts: 3,
};

describe('cmmTemplate: o cabecalho de sempre', () => {
    it('sai identico ao que o handler escrevia, diretiva por diretiva', () => {
        expect(cmmTemplate(P)).toBe(`#PRNAME procTest_00
#NUBITS 23
#NDSTAC 5
#SDEPTH 5
#NUIOIN 2
#NUIOOU 3
#NBMANT 16
#NBEXPO 6
#NUGAIN 128

void main()
{
    // Øk. Você criou um processador em C±, mas e agora?
}`);
    });
});

describe('cppTemplate: o mesmo dito em pragma', () => {
    it('traz prname e as duas portas, e nada alem', () => {
        expect(cppTemplate(P)).toBe(`#pragma yanc prname procTest_00
#pragma yanc nuioin 2
#pragma yanc nuioou 3

void main(void)
{
    // Øk. Você criou um processador em C++, mas e agora?
}`);
    });

    it('NAO escreve largura, mantissa, expoente, ganho nem pilhas', () => {
        // O Hub nao pergunta esses campos no modo C++, entao crava-los aqui
        // seria pôr no fonte de todo mundo um valor que ninguem escolheu. O
        // cppcomp assume sozinho, e quem precisar acrescenta o pragma a mao.
        const fonte = cppTemplate(P);
        for (const chave of ['nubits', 'nbmant', 'nbexpo', 'nugain', 'ndstac', 'sdepth']) {
            expect(fonte).not.toContain(chave);
        }
        expect(fonte.match(/#pragma yanc/g)).toHaveLength(3);
    });

    it('usa a forma dos exemplos do yanc: void main(void)', () => {
        expect(cppTemplate(P)).toContain('void main(void)');
    });
});

describe('processorSourceFile: nome e conteudo pela linguagem', () => {
    it('cpp pede o .cpp com os pragmas', () => {
        const r = processorSourceFile(P, 'cpp');
        expect(r.fileName).toBe('procTest_00.cpp');
        expect(r.content).toBe(cppTemplate(P));
    });

    it('cmm, ausente, vazio ou desconhecido cai no C+-, que e o padrao', () => {
        for (const lang of ['cmm', undefined, null, '', 'rust']) {
            const r = processorSourceFile(P, lang);
            expect(r.fileName).toBe('procTest_00.cmm');
            expect(r.content).toBe(cmmTemplate(P));
        }
    });

    it('a linguagem nao depende da caixa', () => {
        expect(processorSourceFile(P, 'CPP').fileName).toBe('procTest_00.cpp');
    });
});

describe('PADROES_DO_CPPCOMP: o que a interface mostra nos campos que desabilita', () => {
    it('sao os do config.h do cppcomp, e o formato fecha (32 = 23 + 8 + 1)', () => {
        expect(PADROES_DO_CPPCOMP).toEqual({
            nBits: 32, nbMantissa: 23, nbExponent: 8,
            gain: 128, dataStackSize: 128, instructionStackSize: 128,
        });
        expect(PADROES_DO_CPPCOMP.nBits)
            .toBe(PADROES_DO_CPPCOMP.nbMantissa + PADROES_DO_CPPCOMP.nbExponent + 1);
    });
});
