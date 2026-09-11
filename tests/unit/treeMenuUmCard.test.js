// @vitest-environment happy-dom
//
// O menu de botao direito da visao de pastas (js/tree/standard_tree_crud.js).
//
// O card anterior fica 150 ms no DOM enquanto esvaece, e o fechamento o
// procurava pelo id, que o card novo tambem tinha. Dois cliques com o botao
// direito dentro desse intervalo fechavam o card errado e deixavam o novo
// sem quem o fechasse: um card por clique, empilhados na tela. O que se
// prova aqui e que, por mais depressa que se clique, ha um card visivel de
// cada vez, e que o ultimo ainda fecha com clique fora e com Escape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    const nada = () => Promise.resolve();
    globalThis.window.electronAPI = new Proxy({}, { get: () => nada });
});

vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: {} }));
vi.mock('../../js/tree/standard_tree_render.js', () => ({ standardTreeRenderer: {} }));
vi.mock('../../js/tree/tree_view.js', () => ({ treeView: {} }));
vi.mock('../../js/terminal/terminal.js', () => ({ switchTerminal: () => {} }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: () => {} }));
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: {} }));
vi.mock('../../js/project/project_store.js', () => ({
    ProjectStore: { subscribe: () => {}, getProjectPath: () => null },
}));
vi.mock('../../js/project/spf_store.js', () => ({ SpfStore: {} }));

import { standardTreeCrud } from '../../js/tree/standard_tree_crud.js';
import { ActionsMixin } from '../../js/project/project_tree_actions.js';

const ITENS = [{ icon: 'ph-file-plus', label: 'New File...', run: () => {} }];

/** Cards ainda com id: os que esvaecem perdem o id ao fechar. */
const abertos = () => document.querySelectorAll('#standard-tree-context-menu').length;
/** Tudo que ainda esta na tela, esvaecendo ou nao. */
const naTela = () => document.querySelectorAll('.verilog-context-menu').length;

describe('menu da arvore: um card por vez', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });
    afterEach(() => {
        standardTreeCrud._closeMenu();
        vi.runAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('botao direito repetido sem esperar deixa so um card aberto', () => {
        for (let i = 0; i < 5; i++) {
            standardTreeCrud._closeMenu();
            standardTreeCrud._renderMenu(ITENS, 10 + i, 10 + i);
        }
        expect(abertos()).toBe(1);
        // Passado o esvaecer, os antigos sairam do DOM de verdade.
        vi.advanceTimersByTime(200);
        expect(naTela()).toBe(1);
    });

    it('o ultimo card ainda fecha com clique fora', () => {
        standardTreeCrud._closeMenu();
        standardTreeCrud._renderMenu(ITENS, 10, 10);
        standardTreeCrud._closeMenu();
        standardTreeCrud._renderMenu(ITENS, 20, 20);
        vi.advanceTimersByTime(1);
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(abertos()).toBe(0);
        vi.advanceTimersByTime(200);
        expect(naTela()).toBe(0);
    });

    it('o ultimo card ainda fecha com Escape', () => {
        standardTreeCrud._closeMenu();
        standardTreeCrud._renderMenu(ITENS, 10, 10);
        standardTreeCrud._closeMenu();
        standardTreeCrud._renderMenu(ITENS, 20, 20);
        vi.advanceTimersByTime(1);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(abertos()).toBe(0);
    });

    it('clicar dentro do card nao o fecha', () => {
        standardTreeCrud._closeMenu();
        standardTreeCrud._renderMenu(ITENS, 10, 10);
        vi.advanceTimersByTime(1);
        const card = document.getElementById('standard-tree-context-menu');
        card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(abertos()).toBe(1);
    });

    it('fechar e abrir nao deixa listener orfao no document', () => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        for (let i = 0; i < 3; i++) {
            standardTreeCrud._closeMenu();
            standardTreeCrud._renderMenu(ITENS, 10, 10);
            vi.advanceTimersByTime(1);
        }
        standardTreeCrud._closeMenu();
        const ligados = add.mock.calls.filter(([, fn]) => typeof fn === 'function').length;
        const desligados = remove.mock.calls.filter(([, fn]) => typeof fn === 'function').length;
        expect(desligados).toBe(ligados);
    });
});

