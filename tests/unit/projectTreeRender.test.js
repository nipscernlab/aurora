// @vitest-environment happy-dom
//
// Regression tests for the verilog view's key-based reconciler
// (RenderMixin in js/project/project_tree_render.js, mixed into
// ProjectTreeManager). ARCHITECTURE.md §8 calls this out explicitly:
// "Multiple identical-data renders are zero-mutation no-ops. Don't
// replace this with destroy-and-rebuild."
//
// The mixin imports nothing external, it reads `this` (verilogFiles,
// a couple of path helpers) and writes into the container handed back
// by window.treeView.getContainer('verilog'). So we drive it with a
// stub treeView pointing at a detached <div> and a hand-built `this`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RenderMixin } from '../../js/project/project_tree_render.js';

/** Cheap, real-enough extension helper (mirrors the state mixin's). */
function getFileExtension(name) {
    const i = String(name || '').lastIndexOf('.');
    return i < 0 ? '' : name.slice(i).toLowerCase();
}

/**
 * Build a manager-like object carrying RenderMixin. `_getProcessorForFile`
 * reads an optional `proc` field off each file so tests can exercise the
 * grouping/separator paths without the real path-parsing logic.
 */
function makeManager(container) {
    window.treeView = { getContainer: (n) => (n === 'verilog' ? container : null) };
    return Object.assign(
        {
            verilogFiles: [],
            missingFiles: [],
            getFileExtension,
            _getProcessorForFile: (file) => file.proc ?? null,
        },
        RenderMixin,
    );
}

const f = (path, extra = {}) => ({ path, name: path.split('/').pop(), category: 'synthesizable', ...extra });

/** path -> the .verilog-file-item node currently rendered for it. */
function rowMap(container) {
    const map = new Map();
    for (const row of container.querySelectorAll('.verilog-file-item')) {
        map.set(row.dataset.filePath, row);
    }
    return map;
}

let container;
let mgr;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mgr = makeManager(container);
});

afterEach(() => {
    document.body.innerHTML = '';
    delete window.treeView;
    vi.restoreAllMocks();
});

describe('RenderMixin.renderTree — basic projection', () => {
    it('renders one row per file, keyed by data-file-path', () => {
        mgr.verilogFiles = [f('a.v'), f('b.v'), f('c.v')];
        mgr.renderTree();

        const rows = container.querySelectorAll('.verilog-file-item');
        expect(rows.length).toBe(3);
        expect([...rows].map((r) => r.dataset.filePath)).toEqual(['a.v', 'b.v', 'c.v']);
    });

    it('reflects category in the row classes', () => {
        mgr.verilogFiles = [f('dut.v'), f('tb.v', { category: 'testbench' })];
        mgr.renderTree();

        const rows = rowMap(container);
        expect(rows.get('dut.v').classList.contains('synthesizable')).toBe(true);
        expect(rows.get('tb.v').classList.contains('testbench')).toBe(true);
    });
});

