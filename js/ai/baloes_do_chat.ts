/**
 * baloes_do_chat.ts: os baloes de mensagem e o divisor do painel de IA.
 *
 * O balao renderiza markdown nos dois papeis (o codigo que a pessoa cola vira
 * bloco de verdade), mostra o rotulo uma vez por sequencia da assistente, e na
 * mensagem da pessoa leva o botao de voltar o codigo ao instante em que ela foi
 * enviada. O divisor e uma nota de tela (troca de modelo), nunca gravada.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3).
 */

import { renderMarkdown, highlightCodeBlocks, linkifyFileRefs } from './chat_render.js';
import { listarPontos, voltarAoPonto } from './rewind.js';

/** O que os baloes leem e escrevem do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDosBaloes {
  messagesEl: HTMLElement | null;
  chatEmptyHint: HTMLElement | null;
  _lastMsgRole: string | null;
  scrollToBottom(force?: boolean): void;
}

/** O texto traduzido, ou o padrao quando nao ha traducao (t devolve a chave). */
function traduzido(chave: string, padrao: string): string {
  return (window.t && window.t(chave) !== chave) ? window.t(chave) : padrao;
}

/**
 * Volta o codigo ao instante em que aquela mensagem foi enviada. A bolha leva
 * o id da mensagem, e o ponto e procurado por ele. Bolha de conversa carregada
 * do disco (sem ponto, ou com o ponto ja podado) diz que nao ha ponto em vez de
 * oferecer um botao que nao faz nada.
 */
async function voltarAoPontoDaBolha(el: HTMLElement): Promise<void> {
  const id = el.getAttribute('data-ponto');
  const pontos = await listarPontos();
  const ponto = id ? pontos.find((x) => x.mensagemId === id) : null;
  if (!ponto) {
    try {
      window.showNotification?.(
        traduzido('rewind.noPoint', 'No restore point for this message.'),
        'info', 4000, 'rewind');
    } catch { /* sem notificacao */ }
    return;
  }
  await voltarAoPonto(ponto.id);
}

/** Um balao novo no fim da conversa; devolve o elemento. */
export function novoBalao(p: PainelDosBaloes, role: string, content: string, { error = false } = {}): HTMLElement {
  if (p.chatEmptyHint) p.chatEmptyHint.classList.add('hidden');
  const el = document.createElement('div');
  el.className = `ai-message ai-msg-${role}${error ? ' error' : ''}`;
  const label = role === 'user' ? 'You' : 'Aurora Intelligence';
  // O rotulo aparece uma vez por sequencia da assistente. Um turno chega em
  // varios segmentos separados por ferramentas, e rotular cada um fazia a
  // parede de "AURORA INTELLIGENCE" repetido. Mensagem da pessoa, divisor e
  // chip de tarefa reiniciam a sequencia (zeram _lastMsgRole).
  const showLabel = !(role === 'assistant' && p._lastMsgRole === 'assistant');
  el.innerHTML = `
      ${showLabel ? `<div class="ai-msg-role">${label}</div>` : ''}
      <div class="ai-msg-content"></div>
    `;
  // So na mensagem da pessoa: o ponto foi marcado quando ELA foi enviada, e
  // voltar desfaz o que veio depois. Na resposta o botao nao teria um instante
  // proprio para apontar.
  if (role === 'user') {
    const voltar = document.createElement('button');
    voltar.className = 'ai-msg-rewind';
    voltar.type = 'button';
    voltar.innerHTML = '<i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i>';
    const dica = traduzido('rewind.toHere', 'Rewind code to here');
    voltar.title = dica;
    voltar.setAttribute('aria-label', dica);
    voltar.addEventListener('click', () => voltarAoPontoDaBolha(el));
    el.appendChild(voltar);
  }
  const contentEl = el.querySelector('.ai-msg-content') as HTMLElement;
  if (content) {
    // Markdown nos DOIS papeis, pelo mesmo renderizador seguro (escapa HTML):
    // o bloco de codigo que a pessoa cola aparece como bloco com realce.
    contentEl.innerHTML = renderMarkdown(content);
    highlightCodeBlocks(contentEl);
    linkifyFileRefs(contentEl);
  }
  (p.messagesEl as HTMLElement).appendChild(el);
  p._lastMsgRole = role;
  // A pessoa acabou de mandar: volta a acompanhar o fim de onde ela estiver.
  // Na resposta, so acompanha quem ja estava no fim.
  p.scrollToBottom(role === 'user');
  return el;
}

/**
 * Um divisor com texto no meio, no estilo da extensao do Claude no VS Code,
 * para notas que nao sao conversa (troca de modelo). NAO vai para as
 * mensagens: o modelo nunca o ve e ele nao e gravado.
 */
export function novoDivisor(p: PainelDosBaloes, text: string): HTMLElement | null {
  if (!p.messagesEl) return null;
  if (p.chatEmptyHint) p.chatEmptyHint.classList.add('hidden');
  const el = document.createElement('div');
  el.className = 'ai-divider';
  el.setAttribute('role', 'separator');
  const span = document.createElement('span');
  span.className = 'ai-divider-text';
  span.textContent = text;
  el.appendChild(span);
  p.messagesEl.appendChild(el);
  // O divisor separa secoes: o proximo balao da assistente mostra o rotulo de novo.
  p._lastMsgRole = null;
  p.scrollToBottom();
  return el;
}
