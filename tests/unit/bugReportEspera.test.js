/**
 * O prazo que o usuario le quando bate no limite de frequencia.
 *
 * Arredondar para baixo aqui tem uma consequencia concreta: a pessoa espera
 * o tempo que a tela pediu, clica, e e barrada de novo. O aviso perde a
 * credibilidade na primeira vez que isso acontece, entao o arredondamento
 * para cima e a regra, e e o que este teste protege.
 *
 * `window.t` nao existe fora do app, entao o modulo cai nas reservas em
 * portugues, que e exatamente o caminho exercitado aqui.
 */

import { describe, it, expect, beforeAll } from 'vitest';

let emMinutos;

beforeAll(async () => {
  // O modulo toca `window` no topo (reservas + tr), entao o dublê minimo
  // precisa existir antes do import.
  globalThis.window = { t: null };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  ({ emMinutos } = await import('../../js/ui/bug_report_form.js'));
});

describe('emMinutos', () => {
  it('conta em segundos abaixo de um minuto', () => {
    expect(emMinutos(30)).toBe('30 segundos');
  });

  it('usa o singular quando e um minuto', () => {
    expect(emMinutos(60)).toBe('1 minuto');
  });

  it('arredonda PARA CIMA, para a pessoa nao voltar cedo demais', () => {
    // 61 s arredondado para baixo viraria "1 minuto", e quem esperasse 60 s
    // levaria outro 429 na cara.
    expect(emMinutos(61)).toBe('2 minutos');
    expect(emMinutos(299)).toBe('5 minutos');
  });

  it('nunca promete zero', () => {
    // Zero leria como "pode agora", que e o contrario do que aconteceu.
    for (const v of [0, -5, null, undefined, NaN]) {
      expect(emMinutos(v), String(v)).toBe('1 segundo');
    }
  });
});
