/**
 * ai_assistant_manager.ts: Aurora Intelligence side panel.
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

import type { MensagemDoChat, ConversaListada } from '../ai/chat_history.js';
import type { CitacaoDoManual } from '../ai/manual_citation.js';
import type { EntradaDeProvedor, RelatorioDeUso } from '../ai/ai_metadata.js';
import type { EstadoDaCli } from '../ai/estado_do_provedor.js';
import type { GrupoDeFerramentas, ChipEmVoo } from '../ai/chips_de_ferramenta.js';
import type { ItemDaFila } from '../ai/fila_do_chat.js';
import type { RespostaDaPergunta } from '../ai/perguntas_inline.js';
import type { Anexo } from '../ai/chat_attachments.js';

/**
 * Os elementos nascem vazios e o initialize os preenche. Declarados com o tipo
 * de depois da montagem, porque e assim que o resto do painel e os modulos de
 * js/ai os usam; o NADA e o `null` de antes, tipado para caber em qualquer
 * campo, entao em tempo de execucao nada muda.
 */
const NADA = null as never;

/** Os parametros de uma funcao de modulo depois do contexto (o painel), que a delegacao repassa. */
type Resto<F> = F extends (p: never, ...resto: infer R) => unknown ? R : never;

class AIAssistantManager {
  // ── elementos (preenchidos no initialize) ──
  container: HTMLElement | null;
  providerSelect: HTMLElement | null;
  providerIcon: HTMLImageElement;
  messagesEl: HTMLElement;
  emptyStateEl: HTMLElement;
  inputEl: HTMLTextAreaElement;
  declare composerEl: HTMLElement | null;
  sendBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  declare tutorialBtn: HTMLElement | null;
  declare attachBtn: HTMLElement | null;
  declare attachInput: HTMLInputElement | null;
  declare attachmentsEl: HTMLElement | null;
  declare queueEl: HTMLElement | null;
  tokenCounter: HTMLElement;
  declare chatEmptyHint: HTMLElement | null;
  declare modelChip: HTMLElement;
  declare modelChipIcon: HTMLImageElement;
  declare modelChipName: HTMLElement;
  declare modelPopover: HTMLElement;
  declare mpProviders: HTMLElement;
  declare mpPerms: HTMLElement;
  declare modelInput: HTMLInputElement | null;
  declare modelResetBtn: HTMLElement;
  declare mpModelApi: HTMLElement;
  declare mpModelPresets: HTMLElement;
  declare mpUsage: HTMLElement;
  declare usageBars: HTMLElement | null;
  declare usagePlan: HTMLElement;
  declare ccStatusEl: HTMLElement | null;
  declare effortSection: HTMLElement | null;
  declare effortSeg: HTMLElement;
  declare ccSections: NodeListOf<Element>;
  declare historyBtn: HTMLElement;
  declare historyPopover: HTMLElement;
  declare historyList: HTMLElement | null;
  thinkingEl: HTMLElement | null;
  declare cliDownloadEl?: HTMLElement | null;

  // ── conversa ──
  messages: MensagemDoChat[];
  pendingAttachments: Anexo[];
  currentChatId: string | null;
  currentChatTitle: string;
  currentChatCreatedAt: number;
  historyOpen: boolean;
  chatList: ConversaListada[];
  cumulativeTokens: number;
  declare cacheLidos?: number;
  declare cacheEscritos?: number;
  declare tutorialBlock: string;
  declare _citacoesDoTurno: CitacaoDoManual[] | null;
  declare _versaoDoManual?: string;

  // ── provedor ──
  currentProvider: string | null;
  providersAvailable: EntradaDeProvedor[];
  providersConfigured: Record<string, boolean>;
  declare claudeCodeEntry?: EntradaDeProvedor;
  declare chatgptEntry?: EntradaDeProvedor;
  permissionMode: string;
  claudeCodeEffort: string;
  modelPopoverOpen: boolean;
  subStatus: Record<string, EstadoDaCli | null>;
  subUsage: Record<string, RelatorioDeUso | null>;

