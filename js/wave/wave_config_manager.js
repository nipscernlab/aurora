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

import { parseVerilogModules, buildHierarchyTree } from '../verilog/signal_parser.js';
import { ProjectStore } from '../project/project_store.js';
import { ProjectConfigStore } from '../project/project_config_store.js';

class WaveConfigManager {
    constructor() {
        this.modal = null;
        this.elements = {};
        this.tree = null;
        this.selected = new Set();
        this.collapsedScopes = new Set();
        this._initialized = false;
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

        // Restore saved selection if present, else apply the default.
        if (Array.isArray(config.waveSignals) && config.waveSignals.length > 0) {
            this.selected = new Set(config.waveSignals);
        } else {
            this._applyDefaultSelection();
        }

        this.renderTree();
    }

    _applyDefaultSelection() {
        this.selected = new Set();
        if (!this.tree) return;
        for (const sig of this.tree.signals) {
            this.selected.add(`${this.tree.scopePath}.${sig.name}`);
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

        row.innerHTML = `
            <span class="wave-tree-chevron spacer"></span>
            <input type="checkbox" class="wave-tree-checkbox" tabindex="-1">
            <span class="wave-tree-icon"><i class="ph ph-pulse"></i></span>
            <span class="wave-tree-name">
                <span class="signal-kind">${this._escape(sig.kind)}</span>
                <span>${this._escape(sig.name)}</span>
                ${sig.range ? `<span class="signal-range">[${this._escape(sig.range)}]</span>` : ''}
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
        await ProjectConfigStore.update(projectPath, (cfg) => {
            cfg.waveSignals = list;
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
