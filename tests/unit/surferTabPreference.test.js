/**
 * Testes da preferência "Surfer em aba".
 *
 * O que importa proteger é o PADRÃO e a sua assimetria: a aba é o comportamento
 * de fábrica, e só um 'false' gravado desliga. O módulo roda no hot path do
 * botão Wave, então também importa que ele nunca lance — nem sem localStorage
 * (os testes unitários rodam em node puro, sem DOM, o que por si só exercita
 * esse caminho), nem com um localStorage que lança.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import { getSurferInTab, setSurferInTab } from '../../js/wave/surfer_tab_preference.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getSurferInTab', () => {
  it('vem LIGADO sem localStorage (ambiente sem DOM nao derruba o hot path)', () => {
    expect(typeof localStorage).toBe('undefined');
    expect(getSurferInTab()).toBe(true);
  });

  it('vem LIGADO quando nada foi gravado', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    });
    expect(getSurferInTab()).toBe(true);
  });

  it('so um false gravado desliga; qualquer outro valor mantem a aba', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    });

    setSurferInTab(false);
    expect(getSurferInTab()).toBe(false);

    setSurferInTab(true);
    expect(getSurferInTab()).toBe(true);

    // Lixo gravado por fora nao pode desligar a aba por acidente.
    store.set('aurora.surferInTab', 'talvez');
    expect(getSurferInTab()).toBe(true);
  });

  it('setSurferInTab coage nao-boolean para false gravado como texto', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    });
    setSurferInTab(/** @type {any} */ ('yes'));
    expect(store.get('aurora.surferInTab')).toBe('false');
  });

  it('nunca lanca com localStorage hostil', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('quota'); },
      setItem: () => { throw new Error('quota'); },
    });
    expect(() => getSurferInTab()).not.toThrow();
    expect(getSurferInTab()).toBe(true);
    expect(() => setSurferInTab(false)).not.toThrow();
  });
});
