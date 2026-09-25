// @vitest-environment happy-dom
//
// Onde o PRISM abre (js/prism/prism_mode): janela ou aba, no localStorage,
// com aviso quando muda.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getPrismMode, setPrismMode } from '../../js/prism/prism_mode.js';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('modo do PRISM', () => {
  it('sem nada salvo, janela', () => {
    expect(getPrismMode()).toBe('window');
  });

  it('grava, avisa quem ouve e le de volta', () => {
    const ouvinte = vi.fn();
    window.addEventListener('aurora:prism-mode-changed', ouvinte);
    expect(setPrismMode('tab')).toBe('tab');
    window.removeEventListener('aurora:prism-mode-changed', ouvinte);
    expect(getPrismMode()).toBe('tab');
    expect(ouvinte.mock.calls[0][0].detail).toEqual({ mode: 'tab' });
  });

  it('valor desconhecido vira janela, na gravacao e na leitura', () => {
    expect(setPrismMode('lixo')).toBe('window');
    localStorage.setItem('aurora.prismMode', 'lixo');
    expect(getPrismMode()).toBe('window');
  });

  it('storage que lanca nao derruba', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('cheio'); },
    });
    expect(getPrismMode()).toBe('window');
    expect(setPrismMode('tab')).toBe('tab');
  });
});
