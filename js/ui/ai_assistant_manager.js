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

import { abrirAjudaDe } from './help_link.js';
import { semAnimar } from '../utils/resize.js';
import {
  aplicarLargura, larguraPermitida, aplicarAbertura, alternar, garantirAberto, reaplicarLimite,
  ligarDivisorDeLargura, ligarCantoDoTerminal, ligarReavaliacaoDaLargura,
} from '../ai/layout_do_painel.js';
import { correrEmSegundoPlano } from '../ai/tarefa_em_segundo_plano.js';
import { lerVersaoDoManual } from '../ai/citacoes_do_chat.js';
import {
  alternarPopover, desenharPermissoes, definirPermissao, atualizarProvedores, aplicarProvedor,
  escolherProvedor, definirEsforco, gravarModelo, atualizarEstadoDaAssinatura,
  desenharEstadoDaAssinatura, desenharEstadoDoProvedor, atualizarUso, desenharUso, ligarPopover,
} from '../ai/provedores_do_painel.js';
import { iniciarChip, terminarChip, fecharGrupo } from '../ai/chips_de_ferramenta.js';
import { rolarAoFim, ligarRolagem } from '../ai/rolagem_do_chat.js';
import { mostrarPensando, mostrarDownloadDaCli, limparDownloadDaCli, somarUso, atualizarContador } from '../ai/indicadores_do_turno.js';
import { receberPedaco, revelarSegmento, cancelarDesenho, selarTextoDoTurno } from '../ai/desenho_do_stream.js';
import { ligarComposer, perguntarSobreSelecao } from '../ai/composer_do_chat.js';
import { novoBalao, novoDivisor } from '../ai/baloes_do_chat.js';
import {
  enviar, enviarDaFilaAgora, interromperParaFalar, entregarAoVivo, seguimentoAceito,
  devolverVivasAFila, escoarFila, desenharEspera,
} from '../ai/envio_do_chat.js';
import {
  despacharTurno, continuarSozinho, escoarAutonomos, parar, armarCaoDeGuarda, desarmarCaoDeGuarda,
  recuperarDoSilencio, fecharTurno, falharTurno, proximoSegmento, zerarTurno, definirTransmissao,
} from '../ai/turno_do_chat.js';
import { tratarEvento } from '../ai/eventos_do_stream.js';
import { ligarCliquesNaConversa } from '../ai/cliques_na_conversa.js';
import { moldeDoPainel } from '../ai/molde_do_painel.js';
import { abrirReferencia, abrirCaminhoDoChat } from '../ai/abrir_referencia.js';
import { confiaEmLinksExternos, definirConfiancaEmLinks, confirmarLinkExterno } from '../ai/link_externo.js';
import { adicionarArquivos, abrirImagem, desenharAnexos, desenharAnexosNaBolha, escaparHtml } from '../ai/anexos_do_chat.js';
import { confirmarFerramenta, perguntarAPessoa } from '../ai/perguntas_inline.js';
import {
  novaConversa, relerLista, apagarConversa, abrirConversa, gravarConversa, ligarHistorico,
} from '../ai/conversas_do_chat.js';
import {
  CLAUDE_CODE_EFFORT, readPermissionMode,
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
   * O trecho selecionado no editor entra no composer, citado; com intencao e
   * `send`, o pedido sai na hora. Porta do window.AuroraAPI.ai.askAboutSelection;
   * mora em js/ai/composer_do_chat.ts.
   */
  askAboutSelection(pedido) { perguntarSobreSelecao(this, pedido); }

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
  // Mandar, entregar ao turno vivo, as duas filas de espera e o "enviar agora"
  // moram em js/ai/envio_do_chat.ts; o painel e o contexto.

  send() { return enviar(this); }
  _enviarDaFilaAgora(i) { return enviarDaFilaAgora(this, i); }
  _interromperParaFalar() { return interromperParaFalar(this); }
  _tryPushLive(text, atts) { return entregarAoVivo(this, text, atts); }
  _followUpTaken(content) { seguimentoAceito(this, content); }
  _devolverVivasAFila() { devolverVivasAFila(this); }
  /** Despacha a proxima da fila; true se despachou (o fim do turno prefere a pessoa). */
  _drainMessageQueue() { return escoarFila(this); }
  _renderQueue() { desenharEspera(this); }

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
  _dispatchTurn(operacao) { return despacharTurno(this, operacao); }

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
  autoContinue(content, opcoes) { continuarSozinho(this, content, opcoes); }

  _drainAutoQueue() { escoarAutonomos(this); }

  /**
   * Comeca uma compilacao em segundo plano e devolve na hora; quando ela acaba,
   * a assistente continua sozinha com o resultado. Porta do aurora_api
   * (ai.runInBackground); mora em js/ai/tarefa_em_segundo_plano.ts.
   */
  runInBackground(pedido) { return correrEmSegundoPlano(this, pedido); }

  stop() { return parar(this); }

  /* ---------------- stream watchdog (anti-freeze) ---------------- */

  _armStreamWatchdog() { armarCaoDeGuarda(this); }

  _disarmStreamWatchdog() { desarmarCaoDeGuarda(this); }

  /**
   * Self-heal a turn that went silent with nothing pending, the "a conversa
   * trava" symptom. Aborts the backend, drops the spinner, and returns the
   * composer to idle so the user is never stranded. The notice is display-only
   * (not persisted into the model context).
   */
  _recoverFromStall() { recuperarDoSilencio(this); }

  handleChatEvent(ev) { tratarEvento(this, ev); }

  /* ---------------- streaming text segments ---------------- */
  // O texto aparecendo por quadro, a maquina de escrever, o fecho de cada
  // segmento e o selo do turno moram em js/ai/desenho_do_stream.ts.

  appendDelta(delta) { receberPedaco(this, delta); }
  _revealSegment() { revelarSegmento(this); }
  _cancelarFrameDoStream() { cancelarDesenho(this); }
  /** Reveal the last segment, store it, tidy the DOM: commitTurn minus the teardown. */
  _sealTurnText() { selarTextoDoTurno(this); }

  commitTurn() { fecharTurno(this); }

  failTurn(message) { falharTurno(this, message); }

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
  _startNextSegment() { proximoSegmento(this); }

  resetTurnState() { zerarTurno(this); }

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

  setStreaming(streaming) { definirTransmissao(this, streaming); }

  /* ---------------- bubbles / clear ---------------- */
  // Os baloes, o voltar ao ponto e o divisor moram em js/ai/baloes_do_chat.ts.

  appendBubble(role, content, opcoes) { return novoBalao(this, role, content, opcoes); }
  appendDivider(text) { return novoDivisor(this, text); }

  /* ---------------- conversas ---------------- */
  // O ciclo da conversa (nova, abrir, gravar, renomear, apagar, tutorial) mora
  // em js/ai/conversas_do_chat.ts; o painel e o contexto.

  newChat() { return novaConversa(this); }
  refreshChatList() { return relerLista(this); }
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
