/**
 * Unit tests pra processor_list.js, o owner unico de
 * `window.availableProcessors`. Cada teste reseta o global fake
 * (`globalThis.window`) pra que estado leak entre testes nao
 * mascare um bug de side-effect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setAvailableProcessors, addAvailableProcessor } from '../../js/project/processor_list.ts';

beforeEach(() => {
    globalThis.window = {};
});

afterEach(() => {
    delete globalThis.window;
});

describe('setAvailableProcessors', () => {
    it('aceita array de strings e preserva ordem', () => {
        setAvailableProcessors(['proc_a', 'proc_b', 'proc_c']);
        expect(window.availableProcessors).toEqual(['proc_a', 'proc_b', 'proc_c']);
    });

    it('aceita array de objetos {name} (formato .spf)', () => {
        setAvailableProcessors([{ name: 'proc_a' }, { name: 'proc_b' }]);
        expect(window.availableProcessors).toEqual(['proc_a', 'proc_b']);
    });

    it('aceita mistura de strings e objetos', () => {
        setAvailableProcessors(['proc_a', { name: 'proc_b' }, 'proc_c']);
        expect(window.availableProcessors).toEqual(['proc_a', 'proc_b', 'proc_c']);
    });

    it('dedup case-insensitive (Windows folders)', () => {
        setAvailableProcessors(['Foo', 'foo', 'FOO', 'bar']);
        expect(window.availableProcessors).toEqual(['Foo', 'bar']);
    });

    it('dedup preserva o PRIMEIRO casing visto', () => {
        setAvailableProcessors([{ name: 'procA' }, 'PROCA', { name: 'ProcA' }]);
        expect(window.availableProcessors).toEqual(['procA']);
    });

    it('filtra entries vazias/falsy', () => {
        setAvailableProcessors([null, undefined, '', { name: '' }, { name: null }, 'valid']);
        expect(window.availableProcessors).toEqual(['valid']);
    });

    it('null/undefined viram array vazio (nao crasham)', () => {
        setAvailableProcessors(null);
        expect(window.availableProcessors).toEqual([]);
        setAvailableProcessors(undefined);
        expect(window.availableProcessors).toEqual([]);
    });

    it('input nao-array vira array vazio', () => {
        setAvailableProcessors('not an array');
        expect(window.availableProcessors).toEqual([]);
        setAvailableProcessors(42);
        expect(window.availableProcessors).toEqual([]);
        setAvailableProcessors({ name: 'foo' });
        expect(window.availableProcessors).toEqual([]);
    });

    it('array vazio gera lista vazia', () => {
        setAvailableProcessors([]);
        expect(window.availableProcessors).toEqual([]);
    });

    it('chamadas sucessivas substituem (nao acumulam)', () => {
        setAvailableProcessors(['a', 'b']);
        setAvailableProcessors(['c']);
        expect(window.availableProcessors).toEqual(['c']);
    });
});

describe('addAvailableProcessor', () => {
    it('adiciona em lista vazia', () => {
        addAvailableProcessor('proc_a');
        expect(window.availableProcessors).toEqual(['proc_a']);
    });

    it('adiciona no fim quando a lista ja tem entries', () => {
        window.availableProcessors = ['proc_a'];
        addAvailableProcessor('proc_b');
        expect(window.availableProcessors).toEqual(['proc_a', 'proc_b']);
    });

    it('no-op se ja existe (match case-sensitive)', () => {
        window.availableProcessors = ['proc_a', 'proc_b'];
        addAvailableProcessor('proc_b');
        expect(window.availableProcessors).toEqual(['proc_a', 'proc_b']);
    });

    it('no-op se ja existe com case diferente', () => {
        window.availableProcessors = ['Foo'];
        addAvailableProcessor('foo');
        addAvailableProcessor('FOO');
        expect(window.availableProcessors).toEqual(['Foo']);
    });

    it('ignora name vazio/falsy', () => {
        window.availableProcessors = ['a'];
        addAvailableProcessor('');
        addAvailableProcessor(null);
        addAvailableProcessor(undefined);
        expect(window.availableProcessors).toEqual(['a']);
    });

    it('ignora name nao-string', () => {
        window.availableProcessors = ['a'];
        addAvailableProcessor(42);
        addAvailableProcessor({ name: 'b' });
        addAvailableProcessor(['b']);
        expect(window.availableProcessors).toEqual(['a']);
    });

    it('inicializa quando availableProcessors nao e array', () => {
        // Edge: legacy callers podem ter setado pra null/undefined
        window.availableProcessors = null;
        addAvailableProcessor('proc_a');
        expect(window.availableProcessors).toEqual(['proc_a']);

        window.availableProcessors = 'not an array';
        addAvailableProcessor('proc_b');
        expect(window.availableProcessors).toEqual(['proc_b']);
    });

    it('substitui o array (nao muta in-place)', () => {
        // Importante porque alguns consumidores capturam o array por
        // referencia em closures, se mutarmos in-place, eles veriam
        // updates "magicos". Substituir forca cada read fresco.
        const before = ['proc_a'];
        window.availableProcessors = before;
        addAvailableProcessor('proc_b');
        expect(window.availableProcessors).not.toBe(before);
        expect(before).toEqual(['proc_a']); // original intocado
    });
});
