import { electronAPI } from '../app/electron_api.js';
import '../components/aurora-terminal.js';
import { switchTerminal, smoothFollowToBottom } from './terminal.js';
import { linhaComLinks, ligarLinks, irParaLinha } from './links_do_terminal.js';
import { tr, formatarBytes } from './texto_do_terminal.js';
import { barraNoTerminal, atualizarBarra, derrubarBarra, formatarEta } from './barra_de_progresso.js';
import { exportarLog } from './exportar_log.js';
import {
    tipoDaMensagem, contarMensagens, aplicarFiltro, semRuidoDoGtkwave,
} from './classificacao_do_terminal.js';

// Hard cap on retained `.log-entry` nodes per terminal body. A streaming
// compile (Verilator/iverilog dumping thousands of lines) appends one node
// per line with no upper bound, the DOM grows without limit, memory climbs,
// and every recount / filter / scroll pass gets slower until the panel janks.
// We keep the most-recent N entries and drop the oldest from the top. Counts
// (recountMessages) run from DOM truth after trimming, so the badges reflect
// the retained window, the right semantics for a live scrollback console.
const MAX_TERMINAL_ENTRIES = 5000;

// Companion cap for GROUPED cards: the per-terminal cap above counts
// `.log-entry` nodes, but a grouped card is ONE entry that can accrete an
// unbounded number of `.grouped-message` children (e.g. a build spewing
// thousands of same-type warnings into a single group). Trim the oldest
// grouped lines past this limit so one card can't grow without bound.
const MAX_GROUPED_MESSAGES = 5000;

import type { BarraDeProgresso, Progresso } from './barra_de_progresso.js';
import type { Contagem } from './classificacao_do_terminal.js';

/** O pill do tamanho do dump, com o span do texto pendurado nele. */
interface PillDoDump extends HTMLDivElement { _text: HTMLElement }

/** Os elementos que se atualizam no lugar, por terminal. */
interface CartoesVivos { hwProgress?: BarraDeProgresso | null; dumpSize?: PillDoDump | null }

/** Uma resposta de executavel. */
interface SaidaDeExecutavel { stdout?: string | null; stderr?: string | null }

type ArgsDoAppend = [string, string | SaidaDeExecutavel, string, { internal?: boolean }];

class TerminalManager {
    static clearButtonInitialized?: boolean;
    static exportLogButtonInitialized?: boolean;
    static terminalLogListenerInitialized?: boolean;
    static terminalTabsInitialized?: boolean;
    static autoScrollInitialized?: boolean;

    terminals: Record<string, HTMLElement | null>;
    messageCounts: Record<string, Contagem>;
    updatableCards: Record<string, CartoesVivos | null>;
    currentSessionCards: Record<string, Record<string, HTMLElement>>;
    activeFilters: Set<string>;
    verboseMode: boolean;
    clearMode?: 'current' | 'all';
    handleClearClick?: (event: MouseEvent) => Promise<void>;
    handleClearContextMenu?: (event: MouseEvent) => void;
    /** Enquanto um terminal esvaece para limpar, o que chega espera aqui. */
    _clearingQueues?: Map<string, ArgsDoAppend[]>;
    /** A ultima linha de cada terminal, para agrupar a repeticao imediata. */
    _ultimaLinha?: Map<string, { text: string; type: string; el: HTMLElement; count: number }>;
    _refreshPending?: Set<string>;
    _countTimers?: Map<string, ReturnType<typeof setTimeout>>;

