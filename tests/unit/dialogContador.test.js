// @vitest-environment happy-dom
//
// O botao de confirmar com contagem (js/ui/dialog_manager.js).
//
// Numa acao sem volta facil, como mandar a pasta do projeto para a Lixeira, o
// botao de confirmar nasce desabilitado e conta 5, 4, 3, 2, 1 antes de
// liberar. Nao e enfeite: e o tempo de ler o caminho que vai embora e
// desistir. O que se prova aqui e a contagem em si, o rotulo a cada segundo,
// que o Enter nao atravessa o botao travado, e que cancelar no meio para o
// relogio.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/ui/help_link.js', () => ({ abrirAjudaDe: () => {} }));

import { showDialog, rotuloComContador } from '../../js/ui/dialog_manager.js';

const botaoDe = (acao) => document.querySelector(`.confirm-btn[data-action="${acao}"]`);

beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); });

describe('rotuloComContador', () => {
    it('escreve o que falta entre parenteses, e o rotulo limpo no fim', () => {
        expect(rotuloComContador('Excluir', 5)).toBe('Excluir (5)');
        expect(rotuloComContador('Excluir', 1)).toBe('Excluir (1)');
        expect(rotuloComContador('Excluir', 0)).toBe('Excluir');
        expect(rotuloComContador('Excluir', -3)).toBe('Excluir');
    });
});

describe('showDialog com countdown', () => {
    it('conta 5, 4, 3, 2, 1 e libera o botao no fim', async () => {
        showDialog({
            title: 't', message: 'm',
            buttons: [
                { label: 'Cancelar', action: 'cancel', type: 'cancel' },
                { label: 'Excluir', action: 'trash', type: 'danger', countdown: 5 },
            ],
        });
        const b = botaoDe('trash');
        expect(b.disabled).toBe(true);
        expect(b.textContent.trim()).toBe('Excluir (5)');
        const vistos = [];
        for (let i = 0; i < 4; i++) { vi.advanceTimersByTime(1000); vistos.push(b.textContent.trim()); }
        expect(vistos).toEqual(['Excluir (4)', 'Excluir (3)', 'Excluir (2)', 'Excluir (1)']);
        expect(b.disabled).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(b.disabled).toBe(false);
        expect(b.textContent.trim()).toBe('Excluir');
        // O cancelar nunca esteve travado.
        expect(botaoDe('cancel').disabled).toBe(false);
    });

    it('o Enter nao atravessa o botao travado, e atravessa depois', async () => {
        const p = showDialog({
            title: 't', message: 'm',
            buttons: [{ label: 'Excluir', action: 'trash', type: 'danger', countdown: 2 }],
        });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        let resolvido = null;
        p.then((a) => { resolvido = a; });
        await Promise.resolve();
        expect(resolvido).toBeNull();

        vi.advanceTimersByTime(2000);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        vi.advanceTimersByTime(300);          // a saida animada do dialogo
        await Promise.resolve();
        expect(resolvido).toBe('trash');
    });

    it('clicar no botao travado nao confirma', async () => {
        const p = showDialog({
            title: 't', message: 'm',
            buttons: [{ label: 'Excluir', action: 'trash', type: 'danger', countdown: 3 }],
        });
        let resolvido = null;
        p.then((a) => { resolvido = a; });
        botaoDe('trash').click();
        vi.advanceTimersByTime(300);
        await Promise.resolve();
        expect(resolvido).toBeNull();
    });

    it('cancelar no meio da contagem para o relogio', async () => {
        const p = showDialog({
            title: 't', message: 'm',
            buttons: [
                { label: 'Cancelar', action: 'cancel', type: 'cancel' },
                { label: 'Excluir', action: 'trash', type: 'danger', countdown: 5 },
            ],
        });
        vi.advanceTimersByTime(1000);
        botaoDe('cancel').click();
        vi.advanceTimersByTime(300);
        await expect(p).resolves.toBe('cancel');
        // Nenhum intervalo sobrou contando no vazio.
        expect(vi.getTimerCount()).toBe(0);
    });

    it('sem countdown, nada muda: o botao nasce liberado', () => {
        showDialog({ title: 't', message: 'm', buttons: [{ label: 'Ok', action: 'ok', type: 'save' }] });
        expect(botaoDe('ok').disabled).toBe(false);
        expect(botaoDe('ok').textContent.trim()).toBe('Ok');
    });
});
