class TerminalManager {
    constructor() {
        this.terminals = {
            tcmm: document.querySelector('#terminal-tcmm .terminal-body'),
            tasm: document.querySelector('#terminal-tasm .terminal-body'),
            tveri: document.querySelector('#terminal-tveri .terminal-body'),
            twave: document.querySelector('#terminal-twave .terminal-body'),
            tprism: document.querySelector('#terminal-tprism .terminal-body'),
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
                badge.style.cssText = `
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    background: var(--${type === 'tips' ? 'info' : type});
                    color: white;
                    border-radius: 50%;
                    min-width: 18px;
                    height: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: bold;
                    padding: 2px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    transition: all 0.2s ease;
                    pointer-events: none;
                `;
                button.style.position = 'relative';
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

        this.messageCounts[terminalId] = {
            error: 0,
            warning: 0,
            success: 0,
            tips: 0
        };

        const entries = terminal.querySelectorAll('.log-entry');
        entries.forEach(entry => {
            if (entry.classList.contains('error')) {
                this.messageCounts[terminalId].error++;
            } else if (entry.classList.contains('warning')) {
                this.messageCounts[terminalId].warning++;
            } else if (entry.classList.contains('success')) {
                this.messageCounts[terminalId].success++;
            } else if (entry.classList.contains('tips') || entry.classList.contains('info')) {
                this.messageCounts[terminalId].tips++;
            }
        });

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

    createOrUpdateCard(terminalId, cardId, lines, type, status = 'running') {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        if (!this.updatableCards[terminalId]) {
            this.updatableCards[terminalId] = {};
        }

        let card = this.updatableCards[terminalId][cardId];
        const timestamp = new Date().toLocaleString('pt-BR', {
            hour12: false
        });

        const contentHTML = lines.map(line => `<div>${line}</div>`).join('');

        if (!card) {
            card = document.createElement('div');
            card.classList.add('log-entry', type);

            card.innerHTML = `
                <span class="timestamp">[${timestamp}]</span>
                <div class="message-content">
                    <div class="message-lines">${contentHTML}</div>
                </div>
            `;

            terminal.appendChild(card);
            this.updatableCards[terminalId][cardId] = card;

            if (['error', 'warning', 'success', 'tips'].includes(type)) {
                this.incrementMessageCount(terminalId, type);
            }

            card.style.opacity = '0';
            requestAnimationFrame(() => {
                card.style.transition = 'opacity 0.3s ease';
                card.style.opacity = '1';
            });

        } else {
            const messageContainer = card.querySelector('.message-lines');
            if (messageContainer) {
                messageContainer.innerHTML = contentHTML;
            }
        }

        card.setAttribute('data-status', status);
        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
        return card;
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

        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
    }

    appendToTerminal(terminalId, content, type = 'info') {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        let text = (typeof content === 'string') ? content : (content.stdout || '') + (content.stderr || '');
        if (!text.trim()) return;

        const lines = text.split('\n').filter(line => line.trim());

        lines.forEach(line => {
            const detectedType = this.detectMessageType(line);

            if (detectedType !== 'plain' || this.verboseMode) {
                const timestamp = new Date().toLocaleString('pt-BR', {
                    hour12: false
                });
                this.createLogEntry(terminal, line.trim(), type, timestamp);
            }
        });

        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
    }

    applyFilter(terminalId) {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        const cards = terminal.querySelectorAll('.log-entry');
        const hasActiveFilters = this.activeFilters.size > 0;

        cards.forEach(card => {
            const hasLineLinks = card.querySelector('.line-link') !== null;

            if (hasLineLinks) {
                card.style.display = '';
                return;
            }

            if (!this.verboseMode && card.classList.contains('plain')) {
                card.style.display = 'none';
                return;
            }

            if (!hasActiveFilters) {
                card.style.display = '';
                return;
            }

            const shouldShow = [...this.activeFilters].some(filter => card.classList.contains(filter));

            if (shouldShow) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
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
        window.electronAPI.onTerminalLog((event, terminal, message, type = 'info') => {
            this.appendToTerminal(terminal, message, type);
        });
    }

    setupTerminalTabs() {
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

        if (text.includes('Atenção') || text.includes('Warning')) return 'warning';
        if (text.includes('Erro') || text.includes('ERROR')) return 'error';
        if (text.includes('Sucesso') || text.includes('Success')) return 'success';
        if (text.includes('Info') || text.includes('Tip')) return 'tips';
        if (text.includes('não está sendo usada') || text.includes('Economize memória')) return 'tips';
        if (text.includes('de sintaxe') || text.includes('cadê a função')) return 'error';

        return 'plain';
    }

    makeLineNumbersClickable(text) {
        return text.replace(/\b(?:linha|line)\s+(\d+)/gi, (match, lineNumber) => {
            return `<span title="Opa. Bão?" class="line-link" data-line="${lineNumber}" ` +
                `style="cursor: pointer; text-decoration: none; filter: brightness(1.4);">` +
                `${match}</span>`;
        });
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

            if (['error', 'warning', 'success', 'tips'].includes(type)) {
                this.incrementMessageCount(terminalId, type);
            }
        }

        this.addMessageToCard(card, text, type);
    }

    createGroupedCard(terminal, type, timestamp) {
        const logEntry = document.createElement('div');
        logEntry.classList.add('log-entry', type);

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

        logEntry.style.opacity = '0';
        logEntry.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            logEntry.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            logEntry.style.opacity = '1';
            logEntry.style.transform = 'translateY(0)';
        });

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

        const lineLinks = messageDiv.querySelectorAll('.line-link');
        lineLinks.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineNumber = parseInt(link.getAttribute('data-line'));
                console.log(`Clicked on line ${lineNumber}`);

                try {
                    let cmmFilePath = null;

                    if (window.compilationManager?.getCurrentProcessor) {
                        const currentProcessor = window.compilationManager.getCurrentProcessor();
                        if (currentProcessor) {
                            try {
                                const selectedCmmFile = await window.compilationManager.getSelectedCmmFile(currentProcessor);
                                if (selectedCmmFile) {
                                    const projectPath = window.compilationManager.projectPath;
                                    const softwarePath = await window.electronAPI.joinPath(projectPath, currentProcessor.name, 'Software');
                                    cmmFilePath = await window.electronAPI.joinPath(softwarePath, selectedCmmFile);
                                }
                            } catch (error) {
                                console.log('Error getting CMM file from compilation manager:', error);
                            }
                        }
                    }

                    if (!cmmFilePath) {
                        const terminalContent = card.closest('.terminal-content');
                        if (terminalContent) {
                            const logEntries = terminalContent.querySelectorAll('.log-entry');

                            for (const entry of Array.from(logEntries).reverse()) {
                                const entryText = entry.textContent || '';

                                const cmmCompMatch = entryText.match(/cmmcomp\.exe["\s]+([^\s"]+\.cmm)\s+([^\s"]+)\s+"([^"]+)"/);
                                if (cmmCompMatch) {
                                    const cmmFileName = cmmCompMatch[1];
                                    const processorName = cmmCompMatch[2];
                                    const projectPath = cmmCompMatch[3];

                                    cmmFilePath = await window.electronAPI.joinPath(projectPath, 'Software', cmmFileName);
                                    break;
                                }
                            }
                        }
                    }

                    if (!cmmFilePath) {
                        console.log('Could not determine CMM file path');
                        return;
                    }

                    const fileExists = await window.electronAPI.fileExists(cmmFilePath);
                    if (!fileExists) {
                        console.log(`CMM file does not exist: ${cmmFilePath}`);
                        return;
                    }

                    const isFileOpen = TabManager.tabs.has(cmmFilePath);

                    if (!isFileOpen) {
                        const content = await window.electronAPI.readFile(cmmFilePath, {
                            encoding: 'utf8'
                        });
                        TabManager.addTab(cmmFilePath, content);
                    } else {
                        TabManager.activateTab(cmmFilePath);
                    }

                    setTimeout(() => {
                        this.goToLine(lineNumber);
                    }, 100);

                } catch (error) {
                    console.error('Error opening CMM file and navigating to line:', error);
                }
            });
        });

        messagesContainer.appendChild(messageDiv);
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
        logEntry.classList.add('log-entry', type);

        const timestampElement = document.createElement('span');
        timestampElement.classList.add('timestamp');
        timestampElement.textContent = `[${timestamp}]`;

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        let processedText = this.makeLineNumbersClickable(text);
        processedText = processedText.replace(
            /^(Atenção|Erro|Sucesso|Info)(:)?/i, (_, word, colon) => `<strong>${word}</strong>${colon || ''}`
        );
        messageContent.innerHTML = processedText;

        logEntry.appendChild(timestampElement);
        logEntry.appendChild(messageContent);
        terminal.appendChild(logEntry);

        const lineLinks = messageContent.querySelectorAll('.line-link');
        lineLinks.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineNumber = parseInt(link.getAttribute('data-line'));
                console.log(`Clicked on line ${lineNumber}`);

                try {
                    let cmmFilePath = null;

                    if (window.compilationManager?.getCurrentProcessor) {
                        const currentProcessor = window.compilationManager.getCurrentProcessor();
                        if (currentProcessor) {
                            try {
                                const selectedCmmFile = await window.compilationManager.getSelectedCmmFile(currentProcessor);
                                if (selectedCmmFile) {
                                    const projectPath = window.compilationManager.projectPath;
                                    const softwarePath = await window.electronAPI.joinPath(projectPath, currentProcessor.name, 'Software');
                                    cmmFilePath = await window.electronAPI.joinPath(softwarePath, selectedCmmFile);
                                }
                            } catch (error) {
                                console.log('Error getting CMM file from compilation manager:', error);
                            }
                        }
                    }

                    if (!cmmFilePath) {
                        const terminalContent = logEntry.closest('.terminal-content');
                        if (terminalContent) {
                            const logEntries = terminalContent.querySelectorAll('.log-entry');

                            for (const entry of Array.from(logEntries).reverse()) {
                                const entryText = entry.textContent || '';

                                const cmmCompMatch = entryText.match(/cmmcomp\.exe["\s]+([^\s"]+\.cmm)\s+([^\s"]+)\s+"([^"]+)"/);
                                if (cmmCompMatch) {
                                    const cmmFileName = cmmCompMatch[1];
                                    const processorName = cmmCompMatch[2];
                                    const projectPath = cmmCompMatch[3];

                                    cmmFilePath = await window.electronAPI.joinPath(projectPath, 'Software', cmmFileName);
                                    break;
                                }
                            }
                        }
                    }

                    if (!cmmFilePath) {
                        console.log('Could not determine CMM file path');
                        return;
                    }

                    const fileExists = await window.electronAPI.fileExists(cmmFilePath);
                    if (!fileExists) {
                        console.log(`CMM file does not exist: ${cmmFilePath}`);
                        return;
                    }

                    const isFileOpen = TabManager.tabs.has(cmmFilePath);

                    if (!isFileOpen) {
                        const content = await window.electronAPI.readFile(cmmFilePath, {
                            encoding: 'utf8'
                        });
                        TabManager.addTab(cmmFilePath, content);
                    } else {
                        TabManager.activateTab(cmmFilePath);
                    }

                    setTimeout(() => {
                        this.goToLine(lineNumber);
                    }, 100);

                } catch (error) {
                    console.error('Error opening CMM file and navigating to line:', error);
                }
            });
        });

