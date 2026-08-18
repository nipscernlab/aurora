/**
 * file_tree_view_controller.js: single owner do par "qual file-tree
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
 *   2. O nome da view ativa ('verilog' | 'hierarchy').
 *   3. Os dados de hierarquia (pra saber se o toggle deve estar
 *      habilitado).
 *
 * Renderers registram uma funcao por view. Quando a view fica
 * ativa, o controller chama o renderer. Renderers nunca mutam o
 * toggle nem o estado de view direto.
 *
 * API publica:
 *   showFileMode()            , vai pra 'verilog' (a view de
 *                                 arquivos do projeto)
 *   showHierarchyMode()       , vai pra hierarchy (no-op se
 *                                 nao ha hierarchyData)
 *   isShowingHierarchy()
 *   isShowingFileMode()
 *   setHierarchyData(data)    , compile flow avisa que ha (ou
 *                                 nao ha mais) hierarchy data
 *   getHierarchyData()
 *   registerRenderer(name, fn), view registra sua render fn
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
        this._activeView = 'verilog';
        this._hierarchyData = null;
        this._renderers = Object.create(null);
        this._initialized = false;
    }

    /**
     * Idempotent. Safe to call from multiple init paths, only the
     * first call attaches the click listener.
     */
    initialize() {
        if (this._initialized) return;
        treeView.initialize();
        this._installToggleListener();
        this._wireProjectStore();
        // The button's icon/label/tooltip are produced via window.t; the
        // span has no data-i18n binding, so re-render it ourselves when
        // the locale changes.
        if (typeof window !== 'undefined') {
            window.addEventListener('aurora:locale-changed', () => this._updateToggleUI());
        }
        this._updateToggleUI();
        this._initialized = true;
    }

    /**
     * Keep the toggle's enabled state in sync with project open/close:
     * 'standard' only joins the cycle once a project is open, so the
     * button enables the moment one loads (no compile required) and
     * disables again on close. On close we also leave 'standard' so we
     * don't sit on a now-empty folder tree.
     */
    _wireProjectStore() {
        const onChange = () => {
            if (!this._hasProject() && this.isShowingStandard()) {
                this._showView('verilog');
            } else {
                this._updateToggleUI();
            }
        };
        if (window.ProjectStore?.subscribe) {
            window.ProjectStore.subscribe(onChange);
        } else {
            // ProjectStore module may not have loaded yet, retry once.
            queueMicrotask(() => window.ProjectStore?.subscribe?.(onChange));
        }
    }

    /**
     * @param {'verilog'|'hierarchy'|'standard'} name
     * @param {() => void} renderFn, invoked when this view becomes
     *   active. Should be idempotent (renderer-decides-what-to-do
     *   based on its own state). If the render throws, the controller
     *   logs and continues, view is still set active.
     */
    registerRenderer(name, renderFn) {
        this._renderers[name] = renderFn;
    }

    /**
     * Flip pra view de arquivos. Modo unico → sempre o verilog
     * picker (a unica view de arquivos hoje).
     */
    showFileMode() {
        this._showView('verilog');
    }

    /**
     * Flip to hierarchy view. No-op (returns false) if there's no
     * hierarchy data, the toggle button should already be disabled
     * in that case, but we double-check so direct callers behave
     * correctly too.
     */
    showHierarchyMode() {
        if (!this._hierarchyData) return false;
        this._showView('hierarchy');
        return true;
    }

    /**
     * Flip to the standard folder tree (rooted at the .spf directory).
     * No-op (returns false) if no project is open, there are no folders
     * to browse, and the toggle skips this view in that case.
     */
    showStandardMode() {
        if (!this._hasProject()) return false;
        this._showView('standard');
        return true;
    }

    isShowingHierarchy() { return this._activeView === 'hierarchy'; }
    isShowingStandard() { return this._activeView === 'standard'; }
    isShowingFileMode() { return this._activeView === 'verilog'; }
    getActiveView() { return this._activeView; }

    /**
     * Compile flow calls this when it produces (or invalidates)
     * hierarchy data. The hierarchy toggle's enabled state and the
     * "go to hierarchy" path key off this single field.
     */
    setHierarchyData(data) {
        this._hierarchyData = data ?? null;
        // Hierarchy data went away while we were showing it (e.g. a new
        // compile invalidated the old tree), drop back to the file view
        // so we're never stuck on an empty hierarchy pane.
        if (!this._hierarchyData && this.isShowingHierarchy()) {
            this._showView('verilog');
            return;
        }
        this._updateToggleUI();
    }

    getHierarchyData() {
        return this._hierarchyData;
    }

    // ------------- private -------------

    _hasProject() {
        return typeof window !== 'undefined' && !!window.currentProjectPath;
    }

    /**
     * The views the toggle can currently rotate through, in cycle order.
     * 'verilog' is always present; 'hierarchy' only with compiled data;
     * 'standard' only with a project open. The button is enabled iff
     * there's more than one.
     */
    _cyclableViews() {
        const views = ['verilog'];
        if (this._hierarchyData) views.push('hierarchy');
        if (this._hasProject()) views.push('standard');
        return views;
    }

    /** Next view after the active one in the cyclable list (wraps). */
    _nextView() {
        const views = this._cyclableViews();
        const idx = views.indexOf(this._activeView);
        // If the active view fell out of the cyclable set, restart at the
        // first available one.
        return views[(idx + 1) % views.length] ?? 'verilog';
    }

    _showView(name) {
        if (!['verilog', 'hierarchy', 'standard'].includes(name)) {
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
        // Idempotent, multiple initialize() calls won't stack
        // listeners.
        if (btn.dataset.ftvcBound === 'true') return;
        btn.dataset.ftvcBound = 'true';
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            this._showView(this._nextView());
        });
    }

    _updateToggleUI() {
        const btn = document.getElementById(TOGGLE_BTN_ID);
        if (!btn) return;

        // Enabled whenever there's more than one view to rotate through.
        // With a project open that's always true (verilog + standard);
        // before any project it's just verilog → disabled.
        const enabled = this._cyclableViews().length > 1;
        btn.disabled = !enabled;
        btn.classList.toggle('disabled', !enabled);

        const tr = (k) => (typeof window !== 'undefined' && window.t ? window.t(k) : null);
        const view = VIEW_UI[this._activeView] ?? VIEW_UI.verilog;

        const icon = btn.querySelector('i');
        const text = btn.querySelector('.toggle-text');
        if (icon) icon.className = view.icon;
        if (text) text.textContent = tr(view.labelKey) ?? view.label;

        // The button reflects the CURRENT view (not the next one), with
        // three modes a "switch to X" label can't name the single next
        // target cleanly. The tooltip says it cycles. We set data-tooltip
        // (Aurora's custom tooltip wins over native title, see
        // js/ui/tooltip.js) rather than .title.
        btn.classList.toggle('active', this._activeView !== 'verilog');
        if (enabled) {
            const label = tr(view.labelKey) ?? view.label;
            btn.dataset.tooltip = (tr('toolbar.treeView.cycleTooltip') ?? 'File tree view: {{mode}} — click to switch')
                .replace('{{mode}}', label);
        } else {
            btn.dataset.tooltip = tr('toolbar.treeView.disabledTooltip')
                ?? 'Open a project to browse files';
        }
    }
}

