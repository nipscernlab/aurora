// @vitest-environment happy-dom
//
// As preferencias globais do botao Wave: qual simulador roda
// (js/wave/simulator_preference) e qual visualizador abre, e onde o Surfer
// abre (js/wave/viewer_preference). As tres moram no localStorage e nunca
// lancam, porque sao lidas a cada clique.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getSimulator, setSimulator } from '../../js/wave/simulator_preference.js';
import { getViewer, setViewer, getSurferMode, setSurferMode } from '../../js/wave/viewer_preference.js';
import { getSurferMultiWindow, setSurferMultiWindow } from '../../js/wave/surfer_window_preference.js';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const casos = [
  { nome: 'simulador', get: getSimulator, set: setSimulator, chave: 'aurora.waveSimulator', padrao: 'iverilog', outro: 'verilator' },
  { nome: 'visualizador', get: getViewer, set: setViewer, chave: 'aurora.waveViewer', padrao: 'gtkwave', outro: 'surfer' },
  { nome: 'modo do Surfer', get: getSurferMode, set: setSurferMode, chave: 'aurora.surferMode', padrao: 'tab', outro: 'window' },
];

describe.each(casos)('preferencia de $nome', ({ get, set, chave, padrao, outro }) => {
  it('sem nada salvo, o padrao', () => {
    expect(get()).toBe(padrao);
  });

  it('grava e le de volta', () => {
    expect(set(outro)).toBe(outro);
    expect(localStorage.getItem(chave)).toBe(outro);
    expect(get()).toBe(outro);
  });

  it('valor desconhecido vira o padrao, na gravacao e na leitura', () => {
    expect(set('lixo')).toBe(padrao);
    expect(localStorage.getItem(chave)).toBe(padrao);
    localStorage.setItem(chave, 'lixo');
    expect(get()).toBe(padrao);
  });

  it('storage que lanca nao derruba: le o padrao e a gravacao devolve o valor', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('cheio'); },
    });
    expect(get()).toBe(padrao);
    expect(set(outro)).toBe(outro);
    vi.unstubAllGlobals();
  });
});

describe('varias janelas do Surfer', () => {
  it('padrao uma janela so; so true liga', () => {
    expect(getSurferMultiWindow()).toBe(false);
    expect(setSurferMultiWindow(true)).toBe(true);
    expect(localStorage.getItem('aurora.surferMultiWindow')).toBe('true');
    expect(getSurferMultiWindow()).toBe(true);
    expect(setSurferMultiWindow('true')).toBe(false);
    expect(getSurferMultiWindow()).toBe(false);
  });

  it('storage que lanca nao derruba', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('cheio'); },
    });
    expect(getSurferMultiWindow()).toBe(false);
    expect(setSurferMultiWindow(true)).toBe(true);
    vi.unstubAllGlobals();
  });
});
