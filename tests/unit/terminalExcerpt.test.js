/**
 * O recorte do terminal que acompanha um relato.
 *
 * A regra decide o que a equipe vai ver de uma compilacao que falhou na
 * maquina de outra pessoa. Errar aqui nao quebra nada visivelmente: o relato
 * chega, so que sem a linha que explicava a falha, e a investigacao vira
 * adivinhacao.
 *
 * Tres coisas nao dao para conferir lendo o codigo, e sao as testadas:
 * que o erro nunca e descartado, que a vizinhanca vem junto (o iverilog diz
 * ONDE falhou uma linha antes de dizer O QUE falhou), e que o teto preserva
 * os ULTIMOS erros, que sao os que derrubaram a build.
 */

import { describe, it, expect } from 'vitest';

import {
  recortar, LIMITE_LINHAS, CAUDA_SEM_ERRO, VIZINHANCA,
} from '../../js/terminal/terminal_excerpt.js';

const info = (t) => ({ tipo: 'INFO', texto: t });
const erro = (t) => ({ tipo: 'ERRO', texto: t });
const aviso = (t) => ({ tipo: 'AVISO', texto: t });

describe('recortar', () => {
  it('nao inventa nada com a lista vazia', () => {
    expect(recortar([])).toEqual({ linhas: [], cortadas: 0 });
    expect(recortar(null)).toEqual({ linhas: [], cortadas: 0 });
  });

  it('sem erro, guarda o fim, que e onde a sessao parou', () => {
    const linhas = Array.from({ length: 100 }, (_, i) => info(`linha ${i}`));
    const { linhas: saida, cortadas } = recortar(linhas);
    expect(saida).toHaveLength(CAUDA_SEM_ERRO);
    expect(saida[saida.length - 1].texto).toBe('linha 99');
    expect(cortadas).toBe(100 - CAUDA_SEM_ERRO);
  });

  it('guarda o erro E a vizinhanca dele', () => {
    const linhas = [
      ...Array.from({ length: 50 }, (_, i) => info(`ruido ${i}`)),
      info('compilando core.v'),
      erro('syntax error near always'),
      info('abortando'),
      ...Array.from({ length: 50 }, (_, i) => info(`mais ruido ${i}`)),
    ];
    const textos = recortar(linhas).linhas.map((l) => l.texto);
    expect(textos).toContain('syntax error near always');
    // A linha ANTES do erro e a que diz em que arquivo ele aconteceu.
    expect(textos).toContain('compilando core.v');
    expect(textos).toContain('abortando');
    // E o ruido distante fica de fora.
    expect(textos).not.toContain('ruido 0');
  });

  it('avisos contam como interessantes', () => {
    const linhas = [...Array.from({ length: 40 }, (_, i) => info(`x ${i}`)), aviso('latch inferido')];
    expect(recortar(linhas).linhas.map((l) => l.texto)).toContain('latch inferido');
  });

  it('marca o que foi omitido, em vez de emendar linhas distantes', () => {
    // Sem a marca, duas linhas separadas por centenas de outras apareceriam
    // coladas, e quem le concluiria que uma levou a outra.
    const linhas = [
      erro('primeiro'),
      ...Array.from({ length: 60 }, (_, i) => info(`meio ${i}`)),
      erro('segundo'),
    ];
    const textos = recortar(linhas).linhas.map((l) => l.texto);
    expect(textos.some((t) => t.includes('linhas omitidas'))).toBe(true);
  });

  it('nao marca omissao entre linhas que ja eram vizinhas', () => {
    const linhas = [info('a'), erro('b'), info('c')];
    const textos = recortar(linhas).linhas.map((l) => l.texto);
    expect(textos.some((t) => t.includes('omitidas'))).toBe(false);
    expect(textos).toEqual(['a', 'b', 'c']);
  });

  it('com erros demais, preserva os ULTIMOS', () => {
    // O primeiro erro de uma build costuma ser sintoma; os ultimos sao os que
    // a derrubaram. Cortar pelo comeco jogaria fora justamente o desfecho.
    const linhas = Array.from({ length: 400 }, (_, i) => erro(`erro ${i}`));
    const { linhas: saida } = recortar(linhas);
    expect(saida.length).toBeLessThanOrEqual(LIMITE_LINHAS);
    expect(saida[saida.length - 1].texto).toBe('erro 399');
  });

  it('a vizinhanca declarada e a aplicada', () => {
    const linhas = [
      ...Array.from({ length: 20 }, (_, i) => info(`antes ${i}`)),
      erro('estourou'),
    ];
    const textos = recortar(linhas).linhas.map((l) => l.texto);
    expect(textos).toContain(`antes ${20 - VIZINHANCA}`);
    expect(textos).not.toContain(`antes ${20 - VIZINHANCA - 1}`);
  });
});
