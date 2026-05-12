/**
 * wave_config_manager.js — Wave Configuration modal.
 *
 * Hierarchical signal picker: walks the project's Verilog files, builds
 * a tree rooted at the testbench module, lets the user check which
 * signals get $dumpvars'd. Selection persists to projectOriented.json
 * as `waveSignals: [...]`.
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
import { ProjectStore } from '../project/project_store.js';
import { ProjectConfigStore } from '../project/project_config_store.js';
import { CompilationModule } from '../compilation/compilation_module.js';

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
        // diferenca seta waveSignalsCustomized=true em
        // projectOriented.json e o compile flow passa a injetar o
        // proprio $dumpvars (override do testbench).
        this._initialSelection = new Set();
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
            refreshBtn:        document.getElementById('waveConfigRefresh'),
            selectDefaultBtn:  document.getElementById('waveConfigSelectDefault'),
            selectAllBtn:      document.getElementById('waveConfigSelectAll'),
            selectNoneBtn:     document.getElementById('waveConfigSelectNone'),
            tree:              document.getElementById('waveConfigTree'),
            counter:           document.getElementById('waveConfigSelectedCount'),
        };
    }

    bindListeners() {
        this.elements.closeBtn?.addEventListener('click', () => this.close());
        this.elements.cancelBtn?.addEventListener('click', () => this.close());
        this.elements.saveBtn?.addEventListener('click', () => this.save());
        this.elements.refreshBtn?.addEventListener('click', () => this.refresh());
        this.elements.selectDefaultBtn?.addEventListener('click', () => this.selectDefault());
        this.elements.selectAllBtn?.addEventListener('click', () => this.selectAll());
        this.elements.selectNoneBtn?.addEventListener('click', () => this.selectNone());

        // Toolbar button — primary entry point for the modal. Also
        // wired up here (rather than in renderer.js / compilation_flow)
        // so the manager owns its full lifecycle.
        document.getElementById('waveConfigBtn')?.addEventListener('click', () => this.open());

        // Esc closes when modal is open.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) this.close();
        });

        // Click on overlay (outside the container) closes — same as
        // every other modal in Aurora.
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });
    }

    // ------------- open/close ------------------

    isOpen() {
        return this.modal?.getAttribute('aria-hidden') === 'false';
    }

    async open() {
        const projectPath = ProjectStore.getProjectPath();

        if (projectPath) {
            const compiler = new CompilationModule(projectPath);
            await compiler.loadConfig();

            // STEP 1 — local cleanup: validate the saved waveSignals
            // against the current Verilog hierarchy and auto-prune
            // entries that no longer exist. Cheap regex parse, runs
            // BEFORE any iverilog work so a stale selection from a
            // previous code edit can't outlive the rename. The
            // notification (twave) and the projectOriented.json write
            // happen inside _validateWaveSelection.
            const cfg = await ProjectConfigStore.read(projectPath);
            const filePaths = [
                ...(cfg.synthesizableFiles || []).map((f) => f?.path),
                cfg.testbenchFile,
                ...(cfg.testbenchFiles || []).map((f) => f?.path),
            ].filter(Boolean);
            const moduleNameFromPath = (p) => p && p.split(/[\\/]/).pop().replace(/\.v$/i, '');
            const tbModule = moduleNameFromPath(cfg.testbenchFile)
                || moduleNameFromPath(cfg.topLevelFile);
            const rawSelected = Array.isArray(cfg.waveSignals) ? cfg.waveSignals : [];
            if (tbModule && filePaths.length > 0) {
                await compiler._validateWaveSelection(rawSelected, filePaths, tbModule);
            }

            // STEP 2 — informational iverilog syntax check. Used to
            // gate the modal but that created a dead-end (if a stale
            // selection caused the iverilog failure, the user
            // couldn't reach the picker to clean it up). Now purely
            // informational; modal opens regardless. Roda pros dois
            // fluxos (com e sem processador) — syntaxCheck usa
            // -y components/HDL que resolve a biblioteca SAPHO, entao
            // funciona em projeto com processador tambem.
            if (typeof window.switchTerminal === 'function') {
                window.switchTerminal('terminal-tveri');
            }
            await compiler.syntaxCheck();
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
        if (!projectPath) {
            this.tree = null;
            this.renderTree();
            return;
        }

        const config = await ProjectConfigStore.read(projectPath);
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
        this.aliasMap = buildAliasMap(this._hierarchyToScopes(this.tree));

        // Estrategia de selecao inicial:
        //  1. waveSignalsCustomizedFor === testbench atual  -> usa a
        //     selecao salva em waveSignals (usuario assumiu o controle
        //     PARA ESTE testbench).
        //  2. testbench tem $dumpfile/$dumpvars hand-written E VCD
        //     existe   -> deriva a selecao do VCD atual (mostra ao
        //     usuario o que ESTA sendo dumpado pelo $dumpvars dele).
        //  3. caso contrario -> usa waveSignals salvo, ou aplica o
        //     default (signals do escopo do testbench).
        //
        // O flag e atrelado ao path do testbench, nao um boolean
        // global — trocar o testbench naturalmente "expira" a
        // customizacao porque os paths nao batem mais.
        const customized = config.waveSignalsCustomizedFor
            && config.testbenchFile
            && config.waveSignalsCustomizedFor === config.testbenchFile;
        if (customized) {
            this.selected = new Set(Array.isArray(config.waveSignals) ? config.waveSignals : []);
        } else {
            const vcdDerived = await this._tryDeriveSelectionFromVcd(projectPath, config, topModule);
            if (vcdDerived) {
                this.selected = vcdDerived;
            } else if (Array.isArray(config.waveSignals) && config.waveSignals.length > 0) {
                this.selected = new Set(config.waveSignals);
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
            const vcdPath = await window.electronAPI.joinPath(componentsPath, 'Temp', `${topModule}.vcd`);
            const vcdExists = await window.electronAPI.fileExists(vcdPath);
            if (!vcdExists) return null;

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
        this.selected = new Set();
        if (!this.tree) return;
        const walk = (node) => {
            for (const sig of node.signals) {
                this.selected.add(`${node.scopePath}.${sig.name}`);
            }
            for (const child of node.children) walk(child);
        };
        walk(this.tree);
        this.renderTree();
    }

    selectNone() {
        this.selected = new Set();
        this.renderTree();
    }

    // ------------- rendering -------------------

    renderTree() {
        const treeEl = this.elements.tree;
        if (!treeEl) return;
        treeEl.innerHTML = '';

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

        const walk = (node, depth, parentVisible) => {
            treeEl.appendChild(this._renderModuleRow(node, depth, parentVisible));
            const collapsed = this.collapsedScopes.has(node.scopePath);
            const childrenVisible = parentVisible && !collapsed;
            for (const sig of node.signals) {
                treeEl.appendChild(this._renderSignalRow(node, sig, depth + 1, childrenVisible));
            }
            for (const child of node.children) {
                walk(child, depth + 1, childrenVisible);
            }
        };
        walk(this.tree, 0, true);

        this._updateCounter();
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
            ? `<span class="signal-alias">${this._escape(alias)}</span>
               <span class="signal-raw">${this._escape(sig.name)}${sig.range ? `[${this._escape(sig.range)}]` : ''}</span>`
            : `<span class="signal-kind">${this._escape(sig.kind)}</span>
               <span>${this._escape(sig.name)}</span>
               ${sig.range ? `<span class="signal-range">[${this._escape(sig.range)}]</span>` : ''}`;

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
        this.elements.counter.textContent = `${n} signal${n === 1 ? '' : 's'} selected`;
    }

    _escape(text) {
        const d = document.createElement('div');
        d.textContent = text ?? '';
        return d.innerHTML;
    }

    // ------------- save -------------------------

    async save() {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath) {
            this.close();
            return;
        }
        // Sort for stable diffs in projectOriented.json.
        const list = [...this.selected].sort();

        // Detecta se o usuario mexeu na selecao. Comparacao por
        // conjunto: tamanhos iguais E todos os elementos em comum.
        const changed = this.selected.size !== this._initialSelection.size
            || [...this.selected].some((s) => !this._initialSelection.has(s));

        await ProjectConfigStore.update(projectPath, (cfg) => {
            cfg.waveSignals = list;
            // O flag e atrelado ao path do testbench atual. Trocar o
            // testbench depois "expira" automaticamente — o novo
            // testbench cai no caminho "pre-popular do VCD" porque o
            // path nao bate mais.
            if (changed && cfg.testbenchFile) {
                cfg.waveSignalsCustomizedFor = cfg.testbenchFile;
            }
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
