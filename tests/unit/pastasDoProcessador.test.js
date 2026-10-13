/**
 * Onde mora cada arquivo de um processador desde o yanc v7.1, e que nome o
 * processador pode ter (js/compilation/pastas_do_processador.ts).
 *
 * A regra do nome e copia da do yanc (Compilers/common/proc_name.c). O teste
 * prende os exemplos que o proprio yanc da na resposta da v7.1, para a AURORA
 * recusar na criacao exatamente o que a compilacao recusaria depois.
 */

import { describe, expect, it } from 'vitest';

import {
  arquivosDaSaida,
  arquivosLidosPeloVerilog,
  nomesDosProcessadores,
  problemaNoNomeDoProcessador,
  processadorDoCaminho,
  segmentosDaSaida,
  segmentosDaSimulacao,
  segmentosDoFonte,
} from '../../js/compilation/pastas_do_processador.ts';

describe('as duas pastas', () => {
  it('o fonte fica em <proc>/ e a saida em <proc>/<proc>/', () => {
    expect(segmentosDoFonte('filtro')).toEqual(['filtro']);
    expect(segmentosDaSaida('filtro')).toEqual(['filtro', 'filtro']);
  });

  it('os nomes do que o yanc gera seguem o processador', () => {
    expect(arquivosDaSaida('filtro')).toEqual({
      asm: 'filtro.asm',
      progLog: 'prog_log.txt',
      srcLines: 'src_lines.txt',
      pcMem: 'pc_filtro_mem.txt',
      appLog: 'app_log.txt',
      tradOpcode: 'trad_opcode.txt',
      verilog: 'filtro.v',
      instMif: 'filtro_inst.mif',
      dataMif: 'filtro_data.mif',
      testbench: 'filtro_tb.v',
    });
  });

  it('o Verilog le os dois .mif e o pc_<proc>_mem.txt pelo nome puro', () => {
    expect(arquivosLidosPeloVerilog('a')).toEqual(['a_inst.mif', 'a_data.mif', 'pc_a_mem.txt']);
  });
});

describe('processadorDoCaminho', () => {
  const proj = 'C:\\proj';
  const nomes = ['Filtro', 'outro'];

  it('arquivo na pasta do processador e do fonte', () => {
    expect(processadorDoCaminho('C:\\proj\\Filtro\\Filtro.cmm', proj, nomes))
      .toEqual({ nome: 'Filtro', lugar: 'fonte' });
    expect(processadorDoCaminho('C:/proj/filtro/input_0.txt', proj, nomes))
      .toEqual({ nome: 'Filtro', lugar: 'fonte' });
  });

  it('arquivo em <proc>/<proc>/ e da saida', () => {
    expect(processadorDoCaminho('C:\\proj\\Filtro\\Filtro\\Filtro.v', proj, nomes))
      .toEqual({ nome: 'Filtro', lugar: 'saida' });
  });

  it('caixa diferente no projeto e no processador ainda casa', () => {
    expect(processadorDoCaminho('c:/PROJ/OUTRO/outro/outro_tb.v', proj, nomes))
      .toEqual({ nome: 'outro', lugar: 'saida' });
  });

  it('fora do projeto, de processador desconhecido ou em outra subpasta: null', () => {
    expect(processadorDoCaminho('C:\\outro\\Filtro\\Filtro.cmm', proj, nomes)).toBeNull();
    expect(processadorDoCaminho('C:\\proj\\Novo\\Novo.cmm', proj, nomes)).toBeNull();
    expect(processadorDoCaminho('C:\\proj\\Filtro\\Software\\Filtro.cmm', proj, nomes)).toBeNull();
    expect(processadorDoCaminho('C:\\proj\\Filtro', proj, nomes)).toBeNull();
    expect(processadorDoCaminho('C:\\proj\\top.v', proj, nomes)).toBeNull();
    expect(processadorDoCaminho('C:\\project\\Filtro\\Filtro.cmm', proj, nomes)).toBeNull();
  });

  it('sem caminho ou sem projeto: null', () => {
    expect(processadorDoCaminho(null, proj, nomes)).toBeNull();
    expect(processadorDoCaminho('C:\\proj\\Filtro\\Filtro.cmm', '', nomes)).toBeNull();
  });
});

describe('problemaNoNomeDoProcessador, a regra do yanc', () => {
  it('nomes que servem', () => {
    for (const n of ['filtro', 'Filtro_2', '_x', 'a', 'Begin', 'mediamovel']) {
      expect(problemaNoNomeDoProcessador(n), n).toBeNull();
    }
  });

  it('os exemplos da resposta do yanc, cada um pelo seu motivo', () => {
    expect(problemaNoNomeDoProcessador('my-prog')).toBe('caracteres');
    expect(problemaNoNomeDoProcessador('dois nomes')).toBe('caracteres');
    expect(problemaNoNomeDoProcessador('2fast')).toBe('digito');
    expect(problemaNoNomeDoProcessador('__x')).toBe('sublinhado');
    expect(problemaNoNomeDoProcessador('begin')).toBe('reservada');
    expect(problemaNoNomeDoProcessador('module')).toBe('reservada');
    expect(problemaNoNomeDoProcessador('input')).toBe('reservada');
    expect(problemaNoNomeDoProcessador('wire')).toBe('reservada');
  });

  it('acento nao e letra para o Verilog', () => {
    expect(problemaNoNomeDoProcessador('média')).toBe('caracteres');
  });

  it('vazio ou nao-texto', () => {
    expect(problemaNoNomeDoProcessador('')).toBe('vazio');
    expect(problemaNoNomeDoProcessador(null)).toBe('vazio');
    expect(problemaNoNomeDoProcessador(42)).toBe('vazio');
  });

  it('a ordem e a do yanc: caractere invalido vence o digito inicial', () => {
    expect(problemaNoNomeDoProcessador('2-x')).toBe('caracteres');
    expect(problemaNoNomeDoProcessador('2__')).toBe('digito');
  });
});

describe('nomesDosProcessadores', () => {
  it('aceita texto e objeto, e tira o que nao tem nome', () => {
    expect(nomesDosProcessadores(['a', { name: ' b ' }, { name: '' }, null, 3, {}])).toEqual(['a', 'b']);
  });

  it('o que nao e lista vira lista vazia', () => {
    expect(nomesDosProcessadores(undefined)).toEqual([]);
    expect(nomesDosProcessadores({ name: 'a' })).toEqual([]);
  });
});

describe('segmentosDaSimulacao', () => {
  const proj = 'C:/proj';

  it('o _tb.v gerado roda na pasta de saida do processador', () => {
    expect(segmentosDaSimulacao('C:/proj/f/f/f_tb.v', proj, ['f'])).toEqual(['f', 'f']);
  });

  it('o testbench do projeto roda na pasta do projeto', () => {
    expect(segmentosDaSimulacao('C:/proj/Testbench/tb.v', proj, ['f'])).toBeNull();
    expect(segmentosDaSimulacao('C:/proj/f/tb_meu.v', proj, ['f'])).toBeNull();
    expect(segmentosDaSimulacao(null, proj, ['f'])).toBeNull();
  });
});
