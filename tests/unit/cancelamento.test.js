// O estado do cancelamento (js/compilation/cancelamento.ts).

import { describe, it, expect, beforeEach, vi } from 'vitest';

let c;

beforeEach(async () => {
  vi.resetModules();
  globalThis.window = {};
  c = await import('../../js/compilation/cancelamento.js');
});

describe('cancelamento', () => {
  it('comeca sem cancelamento e se expoe em window.isCompilationCanceled', () => {
    expect(c.foiCancelada()).toBe(false);
    expect(window.isCompilationCanceled()).toBe(false);
    expect(() => c.checkCancellation()).not.toThrow();
  });

  it('pedir cancela uma vez; o segundo pedido diz que ja estava', () => {
    expect(c.pedirCancelamento()).toBe(true);
    expect(c.pedirCancelamento()).toBe(false);
    expect(c.foiCancelada()).toBe(true);
    expect(window.isCompilationCanceled()).toBe(true);
  });

  it('com cancelamento, checkCancellation lanca o erro marcado', () => {
    window.t = (k) => (k === 'error.user.cancelled' ? 'Cancelado' : k);
    c.pedirCancelamento();
    let erro;
    try { c.checkCancellation(); } catch (e) { erro = e; }
    expect(erro.message).toBe('Cancelado');
    expect(c.eCancelamento(erro)).toBe(true);
    expect(c.eCancelamento(new Error('outro'))).toBe(false);
    expect(c.eCancelamento(null)).toBe(false);
  });

  it('sem traducao, a mensagem e a chave', () => {
    expect(c.erroDeCancelamento().message).toBe('error.user.cancelled');
  });

  it('o cartao sai uma vez por rodada', () => {
    expect(c.primeiroCartao()).toBe(true);
    expect(c.primeiroCartao()).toBe(false);
    c.iniciarRodada();
    expect(c.primeiroCartao()).toBe(true);
  });

  it('iniciar rodada e desfazer zeram as duas bandeiras', () => {
    c.pedirCancelamento();
    c.primeiroCartao();
    c.iniciarRodada();
    expect(c.foiCancelada()).toBe(false);
    expect(c.primeiroCartao()).toBe(true);
    c.pedirCancelamento();
    c.desfazerCancelamento();
    expect(c.foiCancelada()).toBe(false);
    expect(c.primeiroCartao()).toBe(true);
  });
});