  // ── turno e stream ──
  currentSessionId: string | null;
  currentAssistantContentEl: HTMLElement | null;
  segmentBuffer: string;
  turnText: string;
  _committedTurnLen: number;
  declare _revealLength: number;
  declare _streamFlush?: boolean;
  declare _streamRenderRaf?: number | null;
  declare _streamRenderTimer?: ReturnType<typeof setTimeout> | null;
  runningChips: ChipEmVoo[];
  declare _toolGroup: (GrupoDeFerramentas & { total: number }) | null;
  declare hadToolCalls: boolean;
  _lastMsgRole: string | null;
  declare _isStreaming: boolean;
  declare _lastEventAt?: number;
  declare _streamWatchdog?: ReturnType<typeof setInterval> | null;
  unsubChatEvent: (() => void) | null;
  _autoQueue: Array<{ content: string; label: string; operacao: string | null }> = [];
  declare _autoChainCount: number;
  declare _messageQueue: ItemDaFila[];
  declare _liveQueue: string[];
  declare _operacaoDoProximoEnvio: string | null;
  pendingConfirms: Set<(allowed: boolean) => void>;
  pendingAskUserQuestions?: Set<(r: RespostaDaPergunta) => void>;

  // ── tela ──
  stickToBottom: boolean;
  declare _scrollRaf?: number | null;
  declare _reclampRaf?: number | null;
  _glowRevealed: boolean;

