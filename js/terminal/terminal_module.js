import { electronAPI } from '../app/electron_api.js';
import '../components/aurora-terminal.js';
import { TabManager } from '../tabs/tab_manager.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { showCardNotification } from '../ui/notification.js';
import { switchTerminal, smoothFollowToBottom } from './terminal.js';

// Hard cap on retained `.log-entry` nodes per terminal body. A streaming
// compile (Verilator/iverilog dumping thousands of lines) appends one node
// per line with no upper bound — the DOM grows without limit, memory climbs,
// and every recount / filter / scroll pass gets slower until the panel janks.
// We keep the most-recent N entries and drop the oldest from the top. Counts
// (recountMessages) run from DOM truth after trimming, so the badges reflect
// the retained window — the right semantics for a live scrollback console.
const MAX_TERMINAL_ENTRIES = 5000;

// Companion cap for GROUPED cards: the per-terminal cap above counts
// `.log-entry` nodes, but a grouped card is ONE entry that can accrete an
// unbounded number of `.grouped-message` children (e.g. a build spewing
// thousands of same-type warnings into a single group). Trim the oldest
// grouped lines past this limit so one card can't grow without bound.
const MAX_GROUPED_MESSAGES = 5000;

class TerminalManager {
    constructor() {
        this.terminals = {
            tcmm: document.querySelector('#terminal-tcmm .terminal-body'),
            tasm: document.querySelector('#terminal-tasm .terminal-body'),
            tveri: document.querySelector('#terminal-tveri .terminal-body'),
            twave: document.querySelector('#terminal-twave .terminal-body'),
            // THTEST — Terminal Hardware Test: etapas + barra de progresso do
            // botao Verilator (processador CMM). Ver renderHardwareProgress.
            thtest: document.querySelector('#terminal-thtest .terminal-body'),
            tcmd: document.querySelector('#terminal-tcmd .terminal-body'),
        };

        this.messageCounts = {};
        Object.keys(this.terminals).forEach(id => {
            this.messageCounts[id] = {
                error: 0,
                warning: 0,
                success: 0,
                tips: 0
            };
        });

        this.setupTerminalTabs();
        this.setupAutoScroll();
        this.setupTerminalLogListener();
        this.updatableCards = {};

        this.currentSessionCards = {};
        Object.keys(this.terminals)
            .forEach(id => {
                this.currentSessionCards[id] = {};
            });

        if (!TerminalManager.clearButtonInitialized) {
            this.setupClearButton();
            TerminalManager.clearButtonInitialized = true;
        }

        if (!TerminalManager.exportLogButtonInitialized) {
            this.setupExportLogButton();
            TerminalManager.exportLogButtonInitialized = true;
        }

        this.activeFilters = new Set();
        this.setupFilterButtons();

        this.verboseMode = this.loadVerboseMode();
        this.setupVerboseToggle();
        this.createCounterBadges();
        this.updateCounterDisplay();
    }

    loadVerboseMode() {
        const saved = localStorage.getItem('terminal-verbose-mode');
        return saved !== null ? JSON.parse(saved) : true;
    }

    createCounterBadges() {
        const filterButtons = {
            error: document.getElementById('filter-error'),
            warning: document.getElementById('filter-warning'),
            success: document.getElementById('filter-success'),
            tips: document.getElementById('filter-tip')
        };

        Object.entries(filterButtons).forEach(([type, button]) => {
            if (button && !button.querySelector('.message-counter')) {
                const badge = document.createElement('span');
                badge.className = `message-counter counter-${type}`;
                badge.textContent = '0';
                button.appendChild(badge);
            }
        });
    }

    updateCounterDisplay() {
        const activeTab = document.querySelector('.terminal-tabs .tab.active');
        if (!activeTab) return;

        const terminalId = activeTab.getAttribute('data-terminal');
        const counts = this.messageCounts[terminalId] || {
            error: 0,
            warning: 0,
            success: 0,
            tips: 0
        };

        const updateBadge = (type, count) => {
            const buttonId = type === 'tips' ? 'filter-tip' : `filter-${type}`;
            const button = document.getElementById(buttonId);

            if (button) {
                const badge = button.querySelector('.message-counter');
                if (badge) {
                    const oldCount = parseInt(badge.textContent, 10) || 0;
                    badge.textContent = count;
                    badge.style.display = count > 0 ? 'flex' : 'none';

                    if (count > oldCount) {
                        badge.classList.add('pulse');
                        setTimeout(() => {
                            badge.classList.remove('pulse');
                        }, 300);
                    }
                }
            }
        };

        updateBadge('error', counts.error);
        updateBadge('warning', counts.warning);
        updateBadge('success', counts.success);
        updateBadge('tips', counts.tips);
    }

    incrementMessageCount(terminalId, type) {
        if (this.messageCounts[terminalId] && this.messageCounts[terminalId][type] !== undefined) {
            this.messageCounts[terminalId][type]++;
            this.updateCounterDisplay();
        }
    }

    resetMessageCounts(terminalId) {
        if (this.messageCounts[terminalId]) {
            this.messageCounts[terminalId] = {
                error: 0,
                warning: 0,
                success: 0,
                tips: 0
            };
            this.updateCounterDisplay();
        }
    }

    recountMessages(terminalId) {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;

        const counts = { error: 0, warning: 0, success: 0, tips: 0 };

        const entries = terminal.querySelectorAll('.log-entry');
        entries.forEach(entry => {
            // Determine the type of this entry from its classes.
            let type = null;
            if (entry.classList.contains('error'))   type = 'error';
            else if (entry.classList.contains('warning')) type = 'warning';
            else if (entry.classList.contains('success')) type = 'success';
            else if (entry.classList.contains('tips') || entry.classList.contains('info')) type = 'tips';
            if (!type) return;

            // Grouped card: count each child message individually.
            const grouped = entry.querySelectorAll('.grouped-message');
            if (grouped.length > 0) {
                counts[type] += grouped.length;
            } else {
                counts[type] += 1;
            }
        });

        this.messageCounts[terminalId] = counts;
        this.updateCounterDisplay();
    }


    saveVerboseMode() {
        localStorage.setItem('terminal-verbose-mode', JSON.stringify(this.verboseMode));
    }

    setupVerboseToggle() {
        const verboseToggle = document.getElementById('verbose-toggle');
        if (verboseToggle) {
            verboseToggle.checked = this.verboseMode;
            verboseToggle.addEventListener('change', (e) => {
                this.verboseMode = e.target.checked;
                this.saveVerboseMode();
                this.applyFilterToAllTerminals();
            });
        }
    }

    resetSessionCards(terminalId) {
        if (this.currentSessionCards[terminalId]) {
            this.currentSessionCards[terminalId] = {};
        }
    }


