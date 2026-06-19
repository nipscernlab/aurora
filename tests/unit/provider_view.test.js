import { describe, it, expect } from 'vitest';
import {
    providerOptionsHtml, modelPresetsHtml, faithfulModelName,
} from '../../js/ai/provider_view.js';

describe('providerOptionsHtml', () => {
    it('checks the current provider and shows the model hint (unknown provider falls back to its name)', () => {
        const html = providerOptionsHtml([{ name: 'acme', model: 'm1' }], 'acme');
        expect(html).toContain('value="acme" checked');
        expect(html).toContain('m1');        // hint = model for API providers
        expect(html).toContain('>acme<');    // fallback label = name
    });
    it('does not check a non-current provider', () => {
        const html = providerOptionsHtml([{ name: 'acme', model: 'm1' }], 'other');
        expect(html).toContain('value="acme"');
        expect(html).not.toContain('value="acme" checked');
    });
});

describe('modelPresetsHtml', () => {
    const models = [{ id: 'default', label: 'Default' }, { id: 'opus', label: 'Opus' }];
    it('marks the active preset and renders each label', () => {
        const html = modelPresetsHtml(models, 'opus');
        expect(html).toContain('data-model="opus"');
        expect(html).toContain('ai-seg-btn active">Opus');
        expect(html).toContain('data-model="default"');
        expect(html).not.toContain('ai-seg-btn active">Default');
    });
});

describe('faithfulModelName', () => {
    it('returns the subscription preset label (claude-code)', () => {
        expect(faithfulModelName({ model: 'opus' }, 'claude-code')).toBe('Opus');
        expect(faithfulModelName({ model: '' }, 'claude-code')).toBe('Default');     // '' -> default preset
        expect(faithfulModelName({ model: 'mystery' }, 'claude-code')).toBe('mystery'); // unknown id passes through
    });
    it('returns empty for an API provider with only the default model', () => {
        expect(faithfulModelName({ model: 'default' }, 'some-api')).toBe('');
        expect(faithfulModelName({}, 'some-api')).toBe('');
    });
    it('falls back to the provider default model when no model is set', () => {
        expect(faithfulModelName({ model: '', defaultModel: 'gpt-4o' }, 'some-api')).toBeTruthy();
    });
});
