
/**
 * Testes do nucleo da AuroraAPI: o envelope de resposta e o barramento de
 * eventos.
 *
 * Alavancagem: TODA resposta das 103 ferramentas chamaveis pela IA sai por
 * `ok` ou `err`, e o modelo decide o proximo passo lendo esse formato. Mudar o
 * formato sem perceber quebra as 103 de uma vez, e o arquivo (2957 linhas) nao
 * tinha nenhum teste ate 08/08/2026.
 *
 * O barramento e o que liga a IDE ao painel. A propriedade que mais importa
 * nele e resiliencia: um ouvinte que lanca nao pode derrubar os outros.
 */

import { describe, it, expect, vi } from 'vitest';

import * as core from '../../js/api/api_core.js';

const { ok, err, on, off, emit, WINDOW_EVENT_BRIDGE } = core;

describe('envelope de sucesso', () => {
  it('embrulha o dado', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
  });

  it('normaliza undefined para null, porque JSON.stringify descarta undefined', () => {
    // Sem isto a chave `data` sumiria da mensagem de IPC e o modelo receberia
    // um objeto sem o campo que ele espera.
    expect(ok(undefined)).toEqual({ ok: true, data: null });
    expect(ok()).toEqual({ ok: true, data: null });
  });

  it('PRESERVA valor falso que nao e undefined', () => {
    // O caso que uma normalizacao descuidada quebraria: `false`, `0` e `''` sao
    // respostas legitimas de ferramenta (existe? quantos? qual o texto?).
    expect(ok(false)).toEqual({ ok: true, data: false });
    expect(ok(0)).toEqual({ ok: true, data: 0 });
    expect(ok('')).toEqual({ ok: true, data: '' });
    expect(ok(null)).toEqual({ ok: true, data: null });
  });
});

describe('envelope de erro', () => {
  it('tem sempre a mesma forma', () => {
    expect(err('deu ruim', 'E_X')).toEqual({
      ok: false, error: { message: 'deu ruim', code: 'E_X' },
    });
  });

  it('codigo ausente vira null, e nao undefined', () => {
    expect(err('x').error.code).toBeNull();
  });

  it('mensagem vazia vira texto util em vez de string vazia', () => {
    expect(err().error.message).toBe('Unknown error');
    expect(err('').error.message).toBe('Unknown error');
    expect(err(null).error.message).toBe('Unknown error');
  });

  it('converte Error em texto, porque Error nao sobrevive ao JSON do IPC', () => {
    expect(err(new Error('falhou')).error.message).toBe('Error: falhou');
  });

  it('nunca devolve ok true', () => {
    expect(err('x').ok).toBe(false);
  });
});

describe('barramento de eventos', () => {
  it('entrega o payload a quem assinou', () => {
    const f = vi.fn();
    on('t:um', f);
    emit('t:um', { v: 1 });
    expect(f).toHaveBeenCalledWith({ v: 1 });
    off('t:um', f);
  });

  it('devolve uma funcao que cancela a assinatura', () => {
    const f = vi.fn();
    const cancelar = on('t:dois', f);
    cancelar();
    emit('t:dois', 1);
    expect(f).not.toHaveBeenCalled();
  });

  it('um ouvinte que lanca NAO derruba os outros', () => {
    // A propriedade mais importante do barramento: um painel com defeito nao
    // pode calar os eventos do resto da IDE.
    const antes = vi.fn();
    const depois = vi.fn();
    const bomba = () => { throw new Error('ops'); };
    on('t:tres', antes);
    on('t:tres', bomba);
    on('t:tres', depois);

    expect(() => emit('t:tres', 'x')).not.toThrow();
    expect(antes).toHaveBeenCalledWith('x');
    expect(depois).toHaveBeenCalledWith('x');

    off('t:tres', antes); off('t:tres', bomba); off('t:tres', depois);
  });

  it('emitir evento sem ninguem assinando e no-op', () => {
    expect(() => emit('t:ninguem', 1)).not.toThrow();
  });

  it('assinar com algo que nao e funcao devolve cancelamento inofensivo', () => {
    const cancelar = on('t:quatro', 'nao sou funcao');
    expect(typeof cancelar).toBe('function');
    expect(() => cancelar()).not.toThrow();
    expect(() => emit('t:quatro', 1)).not.toThrow();
  });

  it('cancelar duas vezes nao quebra', () => {
    const f = vi.fn();
    const cancelar = on('t:cinco', f);
    cancelar(); cancelar();
    expect(() => emit('t:cinco', 1)).not.toThrow();
  });

  it('o mesmo ouvinte assinado duas vezes e chamado uma vez so', () => {
    // O registro e um Set, entao assinatura repetida nao duplica entrega.
    const f = vi.fn();
    on('t:seis', f); on('t:seis', f);
    emit('t:seis', 1);
    expect(f).toHaveBeenCalledTimes(1);
    off('t:seis', f);
  });
});

describe('ponte dos eventos legados', () => {
  it('e imutavel, para ninguem reescrever o mapa em tempo de execucao', () => {
    expect(Object.isFrozen(WINDOW_EVENT_BRIDGE)).toBe(true);
  });

  it('traduz nome de janela para nome do barramento', () => {
    expect(WINDOW_EVENT_BRIDGE['aurora:locale-changed']).toBe('locale:changed');
    expect(WINDOW_EVENT_BRIDGE['aurora:spf-changed']).toBe('project:spf-changed');
  });

  it('todo destino usa dois-pontos, que e a convencao do barramento', () => {
    for (const destino of Object.values(WINDOW_EVENT_BRIDGE)) {
      expect(destino).toMatch(/^[a-z-]+:[a-z-]+$/);
    }
  });
});
