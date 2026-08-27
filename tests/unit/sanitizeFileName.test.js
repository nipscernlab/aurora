/**
 * Unit tests for the filename sanitizer used wherever module names or
 * project names get spliced into filesystem paths. The control-byte clause
 * is the security-critical bit, bytes \\x00..\\x1f can sneak in via
 * copy-paste and cause inconsistent behaviour downstream.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeFileName } from '../../main/utils.js';

describe('sanitizeFileName', () => {
  describe('Windows-illegal characters', () => {
    it.each([
      ['<', 'angle-open'],
      ['>', 'angle-close'],
      [':', 'colon'],
      ['"', 'quote'],
      ['/', 'forward-slash'],
      ['\\', 'backslash'],
      ['|', 'pipe'],
      ['?', 'question-mark'],
      ['*', 'asterisk'],
    ])('replaces %s (%s) with underscore', (char) => {
      expect(sanitizeFileName(`mod${char}name`)).toBe('mod_name');
    });

    it('replaces a stretch of mixed illegal characters', () => {
      expect(sanitizeFileName('a<>:"/\\|?*b')).toBe('a_________b');
    });
  });

  describe('control-byte stripping (security)', () => {
    it('replaces a leading null byte', () => {
      expect(sanitizeFileName('\0safe')).toBe('_safe');
    });

    it('replaces an embedded null byte', () => {
      expect(sanitizeFileName('safe\0name')).toBe('safe_name');
    });

    it('replaces every byte in the \\x00..\\x1f range', () => {
      // \x07 (BEL), \x0c (FF), \x1b (ESC), \x1f (US), all should get replaced.
      const dirty = `a\x07b\x0cc\x1bd\x1fe`;
      expect(sanitizeFileName(dirty)).toBe('a_b_c_d_e');
    });

    it('does NOT touch bytes at or above 0x20', () => {
      expect(sanitizeFileName('a b')).toBe('a_b'); // space (0x20) hits the \\s+ rule, separately verified
      expect(sanitizeFileName('a\x21b')).toBe('a!b'); // 0x21 = '!' — preserved
    });
  });

  describe('whitespace collapsing', () => {
    it('replaces a single space with underscore', () => {
      expect(sanitizeFileName('foo bar')).toBe('foo_bar');
    });

    it('collapses multiple spaces into one underscore', () => {
      expect(sanitizeFileName('foo   bar')).toBe('foo_bar');
    });

    it('replaces tabs and newlines (each becomes one underscore)', () => {
      // \\t and \\n are *both* in the 0x00..0x1f control-byte range, so they
      // hit the first replace (per-character) before the \\s+ collapsing pass
      // ever sees them. Result: one underscore per control byte, not a
      // collapsed run. This is fine for filename safety, the goal is
      // strip-or-replace, not minify whitespace.
      expect(sanitizeFileName('foo\t\nbar')).toBe('foo__bar');
    });

    it('collapses literal space runs (which the first regex doesn\\u2019t touch)', () => {
      expect(sanitizeFileName('foo   bar')).toBe('foo_bar');
    });

    it('handles whitespace at the boundaries', () => {
      expect(sanitizeFileName(' leading')).toBe('_leading');
      expect(sanitizeFileName('trailing ')).toBe('trailing_');
    });
  });

  describe('happy path', () => {
    it('preserves a clean alphanumeric name unchanged', () => {
      expect(sanitizeFileName('processor_top_level_v2')).toBe('processor_top_level_v2');
    });

    it('preserves dashes, dots, parentheses', () => {
      expect(sanitizeFileName('cpu-v1.0(rev2)')).toBe('cpu-v1.0(rev2)');
    });

    it('preserves Unicode letters', () => {
      expect(sanitizeFileName('módulo_α')).toBe('módulo_α');
    });

    it('returns empty for empty input', () => {
      expect(sanitizeFileName('')).toBe('');
    });
  });
});
