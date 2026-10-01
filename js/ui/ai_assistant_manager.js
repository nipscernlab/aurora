/**
 * ai_assistant_manager.js: Aurora Intelligence side panel.
 *
 * Replaces the previous `<webview>`-based wrapper. The panel now talks
 * directly to a Vercel-AI-SDK-driven backend via `window.aiAPI`:
 *
 *   • renderer maintains the chat history,
 *   • each turn streams from main via `ai:chat-event` packets,
 *   • assistant text is rendered as Markdown live (token by token).
 *
 * Chat history (this version), every conversation is auto-persisted
 * to `userData/aurora-intelligence-chats/<id>.json` and listed in a
 * dropdown anchored to the history button. New / Open / Rename /
 * Delete operate on those files (see `main/ai/conversations.js`).
 */

import { motivoDe } from '../app/api_reply.js';
import { abrirAjudaDe } from './help_link.js';
import { semAnimar } from '../utils/resize.js';
import {
  aplicarLargura, larguraPermitida, aplicarAbertura, alternar, garantirAberto, reaplicarLimite,
  ligarDivisorDeLargura, ligarCantoDoTerminal, ligarReavaliacaoDaLargura,
} from '../ai/layout_do_painel.js';
import { correrEmSegundoPlano } from '../ai/tarefa_em_segundo_plano.js';
import { lerVersaoDoManual, juntarCitacao, colherCitacaoDeFerramenta, registrarCitacoes } from '../ai/citacoes_do_chat.js';
import {
  alternarPopover, desenharPermissoes, definirPermissao, atualizarProvedores, aplicarProvedor,
  escolherProvedor, definirEsforco, gravarModelo, atualizarEstadoDaAssinatura,
  desenharEstadoDaAssinatura, desenharEstadoDoProvedor, atualizarUso, desenharUso, ligarPopover,
} from '../ai/provedores_do_painel.js';
import { iniciarChip, terminarChip, fecharGrupo } from '../ai/chips_de_ferramenta.js';
import { SYSTEM_PROMPT } from '../ai/system_prompt.js';
import { rolarAoFim, ligarRolagem } from '../ai/rolagem_do_chat.js';
import { mostrarPensando, mostrarDownloadDaCli, limparDownloadDaCli, somarUso, atualizarContador } from '../ai/indicadores_do_turno.js';
import { receberPedaco, revelarSegmento, cancelarDesenho, selarTextoDoTurno } from '../ai/desenho_do_stream.js';
import { ligarComposer } from '../ai/composer_do_chat.js';
import { ligarCliquesNaConversa } from '../ai/cliques_na_conversa.js';
import { moldeDoPainel } from '../ai/molde_do_painel.js';
import { stripToolCallArtifacts } from '../ai/tool_call_text.js';
import { abrirReferencia, abrirCaminhoDoChat } from '../ai/abrir_referencia.js';
import { confiaEmLinksExternos, definirConfiancaEmLinks, confirmarLinkExterno } from '../ai/link_externo.js';
import { adicionarArquivos, abrirImagem, desenharAnexos, desenharAnexosNaBolha, escaparHtml } from '../ai/anexos_do_chat.js';
import { lerContextoDoTurno } from '../ai/contexto_do_turno.js';
import { avisoDeAssinatura, desenharFila } from '../ai/fila_do_chat.js';
import { confirmarFerramenta, perguntarAPessoa } from '../ai/perguntas_inline.js';
import {
  novaConversa, comecarTutorial, alternarHistorico, relerLista, cliqueNoHistorico,
  apagarConversa, abrirConversa, gravarConversa, ligarHistorico,
} from '../ai/conversas_do_chat.js';
import { buildApiMessages, buildProjectContext } from '../ai/chat_turn.js';
import {
  renderMarkdown, highlightCodeBlocks,
  linkifyFileRefs,
} from '../ai/chat_render.js';
import { marcarPonto, rotuloDoPedido, voltarAoPonto, listarPontos } from '../ai/rewind.js';
import {
  CLAUDE_CODE_EFFORT, SUB_META, isSubProvider, STREAM_STALL_MS, STREAM_STALL_HARD_MS,
  readPermissionMode,
} from '../ai/ai_metadata.js';

/* ============================================================
 *  Chat manager
 * ========================================================== */

class AIAssistantManager {
  constructor() {
    this.container = null;
    this.providerSelect = null;
    this.providerIcon = null;
    this.messagesEl = null;
    this.emptyStateEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    /** Pending composer attachments: { id, kind:'image'|'file', name, mime, size, dataUrl?, text? }. */
    this.pendingAttachments = [];
    this.stopBtn = null;
    this.clearBtn = null;
    this.tokenCounter = null;

    this.messages = [];              // [{ role:'user'|'assistant', content }]
    // The bottom "aurora glow" starts OFF and reveals on the user's first
    // message of the session, then stays lit. In-memory on purpose: closing and
    // reopening the panel keeps it; only a fresh app start replays the reveal.
    this._glowRevealed = false;
    this.currentProvider = null;
    this.providersAvailable = [];    // [{ name, model, defaultModel }]
    this.providersConfigured = {};   // { name: bool }
    this.currentSessionId = null;
    this.currentAssistantContentEl = null;  // current text segment bubble, or null
    this.segmentBuffer = '';                // text of the current segment
    this.turnText = '';                     // full assistant text for the turn
    this._committedTurnLen = 0;             // chars of turnText already stored as messages
    this.runningChips = [];                 // [{ toolName, el }] in-flight tools
    this.thinkingEl = null;                 // "thinking…" placeholder, or null
    this._lastMsgRole = null;               // role of the last appended bubble (label de-dup)
    this.cumulativeTokens = 0;

    this.unsubChatEvent = null;

    // Tool permission gate.
    this.permissionMode = readPermissionMode();
    this.modelPopoverOpen = false;
    this.pendingConfirms = new Set();   // resolve fns of open confirmation cards

    // Subscription-provider (Claude Code / ChatGPT) state, keyed by
    // provider name so both CLIs share the same panel machinery.
    this.subStatus = {};                // provider → { installed, authed, … }
    this.subUsage = {};                 // provider → usage snapshot
    this.claudeCodeEffort = '';         // '' | low | medium | high | xhigh | max
    try {
      const e = localStorage.getItem('aurora-ai-cc-effort');
      if (CLAUDE_CODE_EFFORT.some((x) => x.id === e)) this.claudeCodeEffort = e;
    } catch (_) { /* default '' */ }

    // Persistent chat history.
    this.currentChatId = null;          // null until the user sends the 1st turn
    this.currentChatTitle = '';
    this.currentChatCreatedAt = 0;
    this.historyOpen = false;
    this.chatList = [];                 // cached light metadata

    // Smart auto-scroll: true while the viewport is glued to the bottom.
    // The user scrolling up flips this to false (frees them to read
    // earlier messages); scrolling back to the bottom flips it on again.
    // Every appendDelta / appendBubble / tool chip respects this flag:
    // we only push the viewport when the user is already at the bottom.
    this.stickToBottom = true;
  }

  /* ---------------- rolagem ---------------- */
  // Acompanhar o fim, soltar quando a pessoa sobe e o "Jump to latest" moram
  // em js/ai/rolagem_do_chat.ts.

  /** Vai ao fim se a pessoa nao subiu para ler; `force` volta a acompanhar. */
  scrollToBottom(force = false) { rolarAoFim(this, force); }

