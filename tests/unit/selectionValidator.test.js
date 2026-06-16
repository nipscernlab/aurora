import { describe, it, expect } from 'vitest';
import { validateSelection } from '../../js/wave/selection_validator.ts';

const sampleTree = {
    name: 'tb_counter',
    instanceName: null,
    scopePath: 'tb_counter',
    signals: [
        { name: 'clk' },
        { name: 'rst' },
        { name: 'q' },
    ],
    children: [
        {
            name: 'counter',
            instanceName: 'dut',
            scopePath: 'tb_counter.dut',
            signals: [
                { name: 'clk' },
                { name: 'q_next' },
            ],
            children: [],
        },
    ],
};

describe('validateSelection', () => {
    it('keeps selections that still resolve and reports the rest as dropped', () => {
        const r = validateSelection(
            ['tb_counter.clk', 'tb_counter.rst', 'tb_counter.dut.q_next', 'tb_counter.gone'],
            sampleTree,
        );
        expect(r.valid.sort()).toEqual(['tb_counter.clk', 'tb_counter.dut.q_next', 'tb_counter.rst']);
        expect(r.dropped).toEqual(['tb_counter.gone']);
    });

    it('drops a renamed signal — the user-reported regression scenario', () => {
        // User had `rst` selected, then renamed it to `rs` in source.
        const treeAfterRename = {
            ...sampleTree,
            signals: [{ name: 'clk' }, { name: 'rs' }, { name: 'q' }],
        };
        const r = validateSelection(['tb_counter.rst', 'tb_counter.clk'], treeAfterRename);
        expect(r.valid).toEqual(['tb_counter.clk']);
        expect(r.dropped).toEqual(['tb_counter.rst']);
    });

    it('returns empty arrays for an empty selection (no work to do)', () => {
        expect(validateSelection([], sampleTree)).toEqual({ valid: [], dropped: [] });
    });

    it('keeps the selection intact when no hierarchy is available (parse failed)', () => {
        // Conservative: better to let iverilog produce a real error than
        // to silently strip the user's selection because we couldn't parse.
        const r = validateSelection(['tb_counter.rst'], null);
        expect(r.valid).toEqual(['tb_counter.rst']);
        expect(r.dropped).toEqual([]);
    });

    it('handles selections that point at submodule signals', () => {
        const r = validateSelection(
            ['tb_counter.dut.q_next', 'tb_counter.dut.unknown'],
            sampleTree,
        );
        expect(r.valid).toEqual(['tb_counter.dut.q_next']);
        expect(r.dropped).toEqual(['tb_counter.dut.unknown']);
    });
});
