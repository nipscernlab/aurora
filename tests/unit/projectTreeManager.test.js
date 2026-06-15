// @vitest-environment happy-dom
//
// Regression tests for the ProjectTreeManager boot contract (ARCHITECTURE.md
// §8, "Manager constructors do I/O"). This is the most-documented instance of
// that fragility, and it was untestable until the boot refactor that moved the
// DOMContentLoaded gate out of the constructor and into the module bootstrap
// (mirroring GtkwPickerManager's pure-constructor + idempotent-initialize
// shape).
//
// The whole point: importing file_mode.js pulls a self-bootstrapping chain
// (tab_manager, monaco, the file_mode singleton). We force readyState='loading'
// BEFORE the import so every guarded auto-init defers, and we never dispatch
// DOMContentLoaded — so nothing in the chain fires and the import stays clean,
// no electronAPI/monaco hacks needed. Then we drive initialize() directly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
// refreshTree() does project discovery via electronAPI (and tab watchers reach
// it too); a permissive no-op proxy keeps initialize()'s downstream async calls
// from throwing. None of this runs at import time — only when we call
// initialize() ourselves.
window.electronAPI = new Proxy({}, { get: () => () => {} });

const { ProjectTreeManager, projectTreeManager } = await import('../../js/project/file_mode.js');

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('ProjectTreeManager — pure constructor (§8: constructors do I/O)', () => {
    it('queries no DOM and caches nothing at construction time', () => {
        const spy = vi.spyOn(document, 'getElementById');
        const mgr = new ProjectTreeManager();

        // The fragility class is a constructor that reaches into the DOM /
        // kicks off init(). This one must not — only field setup + pure binds.
        expect(spy).not.toHaveBeenCalled();
        expect(mgr._initialized).toBe(false);
        expect(mgr.elements).toEqual({});
    });
});

describe('ProjectTreeManager — boot gate is in the bootstrap, not the constructor (§8)', () => {
    it('the imported singleton stays uninitialized while readyState is loading', () => {
        // Imported with readyState='loading' → the module bootstrap deferred
        // initialize() to DOMContentLoaded, which this test never dispatches.
        // So the singleton was constructed (pure) but has cached nothing. If
        // the gate were back in the constructor, this would already be wired.
        expect(projectTreeManager._initialized).toBe(false);
        expect(projectTreeManager.elements).toEqual({});
    });
});

describe('ProjectTreeManager — idempotent initialize (§8: no double-wiring)', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="file-tree"></div>';
    });

    it('caches and wires exactly once across repeated initialize() calls', () => {
        const mgr = new ProjectTreeManager();
        const cacheSpy = vi.spyOn(mgr, 'cacheElements');
        const wireSpy = vi.spyOn(mgr, 'setupEventListeners');

        mgr.initialize();
        mgr.initialize();
        mgr.initialize();

        expect(mgr._initialized).toBe(true);
        // setupEventListeners() runs activateTree() -> refreshTree() -> back
        // into initialize(); the topmost-set _initialized flag must make that
        // reentry a no-op, so the work still happens exactly once.
        expect(cacheSpy).toHaveBeenCalledTimes(1);
        expect(wireSpy).toHaveBeenCalledTimes(1);
        expect(mgr.elements.fileTree).toBe(document.getElementById('file-tree'));
    });

    it('is safe to construct before the DOM exists, then initialize once it lands', () => {
        document.body.innerHTML = ''; // no #file-tree yet
        const early = new ProjectTreeManager();
        expect(() => early.initialize()).not.toThrow();
        expect(early.elements.fileTree).toBeNull(); // cached, but nothing was there

        // DOM lands; a fresh manager initializes cleanly against it.
        document.body.innerHTML = '<div id="file-tree"></div>';
        const ready = new ProjectTreeManager();
        ready.initialize();
        expect(ready.elements.fileTree).toBe(document.getElementById('file-tree'));
    });
});
