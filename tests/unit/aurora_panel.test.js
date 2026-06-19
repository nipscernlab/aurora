import { describe, it, expect } from 'vitest';
import { nextCollapseState } from '../../js/components/aurora-panel.js';

describe('nextCollapseState (panel collapse threshold)', () => {
    it('is collapsed below the threshold', () => {
        expect(nextCollapseState(0, 24)).toBe(true);
        expect(nextCollapseState(23, 24)).toBe(true);
    });
    it('is NOT collapsed at or above the threshold', () => {
        expect(nextCollapseState(24, 24)).toBe(false);
        expect(nextCollapseState(260, 24)).toBe(false);
    });
    it('coerces string widths (style.width / offsetWidth reads)', () => {
        expect(nextCollapseState('0', 24)).toBe(true);
        expect(nextCollapseState('260', 24)).toBe(false);
    });
});
