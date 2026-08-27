/**
 * Testes da regra de caminho de projeto.
 *
 * A regra existe porque o erro chegava tarde e no lugar errado: a IDE aceitava
 * a pasta, e a falha aparecia depois, vinda de uma ferramenta de linha de
 * comando, com uma mensagem que não mencionava o caractere culpado.
 *
 * Os dois lados importam. Recusar de menos devolve o problema original.
 * Recusar demais impede alguém de trabalhar numa pasta que funcionaria, e é o
 * jeito mais rápido de a validação ser contornada e desligada.
 */

import { describe, it, expect } from 'vitest';

import {
    analisarCaminhoDeProjeto, analisarNomeDeProjeto, explicar,
} from '../../js/project/path_rules.js';

const ok = (p) => analisarCaminhoDeProjeto(p).ok;

describe('caminhos que precisam passar', () => {
    it('aceita o caso comum no Windows', () => {
        expect(ok('C:\\Users\\chrys\\Documents\\GitHub\\sapho_cnn')).toBe(true);
    });

    it('aceita espaco simples, hifen, ponto e sublinhado', () => {
        expect(ok('C:\\Users\\ana\\Meus Projetos\\proj-fft_v2.1')).toBe(true);
    });

    it('aceita caminho no formato POSIX', () => {
        expect(ok('/home/ana/projetos/sapho')).toBe(true);
    });

    it('a unidade do Windows nao e confundida com caractere proibido', () => {
        // `C:` traz dois-pontos e barra invertida legitimos.
        expect(ok('D:\\lab\\proj')).toBe(true);
    });
});

describe('caminhos que quebram a cadeia de compilacao', () => {
    it.each([
        ['e comercial', 'C:\\lab\\Ana & Bruno\\proj'],
        ['cerquilha', 'C:\\lab\\proj#1'],
        ['porcento', 'C:\\lab\\100%\\proj'],
        ['parenteses', 'C:\\lab\\proj (copia)'],
        ['cifrao', 'C:\\lab\\$temp\\proj'],
        ['exclamacao', 'C:\\lab\\proj!'],
        ['aspas', 'C:\\lab\\pro"j'],
        ['asterisco', 'C:\\lab\\pro*j'],
        ['pipe', 'C:\\lab\\a|b'],
        ['ponto e virgula', 'C:\\lab\\a;b'],
    ])('recusa %s', (_nome, caminho) => {
        expect(ok(caminho)).toBe(false);
    });

    it('recusa acento, porque parte do MSYS nao le fora do ASCII', () => {
        const r = analisarCaminhoDeProjeto('C:\\Users\\ana\\Área de Trabalho\\proj');
        expect(r.ok).toBe(false);
        expect(r.motivo).toBe('acento');
    });

    it('recusa espaco duplo, que some em argumento nao citado', () => {
        const r = analisarCaminhoDeProjeto('C:\\lab\\meu  projeto');
        expect(r.ok).toBe(false);
        expect(r.motivo).toBe('espacoDuplo');
    });

    it('recusa nome reservado do Windows', () => {
        expect(analisarCaminhoDeProjeto('C:\\lab\\con\\proj').motivo).toBe('reservado');
        expect(analisarCaminhoDeProjeto('C:\\lab\\LPT1.txt').motivo).toBe('reservado');
    });

    it('recusa pasta que termina em ponto, que o Windows nao guarda', () => {
        expect(analisarCaminhoDeProjeto('C:\\lab\\proj.').motivo).toBe('pontoFinal');
    });

    it('recusa espaco nas bordas de um trecho', () => {
        expect(analisarCaminhoDeProjeto('C:\\lab\\ proj').motivo).toBe('bordas');
    });

    it('recusa vazio', () => {
        expect(analisarCaminhoDeProjeto('').motivo).toBe('vazio');
        expect(analisarCaminhoDeProjeto(null).motivo).toBe('vazio');
    });
});

describe('nome de projeto', () => {
    it('nao aceita barra, porque nome nao e caminho', () => {
        expect(analisarNomeDeProjeto('meu/proj').motivo).toBe('separador');
        expect(analisarNomeDeProjeto('meu\\proj').motivo).toBe('separador');
    });

    it('aceita um nome comum', () => {
        expect(analisarNomeDeProjeto('cnn_sapho').ok).toBe(true);
    });
});

describe('a mensagem aponta o problema', () => {
    it('diz QUAL caractere impede, que e o que resolve para quem le', () => {
        const r = analisarCaminhoDeProjeto('C:\\lab\\a&b');
        expect(explicar(r)).toContain('&');
    });

    it('caminho valido nao gera mensagem', () => {
        expect(explicar(analisarCaminhoDeProjeto('C:\\lab\\proj'))).toBe('');
    });
});