// A visao de processadores tem os seus proprios cards (o "New File" de tres
// itens do print, e o menu de row). Eles fechavam pelo mesmo caminho e
// empilhavam do mesmo jeito.
describe('menu da visao de processadores: um card por vez', () => {
    /** O minimo de `this` que showCreateMenu e showContextMenu usam. */
    const ctx = () => Object.assign(Object.create(ActionsMixin), {
        verilogFiles: [],
        isTreeActive: true,
        getFileExtension(nome) {
            const i = String(nome).lastIndexOf('.');
            return i < 0 ? '' : String(nome).slice(i).toLowerCase();
        },
        createNewCocotbFile: () => {},
        createGitignore: () => {},
        handleContextMenuAction: () => {},
        deleteFile: () => {},
    });

    const criados = () => document.querySelectorAll('#verilog-create-menu').length;
    const deRow = () => document.querySelectorAll('#verilog-context-menu').length;
    const naTelaTodos = () =>
        document.querySelectorAll('.verilog-create-menu, .verilog-context-menu').length;

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });
    afterEach(() => {
        ActionsMixin.closeAllTreeMenus.call(ctx());
        vi.runAllTimers();
        vi.useRealTimers();
    });

    it('cinco cliques na area vazia deixam so um card "New File"', () => {
        const t = ctx();
        for (let i = 0; i < 5; i++) t.showCreateMenu(10 + i, 10 + i);
        expect(criados()).toBe(1);
        vi.advanceTimersByTime(300);
        expect(naTelaTodos()).toBe(1);
    });

    it('cinco cliques numa row deixam so um card de row', () => {
        const t = ctx();
        const file = { name: 'contador.v', path: 'c:/p/contador.v', category: 'synth' };
        for (let i = 0; i < 5; i++) t.showContextMenu({ pageX: 10, pageY: 10 }, file, 0);
        expect(deRow()).toBe(1);
        vi.advanceTimersByTime(300);
        expect(naTelaTodos()).toBe(1);
    });

    it('row depois de area vazia nao deixa os dois na tela', () => {
        const t = ctx();
        t.showCreateMenu(10, 10);
        t.showContextMenu({ pageX: 20, pageY: 20 }, { name: 'a.v', path: 'c:/p/a.v' }, 0);
        expect(criados()).toBe(0);
        expect(deRow()).toBe(1);
        vi.advanceTimersByTime(300);
        expect(naTelaTodos()).toBe(1);
    });

    it('o card "New File" que sobra ainda fecha com clique fora', () => {
        const t = ctx();
        t.showCreateMenu(10, 10);
        t.showCreateMenu(20, 20);
        vi.advanceTimersByTime(150);
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(criados()).toBe(0);
    });

    it('abrir e fechar o "New File" varias vezes nao acumula listener', () => {
        const t = ctx();
        // Conta os handlers de click que ficam pendurados no document: o
        // fechar-no-clique-fora era um closure novo por abertura e so se
        // removia ao disparar, entao abrir quatro vezes deixava quatro.
        const vivos = new Set();
        // Os originais vem do prototype: pegar de `document` apanharia o
        // espiao de outro teste e a chamada voltaria para dentro dele.
        const add = EventTarget.prototype.addEventListener;
        const remove = EventTarget.prototype.removeEventListener;
        document.addEventListener = (tipo, fn, o) => {
            if (tipo === 'click') vivos.add(fn);
            add.call(document, tipo, fn, o);
        };
        document.removeEventListener = (tipo, fn, o) => {
            if (tipo === 'click') vivos.delete(fn);
            remove.call(document, tipo, fn, o);
        };
        for (let i = 0; i < 4; i++) {
            t.showCreateMenu(10, 10);
            vi.advanceTimersByTime(150);
        }
        expect(vivos.size).toBe(1);
        t.closeCreateMenu();
        expect(vivos.size).toBe(0);
        delete document.addEventListener;
        delete document.removeEventListener;
    });
});
