import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from '../../js/ai/system_prompt.js';

// Smoke guards for the extracted Aurora Intelligence system prompt: it must
// stay a single non-empty string and keep the project's load-bearing invariants
// (AURORA is feminine; the group works on ATLAS, NEVER LHCb) so an accidental
// edit/corruption fails loudly here instead of silently in a live chat turn.
describe('SYSTEM_PROMPT', () => {
    it('is one non-empty joined string (not an array)', () => {
        expect(typeof SYSTEM_PROMPT).toBe('string');
        expect(SYSTEM_PROMPT.length).toBeGreaterThan(1000);
    });

    it('preserves the core identity invariants', () => {
        expect(SYSTEM_PROMPT).toContain('AURORA INTELLIGENCE');
        expect(SYSTEM_PROMPT).toContain('NIPSCERN');
        expect(SYSTEM_PROMPT).toContain('ATLAS');
        expect(SYSTEM_PROMPT).toContain('NEVER LHCb');
    });
});
