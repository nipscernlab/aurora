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
    analisarCaminhoDeProjeto, analisarNome, explicar,
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

// #187. Projeto e processador seguem UMA regra de nome, a do processador
// (pastas_do_processador.ts, a mesma do yanc), mais os nomes que o Windows
// reserva, porque os dois viram pasta. Antes o projeto aceitava hifen e digito
// no comeco, e o processador nao; quem criava os dois via avisos diferentes.
describe('nome de projeto e de processador', () => {
    it('aceita um nome comum', () => {
        expect(analisarNome('cnn_sapho').ok).toBe(true);
        expect(analisarNome('Filtro2').ok).toBe(true);
    });

    // #186: o nome herdava a regra do caminho, que aceita espaco simples.
    it('recusa espaco, e o aviso escreve "espaço" em vez de um branco invisivel', () => {
        const r = analisarNome('meu projeto');
        expect(r.motivo).toBe('nomeCaracteres');
        expect(explicar(r)).toContain('Tire: espaço.');
    });

    it('lista cada caractere recusado uma vez so', () => {
        expect(analisarNome('a-b-c.d').detalhe).toBe('- .');
        expect(analisarNome('ação').detalhe).toBe('ç ã');
    });

    it('barra cai na mesma regra, porque nome nao e caminho', () => {
        expect(analisarNome('meu/proj').motivo).toBe('nomeCaracteres');
        expect(analisarNome('meu\\proj').detalhe).toBe('\\');
    });

    it('as recusas do yanc, na ordem dele', () => {
        expect(analisarNome('').motivo).toBe('nomeVazio');
        expect(analisarNome(null).motivo).toBe('nomeVazio');
        expect(analisarNome('2fir').motivo).toBe('nomeDigito');
        expect(analisarNome('__x').motivo).toBe('nomeSublinhado');
        expect(analisarNome('wire')).toEqual({ ok: false, motivo: 'nomeReservada', detalhe: 'wire' });
    });

    it('recusa nome que o Windows reserva, que o yanc aceitaria mas a pasta nao', () => {
        expect(analisarNome('con')).toEqual({ ok: false, motivo: 'reservado', detalhe: 'con' });
        expect(analisarNome('LPT1').motivo).toBe('reservado');
    });

    it('cada recusa tem um texto proprio', () => {
        const textos = ['', '2fir', '__x', 'wire', 'a b'].map((n) => explicar(analisarNome(n)));
        expect(new Set(textos).size).toBe(textos.length);
        expect(textos.every((t) => t && t !== 'Caminho inválido.')).toBe(true);
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
