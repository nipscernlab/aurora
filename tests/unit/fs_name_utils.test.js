import { describe, it, expect } from 'vitest';
import {
    validateEntryName, nextCopyName, normSlash, baseName, parentDir, isUnder,
} from '../../js/tree/fs_name_utils.js';

// Pure helpers behind the file-tree CRUD (standard_tree_crud.js). The rules
// mirror VS Code's Explorer — see the module doc for the full list.

describe('path helpers', () => {
    it('normSlash converts backslashes', () => {
        expect(normSlash('C:\\a\\b')).toBe('C:/a/b');
    });
    it('baseName / parentDir handle both separators', () => {
        expect(baseName('C:\\proj\\src\\main.v')).toBe('main.v');
        expect(parentDir('C:\\proj\\src\\main.v')).toBe('C:/proj/src');
        expect(baseName('C:/proj/dir/')).toBe('dir');
    });
    it('isUnder is strict and case-insensitive', () => {
        expect(isUnder('C:\\proj\\src\\a.v', 'c:/PROJ/src')).toBe(true);
        expect(isUnder('C:/proj/src', 'C:/proj/src')).toBe(false);       // itself
        expect(isUnder('C:/proj/src2/a.v', 'C:/proj/src')).toBe(false);  // sibling prefix
    });
});

describe('validateEntryName', () => {
    const v = (name, opts = {}) => validateEntryName(name, opts);

    it('rejects empty and whitespace-wrapped names', () => {
        expect(v('').error).toBe('empty');
        expect(v('   ').error).toBe('empty');
        expect(v(' name').error).toBe('whitespace');
        expect(v('name ').error).toBe('whitespace');
    });

    it('accepts ordinary names (spaces inside are fine)', () => {
        expect(v('my file.txt').ok).toBe(true);
        expect(v('módulo çedilha.v').ok).toBe(true);
    });

    it('rejects Windows-invalid characters', () => {
        for (const c of ['<', '>', ':', '"', '|', '?', '*']) {
            expect(v(`a${c}b`).error).toBe('invalidChars');
        }
    });

    it('rejects separators unless nested create is allowed', () => {
        expect(v('a/b.txt').error).toBe('separators');
        expect(v('a\\b.txt').error).toBe('separators');
        expect(v('a/b.txt', { allowSeparators: true }).ok).toBe(true);
        // empty segments still rejected in nested mode
        expect(v('a//b.txt', { allowSeparators: true }).error).toBe('separators');
        expect(v('/a.txt', { allowSeparators: true }).error).toBe('separators');
    });

    it('rejects reserved device names per segment (any extension)', () => {
        expect(v('CON').error).toBe('reserved');
        expect(v('con.txt').error).toBe('reserved');
        expect(v('LPT1.log').error).toBe('reserved');
        expect(v('a/NUL/b.txt', { allowSeparators: true }).error).toBe('reserved');
        expect(v('console.txt').ok).toBe(true); // NOT reserved — longer base
    });

    it('rejects dot navigation and trailing dot/space', () => {
        expect(v('.').error).toBe('dots');
        expect(v('..').error).toBe('dots');
        expect(v('name.').error).toBe('endsBad');
        expect(v('name.v ', {}).error).toBe('whitespace'); // trailing space trimmed check first
    });

    it('flags duplicates case-insensitively, allowing a case-only self-rename', () => {
        expect(v('Foo.TXT', { siblings: ['foo.txt'] }).error).toBe('exists');
        expect(v('README.md', { siblings: ['readme.md'], originalName: 'readme.md' }).ok).toBe(true);
        expect(v('other.md', { siblings: ['readme.md'], originalName: 'readme.md' }).ok).toBe(true);
    });
});

describe('nextCopyName', () => {
    it('suffixes before the extension and increments', () => {
        expect(nextCopyName('foo.txt', ['foo.txt'])).toBe('foo copy.txt');
        expect(nextCopyName('foo.txt', ['foo.txt', 'foo copy.txt'])).toBe('foo copy 2.txt');
        expect(nextCopyName('foo.txt', ['foo.txt', 'foo copy.txt', 'foo copy 2.txt']))
            .toBe('foo copy 3.txt');
    });
    it('treats dotfiles and extension-less names as whole bases', () => {
        expect(nextCopyName('.gitignore', ['.gitignore'])).toBe('.gitignore copy');
        expect(nextCopyName('Makefile', ['Makefile'])).toBe('Makefile copy');
    });
    it('is case-insensitive against siblings', () => {
        expect(nextCopyName('Foo.txt', ['foo.txt', 'FOO COPY.TXT'])).toBe('Foo copy 2.txt');
    });
});
