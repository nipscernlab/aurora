// @vitest-environment happy-dom
//
// O menu de botao direito da arvore de arquivos (js/project/project_tree_actions.ts).
//
// Desde o TODO 13b (09/10/2026) o papel de cada arquivo e escolhido pela
// pessoa, nunca adivinhado do conteudo. O menu oferece trocar de papel
// ("marcar como sintese" / "marcar como testbench") e, dentro do papel que o
// arquivo tem, ser o topo dele: top level na sintese, testbench atual no
// testbench. Um arquivo sem papel so oferece escolher um.

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

describe('papel e topo no botao direito', () => {
    it('sintese: vira testbench, ou vira o top level', () => {
        expect(acoesPara({ name: 'somador.v', path: 'C:/p/somador.v', category: 'synthesizable' }))
            .toEqual(['mark-testbench', 'set-top-level', 'delete']);
        expect(acoesPara({ name: 'top.sv', path: 'C:/p/top.sv', category: 'synthesizable', isTopLevel: true }))
            .toEqual(['mark-testbench', 'remove-top-level', 'delete']);
    });

    it('testbench: vira sintese, ou vira o testbench atual', () => {
        expect(acoesPara({ name: 'tb.v', path: 'C:/p/tb.v', category: 'testbench' }))
            .toEqual(['mark-synth', 'set-testbench', 'delete']);
        expect(acoesPara({ name: 'tb.v', path: 'C:/p/tb.v', category: 'testbench', isTopLevel: true }))
            .toEqual(['mark-synth', 'remove-testbench', 'delete']);
    });

    it('sem papel: so escolher um, sem topo', () => {
        expect(acoesPara({ name: 'novo.v', path: 'C:/p/novo.v', category: 'unclassified' }))
            .toEqual(['mark-synth', 'mark-testbench', 'delete']);
    });

    it('header .vh recebe papel mas nunca e topo', () => {
        expect(acoesPara({ name: 'defs.vh', path: 'C:/p/defs.vh', category: 'unclassified' }))
            .toEqual(['mark-synth', 'mark-testbench', 'delete']);
        expect(acoesPara({ name: 'defs.vh', path: 'C:/p/defs.vh', category: 'synthesizable' }))
            .toEqual(['mark-testbench', 'delete']);
    });

    it('num .py so cabe testbench, cocotb nao sintetiza', () => {
        expect(acoesPara({ name: 'teste.py', path: 'C:/p/teste.py', category: 'testbench' }))
            .toEqual(['set-testbench', 'delete']);
    });

    it('num arquivo que nao e fonte, so sobra apagar', () => {
        expect(acoesPara({ name: 'notas.txt', path: 'C:/p/notas.txt' })).toEqual(['delete']);
    });
});
