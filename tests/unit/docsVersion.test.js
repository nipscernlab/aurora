/**
 * Testes da comparacao de versao do manual.
 *
 * O manual do SAPHO chega por dois caminhos: o que veio dentro do instalador e o
 * que o download-docs baixa depois, em userData. O `isNewer` decide qual dos
 * dois e servido. Errar ali nao da erro: serve documentacao velha em silencio,
 * que e o pior tipo de falha num material didatico.
 *
 * O caso que motiva o teste esta escrito no proprio codigo: comparar como texto
 * erraria em 6.10.0 contra 6.9.0, porque "1" vem antes de "9".
 */

import { describe, it, expect } from 'vitest';

import { isNewer, stripBom } from '../../main/ipc/docs.js';

describe('isNewer', () => {
  it('compara numero e nao texto, que e a razao de existir', () => {
    expect(isNewer('6.10.0', '6.9.0')).toBe(true);
    expect(isNewer('6.9.0', '6.10.0')).toBe(false);
    expect(isNewer('1.100.0', '1.99.0')).toBe(true);
  });

  it('versao igual nao e mais nova', () => {
    expect(isNewer('6.4.0', '6.4.0')).toBe(false);
  });

  it('compara da esquerda para a direita, com o major mandando', () => {
    expect(isNewer('7.0.0', '6.99.99')).toBe(true);
    expect(isNewer('6.99.99', '7.0.0')).toBe(false);
  });

  it('trata parte ausente como zero', () => {
    expect(isNewer('6.4', '6.4.0')).toBe(false); // iguais
    expect(isNewer('6.4.1', '6.4')).toBe(true);
    expect(isNewer('6.4', '6.4.1')).toBe(false);
    expect(isNewer('7', '6.9.9')).toBe(true);
  });

  it('nao quebra com entrada vazia, nula ou nao numerica', () => {
    expect(isNewer('', '')).toBe(false);
    expect(isNewer(null, undefined)).toBe(false);
    expect(isNewer('6.4.0', null)).toBe(true);
    expect(isNewer(null, '6.4.0')).toBe(false);
    expect(isNewer('abc', 'def')).toBe(false); // ambos viram 0
    expect(isNewer('6.4.0', 'abc')).toBe(true);
  });

  it('nao inverte quando so um lado tem sufixo nao numerico', () => {
    // parseInt('4-beta') e 4, entao a comparacao cai no numero.
    expect(isNewer('6.4.0', '6.4.0-beta')).toBe(false);
    expect(isNewer('6.5.0', '6.4.0-beta')).toBe(true);
  });
});

describe('stripBom', () => {
  it('tira o BOM que ferramenta do Windows grava e o JSON.parse recusa', () => {
    expect(stripBom('﻿{"a":1}')).toBe('{"a":1}');
    expect(JSON.parse(stripBom('﻿{"a":1}'))).toEqual({ a: 1 });
  });

  it('nao mexe em texto sem BOM', () => {
    expect(stripBom('{"a":1}')).toBe('{"a":1}');
  });

  it('tira so o primeiro, porque BOM no meio e conteudo', () => {
    expect(stripBom('﻿a﻿b')).toBe('a﻿b');
  });

  it('nao quebra com string vazia', () => {
    expect(stripBom('')).toBe('');
  });
});
