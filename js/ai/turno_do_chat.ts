/**
 * turno_do_chat.ts: o turno da Aurora Intelligence, do despacho ao fim.
 *
 * Despachar (montar o pedido e chamar o startChat), os turnos que a propria
 * assistente comeca e o teto da corrente deles, o Stop com a rede de
 * seguranca, o cao de guarda que resgata o turno que emudeceu, e as tres
 * formas de terminar: fechar, falhar e seguir na mesma sessao. O tratamento de
 * cada pacote do stream mora em eventos_do_stream.ts.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3), metodo a metodo e sem mudar o
 * corpo: as chamadas a outras partes do painel continuam passando pelas
 * delegacoes da instancia.
 */

import { motivoDe } from '../app/api_reply.js';
import { SUB_META, isSubProvider, STREAM_STALL_MS, STREAM_STALL_HARD_MS } from './ai_metadata.js';
import type { MensagemDoChat } from './chat_history.js';
import { buildApiMessages, buildProjectContext } from './chat_turn.js';
import { registrarCitacoes } from './citacoes_do_chat.js';
import { lerContextoDoTurno } from './contexto_do_turno.js';
import { SYSTEM_PROMPT } from './system_prompt.js';

/** O que o turno le e escreve do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDoTurno {
  messagesEl: HTMLElement;
  chatEmptyHint: HTMLElement | null;
  sendBtn: HTMLElement;
  stopBtn: HTMLElement;
  clearBtn: HTMLButtonElement;
  messages: MensagemDoChat[];
  currentProvider: string | null;
  currentSessionId: string | null;
  currentChatId: string | null;
  providersAvailable: Array<{ name: string; model?: string }>;
  permissionMode: string;
  claudeCodeEffort: string;
  tutorialBlock?: string;
  turnText: string;
  segmentBuffer: string;
  currentAssistantContentEl: HTMLElement | null;
  runningChips: Array<{ toolName: string; toolUseId: string | null; args: unknown; el: HTMLElement }>;
  hadToolCalls?: boolean;
  pendingConfirms: Set<(allowed: boolean) => void>;
  pendingAskUserQuestions?: Set<(r: { answer: string; selected: string[] }) => void>;
  unsubChatEvent?: (() => void) | null;
  _isStreaming?: boolean;
  _lastEventAt?: number;
  _lastMsgRole: string | null;
  _toolGroup: unknown;
  _committedTurnLen?: number;
  _revealLength?: number;
  _streamWatchdog?: ReturnType<typeof setInterval> | null;
  _autoQueue?: Array<{ content: string; label: string; operacao: string | null }>;
  _autoChainCount?: number;
  _messageQueue: unknown[];
  _liveQueue?: string[];
  _citacoesDoTurno: import('./manual_citation.js').CitacaoDoManual[] | null;
  _versaoDoManual?: string;

  appendBubble(role: string, content: string, opcoes?: unknown): HTMLElement;
  appendDelta(delta: string): void;
  applyUsage(usage: unknown): void;
  showThinking(show: boolean): void;
  startToolChip(toolName: string | undefined, args: unknown, toolUseId?: string | null): void;
  finishToolChip(toolName: string | undefined, result: unknown, toolUseId?: string | null): void;
  persistCurrentChat(): unknown;
  refreshSubUsage(): unknown;
  handleChatEvent(ev: PacoteDoStream | null | undefined): void;
  commitTurn(): void;
  failTurn(message: string): void;
  resetTurnState(): void;
  setStreaming(streaming: boolean): void;
  _dispatchTurn(operacao?: string): Promise<unknown>;
  _drainAutoQueue(): void;
  _drainMessageQueue(): boolean;
  _armStreamWatchdog(): void;
  _disarmStreamWatchdog(): void;
  _recoverFromStall(): void;
  _startNextSegment(): void;
  _capMessages(): void;
  _closeToolGroup(): void;
  _cancelarFrameDoStream(): void;
  _clearCliDownload(): void;
  _renderCliDownload(ev: unknown): void;
  _revealSegment(): void;
  _sealTurnText(): void;
  _renderQueue(): void;
  _followUpTaken(content: unknown): void;
  _devolverVivasAFila(): void;
}

/** Um pacote do stream do main (main/ai/chat.js), do tipo que `type` diz. */
export interface PacoteDoStream {
  sessionId?: string;
  type?: string;
  delta?: string;
  toolName?: string;
  toolUseId?: string | null;
  args?: unknown;
  result?: unknown;
  usage?: unknown;
  more?: boolean;
  message?: string;
  content?: unknown;
  citacao?: import('./manual_citation.js').CitacaoDoManual;
  [campo: string]: unknown;
}

