/**
 * O que a simulacao e a forma de onda leem da pasta de saida do yanc v7.1
 * (js/compilation/tabelas_do_yanc.ts e diretorioDaSimulacao em
 * js/compilation/arquivos_da_simulacao.ts), e a linha `lang` do prog_log.txt
 * (linguagemDoProgLog em pastas_do_processador.ts).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const disco = vi.hoisted(() => new Map());
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: {
    joinPath: async (...p) => p.join('/'),
    fileExists: async (p) => disco.has(p),
    readFile: async (p) => {
      if (disco.get(p) instanceof Error) throw disco.get(p);
      return disco.get(p);
    },
  },
}));

import { linguagensDosProcessadores } from '../../js/compilation/tabelas_do_yanc.ts';
import { diretorioDaSimulacao } from '../../js/compilation/arquivos_da_simulacao.ts';
import { linguagemDoProgLog } from '../../js/compilation/pastas_do_processador.ts';

beforeEach(() => disco.clear());

describe('linguagemDoProgLog', () => {
  it('le a linha lang do prog_log.txt', () => {
    expect(linguagemDoProgLog('main soma 1\nnum_ins 22\nsrcdir C:/p\nlang C+-\n')).toBe('C+-');
    expect(linguagemDoProgLog('lang C++\r\nsrcdir x\n')).toBe('C++');
  });

  it('prog_log de antes da v7.1, linha estranha ou nada: null', () => {
    expect(linguagemDoProgLog('main soma 1\nnum_ins 22\n')).toBeNull();
    expect(linguagemDoProgLog('lang Python\n')).toBeNull();
    expect(linguagemDoProgLog('xlang C++\n')).toBeNull();
    expect(linguagemDoProgLog(null)).toBeNull();
  });
});

describe('linguagensDosProcessadores', () => {
  it('cada processador com prog_log diz a sua; quem nao tem fica de fora', async () => {
    disco.set('C:/p/a/a/prog_log.txt', 'lang C++\n');
    disco.set('C:/p/b/b/prog_log.txt', 'lang C+-\n');
    disco.set('C:/p/c/c/prog_log.txt', 'num_ins 3\n');
    disco.set('C:/p/d/d/prog_log.txt', new Error('EBUSY'));
    expect(await linguagensDosProcessadores('C:/p', ['a', { name: 'b' }, 'c', 'd', 'e']))
      .toEqual({ a: 'C++', b: 'C+-' });
  });

  it('sem projeto, nada', async () => {
    expect(await linguagensDosProcessadores(null, ['a'])).toEqual({});
  });
});

describe('diretorioDaSimulacao', () => {
  it('o _tb.v gerado roda na pasta de saida do processador', async () => {
    expect(await diretorioDaSimulacao('C:/p', [{ name: 'fir' }], 'C:/p/fir/fir/fir_tb.v', 'C:/p/.aurora/Temp'))
      .toBe('C:/p/fir/fir');
  });

  it('o testbench do projeto, ou nenhum, roda na pasta do projeto', async () => {
    expect(await diretorioDaSimulacao('C:/p', ['fir'], 'C:/p/Testbench/tb.v', 'T')).toBe('C:/p');
    expect(await diretorioDaSimulacao('C:/p', ['fir'], null, 'T')).toBe('C:/p');
  });

  it('sem projeto, a reserva', async () => {
    expect(await diretorioDaSimulacao(null, ['fir'], 'C:/p/fir/fir/fir_tb.v', 'T')).toBe('T');
  });
});
