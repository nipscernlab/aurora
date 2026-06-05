import { describe, it, expect } from 'vitest';
import {
    buildHarnessPrompt,
    extractCppFromResponse,
    HARNESS_SYSTEM_PROMPT,
} from '../../js/compilation/ai_harness_prompt.js';

const PORTS = [
    { name: 'clk', direction: 'input', width: 1 },
    { name: 'rst', direction: 'input', width: 1 },
    { name: 'in', direction: 'input', width: 18 },
    { name: 'out', direction: 'output', width: 18 },
    { name: 'big', direction: 'output', width: 48 },
];

describe('buildHarnessPrompt', () => {
    const { system, user } = buildHarnessPrompt({
        topModule: 'top_level', ports: PORTS, testbenchSource: 'module tb; ... endmodule',
    });

    it('uses the harness system prompt', () => {
        expect(system).toBe(HARNESS_SYSTEM_PROMPT);
    });

    it('names the Verilator class, the detected clock, and the testbench', () => {
        expect(user).toContain('Vtop_level');
        expect(user).toContain('Detected clock port: clk');
        expect(user).toContain('module tb; ... endmodule');
    });

    it('lists exactly the output port names for harness_final.txt', () => {
        expect(user).toContain('Use EXACTLY these output names: out, big');
        // 48-bit output -> int64 cast, 18-bit -> int32 cast
        expect(user).toContain('(int64_t)top->big');
        expect(user).toContain('(int32_t)top->out');
    });

    it('appends compile feedback when a previous attempt failed', () => {
        const { user: u2 } = buildHarnessPrompt({
            topModule: 'top_level', ports: PORTS, testbenchSource: 'x',
            feedback: { previousCpp: 'int main(){bad}', buildError: 'error: expected ;' },
        });
        expect(u2).toContain('PREVIOUS ATTEMPT FAILED TO COMPILE');
        expect(u2).toContain('int main(){bad}');
        expect(u2).toContain('error: expected ;');
    });
});

describe('extractCppFromResponse', () => {
    it('returns raw text when there is no fence', () => {
        expect(extractCppFromResponse('int main(){}')).toBe('int main(){}\n');
    });

    it('extracts the body of a ```cpp fence', () => {
        const r = extractCppFromResponse('Here:\n```cpp\nint main(){ return 0; }\n```\nDone.');
        expect(r).toBe('int main(){ return 0; }\n');
    });

    it('handles a bare ``` fence', () => {
        expect(extractCppFromResponse('```\n#include <x>\n```')).toBe('#include <x>\n');
    });

    it('returns empty string for empty/blank input', () => {
        expect(extractCppFromResponse('   ')).toBe('');
        expect(extractCppFromResponse(null)).toBe('');
    });
});
