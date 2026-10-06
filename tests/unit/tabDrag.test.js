// @vitest-environment happy-dom
//
// js/tabs/tab_drag.js: arrastar uma aba reordena a barra ao vivo, anima as
// vizinhas (FLIP) e grava a ordem no localStorage.
//
// Caracterizacao escrita antes de o modulo virar .ts, contra o .js antigo. A
// barra e montada no DOM; a posicao de cada aba sai da ordem dela no
// container (100 px cada), para o FLIP e a escolha do ponto de insercao terem
// o que medir.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tabDrag } from '../../js/tabs/tab_drag.js';

let barra;

function aba(caminho) {
    const t = document.createElement('div');
    t.className = 'tab';
    t.setAttribute('data-path', caminho);
    t.getBoundingClientRect = () => {
        const i = Array.from(barra.children).indexOf(t);
        return { left: i * 100, width: 100, top: i * 20, height: 20, right: i * 100 + 100, bottom: 20 };
    };
    return t;
}

function montar(caminhos = ['a', 'b', 'c']) {
    barra = document.createElement('div');
    barra.id = 'tabs-container';
    document.body.appendChild(barra);
    for (const c of caminhos) barra.appendChild(aba(c));
    const dono = Object.assign(Object.create(tabDrag), {});
    return dono;
}

const ordem = () => Array.from(barra.querySelectorAll('.tab')).map((t) => t.getAttribute('data-path'));
const daAba = (c) => barra.querySelector(`[data-path="${c}"]`);