    /**
     * Bring `terminalId`'s tab to the front so the user always sees the
     * terminal that is actively receiving compiler output. Wired only into
     * the streamed/executable output paths — those carry real command
     * output, so following them never yanks focus for a stray info/AI card.
     *
     * Fixes the "always one terminal ahead (empty)" complaint: a build runs
     * cmm → asm → verilog/wave, each writing to its own tab, but the view
     * used to sit on the destination tab while the work happened (invisibly)
     * in the earlier ones. Now the view tracks wherever output is landing.
     *
     * No-op when that tab is already active (cheap guard — a streaming step
     * calls this once per line, so only the first line of a new terminal
     * actually moves the DOM).
     */
    revealActiveOutputTerminal(terminalId) {
        const tab = document.querySelector(`.terminal-tabs .tab[data-terminal="${terminalId}"]`);
        if (!tab || tab.classList.contains('active')) return;
        // Delegate to switchTerminal so the shared sliding indicator follows the
        // output as a compilation moves between phases. (This used to set the
        // .active class directly, which left the accent bar behind — the
        // "the purple bar should move during compilations too" report.)
        switchTerminal(`terminal-${terminalId}`);
    }

    /**
     * Elemento .terminal-body vivo de um terminal, re-consultando o DOM se a
     * referencia em cache for nula ou estiver destacada. `this.terminals` foi
     * capturado uma unica vez no construtor (document.querySelector); se o
     * singleton nasceu antes do DOM do terminal existir, a referencia ficava
     * nula PRA SEMPRE e toda escrita era engolida pelo `if (!terminal) return`
     * — o sintoma "a IA compila mas o terminal (vazio) nunca recebe nada".
     * Re-consultar torna a escrita resiliente a ordem de init e a qualquer
     * reconstrucao do painel.
     */
    _resolveTerminal(terminalId) {
        let el = this.terminals[terminalId];
        if (!el || !el.isConnected) {
            el = document.querySelector(`#terminal-${terminalId} .terminal-body`);
            if (el) this.terminals[terminalId] = el;
        }
        return el || null;
    }

    processExecutableOutput(terminalId, result) {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal || (!result.stdout && !result.stderr)) {
            return;
        }

        this.revealActiveOutputTerminal(terminalId);
        this.resetSessionCards(terminalId);

        const output = (result.stdout || '') + (result.stderr || '');
        const lines = output.split('\n').filter(line => line.trim());

        if (lines.length === 0) return;

        lines.forEach(line => {
            const messageType = this.detectMessageType(line);

            if (messageType && messageType !== 'plain') {
                this.addToSessionCard(terminalId, line.trim(), messageType);
            } else if (this.verboseMode) {
                const timestamp = new Date().toLocaleString('pt-BR', {
                    hour12: false
                });
                this.createLogEntry(terminal, line.trim(), 'plain', timestamp);
            }
        });

