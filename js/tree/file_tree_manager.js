import { electronAPI } from '../app/electron_api.js';
import '../components/aurora-tree.js';
// file_tree_manager.js
//
// Owns the file-tree view bootstrap: the TreeViewState façade over the
// view controller, the directory watcher, and the no-project empty
// state. The actual file rows are rendered by the verilog view
// (file_mode.js) and the hierarchy view (compilation_module.js). The
// old generic "standard" tree renderer + its file-search lived here too
// until 2026-05, when they were removed (fossil of the IDE-mode toggle,
// and the source of a duplicate file-open handler bug).

// --- Tree View State, façade over fileTreeViewController -------
//
// Pre-controller, TreeViewState owned isHierarchical / hierarchyData /
// isToggleEnabled / compilationModule and a copy lived in BOTH this
// file and tree_view_state_module.js (different objects, never in
// sync). Now it's a thin façade:
//
//   - isHierarchical, hierarchyData, isToggleEnabled  → getters that
//     read from the controller. No private fields here.
//   - setHierarchical / hierarchyData write           → route to the
//     controller's showHierarchyMode / showFileMode / setHierarchyData.
//   - enable/disableToggle                            → no-ops. The
//     controller enables the toggle automatically when hierarchyData
//     is set; disables when it's null. Lifecycle calls (e.g. on each
//     CompilationModule construction) used to re-disable the toggle
//     blindly, that's the bug class we just removed.
//   - setCompilationModule / compilationModule        → no-ops. The
//     controller's hierarchy renderer always reads from
//     window._latestCompilationModule (set in the constructor) so
//     callers don't need to track "the latest" themselves.
//
// New code should call window.fileTreeViewController directly. The
// façade exists so the dozens of legacy reads/writes don't all have
// to migrate at once, and so any future drift between TreeViewState
// and the controller is impossible by construction (there's no
// "TreeViewState" state to drift).
const TreeViewState = {
    get isHierarchical() {
        return window.fileTreeViewController?.isShowingHierarchy() ?? false;
    },
    set isHierarchical(value) {
        // Treat as a request to flip views; the controller is
        // idempotent against same-state writes.
        if (value) window.fileTreeViewController?.showHierarchyMode();
        else window.fileTreeViewController?.showFileMode();
    },

    get hierarchyData() {
        return window.fileTreeViewController?.getHierarchyData() ?? null;
    },
    set hierarchyData(data) {
        window.fileTreeViewController?.setHierarchyData(data);
    },

    get isToggleEnabled() {
        return !!window.fileTreeViewController?.getHierarchyData();
    },

    get compilationModule() {
        return window._latestCompilationModule ?? null;
    },

    setHierarchical(value) {
        this.isHierarchical = value;
    },

    setCompilationModule(_module) {
        // No-op: the controller resolves the latest CompilationModule
        // via window._latestCompilationModule, set by the constructor.
    },

    enableToggle() {
        // No-op: toggle enables automatically when hierarchyData
        // is set on the controller. Old code called this without
        // setting data first, which produced a useless enabled-but-
        // empty toggle.
    },

    disableToggle() {
        // No-op: same reasoning. If you actually want to disable the
        // toggle (because the data became invalid), set
        // hierarchyData = null instead.
    },
};

// --- Empty-state placeholder ---------------------------------------
//
// "No project open" state → a click-to-create-project card. It renders
// into the verilog view subcontainer (the only file view now) and owns
// the whole pane. Intentionally one large tap target, the previous
// "empty file tree with just the header" left the user looking at a
// blank pane with no obvious next step.
//
// (The project-open-but-zero-processors hint is handled by the verilog
// view's own empty state in project_tree_render.js.)

