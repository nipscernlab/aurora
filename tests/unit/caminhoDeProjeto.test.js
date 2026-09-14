/**
 * Caminho de projeto que sobrevive a troca de maquina:
 * js/project/caminho_de_projeto.js.
 *
 * O CASO QUE ORIGINOU ISTO. Um aluno levou um projeto de um computador para
 * outro. O projeto tinha um `.gtkw` escolhido, e ao compilar a AURORA foi abrir
 * o caminho da primeira maquina. O arquivo estava ali, dentro da pasta do
 * projeto; o que nao veio no pendrive foi a letra de unidade e o nome do
 * usuario.
 *
 * As tres coisas que estes testes travam:
 *
 * Dentro do projeto grava relativo, fora grava absoluto. Relativizar um
 * caminho que esta fora nao ajudaria ninguem: ele seria relativo a uma pasta
 * que nao viaja com o projeto.
 *
 * `C:/proj2` NAO esta dentro de `C:/proj`. Sem exigir o separador depois da
 * raiz, o prefixo bate e um projeto irmao entra como se fosse subpasta, o que
 * gravaria `2/arquivo.v` e apontaria para o nada.
 *
 * E o resgate pela cauda, que e o que salva os projetos que JA estao por ai. A
 * correcao dos gravadores so vale para o que for gravado depois dela; o aluno
 * que trouxe o problema tem um arquivo com o caminho velho dentro. Se a cauda
 * daquele caminho existir no projeto de hoje, e o mesmo arquivo que se mudou
 * junto com a pasta.
 */

import { describe, it, expect } from 'vitest';
import {
    ehAbsoluto, dentroDaRaiz, paraRelativo, paraAbsoluto,
    resgatarPelaCauda, resolverGravado,
} from '../../js/project/caminho_de_projeto.ts';

const RAIZ = 'C:/Users/aluno/Desktop/proj';

describe('reconhecer caminho absoluto', () => {
    it('letra de unidade com as duas barras, e caminho de rede', () => {
        expect(ehAbsoluto('C:/proj/a.v')).toBe(true);
        expect(ehAbsoluto('C:\\proj\\a.v')).toBe(true);
        expect(ehAbsoluto('\\\\servidor\\proj\\a.v')).toBe(true);
    });

    it('relativo nao e absoluto', () => {
        expect(ehAbsoluto('Testbench/tb.v')).toBe(false);
        expect(ehAbsoluto('Testbench\\tb.v')).toBe(false);
        expect(ehAbsoluto('')).toBe(false);
    });
});

describe('estar dentro da raiz', () => {
    it('o nivel do .spf e para dentro conta', () => {
        expect(dentroDaRaiz(RAIZ, `${RAIZ}/a.v`)).toBe(true);
        expect(dentroDaRaiz(RAIZ, `${RAIZ}/Testbench/tb.v`)).toBe(true);
        expect(dentroDaRaiz(RAIZ, RAIZ)).toBe(true);
    });

    it('a caixa nao decide, porque no Windows ela nao decide', () => {
        expect(dentroDaRaiz(RAIZ, `${RAIZ.toUpperCase()}/A.V`)).toBe(true);
        expect(dentroDaRaiz(RAIZ, `${RAIZ.replace(/\//g, '\\')}\\a.v`)).toBe(true);
    });

    it('projeto irmao com nome parecido NAO esta dentro', () => {
        // Sem o separador depois da raiz, `proj2` casaria por prefixo e o
        // arquivo seria gravado como `2/a.v`, que aponta para o nada.
        expect(dentroDaRaiz(RAIZ, 'C:/Users/aluno/Desktop/proj2/a.v')).toBe(false);
        expect(dentroDaRaiz(RAIZ, 'C:/Users/aluno/Desktop/outro/a.v')).toBe(false);
    });
});

describe('gravar', () => {
    it('dentro do projeto vira relativo, com barra normal', () => {
        expect(paraRelativo(RAIZ, `${RAIZ}/Testbench/tb.v`)).toBe('Testbench/tb.v');
        expect(paraRelativo(RAIZ, `${RAIZ}\\Testbench\\tb.gtkw`)).toBe('Testbench/tb.gtkw');
    });

    it('fora do projeto fica absoluto', () => {
        // Um .v de biblioteca em Program Files nao tem o que fazer relativo.
        expect(paraRelativo(RAIZ, 'C:/lib/comum.v')).toBe('C:/lib/comum.v');
    });

    it('o que ja era relativo so troca a barra', () => {
        expect(paraRelativo(RAIZ, 'dirac\\Hardware\\dirac.v')).toBe('dirac/Hardware/dirac.v');
    });

    it('a propria raiz vira ponto, e nao string vazia', () => {
        expect(paraRelativo(RAIZ, RAIZ)).toBe('.');
    });
});