/**
 * Shared turn dispatcher used by send() (a real user message) and
 * autoContinue() (an autonomous follow-up). The caller pushes its message
 * into this.messages FIRST; this resets the streaming state, (re)subscribes
 * to chat events, opens a session and calls startChat.
 *
 * `operacao` diz que TIPO de tarefa e este turno. Quem dispara sabe (quem
 * apertou "Fix" na selecao, quem viu a compilacao falhar); o modelo nao. O
 * main traduz isso em esforco de raciocinio (main/ai/effort_policy.js).
 * Ausente, vale o que a pessoa escolheu na interface.
 *
 * @param {string} [operacao]
 */
export async function despacharTurno(p: PainelDoTurno, operacao?: string): Promise<void> {
  // Assistant output is built lazily: text segments and tool chips
  // append in arrival order, so a turn reads top-to-bottom even when
  // the model interleaves "explain → call a tool → explain".
  p.turnText = '';
  p.segmentBuffer = '';
  p.currentAssistantContentEl = null;
  p.runningChips = [];
  p._toolGroup = null;
  // New turn → allow exactly one "Aurora Intelligence" label at the top of
  // p turn's first assistant bubble (later segments in the turn collapse).
  p._lastMsgRole = null;
  p.showThinking(true);

  // Subscribe lazily so we never miss the first packet, startChat
  // fires the work detached on main.
  if (!p.unsubChatEvent) {
    p.unsubChatEvent = (window.aiAPI as NonNullable<Window['aiAPI']>).onChatEvent((ev) => p.handleChatEvent(ev));
  }

  p.currentSessionId = (crypto.randomUUID && crypto.randomUUID()) ||
    `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  p.setStreaming(true);

  // Tool-type entries are display-only records; filter them before sending to
  // the model. Attachments are cloned (chat_turn.js) so the memory-hygiene
  // strip below can't wipe the payload out of what we're about to send.
  const apiMessages = buildApiMessages(p.messages);

  // Memory hygiene: the base64 dataUrls are now safely COPIED into apiMessages
  // for p turn, strip them from the stored history so they are NOT resent
  // on every subsequent turn (images up to 8 MB would accumulate and be
  // re-uploaded N times). Keep name/mime/size/kind for display; drop the payload.
  for (const m of p.messages) {
    if (m.attachments) {
      for (const a of m.attachments) delete a.dataUrl;
    }
  }

  const isSub = isSubProvider(p.currentProvider);
  const subEntry = p.providersAvailable.find((e) => e.name === p.currentProvider);

  // O caminho do projeto, as memorias e os componentes ausentes, relidos a
  // cada turno (js/ai/contexto_do_turno.ts diz por que).
  const { projectPath, spfPath, memories, componentes } = await lerContextoDoTurno();
  // Os dois vao SEPARADOS para o main, e nao concatenados como antes.
  //
  // O SYSTEM_PROMPT nao muda dentro de uma versao; o contexto do projeto e
  // relido do disco a cada turno de proposito (a pessoa pode trocar de
  // projeto, salvar memoria ou instalar componente no meio da conversa).
  // Juntos num blob so, a marca de cache da Anthropic cobria os dois, e
  // mudar 251 tokens de contexto jogava fora 10,4 mil estaveis. Quem decide
  // o que fazer com a separacao e cada runner: o caminho de API poe a marca
  // entre os dois, as CLIs juntam de novo (main/ai/prompt_cache.js).
  const systemPrompt = SYSTEM_PROMPT;
  const systemContext = buildProjectContext(projectPath, spfPath,
    memories as Parameters<typeof buildProjectContext>[2], componentes as Parameters<typeof buildProjectContext>[3]);
  // O bloco do tutorial vai SEPARADO, e nao mais colado no fim do contexto.
  //
  // Ele nao muda do primeiro ao ultimo turno da conversa de tutorial, e o
  // contexto do projeto muda a cada turno. Colados, o bloco inteiro era
  // reescrito toda vez, sem cache: medido em 13/09/2026, 36.423 caracteres de
  // paginas do manual (mais 37.424 de manifesto de ferramentas, que saiu por
  // ser copia do que o modelo ja recebe). Separado, ele leva marca propria de
  // uma hora e e lido do cache nos turnos seguintes.
  const systemFixo = p.tutorialBlock || undefined;

  try {
    const r = await (window.aiAPI as NonNullable<Window['aiAPI']>).startChat({
      sessionId: p.currentSessionId,
      conversationId: p.currentChatId,
      provider: p.currentProvider,
      modelId: isSub ? (subEntry?.model || 'default') : undefined,
      messages: apiMessages,
      system: systemPrompt,
      systemContext,
      systemFixo,
      // Shared effort selection, sent to any bridge that declares
      // hasEffort (Claude Code --effort; Codex -c model_reasoning_effort).
      effort: (SUB_META[p.currentProvider as string]?.hasEffort || p.currentProvider === 'anthropic') ? p.claudeCodeEffort : undefined,
      operacao,
      permission: p.permissionMode,
    });
    if (r && r.ok === false) p.failTurn(motivoDe(r, 'Failed to start chat'));
  } catch (e) {
    p.failTurn((e as { message?: string } | null)?.message || String(e));
  }
}

/**
 * Start a turn the assistant triggered itself (not the user), e.g. a
 * background task finished and the model should report back. `content` is
 * the synthetic user message handed to the model; a subtle "↻" note marks
 * the turn in the stream so the user sees why it appeared.
 *
 * If a turn is already streaming, the request is queued and drained when
 * that turn ends (see setStreaming → _drainAutoQueue). A safety cap stops
 * runaway self-chaining.
 */
export function continuarSozinho(p: PainelDoTurno, content: string, { label = 'Autonomous follow-up', operacao = null }: { label?: string; operacao?: string | null } = {}): void {
  if (!content || !p.currentProvider || !p.currentChatId) return;
  if (!p._autoQueue) p._autoQueue = [];
  // A operacao viaja NA FILA, e nao num campo do objeto: entre enfileirar e
  // despachar pode entrar outro turno, e um campo unico entregaria o rotulo
  // de uma tarefa ao seguinte.
  p._autoQueue.push({ content, label, operacao });
  if (!p._isStreaming) p._drainAutoQueue();
}

export function escoarAutonomos(p: PainelDoTurno): void {
  if (p._isStreaming) return;                 // wait for the live turn
  if (!p._autoQueue || !p._autoQueue.length) return;
  // Runaway guard: never let the assistant self-chain more than a handful of
  // turns without a human in the loop.
  p._autoChainCount = (p._autoChainCount || 0) + 1;
  if (p._autoChainCount > 5) {
    p._autoQueue = [];
    p.appendBubble('assistant',
      '_Paused autonomous follow-ups (chain limit reached). Send a message to continue._',
      { error: true });
    return;
  }
  const { content, label, operacao } = (p._autoQueue as NonNullable<PainelDoTurno['_autoQueue']>).shift() as NonNullable<PainelDoTurno['_autoQueue']>[number];
  // Subtle marker bubble (not a normal user message visually).
  if (p.chatEmptyHint) p.chatEmptyHint.classList.add('hidden');
  const note = document.createElement('div');
  note.className = 'ai-auto-note';
  note.innerHTML = '<i class="ph ph-arrows-clockwise" aria-hidden="true"></i><span></span>';
  (note.querySelector('span') as HTMLElement).textContent = label;
  p.messagesEl.appendChild(note);
  // The synthetic message goes into the model context as a user turn.
  p.messages.push({ role: 'user', content });
  p._capMessages();
  p._dispatchTurn(operacao || undefined);
}

export async function parar(p: PainelDoTurno): Promise<void> {
  if (!p.currentSessionId || !window.aiAPI) return;
  // An explicit stop cancels pending follow-ups too, otherwise the queue
  // would auto-drain (dispatch the next) the moment the abort lands. Vale
  // para as duas esperas: quem manda parar nao quer que a proxima saia
  // sozinha logo em seguida.
  p._messageQueue = [];
  p._liveQueue = [];
  p._renderQueue();
  const sid = p.currentSessionId;
  try { await window.aiAPI.abortChat(sid); }
  catch (_) { /* the stream side reports back via 'aborted' */ }
  // Safety net: if the backend never delivers a terminal event (a wedged
  // CLI process), force the UI back to idle so the composer is never stuck
  // spinning. Guarded on sid so we don't clobber a turn the user restarted.
  setTimeout(() => {
    if (p._isStreaming && p.currentSessionId === sid) {
      p.showThinking(false);
      p._closeToolGroup();
      p.resetTurnState();
      p.setStreaming(false);
    }
  }, 2000);
}

/* ---------------- stream watchdog (anti-freeze) ---------------- */

export function armarCaoDeGuarda(p: PainelDoTurno): void {
  p._disarmStreamWatchdog();
  p._lastEventAt = Date.now();
  p._streamWatchdog = setInterval(() => {
    if (!p._isStreaming) return;
    const idle = Date.now() - (p._lastEventAt || 0);
    // Never reap while a human is mid-answer on an ask/confirm card, those
    // are open for as long as the user takes.
    if (p.pendingAskUserQuestions && p.pendingAskUserQuestions.size) return;
    if (p.pendingConfirms && p.pendingConfirms.size) return;
    // A running tool chip normally blocks recovery (a real tool can take
    // minutes), but only up to the hard ceiling, past that the chip is stuck
    // and must not be able to suppress the rescue forever.
    if (p.runningChips.length && idle <= STREAM_STALL_HARD_MS) return;
    if (idle > STREAM_STALL_MS) {
      p._recoverFromStall();
    }
  }, 15000);
}

export function desarmarCaoDeGuarda(p: PainelDoTurno): void {
  if (p._streamWatchdog) {
    clearInterval(p._streamWatchdog);
    p._streamWatchdog = null;
  }
}

/**
 * Self-heal a turn that went silent with nothing pending, the "a conversa
 * trava" symptom. Aborts the backend, drops the spinner, and returns the
 * composer to idle so the user is never stranded. The notice is display-only
 * (not persisted into the model context).
 */
export function recuperarDoSilencio(p: PainelDoTurno): void {
  const sid = p.currentSessionId;
  try { if (sid) window.aiAPI?.abortChat?.(sid); } catch (_) { /* best-effort */ }
  p.showThinking(false);
  p._closeToolGroup();
  p.appendBubble('assistant',
    '_The assistant stopped responding, so the turn was reset. Send another message to continue._',
    { error: true });
  p.resetTurnState();
  p.setStreaming(false);
}

export function fecharTurno(p: PainelDoTurno): void {
  p._sealTurnText();
  // As citacoes vao DEPOIS do texto selado: elas sustentam o que ficou
  // escrito, entao aparecem embaixo dele, e nao no meio.
  registrarCitacoes(p);
  p.resetTurnState();
  // Auto-save the conversation after every turn.
  p.persistCurrentChat();
}

export function falharTurno(p: PainelDoTurno, message: string): void {
  p.showThinking(false);
  p._closeToolGroup();
  p.appendBubble('assistant', `Error: ${message}`, { error: true });
  // Mark in-flight chips as failed in DOM and persist them, args
  // are kept so the saved transcript still shows what was attempted.
  for (const running of p.runningChips) {
    const { toolName, toolUseId, args, el } = running;
    el.classList.remove('running');
    el.classList.add('failed');
    const statusEl = el.querySelector('.ai-tool-status');
    if (statusEl) statusEl.textContent = 'failed';
    const icon = el.querySelector('i');
    if (icon) icon.className = 'ph ph-x-circle';
    p.messages.push({
      role: 'tool',
      toolName,
      status: 'failed',
      toolUseId: toolUseId || null,
      args: args || null,
      error: message,
    });
  }
  p.persistCurrentChat();
  p.resetTurnState();
  p.setStreaming(false);
}

/**
 * Re-arm the render accumulators for the NEXT in-session turn, after
 * commitTurn() has sealed the previous one. Used only on `finish` with
 * `more`, i.e. the user pushed a follow-up mid-turn and the CLI is about
 * to answer it in the same session.
 *
 * Deliberately NOT resetTurnState(): that one is turn-ENDING teardown. It
 * nulls currentSessionId, and handleChatEvent drops any packet whose
 * sessionId doesn't match, so every event of the follow-up turn would be
 * silently discarded and the panel would sit on the thinking dots forever.
 * It also auto-denies open confirm cards and cancels open question cards,
 * which are perfectly legitimate mid-session. Keep all of that; reset only
 * what draws the next assistant bubble.
 */
export function proximoSegmento(p: PainelDoTurno): void {
  p._cancelarFrameDoStream();
  p.currentAssistantContentEl = null;   // next delta opens a fresh bubble
  p.segmentBuffer = '';
  p.turnText = '';
  p._committedTurnLen = 0;
  p._revealLength = 0;
  p._toolGroup = null;                  // next tool call opens a new group
  p.runningChips = [];
  p.hadToolCalls = false;
}

export function zerarTurno(p: PainelDoTurno): void {
  // Tear down the CLI-download status row here too, p is the chokepoint
  // every turn-ending path runs through (stop()'s safety net, the stall
  // watchdog, failTurn), so a download interrupted by Stop/stall can't leave
  // an orphaned "Downloading…" row behind.
  p._clearCliDownload();
  p._cancelarFrameDoStream();
  p.currentAssistantContentEl = null;
  p.segmentBuffer = '';
  p.turnText = '';
  p._committedTurnLen = 0;   // reset the per-turn "already stored" cursor
  p._revealLength = 0;
  p.currentSessionId = null;
  p.runningChips = [];
  p._toolGroup = null;
  p.hadToolCalls = false;
  // Auto-deny any confirmation cards still open when the turn ends
  // (e.g. the user hit Stop while a card was waiting).
  for (const decide of p.pendingConfirms) decide(false);
  p.pendingConfirms.clear();
  // Same for any open Ask-User-Question cards, resolve them as
  // cancelled so the awaiting tool call doesn't hang forever.
  if (p.pendingAskUserQuestions) {
    for (const decide of p.pendingAskUserQuestions) {
      decide({ answer: '[turn aborted before user answered]', selected: [] });
    }
    p.pendingAskUserQuestions.clear();
  }
}

export function definirTransmissao(p: PainelDoTurno, streaming: boolean): void {
  p._isStreaming = streaming;
  p.sendBtn.classList.toggle('hidden', streaming);
  p.stopBtn.classList.toggle('hidden', !streaming);
  // Keep textarea enabled so the user can compose their next message
  // while generation is running; Enter-to-send is blocked by _isStreaming.
  p.clearBtn.disabled = streaming;
  if (streaming) p._armStreamWatchdog();
  else {
    p._disarmStreamWatchdog();
    // A turn just ended, dispatch a queued USER follow-up first (explicit
    // intent), else an autonomous one.
    if (!p._drainMessageQueue()) p._drainAutoQueue();
  }
}
