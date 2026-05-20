/**
 * wave_config_manager.js — Wave Configuration modal.
 *
 * Hierarchical signal picker: walks the project's Verilog files, builds
 * a tree rooted at the testbench module, lets the user check which
 * signals get $dumpvars'd. Selection persists per-testbench in the
 * WaveStore (`<project>/testbench/<tbKey>.json`) as
 * `waveSignals: [...]`.
 *
 * Default selection (no `waveSignals` saved or "Reset to default"):
 * every signal at the testbench-module scope. Mirrors Phase 1's
 * implicit behaviour ($dumpvars(1, tb)) so a user who never opens the
 * picker still gets a sensible wave layout.
 */

import { parseVerilogModules, buildHierarchyTree } from './signal_parser.js';
import { parseVcdHeaderFromContent } from './vcd_parser.js';
import { buildAliasMap } from './gtkw_proc_writer.js';
import { hasUserDumpCalls } from './testbench_instrumenter.js';
import { WaveStore } from './wave_state_store.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { CompilationModule } from '../compilation/compilation_module.js';
import { getSimulator, setSimulator } from './simulator_preference.js';

function tbKeyFromPath(tbPath) {
    if (!tbPath) return '';
    return tbPath.split(/[\\/]/).pop().replace(/\.v$/i, '');
}

class WaveConfigManager {
    constructor() {
        this.modal = null;
        this.elements = {};
        this.tree = null;
        this.selected = new Set();
        this.collapsedScopes = new Set();
        this._initialized = false;
        // Snapshot da selecao no momento em que o modal abre. Usado em
        // save() pra detectar se o usuario mudou algo — qualquer
        // diferenca seta wcCustomized=true no WaveStore e o compile
        // flow passa a injetar o proprio $dumpvars (override do testbench).
        this._initialSelection = new Set();
        // Filtro visual "Show processor signals only" — quando ligado,
        // mostra apenas signals "codificados" do processador (os que
        // tem alias no aliasMap, renderizados em negrito + cor accent
        // pelo .signal-alias). Engloba Stack/ULA, Assembly/C+-, e
        // typed vars (int/float/comp). Estado UI-only: nao persiste,
        // comeca desligado a cada open().
        this._processorOnly = false;
        // Cache populado em refresh(): scopePaths que tem PELO MENOS UM
        // signal aliased em si ou em descendentes. Modules fora desse
        // conjunto somem quando o filtro liga (junto com seus signals).
        // Consultado por _procFilterVisibility.
        this._scopesWithAliasedSignal = new Set();

        // Find widget state. Monaco-style text filter: literal substring
        // by default, regex via toggle; case-insensitive by default.
        // Reset on every open(). When `_filterRegex` is null the filter
        // is inactive — the tree renders normally.
        this._filterText = '';
        this._filterCaseSensitive = false;
        this._filterIsRegex = false;
        this._filterRegex = null;
        // Pre-computed match sets, refreshed on every filter/text change.
        // `_filterScopesOnPath` is the set of scopePaths that themselves
        // match OR have a matching descendant — used to keep ancestors
        // visible (path-preservation) and to auto-expand them.
        // `_filterMatchedSignals` is the exact set of `scope.sig` full
        // names that pass the filter.
        this._filterScopesOnPath = new Set();
        this._filterMatchedSignals = new Set();
        this._filterMatchCount = 0;
    }

    initialize() {
        if (this._initialized) return;
        this.cacheElements();
        if (!this.modal) {
            // index.html doesn't have the modal in this build (e.g. PRISM
            // window). Bail rather than throw.
            return;
        }
        this.bindListeners();
        this._initialized = true;
    }

    cacheElements() {
        this.modal = document.getElementById('modalWaveConfig');
        if (!this.modal) return;
        this.elements = {
            closeBtn:          document.getElementById('closeWaveConfigModal'),
            cancelBtn:         document.getElementById('cancelWaveConfig'),
            saveBtn:           document.getElementById('saveWaveConfig'),
            selectDefaultBtn:  document.getElementById('waveConfigSelectDefault'),
            selectAllBtn:      document.getElementById('waveConfigSelectAll'),
            selectNoneBtn:     document.getElementById('waveConfigSelectNone'),
            processorOnlyCb:   document.getElementById('waveConfigProcessorOnly'),
            processorOnlyFilter: document.getElementById('waveConfigProcessorOnly')?.closest('.wave-tree-filter'),
            useVerilatorCb:    document.getElementById('waveConfigUseVerilator'),
            tree:              document.getElementById('waveConfigTree'),
            counter:           document.getElementById('waveConfigSelectedCount'),
            filterInput:       document.getElementById('waveConfigFilterInput'),
            filterCount:       document.getElementById('waveConfigFilterCount'),
            filterCaseBtn:     document.getElementById('waveConfigFilterCase'),
            filterRegexBtn:    document.getElementById('waveConfigFilterRegex'),
            filterClearBtn:    document.getElementById('waveConfigFilterClear'),
        };
    }

