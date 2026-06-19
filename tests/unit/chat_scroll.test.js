import { describe, it, expect } from 'vitest';
import { isAtBottom, easeInOutCubic, smoothScrollDuration } from '../../js/ai/chat_scroll.js';

describe('isAtBottom', () => {
    it('treats a missing element as at the bottom', () => {
        expect(isAtBottom(null, 32)).toBe(true);
        expect(isAtBottom(undefined, 32)).toBe(true);
    });
    it('is true within the threshold of the bottom', () => {
        // gap = 1000 - 200 - 790 = 10 <= 32
        expect(isAtBottom({ scrollHeight: 1000, clientHeight: 200, scrollTop: 790 }, 32)).toBe(true);
        // gap exactly at the threshold counts as bottom
        expect(isAtBottom({ scrollHeight: 1000, clientHeight: 200, scrollTop: 768 }, 32)).toBe(true);
    });
    it('is false once scrolled up beyond the threshold', () => {
        // gap = 300 > 32
        expect(isAtBottom({ scrollHeight: 1000, clientHeight: 200, scrollTop: 500 }, 32)).toBe(false);
    });
});

describe('easeInOutCubic', () => {
    it('pins the endpoints and midpoint', () => {
        expect(easeInOutCubic(0)).toBe(0);
        expect(easeInOutCubic(1)).toBe(1);
        expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    });
    it('accelerates in the first half (output below linear)', () => {
        expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
        expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
    });
});

describe('smoothScrollDuration', () => {
    it('clamps to the [240, 560] ms window', () => {
        expect(smoothScrollDuration(0)).toBe(240);     // tiny -> min
        expect(smoothScrollDuration(100)).toBe(240);   // 50 -> min
        expect(smoothScrollDuration(5000)).toBe(560);  // 2500 -> max
    });
    it('is half the distance inside the window', () => {
        expect(smoothScrollDuration(800)).toBe(400);
        expect(smoothScrollDuration(1000)).toBe(500);
    });
});
