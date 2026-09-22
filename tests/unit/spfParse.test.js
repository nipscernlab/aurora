/**
 * Ler um `.spf` tolerando sujeira (js/project/spf_parse.ts).
 *
 * Estes casos vinham do tests/unit/projectPaths.test.js e vieram junto com a
 * funcao, que nao e sobre caminho. A maquina de estados estava escrita duas
 * vezes, uma no renderer e outra no processo principal, e os dois leem O
 * MESMO ARQUIVO: copias divergentes fariam um projeto abrir de um lado e nao
 * do outro.
 */

import { describe, expect, it } from 'vitest';

import { parseSpfTolerant, stripJsonComments } from '../../js/project/spf_parse.ts';

describe('parseSpfTolerant', () => {
  it('le um .spf normal', () => {
    expect(parseSpfTolerant('{"a":1}')).toEqual({ a: 1 });
  });

  it('sobrevive a virgula sobrando, que edicao a mao produz', () => {
    expect(parseSpfTolerant('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });

  it('sobrevive a comentario de linha e de bloco', () => {
    expect(parseSpfTolerant('{\n// nota\n"a":1 /* outra */ }')).toEqual({ a: 1 });
  });

  it('NAO confunde // dentro de string com comentario', () => {
    // O caso real: todo .spf guarda caminho, e caminho tem barra.
    const spf = '{"basePath":"C://Users//x//proj", "url":"https://nipscern.com"}';
    expect(parseSpfTolerant(spf)).toEqual({
      basePath: 'C://Users//x//proj',
      url: 'https://nipscern.com',
    });
  });

  it('preserva aspas escapadas dentro de string', () => {
    expect(parseSpfTolerant('{"n":"diz \\"oi\\""}')).toEqual({ n: 'diz "oi"' });
  });

  it('ainda lanca quando o arquivo esta de fato quebrado', () => {
    expect(() => parseSpfTolerant('{isto nao e json')).toThrow();
  });
});

describe('stripJsonComments', () => {
  it('deixa o conteudo entre aspas intacto, barras e tudo', () => {
    // E a razao de isto ser maquina de estados e nao expressao regular.
    const t = '{"url":"https://a//b"} // fora';
    expect(stripJsonComments(t).trim()).toBe('{"url":"https://a//b"}');
  });

  it('guarda a quebra de linha que fechava o comentario', () => {
    // Sem ela, duas linhas viram uma e o JSON pode colar dois tokens.
    expect(stripJsonComments('1 // nota\n2')).toBe('1 \n2');
  });

  it('come o bloco inteiro, inclusive atravessando linhas', () => {
    expect(stripJsonComments('a /* uma\ndois */ b')).toBe('a  b');
  });

  it('nao se perde com aspa escapada logo antes do fim do texto', () => {
    expect(stripJsonComments('{"n":"diz \\"oi\\""} // fim').trim())
      .toBe('{"n":"diz \\"oi\\""}');
  });
});
