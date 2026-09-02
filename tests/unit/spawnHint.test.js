/**
 * O que o terminal diz quando o Windows barra um executavel da toolchain
 * (main/compile/spawn_hint.js).
 *
 * O relato #6 do sapho-relatos mostrou o custo de nao dizer: "spawn UNKNOWN"
 * no terminal, o aviso do Smart App Control no canto da tela, e o aluno
 * reinstalando componentes porque nada ligava uma coisa a outra. A regra
 * aqui e cirurgica: so no Windows, e so nos codigos que um bloqueio produz;
 * qualquer outro erro passa intocado, porque diagnostico errado e pior que
 * nenhum.
 */

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { mensagemDeErroDeSpawn } = require('../../main/compile/spawn_hint.js');

const bloqueio = { message: 'spawn UNKNOWN', code: 'UNKNOWN' };

describe('quando o Windows barra o executavel', () => {
  it('liga o spawn UNKNOWN ao bloqueio, citando o binario', () => {
    const msg = mensagemDeErroDeSpawn(bloqueio, 'C:/comp/msys/bin/vvp.exe', 'win32');
    expect(msg).toContain('spawn UNKNOWN');
    expect(msg).toContain('(vvp.exe)');
    expect(msg).toContain('Smart App Control');
    expect(msg).toContain('Desbloquear');
  });

  it('explica tambem EACCES e EPERM, que sao as outras caras do bloqueio', () => {
    for (const code of ['EACCES', 'EPERM']) {
      const msg = mensagemDeErroDeSpawn({ message: `spawn ${code}`, code }, 'gtkwave.exe', 'win32');
      expect(msg).toContain('bloqueou');
    }
  });

  it('sem o binario informado, a frase sai sem parenteses vazios', () => {
    const msg = mensagemDeErroDeSpawn(bloqueio, undefined, 'win32');
    expect(msg).toContain('Smart App Control');
    expect(msg).not.toContain('()');
  });
});

describe('quando o erro e outro, a mensagem fica crua', () => {
  it('ENOENT continua ENOENT: binario ausente nao e bloqueio', () => {
    const msg = mensagemDeErroDeSpawn({ message: 'spawn ENOENT', code: 'ENOENT' }, 'vvp.exe', 'win32');
    expect(msg).toBe('spawn ENOENT');
  });

  it('fora do Windows nao ha Smart App Control para acusar', () => {
    const msg = mensagemDeErroDeSpawn(bloqueio, 'vvp', 'linux');
    expect(msg).toBe('spawn UNKNOWN');
  });

  it('erro sem forma (string, null) nao derruba o relator', () => {
    expect(mensagemDeErroDeSpawn('que isso', 'x.exe', 'win32')).toBe('que isso');
    expect(typeof mensagemDeErroDeSpawn(null, 'x.exe', 'win32')).toBe('string');
  });
});
