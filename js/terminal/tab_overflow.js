/**
 * tab_overflow.js — o excedente das abas do terminal vai para uma lista.
 *
 * As abas já cedem largura antes de serem cortadas, mas comprimir tem fim:
 * passado o piso elas ficam ilegíveis e acabam encavalando os botões de ação da
 * direita. A partir dali o certo é esconder o excedente atrás de um botão que
 * abre a lista, como o VS Code faz.
 *
 * Quem decide o que cabe é `planTabOverflow`, que é aritmética pura e tem
 * teste. Aqui fica só o DOM: medir, aplicar e montar o menu.
 *
 * A medição é o cuidado que não é óbvio. Para saber a largura NATURAL de cada
 * aba é preciso medir com todas visíveis e sem compressão; medir no estado
 * comprimido devolveria a largura já espremida e a conta nunca convergiria.
 * Por isso cada passada mostra tudo, mede, e só então esconde.
 */

import { planTabOverflow } from './tab_overflow_plan.js';
import { switchTerminal } from './terminal.js';

const CLASSE_ESCONDIDA = 'tab-overflowed';

/**
 * Abaixo desta largura do TERMINAL, as abas deixam de ser uma faixa horizontal e
 * viram uma coluna a direita, empilhadas, como no VS Code.
 *
 * O primeiro valor foi 560 px, tirado do minimo em que as abas ainda CABEM. Era
 * a conta errada: caber e ficar bom nao sao a mesma coisa, e entre 560 e 780 as
 * abas cabiam encostadas umas nas outras, sem respiro. O sarrafo desceu para que
 * a coluna entre antes, enquanto ainda ha folga, e nao no limite do aperto.
 */
const LARGURA_VIRA_COLUNA = 780;

let barra = null;
let lista = null;
let botao = null;
let menu = null;
let agendado = null;

/** Largura natural de cada aba, medida sem compressão. */
function medirNaturais(abas) {
  // `flex-basis: content` não serve aqui: precisamos do valor em pixels que a
  // aba teria solta. Soltamos a compressão, medimos, e devolvemos ao normal.
  const antes = abas.map((t) => t.style.flexShrink);
  abas.forEach((t) => { t.style.flexShrink = '0'; });
  const larguras = abas.map((t) => t.getBoundingClientRect().width);
  abas.forEach((t, i) => { t.style.flexShrink = antes[i]; });
  return larguras;
}

function fecharMenu() {
  menu?.classList.add('hidden');
  botao?.setAttribute('aria-expanded', 'false');
}

function abrirMenu(abas, escondidas) {
  if (!menu) return;
  menu.innerHTML = '';
  for (const i of escondidas) {
    const aba = abas[i];
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'terminal-tab-overflow-item';
    const glifo = aba.querySelector('.glyph');
    if (glifo) item.appendChild(glifo.cloneNode(true));
    const nome = document.createElement('span');
    // O rótulo é texto solto dentro do botão da aba, então o pegamos do
    // conteúdo e não de um elemento próprio.
    nome.textContent = (aba.textContent || '').trim();
    item.appendChild(nome);
    item.addEventListener('click', () => {
      const alvo = aba.getAttribute('data-terminal');
      if (alvo) switchTerminal(`terminal-${alvo}`);
      fecharMenu();
      // Trocar de aba muda quem é a ativa, e a ativa nunca fica escondida.
      aplicar();
    });
    menu.appendChild(item);
  }
  menu.classList.remove('hidden');
  botao.setAttribute('aria-expanded', 'true');
}

/** Mede o estado atual e aplica o plano. */
/**
 * Decide entre faixa horizontal e coluna a direita, pela largura do terminal.
 * Devolve true quando esta em coluna, porque ai nao ha excedente a esconder:
 * a coluna cabe todas, rolando se precisar.
 */
function ajustarOrientacao() {
  const term = document.querySelector('.terminal-container');
  if (!term) return false;
  const coluna = term.getBoundingClientRect().width < LARGURA_VIRA_COLUNA;
  term.classList.toggle('tabs-vertical', coluna);
  return coluna;
}