// Per-view button presentation. Icon + label name the CURRENTLY active
// view; labelKey resolves through window.t when i18n is available.
const VIEW_UI = {
    verilog:   { icon: 'ph ph-list-bullets',   label: 'Files',     labelKey: 'toolbar.treeView.files' },
    hierarchy: { icon: 'ph ph-tree-structure', label: 'Hierarchy', labelKey: 'toolbar.treeView.hierarchy' },
    standard:  { icon: 'ph ph-folders',        label: 'Folders',   labelKey: 'toolbar.treeView.folders' },
};

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
// per compile" issue (CompilationModule especially), we always use
// the freshest instance.

fileTreeViewController.registerRenderer('verilog', () => {
    window.projectTreeManager?.renderTree?.();
});

fileTreeViewController.registerRenderer('hierarchy', () => {
    // The latest CompilationModule's renderHierarchicalTree falls
    // back to the controller's own hierarchyData when its instance
    // copy is null (see compilation_module.js renderHierarchicalTree
    //, it consults fileTreeViewController.getHierarchyData()).
    const cm = window._latestCompilationModule;
    if (cm?.renderHierarchicalTree) cm.renderHierarchicalTree();
});

fileTreeViewController.registerRenderer('standard', () => {
    // Folder tree rooted at the .spf directory. render() is async but
    // the controller's renderer contract is fire-and-forget, the view
    // is already active; the rows paint when the lazy reads land.
    window.standardTreeRenderer?.render();
});

export { fileTreeViewController, FileTreeViewController };
