/**
 * fila_do_chat.ts: o que o painel de IA mostra enquanto uma mensagem espera, e
 * o aviso quando a assinatura nao pode atender.
 *
 * Sao duas esperas diferentes, e a diferenca importa para quem olha. As
 * mensagens ja entregues a sessao (`vivas`) so aguardam a assistente terminar
 * o que esta dizendo: nao ha o que cancelar nem o que apressar, e viram balao
 * sozinhas quando ela as aceita. As da fila deste lado esperam porque o motor
 * nao tem canal aberto, e essas se cancelam e se apressam. Quando elas andam
 * continua sendo decisao do painel, que conhece o turno; aqui fica o desenho.
 * Saiu do ai_assistant_manager.js (TODO 13.3).
 */

import { escaparHtml } from './anexos_do_chat.js';

/** Um item da fila deste lado: texto e anexos, como a pessoa mandou. */
export interface ItemDaFila { text: string; atts?: unknown[] }

const tr = (k: string) => (window.t ? window.t(k) : k);

/** As fichas de espera acima do composer, com os botoes de cancelar e de enviar agora. */
export function desenharFila(
  el: HTMLElement,
  vivas: string[],
  fila: ItemDaFila[],
  acoes: { aoCancelar: (i: number) => void; aoEnviarAgora: (i: number) => void },
): void {
  el.hidden = vivas.length === 0 && fila.length === 0;
  const fichasVivas = vivas.map((texto) => (
    `<span class="ai-queued-chip ai-queued-live" title="${escaparHtml(tr('ai.queue.live'))}">` +
    `<i class="ph ph-hourglass-medium" aria-hidden="true"></i>` +
    `<span class="ai-queued-text">${escaparHtml(String(texto).slice(0, 80))}</span></span>`
  )).join('');
  el.innerHTML = fichasVivas + fila.map((m, i) => {
    const preview = (m.text || (m.atts && m.atts.length ? `${m.atts.length} attachment(s)` : '')).slice(0, 80);
    const agora = tr('ai.queue.sendNow');
    return `<span class="ai-queued-chip" title="${escaparHtml(tr('ai.queue.waiting'))}">` +
      `<i class="ph ph-clock" aria-hidden="true"></i>` +
      `<span class="ai-queued-text">${escaparHtml(preview)}</span>` +
      `<button class="ai-queued-now" data-i="${i}" type="button" title="${escaparHtml(agora)}" aria-label="${escaparHtml(agora)}">` +
      `<i class="ph ph-paper-plane-right" aria-hidden="true"></i></button>` +
      `<button class="ai-queued-remove" data-i="${i}" type="button" aria-label="${escaparHtml(tr('ai.queue.cancel'))}">` +
      `<i class="ph ph-x" aria-hidden="true"></i></button></span>`;
  }).join('');
  el.querySelectorAll<HTMLElement>('.ai-queued-remove').forEach((btn) => {
    btn.addEventListener('click', () => acoes.aoCancelar(parseInt(btn.dataset.i as string, 10)));
  });
  el.querySelectorAll<HTMLElement>('.ai-queued-now').forEach((btn) => {
    btn.addEventListener('click', () => acoes.aoEnviarAgora(parseInt(btn.dataset.i as string, 10)));
  });
}

/** O estado da CLI de assinatura, como o main o responde. */
export interface EstadoDaAssinatura { installed?: boolean; downloadable?: boolean; authed?: boolean }

/** O que o painel sabe de cada assinatura (ai_metadata.SUB_META). */
export interface DadosDaAssinatura { cliName: string; loginCmd: string; notInstalled: string; installHint: string }

/**
 * O aviso quando a assinatura nao pode atender, ou null quando pode.
 *
 * Uma CLI baixavel mas ainda nao instalada serve: o turno a busca no primeiro
 * uso, com progresso. So bloqueiam "nenhuma CLI" e "sem login".
 */
export function avisoDeAssinatura(s: EstadoDaAssinatura | null | undefined, sm: DadosDaAssinatura): string | null {
  const pronta = !!(s && s.installed && s.authed);
  const vaiBuscar = !!(s && !s.installed && s.downloadable && s.authed);
  if (pronta || vaiBuscar) return null;
  const semLogin = !!(s && (s.installed || s.downloadable) && !s.authed);
  return semLogin
    ? `**${sm.cliName} is not signed in.** Run \`${sm.loginCmd}\` in a ` +
      'terminal, then open the model menu and click re-check.'
    : `**${sm.notInstalled}.** ${sm.installHint}, then open the model ` +
      'menu and click re-check.';
}
