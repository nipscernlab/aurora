/**
 * Argumentos de chamada de ferramenta, validados contra o esquema que a
 * propria ferramenta publica: main/ai/tool_args.js.
 *
 * Onde isto entra. O caminho NORMAL nao precisa: quando o modelo usa o campo
 * nativo de tool-call, o SDK valida contra o `inputSchema` antes de executar.
 * O que escapava era o RESGATE de chat.js, para modelos hospedados no Ollama
 * que escrevem a chamada como JSON no meio do texto: aquilo passava por um
 * `JSON.parse` num try/catch e ia direto para o tool_bridge.
 *
 * Dois buracos, os dois silenciosos. JSON invalido sumia no catch, e a pessoa
 * via a assistente "nao fazer nada" sem nenhuma pista. E JSON VALIDO nao quer
 * dizer argumento valido: `{"filePath": 42}` passava no parse e chegava na
 * ferramenta como caminho de arquivo numerico.
 *
 * O validador cobre so o subconjunto que o manifesto usa (type, required,
 * properties, enum). O que ele nao entende passa direto, de proposito:
 * reprovar por desconhecimento seria pior do que deixar o SDK ou a propria
 * ferramenta reclamarem.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validar, motivoLegivel, tipoDe } = require('../../main/ai/tool_args.js');

// O esquema real de `create_file`, do manifesto.
const CRIAR_ARQUIVO = {
  type: 'object',
  properties: {
    filePath: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['filePath'],
};

describe('validar: o que passava antes e nao devia', () => {
  it('aceita a chamada correta', () => {
    expect(validar({ filePath: 'a.cmm', content: 'x' }, CRIAR_ARQUIVO)).toEqual([]);
  });

  it('recusa o tipo errado num campo, que o JSON.parse deixava passar', () => {
    // Este e o caso que motivou o validador: caminho de arquivo numerico.
    const p = validar({ filePath: 42 }, CRIAR_ARQUIVO);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/filePath/);
    expect(p[0]).toMatch(/string/);
  });

  it('recusa quando falta um campo obrigatorio', () => {
    expect(validar({ content: 'x' }, CRIAR_ARQUIVO)).toEqual(['falta `filePath`']);
  });

  it('campo opcional ausente nao e problema', () => {
    expect(validar({ filePath: 'a.cmm' }, CRIAR_ARQUIVO)).toEqual([]);
  });

  it('junta todos os problemas, em vez de parar no primeiro', () => {
    const esquema = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b', 'c'],
    };
    // Tres: `c` ausente, `a` com tipo errado, `b` com tipo errado. `a` e `b`
    // estao presentes, entao nao contam tambem como obrigatorio faltando.
    expect(validar({ a: 1, b: 'x' }, esquema)).toEqual([
      'falta `c`',
      '`a` devia ser string, veio integer',
      '`b` devia ser number, veio string',
    ]);
  });
});

describe('validar: os tipos', () => {
  it('integer aceita inteiro e recusa fracionario', () => {
    const e = { type: 'object', properties: { n: { type: 'integer' } } };
    expect(validar({ n: 3 }, e)).toEqual([]);
    expect(validar({ n: 3.5 }, e)).toHaveLength(1);
  });

  it('number aceita os dois', () => {
    const e = { type: 'object', properties: { n: { type: 'number' } } };
    expect(validar({ n: 3 }, e)).toEqual([]);
    expect(validar({ n: 3.5 }, e)).toEqual([]);
  });

  it('array e object nao se confundem, e null nao e object', () => {
    expect(tipoDe([])).toBe('array');
    expect(tipoDe({})).toBe('object');
    expect(tipoDe(null)).toBe('null');
    const e = { type: 'object', properties: { o: { type: 'object' } } };
    expect(validar({ o: [] }, e)).toHaveLength(1);
    expect(validar({ o: null }, e)).toHaveLength(1);
  });

  it('respeita enum', () => {
    const e = { type: 'object', properties: { modo: { type: 'string', enum: ['a', 'b'] } } };
    expect(validar({ modo: 'a' }, e)).toEqual([]);
    expect(validar({ modo: 'z' }, e)[0]).toMatch(/a, b/);
  });

  it('argumento que nem e objeto e recusado de uma vez', () => {
    expect(validar('texto solto', CRIAR_ARQUIVO)).toHaveLength(1);
    expect(validar([], CRIAR_ARQUIVO)).toHaveLength(1);
  });
});

describe('validar: a duvida e nossa, nao de quem chamou', () => {
  it('sem esquema, nao reprova nada', () => {
    expect(validar({ qualquer: 'coisa' }, null)).toEqual([]);
    expect(validar({ qualquer: 'coisa' }, undefined)).toEqual([]);
  });

  it('construcao de esquema que nao entendemos passa direto', () => {
    // Nao ha $ref nem oneOf no manifesto. Se um dia houver, o certo e deixar o
    // SDK ou a ferramenta reclamarem, e nao recusar por desconhecimento.
    expect(validar({ x: 1 }, { oneOf: [{ type: 'string' }] })).toEqual([]);
  });
});

describe('motivoLegivel: o que vai para o terminal', () => {
  it('nomeia a ferramenta e o motivo, numa linha', () => {
    const msg = motivoLegivel('create_file', ['falta `filePath`']);
    expect(msg).toContain('create_file');
    expect(msg).toContain('filePath');
    expect(msg).toMatch(/nao foi executada/);
    expect(msg.split('\n')).toHaveLength(1);
  });
});
