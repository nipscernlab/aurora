/**
 * conversas_do_chat.ts: o ciclo da conversa no painel de IA. Comecar uma nova,
 * abrir uma do historico, gravar, renomear, apagar, e o tutorial guiado, que e
 * uma conversa nova com um bloco a mais no system prompt.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3). O painel continua dono do
 * estado da conversa (as mensagens, o id, o contador) e do desenho de cada
 * pedaco da tela; cada funcao aqui o recebe como contexto e so orquestra. As
 * conversas moram em `userData/aurora-intelligence-chats/<id>.json`, pelos
 * canais de main/ai/conversations.js.
 *
 * Duas regras valem em tudo: nada troca de conversa com um turno no meio
 * (`currentSessionId`), e a conversa corrente e gravada antes de ser trocada.
 */

import { showConfirm } from '../ui/dialog_manager.js';
import { showCardNotification } from '../ui/notification.js';
import { lerPaginasDoManual, montarBlocoTutorial, aberturaDoTutorial } from './api_tutorial.js';
import { chatListHtml, serializeMessagesForStorage, type ConversaListada, type MensagemDoChat } from './chat_history.js';
import { highlightCodeBlocks } from './chat_render.js';
import { desenharRegistroDaPergunta, type RegistroDaPergunta } from './perguntas_inline.js';
import { desenharBlocoDeCitacoes } from './citacoes_do_chat.js';
import { criarGrupoDeFerramentas, finalizarGrupo, chipEstatico, type GrupoDeFerramentas } from './chips_de_ferramenta.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** Os canais das conversas gravadas (window.aiAPI) e a conversa como eles a leem. */
type CanaisDaConversa = NonNullable<Window['aiAPI']>;
type ConversaGravada = NonNullable<Awaited<ReturnType<CanaisDaConversa['readConversation']>>>;

/** O que o ciclo le e escreve do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDaConversa {
  currentSessionId: string | null;
  messages: MensagemDoChat[];
  currentChatId: string | null;
  currentChatTitle: string;
  currentChatCreatedAt: number;
  cumulativeTokens: number;
  cacheLidos: number;
  cacheEscritos: number;
  tutorialBlock: string;
  _citacoesDoTurno: unknown;
  _lastMsgRole: string | null;
  runningChips: unknown[];
  _toolGroup: unknown;
  _autoQueue: unknown[];
  _autoChainCount: number;
  _messageQueue: unknown[];
  thinkingEl: HTMLElement | null;

  currentProvider: string | null;
  providersConfigured: Record<string, boolean> | null;
  providersAvailable: Array<{ name: string; model?: string | null }> | null;

  historyOpen: boolean;
  chatList: ConversaListada[];
  messagesEl: HTMLElement;
  chatEmptyHint: HTMLElement | null;
  inputEl: HTMLTextAreaElement;
  historyPopover: HTMLElement;
  historyBtn: HTMLElement;
  historyList: HTMLElement | null;
  mpProviders: HTMLElement;
  container: HTMLElement | null;
  clearBtn: HTMLElement;
  tutorialBtn: HTMLElement | null;

  send(): Promise<unknown>;
  updateTokenCounter(): void;
  applyProviderState(): void;
  _renderQueue(): void;
  appendBubble(role: string, content: string): HTMLElement;
  _renderBubbleAttachments(bubble: HTMLElement, atts: unknown[]): void;
}

/** A dica de conversa vazia de volta, sozinha na area de mensagens. */
function limparMensagens(p: PainelDaConversa): void {
  p.messagesEl.innerHTML = '';
  if (p.chatEmptyHint) {
    p.messagesEl.appendChild(p.chatEmptyHint);
    p.chatEmptyHint.classList.remove('hidden');
  }
}

/**
 * Comeca uma conversa nova. Grava a corrente antes, para ela ficar no
 * historico, e zera todo o estado em memoria.
 */
