/**
 * envio_do_chat.ts: do composer ao turno, e as duas filas de espera.
 *
 * Mandar com um turno parado despacha na hora. Com um turno correndo, a
 * mensagem tenta entrar na sessao viva (so o motor do Agent SDK tem esse
 * canal); sem canal, espera na fila deste lado, que anda quando a resposta
 * acaba ou na hora, pelo "enviar agora", que interrompe a resposta em curso.
 * As duas esperas sao diferentes para quem olha: a mensagem entregue a sessao
 * so aguarda a assistente aceita-la e nao se cancela; a da fila se cancela e
 * se apressa. O desenho das fichas mora em fila_do_chat.ts.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3). As filas, o composer e a
 * conversa sao estado do painel; cada funcao o recebe como contexto.
 */

import type { MensagemDoChat } from './chat_history.js';
import { SUB_META, isSubProvider } from './ai_metadata.js';
import { avisoDeAssinatura, desenharFila, type ItemDaFila } from './fila_do_chat.js';
import { marcarPonto, rotuloDoPedido } from './rewind.js';

/** O que o envio le e escreve do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDoEnvio {
  container: HTMLElement | null;
  inputEl: HTMLTextAreaElement;
  queueEl: HTMLElement | null;
  currentProvider: string | null;
  currentSessionId: string | null;
  currentChatId: string | null;
  currentChatTitle: string;
  currentChatCreatedAt: number;
  subStatus: Record<string, unknown>;
  pendingAttachments: unknown[];
  messages: MensagemDoChat[];
  _isStreaming?: boolean;
  _messageQueue: ItemDaFila[];
  _liveQueue?: string[];
  _glowRevealed?: boolean;
  _autoChainCount?: number;
  _operacaoDoProximoEnvio?: string | null;

  refreshSubStatus(): Promise<unknown>;
  appendBubble(role: string, content: string, opcoes?: unknown): HTMLElement;
  scrollToBottom(): void;
  autoGrowInput(): void;
  showThinking(show: boolean): void;
  setStreaming(streaming: boolean): void;
  commitTurn(): void;
  resetTurnState(): void;
  _closeToolGroup(): void;
  _renderAttachments(): void;
  _renderBubbleAttachments(bubble: HTMLElement, atts: unknown[]): void;
  _capMessages(): void;
  _dispatchTurn(operacao?: string): Promise<unknown>;
}

/** O composer mandou: confere a assinatura, limpa o campo, e despacha, entrega ao vivo ou enfileira. */
export async function enviar(p: PainelDoEnvio): Promise<void> {
  if (!window.aiAPI || !p.currentProvider) return;
  const text = p.inputEl.value.trim();
  const atts = p.pendingAttachments.slice();
  if (!text && atts.length === 0) return;

  // As assinaturas falam com a CLI local. Sem ela instalada ou sem login, um
  // aviso claro (so de tela, nao gravado) no lugar de um erro de stream.
  if (isSubProvider(p.currentProvider)) {
    const sm = SUB_META[p.currentProvider];
    if (!p.subStatus[p.currentProvider]) await p.refreshSubStatus();
    // A CLI baixavel com login serve (fila_do_chat.ts).
    const aviso = avisoDeAssinatura(p.subStatus[p.currentProvider] as Parameters<typeof avisoDeAssinatura>[0], sm);
    if (aviso) {
      p.appendBubble('assistant', aviso, false);
      return;
    }
  }

  // O composer e limpo na hora, para a pessoa seguir escrevendo.
  p.inputEl.value = '';
  p.pendingAttachments = [];
  p._renderAttachments();
  p.autoGrowInput();

  // Com um turno correndo: primeiro o canal vivo; sem ele, a fila deste lado,
  // que anda quando a resposta acaba (ou pelo "enviar agora" de cada item).
  if (p._isStreaming) {
    if (await entregarAoVivo(p, text, atts)) return;
    (p._messageQueue || (p._messageQueue = [])).push({ text, atts });
    desenharEspera(p);
    return;
  }
  await submeterMensagem(p, text, atts);
}

