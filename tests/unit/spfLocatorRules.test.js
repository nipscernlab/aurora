/**
 * As decisões da varredura que reencontra um `.spf` sumido.
 *
 * O que custa errar aqui não é achar de menos, é demorar de mais: entrar em
 * node_modules ou no Windows faz a varredura passar minutos onde um projeto
 * nunca esteve, e o usuário cancela antes de ela chegar ao lugar certo.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { dirEntra, ordenarRaizes, melhorAlvo } = require('../../main/ipc/spf_locator_rules.js');

describe('dirEntra', () => {
    it('entra onde projeto mora', () => {
        for (const n of ['Desktop', 'Documents', 'sapho_procs', 'projetos', 'GitHub']) {
            expect(dirEntra(n), n).toBe(true);
        }
    });

    it('nao entra em infraestrutura, que e onde a varredura morre de velha', () => {
        for (const n of ['node_modules', '.git', 'Windows', 'Program Files',
            'Program Files (x86)', 'ProgramData', 'AppData', '$Recycle.Bin',
            'System Volume Information', '.vscode', '$WinREAgent', '__pycache__']) {
            expect(dirEntra(n), n).toBe(false);
        }
        expect(dirEntra('')).toBe(false);
        expect(dirEntra(null)).toBe(false);
    });
});

describe('ordenarRaizes', () => {
    it('o provavel vem primeiro, o disco inteiro vem depois', () => {
        const r = ordenarRaizes('C:\\Users\\chrys', ['C:\\', 'D:\\']);
        expect(r[0]).toBe('C:\\Users\\chrys\\Desktop');
        expect(r[1]).toBe('C:\\Users\\chrys\\Documents');
        expect(r[2]).toBe('C:\\Users\\chrys\\Downloads');
        expect(r).toContain('C:\\Users\\chrys');
        expect(r.indexOf('C:\\')).toBeGreaterThan(r.indexOf('C:\\Users\\chrys'));
        expect(r).toContain('D:\\');
    });

    it('nao repete raiz', () => {
        const r = ordenarRaizes('C:\\Users\\chrys', ['C:\\', 'C:\\']);
        expect(r.filter((x) => x === 'C:\\')).toHaveLength(1);
    });
});

describe('melhorAlvo', () => {
    it('a cauda comum mais longa decide entre alvos de mesmo nome', () => {
        // Dois projetos com projeto.spf; o achado preserva a cauda do segundo.
        const chaves = [
            'C:\\antigo\\alpha\\projeto.spf',
            'C:\\antigo\\beta\\projeto.spf',
        ];
        expect(melhorAlvo(chaves, 'D:\\novo\\beta\\projeto.spf')).toBe('C:\\antigo\\beta\\projeto.spf');
    });

    it('so mudou a pasta de cima: o resto do caminho e a prova', () => {
        const chaves = ['C:\\Users\\chrys\\Desktop\\my_love\\sapho_cnn\\sapho_cnn.spf'];
        expect(melhorAlvo(chaves, 'C:\\Users\\chrys\\Desktop\\sapho_procs\\sapho_cnn\\sapho_cnn.spf'))
            .toBe(chaves[0]);
    });

    it('sem cauda comum, vale o primeiro, que e o mais antigo da lista', () => {
        const chaves = ['C:\\a\\x.spf', 'C:\\b\\x.spf'];
        expect(melhorAlvo(chaves, 'D:\\outra\\coisa\\x.spf')).toBe('C:\\a\\x.spf');
    });

    it('barra e maiuscula nao atrapalham a comparacao', () => {
        expect(melhorAlvo(['c:/velho/Proj/App.SPF'], 'D:\\novo\\proj\\app.spf')).toBe('c:/velho/Proj/App.SPF');
    });

    it('lista vazia devolve null', () => {
        expect(melhorAlvo([], 'C:\\x.spf')).toBe(null);
    });
});
