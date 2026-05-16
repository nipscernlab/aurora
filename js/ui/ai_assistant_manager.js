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
 * Phase B (this file). Tool execution + ask-before-write confirmation
 * lands in the next sub-step (4c). For now the assistant can read and
 * answer; the IDE's own `AuroraAPI` is not yet exposed to it.
 */

const PROVIDER_META = {
  openai:    { label: 'ChatGPT',  icon: './assets/icons/ai_chatgpt.svg'  },
  anthropic: { label: 'Claude',   icon: './assets/icons/ai_claude.svg'   },
  google:    { label: 'Gemini',   icon: './assets/icons/ai_gemini.webp'  },
  deepseek:  { label: 'DeepSeek', icon: './assets/icons/ai_deepseek.svg' },
};

const SYSTEM_PROMPT =
  "You are Aurora Intelligence, an AI assistant integrated into the AURORA IDE for the SAPHO " +
  "hardware platform (Scalable Architecture for Hardware Optimization, by NIPSCERN at UFJF). " +
  "Users write code in the CMM language (a C-like front-end), compiled by yanc to assembly and " +
  "then to Verilog via Icarus Verilog, with PRISM as the RTL viewer. Be concise. Use Markdown. " +
  "Use fenced ```cmm code blocks for CMM snippets.";

/* ============================================================
 *  Markdown rendering (small, dependency-free)
 * ========================================================== */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sentinels for placeholder stashing. We use Unicode Private-Use Area
// (U+E000..U+F8FF) — those code points carry no semantics, never
// appear in normal text, and are not control characters (so ESLint's
// no-control-regex rule stays happy).
const CODE_SENTINEL_OPEN  = '';
const CODE_SENTINEL_CLOSE = '';

function renderInline(s) {
  // Inline code is extracted first so bold/italic regexes never run
  // inside it (`a*b*c` inside a backtick must stay literal).
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `${CODE_SENTINEL_OPEN}${codes.length - 1}${CODE_SENTINEL_CLOSE}`;
  });
  s = escapeHtml(s);
  s = s.replace(/\*\*([^\n*][^\n]*?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^\n*]+?)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    if (/^https?:\/\//i.test(url)) {
      return `<a href="#" data-href="${escapeHtml(url)}">${text}</a>`;
    }
    return text;
  });
  const sentinelRe = new RegExp(`${CODE_SENTINEL_OPEN}(\\d+)${CODE_SENTINEL_CLOSE}`, 'g');
  s = s.replace(sentinelRe, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
  return s;
}

