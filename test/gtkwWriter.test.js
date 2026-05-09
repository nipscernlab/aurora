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
        const out = pickSignalsToEmit(sampleScopes, 'tb_counter', []);
        const names = out.map((s) => s.fullName).sort();
        expect(names).toEqual(['tb_counter.clk', 'tb_counter.q', 'tb_counter.rst']);
    });

    it('selection match uses the explicit list, not the default', () => {
        const out = pickSignalsToEmit(
            sampleScopes,
            'tb_counter',
            ['tb_counter.dut.q_next', 'tb_counter.clk'],
        );
        const names = out.map((s) => s.fullName).sort();
        expect(names).toEqual(['tb_counter.clk', 'tb_counter.dut.q_next']);
    });

    it('selection picks unknown to the VCD are silently dropped', () => {
        const out = pickSignalsToEmit(
            sampleScopes,
            'tb_counter',
            ['tb_counter.does_not_exist', 'tb_counter.clk'],
        );
        const names = out.map((s) => s.fullName);
        expect(names).toEqual(['tb_counter.clk']);
    });

    it('range information is carried through for buses', () => {
        const out = pickSignalsToEmit(sampleScopes, 'tb_counter', ['tb_counter.dut.q_next']);
        expect(out[0].range).toBe('3:0');
    });
});

describe('buildGtkwContent', () => {
    it('emits the [dumpfile] header and one signal per line', () => {
        const text = buildGtkwContent({
            vcdPath: 'C:/tmp/tb_counter.vcd',
            gtkwPath: 'C:/tmp/tb_counter.gtkw',
            scopes: sampleScopes,
            tbModule: 'tb_counter',
        });
        expect(text).toContain('[dumpfile] "C:/tmp/tb_counter.vcd"');
        expect(text).toContain('[savefile] "C:/tmp/tb_counter.gtkw"');
        // top-scope signals only by default
        expect(text).toContain('tb_counter.clk');
        expect(text).toContain('tb_counter.rst');
        expect(text).toContain('tb_counter.q[3:0]');
        expect(text).not.toContain('tb_counter.dut');
    });

    it('honours user selection and emits range syntax for buses', () => {
        const text = buildGtkwContent({
            vcdPath: 'C:/tmp/x.vcd',
            gtkwPath: 'C:/tmp/x.gtkw',
            scopes: sampleScopes,
            tbModule: 'tb_counter',
            selectedSignals: ['tb_counter.dut.q_next', 'tb_counter.dut.clk'],
        });
        expect(text).toContain('tb_counter.dut.q_next[3:0]');
        expect(text).toContain('tb_counter.dut.clk');
        // default-scope signals are NOT emitted when a selection is in
        // play — that branch is one or the other, not both.
        expect(text).not.toMatch(/^tb_counter\.rst\b/m);
    });

    it('normalises Windows backslashes in paths to forward slashes', () => {
        const text = buildGtkwContent({
            vcdPath: 'C:\\nipscern\\Aurora\\Temp\\tb.vcd',
            gtkwPath: 'C:\\nipscern\\Aurora\\Temp\\tb.gtkw',
            scopes: sampleScopes,
            tbModule: 'tb_counter',
        });
        expect(text).toContain('[dumpfile] "C:/nipscern/Aurora/Temp/tb.vcd"');
        expect(text).not.toContain('\\');
    });

    it('returns null when nothing matches (avoids writing an empty .gtkw)', () => {
        // Empty scopes
        expect(buildGtkwContent({
            vcdPath: 'a', gtkwPath: 'b', scopes: [], tbModule: 'tb',
        })).toBeNull();

        // Selection points at signals not in the VCD
        expect(buildGtkwContent({
            vcdPath: 'a', gtkwPath: 'b', scopes: sampleScopes, tbModule: 'tb_counter',
            selectedSignals: ['nope.zilch'],
        })).toBeNull();

        // Default mode but no top-scope signals (testbench scope name doesn't match)
        expect(buildGtkwContent({
            vcdPath: 'a', gtkwPath: 'b', scopes: sampleScopes, tbModule: 'wrong_name',
        })).toBeNull();
    });
});
