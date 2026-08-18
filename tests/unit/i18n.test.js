/**
 * Unit tests for the pure helpers in js/i18n/i18n.js.
 *
 * The module also has side-effects (window.t, fetch, applyDOM), but those
 * are guarded by `typeof window !== 'undefined'` so importing it from
 * Node doesn't run them, leaves the helpers safe to exercise directly.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
    t,
    lookup,
    interpolate,
    _setTranslations,
    _setLocaleSync,
} from '../../js/i18n/i18n.js';

beforeEach(() => {
    _setTranslations('en', {
        toolbar: {
            newProject: { label: 'New Project' },
            cancel:     { tooltip: 'Cancel' },
        },
        errors: {
            compile: { failed: 'Compilation failed with code {{code}}' },
        },
    });
    _setTranslations('pt', {
        toolbar: {
            newProject: { label: 'Novo Projeto' },
            // 'cancel' missing on purpose, falls back to EN
        },
    });
});

describe('lookup', () => {
    it('navigates nested keys via dotted path', () => {
        const obj = { a: { b: { c: 'deep' } } };
        expect(lookup(obj, 'a.b.c')).toBe('deep');
    });
    it('returns undefined for missing paths', () => {
        expect(lookup({ a: 1 }, 'a.b.c')).toBeUndefined();
        expect(lookup(null, 'a')).toBeUndefined();
    });
});

describe('interpolate', () => {
    it('substitutes {{key}} with params', () => {
        expect(interpolate('hi {{name}}', { name: 'Lu' })).toBe('hi Lu');
    });
    it('leaves missing params as empty string', () => {
        expect(interpolate('hi {{name}}', {})).toBe('hi ');
    });
    it('returns template unchanged when params is falsy', () => {
        expect(interpolate('hi {{name}}')).toBe('hi {{name}}');
    });
});

describe('t', () => {
    it('resolves keys in the active locale', () => {
        _setLocaleSync('pt');
        expect(t('toolbar.newProject.label')).toBe('Novo Projeto');
    });

    it('falls back to EN when key is missing in active locale', () => {
        _setLocaleSync('pt');
        // 'cancel' only exists in EN
        expect(t('toolbar.cancel.tooltip')).toBe('Cancel');
    });

    it('returns the key path when missing in both locales', () => {
        _setLocaleSync('pt');
        expect(t('totally.unknown.key')).toBe('totally.unknown.key');
    });

    it('interpolates params', () => {
        _setLocaleSync('en');
        expect(t('errors.compile.failed', { code: 1 })).toBe('Compilation failed with code 1');
    });

    it('returns empty string for empty key', () => {
        expect(t('')).toBe('');
    });
});