export async function novaConversa(p: PainelDaConversa): Promise<void> {
  if (p.currentSessionId) return;        // never switch mid-stream
  await gravarConversa(p);
  p.messages = [];
  p._citacoesDoTurno = null;
  p.tutorialBlock = '';
  limparMensagens(p);
  p._lastMsgRole = null;
  p.cumulativeTokens = 0;
  p.cacheLidos = 0;
  p.cacheEscritos = 0;
  p.updateTokenCounter();
  p.runningChips = [];
  p._toolGroup = null;
  p._autoQueue = [];
  p._autoChainCount = 0;
  p._messageQueue = [];
  p._renderQueue();
  p.thinkingEl = null;
  p.currentChatId = null;
  p.currentChatTitle = '';
  p.currentChatCreatedAt = 0;
  relerLista(p);
}

/**
 * O tutorial guiado da API (ver api_tutorial.ts).
 *
 * Uma conversa nova, com o bloco do tutorial no system prompt e a primeira
 * mensagem ja enviada: a pessoa clica e a instrutora comeca. O bloco morre
 * com a conversa (novaConversa o limpa), e uma conversa de tutorial reaberta do
 * historico segue pelo que ja foi dito, sem o bloco.
 */
export async function comecarTutorial(p: PainelDaConversa): Promise<void> {
  if (p.currentSessionId) {
    showCardNotification(tr('ai.tutorial.busy'), 'warning', 4000, 'Aurora Intelligence');
    return;
  }
  if (!window.aiAPI || !p.currentProvider) {
    showCardNotification(tr('ai.tutorial.noProvider'), 'warning', 5000, 'Aurora Intelligence');
    return;
  }
  await novaConversa(p);
  const locale = (localStorage.getItem('aurora-locale') === 'en') ? 'en' : 'pt';
  const manual = await lerPaginasDoManual(window.electronAPI as Parameters<typeof lerPaginasDoManual>[0]);
  p.tutorialBlock = montarBlocoTutorial(locale, manual);
  p.inputEl.value = aberturaDoTutorial(locale);
  await p.send();
}

/** Abre ou fecha a lista do historico; sem `force`, alterna. Abrir rele a lista. */
export function alternarHistorico(p: PainelDaConversa, force?: boolean): void {
  const open = force === undefined ? !p.historyOpen : force;
  p.historyOpen = open;
  p.historyPopover.classList.toggle('hidden', !open);
  p.historyBtn.classList.toggle('active', open);
  if (open) relerLista(p);
}

/** Rele a lista do main e a desenha. A leitura que falha vira lista vazia. */
export async function relerLista(p: PainelDaConversa): Promise<void> {
  if (window.aiAPI?.listConversations) {
    try {
      const r = await window.aiAPI.listConversations();
      p.chatList = r?.chats || [];
    } catch (_) { p.chatList = []; }
  }
  desenharLista(p);
}

function desenharLista(p: PainelDaConversa): void {
  if (!p.historyList) return;
  // O desenho de cada linha e puro, em chat_history.ts.
  p.historyList.innerHTML = chatListHtml(p.chatList, p.currentChatId);
}

/** Um clique na lista: o botao de renomear, o de apagar, ou a linha, que abre a conversa. */
export async function cliqueNoHistorico(p: PainelDaConversa, e: Event): Promise<void> {
  const alvo = e.target as Element;
  const item = alvo.closest<HTMLElement>('.ai-history-item');
  if (!item) return;
  const id = item.dataset.chatId as string;
  const actBtn = alvo.closest<HTMLElement>('[data-action]');
  if (actBtn) {
    e.stopPropagation();
    if (actBtn.dataset.action === 'delete') {
      const yes = await showConfirm('Delete chat?', 'This conversation will be deleted permanently.', {
        variant: 'warning', confirmLabel: 'Delete', danger: true,
      });
      if (yes) await apagarConversa(p, id);
    } else if (actBtn.dataset.action === 'rename') {
      renomearNaLista(p, item, id);
    }
    return;
  }
  // Anywhere else on the row: open the chat.
  alternarHistorico(p, false);
  abrirConversa(p, id);
}