        // Counters are recomputed from DOM truth once per batch instead
        // of incrementally inside each emit path. The old per-emit
        // increments double-counted error/warning lines whose Aurora
        // wrapper went through appendToTerminal → createLogEntry (both
        // sites incremented), and missed counts when grouped cards
        // landed multiple sub-messages via different code paths. A single
        // recount over .log-entry / .grouped-message is the only honest
        // source of "how many of each type are visible right now".
        this._scheduleTerminalRefresh(terminalId);
    }

    processStreamedLine(terminalId, line) {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal || !line) return;

        this.revealActiveOutputTerminal(terminalId);

        const messageType = this.detectMessageType(line);

        if (messageType && messageType !== 'plain') {
            this.addToSessionCard(terminalId, line, messageType);
        } else if (this.verboseMode) {
            const timestamp = new Date().toLocaleString('pt-BR', {
                hour12: false
            });
            this.createLogEntry(terminal, line, 'plain', timestamp);
        }

        // See processExecutableOutput — recount per batch beats the
        // double-counting from interleaved increment sites. Coalesced: a
        // streaming compile calls this once per line, so the O(n) recount +
        // filter + scroll must batch to one pass per frame, not per line.
        this._scheduleTerminalRefresh(terminalId);
    }

    appendToTerminal(terminalId, content, type = 'info', options = {}) {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;

        let text = (typeof content === 'string') ? content : (content.stdout || '') + (content.stderr || '');
        if (!text.trim()) return;

        // Wrapper messages (banners, phase notes) also pull focus to their
        // terminal so the active tab + sliding bar follow the compilation.
        this.revealActiveOutputTerminal(terminalId);

        // Anything that comes through appendToTerminal is, by definition,
        // an Aurora wrapper message (compiler output uses processStreamedLine /
        // processExecutableOutput). When verbose is OFF, only show entries
        // whose CONTENT carries a semantic marker (Erro/Atenção/Sucesso/Info).
        const explicitInternal = options.internal === true;

        const lines = text.split('\n').filter(line => line.trim());

        lines.forEach(line => {
            // 'raw' bypasses semantic detection entirely — caller wants
            // the line shown verbatim, no card, no coloring, no verbose
            // filter. Used for streamed compiler stdout where the IDE
            // is acting as a pass-through console.
            if (type === 'raw') {
                const ts = new Date().toLocaleString('pt-BR', { hour12: false });
                this.createLogEntry(terminal, line.trim(), 'raw', ts);
                return;
            }

            const detectedType = this.detectMessageType(line);

            // Detected semantic type (from the text content itself) wins
            // over the caller's intent — that's how compiler stdout gets
            // categorized as error/warning when it carries a marker.
            // Else we trust the caller's `type`: info/warning/success/
            // error/tips are all real, user-facing categories that the
            // verbose filter never hides. Only when neither side has a
            // category do we downgrade to `plain` (filterable noise).
            let effectiveType;
            if (detectedType !== 'plain') {
                effectiveType = detectedType;
            } else if (explicitInternal) {
                effectiveType = 'plain';
            } else {
                effectiveType = type || 'plain';
            }

            // Verbose-off: only show messages with a real semantic marker.
            if (!this.verboseMode && effectiveType === 'plain') return;

            const timestamp = new Date().toLocaleString('pt-BR', { hour12: false });
            this.createLogEntry(terminal, line.trim(), effectiveType, timestamp);
        });

        // Single-source-of-truth recount once per batch (see
        // processExecutableOutput for the rationale). Coalesced to one pass
        // per frame so back-to-back wrapper messages don't each walk the DOM.
        this._scheduleTerminalRefresh(terminalId);
    }

    /**
     * Match a card against a filter category. The visible filter buttons
     * are error / warning / success / tips — but the renderer actually
     * emits two flavours of the info-style card (`.tips` from
     * detectMessageType-classified compiler hints, `.info` from
     * `appendToTerminal(..., 'info')` Aurora wrapper notes). Both render
     * with the same styling, so the filter has to treat them as one
     * group; otherwise the user clicks "filter-tip", sees the counter
     * say 5, and then sees zero rows because every one of those 5 was
     * actually a `.info` card. Same equivalency `recountMessages` uses.
     */
    _cardMatchesFilter(card, filter) {
        if (filter === 'tips') {
            return card.classList.contains('tips') || card.classList.contains('info');
        }
        return card.classList.contains(filter);
    }

    applyFilter(terminalId) {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;

        const cards = terminal.querySelectorAll('.log-entry');
        // "All four filters active" is semantically the same as "no
        // filter" — every category is included. Treat it like the empty
        // set so the user gets the obvious "I clicked everything ON,
        // therefore I should see everything" behaviour instead of an
        // identity-but-confusing pass through the per-card check.
        const activeCount = this.activeFilters.size;
        const hasActiveFilters = activeCount > 0 && activeCount < 4;

        cards.forEach(card => {
            const hasLineLinks = card.querySelector('.line-link') !== null;

            // Verbose-off path. Plain (unclassified) cards stay hidden
            // unless they carry a `line N` link — those are compile
            // diagnostics the user must always be able to click through
            // to, regardless of verbose mode. The previous version of
            // this branch let the line-link override bypass the TYPE
            // filter too, which made any error/warning containing a
            // line number show up under every filter — exactly the
            // "filter doesn't filter" symptom the user hit.
            if (!this.verboseMode && card.classList.contains('plain')) {
                card.style.display = hasLineLinks ? '' : 'none';
                return;
            }

            if (!hasActiveFilters) {
                card.style.display = '';
                return;
            }

            const matchesAny = [...this.activeFilters].some(t => this._cardMatchesFilter(card, t));
            card.style.display = matchesAny ? '' : 'none';
        });
    }

    filterGtkWaveOutput(result) {
        const noisePrefixes = [
            'GTKWave Analyzer',
            'FSTLOAD |',
            'GTKWAVE |',
            'WM Destroy',
            '[0] start time',
            '[0] end time'
        ];

        const filterLines = (text) => {
            if (!text) return '';
            return text.split('\n')
                .filter(line => {
                    return !noisePrefixes.some(prefix => line.trim().startsWith(prefix));
                })
                .join('\n');
        };

        return {
            ...result,
            stdout: filterLines(result.stdout),
            stderr: filterLines(result.stderr),
        };
    }

    setupTerminalLogListener() {
        // Module-level guard — every `new TerminalManager()` used to
        // register its own ipcRenderer.on('terminal-log', ...) callback,
        // and nothing ever removed them. Compilation_module / wave_config /
        // renderer all instantiate one (~3+ instances live at any time
        // when a project is open), so a single PRISM "compilation
        // completed" log fanned out to N terminals = the message
        // appeared 3+ times in tveri.
        //
        // The IPC payload includes the target terminal id, and
        // appendToTerminal routes by id — so one listener serving all
        // terminals is correct. Subsequent constructors no-op.
        if (TerminalManager.terminalLogListenerInitialized) return;
        electronAPI.onTerminalLog((event, terminal, message, type = 'info') => {
            this.appendToTerminal(terminal, message, type);
        });
        TerminalManager.terminalLogListenerInitialized = true;
    }

    setupTerminalTabs() {
        // Bind once. Every `new TerminalManager()` (one per compile, via
        // CompilationModule) targets the SAME shared terminal-tab DOM, so
        // without this guard each compile stacked another click listener on
        // every tab — N compiles = the tab handler firing N+1 times.
        if (TerminalManager.terminalTabsInitialized) return;
        const tabs = document.querySelectorAll('.terminal-tabs .tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const contents = document.querySelectorAll('.terminal-content');
                contents.forEach(content => content.classList.add('hidden'));

                const terminalId = tab.getAttribute('data-terminal');
                const terminal = document.getElementById(`terminal-${terminalId}`);
                terminal.classList.remove('hidden');

                this.updateCounterDisplay();
                this.scrollToBottom(terminalId);
            });
        });
        TerminalManager.terminalTabsInitialized = true;
    }


    setupFilterButtons() {
        const errorBtn = document.getElementById('filter-error');
        const warningBtn = document.getElementById('filter-warning');
        const infoBtn = document.getElementById('filter-tip');
        const successBtn = document.getElementById('filter-success');

        if (!errorBtn || !warningBtn || !infoBtn || !successBtn) return;

        const buttons = {
            error: errorBtn.cloneNode(true),
            warning: warningBtn.cloneNode(true),
            tips: infoBtn.cloneNode(true),
            success: successBtn.cloneNode(true)
        };

        // Cloned nodes inherit the marker attribute but not the tooltip listeners. Clearing it lets tooltip.js bind listeners again.
        Object.values(buttons).forEach((button) => {
            button.removeAttribute('data-tooltip-initialized');
        });

        errorBtn.parentNode.replaceChild(buttons.error, errorBtn);
        warningBtn.parentNode.replaceChild(buttons.warning, warningBtn);
        infoBtn.parentNode.replaceChild(buttons.tips, infoBtn);
        successBtn.parentNode.replaceChild(buttons.success, successBtn);

        this.createCounterBadges();

        buttons.error.addEventListener('click', () => this.toggleFilter('error', buttons.error));
        buttons.warning.addEventListener('click', () => this.toggleFilter('warning', buttons.warning));
        buttons.tips.addEventListener('click', () => this.toggleFilter('tips', buttons.tips));
        buttons.success.addEventListener('click', () => this.toggleFilter('success', buttons.success));
    }

    toggleFilter(filterType, clickedBtn) {
        if (this.activeFilters.has(filterType)) {
            this.activeFilters.delete(filterType);
            clickedBtn.classList.remove('active');
        } else {
            this.activeFilters.add(filterType);
            clickedBtn.classList.add('active');
        }

        this.applyFilterToAllTerminals();
    }

    applyFilterToAllTerminals() {
        Object.keys(this.terminals)
            .forEach(terminalId => {
                this.applyFilter(terminalId);
            });
    }

    detectMessageType(content) {
        const text = typeof content === 'string' ?
            content :
            (content.stdout || '') + ' ' + (content.stderr || '');

        // C-toolchain style: `<file>:<line>: error: ...` / `warning: ...`.
        // Catches lowercase iverilog / yosys / gcc-style diagnostics that
        // the older substring checks (`'ERROR'`, `'Warning'`) miss.
        // Checked first because it's the most specific (token + colon).
        if (/\berror:/i.test(text)) return 'error';
        if (/\bwarning:/i.test(text)) return 'warning';

        if (text.includes('Atenção') || text.includes('Warning')) return 'warning';
        if (text.includes('Erro') || text.includes('ERROR')) return 'error';
        if (text.includes('Sucesso') || text.includes('Success')) return 'success';
        if (text.includes('Info') || text.includes('Tip')) return 'tips';
        if (text.includes('não está sendo usada') || text.includes('Economize memória')) return 'tips';
        if (text.includes('de sintaxe') || text.includes('cadê a função')) return 'error';

        return 'plain';
    }

    makeLineNumbersClickable(text) {
        const encAttr = (s) => String(s)
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // C-toolchain style: `<file>:<line>: ...` — iverilog / yosys /
        // gcc / appcomp diagnostics. The path is captured into data-file
        // so the click handler opens that file directly, instead of
        // falling back to the last compiled .cmm. The optional `[A-Za-z]:`
        // prefix handles Windows drive letters (e.g. `C:\foo\bar.v:15:`)
        // without the path's own colon truncating the match.
        let out = text.replace(
            /((?:[A-Za-z]:)?[^\s:]+?\.(?:v|sv|vh|cmm|asm|h|c)):(\d+)(?=[:\s,]|$)/gi,
            (match, filePath, lineNumber) => {
                return `<span title="Abrir ${encAttr(filePath)}:${lineNumber}" class="line-link" ` +
                    `data-line="${lineNumber}" data-file="${encAttr(filePath)}" ` +
                    `style="cursor: pointer; text-decoration: none; filter: brightness(1.4);">` +
                    `${match}</span>`;
            }
        );
        // Aurora/yanc style: "linha N" / "line N" — no file prefix, click
        // falls back to the last compiled .cmm via the compilation manager.
        out = out.replace(/\b(?:linha|line)\s+(\d+)/gi, (match, lineNumber) => {
            return `<span title="Opa. Bão?" class="line-link" data-line="${lineNumber}" ` +
                `style="cursor: pointer; text-decoration: none; filter: brightness(1.4);">` +
                `${match}</span>`;
        });
        return out;
    }

    addToSessionCard(terminalId, text, type) {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;

        let card = this.currentSessionCards[terminalId][type];

        if (!card) {
            const timestamp = new Date().toLocaleString('pt-BR', {
                hour12: false
            });
            card = this.createGroupedCard(terminal, type, timestamp);
            this.currentSessionCards[terminalId][type] = card;
        }

        this.addMessageToCard(card, text, type);

        // Per-message increments are gone — the batch-level recount in
        // processExecutableOutput/processStreamedLine owns the count
        // now. Mixing increments with recounts caused +1 drift every
        // time the same Aurora wrapper line was both classified by
        // detectMessageType AND surfaced through appendToTerminal.
    }

   createGroupedCard(terminal, type, timestamp) {
        const logEntry = document.createElement('div');
        // Add 'animating-in'
        logEntry.classList.add('log-entry', type, 'animating-in');

        const timestampElement = document.createElement('span');
        timestampElement.classList.add('timestamp');
        timestampElement.textContent = `[${timestamp}]`;

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        const messagesContainer = document.createElement('div');
        messagesContainer.classList.add('messages-container');

        messageContent.appendChild(messagesContainer);
        logEntry.appendChild(timestampElement);
        logEntry.appendChild(messageContent);
        terminal.appendChild(logEntry);

        // Logic for translation removed here as CSS class 'animating-in' handles it
        
        return logEntry;
    }

    addMessageToCard(card, text, type) {
        const messagesContainer = card.querySelector('.messages-container');
        if (!messagesContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.classList.add('grouped-message');
        messageDiv.style.marginBottom = '0.25rem';

        let processedText = this.makeLineNumbersClickable(text);
        processedText = processedText.replace(
            /^(Atenção|Erro|Sucesso|Info)(:)?/i, (_, word, colon) => `<strong style="font-weight:900">${word}</strong>${colon || ''}`
        );

        messageDiv.innerHTML = processedText;
        this._attachLineLinkClicks(messageDiv);

        messagesContainer.appendChild(messageDiv);

        // Bound the card: drop the oldest grouped lines past the cap (mirrors
        // trimTerminal for `.log-entry`). Keeps memory/layout bounded even when
        // a single group accretes thousands of same-type lines.
        let excess = messagesContainer.childElementCount - MAX_GROUPED_MESSAGES;
        while (excess-- > 0 && messagesContainer.firstElementChild) {
            messagesContainer.removeChild(messagesContainer.firstElementChild);
        }
    }

    /**
     * Wire up line-link clicks inside `scopeEl` so Monaco jumps to the
     * referenced line. Two flavours of link are supported:
     *   - data-file present (`<file>:<line>:` C-toolchain diagnostics
     *     from iverilog/yosys/gcc): open the file in data-file directly,
     *     resolving relative paths against the project root.
     *   - data-file absent (`linha N` / `line N` yanc-style): open the
     *     last .cmm the compilation manager compiled, with a DOM-scrape
     *     fallback over recent `cmmcomp.exe` invocations.
     *
     * Previously this lived inline in addMessageToCard and was a no-op
     * for entries that went through createLogEntry (the createLogEntry
     * path referenced `this.handleLineClick`, which was never defined —
     * so any line-link inside a `plain`/`raw` card silently did nothing).
     * That hit English compiler output particularly hard: `detectMessageType`
     * only recognised Portuguese markers (`Erro`, `Atenção`, `Sucesso`) plus
     * a few uppercase forms, so English diagnostics like "syntax error on
     * line 5" got classified `plain`, routed through createLogEntry, and
     * the user clicked the link and nothing happened. Centralising the
     * handler fixes both paths in one place.
     */
    _attachLineLinkClicks(scopeEl) {
        if (!scopeEl) return;
        const lineLinks = scopeEl.querySelectorAll('.line-link');
        if (lineLinks.length === 0) return;
        lineLinks.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineNumber = parseInt(link.getAttribute('data-line'));
                const explicitFile = link.getAttribute('data-file');
                console.log(`Clicked on line ${lineNumber}${explicitFile ? ` (file: ${explicitFile})` : ''}`);

                try {
                    let filePath = null;

                    if (explicitFile) {
                        // C-toolchain diagnostic (iverilog / yosys / gcc):
                        // the path travels in data-file. Absolute paths go
                        // through as-is; relative paths resolve against the
                        // open project root.
                        const root = window.currentProjectPath || '';
                        const isAbs = /^[A-Za-z]:[\\/]/.test(explicitFile) || explicitFile.startsWith('\\\\');
                        filePath = isAbs ? explicitFile :
                            (root ? `${root}\\${explicitFile.replace(/^[\\/]+/, '')}` : explicitFile);
                    } else {
                        // Aurora/yanc "linha N" — cmmCompilation caches the
                        // .cmm it just ran against. Works regardless of
                        // verbose mode because it doesn't touch the DOM.
                        filePath =
                            window.compilationManager?.lastCompiledCmmPath ||
                            window._latestCompilationModule?.lastCompiledCmmPath ||
                            null;

                        if (!filePath) {
                            const terminalContent = scopeEl.closest('.terminal-content');
                            if (terminalContent) {
                                const logEntries = terminalContent.querySelectorAll('.log-entry');

                                for (const entry of Array.from(logEntries).reverse()) {
                                    const entryText = entry.textContent || '';

                                    // cmmcomp.exe agora usa named flags do yanc v4:
                                    //   ... -i "<file.cmm>" -n "<name>" -p "<projectPath>" -m ... -t ...
                                    // Precisamos do -i (nome do .cmm) e -p (proc-dir,
                                    // que e <projectPath>/<processorName>) pra montar
                                    // o caminho ate o Software/.
                                    if (/cmmcomp\.exe\b/.test(entryText)) {
                                        const iMatch = entryText.match(/-i\s+"([^"]+\.cmm)"/);
                                        const pMatch = entryText.match(/-p\s+"([^"]+)"/);
                                        if (iMatch && pMatch) {
                                            filePath = await electronAPI.joinPath(pMatch[1], 'Software', iMatch[1]);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (!filePath) {
                        console.log('Could not determine file path for line link');
                        return;
                    }

                    const fileExists = await electronAPI.fileExists(filePath);
                    if (!fileExists) {
                        console.log(`File does not exist: ${filePath}`);
                        return;
                    }

                    const isFileOpen = TabManager.tabs.has(filePath);

                    if (!isFileOpen) {
                        const content = await electronAPI.readFile(filePath, {
                            encoding: 'utf8'
                        });
                        TabManager.addTab(filePath, content);
                    } else {
                        TabManager.activateTab(filePath);
                    }

                    setTimeout(() => {
                        this.goToLine(lineNumber);
                    }, 100);

                } catch (error) {
                    console.error('Error opening file and navigating to line:', error);
                }
            });
        });
    }

    goToLine(lineNumber) {
        const activeEditor = EditorManager.activeEditor;
        if (!activeEditor) {
            console.warn('No active editor found');
            return;
        }

        const model = activeEditor.getModel();
        if (!model) {
            console.warn('No model found in active editor');
            return;
        }

        const totalLines = model.getLineCount();
        const targetLine = Math.max(1, Math.min(lineNumber, totalLines));

        activeEditor.setPosition({
            lineNumber: targetLine,
            column: 1
        });

        activeEditor.revealLineInCenter(targetLine);
        activeEditor.focus();

        activeEditor.setSelection({
            startLineNumber: targetLine,
            startColumn: 1,
            endLineNumber: targetLine,
            endColumn: model.getLineMaxColumn(targetLine)
        });
    }

createLogEntry(terminal, text, type, timestamp) {
        const logEntry = document.createElement('div');
        logEntry.classList.add('log-entry', type); // Sem animações extras aqui

        const timestampElement = document.createElement('span');
        timestampElement.classList.add('timestamp');
        timestampElement.textContent = `[${timestamp}]`;

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        // Processamento de texto e links (MANTIDO IGUAL)
        let processedText = this.makeLineNumbersClickable(text);
        processedText = processedText.replace(
            /^(Atenção|Erro|Sucesso|Info)(:)?/i, 
            (_, word, colon) => `<strong>${word}</strong>${colon || ''}`
        );
        messageContent.innerHTML = processedText;

        logEntry.appendChild(timestampElement);
        logEntry.appendChild(messageContent);

        // Adiciona ao DOM (ainda invisível se terminal.classList contiver 'faded-out')
        terminal.appendChild(logEntry);

        // Line links resolve against the same .cmm-aware handler that
        // session-card messages use (see _attachLineLinkClicks). Before,
        // this path called `this.handleLineClick` which was never defined,
        // so clicking "line N" on any English compiler diagnostic (which
        // gets classified `plain` and routed through createLogEntry) did
        // nothing.
        this._attachLineLinkClicks(messageContent);

        // No per-entry increment here either — recountMessages at the
        // end of each appendToTerminal batch handles counting from DOM
        // truth, including the grouped-message case where one card
        // contains several sub-messages of the same type.

        // --- AQUI ESTÁ O TRUQUE DE REVELAÇÃO ---
        // Se o terminal estiver apagado (pós-clear), revelamos agora.
        // O requestAnimationFrame garante que o navegador renderizou o HTML inserido acima
        // antes de mudar a opacidade para 1, criando o efeito de "aparecer pronto".
        if (terminal.classList.contains('faded-out')) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => { // Double RAF para garantir o paint cycle
                    terminal.classList.remove('faded-out');
                    this.scrollToBottom(terminal.id.replace('terminal-', ''));
                });
            });
        }

        return logEntry;
    }

    /**
     * Barra de progresso ASCII inline para o fluxo de hardware-test (THTEST).
     * UM unico elemento que se atualiza no lugar: criado na primeira chamada,
     * mutado depois. NAO e um .log-entry — entao o filtro de verbose e os
     * contadores o ignoram e ele fica sempre visivel. Movido pro fim do
     * terminal a cada update pra acompanhar a ultima saida streamada.
     *
     * @param {string} terminalId
     * @param {{pct:number, cyc:number, total:number, reads?:number,
     *          label:string, done?:boolean}} p
     */
    renderHardwareProgress(terminalId, p) {
        // A cancel already tore the bar down (clearHardwareProgress). Stream
        // chunks buffered before the kill still land here afterwards, and each
        // one would rebuild the very bar the user just cancelled away. The flag
        // resets when the next run starts, so this only blocks the tail.
        if (typeof window !== 'undefined' && window.isCompilationCanceled?.()) return;

        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;

        // The hardware test runs in THTEST — pull focus there so its bar is seen.
        this.revealActiveOutputTerminal(terminalId);

        this.updatableCards[terminalId] = this.updatableCards[terminalId] || {};
        let el = this.updatableCards[terminalId].hwProgress;
        if (!el || !el.isConnected) {
            // Real DOM progress bar (replaces the old ASCII █░ string): a label
            // row, an aurora-gradient fill on a track, and a meta line. The fill
            // is driven frame-by-frame by _driveProgress (not a CSS transition),
            // so it creeps continuously between the discrete stdout updates.
            el = document.createElement('div');
            el.className = 'hw-progress';
            el.innerHTML =
                '<div class="hw-progress-head">' +
                  '<span class="hw-progress-label"></span>' +
                  '<span class="hw-progress-pct"></span>' +
                '</div>' +
                '<div class="hw-progress-track"><div class="hw-progress-fill"></div></div>' +
                '<div class="hw-progress-meta"></div>';
            el._label = el.querySelector('.hw-progress-label');
            el._pct = el.querySelector('.hw-progress-pct');
            el._fill = el.querySelector('.hw-progress-fill');
            el._meta = el.querySelector('.hw-progress-meta');
            el._displayPct = 0;       // currently painted % (float — the tween source)
            el._targetPct = 0;        // % the running tween is heading toward
            el._t0 = null;            // perf clock at first counted update (ETA)
            el._c0 = 0;               // cyc at _t0
            el._lastUpdateAt = null;  // perf clock of the previous update
            el._emaInterval = null;   // smoothed gap between updates (tween duration)
            terminal.appendChild(el);
            this.updatableCards[terminalId].hwProgress = el;
        } else {
            // Re-anexar move o no pro fim — mantem a barra colada embaixo
            // mesmo se linhas plain (verbose) chegarem entre os updates.
            terminal.appendChild(el);
        }

        // A new run reusing the same card: cancel any pending auto-hide + un-hide.
        if (el._hideTimer) { clearTimeout(el._hideTimer); el._hideTimer = null; }
        if (el._removeTimer) { clearTimeout(el._removeTimer); el._removeTimer = null; }
        el.classList.remove('hiding');

        const done = !!p.done;
        el._label.textContent = p.label || '';
        el.classList.toggle('done', done);

        // Resolve the target as a FLOAT. Callers hand us a pre-rounded integer
        // pct, but cyc/total carries the full precision — and rounding first is
        // itself a source of stepping (many updates land on the same integer,
        // then one jumps a whole point). Prefer the raw ratio when we have it.
        const exact = (p.total > 0 && p.cyc != null) ? (p.cyc / p.total) * 100 : (p.pct || 0);
        const pct = Math.max(0, Math.min(100, exact));

        // Is this a NEW run inheriting a card the last one left behind (the
        // auto-hide hasn't fired yet, or the run failed and never retired it)?
        // Two tells: the card already finished and we're moving again, or the
        // target fell well below what's painted. Both are impossible within a
        // run — progress there is monotonic — so either means "start over".
        // This matters because the rest of the card's state (the % floor, the
        // ETA baseline, the update-rate EMA) all assume a single run; carried
        // over, they would pin the bar at the old 100% and quote a nonsense ETA.
        if ((el._runDone && !done) || pct < (el._displayPct || 0) - 5) {
            if (el._raf) { cancelAnimationFrame(el._raf); el._raf = null; }
            el._displayPct = pct;
            el._targetPct = pct;
            el._t0 = null;            // ETA re-baselines off this run's first update
            el._c0 = 0;
            el._lastUpdateAt = null;  // don't smooth across the gap between runs
            el._emaInterval = null;
        }
        el._runDone = done;

        // Tween duration = the SMOOTHED gap between updates, so the fill arrives
        // at each value just as the next one lands and the motion reads as one
        // continuous creep. Using the raw last gap (as before) made this jerky:
        // stdout arrives in bursts, so a burst produced a near-zero duration (the
        // bar leapt) followed by a long silence (it sat frozen). An EMA rides
        // through the bursts and tracks the real average rate instead.
        const nowP = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (el._lastUpdateAt != null) {
            const gap = nowP - el._lastUpdateAt;
            el._emaInterval = (el._emaInterval == null)
                ? gap
                : (el._emaInterval * 0.7 + gap * 0.3);
        }
        el._lastUpdateAt = nowP;
        const growMs = done
            ? 260                                                    // finish: settle quickly
            : Math.max(180, Math.min(el._emaInterval ?? 600, 4000));
        this._driveProgress(el, pct, growMs);

        // ETA from the average rate since the first counted update.
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (el._t0 == null && p.cyc > 0) { el._t0 = now; el._c0 = p.cyc; }
        let etaTxt = '';
        if (!done && el._t0 != null && p.cyc > el._c0) {
            const rate = (p.cyc - el._c0) / (now - el._t0);   // cyc per ms
            if (rate > 0 && p.total > p.cyc) {
                etaTxt = ` · ~${this._fmtEta((p.total - p.cyc) / rate)} left`;
            }
        }
        // `reads` e o TOTAL de leituras de entrada (somando todos os input_<N>),
        // entao o rotulo agregado "leituras" cabe mesmo com varias entradas.
        const readsWord = (typeof window !== 'undefined' && window.t)
            ? window.t('terminal.htest.reads') : 'reads';
        const tail = (p.reads != null) ? ` · ${p.reads} ${readsWord}` : '';
        el._meta.textContent = done
            ? `${p.total}/${p.total}${tail} · done`
            : `${p.cyc}/${p.total}${tail}${etaTxt}`;

        // Hold the completed (solid-green) bar a few seconds, then retire it.
        if (done) {
            el._hideTimer = setTimeout(() => {
                el.classList.add('hiding');
                el._removeTimer = setTimeout(() => {
                    try { el.remove(); } catch (_) { /* already gone */ }
                    if (this.updatableCards[terminalId]
                        && this.updatableCards[terminalId].hwProgress === el) {
                        this.updatableCards[terminalId].hwProgress = null;
                    }
                }, 420);   // matches the .hiding opacity transition
            }, 3200);
        }

        this.scrollToBottom(terminalId);
    }

    /**
     * Drive the fill AND the percentage from one rAF loop, so the two can never
     * disagree and the bar moves every frame rather than once per stdout update.
     *
     * Retargeting mid-flight is the point: each update rewrites the tween's
     * from/target/clock while the loop keeps running, so the fill bends toward
     * the new value from wherever it currently sits — no restart, no snap. That
     * is why the loop reads `el._*` on every frame instead of closing over the
     * arguments, and why a live loop is reused (`if (el._raf) return`) instead
     * of being cancelled and replaced.
     *
     * @param {HTMLElement} el      the .hw-progress node
     * @param {number} target       destination percentage (float, 0-100)
     * @param {number} dur          ms to travel there (the smoothed update gap)
     */
    _driveProgress(el, target, dur) {
        const nowFn = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
        // Never walk backwards: a late/out-of-order update would otherwise make
        // the bar visibly retreat. Progress is monotonic by construction.
        el._targetPct = Math.max(el._displayPct || 0, target);
        el._animFrom = el._displayPct || 0;
        el._animT0 = nowFn();
        el._animDur = Math.max(1, dur);

        if (el._raf) return;   // loop already live — it picks the new target up

        const step = () => {
            const k = Math.min(1, (nowFn() - el._animT0) / el._animDur);
            const val = el._animFrom + (el._targetPct - el._animFrom) * k;
            el._displayPct = val;
            el._fill.style.transform = `scaleX(${val / 100})`;
            el._pct.textContent = `${Math.round(val)}%`;
            el._raf = (k < 1) ? requestAnimationFrame(step) : null;
        };
        el._raf = requestAnimationFrame(step);
    }

    /**
     * Tear every hardware-progress bar down immediately, wherever it lives.
     * Called when the user cancels: the run is over, so a bar frozen mid-fill
     * (and its pending auto-hide) is a lie about work still happening.
     *
     * Sweeps the DOM rather than trusting `updatableCards` alone — a new
     * TerminalManager is built per compile, so the instance handling the cancel
     * is not necessarily the one that created the bar on screen.
     */
    clearHardwareProgress() {
        const drop = (el) => {
            if (!el) return;
            if (el._hideTimer) { clearTimeout(el._hideTimer); el._hideTimer = null; }
            if (el._removeTimer) { clearTimeout(el._removeTimer); el._removeTimer = null; }
            if (el._raf) { cancelAnimationFrame(el._raf); el._raf = null; }
            try { el.remove(); } catch (_) { /* already detached */ }
        };
        Object.values(this.updatableCards || {}).forEach((cards) => {
            if (!cards || !cards.hwProgress) return;
            drop(cards.hwProgress);
            cards.hwProgress = null;
        });
        document.querySelectorAll('.hw-progress').forEach(drop);
    }

    /** Format a millisecond ETA as a compact `Ns` / `Mm Ss` string. */
    _fmtEta(ms) {
        const s = Math.max(0, Math.round(ms / 1000));
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        const r = s % 60;
        return r > 0 ? `${m}m ${r}s` : `${m}m`;
    }

    /**
     * Log entry com um trecho clicavel (link de pasta). `message` e a string
     * ja traduzida; `folderPath` e a substring exata a virar link. Ao clicar,
     * a file tree alterna pra view de pastas e revela/expande a pasta-alvo
     * (standardTreeRenderer.revealFolder). Construido com textContent — sem
     * innerHTML, sem risco de injecao.
     *
     * @param {string} terminalId
     * @param {string} message
     * @param {string} folderPath
     * @param {string} [type='success']
     */
    appendFolderLink(terminalId, message, folderPath, type = 'success') {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;

        const ts = new Date().toLocaleString('pt-BR', { hour12: false });
        const entry = document.createElement('div');
        entry.classList.add('log-entry', type);

        const tsEl = document.createElement('span');
        tsEl.className = 'timestamp';
        tsEl.textContent = `[${ts}]`;

        const content = document.createElement('div');
        content.className = 'message-content';

        const idx = (folderPath && message) ? message.indexOf(folderPath) : -1;
        if (idx >= 0) {
            content.appendChild(document.createTextNode(message.slice(0, idx)));
            const link = document.createElement('span');
            link.className = 'folder-link';
            link.textContent = folderPath;
            link.title = window.t ? window.t('terminal.htest.openFolder') : 'Open in folder view';
            link.addEventListener('click', () => {
                window.standardTreeRenderer?.revealFolder?.(folderPath);
            });
            content.appendChild(link);
            content.appendChild(document.createTextNode(message.slice(idx + folderPath.length)));
        } else {
            content.textContent = message;
        }

        entry.appendChild(tsEl);
        entry.appendChild(content);
        terminal.appendChild(entry);

        this.recountMessages(terminalId);
        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
    }

    /**
     * Wires the "Export log" toolbar button to actually export the active
     * terminal's contents. Before this, the button existed in the DOM with
     * a tooltip but no listener — clicking it did nothing. Now it builds a
     * plain-text dump of every visible `.log-entry` (with timestamps and
     * grouped sub-messages flattened) and offers a Save dialog with a
     * timestamped default filename. A toast confirms success or surfaces
     * the failure so the user knows whether the file landed on disk.
     */
    setupExportLogButton() {
        const exportButton = document.getElementById('export-log');
        if (!exportButton) return;
        exportButton.addEventListener('click', () => this.exportCurrentLog());
    }

    /**
     * Format Date as `YYYY-MM-DD_HH-mm-ss` — filesystem-safe (no colons,
     * no slashes) so it slots straight into a filename suffix.
     */
    _logTimestampForFilename(d = new Date()) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
               `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    }

    /**
     * Serialize ALL terminals' log entries to one plain-text file the
     * user picks via the Save dialog. The export covers every terminal
     * (TCMM / TASM / TVERI / TWAVE / TCMD) — not just the focused one —
     * because users usually file bug reports with the full context of
     * what each stage emitted, not "whatever happened to be selected".
     *
     * Layout:
     *   # Aurora terminal log export
     *   # ... metadata ...
     *
     *   ===== TCMM =====
     *   <stamp> [LEVEL] line...
     *   ...
     *
     *   ===== TASM =====
     *   ...
     *
     * Grouped cards (.log-entry holding multiple .grouped-message
     * children) get flattened with the card timestamp prefixed to each
     * child line so the export is grep-friendly.
     */
    async exportCurrentLog() {
        const sections = [];
        let totalEntries = 0;
        const terminalsWithEntries = [];

        Object.entries(this.terminals).forEach(([terminalId, terminal]) => {
            if (!terminal) return;
            const entries = terminal.querySelectorAll('.log-entry');
            if (entries.length === 0) {
                sections.push(`===== ${terminalId.toUpperCase()} =====\n(empty)\n`);
                return;
            }
            terminalsWithEntries.push(terminalId);
            totalEntries += entries.length;

            const sectionLines = [`===== ${terminalId.toUpperCase()} =====`];
            entries.forEach((entry) => {
                const stampEl = entry.querySelector(':scope > .timestamp');
                const stamp = stampEl ? stampEl.textContent.trim() : '';
                const type = entry.classList.contains('error')   ? 'ERROR'
                           : entry.classList.contains('warning') ? 'WARN '
                           : entry.classList.contains('success') ? 'OK   '
                           : entry.classList.contains('info')    ? 'INFO '
                           : entry.classList.contains('tips')    ? 'TIP  '
                           : '     ';

                const grouped = entry.querySelectorAll('.grouped-message');
                if (grouped.length > 0) {
                    grouped.forEach((g) => {
                        sectionLines.push(`${stamp} [${type}] ${g.textContent.replace(/\s+/g, ' ').trim()}`);
                    });
                } else {
                    const body = entry.querySelector('.message-content') || entry;
                    const text = (body === entry && stampEl)
                        ? entry.textContent.replace(stampEl.textContent, '')
                        : body.textContent;
                    sectionLines.push(`${stamp} [${type}] ${text.replace(/\s+/g, ' ').trim()}`);
                }
            });
            sections.push(sectionLines.join('\n') + '\n');
        });

        if (totalEntries === 0) {
            showCardNotification('All terminals are empty — nothing to export.', 'info', 3500);
            return;
        }

        const header = [
            `# Aurora terminal log export`,
            `# Exported: ${new Date().toISOString()}`,
            `# Terminals with content: ${terminalsWithEntries.join(', ') || '(none)'}`,
            `# Total entries: ${totalEntries}`,
            ''
        ].join('\n');
        const body = sections.join('\n');

        const stamp = this._logTimestampForFilename();
        const defaultName = `aurora-log-all-${stamp}.txt`;

        try {
            const api = electronAPI;
            if (!api?.showSaveDialog || !api?.writeFile) {
                showCardNotification('Export not available in this build.', 'error', 4000);
                return;
            }
            const result = await api.showSaveDialog({
                title: 'Export terminal log (all terminals)',
                defaultPath: defaultName,
                filters: [
                    { name: 'Plain text', extensions: ['txt', 'log'] },
                    { name: 'All files',  extensions: ['*'] }
                ],
            });
            if (!result || result.canceled || !result.filePath) {
                // User dismissed the dialog — silent, not an error.
                return;
            }

            const writeResult = await api.writeFile(result.filePath, header + body);
            const ok = writeResult === true
                    || writeResult?.success === true
                    || writeResult === undefined; // ipc handlers that resolve to void mean success
            if (ok) {
                const fileName = String(result.filePath).split(/[\\/]/).pop();
                showCardNotification(
                    `Exported ${totalEntries} entries from ${terminalsWithEntries.length} terminal(s) to ${fileName}.`,
                    'success', 4500, 'Export complete'
                );
            } else {
                const msg = writeResult?.error || writeResult?.message || 'Write failed.';
                showCardNotification(`Could not export the log: ${msg}`, 'error', 5000);
            }
        } catch (err) {
            console.error('exportCurrentLog failed:', err);
            showCardNotification(`Could not export the log: ${err.message || err}`, 'error', 5000);
        }
    }

    setupClearButton() {
        const clearButton = document.getElementById('clear-terminal');
        if (!clearButton) return;
        // Mode lives in state, not the icon class. The old code branched on
        // FontAwesome classes (fa-trash-can / fa-dumpster), but the button was
        // migrated to Phosphor (ph-trash) — so neither branch ever matched and
        // clicking did nothing. Left-click clears; right-click toggles
        // current-tab ↔ all-terminals.
        if (this.clearMode === undefined) this.clearMode = 'current';

        clearButton.removeEventListener('click', this.handleClearClick);
        clearButton.removeEventListener('contextmenu', this.handleClearContextMenu);

        this.handleClearClick = async (event) => {
            if (event.button !== 0) return;
            const activeTab = document.querySelector('.terminal-tabs .tab.active');
            const terminalId = activeTab?.getAttribute('data-terminal')
                || Object.keys(this.terminals)[0];
            if (this.clearMode === 'all') {
                await this.clearAllTerminals();
                if (terminalId) this._flashCleared(terminalId, 'Terminals cleared');
                return;
            }
            if (terminalId) {
                await this.clearTerminal(terminalId);
                this._flashCleared(terminalId, 'Terminal cleared');
            }
        };

        this.handleClearContextMenu = (event) => {
            event.preventDefault();
            this.changeClearIcon(clearButton);
        };

        clearButton.addEventListener('click', this.handleClearClick);
        clearButton.addEventListener('contextmenu', this.handleClearContextMenu);
    }

    setupAutoScroll() {
        // Bind once. The MutationObservers attach to the shared terminal
        // bodies and are never disconnected, so without this guard every
        // `new TerminalManager()` (one per compile) added another 5
        // observers — after N compiles, each output line fired N×5
        // scrollToBottom callbacks, progressively janking the terminal.
        if (TerminalManager.autoScrollInitialized) return;
        const config = {
            childList: true,
            subtree: true
        };

        Object.entries(this.terminals)
            .forEach(([id, terminal]) => {
                const observer = new MutationObserver(() => this.scrollToBottom(id));
                if (terminal) {
                    observer.observe(terminal, config);
                }
            });
        TerminalManager.autoScrollInitialized = true;
    }

    // Drop the oldest entries once a terminal body exceeds the cap. Keeps the
    // DOM (and therefore recount/filter/scroll cost) bounded no matter how long
    // a build runs. See MAX_TERMINAL_ENTRIES.
    trimTerminal(terminal) {
        if (!terminal) return;
        let excess = terminal.childElementCount - MAX_TERMINAL_ENTRIES;
        while (excess-- > 0 && terminal.firstElementChild) {
            terminal.removeChild(terminal.firstElementChild);
        }
    }

    // Coalesce the post-append bookkeeping (trim + recount + filter + scroll)
    // into a single pass per animation frame per terminal. Streaming compiles
    // call processStreamedLine once per line; running these O(n) DOM walks per
    // line is O(n²) over the build and forced a reflow each time — the terminal
    // freeze on large builds. The line's DOM is appended immediately (output
    // stays live); only the expensive bookkeeping is batched.
    _scheduleTerminalRefresh(terminalId) {
        const pending = this._refreshPending || (this._refreshPending = new Set());
        if (pending.has(terminalId)) return;
        pending.add(terminalId);
        requestAnimationFrame(() => {
            pending.delete(terminalId);
            const terminal = this._resolveTerminal(terminalId);
            if (!terminal) return;
            // Cheap per-frame work: keep the DOM bounded and stay scrolled.
            this.trimTerminal(terminal);
            smoothFollowToBottom(terminal);
            // recount + filter walk the whole log (O(n)); throttle them so a
            // fast stream re-walks ~8×/s instead of every frame (P10).
            this._scheduleCountRefresh(terminalId);
        });
    }

    // recountMessages + applyFilter both re-walk every .log-entry (~5k at cap),
    // which is wasteful to do per frame while output streams. Coalesce them onto
    // a trailing timer: the badges/filter settle ~8×/s, and because a final
    // timer always fires after the last append the end state is exact. A type
    // filter applied mid-stream lags new lines by <=120ms — an imperceptible
    // settle, not a correctness loss.
    _scheduleCountRefresh(terminalId) {
        const timers = this._countTimers || (this._countTimers = new Map());
        if (timers.has(terminalId)) return;
        timers.set(terminalId, setTimeout(() => {
            timers.delete(terminalId);
            const terminal = this._resolveTerminal(terminalId);
            if (!terminal) return;
            this.recountMessages(terminalId);
            this.applyFilter(terminalId);
        }, 120));
    }

    scrollToBottom(terminalId) {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;
        // Smooth, self-coalescing follow to the true bottom (see
        // smoothFollowToBottom). Calling it per appended line is cheap: a call
        // while its rAF loop is already running is a no-op, and the loop re-reads
        // the height each frame so it keeps up with the stream and lands exactly
        // on the last line instead of stopping short.
        smoothFollowToBottom(terminal);
    }

