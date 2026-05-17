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

import { showConfirm } from './dialog_manager.js';

const PROVIDER_META = {
  openai:    { label: 'ChatGPT',  icon: './assets/icons/ai_chatgpt.svg'  },
  anthropic: { label: 'Claude',   icon: './assets/icons/ai_claude.svg'   },
  google:    { label: 'Gemini',   icon: './assets/icons/ai_gemini.webp'  },
  deepseek:  { label: 'DeepSeek', icon: './assets/icons/ai_deepseek.svg' },
  groq:      { label: 'Groq',     icon: './assets/icons/ai_groq.svg'     },
  ollama:    { label: 'Ollama',   icon: './assets/icons/ai_ollama.svg'   },
};

const SYSTEM_PROMPT =
  "You are Aurora Intelligence, an AI assistant integrated into the AURORA IDE for the SAPHO " +
  "hardware platform (Scalable Architecture for Hardware Optimization, by NIPSCERN at UFJF). " +
  "Users write code in the CMM language (a C-like front-end), compiled by yanc to assembly and " +
  "then to Verilog via Icarus Verilog, with PRISM as the RTL viewer. Be concise. Use Markdown. " +
  "Use fenced ```cmm code blocks for CMM snippets. " +
  "ALWAYS reply in the same language the user writes in. " +

  "CMM HEADER DIRECTIVES — every .cmm file MUST begin with ALL of these lines (in any order):\n" +
  "  #PRNAME <name>   — processor name (letters, digits, underscore, hyphen)\n" +
  "  #NUBITS <n>      — total data width in bits\n" +
  "  #NDSTAC <n>      — data stack depth\n" +
  "  #SDEPTH <n>      — instruction stack depth\n" +
  "  #NUIOIN <n>      — number of input I/O ports\n" +
  "  #NUIOOU <n>      — number of output I/O ports\n" +
  "  #NBMANT <n>      — mantissa bits (floating-point representation)\n" +
  "  #NBEXPO <n>      — exponent bits (floating-point representation)\n" +
  "  #NUGAIN <n>      — internal gain factor\n" +
  "HARD CONSTRAINTS (the compiler enforces these — breaking them causes build errors):\n" +
  "  • NUBITS = NBMANT + NBEXPO + 1  (strict equality — sign bit accounts for the +1)\n" +
  "  • NUGAIN must be a power of 2 (1, 2, 4, 8, 16, 32, 64, 128, 256 …)\n" +
  "  • All directives must be present; removing any crashes yanc\n" +
  "When you create or edit a .cmm file always validate these constraints before writing.\n" +

  "SIMULATION PARAMETERS — per processor, stored in the project's .spf file:\n" +
  "  • clk (MHz)      — clock frequency, default 100\n" +
  "  • numClocks      — number of clock cycles to simulate, default 2000\n" +
  "  • simTime (µs)   — calculated as numClocks / clk  (e.g. 2000 / 100 = 20 µs)\n" +
  "Call list_processors to read the active processor's current clk, numClocks, simTime_us, " +
  "and the full parsed header (header.NUBITS, header.NBMANT, etc.) before suggesting changes.\n" +

  "RESERVED SAPHO FILENAMES — the compilation pipeline auto-generates and OVERWRITES these files on every build:\n" +
  "  • <proc>/Hardware/<proc>.v          — synthesizable Verilog from assembly (asmcomp output)\n" +
  "  • <proc>/Simulation/<proc>_tb.v     — auto-generated testbench (asmcomp output)\n" +
  "  • <proc>/Software/<proc>.asm        — assembly from CMM\n" +
  "NEVER create files at these paths — they are silently overwritten on compile.\n" +
  "Use UNIQUE names at the project root, e.g. `sqrt_newton_top.v`, `sqrt_newton_test.v`.\n" +

  "WORKFLOW FOR CUSTOM VERILOG FILES (follow this order):\n" +
  "  1. get_project_tree  — discover the project root and existing files.\n" +
  "  2. create_file       — write the .v content; the file is auto-added to the tree.\n" +
  "  3. set_top_level     — register & mark the synthesizable wrapper as Top Level.\n" +
  "  4. set_testbench_top — register & mark the testbench as Testbench Top.\n" +
  "     (Steps 3 & 4 update the file tree immediately — no manual action needed.)\n" +
  "  5. compile_all / compile_step — only after top-level and testbench are set.\n" +
  "  6. list_wave_signals → select_wave_signals → compile_step('wave') for GTKWave.\n" +

  "GTKWAVE SIGNAL PREREQUISITES — before calling list_wave_signals or select_wave_signals:\n" +
  "  1. The project must have at least one file marked as Testbench top OR Top-Level module " +
  "in the file tree (the user right-clicks a .v file and picks 'Mark as Testbench' or 'Set as Top Level').\n" +
  "  2. Wave Configuration uses testbenchFile (or topLevelFile as fallback) as the root module " +
  "to discover the signal hierarchy. If neither is set, list_wave_signals returns an empty list.\n" +
  "  3. IMPORTANT: the active testbench/top in the file tree may belong to a DIFFERENT processor " +
  "than the one the user is currently compiling. Always call list_processors and compare which " +
  "processor the selected testbenchFile belongs to before generating or selecting signals.\n" +
  "  4. If signals are empty, instruct the user to: (a) open the file tree, (b) right-click the " +
  "correct testbench .v file, (c) choose 'Mark as Testbench Top', (d) then retry.\n" +
  "  5. Call open_wave_config before select_wave_signals if the modal needs to be opened first.\n" +

  "TOOL USE RULES: " +
  "(1) When the user requests multiple actions, invoke ALL required tools in sequence — one after another — before writing any response text. Do NOT stop or explain between tool calls. " +
  "(2) Only after ALL tools have finished, write ONE concise summary of what was done and the results. " +
  "(3) If a tool fails, report the error in the final summary and explain what to do next. " +
  "(4) Never output JSON or XML tool-call syntax as text — always use the actual function-calling mechanism.";

