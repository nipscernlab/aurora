/**
 * Testes do guarda de escrita (main/ipc/fs_guard.js).
 *
 * Por que ele importa: os handlers de arquivo aceitavam caminho absoluto
 * arbitrario vindo do renderer, e as ferramentas delete_file e afins da IA
 * chegam la. A regra de prefixo daqui e o que separa "apagar dentro do
 * projeto" de "apagar a pasta do usuario". Os testes rodam a regra nas duas
 * plataformas passando `plataforma` explicito, porque o CI e o LABEL sao
 * Windows mas o guarda nao pode depender disso.
 */

import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { dentroDe, escritaPermitida } from '../../main/ipc/fs_guard.js';

const win = 'win32';
const S = path.sep;
const j = (...p) => p.join(S);

describe('dentroDe', () => {
  const raiz = j('C:', 'Users', 'x', 'proj');

  it('a propria raiz e o que mora dentro passam', () => {
    expect(dentroDe(raiz, raiz, win)).toBe(true);
    expect(dentroDe(raiz, j(raiz, 'a.v'), win)).toBe(true);
    expect(dentroDe(raiz, j(raiz, 'sub', 'fundo', 'a.v'), win)).toBe(true);
  });

  it('vizinho que e so prefixo textual NAO passa', () => {
    expect(dentroDe(raiz, j('C:', 'Users', 'x', 'proj2', 'a.v'), win)).toBe(false);
    expect(dentroDe(raiz, j('C:', 'Users', 'x', 'projeto.v'), win)).toBe(false);
  });

  it('caminho de fora NAO passa', () => {
    expect(dentroDe(raiz, j('C:', 'Windows', 'system32'), win)).toBe(false);
    expect(dentroDe(raiz, j('D:', 'outra'), win)).toBe(false);
  });

  it('`..` resolvido antes da comparacao nao escapa', () => {
    expect(dentroDe(raiz, j(raiz, '..', '..', 'x', 'segredo'), win)).toBe(false);
    expect(dentroDe(raiz, j(raiz, 'sub', '..', 'a.v'), win)).toBe(true);
  });

  it('Windows compara sem diferenciar caixa', () => {
    expect(dentroDe(raiz, j('c:', 'users', 'X', 'PROJ', 'a.v'), win)).toBe(true);
  });

  it('raiz de unidade funciona como raiz (o caso que quebrava o preview)', () => {
    expect(dentroDe('C:' + S, j('C:', 'qualquer.html'), win)).toBe(true);
    expect(dentroDe('C:' + S, 'C:' + S, win)).toBe(true);
  });
});

describe('escritaPermitida', () => {
  const projeto = j('C:', 'lab', 'meuproj');
  const temp = j('C:', 'sapho', 'components', 'Temp');

  const ctx = {
    raizes: [projeto, temp, null, undefined],
    arquivos: new Set([j('C:', 'Users', 'x', 'Desktop', 'solto.v')]),
    raizesConcedidas: new Set([j('D:', 'novo-projeto')]),
  };

  it('dentro do projeto e do Temp passa', () => {
    expect(escritaPermitida(j(projeto, 'p1', 'p1.cmm'), ctx, win)).toBe(true);
    expect(escritaPermitida(j(temp, 'instr_tb.v'), ctx, win)).toBe(true);
  });

  it('arquivo avulso concedido passa, o vizinho dele nao', () => {
    expect(escritaPermitida(j('C:', 'Users', 'x', 'Desktop', 'solto.v'), ctx, win)).toBe(true);
    expect(escritaPermitida(j('C:', 'Users', 'x', 'Desktop', 'outro.v'), ctx, win)).toBe(false);
  });

  it('raiz concedida libera a subarvore', () => {
    expect(escritaPermitida(j('D:', 'novo-projeto', 'a', 'b.v'), ctx, win)).toBe(true);
  });

  it('fora de tudo e recusado, inclusive o perfil do usuario', () => {
    expect(escritaPermitida(j('C:', 'Users', 'x', '.ssh', 'id_rsa'), ctx, win)).toBe(false);
    expect(escritaPermitida(j('C:', 'Windows', 'a.dll'), ctx, win)).toBe(false);
  });

  it('contexto vazio recusa tudo', () => {
    expect(escritaPermitida(j(projeto, 'a.v'), {}, win)).toBe(false);
  });

  it('a concessao de arquivo casa sem diferenciar caixa no Windows', () => {
    expect(escritaPermitida(j('c:', 'users', 'X', 'desktop', 'SOLTO.V'), ctx, win)).toBe(true);
  });
});