function aplicar() {
  if (!barra || !lista || !botao) return;

  // Em coluna todas as abas cabem, entao o botao de excedente nao tem papel.
  if (ajustarOrientacao()) {
    [...lista.querySelectorAll('.tab')].forEach((t) => t.classList.remove(CLASSE_ESCONDIDA));
    botao.classList.add('hidden');
    fecharMenu();
    return;
  }
  const abas = [...lista.querySelectorAll('.tab')];
  if (!abas.length) return;

  // Estado limpo antes de medir: ver o comentário do topo.
  abas.forEach((t) => t.classList.remove(CLASSE_ESCONDIDA));
  botao.classList.add('hidden');

  const larguras = medirNaturais(abas);
  const ativa = abas.findIndex((t) => t.classList.contains('active'));
  const disponivel = lista.clientWidth;
  const larguraBotao = 30;

  const { escondidas } = planTabOverflow(larguras, disponivel, ativa, larguraBotao);

  for (const i of escondidas) abas[i].classList.add(CLASSE_ESCONDIDA);
  botao.classList.toggle('hidden', escondidas.length === 0);
  if (escondidas.length) {
    botao.textContent = '';
    const seta = document.createElement('i');
    seta.className = 'ph ph-caret-right';
    botao.appendChild(seta);
    const n = document.createElement('span');
    n.className = 'terminal-tab-overflow-count';
    n.textContent = String(escondidas.length);
    botao.appendChild(n);
    botao.setAttribute('data-tooltip', `${escondidas.length} abas ocultas`);
  } else {
    fecharMenu();
  }

  botao.onclick = (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden')) abrirMenu(abas, escondidas);
    else fecharMenu();
  };
}

/** Uma passada por quadro, no máximo: o observer dispara em rajada. */
function agendar() {
  if (agendado) cancelAnimationFrame(agendado);
  agendado = requestAnimationFrame(() => { agendado = null; aplicar(); });
}

export function initTerminalTabOverflow() {
  barra = document.querySelector('.terminal-tabs');
  lista = document.querySelector('.terminal-tabs-list');
  // Sem a barra ainda no DOM nao ha o que fazer, mas tambem nao ha por que
  // desistir: quem chama de novo mais tarde encontra.
  if (!barra || !lista) return false;
  if (lista.querySelector('.terminal-tab-overflow-btn')) return true;

  botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'terminal-tab-overflow-btn toolbar-button icon-only hidden';
  botao.setAttribute('aria-haspopup', 'true');
  botao.setAttribute('aria-expanded', 'false');
  botao.setAttribute('aria-label', 'Abas ocultas');
  lista.appendChild(botao);

  menu = document.createElement('div');
  menu.className = 'terminal-tab-overflow-menu hidden';
  lista.appendChild(menu);

  document.addEventListener('click', fecharMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMenu(); });

  // O painel de IA e a árvore mudam a largura da barra sem a janela mudar de
  // tamanho, então observar a barra pega mais casos do que ouvir `resize`.
  // Observa o TERMINAL, e nao so a barra: e a largura dele que decide entre
  // faixa e coluna, e em coluna a barra deixa de acompanhar essa largura.
  try {
    const ro = new ResizeObserver(agendar);
    ro.observe(barra);
    const term = document.querySelector('.terminal-container');
    if (term) ro.observe(term);
  } catch (_) { window.addEventListener('resize', agendar); }

  // Trocar de aba muda quem não pode ser escondida.
  lista.addEventListener('click', (e) => {
    if (e.target.closest('.tab')) agendar();
  });

  agendar();
  return true;
}

/**
 * Auto-instalacao, sem depender de ordem de inicializacao.
 *
 * Isto ficava pendurado no `window.onload` do renderer, atras do initMonaco e
 * do painel de IA. Depender daquela ordem significa que qualquer excecao antes
 * daqui mata esta funcao em silencio, e foi o que aconteceu: as abas continuavam
 * comprimidas e cortadas porque o botao da lista nunca chegou a existir.
 *
 * O modulo passa a se instalar sozinho assim que a barra aparece no DOM, e
 * desiste depois de um tempo para nao ficar sondando para sempre num layout que
 * nao tem terminal.
 */
function autoInstalar() {
  if (initTerminalTabOverflow()) return;
  let tentativas = 0;
  const timer = setInterval(() => {
    if (initTerminalTabOverflow() || ++tentativas > 40) clearInterval(timer);
  }, 150);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInstalar);
  } else {
    autoInstalar();
  }
}
