// @vitest-environment happy-dom
//
// As abas do terminal viram coluna quando ele fica estreito
// (js/terminal/tab_orientation.js): pelo limiar fixo, ou porque a faixa
// estourou, com folga para nao oscilar. O modulo se instala ao carregar, entao
// cada caso monta o DOM e importa de novo.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let largura;
let observadores;

function montar() {
  document.body.innerHTML = '<div class="terminal-container"><div class="terminal-tabs"></div></div>';
  const term = document.querySelector('.terminal-container');
  term.getBoundingClientRect = () => ({ width: largura });
  const barra = document.querySelector('.terminal-tabs');
  barra.cabe = true;
  Object.defineProperty(barra, 'scrollWidth', { get: () => (barra.cabe ? 100 : 200) });
  Object.defineProperty(barra, 'clientWidth', { get: () => 100 });
  return { term, barra };
}

async function carregar() {
  vi.resetModules();
  return import('../../js/terminal/tab_orientation.js');
}

const emColuna = () => document.querySelector('.terminal-container').classList.contains('tabs-vertical');

beforeEach(() => {
  largura = 1200;
  observadores = [];
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; observadores.push(this); }
    observe() {}
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('orientacao das abas', () => {
  it('largo, faixa; abaixo do limiar, coluna; o painel de IA avisa pelo evento', async () => {
    montar();
    const m = await carregar();
    expect(m.LARGURA_VIRA_COLUNA).toBe(780);
    expect(emColuna()).toBe(false);
    largura = 700;
    window.dispatchEvent(new Event('aurora:layout-changed'));
    expect(emColuna()).toBe(true);
    largura = 900;
    observadores[0].cb();
    expect(emColuna()).toBe(false);
  });

  it('a faixa que estoura acima do limiar vira coluna, e so volta com folga', async () => {
    const { barra } = montar();
    await carregar();
    largura = 880;
    barra.cabe = false;
    observadores[0].cb();
    expect(emColuna()).toBe(true);
    // Em coluna nao da para medir a faixa; ela so volta com 40 px a mais.
    barra.cabe = true;
    largura = 915;
    observadores[0].cb();
    expect(emColuna()).toBe(true);
    largura = 921;
    observadores[0].cb();
    expect(emColuna()).toBe(false);
  });

  it('sem ResizeObserver, escuta o redimensionar da janela', async () => {
    globalThis.ResizeObserver = class { constructor() { throw new Error('sem'); } };
    montar();
    await carregar();
    largura = 500;
    window.dispatchEvent(new Event('resize'));
    expect(emColuna()).toBe(true);
  });

  it('sem barra de abas, decide so pela largura; sem terminal, nao faz nada', async () => {
    montar();
    document.querySelector('.terminal-tabs').remove();
    largura = 700;
    await carregar();
    expect(emColuna()).toBe(true);
    document.body.innerHTML = '';
    expect(() => window.dispatchEvent(new Event('aurora:layout-changed'))).not.toThrow();
  });

  it('o terminal que aparece depois e achado pela sondagem', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    await carregar();
    vi.advanceTimersByTime(300);
    largura = 600;
    montar();
    vi.advanceTimersByTime(150);
    expect(emColuna()).toBe(true);
    const n = observadores.length;
    vi.advanceTimersByTime(3000);
    expect(observadores.length).toBe(n);
  });

  it('sem terminal em seis segundos, desiste e avisa uma vez', async () => {
    vi.useFakeTimers();
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '';
    await carregar();
    vi.advanceTimersByTime(150 * 45);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it('com o documento ainda carregando, espera o DOMContentLoaded', async () => {
    montar();
    largura = 600;
    const estado = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    await carregar();
    expect(emColuna()).toBe(false);
    estado.mockRestore();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(emColuna()).toBe(true);
  });
});