/* ============================================================
 *  Tool permission modes
 *
 *  Persisted in localStorage; chosen from the chat's gear popover.
 *    ask    — every tool call needs an inline OK (read and write)
 *    writes — reads run freely, writes need an inline OK (default)
 *    allow  — nothing is prompted; the assistant is fully autonomous
 * ========================================================== */

const PERMISSION_STORE_KEY = 'aurora-ai-permission';
const PERMISSION_MODES = [
  { id: 'ask',    label: 'Ask every time',     hint: 'Confirm every action' },
  { id: 'writes', label: 'Ask before changes', hint: 'Reads run freely; changes ask first' },
  { id: 'allow',  label: 'Allow all',          hint: 'Full autonomy — no prompts' },
];

function readPermissionMode() {
  try {
    const v = localStorage.getItem(PERMISSION_STORE_KEY);
    if (PERMISSION_MODES.some((m) => m.id === v)) return v;
  } catch (_) { /* fall through to default */ }
  return 'writes';
}

/** Compact "2 min ago" / "3 d ago" / locale date stamp. */
function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (diff < 60_000)      return 'just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  try { return new Date(Number(ts)).toLocaleDateString(); }
  catch (_) { return ''; }
}

/* ============================================================
 *  Generic syntax highlighter — zero external dependencies.
 *  Covers C/C++/CMM, JS/TS, Python, Verilog, Bash, and more.
 * ========================================================== */

