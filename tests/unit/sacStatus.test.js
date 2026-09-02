/**
 * A leitura do Smart App Control (main/sac_status.js).
 *
 * So a interpretacao da saida do `reg query` tem logica, e errar nela tem os
 * dois custos opostos: falso alarme em toda maquina saudavel, ou silencio
 * exatamente na maquina onde a simulacao nao roda (relato #6).
 */

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { interpretarPolicyState } = require('../../main/sac_status.js');

const saida = (hex) => `
HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy
    VerifiedAndReputablePolicyState    REG_DWORD    0x${hex}
`;

describe('o VerifiedAndReputablePolicyState do registro', () => {
  it('1 e bloqueio: o unico estado que gera aviso', () => {
    expect(interpretarPolicyState(saida('1'))).toBe('ligado');
  });

  it('2 e avaliacao: observa sem bloquear, nao incomoda ninguem', () => {
    expect(interpretarPolicyState(saida('2'))).toBe('avaliacao');
  });

  it('0 e desligado', () => {
    expect(interpretarPolicyState(saida('0'))).toBe('desligado');
  });

  it('valor fora do vocabulario nao vira alarme', () => {
    expect(interpretarPolicyState(saida('7'))).toBe('desconhecido');
  });

  it('maquina sem o valor (Windows 10, build antiga) fica no desconhecido', () => {
    expect(interpretarPolicyState('ERRO: O sistema nao encontrou a chave')).toBe('desconhecido');
    expect(interpretarPolicyState('')).toBe('desconhecido');
  });
});