  constructor() {
    this.container = null;
    this.providerSelect = null;
    this.providerIcon = NADA;
    this.messagesEl = NADA;
    this.emptyStateEl = NADA;
    this.inputEl = NADA;
    this.sendBtn = NADA;
    /** Pending composer attachments: { id, kind:'image'|'file', name, mime, size, dataUrl?, text? }. */
    this.pendingAttachments = [];
    this.stopBtn = NADA;
    this.clearBtn = NADA;
    this.tokenCounter = NADA;

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
    this.permissionMode = readPermissionMode() as string;
    this.modelPopoverOpen = false;
    this.pendingConfirms = new Set();   // resolve fns of open confirmation cards

    // Subscription-provider (Claude Code / ChatGPT) state, keyed by
    // provider name so both CLIs share the same panel machinery.
    this.subStatus = {};                // provider → { installed, authed, … }
    this.subUsage = {};                 // provider → usage snapshot
    this.claudeCodeEffort = '';         // '' | low | medium | high | xhigh | max
    try {
      const e = localStorage.getItem('aurora-ai-cc-effort');
      if (CLAUDE_CODE_EFFORT.some((x) => x.id === e)) this.claudeCodeEffort = e as string;
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
  scrollToBottom(...a: Resto<typeof rolarAoFim>) { rolarAoFim(this, ...a); }

  /* ---------------- layout ---------------- */
  // A largura, abrir e fechar, e os dois arrastadores moram em
  // js/ai/layout_do_painel.ts; o painel e o contexto.

  toggle() { alternar(this); }
  /** Unico lugar que aplica a largura e o estado que anda com ela. */
  _aplicarLargura(...a: Resto<typeof aplicarLargura>) { aplicarLargura(this, ...a); }
  /** A regra de tamanho do painel (o E2E de layout a chama pela instancia). */
  _larguraPermitida(...a: Parameters<typeof larguraPermitida>) { return larguraPermitida(...a); }
  _applyOpenWidth(...a: Resto<typeof aplicarAbertura>) { aplicarAbertura(this, ...a); }
  /** Bring the panel up if it isn't already open (idempotent). */
  ensureOpen() { garantirAberto(this); }
  reclampWidth() { reaplicarLimite(this); }

  /**
   * O trecho selecionado no editor entra no composer, citado; com intencao e
   * `send`, o pedido sai na hora. Porta do window.AuroraAPI.ai.askAboutSelection;
   * mora em js/ai/composer_do_chat.ts.
   */
  askAboutSelection(...a: Resto<typeof perguntarSobreSelecao>) { perguntarSobreSelecao(this, ...a); }

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

    this.providerIcon  = this.container.querySelector('#ai-provider-icon') as HTMLImageElement;
    this.messagesEl    = this.container.querySelector('#ai-messages') as HTMLElement;
    this.emptyStateEl  = this.container.querySelector('#ai-empty-state') as HTMLElement;
    this.inputEl       = this.container.querySelector('#ai-input') as HTMLTextAreaElement;
    this.composerEl    = this.container.querySelector('#ai-composer') as HTMLElement;
    this.sendBtn       = this.container.querySelector('#ai-send-btn') as HTMLButtonElement;
    this.attachBtn     = this.container.querySelector('#ai-attach-btn') as HTMLElement;
    this.attachInput   = this.container.querySelector('#ai-attach-input') as HTMLInputElement;
    this.attachmentsEl = this.container.querySelector('#ai-attachments') as HTMLElement;
    this.queueEl       = this.container.querySelector('#ai-msg-queue') as HTMLElement;
    this._messageQueue = [];
    this.stopBtn       = this.container.querySelector('#ai-stop-btn') as HTMLButtonElement;
    this.clearBtn      = this.container.querySelector('#ai-clear-btn') as HTMLButtonElement;
    this.tutorialBtn   = this.container.querySelector('#ai-tutorial-btn') as HTMLElement;
    this.tokenCounter  = this.container.querySelector('#ai-token-counter') as HTMLElement;

    // Model / provider chip + popover.
    this.modelChip     = this.container.querySelector('#ai-model-chip') as HTMLElement;
    this.modelChipIcon = this.container.querySelector('#ai-model-chip-icon') as HTMLImageElement;
    this.modelChipName = this.container.querySelector('#ai-model-chip-name') as HTMLElement;
    this.modelPopover  = this.container.querySelector('#ai-model-popover') as HTMLElement;
    this.mpProviders   = this.container.querySelector('#ai-mp-providers') as HTMLElement;
    this.mpPerms       = this.container.querySelector('#ai-mp-perms') as HTMLElement;
    this.modelInput    = this.container.querySelector('#ai-model-input') as HTMLInputElement;
    this.modelResetBtn = this.container.querySelector('#ai-model-reset') as HTMLElement;
    this.mpModelApi    = this.container.querySelector('#ai-mp-model-api') as HTMLElement;
    this.mpModelPresets= this.container.querySelector('#ai-mp-model-presets') as HTMLElement;
    this.mpUsage       = this.container.querySelector('#ai-mp-usage') as HTMLElement;
    this.usageBars     = this.container.querySelector('#ai-usage-bars') as HTMLElement;
    this.usagePlan     = this.container.querySelector('#ai-usage-plan') as HTMLElement;
    this.ccStatusEl    = this.container.querySelector('#ai-mp-cc-status') as HTMLElement;
    this.effortSection = this.container.querySelector('#ai-mp-effort-section') as HTMLElement;
    this.effortSeg     = this.container.querySelector('#ai-mp-effort') as HTMLElement;
    this.ccSections    = this.container.querySelectorAll('.ai-mp-cc') as NodeListOf<Element>;

    this.historyBtn        = this.container.querySelector('#ai-history-btn') as HTMLElement;
    this.historyPopover    = this.container.querySelector('#ai-history-popover') as HTMLElement;
    this.historyList       = this.container.querySelector('#ai-history-list') as HTMLElement;
    this.chatEmptyHint     = this.container.querySelector('#ai-chat-empty-hint') as HTMLElement;

    this.buildPermissionOptions();
    this.attachListeners();
    ligarDivisorDeLargura(this, this.container.querySelector('.ai-resize-handle') as HTMLElement, this.container);
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
    const container = this.container as HTMLElement;
    (container.querySelector('.ai-hbtn-close') as HTMLElement).addEventListener('click', () => this.toggle());
    container.querySelector('#ai-help-btn')
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

  toggleModelPopover(...a: Resto<typeof alternarPopover>) { alternarPopover(this, ...a); }
  buildPermissionOptions() { desenharPermissoes(this); }
  setPermissionMode(...a: Resto<typeof definirPermissao>) { definirPermissao(this, ...a); }
  refreshProviders() { return atualizarProvedores(this); }
  /** Reflect the active provider across the icon, chip, controls and usage. */
  applyProviderState() { aplicarProvedor(this); }
  /** Switch the active provider (from a radio change in the popover). */
  selectProvider(...a: Resto<typeof escolherProvedor>) { escolherProvedor(this, ...a); }
  setClaudeCodeEffort(...a: Resto<typeof definirEsforco>) { definirEsforco(this, ...a); }
  /** Persist a model id for the active provider and refresh the chip. */
  commitModel(...a: Resto<typeof gravarModelo>) { return gravarModelo(this, ...a); }
  refreshSubStatus() { return atualizarEstadoDaAssinatura(this); }
  renderSubStatus() { desenharEstadoDaAssinatura(this); }
  renderProviderStatus() { desenharEstadoDoProvedor(this); }
  refreshSubUsage() { return atualizarUso(this); }
  renderUsage() { desenharUso(this); }

  /** A versao do manual, para carimbar as citacoes (js/ai/citacoes_do_chat.ts). */
  _lerVersaoDoManual() { return lerVersaoDoManual(this); }

  // O aviso antes de abrir link externo mora em js/ai/link_externo.ts.
  _getTrustExternalLinks() { return confiaEmLinksExternos(); }

  _setTrustExternalLinks(...a: Parameters<typeof definirConfiancaEmLinks>) { definirConfiancaEmLinks(...a); }

  _confirmExternalLink(...a: Parameters<typeof confirmarLinkExterno>) { confirmarLinkExterno(...a); }

  /** Um caminho absoluto clicado na conversa (js/ai/abrir_referencia.ts). */
  async _openChatPath(...a: Parameters<typeof abrirCaminhoDoChat>) { await abrirCaminhoDoChat(...a); }

  /* ---------------- tool permission gate ---------------- */

  /**
   * A ferramenta pode rodar? Chamado pelo tool_runner antes de cada uma. O
   * cartao de permissao mora em js/ai/perguntas_inline.ts.
   */
  confirmToolCall(...a: Resto<typeof confirmarFerramenta>) { return confirmarFerramenta(this, ...a); }

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
  showAskUserQuestionInline(...a: Resto<typeof perguntarAPessoa>) { return perguntarAPessoa(this, ...a); }

  showEmptyState(show: boolean) {
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
  _enviarDaFilaAgora(...a: Resto<typeof enviarDaFilaAgora>) { return enviarDaFilaAgora(this, ...a); }
  _interromperParaFalar() { return interromperParaFalar(this); }
  _tryPushLive(...a: Resto<typeof entregarAoVivo>) { return entregarAoVivo(this, ...a); }
  _followUpTaken(...a: Resto<typeof seguimentoAceito>) { seguimentoAceito(this, ...a); }
  _devolverVivasAFila() { devolverVivasAFila(this); }
  /** Despacha a proxima da fila; true se despachou (o fim do turno prefere a pessoa). */
  _drainMessageQueue() { return escoarFila(this); }
  _renderQueue() { desenharEspera(this); }

  /* ---------------- composer attachments (images + files) ---------------- */
  // Ler, desenhar e abrir em tela cheia moram em js/ai/anexos_do_chat.ts; o
  // painel guarda a lista pendente e a faixa do composer.

  /** Read dropped / picked / pasted files into pendingAttachments, then render. */
  async _addFiles(fileList: Parameters<typeof adicionarArquivos>[1]) {
    await adicionarArquivos(this.pendingAttachments, fileList,
      (texto) => this.appendBubble('assistant', texto, false as unknown as Parameters<typeof novoBalao>[3]));
    this._renderAttachments();
  }

  _removeAttachment(id: string) {
    this.pendingAttachments = this.pendingAttachments.filter((a) => a.id !== id);
    this._renderAttachments();
  }

  _escAtt(...a: Parameters<typeof escaparHtml>) { return escaparHtml(...a); }

  /** Render the preview chips row above the composer. */
  _renderAttachments() {
    if (!this.attachmentsEl) return;
    desenharAnexos(this.attachmentsEl, this.pendingAttachments, (id) => this._removeAttachment(id));
  }

  /** Render a read-only attachments strip inside a sent user bubble. */
  _renderBubbleAttachments(...a: Parameters<typeof desenharAnexosNaBolha>) { desenharAnexosNaBolha(...a); }

  /** Full-size image viewer for an attached chat image. */
  _openImageLightbox(...a: Parameters<typeof abrirImagem>) { abrirImagem(...a); }

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
   */
  _dispatchTurn(...a: Resto<typeof despacharTurno>) { return despacharTurno(this, ...a); }

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
  autoContinue(...a: Resto<typeof continuarSozinho>) { continuarSozinho(this, ...a); }

  _drainAutoQueue() { escoarAutonomos(this); }

  /**
   * Comeca uma compilacao em segundo plano e devolve na hora; quando ela acaba,
   * a assistente continua sozinha com o resultado. Porta do aurora_api
   * (ai.runInBackground); mora em js/ai/tarefa_em_segundo_plano.ts.
   */
  runInBackground(...a: Resto<typeof correrEmSegundoPlano>) { return correrEmSegundoPlano(this, ...a); }

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

  handleChatEvent(...a: Resto<typeof tratarEvento>) { tratarEvento(this, ...a); }

  /* ---------------- streaming text segments ---------------- */
  // O texto aparecendo por quadro, a maquina de escrever, o fecho de cada
  // segmento e o selo do turno moram em js/ai/desenho_do_stream.ts.

  appendDelta(...a: Resto<typeof receberPedaco>) { receberPedaco(this, ...a); }
  _revealSegment() { revelarSegmento(this); }
  _cancelarFrameDoStream() { cancelarDesenho(this); }
  /** Reveal the last segment, store it, tidy the DOM: commitTurn minus the teardown. */
  _sealTurnText() { selarTextoDoTurno(this); }

  commitTurn() { fecharTurno(this); }

  failTurn(...a: Resto<typeof falharTurno>) { falharTurno(this, ...a); }

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

  startToolChip(...a: Resto<typeof iniciarChip>) { iniciarChip(this, ...a); }
  finishToolChip(...a: Resto<typeof terminarChip>) { terminarChip(this, ...a); }
  _closeToolGroup() { fecharGrupo(this); }

  /* ---------------- indicadores do turno ---------------- */
  // A palavra de pensando, o aviso de download da CLI e o contador de tokens
  // moram em js/ai/indicadores_do_turno.ts.

  showThinking(...a: Resto<typeof mostrarPensando>) { mostrarPensando(this, ...a); }
  _renderCliDownload(...a: Resto<typeof mostrarDownloadDaCli>) { mostrarDownloadDaCli(this, ...a); }
  _clearCliDownload() { limparDownloadDaCli(this); }
  applyUsage(...a: Resto<typeof somarUso>) { somarUso(this, ...a); }
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

  setStreaming(...a: Resto<typeof definirTransmissao>) { definirTransmissao(this, ...a); }

  /* ---------------- bubbles / clear ---------------- */
  // Os baloes, o voltar ao ponto e o divisor moram em js/ai/baloes_do_chat.ts.

  appendBubble(...a: Resto<typeof novoBalao>) { return novoBalao(this, ...a); }
  appendDivider(...a: Resto<typeof novoDivisor>) { return novoDivisor(this, ...a); }

  /* ---------------- conversas ---------------- */
  // O ciclo da conversa (nova, abrir, gravar, renomear, apagar, tutorial) mora
  // em js/ai/conversas_do_chat.ts; o painel e o contexto.

  newChat() { return novaConversa(this); }
  refreshChatList() { return relerLista(this); }
  deleteChat(...a: Resto<typeof apagarConversa>) { return apagarConversa(this, ...a); }
  loadChat(...a: Resto<typeof abrirConversa>) { return abrirConversa(this, ...a); }
  persistCurrentChat() { return gravarConversa(this); }

  /* ---------------- clickable file references ---------------- */

  /** Abre um arquivo citado na resposta, na linha se ela veio (js/ai/abrir_referencia.ts). */
  async openFileRef(fileName: string, line?: number | null) {
    await abrirReferencia(fileName, line);
  }
}

const aiAssistantManager = new AIAssistantManager();
// Expose on window so AuroraAPI (which lives in a sibling module) can
// reach back into the panel to show inline confirm / ask-question
// cards without creating a circular import.
try { (window as unknown as { aiAssistantManager: AIAssistantManager }).aiAssistantManager = aiAssistantManager; } catch (_) { /* ignore */ }
export { aiAssistantManager };