    constructor() {
        this.terminals = {
            tcmm: document.querySelector('#terminal-tcmm .terminal-body'),
            tasm: document.querySelector('#terminal-tasm .terminal-body'),
            tveri: document.querySelector('#terminal-tveri .terminal-body'),
            twave: document.querySelector('#terminal-twave .terminal-body'),
            // THTEST, Terminal Hardware Test: etapas + barra de progresso do
            // botao Verilator (processador CMM). Ver renderHardwareProgress.
            thtest: document.querySelector('#terminal-thtest .terminal-body'),
            // TPRISM: sintese do esquematico. Saia no TVERI e disputava a
            // tela com o Build; ver o comentario da aba no index.html.
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

    /**
     * Desligado de fabrica.
     *
     * Ligado, o terminal mostra a linha de comando inteira de cada passo,
     * cinco linhas de caminhos absolutos antes de qualquer mensagem util. E
     * o que todo aluno via na primeira compilacao. O que importa (erros,
     * avisos, sucesso, dicas e a saida da propria ferramenta) nunca passa
     * pelo filtro; o que ele esconde e so o eco do comando e as notas de
     * fase, que existem para quem esta depurando a AURORA, e essa pessoa
     * sabe onde fica o interruptor. Quem ja escolheu mantem a escolha.
     */
    loadVerboseMode() {
        const saved = localStorage.getItem('terminal-verbose-mode');
        return saved !== null ? JSON.parse(saved) : false;
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
        const counts = this.messageCounts[terminalId as string] || {
            error: 0,
            warning: 0,
            success: 0,
            tips: 0
        };

        const updateBadge = (type: string, count: number) => {
            const buttonId = type === 'tips' ? 'filter-tip' : `filter-${type}`;
            const button = document.getElementById(buttonId);

            if (button) {
                const badge = button.querySelector('.message-counter') as HTMLElement | null;
                if (badge) {
                    const oldCount = parseInt(badge.textContent as string, 10) || 0;
                    badge.textContent = String(count);
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

    incrementMessageCount(terminalId: string, type: string): void {
        const contagem = this.messageCounts[terminalId] as unknown as Record<string, number> | undefined;
        if (contagem && contagem[type] !== undefined) {
            contagem[type]++;
            this.updateCounterDisplay();
        }
    }

    resetMessageCounts(terminalId: string): void {
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

    recountMessages(terminalId: string): void {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;
        this.messageCounts[terminalId] = contarMensagens(terminal);
        this.updateCounterDisplay();
    }


    saveVerboseMode() {
        localStorage.setItem('terminal-verbose-mode', JSON.stringify(this.verboseMode));
    }

    setupVerboseToggle() {
        const verboseToggle = document.getElementById('verbose-toggle') as HTMLInputElement | null;
        if (verboseToggle) {
            verboseToggle.checked = this.verboseMode;
            verboseToggle.addEventListener('change', (e) => {
                this.verboseMode = (e.target as HTMLInputElement).checked;
                this.saveVerboseMode();
                this.applyFilterToAllTerminals();
            });
        }
    }

    resetSessionCards(terminalId: string): void {
        if (this.currentSessionCards[terminalId]) {
            this.currentSessionCards[terminalId] = {};
        }
    }


    /**
     * Bring `terminalId`'s tab to the front so the user always sees the
     * terminal that is actively receiving compiler output. Wired only into
     * the streamed/executable output paths, those carry real command
     * output, so following them never yanks focus for a stray info/AI card.
     *
     * Fixes the "always one terminal ahead (empty)" complaint: a build runs
     * cmm → asm → verilog/wave, each writing to its own tab, but the view
     * used to sit on the destination tab while the work happened (invisibly)
     * in the earlier ones. Now the view tracks wherever output is landing.
     *
     * No-op when that tab is already active (cheap guard, a streaming step
     * calls this once per line, so only the first line of a new terminal
     * actually moves the DOM).
     */
    revealActiveOutputTerminal(terminalId: string): void {
        const tab = document.querySelector(`.terminal-tabs .tab[data-terminal="${terminalId}"]`);
        if (!tab || tab.classList.contains('active')) return;
        // Delegate to switchTerminal so the shared sliding indicator follows the
        // output as a compilation moves between phases. (This used to set the
        // .active class directly, which left the accent bar behind, the
        // "the purple bar should move during compilations too" report.)
        switchTerminal(`terminal-${terminalId}`);
    }

    /**
     * Elemento .terminal-body vivo de um terminal, re-consultando o DOM se a
     * referencia em cache for nula ou estiver destacada. `this.terminals` foi
     * capturado uma unica vez no construtor (document.querySelector); se o
     * singleton nasceu antes do DOM do terminal existir, a referencia ficava
     * nula PRA SEMPRE e toda escrita era engolida pelo `if (!terminal) return`
     *, o sintoma "a IA compila mas o terminal (vazio) nunca recebe nada".
     * Re-consultar torna a escrita resiliente a ordem de init e a qualquer
     * reconstrucao do painel.
     */
    _resolveTerminal(terminalId: string): HTMLElement | null {
        let el = this.terminals[terminalId];
        if (!el || !el.isConnected) {
            el = document.querySelector(`#terminal-${terminalId} .terminal-body`);
            if (el) this.terminals[terminalId] = el;
        }
        return el || null;
    }

    processExecutableOutput(terminalId: string, result: SaidaDeExecutavel): void {
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

    processStreamedLine(terminalId: string, line: string): void {
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

        // See processExecutableOutput, recount per batch beats the
        // double-counting from interleaved increment sites. Coalesced: a
        // streaming compile calls this once per line, so the O(n) recount +
        // filter + scroll must batch to one pass per frame, not per line.
        this._scheduleTerminalRefresh(terminalId);
    }

    appendToTerminal(terminalId: string, content: string | SaidaDeExecutavel, type = 'info', options: { internal?: boolean } = {}): void {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;

        // Mid-clear: park it, clearTerminal replays it after the wipe.
        const parked = this._clearingQueues?.get(terminalId);
        if (parked) { parked.push([terminalId, content, type, options]); return; }

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
            // 'raw' bypasses semantic detection entirely, caller wants
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
            // over the caller's intent, that's how compiler stdout gets
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


    applyFilter(terminalId: string): void {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;
        aplicarFiltro(terminal, this.activeFilters, this.verboseMode);
    }

    filterGtkWaveOutput(result: SaidaDeExecutavel) { return semRuidoDoGtkwave(result); }

    setupTerminalLogListener() {
        // Module-level guard, every `new TerminalManager()` used to
        // register its own ipcRenderer.on('terminal-log', ...) callback,
        // and nothing ever removed them. Compilation_module / wave_config /
        // renderer all instantiate one (~3+ instances live at any time
        // when a project is open), so a single PRISM "compilation
        // completed" log fanned out to N terminals = the message
        // appeared 3+ times in tveri.
        //
        // The IPC payload includes the target terminal id, and
        // appendToTerminal routes by id, so one listener serving all
        // terminals is correct. Subsequent constructors no-op.
        if (TerminalManager.terminalLogListenerInitialized) return;
        electronAPI.onTerminalLog((_event, terminal, message, type = 'info') => {
            this.appendToTerminal(terminal, message, type);
        });
        TerminalManager.terminalLogListenerInitialized = true;
    }

    setupTerminalTabs() {
        // Bind once. Every `new TerminalManager()` (one per compile, via
        // CompilationModule) targets the SAME shared terminal-tab DOM, so
        // without this guard each compile stacked another click listener on
        // every tab, N compiles = the tab handler firing N+1 times.
        if (TerminalManager.terminalTabsInitialized) return;
        const tabs = document.querySelectorAll('.terminal-tabs .tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Com o painel recolhido, a faixa de abas e a unica coisa na
                // tela, e clicar numa aba era trocar de conteudo invisivel.
                // Agora o clique reabre: e o gesto que a pessoa tenta primeiro.
                window.abrirTerminal?.();
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const contents = document.querySelectorAll('.terminal-content');
                contents.forEach(content => content.classList.add('hidden'));

                const terminalId = tab.getAttribute('data-terminal') as string;
                const terminal = document.getElementById(`terminal-${terminalId}`) as HTMLElement;
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
            error: errorBtn.cloneNode(true) as HTMLElement,
            warning: warningBtn.cloneNode(true) as HTMLElement,
            tips: infoBtn.cloneNode(true) as HTMLElement,
            success: successBtn.cloneNode(true) as HTMLElement,
        };

        // Cloned nodes inherit the marker attribute but not the tooltip listeners. Clearing it lets tooltip.js bind listeners again.
        Object.values(buttons).forEach((button) => {
            button.removeAttribute('data-tooltip-initialized');
        });

        (errorBtn.parentNode as Node).replaceChild(buttons.error, errorBtn);
        (warningBtn.parentNode as Node).replaceChild(buttons.warning, warningBtn);
        (infoBtn.parentNode as Node).replaceChild(buttons.tips, infoBtn);
        (successBtn.parentNode as Node).replaceChild(buttons.success, successBtn);

        this.createCounterBadges();

        buttons.error.addEventListener('click', () => this.toggleFilter('error', buttons.error));
        buttons.warning.addEventListener('click', () => this.toggleFilter('warning', buttons.warning));
        buttons.tips.addEventListener('click', () => this.toggleFilter('tips', buttons.tips));
        buttons.success.addEventListener('click', () => this.toggleFilter('success', buttons.success));
    }

    toggleFilter(filterType: string, clickedBtn: HTMLElement): void {
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

    detectMessageType(content: string | SaidaDeExecutavel) { return tipoDaMensagem(content); }

    makeLineNumbersClickable(text: string): string {
        return linhaComLinks(text);
    }

    addToSessionCard(terminalId: string, text: string, type: string): void {
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

        // Per-message increments are gone, the batch-level recount in
        // processExecutableOutput/processStreamedLine owns the count
        // now. Mixing increments with recounts caused +1 drift every
        // time the same Aurora wrapper line was both classified by
        // detectMessageType AND surfaced through appendToTerminal.
    }

    createGroupedCard(terminal: HTMLElement, type: string, timestamp: string): HTMLElement {
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

    addMessageToCard(card: Element, text: string, _type?: string): void {
        const messagesContainer = card.querySelector('.messages-container');
        if (!messagesContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.classList.add('grouped-message');
        messageDiv.style.marginBottom = '0.25rem';

        let processedText = this.makeLineNumbersClickable(text);
        processedText = processedText.replace(
            /^(Atenção|Erro|Sucesso|Info)(:)?/i, (_, word, colon) => `<strong style="font-weight:700">${word}</strong>${colon || ''}`
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

    // Os links da saida (reconhecer, clicar, ir a linha) moram em
    // links_do_terminal.ts; ficam aqui os nomes que o resto da classe usa.
    _attachLineLinkClicks(scopeEl: Element | null): void {
        ligarLinks(scopeEl, (linha, coluna) => this.goToLine(linha, coluna));
    }

    goToLine(lineNumber: number, columnNumber = 1): void {
        irParaLinha(lineNumber, columnNumber);
    }

/**
     * O tamanho do arquivo de onda, ao vivo, enquanto a simulacao roda.
     *
     * Pedido de 23/08/2026. O dump cresce fora da vista, e a unica noticia
     * era o tamanho final; ver o numero subir e o que permite cancelar cedo
     * uma simulacao que vai encher o disco, e e o que responde "esta fazendo
     * alguma coisa?" numa simulacao longa. Um no' so, atualizado no lugar,
     * mesma mecanica da barra de progresso.
     */
    renderDumpSize(terminalId: string, { name, path = '', bytes, done = false }: { name: string; path?: string; bytes: number; done?: boolean }): void {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;
        const cards = this.updatableCards[terminalId] || {};
        this.updatableCards[terminalId] = cards;
        let el = cards.dumpSize;
        if (!el || !el.isConnected) {
            const novo = document.createElement('div') as PillDoDump;
            novo.className = 'dump-size';
            novo.innerHTML = '<i class="ph ph-wave-sine" aria-hidden="true"></i><span class="dump-size-text"></span>';
            novo._text = novo.querySelector('.dump-size-text') as HTMLElement;
            terminal.appendChild(novo);
            cards.dumpSize = novo;
            el = novo;
        } else if (!done && terminal.lastElementChild !== el) {
            // Cola embaixo, como a barra: linhas novas nao a empurram pro meio.
            terminal.appendChild(el);
        }
        el._text.textContent = `${name} · ${formatarBytes(bytes)}`;
        // O hover mostra ONDE o arquivo esta nascendo: o basename sozinho
        // nao diz a pasta, e a extensao muda por corrida (.vcd no Icarus,
        // .fst no cocotb e no Verilator conforme o modo). O balao decorado
        // do app le data-tooltip; o observador dele inicializa o no' porque
        // o atributo ja esta posto quando a insercao e processada.
        if (path) el.dataset.tooltip = path;
        // 'done' congela o numero final, e o pill FICA no terminal como
        // registro da corrida, junto do resto do log: e assim que se compara
        // o tamanho entre execucoes sem refazer nada. Ele so sai quando o
        // terminal e limpo, como qualquer outra linha; a proxima corrida
        // cria o seu proprio.
        el.classList.toggle('done', !!done);
        this.scrollToBottom(terminalId);
    }

    createLogEntry(terminal: HTMLElement, text: string, type: string, timestamp: string): HTMLElement {
        // A mesma linha, repetida logo em seguida, vira um contador na linha
        // que ja esta na tela. E o caso do $fscanf com $fopen falhado: o vvp
        // imprime o MESMO erro a cada ciclo de clock, milhares de vezes, e o
        // terminal inundado foi lido como "a compilacao entrou em loop".
        // Mil copias nao informam mais que uma com "x1000" do lado; e mil nos
        // de DOM a mais por segundo e o que faz a interface engasgar.
        // So a REPETICAO IMEDIATA agrupa: linhas intercaladas continuam
        // aparecendo na ordem em que chegaram.
        const anterior = this._ultimaLinha?.get(terminal.id);
        if (anterior && anterior.text === text && anterior.type === type
            && anterior.el.isConnected && anterior.el === terminal.lastElementChild) {
            anterior.count++;
            let chip = anterior.el.querySelector('.repeat-count');
            if (!chip) {
                chip = document.createElement('span');
                chip.className = 'repeat-count';
                anterior.el.appendChild(chip);
            }
            chip.textContent = `x${anterior.count}`;
            return anterior.el;
        }

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

        // No per-entry increment here either, recountMessages at the
        // end of each appendToTerminal batch handles counting from DOM
        // truth, including the grouped-message case where one card
        // contains several sub-messages of the same type.

        if (!this._ultimaLinha) this._ultimaLinha = new Map();
        this._ultimaLinha.set(terminal.id, { text, type, el: logEntry, count: 1 });

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
     * A barra do teste de hardware (barra_de_progresso.ts), no terminal pedido.
     * Uma por terminal, guardada em updatableCards.
     */
    renderHardwareProgress(terminalId: string, p: Progresso): void {
        // A cancel already tore the bar down (clearHardwareProgress). Stream
        // chunks buffered before the kill still land here afterwards, and each
        // one would rebuild the very bar the user just cancelled away. The flag
        // resets when the next run starts, so this only blocks the tail.
        if (typeof window !== 'undefined' && window.isCompilationCanceled?.()) return;

        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;

        // The hardware test runs in THTEST, pull focus there so its bar is seen.
        this.revealActiveOutputTerminal(terminalId);

        this.updatableCards[terminalId] = this.updatableCards[terminalId] || {};
        const el = barraNoTerminal(terminal, this.updatableCards[terminalId].hwProgress);
        this.updatableCards[terminalId].hwProgress = el;
        atualizarBarra(el, p, () => {
            if (this.updatableCards[terminalId]
                && this.updatableCards[terminalId].hwProgress === el) {
                this.updatableCards[terminalId].hwProgress = null;
            }
        });
        this.scrollToBottom(terminalId);
    }


    /**
     * Tear every hardware-progress bar down immediately, wherever it lives.
     * Called when the user cancels: the run is over, so a bar frozen mid-fill
     * (and its pending auto-hide) is a lie about work still happening.
     *
     * Sweeps the DOM rather than trusting `updatableCards` alone, a new
     * TerminalManager is built per compile, so the instance handling the cancel
     * is not necessarily the one that created the bar on screen.
     */
    clearHardwareProgress() {
        Object.values(this.updatableCards || {}).forEach((cards) => {
            if (!cards || !cards.hwProgress) return;
            derrubarBarra(cards.hwProgress);
            cards.hwProgress = null;
        });
        document.querySelectorAll('.hw-progress').forEach(derrubarBarra);
    }

    /** Format a millisecond ETA as a compact `Ns` / `Mm Ss` string. */
    _fmtEta(ms: number): string { return formatarEta(ms); }

    /**
     * Log entry com um trecho clicavel (link de pasta). `message` e a string
     * ja traduzida; `folderPath` e a substring exata a virar link. Ao clicar,
     * a file tree alterna pra view de pastas e revela/expande a pasta-alvo
     * (standardTreeRenderer.revealFolder). Construido com textContent, sem
     * innerHTML, sem risco de injecao.
     *
     */
    appendFolderLink(terminalId: string, message: string, folderPath: string, type: string = 'success') {
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
     * a tooltip but no listener, clicking it did nothing. Now it builds a
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


    /** Todos os terminais num arquivo de texto (exportar_log.ts). */
    async exportCurrentLog() { await exportarLog(this.terminals); }

    setupClearButton() {
        const clearButton = document.getElementById('clear-terminal');
        if (!clearButton) return;
        // Mode lives in state, not the icon class. The old code branched on
        // FontAwesome classes (fa-trash-can / fa-dumpster), but the button was
        // migrated to Phosphor (ph-trash), so neither branch ever matched and
        // clicking did nothing. Left-click clears; right-click toggles
        // current-tab ↔ all-terminals.
        if (this.clearMode === undefined) this.clearMode = 'current';

        if (this.handleClearClick) clearButton.removeEventListener('click', this.handleClearClick);
        if (this.handleClearContextMenu) clearButton.removeEventListener('contextmenu', this.handleClearContextMenu);

        this.handleClearClick = async (event) => {
            if (event.button !== 0) return;
            const activeTab = document.querySelector('.terminal-tabs .tab.active');
            const terminalId = activeTab?.getAttribute('data-terminal')
                || Object.keys(this.terminals)[0];
            const tr = (k: string, alt: string) => { const t = window.t ? window.t(k) : k; return t === k ? alt : t; };
            if (this.clearMode === 'all') {
                await this.clearAllTerminals();
                // A pilula em TODOS, e nao so no ativo: quem troca de aba logo
                // depois ve que aquele tambem foi limpo.
                for (const id of new Set([...Object.keys(this.terminals), 'tcmd'])) {
                    this._flashCleared(id, tr('terminal.allCleared', 'Terminals cleared'));
                }
                return;
            }
            if (terminalId) {
                await this.clearTerminal(terminalId);
                this._flashCleared(terminalId, tr('terminal.cleared', 'Terminal cleared'));
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
        // observers, after N compiles, each output line fired N×5
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
    trimTerminal(terminal: Element | null): void {
        if (!terminal) return;
        let excess = terminal.childElementCount - MAX_TERMINAL_ENTRIES;
        while (excess-- > 0 && terminal.firstElementChild) {
            terminal.removeChild(terminal.firstElementChild);
        }
    }

    // Coalesce the post-append bookkeeping (trim + recount + filter + scroll)
    // into a single pass per animation frame per terminal. Streaming compiles
    // call processStreamedLine once per line; running these O(n) DOM walks per
    // line is O(n²) over the build and forced a reflow each time, the terminal
    // freeze on large builds. The line's DOM is appended immediately (output
    // stays live); only the expensive bookkeeping is batched.
    _scheduleTerminalRefresh(terminalId: string): void {
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
    // filter applied mid-stream lags new lines by <=120ms, an imperceptible
    // settle, not a correctness loss.
    _scheduleCountRefresh(terminalId: string): void {
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

    scrollToBottom(terminalId: string): void {
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;
        // Smooth, self-coalescing follow to the true bottom (see
        // smoothFollowToBottom). Calling it per appended line is cheap: a call
        // while its rAF loop is already running is a no-op, and the loop re-reads
        // the height each frame so it keeps up with the stream and lands exactly
        // on the last line instead of stopping short.
        smoothFollowToBottom(terminal);
    }

    async clearTerminal(terminalId: string): Promise<void> {
        // O TCMD e um shell de verdade dentro de um xterm: limpar o DOM dele
        // mataria o terminal. Ele limpa como um shell limpa.
        if (terminalId === 'tcmd') { window.shellTerminal?.limpar?.(); return; }
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;

        // No pill here: clearTerminal is also called programmatically at the
        // start of compilation phases, so a pill would flash whenever new output
        // begins. The confirmation pill is fired ONLY by the manual clear button
        // (handleClearClick → _flashCleared).
        if (!this._temSaida(terminal)) return;

        // 1. Animate the existing entries out (fade + slide), then wipe.
        // Anything appended during the animation would be wiped with the old
        // entries before anyone saw it (it happened once, to the ASM preamble),
        // so appends are parked and replayed after the wipe.
        const parked = this._clearingQueues || (this._clearingQueues = new Map<string, ArgsDoAppend[]>());
        if (parked.has(terminalId)) return; // a clear is already in flight
        parked.set(terminalId, []);
        terminal.classList.add('clearing');
        await new Promise(resolve => setTimeout(resolve, 200));

        // 2. Reset logical state + DOM.
        this.currentSessionCards[terminalId] = {};
        this.updatableCards[terminalId] = {};
        this.messageCounts[terminalId] = { error: 0, warning: 0, success: 0, tips: 0 };
        terminal.innerHTML = '';
        this._porBoasVindas(terminal, terminalId);
        terminal.classList.remove('clearing');
        this.recountMessages?.(terminalId);

        // 3. Replay what arrived while the old entries were fading out.
        const replay = parked.get(terminalId) || [];
        parked.delete(terminalId);
        for (const args of replay) this.appendToTerminal(...args);
    }

    /** Ha saida no terminal, alem da boas-vindas? */
    _temSaida(terminal: Element): boolean {
        return !!terminal.querySelector(':scope > :not(.terminal-welcome)');
    }

    /**
     * A boas-vindas de volta depois de uma limpeza.
     *
     * Um terminal limpo nao fica vazio: volta ao estado de recem-aberto, com o
     * "Bem-vindo ao terminal X", que o CSS esconde assim que a primeira saida
     * chega (`.terminal-welcome:not(:only-child)`). O span leva o data-i18n,
     * e nao o corpo do terminal: com o atributo no corpo, a troca de idioma
     * reescrevia o corpo inteiro e apagava as saidas.
     */
    _porBoasVindas(terminal: Element, terminalId: string): void {
        if (terminal.querySelector(':scope > .terminal-welcome')) return;
        const chave = `terminalWelcome.${terminalId}`;
        const span = document.createElement('span');
        span.className = 'terminal-welcome';
        span.setAttribute('data-i18n', chave);
        const t = window.t ? window.t(chave) : chave;
        span.textContent = t === chave ? `Welcome to the terminal ${String(terminalId).toUpperCase()}!` : t;
        terminal.prepend(span);
    }

    /** Transient confirmation pill, fired by the manual clear button only. */
    _flashCleared(terminalId: string, message = 'Terminal cleared'): void {
        // A pilula mora no CONTEINER do terminal (#terminal-<id>), como uma
        // sobreposicao, e nao no corpo: o TCMD nao tem corpo, tem um xterm, e
        // era por isso que ele nunca ganhava a confirmacao.
        const caixa = document.getElementById(`terminal-${terminalId}`);
        if (!caixa) return;
        caixa.querySelector(':scope > .terminal-cleared-pill')?.remove();
        const pill = document.createElement('div');
        pill.className = 'terminal-cleared-pill';
        pill.innerHTML = '<i class="ph ph-check-circle"></i><span></span>';
        (pill.querySelector('span') as HTMLElement).textContent = message;
        caixa.appendChild(pill);
        // Temporizador, e nao rAF: numa janela ao fundo o Electron segura o
        // frame e a pilula nascia e morria invisivel (medido no TCMD).
        setTimeout(() => pill.classList.add('visible'), 20);
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
     * CMM compile). Sync because the caller is also sync, an async
     * fade would race against the first appendToTerminal of the new
     * run and erase its initial lines.
     */
    clearTerminalImmediate(terminalId: string): void {
        if (terminalId === 'tcmd') { window.shellTerminal?.limpar?.(); return; }
        const terminal = this._resolveTerminal(terminalId);
        if (!terminal) return;
        terminal.classList.remove('faded-out');
        terminal.innerHTML = '';
        this._porBoasVindas(terminal, terminalId);
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

    changeClearIcon(clearButton: HTMLElement): void {
        const icon = clearButton.querySelector('i');
        if (this.clearMode === 'current') {
            this.clearMode = 'all';
            if (icon) icon.className = 'ph ph-broom';
            clearButton.setAttribute('data-tooltip', tr('terminal.clearAllTip', 'Clear all terminals (right-click: current only)'));
        } else {
            this.clearMode = 'current';
            if (icon) icon.className = 'ph ph-trash';
            clearButton.setAttribute('data-tooltip', tr('terminal.clearCurrentTip', 'Clear current terminal tab (right-click: all)'));
        }
    }

    formatOutput(text: string): string {
        return text
            .split('\n')
            .map(line => {
                const indent = (line.match(/^\s*/) as RegExpMatchArray)[0].length;
                const indentSpaces = '&nbsp;'.repeat(indent);
                return indentSpaces + line.trim();
            })
            .join('<br>');
    }
}

export {
    TerminalManager,
};
