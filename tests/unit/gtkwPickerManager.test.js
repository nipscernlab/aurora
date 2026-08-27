// @vitest-environment happy-dom
//
// Regression tests for the manager-boot contract (ARCHITECTURE.md §8,
// "Manager constructors do I/O"). That fragility note warns that several
// managers reach into the DOM / IPC from their constructor (or an init()
// the constructor kicks off), so moving those calls is the exact change
// that breaks startup in subtle ways.
//
// GtkwPickerManager is the clean exemplar of the SAFE shape the codebase
// is converging on: a pure constructor (no DOM, no IPC) plus a separate,
// idempotent initialize() that tolerates the DOM not being there yet.
// These tests pin that shape so a regression toward "do I/O in the
// constructor" or "re-attach listeners on every init" is caught.
//
// Note on scope: ProjectTreeManager (file_mode.js) carries the most
// heavily-documented instance of this fragility (its initPromise gates
// DOM caching on DOMContentLoaded). It is deliberately NOT covered here:
// importing it pulls the whole boot chain (TabManager.initialize() and
// monaco's AMD require fire as import side-effects), so any unit test of
// it is coupled to unrelated boot code and would break for unrelated
// reasons. Making it testable means extracting those import-time side
// effects first, a refactor, tracked separately.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { GtkwPickerManager } from '../../js/wave/gtkw_picker.js';
import { WaveStore } from '../../js/wave/wave_state_store.js';

const TOOLBAR_HTML = `
    <div id="gtkwPicker">
        <button id="gtkwPickerButton"><span class="gtkw-picker-label"></span></button>
    </div>
    <div id="gtkwPickerMenu"></div>
`;

function mountToolbar() {
    document.body.innerHTML = TOOLBAR_HTML;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('GtkwPickerManager — pure constructor (§8: constructors do I/O)', () => {
    it('queries no DOM and caches no elements at construction time', () => {
        const spy = vi.spyOn(document, 'getElementById');
        const inst = new GtkwPickerManager();

        // The fragility class is a manager that reaches for #gtkwPicker in
        // its constructor. This one must not, boot order can't break it.
        expect(spy).not.toHaveBeenCalled();
        expect(inst.root).toBeNull();
        expect(inst.button).toBeNull();
        expect(inst.menu).toBeNull();
        expect(inst._initialized).toBe(false);
    });

    it('is safe to construct before the DOM exists, then initialize once it lands', () => {
        const inst = new GtkwPickerManager(); // empty document

        // initialize() with the toolbar absent is a tolerant no-op: it must
        // not throw and must NOT mark itself initialized, so a later call
        // (once the DOM lands) still takes. This is what makes the manager
        // independent of script/init order.
        expect(() => inst.initialize()).not.toThrow();
        expect(inst._initialized).toBe(false);

        mountToolbar();
        inst.initialize();
        expect(inst._initialized).toBe(true);
        expect(inst.root).toBe(document.getElementById('gtkwPicker'));
    });
});

describe('GtkwPickerManager — idempotent initialize (§8: one listener, attached once)', () => {
    it('does not stack the toggle listener across repeated initialize() calls', () => {
        mountToolbar();
        const inst = new GtkwPickerManager();
        inst.initialize();
        inst.initialize();
        inst.initialize();
        expect(inst._initialized).toBe(true);

        // initialize() runs refresh(), which disables the button with no
        // project open, and a disabled button swallows clicks. Re-enable
        // it so the click actually reaches the listener we're counting.
        const btn = document.getElementById('gtkwPickerButton');
        btn.disabled = false;

        // A stacked listener would fire _toggleOpen more than once per
        // physical click (stopPropagation only blocks bubbling, not
        // sibling listeners on the same node).
        const spy = vi.spyOn(inst, '_toggleOpen').mockImplementation(() => {});
        btn.click();
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

describe('GtkwPickerManager — cold boot does no IPC (§8)', () => {
    it('disables the button and renders the menu without reading wave state when no project is open', async () => {
        mountToolbar();
        const readSpy = vi.spyOn(WaveStore, 'read');

        const inst = new GtkwPickerManager();
        inst.initialize();    // kicks off refresh() internally
        await inst.refresh(); // and once explicitly, to settle any async

        const btn = document.getElementById('gtkwPickerButton');
        expect(btn.disabled).toBe(true);
        // No project → refresh() must early-return before WaveStore.read,
        // which is the only IPC hop. Hitting it on cold boot is the bug.
        expect(readSpy).not.toHaveBeenCalled();
        // The menu still painted its static rows (default + add).
        const rows = document.getElementById('gtkwPickerMenu').querySelectorAll('.gtkw-picker-row');
        expect(rows.length).toBeGreaterThanOrEqual(2);
    });
});
