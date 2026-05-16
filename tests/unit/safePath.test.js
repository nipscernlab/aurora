/**
 * Unit tests for the defensive path-normalization helper used by every FS
 * IPC handler. Catches the obvious shapes a compromised renderer would
 * try to smuggle through: non-strings, empties, null bytes.
 */

import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { safePath } from '../../main/utils.js';

describe('safePath', () => {
  describe('rejects non-strings', () => {
    it('throws TypeError for null', () => {
      expect(() => safePath(null)).toThrow(TypeError);
    });

    it('throws TypeError for undefined', () => {
      expect(() => safePath(undefined)).toThrow(TypeError);
    });

    it('throws TypeError for numbers', () => {
      expect(() => safePath(42)).toThrow(TypeError);
    });

    it('throws TypeError for objects', () => {
      expect(() => safePath({ path: '/etc/passwd' })).toThrow(TypeError);
    });

    it('throws TypeError for arrays', () => {
      expect(() => safePath(['/tmp/x'])).toThrow(TypeError);
    });

    it('throws TypeError for booleans', () => {
      expect(() => safePath(true)).toThrow(TypeError);
    });
  });

  describe('rejects empty strings', () => {
    it('throws on empty string', () => {
      expect(() => safePath('')).toThrow(/empty string/);
    });
  });

  describe('rejects null-byte injection', () => {
    it('throws on a string with a single null byte', () => {
      expect(() => safePath('safe.txt\0../../etc/passwd')).toThrow(/null byte/);
    });

    it('throws on a null byte at the start', () => {
      expect(() => safePath('\0evil')).toThrow(/null byte/);
    });

    it('throws on a null byte at the end', () => {
      expect(() => safePath('evil\0')).toThrow(/null byte/);
    });
  });

  describe('happy path', () => {
    it('returns an absolute path for a relative input', () => {
      const result = safePath('foo/bar.txt');
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('returns the input itself for an already-absolute path', () => {
      const abs = path.resolve('foo', 'bar.txt');
      expect(safePath(abs)).toBe(abs);
    });

    it('normalizes mixed separators on Windows-style input', () => {
      // path.resolve normalizes both / and \\ to the platform separator.
      const result = safePath('foo/bar\\baz.txt');
      expect(result).not.toContain('//');
    });

    it('collapses parent-directory traversal in the resolved form', () => {
      // safePath is *normalization*, not *confinement*. Traversal is
      // documented as a follow-up; here we just confirm resolve() removes
      // the literal `..` segments by collapsing them, so callers get a
      // canonical absolute path. This is not a security property — a
      // future "must be inside projectPath" wrapper handles that.
      const result = safePath('a/b/../c.txt');
      expect(result.endsWith(path.join('a', 'c.txt'))).toBe(true);
    });

    it('accepts the label argument and uses it in error messages', () => {
      expect(() => safePath('', 'projectPath')).toThrow(/projectPath/);
      expect(() => safePath(null, 'src')).toThrow(/src/);
    });
  });
});
