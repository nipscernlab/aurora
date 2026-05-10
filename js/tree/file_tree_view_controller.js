/**
 * file_tree_view_controller.js — Single owner of "which file-tree
 * view is showing right now" + the toggle button.
 *
 * Pre-controller, the state was spread across:
 *   - TreeViewState.isHierarchical (in file_tree_manager.js)
 *   - TreeViewState.hierarchyData (set by 5+ compile paths)
 *   - TreeViewState.compilationModule (re-pinned per compile)
 *   - verilogTreeManager.isVerilogTreeActive
 *   - The mode radios (Project Mode / Processor Mode)
 *   - One click listener in file_tree_manager.js (toggleHierarchyView)
 *   - A second click listener in compilation_module.js (setupHierarchyToggle)
 * and each refactor that closed one bug opened another because the
 * pieces never agreed on who owned the transition.
 *
 * This controller owns:
 *   1. The toggle button click listener (exactly one, attached once).
 *   2. The current view name ('standard' | 'verilog' | 'hierarchy').
 *   3. The hierarchy data (so the toggle knows when it's available).
 *   4. The "what view do we show in 'file mode'?" decision (depends
 *      on Project Mode vs Processor Mode).
 *
 * Renderers register a function for their view. When the view
 * becomes active, the controller calls the renderer. Renderers
 * never directly mutate the toggle button or the view-switch state.
 *
 * Public API (everything outside this file goes through here):
 *   showFileMode()             — flip to whatever "file" means in
 *                                 the current IDE mode
 *   showHierarchyMode()        — flip to hierarchy view (no-op if
 *                                 no hierarchyData yet)
 *   isShowingHierarchy()
 *   isShowingFileMode()
 *   setHierarchyData(data)     — compile flow tells us hierarchy
 *                                 data exists (or is gone)
 *   getHierarchyData()
 *   registerRenderer(name, fn) — view registers its render function
 *
 * Single click listener path:
 *   user clicks toggle → controller decides direction based on
 *   isShowingHierarchy() → calls showHierarchyMode() or
 *   showFileMode() → setActive(name) on tree_view + invokes the
 *   registered renderer. No other code path mutates the active
 *   view.
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
     * Flip to the file-mode view. "File mode" depends on the IDE
     * mode radio: Project Mode → verilog picker; Processor Mode →
     * standard folder listing. Centralising the decision here means
     * nobody else needs to read the mode radio to figure it out.
     */
    showFileMode() {
        const isProject = document.getElementById('Project Mode')?.checked === true;
        this._showView(isProject ? 'verilog' : 'standard');
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
    window.verilogTreeManager?.renderVerilogTree?.();
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
