/**
 * A citacao verificada contra o arquivo: main/docs/citar.js.
 *
 * O QUE ESTE CODIGO E, e o que ele NAO e. Ele nao pergunta ao modelo de onde
 * veio a frase; ele recebe um LOCALIZADOR (o comeco da frase) e o procura no
 * texto da pagina. O que sai daqui e sempre lido do arquivo. Se o localizador
 * nao estiver la, a citacao e recusada, e a recusa e o ponto: sem ela,
 * "verificar" seria repetir o que o modelo digitou com um carimbo em volta.
 *
 * POR QUE LOCALIZADOR E NAO A FRASE INTEIRA. Duas razoes, e as duas valem
 * sozinhas. O modelo digitar a frase toda e token de saida pago, que e
 * exatamente o que se tirou do prompt quando a citacao nativa entrou. E o
 * manual muda sozinho: quanto mais texto o casamento exige, maior a chance de
 * uma palavra ter sido editada e derrubar tudo.
 *
 * AS TRES RECUSAS, e por que cada uma existe:
 *   curto demais   , casaria em varios pontos, e citar o primeiro seria pior
 *                    do que nao citar;
 *   nao existe     , o modelo escreveu de memoria em vez de ler;
 *   ambiguo        , aparece duas vezes, entao nao diz QUAL trecho sustenta.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { conferir, fimDaFrase, normalizar, MIN_LOCALIZADOR } = require('../../main/docs/citar.js');

// Uma pagina como o extrator a entrega: paragrafos ja colapsados num texto so.
const PAGINA = 'Tipos do C±. '
  + 'O tipo complexo e nativo da linguagem, e por isso o identificador i nao serve de contador de laco. '
  + 'Arrays nao podem ser passados como parametro de funcao. '
  + 'O arquivo main.cmm declara o processador. '
  + 'Repetido: o compilador avisa. Repetido: o compilador avisa.';

describe('o que volta e lido do arquivo', () => {
  it('expande o localizador ate o fim da frase', () => {
    const r = conferir(PAGINA, 'O tipo complexo e nativo');
    expect(r.ok).toBe(true);
    // A frase inteira, e nao so o que o modelo mandou: e a diferenca entre
    // citar o arquivo e repetir o modelo.
    expect(r.trecho).toBe('O tipo complexo e nativo da linguagem, e por isso o identificador i nao serve de contador de laco.');
  });

  it('o espaco escrito de outro jeito nao atrapalha', () => {
    const r = conferir(PAGINA, '  Arrays   nao podem\n ser passados ');
    expect(r.ok).toBe(true);
    expect(r.trecho).toBe('Arrays nao podem ser passados como parametro de funcao.');
  });

  it('ponto dentro de nome de arquivo nao termina a frase', () => {
    // `main.cmm` cortaria a frase em "O arquivo main." se o corte fosse no
    // primeiro ponto. O manual e cheio de nomes de arquivo.
    const r = conferir(PAGINA, 'O arquivo main.cmm declara');
    expect(r.ok).toBe(true);
    expect(r.trecho).toBe('O arquivo main.cmm declara o processador.');
  });
});

describe('as tres recusas', () => {
  it('recusa o localizador curto demais, e diz o que fazer', () => {
    const r = conferir(PAGINA, 'O tipo');
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(new RegExp(String(MIN_LOCALIZADOR)));
    expect(r.erro).toMatch(/primeiras palavras/);
  });

  it('recusa o que nao esta na pagina, e manda reler em vez de reescrever', () => {
    // Este e o caso que a ferramenta existe para pegar: o modelo lembrando
    // em vez de lendo.
    const r = conferir(PAGINA, 'O tipo complexo foi removido da linguagem');
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/nao existe nesta pagina/);
    expect(r.erro).toMatch(/read_manual_page/);
  });

  it('recusa o localizador ambiguo', () => {
    // Aparece duas vezes: nao diz qual das duas sustenta a afirmacao.
    const r = conferir(PAGINA, 'Repetido: o compilador avisa');
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/mais de uma vez/);
  });

  it('recusa o localizador longo demais, que seria a frase inteira', () => {
    const r = conferir(PAGINA, 'x'.repeat(500));
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/teto/);
  });
});

describe('o fim da frase', () => {
  it('fecha em ponto, interrogacao e exclamacao seguidos de maiuscula', () => {
    expect(fimDaFrase('Uma frase. Outra frase.', 0)).toBe(10);
    expect(fimDaFrase('Serve? Sim.', 0)).toBe(6);
  });

  it('nao fecha em ponto seguido de minuscula', () => {
    // "1.5 volts" e "main.js" sao a regra no manual, nao a excecao.
    const t = 'O ganho e 1.5 vezes maior. Fim.';
    expect(fimDaFrase(t, 0)).toBe(26);
  });

  it('sem pontuacao, para no teto e nao no fim do arquivo', () => {
    const t = 'palavra '.repeat(200);
    expect(fimDaFrase(t, 0)).toBeLessThanOrEqual(400);
  });
});

describe('normalizar', () => {
  it('e a mesma dos dois lados da comparacao', () => {
    expect(normalizar('  a\n  b  ')).toBe('a b');
    expect(normalizar(null)).toBe('');
  });
});
