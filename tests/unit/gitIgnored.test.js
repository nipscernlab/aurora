// Unit tests for the gitignored+untracked matcher used to MUTE Folders-view
// rows. computeIgnored + isIgnoredPath are PURE (no DOM/globals).
import { describe, it, expect } from 'vitest';
import { computeIgnored, isIgnoredPath } from '../../js/tree/git_decorations.js';

describe('computeIgnored — files vs directory prefixes', () => {
  const ig = computeIgnored(['node_modules/', 'dist/', 'foo.log', 'src/cache/'], 'C:/proj');

  it('records ignored files as normalised absolute paths', () => {
    expect(ig.files.has('c:/proj/foo.log')).toBe(true);
  });
  it('records ignored directories (trailing slash) as prefixes', () => {
    expect(ig.dirs).toContain('c:/proj/node_modules');
    expect(ig.dirs).toContain('c:/proj/dist');
    expect(ig.dirs).toContain('c:/proj/src/cache');
  });
  it('normalises backslash + trailing-slash roots', () => {
    const ig2 = computeIgnored(['x/'], 'C:\\proj\\');
    expect(ig2.dirs).toContain('c:/proj/x');
  });
  it('empty root → empty matcher', () => {
    const e = computeIgnored(['a/'], '');
    expect(e.files.size).toBe(0);
    expect(e.dirs).toHaveLength(0);
  });
});

describe('isIgnoredPath', () => {
  const ig = computeIgnored(['node_modules/', 'foo.log'], 'C:/proj');

  it('matches an exact ignored file', () => {
    expect(isIgnoredPath('c:/proj/foo.log', ig)).toBe(true);
  });
  it('matches the ignored directory itself and everything under it', () => {
    expect(isIgnoredPath('c:/proj/node_modules', ig)).toBe(true);
    expect(isIgnoredPath('c:/proj/node_modules/pkg/index.js', ig)).toBe(true);
  });
  it('does not match tracked paths', () => {
    expect(isIgnoredPath('c:/proj/src/app.js', ig)).toBe(false);
    expect(isIgnoredPath('c:/proj/node_modules_notreally', ig)).toBe(false);
  });
  it('null matcher / empty path → false', () => {
    expect(isIgnoredPath('c:/proj/foo.log', null)).toBe(false);
    expect(isIgnoredPath('', ig)).toBe(false);
  });
});
