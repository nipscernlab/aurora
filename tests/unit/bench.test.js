import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mediana, campo, argumentos, COLUNAS } = require('../../scripts/bench.js');

// O bench so vale se a linha que ele grava for comparavel com a anterior. As
// tres pecas puras que decidem isso ficam provadas aqui: a mediana que resiste
// a uma repeticao com o antivirus acordando, o campo de CSV que nao quebra com
// virgula ou aspas na nota, e os argumentos, cujo default e o que o `npm run
// bench` executa sem ninguem olhar.

describe('mediana', () => {
  it('impar e par, e ignora o que nao e numero', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
    expect(mediana([NaN, 5, undefined, 7])).toBe(6);
  });

  it('vazia da NaN, que vira campo vazio no CSV', () => {
    expect(Number.isNaN(mediana([]))).toBe(true);
    expect(campo(mediana([]))).toBe('');
  });

  it('uma repeticao fora da curva nao vira tendencia', () => {
    expect(mediana([900, 910, 9000])).toBe(910);
  });
});

describe('campo de CSV', () => {
  it('numero e texto simples saem como estao', () => {
    expect(campo(42)).toBe('42');
    expect(campo('antes do refreshTree novo')).toBe('antes do refreshTree novo');
  });

  it('virgula, aspas e quebra de linha ganham aspas, com aspas internas dobradas', () => {
    expect(campo('a,b')).toBe('"a,b"');
    expect(campo('diz "oi"')).toBe('"diz ""oi"""');
    expect(campo('duas\nlinhas')).toBe('"duas\nlinhas"');
  });

  it('nulo e indefinido ficam vazios', () => {
    expect(campo(null)).toBe('');
    expect(campo(undefined)).toBe('');
  });
});

describe('argumentos', () => {
  it('sem nada: tres repeticoes, grava, nao compila', () => {
    const o = argumentos([]);
    expect(o.runs).toBe(3);
    expect(o.seco).toBe(false);
    expect(o.compilar).toBe(false);
    expect(o.nota).toBe('');
  });

  it('le runs, nota, seco e compilar', () => {
    const o = argumentos(['--runs', '5', '--nota', 'x y', '--seco', '--compilar']);
    expect(o.runs).toBe(5);
    expect(o.nota).toBe('x y');
    expect(o.seco).toBe(true);
    expect(o.compilar).toBe(true);
  });

  it('runs invalido cai para tres, e nunca zero', () => {
    expect(argumentos(['--runs', 'abc']).runs).toBe(3);
    expect(argumentos(['--runs', '0']).runs).toBe(1);
  });
});

describe('colunas', () => {
  it('a nota e a ultima, para virgula nela nao deslocar numero', () => {
    expect(COLUNAS[COLUNAS.length - 1]).toBe('nota');
    expect(COLUNAS[0]).toBe('data');
    expect(COLUNAS).toContain('commit');
  });
});
