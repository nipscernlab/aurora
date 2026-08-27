// Unit tests for the file-tree git status decoration logic
// (js/tree/git_decorations.js, added with the VS Code-style tree decorations).
//
// Runs in the default node environment: computeDecorations + letterOf are PURE
// (no DOM, no globals), so importing the module is side-effect-free, its
// renderer-only auto-start is guarded by `typeof window !== 'undefined'`, which
// is false here.
import { describe, it, expect } from 'vitest';
import { computeDecorations, letterOf } from '../../js/tree/git_decorations.js';

describe('letterOf — effective status flag (mirrors git_panel fileFlag)', () => {
  it('prefers the working-tree char over the index char', () => {
    expect(letterOf({ index: 'M', working: 'M' })).toBe('M');
    expect(letterOf({ index: ' ', working: 'M' })).toBe('M');
    expect(letterOf({ index: 'A', working: 'D' })).toBe('D');
  });
  it('falls back to the index char when the working tree is clean', () => {
    expect(letterOf({ index: 'A', working: ' ' })).toBe('A');
    expect(letterOf({ index: 'R', working: '' })).toBe('R');
  });
  it('reports untracked / empty as ?', () => {
    expect(letterOf({ index: '?', working: '?' })).toBe('?');
    expect(letterOf({ index: '', working: '' })).toBe('?');
  });
});

describe('computeDecorations — path map + folder rollup', () => {
  const root = 'C:/proj';

  it('maps a changed file to a normalised absolute path + its letter', () => {
    const { fileStatus } = computeDecorations([{ path: 'src/a.js', index: ' ', working: 'M' }], root);
    expect(fileStatus.get('c:/proj/src/a.js')).toBe('M');
  });

  it('rolls a change up to every ancestor folder, including the root, but never above it', () => {
    const { changedDirs } = computeDecorations([{ path: 'src/deep/x.v', index: '?', working: '?' }], root);
    expect(changedDirs.has('c:/proj/src/deep')).toBe(true);
    expect(changedDirs.has('c:/proj/src')).toBe(true);
    expect(changedDirs.has('c:/proj')).toBe(true);
    expect(changedDirs.has('c:/')).toBe(false);
  });

  it('a top-level file marks only the root folder', () => {
    const { fileStatus, changedDirs } = computeDecorations([{ path: 'README.md', index: 'M', working: ' ' }], root);
    expect(fileStatus.get('c:/proj/readme.md')).toBe('M');
    expect(changedDirs.has('c:/proj')).toBe(true);
    expect(changedDirs.size).toBe(1);
  });

  it('normalises backslash + trailing-slash roots and handles multiple files', () => {
    const { fileStatus, changedDirs } = computeDecorations(
      [{ path: 'a/b.txt', working: 'M', index: ' ' }, { path: 'a/c.txt', working: '?', index: '?' }],
      'C:\\proj\\',
    );
    expect(fileStatus.get('c:/proj/a/b.txt')).toBe('M');
    expect(fileStatus.get('c:/proj/a/c.txt')).toBe('?');
    expect(changedDirs.has('c:/proj/a')).toBe(true);
    expect(fileStatus.size).toBe(2);
  });

  it('returns empty maps with no root, no files, or null input', () => {
    expect(computeDecorations([{ path: 'a.js', working: 'M' }], '').fileStatus.size).toBe(0);
    expect(computeDecorations([], root).fileStatus.size).toBe(0);
    expect(computeDecorations(null, root).changedDirs.size).toBe(0);
  });
});