async clearTerminal(terminalId) {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;

        // No pill here: clearTerminal is also called programmatically at the
        // start of compilation phases, so a pill would flash whenever new output
        // begins. The confirmation pill is fired ONLY by the manual clear button
        // (handleClearClick → _flashCleared).
        if (!terminal.childElementCount) return;

        // 1. Animate the existing entries out (fade + slide), then wipe.
        terminal.classList.add('clearing');
        await new Promise(resolve => setTimeout(resolve, 200));

        // 2. Reset logical state + DOM.
        this.currentSessionCards[terminalId] = {};
        this.updatableCards[terminalId] = {};
        this.messageCounts[terminalId] = { error: 0, warning: 0, success: 0, tips: 0 };
        terminal.innerHTML = '';
        terminal.classList.remove('clearing');
        this.recountMessages?.(terminalId);
    }

    /** Transient confirmation pill — fired by the manual clear button only. */
    _flashCleared(terminalId, message = 'Terminal cleared') {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;
        terminal.querySelector(':scope > .terminal-cleared-pill')?.remove();
        const pill = document.createElement('div');
        pill.className = 'terminal-cleared-pill';
        pill.innerHTML = '<i class="ph ph-check-circle"></i><span></span>';
        pill.querySelector('span').textContent = message;
        terminal.appendChild(pill);
        requestAnimationFrame(() => pill.classList.add('visible'));
        setTimeout(() => {
            pill.classList.remove('visible');
            setTimeout(() => pill.remove(), 250);
        }, 1100);
    }

    async clearAllTerminals() {
        await Promise.all(
            Object.keys(this.terminals).map((terminalId) => this.clearTerminal(terminalId)),
        );
    }

    /**
     * Synchronous wipe of one terminal's DOM and per-terminal state.
     * Used at the start of a new compilation so the user gets a fresh
     * slate WITHOUT erasing terminals belonging to unrelated steps
     * (e.g. running Wave shouldn't clear the tcmm log from a previous
     * CMM compile). Sync because the caller is also sync — an async
     * fade would race against the first appendToTerminal of the new
     * run and erase its initial lines.
     */
    clearTerminalImmediate(terminalId) {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;
        terminal.classList.remove('faded-out');
        terminal.innerHTML = '';
        this.currentSessionCards[terminalId] = {};
        this.updatableCards[terminalId] = {};
        this.messageCounts[terminalId] = {
            error: 0,
            warning: 0,
            success: 0,
            tips: 0,
        };
    }

    /**
     * Wipes every terminal at once. Use clearTerminalImmediate for the
     * per-step case; this is for Full Build / Run All where every
     * pipeline stage runs and the user wants a clean slate everywhere.
     */
    clearAllTerminalsImmediate() {
        Object.keys(this.terminals).forEach((id) => this.clearTerminalImmediate(id));
    }

    changeClearIcon(clearButton) {
        const icon = clearButton.querySelector('i');
        if (this.clearMode === 'current') {
            this.clearMode = 'all';
            if (icon) icon.className = 'ph ph-broom';
            clearButton.setAttribute('data-tooltip', 'Clear all terminals (right-click: current only)');
        } else {
            this.clearMode = 'current';
            if (icon) icon.className = 'ph ph-trash';
            clearButton.setAttribute('data-tooltip', 'Clear current terminal tab (right-click: all)');
        }
    }

    formatOutput(text) {
        return text
            .split('\n')
            .map(line => {
                const indent = line.match(/^\s*/)[0].length;
                const indentSpaces = '&nbsp;'.repeat(indent);
                return indentSpaces + line.trim();
            })
            .join('<br>');
    }
}

export {
    TerminalManager,
};