function buildEmptyStateCard() {
    const tr = (k) => (window.t ? window.t(k) : k);
    const config = {
        icon: 'ph ph-folder-plus',
        title: tr('fileTree.empty.noProjectTitle'),
        cta:   tr('fileTree.empty.noProjectCta'),
        onClick: () => {
            // The new-project modal is wired in index.html's inline
            // script via the trigger→modal map (newProjectBtn →
            // newProjectModal). Clicking the toolbar button keeps
            // every existing pre-condition (focus, store reset,
            // import-file priming) intact instead of forking a
            // second open path here.
            document.getElementById('newProjectBtn')?.click();
        },
    };

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tree-empty-state tree-empty-no-project';
    card.setAttribute('aria-label', config.title);
    card.innerHTML = `
        <span class="tree-empty-state-icon"><i class="${config.icon}" aria-hidden="true"></i></span>
        <span class="tree-empty-state-title">${escapeHtml(config.title)}</span>
        <span class="tree-empty-state-cta">${escapeHtml(config.cta)}</span>
    `;
    card.addEventListener('click', config.onClick);
    return card;
}

/**
 * Drop a full-replacement empty-state card into the verilog view
 * container (the active file view). Used for the "no project open"
 * state, there are no files to compete with, so the card owns the
 * whole pane. When a project later loads, renderTree() strips this
 * card before painting the file rows.
 */
function renderTreeEmptyState() {
    const container = window.treeView?.getContainer('verilog');
    if (!container) return;
    container.innerHTML = '';
    container.appendChild(buildEmptyStateCard());
}


// Minimal escaper for the i18n strings we drop into innerHTML above.
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[ch]);
}


if (typeof window !== 'undefined') {
    window.renderTreeEmptyState = renderTreeEmptyState;
}

// --- Directory Watcher ---
class DirectoryWatcher {
    constructor() {
        this.currentWatchedDirectory = null;
        this.isWatching = false;
    }

    async startWatching(directoryPath) {
        await this.stopWatching();
        if (!directoryPath) return;
        try {
            await electronAPI.watchDirectory(directoryPath);
            this.currentWatchedDirectory = directoryPath;
            this.isWatching = true;
        } catch (error) {
            console.error('Failed to start directory watching:', error);
        }
    }

    async stopWatching() {
        if (this.currentWatchedDirectory && this.isWatching) {
            try {
                await electronAPI.stopWatchingDirectory(this.currentWatchedDirectory);
                this.currentWatchedDirectory = null;
                this.isWatching = false;
            } catch (error) {
                console.error('Failed to stop directory watching:', error);
            }
        }
    }
}

// --- Public Manager Object ---
class FileTreeManager {
    constructor() {
        this.directoryWatcher = new DirectoryWatcher();
    }

    initialize() {
        TreeViewState.disableToggle();
        TreeViewState.setHierarchical(false);

        document.getElementById('refresh-button')?.addEventListener('click', () => {
            if (TreeViewState.isHierarchical) return;
            if (window.fileTreeViewController?.isShowingStandard?.()) {
                window.standardTreeRenderer?.render?.();
                return;
            }
            window.projectTreeManager?.refreshTree();
        });

        // Hierarchy toggle e owned por file_tree_view_controller.js:
        // um unico click listener instalado la cuida do flip file ↔
        // hierarchy. Nao re-attachar aqui; ja tivemos dois listeners
        // brigando no mesmo botao.

        electronAPI.onDirectoryChanged((dir, _files) => {
            if (dir !== this.directoryWatcher.currentWatchedDirectory) return;
            if (TreeViewState.isHierarchical) return;
            // Standard (folder) view mirrors the disk, re-render it so
            // created/deleted files show up; the renderer restores the
            // currently-expanded folders.
            if (window.fileTreeViewController?.isShowingStandard?.()) {
                window.standardTreeRenderer?.render?.();
                return;
            }
            // Verilog view: re-le o .spf pra pegar processor creation/
            // deletion que reescreve o arquivo.
            window.projectTreeManager?.refreshTree?.();
        });

        // Directory watcher errors used to be emitted by main but never
        // consumed (the renderer had no listener), the error was silently
        // lost. Mirror the file-watcher's handling: surface it to the console.
        electronAPI.onDirectoryWatcherError?.((dir, error) => {
            console.error(`Directory watcher error for ${dir}:`, error);
        });

        // Initialize tree based on saved mode
        this.initializeTreeBasedOnMode();
    }

