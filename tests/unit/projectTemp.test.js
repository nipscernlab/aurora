/**
 * A poda da Temp de cada projeto (main/project_temp.js).
 *
 * A pasta <projeto>/.aurora/Temp nao e mais apagada a cada saida, porque o
 * obj_dir do Verilator vale segundos de build por clique. Em troca ela precisa
 * de alguem que a impeca de crescer sem fim, e esse alguem e podarTemp: idade
 * primeiro, teto depois, sempre por entrada de primeiro nivel para nunca
 * deixar um build pela metade. O que se prova aqui e cada uma dessas regras,
 * num disco de verdade e pequeno, com o relogio e os limites injetados.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { podarTemp, tempDoProjeto, garantirGitignoreDaAurora, SEGMENTOS } from '../../main/project_temp.js';

const DIA = 24 * 60 * 60 * 1000;

let raiz;
beforeEach(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-temp-poda-'));
});
afterEach(() => {
    fs.rmSync(raiz, { recursive: true, force: true });
});

/** Cria um arquivo (ou pasta com um arquivo dentro) com tamanho e data dados. */
function entrada(nome, { bytes = 10, idadeMs = 0, pasta = false, agora }) {
    const p = path.join(raiz, nome);
    let alvo = p;
    if (pasta) {
        fs.mkdirSync(p, { recursive: true });
        alvo = path.join(p, 'conteudo.bin');
    }
    fs.writeFileSync(alvo, Buffer.alloc(bytes));
    const t = new Date(agora - idadeMs);
    fs.utimesSync(alvo, t, t);
    if (pasta) fs.utimesSync(p, t, t);
    return p;
}

describe('tempDoProjeto', () => {
    it('e <projeto>/.aurora/Temp, os mesmos segmentos do renderer', () => {
        expect(SEGMENTOS).toEqual(['.aurora', 'Temp']);
        expect(tempDoProjeto(path.join('C:', 'p'))).toBe(path.join('C:', 'p', '.aurora', 'Temp'));
    });
});

describe('podarTemp', () => {
    const agora = Date.parse('2026-09-11T12:00:00Z');

    it('pasta que nao existe: nada a fazer, nada lancado', () => {
        const r = podarTemp(path.join(raiz, 'nao-existe'), { agora });
        expect(r).toEqual({ removidos: [], bytesAntes: 0, bytesDepois: 0 });
    });

    it('apaga o que passou da idade e deixa o recente, mesmo pequeno', () => {
        const velho = entrada('velho.vvp', { idadeMs: 9 * DIA, agora });
        const novo = entrada('novo.vvp', { idadeMs: 1 * DIA, agora });
        const r = podarTemp(raiz, { agora, idadeMaximaMs: 7 * DIA, tetoBytes: 1e9 });
        expect(r.removidos).toEqual([velho]);
        expect(fs.existsSync(novo)).toBe(true);
    });

    it('uma pasta vale pela data do arquivo mais novo dentro dela', () => {
        // obj_dir com Makefile antigo mas um .o de hoje: esta em uso hoje.
        const objDir = entrada('obj_dir_tb', { pasta: true, idadeMs: 30 * DIA, agora });
        const recente = path.join(objDir, 'Vtb.o');
        fs.writeFileSync(recente, Buffer.alloc(5));
        const t = new Date(agora - 1 * DIA);
        fs.utimesSync(recente, t, t);

        const r = podarTemp(raiz, { agora, idadeMaximaMs: 7 * DIA, tetoBytes: 1e9 });
        expect(r.removidos).toEqual([]);
        expect(fs.existsSync(objDir)).toBe(true);
    });

    it('acima do teto, apaga o mais antigo primeiro e para assim que cabe', () => {
        const a = entrada('a', { bytes: 100, idadeMs: 3 * DIA, agora });
        const b = entrada('b', { bytes: 100, idadeMs: 2 * DIA, agora });
        const c = entrada('c', { bytes: 100, idadeMs: 1 * DIA, agora });
        const r = podarTemp(raiz, { agora, idadeMaximaMs: 30 * DIA, tetoBytes: 150 });
        expect(r.removidos).toEqual([a, b]);
        expect(fs.existsSync(c)).toBe(true);
        expect(r.bytesAntes).toBe(300);
        expect(r.bytesDepois).toBe(100);
    });

    it('dentro do teto e da idade, nao toca em nada', () => {
        entrada('a', { bytes: 10, idadeMs: 1 * DIA, agora });
        entrada('b', { bytes: 10, idadeMs: 2 * DIA, agora });
        const r = podarTemp(raiz, { agora, idadeMaximaMs: 7 * DIA, tetoBytes: 1000 });
        expect(r.removidos).toEqual([]);
        expect(fs.readdirSync(raiz).sort()).toEqual(['a', 'b']);
    });

    it('apaga entradas inteiras, nunca um arquivo de dentro de um obj_dir', () => {
        const objDir = entrada('obj_dir_tb', { pasta: true, bytes: 200, idadeMs: 2 * DIA, agora });
        const makefile = path.join(objDir, 'Makefile');
        fs.writeFileSync(makefile, Buffer.alloc(50));
        // Escrever dentro da pasta renova o mtime dela e do arquivo para o
        // relogio real; a idade do obj_dir tem que ser a do teste.
        const antes = new Date(agora - 2 * DIA);
        fs.utimesSync(makefile, antes, antes);
        fs.utimesSync(objDir, antes, antes);
        entrada('novo.vvp', { bytes: 10, idadeMs: 1 * DIA, agora });
        const r = podarTemp(raiz, { agora, idadeMaximaMs: 30 * DIA, tetoBytes: 100 });
        expect(r.removidos).toEqual([objDir]);
        expect(fs.existsSync(objDir)).toBe(false);
    });
});

