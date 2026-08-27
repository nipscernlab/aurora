/**
 * Testes do PADRÃO da preferência "limpar o acesso ao GitHub ao fechar".
 *
 * É uma decisão de segurança, não de gosto, e do tipo que se inverte sem
 * querer: basta alguém trocar o `!== false` por `=== true` numa limpeza de
 * código e o laboratório volta a deixar a conta de um aluno ativa para o
 * próximo que sentar na máquina, sem nada falhar em lugar nenhum.
 *
 * O alvo é `decidirLimparAoSair`, que recebe o conteúdo bruto do arquivo e
 * devolve a decisão. Ela existe separada da leitura do disco justamente para
 * ser verificável aqui: `limparAoSair` chama `app.getPath` do Electron, que
 * não existe neste processo, e um teste contra ela passaria pelo caminho de
 * erro em vez de pela regra — verde pelo motivo errado, que é o pior estado
 * possível para um teste de padrão de segurança.
 */

import { describe, it, expect } from 'vitest';

import { decidirLimparAoSair } from '../../main/ipc/github_forget.js';

describe('decidirLimparAoSair', () => {
  it('LIGADO quando ninguém escolheu ainda (instalação nova, sem arquivo)', () => {
    expect(decidirLimparAoSair(null)).toBe(true);
  });

  it('respeita o desligamento explícito de quem usa a própria máquina', () => {
    expect(decidirLimparAoSair(JSON.stringify({ limparAoSair: false }))).toBe(false);
  });

  it('respeita o ligamento explícito', () => {
    expect(decidirLimparAoSair(JSON.stringify({ limparAoSair: true }))).toBe(true);
  });

  it('cai no padrão quando o arquivo está corrompido', () => {
    // Um arquivo que não dá para interpretar não prova que alguém pediu para
    // manter o acesso, então vale o padrão.
    expect(decidirLimparAoSair('{ isto nao e json')).toBe(true);
  });

  it('cai no padrão quando a chave não está lá', () => {
    expect(decidirLimparAoSair(JSON.stringify({ outraCoisa: 1 }))).toBe(true);
  });

  it('só um false de verdade desliga, não um valor qualquer', () => {
    // Guarda contra alguém "consertar" a regra para algo mais permissivo:
    // string vazia, zero e null não são a escolha de manter o acesso.
    for (const v of ['', 0, null, 'false', undefined]) {
      expect(decidirLimparAoSair(JSON.stringify({ limparAoSair: v })), String(v)).toBe(true);
    }
  });
});
