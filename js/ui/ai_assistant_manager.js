/**
 * ai_assistant_manager.js — Aurora Intelligence side panel.
 *
 * Replaces the previous `<webview>`-based wrapper. The panel now talks
 * directly to a Vercel-AI-SDK-driven backend via `window.aiAPI`:
 *
 *   • renderer maintains the chat history,
 *   • each turn streams from main via `ai:chat-event` packets,
 *   • assistant text is rendered as Markdown live (token by token).
 *
 * Chat history (this version) — every conversation is auto-persisted
 * to `userData/aurora-intelligence-chats/<id>.json` and listed in a
 * dropdown anchored to the history button. New / Open / Rename /
 * Delete operate on those files (see `main/ai/conversations.js`).
 */

import { electronAPI } from '../app/electron_api.js';
import { showConfirm } from './dialog_manager.js';
import { showCardNotification } from './notification.js';
import { constrainTerminalHeight } from '../utils/resize.js';
// Mesma regra de tamanho da árvore de arquivos e do terminal.
import { resolvePaneSize, maxLateralWidth, PANE } from '../utils/pane_size.js';
import { TabManager } from '../tabs/tab_manager.js';
import { SYSTEM_PROMPT } from '../ai/system_prompt.js';
import { isAtBottom, easeInOutCubic, smoothScrollDuration } from '../ai/chat_scroll.js';
import { formatAttachmentSize, composerChipHtml, bubbleChipHtml } from '../ai/chat_attachments.js';
import { mayHaveToolArtifacts, stripToolCallArtifacts } from '../ai/tool_call_text.js';
import { decideToolPermission, previewArgs, splitArgs, permissionOptionsHtml } from '../ai/tool_permission.js';
import { providerOptionsHtml, modelPresetsHtml, faithfulModelName } from '../ai/provider_view.js';
import { chatListHtml, serializeMessagesForStorage } from '../ai/chat_history.js';
import { buildApiMessages, buildProjectContext } from '../ai/chat_turn.js';
import {
  escapeHtml, renderMarkdown, highlightCodeBlocks,
  linkifyFileRefs, aiPathIsText, TRUST_LINKS_KEY,
} from '../ai/chat_render.js';
import {
  PROVIDER_META, CLAUDE_CODE_PROVIDER, CLAUDE_CODE_EFFORT, CHATGPT_PROVIDER, CHATGPT_MODELS,
  SUB_META, isSubProvider, STREAM_STALL_MS, STREAM_STALL_HARD_MS,
  shortModelName, formatTokens, WINDOW_META, untilTime, usageRowHTML,
  PERMISSION_STORE_KEY, PERMISSION_MODES, readPermissionMode,
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

    // Subscription-provider (Claude Code / ChatGPT) state — keyed by
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
    // Every appendDelta / appendBubble / tool chip respects this flag —
    // we only push the viewport when the user is already at the bottom.
    this.stickToBottom = true;
  }

  /** Distance in px the viewport may sit above the bottom and still count as "at the bottom". */
  get _bottomThresholdPx() { return 32; }

  _isAtBottom() {
    // Pure geometry in chat_scroll.js; this class owns the element + state.
    return isAtBottom(this.messagesEl, this._bottomThresholdPx);
  }

  /**
   * Scroll to the bottom IF the user hasn't scrolled away. Called from
   * every place that previously did `messagesEl.scrollTop = scrollHeight`
   * unconditionally. When `force` is true (e.g. the user just sent a
   * message) we re-stick regardless of where they were.
   */
  scrollToBottom(force = false) {
    if (!this.messagesEl) return;
    if (force) this.stickToBottom = true;
    if (this.stickToBottom) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  /**
   * Glide to the bottom with ease-in-out (accelerate then decelerate) — used by
   * the "Jump to latest" pill so the jump feels deliberate, not a hard snap.
   * Re-targets the bottom each frame so it still lands if the stream is growing.
   * (The per-token auto-scroll stays instant via scrollToBottom — smoothing it
   * would visibly lag behind the text.)
   */
  smoothScrollToBottom() {
    const el = this.messagesEl;
    if (!el) return;
    this.stickToBottom = true;
    if (this._scrollRaf) cancelAnimationFrame(this._scrollRaf);
    const start = el.scrollTop;
    const dist = (el.scrollHeight - el.clientHeight) - start;
    if (dist <= 2) { el.scrollTop = el.scrollHeight; return; }
    const dur = smoothScrollDuration(dist);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const target = el.scrollHeight - el.clientHeight;   // re-target growing content
      el.scrollTop = start + (target - start) * easeInOutCubic(p);
      if (p < 1) {
        this._scrollRaf = requestAnimationFrame(step);
      } else {
        this._scrollRaf = null;
        el.scrollTop = el.scrollHeight - el.clientHeight;
      }
    };
    this._scrollRaf = requestAnimationFrame(step);
  }

  toggle() {
    if (!this.container) this.initialize();
    const opening = !this.container.classList.contains('open');
    this.container.classList.toggle('open', opening);
    document.body.classList.toggle('ai-assistant-open', opening);
    try { localStorage.setItem('aurora-ai-panel-open', opening ? '1' : '0'); } catch (_) { /* ignore */ }
    // v3 layout: panel is a flex sibling that pushes the editor area.
    // The CSS `width` transition (240ms) drives the open/close anim;
    // we just set the target width here. Read the persisted user
    // width (default 480px) so re-opening lands on the same size.
    this._applyOpenWidth(opening);
    if (opening) {
      this.refreshProviders().then(() => this.inputEl?.focus());
      this.refreshChatList();
    }
  }

  /**
   * Set the inline `width` driving the open/close animation. CSS leaves
   * the closed state at 0; opening sets it to the user's saved width
   * (or 480 default). Single helper so toggle() and the boot-time
   * "panel was open" restore both stay in sync.
   */
  _applyOpenWidth(opening) {
    if (!this.container) return;
    if (!opening) {
      this.container.style.width = '0px';
      // P17 a11y: prevent Tab + screen reader from reaching the hidden panel.
      this.container.setAttribute('inert', '');
      return;
    }
    this.container.removeAttribute('inert');
    let target = 480;
    try {
      const saved = parseInt(localStorage.getItem('aurora-ai-panel-width'), 10);
      if (saved >= 320) target = saved;
    } catch (_) { /* ignore */ }
    // Pelo mesmo limite do arrasto. A largura salva pode ter vindo de uma
    // janela maior do que a de agora, e era exatamente por aqui que o painel
    // voltava a invadir o terminal.
    this.container.style.width = this._larguraPermitida(target) + 'px';
    // Limpa o estado de colapso: o painel pode ter sido fechado arrastando o
    // divisor até o fim, e o botão da barra é o caminho de volta. A largura
    // salva nunca fica envenenada porque o arrasto só persiste acima do mínimo.
    this.container.classList.remove('is-collapsed');
  }

  /** Bring the panel up if it isn't already open (idempotent). */
  ensureOpen() {
    if (!this.container) this.initialize();
    if (!this.container.classList.contains('open')) this.toggle();
  }

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
    const lead = INTENT_LEAD[intent] || '';
    const fence = '```' + (language || '');
    const body = `${lead ? lead + ' ' : ''}from ${where}:\n\n${fence}\n${snippet}\n\`\`\`\n`;

    // Don't clobber a half-typed message the user already has in the composer.
    const existing = this.inputEl.value;
    this.inputEl.value = existing && !send ? `${existing.replace(/\s*$/, '')}\n\n${body}` : body;
    this.autoGrowInput?.();
    this.inputEl.focus();
    if (lead && send && !this._isStreaming) {
      this.send();
    } else if (!lead) {
      // Free-form "Ask…": leave the cursor at the very start so the user types
      // their question above the quoted snippet.
      try { this.inputEl.setSelectionRange(0, 0); } catch (_) { /* not focusable yet */ }
    }
  }

  initialize() {
    this.container = document.createElement('div');
    this.container.className = 'ai-assistant-container';
    this.container.innerHTML = `
      <div class="ai-assistant-header">
        <div class="ai-header-left">
          <span class="ai-assistant-mark">
            <img id="ai-provider-icon" src="./assets/icons/ai_claude.svg" alt="" class="ai-provider-icon">
          </span>
          <h3 class="ai-assistant-title">Aurora Intelligence</h3>
        </div>
        <div class="ai-header-right">
          <button class="ai-hbtn" id="ai-history-btn" title="Chat history" aria-label="Chat history">
            <i class="ph ph-clock-counter-clockwise"></i>
          </button>
          <button class="ai-hbtn" id="ai-clear-btn" title="New chat" aria-label="New chat">
            <i class="ph ph-note-pencil"></i>
          </button>
          <span class="ai-hbtn-sep"></span>
          <button class="ai-hbtn ai-hbtn-close" id="ai-close-btn" aria-label="Close AI Assistant" title="Close">
            <i class="ph ph-x"></i>
          </button>
        </div>

        <!-- Chat-history popover: list of saved conversations + "New chat".
             The actual list is populated by refreshChatList(). -->
        <div class="ai-history-popover hidden" id="ai-history-popover" role="menu">
          <div class="ai-history-head">
            <span class="ai-history-title">Chats</span>
            <button class="ai-history-new" id="ai-history-new" title="New chat">
              <i class="ph ph-plus"></i><span>New</span>
            </button>
          </div>
          <div class="ai-history-list" id="ai-history-list"></div>
        </div>
      </div>

      <div class="ai-assistant-content">
        <!-- Aurora gradient glow — concentrated at the TOP of the chat and
             fading downward, so it accents the panel without washing out the
             messages below (a soft, slowly breathing aurora wash). -->
        <div class="ai-aurora-glow" aria-hidden="true"></div>
        <div class="ai-empty-state hidden" id="ai-empty-state">
          <i class="ph ph-sparkle ai-empty-icon" aria-hidden="true"></i>
          <h4 data-i18n="ai.offline.title">Aurora Intelligence is offline</h4>
          <p data-i18n="ai.offline.body">The AI backend could not be reached. Restart Aurora, or open Settings to configure a provider.</p>
        </div>

        <div class="ai-messages" id="ai-messages" role="log" aria-live="polite">
          <div class="ai-chat-empty-hint" id="ai-chat-empty-hint" aria-hidden="true">
            <i class="ph ph-brain" aria-hidden="true"></i>
            <p data-i18n="ai.emptyHint">Ask Aurora Intelligence about your project, Verilog, or SAPHO/CMM</p>
          </div>
        </div>

        <div class="ai-input-area">
          <!-- Model / provider popover — anchored above the composer chip. -->
          <div class="ai-model-popover hidden" id="ai-model-popover" role="menu">
            <div class="ai-mp-section">
              <div class="ai-mp-label" data-i18n="ai.provider">Provider</div>
              <div class="ai-mp-list" id="ai-mp-providers"></div>
            </div>

            <!-- Connection status row — shown for ANY active provider.
                 For Claude Code / ChatGPT it shows CLI install + login + plan;
                 for API providers it shows configured / not configured + model. -->
            <div class="ai-mp-section" id="ai-mp-cc-status"></div>

            <div class="ai-mp-section" id="ai-mp-model-section">
              <div class="ai-mp-label" data-i18n="ai.model">Model</div>
              <div class="ai-mp-modelrow" id="ai-mp-model-api">
                <input type="text" id="ai-model-input" class="ai-mp-model-input"
                       spellcheck="false" autocomplete="off" placeholder="default">
                <button class="ai-mp-iconbtn" id="ai-model-reset" type="button"
                        title="Reset to default model" aria-label="Reset model"
                        data-i18n-title="ai.resetModel">
                  <i class="ph ph-arrow-counter-clockwise"></i>
                </button>
              </div>
              <div class="ai-mp-seg hidden" id="ai-mp-model-presets"></div>
            </div>

            <!-- Effort / reasoning depth (Claude Code only) -->
            <div class="ai-mp-section ai-mp-cc hidden" id="ai-mp-effort-section">
              <div class="ai-mp-label" data-i18n="ai.effort">Effort &amp; reasoning</div>
              <div class="ai-mp-seg" id="ai-mp-effort"></div>
            </div>

            <!-- Subscription usage. For Claude Code these are REAL plan-limit
                 windows (5-hour / 7-day): the Agent SDK streams a per-window
                 utilization percent + reset time as rate_limit_event, read via
                 getClaudeCodeUsage. For Codex the CLI exposes only a session
                 token tally, so it shows one honest session row + a hint. Shown
                 for any subscription provider (ai-mp-cc toggle). -->
            <div class="ai-mp-section ai-mp-usage ai-mp-cc hidden" id="ai-mp-usage">
              <div class="ai-mp-label ai-usage-head">
                <span data-i18n="ai.usage">Usage</span>
                <span class="ai-usage-plan" id="ai-usage-plan"></span>
              </div>
              <div class="ai-usage-bars" id="ai-usage-bars"></div>
            </div>

            <div class="ai-mp-section">
              <div class="ai-mp-label" data-i18n="ai.permissions">Permissions</div>
              <div class="ai-mp-list" id="ai-mp-perms"></div>
            </div>
            <button class="ai-mp-managekeys" id="ai-mp-managekeys" type="button">
              <i class="ph ph-key" aria-hidden="true"></i><span data-i18n="ai.manageKeys">Manage API keys &amp; providers</span>
            </button>
          </div>

          <div class="ai-attachments" id="ai-attachments" hidden></div>
          <div class="ai-msg-queue" id="ai-msg-queue" hidden></div>
          <div class="ai-composer" id="ai-composer">
            <button class="ai-attach-btn" id="ai-attach-btn" type="button"
                    title="Attach files or images" aria-label="Attach files or images"
                    data-i18n-title="ai.attach" data-i18n-aria-label="ai.attach">
              <i class="ph ph-paperclip"></i>
            </button>
            <input type="file" id="ai-attach-input" multiple hidden
                   accept="image/*,text/*,.v,.sv,.svh,.vh,.cmm,.asm,.tasm,.json,.md,.txt,.log,.gtkw,.spf">
            <button class="ai-model-chip" id="ai-model-chip" type="button"
                    title="Switch model or provider" aria-label="Model and provider"
                    data-i18n-title="ai.switchModel">
              <img class="ai-model-chip-icon" id="ai-model-chip-icon"
                   src="./assets/icons/ai_claude.svg" alt="">
              <span class="ai-model-chip-name" id="ai-model-chip-name">Claude</span>
              <i class="ph ph-caret-up-down ai-model-chip-caret"></i>
            </button>

            <textarea id="ai-input"
              class="ai-input"
              placeholder="Ask Aurora Intelligence…"
              data-i18n-placeholder="ai.inputPlaceholder"
              rows="1"
              aria-label="Message"></textarea>

            <span class="ai-token-counter" id="ai-token-counter" title="Tokens this conversation">0</span>

            <button class="ai-stop-btn hidden" id="ai-stop-btn" title="Stop generation" aria-label="Stop"
                    data-i18n-title="ai.stop">
              <i class="ph ph-stop"></i>
            </button>
            <button class="ai-send-btn" id="ai-send-btn" title="Send (Enter)" aria-label="Send"
                    data-i18n-title="ai.send">
              <i class="ph-bold ph-arrow-up"></i>
            </button>
          </div>
        </div>

        <div class="ai-resize-handle" aria-label="Resize AI panel"></div>
      </div>`;
    // v3: AI panel is a flex sibling of .file-tree-container and
    // .editor-terminal-container inside .main-container, so opening it
    // pushes (not overlays) the editor area. Fallback to body for the
    // edge case where main-container hasn't rendered yet (unlikely —
    // initialize() runs on first toggle, well after DOMContentLoaded).
    const mountTarget = document.querySelector('.main-container') || document.body;
    mountTarget.appendChild(this.container);
    try { window.i18nApplyDOM?.(this.container); } catch (_) { /* i18n optional */ }
    // P17: panel starts closed (width 0) — mark inert so Tab can't reach it.
    this.container.setAttribute('inert', '');

    this.providerIcon  = this.container.querySelector('#ai-provider-icon');
    this.messagesEl    = this.container.querySelector('#ai-messages');
    // Delegated: clicking a linkified file reference (`core.v`, `proc.cmm:25`)
    // opens that project file in the editor, jumping to the line when given.
    this.messagesEl?.addEventListener('click', (e) => {
      // Click an attached image in a sent bubble → open it full-size (lightbox).
      const img = e.target.closest?.('.ai-att-thumb-lg');
      if (img) {
        e.preventDefault();
        this._openImageLightbox(img.getAttribute('src'), img.getAttribute('alt'));
        return;
      }
      const ref = e.target.closest?.('.ai-file-ref');
      if (!ref) return;
      e.preventDefault();
      this.openFileRef(ref.dataset.file, ref.dataset.line ? parseInt(ref.dataset.line, 10) : null);
    });
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
    this.setupResize(this.container.querySelector('.ai-resize-handle'), this.container);
    this.setupTerminalCorner();

    // v3 layout: width = 0 means closed, width > 0 means open. CSS
    // initial value is 0; nothing to set here for the closed case.
    // (Persisted width is applied by _applyOpenWidth when opening.)

    // Restore open state — if the panel was open when the user last closed
    // the app, re-open it now so they land right back where they left off.
    try {
      if (localStorage.getItem('aurora-ai-panel-open') === '1') {
        this.container.classList.add('open');
        document.body.classList.add('ai-assistant-open');
        this._applyOpenWidth(true);
        this.refreshProviders().then(() => this.inputEl?.focus());
        this.refreshChatList();
      }
    } catch (_) { /* ignore */ }
  }

  attachListeners() {
    this.container.querySelector('.ai-hbtn-close').addEventListener('click', () => this.toggle());

    // Model / provider popover — opened from the composer chip.
    this.modelChip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleModelPopover();
    });
    this.modelPopover.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.toggleModelPopover(false));

    // Re-sync providers whenever the AI settings panel changes model/key.
    window.addEventListener('aurora-ai-settings-changed', () => this.refreshProviders());

    // Encolher a janela pode tornar invasiva uma largura que era legitima.
    // Sem isto o painel so era reavaliado ao ser arrastado, entao bastava
    // diminuir a janela para ele voltar a cobrir o terminal.
    window.addEventListener('resize', () => {
      if (this._reclampRaf) cancelAnimationFrame(this._reclampRaf);
      this._reclampRaf = requestAnimationFrame(() => this.reclampWidth());
    });

    this.mpProviders.addEventListener('change', (e) => {
      const radio = e.target.closest('input[name="ai-provider"]');
      if (radio) this.selectProvider(radio.value);
    });
    this.mpPerms.addEventListener('change', (e) => {
      const radio = e.target.closest('input[name="ai-perm"]');
      if (radio) this.setPermissionMode(radio.value);
    });

    // Model id — committed on Enter / blur (API providers, free text).
    this.modelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.modelInput.blur(); }
    });
    this.modelInput.addEventListener('change', () => this.commitModel(this.modelInput.value));
    this.modelResetBtn.addEventListener('click', () => {
      const meta = this.providersAvailable.find((p) => p.name === this.currentProvider);
      this.commitModel(meta?.defaultModel || '');
    });

    // Claude Code model presets (segmented control).
    this.mpModelPresets.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-model]');
      if (btn) this.commitModel(btn.dataset.model);
    });

    // Claude Code effort / reasoning depth (segmented control).
    this.effortSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-effort]');
      if (btn) this.setClaudeCodeEffort(btn.dataset.effort);
    });

    // Subscription-provider status section — "Re-check" button.
    this.ccStatusEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-cc-recheck]')) this.refreshSubStatus();
    });

    this.container.querySelector('#ai-mp-managekeys').addEventListener('click', () => {
      this.toggleModelPopover(false);
      document.getElementById('aurora-settings')?.click();
      // Jump straight to the AI Assistant pane once the modal is up.
      setTimeout(() => {
        document.querySelector('.settings-nav-item[data-pane="ai"]')?.click();
      }, 60);
    });

    // History popover — list of persisted chats + "New chat".
    this.historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistory();
    });
    this.historyPopover.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.toggleHistory(false));
    this.container.querySelector('#ai-history-new').addEventListener('click', () => {
      this.toggleHistory(false);
      this.newChat();
    });
    this.historyList.addEventListener('click', (e) => this.handleHistoryClick(e));

    this.sendBtn.addEventListener('click', () => this.send());

    // --- Composer attachments: button → picker, drag-drop, clipboard paste --
    this.attachBtn?.addEventListener('click', () => this.attachInput?.click());
    this.attachInput?.addEventListener('change', () => {
      this._addFiles(this.attachInput.files);
      this.attachInput.value = '';   // let the same file be picked again
    });
    const stopDrag = (e) => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter', 'dragover'].forEach((t) => this.composerEl?.addEventListener(t, (e) => {
      if (e.dataTransfer?.types?.includes('Files')) { stopDrag(e); this.composerEl.classList.add('drag-over'); }
    }));
    ['dragleave', 'dragend', 'drop'].forEach((t) => this.composerEl?.addEventListener(t, (e) => {
      stopDrag(e); this.composerEl.classList.remove('drag-over');
    }));
    this.composerEl?.addEventListener('drop', (e) => {
      if (e.dataTransfer?.files?.length) this._addFiles(e.dataTransfer.files);
    });
    this.inputEl.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const it of items) {
        if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
      }
      if (files.length) { e.preventDefault(); this._addFiles(files); }
    });
    this.stopBtn.addEventListener('click', () => this.stop());
    this.clearBtn.addEventListener('click', () => this.newChat());

    // Enter sends, Shift+Enter inserts a newline.
    // Enter is NOT gated on _isStreaming: send() itself decides between
    // dispatching now and queueing (see the _messageQueue branch there), so
    // gating here just made the follow-up queue unreachable from the keyboard —
    // the whole point is that a running turn does not block the composer.
    // sendBtn.disabled still guards the real blocker: no AI provider available.
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this.sendBtn.disabled) this.send();
      }
    });

    // Grow the composer with the text the user types (up to a cap, then
    // scroll). Runs on every input event.
    this.inputEl.addEventListener('input', () => this.autoGrowInput());

    // External links in markdown bubbles. The anchor is just a sentinel —
    // `data-href` carries the real URL. The model controls these URLs, so we
    // show a redirect warning before handing anything to the OS browser.
    this.messagesEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-href]');
      if (!a) return;
      e.preventDefault();
      this._confirmExternalLink(a.getAttribute('data-href'));
    });

    // Absolute filesystem paths in chat: directory → Explorer, text/code file →
    // open in Monaco, any other file → OS default app.
    this.messagesEl.addEventListener('click', (e) => {
      const p = e.target.closest('.ai-path');
      if (!p) return;
      e.preventDefault();
      this._openChatPath(p.getAttribute('data-path'));
    });

    // Copy button on code blocks.
    this.messagesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.ai-code-copy');
      if (!btn) return;
      const code = btn.closest('.ai-code-block')?.querySelector('code');
      if (!code) return;
      navigator.clipboard.writeText(code.innerText).then(() => {
        btn.innerHTML = '<i class="ph ph-check"></i>';
        setTimeout(() => { btn.innerHTML = '<i class="ph ph-copy"></i>'; }, 2000);
      }).catch(() => {});
    });

    // Smart auto-scroll. We treat the scrollbar as the user's "I'm
    // reading earlier messages" signal: the moment they scroll up from
    // the bottom we stop pinning the viewport so new tokens don't yank
    // them down. Returning to the bottom re-arms the pin.
    // Wheel / touch events scroll the same element so a single scroll
    // listener catches every input modality.
    this.messagesEl.addEventListener('scroll', () => {
      const atBottom = this._isAtBottom();
      if (this.stickToBottom !== atBottom) {
        this.stickToBottom = atBottom;
        this._toggleResumeScrollHint(!atBottom);
      }
    }, { passive: true });
  }

  /**
   * Floating "Jump to latest" pill, shown while the user is reading above
   * the live edge. The element is created once and kept in the DOM; we just
   * toggle `.visible`, so it fades both in and out via CSS (instant
   * `.remove()` used to make it pop out abruptly). Clicking it jumps to the
   * bottom AND hides it immediately — relying on the scroll handler to hide
   * it failed because `scrollToBottom(true)` had already set
   * `stickToBottom = true`, so the handler's `stickToBottom !== atBottom`
   * guard short-circuited and the pill stayed up.
   */
  _toggleResumeScrollHint(show) {
    if (!this.container) return;
    let pill = this.container.querySelector('.ai-scroll-resume');
    if (show) {
      if (!pill) {
        pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'ai-scroll-resume';
        pill.innerHTML = '<i class="ph ph-arrow-down"></i><span>Jump to latest</span>';
        pill.addEventListener('click', () => {
          this.smoothScrollToBottom();
          this._toggleResumeScrollHint(false);
        });
        // Anchor inside .ai-assistant-content so it floats above the
        // messages but below the composer.
        this.messagesEl.parentElement.appendChild(pill);
        // Force a reflow so adding `.visible` on the same tick animates.
        void pill.offsetWidth;
      }
      pill.classList.add('visible');
    } else if (pill) {
      pill.classList.remove('visible');
    }
  }

  /* ---------------- model / provider popover ---------------- */

  toggleModelPopover(force) {
    const open = force === undefined ? !this.modelPopoverOpen : force;
    this.modelPopoverOpen = open;
    this.modelPopover.classList.toggle('hidden', !open);
    this.modelChip.classList.toggle('active', open);
    if (open && isSubProvider(this.currentProvider)) this.refreshSubUsage();
  }

  buildPermissionOptions() {
    this.mpPerms.innerHTML = permissionOptionsHtml(PERMISSION_MODES, this.permissionMode);
  }

  setPermissionMode(mode) {
    if (!PERMISSION_MODES.some((m) => m.id === mode)) return;
    this.permissionMode = mode;
    try { localStorage.setItem(PERMISSION_STORE_KEY, mode); }
    catch (_) { /* persistence is best-effort */ }
  }

  async refreshProviders() {
    if (!window.aiAPI) {
      this.showEmptyState(true);
      this.sendBtn.disabled = true;
      this.inputEl.disabled = true;
      return;
    }

    let providers = [];
    try {
      const r = await window.aiAPI.listProviders();
      const s = await window.aiAPI.getKeyStatus();
      providers = r?.providers || [];
      this.providersConfigured = s?.configured || {};
    } catch (e) {
      console.warn('[ai-panel] refreshProviders failed:', e);
      providers = [];
      this.providersConfigured = {};
    }

    // Claude Code and ChatGPT are synthetic, always-available providers
    // (subscription auth — no API key). Their model is persisted locally,
    // not by the backend.
    if (!this.claudeCodeEntry) {
      this.claudeCodeEntry = { ...CLAUDE_CODE_PROVIDER };
      try {
        const saved = localStorage.getItem(SUB_META['claude-code'].modelStoreKey);
        if (saved) this.claudeCodeEntry.model = saved;
      } catch (_) { /* ignore */ }
    }
    if (!this.chatgptEntry) {
      this.chatgptEntry = { ...CHATGPT_PROVIDER };
      try {
        const key = SUB_META['chatgpt'].modelStoreKey;
        const saved = localStorage.getItem(key);
        // Drop any previously-saved id that is no longer a valid preset.
        // Earlier versions offered `gpt-5` and `gpt-5-codex` — both fail
        // on ChatGPT-subscription auth with "model is not supported when
        // using Codex with a ChatGPT account". Falling back to "default"
        // avoids a stream error on the very first turn after the upgrade.
        if (saved && CHATGPT_MODELS.some((m) => m.id === saved)) {
          this.chatgptEntry.model = saved;
        } else if (saved) {
          localStorage.removeItem(key);
          this.chatgptEntry.model = 'default';
        }
      } catch (_) { /* ignore */ }
    }
    this.providersConfigured['claude-code'] = true;
    this.providersConfigured['chatgpt'] = true;

    const apiUsable = providers.filter((p) => this.providersConfigured[p.name]);
    this.providersAvailable = [this.claudeCodeEntry, this.chatgptEntry, ...apiUsable];

    this.showEmptyState(false);
    this.sendBtn.disabled = false;
    this.inputEl.disabled = false;

    // Keep the current selection if still valid; otherwise prefer a
    // configured API provider, falling back to Claude Code.
    if (!this.currentProvider ||
        !this.providersAvailable.some((p) => p.name === this.currentProvider)) {
      this.currentProvider = apiUsable[0]?.name || 'claude-code';
    }

    this.renderProviderOptions();
    this.applyProviderState();
  }

  renderProviderOptions() {
    // Pure markup in provider_view.js; this method owns the popover element.
    this.mpProviders.innerHTML = providerOptionsHtml(this.providersAvailable, this.currentProvider);
  }

  /** Reflect the active provider across the icon, chip, controls and usage. */
  applyProviderState() {
    const meta = PROVIDER_META[this.currentProvider] || {};
    const entry = this.providersAvailable.find((p) => p.name === this.currentProvider);
    const isSub = !!meta.subscription;

    if (meta.icon) this.providerIcon.src = meta.icon;
    this.updateModelChip();
    if (this.modelInput) this.modelInput.value = entry?.model || '';

    // Effort / usage sections stay subscription-only — they have no
    // analog for API providers.
    this.ccSections.forEach((el) => el.classList.toggle('hidden', !isSub));
    // Effort shows for any bridge with hasEffort — Claude Code (--effort)
    // and Codex (-c model_reasoning_effort) share the same segmented control.
    const sm = SUB_META[this.currentProvider];
    if (this.effortSection) {
      this.effortSection.classList.toggle('hidden', !(sm && sm.hasEffort));
    }

    this.renderModelControls();
    if (isSub) {
      if (sm && sm.hasEffort) this.renderEffort();
      this.refreshSubStatus();
      this.refreshSubUsage();
    } else {
      // API provider — status row is generated synchronously from the
      // already-loaded providersConfigured map.
      this.renderProviderStatus();
    }
  }

  /** Switch the active provider (from a radio change in the popover). */
  selectProvider(name) {
    if (name === this.currentProvider) return;
    this.currentProvider = name;
    this.applyProviderState();
    this.logModelChange();
    // Choosing an AI is the last thing the user wants from the popover —
    // close it so they land straight back on the composer.
    this.toggleModelPopover(false);
  }

  /**
   * Print a `--- Modelo: <provider> · <model> ---` divider into the
   * messages list. Called whenever the user changes the provider or the
   * model — gives a clear in-chat marker of which model produced which
   * answers, in the style of Claude's VS Code extension.
   */
  logModelChange() {
    const meta = PROVIDER_META[this.currentProvider] || {};
    const entry = this.providersAvailable.find((p) => p.name === this.currentProvider);
    const label = meta.label || this.currentProvider || 'Model';
    const model = faithfulModelName(entry, this.currentProvider);
    const el = this.appendDivider(model ? `Modelo: ${label} · ${model}` : `Modelo: ${label}`);
    // Render this marker with a flowing sine wave instead of flat rules.
    el?.classList.add('ai-divider-wave');
  }

  /**
   * The model name to show in the switch marker — faithful to what the
   * user actually picked. For the subscription CLIs that means the chosen
   * preset label (Default / Sonnet / Opus / Haiku); for API providers it's
   * the real model id (lightly shortened), falling back to the provider's
   * default model so the marker is never blank.
   */
  /** Model picker: free-text input for API providers, presets for the CLIs. */
  renderModelControls() {
    const sm = SUB_META[this.currentProvider];
    this.mpModelApi.classList.toggle('hidden', !!sm);
    this.mpModelPresets.classList.toggle('hidden', !sm);
    if (sm) {
      const entry = this.providersAvailable.find((p) => p.name === this.currentProvider);
      const active = entry?.model || 'default';
      this.mpModelPresets.innerHTML = modelPresetsHtml(sm.models, active);
    }
  }

  /** Effort / reasoning-depth segmented control (Claude Code only). */
  renderEffort() {
    this.effortSeg.innerHTML = CLAUDE_CODE_EFFORT.map((e) =>
      `<button type="button" data-effort="${e.id}" class="ai-seg-btn${
        e.id === this.claudeCodeEffort ? ' active' : ''}">${e.label}</button>`).join('');
  }

  setClaudeCodeEffort(id) {
    if (!CLAUDE_CODE_EFFORT.some((e) => e.id === id)) return;
    this.claudeCodeEffort = id;
    try { localStorage.setItem('aurora-ai-cc-effort', id); }
    catch (_) { /* best-effort */ }
    this.renderEffort();
  }

  /** Persist a model id for the active provider and refresh the chip. */
  async commitModel(value) {
    const v = (value || '').trim();
    const entry = this.providersAvailable.find((p) => p.name === this.currentProvider);
    const before = entry?.model || '';

    const sm = SUB_META[this.currentProvider];
    if (sm) {
      const model = v || 'default';
      if (entry) entry.model = model;
      try { localStorage.setItem(sm.modelStoreKey, model); }
      catch (_) { /* best-effort */ }
      this.renderModelControls();
      this.updateModelChip();
      if (model !== before) this.logModelChange();
      return;
    }

    try {
      const r = await window.aiAPI.setModel(this.currentProvider, v);
      if (r && r.ok) {
        if (entry) entry.model = r.model || '';
        if (this.modelInput) this.modelInput.value = r.model || '';
      }
    } catch (_) { /* leave the field as the user typed it */ }
    this.updateModelChip();
    this.renderProviderOptions();   // refresh the per-provider model hint
    if ((entry?.model || '') !== before) this.logModelChange();
  }

  /** Refresh the composer chip — provider icon + short model name. */
  updateModelChip() {
    const meta = PROVIDER_META[this.currentProvider] || {};
    const entry = this.providersAvailable.find((p) => p.name === this.currentProvider);
    if (meta.icon) this.modelChipIcon.src = meta.icon;

    const short = shortModelName(entry?.model);
    this.modelChipName.textContent = short || meta.label || this.currentProvider || 'Model';
    this.modelChip.title = entry?.model
      ? `${meta.label || this.currentProvider} · ${entry.model}`
      : `${meta.label || this.currentProvider} — switch model or provider`;
  }

  /* ---------------- subscription provider: connection status ---------------- */

  /** Probe the active subscription CLI's install + login status. */
  async refreshSubStatus() {
    const provider = this.currentProvider;
    const sm = SUB_META[provider];
    if (!sm) return;
    let status = null;
    try {
      const r = await window.aiAPI?.[sm.statusApi]?.();
      status = r?.status || null;
    } catch (_) { /* treat as not installed */ }
    this.subStatus[provider] = status;
    // The user may have switched providers while the probe was in flight.
    if (this.currentProvider === provider) this.renderSubStatus();
  }

  /**
   * Friendly plan label for the status row. Raw values come straight
   * from the CLI/JWT (`pro`, `max`, `plus`, `business`, `free`, …) — we
   * uppercase them and map the few that have well-known marketing names.
   */
  formatPlanLabel(raw) {
    if (!raw) return '';
    const v = String(raw).toLowerCase().trim();
    const known = {
      'pro':         'PRO',
      'max':         'MAX',
      'plus':        'PLUS',
      'free':        'FREE',
      'team':        'TEAM',
      'business':    'BUSINESS',
      'edu':         'EDU',
      'enterprise':  'ENTERPRISE',
      // Some Claude payloads use `subscriptionType: 'pro_max'` / `claude_max`.
      'pro_max':     'MAX',
      'claude_max':  'MAX',
      'claude_pro':  'PRO',
    };
    return known[v] || v.toUpperCase();
  }

  renderSubStatus() {
    if (!this.ccStatusEl) return;
    const sm = SUB_META[this.currentProvider];
    if (!sm) return;
    const s = this.subStatus[this.currentProvider];
    const meta = PROVIDER_META[this.currentProvider] || {};
    let state = 'off';
    let icon = 'ph-x-circle';
    let title = 'Checking…';
    let detail = '';

    if (!s) {
      title = `Checking ${sm.cliName}…`;
    } else if (!s.installed && !s.downloadable) {
      state = 'off'; icon = 'ph-x-circle';
      title = sm.notInstalled;
      detail = sm.installHint;
    } else if (!s.authed) {
      state = 'warn'; icon = 'ph-warning-circle';
      title = 'Not signed in';
      detail = `Run <code>${sm.loginCmd}</code> in a terminal, then re-check.`;
    } else if (!s.installed) {
      // B12: signed in and downloadable — ready to use; the ~230 MB binary is
      // fetched on the first message (then this flips to the version detail).
      state = 'on'; icon = 'ph-check-circle';
      const plan = this.formatPlanLabel(s.plan) || 'SUBSCRIPTION';
      title = `${meta.label || sm.cliName} · ${plan}`;
      detail = 'Downloads on first message';
    } else {
      state = 'on'; icon = 'ph-check-circle';
      const plan = this.formatPlanLabel(s.plan) || 'SUBSCRIPTION';
      title = `${meta.label || sm.cliName} · ${plan}`;
      detail = s.version || sm.cliName;
    }

    this.ccStatusEl.dataset.state = state;
    this.ccStatusEl.innerHTML = `
      <div class="ai-cc-row">
        <i class="ph ${icon} ai-cc-icon" aria-hidden="true"></i>
        <span class="ai-cc-title">${title}</span>
        <button type="button" class="ai-cc-recheck" data-cc-recheck
                title="Re-check connection">
          <i class="ph ph-arrow-clockwise" aria-hidden="true"></i>
        </button>
      </div>
      ${detail ? `<p class="ai-cc-detail">${escapeHtml(detail)}</p>` : ''}`;
  }

  /**
   * Connection status row for an API (BYOK) provider — OpenAI, Anthropic,
   * Google, DeepSeek, Groq, Ollama. Mirrors renderSubStatus so the user
   * sees a uniform "what am I connected to?" badge regardless of whether
   * the provider is subscription- or key-backed.
   */
  renderProviderStatus() {
    if (!this.ccStatusEl) return;
    const provider = this.currentProvider;
    const meta = PROVIDER_META[provider] || {};
    const entry = this.providersAvailable.find((p) => p.name === provider);
    const configured = !!(this.providersConfigured && this.providersConfigured[provider]);

    let state, icon, title, detail;
    if (configured) {
      state = 'on';
      icon = 'ph-check-circle';
      title = `${meta.label || provider} · Connected`;
      const model = entry?.model || entry?.defaultModel || '';
      detail = model ? `Model: ${model}` : '';
    } else {
      state = 'off';
      icon = 'ph-x-circle';
      title = `${meta.label || provider} · Not configured`;
      detail = 'Add an API key in Settings → AI Assistant.';
    }

    this.ccStatusEl.dataset.state = state;
    this.ccStatusEl.innerHTML = `
      <div class="ai-cc-row">
        <i class="ph ${icon} ai-cc-icon" aria-hidden="true"></i>
        <span class="ai-cc-title">${escapeHtml(title)}</span>
      </div>
      ${detail ? `<p class="ai-cc-detail">${escapeHtml(detail)}</p>` : ''}`;
  }

  /** True when the active subscription CLI is installed and signed in. */
  isSubReady() {
    const s = this.subStatus[this.currentProvider];
    return !!(s && s.installed && s.authed);
  }

  /* ---------------- subscription provider: usage ---------------- */

  async refreshSubUsage() {
    const provider = this.currentProvider;
    const sm = SUB_META[provider];
    if (!sm) return;
    let usage = null;
    try {
      const r = await window.aiAPI?.[sm.usageApi]?.();
      usage = r?.usage || null;
    } catch (_) { /* leave usage null */ }
    this.subUsage[provider] = usage;
    if (this.currentProvider === provider) this.renderUsage();
  }

  /**
   * Redirect warning before opening a model-supplied link in the OS browser.
   * Shows the exact destination URL (as text — no injection) and only calls
   * openExternal on explicit confirmation. openExternal itself also rejects
   * non-http(s)/mailto schemes in the main process (defence in depth).
   */
  _getTrustExternalLinks() {
    try { return localStorage.getItem(TRUST_LINKS_KEY) === '1'; } catch (_) { return false; }
  }

  _setTrustExternalLinks(v) {
    try { localStorage.setItem(TRUST_LINKS_KEY, v ? '1' : '0'); } catch (_) { /* ignore */ }
    // Keep any Settings toggle bound to the same preference in sync, live.
    window.dispatchEvent(new CustomEvent('aurora:trust-external-links-changed', { detail: { value: !!v } }));
  }

  _confirmExternalLink(url) {
    if (!url) return;

    // Bypass the warning entirely when the user has chosen to trust external
    // links (the dialog checkbox, mirrored by the Settings toggle).
    if (this._getTrustExternalLinks()) {
      electronAPI?.openExternal?.(url);
      return;
    }

    document.querySelector('.ai-link-warning')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ai-link-warning';
    overlay.innerHTML =
      '<div class="ai-link-warning-card" role="dialog" aria-modal="true" aria-label="Open external link">' +
        '<div class="ai-link-warning-head"><i class="ph ph-arrow-square-out"></i>' +
          '<span>Open external link?</span></div>' +
        '<p class="ai-link-warning-text">This leaves Aurora and opens in your default browser:</p>' +
        '<div class="ai-link-warning-url"></div>' +
        '<label class="ai-link-warning-trust">' +
          '<input type="checkbox" class="ai-link-warning-trust-cb">' +
          '<span>Always open external links without asking</span>' +
        '</label>' +
        '<div class="ai-link-warning-actions">' +
          '<button class="ai-link-warning-cancel" type="button">Cancel</button>' +
          '<button class="ai-link-warning-open" type="button">Open link</button>' +
        '</div>' +
      '</div>';
    // textContent, never innerHTML — the URL is untrusted model output.
    overlay.querySelector('.ai-link-warning-url').textContent = url;

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
    overlay.querySelector('.ai-link-warning-cancel').addEventListener('click', close);
    overlay.querySelector('.ai-link-warning-open').addEventListener('click', () => {
      // If "always" was ticked, persist the bypass before opening.
      if (overlay.querySelector('.ai-link-warning-trust-cb')?.checked) {
        this._setTrustExternalLinks(true);
      }
      electronAPI?.openExternal?.(url);
      close();
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    overlay.querySelector('.ai-link-warning-open').focus();
  }

  /**
   * Route a clicked absolute filesystem path. We stat it in the main process
   * (get-file-stats) and then: directory → open in the OS file manager
   * (shell.openPath ⇒ Explorer on Windows); text/code file → open inside Monaco
   * as a tab; any other file (image/video/audio/pdf/…) → OS default app.
   */
  async _openChatPath(rawPath) {
    if (!rawPath) return;
    let info = null;
    try { info = await electronAPI?.getFileStats?.(rawPath); }
    catch (_) { info = null; }
    if (!info) {
      try { window.showNotification?.(`Path not found: ${rawPath}`, 'warning'); } catch (_) { /* ignore */ }
      return;
    }
    if (info.isDirectory) {
      electronAPI?.openFolder?.(rawPath);           // shell.openPath → Explorer
      return;
    }
    if (aiPathIsText(rawPath)) {
      try {
        const content = await electronAPI.readFile(rawPath);
        window.TabManager?.addTab?.(rawPath, content ?? '', { preview: true });
      } catch (_) {
        electronAPI?.openFolder?.(rawPath);         // fallback: default app
      }
    } else {
      electronAPI?.openFolder?.(rawPath);           // shell.openPath → default app
    }
  }

  renderUsage() {
    if (!this.usageBars) return;
    const u = this.subUsage[this.currentProvider];

    this.usagePlan.textContent = u?.plan ? `${this.formatPlanLabel(u.plan)} plan` : '';

    // Session: the CLI's per-turn usage is the source of truth. We
    // surface exactly what it reported — no synthetic floor — so the
    // counter never drifts from reality. The composer token pill stays
    // in sync because applyUsage() feeds the same numbers back.
    const sessTokens = Number(u?.session?.tokens) || 0;
    const cost = Number(u?.session?.costUsd) || 0;
    const rows = [
      usageRowHTML('This session', 'ph-lightning',
        `${formatTokens(sessTokens)} tokens${cost > 0 ? ` · $${cost.toFixed(2)}` : ''}`,
        'count', 0),
    ];

    // Rate-limit windows (5-hour, 7-day, …). The Claude Agent SDK reports a
    // real `utilization` (0–100 %) per window plus a `resetsAt` timestamp, so we
    // plot that directly. (The previous code guessed `used`/`limit` fields the
    // SDK never sends, so `pct` was always null and every bar fell back to a
    // coarse status heuristic — why the meter never showed real numbers.)
    const windows = Array.isArray(u?.windows) ? u.windows : [];
    for (const w of windows) {
      const meta = WINDOW_META[w.rateLimitType] || { label: w.rateLimitType, icon: 'ph-clock' };
      const util = Number(w.utilization);
      const pct = Number.isFinite(util) ? Math.max(0, Math.min(100, util)) : null;
      const sev = (pct != null
        ? (pct >= 90 ? 'high' : pct >= 60 ? 'mid' : 'ok')
        : (w.status === 'rejected' ? 'high'
            : (w.status && w.status !== 'allowed') ? 'mid' : 'ok'));
      // resetsAt can arrive in seconds or milliseconds — untilTime wants unix
      // seconds, so fold ms down.
      const resetSecs = w.resetsAt
        ? (Number(w.resetsAt) > 1e12 ? Number(w.resetsAt) / 1000 : Number(w.resetsAt))
        : null;
      const reset = resetSecs ? `resets ${untilTime(resetSecs)}` : '';
      const valText = (pct != null)
        ? `${Math.round(pct)}%${reset ? ` · ${reset}` : ''}`
        : (reset || w.status || '');
      rows.push(usageRowHTML(meta.label, meta.icon, valText, sev,
        pct != null ? pct : (sev === 'high' ? 100 : sev === 'mid' ? 66 : 22)));
    }

    this.usageBars.innerHTML = rows.join('');

    let hint = this.mpUsage.querySelector('.ai-usage-hint');
    if (!windows.length) {
      // Codex's CLI exposes only a session token tally, never rate-limit
      // windows — so the "appears after your first message" copy was wrong
      // there forever. Tell each provider the truth.
      const text = this.currentProvider === 'chatgpt'
        ? 'The Codex CLI reports only this session’s token tally, not ChatGPT plan limits.'
        : 'Plan limits appear here after your first message.';
      if (!hint) {
        hint = document.createElement('p');
        hint.className = 'ai-usage-hint';
        this.mpUsage.appendChild(hint);
      }
      hint.textContent = text;
    } else if (hint) {
      hint.remove();
    }
  }

  /* ---------------- tool permission gate ---------------- */

  /**
   * Decide whether a tool call may run. Resolves true/false. Called by
   * the tool runner before every tool. `allow` mode auto-approves;
   * `writes` auto-approves reads; otherwise an inline card is shown.
   */
  confirmToolCall(def, args) {
    // Pure decision logic (modes, always-confirm, pre-authorized) lives in
    // tool_permission.js; the class still owns the DOM card (showInlineConfirm).
    return decideToolPermission(def, this.permissionMode) === 'allow'
      ? Promise.resolve(true)
      : this.showInlineConfirm(def, args);
  }

  /**
   * Runaway guard for memory hygiene: a single never-ending conversation must
   * not grow `this.messages` without bound. Keep the most recent
   * MAX_RETAINED_MESSAGES (a high cap normal chats never hit); switching/closing
   * a chat already resets the array entirely (the common path). On the rare trim
   * the very oldest turns drop from the locally-held history — acceptable at this
   * size (the subscription CLIs keep their own context via --resume).
   */
  _capMessages() {
    const MAX_RETAINED_MESSAGES = 400;
    if (this.messages.length > MAX_RETAINED_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_RETAINED_MESSAGES);
    }
  }

  /**
   * Render an inline Allow/Deny card in the message stream (not a
   * full-screen modal) and resolve with the user's choice. The card
   * removes itself once decided.
   */
  showInlineConfirm(def, args) {
    return new Promise((resolve) => {
      const card = document.createElement('div');
      card.className = 'ai-confirm enter';
      const verb = def && def.access === 'write' ? 'make a change' : 'read something';
      card.innerHTML = `
        <div class="ai-confirm-head">
          <i class="ph ph-shield-check" aria-hidden="true"></i>
          <span>Aurora Intelligence wants to ${verb}</span>
        </div>
        <div class="ai-confirm-tool"></div>
        <div class="ai-confirm-desc"></div>
        <div class="ai-confirm-notes"></div>
        <pre class="ai-confirm-args"></pre>
        <div class="ai-confirm-actions">
          <button class="ai-confirm-deny" type="button">Deny</button>
          <button class="ai-confirm-allow" type="button">Allow</button>
        </div>
      `;
      card.querySelector('.ai-confirm-tool').textContent = def ? def.name : 'tool';
      card.querySelector('.ai-confirm-desc').textContent = def ? (def.description || '') : '';
      // The model's prose (note / question) reads as text; only the structural
      // args stay in the JSON block. textContent throughout — this is model
      // output, so it is never parsed as markup.
      const { prose, rest } = splitArgs(args);
      const notes = card.querySelector('.ai-confirm-notes');
      for (const p of prose) {
        const row = document.createElement('div');
        row.className = 'ai-confirm-note';
        const key = document.createElement('span');
        key.className = 'ai-confirm-note-key';
        key.textContent = p.key;
        const text = document.createElement('span');
        text.className = 'ai-confirm-note-text';
        text.textContent = p.text;
        row.append(key, text);
        notes.appendChild(row);
      }
      if (!prose.length) notes.remove();

      const preview = previewArgs(rest);
      const pre = card.querySelector('.ai-confirm-args');
      if (preview) pre.textContent = preview; else pre.remove();

      let settled = false;
      const finish = (allowed) => {
        if (settled) return;
        settled = true;
        this.pendingConfirms.delete(decide);
        card.classList.add('done');
        setTimeout(() => card.remove(), 180);
        resolve(allowed);
      };
      // Registered so an aborted/failed turn can auto-deny a stale card.
      const decide = (allowed) => finish(allowed);
      this.pendingConfirms.add(decide);

      card.querySelector('.ai-confirm-allow').addEventListener('click', () => finish(true));
      card.querySelector('.ai-confirm-deny').addEventListener('click', () => finish(false));

      this.messagesEl.appendChild(card);
      this.scrollToBottom();
      requestAnimationFrame(() => card.classList.remove('enter'));
    });
  }

  /**
   * Inline "Ask User Question" card — the AI's way of pausing a turn and
   * asking the human for a decision/clarification. Mirrors Claude
   * Code's `AskUserQuestion` tool: one prompt, an optional list of
   * single- or multi-select options, plus an "Other" text field.
   *
   * Resolves with `{ answer, selected }` once the user submits, or with
   * `null` if the turn is aborted before they answer (see
   * resetTurnState — pendingAskUserQuestions is purged there).
   *
   * @param {object} params
   * @param {string} params.question
   * @param {Array<{label:string, description?:string}>} [params.options]
   * @param {boolean} [params.multiSelect]
   */
  showAskUserQuestionInline({ question, options = [], multiSelect = false } = {}) {
    if (!this.container) this.initialize();
    return new Promise((resolve) => {
      const card = document.createElement('div');
      card.className = 'ai-ask-question enter';
      const inputType = multiSelect ? 'checkbox' : 'radio';
      const safeOptions = Array.isArray(options) ? options : [];
      const optsHtml = safeOptions.map((opt, idx) => {
        const label = escapeHtml(opt.label || `Option ${idx + 1}`);
        const desc  = opt.description ? `<span class="ai-askq-opt-desc">${escapeHtml(opt.description)}</span>` : '';
        return `
          <label class="ai-askq-opt">
            <input type="${inputType}" name="ai-askq-opt" value="${idx}">
            <span class="ai-askq-opt-text">
              <span class="ai-askq-opt-label">${label}</span>${desc}
            </span>
          </label>`;
      }).join('');
      card.innerHTML = `
        <div class="ai-askq-head">
          <i class="ph ph-question" aria-hidden="true"></i>
          <span>Aurora Intelligence is asking</span>
        </div>
        <div class="ai-askq-question"></div>
        <div class="ai-askq-options">${optsHtml}</div>
        <div class="ai-askq-other">
          <label class="ai-askq-other-label">Other / write your own answer</label>
          <textarea class="ai-askq-other-input" rows="2"
                    placeholder="Type a custom answer (optional)"></textarea>
        </div>
        <div class="ai-askq-actions">
          <button type="button" class="ai-askq-cancel">Cancel</button>
          <button type="button" class="ai-askq-submit">Send answer</button>
        </div>
      `;
      card.querySelector('.ai-askq-question').textContent = question;

      let settled = false;
      /**
       * `record` leaves a permanent trace of the exchange in the chat. Without
       * it the card just vanished: what was asked and what you picked survived
       * only inside the tool chip's JSON, so a reopened chat lost the decision
       * entirely — and a decision is usually the most re-readable thing in the
       * whole conversation. Passed only for deliberate answers/dismissals; a
       * turn aborted from elsewhere resolves without one, since "the turn died"
       * is not a decision worth a record.
       */
      const finish = (payload, record = null) => {
        if (settled) return;
        settled = true;
        this.pendingAskUserQuestions?.delete(decide);
        if (record) {
          this.messages.push(record);
          // In place, where the card stood, before the card fades out.
          this.messagesEl.insertBefore(this._renderQuestionRecord(record), card);
        }
        card.classList.add('done');
        setTimeout(() => card.remove(), 180);
        resolve(payload);
      };
      const decide = (val) => finish(val);
      if (!this.pendingAskUserQuestions) this.pendingAskUserQuestions = new Set();
      this.pendingAskUserQuestions.add(decide);

      const submit = () => {
        const otherText = card.querySelector('.ai-askq-other-input').value.trim();
        const checked = Array.from(card.querySelectorAll('input[name="ai-askq-opt"]:checked'))
          .map((el) => safeOptions[Number(el.value)]?.label).filter(Boolean);
        // Resolution: if "Other" text is present we use that as the
        // canonical answer (with the checked labels as supplementary
        // context). Otherwise the selected labels form the answer.
        let answer;
        if (otherText) {
          answer = checked.length
            ? `${otherText} (also selected: ${checked.join(', ')})`
            : otherText;
        } else if (checked.length) {
          answer = multiSelect ? checked.join(', ') : checked[0];
        } else {
          // Nothing selected and nothing typed — keep the card open and
          // flash the textarea so the user knows we need an input.
          card.classList.add('shake');
          setTimeout(() => card.classList.remove('shake'), 320);
          return;
        }
        finish({ answer, selected: checked },
          { role: 'question', question, selected: checked, custom: otherText, cancelled: false });
      };

      card.querySelector('.ai-askq-submit').addEventListener('click', submit);
      card.querySelector('.ai-askq-cancel').addEventListener('click', () => {
        finish({ answer: '[user cancelled the question]', selected: [] },
          { role: 'question', question, selected: [], custom: '', cancelled: true });
      });
      // Enter inside the textarea (without shift) also submits.
      card.querySelector('.ai-askq-other-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      });

      this.messagesEl.appendChild(card);
      this.scrollToBottom();
      requestAnimationFrame(() => card.classList.remove('enter'));
    });
  }

  /**
   * The permanent trace of one ask_user_question exchange: what was asked and
   * what you picked. Rendered live in place of the card, and again from
   * `this.messages` when the chat is reopened — same element either way, so the
   * reloaded chat reads exactly like the live one.
   *
   * Display-only: `question` entries are filtered out of buildApiMessages. The
   * model already learned the answer through the tool's return value, so
   * sending this too would just say it twice.
   *
   * @param {{question?:string, selected?:string[], custom?:string, cancelled?:boolean}} entry
   */
  _renderQuestionRecord(entry) {
    const el = document.createElement('div');
    el.className = `ai-askq-record${entry.cancelled ? ' cancelled' : ''}`;

    const head = document.createElement('div');
    head.className = 'ai-askq-record-head';
    const icon = document.createElement('i');
    icon.className = entry.cancelled ? 'ph ph-x-circle' : 'ph ph-check-circle';
    icon.setAttribute('aria-hidden', 'true');
    const headText = document.createElement('span');
    headText.textContent = entry.cancelled ? 'You dismissed a question' : 'You answered';
    head.append(icon, headText);
    el.appendChild(head);

    const q = document.createElement('div');
    q.className = 'ai-askq-record-q';
    q.textContent = entry.question || '';   // model text — never markup
    el.appendChild(q);

    const selected = Array.isArray(entry.selected) ? entry.selected : [];
    if (selected.length) {
      const chips = document.createElement('div');
      chips.className = 'ai-askq-record-chips';
      for (const label of selected) {
        const chip = document.createElement('span');
        chip.className = 'ai-askq-record-chip';
        const tick = document.createElement('i');
        tick.className = 'ph ph-check';
        tick.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = String(label);   // model text — never markup
        chip.append(tick, text);
        chips.appendChild(chip);
      }
      el.appendChild(chips);
    }

    if (entry.custom) {
      const custom = document.createElement('div');
      custom.className = 'ai-askq-record-custom';
      custom.textContent = entry.custom;    // the user's own words
      el.appendChild(custom);
    }
    return el;
  }

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
    // notice (display-only bubble — not persisted) instead of a stream error.
    if (isSubProvider(this.currentProvider)) {
      const sm = SUB_META[this.currentProvider];
      if (!this.subStatus[this.currentProvider]) await this.refreshSubStatus();
      const s = this.subStatus[this.currentProvider];
      // B12: a downloadable-but-not-yet-installed CLI is fine to start — the
      // turn fetches it on first use (with progress). The only hard blockers
      // are "no CLI available at all" and "not signed in".
      const willFetch = !!(s && !s.installed && s.downloadable && s.authed);
      if (!this.isSubReady() && !willFetch) {
        const signedOut = !!(s && (s.installed || s.downloadable) && !s.authed);
        this.appendBubble('assistant', signedOut
          ? `**${sm.cliName} is not signed in.** Run \`${sm.loginCmd}\` in a ` +
            'terminal, then open the model menu and click re-check.'
          : `**${sm.notInstalled}.** ${sm.installHint}, then open the model ` +
            'menu and click re-check.', false);
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
      (this._messageQueue || (this._messageQueue = [])).push({ text, atts });
      this._renderQueue();
      return;
    }
    await this._submitUserMessage(text, atts);
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
    // First message of a new chat — assign an id, derive a title from the
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

    const userBubble = this.appendBubble('user', text);
    if (atts.length) this._renderBubbleAttachments(userBubble, atts);
    this.messages.push({ role: 'user', content: text, attachments: atts.length ? atts : undefined });
    this._capMessages();
    // A real user message breaks any autonomous follow-up chain.
    this._autoChainCount = 0;

    await this._dispatchTurn();
  }

  /**
   * Try to hand a follow-up to the turn that is running right now, so the model
   * sees it in-session instead of after a fresh dispatch. Returns true when the
   * live turn took it — the caller then does NOT queue.
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
    // It is in the CLI's transcript now, so it belongs in ours too — in order,
    // as a normal message. The model answers it in a later segment of this same
    // turn, which is why no queued chip is rendered for it.
    this.messages.push({ role: 'user', content: text });
    this.appendBubble('user', text);
    this.scrollToBottom();
    return true;
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

  /** Render the queued-follow-up chips above the composer (each cancellable). */
  _renderQueue() {
    if (!this.queueEl) return;
    const q = this._messageQueue || [];
    this.queueEl.hidden = q.length === 0;
    this.queueEl.innerHTML = q.map((m, i) => {
      const preview = (m.text || (m.atts && m.atts.length ? `${m.atts.length} attachment(s)` : '')).slice(0, 80);
      return `<span class="ai-queued-chip" title="Queued — sends after the current reply">` +
        `<i class="ph ph-clock" aria-hidden="true"></i>` +
        `<span class="ai-queued-text">${this._escAtt(preview)}</span>` +
        `<button class="ai-queued-remove" data-i="${i}" type="button" aria-label="Cancel queued message">` +
        `<i class="ph ph-x" aria-hidden="true"></i></button></span>`;
    }).join('');
    this.queueEl.querySelectorAll('.ai-queued-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._messageQueue.splice(parseInt(btn.dataset.i, 10), 1);
        this._renderQueue();
      });
    });
  }

  /* ---------------- composer attachments (images + files) ---------------- */

  /** Read dropped / picked / pasted files into pendingAttachments, then render. */
  async _addFiles(fileList) {
    const files = Array.from(fileList || []);
    const MAX_IMAGE = 8 * 1024 * 1024;   // 8 MB per image
    const MAX_TEXT = 256 * 1024;         // 256 KB of text context per file
    for (const file of files) {
      if (this.pendingAttachments.length >= 10) {
        this.appendBubble('assistant', '_Up to 10 attachments per message._', false);
        break;
      }
      const isImage = (file.type || '').startsWith('image/');
      try {
        if (isImage) {
          if (file.size > MAX_IMAGE) {
            this.appendBubble('assistant', `_"${file.name}" is too large (images max 8 MB)._`, false);
            continue;
          }
          const dataUrl = await this._readAs(file, 'dataURL');
          this.pendingAttachments.push({
            id: this._attId(), kind: 'image', name: file.name || 'image.png',
            mime: file.type || 'image/png', size: file.size, dataUrl,
          });
        } else {
          const text = await this._readAs(file, 'text');
          const clipped = text.length > MAX_TEXT;
          this.pendingAttachments.push({
            id: this._attId(), kind: 'file', name: file.name || 'file.txt',
            mime: file.type || 'text/plain', size: file.size,
            text: clipped ? text.slice(0, MAX_TEXT) : text, clipped,
          });
        }
      } catch (_) {
        this.appendBubble('assistant', `_Could not read "${file.name}"._`, false);
      }
    }
    this._renderAttachments();
  }

  _readAs(file, how) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      if (how === 'dataURL') r.readAsDataURL(file); else r.readAsText(file);
    });
  }

  _attId() { return `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

  _removeAttachment(id) {
    this.pendingAttachments = this.pendingAttachments.filter((a) => a.id !== id);
    this._renderAttachments();
  }

  _escAtt(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  /** Render the preview chips row above the composer. */
  _renderAttachments() {
    if (!this.attachmentsEl) return;
    const list = this.pendingAttachments;
    this.attachmentsEl.hidden = list.length === 0;
    // Pure chip markup lives in chat_attachments.js; the class still owns the
    // element, the state, and the remove-button wiring. `esc` is the same
    // DOM-based escaper as before, so the markup stays byte-identical.
    const esc = (s) => this._escAtt(s);
    this.attachmentsEl.innerHTML = list
      .map((a) => composerChipHtml(a, esc, formatAttachmentSize))
      .join('');
    this.attachmentsEl.querySelectorAll('.ai-att-remove').forEach((btn) => {
      btn.addEventListener('click', () => this._removeAttachment(btn.dataset.id));
    });
  }

  /** Render a read-only attachments strip inside a sent user bubble. */
  _renderBubbleAttachments(bubble, atts) {
    if (!bubble || !atts || !atts.length) return;
    const strip = document.createElement('div');
    strip.className = 'ai-msg-attachments';
    const esc = (s) => this._escAtt(s);
    strip.innerHTML = atts.map((a) => bubbleChipHtml(a, esc, formatAttachmentSize)).join('');
    const content = bubble.querySelector('.ai-msg-content');
    (content || bubble).appendChild(strip);
  }

  /** Full-size image viewer for an attached chat image — dim backdrop with the
   *  image fit to the screen; click the backdrop / × or press Esc to close. */
  _openImageLightbox(src, alt) {
    if (!src) return;
    const overlay = document.createElement('div');
    overlay.className = 'ai-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Image preview');
    overlay.innerHTML =
      `<img class="ai-lightbox-img" src="${src}" alt="${this._escAtt(alt || '')}">` +
      `<button class="ai-lightbox-close" type="button" aria-label="Close"><i class="ph ph-x"></i></button>`;
    const close = () => {
      overlay.classList.remove('open');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => overlay.remove(), 160);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    overlay.addEventListener('click', (e) => {
      // Close on the backdrop or the × — but not when clicking the image itself.
      if (e.target.closest('.ai-lightbox-img') && !e.target.closest('.ai-lightbox-close')) return;
      close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  /**
   * Shared turn dispatcher used by send() (a real user message) and
   * autoContinue() (an autonomous follow-up). The caller pushes its message
   * into this.messages FIRST; this resets the streaming state, (re)subscribes
   * to chat events, opens a session and calls startChat.
   */
  async _dispatchTurn() {
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

    // Subscribe lazily so we never miss the first packet — startChat
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
    // for this turn — strip them from the stored history so they are NOT resent
    // on every subsequent turn (images up to 8 MB would accumulate and be
    // re-uploaded N times). Keep name/mime/size/kind for display; drop the payload.
    for (const m of this.messages) {
      if (m.attachments) {
        for (const a of m.attachments) delete a.dataUrl;
      }
    }

    const isSub = isSubProvider(this.currentProvider);
    const subEntry = this.providersAvailable.find((p) => p.name === this.currentProvider);

    // Inject the current project path into the system prompt on every
    // turn. Without this, the model has to spend a `get_current_project`
    // tool-call (and the user's tokens) just to know where it is —
    // worse, models that don't reliably call tools first sometimes
    // hallucinate paths from earlier projects. The block is rebuilt
    // per-turn so switching projects mid-chat just works.
    const projectPath =
      window.currentProjectPath || window.currentOpenProjectPath || null;
    const spfPath = window.ProjectStore?.getSpfPath?.() || null;
    // Project memories ride along in the same block. Read per turn rather than
    // cached: a memory written during THIS turn has to be visible on the next
    // one, and a cache keyed on anything less than the turn would go stale
    // exactly when it matters. They are a handful of small files.
    let memories = [];
    try {
      const r = await window.AuroraAPI?.project?.listMemories?.();
      if (r?.ok) memories = r.data?.memories || [];
    } catch (e) {
      console.warn('[ai] could not load project memories:', e);  // never block a turn over this
    }
    const systemPrompt = SYSTEM_PROMPT + buildProjectContext(projectPath, spfPath, memories);

    try {
      const r = await window.aiAPI.startChat({
        sessionId: this.currentSessionId,
        conversationId: this.currentChatId,
        provider: this.currentProvider,
        modelId: isSub ? (subEntry?.model || 'default') : undefined,
        messages: apiMessages,
        system: systemPrompt,
        // Shared effort selection — sent to any bridge that declares
        // hasEffort (Claude Code --effort; Codex -c model_reasoning_effort).
        effort: SUB_META[this.currentProvider]?.hasEffort ? this.claudeCodeEffort : undefined,
        permission: this.permissionMode,
      });
      if (r && r.ok === false) this.failTurn(r.error || 'Failed to start chat');
    } catch (e) {
      this.failTurn(e?.message || String(e));
    }
  }

  /* ---------------- autonomous turns (Phase E) ---------------- */

  /**
   * Start a turn the assistant triggered itself (not the user) — e.g. a
   * background task finished and the model should report back. `content` is
   * the synthetic user message handed to the model; a subtle "↻" note marks
   * the turn in the stream so the user sees why it appeared.
   *
   * If a turn is already streaming, the request is queued and drained when
   * that turn ends (see setStreaming → _drainAutoQueue). A safety cap stops
   * runaway self-chaining.
   */
  autoContinue(content, { label = 'Autonomous follow-up' } = {}) {
    if (!content || !this.currentProvider || !this.currentChatId) return;
    if (!this._autoQueue) this._autoQueue = [];
    this._autoQueue.push({ content, label });
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
    const { content, label } = this._autoQueue.shift();
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
    this._dispatchTurn();
  }

  /**
   * Kick off a long task in the background and return immediately, so the
   * current turn can end. When the task finishes, the assistant auto-continues
   * with the result (autoContinue). Backs window.AuroraAPI.ai.runInBackground.
   *
   * @param {{task:'compile_all'|'compile_step', step?:string, note?:string}} p
   * @returns {{ok:boolean, data?:object, error?:string}}
   */
  runInBackground({ task, step, note } = {}) {
    const api = window.AuroraAPI;
    if (!api || !api.compile) return { ok: false, error: 'AuroraAPI.compile unavailable' };
    let job;
    if (task === 'compile_all') job = api.compile.compileAll();
    else if (task === 'compile_step') {
      if (!step) return { ok: false, error: 'compile_step requires a step' };
      job = api.compile.compileStep(step);
    } else {
      return { ok: false, error: `unknown background task: ${task}` };
    }

    const taskId = `bg-${Date.now().toString(36)}`;
    const label = task === 'compile_step' ? `compile ${step}` : 'compile all';
    // Pin the conversation this task belongs to — if the user switches chats
    // before it finishes, we must NOT inject the follow-up into the new one.
    const originChatId = this.currentChatId;
    this._renderBgTask(taskId, `Running ${label} in the background…`, 'running');

    const stillSameChat = () => this.currentChatId === originChatId;

    Promise.resolve(job).then(async (res) => {
      const okJob = !(res && res.ok === false);
      if (!stillSameChat()) return;   // user moved on — drop the auto-continue
      // Pull the compiler terminals for context so the follow-up turn can
      // actually report what happened.
      let terminals = '';
      try {
        const t = await api.terminal?.getAll?.();
        if (t && t.ok && t.data) terminals = JSON.stringify(t.data).slice(0, 4000);
      } catch (_) { /* terminals are best-effort context */ }
      this._renderBgTask(taskId, `${label} ${okJob ? 'finished' : 'failed'}`, okJob ? 'done' : 'failed');
      const status = okJob ? 'completed' : `failed: ${res?.error?.message || res?.error || 'unknown error'}`;
      this.autoContinue(
        `[AUTONOMOUS BACKGROUND TASK] "${label}" (${taskId}) ${status}.\n\n` +
        (note ? `Original intent: ${note}\n\n` : '') +
        `Relevant terminal output (truncated):\n${terminals || '(none captured)'}\n\n` +
        `Summarise the outcome for the user concisely, and decide whether any follow-up action is warranted.`,
        { label: `Background task: ${label} ${okJob ? 'finished' : 'failed'}` },
      );
    }).catch((e) => {
      if (!stillSameChat()) return;
      this._renderBgTask(taskId, `${label} errored`, 'failed');
      this.autoContinue(
        `[AUTONOMOUS BACKGROUND TASK] "${label}" (${taskId}) threw: ${e?.message || e}. Report this to the user.`,
        { label: `Background task: ${label} errored` },
      );
    });

    return { ok: true, data: { taskId, status: 'started', task: label } };
  }

  /** Render (or update) the inline status chip for a background task. */
  _renderBgTask(taskId, text, state) {
    let el = this.messagesEl.querySelector(`.ai-bgtask[data-task-id="${taskId}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'ai-bgtask';
      el.dataset.taskId = taskId;
      el.innerHTML = '<i class="ph ai-bgtask-icon" aria-hidden="true"></i><span class="ai-bgtask-text"></span>';
      this.messagesEl.appendChild(el);
    }
    el.classList.remove('running', 'done', 'failed');
    el.classList.add(state);
    const icon = el.querySelector('.ai-bgtask-icon');
    if (icon) icon.className = `ph ai-bgtask-icon ${state === 'done' ? 'ph-check-circle' : state === 'failed' ? 'ph-x-circle' : 'ph-circle-notch ai-tool-spin'}`;
    el.querySelector('.ai-bgtask-text').textContent = text;
    this.scrollToBottom();
  }

  async stop() {
    if (!this.currentSessionId || !window.aiAPI) return;
    // An explicit stop cancels pending follow-ups too — otherwise the queue
    // would auto-drain (dispatch the next) the moment the abort lands.
    this._messageQueue = [];
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
      // Never reap while a human is mid-answer on an ask/confirm card — those
      // are open for as long as the user takes.
      if (this.pendingAskUserQuestions && this.pendingAskUserQuestions.size) return;
      if (this.pendingConfirms && this.pendingConfirms.size) return;
      // A running tool chip normally blocks recovery (a real tool can take
      // minutes), but only up to the hard ceiling — past that the chip is stuck
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
   * Self-heal a turn that went silent with nothing pending — the "a conversa
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
        // transient status — never persisted into the conversation.
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
        break;
      case 'finish':
        this._clearCliDownload();
        this.showThinking(false);
        this.commitTurn();
        this.applyUsage(ev.usage);
        // `more` = a follow-up the user pushed mid-turn is already queued inside
        // the CLI and answers next, in this same session. Seal this segment but
        // stay streaming: ending the turn here would drain the renderer queue on
        // top of the CLI's own, double-dispatching, and would flip the composer
        // back to Send while the model is still working.
        if (ev.more) {
          this._startNextSegment();
          this.showThinking(true);
          break;
        }
        this.setStreaming(false);
        // Pull the CLI's authoritative usage snapshot at the END of every
        // turn (not just when the model popover happens to be open) so the
        // Subscription usage bars and plan limits reflect reality the next
        // time the user looks — this is what fixes "usage never updates".
        if (isSubProvider(this.currentProvider)) this.refreshSubUsage();
        break;
      case 'aborted':
        this._clearCliDownload();
        this.showThinking(false);
        this.commitTurn();
        this.setStreaming(false);
        if (isSubProvider(this.currentProvider)) this.refreshSubUsage();
        break;
      case 'error':
        this._clearCliDownload();
        this.failTurn(ev.message || 'Unknown error');
        break;
    }
  }

  /* ---------------- streaming text segments ---------------- */

  appendDelta(delta) {
    if (!delta) return;
    // Text resuming after a run of tools closes that batch (tidy summary).
    this._closeToolGroup();
    // Wait-then-reveal: accumulate the segment silently with the thinking
    // indicator up. The segment is rendered ONCE — with syntax highlight and a
    // quick fade-in cascade — when it completes (at a tool call or at finish).
    // Re-rendering markdown per token looked janky and left code blocks
    // unhighlighted until the very end.
    this.segmentBuffer += delta;
    this.turnText += delta;
    this.showThinking(true);
  }

  /**
   * Render the accumulated segment in full, once: strip tool-call artefacts,
   * render markdown, syntax-highlight code, then play a quick staggered fade-in
   * on the blocks. Called at each segment boundary (tool call / finish), so the
   * user waits with the thinking dots and then the answer flows in cleanly.
   */
  _revealSegment() {
    const buf = this.segmentBuffer || '';
    const displayText = (mayHaveToolArtifacts(buf) ? stripToolCallArtifacts(buf) : buf).trim();

    if (!displayText) {
      // Pure tool-call artifact / whitespace — never leave an empty bubble.
      if (this.currentAssistantContentEl) {
        this.currentAssistantContentEl.closest('.ai-message')?.remove();
        this.currentAssistantContentEl = null;
      }
      return;
    }

    this.showThinking(false);
    if (!this.currentAssistantContentEl) {
      const bubble = this.appendBubble('assistant', '');
      this.currentAssistantContentEl = bubble.querySelector('.ai-msg-content');
    }
    this.currentAssistantContentEl.innerHTML = renderMarkdown(displayText);
    highlightCodeBlocks(this.currentAssistantContentEl);
    linkifyFileRefs(this.currentAssistantContentEl);
    this._applyRevealCascade(this.currentAssistantContentEl);
    this.scrollToBottom();
  }

  /** Quick staggered fade-in over the rendered blocks of a revealed segment. */
  _applyRevealCascade(el) {
    if (!el) return;
    const kids = Array.from(el.children);
    kids.forEach((k, i) => {
      k.classList.add('ai-reveal-block');
      k.style.animationDelay = `${Math.min(i * 45, 360)}ms`;
    });
  }

  /** Queue a streaming re-render on the next frame (idempotent per frame). */
  _scheduleStreamRender() {
    if (this._streamRenderRaf) return;
    this._streamRenderRaf = requestAnimationFrame(() => {
      this._streamRenderRaf = null;
      this._renderStreamingBubble();
    });
  }

  /** Render the accumulated stream buffer with the fade-reveal suffix. */
  _renderStreamingBubble() {
    // Strip tool-call artefacts that some models (Llama/Qwen) emit as inline
    // text (see tool_call_text.js). mayHaveToolArtifacts skips the three
    // full-buffer scans on the common case (no markers — Claude & most models),
    // so a long well-behaved response pays nothing; result is identical.
    const buf = this.segmentBuffer;
    const displayText = (mayHaveToolArtifacts(buf) ? stripToolCallArtifacts(buf) : buf).trim();
    // If stripping removes everything and the buffer looks like a tool-call
    // JSON being streamed token-by-token, render empty rather than flashing
    // raw JSON at the user (the tool chip will appear shortly).
    const looksLikeToolArtifact = !displayText &&
      /^\s*[⺀-鿿]*\s*\{/.test(this.segmentBuffer) &&
      /"name"\s*:/.test(this.segmentBuffer);
    // Use the cleaned + trimmed text only. The old `|| this.segmentBuffer`
    // fallback meant a segment that trimmed to empty (whitespace, or a fully
    // stripped tool-call artifact) still rendered the raw buffer — creating an
    // empty assistant bubble whose top/bottom borders showed as a pair of
    // faint hairlines ("várias linhas" between real answers). With displayText
    // alone, such segments yield '' and the block below drops the bubble.
    // Real prose (even containing "<" or "{") always survives in displayText.
    const sourceText = looksLikeToolArtifact ? '' : displayText;

    if (!sourceText) {
      // Nothing visible yet (segment is pure tool-call artifact / whitespace,
      // or it just stripped down to empty as a streamed <tool_call> block
      // completed). Drop any bubble we optimistically created so no empty
      // "Aurora Intelligence" bar is left behind; the tool chip carries the
      // information instead.
      if (this.currentAssistantContentEl) {
        this.currentAssistantContentEl.closest('.ai-message')?.remove();
        this.currentAssistantContentEl = null;
        this._revealLength = 0;
      }
      return;
    }

    // Real text is about to render — retire the "thinking…" dots NOW (not on
    // the first raw delta in handleChatEvent), so the dots stay on screen
    // continuously until the first words appear, with no blank gap between.
    this.showThinking(false);

    // Create the segment bubble lazily — now that there is real text to show.
    if (!this.currentAssistantContentEl) {
      const bubble = this.appendBubble('assistant', '');
      this.currentAssistantContentEl = bubble.querySelector('.ai-msg-content');
    }

    // Fade reveal: re-render the bubble, then wrap any characters that
    // weren't visible last frame in <span.ai-fade-reveal> so they animate
    // from soft purple → normal. We mark the boundary in the source text
    // BEFORE markdown rendering so the span surrounds whole tokens, not
    // partial HTML tags.
    // Typewriter reveal: advance a cursor toward the buffered text a fraction at
    // a time, so a large provider chunk (CLI bridges deliver big blocks) flows
    // in smoothly instead of dumping all at once. _revealLength doubles as the
    // cursor (chars shown so far); the fade animates the slice revealed this
    // frame. On finish, _streamFlush forces the whole thing to show at once.
    const prevShown = Math.min(this._revealLength || 0, sourceText.length);
    let shown;
    if (this._streamFlush || prevShown >= sourceText.length) {
      shown = sourceText.length;
    } else {
      const gap = sourceText.length - prevShown;
      shown = Math.min(sourceText.length, prevShown + Math.max(2, Math.ceil(gap * 0.16)));
    }
    this._streamFlush = false;
    this.currentAssistantContentEl.innerHTML = this._renderWithReveal(sourceText.slice(0, shown), prevShown);
    this._revealLength = shown;
    this.scrollToBottom();
    // Keep revealing the buffered tail on the next frames even if no new delta
    // arrives, until the cursor catches up to everything received so far.
    if (shown < sourceText.length) this._scheduleStreamRender();
  }

  /**
   * Render markdown with a fade-reveal span around the suffix that begins
   * at `revealOffset`. The marker is dropped into the source text via a
   * PUA sentinel pair so it survives escapeHtml() and renderMarkdown's
   * paragraph/list splitting; afterwards we swap the sentinels for the
   * real <span class="ai-fade-reveal"> tags.
   */
  _renderWithReveal(text, revealOffset) {
    if (!text) return '';
    if (revealOffset <= 0 || revealOffset >= text.length) return renderMarkdown(text);
    // Use a sentinel that's safe across markdown rules (paragraphs,
    // lists, code-fences …). PUA U+E040/U+E041 stay literal everywhere.
    const OPEN  = 'AI_REVEAL_OPEN';
    const CLOSE = 'AI_REVEAL_CLOSE';
    const head = text.slice(0, revealOffset);
    const tail = text.slice(revealOffset);
    // Don't slice through a code fence — if the head ends inside an open
    // ```, drop the reveal so we don't poison the highlighter. Renders
    // without animation in that case; the next delta re-tries.
    const openFences = (head.match(/```/g) || []).length;
    if (openFences % 2 !== 0) return renderMarkdown(text);
    const marked = `${head}${OPEN}${tail}${CLOSE}`;
    let html = renderMarkdown(marked);
    // The sentinels survived rendering — convert to real spans, and
    // accept stray openings that happen to land inside attributes by
    // simply stripping any unmatched pair.
    html = html.split(OPEN).join('<span class="ai-fade-reveal">');
    html = html.split(CLOSE).join('</span>');
    return html;
  }

  commitTurn() {
    // Collapse the final tool batch so a finished turn reads clean.
    this._closeToolGroup();
    // Reveal the final segment in full (markdown + syntax highlight + fade
    // cascade). Any in-flight stream-render frame is cancelled first.
    if (this._streamRenderRaf) {
      cancelAnimationFrame(this._streamRenderRaf);
      this._streamRenderRaf = null;
    }
    this._revealSegment();
    // Persist only the FINAL segment (text produced after the last tool call);
    // any earlier segments were already stored at their tool-call boundaries
    // above. Strip XML tool-call artifacts before storing — they confuse models
    // on subsequent turns.
    const cleanText = stripToolCallArtifacts(
      this.turnText.slice(this._committedTurnLen || 0)).trim();
    if (cleanText) {
      this.messages.push({ role: 'assistant', content: cleanText });
    }
    if (this.currentAssistantContentEl) {
      highlightCodeBlocks(this.currentAssistantContentEl);
      linkifyFileRefs(this.currentAssistantContentEl);
    }

    // If the model called tools but never generated a text explanation
    // (common with some Ollama models), show a prompt so the user knows
    // the turn is over and can ask a follow-up.
    if (!cleanText && this.hadToolCalls) {
      this.appendBubble('assistant', '_All actions completed. Ask a follow-up if you want details._');
    }

    // Backstop: drop any assistant bubble that ended up with no visible
    // content, so a stray empty segment never lingers as the faint pair of
    // top/bottom-border hairlines between real answers.
    this._pruneEmptyBubbles();

    this.resetTurnState();
    // Auto-save the conversation after every turn.
    this.persistCurrentChat();
  }

  /**
   * Remove assistant bubbles whose content is visually empty (no text and no
   * element children — so image/code-only bubbles are preserved). Defensive
   * cleanup against empty "hairline" bars; the lazy creation in
   * _renderStreamingBubble already avoids creating them in the common case.
   */
  _pruneEmptyBubbles() {
    if (!this.messagesEl) return;
    for (const content of this.messagesEl.querySelectorAll('.ai-msg-assistant .ai-msg-content')) {
      if (!content.firstElementChild && !content.textContent.trim()) {
        content.closest('.ai-message')?.remove();
      }
    }
  }

  failTurn(message) {
    this.showThinking(false);
    this._closeToolGroup();
    this.appendBubble('assistant', `Error: ${message}`, { error: true });
    // Mark in-flight chips as failed in DOM and persist them — args
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
   * `more` — i.e. the user pushed a follow-up mid-turn and the CLI is about
   * to answer it in the same session.
   *
   * Deliberately NOT resetTurnState(): that one is turn-ENDING teardown. It
   * nulls currentSessionId — and handleChatEvent drops any packet whose
   * sessionId doesn't match, so every event of the follow-up turn would be
   * silently discarded and the panel would sit on the thinking dots forever.
   * It also auto-denies open confirm cards and cancels open question cards,
   * which are perfectly legitimate mid-session. Keep all of that; reset only
   * what draws the next assistant bubble.
   */
  _startNextSegment() {
    if (this._streamRenderRaf) {
      cancelAnimationFrame(this._streamRenderRaf);
      this._streamRenderRaf = null;
    }
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
    // Tear down the CLI-download status row here too — this is the chokepoint
    // every turn-ending path runs through (stop()'s safety net, the stall
    // watchdog, failTurn), so a download interrupted by Stop/stall can't leave
    // an orphaned "Downloading…" row behind.
    this._clearCliDownload();
    if (this._streamRenderRaf) {
      cancelAnimationFrame(this._streamRenderRaf);
      this._streamRenderRaf = null;
    }
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
    // Same for any open Ask-User-Question cards — resolve them as
    // cancelled so the awaiting tool call doesn't hang forever.
    if (this.pendingAskUserQuestions) {
      for (const decide of this.pendingAskUserQuestions) {
        decide({ answer: '[turn aborted before user answered]', selected: [] });
      }
      this.pendingAskUserQuestions.clear();
    }
  }

  /* ---------------- tool chips ---------------- */

  /**
   * A run of consecutive tool calls is wrapped in one collapsible group so a
   * busy turn doesn't flood the chat with chips ("poluído de informações").
   * The group is created lazily on the first chip of a batch; a text segment
   * or the turn ending closes it (and collapses multi-step batches to a tidy
   * "N actions" summary the user can expand).
   */
  /**
   * Build a tool-group shell — `{ el, body, summaryEl }` — with the
   * expand/collapse header wired up. Shared by the live group
   * (_ensureToolGroup) and the static group rebuilt when replaying a saved
   * chat, so both render the identical "N actions" collapsible bubble.
   */
  _createToolGroupEl() {
    const el = document.createElement('div');
    el.className = 'ai-tool-group';
    el.innerHTML = `
      <button class="ai-tool-group-head" type="button" aria-expanded="true">
        <i class="ph ph-caret-down ai-tool-group-caret" aria-hidden="true"></i>
        <i class="ph ph-wrench ai-tool-group-icon" aria-hidden="true"></i>
        <span class="ai-tool-group-summary">Working…</span>
      </button>
      <div class="ai-tool-group-body"></div>`;
    const head = el.querySelector('.ai-tool-group-head');
    head.addEventListener('click', () => {
      const collapsed = el.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
    });
    return {
      el,
      body: el.querySelector('.ai-tool-group-body'),
      summaryEl: el.querySelector('.ai-tool-group-summary'),
    };
  }

  _ensureToolGroup() {
    if (this._toolGroup && this._toolGroup.el.isConnected) return this._toolGroup;
    const parts = this._createToolGroupEl();
    this.messagesEl.appendChild(parts.el);
    this._toolGroup = { ...parts, total: 0 };
    return this._toolGroup;
  }

  /** Human-friendly form of a tool name for the group header (chips keep the
   *  raw mono name). "get_terminal_output" → "get terminal output". */
  _prettyToolName(name) {
    return String(name || 'tool').replace(/_/g, ' ');
  }

  /**
   * Live header. While a chip is spinning it names WHAT is running so the
   * user can see the current action at a glance — "Running get terminal
   * output…" (or "Running N actions…" when several run in parallel). Idle →
   * "N actions".
   */
  _refreshToolGroupSummary() {
    const g = this._toolGroup;
    if (!g) return;
    const running = this.runningChips.filter((c) => g.body.contains(c.el));
    if (running.length === 1) {
      g.summaryEl.textContent = `Running ${this._prettyToolName(running[running.length - 1].toolName)}…`;
    } else if (running.length > 1) {
      g.summaryEl.textContent = `Running ${running.length} actions…`;
    } else {
      g.summaryEl.textContent = `${g.total} action${g.total === 1 ? '' : 's'}`;
    }
  }

  /**
   * Finalise the current batch: swap the wrench for a check and collapse the
   * whole sequence into its own bubble — even a single action — so a finished
   * turn reads as a tidy, modern "N actions" pill the user can expand.
   */
  _closeToolGroup() {
    const g = this._toolGroup;
    if (!g) return;
    this._finalizeToolGroup(g.el, g.summaryEl, g.total);
    this._toolGroup = null;
  }

  /**
   * Collapse a finished tool batch into its tidy "N actions" pill: set the
   * summary, pick a green check or a red cross depending on whether any chip
   * failed/was denied, and collapse it (even a single action). Shared by the
   * live group (_closeToolGroup) and the static group rebuilt on chat replay
   * so both look identical.
   */
  _finalizeToolGroup(el, summaryEl, total) {
    if (summaryEl) summaryEl.textContent = `${total} action${total === 1 ? '' : 's'}`;
    const failed = el.querySelector(
      '.ai-tool-group-body .ai-tool-chip.failed, .ai-tool-group-body .ai-tool-chip.denied',
    );
    const icon = el.querySelector('.ai-tool-group-icon');
    if (icon) icon.className = `ph ${failed ? 'ph-x-circle' : 'ph-check-circle'} ai-tool-group-icon`;
    el.classList.add('done');
    el.classList.toggle('has-failure', !!failed);
    if (total >= 1) {
      el.classList.add('collapsed');
      el.querySelector('.ai-tool-group-head')?.setAttribute('aria-expanded', 'false');
    }
  }

  startToolChip(toolName, args, toolUseId) {
    const name = toolName || 'tool';
    const chip = document.createElement('div');
    chip.className = 'ai-tool-chip running';
    chip.innerHTML = `
      <i class="ph ph-circle-notch ai-tool-spin" aria-hidden="true"></i>
      <span class="ai-tool-name"></span>
      <span class="ai-tool-status">running…</span>
    `;
    chip.querySelector('.ai-tool-name').textContent = name;
    // Args go into the chip's title so users can inspect the inputs
    // by hovering — useful for diagnosing model behaviour without
    // bloating the visible chip. Long args are clipped at 800 chars.
    if (args && Object.keys(args).length) {
      const argText = this._formatArgsForTitle(args);
      if (argText) chip.title = argText;
    }
    const group = this._ensureToolGroup();
    group.body.appendChild(chip);
    group.total += 1;
    this.scrollToBottom();
    this.runningChips.push({ toolUseId: toolUseId || null, toolName: name, args, el: chip });
    this._refreshToolGroupSummary();
  }

  finishToolChip(toolName, result, toolUseId) {
    const name = toolName || 'tool';
    // Prefer matching by toolUseId (carried end-to-end from the
    // provider/CLI) — without it, two parallel calls to the same tool
    // would collide on toolName and one chip would stay spinning
    // forever. Fall back to name-match for legacy events without ids.
    let idx = -1;
    if (toolUseId) {
      idx = this.runningChips.findIndex((c) => c.toolUseId === toolUseId);
    }
    if (idx < 0) {
      idx = this.runningChips.findIndex((c) => c.toolName === name);
    }
    if (idx < 0) {
      // No chip matched (already finished, or an id/name mismatch). Nothing to
      // close — but log it: an unmatched result is how a chip can be left
      // spinning, which the watchdog hard-ceiling now reaps as a backstop.
      console.warn('[ai] tool-result with no matching running chip:', name, toolUseId);
      return;
    }
    const running = this.runningChips.splice(idx, 1)[0];
    const { el, args } = running;
    const ok = !(result && result.ok === false);
    const denied = !ok && /denied/i.test((result && result.error) || '');
    const statusStr = ok ? 'done' : (denied ? 'denied' : 'failed');
    el.classList.remove('running');
    el.classList.add(statusStr);
    const icon = el.querySelector('i');
    const statusEl = el.querySelector('.ai-tool-status');
    if (icon) icon.className = ok ? 'ph ph-check-circle' : (denied ? 'ph ph-prohibit' : 'ph ph-x-circle');
    if (statusEl) statusEl.textContent = statusStr;
    // Tooltip now shows args + result preview together.
    const tooltip = this._formatToolTooltip(args, result);
    if (tooltip) el.title = tooltip;

    // Persist the tool call in the messages array so it survives
    // into the saved chat and can be replayed when history is opened.
    // Args + a result preview are saved so the user can later inspect
    // exactly what each call did even after the model context is gone.
    const entry = {
      role: 'tool',
      toolName: name,
      status: statusStr,
      toolUseId: toolUseId || running.toolUseId || null,
      args: args || null,
      result: this._summariseResult(result),
    };
    if (!ok && result?.error) entry.error = result.error;
    this.messages.push(entry);
    this._refreshToolGroupSummary();
  }

  /** Compact, hover-friendly representation of tool args. */
  _formatArgsForTitle(args) {
    try {
      const s = JSON.stringify(args, null, 2);
      return s.length > 800 ? `${s.slice(0, 800)}…` : s;
    } catch (_) { return ''; }
  }

  /** Hover tooltip showing args and a preview of the result. */
  _formatToolTooltip(args, result) {
    const lines = [];
    if (args && Object.keys(args).length) {
      const a = this._formatArgsForTitle(args);
      if (a) lines.push(`args: ${a}`);
    }
    if (result) {
      const r = this._summariseResult(result);
      if (typeof r === 'string') {
        lines.push(`result: ${r.length > 400 ? r.slice(0, 400) + '…' : r}`);
      } else if (r != null) {
        try {
          const s = JSON.stringify(r);
          lines.push(`result: ${s.length > 400 ? s.slice(0, 400) + '…' : s}`);
        } catch (_) { /* ignore */ }
      }
    }
    return lines.join('\n');
  }

  /** Reduce a tool result to a small JSON-serialisable summary for persistence. */
  _summariseResult(result) {
    if (result == null) return null;
    if (typeof result === 'string') return result.slice(0, 4000);
    if (typeof result !== 'object') return result;
    // Common shapes: { ok, data } from AuroraAPI, { ok, content } from Claude Code.
    const out = {};
    if ('ok' in result) out.ok = !!result.ok;
    if ('error' in result && result.error) out.error = String(result.error).slice(0, 800);
    if ('content' in result && typeof result.content === 'string') {
      out.content = result.content.length > 4000 ? result.content.slice(0, 4000) + '…' : result.content;
    }
    if ('data' in result) {
      try {
        const s = JSON.stringify(result.data);
        out.data = s.length > 4000 ? JSON.parse(s.slice(0, 4000)) : result.data;
      } catch (_) { out.data = '[unserialisable]'; }
    }
    return out;
  }

  /**
   * Builds a completed tool chip with no animation — used when replaying
   * saved conversations from history. The chip shows the final status
   * (done / failed / denied) and a tooltip with args + result. Returns the
   * element so the caller can drop it into the replay's collapsed group.
   */
  appendStaticToolChip(toolName, status, error, args, result) {
    const chip = document.createElement('div');
    chip.className = `ai-tool-chip ${status || 'done'}`;
    const iconClass = status === 'done'   ? 'ph ph-check-circle'
                    : status === 'denied' ? 'ph ph-prohibit'
                                          : 'ph ph-x-circle';
    chip.innerHTML = `
      <i class="${iconClass}" aria-hidden="true"></i>
      <span class="ai-tool-name"></span>
      <span class="ai-tool-status"></span>
    `;
    chip.querySelector('.ai-tool-name').textContent = toolName || 'tool';
    chip.querySelector('.ai-tool-status').textContent = status || 'done';
    const tooltip = this._formatToolTooltip(args, result) ||
                    (error ? `error: ${error}` : '');
    if (tooltip) chip.title = tooltip;
    return chip;
  }

  /* ---------------- thinking indicator ---------------- */

  showThinking(show) {
    if (show && !this.thinkingEl) {
      const words = [
        'Descombobulating', 'Reticulating splines', 'Calibrating flux',
        'Summoning quarks', 'Consulting the oracle', 'Defragmenting neurons',
        'Reverse-engineering vibes', 'Untangling spaghetti', 'Overclocking brain cells',
        'Pondering the imponderables', 'Aligning the qubits', 'Polishing the silicon',
        'Sweet-talking the compiler', 'Negotiating with yanc', 'Routing the nets',
        'Charging the flux capacitor', 'Counting to NUBITS', 'Folding the bitstream',
        'Tuning the oscillators', 'Herding the electrons', 'Waxing the waveforms',
        'Compiling confidence', 'Synthesizing brilliance', 'Asking the rubber duck',
        'Dividing by NUGAIN', 'Probing the testbench', 'Warming up the ALU',
        'Annealing the lattice', 'Sampling the aurora', 'Buffering inspiration',
        'Convincing the linter', 'Greasing the pipeline',
      ];
      const word = words[Math.floor(Math.random() * words.length)];
      const el = document.createElement('div');
      el.className = 'ai-thinking-wrap';
      // The funny word and the three loading dots share one line; the dots
      // read as the trailing ellipsis (so no literal "…" is appended).
      el.innerHTML =
        `<em class="ai-thinking-word">${word}</em>` +
        '<span class="ai-thinking-dots"><span></span><span></span><span></span></span>';
      this.messagesEl.appendChild(el);
      this.scrollToBottom();
      this.thinkingEl = el;
    } else if (!show && this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
    }
  }

  /**
   * Transient status while a subscription CLI is fetched on first use (B12).
   * Reuses the thinking-indicator chrome; display-only, never persisted. The
   * `done` phase (and any turn end) tears it down via _clearCliDownload.
   */
  _renderCliDownload(ev) {
    if (!ev || ev.phase === 'done') {
      this._clearCliDownload();
      if (ev && ev.phase === 'done') {
        // The CLI just finished installing. Bridge the spawn/first-token gap
        // with the thinking indicator so the panel doesn't look frozen right
        // after a long download, and refresh the status row so it flips off
        // "Downloads on first message" to the resolved version/plan.
        this.showThinking(true);
        this.refreshSubStatus?.();
      }
      return;
    }
    this.showThinking(false); // the funny "thinking" word would fight this row
    // Recreate if missing OR detached (a chat switch/clear wipes messagesEl,
    // leaving a stale ref that would otherwise render progress off-DOM).
    if (!this.cliDownloadEl || !this.cliDownloadEl.isConnected) {
      const el = document.createElement('div');
      el.className = 'ai-thinking-wrap ai-cli-download';
      this.messagesEl.appendChild(el);
      this.cliDownloadEl = el;
    }
    const cli = ev.cli || 'AI CLI';
    let label;
    if (ev.phase === 'verify') label = `Verifying ${cli}…`;
    else if (ev.phase === 'extract') label = `Installing ${cli}…`;
    else {
      const mb = (n) => (Number(n || 0) / 1e6).toFixed(0);
      const size = ev.total > 0 ? ` · ${mb(ev.received)}/${mb(ev.total)} MB` : '';
      label = `Downloading ${cli} (first use)… ${ev.pct || 0}%${size}`;
    }
    this.cliDownloadEl.innerHTML =
      `<em class="ai-thinking-word">${escapeHtml(label)}</em>` +
      '<span class="ai-thinking-dots"><span></span><span></span><span></span></span>';
    this.scrollToBottom();
  }

  _clearCliDownload() {
    if (this.cliDownloadEl) {
      this.cliDownloadEl.remove();
      this.cliDownloadEl = null;
    }
  }

  applyUsage(usage) {
    if (!usage) return;
    // Vercel AI SDK v6 surfaces `totalTokens` (sometimes `inputTokens`
    // + `outputTokens`). Be defensive about both shapes.
    const total = usage.totalTokens ??
      ((usage.inputTokens ?? usage.promptTokens ?? 0) +
       (usage.outputTokens ?? usage.completionTokens ?? 0));
    if (total > 0) {
      this.cumulativeTokens += total;
      this.updateTokenCounter();
    }
  }

  /** Refresh the compact composer token pill and (if open) the usage bars. */
  updateTokenCounter() {
    this.tokenCounter.textContent = formatTokens(this.cumulativeTokens);
    this.tokenCounter.title = `${this.cumulativeTokens.toLocaleString()} tokens this conversation`;
    // Refresh the usage section live for any subscription provider whose
    // popover is open — the per-turn `applyUsage()` may have ticked the
    // CLI-reported session counter forward.
    if (isSubProvider(this.currentProvider) && this.modelPopoverOpen) {
      this.refreshSubUsage();
    }
  }

  /** Grow the textarea to fit its content (up to ~10 lines, then scroll). */
  autoGrowInput() {
    const el = this.inputEl;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
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
      // A turn just ended — dispatch a queued USER follow-up first (explicit
      // intent), else an autonomous one.
      if (!this._drainMessageQueue()) this._drainAutoQueue();
    }
  }

  /* ---------------- bubbles / clear ---------------- */

  appendBubble(role, content, { error = false } = {}) {
    if (this.chatEmptyHint) this.chatEmptyHint.classList.add('hidden');
    const el = document.createElement('div');
    el.className = `ai-message ai-msg-${role}${error ? ' error' : ''}`;
    const label = role === 'user' ? 'You' : 'Aurora Intelligence';
    // Collapse the role label across a run of consecutive assistant bubbles.
    // A single turn streams as several segments split by tool calls, and a
    // background-task chain adds more — labelling every one produced the wall
    // of repeated "AURORA INTELLIGENCE" headers. Show it once per assistant
    // group; user messages, dividers and background-task chips reset the run
    // (they clear _lastMsgRole) so the label reappears for the next section.
    const showLabel = !(role === 'assistant' && this._lastMsgRole === 'assistant');
    el.innerHTML = `
      ${showLabel ? `<div class="ai-msg-role">${label}</div>` : ''}
      <div class="ai-msg-content"></div>
    `;
    const contentEl = el.querySelector('.ai-msg-content');
    if (content) {
      // Render markdown for BOTH roles. The user's own message goes through the
      // same safe (HTML-escaped) renderer, so a fenced ```code``` block they
      // paste shows as a real, syntax-highlighted code block — and inline
      // `code`/file paths render — instead of raw backticks. Parity with the
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
   * Inline log divider — a hairline with centered text, in the style of
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
    // A divider is a visual section break — let the next assistant bubble
    // re-show its label.
    this._lastMsgRole = null;
    this.scrollToBottom();
    return el;
  }

  /**
   * Start a fresh chat. Saves the current one first so it remains in
   * the history sidebar, then clears every piece of in-memory state.
   * Replaces the old `clearChat` — the button at the header now
   * carries a "+" icon and is wired here.
   */
  async newChat() {
    if (this.currentSessionId) return;        // never switch mid-stream
    await this.persistCurrentChat();
    this.messages = [];
    this.messagesEl.innerHTML = '';
    this._lastMsgRole = null;
    if (this.chatEmptyHint) {
      this.messagesEl.appendChild(this.chatEmptyHint);
      this.chatEmptyHint.classList.remove('hidden');
    }
    this.cumulativeTokens = 0;
    this.updateTokenCounter();
    this.runningChips = [];
    this._toolGroup = null;
    this._autoQueue = [];
    this._autoChainCount = 0;
    this._messageQueue = [];
    this._renderQueue();
    this.thinkingEl = null;
    this.currentChatId = null;
    this.currentChatTitle = '';
    this.currentChatCreatedAt = 0;
    this.refreshChatList();
  }

  /* ---------------- chat history ---------------- */

  toggleHistory(force) {
    const open = force === undefined ? !this.historyOpen : force;
    this.historyOpen = open;
    this.historyPopover.classList.toggle('hidden', !open);
    this.historyBtn.classList.toggle('active', open);
    if (open) this.refreshChatList();
  }

  async refreshChatList() {
    if (window.aiAPI?.listConversations) {
      try {
        const r = await window.aiAPI.listConversations();
        this.chatList = r?.chats || [];
      } catch (_) { this.chatList = []; }
    }
    this.renderChatList();
  }

  renderChatList() {
    if (!this.historyList) return;
    // Pure list markup in chat_history.js; this method owns the popover element.
    this.historyList.innerHTML = chatListHtml(this.chatList, this.currentChatId);
  }

  async handleHistoryClick(e) {
    const item = e.target.closest('.ai-history-item');
    if (!item) return;
    const id = item.dataset.chatId;
    const actBtn = e.target.closest('[data-action]');
    if (actBtn) {
      e.stopPropagation();
      if (actBtn.dataset.action === 'delete') {
        const yes = await showConfirm('Delete chat?', 'This conversation will be deleted permanently.', {
          variant: 'warning', confirmLabel: 'Delete', danger: true,
        });
        if (yes) await this.deleteChat(id);
      } else if (actBtn.dataset.action === 'rename') {
        this.renameChatInline(item, id);
      }
      return;
    }
    // Anywhere else on the row: open the chat.
    this.toggleHistory(false);
    this.loadChat(id);
  }

  renameChatInline(itemEl, id) {
    const titleEl = itemEl.querySelector('.ai-history-item-title');
    if (!titleEl) return;
    const oldTitle = titleEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ai-history-item-rename';
    input.value = oldTitle;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    const finish = async (commit) => {
      const newTitle = input.value.trim() || oldTitle;
      const span = document.createElement('span');
      span.className = 'ai-history-item-title';
      span.textContent = newTitle;
      if (input.parentNode) input.replaceWith(span);
      if (commit && newTitle !== oldTitle) {
        try { await window.aiAPI.renameConversation(id, newTitle); }
        catch (_) { /* the list refresh below will reveal a failure */ }
        if (id === this.currentChatId) this.currentChatTitle = newTitle;
        this.refreshChatList();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  async deleteChat(id) {
    // Smoothly animate the deleted card out instead of a full re-render — the
    // History popover stays open the whole time. We drop the row from the
    // in-memory list (and DOM) locally rather than calling refreshChatList(),
    // which would re-fetch and rebuild the whole list (the abrupt snap).
    const cardEl = this.historyList
      ? Array.from(this.historyList.querySelectorAll('.ai-history-item'))
          .find((n) => n.dataset.chatId === id)
      : null;

    const dropFromList = () => {
      this.chatList = (this.chatList || []).filter((c) => c.id !== id);
      if (this.historyList && !this.chatList.length) {
        this.historyList.innerHTML = '<p class="ai-history-empty">No saved chats yet.</p>';
      }
    };

    if (cardEl) this._animateHistoryItemOut(cardEl, dropFromList);
    else dropFromList();

    try { await window.aiAPI.deleteConversation(id); }
    catch (_) { /* the card is already animating out; a later open reveals failure */ }

    if (id === this.currentChatId) {
      // The visible chat was deleted — reset to a fresh state.
      this.currentChatId = null;
      this.currentChatTitle = '';
      this.currentChatCreatedAt = 0;
      this.messages = [];
      this.messagesEl.innerHTML = '';
      if (this.chatEmptyHint) {
        this.messagesEl.appendChild(this.chatEmptyHint);
        this.chatEmptyHint.classList.remove('hidden');
      }
      this.cumulativeTokens = 0;
      this.updateTokenCounter();
    }
  }

  /**
   * Collapse + fade a history row out, then remove it from the DOM and run
   * `onDone`. Pins an explicit pixel height first so the CSS `height: 0`
   * transition actually animates (you can't transition from `auto`).
   */
  _animateHistoryItemOut(el, onDone) {
    el.style.height = el.offsetHeight + 'px';
    void el.offsetHeight; // commit the start height before collapsing
    el.classList.add('removing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.remove();
      if (typeof onDone === 'function') onDone();
    };
    el.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'height' || e.propertyName === 'opacity') finish();
    });
    setTimeout(finish, 450); // fallback if transitionend never fires
  }

  async loadChat(id) {
    if (this.currentSessionId) return;        // never switch mid-stream
    if (id === this.currentChatId) return;
    await this.persistCurrentChat();

    let chat;
    try { chat = await window.aiAPI.readConversation(id); }
    catch (_) { chat = null; }
    if (!chat) return;

    this.currentChatId = chat.id;
    this.currentChatTitle = chat.title || 'Untitled';
    this.currentChatCreatedAt = chat.createdAt || Date.now();
    this.messages = Array.isArray(chat.messages) ? chat.messages.slice() : [];
    this.cumulativeTokens = Number(chat.cumulativeTokens) || 0;
    this.updateTokenCounter();

    // Switch provider if the saved chat used a different one (and it's
    // still available). Falls back silently if not.
    if (chat.provider && chat.provider !== this.currentProvider) {
      if (this.providersConfigured && this.providersConfigured[chat.provider]) {
        this.currentProvider = chat.provider;
        this.applyProviderState();
        const radio = this.mpProviders.querySelector(`input[name="ai-provider"][value="${chat.provider}"]`);
        if (radio) radio.checked = true;
      }
    }

    // Replay every message into the bubble stream.
    this.messagesEl.innerHTML = '';
    this._lastMsgRole = null;
    if (this.chatEmptyHint) this.messagesEl.appendChild(this.chatEmptyHint);
    if (this.chatEmptyHint) this.chatEmptyHint.classList.toggle('hidden', this.messages.length > 0);
    // Consecutive tool calls are rebuilt into one collapsed "N actions"
    // group, matching the live look so a reopened chat reads the same way.
    let staticGroup = null;
    const closeStaticGroup = () => {
      if (!staticGroup) return;
      this._finalizeToolGroup(staticGroup.el, staticGroup.summaryEl, staticGroup.total);
      staticGroup = null;
    };
    for (const msg of this.messages) {
      if (!msg || !msg.role) continue;
      if (msg.role === 'tool') {
        if (!staticGroup) {
          staticGroup = this._createToolGroupEl();
          staticGroup.total = 0;
          this.messagesEl.appendChild(staticGroup.el);
        }
        staticGroup.body.appendChild(
          this.appendStaticToolChip(msg.toolName, msg.status, msg.error, msg.args, msg.result),
        );
        staticGroup.total += 1;
      } else if (msg.role === 'question') {
        // A question record has no `content`, so without this branch the
        // `typeof msg.content === 'string'` test below drops it silently.
        closeStaticGroup();
        this.messagesEl.appendChild(this._renderQuestionRecord(msg));
      } else if (typeof msg.content === 'string') {
        closeStaticGroup();
        const bubble = this.appendBubble(msg.role, msg.content);
        // Restore the attachment chips (name/ext only — the payload was dropped)
        // so a reopened message reads with context, not as an empty bubble.
        if (Array.isArray(msg.attachments) && msg.attachments.length) {
          this._renderBubbleAttachments(bubble, msg.attachments);
        }
      }
    }
    closeStaticGroup();
    highlightCodeBlocks(this.messagesEl);
    this.refreshChatList();
  }

  async persistCurrentChat() {
    if (!this.currentChatId || !this.messages.length || !window.aiAPI?.saveConversation) return;
    const providerInfo = (this.providersAvailable || []).find((p) => p.name === this.currentProvider);
    try {
      await window.aiAPI.saveConversation({
        id: this.currentChatId,
        title: this.currentChatTitle || 'Untitled',
        provider: this.currentProvider,
        model: providerInfo ? providerInfo.model : null,
        createdAt: this.currentChatCreatedAt || Date.now(),
        // Pure message-shaping (tool breadcrumb + lightweight attachment meta,
        // payload dropped) lives in chat_history.js.
        messages: serializeMessagesForStorage(this.messages),
        cumulativeTokens: this.cumulativeTokens,
      });
    } catch (e) { console.warn('[ai-panel] persist failed:', e); }
    this.refreshChatList();
  }

  /* ---------------- resize ---------------- */

  /**
   * A largura que o painel PODE ter, dado o que ele pediu.
   *
   * Esta e a autoridade unica, e ela existir e o conserto. A regra morava
   * dentro do arrasto, entao so o arrasto a respeitava: reabrir o painel
   * restaurava a largura salva com um piso e nenhum teto, e redimensionar a
   * janela nao reavaliava nada. Bastava salvar a largura numa janela larga e
   * abrir numa estreita para o painel voltar a comer o terminal.
   *
   * O teto nao e uma fracao da janela: e o que sobra depois da arvore de
   * arquivos e do minimo que o editor precisa. Calcular sobre `innerWidth`
   * deixava o painel crescer por cima do editor, que tem `min-width: 0` e por
   * isso era espremido ate zero, parecendo sobreposicao.
   *
   * @param {number} desejado
   * @returns {number} 0 quando colapsa, senao entre o minimo e o teto
   */
  _larguraPermitida(desejado) {
    const tree = document.querySelector('.file-tree-container');
    // A faixa disputada e a do .main-container, e nao a janela: os tres paineis
    // dividem ELE. Hoje os dois batem, mas medir a janela sempre foi a medida
    // errada da coisa certa, e qualquer coluna que apareca ao lado passaria a
    // mentir o espaco disponivel.
    const faixa = document.querySelector('.main-container');
    return resolvePaneSize(desejado, {
      min: PANE.MIN_AI,
      collapseAt: PANE.COLLAPSE_AI,
      max: maxLateralWidth(
        faixa ? faixa.clientWidth : window.innerWidth,
        tree ? tree.offsetWidth : 0, PANE.MIN_EDITOR, PANE.MIN_AI,
      ),
    });
  }

  /**
   * Reaplica o limite a largura atual. Chamado quando a janela muda de tamanho:
   * uma largura legitima numa janela grande passa a invadir o editor numa
   * janela menor, e sem isto ninguem percebia.
   */
  reclampWidth() {
    const c = this.container;
    if (!c || !c.classList.contains('open')) return;
    const atual = parseInt(document.defaultView.getComputedStyle(c).width, 10);
    if (!Number.isFinite(atual) || atual <= 0) return;
    const permitida = this._larguraPermitida(atual);
    if (permitida === atual) return;
    c.style.width = permitida + 'px';
    c.classList.toggle('is-collapsed', permitida === 0);
  }

  setupResize(handle, container) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      let active = true;
      let raf = null;
      const startX = e.clientX;
      const startWidth = parseInt(document.defaultView.getComputedStyle(container).width, 10);

      document.body.classList.add('resizing-vertical');

      const onMove = (ev) => {
        if (!active) return;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const newWidth = this._larguraPermitida(startWidth + (startX - ev.clientX));
          container.style.width = newWidth + 'px';
          container.classList.toggle('is-collapsed', newWidth === 0);
        });
      };

      const onUp = () => {
        active = false;
        document.body.classList.remove('resizing-vertical');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (raf) cancelAnimationFrame(raf);
        try {
          const w = parseInt(container.style.width, 10);
          if (w >= 320) localStorage.setItem('aurora-ai-panel-width', String(w));
        } catch (_) { /* ignore */ }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /**
   * Corner handle at the junction where the AI panel's LEFT edge meets the
   * terminal's TOP edge — the right-side mirror of the file-tree↔terminal
   * corner in resize.js. Dragging it resizes the AI panel width and the
   * terminal height at once. Only live while the panel is open.
   */
  setupTerminalCorner() {
    const aiContainer = this.container;
    const terminalContainer = document.querySelector('.terminal-container');
    if (!aiContainer || !terminalContainer) return;

    const corner = document.createElement('div');
    corner.id = 'ai-terminal-corner-handle';
    // Generous invisible hit area; visual cue comes from the resizers it sits
    // on. Sits above the width-only handle so the junction grabs both axes.
    Object.assign(corner.style, {
      position: 'fixed', width: '22px', height: '22px',
      background: 'transparent', cursor: 'all-scroll', zIndex: '100',
      display: 'none',
    });
    document.body.appendChild(corner);

    // Hover discovery: lighting up BOTH the AI width handle and the terminal's
    // horizontal resizer is the cue the junction is grabbable — exactly the
    // file-tree↔terminal corner's behaviour (see styles.css / ai_assistant.css).
    corner.addEventListener('mouseenter', () => {
      if (isOpen()) document.body.classList.add('ai-corner-hovering');
    });
    corner.addEventListener('mouseleave', () => {
      document.body.classList.remove('ai-corner-hovering');
    });

    // Este canto tinha a PROPRIA copia da regra de largura, com o antigo
    // `innerWidth * 0.7`, que nao descontava a arvore nem reservava espaco para
    // o editor. Como ele fica por cima do divisor de largura no encontro com o
    // terminal, era ele que a mao pegava, e por isso o painel continuava
    // invadindo mesmo depois de o outro caminho ter sido corrigido. Duas copias
    // da mesma regra e uma delas errada: agora ha uma so, _larguraPermitida.
    const isOpen = () => parseInt(aiContainer.style.width, 10) > 0;

    let posRaf = null, lastL = null, lastT = null;
    const position = () => {
      if (!isOpen()) { corner.style.display = 'none'; lastL = lastT = null; return; }
      const aiRect = aiContainer.getBoundingClientRect();
      const termRect = terminalContainer.getBoundingClientRect();
      const half = (corner.offsetWidth || 22) / 2;
      const left = aiRect.left - half;   // AI panel's left edge
      const top  = termRect.top  - half; // terminal's top edge
      if (left === lastL && top === lastT && corner.style.display === 'block') return;
      lastL = left; lastT = top;
      corner.style.left = left + 'px';
      corner.style.top  = top + 'px';
      corner.style.display = 'block';
    };
    const schedulePosition = () => {
      if (posRaf) return;
      posRaf = requestAnimationFrame(() => { posRaf = null; position(); });
    };

    let active = false, startX = 0, startY = 0, startW = 0, startH = 0, dragRaf = null;
    corner.addEventListener('mousedown', (e) => {
      if (!isOpen()) return;
      e.preventDefault();
      active = true;
      startX = e.clientX; startY = e.clientY;
      startW = aiContainer.offsetWidth;
      startH = terminalContainer.offsetHeight;
      // Dedicated class (not the file-tree's resizing-vertical/corner) so the
      // far-left file-tree resizers don't light up when dragging on the right.
      // The CSS for it suspends both panels' transitions, sets the all-scroll
      // cursor, and lights the AI handle + terminal resizer (ai_assistant.css).
      document.body.classList.add('resizing-ai-corner');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    const onMove = (e) => {
      if (!active) return;
      if (dragRaf) cancelAnimationFrame(dragRaf);
      dragRaf = requestAnimationFrame(() => {
        // AI panel is on the right: dragging left (smaller X) grows it.
        const w = this._larguraPermitida(startW + (startX - e.clientX));
        const h = constrainTerminalHeight(startH - (e.clientY - startY));
        aiContainer.style.width = w + 'px';
        aiContainer.classList.toggle('is-collapsed', w === 0);
        terminalContainer.style.height = h + 'px';
        position();
      });
    };

    const onUp = () => {
      if (!active) return;
      active = false;
      document.body.classList.remove('resizing-ai-corner');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (dragRaf) cancelAnimationFrame(dragRaf);
      try {
        const w = parseInt(aiContainer.style.width, 10);
        if (w >= PANE.MIN_AI) localStorage.setItem('aurora-ai-panel-width', String(w));
        localStorage.setItem('terminalHeight', String(terminalContainer.offsetHeight));
      } catch (_) { /* storage full / private mode — ignore */ }
    };

    // Keep the handle glued to the junction as either dimension (or the open
    // state) changes. Coalesced to one reflow per frame.
    // ResizeObserver fires on the initial layout (and any size change), so the
    // handle is placed on the junction from the start instead of only after the
    // first resize. Opening/closing the panel changes the AI container's
    // rendered width, which the observer also picks up.
    const ro = new ResizeObserver(schedulePosition);
    ro.observe(aiContainer);
    ro.observe(terminalContainer);
    window.addEventListener('resize', schedulePosition);
    position();
  }

  /* ---------------- clickable file references ---------------- */

  /**
   * Resolve a referenced filename to an absolute path using the project's
   * tracked files (the file tree's verilogFiles: Verilog + Python imports +
   * each processor's .cmm). Matched by basename, case-insensitive. Returns
   * null when the open project has no file by that name.
   */
  _resolveTrackedFile(fileName) {
    if (!fileName) return null;
    const base = String(fileName).split(/[\\/]/).pop().toLowerCase();
    const files = window.projectTreeManager?.verilogFiles;
    if (!Array.isArray(files)) return null;
    const hit = files.find((f) => (f.name || '').toLowerCase() === base);
    return hit ? hit.path : null;
  }

  /**
   * Ordered list of candidate paths to try for a reference, kept inside the
   * project sandbox: a tracked file matched by basename (handles any nesting,
   * plus absolute refs that point back into the tree), then the ref resolved
   * relative to the project root. Absolute paths and `..` segments that would
   * climb out of the project are never resolved as such — existence is checked
   * in openFileRef(), so only files that genuinely live under the project open.
   */
  _fileRefCandidates(ref) {
    const raw = String(ref || '').trim().replace(/^[("'<]+|[)"'>]+$/g, '');
    if (!raw) return [];
    const out = [];
    const push = (p) => { if (p && !out.includes(p)) out.push(p); };

    push(this._resolveTrackedFile(raw));

    const root = window.currentProjectPath;
    const isAbs = /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/');
    if (root && !isAbs) {
      const rel = raw.replace(/\\/g, '/');
      if (!rel.split('/').includes('..')) push(`${root}/${rel}`);
    }
    return out;
  }

  /** Open a referenced project file in the editor, jumping to `line` if given. */
  async openFileRef(fileName, line) {
    const tr = (k, p) => (window.t ? window.t(k, p) : null);
    let filePath = null;
    for (const cand of this._fileRefCandidates(fileName)) {
      try {
        if (await electronAPI.fileExists(cand)) { filePath = cand; break; }
      } catch (_) { /* try the next candidate */ }
    }
    if (!filePath) {
      showCardNotification(
        tr('notification.ai.fileNotFound', { name: fileName }) || `File not in project: ${fileName}`,
        'warning', 3000,
      );
      return;
    }
    try {
      const content = await electronAPI.readFile(filePath);
      const opts = (Number.isFinite(line) && line > 0)
        ? { revealPosition: { line, column: 1 } }
        : {};
      TabManager.addTab(filePath, content, opts);
    } catch (_e) {
      showCardNotification(
        tr('notification.ai.fileOpenError', { name: fileName }) || `Could not open ${fileName}`,
        'error', 3000,
      );
    }
  }
}

const aiAssistantManager = new AIAssistantManager();
// Expose on window so AuroraAPI (which lives in a sibling module) can
// reach back into the panel to show inline confirm / ask-question
// cards without creating a circular import.
try { window.aiAssistantManager = aiAssistantManager; } catch (_) { /* ignore */ }
export { aiAssistantManager };
