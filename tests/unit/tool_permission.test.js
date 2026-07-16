import { describe, it, expect } from 'vitest';
import {
    decideToolPermission, previewArgs, splitArgs, permissionOptionsHtml,
} from '../../js/ai/tool_permission.js';

describe('decideToolPermission', () => {
    it('always confirms set_command_override, even in allow mode', () => {
        expect(decideToolPermission({ name: 'set_command_override', access: 'write' }, 'allow'))
            .toBe('confirm');
    });
    it('pre-authorizes renames and rename-status polling in any mode', () => {
        expect(decideToolPermission({ name: 'rename_project', access: 'write' }, 'confirm')).toBe('allow');
        expect(decideToolPermission({ name: 'rename_processor', access: 'write' }, 'writes')).toBe('allow');
        expect(decideToolPermission({ name: 'get_rename_status', access: 'read' }, 'confirm')).toBe('allow');
    });
    it('allow mode auto-approves everything else', () => {
        expect(decideToolPermission({ name: 'write_file', access: 'write' }, 'allow')).toBe('allow');
    });
    it('writes mode auto-approves reads but confirms writes', () => {
        expect(decideToolPermission({ name: 'read_file', access: 'read' }, 'writes')).toBe('allow');
        expect(decideToolPermission({ name: 'write_file', access: 'write' }, 'writes')).toBe('confirm');
    });
    it('confirm mode confirms everything (default)', () => {
        expect(decideToolPermission({ name: 'read_file', access: 'read' }, 'confirm')).toBe('confirm');
        expect(decideToolPermission(null, 'confirm')).toBe('confirm');
    });
});

describe('previewArgs', () => {
    it('returns empty for no args', () => {
        expect(previewArgs(null)).toBe('');
        expect(previewArgs({})).toBe('');
    });
    it('pretty-prints JSON', () => {
        expect(previewArgs({ a: 1 })).toBe('{\n  "a": 1\n}');
    });
    it('caps long output at 500 chars with an ellipsis', () => {
        const out = previewArgs({ big: 'x'.repeat(2000) });
        expect(out.length).toBeLessThanOrEqual(502); // 500 + "\n…"
        expect(out.endsWith('\n…')).toBe(true);
    });
});

describe('splitArgs', () => {
    it('returns empty halves for no args', () => {
        expect(splitArgs(null)).toEqual({ prose: [], rest: {} });
        expect(splitArgs({})).toEqual({ prose: [], rest: {} });
    });
    it('pulls note out of the structural args', () => {
        const { prose, rest } = splitArgs({ step: 'verilator-build', note: 'resolve MODMISSING', persist: true });
        expect(prose).toEqual([{ key: 'note', text: 'resolve MODMISSING' }]);
        expect(rest).toEqual({ step: 'verilator-build', persist: true });
    });
    it('pulls question out too', () => {
        const { prose, rest } = splitArgs({ question: 'Qual top?', multiSelect: false });
        expect(prose).toEqual([{ key: 'question', text: 'Qual top?' }]);
        expect(rest).toEqual({ multiSelect: false });
    });
    it('leaves the JSON block empty when every arg is prose', () => {
        const { rest } = splitArgs({ question: 'Só isso?' });
        expect(previewArgs(rest)).toBe('');
    });
    it('treats a non-string or blank note as data, not prose', () => {
        expect(splitArgs({ note: 42 })).toEqual({ prose: [], rest: { note: 42 } });
        expect(splitArgs({ note: '   ' })).toEqual({ prose: [], rest: { note: '   ' } });
    });
    it('trims and caps long prose at 1000 chars with an ellipsis', () => {
        const { prose } = splitArgs({ note: '  ' + 'x'.repeat(2000) + '  ' });
        expect(prose[0].text.length).toBe(1001); // 1000 + "…"
        expect(prose[0].text.endsWith('…')).toBe(true);
    });
    it('keeps args untouched when there is no prose field', () => {
        const { prose, rest } = splitArgs({ step: 'cmm', appendArgs: ['-y'] });
        expect(prose).toEqual([]);
        expect(rest).toEqual({ step: 'cmm', appendArgs: ['-y'] });
    });
});

describe('permissionOptionsHtml', () => {
    const modes = [
        { id: 'allow', label: 'Allow all', hint: 'auto' },
        { id: 'confirm', label: 'Ask', hint: 'each time' },
    ];
    it('marks the current mode as checked and only that one', () => {
        const html = permissionOptionsHtml(modes, 'confirm');
        expect(html).toContain('value="confirm" checked');
        expect(html).toContain('value="allow"');
        expect(html).not.toContain('value="allow" checked');
    });
    it('renders each mode label + hint', () => {
        const html = permissionOptionsHtml(modes, 'allow');
        expect(html).toContain('Allow all');
        expect(html).toContain('each time');
    });
});
