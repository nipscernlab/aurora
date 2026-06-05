import { describe, it, expect } from 'vitest';
import {
    buildHarnessScaffold,
    buildHarnessPrompt,
    extractCppFromResponse,
    reinjectDump,
    HARNESS_SYSTEM_PROMPT,
} from '../../js/compilation/ai_harness_prompt.js';

const PORTS = [
    { name: 'clk', direction: 'input', width: 1, signed: false },
    { name: 'in', direction: 'input', width: 18, signed: true },
    { name: 'out', direction: 'output', width: 18, signed: true },
    { name: 'big', direction: 'output', width: 48, signed: true },
    { name: 'flags', direction: 'output', width: 3, signed: false },
];

describe('buildHarnessScaffold', () => {
    const scaffold = buildHarnessScaffold({ topModule: 'top_level', ports: PORTS });

    it('has the fixed boilerplate and DUT instantiation', () => {
        expect(scaffold).toContain('#include "Vtop_level.h"');
        expect(scaffold).toContain('Vtop_level* top = new Vtop_level;');
        expect(scaffold).toContain('double sc_time_stamp()');
    });

    it('toggles the detected clock in the loop (not left to the AI)', () => {
        expect(scaffold).toContain('top->clk = 1; top->eval();');
        expect(scaffold).toContain('top->clk = 0; top->eval();');
    });

    it('exposes the four @AURORA_FILL holes', () => {
        expect(scaffold).toContain('@AURORA_FILL setup');
        expect(scaffold).toContain('@AURORA_FILL total_cycles');
        expect(scaffold).toContain('@AURORA_FILL drive');
        expect(scaffold).toContain('@AURORA_FILL advance');
    });

    it('embeds the deterministic sign-aware dump between markers', () => {
        expect(scaffold).toContain('AURORA_DUMP_BEGIN');
        expect(scaffold).toContain('AURORA_DUMP_END');
        // signed 18-bit -> sign-extend (shift 64-18=46); unsigned -> plain
        expect(scaffold).toContain('(int64_t)((uint64_t)top->out << 46) >> 46');
        expect(scaffold).toContain('(int64_t)((uint64_t)top->big << 16) >> 16');
        expect(scaffold).toContain('(unsigned long long)top->flags');
    });
});

describe('buildHarnessPrompt', () => {
    const { system, user } = buildHarnessPrompt({
        topModule: 'top_level', ports: PORTS, testbenchSource: 'module tb; foo(); endmodule',
    });

    it('uses the harness system prompt', () => {
        expect(system).toBe(HARNESS_SYSTEM_PROMPT);
    });

    it('includes the scaffold, the testbench, the clock, and the worked example', () => {
        expect(user).toContain('Vtop_level* top = new Vtop_level;'); // scaffold embedded
        expect(user).toContain('module tb; foo(); endmodule');       // testbench
        expect(user).toContain('detected clock port: clk');
        expect(user).toContain('450000/4 = 112500');                 // numeric cycle example
    });

    it('appends compile feedback on a previous failure', () => {
        const { user: u2 } = buildHarnessPrompt({
            topModule: 'top_level', ports: PORTS, testbenchSource: 'x',
            feedback: { previousCpp: 'int main(){bad}', buildError: 'error: expected ;' },
        });
        expect(u2).toContain('PREVIOUS ATTEMPT FAILED TO COMPILE');
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
    it('returns empty string for empty/blank input', () => {
        expect(extractCppFromResponse('   ')).toBe('');
        expect(extractCppFromResponse(null)).toBe('');
    });
});

describe('reinjectDump', () => {
    it('overwrites a tampered dump block with the canonical one', () => {
        const scaffold = buildHarnessScaffold({ topModule: 'top_level', ports: PORTS });
        // simulate the model dropping the sign-extension on `out`
        const tampered = scaffold.replace(
            '(int64_t)((uint64_t)top->out << 46) >> 46', '(int32_t)top->out');
        expect(tampered).toContain('(int32_t)top->out');

        const fixed = reinjectDump({ cpp: tampered, ports: PORTS });
        expect(fixed).toContain('(int64_t)((uint64_t)top->out << 46) >> 46'); // restored
        expect(fixed).not.toContain('(int32_t)top->out');
    });

    it('keeps everything outside the dump intact', () => {
        const scaffold = buildHarnessScaffold({ topModule: 'top_level', ports: PORTS });
        const fixed = reinjectDump({ cpp: scaffold, ports: PORTS });
        expect(fixed).toContain('Vtop_level* top = new Vtop_level;');
        expect(fixed).toContain('@AURORA_FILL drive');
    });

    it('returns the cpp untouched when the markers are absent', () => {
        expect(reinjectDump({ cpp: 'int main(){}', ports: PORTS })).toBe('int main(){}');
    });
});
