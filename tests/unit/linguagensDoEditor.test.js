// @vitest-environment happy-dom
//
// js/editor/linguagens_do_editor.ts: o que a AURORA ensina ao Monaco. As tres
// linguagens que o pacote do Monaco nao traz (C+-, o assembly do SAPHO e
// MATLAB), os temas da casa, e o conjunto de nomes de #define do C+-, que
// acompanha os buffers abertos e vira constante no tokenizador.
//
// As linguagens sairam do monaco_editor.js em 06/10/2026; a extracao foi
// conferida por uma prova diferencial (as funcoes antigas e as novas
// registraram as mesmas 16 chamadas sobre um Monaco de mentira). Os
// tokenizadores e os temas ficam numa foto: mudar uma regra de cor ou de
// token passa a ser uma decisao visivel no diff do teste.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    setupCMMLanguage, setupASMLanguage, setupMatlabLanguage, definirTemasDaAurora,
} from '../../js/editor/linguagens_do_editor.js';

/** Um Monaco de mentira que guarda tudo o que lhe registram. */
function monacoFalso() {
    const m = {
        idiomas: [],
        tokenizadores: {},
        trocasDoCmm: 0,
        configuracoes: {},
        temas: {},
        sugestoes: [],
        modelos: [],
        aoCriarModelo: null,
        aoMudarLinguagem: null,
        languages: {
            register: (d) => { m.idiomas.push(d); },
            setMonarchTokensProvider: (id, def) => {
                if (id === 'cmm') m.trocasDoCmm += 1;
                m.tokenizadores[id] = def;
            },
            setLanguageConfiguration: (id, c) => { m.configuracoes[id] = c; },
            registerCompletionItemProvider: (id, p) => { m.sugestoes.push([id, p]); return { dispose() {} }; },
            CompletionItemKind: { Snippet: 27 },
            CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
        },
        editor: {
            defineTheme: (nome, t) => { m.temas[nome] = t; },
            getModels: () => m.modelos,
            onDidCreateModel: (cb) => { m.aoCriarModelo = cb; },
            onDidChangeModelLanguage: (cb) => { m.aoMudarLinguagem = cb; },
        },
    };
    return m;
}

/** Um modelo de texto de mentira. */
function modelo(texto, lingua = 'cmm') {
    const md = {
        texto,
        lingua,
        ouvintes: [],
        getLanguageId: () => md.lingua,
        getValue: () => md.texto,
        onDidChangeContent: (cb) => { md.ouvintes.push(cb); },
        editar(t) { md.texto = t; md.ouvintes.forEach((cb) => cb()); },
    };
    return md;
}

/** Registra tudo, na ordem do boot do Monaco. */
function registrarTudo(mon) {
    setupCMMLanguage(mon);
    setupASMLanguage(mon);
    setupMatlabLanguage(mon);
    definirTemasDaAurora(mon);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('registro', () => {
    it('as tres linguagens, os quatro temas e as sugestoes de Dirac no C+-', () => {
        const mon = monacoFalso();
        registrarTudo(mon);
        expect(mon.idiomas).toEqual([
            { id: 'cmm' },
            { id: 'asm' },
            { id: 'matlab', extensions: ['.m'], aliases: ['MATLAB', 'matlab', 'Octave', 'octave'] },
        ]);
        expect(Object.keys(mon.temas).sort()).toEqual(['asm-dark', 'asm-light', 'cmm-dark', 'cmm-light']);
        expect(mon.sugestoes.map(([id]) => id)).toEqual(['cmm']);
    });

    it('os tokenizadores, a configuracao do MATLAB e os temas, como estao', () => {
        const mon = monacoFalso();
        registrarTudo(mon);
        expect({
            tokenizadores: mon.tokenizadores,
            configuracoes: mon.configuracoes,
            temas: mon.temas,
        }).toMatchSnapshot();
    });
    it('o assembly conhece as leituras da divisao do yanc v6.0', () => {
        // `DIV x; NOP; QUO`: QUO, REM e F_QUO sao apelidos do asmcomp v6.0.
        const mon = monacoFalso();
        setupASMLanguage(mon);
        expect(mon.tokenizadores.asm.instructions).toEqual(
            expect.arrayContaining(['QUO', 'REM', 'F_QUO']));
    });
});

describe('os #define do C+-', () => {
    it('o nome de um #define vira constante do tokenizador, e so ao mudar o conjunto', async () => {
        const mon = monacoFalso();
        const aberto = modelo('#define N 4\nint x;');
        mon.modelos.push(aberto, modelo('#define Y 1', 'verilog'));
        setupCMMLanguage(mon);
        expect(mon.trocasDoCmm).toBe(1);

        await vi.advanceTimersByTimeAsync(300);
        expect(mon.trocasDoCmm).toBe(2);
        expect(mon.tokenizadores.cmm.defineConstants).toEqual(['N']);

        // Editar sem mudar o conjunto nao re-registra; varias teclas viram uma conferencia.
        aberto.editar('#define N 5\nint x;');
        aberto.editar('#define N 6\nint x;');
        await vi.advanceTimersByTimeAsync(300);
        expect(mon.trocasDoCmm).toBe(2);

        // Um #define que nao esta no comeco da linha nao conta; um novo conta.
        aberto.editar('x = "#define FALSO";\n  #define M 2\n#define N 1');
        await vi.advanceTimersByTimeAsync(300);
        expect(mon.trocasDoCmm).toBe(3);
        expect([...mon.tokenizadores.cmm.defineConstants].sort()).toEqual(['M', 'N']);

        // Mesmo tamanho, nome diferente: conta.
        aberto.editar('#define A 1\n#define B 2');
        await vi.advanceTimersByTimeAsync(300);
        expect([...mon.tokenizadores.cmm.defineConstants].sort()).toEqual(['A', 'B']);
    });

    it('modelo criado depois, ou que vira C+- depois, entra; outra linguagem e repetido nao', async () => {
        const mon = monacoFalso();
        setupCMMLanguage(mon);
        const novo = modelo('#define K 1');
        mon.modelos.push(novo);
        mon.aoCriarModelo(novo);
        mon.aoCriarModelo(novo);
        expect(novo.ouvintes).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(300);
        expect(mon.tokenizadores.cmm.defineConstants).toEqual(['K']);

        const v = modelo('', 'verilog');
        mon.aoCriarModelo(v);
        mon.aoCriarModelo(null);
        expect(v.ouvintes).toHaveLength(0);
        v.lingua = 'cmm';
        mon.aoMudarLinguagem({ model: v });
        expect(v.ouvintes).toHaveLength(1);
    });
});
