/**
 * file_tree_view_controller.js — single owner do par "qual file-tree
 * view esta visivel agora" + listener do toggle button.
 *
 * Pre-controller, esse estado estava espalhado por 6+ lugares
 * (TreeViewState.isHierarchical, .hierarchyData, .compilationModule;
 * projectTreeManager.isTreeActive; mode radios; dois click
 * listeners diferentes no mesmo botao). Cada refactor que fechava um
 * bug abria outro. O design atual centraliza tudo aqui.
 *
 * O controller e dono de:
 *   1. O click listener do toggle (exatamente um, attached once).
 *   2. O nome da view ativa ('standard' | 'verilog' | 'hierarchy').
 *   3. Os dados de hierarquia (pra saber se o toggle deve estar
 *      habilitado).
 *
 * Renderers registram uma funcao por view. Quando a view fica
 * ativa, o controller chama o renderer. Renderers nunca mutam o
 * toggle nem o estado de view direto.
 *
 * API publica:
 *   showFileMode()             — vai pra 'verilog' (a view de
 *                                 arquivos do projeto)
 *   showHierarchyMode()        — vai pra hierarchy (no-op se
 *                                 nao ha hierarchyData)
 *   isShowingHierarchy()
 *   isShowingFileMode()
 *   setHierarchyData(data)     — compile flow avisa que ha (ou
 *                                 nao ha mais) hierarchy data
 *   getHierarchyData()
 *   registerRenderer(name, fn) — view registra sua render fn
 *
 * Path de um clique: user clica toggle → controller decide direcao
 * via isShowingHierarchy() → chama showHierarchyMode() ou
 * showFileMode() → setActive(name) no tree_view + invoca o renderer
 * registrado. Nenhum outro caminho muta a active view.
 */

import { treeView } from './tree_view.js';

const TOGGLE_BTN_ID = 'alternate-tree-toggle';

class FileTreeViewController {
    constructor() {
        this._activeView = 'standard';
        this._hierarchyData = null;
        this._renderers = Object.create(null);
        this._initialized = false;
    }

    /**
     * Idempotent. Safe to call from multiple init paths — only the
     * first call attaches the click listener.
     */
    initialize() {
        if (this._initialized) return;
        treeView.initialize();
        this._installToggleListener();
        this._updateToggleUI();
        this._initialized = true;
    }

    /**
     * @param {'standard'|'verilog'|'hierarchy'} name
     * @param {() => void} renderFn — invoked when this view becomes
     *   active. Should be idempotent (renderer-decides-what-to-do
     *   based on its own state). If the render throws, the controller
     *   logs and continues — view is still set active.
     */
    registerRenderer(name, renderFn) {
        this._renderers[name] = renderFn;
    }

    /**
     * Flip pra view de arquivos. Modo unico → sempre o verilog
     * picker. O renderer 'standard' continua registrado pra compat
     * com codigo legado que invoca _showView('standard') direto.
     */
    showFileMode() {
        this._showView('verilog');
    }

    /**
     * Flip to hierarchy view. No-op (returns false) if there's no
     * hierarchy data — the toggle button should already be disabled
     * in that case, but we double-check so direct callers behave
     * correctly too.
     */
    showHierarchyMode() {
        if (!this._hierarchyData) return false;
        this._showView('hierarchy');
        return true;
    }

    isShowingHierarchy() { return this._activeView === 'hierarchy'; }
    isShowingFileMode() { return !this.isShowingHierarchy(); }
    getActiveView() { return this._activeView; }

    /**
     * Compile flow calls this when it produces (or invalidates)
     * hierarchy data. The hierarchy toggle's enabled state and the
     * "go to hierarchy" path key off this single field.
     */
    setHierarchyData(data) {
        this._hierarchyData = data ?? null;
        this._updateToggleUI();
    }

    getHierarchyData() {
        return this._hierarchyData;
    }

    // ------------- private -------------

    _showView(name) {
        if (!['standard', 'verilog', 'hierarchy'].includes(name)) {
            console.warn(`FileTreeViewController: unknown view "${name}"`);
            return;
        }
        treeView.setActive(name);
        this._activeView = name;
        const fn = this._renderers[name];
        if (typeof fn === 'function') {
            try { fn(); }
            catch (err) { console.error(`Renderer for "${name}" threw:`, err); }
        }
        this._updateToggleUI();
    }

    _installToggleListener() {
        const btn = document.getElementById(TOGGLE_BTN_ID);
        if (!btn) return;
        // Idempotent — multiple initialize() calls won't stack
        // listeners.
        if (btn.dataset.ftvcBound === 'true') return;
        btn.dataset.ftvcBound = 'true';
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            if (this.isShowingHierarchy()) {
                this.showFileMode();
            } else {
                this.showHierarchyMode();
            }
        });
    }

    _updateToggleUI() {
        const btn = document.getElementById(TOGGLE_BTN_ID);
        if (!btn) return;
        const enabled = !!this._hierarchyData;
        btn.disabled = !enabled;
        btn.classList.toggle('disabled', !enabled);
        const icon = btn.querySelector('i');
        const text = btn.querySelector('.toggle-text');
        if (this.isShowingHierarchy()) {
            if (icon) icon.className = 'ph ph-list-bullets';
            if (text) text.textContent = 'Standard';
            btn.classList.add('active');
            btn.title = 'Switch to file tree';
        } else {
            if (icon) icon.className = 'ph ph-tree-structure';
            if (text) text.textContent = 'Hierarchical';
            btn.classList.remove('active');
            btn.title = enabled
                ? 'Switch to hierarchical module view'
                : 'Compile Verilog to generate hierarchy';
        }
    }
}

const fileTreeViewController = new FileTreeViewController();

if (typeof window !== 'undefined') {
    window.fileTreeViewController = fileTreeViewController;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => fileTreeViewController.initialize());
} else {
    fileTreeViewController.initialize();
}

// ---- Built-in renderer registrations -----------------------------
// The three renderers live in their own modules but their lifecycle
// is shared with the controller. Here we wire delegating renderer
// functions: each one looks up the relevant manager at call time and
// invokes its renderer. That sidesteps the "manager is reconstructed
// per compile" issue (CompilationModule especially) — we always use
// the freshest instance.

fileTreeViewController.registerRenderer('verilog', () => {
    window.projectTreeManager?.renderVerilogTree?.();
});

fileTreeViewController.registerRenderer('standard', () => {
    if (typeof window.refreshFileTree === 'function') window.refreshFileTree();
});

fileTreeViewController.registerRenderer('hierarchy', () => {
    // The latest CompilationModule's renderHierarchicalTree falls
    // back to the controller's own hierarchyData when its instance
    // copy is null (see compilation_module.js renderHierarchicalTree
    // — it consults fileTreeViewController.getHierarchyData()).
    const cm = window._latestCompilationModule;
    if (cm?.renderHierarchicalTree) cm.renderHierarchicalTree();
});

export { fileTreeViewController, FileTreeViewController };
