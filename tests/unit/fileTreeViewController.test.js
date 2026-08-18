// @vitest-environment happy-dom
//
// Regression tests for the #file-tree subsystem's single controller.
// These pin the invariants documented in ARCHITECTURE.md §8 ("Known
// fragilities"), the ones a six-bug debugging chain settled on. Each
// test maps to a property that, if it regresses, reopens one of those
// historical bugs:
//
//   - three physically separate DOM subtrees (renderers can't collide)
//   - exactly ONE toggle click listener, attached once
//   - the toggle's enabled state is a function of "is data available"
//   - we're never stuck on an empty pane (hierarchy data vanishes →
//     fall back to the file view; project closes → leave 'standard')
//   - a renderer that throws still leaves the view switched
//
// The controller + tree_view touch document/window at import time, so
// this file runs under happy-dom. Each test gets a fresh module graph
// (vi.resetModules) so the singletons and the one-shot toggle listener
// don't bleed across cases.
import { describe, it, expect, afterEach, vi } from 'vitest';

/** Minimal DOM the controller wires itself into on initialize(). */
function mountDom() {
    document.body.innerHTML = `
        <div id="file-tree"></div>
        <button id="alternate-tree-toggle">
            <i></i><span class="toggle-text"></span>
        </button>
    `;
}

/**
 * Load a fresh controller. window.* the modules read are configured
 * BEFORE import, because the module self-initializes on import (happy-dom
 * reports readyState 'complete'), and initialize() reads them then.
 */
async function load({ projectPath = null, projectStore = null } = {}) {
    vi.resetModules();
    mountDom();

    // Reset every global the subsystem reads so cases don't leak state.
    delete window.currentProjectPath;
    delete window.ProjectStore;
    delete window.treeView;
    delete window.fileTreeViewController;
    delete window.t;
    if (projectPath) window.currentProjectPath = projectPath;
    if (projectStore) window.ProjectStore = projectStore;

    await import('../../js/tree/tree_view.js');
    const mod = await import('../../js/tree/file_tree_view_controller.js');
    const controller = mod.fileTreeViewController;
    controller.initialize(); // idempotent; ensures init even if import timing changes
    return {
        controller,
        treeView: window.treeView,
        btn: document.getElementById('alternate-tree-toggle'),
        fileTree: document.getElementById('file-tree'),
    };
}

/** A ProjectStore test double that captures subscribers so we can emit. */
function makeProjectStore() {
    const subs = [];
    return { subscribe: (cb) => subs.push(cb), emit: () => subs.forEach((cb) => cb()) };
}

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('FileTreeViewController — DOM topology (§8)', () => {
    it('creates three physically separate subtrees inside #file-tree', async () => {
        const { treeView, fileTree } = await load();

        const verilog = treeView.getContainer('verilog');
        const hierarchy = treeView.getContainer('hierarchy');
        const standard = treeView.getContainer('standard');

        expect(verilog).toBeTruthy();
        expect(hierarchy).toBeTruthy();
        expect(standard).toBeTruthy();
        // Distinct nodes, renderers writing into one cannot touch another.
        expect(verilog).not.toBe(hierarchy);
        expect(verilog).not.toBe(standard);
        expect(hierarchy).not.toBe(standard);
        // All are direct children of #file-tree.
        for (const el of [verilog, hierarchy, standard]) {
            expect(el.parentElement).toBe(fileTree);
        }
    });

    it('switching views is an attribute flip that preserves other subtrees content', async () => {
        const { controller, treeView, fileTree } = await load({ projectPath: '/proj' });
        controller.setHierarchyData({ root: 'top' });

        // Each renderer writes only into its own subtree.
        treeView.getContainer('hierarchy').innerHTML = '<div class="hier-row">kept</div>';
        treeView.getContainer('verilog').innerHTML = '<div class="vlg-row">kept</div>';

        controller.showHierarchyMode();
        expect(fileTree.dataset.activeView).toBe('hierarchy');
        controller.showFileMode();
        expect(fileTree.dataset.activeView).toBe('verilog');

        // Inactive subtrees keep their content (display:none, not wiped):
        // the whole point of the separate-subtree design.
        expect(treeView.getContainer('hierarchy').querySelector('.hier-row')).toBeTruthy();
        expect(treeView.getContainer('verilog').querySelector('.vlg-row')).toBeTruthy();
    });
});

