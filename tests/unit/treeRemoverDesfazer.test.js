// @vitest-environment happy-dom
//
// Tirar um arquivo da arvore pelo x da linha, e o botao de desfazer que o
// card da notificacao ganhou (js/project/project_tree_actions.js).
//
// Tirar da arvore nao apaga do disco, so a referencia no .spf, e mesmo assim
// era irreversivel: quem errava o x reimportava o arquivo e remarcava topo e
// testbench a mao. O que se prova aqui: a remocao tira a entrada E a marca de
// topo, o card oferece o desfazer, o desfazer repoe as duas coisas, e o botao
// so funciona uma vez.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    const nada = () => Promise.resolve();
    globalThis.window.electronAPI = new Proxy({}, { get: () => nada });
});

// O .spf de mentira: um objeto vivo que os mutators alteram no lugar.
const disco = { spf: null };
vi.mock('../../js/project/spf_store.js', () => ({
    SpfStore: {
        update: async (_p, mutator) => { mutator(disco.spf); return disco.spf; },
        read: async () => disco.spf,
    },
}));
vi.mock('../../js/project/project_store.js', () => ({
    ProjectStore: { getSpfPath: () => 'C:/p/p.spf', getProjectPath: () => 'C:/p' },
}));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: {} }));

import { ActionsMixin } from '../../js/project/project_tree_actions.js';

const ARQ = 'C:/p/Hardware/contador.v';

function contexto() {
    return Object.assign(Object.create(ActionsMixin), {
        verilogFiles: [{ path: ARQ, name: 'contador.v' }],
        _normalizePath: (p) => String(p).replace(/\\/g, '/').toLowerCase(),
        showNotification() {},
    });
}

const cards = () => Array.from(document.querySelectorAll('aurora-toast'));
// Os cards saem um a um. Zerar o body destacaria o container que o
// notification.js guarda em variavel de modulo: os cards seguintes iriam
// para uma arvore fora do documento, onde o Lit nunca os renderiza.
const limparCards = () => cards().forEach((c) => c.remove());

describe('remover da arvore com desfazer', () => {
    beforeEach(() => {
        limparCards();
        disco.spf = {
            topLevelFile: ARQ,
            testbenchFile: '',
            synthesizableFiles: [{ path: ARQ, name: 'contador.v', isTopLevel: true }],
            testbenchFiles: [],
        };
    });
    afterEach(limparCards);

    it('remover tira a entrada da lista e a marca de topo, e oferece desfazer', async () => {
        await contexto()._removeFileByPath(ARQ);
        expect(disco.spf.synthesizableFiles).toEqual([]);
        expect(disco.spf.topLevelFile).toBe('');

        const [card] = cards();
        expect(card).toBeTruthy();
        expect(card.actionLabel).toBe('notification.tree.undo');
        expect(typeof card.action).toBe('function');
    });

    it('desfazer repoe a entrada com a marca de topo que ela tinha', async () => {
        await contexto()._removeFileByPath(ARQ);
        const [card] = cards();
        await card.action();
        expect(disco.spf.synthesizableFiles).toEqual([
            { path: ARQ, name: 'contador.v', isTopLevel: true },
        ]);
        expect(disco.spf.topLevelFile).toBe(ARQ);
    });

    it('desfazer duas vezes nao duplica a entrada', async () => {
        await contexto()._removeFileByPath(ARQ);
        const [card] = cards();
        await card.action();
        await card.action();
        expect(disco.spf.synthesizableFiles).toHaveLength(1);
    });

    it('se a pessoa escolheu outro topo antes de desfazer, a escolha dela fica', async () => {
        await contexto()._removeFileByPath(ARQ);
        disco.spf.topLevelFile = 'C:/p/Hardware/outro.v';
        const [card] = cards();
        await card.action();
        expect(disco.spf.topLevelFile).toBe('C:/p/Hardware/outro.v');
        expect(disco.spf.synthesizableFiles).toHaveLength(1);
    });

    it('arquivo que nao esta na arvore: nada muda, nenhum card', async () => {
        await contexto()._removeFileByPath('C:/p/Hardware/nao.v');
        expect(disco.spf.synthesizableFiles).toHaveLength(1);
        expect(cards()).toHaveLength(0);
    });
});

describe('aurora-toast com botao de acao', () => {
    beforeEach(limparCards);

    it('sem actionLabel nao ha botao; com ele, o clique roda a acao e fecha o card', async () => {
        const { showCardNotification } = await import('../../js/ui/notification.js');
        const semAcao = showCardNotification('a', 'info', 0);
        await semAcao.updateComplete;
        expect(semAcao.shadowRoot.querySelector('.action')).toBeNull();

        const rodou = vi.fn();
        const card = showCardNotification('b', 'success', 0, undefined, {
            action: { label: 'Desfazer', run: rodou },
        });
        await card.updateComplete;
        const botao = card.shadowRoot.querySelector('.action');
        expect(botao.textContent).toBe('Desfazer');
        botao.click();
        await Promise.resolve();
        expect(rodou).toHaveBeenCalledTimes(1);
        expect(card.dismissing).toBe(true);
    });
});
