import { describe, it, expect } from 'vitest';
import { memorySlug } from '../../js/ai/memory.js';

// memorySlug is a security boundary, not cosmetics: `name` comes from the MODEL
// and becomes a filename under <root>/.aurora/memory/. It is an allowlist, so
// these cases assert that nothing dangerous can survive the output alphabet.
describe('memorySlug', () => {
    it('keeps a plain kebab-case name', () => {
        expect(memorySlug('porta-adc-q20')).toBe('porta-adc-q20');
    });
    it('slugifies spaces, case and punctuation', () => {
        expect(memorySlug('Porta ADC é Q20!')).toBe('porta-adc-e-q20');
    });
    it('strips accents down to ascii', () => {
        expect(memorySlug('referência analítica')).toBe('referencia-analitica');
    });

    it('defuses path traversal', () => {
        expect(memorySlug('../../evil')).toBe('evil');
        expect(memorySlug('..')).toBe('');
        expect(memorySlug('../../../')).toBe('');
        expect(memorySlug('a/../../b')).toBe('a-b');
    });
    it('defuses absolute paths and drive letters', () => {
        expect(memorySlug('C:\\Windows\\win.ini')).toBe('c-windows-win-ini');
        expect(memorySlug('/etc/passwd')).toBe('etc-passwd');
    });
    it('defuses NTFS streams, dotfiles and null bytes', () => {
        expect(memorySlug('x.md:evil')).toBe('x-md-evil');
        expect(memorySlug('.gitignore')).toBe('gitignore');
        expect(memorySlug('a\0b')).toBe('a-b');
    });
    it('never emits a leading or trailing dash', () => {
        expect(memorySlug('---a---')).toBe('a');
        expect(memorySlug('  spaced  ')).toBe('spaced');
    });

    it('rejects a name with nothing usable left', () => {
        expect(memorySlug('///')).toBe('');
        expect(memorySlug('...')).toBe('');
        expect(memorySlug('')).toBe('');
    });
    it('rejects non-strings', () => {
        expect(memorySlug(null)).toBe('');
        expect(memorySlug(42)).toBe('');
        expect(memorySlug({ name: 'x' })).toBe('');
    });
    it('caps length at 64 without leaving a trailing dash', () => {
        const out = memorySlug('x'.repeat(200));
        expect(out.length).toBe(64);
        const cut = memorySlug('a'.repeat(64) + ' tail');
        expect(cut.endsWith('-')).toBe(false);
    });
});