        const messageType = type === 'info' ? 'tips' : type;
        if (['error', 'warning', 'success', 'tips'].includes(messageType)) {
            this.incrementMessageCount(terminal.closest('.terminal-content').id.replace('terminal-', ''), messageType);
        }

        logEntry.style.opacity = '0';
        logEntry.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            logEntry.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            logEntry.style.opacity = '1';
            logEntry.style.transform = 'translateY(0)';
        });
    }

    setupGoDownButton() {
        const goDownButton = document.getElementById('godown-terminal');
        const goUpButton = document.getElementById('goup-terminal');

        if (!goDownButton && !goUpButton) return;

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

    clearTerminal(terminalId) {
        const terminal = this.terminals[terminalId];
        if (terminal) {
            terminal.innerHTML = '';
            this.currentSessionCards[terminalId] = {};
        }
    }

    clearAllTerminals() {
        Object.keys(this.terminals)
            .forEach(terminalId => {
                this.clearTerminal(terminalId);
            });
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

class VVPProgressManager {
    constructor() {
        this.overlay = null;
        this.progressFill = null;
        this.progressPercentage = null;
        this.elapsedTimeElement = null;
        this.elapsedTimeMinimizedElement = null;
        this.isVisible = false;
        this.isMinimized = false;
        this.isComplete = false;
        this.progressPath = null;
        this.startTime = null;
        this.currentProgress = 0;
        this.targetProgress = 0;
        this.animationFrame = null;
        this.readInterval = null;
        this.timeUpdateInterval = null;
        this.minimizeTimeout = null;

        this.interpolationSpeed = 0.08;
        this.readIntervalMs = 1000;
        this.autoMinimizeDelayMs = 5000;
        this.completionDelayMs = 3000;
    }

    async resolveProgressPath(name) {
        const toggleBtn = document.getElementById('toggle-ui');
        const useFlat = toggleBtn && toggleBtn.classList.contains('active');

        if (useFlat) {
            return await window.electronAPI.joinPath('components', 'Temp', 'progress.txt');
        } else {
            return await window.electronAPI.joinPath('components', 'Temp', name, 'progress.txt');
        }
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

    async show(name) {
        if (this.isVisible) return;

        try {
            await this.deleteProgressFile(name);
            this.progressPath = await this.resolveProgressPath(name);

            if (!this.overlay) this.createOverlay();

            this.currentProgress = 0;
            this.targetProgress = 0;
            this.startTime = Date.now();
            this.isMinimized = false;
            this.isComplete = false;
            this.overlay.querySelector('.vvp-progress-info').classList.remove('vvp-complete');
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
        this.isVisible = false;

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
              <span>VVP Simulation</span>
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
          </div>
          
          <div class="vvp-progress-stats">
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
        const readProgress = async () => {
            if (!this.isVisible || this.isComplete) return;

            try {
                if (await window.electronAPI.fileExists(this.progressPath)) {
                    const content = await window.electronAPI.readFile(this.progressPath);
                    const lines = content.split('\n').filter(line => line.trim());

                    if (lines.length > 0) {
                        const progress = parseInt(lines[lines.length - 1].trim(), 10);

                        if (!isNaN(progress) && progress >= 0) {
                            this.targetProgress = Math.min(progress, 100);

                            if (this.targetProgress >= 100) {
                                clearInterval(this.readInterval);
                                this.readInterval = null;
                            }
                        }
                    }
                }
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

        setTimeout(() => {
            this.hide();
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

function showVVPProgress(name) {
    vvpProgressManager.deleteProgressFile(name);
    return vvpProgressManager.show(name);
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