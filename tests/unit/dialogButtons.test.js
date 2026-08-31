// @vitest-environment happy-dom
/**
 * Os botoes do dialogo comum (js/ui/dialog_manager.js).
 *
 * Duas coisas que quebraram calado. O `type` passa por uma lista de nomes
 * aceitos, e `primary` NAO estava nela: oito lugares do codigo o escrevem, e
 * todos caiam no `cancel`, entao a acao principal saia com a cara da
 * secundaria e o Enter, que procura `.save`/`.danger`, nao achava nada.
 *
 * E o rodape nao quebrava linha. Como os botoes tem `white-space: nowrap`, um
 * rotulo longo nao encolhe: no dialogo de energia a fileira pedia 344 px num
 * rodape de 327 e o Fechar escapava 17 px para fora da caixa, sobre o que
 * estivesse atras. O CSS agora quebra; aqui fica o outro lado, o nome do tipo.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
});

import { showDialog } from '../../js/ui/dialog_manager.js';

const abrir = (buttons) => {
    showDialog({ title: 't', message: 'm', buttons });
    return document.getElementById('custom-dialog-modal');
};
const classes = (modal) => [...modal.querySelectorAll('.confirm-btn')]
    .map((b) => [...b.classList].filter((c) => c !== 'confirm-btn').join(' '));

beforeEach(() => { document.body.innerHTML = ''; });

describe('o tipo de cada botao do dialogo', () => {
    it('primary vale o mesmo que save, que e a acao principal', () => {
        const modal = abrir([
            { label: 'Fechar', action: 'close', type: 'cancel' },
            { label: 'Abrir configuracoes de energia do Windows', action: 'abrir', type: 'primary' },
        ]);
        expect(classes(modal)).toEqual(['cancel', 'save']);
        // O Enter procura por este seletor: sem ele, a tecla nao fazia nada.
        expect(modal.querySelector('.confirm-btn.save')).not.toBeNull();
    });

    it('os tipos que ja existiam continuam como estavam', () => {
        const modal = abrir([
            { label: 'a', action: 'a', type: 'cancel' },
            { label: 'b', action: 'b', type: 'save' },
            { label: 'c', action: 'c', type: 'danger' },
            { label: 'd', action: 'd', type: 'dont-save' },
        ]);
        expect(classes(modal)).toEqual(['cancel', 'save', 'danger', 'dont-save']);
    });

    it('um tipo desconhecido continua caindo no cancel, e nao quebra a tela', () => {
        const modal = abrir([{ label: 'x', action: 'x', type: 'roxo' }]);
        expect(classes(modal)).toEqual(['cancel']);
    });

    it('sem tipo nenhum tambem e cancel', () => {
        const modal = abrir([{ label: 'x', action: 'x' }]);
        expect(classes(modal)).toEqual(['cancel']);
    });
});
