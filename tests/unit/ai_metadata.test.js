import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    isSubProvider, formatTokens, shortModelName,
    readPermissionMode, PERMISSION_MODES,
} from '../../js/ai/ai_metadata.js';

describe('isSubProvider', () => {
    it('flags the subscription CLIs, not API providers', () => {
        expect(isSubProvider('claude-code')).toBe(true);
        expect(isSubProvider('chatgpt')).toBe(true);
        expect(isSubProvider('openai')).toBe(false);
        expect(isSubProvider('')).toBe(false);
    });
});

describe('formatTokens', () => {
    it('compacts with k/M and trims trailing .0', () => {
        expect(formatTokens(500)).toBe('500');
        expect(formatTokens(1500)).toBe('1.5k');
        expect(formatTokens(2000)).toBe('2k');
        expect(formatTokens(2_000_000)).toBe('2M');
    });
});

describe('shortModelName', () => {
    it('strips the provider prefix, tolerates empty', () => {
        expect(shortModelName('claude-opus-4-8')).toBe('opus-4-8');
        expect(shortModelName('')).toBe('');
    });
});

describe('permission modes', () => {
    beforeEach(() => {
        const store = {};
        globalThis.localStorage = {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
        };
    });
    afterEach(() => { delete globalThis.localStorage; });

    it('exposes ask / writes / allow', () => {
        expect(PERMISSION_MODES.map((m) => m.id)).toEqual(['ask', 'writes', 'allow']);
    });
    it('defaults to writes when unset', () => {
        expect(readPermissionMode()).toBe('writes');
    });
    it('returns a stored valid mode, ignores an invalid one', () => {
        localStorage.setItem('aurora-ai-permission', 'allow');
        expect(readPermissionMode()).toBe('allow');
        localStorage.setItem('aurora-ai-permission', 'bogus');
        expect(readPermissionMode()).toBe('writes');
    });
});