  /* ---------------- layout ---------------- */
  // A largura, abrir e fechar, e os dois arrastadores moram em
  // js/ai/layout_do_painel.ts; o painel e o contexto.

  toggle() { alternar(this); }
  /** Unico lugar que aplica a largura e o estado que anda com ela. */
  _aplicarLargura(w) { aplicarLargura(this, w); }
  /** A regra de tamanho do painel (o E2E de layout a chama pela instancia). */
  _larguraPermitida(desejado) { return larguraPermitida(desejado); }
  _applyOpenWidth(opening) { aplicarAbertura(this, opening); }
  /** Bring the panel up if it isn't already open (idempotent). */
  ensureOpen() { garantirAberto(this); }
  reclampWidth() { reaplicarLimite(this); }

  /**
   * Public entry for the Monaco selection "star": open the panel and seed the
   * composer with a snippet the user highlighted, so they can ask the AI about
   * that exact passage. With a concrete `intent` ('explain'|'fix'|'improve'|
   * 'comment'|'doc') and `send:true`, the message is dispatched immediately;
   * otherwise the composer is just pre-filled and focused for the user to type.
   *
   * Reached via window.AuroraAPI.ai.askAboutSelection(...).
   */
  askAboutSelection({ code = '', language = '', filePath = '', lineStart = 0, lineEnd = 0, intent = '', send = false } = {}) {
    const snippet = String(code || '').replace(/\s+$/, '');
    if (!snippet) return;
    this.ensureOpen();
    if (!this.inputEl) return;

    const fileName = filePath ? String(filePath).split(/[\\/]/).pop() : '';
    const lineRef = lineStart && lineEnd
      ? (lineStart === lineEnd ? `line ${lineStart}` : `lines ${lineStart}–${lineEnd}`)
      : '';
    const where = fileName
      ? `\`${fileName}\`${lineRef ? ` (${lineRef})` : ''}`
      : (lineRef || 'the selection');

    const INTENT_LEAD = {
      explain: 'Explain what this code does',
      fix: 'Find and fix any bugs in this code',
      improve: 'Improve and refactor this code',
      comment: 'Add clear, concise comments to this code',
      doc: 'Write documentation for this code',
    };
    // Do botao para a operacao, e dai para o esforco. A regra e o RACIOCINIO
    // que a tarefa exige, e nao o nome do botao: explicar, comentar e
    // documentar sao a mesma leitura local de um trecho que ja esta na tela,
    // e caem na mesma linha da tabela. `fix` e o oposto, exige simular a
    // execucao e comparar hipoteses. `improve` fica de fora de proposito: nao
    // esta na tabela, entao vale o que a pessoa escolheu na interface, que e
    // melhor do que inventarmos um esforco para quem paga a conta.
    const OPERACAO_DO_INTENT = {
      explain: 'comentar',
      comment: 'comentar',
      doc: 'comentar',
      fix: 'acharErros',
    };
    const lead = INTENT_LEAD[intent] || '';
    const fence = '```' + (language || '');
    const body = `${lead ? lead + ' ' : ''}from ${where}:\n\n${fence}\n${snippet}\n\`\`\`\n`;

    // Don't clobber a half-typed message the user already has in the composer.
    const existing = this.inputEl.value;
    this.inputEl.value = existing && !send ? `${existing.replace(/\s*$/, '')}\n\n${body}` : body;
    this.autoGrowInput?.();
    this.inputEl.focus();
    if (lead && send && !this._isStreaming) {
      this._operacaoDoProximoEnvio = OPERACAO_DO_INTENT[intent] || null;
      this.send();
    } else if (!lead) {
      // Free-form "Ask…": leave the cursor at the very start so the user types
      // their question above the quoted snippet.
      try { this.inputEl.setSelectionRange(0, 0); } catch (_) { /* not focusable yet */ }
    }
  }

  initialize() {
    // Idempotente de proposito. Sem esta guarda, uma segunda chamada criava um
    // SEGUNDO painel no .main-container: o gerenciador passava a governar o
    // novo, o antigo ficava orfao no DOM ainda ocupando espaco na faixa, e a
    // largura ia para um elemento enquanto a tela mostrava o outro. Acontece de
    // verdade porque ha dois caminhos de entrada, o window.onload do renderer e
    // o `if (!this.container) this.initialize()` do toggle, e quem chegar
    // primeiro nao impedia o segundo.
    if (this.container && this.container.isConnected) return;

    // Lido AQUI, e nao no restore la embaixo: montar o painel passa por
    // `_aplicarLargura(0)`, que grava esta mesma chave, entao ler depois leria
    // o que nos mesmos acabamos de escrever e o painel nunca reabriria sozinho.
    let abertoNaSessaoAnterior = false;
    try {
      abertoNaSessaoAnterior = localStorage.getItem('aurora-ai-panel-open') === '1';
    } catch (_) { /* modo privado */ }
    this.container = document.createElement('div');
    this.container.className = 'ai-assistant-container';
    this.container.innerHTML = moldeDoPainel();
    // v3: AI panel is a flex sibling of .file-tree-container and
    // .editor-terminal-container inside .main-container, so opening it
    // pushes (not overlays) the editor area. Fallback to body for the
    // edge case where main-container hasn't rendered yet (unlikely:
    // initialize() runs on first toggle, well after DOMContentLoaded).
    const mountTarget = document.querySelector('.main-container') || document.body;
    // Antes do trilho da direita, para a ordem visual ficar trilho, arvore,
    // editor, painel, trilho. Sem projeto no DOM o insertBefore vira append.
    mountTarget.insertBefore(this.container, mountTarget.querySelector('.edge-rail-right'));
    try { window.i18nApplyDOM?.(this.container); } catch (_) { /* i18n optional */ }
    // Nasce fechado, pelo mesmo caminho de todo mundo: e o que poe o `inert`,
    // para o Tab nao alcancar o painel de largura zero, e o `ai-collapsed`, que
    // acende o trilho da direita ja no arranque.
    this._aplicarLargura(0);

    this.providerIcon  = this.container.querySelector('#ai-provider-icon');
    this.messagesEl    = this.container.querySelector('#ai-messages');
    this.emptyStateEl  = this.container.querySelector('#ai-empty-state');
    this.inputEl       = this.container.querySelector('#ai-input');
    this.composerEl    = this.container.querySelector('#ai-composer');
    this.sendBtn       = this.container.querySelector('#ai-send-btn');
    this.attachBtn     = this.container.querySelector('#ai-attach-btn');
    this.attachInput   = this.container.querySelector('#ai-attach-input');
    this.attachmentsEl = this.container.querySelector('#ai-attachments');
    this.queueEl       = this.container.querySelector('#ai-msg-queue');
    this._messageQueue = [];
    this.stopBtn       = this.container.querySelector('#ai-stop-btn');
    this.clearBtn      = this.container.querySelector('#ai-clear-btn');
    this.tutorialBtn   = this.container.querySelector('#ai-tutorial-btn');
    this.tokenCounter  = this.container.querySelector('#ai-token-counter');

    // Model / provider chip + popover.
    this.modelChip     = this.container.querySelector('#ai-model-chip');
    this.modelChipIcon = this.container.querySelector('#ai-model-chip-icon');
    this.modelChipName = this.container.querySelector('#ai-model-chip-name');
    this.modelPopover  = this.container.querySelector('#ai-model-popover');
    this.mpProviders   = this.container.querySelector('#ai-mp-providers');
    this.mpPerms       = this.container.querySelector('#ai-mp-perms');
    this.modelInput    = this.container.querySelector('#ai-model-input');
    this.modelResetBtn = this.container.querySelector('#ai-model-reset');
    this.mpModelApi    = this.container.querySelector('#ai-mp-model-api');
    this.mpModelPresets= this.container.querySelector('#ai-mp-model-presets');
    this.mpUsage       = this.container.querySelector('#ai-mp-usage');
    this.usageBars     = this.container.querySelector('#ai-usage-bars');
    this.usagePlan     = this.container.querySelector('#ai-usage-plan');
    this.ccStatusEl    = this.container.querySelector('#ai-mp-cc-status');
    this.effortSection = this.container.querySelector('#ai-mp-effort-section');
    this.effortSeg     = this.container.querySelector('#ai-mp-effort');
    this.ccSections    = this.container.querySelectorAll('.ai-mp-cc');

    this.historyBtn        = this.container.querySelector('#ai-history-btn');
    this.historyPopover    = this.container.querySelector('#ai-history-popover');
    this.historyList       = this.container.querySelector('#ai-history-list');
    this.chatEmptyHint     = this.container.querySelector('#ai-chat-empty-hint');

    this.buildPermissionOptions();
    this.attachListeners();
    ligarDivisorDeLargura(this, this.container.querySelector('.ai-resize-handle'), this.container);
    ligarCantoDoTerminal(this);

    // v3 layout: width = 0 means closed, width > 0 means open. CSS
    // initial value is 0; nothing to set here for the closed case.
    // (Persisted width is applied by _applyOpenWidth when opening.)

    // Restore open state, if the panel was open when the user last closed
    // the app, re-open it now so they land right back where they left off.
    if (abertoNaSessaoAnterior) {
      // `open`, `ai-assistant-open` e o `inert` saem todos daqui: eram tres
      // linhas soltas antes, e eram elas que podiam discordar da largura.
      //
      // Sem animar: no arranque nao ha interacao para acompanhar, a largura
      // salva vem de 0, e os 240 ms de animacao caem exatamente na janela em
      // que o Monaco esta inicializando, com `automaticLayout` ele observa o
      // proprio contorno, entao cada quadro dali e um relayout de editor.
      semAnimar(this.container, () => this._applyOpenWidth(true));
      this.refreshProviders().then(() => this.inputEl?.focus());
      this.refreshChatList();
    }
  }

