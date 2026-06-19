import { describe, it, expect } from 'vitest';
import { nextRovingIndex } from '../../js/components/aurora-tabs.js';

describe('nextRovingIndex (tablist roving focus)', () => {
    it('moves right/down with wrap-around', () => {
        expect(nextRovingIndex(0, 3, 'ArrowRight')).toBe(1);
        expect(nextRovingIndex(2, 3, 'ArrowRight')).toBe(0); // wraps
        expect(nextRovingIndex(1, 3, 'ArrowDown')).toBe(2);
    });
    it('moves left/up with wrap-around', () => {
        expect(nextRovingIndex(1, 3, 'ArrowLeft')).toBe(0);
        expect(nextRovingIndex(0, 3, 'ArrowLeft')).toBe(2); // wraps
        expect(nextRovingIndex(2, 3, 'ArrowUp')).toBe(1);
    });
    it('jumps to the ends with Home/End', () => {
        expect(nextRovingIndex(2, 4, 'Home')).toBe(0);
        expect(nextRovingIndex(0, 4, 'End')).toBe(3);
    });
    it('returns -1 for keys it does not handle', () => {
        expect(nextRovingIndex(0, 3, 'Enter')).toBe(-1);
        expect(nextRovingIndex(0, 3, 'a')).toBe(-1);
        expect(nextRovingIndex(0, 3, 'Tab')).toBe(-1);
    });
    it('returns -1 for an empty strip or no focused tab', () => {
        expect(nextRovingIndex(0, 0, 'ArrowRight')).toBe(-1);
        expect(nextRovingIndex(-1, 3, 'ArrowRight')).toBe(-1);
    });
});
