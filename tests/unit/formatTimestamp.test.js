/**
 * Unit tests for the local-time timestamp formatter used in backup folder
 * names. Embeddable in a filesystem path; sortable lexicographically.
 */

import { describe, it, expect } from 'vitest';
import { formatTimestamp } from '../../main/utils.js';

describe('formatTimestamp', () => {
  it('formats a fixed Date as YYYY-MM-DD_HH-mm-ss', () => {
    // Use a Date that's identical in every timezone: noon on Jan 2, 2026
    // *constructed from local-time components* so the formatter (which uses
    // local-time getters) gives a deterministic answer regardless of the
    // host's timezone.
    const fixed = new Date(2026, 0, 2, 12, 30, 45); // local
    expect(formatTimestamp(fixed)).toBe('2026-01-02_12-30-45');
  });

  it('zero-pads single-digit month/day/hour/minute/second', () => {
    const fixed = new Date(2026, 0, 5, 7, 8, 9); // Jan 5
    expect(formatTimestamp(fixed)).toBe('2026-01-05_07-08-09');
  });

  it('handles December (month index 11) without off-by-one', () => {
    const fixed = new Date(2026, 11, 31, 23, 59, 59);
    expect(formatTimestamp(fixed)).toBe('2026-12-31_23-59-59');
  });

  it('handles midnight correctly', () => {
    const fixed = new Date(2026, 5, 1, 0, 0, 0);
    expect(formatTimestamp(fixed)).toBe('2026-06-01_00-00-00');
  });

  it('produces a string that sorts lexicographically with itself', () => {
    const earlier = formatTimestamp(new Date(2026, 5, 1, 12, 0, 0));
    const later = formatTimestamp(new Date(2026, 5, 1, 12, 0, 1));
    expect(earlier < later).toBe(true);
  });

  it('only contains characters legal in a Windows path', () => {
    const ts = formatTimestamp(new Date(2026, 5, 1, 12, 30, 45));
    expect(ts).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('uses now() by default — output looks well-formed', () => {
    const result = formatTimestamp();
    // YYYY-MM-DD_HH-mm-ss = 4+1+2+1+2 + 1 + 2+1+2+1+2 = 19 chars
    expect(result).toHaveLength(19);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  });
});
