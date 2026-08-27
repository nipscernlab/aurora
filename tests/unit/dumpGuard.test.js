import { describe, it, expect } from 'vitest';
import {
  nomesDeDumpEsperados, NOMES_DE_DUMP_COCOTB, dumpEstaFresco,
} from '../../js/compilation/dump_guard.js';

describe('nomesDeDumpEsperados', () => {
  it('cobre os dois formatos que o resolver aceita, .fst primeiro', () => {
    expect(nomesDeDumpEsperados('tb_media')).toEqual(['tb_media.fst', 'tb_media.vcd']);
  });
  it('cocotb usa os nomes fixos do runner', () => {
    expect(NOMES_DE_DUMP_COCOTB).toEqual(['dump.fst', 'dump.vcd']);
  });
});

describe('dumpEstaFresco', () => {
  const inicio = 1_000_000_000_000;

  it('aceita dump escrito depois do inicio da corrida', () => {
    expect(dumpEstaFresco(inicio + 15_000, inicio)).toBe(true);
  });

  it('rejeita dump de uma corrida anterior', () => {
    expect(dumpEstaFresco(inicio - 60_000, inicio)).toBe(false);
    expect(dumpEstaFresco(inicio - 86_400_000, inicio)).toBe(false); // ontem
  });

  it('a folga absorve granularidade de mtime (FAT arredonda em 2 s)', () => {
    expect(dumpEstaFresco(inicio - 1_999, inicio)).toBe(true);
    expect(dumpEstaFresco(inicio - 2_000, inicio)).toBe(true); // borda inclusa
    expect(dumpEstaFresco(inicio - 2_001, inicio)).toBe(false);
  });

  it('folga customizada e respeitada', () => {
    expect(dumpEstaFresco(inicio - 5_000, inicio, 6_000)).toBe(true);
    expect(dumpEstaFresco(inicio - 7_000, inicio, 6_000)).toBe(false);
  });

  it('entrada sem numero utilizavel e fail-open: nunca derruba onda boa', () => {
    expect(dumpEstaFresco(NaN, inicio)).toBe(true);
    expect(dumpEstaFresco(undefined, inicio)).toBe(true);
    expect(dumpEstaFresco(inicio, NaN)).toBe(true);
    expect(dumpEstaFresco(null, inicio)).toBe(true);
  });
});
