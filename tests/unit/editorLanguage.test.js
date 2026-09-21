/**
 * A extensao vira linguagem do Monaco (js/editor/editor_language.ts).
 *
 * O que estes casos travam: a resposta e UMA SO, venha de onde vier. Antes
 * havia tres tabelas a mao, e a do painel dividido ja tinha divergido; como o
 * Monaco grava a linguagem no modelo compartilhado quando ele nasce, o realce
 * de um `.hpp` dependia de qual painel abrisse o arquivo primeiro. A tabela
 * aqui e a uniao das tres, entao nenhum lado perdeu o que tinha.
 */

import { describe, expect, it } from 'vitest';

import {
    LINGUAGEM_PADRAO,
    LINGUAGEM_POR_EXTENSAO,
    extensionOfPath,
    languageFromPath,
} from '../../js/editor/editor_language.ts';

/** O que o editor principal e a dica de arquivo vazio ja respondiam. */
const DO_EDITOR_PRINCIPAL = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    html: 'html', css: 'css', json: 'json', md: 'markdown', py: 'python',
    c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
    cmm: 'cmm', asm: 'asm', m: 'matlab',
    v: 'verilog', vh: 'verilog', sv: 'systemverilog', svh: 'systemverilog',
    spf: 'json',
};

/** O que so o painel dividido respondia. */
const SO_DO_PAINEL_DIVIDIDO = { xml: 'xml', yaml: 'yaml', yml: 'yaml' };

describe('languageFromPath: a uniao das tres tabelas', () => {
    it('responde tudo que o editor principal respondia', () => {
        for (const [ext, lang] of Object.entries(DO_EDITOR_PRINCIPAL)) {
            expect(languageFromPath(`C:\\proj\\arquivo.${ext}`), ext).toBe(lang);
        }
    });

    it('responde tambem o que so o painel dividido respondia', () => {
        for (const [ext, lang] of Object.entries(SO_DO_PAINEL_DIVIDIDO)) {
            expect(languageFromPath(`C:\\proj\\arquivo.${ext}`), ext).toBe(lang);
        }
    });

    it('as nove extensoes que faltavam no painel dividido agora valem la tambem', () => {
        // Sao elas que faziam o realce depender de qual painel abrisse primeiro.
        for (const ext of ['jsx', 'tsx', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'svh', 'm']) {
            expect(languageFromPath(`x.${ext}`), ext).not.toBe(LINGUAGEM_PADRAO);
        }
    });

    it('as duas linguagens de fonte de processador tem realce proprio', () => {
        expect(languageFromPath('proc/Software/proc.cmm')).toBe('cmm');
        expect(languageFromPath('proc/Software/proc.cpp')).toBe('cpp');
    });

    it('o arquivo de projeto e lido como JSON, que e o que ele e', () => {
        expect(languageFromPath('meu_projeto.spf')).toBe('json');
    });

    it('nao inventa linguagem para extensao desconhecida', () => {
        expect(languageFromPath('leiame.docx')).toBe(LINGUAGEM_PADRAO);
        expect(languageFromPath('Makefile')).toBe(LINGUAGEM_PADRAO);
    });

    it('a extensao e lida sem ligar para maiuscula', () => {
        expect(languageFromPath('TOPO.V')).toBe('verilog');
        expect(languageFromPath('Proc.CmM')).toBe('cmm');
    });

    it('entrada torta vira texto puro, e nao um estouro', () => {
        // Duas das tres copias chamavam `.split` direto e estouravam com null.
        for (const entrada of [null, undefined, '', 0, false, {}]) {
            expect(languageFromPath(entrada)).toBe(LINGUAGEM_PADRAO);
        }
    });
});

describe('extensionOfPath', () => {
    it('tira o ponto e abaixa a caixa', () => {
        expect(extensionOfPath('C:\\a\\b\\Topo.SV')).toBe('sv');
    });

    it('nome sem ponto devolve o nome, que cai no padrao do mesmo jeito', () => {
        expect(extensionOfPath('Makefile')).toBe('makefile');
        expect(languageFromPath('Makefile')).toBe(LINGUAGEM_PADRAO);
    });
});

describe('LINGUAGEM_POR_EXTENSAO', () => {
    it('e congelada, para ninguem acrescentar extensao em tempo de execucao', () => {
        expect(Object.isFrozen(LINGUAGEM_POR_EXTENSAO)).toBe(true);
    });

    it('cobre as 28 extensoes da uniao, e nenhuma a mais', () => {
        expect(Object.keys(LINGUAGEM_POR_EXTENSAO).sort()).toEqual(
            [...Object.keys(DO_EDITOR_PRINCIPAL), ...Object.keys(SO_DO_PAINEL_DIVIDIDO)].sort(),
        );
    });
});