  attachListeners() {
    this.container.querySelector('.ai-hbtn-close').addEventListener('click', () => this.toggle());
    this.container.querySelector('#ai-help-btn')
      ?.addEventListener('click', () => abrirAjudaDe('aiPanelHelp'));

    // A versao do manual, para carimbar as citacoes. Lida agora e RELIDA ao
    // voltar o foco: o manual se atualiza sozinho por manifesto, no meio da
    // sessao, e uma citacao carimbada com a versao velha mandaria o leitor
    // procurar a diferenca no lugar errado.
    this._lerVersaoDoManual();
    window.addEventListener('focus', () => this._lerVersaoDoManual());

    // Cada grupo de controles e ligado pelo modulo que e dono dele.
    ligarReavaliacaoDaLargura(this);   // layout_do_painel.ts
    ligarPopover(this);                // provedores_do_painel.ts
    ligarHistorico(this);              // conversas_do_chat.ts
    ligarComposer(this);               // composer_do_chat.ts
    ligarCliquesNaConversa(this.messagesEl);   // cliques_na_conversa.ts
    ligarRolagem(this);                // rolagem_do_chat.ts
  }

  /* ---------------- model / provider popover ---------------- */
  // O popover de provedor e modelo, o esforco, a permissao, a linha de estado
  // e o uso moram em js/ai/provedores_do_painel.ts; o painel e o contexto.

  toggleModelPopover(force) { alternarPopover(this, force); }
  buildPermissionOptions() { desenharPermissoes(this); }
  setPermissionMode(mode) { definirPermissao(this, mode); }
  refreshProviders() { return atualizarProvedores(this); }
  /** Reflect the active provider across the icon, chip, controls and usage. */
  applyProviderState() { aplicarProvedor(this); }
  /** Switch the active provider (from a radio change in the popover). */
  selectProvider(name) { escolherProvedor(this, name); }
  setClaudeCodeEffort(id) { definirEsforco(this, id); }
  /** Persist a model id for the active provider and refresh the chip. */
  commitModel(value) { return gravarModelo(this, value); }
  refreshSubStatus() { return atualizarEstadoDaAssinatura(this); }
  renderSubStatus() { desenharEstadoDaAssinatura(this); }
  renderProviderStatus() { desenharEstadoDoProvedor(this); }
  refreshSubUsage() { return atualizarUso(this); }
  renderUsage() { desenharUso(this); }

  /** A versao do manual, para carimbar as citacoes (js/ai/citacoes_do_chat.ts). */
  _lerVersaoDoManual() { return lerVersaoDoManual(this); }

  // O aviso antes de abrir link externo mora em js/ai/link_externo.ts.
  _getTrustExternalLinks() { return confiaEmLinksExternos(); }

  _setTrustExternalLinks(v) { definirConfiancaEmLinks(v); }

  _confirmExternalLink(url) { confirmarLinkExterno(url); }

  /** Um caminho absoluto clicado na conversa (js/ai/abrir_referencia.ts). */
  async _openChatPath(rawPath) { await abrirCaminhoDoChat(rawPath); }

  /* ---------------- tool permission gate ---------------- */

  /**
   * A ferramenta pode rodar? Chamado pelo tool_runner antes de cada uma. O
   * cartao de permissao mora em js/ai/perguntas_inline.ts.
   */
  confirmToolCall(def, args) { return confirmarFerramenta(this, def, args); }

