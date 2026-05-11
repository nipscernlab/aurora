import { describe, it, expect } from 'vitest';
import { extractSignalRefs } from '../js/wave/gtkw_writer.js';

describe('extractSignalRefs', () => {
    it('pulls dotted paths and strips trailing ranges', () => {
        const text = [
            '[*]',
            '[*] GTKWave Analyzer save file',
            '[dumpfile] "/tmp/tb.vcd"',
            '[savefile] "/tmp/tb.gtkw"',
            '@28',
            'tb_counter.clk',
            'tb_counter.q[3:0]',
            '-Group A',
            'tb_counter.dut.q_next[3:0]',
            '[group_close]',
        ].join('\n');
        expect(extractSignalRefs(text).sort()).toEqual([
            'tb_counter.clk',
            'tb_counter.dut.q_next',
            'tb_counter.q',
        ]);
    });

    it('ignores non-signal lines (decorations, comments, blank)', () => {
        const text = [
            '',
            '   ',
            '# a comment',
            '[*] header',
            '@1401200',
            '-MyGroup',
            '*another star',
            'tb.foo',
        ].join('\n');
        expect(extractSignalRefs(text)).toEqual(['tb.foo']);
    });

    it('rejects a bare identifier with no dot (not a hierarchical path)', () => {
        // A bare `clk` would mean module-less which Aurora's flow never
        // emits; if we see one, it's not something we can validate
        // against `tb_counter.<sig>` style VCD scopes.
        expect(extractSignalRefs('clk\ntb.dut.q')).toEqual(['tb.dut.q']);
    });

    it('returns an empty array for empty / non-string input', () => {
        expect(extractSignalRefs('')).toEqual([]);
        expect(extractSignalRefs(null)).toEqual([]);
        expect(extractSignalRefs(undefined)).toEqual([]);
    });

    it('dedupes repeated references', () => {
        const text = 'tb.clk\ntb.clk\ntb.q\n';
        expect(extractSignalRefs(text).sort()).toEqual(['tb.clk', 'tb.q']);
    });
});
