import { describe, it, expect } from 'vitest';
import {
    pickSignalsToEmit,
    buildGtkwContent,
} from '../js/wave/gtkw_writer.js';

const sampleScopes = [
    {
        name: 'tb_counter',
        path: 'tb_counter',
        signals: [
            { name: 'clk',  width: 1, range: null,  type: 'reg' },
            { name: 'rst',  width: 1, range: null,  type: 'reg' },
            { name: 'q',    width: 4, range: '3:0', type: 'wire' },
        ],
    },
    {
        name: 'dut',
        path: 'tb_counter.dut',
        signals: [
            { name: 'clk',     width: 1, range: null,  type: 'wire' },
            { name: 'q_next',  width: 4, range: '3:0', type: 'wire' },
        ],
    },
];

describe('pickSignalsToEmit', () => {
    it('default (no selection) emits only top-scope testbench signals', () => {
        const { emit, dropped } = pickSignalsToEmit(sampleScopes, 'tb_counter', []);
        const names = emit.map((s) => s.fullName).sort();
        expect(names).toEqual(['tb_counter.clk', 'tb_counter.q', 'tb_counter.rst']);
        expect(dropped).toEqual([]);
    });

    it('selection match uses the explicit list, not the default', () => {
        const { emit } = pickSignalsToEmit(
            sampleScopes,
            'tb_counter',
            ['tb_counter.dut.q_next', 'tb_counter.clk'],
        );
        const names = emit.map((s) => s.fullName).sort();
        expect(names).toEqual(['tb_counter.clk', 'tb_counter.dut.q_next']);
    });

    it('selections not in the VCD are emitted as `dropped` instead of being silently skipped', () => {
        const { emit, dropped } = pickSignalsToEmit(
            sampleScopes,
            'tb_counter',
            ['tb_counter.does_not_exist', 'tb_counter.clk', 'tb_counter.dut.gone'],
        );
        const names = emit.map((s) => s.fullName);
        expect(names).toEqual(['tb_counter.clk']);
        expect(dropped.sort()).toEqual(['tb_counter.does_not_exist', 'tb_counter.dut.gone']);
    });

    it('range information is carried through for buses', () => {
        const { emit } = pickSignalsToEmit(sampleScopes, 'tb_counter', ['tb_counter.dut.q_next']);
        expect(emit[0].range).toBe('3:0');
    });

    it('default-mode never reports dropped (no selection means nothing to validate)', () => {
        const { dropped } = pickSignalsToEmit(sampleScopes, 'tb_counter', []);
        expect(dropped).toEqual([]);
    });
});

describe('buildGtkwContent', () => {
    it('emits the [dumpfile] header and one signal per line', () => {
        const { content } = buildGtkwContent({
            vcdPath: 'C:/tmp/tb_counter.vcd',
            gtkwPath: 'C:/tmp/tb_counter.gtkw',
            scopes: sampleScopes,
            tbModule: 'tb_counter',
        });
        expect(content).toContain('[dumpfile] "C:/tmp/tb_counter.vcd"');
        expect(content).toContain('[savefile] "C:/tmp/tb_counter.gtkw"');
        // top-scope signals only by default
        expect(content).toContain('tb_counter.clk');
        expect(content).toContain('tb_counter.rst');
        expect(content).toContain('tb_counter.q[3:0]');
        expect(content).not.toContain('tb_counter.dut');
    });

    it('honours user selection and emits range syntax for buses', () => {
        const { content } = buildGtkwContent({
            vcdPath: 'C:/tmp/x.vcd',
            gtkwPath: 'C:/tmp/x.gtkw',
            scopes: sampleScopes,
            tbModule: 'tb_counter',
            selectedSignals: ['tb_counter.dut.q_next', 'tb_counter.dut.clk'],
        });
        expect(content).toContain('tb_counter.dut.q_next[3:0]');
        expect(content).toContain('tb_counter.dut.clk');
        // default-scope signals are NOT emitted when a selection is in
        // play — that branch is one or the other, not both.
        expect(content).not.toMatch(/^tb_counter\.rst\b/m);
    });

    it('normalises Windows backslashes in paths to forward slashes', () => {
        const { content } = buildGtkwContent({
            vcdPath: 'C:\\nipscern\\Aurora\\Temp\\tb.vcd',
            gtkwPath: 'C:\\nipscern\\Aurora\\Temp\\tb.gtkw',
            scopes: sampleScopes,
            tbModule: 'tb_counter',
        });
        expect(content).toContain('[dumpfile] "C:/nipscern/Aurora/Temp/tb.vcd"');
        expect(content).not.toContain('\\');
    });

    it('returns content=null when nothing matches (avoids writing an empty .gtkw)', () => {
        // Empty scopes
        expect(buildGtkwContent({
            vcdPath: 'a', gtkwPath: 'b', scopes: [], tbModule: 'tb',
        })).toEqual({ content: null, dropped: [] });

        // Selection points at signals not in the VCD — content is null
        // but dropped is populated so the caller can warn the user.
        expect(buildGtkwContent({
            vcdPath: 'a', gtkwPath: 'b', scopes: sampleScopes, tbModule: 'tb_counter',
            selectedSignals: ['nope.zilch'],
        })).toEqual({ content: null, dropped: ['nope.zilch'] });

        // Default mode but no top-scope signals (testbench scope name doesn't match)
        const r = buildGtkwContent({
            vcdPath: 'a', gtkwPath: 'b', scopes: sampleScopes, tbModule: 'wrong_name',
        });
        expect(r.content).toBeNull();
        expect(r.dropped).toEqual([]);
    });

    it('reports dropped signals even when the .gtkw still has content', () => {
        const { content, dropped } = buildGtkwContent({
            vcdPath: 'a', gtkwPath: 'b',
            scopes: sampleScopes,
            tbModule: 'tb_counter',
            selectedSignals: ['tb_counter.clk', 'tb_counter.gone_after_rename'],
        });
        expect(content).toContain('tb_counter.clk');
        expect(dropped).toEqual(['tb_counter.gone_after_rename']);
    });
});