  /**
   * Runaway guard for memory hygiene: a single never-ending conversation must
   * not grow `this.messages` without bound. Keep the most recent
   * MAX_RETAINED_MESSAGES (a high cap normal chats never hit); switching/closing
   * a chat already resets the array entirely (the common path). On the rare trim
   * the very oldest turns drop from the locally-held history, acceptable at this
   * size (the subscription CLIs keep their own context via --resume).
   */
  _capMessages() {
    const MAX_RETAINED_MESSAGES = 400;
    if (this.messages.length > MAX_RETAINED_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_RETAINED_MESSAGES);
    }
  }

  /** O cartao de pergunta (ask_user_question), chamado pelo aurora_api; mora em js/ai/perguntas_inline.ts. */
  showAskUserQuestionInline(params) { return perguntarAPessoa(this, params); }

  showEmptyState(show) {
    this.emptyStateEl.classList.toggle('hidden', !show);
    this.messagesEl.classList.toggle('hidden', show);
    if (!show && this.chatEmptyHint) {
      this.chatEmptyHint.classList.toggle('hidden', this.messages.length > 0);
    }
  }

  /* ---------------- sending ---------------- */

  async send() {
    if (!window.aiAPI || !this.currentProvider) return;
    const text = this.inputEl.value.trim();
    const atts = this.pendingAttachments.slice();
    if (!text && atts.length === 0) return;

    // Claude Code / ChatGPT talk to the user's subscription via a local
    // CLI. If it isn't installed / signed in, fail fast with a clear
    // notice (display-only bubble, not persisted) instead of a stream error.
    if (isSubProvider(this.currentProvider)) {
      const sm = SUB_META[this.currentProvider];
      if (!this.subStatus[this.currentProvider]) await this.refreshSubStatus();
      // B12: a CLI baixavel com login serve (js/ai/fila_do_chat.ts).
      const aviso = avisoDeAssinatura(this.subStatus[this.currentProvider], sm);
      if (aviso) {
        this.appendBubble('assistant', aviso, false);
        return;
      }
    }

    // Capture + clear the composer immediately so the user can keep typing.
    this.inputEl.value = '';
    this.pendingAttachments = [];
    this._renderAttachments();
    this.autoGrowInput();

    // A turn is already streaming. Preferred: push into the LIVE session so the
    // model answers it without a re-dispatch. If this runner has no open input
    // channel (everything but the Claude Agent SDK engine), fall back to the
    // follow-up queue, which dispatches when the current turn ends.
    if (this._isStreaming) {
      if (await this._tryPushLive(text, atts)) return;
      // Sem canal vivo (todo runner menos o Agent SDK) a mensagem espera na
      // fila, que anda quando a resposta acaba. Cada item da fila tem um botao
      // de enviar agora, que interrompe a resposta em curso (ela fica no
      // historico ate onde chegou) e poe a mensagem na conversa na hora.
      (this._messageQueue || (this._messageQueue = [])).push({ text, atts });
      this._renderQueue();
      return;
    }
    await this._submitUserMessage(text, atts);
  }

  /** Tira um item da fila e o envia agora, interrompendo a resposta em curso. */
  async _enviarDaFilaAgora(i) {
    const item = this._messageQueue && this._messageQueue.splice(i, 1)[0];
    this._renderQueue();
    if (!item) return;
    if (this._isStreaming && !(await this._interromperParaFalar())) {
      // Nao fechou: devolve ao inicio da fila em vez de perder a mensagem.
      this._messageQueue.unshift(item);
      this._renderQueue();
      return;
    }
    await this._submitUserMessage(item.text, item.atts || []);
  }

  /**
   * Interrompe a resposta em curso e espera o turno fechar, para a proxima
   * mensagem do usuario entrar em ordem. Devolve false se o turno nao fechou
   * em tempo (runner travado): quem chama cai na fila.
   */
  async _interromperParaFalar() {
    const sid = this.currentSessionId;
    if (!sid) return true;
    try { await window.aiAPI.abortChat(sid); } catch (_) { /* o 'aborted' fecha do lado de la */ }
    const limite = Date.now() + 3000;
    while (this._isStreaming && this.currentSessionId === sid && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 40));
    }
    if (this._isStreaming && this.currentSessionId === sid) {
      // O runner nao respondeu ao abort: forca o fechamento, como o stop() faz.
      this.showThinking(false);
      this._closeToolGroup();
      this.commitTurn();
      this.resetTurnState();
      this.setStreaming(false);
    }
    return !this._isStreaming;
  }

  /** Reveal the bottom aurora glow on the user's first message of the session,
   *  then leave it lit. Idempotent via the in-memory flag, so reopening the panel
   *  keeps the glow and only a fresh app start replays the reveal. */
  _revealGlow() {
    if (this._glowRevealed) return;
    this._glowRevealed = true;
    const glow = this.container?.querySelector('.ai-aurora-glow');
    if (glow) glow.classList.add('revealed');
  }

  /** Append the user bubble, record the message, and dispatch its turn. Shared
   *  by an immediate send and by draining a queued follow-up. */
  async _submitUserMessage(text, atts) {
    // First message of a new chat, assign an id, derive a title from the
    // user's text, and mark this as the conversation we'll persist.
    if (!this.currentChatId) {
      try {
        const r = await window.aiAPI.newConversationId?.();
        this.currentChatId = (r && r.id) || `c-${Date.now()}`;
      } catch (_) { this.currentChatId = `c-${Date.now()}`; }
      this.currentChatTitle = text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';
      this.currentChatCreatedAt = Date.now();
    }

    // First real user message of the session lights the aurora glow (it rises
    // from the bottom and brightens, then stays on). No-op after the first time.
    this._revealGlow();

    // Um ponto de restauracao ANTES de a IA encostar em qualquer arquivo. E o
    // gesto que mais causa arrependimento no projeto de alguem, e o unico em
    // que a pessoa nao viu o que ia acontecer antes de acontecer. Nao se
    // espera por ele: marcar o instante nao pode atrasar o envio.
    const idDaMensagem = `msg-${Date.now()}`;
    marcarPonto({ motivo: 'pedido', rotulo: rotuloDoPedido(text), mensagemId: idDaMensagem });
    const userBubble = this.appendBubble('user', text);
    userBubble?.setAttribute('data-ponto', idDaMensagem);
    if (atts.length) this._renderBubbleAttachments(userBubble, atts);
    this.messages.push({ role: 'user', content: text, attachments: atts.length ? atts : undefined });
    this._capMessages();
    // A real user message breaks any autonomous follow-up chain.
    this._autoChainCount = 0;

    // A operacao vale para UM envio. Quem a marcou foi o botao da selecao
    // logo antes de chamar send(); qualquer outro envio e turno livre, e um
    // rotulo esquecido aqui daria esforco errado na mensagem seguinte.
    const operacao = this._operacaoDoProximoEnvio || undefined;
    this._operacaoDoProximoEnvio = null;

    await this._dispatchTurn(operacao);
  }

  /**
   * Try to hand a follow-up to the turn that is running right now, so the model
   * sees it in-session instead of after a fresh dispatch. Returns true when the
   * live turn took it, the caller then does NOT queue.
   *
   * Attachments deliberately never take this path: the live channel carries
   * plain text, and an image has to ride the normal startChat payload.
   */
  async _tryPushLive(text, atts) {
    if (!text || (atts && atts.length)) return false;
    if (!window.aiAPI?.pushChatMessage || !this.currentSessionId) return false;
    let accepted = false;
    try {
      const r = await window.aiAPI.pushChatMessage(this.currentSessionId, text);
      accepted = !!(r && r.ok && r.data && r.data.accepted);
    } catch (e) {
      console.warn('[ai] live push failed — queueing instead:', e);
      return false;
    }
    if (!accepted) return false;
    // A mensagem esta com a sessao, mas a assistente ainda esta escrevendo a
    // resposta anterior: quem decide QUANDO aceita-la e ela, e o main avisa no
    // momento em que isso acontece (`follow-up-taken`). Ate la a mensagem
    // aparece como ficha em espera, e nao como balao na conversa.
    //
    // Punha-la na conversa aqui era o defeito: o balao ia para o fim enquanto
    // o texto continuava entrando na bolha de cima, entao a resposta parecia
    // cortada no meio, e no historico a pergunta ficava ANTES da resposta que
    // ela nem tinha interrompido.
    (this._liveQueue || (this._liveQueue = [])).push(text);
    this._renderQueue();
    return true;
  }

  /**
   * A assistente aceitou a mensagem que esperava: agora ela entra na conversa,
   * no lugar certo da ordem, e a ficha de espera sai.
   */
  _followUpTaken(content) {
    const texto = typeof content === 'string' ? content : '';
    if (this._liveQueue && this._liveQueue.length) {
      const i = this._liveQueue.indexOf(texto);
      this._liveQueue.splice(i >= 0 ? i : 0, 1);
      this._renderQueue();
    }
    if (!texto) return;
    this.messages.push({ role: 'user', content: texto });
    this.appendBubble('user', texto);
    this.scrollToBottom();
  }

  /**
   * O turno morreu (abortado ou com erro) e havia mensagem entregue a sessao
   * que ela nunca chegou a aceitar. Ela volta para a fila deste lado, para o
   * proximo turno leva-la: perder uma mensagem que a pessoa escreveu porque a
   * sessao caiu seria o pior desfecho dos tres.
   */
  _devolverVivasAFila() {
    const vivas = this._liveQueue || [];
    if (!vivas.length) return;
    this._liveQueue = [];
    const fila = this._messageQueue || (this._messageQueue = []);
    fila.unshift(...vivas.map((text) => ({ text, atts: [] })));
    this._renderQueue();
  }

  /** Dispatch the next queued user follow-up, if any. Returns true if it did
   *  (so the turn-end drain prefers a user message over an autonomous one). */
  _drainMessageQueue() {
    if (this._isStreaming) return false;
    if (!this._messageQueue || !this._messageQueue.length) return false;
    const { text, atts } = this._messageQueue.shift();
    this._renderQueue();
    this._submitUserMessage(text, atts); // async, fire-and-forget (sets streaming)
    return true;
  }

  /**
   * As fichas de espera acima do compositor.
   *
   * Sao duas esperas diferentes, e a diferenca importa para quem olha. As do
   * `_liveQueue` ja foram entregues a sessao e so aguardam a assistente
   * termina o que esta dizendo: nao ha o que cancelar nem o que apressar, e
   * elas viram balao sozinhas quando ela as aceita. As do `_messageQueue`
   * esperam do lado de ca, porque este motor nao tem canal aberto, e essas
   * sim se cancelam e se apressam.
   */
  _renderQueue() {
    if (!this.queueEl) return;
    desenharFila(this.queueEl, this._liveQueue || [], this._messageQueue || [], {
      aoCancelar: (i) => { this._messageQueue.splice(i, 1); this._renderQueue(); },
      aoEnviarAgora: (i) => this._enviarDaFilaAgora(i),
    });
  }

  /* ---------------- composer attachments (images + files) ---------------- */
  // Ler, desenhar e abrir em tela cheia moram em js/ai/anexos_do_chat.ts; o
  // painel guarda a lista pendente e a faixa do composer.

  /** Read dropped / picked / pasted files into pendingAttachments, then render. */
  async _addFiles(fileList) {
    await adicionarArquivos(this.pendingAttachments, fileList,
      (texto) => this.appendBubble('assistant', texto, false));
    this._renderAttachments();
  }

  _removeAttachment(id) {
    this.pendingAttachments = this.pendingAttachments.filter((a) => a.id !== id);
    this._renderAttachments();
  }

  _escAtt(s) { return escaparHtml(s); }

  /** Render the preview chips row above the composer. */
  _renderAttachments() {
    if (!this.attachmentsEl) return;
    desenharAnexos(this.attachmentsEl, this.pendingAttachments, (id) => this._removeAttachment(id));
  }

  /** Render a read-only attachments strip inside a sent user bubble. */
  _renderBubbleAttachments(bubble, atts) { desenharAnexosNaBolha(bubble, atts); }

  /** Full-size image viewer for an attached chat image. */
  _openImageLightbox(src, alt) { abrirImagem(src, alt); }

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
  async _dispatchTurn(operacao) {
    // Assistant output is built lazily: text segments and tool chips
    // append in arrival order, so a turn reads top-to-bottom even when
    // the model interleaves "explain → call a tool → explain".
    this.turnText = '';
    this.segmentBuffer = '';
    this.currentAssistantContentEl = null;
    this.runningChips = [];
    this._toolGroup = null;
    // New turn → allow exactly one "Aurora Intelligence" label at the top of
    // this turn's first assistant bubble (later segments in the turn collapse).
    this._lastMsgRole = null;
    this.showThinking(true);

    // Subscribe lazily so we never miss the first packet, startChat
    // fires the work detached on main.
    if (!this.unsubChatEvent) {
      this.unsubChatEvent = window.aiAPI.onChatEvent((ev) => this.handleChatEvent(ev));
    }

    this.currentSessionId = (crypto.randomUUID && crypto.randomUUID()) ||
      `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.setStreaming(true);

    // Tool-type entries are display-only records; filter them before sending to
    // the model. Attachments are cloned (chat_turn.js) so the memory-hygiene
    // strip below can't wipe the payload out of what we're about to send.
    const apiMessages = buildApiMessages(this.messages);

    // Memory hygiene: the base64 dataUrls are now safely COPIED into apiMessages
    // for this turn, strip them from the stored history so they are NOT resent
    // on every subsequent turn (images up to 8 MB would accumulate and be
    // re-uploaded N times). Keep name/mime/size/kind for display; drop the payload.
    for (const m of this.messages) {
      if (m.attachments) {
        for (const a of m.attachments) delete a.dataUrl;
      }
    }

    const isSub = isSubProvider(this.currentProvider);
    const subEntry = this.providersAvailable.find((p) => p.name === this.currentProvider);

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
    const systemContext = buildProjectContext(projectPath, spfPath, memories, componentes);
    // O bloco do tutorial vai SEPARADO, e nao mais colado no fim do contexto.
    //
    // Ele nao muda do primeiro ao ultimo turno da conversa de tutorial, e o
    // contexto do projeto muda a cada turno. Colados, o bloco inteiro era
    // reescrito toda vez, sem cache: medido em 13/09/2026, 36.423 caracteres de
    // paginas do manual (mais 37.424 de manifesto de ferramentas, que saiu por
    // ser copia do que o modelo ja recebe). Separado, ele leva marca propria de
    // uma hora e e lido do cache nos turnos seguintes.
    const systemFixo = this.tutorialBlock || undefined;

    try {
      const r = await window.aiAPI.startChat({
        sessionId: this.currentSessionId,
        conversationId: this.currentChatId,
        provider: this.currentProvider,
        modelId: isSub ? (subEntry?.model || 'default') : undefined,
        messages: apiMessages,
        system: systemPrompt,
        systemContext,
        systemFixo,
        // Shared effort selection, sent to any bridge that declares
        // hasEffort (Claude Code --effort; Codex -c model_reasoning_effort).
        effort: (SUB_META[this.currentProvider]?.hasEffort || this.currentProvider === 'anthropic') ? this.claudeCodeEffort : undefined,
        operacao,
        permission: this.permissionMode,
      });
      if (r && r.ok === false) this.failTurn(motivoDe(r, 'Failed to start chat'));
    } catch (e) {
      this.failTurn(e?.message || String(e));
    }
  }

  /* ---------------- autonomous turns (Phase E) ---------------- */

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
  autoContinue(content, { label = 'Autonomous follow-up', operacao = null } = {}) {
    if (!content || !this.currentProvider || !this.currentChatId) return;
    if (!this._autoQueue) this._autoQueue = [];
    // A operacao viaja NA FILA, e nao num campo do objeto: entre enfileirar e
    // despachar pode entrar outro turno, e um campo unico entregaria o rotulo
    // de uma tarefa ao seguinte.
    this._autoQueue.push({ content, label, operacao });
    if (!this._isStreaming) this._drainAutoQueue();
  }

  _drainAutoQueue() {
    if (this._isStreaming) return;                 // wait for the live turn
    if (!this._autoQueue || !this._autoQueue.length) return;
    // Runaway guard: never let the assistant self-chain more than a handful of
    // turns without a human in the loop.
    this._autoChainCount = (this._autoChainCount || 0) + 1;
    if (this._autoChainCount > 5) {
      this._autoQueue = [];
      this.appendBubble('assistant',
        '_Paused autonomous follow-ups (chain limit reached). Send a message to continue._',
        { error: true });
      return;
    }
    const { content, label, operacao } = this._autoQueue.shift();
    // Subtle marker bubble (not a normal user message visually).
    if (this.chatEmptyHint) this.chatEmptyHint.classList.add('hidden');
    const note = document.createElement('div');
    note.className = 'ai-auto-note';
    note.innerHTML = '<i class="ph ph-arrows-clockwise" aria-hidden="true"></i><span></span>';
    note.querySelector('span').textContent = label;
    this.messagesEl.appendChild(note);
    // The synthetic message goes into the model context as a user turn.
    this.messages.push({ role: 'user', content });
    this._capMessages();
    this._dispatchTurn(operacao || undefined);
  }

  /**
   * Comeca uma compilacao em segundo plano e devolve na hora; quando ela acaba,
   * a assistente continua sozinha com o resultado. Porta do aurora_api
   * (ai.runInBackground); mora em js/ai/tarefa_em_segundo_plano.ts.
   */
  runInBackground(pedido) { return correrEmSegundoPlano(this, pedido); }

  async stop() {
    if (!this.currentSessionId || !window.aiAPI) return;
    // An explicit stop cancels pending follow-ups too, otherwise the queue
    // would auto-drain (dispatch the next) the moment the abort lands. Vale
    // para as duas esperas: quem manda parar nao quer que a proxima saia
    // sozinha logo em seguida.
    this._messageQueue = [];
    this._liveQueue = [];
    this._renderQueue();
    const sid = this.currentSessionId;
    try { await window.aiAPI.abortChat(sid); }
    catch (_) { /* the stream side reports back via 'aborted' */ }
    // Safety net: if the backend never delivers a terminal event (a wedged
    // CLI process), force the UI back to idle so the composer is never stuck
    // spinning. Guarded on sid so we don't clobber a turn the user restarted.
    setTimeout(() => {
      if (this._isStreaming && this.currentSessionId === sid) {
        this.showThinking(false);
        this._closeToolGroup();
        this.resetTurnState();
        this.setStreaming(false);
      }
    }, 2000);
  }

  /* ---------------- stream watchdog (anti-freeze) ---------------- */

  _armStreamWatchdog() {
    this._disarmStreamWatchdog();
    this._lastEventAt = Date.now();
    this._streamWatchdog = setInterval(() => {
      if (!this._isStreaming) return;
      const idle = Date.now() - (this._lastEventAt || 0);
      // Never reap while a human is mid-answer on an ask/confirm card, those
      // are open for as long as the user takes.
      if (this.pendingAskUserQuestions && this.pendingAskUserQuestions.size) return;
      if (this.pendingConfirms && this.pendingConfirms.size) return;
      // A running tool chip normally blocks recovery (a real tool can take
      // minutes), but only up to the hard ceiling, past that the chip is stuck
      // and must not be able to suppress the rescue forever.
      if (this.runningChips.length && idle <= STREAM_STALL_HARD_MS) return;
      if (idle > STREAM_STALL_MS) {
        this._recoverFromStall();
      }
    }, 15000);
  }

  _disarmStreamWatchdog() {
    if (this._streamWatchdog) {
      clearInterval(this._streamWatchdog);
      this._streamWatchdog = null;
    }
  }

  /**
   * Self-heal a turn that went silent with nothing pending, the "a conversa
   * trava" symptom. Aborts the backend, drops the spinner, and returns the
   * composer to idle so the user is never stranded. The notice is display-only
   * (not persisted into the model context).
   */
  _recoverFromStall() {
    const sid = this.currentSessionId;
    try { if (sid) window.aiAPI?.abortChat?.(sid); } catch (_) { /* best-effort */ }
    this.showThinking(false);
    this._closeToolGroup();
    this.appendBubble('assistant',
      '_The assistant stopped responding, so the turn was reset. Send another message to continue._',
      { error: true });
    this.resetTurnState();
    this.setStreaming(false);
  }

  handleChatEvent(ev) {
    if (!ev || ev.sessionId !== this.currentSessionId) return;
    // Watchdog liveness: any packet from the active turn proves it's alive.
    this._lastEventAt = Date.now();
    switch (ev.type) {
      case 'cli-download':
        // B12: a subscription CLI is being fetched on first use. Display-only,
        // transient status, never persisted into the conversation.
        this._renderCliDownload(ev);
        break;
      case 'text-delta':
        // Do NOT hide the thinking dots here. A delta can be whitespace or a
        // stripped tool-call artifact that produces no bubble yet, so hiding
        // on the first raw delta left a blank gap (dots gone, no text). The
        // dots are retired inside _renderStreamingBubble the instant real
        // text actually lands on screen.
        this.appendDelta(ev.delta || '');
        break;
      case 'tool-call':
        // Reveal whatever text the model produced BEFORE this tool call, then
        // start a fresh segment below the chip.
        this._revealSegment();
        // Persist that pre-tool prose as its OWN assistant message, interleaved
        // with the tool entry, instead of dumping the whole turn's text after
        // the tool group at commitTurn. This makes a reloaded chat reproduce the
        // live layout (seg1 → [actions] → seg2). buildApiMessages re-merges
        // adjacent assistant messages so the API still sees alternating roles.
        {
          const seg = stripToolCallArtifacts(
            this.turnText.slice(this._committedTurnLen || 0)).trim();
          if (seg) this.messages.push({ role: 'assistant', content: seg });
          this._committedTurnLen = this.turnText.length;
        }
        this.showThinking(false);
        this.hadToolCalls = true;
        this.startToolChip(ev.toolName, ev.args, ev.toolUseId);
        this.currentAssistantContentEl = null;
        this.segmentBuffer = '';
        this._revealLength = 0;
        break;
      case 'tool-result':
        this.finishToolChip(ev.toolName, ev.result, ev.toolUseId);
        // Uma citacao VERIFICADA e um resultado de ferramenta como outro
        // qualquer, e vira linha no mesmo bloco que a citacao nativa da API.
        // Os dois caminhos convergem aqui de proposito: quem le a resposta nao
        // deve precisar saber por qual provedor ela veio.
        colherCitacaoDeFerramenta(this, ev.toolName, ev.result);
        break;
      case 'finish':
        this._clearCliDownload();
        this.showThinking(false);
        // `more` = a follow-up the user pushed mid-turn is already queued inside
        // the CLI and answers next, in this same session. Seal this segment but
        // stay streaming: ending the turn here would drain the renderer queue on
        // top of the CLI's own, double-dispatching, and would flip the composer
        // back to Send while the model is still working.
        //
        // SELAR, e nao encerrar. Este ramo chamava `commitTurn()` antes de
        // olhar o `more`, e o commitTurn passa por `resetTurnState()`, que
        // ZERA o `currentSessionId`. Como o `handleChatEvent` descarta todo
        // pacote cuja sessao nao bate, a resposta do follow-up chegava e era
        // jogada fora inteira: o painel ficava nos pontinhos ate o cao de
        // guarda matar o turno tres minutos depois. Era exatamente o que o
        // comentario do `_startNextSegment` dizia estar evitando, e nao
        // evitava, porque quem zerava vinha ANTES dele. O reset tambem
        // auto-nega os cartoes de confirmacao e cancela as perguntas abertas,
        // que no meio da sessao sao legitimos.
        if (ev.more) {
          this._sealTurnText();
          // O uso antes de gravar, senao o total no disco fica um turno atras.
          this.applyUsage(ev.usage);
          this.persistCurrentChat();
          this._startNextSegment();
          this.showThinking(true);
          break;
        }
        this.applyUsage(ev.usage);       // antes do commitTurn, que grava a conversa
        this.commitTurn();
        this.setStreaming(false);
        // Pull the CLI's authoritative usage snapshot at the END of every
        // turn (not just when the model popover happens to be open) so the
        // Subscription usage bars and plan limits reflect reality the next
        // time the user looks, this is what fixes "usage never updates".
        if (isSubProvider(this.currentProvider)) this.refreshSubUsage();
        break;
      case 'citation':
        // O trecho REAL da pagina do manual que sustenta o que a assistente
        // acabou de dizer, com o indice do caractere. Junta-se aqui e desenha
        // de uma vez no fim do turno: desenhar a cada chegada faria o bloco
        // crescer por baixo do texto enquanto a pessoa ainda le.
        // A mesma frase citada duas vezes fica uma linha so (citacoes_do_chat.ts).
        if (ev.citacao) juntarCitacao(this, ev.citacao);
        break;
      case 'tool-rejected':
        // Uma chamada de ferramenta que a IA escreveu como texto e que NAO
        // passou pelo esquema da propria ferramenta. Vai para o TCMD, que e o
        // painel de shell, e nao para um dos terminais de compilacao: nada foi
        // compilado, o que houve foi um pedido malformado.
        //
        // Antes isto era silencio: a chamada sumia num catch e a pessoa via a
        // assistente "nao fazer nada", sem pista nenhuma do motivo.
        try {
          window.initializeGlobalTerminalManager?.()?.appendToTerminal?.(
            'tcmd', ev.message, 'warning',
          );
        } catch (e) {
          console.warn('[ai] nao consegui escrever a recusa no terminal:', e);
        }
        break;
      case 'follow-up-taken':
        // A assistente terminou o que estava dizendo e pegou a mensagem que
        // esperava: agora ela entra na conversa, depois da resposta anterior.
        this._followUpTaken(ev.content);
        break;
      case 'aborted':
        this._clearCliDownload();
        this.showThinking(false);
        this.commitTurn();
        this.setStreaming(false);
        this._devolverVivasAFila();
        if (isSubProvider(this.currentProvider)) this.refreshSubUsage();
        break;
      case 'error':
        this._clearCliDownload();
        this.failTurn(ev.message || 'Unknown error');
        this._devolverVivasAFila();
        break;
    }
  }

  /* ---------------- streaming text segments ---------------- */
  // O texto aparecendo por quadro, a maquina de escrever, o fecho de cada
  // segmento e o selo do turno moram em js/ai/desenho_do_stream.ts.

  appendDelta(delta) { receberPedaco(this, delta); }
  _revealSegment() { revelarSegmento(this); }
  _cancelarFrameDoStream() { cancelarDesenho(this); }
  /** Reveal the last segment, store it, tidy the DOM: commitTurn minus the teardown. */
  _sealTurnText() { selarTextoDoTurno(this); }

  commitTurn() {
    this._sealTurnText();
    // As citacoes vao DEPOIS do texto selado: elas sustentam o que ficou
    // escrito, entao aparecem embaixo dele, e nao no meio.
    registrarCitacoes(this);
    this.resetTurnState();
    // Auto-save the conversation after every turn.
    this.persistCurrentChat();
  }

  failTurn(message) {
    this.showThinking(false);
    this._closeToolGroup();
    this.appendBubble('assistant', `Error: ${message}`, { error: true });
    // Mark in-flight chips as failed in DOM and persist them, args
    // are kept so the saved transcript still shows what was attempted.
    for (const running of this.runningChips) {
      const { toolName, toolUseId, args, el } = running;
      el.classList.remove('running');
      el.classList.add('failed');
      const statusEl = el.querySelector('.ai-tool-status');
      if (statusEl) statusEl.textContent = 'failed';
      const icon = el.querySelector('i');
      if (icon) icon.className = 'ph ph-x-circle';
      this.messages.push({
        role: 'tool',
        toolName,
        status: 'failed',
        toolUseId: toolUseId || null,
        args: args || null,
        error: message,
      });
    }
    this.persistCurrentChat();
    this.resetTurnState();
    this.setStreaming(false);
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
  _startNextSegment() {
    this._cancelarFrameDoStream();
    this.currentAssistantContentEl = null;   // next delta opens a fresh bubble
    this.segmentBuffer = '';
    this.turnText = '';
    this._committedTurnLen = 0;
    this._revealLength = 0;
    this._toolGroup = null;                  // next tool call opens a new group
    this.runningChips = [];
    this.hadToolCalls = false;
  }

  resetTurnState() {
    // Tear down the CLI-download status row here too, this is the chokepoint
    // every turn-ending path runs through (stop()'s safety net, the stall
    // watchdog, failTurn), so a download interrupted by Stop/stall can't leave
    // an orphaned "Downloading…" row behind.
    this._clearCliDownload();
    this._cancelarFrameDoStream();
    this.currentAssistantContentEl = null;
    this.segmentBuffer = '';
    this.turnText = '';
    this._committedTurnLen = 0;   // reset the per-turn "already stored" cursor
    this._revealLength = 0;
    this.currentSessionId = null;
    this.runningChips = [];
    this._toolGroup = null;
    this.hadToolCalls = false;
    // Auto-deny any confirmation cards still open when the turn ends
    // (e.g. the user hit Stop while a card was waiting).
    for (const decide of this.pendingConfirms) decide(false);
    this.pendingConfirms.clear();
    // Same for any open Ask-User-Question cards, resolve them as
    // cancelled so the awaiting tool call doesn't hang forever.
    if (this.pendingAskUserQuestions) {
      for (const decide of this.pendingAskUserQuestions) {
        decide({ answer: '[turn aborted before user answered]', selected: [] });
      }
      this.pendingAskUserQuestions.clear();
    }
  }

  /* ---------------- tool chips ---------------- */
  // O grupo "N actions", os chips ao vivo e o chip da conversa reaberta moram
  // em js/ai/chips_de_ferramenta.ts; o painel e o contexto.

  startToolChip(toolName, args, toolUseId) { iniciarChip(this, toolName, args, toolUseId); }
  finishToolChip(toolName, result, toolUseId) { terminarChip(this, toolName, result, toolUseId); }
  _closeToolGroup() { fecharGrupo(this); }

  /* ---------------- indicadores do turno ---------------- */
  // A palavra de pensando, o aviso de download da CLI e o contador de tokens
  // moram em js/ai/indicadores_do_turno.ts.

  showThinking(show) { mostrarPensando(this, show); }
  _renderCliDownload(ev) { mostrarDownloadDaCli(this, ev); }
  _clearCliDownload() { limparDownloadDaCli(this); }
  applyUsage(usage) { somarUso(this, usage); }
  /** Refresh the compact composer token pill and (if open) the usage bars. */
  updateTokenCounter() { atualizarContador(this); }

  /**
   * Grow the textarea to fit its content (up to ~10 lines, then scroll).
   *
   * Com o campo VAZIO o `scrollHeight` nao mede o conteudo, mede o texto da
   * dica: numa coluna estreita "Pergunte a Aurora Intelligence..." quebra em
   * duas linhas e a caixa nascia com o dobro da altura (46 px em vez de 29,
   * medido). Como a linha do compositor alinha por baixo, a dica flutuava 26
   * px acima do clipe, do seletor de modelo e do botao, e nada parecia
   * alinhado. Vazio e uma linha: zero deixa o `min-height` do CSS decidir.
   */
  autoGrowInput() {
    const el = this.inputEl;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = (el.value ? Math.min(el.scrollHeight, 200) : 0) + 'px';
  }

  setStreaming(streaming) {
    this._isStreaming = streaming;
    this.sendBtn.classList.toggle('hidden', streaming);
    this.stopBtn.classList.toggle('hidden', !streaming);
    // Keep textarea enabled so the user can compose their next message
    // while generation is running; Enter-to-send is blocked by _isStreaming.
    this.clearBtn.disabled = streaming;
    if (streaming) this._armStreamWatchdog();
    else {
      this._disarmStreamWatchdog();
      // A turn just ended, dispatch a queued USER follow-up first (explicit
      // intent), else an autonomous one.
      if (!this._drainMessageQueue()) this._drainAutoQueue();
    }
  }

  /**
   * Volta o codigo ao instante em que aquela mensagem foi enviada.
   *
   * A bolha carrega o id da mensagem; o ponto e procurado por ele. Uma bolha
   * de conversa carregada do disco (sem ponto, ou com ponto ja podado) nao
   * pode oferecer um botao que nao faz nada, entao ela diz que nao ha ponto em
   * vez de fingir.
   */
  async _voltarAoPontoDaBolha(el) {
    const id = el?.getAttribute?.('data-ponto');
    const pontos = await listarPontos();
    const ponto = id ? pontos.find((p) => p.mensagemId === id) : null;
    if (!ponto) {
      try {
        window.showNotification?.(
          (window.t && window.t('rewind.noPoint') !== 'rewind.noPoint')
            ? window.t('rewind.noPoint')
            : 'No restore point for this message.',
          'info', 4000, 'rewind');
      } catch { /* sem notificacao */ }
      return;
    }
    await voltarAoPonto(ponto.id);
  }

  /* ---------------- bubbles / clear ---------------- */

  appendBubble(role, content, { error = false } = {}) {
    if (this.chatEmptyHint) this.chatEmptyHint.classList.add('hidden');
    const el = document.createElement('div');
    el.className = `ai-message ai-msg-${role}${error ? ' error' : ''}`;
    const label = role === 'user' ? 'You' : 'Aurora Intelligence';
    // Collapse the role label across a run of consecutive assistant bubbles.
    // A single turn streams as several segments split by tool calls, and a
    // background-task chain adds more, labelling every one produced the wall
    // of repeated "AURORA INTELLIGENCE" headers. Show it once per assistant
    // group; user messages, dividers and background-task chips reset the run
    // (they clear _lastMsgRole) so the label reappears for the next section.
    const showLabel = !(role === 'assistant' && this._lastMsgRole === 'assistant');
    el.innerHTML = `
      ${showLabel ? `<div class="ai-msg-role">${label}</div>` : ''}
      <div class="ai-msg-content"></div>
    `;
    // So na bolha do usuario: o ponto foi marcado quando ELA foi enviada, e
    // voltar significa desfazer o que veio depois dela. Na bolha da resposta o
    // botao nao teria um instante proprio para apontar.
    if (role === 'user') {
      const voltar = document.createElement('button');
      voltar.className = 'ai-msg-rewind';
      voltar.type = 'button';
      voltar.innerHTML = '<i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i>';
      const dica = (window.t && window.t('rewind.toHere') !== 'rewind.toHere')
        ? window.t('rewind.toHere') : 'Rewind code to here';
      voltar.title = dica;
      voltar.setAttribute('aria-label', dica);
      voltar.addEventListener('click', () => this._voltarAoPontoDaBolha(el));
      el.appendChild(voltar);
    }
    const contentEl = el.querySelector('.ai-msg-content');
    if (content) {
      // Render markdown for BOTH roles. The user's own message goes through the
      // same safe (HTML-escaped) renderer, so a fenced ```code``` block they
      // paste shows as a real, syntax-highlighted code block, and inline
      // `code`/file paths render, instead of raw backticks. Parity with the
      // assistant bubble; the .ai-msg-user style still sets it apart visually.
      contentEl.innerHTML = renderMarkdown(content);
      highlightCodeBlocks(contentEl);
      linkifyFileRefs(contentEl);
    }
    this.messagesEl.appendChild(el);
    this._lastMsgRole = role;
    // The user just sent a message: force-stick to the bottom even if
    // they had been reading scrollback. For an assistant bubble we only
    // follow if they're already at the bottom.
    this.scrollToBottom(role === 'user');
    return el;
  }

  /**
   * Inline log divider, a hairline with centered text, in the style of
   * Claude's VS Code extension when the active model changes. Used for
   * ephemeral, non-conversational notes (model switched, etc.). NOT
   * pushed to `this.messages` so the model never sees them and they
   * don't persist into saved chats.
   */
  appendDivider(text) {
    if (!this.messagesEl) return null;
    if (this.chatEmptyHint) this.chatEmptyHint.classList.add('hidden');
    const el = document.createElement('div');
    el.className = 'ai-divider';
    el.setAttribute('role', 'separator');
    const span = document.createElement('span');
    span.className = 'ai-divider-text';
    span.textContent = text;
    el.appendChild(span);
    this.messagesEl.appendChild(el);
    // A divider is a visual section break, let the next assistant bubble
    // re-show its label.
    this._lastMsgRole = null;
    this.scrollToBottom();
    return el;
  }

  /* ---------------- conversas ---------------- */
  // O ciclo da conversa (nova, abrir, gravar, renomear, apagar, tutorial) mora
  // em js/ai/conversas_do_chat.ts; o painel e o contexto.

  newChat() { return novaConversa(this); }
  startTutorial() { return comecarTutorial(this); }
  toggleHistory(force) { alternarHistorico(this, force); }
  refreshChatList() { return relerLista(this); }
  handleHistoryClick(e) { return cliqueNoHistorico(this, e); }
  deleteChat(id) { return apagarConversa(this, id); }
  loadChat(id) { return abrirConversa(this, id); }
  persistCurrentChat() { return gravarConversa(this); }

  /* ---------------- clickable file references ---------------- */

  /** Abre um arquivo citado na resposta, na linha se ela veio (js/ai/abrir_referencia.ts). */
  async openFileRef(fileName, line) {
    await abrirReferencia(fileName, line);
  }
}

const aiAssistantManager = new AIAssistantManager();
// Expose on window so AuroraAPI (which lives in a sibling module) can
// reach back into the panel to show inline confirm / ask-question
// cards without creating a circular import.
try { window.aiAssistantManager = aiAssistantManager; } catch (_) { /* ignore */ }
export { aiAssistantManager };
