/**
 * O reconhecedor de linhas de progresso (js/terminal/progress_line.js).
 *
 * Ele decide o que vira barra e o que chega ao terminal como texto, e as duas
 * decisoes erradas custam coisas diferentes: engolir uma linha comum some com
 * informacao que o usuario nunca vai saber que existiu, enquanto deixar passar
 * uma linha de contador so enche a tela. Por isso os testes cobrem as duas
 * bordas, e a lista de "isto NAO e progresso" e a metade que importa.
 */

import { describe, expect, it } from 'vitest';

import { lerProgresso } from '../../js/terminal/progress_line.js';

describe('formatos reconhecidos', () => {
  it('o harness do teste de hardware', () => {
    const p = lerProgresso('@@AURORA_PROG 512 1024 7');
    expect(p).toMatchObject({ pct: 50, cyc: 512, total: 1024, reads: 7, done: false });
  });

  it('cocotb, com o prefixo de log que ele mesmo poe na frente', () => {
    const p = lerProgresso('1250000.00ns INFO cocotb.dut media: 128/512 samples processed (25%)');
    expect(p).toMatchObject({ pct: 25, cyc: 128, total: 512, done: false });
    // O rotulo e o nome do sinal, e nao o carimbo de tempo nem o "INFO".
    expect(p.label).toBe('media');
  });

  it('contador declarado, em portugues e em ingles', () => {
    expect(lerProgresso('progress: 3/10')).toMatchObject({ pct: 30, cyc: 3, total: 10 });
    expect(lerProgresso('Progresso 5 / 10 amostras')).toMatchObject({ pct: 50, cyc: 5, total: 10 });
  });

  it('percentual declarado', () => {
    expect(lerProgresso('progress: 42%')).toMatchObject({ pct: 42, cyc: null, total: null });
  });

  it('percentual entre colchetes, o formato do make', () => {
    expect(lerProgresso('[ 42%] Building CXX object Vtop.o')).toMatchObject({ pct: 42 });
  });

  it('o fim e o contador chegando ao total, nao o percentual arredondado', () => {
    // 1023/1024 arredonda para 100%, e uma barra que se despede antes do fim
    // faz o usuario achar que a simulacao travou no ultimo passo.
    expect(lerProgresso('@@AURORA_PROG 1023 1024 0')).toMatchObject({ pct: 100, done: false });
    expect(lerProgresso('@@AURORA_PROG 1024 1024 0')).toMatchObject({ pct: 100, done: true });
  });

  it('percentual fora da faixa e preso entre 0 e 100', () => {
    expect(lerProgresso('progress: 380%')).toMatchObject({ pct: 100 });
    expect(lerProgresso('@@AURORA_PROG 900 100 0')).toMatchObject({ pct: 100 });
  });
});

describe('o que NAO e progresso, e precisa chegar ao terminal', () => {
  const naoSao = [
    // Resultado, nao andamento. O numero e a conclusao.
    '50% of tests failed',
    'Cobertura: 87% das linhas',
    // Frase com contador dentro, mas contando outra coisa.
    'Error: 3/10 assertions failed in tb_media',
    'Warning: 2/8 signals were not found in the dump',
    // Numero solto, sem nada declarando progresso.
    '512/1024',
    '42%',
    // Saida normal de ferramenta.
    'VCD info: dumpfile media.vcd opened for output.',
    '$finish called at 102400 (1ps)',
    "assign x = 100'd42;",
    '',
    '   ',
  ];
  for (const linha of naoSao) {
    it(JSON.stringify(linha), () => {
      expect(lerProgresso(linha)).toBeNull();
    });
  }

  it('o formato da AURORA com sujeira em volta e ecoado, nao engolido', () => {
    // Sobra zero de proposito: se este formato mudar, alguem precisa VER a
    // linha nova em vez de ela sumir na barra.
    expect(lerProgresso('@@AURORA_PROG 1 2 3 e mais alguma coisa')).toBeNull();
  });

  it('entrada que nao e texto nao quebra nem vira progresso', () => {
    expect(lerProgresso(null)).toBeNull();
    expect(lerProgresso(undefined)).toBeNull();
    expect(lerProgresso(12)).toBeNull();
  });
});

describe('rotulo', () => {
  it('cai na reserva quando a linha nao nomeia nada', () => {
    expect(lerProgresso('@@AURORA_PROG 1 4 0', { rotuloPadrao: 'execucao' }).label).toBe('execucao');
  });

  it('usa o texto que vem depois do percentual quando ha um', () => {
    expect(lerProgresso('[ 10%] Compilando Vtop').label).toBe('Compilando Vtop');
  });
});
