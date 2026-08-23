/**
 * O que um clique faz com a seleção da árvore.
 *
 * A regra que mais custa errar é a âncora do Shift. Ela é o último clique SEM
 * Shift, e não o último item selecionado: se andar junto, arrastar o intervalo
 * para cima e para baixo come a seleção em vez de crescer e encolher a partir
 * do mesmo ponto, e o usuário só descobre quando apaga o que não queria.
 */

import { describe, it, expect } from 'vitest';

import { nextSelection, pruneSelection, topMostPaths } from '../../js/tree/tree_selection.js';

// A ordem da tela, que é a do DOM: uma pasta fechada não põe filhos aqui.
const visible = ['C:/p/a.v', 'C:/p/b.v', 'C:/p/sub', 'C:/p/sub/c.v', 'C:/p/d.v'];

describe('nextSelection', () => {
    it('clique simples troca a seleção e move a âncora', () => {
        const r = nextSelection({ visible, selected: ['C:/p/a.v', 'C:/p/b.v'], anchor: 'C:/p/a.v', path: 'C:/p/d.v' });
        expect(r).toEqual({ selected: ['C:/p/d.v'], anchor: 'C:/p/d.v' });
    });

    it('Ctrl+clique soma, e um segundo Ctrl+clique no mesmo item tira', () => {
        const somou = nextSelection({ visible, selected: ['C:/p/a.v'], anchor: 'C:/p/a.v', path: 'C:/p/d.v', ctrl: true });
        expect(somou).toEqual({ selected: ['C:/p/a.v', 'C:/p/d.v'], anchor: 'C:/p/d.v' });

        const tirou = nextSelection({ visible, selected: somou.selected, anchor: somou.anchor, path: 'C:/p/a.v', ctrl: true });
        expect(tirou).toEqual({ selected: ['C:/p/d.v'], anchor: 'C:/p/a.v' });
    });

    it('Shift+clique pega o intervalo na ordem da tela, nos dois sentidos', () => {
        const desce = nextSelection({ visible, selected: ['C:/p/b.v'], anchor: 'C:/p/b.v', path: 'C:/p/d.v', shift: true });
        expect(desce.selected).toEqual(['C:/p/b.v', 'C:/p/sub', 'C:/p/sub/c.v', 'C:/p/d.v']);

        const sobe = nextSelection({ visible, selected: ['C:/p/d.v'], anchor: 'C:/p/d.v', path: 'C:/p/b.v', shift: true });
        expect(sobe.selected).toEqual(['C:/p/b.v', 'C:/p/sub', 'C:/p/sub/c.v', 'C:/p/d.v']);
    });

    it('a âncora não anda no Shift, então o intervalo cresce e encolhe do mesmo ponto', () => {
        const grande = nextSelection({ visible, selected: ['C:/p/a.v'], anchor: 'C:/p/a.v', path: 'C:/p/d.v', shift: true });
        expect(grande.anchor).toBe('C:/p/a.v');
        const menor = nextSelection({ visible, selected: grande.selected, anchor: grande.anchor, path: 'C:/p/b.v', shift: true });
        expect(menor.selected).toEqual(['C:/p/a.v', 'C:/p/b.v']);
        expect(menor.anchor).toBe('C:/p/a.v');
    });

    it('Ctrl+Shift soma o intervalo ao que já estava', () => {
        const r = nextSelection({
            visible, selected: ['C:/p/a.v'], anchor: 'C:/p/sub', path: 'C:/p/d.v', ctrl: true, shift: true,
        });
        expect(r.selected).toEqual(['C:/p/a.v', 'C:/p/sub', 'C:/p/sub/c.v', 'C:/p/d.v']);
        expect(r.anchor).toBe('C:/p/sub');
    });

    it('Shift sem âncora, ou com âncora que saiu da tela, vira clique simples', () => {
        expect(nextSelection({ visible, selected: [], anchor: null, path: 'C:/p/b.v', shift: true }))
            .toEqual({ selected: ['C:/p/b.v'], anchor: 'C:/p/b.v' });
        expect(nextSelection({ visible, selected: [], anchor: 'C:/p/sumiu.v', path: 'C:/p/b.v', shift: true }))
            .toEqual({ selected: ['C:/p/b.v'], anchor: 'C:/p/b.v' });
    });

    it('compara caminho sem distinguir barra nem maiúscula, porque é Windows', () => {
        const r = nextSelection({
            visible, selected: ['c:\\p\\a.v'], anchor: 'c:\\p\\a.v', path: 'C:/p/a.v', ctrl: true,
        });
        expect(r.selected).toEqual([]);
    });
});

describe('pruneSelection', () => {
    it('fica só quem ainda existe depois do redesenho', () => {
        expect(pruneSelection(['C:/p/a.v', 'C:/p/foi.v'], visible)).toEqual(['C:/p/a.v']);
        expect(pruneSelection([], visible)).toEqual([]);
    });
});

describe('topMostPaths', () => {
    it('some o filho quando a pasta dele também está selecionada', () => {
        expect(topMostPaths(['C:/p/sub', 'C:/p/sub/c.v', 'C:/p/a.v'])).toEqual(['C:/p/sub', 'C:/p/a.v']);
    });

    it('irmãos não se comem', () => {
        expect(topMostPaths(['C:/p/a.v', 'C:/p/ab.v'])).toEqual(['C:/p/a.v', 'C:/p/ab.v']);
    });
});
