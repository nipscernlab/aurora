/**
 * Testes da montagem da busca a partir do que o usuario digita.
 *
 * A caixa de busca aceita texto literal ou expressao regular, e tem alternancia
 * de caixa e de palavra inteira. O `buildRegex` e o ponto onde um caractere
 * especial vira comportamento inesperado: sem escape, procurar por `ula(` viraria
 * um grupo aberto e lancaria; procurar por `.` casaria qualquer caractere.
 *
 * Isso importa aqui mais do que numa busca comum porque o que se procura e
 * Verilog e C±, cheios de parentese, colchete, cifrao e ponto.
 */

import { describe, it, expect } from 'vitest';

import { buildRegex, escapeRegExp } from '../../main/ipc/search.js';

const opts = (o = {}) => ({ caseSensitive: false, wholeWord: false, regex: false, ...o });

describe('escapeRegExp', () => {
  it('neutraliza os metacaracteres que aparecem em HDL', () => {
    expect(escapeRegExp('ula(')).toBe('ula\\(');
    expect(escapeRegExp('$dumpvars')).toBe('\\$dumpvars');
    expect(escapeRegExp('a[0]')).toBe('a\\[0\\]');
    expect(escapeRegExp('x.y')).toBe('x\\.y');
  });

  it('e seguro aplicar em texto sem nada especial', () => {
    expect(escapeRegExp('modulo')).toBe('modulo');
  });
});

describe('buildRegex em modo literal', () => {
  it('acha texto simples', () => {
    expect('module ula'.match(buildRegex('ula', opts()))).toBeTruthy();
  });

  it('trata o ponto como ponto, e nao como qualquer caractere', () => {
    const re = buildRegex('a.b', opts());
    expect(re.test('a.b')).toBe(true);
    re.lastIndex = 0;
    expect(re.test('axb')).toBe(false);
  });

  it('nao lanca com parentese aberto, que num regex cru seria erro', () => {
    expect(() => buildRegex('ula(', opts())).not.toThrow();
    expect(buildRegex('ula(', opts()).test('ula(clk)')).toBe(true);
  });

  it('acha o cifrao das tarefas do Verilog', () => {
    expect(buildRegex('$dumpvars', opts()).test('  $dumpvars(1, tb);')).toBe(true);
  });

  it('ignora caixa por padrao e respeita quando pedido', () => {
    expect(buildRegex('ULA', opts()).test('module ula')).toBe(true);
    expect(buildRegex('ULA', opts({ caseSensitive: true })).test('module ula')).toBe(false);
  });
});

describe('buildRegex em modo expressao regular', () => {
  it('passa o padrao adiante sem escapar', () => {
    const re = buildRegex('a.b', opts({ regex: true }));
    expect(re.test('axb')).toBe(true);
  });

  it('lanca em padrao invalido, para o chamador virar erro na interface', () => {
    expect(() => buildRegex('ula(', opts({ regex: true }))).toThrow();
    expect(() => buildRegex('[a-', opts({ regex: true }))).toThrow();
  });
});

describe('buildRegex com palavra inteira', () => {
  it('nao casa a palavra dentro de outra', () => {
    const re = buildRegex('ula', opts({ wholeWord: true }));
    expect(re.test('ula u1')).toBe(true);
    re.lastIndex = 0;
    expect(re.test('ula_mux')).toBe(false);
  });

  it('busca terminada em simbolo depende do que vem DEPOIS do simbolo', () => {
    // Comportamento conhecido e nao obvio, registrado para quem mexer nao
    // "consertar" sem perceber. O padrao vira \bula\(\b, e a ultima borda exige
    // caractere de palavra de um dos lados do ponto onde ela cai. Depois do
    // parentese: se vier letra, ha borda e casa; se vier outro simbolo, nao ha.
    const re = () => buildRegex('ula(', opts({ wholeWord: true }));
    expect(re().test('ula(clk)')).toBe(true);  // ( seguido de letra
    expect(re().test('ula()')).toBe(false);    // ( seguido de )
    expect(re().test('ula( clk)')).toBe(false); // ( seguido de espaco
  });

  it('combina com caixa sensivel', () => {
    const re = buildRegex('ULA', opts({ wholeWord: true, caseSensitive: true }));
    expect(re.test('ULA u1')).toBe(true);
    re.lastIndex = 0;
    expect(re.test('ula u1')).toBe(false);
  });
});

describe('buildRegex sempre devolve regex global', () => {
  it('porque o scanner reusa a instancia por linha', () => {
    expect(buildRegex('x', opts()).flags).toContain('g');
    expect(buildRegex('x', opts({ caseSensitive: true })).flags).toBe('g');
    expect(buildRegex('x', opts()).flags).toBe('gi');
  });
});