const _HKW = new Set([
  'if','else','for','while','do','return','break','continue','switch','case','default',
  'function','const','let','var','class','import','export','new','this','super',
  'true','false','null','undefined','void','typeof','instanceof','in','of','delete',
  'async','await','try','catch','finally','throw','yield',
  'int','float','double','char','bool','short','long','unsigned','signed',
  'struct','enum','typedef','sizeof','static','extern','volatile','register','inline',
  'public','private','protected','abstract','interface','extends','implements','override','virtual',
  'module','wire','reg','input','output','inout','begin','end','always','assign',
  'posedge','negedge','initial','endmodule','parameter','localparam',
  'def','lambda','pass','with','as','from','not','and','or','is','elif','None','True','False',
  'namespace','using','template','typename','auto',
]);

// Groups: 1=// comment  2=/* block */  3=# comment/preprocessor
//         4=string  5=number  6=fn-call-ident  7=ident  8=any-other-char
const _HRE = /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([a-zA-Z_$][\w$]*(?=\s*\())|([a-zA-Z_$][\w$]*)|([^\w]|\s)/g;

function _hesc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _highlightCode(text) {
  _HRE.lastIndex = 0;
  let out = '', m;
  while ((m = _HRE.exec(text)) !== null) {
    if (m[1] || m[2] || m[3]) out += `<span class="hl-c">${_hesc(m[0])}</span>`;
    else if (m[4])             out += `<span class="hl-s">${_hesc(m[4])}</span>`;
    else if (m[5])             out += `<span class="hl-n">${_hesc(m[5])}</span>`;
    else if (m[6])             out += `<span class="hl-f">${_hesc(m[6])}</span>`;
    else if (m[7])             out += _HKW.has(m[7]) ? `<span class="hl-k">${_hesc(m[7])}</span>` : _hesc(m[7]);
    else                       out += _hesc(m[0]);
  }
  return out;
}

/** Apply syntax highlighting to all unhighlighted code blocks in `containerEl`. */
function highlightCodeBlocks(containerEl) {
  if (!containerEl) return;
  containerEl.querySelectorAll('.ai-code-block code:not([data-hl])').forEach(el => {
    el.innerHTML = _highlightCode(el.textContent);
    el.dataset.hl = '1';
  });
}

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
    const lang = escapeHtml(codeLang || 'text');
    out.push(
      `<div class="ai-code-block">` +
      `<div class="ai-code-header"><span class="ai-code-lang">${lang}</span>` +
      `<button class="ai-code-copy" title="Copy"><i class="ph ph-copy"></i></button></div>` +
      `<pre><code class="lang-${lang}">${escapeHtml(codeLines.join('\n'))}</code></pre>` +
      `</div>`,
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
    this.currentAssistantContentEl = null;  // current text segment bubble, or null
    this.segmentBuffer = '';                // text of the current segment
    this.turnText = '';                     // full assistant text for the turn
    this.runningChips = [];                 // [{ toolName, el }] in-flight tools
    this.thinkingEl = null;                 // "thinking…" placeholder, or null
    this.cumulativeTokens = 0;

    this.unsubChatEvent = null;

    // Tool permission gate.
    this.permissionMode = readPermissionMode();
    this.gearOpen = false;
    this.pendingConfirms = new Set();   // resolve fns of open confirmation cards

    // Persistent chat history.
    this.currentChatId = null;          // null until the user sends the 1st turn
    this.currentChatTitle = '';
    this.currentChatCreatedAt = 0;
    this.historyOpen = false;
    this.chatList = [];                 // cached light metadata
  }

  toggle() {
    if (!this.container) this.initialize();
    const opening = !this.container.classList.contains('open');
    this.container.classList.toggle('open', opening);
    document.body.classList.toggle('ai-assistant-open', opening);
    if (opening) {
      this.refreshProviders().then(() => this.inputEl?.focus());
      this.refreshChatList();
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
          <button class="ai-history-btn" id="ai-history-btn" title="Chat history" aria-label="Chat history">
            <i class="ph ph-clock-counter-clockwise"></i>
          </button>
          <button class="ai-gear-btn" id="ai-gear-btn" title="Chat settings" aria-label="Chat settings">
            <i class="ph ph-gear-six"></i>
          </button>
          <button class="ai-clear-btn" id="ai-clear-btn" title="New chat" aria-label="New chat">
            <i class="ph ph-plus-circle"></i>
          </button>
          <button class="ai-assistant-close" aria-label="Close AI Assistant">
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

        <!-- Gear popover: pick the provider and the tool permission mode. -->
        <div class="ai-gear-popover hidden" id="ai-gear-popover" role="menu">
          <div class="ai-gear-section">
            <div class="ai-gear-label">Provider</div>
            <div class="ai-gear-list" id="ai-gear-providers"></div>
          </div>
          <div class="ai-gear-section">
            <div class="ai-gear-label">Permissions</div>
            <div class="ai-gear-list" id="ai-gear-perms"></div>
          </div>
          <button class="ai-gear-managekeys" id="ai-gear-managekeys">
            <i class="ph ph-key" aria-hidden="true"></i><span>Manage API keys</span>
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

    this.providerIcon  = this.container.querySelector('#ai-provider-icon');
    this.messagesEl    = this.container.querySelector('#ai-messages');
    this.emptyStateEl  = this.container.querySelector('#ai-empty-state');
    this.inputEl       = this.container.querySelector('#ai-input');
    this.sendBtn       = this.container.querySelector('#ai-send-btn');
    this.stopBtn       = this.container.querySelector('#ai-stop-btn');
    this.clearBtn      = this.container.querySelector('#ai-clear-btn');
    this.tokenCounter  = this.container.querySelector('#ai-token-counter');
    this.gearBtn       = this.container.querySelector('#ai-gear-btn');
    this.gearPopover   = this.container.querySelector('#ai-gear-popover');
    this.gearProviders = this.container.querySelector('#ai-gear-providers');
    this.gearPerms     = this.container.querySelector('#ai-gear-perms');
    this.historyBtn    = this.container.querySelector('#ai-history-btn');
    this.historyPopover = this.container.querySelector('#ai-history-popover');
    this.historyList   = this.container.querySelector('#ai-history-list');

    this.buildPermissionOptions();
    this.attachListeners();
    this.setupResize(this.container.querySelector('.ai-resize-handle'), this.container);
  }

  attachListeners() {
    this.container.querySelector('.ai-assistant-close').addEventListener('click', () => this.toggle());

    // Gear popover — provider + permission mode.
    this.gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleGear();
    });
    this.gearPopover.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.toggleGear(false));

    this.gearProviders.addEventListener('change', (e) => {
      const radio = e.target.closest('input[name="ai-provider"]');
      if (radio) {
        this.currentProvider = radio.value;
        this.updateProviderIcon();
      }
    });
    this.gearPerms.addEventListener('change', (e) => {
      const radio = e.target.closest('input[name="ai-perm"]');
      if (radio) this.setPermissionMode(radio.value);
    });
    this.container.querySelector('#ai-gear-managekeys').addEventListener('click', () => {
      this.toggleGear(false);
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
    this.stopBtn.addEventListener('click', () => this.stop());
    this.clearBtn.addEventListener('click', () => this.newChat());

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
  }

  /* ---------------- gear popover ---------------- */

  toggleGear(force) {
    const open = force === undefined ? !this.gearOpen : force;
    this.gearOpen = open;
    this.gearPopover.classList.toggle('hidden', !open);
    this.gearBtn.classList.toggle('active', open);
  }

  buildPermissionOptions() {
    this.gearPerms.innerHTML = PERMISSION_MODES.map((m) => `
      <label class="ai-gear-opt">
        <input type="radio" name="ai-perm" value="${m.id}"${m.id === this.permissionMode ? ' checked' : ''}>
        <span class="ai-gear-opt-text">
          <span class="ai-gear-opt-label">${m.label}</span>
          <span class="ai-gear-opt-hint">${m.hint}</span>
        </span>
      </label>
    `).join('');
  }

  setPermissionMode(mode) {
    if (!PERMISSION_MODES.some((m) => m.id === mode)) return;
    this.permissionMode = mode;
    try { localStorage.setItem(PERMISSION_STORE_KEY, mode); }
    catch (_) { /* persistence is best-effort */ }
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
      this.gearProviders.innerHTML = '<p class="ai-gear-empty">No API key configured.</p>';
      this.currentProvider = null;
      this.sendBtn.disabled = true;
      this.inputEl.disabled = true;
      return;
    }

    this.showEmptyState(false);
    this.sendBtn.disabled = false;
    this.inputEl.disabled = false;

    // Keep the current selection if its key is still configured.
    if (!this.currentProvider || !usable.some((p) => p.name === this.currentProvider)) {
      this.currentProvider = usable[0].name;
    }

    this.gearProviders.innerHTML = usable.map((p) => {
      const meta = PROVIDER_META[p.name] || { label: p.name };
      const checked = p.name === this.currentProvider ? ' checked' : '';
      return `
        <label class="ai-gear-opt">
          <input type="radio" name="ai-provider" value="${p.name}"${checked}>
          <span class="ai-gear-opt-text">
            <span class="ai-gear-opt-label">${meta.label}</span>
            <span class="ai-gear-opt-hint">${p.model || ''}</span>
          </span>
        </label>
      `;
    }).join('');

    this.updateProviderIcon();
  }

  updateProviderIcon() {
    const meta = PROVIDER_META[this.currentProvider];
    if (meta?.icon) this.providerIcon.src = meta.icon;
  }

  /* ---------------- tool permission gate ---------------- */

  /**
   * Decide whether a tool call may run. Resolves true/false. Called by
   * the tool runner before every tool. `allow` mode auto-approves;
   * `writes` auto-approves reads; otherwise an inline card is shown.
   */
  confirmToolCall(def, args) {
    const mode = this.permissionMode;
    if (mode === 'allow') return Promise.resolve(true);
    if (mode === 'writes' && def && def.access === 'read') return Promise.resolve(true);
    return this.showInlineConfirm(def, args);
  }

  previewArgs(args) {
    if (!args || Object.keys(args).length === 0) return '';
    let json;
    try { json = JSON.stringify(args, null, 2); }
    catch { json = String(args); }
    return json.length > 500 ? json.slice(0, 500) + '\n…' : json;
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
        <pre class="ai-confirm-args"></pre>
        <div class="ai-confirm-actions">
          <button class="ai-confirm-deny" type="button">Deny</button>
          <button class="ai-confirm-allow" type="button">Allow</button>
        </div>
      `;
      card.querySelector('.ai-confirm-tool').textContent = def ? def.name : 'tool';
      card.querySelector('.ai-confirm-desc').textContent = def ? (def.description || '') : '';
      const preview = this.previewArgs(args);
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
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      requestAnimationFrame(() => card.classList.remove('enter'));
    });
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

    // First message of a new chat — assign an id, derive a title from
    // the user's text, and mark this as the conversation we'll persist.
    if (!this.currentChatId) {
      try {
        const r = await window.aiAPI.newConversationId?.();
        this.currentChatId = (r && r.id) || `c-${Date.now()}`;
      } catch (_) { this.currentChatId = `c-${Date.now()}`; }
      this.currentChatTitle = text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';
      this.currentChatCreatedAt = Date.now();
    }

    this.appendBubble('user', text);
    this.messages.push({ role: 'user', content: text });

    // Assistant output is built lazily: text segments and tool chips
    // append in arrival order, so a turn reads top-to-bottom even when
    // the model interleaves "explain → call a tool → explain".
    this.turnText = '';
    this.segmentBuffer = '';
    this.currentAssistantContentEl = null;
    this.runningChips = [];
    this.showThinking(true);

    // Subscribe lazily so we never miss the first packet — startChat
    // fires the work detached on main.
    if (!this.unsubChatEvent) {
      this.unsubChatEvent = window.aiAPI.onChatEvent((ev) => this.handleChatEvent(ev));
    }

    this.currentSessionId = (crypto.randomUUID && crypto.randomUUID()) ||
      `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.setStreaming(true);

    // Tool-type entries are display-only records; filter them before sending to the model.
    const apiMessages = this.messages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const r = await window.aiAPI.startChat({
        sessionId: this.currentSessionId,
        provider: this.currentProvider,
        messages: apiMessages,
        system: SYSTEM_PROMPT,
      });
      if (r && r.ok === false) this.failTurn(r.error || 'Failed to start chat');
    } catch (e) {
      this.failTurn(e?.message || String(e));
    }
  }

  async stop() {
    if (!this.currentSessionId || !window.aiAPI) return;
    try { await window.aiAPI.abortChat(this.currentSessionId); }
    catch (_) { /* the stream side reports back via 'aborted' */ }
  }

  handleChatEvent(ev) {
    if (!ev || ev.sessionId !== this.currentSessionId) return;
    switch (ev.type) {
      case 'text-delta':
        this.showThinking(false);
        this.appendDelta(ev.delta || '');
        break;
      case 'tool-call':
        this.showThinking(false);
        this.hadToolCalls = true;
        this.startToolChip(ev.toolName);
        // Text after a tool call opens a fresh segment below the chip.
        this.currentAssistantContentEl = null;
        this.segmentBuffer = '';
        break;
      case 'tool-result':
        this.finishToolChip(ev.toolName, ev.result);
        break;
      case 'finish':
        this.showThinking(false);
        this.commitTurn();
        this.applyUsage(ev.usage);
        this.setStreaming(false);
        break;
      case 'aborted':
        this.showThinking(false);
        this.commitTurn();
        this.setStreaming(false);
        break;
      case 'error':
        this.failTurn(ev.message || 'Unknown error');
        break;
    }
  }

  /* ---------------- streaming text segments ---------------- */

  appendDelta(delta) {
    if (!delta) return;
    if (!this.currentAssistantContentEl) {
      const bubble = this.appendBubble('assistant', '');
      this.currentAssistantContentEl = bubble.querySelector('.ai-msg-content');
      this.segmentBuffer = '';
    }
    this.segmentBuffer += delta;
    this.turnText += delta;
    // Strip tool-call artefacts that some models (Llama/Qwen) emit as inline
    // text. This covers XML blocks, Qwen-style JSON+</tool_call> lines, and
    // orphan closing tags. Only complete patterns are stripped while streaming
    // so partial tags don't permanently corrupt the buffer.
    const displayText = this.segmentBuffer
      .replace(/<(?:tool_call|function_calls|invoke)(?:\s[^>]*)?>[\s\S]*?<\/(?:tool_call|function_calls|invoke)>/g, '')
      .replace(/[⺀-鿿]*\s*\{"name"\s*:\s*"[a-z_][a-z_0-9]*"\s*,\s*"arguments"\s*:[\s\S]*?\}\s*\}\s*(?:<\/tool_call>)?/g, '')
      .replace(/<\/tool_call>/g, '')
      .trim();
    this.currentAssistantContentEl.innerHTML = renderMarkdown(displayText || this.segmentBuffer);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  commitTurn() {
    // The whole turn's text is persisted as one assistant message so
    // the next turn carries context. Strip XML tool-call artifacts before
    // storing — they confuse models on subsequent turns.
    const cleanText = this.turnText
      .replace(/<(?:tool_call|function_calls|invoke)(?:\s[^>]*)?>[\s\S]*?<\/(?:tool_call|function_calls|invoke)>/g, '')
      .replace(/[⺀-鿿]*\s*\{"name"\s*:\s*"[a-z_][a-z_0-9]*"\s*,\s*"arguments"\s*:[\s\S]*?\}\s*\}\s*(?:<\/tool_call>)?/g, '')
      .replace(/<\/tool_call>/g, '')
      .trim();
    if (cleanText) {
      this.messages.push({ role: 'assistant', content: cleanText });
    }
    if (this.currentAssistantContentEl) highlightCodeBlocks(this.currentAssistantContentEl);

    // If the model called tools but never generated a text explanation
    // (common with some Ollama models), show a prompt so the user knows
    // the turn is over and can ask a follow-up.
    if (!cleanText && this.hadToolCalls) {
      this.appendBubble('assistant', '_All actions completed. Ask a follow-up if you want details._');
    }

    this.resetTurnState();
    // Auto-save the conversation after every turn.
    this.persistCurrentChat();
  }

  failTurn(message) {
    this.showThinking(false);
    this.appendBubble('assistant', `Error: ${message}`, { error: true });
    // Mark in-flight chips as failed in DOM and persist them.
    for (const { toolName, el } of this.runningChips) {
      el.classList.remove('running');
      el.classList.add('failed');
      const statusEl = el.querySelector('.ai-tool-status');
      if (statusEl) statusEl.textContent = 'failed';
      const icon = el.querySelector('i');
      if (icon) icon.className = 'ph ph-x-circle';
      this.messages.push({ role: 'tool', toolName, status: 'failed', error: message });
    }
    this.persistCurrentChat();
    this.resetTurnState();
    this.setStreaming(false);
  }

  resetTurnState() {
    this.currentAssistantContentEl = null;
    this.segmentBuffer = '';
    this.turnText = '';
    this.currentSessionId = null;
    this.runningChips = [];
    this.hadToolCalls = false;
    // Auto-deny any confirmation cards still open when the turn ends
    // (e.g. the user hit Stop while a card was waiting).
    for (const decide of this.pendingConfirms) decide(false);
    this.pendingConfirms.clear();
  }

  /* ---------------- tool chips ---------------- */

  startToolChip(toolName) {
    const name = toolName || 'tool';
    const chip = document.createElement('div');
    chip.className = 'ai-tool-chip running';
    chip.innerHTML = `
      <i class="ph ph-circle-notch ai-tool-spin" aria-hidden="true"></i>
      <span class="ai-tool-name"></span>
      <span class="ai-tool-status">running…</span>
    `;
    chip.querySelector('.ai-tool-name').textContent = name;
    this.messagesEl.appendChild(chip);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    this.runningChips.push({ toolName: name, el: chip });
  }

  finishToolChip(toolName, result) {
    const name = toolName || 'tool';
    const idx = this.runningChips.findIndex((c) => c.toolName === name);
    if (idx < 0) return;
    const { el } = this.runningChips.splice(idx, 1)[0];
    const ok = !(result && result.ok === false);
    const denied = !ok && /denied/i.test((result && result.error) || '');
    const statusStr = ok ? 'done' : (denied ? 'denied' : 'failed');
    el.classList.remove('running');
    el.classList.add(statusStr);
    const icon = el.querySelector('i');
    const statusEl = el.querySelector('.ai-tool-status');
    if (icon) icon.className = ok ? 'ph ph-check-circle' : (denied ? 'ph ph-prohibit' : 'ph ph-x-circle');
    if (statusEl) statusEl.textContent = statusStr;

    // Persist the tool call in the messages array so it survives
    // into the saved chat and can be replayed when history is opened.
    const entry = { role: 'tool', toolName: name, status: statusStr };
    if (!ok && result?.error) entry.error = result.error;
    this.messages.push(entry);
  }

  /**
   * Renders a completed tool chip with no animation — used when replaying
   * saved conversations from history. The chip shows the final status
   * (done / failed / denied) and a tooltip with the error if present.
   */
  appendStaticToolChip(toolName, status, error) {
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
    if (error) chip.title = error;
    this.messagesEl.appendChild(chip);
  }

  /* ---------------- thinking indicator ---------------- */

  showThinking(show) {
    if (show && !this.thinkingEl) {
      const el = document.createElement('div');
      el.className = 'ai-thinking';
      el.innerHTML = '<span></span><span></span><span></span>';
      this.messagesEl.appendChild(el);
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      this.thinkingEl = el;
    } else if (!show && this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
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
      highlightCodeBlocks(contentEl);
    }
    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
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
    this.cumulativeTokens = 0;
    this.tokenCounter.textContent = '0 tokens';
    this.runningChips = [];
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
    if (!this.chatList.length) {
      this.historyList.innerHTML = '<p class="ai-history-empty">No saved chats yet.</p>';
      return;
    }
    this.historyList.innerHTML = this.chatList.map((c) => {
      const meta = PROVIDER_META[c.provider] || {};
      const icon = meta.icon || '';
      const providerLabel = meta.label || c.provider || '';
      const active = c.id === this.currentChatId ? ' active' : '';
      return `
        <div class="ai-history-item${active}" data-chat-id="${escapeHtml(c.id)}">
          ${icon ? `<img class="ai-history-item-icon" src="${icon}" alt="">` : '<span class="ai-history-item-icon-spacer"></span>'}
          <div class="ai-history-item-text">
            <span class="ai-history-item-title">${escapeHtml(c.title || 'Untitled')}</span>
            <span class="ai-history-item-meta">${escapeHtml(providerLabel)}${providerLabel ? ' · ' : ''}${escapeHtml(relativeTime(c.updatedAt))}</span>
          </div>
          <div class="ai-history-item-actions">
            <button class="ai-history-item-act" data-action="rename" title="Rename"><i class="ph ph-pencil-simple"></i></button>
            <button class="ai-history-item-act" data-action="delete" title="Delete"><i class="ph ph-trash"></i></button>
          </div>
        </div>
      `;
    }).join('');
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
    try { await window.aiAPI.deleteConversation(id); }
    catch (_) { /* refresh below will reveal a failure */ }
    if (id === this.currentChatId) {
      // The visible chat was deleted — reset to a fresh state.
      this.currentChatId = null;
      this.currentChatTitle = '';
      this.currentChatCreatedAt = 0;
      this.messages = [];
      this.messagesEl.innerHTML = '';
      this.cumulativeTokens = 0;
      this.tokenCounter.textContent = '0 tokens';
    }
    this.refreshChatList();
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
    this.tokenCounter.textContent = `${this.cumulativeTokens.toLocaleString()} tokens`;

    // Switch provider if the saved chat used a different one (and we
    // still have a key for it). Falls back silently if not.
    if (chat.provider && chat.provider !== this.currentProvider) {
      if (this.providersConfigured && this.providersConfigured[chat.provider]) {
        this.currentProvider = chat.provider;
        this.updateProviderIcon();
        const radio = this.gearProviders.querySelector(`input[name="ai-provider"][value="${chat.provider}"]`);
        if (radio) radio.checked = true;
      }
    }

    // Replay every message into the bubble stream.
    this.messagesEl.innerHTML = '';
    for (const msg of this.messages) {
      if (!msg || !msg.role) continue;
      if (msg.role === 'tool') {
        this.appendStaticToolChip(msg.toolName, msg.status, msg.error);
      } else if (typeof msg.content === 'string') {
        this.appendBubble(msg.role, msg.content);
      }
    }
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
        messages: this.messages.map((m) => {
            const entry = { role: m.role };
            if (m.role === 'tool') {
              entry.toolName = m.toolName;
              entry.status   = m.status;
              if (m.error) entry.error = m.error;
            } else {
              entry.content = m.content;
            }
            return entry;
          }),
        cumulativeTokens: this.cumulativeTokens,
      });
    } catch (e) { console.warn('[ai-panel] persist failed:', e); }
    this.refreshChatList();
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
