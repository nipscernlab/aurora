/**
 * tree_view.js: Single source of truth for which file-tree view is
 * showing right now.
 *
 * Aurora has two ways to present the file tree:
 *   - 'verilog'  , verilog picker (synth/testbench rows w/ badges):
 *                   the project file view (also hosts the empty-state
 *                   cards when there is no project / no processors)
 *   - 'hierarchy', module instance tree from Yosys
 *   - 'standard' , plain folder/file tree rooted at the project (.spf)
 *                   directory; lazy-reads children on expand
 *
 * 'standard' was removed in 2026-05 (fossil of the old IDE-mode toggle,
 * with a duplicate file-open handler that caused bugs) and reintroduced
 * in 2026-06 as a deliberate third view in the toggle cycle. This time
 * it is owned by a single renderer (standard_tree_render.js) with one
 * file-open path, so the old divergent-routing bug class can't return.
 *
 * Pre-2026-05, all views rendered into the same `#file-tree` element
 * and competed via a class-based lock (`verilog-mode-active`). That
 * proved fragile in three separate ways:
 *   - Deferred writes (setTimeout / await) escaped the top-of-function
 *     guard and stomped a view that took ownership in between.
 *   - Renderers left DOM artifacts of their view that the next view
 *     had to know how to clean, which only worked if every renderer
 *     was kept in sync with every other.
 *   - State spread across multiple flags (TreeViewState.isHierarchical,
 *     projectTreeManager.isTreeActive, mode radios) drifted
 *     out of sync.
 *
 * This controller replaces the lock pattern with three physically
 * separate DOM subtrees inside `#file-tree`, plus a single
 * `data-active-view` attribute that drives CSS visibility. Each
 * renderer writes into its OWN subtree only, they cannot collide.
 * Switching views is one attribute change; no DOM mutation needed.
 *
 *   <div id="file-tree" data-active-view="verilog">
 *     <div class="tree-view tree-view-verilog">…</div>
 *     <div class="tree-view tree-view-hierarchy">…</div>
 *   </div>
 *
 * Renderers call `treeView.getContainer(name)` to get the target
 * div. To switch views, `treeView.setActive(name)`. Done.
 */

const VIEW_NAMES = Object.freeze(['verilog', 'hierarchy', 'standard']);

class TreeViewController {
    constructor() {
        this.fileTree = null;
    }

    /**
     * Idempotent setup. Safe to call multiple times. Also called
     * lazily by `getContainer` / `setActive` so callers don't need
     * to worry about initialization order.
     */
    initialize() {
        const fileTree = document.getElementById('file-tree');
        if (!fileTree) return false;
        this.fileTree = fileTree;

        // Create the three subcontainers if not already there.
        for (const name of VIEW_NAMES) {
            if (!fileTree.querySelector(`:scope > .tree-view-${name}`)) {
                const div = document.createElement('div');
                div.className = `tree-view tree-view-${name}`;
                fileTree.appendChild(div);
            }
        }

        if (!fileTree.dataset.activeView) {
            fileTree.dataset.activeView = 'verilog';
        }
        return true;
    }

    /**
     * Returns the dedicated subcontainer for `viewName`, creating
     * the wrapper if needed. Pass the renderer's view name in;
     * write into the returned element directly.
     */
    getContainer(viewName) {
        if (!VIEW_NAMES.includes(viewName)) {
            console.warn(`TreeView: unknown view "${viewName}"`);
            return null;
        }
        if (!this.fileTree) this.initialize();
        return this.fileTree?.querySelector(`:scope > .tree-view-${viewName}`) ?? null;
    }

    /**
     * Switch which view is visible. CSS in css/tree/file_tree.css
     * keys off `[data-active-view]` to show/hide. Other views'
     * subtrees stay in the DOM but are display:none, preserving
     * their state for cheap toggling without re-render.
     */
    setActive(viewName) {
        if (!VIEW_NAMES.includes(viewName)) {
            console.warn(`TreeView: unknown view "${viewName}"`);
            return;
        }
        if (!this.fileTree) this.initialize();
        if (!this.fileTree) return;
        this.fileTree.dataset.activeView = viewName;
    }

    getActive() {
        if (!this.fileTree) this.initialize();
        return this.fileTree?.dataset.activeView ?? null;
    }

    /**
     * Wipe a single view's subtree. Used on close-project and when a
     * renderer wants a clean slate (rare, most renderers should
     * reconcile rather than wipe).
     */
    clear(viewName) {
        const c = this.getContainer(viewName);
        if (c) c.innerHTML = '';
    }

    /** Wipe all three. Used on close-project. */
    clearAll() {
        for (const name of VIEW_NAMES) this.clear(name);
    }
}

const treeView = new TreeViewController();

if (typeof window !== 'undefined') {
    window.treeView = treeView;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => treeView.initialize());
} else {
    treeView.initialize();
}

export { treeView, TreeViewController, VIEW_NAMES };
