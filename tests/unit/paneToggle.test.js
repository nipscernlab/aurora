import { describe, it, expect } from 'vitest';
import { resolvePaneSize, PANE } from '../../js/utils/pane_size.js';

// O painel de terminais recolhido nao tinha caminho de volta: clicar numa aba
// so trocava de conteudo, o divisor horizontal nao escutava duplo clique, e
// nao havia botao nem comando. A regra de "recolhido" e o que liga o arrasto
// (que produz o estado) aos gestos de reabrir (que o desfazem); se ela mudar
// de um lado sem mudar do outro, o painel volta a ficar sem volta.
//
// `terminalRecolhido()` mora em js/utils/resize.js, que toca o DOM no topo do
// modulo e nao carrega no Node. O que se testa aqui e a regra dele: o arrasto
// so produz dois estados que a pessoa le como fechado, zero e o piso, e os
// dois tem de contar como recolhido.
const recolhido = (altura) => altura <= PANE.MIN_TERMINAL;

describe('o estado recolhido do painel de terminais', () => {
    it('o arrasto alem do limiar zera a altura', () => {
        const h = resolvePaneSize(PANE.COLLAPSE_TERMINAL - 1, {
            min: PANE.MIN_TERMINAL, collapseAt: PANE.COLLAPSE_TERMINAL, max: 600,
        });
        expect(h).toBe(0);
        expect(recolhido(h)).toBe(true);
    });

    it('parar entre o limiar e o piso encosta no piso, que so mostra a faixa de abas', () => {
        const h = resolvePaneSize(PANE.COLLAPSE_TERMINAL + 2, {
            min: PANE.MIN_TERMINAL, collapseAt: PANE.COLLAPSE_TERMINAL, max: 600,
        });
        expect(h).toBe(PANE.MIN_TERMINAL);
        // O piso e a altura da faixa de abas: para quem olha, e o mesmo que
        // fechado, entao reabrir tem de valer aqui tambem.
        expect(recolhido(h)).toBe(true);
    });

    it('qualquer altura util nao conta como recolhido', () => {
        for (const pedido of [PANE.MIN_TERMINAL + 1, 120, 240, 600]) {
            const h = resolvePaneSize(pedido, {
                min: PANE.MIN_TERMINAL, collapseAt: PANE.COLLAPSE_TERMINAL, max: 600,
            });
            expect(recolhido(h), `altura ${h} deveria contar como aberto`).toBe(false);
        }
    });

    it('a altura padrao de reabertura passa pelo mesmo teto do arrasto', () => {
        // Numa janela pequena, devolver os 240 px do padrao comeria o editor.
        const teto = 90;
        const h = resolvePaneSize(240, {
            min: PANE.MIN_TERMINAL, collapseAt: PANE.COLLAPSE_TERMINAL, max: teto,
        });
        expect(h).toBe(teto);
        expect(recolhido(h)).toBe(false);
    });
});
