/**
 * O disjuntor dos servidores de linguagem (main/lsp/disjuntor.js).
 *
 * Ele existe porque o slang responde `bad allocation` ao completar codigo com o
 * buffer no meio de uma edicao, e o editor pergunta a cada tecla: uma digitacao
 * normal virava dez pedidos identicos, todos falhando, cada um refazendo a
 * elaboracao do projeto inteiro.
 *
 * O que precisa de prova sao as duas bordas. Abrir cedo demais cala sugestoes
 * que iam funcionar, por causa de um tropeco passageiro; abrir tarde demais, ou
 * nunca fechar, e nao ter resolvido nada. O relogio e injetado, entao os testes
 * nao esperam de verdade.
 */

import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { criarDisjuntor, LIMITE_PADRAO, PAUSA_PADRAO_MS } = require('../../main/lsp/disjuntor.js');

/** Um relogio que so anda quando o teste manda. */
function relogio(inicio = 1_000) {
  let t = inicio;
  return { agora: () => t, avancar: (ms) => { t += ms; } };
}

describe('enquanto o servidor responde', () => {
  it('deixa passar sempre', () => {
    const d = criarDisjuntor();
    for (let i = 0; i < 50; i++) {
      expect(d.podeTentar()).toBe(true);
      d.registrarSucesso();
    }
    expect(d.aberto).toBe(false);
  });

  it('falha isolada nao cala nada', () => {
    // O caso comum: o arquivo fecha de novo assim que a pessoa termina a linha.
    const d = criarDisjuntor({ limite: 3 });
    d.registrarFalha(new Error('bad allocation'));
    expect(d.podeTentar()).toBe(true);
    d.registrarSucesso();
    d.registrarFalha(new Error('bad allocation'));
    d.registrarFalha(new Error('bad allocation'));
    expect(d.podeTentar()).toBe(true);
    expect(d.aberto).toBe(false);
  });

  it('sucesso zera a contagem, entao as falhas precisam ser SEGUIDAS', () => {
    const d = criarDisjuntor({ limite: 3 });
    d.registrarFalha('x');
    d.registrarFalha('x');
    d.registrarSucesso();
    d.registrarFalha('x');
    d.registrarFalha('x');
    expect(d.aberto).toBe(false);
  });
});

describe('quando ele para de responder', () => {
  it('abre na enesima falha seguida, e avisa uma vez so', () => {
    const aoAbrir = vi.fn();
    const d = criarDisjuntor({ limite: 3, aoAbrir, agora: relogio().agora });

    expect(d.registrarFalha(new Error('bad allocation'))).toBe(false);
    expect(d.registrarFalha(new Error('bad allocation'))).toBe(false);
    expect(d.registrarFalha(new Error('bad allocation'))).toBe(true);

    expect(aoAbrir).toHaveBeenCalledTimes(1);
    expect(aoAbrir.mock.calls[0][0]).toMatchObject({ falhas: 3, motivo: 'bad allocation' });
    expect(d.aberto).toBe(true);
    expect(d.podeTentar()).toBe(false);
  });

  it('nao repete o aviso a cada tecla depois de aberto', () => {
    const aoAbrir = vi.fn();
    const d = criarDisjuntor({ limite: 2, aoAbrir, agora: relogio().agora });
    d.registrarFalha('x');
    d.registrarFalha('x');
    for (let i = 0; i < 20; i++) d.registrarFalha('x');
    expect(aoAbrir).toHaveBeenCalledTimes(1);
  });

  it('guarda o motivo, para quem for relatar', () => {
    const d = criarDisjuntor({ limite: 1 });
    d.registrarFalha(new Error('bad allocation'));
    expect(d.motivo).toBe('bad allocation');
  });

  it('motivo que nao e Error tambem vira texto', () => {
    const d = criarDisjuntor({ limite: 1 });
    d.registrarFalha('erro cru');
    expect(d.motivo).toBe('erro cru');
    d.zerar();
    d.registrarFalha(null);
    expect(d.motivo).toBe('desconhecido');
  });
});

describe('a volta', () => {
  it('passada a pausa, deixa tentar de novo', () => {
    const r = relogio();
    const d = criarDisjuntor({ limite: 2, pausaMs: 60_000, agora: r.agora });
    d.registrarFalha('x');
    d.registrarFalha('x');
    expect(d.podeTentar()).toBe(false);

    r.avancar(59_000);
    expect(d.podeTentar()).toBe(false);
    expect(d.restanteMs()).toBe(1_000);

    r.avancar(1_000);
    expect(d.podeTentar()).toBe(true);
    expect(d.restanteMs()).toBe(0);
  });

  it('a tentativa de volta que falha reabre na hora, sem gastar o limite de novo', () => {
    // Sem isto, cada volta custaria mais duas tentativas para redescobrir o que
    // ja se sabia, e o log voltaria a encher.
    const r = relogio();
    const aoAbrir = vi.fn();
    const d = criarDisjuntor({ limite: 2, pausaMs: 1_000, aoAbrir, agora: r.agora });
    d.registrarFalha('x');
    d.registrarFalha('x');

    r.avancar(1_000);
    expect(d.podeTentar()).toBe(true);
    d.registrarFalha('x');
    expect(d.aberto).toBe(true);
    expect(d.podeTentar()).toBe(false);
    expect(aoAbrir).toHaveBeenCalledTimes(1);   // continua sendo um aviso so
  });

  it('a tentativa de volta que da certo fecha o disjuntor e avisa', () => {
    const r = relogio();
    const aoFechar = vi.fn();
    const d = criarDisjuntor({ limite: 2, pausaMs: 1_000, aoFechar, agora: r.agora });
    d.registrarFalha('x');
    d.registrarFalha('x');
    r.avancar(1_000);
    expect(d.podeTentar()).toBe(true);
    expect(d.registrarSucesso()).toBe(true);
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(d.aberto).toBe(false);
    expect(d.motivo).toBeNull();
  });

  it('sucesso quando nada estava errado nao avisa nada', () => {
    const aoFechar = vi.fn();
    const d = criarDisjuntor({ aoFechar });
    expect(d.registrarSucesso()).toBe(false);
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it('zerar devolve ao estado inicial, para um servidor novo comecar limpo', () => {
    const d = criarDisjuntor({ limite: 1 });
    d.registrarFalha('x');
    expect(d.aberto).toBe(true);
    d.zerar();
    expect(d.aberto).toBe(false);
    expect(d.podeTentar()).toBe(true);
    expect(d.motivo).toBeNull();
  });
});

describe('os padroes', () => {
  it('sao os que o slang usa, e estao declarados', () => {
    expect(LIMITE_PADRAO).toBe(3);
    expect(PAUSA_PADRAO_MS).toBe(60000);
  });

  it('opcao invalida cai no padrao em vez de virar NaN', () => {
    // Um limite NaN faria a comparacao ser sempre falsa e o disjuntor nunca
    // abriria, que e o defeito silencioso que este teste impede.
    const d = criarDisjuntor({ limite: undefined, pausaMs: 'muito' });
    for (let i = 0; i < LIMITE_PADRAO; i++) d.registrarFalha('x');
    expect(d.aberto).toBe(true);
    expect(d.restanteMs()).toBeGreaterThan(0);
  });
});