    /**
     * Primeira pintura da tree: dispara o verilog picker assim que o
     * projectTreeManager terminou seu init.
     *
     * O nome "initializeTreeBasedOnMode" e historico (era um branch
     * sobre IDE mode). Modo unico hoje, chama activateTree
     * direto. A coalescencia em activateTree garante que isso
     * + projectManager.loadProject nao gerem duplo loadConfiguration.
     */
    async initializeTreeBasedOnMode() {
        const ptm = window.projectTreeManager;
        if (!ptm) return;
        // Espera o sinal REAL de readiness (DOMContentLoaded + cacheElements
        // + setupEventListeners, exposto como initPromise) em vez de chutar
        // 100ms. O sleep curto deixava activateTree rodar antes do DOM da
        // tree ser cacheado em cold start lento, e bailava silenciosamente.
        if (ptm.initPromise) await ptm.initPromise;
        await ptm.activateTree();
    }


toggleHierarchyView() {
    // Delegate to the file-tree view controller, it owns the
    // toggle button and the view-switch state. Kept this stub so
    // legacy callers (command palette, etc.) that still call
    // `fileTreeManager.toggleHierarchyView()` keep working.
    if (window.fileTreeViewController?.isShowingHierarchy?.()) {
        window.fileTreeViewController.showFileMode();
    } else {
        window.fileTreeViewController?.showHierarchyMode?.();
    }
}


    get watcher() {
        return this.directoryWatcher;
    }
}

const fileTreeManager = new FileTreeManager();
export { fileTreeManager, TreeViewState };


// --- Empty-state wiring ---------------------------------------------
//
// Two signals decide whether the no-project card belongs in the file
// view:
//
//   1. ProjectStore goes from "has project" to "no project" or vice
//      versa  →  swap between the no-project card and the live tree.
//   2. App boot with no auto-restored project  →  render the
//      no-project card immediately instead of leaving a blank pane.
//
// Both converge on `renderTreeEmptyState()` (no-project card) /
// projectTreeManager.refreshTree() (live tree), defined above /
// in file_mode.js. The "project open but zero processors" hint is
// owned by the verilog view's own empty state.
function bootstrapTreeEmptyStateWiring() {
    const onProjectChange = (snapshot) => {
        if (snapshot?.projectPath) {
            // Switched into a project, render the verilog tree so files
            // populate (it strips the no-project card on the way in).
            window.projectTreeManager?.refreshTree?.();
        } else {
            renderTreeEmptyState();
        }
    };

    if (window.ProjectStore?.subscribe) {
        window.ProjectStore.subscribe(onProjectChange);
    }

    // Cold start with no project: paint the empty card immediately so
    // the user is never staring at a blank file-tree pane. Skipped
    // when a project auto-restore is in flight (signalled by the
    // localStorage key index.html's inline boot script reads), in
    // that case the user briefly sees the "Loading…" header and the
    // ProjectStore subscriber above will refresh into the live tree
    // once the IPC roundtrip lands.
    let willAutoRestore = false;
    try { willAutoRestore = !!localStorage.getItem('aurora-last-project-path'); }
    catch (_) { /* localStorage unavailable, treat as no restore */ }

    if (!window.currentProjectPath && !willAutoRestore) {
        // Defer one tick so treeView has had a chance to mount its
        // subcontainers (initialize() runs on DOMContentLoaded).
        queueMicrotask(() => {
            if (!window.currentProjectPath) renderTreeEmptyState();
        });
    } else if (!window.currentProjectPath && willAutoRestore) {
        // Auto-restore safety net: if it never completes (e.g. the
        // stored .spf was moved), the user shouldn't be stuck on a
        // blank tree forever. After ~3s of no project, fall back to
        // the empty card so they can manually create/open a project.
        setTimeout(() => {
            if (!window.currentProjectPath) renderTreeEmptyState();
        }, 3000);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapTreeEmptyStateWiring, { once: true });
} else {
    bootstrapTreeEmptyStateWiring();
}