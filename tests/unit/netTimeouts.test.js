// Tabela de prazos de rede e de processo filho (main/net/timeouts.js).
// O que se garante aqui e o contrato, nao os numeros: a hierarquia que a
// autoverificacao do modulo protege, e o prazo do Surfer crescendo com o dump
// sem sair do piso nem passar do teto.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const t = require('../../main/net/timeouts.js');

describe('net/timeouts: hierarquia', () => {
  it('todos os prazos sao positivos e o avatar espera menos que a API', () => {
    for (const k of ['GITHUB_API_MS', 'GITHUB_AVATAR_MS', 'GIT_IDLE_MS', 'EXTRACT_MS',
      'SURFER_BOOT_BASE_MS', 'SURFER_BOOT_PER_MB_MS', 'SURFER_BOOT_MAX_MS']) {
      expect(t[k], k).toBeGreaterThan(0);
    }
    expect(t.GITHUB_AVATAR_MS).toBeLessThanOrEqual(t.GITHUB_API_MS);
    expect(t.SURFER_BOOT_BASE_MS).toBeLessThanOrEqual(t.SURFER_BOOT_MAX_MS);
  });
});

describe('net/timeouts: surferBootDeadlineMs', () => {
  it('sem tamanho devolve o piso', () => {
    expect(t.surferBootDeadlineMs(0)).toBe(t.SURFER_BOOT_BASE_MS);
    expect(t.surferBootDeadlineMs(NaN)).toBe(t.SURFER_BOOT_BASE_MS);
    expect(t.surferBootDeadlineMs(-5)).toBe(t.SURFER_BOOT_BASE_MS);
  });

  it('cresce com o dump', () => {
    const pequeno = t.surferBootDeadlineMs(10 * 1024 * 1024);
    const medio = t.surferBootDeadlineMs(100 * 1024 * 1024);
    expect(pequeno).toBeGreaterThan(t.SURFER_BOOT_BASE_MS);
    expect(medio).toBeGreaterThan(pequeno);
  });

  it('um dump de 854 MB, o maior ja medido, ganha mais que os 30 s antigos', () => {
    expect(t.surferBootDeadlineMs(854 * 1024 * 1024)).toBeGreaterThan(30_000);
  });

  it('nunca passa do teto', () => {
    expect(t.surferBootDeadlineMs(50 * 1024 * 1024 * 1024)).toBe(t.SURFER_BOOT_MAX_MS);
  });
});
