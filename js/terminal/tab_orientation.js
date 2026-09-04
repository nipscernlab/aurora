/**
 * tab_orientation.js: as abas do terminal viram coluna quando ele fica estreito.
 *
 * Acima do limiar as abas ficam numa faixa horizontal, como sempre foram. Abaixo
 * dele saem da faixa e viram uma coluna à direita, empilhadas, como no VS Code.
 * Comprimir tem fim; empilhar não, e em coluna o nome inteiro volta a caber.
 *
 * Isto substituiu uma lista de excedente, que escondia as abas que não coubessem
 * atrás de um botão. A lista funcionava em teste e nunca disparou em uso real,
 * e depois que a coluna passou a entrar em 780 px a faixa em que ela ainda teria
 * função ficou estreita demais para justificar código que não se sabe por que
 * não roda. Empilhar resolve o mesmo problema sem esconder nada.
 */

/**
 * Abaixo desta largura do TERMINAL, as abas viram coluna.
 *
 * O primeiro valor foi 560 px, tirado do mínimo em que as abas ainda CABEM. Era
 * a conta errada: caber e ficar bom não são a mesma coisa, e entre 560 e 780 as
 * abas cabiam encostadas umas nas outras. O limiar subiu para que a coluna entre
 * enquanto ainda há folga, e não no limite do aperto.
 */
export const LARGURA_VIRA_COLUNA = 780;

/**
 * Largura do terminal em que a faixa horizontal estourou pela última vez, ou 0.
 *
 * O limiar fixo cobre o caso comum, mas a barra também pode não caber ACIMA
 * dele: fonte maior, idioma com nomes mais longos, um botão a mais nas ações.
 * Aí as abas passavam da borda direita do terminal, que é a borda esquerda do
 * painel de IA, e na tela isso é indistinguível do painel estar por cima. Quando
 * a faixa não cabe, vira coluna também; e para não oscilar (em coluna não dá
 * para medir se a faixa caberia), a coluna só volta a faixa quando o terminal
 * cresce uma folga além da largura em que estourou.
 */
let larguraQueEstourou = 0;
const FOLGA_PARA_VOLTAR = 40;

/** Decide entre faixa horizontal e coluna, pela largura do terminal e pelo que cabe. */
function ajustarOrientacao() {
  const term = document.querySelector('.terminal-container');
  if (!term) return false;
  const largura = term.getBoundingClientRect().width;
  const barra = term.querySelector('.terminal-tabs');
  const emColuna = term.classList.contains('tabs-vertical');
  if (!emColuna && barra && barra.scrollWidth > barra.clientWidth + 1) {
    larguraQueEstourou = largura;
  } else if (emColuna && largura > larguraQueEstourou + FOLGA_PARA_VOLTAR) {
    larguraQueEstourou = 0;
  }
  const coluna = largura < LARGURA_VIRA_COLUNA || (larguraQueEstourou > 0 && largura <= larguraQueEstourou + FOLGA_PARA_VOLTAR);
  term.classList.toggle('tabs-vertical', coluna);
  return coluna;
}

/**
 * Roda de imediato, e não num requestAnimationFrame: o ResizeObserver já entrega
 * as mudanças em lote antes da pintura, e um quadro de animação numa janela
 * que o compositor considera oculta (ocorre no runner do CI e com a tela
 * bloqueada) pode simplesmente não vir, deixando as abas na orientação velha.
 */
function agendar() {
  ajustarOrientacao();
}

function initTerminalTabOrientation() {
  const term = document.querySelector('.terminal-container');
  if (!term) return false;

  // Observa o terminal, e não a janela: o painel de IA e a árvore mudam a
  // largura dele sem a janela mudar de tamanho.
  try { new ResizeObserver(agendar).observe(term); }
  catch (_) { window.addEventListener('resize', agendar); }

  // E ouve quem muda a largura por código, na hora. O ResizeObserver só entrega
  // no próximo quadro de renderização, e numa janela que o compositor considera
  // oculta (atrás de outra, no runner do CI, com a tela bloqueada) esse quadro
  // pode não vir: o painel de IA abria, o terminal encolhia para 540 px e as
  // abas ficavam em faixa, estourando 15 px para dentro do painel. Quem aplica
  // largura (painel de IA, árvore) avisa por este evento, e a orientação segue
  // a mudança sem depender de quadro nenhum.
  window.addEventListener('aurora:layout-changed', agendar);

  agendar();
  return true;
}

/**
 * Auto-instalação, sem depender de ordem de inicialização.
 *
 * A versão anterior ficava pendurada no `window.onload` do renderer, atrás do
 * initMonaco e do painel de IA, e qualquer exceção antes dali a matava em
 * silêncio. Aqui o módulo se instala sozinho assim que a barra aparece, e
 * desiste depois de um tempo para não sondar para sempre num layout sem
 * terminal.
 */
function autoInstalar() {
  if (initTerminalTabOrientation()) return;
  let tentativas = 0;
  const timer = setInterval(() => {
    if (initTerminalTabOrientation()) { clearInterval(timer); return; }
    if (++tentativas > 40) {
      clearInterval(timer);
      // Seis segundos sem barra de terminal e anomalia, nao layout sem
      // terminal; fica a linha para haver por onde comecar.
      console.warn('[tab_orientation] barra do terminal nao apareceu em 6 s; orientacao das abas desligada');
    }
  }, 150);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInstalar);
  } else {
    autoInstalar();
  }
}