    bindListeners() {
        this.elements.closeBtn?.addEventListener('click', () => this.close());
        this.elements.cancelBtn?.addEventListener('click', () => this.close());
        this.elements.saveBtn?.addEventListener('click', () => this.save());
        this.elements.selectDefaultBtn?.addEventListener('click', () => this.selectDefault());
        this.elements.selectAllBtn?.addEventListener('click', () => this.selectAll());
        this.elements.selectNoneBtn?.addEventListener('click', () => this.selectNone());
        this.elements.processorOnlyCb?.addEventListener('change', (e) => {
            this._processorOnly = !!e.target.checked;
            if (this._processorOnly) {
                // Default e abrir tudo colapsado menos o root, o que
                // esconderia os signals do processador atras de varios
                // niveis (top_level_inst → DTWv4_inst → p_ProcDTW →
                // core → sp/ula...). Quando o filtro liga, abrimos o
                // caminho ate cada module com signal aliased pra que
                // o usuario veja imediatamente o que pediu — caso
                // contrario a tela parece vazia.
                for (const path of this._scopesWithAliasedSignal) {
                    this.collapsedScopes.delete(path);
                }
            }
            this.renderTree();
        });

        // Simulator switch: persistido em localStorage (global). Sem
        // re-render — o toggle so afeta o proximo clique no Wave.
        this.elements.useVerilatorCb?.addEventListener('change', (e) => {
            setSimulator(e.target.checked ? 'verilator' : 'iverilog');
        });

        // Toolbar button — primary entry point for the modal. Also
        // wired up here (rather than in renderer.js / compilation_flow)
        // so the manager owns its full lifecycle.
        document.getElementById('waveConfigBtn')?.addEventListener('click', () => this.open());

        // Esc closes when modal is open. But if the focus is in the
        // filter input AND there's filter text, Esc clears the filter
        // first — Monaco-style two-step Esc (clear, then close).
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                if (document.activeElement === this.elements.filterInput && this._filterText) {
                    this._setFilterText('');
                    e.stopPropagation();
                    return;
                }
                this.close();
            }
        });

        // Click on overlay (outside the container) closes — same as
        // every other modal in Aurora.
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });

        // Ctrl/Cmd+F focuses the find input — like Monaco. Scoped to the
        // modal so it doesn't intercept the shortcut globally.
        this.modal.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
                const input = this.elements.filterInput;
                if (input) {
                    e.preventDefault();
                    input.focus();
                    input.select();
                }
            }
        });

        // Find widget — input, case/regex toggles, clear button.
        this.elements.filterInput?.addEventListener('input', (e) => {
            this._setFilterText(e.target.value);
        });
        this.elements.filterCaseBtn?.addEventListener('click', () => {
            this._filterCaseSensitive = !this._filterCaseSensitive;
            this.elements.filterCaseBtn.classList.toggle('active', this._filterCaseSensitive);
            this.elements.filterCaseBtn.setAttribute('aria-pressed', String(this._filterCaseSensitive));
            this._compileFilter();
            this._computeFilterMatches();
            this.renderTree();
        });
        this.elements.filterRegexBtn?.addEventListener('click', () => {
            this._filterIsRegex = !this._filterIsRegex;
            this.elements.filterRegexBtn.classList.toggle('active', this._filterIsRegex);
            this.elements.filterRegexBtn.setAttribute('aria-pressed', String(this._filterIsRegex));
            this._compileFilter();
            this._computeFilterMatches();
            this.renderTree();
        });
        this.elements.filterClearBtn?.addEventListener('click', () => {
            this._setFilterText('');
            this.elements.filterInput?.focus();
        });
    }

    /**
     * Centralised filter-text setter — updates state, DOM, compiles the
     * matcher, recomputes match sets, and re-renders. Called from the
     * input handler, from Esc-clear, and from the clear button.
     */
    _setFilterText(text) {
        this._filterText = String(text ?? '');
        if (this.elements.filterInput && this.elements.filterInput.value !== this._filterText) {
            this.elements.filterInput.value = this._filterText;
        }
        if (this.elements.filterClearBtn) {
            this.elements.filterClearBtn.hidden = this._filterText.length === 0;
        }
        this._compileFilter();
        this._computeFilterMatches();
        this.renderTree();
    }

    /**
     * Build the matcher RegExp from `_filterText` + toggles. Falls back
     * to literal substring if the user typed an invalid regex with the
     * `.*` toggle on — keeps the UI responsive instead of throwing.
     */
    _compileFilter() {
        const text = this._filterText.trim();
        if (!text) { this._filterRegex = null; return; }
        const flags = this._filterCaseSensitive ? 'g' : 'gi';
        const literalEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try {
            this._filterRegex = this._filterIsRegex
                ? new RegExp(text, flags)
                : new RegExp(literalEscape(text), flags);
        } catch (_) {
            // Invalid regex — fall back to a literal-text match of the
            // raw input so the picker keeps filtering "somehow" instead
            // of going blank while the user finishes typing.
            this._filterRegex = new RegExp(literalEscape(text), flags);
        }
    }

    /**
     * Walk the hierarchy and decide which signals match. Side effects:
     * populates `_filterScopesOnPath`, `_filterMatchedSignals`,
     * `_filterMatchCount`. Cheap O(n) — recomputed on every keystroke.
     *
     * Matching rule: only leaf signals can be "matched", and the match
     * is tested ONLY against the signal's own identifier — `sig.name`
     * and the SAPHO alias (so searching "Assembly" finds `valr2`).
     *
     * Scope/full-path matching is deliberately NOT used: it would pull
     * every signal under a matching scope into the result (search "ula"
     * → every signal inside the `ula` module appears, even ones whose
     * names have no "ula" in them), defeating the point of the filter.
     * Modules show up purely as ancestors of matched signals — path
     * preservation, never themselves a match source.
     *
     * Processor-internal plumbing (the raw `me3_*` / `arr_me3_*` memory
     * regs/wires that combine to produce the `comp_me3_*` value the user
     * actually reads) is excluded from match results unconditionally —
     * those are infra, not signals worth presenting to the picker. They
     * remain visible in hierarchical mode if the user navigates there.
     */
    _computeFilterMatches() {
        this._filterScopesOnPath.clear();
        this._filterMatchedSignals.clear();
        this._filterMatchCount = 0;
        if (!this._filterRegex || !this.tree) {
            this._updateFilterCount();
            return;
        }
        const testRe = (s) => {
            if (!s) return false;
            this._filterRegex.lastIndex = 0;
            return this._filterRegex.test(s);
        };
        const walk = (node) => {
            let any = false;
            for (const sig of node.signals) {
                if (this._isProcessorInternal(sig.name)) continue;
                const full = `${node.scopePath}.${sig.name}`;
                const alias = this.aliasMap?.get(full);
                if (testRe(sig.name) || testRe(alias)) {
                    this._filterMatchedSignals.add(full);
                    this._filterMatchCount++;
                    any = true;
                }
            }
            for (const child of node.children) {
                if (walk(child)) any = true;
            }
            if (any) this._filterScopesOnPath.add(node.scopePath);
            return any;
        };
        walk(this.tree);
        this._updateFilterCount();
    }

    /**
     * True for SAPHO processor "plumbing" signals — the raw memory
     * registers/wires that feed the aliased `comp_me3_*` view but carry
     * no standalone meaning for the user. Currently:
     *   - `me3_*`     (without `comp_` prefix): scalar comp-var mem
     *   - `arr_me3_*` (without `comp_` prefix): array comp-var mem
     * Keep this list narrow — it's a hard-coded skip in the find widget
     * results, so over-inclusion would silently hide useful signals.
     */
    _isProcessorInternal(sigName) {
        if (!sigName) return false;
        return sigName.startsWith('me3_') || sigName.startsWith('arr_me3_');
    }

    _updateFilterCount() {
        const el = this.elements.filterCount;
        if (!el) return;
        const tr = (k, p) => (window.t ? window.t(k, p) : k);
        if (!this._filterRegex) {
            el.textContent = '';
            el.classList.remove('no-match');
            return;
        }
        if (this._filterMatchCount === 0) {
            el.textContent = tr('modal.waveConfig.filterNoMatch');
            el.classList.add('no-match');
            return;
        }
        el.classList.remove('no-match');
        el.textContent = this._filterMatchCount === 1
            ? tr('modal.waveConfig.filterMatchCountOne')
            : tr('modal.waveConfig.filterMatchCountOther', { count: this._filterMatchCount });
    }

    // ------------- open/close ------------------

    isOpen() {
        return this.modal?.getAttribute('aria-hidden') === 'false';
    }

    async open() {
        const projectPath = ProjectStore.getProjectPath();
        const spfPath = ProjectStore.getSpfPath();

        if (projectPath && spfPath) {
            const compiler = new CompilationModule(projectPath);
            await compiler.loadConfig();

            // STEP 1 — local cleanup: validate the saved waveSignals
            // against the current Verilog hierarchy and auto-prune
            // entries that no longer exist. Cheap regex parse, runs
            // BEFORE any iverilog work so a stale selection from a
            // previous code edit can't outlive the rename. The
            // notification (twave) and the WaveStore write happen
            // inside _validateWaveSelection.
            const cfg = await SpfStore.read(spfPath);
            const filePaths = [
                ...(cfg.synthesizableFiles || []).map((f) => f?.path),
                cfg.testbenchFile,
                ...(cfg.testbenchFiles || []).map((f) => f?.path),
            ].filter(Boolean);
            // Include components/HDL/*.v (SAPHO library: core, ula, addr_dec,
            // instr_dec, myFIFO, ...). Without these, _validateWaveSelection
            // doesn't see signals inside the processor core (e.g.
            // "Data Stack Max", "Rounding Error") and would auto-prune
            // them as "stale" — the WaveStore loses the user's selection
            // every time the modal opens. Mirrors the same widening done
            // for the compile-time path in iverilogCompile.
            try {
                const componentsPath = await window.electronAPI.getComponentsPath();
                const hdlDir = await window.electronAPI.joinPath(componentsPath, 'HDL');
                const hdlEntries = await window.electronAPI.listFilesInDirectory(hdlDir);
                if (Array.isArray(hdlEntries)) {
                    for (const name of hdlEntries) {
                        if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                            filePaths.push(await window.electronAPI.joinPath(hdlDir, name));
                        }
                    }
                }
            } catch (_e) { /* HDL unavailable — validate proceeds without it */ }
            const moduleNameFromPath = (p) => p && p.split(/[\\/]/).pop().replace(/\.v$/i, '');
            const tbModule = moduleNameFromPath(cfg.testbenchFile)
                || moduleNameFromPath(cfg.topLevelFile);
            // waveSignals vive no WaveStore per-testbench. Le do tb atual.
            const tbKey = tbKeyFromPath(cfg.testbenchFile);
            const tbState = tbKey ? await WaveStore.read(projectPath, tbKey) : null;
            const rawSelected = Array.isArray(tbState?.waveSignals) ? tbState.waveSignals : [];
            if (tbModule && filePaths.length > 0) {
                await compiler._validateWaveSelection(rawSelected, filePaths, tbModule, tbKey);
            }

            // STEP 2 — informational iverilog syntax check. Used to
            // gate the modal but that created a dead-end (if a stale
            // selection caused the iverilog failure, the user
            // couldn't reach the picker to clean it up). Now purely
            // informational; modal opens regardless. Roda pros dois
            // fluxos (com e sem processador) — syntaxCheck usa
            // -y components/HDL que resolve a biblioteca SAPHO, entao
            // funciona em projeto com processador tambem.
            // Limpa o tveri antes de re-rodar o syntax check. Cada open()
            // reescreve os mesmos banners (simTop, passed/failed, etc); sem
            // limpar, as mensagens das aberturas anteriores se acumulam e o
            // usuario nao distingue o resultado atual do anterior.
            compiler.terminalManager?.clearTerminalImmediate?.('tveri');
            if (typeof window.switchTerminal === 'function') {
                window.switchTerminal('terminal-tveri');
            }
            await compiler.syntaxCheck();
        }

        // O filtro "processor only" e UI-only e nao persiste — comeca
        // desligado a cada open(). Mantemos o estado interno em sync
        // com o DOM checkbox antes do refresh pra evitar render duplo.
        this._processorOnly = false;
        if (this.elements.processorOnlyCb) {
            this.elements.processorOnlyCb.checked = false;
        }
        // Simulator preference: persiste entre sessoes (localStorage),
        // entao o checkbox reflete o estado salvo, nao reseta a cada open.
        if (this.elements.useVerilatorCb) {
            this.elements.useVerilatorCb.checked = (getSimulator() === 'verilator');
        }
        // Find widget: also UI-only, also reset on each open(). Toggles
        // (case/regex) reset too — fresh slate every time the user
        // re-enters the modal.
        this._filterText = '';
        this._filterCaseSensitive = false;
        this._filterIsRegex = false;
        this._filterRegex = null;
        if (this.elements.filterInput) this.elements.filterInput.value = '';
        if (this.elements.filterClearBtn) this.elements.filterClearBtn.hidden = true;
        if (this.elements.filterCaseBtn) {
            this.elements.filterCaseBtn.classList.remove('active');
            this.elements.filterCaseBtn.setAttribute('aria-pressed', 'false');
        }
        if (this.elements.filterRegexBtn) {
            this.elements.filterRegexBtn.classList.remove('active');
            this.elements.filterRegexBtn.setAttribute('aria-pressed', 'false');
        }
        if (this.elements.filterCount) {
            this.elements.filterCount.textContent = '';
            this.elements.filterCount.classList.remove('no-match');
        }
        await this.refresh();
        this.modal?.setAttribute('aria-hidden', 'false');
        this.modal?.classList.add('show');
    }

    close() {
        this.modal?.setAttribute('aria-hidden', 'true');
        this.modal?.classList.remove('show');
    }

    // ------------- data refresh ----------------

    async refresh() {
        const projectPath = ProjectStore.getProjectPath();
        const spfPath = ProjectStore.getSpfPath();
        // Reset no inicio: cada early-return abaixo deixa o picker sem
        // arvore, o que tambem significa "sem processador". Sem esse
        // reset, o set ficaria stale do refresh anterior e o checkbox
        // "processor only" continuaria visivel num projeto sem processador.
        this._scopesWithAliasedSignal = new Set();
        if (!projectPath || !spfPath) {
            this.tree = null;
            this.renderTree();
            return;
        }

        const config = await SpfStore.read(spfPath);
        const filePaths = new Set();
        (config.synthesizableFiles || []).forEach((f) => f?.path && filePaths.add(f.path));
        if (config.testbenchFile) filePaths.add(config.testbenchFile);
        (config.testbenchFiles || []).forEach((f) => f?.path && filePaths.add(f.path));

        // components/HDL/*.v — biblioteca SAPHO (core.v, myFIFO.v,
        // processor.v, ula.v, etc). Esses modulos sao instanciados
        // dentro do .v gerado pelo asmcomp mas nao aparecem em
        // synthesizableFiles. Sem incluir aqui, o Wave Config picker
        // nao mostra sinais tipo `core.sp.pointeri`, `core.ula.delta_int`
        // — e ai o $dumpvars gerado nao inclui esses sinais no VCD,
        // sumindo a secao Flags do .gtkw final.
        try {
            const componentsPath = await window.electronAPI.getComponentsPath();
            const hdlPath = await window.electronAPI.joinPath(componentsPath, 'HDL');
            const hdlEntries = await window.electronAPI.listFilesInDirectory(hdlPath);
            if (Array.isArray(hdlEntries)) {
                for (const name of hdlEntries) {
                    if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                        const full = await window.electronAPI.joinPath(hdlPath, name);
                        filePaths.add(full);
                    }
                }
            }
        } catch (_e) {
            // HDL nao acessivel — segue sem (picker fica sem sinais
            // SAPHO mas resto do projeto continua).
        }

        if (filePaths.size === 0) {
            this.tree = null;
            this.renderTree();
            return;
        }

        // Read every .v file. Skip ones that fail (e.g. moved on disk)
        // rather than aborting the whole picker.
        const contents = await Promise.all(
            [...filePaths].map(async (path) => {
                try {
                    return { path, content: await window.electronAPI.readFile(path) };
                } catch (_e) {
                    return null;
                }
            }),
        );
        const ok = contents.filter(Boolean);
        const { modules } = parseVerilogModules(ok);

        // The simulation top is the testbench module. Fall back to the
        // synthesizable top if no testbench is set (rare in practice).
        const moduleNameFromPath = (p) => p && p.split(/[\\/]/).pop().replace(/\.v$/i, '');
        const topModule =
            moduleNameFromPath(config.testbenchFile)
            || moduleNameFromPath(config.topLevelFile);

        if (!topModule || !modules.has(topModule)) {
            this.tree = null;
            this.renderTree();
            return;
        }

        this.tree = buildHierarchyTree(modules, topModule);

        // Constroi um alias map a partir da hierarquia parseada. Mesmas
        // regras que o gtkw writer aplica, entao o rotulo mostrado no
        // modal bate com o que vai aparecer no GTKWave.
        const flatScopes = this._hierarchyToScopes(this.tree);
        this.aliasMap = buildAliasMap(flatScopes);

        // Pre-computa o set de scopePaths que carregam (em si ou em
        // descendentes) pelo menos um signal com alias — alimenta o
        // filtro "Show processor signals only". Inclui os scopes que
        // sao ancestrais de signals aliased pra que a arvore mantenha
        // contiguidade visual (caso contrario um filho aliased ficaria
        // sem pai renderizado).
        this._scopesWithAliasedSignal = this._computeScopesWithAliasedSignal();

        // Estrategia de selecao inicial — usando WaveStore per-tb:
        //  1. state.wcCustomized = true  -> usa state.waveSignals
        //     (usuario assumiu o controle para ESTE testbench).
        //  2. testbench tem $dumpfile/$dumpvars hand-written E VCD
        //     existe   -> deriva a selecao do VCD atual (mostra ao
        //     usuario o que ESTA sendo dumpado pelo $dumpvars dele).
        //  3. state.waveSignals nao-vazio -> usa.
        //  4. caso contrario -> aplica o default (signals do escopo do
        //     testbench).
        //
        // Como o state e per-(projectPath, tbKey), trocar o testbench
        // naturalmente "expira" a customizacao do anterior.
        const tbKey = tbKeyFromPath(config.testbenchFile);
        const tbState = tbKey ? await WaveStore.read(projectPath, tbKey) : null;
        const savedSignals = Array.isArray(tbState?.waveSignals) ? tbState.waveSignals : [];
        if (tbState?.wcCustomized) {
            this.selected = new Set(savedSignals);
        } else {
            const vcdDerived = await this._tryDeriveSelectionFromVcd(projectPath, config, topModule);
            if (vcdDerived) {
                this.selected = vcdDerived;
            } else if (savedSignals.length > 0) {
                this.selected = new Set(savedSignals);
            } else {
                this._applyDefaultSelection();
            }
        }

        // Snapshot pra detectar mudanca em save().
        this._initialSelection = new Set(this.selected);

        // Open the modal with every nested module collapsed. The root
        // (testbench) stays expanded so the user lands on the most
        // common scope without having to click first; deep DUT
        // hierarchies stay tucked away until explicitly opened.
        this._collapseAllExceptRoot();

        this.renderTree();
    }

    _collapseAllExceptRoot() {
        this.collapsedScopes = new Set();
        if (!this.tree) return;
        const walk = (node) => {
            for (const child of node.children) {
                this.collapsedScopes.add(child.scopePath);
                walk(child);
            }
        };
        walk(this.tree);
    }

    /**
     * Converte uma HierarchyNode (output do buildHierarchyTree) num
     * array de scopes no formato esperado por buildAliasMap
     * ({ path, signals: [{name}] }), pra que as regras do .gtkw
     * processor-aware se apliquem identicamente aqui no modal.
     */
    _hierarchyToScopes(root) {
        const scopes = [];
        const walk = (n) => {
            if (!n) return;
            scopes.push({
                path: n.scopePath,
                signals: (n.signals || []).map((s) => ({ name: s.name })),
            });
            for (const child of n.children || []) walk(child);
        };
        walk(root);
        return scopes;
    }

    _applyDefaultSelection() {
        this.selected = new Set();
        if (!this.tree) return;
        for (const sig of this.tree.signals) {
            this.selected.add(`${this.tree.scopePath}.${sig.name}`);
        }
    }

    /**
     * Quando o testbench tem $dumpfile/$dumpvars hand-written, a primeira
     * vez que o modal abre pra um projeto nao-customizado mostramos o
     * que ESTA efetivamente sendo dumpado — i.e., parseamos o VCD
     * gerado pela ultima simulacao e marcamos os sinais correspondentes.
     *
     * Devolve um Set<string> com os paths ou null se:
     *   - testbench nao tem $dumpvars/$dumpfile (caso normal, segue
     *     o fluxo default/waveSignals);
     *   - VCD nao existe ainda (primeira simulacao nem rodou);
     *   - parsing do testbench ou do VCD falhou.
     */
    async _tryDeriveSelectionFromVcd(projectPath, config, topModule) {
        try {
            // Precisa ter um testbenchFile pra verificar dumpvars.
            if (!config.testbenchFile) return null;
            const tbContent = await window.electronAPI.readFile(config.testbenchFile);
            // hasUserDumpCalls strip-a comentarios antes de testar,
            // pra que `// $dumpvars(0, tb);` NAO conte como user-defined.
            if (!hasUserDumpCalls(tbContent)) return null;

            // VCD vive em components/Temp/<topModule>.vcd no fluxo
            // no-processors. Outras configs podem ter outros paths
            // mas esse e o caminho canonico do botao Wave.
            const componentsPath = await window.electronAPI.getComponentsPath();
            // Prefer the stashed pass-1 header (.header.vcd) because the
            // canonical .vcd is overwritten with FST binary by pass 2 of
            // the two-pass dump strategy. Fall back to .vcd if present
            // (legacy / single-pass runs).
            const headerPath = await window.electronAPI.joinPath(componentsPath, 'Temp', `${topModule}.header.vcd`);
            const legacyPath = await window.electronAPI.joinPath(componentsPath, 'Temp', `${topModule}.vcd`);
            let vcdPath = null;
            if (await window.electronAPI.fileExists(headerPath)) vcdPath = headerPath;
            else if (await window.electronAPI.fileExists(legacyPath)) vcdPath = legacyPath;
            if (!vcdPath) return null;

            const vcdContent = await window.electronAPI.readFile(vcdPath);
            const scopes = parseVcdHeaderFromContent(vcdContent);
            if (!Array.isArray(scopes) || scopes.length === 0) return null;

            const derived = new Set();
            for (const scope of scopes) {
                for (const sig of scope.signals) {
                    derived.add(`${scope.path}.${sig.name}`);
                }
            }
            return derived;
        } catch (_e) {
            return null;
        }
    }

    selectDefault() {
        this._applyDefaultSelection();
        this.renderTree();
    }

    selectAll() {
        if (!this.tree) {
            this.selected = new Set();
            this.renderTree();
            return;
        }
        // Filtro ligado: o usuario ve so signals aliased — "Select all"
        // opera sobre o que ele esta vendo (signals do processador),
        // preservando o estado dos outros pra nao mexer no que esta
        // escondido. Filtro desligado: comportamento classico (todos).
        if (this._processorOnly) {
            const walk = (node) => {
                for (const sig of node.signals) {
                    const full = `${node.scopePath}.${sig.name}`;
                    if (this._shouldRenderSignal(full)) this.selected.add(full);
                }
                for (const child of node.children) walk(child);
            };
            walk(this.tree);
        } else {
            this.selected = new Set();
            const walk = (node) => {
                for (const sig of node.signals) {
                    this.selected.add(`${node.scopePath}.${sig.name}`);
                }
                for (const child of node.children) walk(child);
            };
            walk(this.tree);
        }
        this.renderTree();
    }

    selectNone() {
        // Filtro ligado: limpa so signals aliased (visiveis); o que esta
        // escondido pelo filtro fica intocado. Filtro desligado: limpa
        // tudo.
        if (this._processorOnly && this.tree) {
            const walk = (node) => {
                for (const sig of node.signals) {
                    const full = `${node.scopePath}.${sig.name}`;
                    if (this._shouldRenderSignal(full)) this.selected.delete(full);
                }
                for (const child of node.children) walk(child);
            };
            walk(this.tree);
        } else {
            this.selected = new Set();
        }
        this.renderTree();
    }

    // ------------- rendering -------------------

    renderTree() {
        const treeEl = this.elements.tree;
        if (!treeEl) return;
        treeEl.innerHTML = '';

        // O checkbox "Show processor signals only" so faz sentido quando
        // o .spf tem de fato um processador — i.e., existe pelo menos um
        // signal aliased (plumbing SAPHO). Esconde caso contrario.
        this._updateProcessorFilterVisibility();

        if (!this.tree) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = `
                <i class="ph ph-tree-structure empty-icon" aria-hidden="true"></i>
                <span>No signals discovered. Make sure the project has a top-level synthesizable file (and ideally a testbench).</span>
            `;
            treeEl.appendChild(empty);
            this._updateCounter();
            return;
        }

        const filterActive = !!this._filterRegex;

        if (filterActive) {
            // Flat-list mode: only signal rows, ordered by their natural
            // tree walk, each carrying the full scope path so the user
            // can tell where every match lives without the indentation
            // dance. No module rows, no chevrons, no collapse state.
            treeEl.classList.add('flat-mode');
            const flatWalk = (node) => {
                for (const sig of node.signals) {
                    const fullName = `${node.scopePath}.${sig.name}`;
                    if (!this._shouldRenderSignal(fullName)) continue;
                    if (!this._filterMatchedSignals.has(fullName)) continue;
                    treeEl.appendChild(this._renderSignalRow(node, sig, 0, true));
                }
                for (const child of node.children) flatWalk(child);
            };
            flatWalk(this.tree);
            this._updateCounter();
            return;
        }
        treeEl.classList.remove('flat-mode');

        const walk = (node, depth, parentVisible) => {
            const vis = this._procFilterVisibility(node.scopePath);
            if (vis.module) {
                treeEl.appendChild(this._renderModuleRow(node, depth, parentVisible));
            }
            const collapsed = this.collapsedScopes.has(node.scopePath);
            const childrenVisible = vis.module && parentVisible && !collapsed;
            if (vis.module) {
                for (const sig of node.signals) {
                    const fullName = `${node.scopePath}.${sig.name}`;
                    if (!this._shouldRenderSignal(fullName)) continue;
                    treeEl.appendChild(this._renderSignalRow(node, sig, depth + 1, childrenVisible));
                }
            }
            for (const child of node.children) {
                // Mantem o depth do filho mesmo se o pai foi escondido —
                // assim a indentacao reflete a hierarquia real, nao a
                // posicao visual no filtro. Filtro afeta visibilidade,
                // nao geometria.
                walk(child, vis.module ? depth + 1 : depth, childrenVisible);
            }
        };
        walk(this.tree, 0, true);

        this._updateCounter();
    }

    /**
     * Visibilidade do node sob o filtro "processor signals only".
     *
     *   - filtro desligado: tudo visivel.
     *   - ligado: module visivel se ele ou algum descendente tem
     *     signal aliased. Signals individuais sao decididos no
     *     renderTree (`shouldRenderSignal`), porque o filtro precisa
     *     casar com aliasMap.has(fullName).
     *
     * @param {string} scopePath
     * @returns {{ module: boolean }}
     */
    _procFilterVisibility(scopePath) {
        if (!this._processorOnly) return { module: true };
        return { module: this._scopesWithAliasedSignal.has(scopePath) };
    }

    /**
     * Decide se um signal individual entra na arvore sob o filtro:
     * presente no aliasMap (= "codificado" do processador, renderizado
     * em negrito).
     *
     * @param {string} fullName  `scope.path.sig`
     * @returns {boolean}
     */
    _shouldRenderSignal(fullName) {
        if (!this._processorOnly) return true;
        return !!this.aliasMap?.has(fullName);
    }

    /**
     * Constroi o set de scopePaths que tem (em si OU em descendentes)
     * pelo menos um signal aliased. O walk bottom-up garante que se um
     * filho qualifica, todos os ancestrais tambem qualificam — assim a
     * arvore mantem caminho do root ate o signal aliased sem buracos.
     *
     * Roda uma vez por refresh() — depois cada renderTree consulta o
     * set em O(1).
     *
     * @returns {Set<string>}
     */
    _computeScopesWithAliasedSignal() {
        const out = new Set();
        if (!this.tree || !this.aliasMap) return out;
        const walk = (node) => {
            let qualifies = false;
            for (const sig of node.signals) {
                if (this.aliasMap.has(`${node.scopePath}.${sig.name}`)) {
                    qualifies = true;
                    break;
                }
            }
            for (const child of node.children) {
                if (walk(child)) qualifies = true;
            }
            if (qualifies) out.add(node.scopePath);
            return qualifies;
        };
        walk(this.tree);
        return out;
    }

    /**
     * Mostra/esconde o filtro "Show processor signals only" conforme o
     * projeto tenha (ou nao) sinais de processador. _scopesWithAliasedSignal
     * vazio == nenhum signal aliased == sem processador no .spf. Quando
     * escondemos, tambem desligamos o filtro pra nao deixar a arvore
     * presa num estado filtrado que o usuario nao consegue mais reverter.
     */
    _updateProcessorFilterVisibility() {
        const wrap = this.elements.processorOnlyFilter;
        if (!wrap) return;
        const hasProcessor = this._scopesWithAliasedSignal.size > 0;
        wrap.hidden = !hasProcessor;
        if (!hasProcessor && this._processorOnly) {
            this._processorOnly = false;
            if (this.elements.processorOnlyCb) this.elements.processorOnlyCb.checked = false;
        }
    }

    _renderModuleRow(node, depth, visible) {
        const row = document.createElement('div');
        row.className = 'wave-tree-row module-row';
        if (!visible) row.classList.add('hidden-by-parent');
        row.style.setProperty('--depth', String(depth));
        row.dataset.scope = node.scopePath;

        const collapsed = this.collapsedScopes.has(node.scopePath);
        const hasChildren = node.children.length > 0 || node.signals.length > 0;

        row.innerHTML = `
            <span class="wave-tree-chevron ${hasChildren ? '' : 'spacer'} ${collapsed ? 'collapsed' : ''}">
                <i class="ph ph-caret-down"></i>
            </span>
            <input type="checkbox" class="wave-tree-checkbox" tabindex="-1">
            <span class="wave-tree-icon"><i class="ph ph-cube"></i></span>
            <span class="wave-tree-name">
                <span>${this._escape(node.name)}</span>
                ${node.instanceName ? `<span class="wave-tree-instance">(${this._escape(node.instanceName)})</span>` : ''}
            </span>
        `;

        const cb = row.querySelector('.wave-tree-checkbox');
        const state = this._moduleCheckState(node);
        cb.checked = state.all;
        cb.indeterminate = state.partial;

        cb.addEventListener('click', (e) => {
            e.stopPropagation();
            // After native toggle, cb.checked reflects the desired
            // direction. If the row was indeterminate, the click sets
            // checked = true (browser convention); we honour that as
            // "select everything in this scope".
            const turnOn = cb.checked;
            this._toggleScope(node, turnOn);
            this.renderTree();
        });

        if (hasChildren) {
            const chev = row.querySelector('.wave-tree-chevron');
            chev.addEventListener('click', (e) => {
                e.stopPropagation();
                if (collapsed) this.collapsedScopes.delete(node.scopePath);
                else this.collapsedScopes.add(node.scopePath);
                this.renderTree();
            });
        }

        return row;
    }

    _renderSignalRow(parent, sig, depth, visible) {
        const row = document.createElement('div');
        row.className = 'wave-tree-row signal-row';
        if (!visible) row.classList.add('hidden-by-parent');
        row.style.setProperty('--depth', String(depth));
        const fullName = `${parent.scopePath}.${sig.name}`;
        row.dataset.signal = fullName;

        // Se o sinal e parte de um processador SAPHO reconhecido, mostra
        // o alias amigavel ("Assembly", "int cont in global", etc.)
        // em vez do nome cru. Identicos aos labels que aparecem no
        // GTKWave depois.
        const alias = this.aliasMap?.get(fullName);

        const nameSpanHtml = alias
            ? `<span class="signal-alias">${this._highlightMatches(alias)}</span>
               <span class="signal-raw">${this._highlightMatches(sig.name)}${sig.range ? `[${this._escape(sig.range)}]` : ''}</span>`
            : `<span class="signal-kind">${this._escape(sig.kind)}</span>
               <span>${this._highlightMatches(sig.name)}</span>
               ${sig.range ? `<span class="signal-range">[${this._escape(sig.range)}]</span>` : ''}`;

        // Full dotted path lives in data-tooltip so the Aurora tooltip
        // system (which queries `[data-tooltip]` via MutationObserver)
        // shows it on hover. Useful in flat-list mode where the row no
        // longer carries the parent scope inline, but also handy in
        // hierarchical mode for deeply nested signals.
        row.setAttribute('data-tooltip', fullName);

        row.innerHTML = `
            <span class="wave-tree-chevron spacer"></span>
            <input type="checkbox" class="wave-tree-checkbox" tabindex="-1">
            <span class="wave-tree-icon"><i class="ph ph-pulse"></i></span>
            <span class="wave-tree-name">
                ${nameSpanHtml}
            </span>
        `;

        const cb = row.querySelector('.wave-tree-checkbox');
        cb.checked = this.selected.has(fullName);

        cb.addEventListener('click', (e) => {
            e.stopPropagation();
            if (cb.checked) this.selected.add(fullName);
            else this.selected.delete(fullName);
            this.renderTree();
        });

        return row;
    }

    _moduleCheckState(node) {
        const all = [];
        const walk = (n) => {
            for (const sig of n.signals) all.push(`${n.scopePath}.${sig.name}`);
            for (const child of n.children) walk(child);
        };
        walk(node);
        if (all.length === 0) return { all: false, partial: false };
        const checked = all.filter((s) => this.selected.has(s)).length;
        if (checked === 0) return { all: false, partial: false };
        if (checked === all.length) return { all: true, partial: false };
        return { all: false, partial: true };
    }

    _toggleScope(node, turnOn) {
        const walk = (n) => {
            for (const sig of n.signals) {
                const full = `${n.scopePath}.${sig.name}`;
                if (turnOn) this.selected.add(full);
                else this.selected.delete(full);
            }
            for (const child of n.children) walk(child);
        };
        walk(node);
    }

    _updateCounter() {
        if (!this.elements.counter) return;
        const n = this.selected.size;
        const tr = (k, p) => (window.t ? window.t(k, p) : k);
        // Two keys instead of an ICU plural — fine for {0/1, many}; if a
        // third locale lands with more plural forms (Slavic, Arabic) we
        // promote to a plural-aware helper at that point.
        this.elements.counter.textContent = n === 1
            ? tr('modal.waveConfig.selectedCountOne')
            : tr('modal.waveConfig.selectedCountOther', { count: n });
    }

    _escape(text) {
        const d = document.createElement('div');
        d.textContent = text ?? '';
        return d.innerHTML;
    }

    /**
     * Return HTML-escaped `text` with every occurrence of the current
     * filter pattern wrapped in `<mark>`. When the filter is inactive,
     * behaves identically to `_escape`. The regex is cloned to avoid
     * sharing `lastIndex` state with `_computeFilterMatches`.
     */
    _highlightMatches(text) {
        if (!this._filterRegex || !text) return this._escape(text);
        const re = new RegExp(this._filterRegex.source, this._filterRegex.flags);
        let out = '';
        let last = 0;
        let m;
        let safety = 0;
        while ((m = re.exec(text)) !== null && safety++ < 1000) {
            // Zero-width match: advance manually so the loop terminates.
            if (m.index === re.lastIndex) { re.lastIndex++; continue; }
            out += this._escape(text.slice(last, m.index));
            out += `<mark>${this._escape(m[0])}</mark>`;
            last = m.index + m[0].length;
        }
        out += this._escape(text.slice(last));
        return out;
    }

    // ------------- save -------------------------

    async save() {
        const projectPath = ProjectStore.getProjectPath();
        const spfPath = ProjectStore.getSpfPath();
        if (!projectPath || !spfPath) {
            this.close();
            return;
        }
        const cfg = await SpfStore.read(spfPath);
        const tbKey = tbKeyFromPath(cfg.testbenchFile);
        if (!tbKey) {
            // Sem testbench definido — nao temos onde persistir.
            this.close();
            return;
        }
        // Sort for stable diffs in the wavestate JSON.
        const list = [...this.selected].sort();

        // Detecta se o usuario mexeu na selecao. Comparacao por
        // conjunto: tamanhos iguais E todos os elementos em comum.
        const changed = this.selected.size !== this._initialSelection.size
            || [...this.selected].some((s) => !this._initialSelection.has(s));

        await WaveStore.update(projectPath, tbKey, (state) => {
            state.tbPath = cfg.testbenchFile;
            state.tbModule = tbKey;
            state.waveSignals = list;
            state.wcInitialized = true;
            // wcCustomized so liga; uma vez customizado, fica. O reset
            // implicito vem da troca de testbench (cada tb tem flag
            // propria).
            if (changed) state.wcCustomized = true;
        });
        this.close();
    }
}

const waveConfigManager = new WaveConfigManager();

if (typeof window !== 'undefined') {
    // Globally exposed so a future toolbar button + command palette
    // entry can call window.waveConfigManager.open() without an import
    // cycle.
    window.waveConfigManager = waveConfigManager;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waveConfigManager.initialize());
} else {
    waveConfigManager.initialize();
}

export { waveConfigManager, WaveConfigManager };
