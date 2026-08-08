/**
 * pane_size.js — a regra de tamanho dos painéis redimensionáveis, no
 * comportamento do VS Code.
 *
 * O que o VS Code faz, e que a AURORA não fazia: arrastando, o painel encolhe
 * até um mínimo e para ali; se você continuar forçando além de um limiar, ele
 * colapsa por inteiro. Antes, o arrasto simplesmente travava no mínimo e
 * colapsar só era possível pelo botão da barra de ferramentas.
 *
 * A segunda regra é a que faltava no painel de IA: o teto de um painel não é
 * uma fração da janela, é o que sobra depois de reservar o mínimo dos vizinhos.
 * Calcular sobre `window.innerWidth` deixava o painel crescer por cima do
 * espaço do editor, que tem `min-width: 0` e portanto era espremido até zero,
 * parecendo sobreposição.
 *
 * Sem dependências de propósito: é aritmética pura e tem teste.
 */

/**
 * Resolve a largura (ou altura) final de um painel a partir do que o arrasto
 * pediu.
 *
 * @param {number} desejado tamanho cru que o arrasto produziu, podendo ser
 *   negativo quando o usuário força para além da borda
 * @param {{min: number, collapseAt: number, max: number}} limites
 *   `min` é onde o arrasto encosta; `collapseAt` é o ponto além do qual
 *   colapsa; `max` é o teto já descontado dos vizinhos
 * @returns {number} 0 quando colapsa, senão um valor entre `min` e `max`
 */
export function resolvePaneSize(desejado, { min, collapseAt, max }) {
  const d = Number(desejado);
  if (!Number.isFinite(d)) return min;
  // Forçar além do limiar colapsa. Este é o comportamento do VS Code e o que
  // permite fechar o painel sem tirar a mão do divisor.
  if (d < collapseAt) return 0;
  if (max < min) return Math.max(0, max);
  return Math.max(min, Math.min(d, max));
}

/**
 * Teto de um painel lateral: o que sobra da janela depois do painel do outro
 * lado e do mínimo que o editor precisa para continuar utilizável.
 *
 * @param {number} larguraJanela
 * @param {number} larguraVizinho largura atual do painel do outro lado
 * @param {number} minEditor espaço mínimo reservado para a área central
 * @param {number} minProprio piso do próprio painel, para o teto nunca ficar
 *   abaixo dele em janela pequena
 */
export function maxLateralWidth(larguraJanela, larguraVizinho, minEditor, minProprio) {
  const sobra = Number(larguraJanela) - Number(larguraVizinho || 0) - Number(minEditor);
  return Math.max(Number(minProprio), sobra);
}

/**
 * Altura máxima do terminal: o que sobra da faixa que ele divide com o editor,
 * depois do divisor e do mínimo que o editor precisa para continuar utilizável.
 *
 * É o `maxLateralWidth` virado para o eixo vertical, e existe pelo mesmo motivo:
 * o container do editor tem `min-height: 0`, então sem reservar nada para ele o
 * terminal cresce até engoli-lo. A faixa é a do `.editor-terminal-container`,
 * medida, e não a janela: derivar de `innerHeight` obriga a subtrair barra de
 * ferramentas e barra de estado de cabeça, e errar por um pixel ali vira folga
 * que o divisor nunca alcança.
 *
 * @param {number} alturaFaixa altura do container que o editor e o terminal
 *   dividem
 * @param {number} alturaDivisor altura do resizer entre os dois
 * @param {number} minEditor espaço mínimo reservado para o editor
 * @param {number} minProprio piso do próprio terminal, para o teto nunca ficar
 *   abaixo dele em janela baixa
 */
export function maxTerminalHeight(alturaFaixa, alturaDivisor, minEditor, minProprio) {
  const sobra = Number(alturaFaixa) - Number(alturaDivisor || 0) - Number(minEditor);
  return Math.max(Number(minProprio), sobra);
}

/** Limiares do painel lateral, em pixels. Um lugar só para os três painéis. */
export const PANE = Object.freeze({
  /** Largura mínima de um painel lateral enquanto aberto. */
  MIN_LATERAL: 180,
  /** Abaixo disto, o arrasto colapsa em vez de encostar no mínimo. */
  COLLAPSE_LATERAL: 90,
  /** Piso do painel de IA aberto: abaixo disso o chat fica ilegível. */
  MIN_AI: 320,
  /** O painel de IA colapsa antes, porque o piso dele é mais alto. */
  COLLAPSE_AI: 160,
  /** Espaço que o editor sempre mantém, para nunca ser espremido a zero. */
  MIN_EDITOR: 320,
  /**
   * Altura mínima do terminal aberto: a faixa de abas (34 px) mais a borda de
   * cima, que é o ponto em que ele ainda mostra alguma coisa. Era 30 aqui e
   * 40 no `min-height` do `terminal.css`, e quem desenhava era o CSS.
   */
  MIN_TERMINAL: 35,
  /** Abaixo disto, arrastar o terminal para baixo o colapsa. */
  COLLAPSE_TERMINAL: 16,
  /**
   * Altura que o editor sempre mantém. A faixa de abas mais três linhas de
   * código: abaixo disso o editor deixa de ser editor e vira uma tarja.
   */
  MIN_EDITOR_HEIGHT: 120,
});