describe('usar', () => {
    it('relativo resolve contra a raiz de AGORA', () => {
        expect(paraAbsoluto(RAIZ, 'Testbench/tb.v')).toBe(`${RAIZ}/Testbench/tb.v`);
        expect(paraAbsoluto(RAIZ, 'Testbench\\tb.v')).toBe(`${RAIZ}/Testbench/tb.v`);
    });

    it('absoluto passa inteiro', () => {
        expect(paraAbsoluto(RAIZ, 'C:/lib/comum.v')).toBe('C:/lib/comum.v');
    });

    it('a viagem de ida e volta devolve o mesmo arquivo em outra raiz', () => {
        // Este e o teste que representa o caso do aluno: grava na maquina A,
        // le na maquina B, e o arquivo continua sendo achado.
        const maquinaA = 'C:/Users/joao/Desktop/proj';
        const maquinaB = 'D:/aulas/proj';
        const naA = `${maquinaA}/Testbench/tb.gtkw`;
        const gravado = paraRelativo(maquinaA, naA);
        expect(paraAbsoluto(maquinaB, gravado)).toBe(`${maquinaB}/Testbench/tb.gtkw`);
    });
});

describe('resgatar o que foi gravado na outra maquina', () => {
    const ANTIGO = 'C:/Users/joao/Desktop/velho/proj/Testbench/tb.gtkw';
    const AGORA = `${RAIZ}/Testbench/tb.gtkw`;
    const existe = (p) => p === AGORA;

    it('acha pela cauda mais longa que existir', () => {
        expect(resgatarPelaCauda(RAIZ, ANTIGO, existe)).toBe(AGORA);
    });

    it('nao inventa quando nada da cauda existe', () => {
        expect(resgatarPelaCauda(RAIZ, ANTIGO, () => false)).toBeNull();
    });

    it('prefere a cauda com mais pastas, para nao cair num homonimo', () => {
        // Ha um `tb.gtkw` na raiz E um em Testbench. O certo e o de
        // Testbench, porque casa mais pastas do caminho antigo.
        const doisExistem = (p) => p === AGORA || p === `${RAIZ}/tb.gtkw`;
        expect(resgatarPelaCauda(RAIZ, ANTIGO, doisExistem)).toBe(AGORA);
    });

    it('caminho de um nivel so nao tem cauda para tentar', () => {
        expect(resgatarPelaCauda(RAIZ, 'C:/', existe)).toBeNull();
    });
});

describe('resolver o que esta gravado', () => {
    const ARQ = `${RAIZ}/Testbench/tb.gtkw`;

    it('relativo que existe: usa e nao marca resgate', () => {
        expect(resolverGravado(RAIZ, 'Testbench/tb.gtkw', (p) => p === ARQ))
            .toEqual({ caminho: ARQ, resgatado: false });
    });

    it('absoluto de outra maquina: resgata e AVISA que resgatou', () => {
        // O aviso importa: quem chama grava de volta o caminho consertado, e
        // sem saber que houve resgate ele regravaria o caminho velho.
        const r = resolverGravado(RAIZ, 'C:/Users/joao/proj/Testbench/tb.gtkw', (p) => p === ARQ);
        expect(r).toEqual({ caminho: ARQ, resgatado: true });
    });

    it('absoluto de fora do projeto que existe: fica como esta', () => {
        // Biblioteca compartilhada e caso legitimo, nao e caminho quebrado.
        const lib = 'C:/lib/comum.v';
        expect(resolverGravado(RAIZ, lib, (p) => p === lib))
            .toEqual({ caminho: lib, resgatado: false });
    });

    it('sem palpite nenhum, devolve o caminho resolvido e nao null', () => {
        // Quem chama precisa de um caminho para poder dizer qual arquivo
        // faltou. Devolver null viraria "nao consegui" sem dizer de que.
        const r = resolverGravado(RAIZ, 'Testbench/sumiu.gtkw', () => false);
        expect(r.caminho).toBe(`${RAIZ}/Testbench/sumiu.gtkw`);
        expect(r.resgatado).toBe(false);
    });

    it('vazio nao vira caminho', () => {
        expect(resolverGravado(RAIZ, '', () => true)).toBeNull();
    });
});
