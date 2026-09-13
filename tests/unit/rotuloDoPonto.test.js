// @vitest-environment happy-dom
/**
 * O nome de um ponto de restauracao: js/ai/rewind.js.
 *
 * O Chrysthofer viu na tela dele uma lista com "marked by hand" e "antes de
 * voltar" misturados, numa interface so. A causa era o rotulo ser gravado no
 * disco JA TRADUZIDO, no instante em que o ponto nascia: quem criasse um ponto
 * com a interface em ingles ficava com ele em ingles para sempre, e o "antes de
 * voltar" estava escrito em portugues dentro do processo principal, entao
 * aparecia assim ate para quem usa em ingles.
 *
 * Rotulo de tela nao pode ser gravado em disco. O disco guarda um MOTIVO (uma
 * chave: manual, compilar, voltar, pedido) e quem mostra traduz na hora. O
 * unico texto que fica gravado e o unico que nao se traduz: o comeco do que a
 * pessoa escreveu para a IA, que e dela.
 *
 * O ponto ANTIGO, gravado antes desta mudanca, so tem `rotulo`. Ele continua
 * sendo mostrado como esta: inventar um motivo para ele seria adivinhar, e uma
 * lista que mente e pior do que uma lista com uma linha em ingles.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { nomeDoPonto } from '../../js/ai/rewind.js';

const PT = {
  'rewind.manual': 'marcado à mão',
  'rewind.beforeBuild': 'antes de compilar',
  'rewind.beforeRewind': 'antes de voltar',
  'rewind.beforePrompt': 'antes de um pedido',
  'rewind.point': 'ponto de restauração',
};
const EN = {
  'rewind.manual': 'marked by hand',
  'rewind.beforeBuild': 'before compiling',
  'rewind.beforeRewind': 'before rewinding',
  'rewind.beforePrompt': 'before a request',
  'rewind.point': 'restore point',
};

const falar = (dic) => { window.t = (k) => dic[k] ?? k; };

beforeEach(() => { globalThis.window = globalThis.window || {}; });

describe('nome do ponto: a lingua e a de agora, nao a de quando ele nasceu', () => {
  it('o mesmo ponto sai em portugues ou em ingles, conforme a interface', () => {
    const ponto = { motivo: 'manual' };

    falar(PT);
    expect(nomeDoPonto(ponto)).toBe('marcado à mão');
    falar(EN);
    expect(nomeDoPonto(ponto)).toBe('marked by hand');
  });

  it('cobre os tres motivos automaticos', () => {
    falar(PT);
    expect(nomeDoPonto({ motivo: 'compilar' })).toBe('antes de compilar');
    expect(nomeDoPonto({ motivo: 'voltar' })).toBe('antes de voltar');
    expect(nomeDoPonto({ motivo: 'manual' })).toBe('marcado à mão');
  });
});

describe('nome do ponto: o que e do usuario fica como ele escreveu', () => {
  it('o ponto de uma mensagem mostra o comeco do pedido, sem traduzir', () => {
    falar(EN);
    // O texto e dele e nao se traduz, nem com a interface em ingles.
    expect(nomeDoPonto({ motivo: 'pedido', rotulo: 'refatore o contador' }))
      .toBe('refatore o contador');
  });

  it('pedido sem texto cai numa frase traduzida, e nao numa linha vazia', () => {
    falar(PT);
    expect(nomeDoPonto({ motivo: 'pedido' })).toBe('antes de um pedido');
  });
});

describe('nome do ponto: o que ja estava gravado', () => {
  it('ponto antigo, so com rotulo, e mostrado como esta', () => {
    falar(PT);
    // Gravado antes da mudanca, com o texto ja traduzido dentro.
    expect(nomeDoPonto({ rotulo: 'marked by hand' })).toBe('marked by hand');
  });

  it('ponto sem motivo e sem rotulo ainda tem nome', () => {
    falar(PT);
    expect(nomeDoPonto({})).toBe('ponto de restauração');
  });

  it('motivo desconhecido nao vira chave crua na tela', () => {
    falar(PT);
    expect(nomeDoPonto({ motivo: 'inventado' })).toBe('ponto de restauração');
  });
});
