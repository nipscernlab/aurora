/**
 * tab_overflow_plan.js — quais abas do terminal cabem, e quais vão para a lista.
 *
 * Comprimir aba tem fim. Passado o piso de largura, as últimas abas ficam
 * ilegíveis e acabam encavalando os botões de ação da direita. A partir dali o
 * certo é esconder o excedente atrás de um botão que abre a lista, como o VS
 * Code faz, em vez de continuar espremendo.
 *
 * Duas regras dão conta do comportamento inteiro:
 *
 *   A aba ATIVA nunca é escondida. Sumir com a aba que a pessoa está usando é
 *   pior do que qualquer aperto de layout, e é o erro clássico desta feature.
 *
 *   O botão da lista só aparece quando há o que listar, e o espaço dele é
 *   descontado antes da conta. Sem descontar, cabe tudo por um triz, o botão
 *   entra depois e volta a estourar.
 *
 * Isto é aritmética pura, sem DOM, de propósito: é o que dá para testar.
 */

/**
 * @param {number[]} larguras largura de cada aba, na ordem em que aparecem
 * @param {number} disponivel espaço da lista, em pixels
 * @param {number} ativa índice da aba ativa, ou -1
 * @param {number} larguraBotao espaço do botão que abre a lista
 * @returns {{visiveis: number[], escondidas: number[]}} índices, em ordem
 */
export function planTabOverflow(larguras, disponivel, ativa, larguraBotao) {
  const n = larguras.length;
  const todos = Array.from({ length: n }, (_, i) => i);
  if (!n) return { visiveis: [], escondidas: [] };

  const total = larguras.reduce((a, b) => a + b, 0);
  if (total <= disponivel) return { visiveis: todos, escondidas: [] };

  // Cabe o que couber da esquerda para a direita, já sem o espaço do botão.
  const util = Math.max(0, disponivel - larguraBotao);
  const visiveis = [];
  let usado = 0;
  for (let i = 0; i < n; i++) {
    if (usado + larguras[i] > util) break;
    visiveis.push(i);
    usado += larguras[i];
  }

  // A aba ativa entra no lugar da última visível quando ficou de fora. Trocar
  // em vez de somar mantém a conta de espaço válida.
  if (ativa >= 0 && ativa < n && !visiveis.includes(ativa)) {
    while (visiveis.length && usado + larguras[ativa] > util) {
      usado -= larguras[visiveis.pop()];
    }
    visiveis.push(ativa);
    visiveis.sort((a, b) => a - b);
  }

  const dentro = new Set(visiveis);
  return { visiveis, escondidas: todos.filter((i) => !dentro.has(i)) };
}