function renomearNaLista(p: PainelDaConversa, itemEl: HTMLElement, id: string): void {
  const titleEl = itemEl.querySelector('.ai-history-item-title');
  if (!titleEl) return;
  const oldTitle = titleEl.textContent as string;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ai-history-item-rename';
  input.value = oldTitle;
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  // Fecha uma vez so. O campo sai do DOM com o foco nele, e o blur que o
  // navegador dispara nessa hora gravaria o nome que o Escape descartou.
  let fechado = false;
  const finish = async (commit: boolean) => {
    if (fechado) return;
    fechado = true;
    const newTitle = commit ? (input.value.trim() || oldTitle) : oldTitle;
    const span = document.createElement('span');
    span.className = 'ai-history-item-title';
    span.textContent = newTitle;
    if (input.parentNode) input.replaceWith(span);
    if (commit && newTitle !== oldTitle) {
      try { await window.aiAPI?.renameConversation(id, newTitle); }
      catch (_) { /* the list refresh below will reveal a failure */ }
      if (id === p.currentChatId) p.currentChatTitle = newTitle;
      relerLista(p);
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

/**
 * Apaga uma conversa. A linha sai animando em vez de a lista ser relida (que
 * a reconstruiria inteira, num salto), e a lista fica aberta o tempo todo.
 * Apagar a conversa aberta zera o painel.
 */
export async function apagarConversa(p: PainelDaConversa, id: string): Promise<void> {
  const cardEl = p.historyList
    ? Array.from(p.historyList.querySelectorAll<HTMLElement>('.ai-history-item'))
        .find((n) => n.dataset.chatId === id)
    : null;

  const dropFromList = () => {
    p.chatList = (p.chatList || []).filter((c) => c.id !== id);
    if (p.historyList && !p.chatList.length) {
      p.historyList.innerHTML = '<p class="ai-history-empty">No saved chats yet.</p>';
    }
  };

  if (cardEl) animarSaidaDaLinha(cardEl, dropFromList);
  else dropFromList();

  try { await window.aiAPI?.deleteConversation(id); }
  catch (_) { /* the card is already animating out; a later open reveals failure */ }

  if (id === p.currentChatId) {
    // The visible chat was deleted, reset to a fresh state.
    p.currentChatId = null;
    p.currentChatTitle = '';
    p.currentChatCreatedAt = 0;
    p.messages = [];
    limparMensagens(p);
    p.cumulativeTokens = 0;
    p.updateTokenCounter();
  }
}

/**
 * Recolhe e apaga a linha, depois a tira do DOM e roda `onDone`. Fixa a altura
 * em pixels antes, porque a transicao para `height: 0` nao anima a partir de
 * `auto`. O prazo cobre o transitionend que nao chega.
 */
function animarSaidaDaLinha(el: HTMLElement, onDone: () => void): void {
  el.style.height = el.offsetHeight + 'px';
  void el.offsetHeight; // commit the start height before collapsing
  el.classList.add('removing');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.remove();
    onDone();
  };
  el.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'height' || e.propertyName === 'opacity') finish();
  });
  setTimeout(finish, 450); // fallback if transitionend never fires
}

/**
 * Abre uma conversa gravada e a reproduz na tela como ela foi ao vivo:
 * ferramentas seguidas num grupo fechado, citacoes e perguntas nos seus
 * blocos, e os anexos como fichas nos baloes.
 */