/** Tira um item da fila e o envia agora, interrompendo a resposta em curso. */
export async function enviarDaFilaAgora(p: PainelDoEnvio, i: number): Promise<void> {
  const item = p._messageQueue && p._messageQueue.splice(i, 1)[0];
  desenharEspera(p);
  if (!item) return;
  if (p._isStreaming && !(await interromperParaFalar(p))) {
    // Nao fechou: volta ao comeco da fila em vez de se perder.
    p._messageQueue.unshift(item);
    desenharEspera(p);
    return;
  }
  await submeterMensagem(p, item.text, item.atts || []);
}

/**
 * Interrompe a resposta em curso e espera o turno fechar, para a proxima
 * mensagem entrar em ordem. Devolve false se o turno nao fechou em tempo: quem
 * chama cai na fila.
 */
export async function interromperParaFalar(p: PainelDoEnvio): Promise<boolean> {
  const sid = p.currentSessionId;
  if (!sid) return true;
  try { await (window.aiAPI as NonNullable<Window['aiAPI']>).abortChat(sid); } catch (_) { /* o 'aborted' fecha do lado de la */ }
  const limite = Date.now() + 3000;
  while (p._isStreaming && p.currentSessionId === sid && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 40));
  }
  if (p._isStreaming && p.currentSessionId === sid) {
    // O runner nao respondeu ao abort: fecha a forca, como o stop faz.
    p.showThinking(false);
    p._closeToolGroup();
    p.commitTurn();
    p.resetTurnState();
    p.setStreaming(false);
  }
  return !p._isStreaming;
}

/**
 * Acende o brilho da aurora embaixo do painel na primeira mensagem da sessao, e
 * o deixa aceso. A marca e da memoria: reabrir o painel mantem o brilho, e so
 * um app novo repete a entrada.
 */
function acenderBrilho(p: PainelDoEnvio): void {
  if (p._glowRevealed) return;
  p._glowRevealed = true;
  const glow = p.container?.querySelector('.ai-aurora-glow');
  if (glow) glow.classList.add('revealed');
}

/** Poe a mensagem na conversa (balao, registro, ponto de retorno) e despacha o turno dela. */
async function submeterMensagem(p: PainelDoEnvio, text: string, atts: unknown[]): Promise<void> {
  // A primeira mensagem de uma conversa nova: id, titulo tirado do texto, e
  // esta passa a ser a conversa gravada.
  if (!p.currentChatId) {
    try {
      const r = await window.aiAPI?.newConversationId?.();
      p.currentChatId = (r && r.id) || `c-${Date.now()}`;
    } catch (_) { p.currentChatId = `c-${Date.now()}`; }
    p.currentChatTitle = text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';
    p.currentChatCreatedAt = Date.now();
  }

  acenderBrilho(p);

  // Um ponto de restauracao ANTES de a IA encostar em qualquer arquivo. E o
  // gesto que mais causa arrependimento, e o unico em que a pessoa nao viu o
  // que ia acontecer. Nao se espera por ele: marcar nao pode atrasar o envio.
  const idDaMensagem = `msg-${Date.now()}`;
  marcarPonto({ motivo: 'pedido', rotulo: rotuloDoPedido(text), mensagemId: idDaMensagem });
  const userBubble = p.appendBubble('user', text);
  userBubble?.setAttribute('data-ponto', idDaMensagem);
  if (atts.length) p._renderBubbleAttachments(userBubble, atts);
  p.messages.push({ role: 'user', content: text, attachments: atts.length ? atts as MensagemDoChat['attachments'] : undefined });
  p._capMessages();
  // Uma mensagem de verdade quebra a corrente de turnos autonomos.
  p._autoChainCount = 0;

  // A operacao vale para UM envio: quem a marcou foi o botao da selecao logo
  // antes de chamar send; qualquer outro envio e turno livre.
  const operacao = p._operacaoDoProximoEnvio || undefined;
  p._operacaoDoProximoEnvio = null;

  await p._dispatchTurn(operacao);
}