// O `.gitignore` de dentro da `.aurora`.
//
// O botao "New .gitignore" escreve a linha na raiz do projeto, mas so em
// projeto NOVO: quem ja tinha um `.gitignore` ficaria com a Temp aparecendo
// no `git status` para sempre. Um `.gitignore` aninhado resolve isso sem
// tocar no arquivo da raiz, que e do usuario.
describe('garantirGitignoreDaAurora', () => {
    it('escreve o arquivo dentro da .aurora quando nao ha nenhum', () => {
        garantirGitignoreDaAurora(raiz);
        const txt = fs.readFileSync(path.join(raiz, '.aurora', '.gitignore'), 'utf8');
        expect(txt).toContain('Temp/');
        expect(txt).toContain('execucoes/');
    });

    it('NAO ignora memory/, que e conteudo e pode ser versionado', () => {
        garantirGitignoreDaAurora(raiz);
        const txt = fs.readFileSync(path.join(raiz, '.aurora', '.gitignore'), 'utf8');
        expect(txt).not.toMatch(/^memory\//m);
    });

    it('nao sobrescreve um arquivo que alguem editou a mao', () => {
        const alvo = path.join(raiz, '.aurora', '.gitignore');
        fs.mkdirSync(path.dirname(alvo), { recursive: true });
        fs.writeFileSync(alvo, 'meu proprio conteudo\n');
        garantirGitignoreDaAurora(raiz);
        expect(fs.readFileSync(alvo, 'utf8')).toBe('meu proprio conteudo\n');
    });

    it('um arquivo vazio conta como ausente e e preenchido', () => {
        const alvo = path.join(raiz, '.aurora', '.gitignore');
        fs.mkdirSync(path.dirname(alvo), { recursive: true });
        fs.writeFileSync(alvo, '   \n');
        garantirGitignoreDaAurora(raiz);
        expect(fs.readFileSync(alvo, 'utf8')).toContain('Temp/');
    });

    it('pasta que nao da para escrever nao lanca', () => {
        expect(() => garantirGitignoreDaAurora('')).not.toThrow();
    });
});