export async function abrirConversa(p: PainelDaConversa, id: string): Promise<void> {
  if (p.currentSessionId) return;        // never switch mid-stream
  if (id === p.currentChatId) return;
  await gravarConversa(p);

  let chat: ConversaGravada | null;
  try { chat = await (window.aiAPI as CanaisDaConversa).readConversation(id); }
  catch (_) { chat = null; }
  if (!chat) return;

  p.currentChatId = chat.id;
  p.currentChatTitle = chat.title || 'Untitled';
  p.currentChatCreatedAt = chat.createdAt || Date.now();
  p.messages = Array.isArray(chat.messages) ? chat.messages.slice() : [];
  p.cumulativeTokens = Number(chat.cumulativeTokens) || 0;
  p.updateTokenCounter();

  // Switch provider if the saved chat used a different one (and it's
  // still available). Falls back silently if not.
  if (chat.provider && chat.provider !== p.currentProvider) {
    if (p.providersConfigured && p.providersConfigured[chat.provider]) {
      p.currentProvider = chat.provider;
      p.applyProviderState();
      const radio = p.mpProviders.querySelector<HTMLInputElement>(`input[name="ai-provider"][value="${chat.provider}"]`);
      if (radio) radio.checked = true;
    }
  }

  // Replay every message into the bubble stream.
  p.messagesEl.innerHTML = '';
  p._lastMsgRole = null;
  if (p.chatEmptyHint) p.messagesEl.appendChild(p.chatEmptyHint);
  if (p.chatEmptyHint) p.chatEmptyHint.classList.toggle('hidden', p.messages.length > 0);
  // Consecutive tool calls are rebuilt into one collapsed "N actions"
  // group, matching the live look so a reopened chat reads the same way.
  let staticGroup: (GrupoDeFerramentas & { total: number }) | null = null;
  const closeStaticGroup = () => {
    if (!staticGroup) return;
    finalizarGrupo(staticGroup.el, staticGroup.summaryEl, staticGroup.total);
    staticGroup = null;
  };
  for (const msg of p.messages) {
    if (!msg || !msg.role) continue;
    if (msg.role === 'tool') {
      if (!staticGroup) {
        staticGroup = { ...criarGrupoDeFerramentas(), total: 0 };
        p.messagesEl.appendChild(staticGroup.el);
      }
      staticGroup.body.appendChild(
        chipEstatico(msg.toolName, msg.status, msg.error, msg.args, msg.result),
      );
      staticGroup.total += 1;
    } else if (msg.role === 'citation') {
      // Sem este ramo a citacao cairia no teste de `typeof msg.content`
      // abaixo, que e string, e sumiria calada ao reabrir a conversa.
      closeStaticGroup();
      p.messagesEl.appendChild(desenharBlocoDeCitacoes(msg.citacoes || []));
    } else if (msg.role === 'question') {
      // A question record has no `content`, so without this branch the
      // `typeof msg.content === 'string'` test below drops it silently.
      closeStaticGroup();
      p.messagesEl.appendChild(desenharRegistroDaPergunta(msg as RegistroDaPergunta));
    } else if (typeof msg.content === 'string') {
      closeStaticGroup();
      const bubble = p.appendBubble(msg.role, msg.content);
      // Restore the attachment chips (name/ext only, the payload was dropped)
      // so a reopened message reads with context, not as an empty bubble.
      if (Array.isArray(msg.attachments) && msg.attachments.length) {
        p._renderBubbleAttachments(bubble, msg.attachments);
      }
    }
  }
  closeStaticGroup();
  highlightCodeBlocks(p.messagesEl);
  relerLista(p);
}

/** Grava a conversa corrente, se ela tem mensagens. A gravacao que falha so avisa no console. */
export async function gravarConversa(p: PainelDaConversa): Promise<void> {
  if (!p.currentChatId || !p.messages.length || !window.aiAPI?.saveConversation) return;
  const providerInfo = (p.providersAvailable || []).find((x) => x.name === p.currentProvider);
  try {
    await window.aiAPI.saveConversation({
      id: p.currentChatId,
      title: p.currentChatTitle || 'Untitled',
      provider: p.currentProvider,
      model: providerInfo ? providerInfo.model : null,
      createdAt: p.currentChatCreatedAt || Date.now(),
      // O rastro das ferramentas fica inteiro, dos anexos so os metadados
      // (chat_history.ts).
      messages: serializeMessagesForStorage(p.messages),
      cumulativeTokens: p.cumulativeTokens,
    });
  } catch (e) { console.warn('[ai-panel] persist failed:', e); }
  relerLista(p);
}

/**
 * Liga o historico e a conversa nova: o botao que abre a lista, clicar fora que
 * a fecha, o "Novo" da lista, as linhas, o "+" do cabecalho e o tutorial.
 */
export function ligarHistorico(p: PainelDaConversa): void {
  p.historyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    alternarHistorico(p);
  });
  p.historyPopover.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => alternarHistorico(p, false));
  (p.container as HTMLElement).querySelector('#ai-history-new')?.addEventListener('click', () => {
    alternarHistorico(p, false);
    novaConversa(p);
  });
  (p.historyList as HTMLElement).addEventListener('click', (e) => cliqueNoHistorico(p, e));
  p.clearBtn.addEventListener('click', () => novaConversa(p));
  p.tutorialBtn?.addEventListener('click', () => comecarTutorial(p));
}
