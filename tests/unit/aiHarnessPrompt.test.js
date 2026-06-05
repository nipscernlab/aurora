import { describe, it, expect } from 'vitest';
import {
    buildHarnessPrompt,
    extractCppFromResponse,
    HARNESS_SYSTEM_PROMPT,
} from '../../js/compilation/ai_harness_prompt.js';

const PORTS = [
    { name: 'clk', direction: 'input', width: 1, signed: false },
    { name: 'in', direction: 'input', width: 18, signed: true },
    { name: 'out', direction: 'output', width: 18, signed: true },
    { name: 'big', direction: 'output', width: 48, signed: true },
    { name: 'flags', direction: 'output', width: 3, signed: false },
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

    it('dumps outputs with width/sign-aware extension', () => {
        expect(user).toContain('Use EXACTLY these output names: out, big, flags');
        // signed 18-bit -> sign-extend from 18 (shift 64-18 = 46)
        expect(user).toContain('(int64_t)((uint64_t)top->out << 46) >> 46');
        // signed 48-bit -> shift 64-48 = 16
        expect(user).toContain('(int64_t)((uint64_t)top->big << 16) >> 16');
        // unsigned -> plain, no sign-extension
        expect(user).toContain('(unsigned long long)top->flags');
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