describe('RenderMixin.renderTree — key-based reconciliation (§8: zero-mutation no-ops)', () => {
    it('re-rendering identical data reuses the SAME row nodes (no rebuild)', () => {
        mgr.verilogFiles = [f('a.v'), f('b.v'), f('c.v')];
        mgr.renderTree();
        const before = rowMap(container);

        mgr.renderTree(); // identical input — must be a no-op on node identity
        const after = rowMap(container);

        for (const path of before.keys()) {
            expect(after.get(path)).toBe(before.get(path)); // same object, not a rebuild
        }
    });

    it('adding a file inserts only the new row, keeping existing instances', () => {
        mgr.verilogFiles = [f('a.v'), f('b.v')];
        mgr.renderTree();
        const before = rowMap(container);

        mgr.verilogFiles = [f('a.v'), f('b.v'), f('c.v')];
        mgr.renderTree();
        const after = rowMap(container);

        expect(after.get('a.v')).toBe(before.get('a.v'));
        expect(after.get('b.v')).toBe(before.get('b.v'));
        expect(after.get('c.v')).toBeTruthy();
        expect(before.has('c.v')).toBe(false); // genuinely new
        expect(after.size).toBe(3);
    });

    it('removing a file drops only its row', () => {
        mgr.verilogFiles = [f('a.v'), f('b.v'), f('c.v')];
        mgr.renderTree();
        const before = rowMap(container);

        mgr.verilogFiles = [f('a.v'), f('c.v')];
        mgr.renderTree();
        const after = rowMap(container);

        expect(after.has('b.v')).toBe(false);
        expect(before.get('b.v').isConnected).toBe(false); // detached from DOM
        expect(after.get('a.v')).toBe(before.get('a.v'));
        expect(after.get('c.v')).toBe(before.get('c.v'));
    });

    it('reorders existing rows in place rather than recreating them', () => {
        mgr.verilogFiles = [f('a.v'), f('b.v'), f('c.v')];
        mgr.renderTree();
        const before = rowMap(container);

        mgr.verilogFiles = [f('c.v'), f('a.v'), f('b.v')];
        mgr.renderTree();
        const after = rowMap(container);

        // Same instances, new order.
        expect(after.get('a.v')).toBe(before.get('a.v'));
        expect(after.get('c.v')).toBe(before.get('c.v'));
        expect([...container.querySelectorAll('.verilog-file-item')].map((r) => r.dataset.filePath))
            .toEqual(['c.v', 'a.v', 'b.v']);
    });

    it('collapses pre-existing duplicate rows for the same path', () => {
        mgr.verilogFiles = [f('a.v')];
        mgr.renderTree();
        // Simulate a row a buggy upstream render could have left behind.
        const dup = container.querySelector('.verilog-file-item').cloneNode(true);
        container.appendChild(dup);
        expect(container.querySelectorAll('.verilog-file-item').length).toBe(2);

        mgr.renderTree();
        expect(container.querySelectorAll('[data-file-path="a.v"]').length).toBe(1);
    });
});

describe('RenderMixin.renderTree — empty state', () => {
    it('shows the empty placeholder and clears rows when there are no files', () => {
        mgr.verilogFiles = [f('a.v'), f('b.v')];
        mgr.renderTree();
        expect(container.querySelectorAll('.verilog-file-item').length).toBe(2);

        mgr.verilogFiles = [];
        mgr.renderTree();
        expect(container.querySelectorAll('.verilog-file-item').length).toBe(0);
        expect(container.classList.contains('verilog-empty')).toBe(true);
        expect(container.querySelector('.verilog-empty-state')).toBeTruthy();
    });

    it('drops stale processor separators when the project empties out', () => {
        mgr.verilogFiles = [f('top.v'), f('P/Hardware/x.v', { proc: 'P' })];
        mgr.renderTree();
        expect(container.querySelector('.verilog-processor-separator')).toBeTruthy();

        mgr.verilogFiles = [];
        mgr.renderTree();
        expect(container.querySelector('.verilog-processor-separator')).toBeNull();
    });
});

describe('RenderMixin.renderTree — processor grouping', () => {
    it('emits a processor separator per group and an "Imported" header only when user files coexist', () => {
        mgr.verilogFiles = [
            f('user.v'), // no proc → imported/user file
            f('P/Hardware/a.v', { proc: 'P' }),
            f('Q/Hardware/b.v', { proc: 'Q' }),
        ];
        mgr.renderTree();

        const seps = [...container.querySelectorAll('.verilog-processor-separator')]
            .map((s) => s.dataset.processorName);
        expect(seps).toContain('P');
        expect(seps).toContain('Q');
        expect(seps).toContain('__imported__'); // user files + procs → Imported header shown
    });

    it('omits the "Imported" header when every file belongs to a processor', () => {
        mgr.verilogFiles = [
            f('P/Hardware/a.v', { proc: 'P' }),
            f('P/Hardware/b.v', { proc: 'P' }),
        ];
        mgr.renderTree();

        const seps = [...container.querySelectorAll('.verilog-processor-separator')]
            .map((s) => s.dataset.processorName);
        expect(seps).toEqual(['P']); // only the processor separator, no __imported__
    });
});

describe('RenderMixin.renderTree — missing-files notice', () => {
    it('renders a notice card listing missing files and removes it once cleared', () => {
        mgr.verilogFiles = [f('a.v')];
        mgr.missingFiles = [{ name: 'gone.v', path: '/proj/gone.v' }];
        mgr.renderTree();
        expect(container.querySelector('.verilog-missing-notice')).toBeTruthy();

        mgr.missingFiles = [];
        mgr.renderTree();
        expect(container.querySelector('.verilog-missing-notice')).toBeNull();
    });
});
