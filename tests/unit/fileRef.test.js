/**
 * Para onde aponta uma referencia a arquivo escrita pela IA (js/ai/file_ref.ts).
 *
 * Isto e regra de SANDBOX, e nao so de conveniencia: e o que impede que o
 * modelo escreva um caminho e o painel abra um arquivo de fora do projeto.
 * Estava dentro da classe de 4081 linhas do ai_assistant_manager, lendo dois
 * globais do `window` por dentro, entao nao havia como exercita-la sem subir o
 * painel. Uma regra de sandbox sem teste.
 */

import { describe, expect, it } from 'vitest';

import { fileRefCandidates, resolveTrackedFile } from '../../js/ai/file_ref.ts';

const ARVORE = [
    { name: 'proc.cmm', path: 'C:/proj/proc/Software/proc.cmm' },
    { name: 'topo.v', path: 'C:/proj/Hardware/topo.v' },
];
const CTX = { trackedFiles: ARVORE, projectRoot: 'C:/proj' };

describe('resolveTrackedFile', () => {
    it('acha pelo NOME, qualquer que seja a pasta escrita na frente', () => {
        for (const ref of ['proc.cmm', 'Software/proc.cmm', 'a/b/c/proc.cmm']) {
            expect(resolveTrackedFile(ref, ARVORE), ref)
                .toBe('C:/proj/proc/Software/proc.cmm');
        }
    });

    it('nao liga para maiuscula, porque Windows', () => {
        expect(resolveTrackedFile('PROC.CMM', ARVORE))
            .toBe('C:/proj/proc/Software/proc.cmm');
    });

    it('aceita as duas barras', () => {
        expect(resolveTrackedFile('a\\b\\topo.v', ARVORE)).toBe('C:/proj/Hardware/topo.v');
    });

    it('devolve null para o que a arvore nao conhece', () => {
        expect(resolveTrackedFile('nao_existe.v', ARVORE)).toBeNull();
    });

    it('devolve null sem arvore, sem nome, ou com arvore que nao e lista', () => {
        expect(resolveTrackedFile('proc.cmm', null)).toBeNull();
        expect(resolveTrackedFile('proc.cmm', undefined)).toBeNull();
        expect(resolveTrackedFile('proc.cmm', {})).toBeNull();
        expect(resolveTrackedFile('', ARVORE)).toBeNull();
        expect(resolveTrackedFile(null, ARVORE)).toBeNull();
    });
});

describe('fileRefCandidates: o caminho de dentro do projeto', () => {
    it('oferece o arquivo da arvore primeiro, depois o resolvido pela raiz', () => {
        expect(fileRefCandidates('proc.cmm', CTX)).toEqual([
            'C:/proj/proc/Software/proc.cmm',  // o que a arvore conhece
            'C:/proj/proc.cmm',                // o mesmo nome a partir da raiz
        ]);
    });

    it('quando as duas respostas coincidem, sai uma so', () => {
        expect(fileRefCandidates('proc/Software/proc.cmm', CTX))
            .toEqual(['C:/proj/proc/Software/proc.cmm']);
    });

    it('arquivo que a arvore nao conhece ainda tenta a raiz do projeto', () => {
        expect(fileRefCandidates('docs/leiame.md', CTX))
            .toEqual(['C:/proj/docs/leiame.md']);
    });

    it('limpa os delimitadores que o texto traz', () => {
        for (const ref of ['(proc.cmm)', '"proc.cmm"', "'proc.cmm'", '<proc.cmm>']) {
            expect(fileRefCandidates(ref, CTX), ref)
                .toEqual(['C:/proj/proc/Software/proc.cmm', 'C:/proj/proc.cmm']);
        }
    });

    it('barra invertida vira barra normal no caminho montado', () => {
        expect(fileRefCandidates('docs\\sub\\a.md', CTX)).toEqual(['C:/proj/docs/sub/a.md']);
    });

    it('nao repete o mesmo caminho duas vezes', () => {
        const fora = fileRefCandidates('topo.v', CTX);
        expect(new Set(fora).size).toBe(fora.length);
    });
});

describe('fileRefCandidates: o que a regra RECUSA', () => {
    it('referencia com .. nao vira candidato, nem normalizada', () => {
        for (const ref of ['../fora.txt', 'a/../../fora.txt', '..\\fora.txt']) {
            expect(fileRefCandidates(ref, CTX), ref).toEqual([]);
        }
    });

    it('caminho absoluto de fora nao e resolvido como absoluto', () => {
        for (const ref of ['C:/Windows/system32/x.dll', '/etc/passwd', '\\\\servidor\\x']) {
            expect(fileRefCandidates(ref, CTX), ref).toEqual([]);
        }
    });

    it('caminho absoluto SO abre quando aponta de volta para a arvore', () => {
        // E ai ele entra pelo nome do arquivo, nao pelo caminho que veio escrito.
        expect(fileRefCandidates('C:/outro/lugar/proc.cmm', CTX))
            .toEqual(['C:/proj/proc/Software/proc.cmm']);
    });

    it('sem projeto aberto, so vale o que a arvore conhece', () => {
        const semRaiz = { trackedFiles: ARVORE, projectRoot: null };
        expect(fileRefCandidates('proc.cmm', semRaiz))
            .toEqual(['C:/proj/proc/Software/proc.cmm']);
        expect(fileRefCandidates('docs/leiame.md', semRaiz)).toEqual([]);
    });

    it('referencia vazia ou so de delimitadores nao gera candidato', () => {
        for (const ref of ['', '   ', '()', '""', null, undefined]) {
            expect(fileRefCandidates(ref, CTX), String(ref)).toEqual([]);
        }
    });

    it('sem contexto nenhum, nao gera candidato', () => {
        expect(fileRefCandidates('proc.cmm')).toEqual([]);
    });
});
