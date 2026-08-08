/**
 * Testes da regra de tamanho dos painéis.
 *
 * Dois bugs reais motivaram isto. O painel de IA calculava o teto como
 * `window.innerWidth * 0.7`, sem descontar a árvore de arquivos nem reservar
 * espaço para o editor; como o container do editor tem `min-width: 0`, ele era
 * espremido até zero e o painel parecia sobrepor o terminal e os splits. E
 * nenhum dos painéis colapsava por arrasto: o clamp travava no mínimo, então o
 * `is-collapsed` existia mas era inalcançável pelo divisor.
 */

import { describe, it, expect } from 'vitest';

import { resolvePaneSize, maxLateralWidth, PANE } from '../../js/utils/pane_size.js';

const lateral = { min: PANE.MIN_LATERAL, collapseAt: PANE.COLLAPSE_LATERAL, max: 800 };

describe('resolvePaneSize', () => {
  it('devolve o tamanho pedido quando ele cabe', () => {
    expect(resolvePaneSize(400, lateral)).toBe(400);
  });

  it('encosta no minimo em vez de encolher demais', () => {
    expect(resolvePaneSize(150, lateral)).toBe(PANE.MIN_LATERAL);
    expect(resolvePaneSize(PANE.COLLAPSE_LATERAL, lateral)).toBe(PANE.MIN_LATERAL);
  });

  it('COLAPSA quando o arrasto forca alem do limiar', () => {
    // O comportamento do VS Code, e o que faltava: dava para encostar no
    // minimo, mas nunca fechar sem tirar a mao do divisor.
    expect(resolvePaneSize(PANE.COLLAPSE_LATERAL - 1, lateral)).toBe(0);
    expect(resolvePaneSize(10, lateral)).toBe(0);
    expect(resolvePaneSize(0, lateral)).toBe(0);
  });

  it('colapsa tambem quando o arrasto passa da borda e fica negativo', () => {
    expect(resolvePaneSize(-120, lateral)).toBe(0);
  });

  it('respeita o teto', () => {
    expect(resolvePaneSize(5000, lateral)).toBe(800);
  });

  it('em janela apertada, o teto vence o minimo em vez de estourar', () => {
    // Sem isto, um teto menor que o minimo devolveria o minimo e o painel
    // passaria do espaco disponivel.
    expect(resolvePaneSize(300, { min: 320, collapseAt: 160, max: 200 })).toBe(200);
  });

  it('nao quebra com entrada invalida', () => {
    expect(resolvePaneSize(NaN, lateral)).toBe(PANE.MIN_LATERAL);
    expect(resolvePaneSize(undefined, lateral)).toBe(PANE.MIN_LATERAL);
  });
});

describe('maxLateralWidth', () => {
  it('desconta o painel do outro lado e o minimo do editor', () => {
    // Janela 1600, arvore 260, editor precisa de 320 -> sobram 1020.
    expect(maxLateralWidth(1600, 260, PANE.MIN_EDITOR, PANE.MIN_AI)).toBe(1020);
  });

  it('e isso e o que impedia o painel de espremer o editor a zero', () => {
    // A regra antiga era innerWidth * 0.7. Numa janela de 1000 com arvore de
    // 260, ela permitia 700 e sobravam 40 para o editor.
    const antigo = 1000 * 0.7;
    const novo = maxLateralWidth(1000, 260, PANE.MIN_EDITOR, PANE.MIN_AI);
    expect(antigo).toBe(700);
    expect(novo).toBe(420);
    expect(1000 - 260 - novo).toBeGreaterThanOrEqual(PANE.MIN_EDITOR);
  });

  it('nunca devolve abaixo do proprio piso, mesmo em janela minuscula', () => {
    expect(maxLateralWidth(600, 400, PANE.MIN_EDITOR, PANE.MIN_AI)).toBe(PANE.MIN_AI);
  });

  it('trata vizinho ausente como zero', () => {
    expect(maxLateralWidth(1200, null, 320, 180)).toBe(880);
  });
});

describe('os limiares fazem sentido entre si', () => {
  it('o ponto de colapso e sempre menor que o minimo', () => {
    expect(PANE.COLLAPSE_LATERAL).toBeLessThan(PANE.MIN_LATERAL);
    expect(PANE.COLLAPSE_AI).toBeLessThan(PANE.MIN_AI);
    expect(PANE.COLLAPSE_TERMINAL).toBeLessThan(PANE.MIN_TERMINAL);
  });

  it('o painel de IA tem piso maior que o lateral comum, porque e um chat', () => {
    expect(PANE.MIN_AI).toBeGreaterThan(PANE.MIN_LATERAL);
  });
});

describe('a largura salva tem que passar pelo mesmo limite', () => {
    // A regressao que este bloco guarda: a regra existia, mas so o ARRASTO a
    // aplicava. Reabrir o painel restaurava a largura salva checando so o piso,
    // e nada reavaliava ao encolher a janela. Bastava salvar numa janela larga
    // e abrir numa estreita para o painel comer o terminal de novo.
    it('largura salva numa janela larga nao cabe numa estreita', () => {
        const salva = 900; // legitima numa janela de 2560
        const teto = maxLateralWidth(1280, 260, PANE.MIN_EDITOR, PANE.MIN_AI);
        const aplicada = resolvePaneSize(salva, {
            min: PANE.MIN_AI, collapseAt: PANE.COLLAPSE_AI, max: teto,
        });
        expect(aplicada).toBe(700);
        expect(aplicada).toBeLessThan(salva);
        // E o editor continua com o espaco dele, que era o ponto.
        expect(1280 - 260 - aplicada).toBeGreaterThanOrEqual(PANE.MIN_EDITOR);
    });

    it('o painel cede ate o proprio minimo antes de invadir o editor', () => {
        // Janela apertada: o teto cai abaixo do minimo do painel, e ai vence o
        // teto. Melhor um painel menor que o piso do que um editor a zero.
        const teto = maxLateralWidth(700, 260, PANE.MIN_EDITOR, PANE.MIN_AI);
        expect(resolvePaneSize(900, {
            min: PANE.MIN_AI, collapseAt: PANE.COLLAPSE_AI, max: teto,
        })).toBe(PANE.MIN_AI);
    });

    it('a arvore desconta o painel de IA, e nao so a janela', () => {
        // O mesmo de mao trocada: com a IA aberta em 480, reabrir a arvore com
        // 600 salvos nao pode devolver 600.
        const teto = maxLateralWidth(1280, 480, PANE.MIN_EDITOR, PANE.MIN_LATERAL);
        expect(resolvePaneSize(600, {
            min: PANE.MIN_LATERAL, collapseAt: PANE.COLLAPSE_LATERAL, max: teto,
        })).toBe(480);
    });
});
