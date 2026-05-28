import { TabManager } from '../tabs/tab_manager.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { showCardNotification } from '../ui/notification.js';


class TerminalManager {
    constructor() {
        this.terminals = {
            tcmm: document.querySelector('#terminal-tcmm .terminal-body'),
            tasm: document.querySelector('#terminal-tasm .terminal-body'),
            tveri: document.querySelector('#terminal-tveri .terminal-body'),
            twave: document.querySelector('#terminal-twave .terminal-body'),
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
        this.setupGoDownButton();
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
        const terminal = this.terminals[terminalId];
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


    processExecutableOutput(terminalId, result) {
        const terminal = this.terminals[terminalId];
        if (!terminal || (!result.stdout && !result.stderr)) {
            return;
        }

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
        this.recountMessages(terminalId);
        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
    }

    processStreamedLine(terminalId, line) {
        const terminal = this.terminals[terminalId];
        if (!terminal || !line) return;

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
        // double-counting from interleaved increment sites.
        this.recountMessages(terminalId);
        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
    }

    appendToTerminal(terminalId, content, type = 'info', options = {}) {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        let text = (typeof content === 'string') ? content : (content.stdout || '') + (content.stderr || '');
        if (!text.trim()) return;

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
        // processExecutableOutput for the rationale).
        this.recountMessages(terminalId);
        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
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
        const terminal = this.terminals[terminalId];
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
        window.electronAPI.onTerminalLog((event, terminal, message, type = 'info') => {
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
        const terminal = this.terminals[terminalId];
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
                                            filePath = await window.electronAPI.joinPath(pMatch[1], 'Software', iMatch[1]);
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

                    const fileExists = await window.electronAPI.fileExists(filePath);
                    if (!fileExists) {
                        console.log(`File does not exist: ${filePath}`);
                        return;
                    }

                    const isFileOpen = TabManager.tabs.has(filePath);

                    if (!isFileOpen) {
                        const content = await window.electronAPI.readFile(filePath, {
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

    setupGoDownButton() {
        // Bind once — see setupTerminalTabs. Without the guard every
        // `new TerminalManager()` re-added the scroll-button handlers AND
        // four document-level listeners (mouseup/touchend/mouseleave/
        // touchcancel) that were never removed, accumulating on `document`.
        if (TerminalManager.goDownButtonInitialized) return;
        const goDownButton = document.getElementById('godown-terminal');
        const goUpButton = document.getElementById('goup-terminal');

        if (!goDownButton && !goUpButton) return;
        TerminalManager.goDownButtonInitialized = true;

        let isScrolling = false;
        let animationFrameId = null;
        const STEP = 200;

        const startScrolling = (direction, e) => {
            if (e.type === 'touchstart') e.preventDefault();
            if (isScrolling) return;
            isScrolling = true;

            const activeTab = document.querySelector('.terminal-tabs .tab.active');
            if (!activeTab) return;
            const termId = activeTab.getAttribute('data-terminal');
            const terminal = this.terminals[termId];
            if (!terminal) return;

            const scrollLoop = () => {
                if (!isScrolling) return;

                const maxScroll = terminal.scrollHeight - terminal.clientHeight;
                let next = terminal.scrollTop + direction;
                next = Math.max(0, Math.min(next, maxScroll));
                terminal.scrollTop = next;

                if ((direction > 0 && next < maxScroll) || (direction < 0 && next > 0)) {
                    animationFrameId = requestAnimationFrame(scrollLoop);
                } else {
                    isScrolling = false;
                }
            };

            animationFrameId = requestAnimationFrame(scrollLoop);
        };

        const stopScrolling = () => {
            cancelAnimationFrame(animationFrameId);
            isScrolling = false;
        };

        if (goDownButton) {
            goDownButton.addEventListener('mousedown', e => startScrolling(+STEP, e));
            goDownButton.addEventListener('touchstart', e => startScrolling(+STEP, e), {
                passive: false
            });
        }
        if (goUpButton) {
            goUpButton.addEventListener('mousedown', e => startScrolling(-STEP, e));
            goUpButton.addEventListener('touchstart', e => startScrolling(-STEP, e), {
                passive: false
            });
        }

        document.addEventListener('mouseup', stopScrolling);
        document.addEventListener('touchend', stopScrolling);
        document.addEventListener('mouseleave', stopScrolling);
        document.addEventListener('touchcancel', stopScrolling);
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
            const api = window.electronAPI;
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

        clearButton.removeEventListener('click', this.handleClearClick);
        clearButton.removeEventListener('contextmenu', this.handleClearContextMenu);

        this.handleClearClick = (event) => {
            if (event.button === 0) {
                const icon = clearButton.querySelector('i');
                if (icon.classList.contains('fa-trash-can')) {
                    const activeTab = document.querySelector('.terminal-tabs .tab.active');
                    if (activeTab) {
                        const terminalId = activeTab.getAttribute('data-terminal');
                        this.clearTerminal(terminalId);
                    }
                } else if (icon.classList.contains('fa-dumpster')) {
                    this.clearAllTerminals();
                }
            }
        };

        this.handleClearContextMenu = (event) => {
            event.preventDefault();
            if (event.button === 2) {
                setTimeout(() => {
                    this.changeClearIcon(clearButton);
                }, 50);
            }
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

    scrollToBottom(terminalId) {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        requestAnimationFrame(() => {
            terminal.scrollTop = terminal.scrollHeight;

            setTimeout(() => {
                terminal.scrollTop = terminal.scrollHeight;
            }, 100);
        });
    }

async clearTerminal(terminalId) {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        // 1. Inicia o Fade Out do container inteiro
        terminal.classList.add('faded-out');

        // 2. Aguarda a animação CSS terminar (200ms definido no CSS)
        // Damos uma pequena folga (250ms) para garantir fluidez
        await new Promise(resolve => setTimeout(resolve, 250));

        // 3. Limpa os dados lógicos
        this.currentSessionCards[terminalId] = {};
        this.updatableCards[terminalId] = {};
        
        // 4. Limpa o DOM (o usuário não vê isso acontecer pois opacity está 0)
        terminal.innerHTML = '';
        
        // Mantemos a classe 'faded-out' aqui! 
        // Ela só será removida quando novo conteúdo for adicionado.
    }

    clearAllTerminals() {
        Object.keys(this.terminals)
            .forEach(terminalId => {
                this.clearTerminal(terminalId);
            });
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
        const terminal = this.terminals[terminalId];
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
        if (icon.classList.contains('fa-trash-can')) {
            icon.classList.remove('fa-trash-can');
            icon.classList.add('fa-dumpster');
            clearButton.setAttribute('titles', 'Clear All Terminals');
        } else {
            icon.classList.remove('fa-dumpster');
            icon.classList.add('fa-trash-can');
            clearButton.setAttribute('titles', 'Clear Terminal');
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

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ${units[i]}`;
}

class VVPProgressManager {
    constructor() {
        this.overlay = null;
        this.progressFill = null;
        this.progressPercentage = null;
        this.elapsedTimeElement = null;
        this.elapsedTimeMinimizedElement = null;
        this.fstSizeElement = null;
        this.fstSizeMinimizedElement = null;
        this.isVisible = false;
        this.isMinimized = false;
        this.isComplete = false;
        this.progressPath = null;
        this.fstDir = null;
        this.startTime = null;
        this.currentProgress = 0;
        this.targetProgress = 0;
        this.animationFrame = null;
        this.readInterval = null;
        this.timeUpdateInterval = null;
        this.minimizeTimeout = null;
        this.opts = {};

        this.interpolationSpeed = 0.08;
        this.readIntervalMs = 1000;
        this.autoMinimizeDelayMs = 5000;
        this.completionDelayMs = 2000;
        this._hideRequested = false;
    }

    async resolveProgressPath(_name) {
        // Modo unico: vvp roda em components/Temp/ direto, e o
        // testbench gerado pelo asmcomp escreve `progress.txt` no
        // CWD do vvp — sempre flat. O ramo "Temp/<name>/progress.txt"
        // era do modo Processor antigo (removido em mai/2026).
        //
        // Usa getComponentsPath() em vez de joinPath('components',...)
        // porque o `'components'` no joinPath tem um special-case
        // (main/ipc/system.js) que prepende `rootPath` =
        // appRoot/../.. — correto em build empacotado mas em DEV
        // resolve dois niveis acima do aurora-root, ou seja `c:/components/...`,
        // que nao existe. vvp escreve no caminho absoluto certo
        // (componentsPath/Temp/progress.txt) entao precisamos do
        // absoluto aqui pra bater.
        const componentsPath = await window.electronAPI.getComponentsPath();
        return await window.electronAPI.joinPath(componentsPath, 'Temp', 'progress.txt');
    }

    async resolveFstDir() {
        // vvp -fst escreve em components/Temp/. O nome do arquivo
        // depende do $dumpfile() do testbench — pra auto-instrumentado
        // e' <simTopModule>.fst, mas se o usuario escreveu
        // $dumpfile("outro.vcd") a mao o nome muda. Em vez de adivinhar
        // o nome, devolvemos so o dir e o poll escaneia por *.fst.
        const componentsPath = await window.electronAPI.getComponentsPath();
        return await window.electronAPI.joinPath(componentsPath, 'Temp');
    }

    async deleteProgressFile(name) {
        try {
            const pathToDelete = await this.resolveProgressPath(name);
            if (await window.electronAPI.fileExists(pathToDelete)) {
                await window.electronAPI.deleteFileOrDirectory(pathToDelete);
            }
            return true;
        } catch (err) {
            console.error('Failed to delete progress file:', err);
            return false;
        }
    }

    async show(name, opts = {}) {
        if (this.isVisible) return;

        // opts (modo Verilator-processador): title, readsLabel (mostra o
        // 2o token de progress.txt como stat "Leituras"), hideFst.
        this.opts = opts || {};

        try {
            await this.deleteProgressFile(name);
            this.progressPath = await this.resolveProgressPath(name);
            this.fstDir = await this.resolveFstDir();

            if (!this.overlay) this.createOverlay();

            // Aplica customizacao por modo (title / FST / stat extra).
            if (this.titleTextElement) this.titleTextElement.textContent = this.opts.title || 'VVP Simulation';
            if (this.fstStatElement) this.fstStatElement.style.display = this.opts.hideFst ? 'none' : '';
            // FST minimizado (compacto): esconde no modo processador.
            if (this.fstSizeMinimizedElement) this.fstSizeMinimizedElement.style.display = this.opts.hideFst ? 'none' : '';
            if (this.extraStatElement) {
                if (this.opts.readsLabel) {
                    this.extraLabelElement.textContent = `${this.opts.readsLabel}:`;
                    this.extraValueElement.textContent = '0';
                    this.extraStatElement.style.display = '';
                } else {
                    this.extraStatElement.style.display = 'none';
                }
            }
            // Indicador compacto de leituras (visivel quando minimizado).
            if (this.readsMinimizedElement) {
                if (this.opts.readsLabel) {
                    this.readsMinimizedElement.textContent = '0';
                    this.readsMinimizedElement.title = this.opts.readsLabel;
                    this.readsMinimizedElement.style.display = '';
                } else {
                    this.readsMinimizedElement.style.display = 'none';
                }
            }

            this.currentProgress = 0;
            this.targetProgress = 0;
            this.startTime = Date.now();
            this.isMinimized = false;
            this.isComplete = false;
            this._hideRequested = false;
            this.overlay.querySelector('.vvp-progress-info').classList.remove('vvp-complete');
            if (this.fstSizeElement) this.fstSizeElement.textContent = '—';
            if (this.fstSizeMinimizedElement) this.fstSizeMinimizedElement.textContent = '—';
            this.updateUI();

            this.overlay.classList.add('vvp-progress-visible');
            this.isVisible = true;

            this.resetMinimizeTimeout();

            this.startProgressReading();
            this.startAnimationLoop();
            this.startTimeCounter();

        } catch (error) {
            console.error('Error showing VVP progress:', error);
        }
    }

    hide() {
        if (!this.isVisible) return;

        // If bar hasn't reached 100% yet, queue the hide — completion will trigger it
        if (!this.isComplete) {
            this._hideRequested = true;
            // Force the bar to target 100% so it finishes visually
            this.targetProgress = 100;
            return;
        }

        this._doHide();
    }

    _doHide() {
        if (!this.isVisible) return;
        this.isVisible = false;
        this._hideRequested = false;

        clearTimeout(this.minimizeTimeout);
        clearInterval(this.readInterval);
        clearInterval(this.timeUpdateInterval);
        cancelAnimationFrame(this.animationFrame);

        this.minimizeTimeout = null;
        this.readInterval = null;
        this.timeUpdateInterval = null;
        this.animationFrame = null;

        if (this.overlay) {
            this.overlay.classList.remove('vvp-progress-visible');
        }
    }

    minimize() {
        if (!this.overlay || this.isMinimized) return;
        this.isMinimized = true;
        this.overlay.classList.add('minimized');
        clearTimeout(this.minimizeTimeout);
    }

    maximize() {
        if (!this.overlay || !this.isMinimized) return;
        this.isMinimized = false;
        this.overlay.classList.remove('minimized');
        this.resetMinimizeTimeout();
    }

    resetMinimizeTimeout() {
        clearTimeout(this.minimizeTimeout);
        this.minimizeTimeout = setTimeout(() => this.minimize(), this.autoMinimizeDelayMs);
    }

    createOverlay() {
        const overlayHTML = `
      <div class="vvp-progress-overlay">
        <div class="vvp-progress-info">
          <div class="vvp-progress-header">
            <div class="vvp-progress-title">
              <div class="icon-spinner"></div>
              <span id="vvp-progress-title-text">VVP Simulation</span>
            </div>
            <div class="vvp-progress-controls">
              <button class="vvp-progress-control-btn" id="vvp-minimize-btn" title="Minimize">
                <i class="fas fa-minus"></i>
              </button>
              <button class="vvp-progress-control-btn" id="vvp-maximize-btn" title="Maximize">
                <i class="fas fa-clone"></i>
              </button>
            </div>
          </div>
          
          <div class="vvp-progress-bar-wrapper">
            <div class="vvp-progress-bar">
              <div class="vvp-progress-fill" id="vvp-progress-fill"></div>
            </div>
            <div class="vvp-progress-percentage" id="vvp-progress-percentage">0%</div>
            <span class="vvp-progress-time-minimized" id="vvp-time-minimized">0s</span>
            <span class="vvp-progress-fst-minimized" id="vvp-fst-minimized">—</span>
            <span class="vvp-progress-reads-minimized" id="vvp-reads-minimized" style="display:none">0</span>
          </div>
          
          <div class="vvp-progress-stats">
            <div class="vvp-stat" id="vvp-fst-stat">
              <span class="vvp-stat-label">FST Size:</span>
              <span class="vvp-stat-value" id="vvp-fst-size">—</span>
            </div>
            <div class="vvp-stat" id="vvp-extra-stat" style="display:none">
              <span class="vvp-stat-label" id="vvp-extra-label">—</span>
              <span class="vvp-stat-value" id="vvp-extra-value">0</span>
            </div>
            <div class="vvp-stat">
              <span class="vvp-stat-label">Elapsed Time:</span>
              <span class="vvp-stat-value" id="vvp-elapsed-time">0s</span>
            </div>
          </div>
        </div>
      </div>
    `;

        const targetElement = document.getElementById('terminal-twave') || document.body;
        targetElement.insertAdjacentHTML(targetElement.id === 'terminal-twave' ? 'afterend' : 'beforeend', overlayHTML);

        this.overlay = document.querySelector('.vvp-progress-overlay');
        this.progressFill = document.getElementById('vvp-progress-fill');
        this.progressPercentage = document.getElementById('vvp-progress-percentage');
        this.elapsedTimeElement = document.getElementById('vvp-elapsed-time');
        this.elapsedTimeMinimizedElement = document.getElementById('vvp-time-minimized');
        this.fstSizeElement = document.getElementById('vvp-fst-size');
        this.fstSizeMinimizedElement = document.getElementById('vvp-fst-minimized');
        this.titleTextElement = document.getElementById('vvp-progress-title-text');
        this.fstStatElement = document.getElementById('vvp-fst-stat');
        this.extraStatElement = document.getElementById('vvp-extra-stat');
        this.extraLabelElement = document.getElementById('vvp-extra-label');
        this.extraValueElement = document.getElementById('vvp-extra-value');
        this.readsMinimizedElement = document.getElementById('vvp-reads-minimized');

        document.getElementById('vvp-minimize-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.minimize();
        });
        document.getElementById('vvp-maximize-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.maximize();
        });
    }

    async startProgressReading() {
        const readFstSize = async () => {
            if (this.opts && this.opts.hideFst) return; // modo processador: sem FST
            if (!this.fstSizeElement || !this.fstDir) return;
            try {
                // vvp -fst grava o dump em components/Temp/, mas o nome
                // e extensao dependem do $dumpfile() do testbench
                // (.fst ou .vcd com bytes FST). Em vez de adivinhar,
                // escaneia a cada tick por .fst/.vcd e pega o maior —
                // eh o que esta sendo escrito ativamente.
                const entries = await window.electronAPI.listFilesInDirectory(this.fstDir);
                if (!Array.isArray(entries) || entries.length === 0) return;
                const candidates = entries.filter((n) => {
                    if (typeof n !== 'string') return false;
                    const lower = n.toLowerCase();
                    return lower.endsWith('.fst') || lower.endsWith('.vcd');
                });
                if (candidates.length === 0) return;
                let biggest = 0;
                for (const name of candidates) {
                    const full = await window.electronAPI.joinPath(this.fstDir, name);
                    try {
                        // getFileSizeLive abre fd + fstat — bypassa o cache
                        // de metadata do diretorio do Windows, que so atualiza
                        // quando o vvp fecha o arquivo. Sem isso, o tamanho
                        // ficaria "preso" durante toda a simulacao e so
                        // saltaria pro valor final no fim.
                        const size = await window.electronAPI.getFileSizeLive(full);
                        if (typeof size === 'number' && size > biggest) {
                            biggest = size;
                        }
                    } catch (_statErr) { /* skip */ }
                }
                if (biggest > 0) {
                    const formatted = formatBytes(biggest);
                    this.fstSizeElement.textContent = formatted;
                    if (this.fstSizeMinimizedElement) {
                        this.fstSizeMinimizedElement.textContent = formatted;
                    }
                }
            } catch (_e) {
                // Silencioso — tamanho e info auxiliar.
            }
        };

        const readProgress = async () => {
            if (!this.isVisible || this.isComplete) return;

            try {
                if (await window.electronAPI.fileExists(this.progressPath)) {
                    const content = await window.electronAPI.readFile(this.progressPath);
                    const lines = content.split('\n').filter(line => line.trim());

                    if (lines.length > 0) {
                        const lastLine = lines[lines.length - 1].trim();
                        const progress = parseInt(lastLine, 10);

                        // 2o token (modo processador): nº de leituras de entrada.
                        if (this.opts && this.opts.readsLabel) {
                            const parts = lastLine.split(/\s+/);
                            if (parts.length > 1 && parts[1] !== '') {
                                if (this.extraValueElement) this.extraValueElement.textContent = parts[1];
                                if (this.readsMinimizedElement) this.readsMinimizedElement.textContent = parts[1];
                            }
                        }

                        if (!isNaN(progress) && progress >= 0) {
                            this.targetProgress = Math.min(progress, 100);

                            if (this.targetProgress >= 100) {
                                // Ultimo stat antes de parar pra cravar
                                // o tamanho final na UI.
                                await readFstSize();
                                clearInterval(this.readInterval);
                                this.readInterval = null;
                                return;
                            }
                        }
                    }
                }
                await readFstSize();
            } catch (error) {
                console.error('Error reading progress file:', error);
                clearInterval(this.readInterval);
                this.readInterval = null;
            }
        };

        await readProgress();

        if (this.targetProgress < 100 && !this.isComplete) {
            this.readInterval = setInterval(readProgress, this.readIntervalMs);
        }
    }

    startAnimationLoop() {
        const animate = () => {
            if (!this.isVisible || this.isComplete) return;

            const diff = this.targetProgress - this.currentProgress;

            if (Math.abs(diff) > 0.01) {
                this.currentProgress += diff * this.interpolationSpeed;
            } else if (this.targetProgress === 100) {
                this.currentProgress = 100;
            }

            this.updateUI();

            if (this.currentProgress >= 99.9 && this.targetProgress >= 100 && !this.isComplete) {
                this.handleCompletion();
                return;
            }

            if (!this.isComplete) {
                this.animationFrame = requestAnimationFrame(animate);
            }
        };

        this.animationFrame = requestAnimationFrame(animate);
    }

    handleCompletion() {
        this.isComplete = true;
        this.currentProgress = 100;
        this.updateUI();

        this.overlay.querySelector('.vvp-progress-info').classList.add('vvp-complete');

        clearTimeout(this.minimizeTimeout);
        clearInterval(this.timeUpdateInterval);

        // Stay at 100% for completionDelayMs (500ms), then fade out
        setTimeout(() => {
            this._doHide();
        }, this.completionDelayMs);
    }


    startTimeCounter() {
        const formatElapsedTime = (seconds) => {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            let timeString = '';

            if (days > 0) {
                timeString += `${days}d `;
                if (hours > 0) timeString += `${hours}h `;
                if (minutes > 0 && days < 2) timeString += `${minutes}m`;
            } else if (hours > 0) {
                timeString += `${hours}h`;
                if (minutes > 0) timeString += `${minutes}m`;
            } else if (minutes > 0) {
                timeString += `${minutes}m`;
                if (secs > 0) timeString += `${secs}s`;
            } else {
                timeString += `${secs}s`;
            }

            return timeString.trim();
        };

        const update = () => {
            if (!this.isVisible) return;
            const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
            const timeString = formatElapsedTime(elapsedSeconds);

            if (this.elapsedTimeElement) this.elapsedTimeElement.textContent = timeString;
            if (this.elapsedTimeMinimizedElement) this.elapsedTimeMinimizedElement.textContent = timeString;
        };

        clearInterval(this.timeUpdateInterval);
        this.timeUpdateInterval = setInterval(update, 1000);
        update();
    }


    updateUI() {
        if (!this.overlay) return;
        const displayProgress = Math.min(100, this.currentProgress);
        this.progressFill.style.width = `${displayProgress}%`;
        this.progressPercentage.textContent = `${Math.floor(displayProgress)}%`;
        this.overlay.classList.toggle('minimized', this.isMinimized);
    }
}

const vvpProgressManager = new VVPProgressManager();

function showVVPProgress(name, opts = {}) {
    vvpProgressManager.deleteProgressFile(name);
    return vvpProgressManager.show(name, opts);
}

function hideVVPProgress(delay = 4000) {
    setTimeout(() => {
        vvpProgressManager.hide();
    }, delay);
}

export {
    TerminalManager,
    showVVPProgress,
    hideVVPProgress
};