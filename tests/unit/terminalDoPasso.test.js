import { describe, it, expect } from 'vitest';

// Em que terminal sai o aviso de override de cada passo. O passo do C++ nao
// estava na tabela, entao um override no cppcomp nao avisava em lugar nenhum,
// e a tabela ainda trazia o asm-pre, que saiu com o appcomp no yanc v7.1.
import { terminalForStep } from '../../js/compilation/spec_runner.js';

describe('terminalForStep', () => {
  it('cada passo que os builders emitem tem o terminal da sua etapa', () => {
    const esperado = {
      cmm: 'tcmm',
      cpp: 'tcmm',
      asm: 'tasm',
      'iverilog-check': 'tveri',
      'iverilog-build': 'tveri',
      'vvp-run': 'twave',
      'cocotb-run': 'twave',
      'verilator-build': 'twave',
      'verilator-run': 'twave',
      'verilator-json': 'twave',
      'verilator-tb-build': 'twave',
      'verilator-tb-run': 'twave',
      fst2vcd: 'twave',
      gtkwave: 'twave',
      'yosys-hierarchy': 'twave',
      'prism-yosys': 'tveri',
    };
    for (const [passo, terminal] of Object.entries(esperado)) {
      expect(terminalForStep(passo), passo).toBe(terminal);
    }
  });

  it('o asm-pre do appcomp e passo desconhecido nao tem terminal', () => {
    expect(terminalForStep('asm-pre')).toBeNull();
    expect(terminalForStep('nada')).toBeNull();
  });
});
