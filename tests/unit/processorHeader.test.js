/**
 * O cabecalho de hardware lido do fonte, nas duas linguagens
 * (js/compilation/processor_header.ts).
 *
 * O que estes casos travam:
 *
 *   - a leitura do C+- continua exatamente a que as duas copias a mao faziam,
 *     inclusive no que ela RECUSA (diretiva indentada, chave minuscula);
 *   - a leitura do C++ segue o lexer do cppcomp, inclusive no que ele recusa
 *     (chave maiuscula, que ele lexa e nao aplica) e no que ele aceita
 *     (pragma indentado, pragma no meio do arquivo);
 *   - a chave sai em MAIUSCULA nas duas, para quem consome perguntar por
 *     `NUBITS` sem saber a linguagem;
 *   - a forma de uma linguagem NAO e lida na outra.
 */

import { describe, expect, it } from 'vitest';

import { parseProcessorHeader } from '../../js/compilation/processor_header.ts';

describe('parseProcessorHeader: C+-', () => {
    it('le as nove diretivas do cabecalho que o template escreve', () => {
        const fonte = [
            '#PRNAME proc_teste',
            '#NUBITS 23',
            '#NDSTAC 5',
            '#SDEPTH 5',
            '#NUIOIN 2',
            '#NUIOOU 3',
            '#NBMANT 16',
            '#NBEXPO 6',
            '#NUGAIN 128',
            '',
            'void main()',
            '{',
            '}',
        ].join('\n');
        expect(parseProcessorHeader(fonte, 'cmm')).toEqual({
            PRNAME: 'proc_teste',
            NUBITS: '23',
            NDSTAC: '5',
            SDEPTH: '5',
            NUIOIN: '2',
            NUIOOU: '3',
            NBMANT: '16',
            NBEXPO: '6',
            NUGAIN: '128',
        });
    });

    it('aguenta o fim de linha do Windows sem levar o \\r para o valor', () => {
        expect(parseProcessorHeader('#NUBITS 23\r\n#NBMANT 16\r\n', 'cmm'))
            .toEqual({ NUBITS: '23', NBMANT: '16' });
    });

    it('recusa diretiva indentada, como as copias que substitui recusavam', () => {
        expect(parseProcessorHeader('   #NUBITS 23', 'cmm')).toEqual({});
    });

    it('recusa chave minuscula: a diretiva do C+- e maiuscula', () => {
        expect(parseProcessorHeader('#nubits 23', 'cmm')).toEqual({});
    });

    it('recusa diretiva sem valor', () => {
        expect(parseProcessorHeader('#NUBITS', 'cmm')).toEqual({});
    });

    it('a ultima repetida vence, que e o que o laco copiado fazia', () => {
        expect(parseProcessorHeader('#NUBITS 23\n#NUBITS 32', 'cmm'))
            .toEqual({ NUBITS: '32' });
    });

    it('nao le a forma do C++', () => {
        expect(parseProcessorHeader('#pragma yanc nubits 32', 'cmm')).toEqual({});
    });
});

describe('parseProcessorHeader: C++', () => {
    it('le os tres pragmas que o template escreve, com a chave em maiuscula', () => {
        const fonte = [
            '#pragma yanc prname proc_cpp',
            '#pragma yanc nuioin 2',
            '#pragma yanc nuioou 3',
            '',
            'void main(void)',
            '{',
            '}',
        ].join('\n');
        expect(parseProcessorHeader(fonte, 'cpp')).toEqual({
            PRNAME: 'proc_cpp',
            NUIOIN: '2',
            NUIOOU: '3',
        });
    });

    it('le as onze chaves que o lexer do cppcomp aplica', () => {
        const chaves = ['prname', 'nubits', 'nbmant', 'nbexpo', 'nugain',
            'ndstac', 'sdepth', 'nuioin', 'nuioou', 'fftsiz', 'itradd'];
        const fonte = chaves.map((k, i) => `#pragma yanc ${k} ${i}`).join('\n');
        const lido = parseProcessorHeader(fonte, 'cpp');
        expect(Object.keys(lido)).toEqual(chaves.map((k) => k.toUpperCase()));
    });

    it('aceita pragma indentado, porque o lexer aceita', () => {
        expect(parseProcessorHeader('    #pragma yanc nubits 32', 'cpp'))
            .toEqual({ NUBITS: '32' });
    });

    it('aceita espaco depois do # e tabulacao entre os pedacos', () => {
        expect(parseProcessorHeader('#\tpragma\tyanc\tnubits\t32', 'cpp'))
            .toEqual({ NUBITS: '32' });
    });

    it('le pragma no meio do arquivo, e nao so no topo', () => {
        const fonte = 'void f(void) { }\n#pragma yanc sdepth 64\nvoid main(void) { }';
        expect(parseProcessorHeader(fonte, 'cpp')).toEqual({ SDEPTH: '64' });
    });

    it('recusa chave maiuscula: o cppcomp lexa, avisa e NAO aplica', () => {
        expect(parseProcessorHeader('#pragma yanc NUBITS 32', 'cpp')).toEqual({});
    });

    it('recusa pragma sem valor, como o sscanf do lexer recusa', () => {
        expect(parseProcessorHeader('#pragma yanc nubits', 'cpp')).toEqual({});
    });

    it('nao confunde outro pragma com os do yanc', () => {
        expect(parseProcessorHeader('#pragma once\n#pragma pack(1)', 'cpp')).toEqual({});
    });

    it('nao le as diretivas do C+-, nem o include, nem o define', () => {
        const fonte = '#include <stdint.h>\n#define NUBITS 32\n#NUBITS 32';
        expect(parseProcessorHeader(fonte, 'cpp')).toEqual({});
    });

    it('guarda o resto da linha como valor, igual ao sscanf do lexer', () => {
        // `%255[^\n\r]` leva o comentario junto; o cppcomp resolve no atoi.
        expect(parseProcessorHeader('#pragma yanc nubits 32 // largura', 'cpp'))
            .toEqual({ NUBITS: '32 // largura' });
    });
});

describe('parseProcessorHeader: entrada torta', () => {
    it('devolve objeto vazio para texto vazio, nulo ou indefinido', () => {
        for (const entrada of ['', null, undefined, 0, false]) {
            expect(parseProcessorHeader(entrada, 'cmm')).toEqual({});
            expect(parseProcessorHeader(entrada, 'cpp')).toEqual({});
        }
    });
});
