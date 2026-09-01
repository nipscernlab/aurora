// @vitest-environment happy-dom
//
// O menu de botao direito da arvore de arquivos (js/project/project_tree_actions.js).
//
// A categoria synth-vs-testbench e adivinhada do conteudo do arquivo. A
// adivinhacao acerta muito, mas nao sempre: um testbench recem escrito, ainda
// sem $dumpvars e sem "tb" no nome, e lido como sintetizavel. O menu mostrava
// so o marcador da categoria adivinhada, entao nesse caso a unica opcao
// oferecida era "definir como top level" e nao havia gesto nenhum para dizer
// que aquilo era o testbench: a pessoa ficava presa no palpite errado.
//
// O que se prova aqui e que os dois marcadores aparecem em todo .v/.sv,
// qualquer que seja a categoria, e que cada um oferece a acao certa para o
// estado em que o arquivo esta.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// O modulo puxa o TabManager, que registra listeners de IPC ao ser importado
// (ARCHITECTURE.md §8, "efeitos colaterais de import"). O hoisted corre antes
// dos imports, entao a ponte falsa ja esta de pe quando isso acontece.
vi.hoisted(() => {
    const nada = () => Promise.resolve();
    globalThis.window.electronAPI = new Proxy({}, { get: () => nada });
});

import { ActionsMixin } from '../../js/project/project_tree_actions.js';

/** O minimo de `this` que o showContextMenu usa. */
function contexto() {
    return {
        // Como no real: abrir um menu tira o anterior da tela. Sem isso os
        // cards se empilham e a leitura pega o do teste passado.
        closeAllTreeMenus() { document.getElementById('verilog-context-menu')?.remove(); },
        closeContextMenu() { document.getElementById('verilog-context-menu')?.remove(); },
        getFileExtension(nome) {
            const i = String(nome).lastIndexOf('.');
            return i < 0 ? '' : String(nome).slice(i).toLowerCase();
        },
    };
}

const evento = { pageX: 10, pageY: 10 };

/** As acoes (data-action) que o menu oferece para um arquivo. */
function acoesPara(file) {
    ActionsMixin.showContextMenu.call(contexto(), evento, file, 0);
    const menu = document.getElementById('verilog-context-menu');
    return [...menu.querySelectorAll('.context-menu-item')].map((el) => el.dataset.action);
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; });

describe('marcar top level e testbench', () => {
    it('oferece os dois marcadores num .v lido como sintetizavel', () => {
        // O caso que travava: sem "marcar como testbench" aqui, um testbench
        // classificado errado nao tinha como ser corrigido pela interface.
        const acoes = acoesPara({ name: 'somador_top.v', path: 'C:/p/somador_top.v', category: 'synthesizable' });
        expect(acoes).toContain('set-top-level');
        expect(acoes).toContain('set-testbench');
    });

    it('oferece os dois marcadores num .v lido como testbench', () => {
        const acoes = acoesPara({ name: 'somador_tb.v', path: 'C:/p/somador_tb.v', category: 'testbench' });
        expect(acoes).toContain('set-top-level');
        expect(acoes).toContain('set-testbench');
    });

    it('vale para .sv tambem', () => {
        const acoes = acoesPara({ name: 'algo.sv', path: 'C:/p/algo.sv', category: 'synthesizable' });
        expect(acoes).toContain('set-top-level');
        expect(acoes).toContain('set-testbench');
    });

    it('oferece desmarcar quando o arquivo ja e o top da sua categoria', () => {
        expect(acoesPara({ name: 'top.v', path: 'C:/p/top.v', category: 'synthesizable', isTopLevel: true }))
            .toContain('remove-top-level');
        expect(acoesPara({ name: 'tb.v', path: 'C:/p/tb.v', category: 'testbench', isTopLevel: true }))
            .toContain('remove-testbench');
    });

    it('num testbench marcado, o outro marcador continua oferecendo virar top level', () => {
        // A saida do palpite errado tem que existir nos dois sentidos: um synth
        // lido como testbench precisa poder voltar a ser synth.
        const acoes = acoesPara({ name: 'tb.v', path: 'C:/p/tb.v', category: 'testbench', isTopLevel: true });
        expect(acoes).toContain('set-top-level');
    });

    it('num .py so cabe testbench, cocotb nao sintetiza', () => {
        const acoes = acoesPara({ name: 'teste.py', path: 'C:/p/teste.py', category: 'testbench' });
        expect(acoes).toContain('set-testbench');
        expect(acoes).not.toContain('set-top-level');
    });

    it('num arquivo que nao e fonte, so sobra apagar', () => {
        expect(acoesPara({ name: 'notas.txt', path: 'C:/p/notas.txt' })).toEqual(['delete']);
    });
});
