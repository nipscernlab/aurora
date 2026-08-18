/**
 * ai_mark.js: o desenho do símbolo da Aurora Intelligence.
 *
 * Duas estrelas de quatro pontas — uma grande em cima à esquerda, uma pequena
 * embaixo à direita. É o glifo que o mercado inteiro usa para dizer "IA", e o
 * motivo de existir aqui em vez de sair do Phosphor é que o Phosphor só tem a
 * estrela sozinha (`ph-sparkle`, `ph-star-four`); o par é o que identifica.
 *
 * Cada estrela é um losango de lados côncavos: quatro curvas cúbicas ligando as
 * pontas N-L-S-O, com os pontos de controle puxados para perto do centro. O
 * quanto eles se aproximam (k, abaixo) é o que decide se a estrela sai gorda ou
 * afiada — k pequeno afina as pontas. k = 0.22 do raio é o meio-termo que
 * aguenta 40 px na dica do chat vazio e 16 px na barra sem virar borrão.
 *
 * A função devolve markup como string porque os pontos de uso montam HTML por
 * template literal; quem precisa de um nó de verdade usa aiMarkElement().
 */

/**
 * Uma estrela de quatro pontas como comando de path SVG.
 * @param {number} cx centro X
 * @param {number} cy centro Y
 * @param {number} r  raio (centro até a ponta)
 * @returns {string} o `d` de um <path> fechado
 */
function fourPointStar(cx, cy, r) {
  const k = r * 0.22;             // controle: quanto menor, mais afiada a ponta
  const n = (cy - r).toFixed(2);  // ponta norte
  const s = (cy + r).toFixed(2);  // ponta sul
  const e = (cx + r).toFixed(2);  // ponta leste
  const w = (cx - r).toFixed(2);  // ponta oeste
  const x = cx.toFixed(2);
  const y = cy.toFixed(2);
  const up = (cy - k).toFixed(2);
  const down = (cy + k).toFixed(2);
  const right = (cx + k).toFixed(2);
  const left = (cx - k).toFixed(2);

  return `M${x} ${n}`
    + `C${x} ${up} ${right} ${y} ${e} ${y}`   // N -> L
    + `C${right} ${y} ${x} ${down} ${x} ${s}` // L -> S
    + `C${x} ${down} ${left} ${y} ${w} ${y}`  // S -> O
    + `C${left} ${y} ${x} ${up} ${x} ${n}Z`;  // O -> N
}

// Geometria fixa das duas estrelas na caixa 24x24. A grande ocupa o quadrante
// superior esquerdo e a pequena o inferior direito; as duas se aproximam pela
// diagonal, que é exatamente onde a concavidade as afina, então não encostam.
const BIG = fourPointStar(9.2, 9.2, 7.7);
const SMALL = fourPointStar(18.6, 18.6, 4.4);

/**
 * O símbolo como string de SVG, pronto para entrar num template literal.
 * Decorativo por padrão (aria-hidden): onde ele for a única coisa dentro de um
 * botão, quem chama deve rotular o BOTÃO com aria-label, não o desenho.
 * @param {string} [extraClass] classes adicionais no <svg>
 * @returns {string}
 */
export function aiMarkSvg(extraClass = '') {
  const cls = extraClass ? `ai-mark ${extraClass}` : 'ai-mark';
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">`
    + `<path d="${BIG}"/><path d="${SMALL}"/></svg>`;
}

/**
 * O mesmo símbolo como nó do DOM, para quem monta a árvore por createElement.
 * @param {string} [extraClass]
 * @returns {SVGElement}
 */
export function aiMarkElement(extraClass = '') {
  const tpl = document.createElement('template');
  tpl.innerHTML = aiMarkSvg(extraClass);
  return tpl.content.firstElementChild;
}
