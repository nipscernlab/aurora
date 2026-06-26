// Unit tests for the `.inv` (Folders-view hide list) matcher.
// parseInv + isInvHidden are PURE (no DOM/IO), so they import cleanly in node.
import { describe, it, expect } from 'vitest';
import { parseInv, isInvHidden } from '../../js/tree/inv_filter.js';

const hidden = (text, rel, isDir = false) => isInvHidden(rel, isDir, parseInv(text));

describe('parseInv — line handling', () => {
  it('skips blanks and # comments', () => {
    expect(parseInv('\n\n# a comment\n   \n')).toHaveLength(0);
  });
  it('counts real rules', () => {
    expect(parseInv('tests/\n*.log\n!keep.log')).toHaveLength(3);
  });
});

describe('isInvHidden — unanchored (basename, any depth)', () => {
  it('a bare name hides matching dirs/files at any depth', () => {
    expect(hidden('node_modules', 'node_modules', true)).toBe(true);
    expect(hidden('node_modules', 'a/b/node_modules', true)).toBe(true);
    expect(hidden('node_modules', 'src/app.js')).toBe(false);
  });
  it('globs match the basename', () => {
    expect(hidden('*.log', 'logs/run.log')).toBe(true);
    expect(hidden('*.log', 'run.txt')).toBe(false);
    expect(hidden('build?', 'src/build1', true)).toBe(true);
  });
});

describe('isInvHidden — directory-only (trailing /)', () => {
  it('matches directories but not same-named files', () => {
    expect(hidden('dist/', 'dist', true)).toBe(true);
    expect(hidden('dist/', 'pkg/dist', true)).toBe(true);
    expect(hidden('dist/', 'dist')).toBe(false); // a FILE named dist
  });
});

describe('isInvHidden — anchored (slash in pattern)', () => {
  it('a leading slash anchors to the project root', () => {
    expect(hidden('/build', 'build', true)).toBe(true);
    expect(hidden('/build', 'src/build', true)).toBe(false);
  });
  it('a mid-path slash anchors too', () => {
    expect(hidden('src/generated', 'src/generated', true)).toBe(true);
    expect(hidden('src/generated', 'lib/src/generated', true)).toBe(false);
  });
  it('** spans directories', () => {
    expect(hidden('src/**/*.spec.js', 'src/a/b.spec.js')).toBe(true);
    expect(hidden('src/**/*.spec.js', 'src/x.spec.js')).toBe(true);
    expect(hidden('src/**/*.spec.js', 'lib/x.spec.js')).toBe(false);
  });
});

describe('isInvHidden — negation (last match wins)', () => {
  it('re-includes a same-level exception', () => {
    const txt = '*.tmp\n!keep.tmp';
    expect(hidden(txt, 'keep.tmp')).toBe(false);
    expect(hidden(txt, 'other.tmp')).toBe(true);
  });
});

describe('isInvHidden — misc', () => {
  it('is case-insensitive (Windows-friendly)', () => {
    expect(hidden('Tests/', 'tests', true)).toBe(true);
  });
  it('no rules → nothing hidden', () => {
    expect(isInvHidden('anything', true, [])).toBe(false);
    expect(isInvHidden('', true, parseInv('*'))).toBe(false);
  });
  it('normalises backslashes + leading slash in the path', () => {
    expect(hidden('node_modules', '\\a\\node_modules', true)).toBe(true);
  });
});
