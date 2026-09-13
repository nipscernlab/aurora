// @vitest-environment happy-dom
/**
 * A caixa de selecao de componente, durante um download.
 *
 * Pedido do Chrysthofer: enquanto baixa, a caixa nao pode ser desmarcada.
 *
 * O motivo esta em como a fila funciona. `baixarFila` le os marcados UMA vez,
 * no comeco, e percorre a lista item a item. Desmarcar no meio nao cancela o
 * que esta baixando nem tira o item da fila, entao a caixa passaria a mentir
 * sobre o que vai acontecer. No sentido contrario e pior: marcar durante o
 * download cria a expectativa de que aquele componente entra nesta rodada, e
 * ele nao entra, porque a lista ja foi lida.
 *
 * Dois cuidados que este arquivo fixa, os dois faceis de errar:
 *
 *   - `disabled`, e nao `readonly`. Input do tipo checkbox IGNORA `readonly`:
 *     usar a propriedade errada aqui daria a impressao de estar travado
 *     enquanto a caixa continuaria alternando ao clique;
 *   - destravar nos DOIS caminhos que terminam um download, a fila e o
 *     instalar avulso. Esquecer um deixa o painel travado ate a pessoa fechar
 *     e reabrir, o que parece um bug muito pior do que o que se consertou.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fonte = fs.readFileSync(path.join(RAIZ, 'js', 'ui', 'components_panel.js'), 'utf8');

describe('caixa durante o download: o que o codigo garante', () => {
  it('trava com `disabled`, porque checkbox ignora `readonly`', () => {
    const fn = fonte.slice(fonte.indexOf('function travarCaixas'));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toMatch(/\.disabled\s*=/);
    expect(corpo).not.toMatch(/\.readOnly\s*=/);
  });

  it('trava ao comecar e destrava nos DOIS fins de download', () => {
    expect(fonte.match(/travarCaixas\(true\)/g) || []).toHaveLength(1);
    // Um por caminho: a fila (baixarFila) e o instalar avulso (instalar).
    expect(fonte.match(/travarCaixas\(false\)/g) || []).toHaveLength(2);
  });

  it('o clique na caixa e recusado enquanto ha download', () => {
    const trecho = fonte.slice(fonte.indexOf("matches('[data-marcar]')"));
    const ateOFim = trecho.slice(0, trecho.indexOf('atualizarBarraDaFila'));
    // A recusa vem ANTES de mexer no conjunto de selecionados, senao o estado
    // mudaria e so a tela e que nao mostraria.
    expect(ateOFim).toMatch(/if \(baixando\)/);
    expect(ateOFim.indexOf('if (baixando)')).toBeLessThan(ateOFim.indexOf('selecionados.add'));
    expect(ateOFim).toMatch(/preventDefault/);
  });

  it('avisa por que recusou, em vez de ignorar em silencio', () => {
    const trecho = fonte.slice(fonte.indexOf("matches('[data-marcar]')"));
    expect(trecho.slice(0, 900)).toMatch(/componentsBusy/);
  });
});

describe('caixa durante o download: o comportamento', () => {
  let caixa;

  beforeEach(() => {
    document.body.innerHTML = '<input type="checkbox" class="componente-marcar" data-marcar="msys">';
    caixa = document.querySelector('.componente-marcar');
  });

  it('uma caixa desabilitada nao alterna ao clique', () => {
    caixa.disabled = true;
    caixa.click();
    expect(caixa.checked).toBe(false);
  });

  it('e a prova de que `readonly` NAO serviria aqui', () => {
    // O engano que o teste estatico acima impede: com readOnly a caixa alterna
    // do mesmo jeito, e a trava so pareceria existir.
    caixa.readOnly = true;
    caixa.click();
    expect(caixa.checked).toBe(true);
  });
});
