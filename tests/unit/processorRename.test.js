/**
 * O que muda de nome quando um processador e renomeado
 * (main/ipc/processor_rename.ts).
 *
 * O defeito que este modulo fecha: criar processador C++ passou a funcionar
 * pelo Processor Hub, mas o rename so conhecia C+-. Um processador C++
 * renomeado ficava com o `.cpp` no nome antigo e com o `#pragma yanc prname`
 * apontando para um nome que nao existia mais, e parava de compilar.
 */

import { describe, expect, it } from 'vitest';

import {
    artefatosDoProcessador,
    fontesPossiveis,
    linguagemDoArquivo,
    reescreverNomeNoFonte,
} from '../../main/ipc/processor_rename.ts';

describe('artefatosDoProcessador', () => {
    it('inclui os fontes das DUAS linguagens, mais o .asm, o .v e o testbench', () => {
        expect(artefatosDoProcessador('P', 'Q')).toEqual([
            { sub: 'Software', de: 'P.cmm', para: 'Q.cmm' },
            { sub: 'Software', de: 'P.cpp', para: 'Q.cpp' },
            { sub: 'Software', de: 'P.asm', para: 'Q.asm' },
            { sub: 'Hardware', de: 'P.v', para: 'Q.v' },
            { sub: 'Simulation', de: 'P_tb.v', para: 'Q_tb.v' },
        ]);
    });

    it('lista os dois fontes mesmo sabendo que so um existe', () => {
        // Quem renomeia nao pergunta a linguagem a ninguem: pede os dois e
        // pula o que nao estiver no disco. Filtrar aqui exigiria que o
        // chamador soubesse a linguagem, que e justamente o que falhava.
        const fontes = artefatosDoProcessador('P', 'Q').filter((a) => a.sub === 'Software' && !a.de.endsWith('.asm'));
        expect(fontes.map((f) => f.de)).toEqual(['P.cmm', 'P.cpp']);
    });

    it('so mexe em Software, Hardware e Simulation', () => {
        const subs = new Set(artefatosDoProcessador('P', 'Q').map((a) => a.sub));
        expect([...subs].sort()).toEqual(['Hardware', 'Simulation', 'Software']);
    });
});

describe('reescreverNomeNoFonte', () => {
    it('troca o #PRNAME do C+-, e so a linha da diretiva', () => {
        const antes = '#PRNAME velho\n#NUBITS 23\n\nvoid main()\n{\n  // velho continua aqui\n}\n';
        const depois = reescreverNomeNoFonte(antes, 'novo', 'cmm');
        expect(depois).toContain('#PRNAME novo');
        expect(depois).toContain('// velho continua aqui');
        expect(depois).toContain('#NUBITS 23');
    });

    it('troca o #pragma yanc prname do C++, e so a linha da diretiva', () => {
        const antes = '#pragma yanc prname velho\n#pragma yanc nuioin 2\n\nvoid main(void)\n{\n  int velho = 1;\n}\n';
        const depois = reescreverNomeNoFonte(antes, 'novo', 'cpp');
        expect(depois).toContain('#pragma yanc prname novo');
        expect(depois).toContain('int velho = 1;');
        expect(depois).toContain('#pragma yanc nuioin 2');
    });

    it('aguenta o espacamento que o compilador aceita', () => {
        // O lexer do cppcomp casa `#pragma` com espaco livre em volta.
        expect(reescreverNomeNoFonte('#  pragma   yanc   prname   velho\n', 'novo', 'cpp'))
            .toContain('prname   novo');
        expect(reescreverNomeNoFonte('  #PRNAME velho\n', 'novo', 'cmm'))
            .toContain('#PRNAME novo');
    });

    it('nao inventa a diretiva quando ela nao esta la', () => {
        const semDiretiva = 'void main(void) {}\n';
        expect(reescreverNomeNoFonte(semDiretiva, 'novo', 'cpp')).toBe(semDiretiva);
        expect(reescreverNomeNoFonte(semDiretiva, 'novo', 'cmm')).toBe(semDiretiva);
    });

    it('nao troca a diretiva da OUTRA linguagem', () => {
        // Um .cmm com um `#pragma yanc` solto, ou o contrario, nao e mexido
        // pela linguagem errada: cada forma so responde pela sua.
        expect(reescreverNomeNoFonte('#pragma yanc prname velho\n', 'novo', 'cmm'))
            .toBe('#pragma yanc prname velho\n');
        expect(reescreverNomeNoFonte('#PRNAME velho\n', 'novo', 'cpp'))
            .toBe('#PRNAME velho\n');
    });

    it('troca so a primeira ocorrencia, que e a declaracao', () => {
        const duas = '#PRNAME velho\n#PRNAME outro\n';
        expect(reescreverNomeNoFonte(duas, 'novo', 'cmm')).toBe('#PRNAME novo\n#PRNAME outro\n');
    });

    it('nao lanca com texto ausente', () => {
        expect(reescreverNomeNoFonte(undefined, 'novo', 'cmm')).toBe('');
        expect(reescreverNomeNoFonte(null, 'novo', 'cpp')).toBe('');
    });
});

describe('fontesPossiveis e linguagemDoArquivo', () => {
    it('da o nome do fonte de cada linguagem, com a linguagem junto', () => {
        expect(fontesPossiveis('P')).toEqual([
            { language: 'cmm', arquivo: 'P.cmm' },
            { language: 'cpp', arquivo: 'P.cpp' },
        ]);
    });

    it('reconhece a linguagem pela extensao, em qualquer caixa', () => {
        expect(linguagemDoArquivo('P.cmm')).toBe('cmm');
        expect(linguagemDoArquivo('P.CPP')).toBe('cpp');
        for (const x of ['P.asm', 'P.v', 'P', '', null]) {
            expect(linguagemDoArquivo(x), String(x)).toBeNull();
        }
    });
});