function transferencia() {
    return {
        dados: {},
        effectAllowed: '',
        dropEffect: '',
        setData(k, v) { this.dados[k] = v; },
        setDragImage: vi.fn(),
        clearData: vi.fn(),
    };
}
function disparar(alvo, tipo, extra = {}) {
    const e = Object.assign(new Event(tipo, { bubbles: true, cancelable: true }), extra);
    alvo.dispatchEvent(e);
    return e;
}

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.SplitEditorManager;
    window.requestAnimationFrame = (cb) => { cb(); return 1; };
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('arrastar', () => {
    it('arrastar a primeira para o fim reordena ao vivo, anima as vizinhas e grava a ordem', async () => {
        const dono = montar();
        dono.initSortableTabs();
        window.SplitEditorManager = {};
        const dt = transferencia();

        disparar(daAba('a'), 'dragstart', { clientX: 50, dataTransfer: dt });
        expect(dt.effectAllowed).toBe('move');
        expect(dt.dados['application/x-aurora-tab-path']).toBe('a');
        expect(dt.setDragImage).toHaveBeenCalled();
        expect(window.SplitEditorManager).toEqual({ _dragActive: true, _dragSourcePane: 0 });
        await vi.advanceTimersByTimeAsync(10);
        expect(daAba('a').classList.contains('dragging')).toBe(true);
        expect(barra.classList.contains('dragging-active')).toBe(true);

        // Pouco movimento ainda nao reordena; o evento final com x = 0 e ignorado.
        disparar(daAba('a'), 'drag', { clientX: 55 });
        disparar(daAba('a'), 'drag', { clientX: 0 });
        expect(ordem()).toEqual(['a', 'b', 'c']);

        disparar(daAba('a'), 'drag', { clientX: 290 });
        expect(ordem()).toEqual(['b', 'c', 'a']);
        // A vizinha que andou parte de onde estava.
        expect(daAba('b').style.transition).toBe('transform 190ms var(--ease-aurora)');

        // Ja no fim: nada a fazer.
        disparar(daAba('a'), 'drag', { clientX: 295 });
        expect(ordem()).toEqual(['b', 'c', 'a']);

        disparar(daAba('a'), 'dragend');
        expect(daAba('a').classList.contains('dragging')).toBe(false);
        expect(barra.classList.contains('dragging-active')).toBe(false);
        expect(daAba('b').style.transform).toBe('');
        expect(window.SplitEditorManager).toEqual({ _dragActive: false, _dragSourcePane: null });
        expect(JSON.parse(localStorage.getItem('editorTabOrder'))).toEqual(['b', 'c', 'a']);
    });

    it('arrastar para antes de outra; a aba no proprio lugar nao mexe', async () => {
        const dono = montar(['a', 'b', 'c']);
        dono.initSortableTabs();
        disparar(daAba('c'), 'dragstart', { clientX: 250, dataTransfer: transferencia() });
        await vi.advanceTimersByTimeAsync(10);
        disparar(daAba('c'), 'drag', { clientX: 10 });
        expect(ordem()).toEqual(['c', 'a', 'b']);
        // A referencia agora e a propria vizinha seguinte: ja esta antes dela.
        disparar(daAba('c'), 'drag', { clientX: 20 });
        expect(ordem()).toEqual(['c', 'a', 'b']);
    });

    it('soltar na barra termina o arraste; dragover pede mover', async () => {
        const dono = montar();
        dono.initSortableTabs();
        const dt = transferencia();
        disparar(daAba('b'), 'dragstart', { clientX: 150, dataTransfer: dt });
        const sobre = disparar(barra, 'dragover', { dataTransfer: dt });
        expect(sobre.defaultPrevented).toBe(true);
        expect(dt.dropEffect).toBe('move');

        dt.clearData = () => { throw new Error('protegido'); };
        disparar(barra, 'drop', { dataTransfer: dt });
        expect(JSON.parse(localStorage.getItem('editorTabOrder'))).toEqual(['a', 'b', 'c']);
        // Antes dos 10 ms: a aba que ja saiu do arraste nao ganha a classe.
        await vi.advanceTimersByTimeAsync(10);
        expect(daAba('b').classList.contains('dragging')).toBe(false);
    });

    it('fim de arraste sem aba arrastada nao grava; arraste sem aba nao comeca', () => {
        const dono = montar();
        dono.initSortableTabs();
        disparar(daAba('a'), 'dragend');
        disparar(daAba('a'), 'drag', { clientX: 300 });
        expect(localStorage.getItem('editorTabOrder')).toBeNull();
        const solto = document.createElement('span');
        barra.appendChild(solto);
        disparar(solto, 'dragstart', { clientX: 1, dataTransfer: transferencia() });
        disparar(daAba('a'), 'drag', { clientX: 300 });
        expect(ordem()).toEqual(['a', 'b', 'c']);
    });

    it('uma reordenacao por quadro: enquanto o quadro nao chega, ignora', () => {
        const dono = montar();
        dono.initSortableTabs();
        const quadros = [];
        window.requestAnimationFrame = (cb) => { quadros.push(cb); return 1; };
        disparar(daAba('a'), 'dragstart', { clientX: 50, dataTransfer: transferencia() });
        disparar(daAba('a'), 'drag', { clientX: 290 });
        disparar(daAba('a'), 'drag', { clientX: 295 });
        expect(quadros).toHaveLength(1);
        disparar(daAba('a'), 'dragend');
        quadros[0]();
        expect(ordem()).toEqual(['a', 'b', 'c']);
    });

    it('aba nova ganha os ouvintes; o navegador nao abre o que escapa da barra', async () => {
        const dono = montar(['a']);
        dono.initSortableTabs();
        const nova = aba('n');
        barra.appendChild(nova);
        barra.appendChild(document.createTextNode('texto'));
        const outro = document.createElement('span');
        barra.appendChild(outro);
        await vi.advanceTimersByTimeAsync(0);
        expect(nova.draggable).toBe(true);
        expect(outro.draggable).not.toBe(true);
        expect(dono.tabObserver).toBeInstanceOf(window.MutationObserver);
        expect(disparar(window, 'dragover').defaultPrevented).toBe(true);
        expect(disparar(window, 'drop').defaultPrevented).toBe(true);
    });

    it('sem a barra no DOM, nao liga nada', () => {
        const dono = Object.create(tabDrag);
        dono.initSortableTabs();
        expect(dono.tabObserver).toBeUndefined();
    });
});

describe('ordem guardada', () => {
    it('restaura a ordem gravada, pulando o que ja nao esta aberto', () => {
        const dono = montar(['a', 'b', 'c']);
        localStorage.setItem('editorTabOrder', JSON.stringify(['c', 'sumiu', 'a']));
        dono.restoreTabOrder();
        expect(ordem()).toEqual(['b', 'c', 'a']);
    });

    it('sem ordem gravada, nada muda', () => {
        const dono = montar(['a', 'b']);
        dono.restoreTabOrder();
        expect(ordem()).toEqual(['a', 'b']);
    });
});

describe('getDragAfterElement', () => {
    it('a aba cujo meio fica logo abaixo do y; nenhuma alem do fim', () => {
        const dono = montar(['a', 'b', 'c']);
        daAba('b').classList.add('dragging');
        expect(dono.getDragAfterElement(barra, 5)?.getAttribute('data-path')).toBe('a');
        expect(dono.getDragAfterElement(barra, 25)?.getAttribute('data-path')).toBe('c');
        expect(dono.getDragAfterElement(barra, 500)).toBeUndefined();
    });
});
