/**
 * rolagem_do_chat.ts: como a conversa acompanha o texto que chega.
 *
 * Enquanto a pessoa esta no fim, cada pedaco novo leva a vista ao fim. Quando
 * ela sobe para ler, a vista para de acompanhar (senao cada token a puxaria de
 * volta) e aparece o "Jump to latest"; voltar ao fim, ou clicar nele, rearma.
 * A conta pura (estar no fim, a curva e a duracao do deslize) mora em
 * chat_scroll.ts.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3). O painel continua dono do
 * elemento e da flag `stickToBottom`; cada funcao o recebe como contexto.
 */

import { isAtBottom, easeInOutCubic, smoothScrollDuration } from './chat_scroll.js';

/** O que a rolagem le e escreve do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDaRolagem {
  container: HTMLElement | null;
  messagesEl: HTMLElement | null;
  stickToBottom: boolean;
  _scrollRaf?: number | null;
}

/** Distancia em px acima do fim que ainda conta como "no fim". */
const LIMIAR_DO_FIM = 32;

/**
 * Vai ao fim SE a pessoa nao subiu para ler. `forcar` (ela acabou de mandar
 * uma mensagem) volta a acompanhar de onde ela estiver.
 */
export function rolarAoFim(p: PainelDaRolagem, forcar = false): void {
  if (!p.messagesEl) return;
  if (forcar) p.stickToBottom = true;
  if (p.stickToBottom) {
    p.messagesEl.scrollTop = p.messagesEl.scrollHeight;
  }
}

/**
 * Desliza ate o fim acelerando e freando, o gesto do "Jump to latest", para o
 * salto parecer deliberado. Mira o fim a cada quadro, para chegar mesmo com o
 * texto crescendo. A rolagem por token fica instantanea (rolarAoFim): suavizada,
 * ela ficaria visivelmente atras do texto.
 */
function deslizarAoFim(p: PainelDaRolagem): void {
  const el = p.messagesEl;
  /* v8 ignore next */ // so e chamado pelo botao da dica, que so existe com o painel montado
  if (!el) return;
  p.stickToBottom = true;
  if (p._scrollRaf) cancelAnimationFrame(p._scrollRaf);
  const start = el.scrollTop;
  const dist = (el.scrollHeight - el.clientHeight) - start;
  if (dist <= 2) { el.scrollTop = el.scrollHeight; return; }
  const dur = smoothScrollDuration(dist);
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / dur);
    const target = el.scrollHeight - el.clientHeight;   // o fim que cresce
    el.scrollTop = start + (target - start) * easeInOutCubic(t);
    if (t < 1) {
      p._scrollRaf = requestAnimationFrame(step);
    } else {
      p._scrollRaf = null;
      el.scrollTop = el.scrollHeight - el.clientHeight;
    }
  };
  p._scrollRaf = requestAnimationFrame(step);
}

/**
 * O "Jump to latest" flutuante, enquanto a pessoa le acima do fim. Nasce uma
 * vez e fica no DOM; so `.visible` alterna, para entrar e sair com a transicao
 * do CSS. O clique desliza ao fim E esconde a dica na hora: esperar o ouvinte
 * da rolagem esconder nao funcionava, porque ele so age quando o estado muda,
 * e o clique ja o tinha mudado.
 */
function alternarDicaDeVoltar(p: PainelDaRolagem, mostrar: boolean): void {
  /* v8 ignore next */ // o ouvinte da rolagem so e ligado depois de o painel existir
  if (!p.container) return;
  let pill = p.container.querySelector<HTMLElement>('.ai-scroll-resume');
  if (mostrar) {
    if (!pill) {
      const botao = document.createElement('button');
      botao.type = 'button';
      pill = botao;
      pill.className = 'ai-scroll-resume';
      pill.innerHTML = '<i class="ph ph-arrow-down"></i><span>Jump to latest</span>';
      pill.addEventListener('click', () => {
        deslizarAoFim(p);
        alternarDicaDeVoltar(p, false);
      });
      // Dentro do conteudo do painel: flutua acima das mensagens e abaixo do
      // composer.
      (p.messagesEl as HTMLElement).parentElement?.appendChild(pill);
      // Um reflow antes, para o `.visible` no mesmo tique animar.
      void pill.offsetWidth;
    }
    pill.classList.add('visible');
  } else if (pill) {
    pill.classList.remove('visible');
  }
}

/**
 * Liga a rolagem inteligente: a barra de rolagem e o sinal de "estou lendo
 * mensagens anteriores". Subir do fim solta a vista; voltar ao fim a prende de
 * novo. Roda do mouse e toque rolam o mesmo elemento, entao um ouvinte so pega
 * todos os jeitos.
 */
export function ligarRolagem(p: PainelDaRolagem): void {
  (p.messagesEl as HTMLElement).addEventListener('scroll', () => {
    const atBottom = isAtBottom(p.messagesEl, LIMIAR_DO_FIM);
    if (p.stickToBottom !== atBottom) {
      p.stickToBottom = atBottom;
      alternarDicaDeVoltar(p, !atBottom);
    }
  }, { passive: true });
}