describe('FileTreeViewController — toggle enabled is a function of available data (§8)', () => {
    it('disables the toggle when only the verilog view is cyclable', async () => {
        const { btn, controller } = await load(); // no project, no hierarchy data
        expect(controller.getActiveView()).toBe('verilog');
        expect(btn.disabled).toBe(true);
    });

    it('enables the toggle once hierarchy data exists', async () => {
        const { btn, controller } = await load();
        expect(btn.disabled).toBe(true);

        controller.setHierarchyData({ root: 'top' });
        expect(btn.disabled).toBe(false);
        expect(controller.showHierarchyMode()).toBe(true);
        expect(controller.isShowingHierarchy()).toBe(true);
    });

    it('enables the toggle (standard joins the cycle) once a project is open', async () => {
        const { btn, controller } = await load({ projectPath: '/proj' });
        expect(btn.disabled).toBe(false);
        expect(controller.showStandardMode()).toBe(true);
        expect(controller.isShowingStandard()).toBe(true);
    });

    it('refuses hierarchy/standard when their data/project is absent', async () => {
        const { controller } = await load(); // nothing open
        expect(controller.showHierarchyMode()).toBe(false);
        expect(controller.showStandardMode()).toBe(false);
        expect(controller.isShowingFileMode()).toBe(true);
    });
});

describe('FileTreeViewController — one click listener, correct cycle (§8)', () => {
    it('cycles verilog → hierarchy → standard → verilog on click', async () => {
        const { btn, controller } = await load({ projectPath: '/proj' });
        controller.setHierarchyData({ root: 'top' });

        expect(controller.getActiveView()).toBe('verilog');
        btn.click();
        expect(controller.getActiveView()).toBe('hierarchy');
        btn.click();
        expect(controller.getActiveView()).toBe('standard');
        btn.click();
        expect(controller.getActiveView()).toBe('verilog');
    });

    it('attaches exactly one listener even if the binder runs repeatedly', async () => {
        const { btn, controller } = await load({ projectPath: '/proj' });
        controller.setHierarchyData({ root: 'top' });

        // Hammer the (idempotent) binder, the dataset guard must keep it
        // to a single listener. A stacked listener would advance the view
        // by more than one step per physical click.
        controller._installToggleListener();
        controller._installToggleListener();
        controller.initialize();

        expect(controller.getActiveView()).toBe('verilog');
        btn.click();
        expect(controller.getActiveView()).toBe('hierarchy'); // exactly one step
    });

    it('ignores clicks while the toggle is disabled', async () => {
        const { btn, controller } = await load(); // only verilog → disabled
        btn.click();
        expect(controller.getActiveView()).toBe('verilog');
    });
});

describe('FileTreeViewController — never stuck on an empty pane (§8)', () => {
    it('falls back to the file view when hierarchy data is invalidated mid-view', async () => {
        const { controller } = await load();
        controller.setHierarchyData({ root: 'top' });
        controller.showHierarchyMode();
        expect(controller.isShowingHierarchy()).toBe(true);

        controller.setHierarchyData(null); // e.g. a new compile invalidated it
        expect(controller.isShowingFileMode()).toBe(true);
    });

    it('leaves the standard view when the project closes', async () => {
        const store = makeProjectStore();
        const { controller } = await load({ projectPath: '/proj', projectStore: store });
        controller.showStandardMode();
        expect(controller.isShowingStandard()).toBe(true);

        delete window.currentProjectPath; // project closed
        store.emit();
        expect(controller.isShowingFileMode()).toBe(true);
    });
});

describe('FileTreeViewController — renderer isolation (§8)', () => {
    it('still switches the view when a registered renderer throws', async () => {
        const { controller } = await load();
        controller.setHierarchyData({ root: 'top' });
        controller.showHierarchyMode();

        vi.spyOn(console, 'error').mockImplementation(() => {});
        controller.registerRenderer('verilog', () => {
            throw new Error('renderer blew up');
        });

        // The throw must not escape, and the view must still flip.
        expect(() => controller.showFileMode()).not.toThrow();
        expect(controller.getActiveView()).toBe('verilog');
        expect(console.error).toHaveBeenCalled();
    });
});