/**
 * Tenta entregar a mensagem ao turno que esta correndo, para o modelo a ver na
 * sessao em vez de depois de um despacho novo. Devolve true quando o turno a
 * aceitou; quem chama entao NAO enfileira. Anexo nunca vai por aqui: o canal
 * vivo leva so texto, e a imagem precisa ir no startChat normal.
 */
export async function entregarAoVivo(p: PainelDoEnvio, text: string, atts: unknown[]): Promise<boolean> {
  if (!text || (atts && atts.length)) return false;
  if (!window.aiAPI?.pushChatMessage || !p.currentSessionId) return false;
  let accepted = false;
  try {
    const r = await window.aiAPI.pushChatMessage(p.currentSessionId, text);
    accepted = !!(r && r.ok && r.data && r.data.accepted);
  } catch (e) {
    console.warn('[ai] live push failed — queueing instead:', e);
    return false;
  }
  if (!accepted) return false;
  // A mensagem esta com a sessao, mas a assistente ainda escreve a resposta
  // anterior: quem decide QUANDO aceita-la e ela, e o main avisa na hora
  // (`follow-up-taken`). Ate la ela aparece como ficha em espera. Por na
  // conversa aqui era o defeito: o balao ia para o fim enquanto o texto
  // continuava entrando na bolha de cima, e a resposta parecia cortada.
  (p._liveQueue || (p._liveQueue = [])).push(text);
  desenharEspera(p);
  return true;
}

/** A assistente aceitou a mensagem que esperava: ela entra na conversa, no lugar certo, e a ficha sai. */
export function seguimentoAceito(p: PainelDoEnvio, content: unknown): void {
  const texto = typeof content === 'string' ? content : '';
  if (p._liveQueue && p._liveQueue.length) {
    const i = p._liveQueue.indexOf(texto);
    p._liveQueue.splice(i >= 0 ? i : 0, 1);
    desenharEspera(p);
  }
  if (!texto) return;
  p.messages.push({ role: 'user', content: texto });
  p.appendBubble('user', texto);
  p.scrollToBottom();
}

/**
 * O turno morreu (abortado ou com erro) com mensagem entregue a sessao que ela
 * nunca aceitou: a mensagem volta para a fila deste lado, para o proximo turno.
 * Perder o que a pessoa escreveu porque a sessao caiu seria o pior desfecho.
 */
export function devolverVivasAFila(p: PainelDoEnvio): void {
  const vivas = p._liveQueue || [];
  if (!vivas.length) return;
  p._liveQueue = [];
  const fila = p._messageQueue || (p._messageQueue = []);
  fila.unshift(...vivas.map((text) => ({ text, atts: [] })));
  desenharEspera(p);
}

/**
 * Despacha a proxima mensagem da fila, se houver. Devolve true se despachou,
 * para o fim do turno preferir a mensagem da pessoa a um turno autonomo.
 */
export function escoarFila(p: PainelDoEnvio): boolean {
  if (p._isStreaming) return false;
  if (!p._messageQueue || !p._messageQueue.length) return false;
  const { text, atts } = p._messageQueue.shift() as ItemDaFila;
  desenharEspera(p);
  submeterMensagem(p, text, atts as unknown[]); // assincrono, sem esperar (liga o streaming)
  return true;
}

/** As fichas de espera acima do composer (o desenho mora em fila_do_chat.ts). */
export function desenharEspera(p: PainelDoEnvio): void {
  if (!p.queueEl) return;
  desenharFila(p.queueEl, p._liveQueue || [], p._messageQueue || [], {
    aoCancelar: (i) => { p._messageQueue.splice(i, 1); desenharEspera(p); },
    aoEnviarAgora: (i) => enviarDaFilaAgora(p, i),
  });
}
