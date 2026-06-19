import { describe, it, expect } from 'vitest';
import { mayHaveToolArtifacts, stripToolCallArtifacts } from '../../js/ai/tool_call_text.js';

describe('mayHaveToolArtifacts', () => {
    it('is true when a tool-call marker may be present', () => {
        expect(mayHaveToolArtifacts('hi <tool_call>')).toBe(true);
        expect(mayHaveToolArtifacts('{"name": "x"}')).toBe(true);
    });
    it('is false for plain prose (so the strip scans are skipped)', () => {
        expect(mayHaveToolArtifacts('just a normal answer, nothing special')).toBe(false);
        expect(mayHaveToolArtifacts('')).toBe(false);
    });
});

describe('stripToolCallArtifacts', () => {
    it('removes XML tool-call blocks (tool_call / function_calls / invoke)', () => {
        expect(stripToolCallArtifacts('before<tool_call>{"x":1}</tool_call>after'))
            .toBe('beforeafter');
        expect(stripToolCallArtifacts('a<function_calls>zzz</function_calls>b')).toBe('ab');
        expect(stripToolCallArtifacts('a<invoke name="f">zzz</invoke>b')).toBe('ab');
    });
    it('removes Qwen-style {"name":...,"arguments":{...}} JSON', () => {
        expect(stripToolCallArtifacts('{"name":"read_file","arguments":{"path":"x"}}'))
            .toBe('');
        // The pattern's leading/trailing \s* eats the spaces around the JSON.
        expect(stripToolCallArtifacts('keep {"name":"f","arguments":{"a":1}} tail'))
            .toBe('keeptail');
    });
    it('removes orphan closing tags', () => {
        expect(stripToolCallArtifacts('answer</tool_call>')).toBe('answer');
    });
    it('leaves normal prose untouched', () => {
        expect(stripToolCallArtifacts('A normal answer with < and { but no tool calls.'))
            .toBe('A normal answer with < and { but no tool calls.');
    });
    it('leaves a half-streamed (incomplete) tag intact', () => {
        // No closing tag yet — must NOT be stripped, or partial tokens corrupt the buffer.
        expect(stripToolCallArtifacts('thinking <tool_call>partial'))
            .toBe('thinking <tool_call>partial');
    });
});