function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let codeLang = '';
  let codeLines = [];
  let listType = null;
  let paraLines = [];

  const flushPara = () => {
    if (paraLines.length) {
      out.push(`<p>${renderInline(paraLines.join(' '))}</p>`);
      paraLines = [];
    }
  };
  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };
  const flushCode = () => {
    out.push(
      `<pre><code class="lang-${escapeHtml(codeLang || 'text')}">${escapeHtml(codeLines.join('\n'))}</code></pre>`,
    );
    codeLines = [];
    codeLang = '';
  };

  for (const line of lines) {
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCode) { flushCode(); inCode = false; }
      else { flushPara(); closeList(); inCode = true; codeLang = fence[1] || ''; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      flushPara(); closeList();
      const level = head[1].length;
      out.push(`<h${level}>${renderInline(head[2])}</h${level}>`);
      continue;
    }

    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (listType !== 'ul') { closeList(); listType = 'ul'; out.push('<ul>'); }
      out.push(`<li>${renderInline(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType !== 'ol') { closeList(); listType = 'ol'; out.push('<ol>'); }
      out.push(`<li>${renderInline(ol[1])}</li>`);
      continue;
    }

    if (!line.trim()) { flushPara(); closeList(); continue; }

    closeList();
    paraLines.push(line);
  }

  if (inCode) flushCode();         // unclosed fence during streaming
  flushPara();
  closeList();
  return out.join('');
}

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
    this.stopBtn = null;
    this.clearBtn = null;
    this.tokenCounter = null;

    this.messages = [];              // [{ role:'user'|'assistant', content }]
    this.currentProvider = null;
    this.providersAvailable = [];    // [{ name, defaultModel }]
    this.providersConfigured = {};   // { name: bool }
    this.currentSessionId = null;
    this.currentAssistantContentEl = null;
    this.currentAssistantBuffer = '';
    this.cumulativeTokens = 0;

    this.unsubChatEvent = null;
  }

  toggle() {
    if (!this.container) this.initialize();
    const opening = !this.container.classList.contains('open');
    this.container.classList.toggle('open', opening);
    document.body.classList.toggle('ai-assistant-open', opening);
    if (opening) {
      this.refreshProviders().then(() => this.inputEl?.focus());
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
          <div class="ai-provider-section">
            <select id="ai-provider-select" class="ai-provider-select" aria-label="Provider"></select>
            <i class="ph ph-caret-down ai-provider-caret" aria-hidden="true"></i>
          </div>
          <button class="ai-clear-btn" id="ai-clear-btn" title="Clear conversation" aria-label="Clear conversation">
            <i class="ph ph-broom"></i>
          </button>
          <button class="ai-assistant-close" aria-label="Close AI Assistant">
            <i class="ph ph-x"></i>
          </button>
        </div>
      </div>

      <div class="ai-assistant-content">
        <div class="ai-empty-state" id="ai-empty-state">
          <i class="ph ph-sparkle ai-empty-icon" aria-hidden="true"></i>
          <h4>No provider configured</h4>
          <p>Set an API key for any supported provider — OpenAI, Anthropic, Google or DeepSeek — and reopen this panel.</p>
          <p class="ai-empty-hint">For now, configure a key from DevTools:<br><code>await aiAPI.setKey('anthropic', 'sk-ant-...')</code></p>
        </div>

        <div class="ai-messages" id="ai-messages" role="log" aria-live="polite"></div>

        <div class="ai-input-area">
          <textarea id="ai-input"
            class="ai-input"
            placeholder="Ask Aurora Intelligence…"
            rows="1"
            aria-label="Message"></textarea>
          <div class="ai-input-controls">
            <span class="ai-token-counter" id="ai-token-counter">0 tokens</span>
            <button class="ai-send-btn" id="ai-send-btn" title="Send (Enter)" aria-label="Send">
              <i class="ph ph-paper-plane-tilt"></i>
            </button>
            <button class="ai-stop-btn hidden" id="ai-stop-btn" title="Stop" aria-label="Stop">
              <i class="ph ph-stop-circle"></i>
            </button>
          </div>
        </div>

        <div class="ai-resize-handle" aria-label="Resize AI panel"></div>
      </div>`;
    document.body.appendChild(this.container);

    this.providerSelect          = this.container.querySelector('#ai-provider-select');
    this.providerIcon            = this.container.querySelector('#ai-provider-icon');
    this.messagesEl              = this.container.querySelector('#ai-messages');
    this.emptyStateEl            = this.container.querySelector('#ai-empty-state');
    this.inputEl                 = this.container.querySelector('#ai-input');
    this.sendBtn                 = this.container.querySelector('#ai-send-btn');
    this.stopBtn                 = this.container.querySelector('#ai-stop-btn');
    this.clearBtn                = this.container.querySelector('#ai-clear-btn');
    this.tokenCounter            = this.container.querySelector('#ai-token-counter');

    this.attachListeners();
    this.setupResize(this.container.querySelector('.ai-resize-handle'), this.container);
  }

  attachListeners() {
    this.container.querySelector('.ai-assistant-close').addEventListener('click', () => this.toggle());

    this.providerSelect.addEventListener('change', () => {
      this.currentProvider = this.providerSelect.value;
      this.updateProviderIcon();
    });

    this.sendBtn.addEventListener('click', () => this.send());
    this.stopBtn.addEventListener('click', () => this.stop());
    this.clearBtn.addEventListener('click', () => this.clearChat());

    // Enter sends, Shift+Enter inserts a newline. Holding Ctrl/Cmd also
    // sends so users with the muscle memory don't get stuck.
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this.sendBtn.disabled) this.send();
      }
    });

    // Auto-resize the textarea up to ~6 lines.
    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 160) + 'px';
    });

    // External links in markdown bubbles: openExternal so the renderer
    // window doesn't navigate. The anchor itself is just a sentinel —
    // `data-href` carries the real URL.
    this.messagesEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-href]');
      if (!a) return;
      e.preventDefault();
      window.electronAPI?.openExternal?.(a.getAttribute('data-href'));
    });
  }

  async refreshProviders() {
    if (!window.aiAPI) return;
    try {
      const { providers } = await window.aiAPI.listProviders();
      const { configured } = await window.aiAPI.getKeyStatus();
      this.providersAvailable = providers || [];
      this.providersConfigured = configured || {};
    } catch (e) {
      console.warn('[ai-panel] refreshProviders failed:', e);
      this.providersAvailable = [];
      this.providersConfigured = {};
    }

    const usable = this.providersAvailable.filter((p) => this.providersConfigured[p.name]);

    if (!usable.length) {
      this.showEmptyState(true);
      this.providerSelect.innerHTML = '';
      this.currentProvider = null;
      this.sendBtn.disabled = true;
      this.inputEl.disabled = true;
      return;
    }

    this.showEmptyState(false);
    this.sendBtn.disabled = false;
    this.inputEl.disabled = false;

    // Preserve current selection across refreshes if still configured.
    const previous = this.currentProvider;
    this.providerSelect.innerHTML = usable
      .map((p) => {
        const meta = PROVIDER_META[p.name] || { label: p.name };
        return `<option value="${p.name}">${meta.label}</option>`;
      })
      .join('');
    if (previous && usable.some((p) => p.name === previous)) {
      this.providerSelect.value = previous;
    } else {
      this.currentProvider = usable[0].name;
      this.providerSelect.value = this.currentProvider;
    }
    this.currentProvider = this.providerSelect.value;
    this.updateProviderIcon();
  }

  updateProviderIcon() {
    const meta = PROVIDER_META[this.currentProvider];
    if (meta?.icon) this.providerIcon.src = meta.icon;
  }

  showEmptyState(show) {
    this.emptyStateEl.classList.toggle('hidden', !show);
    this.messagesEl.classList.toggle('hidden', show);
  }

  /* ---------------- sending ---------------- */

  async send() {
    if (!window.aiAPI || !this.currentProvider) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';

    // User bubble + placeholder for the assistant. The assistant bubble
    // starts empty and is filled token-by-token from chat events.
    this.appendBubble('user', text);
    this.messages.push({ role: 'user', content: text });

    const assistantBubble = this.appendBubble('assistant', '');
    this.currentAssistantContentEl = assistantBubble.querySelector('.ai-msg-content');
    this.currentAssistantBuffer = '';
    this.messages.push({ role: 'assistant', content: '' });

    // Subscribe lazily so we never miss the first text-delta packet —
    // startChat fires the work detached on main.
    if (!this.unsubChatEvent) {
      this.unsubChatEvent = window.aiAPI.onChatEvent((ev) => this.handleChatEvent(ev));
    }

    this.currentSessionId = (crypto.randomUUID && crypto.randomUUID()) ||
      `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.setStreaming(true);

    // Send the trimmed conversation: skip the empty assistant placeholder
    // we just pushed, and stringify every content as plain text.
    const apiMessages = this.messages
      .filter((m, idx) => !(idx === this.messages.length - 1 && m.role === 'assistant' && !m.content))
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const r = await window.aiAPI.startChat({
        sessionId: this.currentSessionId,
        provider: this.currentProvider,
        messages: apiMessages,
        system: SYSTEM_PROMPT,
      });
      if (r && r.ok === false) this.markBubbleError(r.error || 'Failed to start chat');
    } catch (e) {
      this.markBubbleError(e?.message || String(e));
    }
  }

  async stop() {
    if (!this.currentSessionId || !window.aiAPI) return;
    try { await window.aiAPI.abortChat(this.currentSessionId); }
    catch (_) { /* the event-loop side reports back via 'aborted' */ }
  }

  handleChatEvent(ev) {
    if (!ev || ev.sessionId !== this.currentSessionId) return;
    switch (ev.type) {
      case 'text-delta':
        this.currentAssistantBuffer += ev.delta || '';
        this.renderStreamingBubble();
        break;
      case 'finish':
        if (ev.text) {
          this.currentAssistantBuffer = ev.text;
          this.renderStreamingBubble();
        }
        this.commitAssistantMessage();
        this.applyUsage(ev.usage);
        this.setStreaming(false);
        break;
      case 'aborted':
        if (ev.text) {
          this.currentAssistantBuffer = ev.text;
          this.renderStreamingBubble();
        }
        this.commitAssistantMessage();
        this.setStreaming(false);
        break;
      case 'error':
        this.markBubbleError(ev.message || 'Unknown error');
        this.setStreaming(false);
        break;
    }
  }

  renderStreamingBubble() {
    if (!this.currentAssistantContentEl) return;
    this.currentAssistantContentEl.innerHTML = renderMarkdown(this.currentAssistantBuffer);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  commitAssistantMessage() {
    // Persist final text back into the history slot for the next turn.
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        this.messages[i].content = this.currentAssistantBuffer;
        break;
      }
    }
    this.currentAssistantContentEl = null;
    this.currentAssistantBuffer = '';
    this.currentSessionId = null;
  }

  markBubbleError(message) {
    if (this.currentAssistantContentEl) {
      this.currentAssistantContentEl.parentElement.classList.add('error');
      this.currentAssistantContentEl.textContent = `Error: ${message}`;
    } else {
      this.appendBubble('assistant', `Error: ${message}`, { error: true });
    }
    // Drop the broken placeholder from history so the next turn doesn't
    // ship an empty assistant message to the model.
    if (this.messages.length && !this.messages[this.messages.length - 1].content) {
      this.messages.pop();
    }
    this.currentAssistantContentEl = null;
    this.currentAssistantBuffer = '';
    this.currentSessionId = null;
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
      this.tokenCounter.textContent = `${this.cumulativeTokens.toLocaleString()} tokens`;
    }
  }

  setStreaming(streaming) {
    this.sendBtn.classList.toggle('hidden', streaming);
    this.stopBtn.classList.toggle('hidden', !streaming);
    this.inputEl.disabled = streaming;
    this.clearBtn.disabled = streaming;
  }

  /* ---------------- bubbles / clear ---------------- */

  appendBubble(role, content, { error = false } = {}) {
    const el = document.createElement('div');
    el.className = `ai-message ai-msg-${role}${error ? ' error' : ''}`;
    const label = role === 'user' ? 'You' : 'Aurora Intelligence';
    el.innerHTML = `
      <div class="ai-msg-role">${label}</div>
      <div class="ai-msg-content"></div>
    `;
    const contentEl = el.querySelector('.ai-msg-content');
    if (role === 'user') {
      // User text is verbatim, not rendered as markdown.
      contentEl.textContent = content;
    } else if (content) {
      contentEl.innerHTML = renderMarkdown(content);
    }
    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return el;
  }

  clearChat() {
    if (this.currentSessionId) return;        // never clear mid-stream
    this.messages = [];
    this.messagesEl.innerHTML = '';
    this.cumulativeTokens = 0;
    this.tokenCounter.textContent = '0 tokens';
  }

  /* ---------------- resize ---------------- */

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
          const newWidth = Math.max(
            320,
            Math.min(startWidth + (startX - ev.clientX), window.innerWidth * 0.7),
          );
          container.style.width = newWidth + 'px';
        });
      };

      const onUp = () => {
        active = false;
        document.body.classList.remove('resizing-vertical');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (raf) cancelAnimationFrame(raf);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

const aiAssistantManager = new AIAssistantManager();
export { aiAssistantManager };
