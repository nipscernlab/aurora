/**
 * A dica de arquivo vazio: js/editor/empty_placeholder.js.
 *
 * A regra pedida pelo Chrysthofer e simples de dizer e facil de errar na
 * implementacao: arquivo vazio mostra a dica, e a dica some assim que a pessoa
 * comeca a escrever, voltando se ela apagar tudo de novo. Vale para QUALQUER
 * arquivo, sem lista de convidados.
 *
 * A parte que merece teste e a FORMA da dica. Ela imita um comentario, entao o
 * marcador tem de ser o da linguagem: um `//` num arquivo Python ensinaria a
 * sintaxe errada de graca, para quem esta justamente aprendendo. Onde nao ha
 * comentario de linha vale o de bloco, e onde nao ha comentario nenhum (JSON)
 * a dica vai sem marcador, porque um JSON com `//` nao e JSON nem de mentira.
 *
 * O outro ponto delicado e o documento sem titulo, que comeca como texto puro
 * e vira C+- quando a pessoa digita o gatilho. A dica le a linguagem do MODELO
 * quando ela existe, e nao a extensao do nome provisorio, senao ficaria
 * dizendo "Empty file" num arquivo que ja e C+-.
 */

import { describe, it, expect } from 'vitest';
import { placeholderTextFor } from '../../js/editor/empty_placeholder.js';

describe('dica de arquivo vazio: o marcador e o da linguagem', () => {
  it('usa // nas linguagens da familia do C', () => {
    expect(placeholderTextFor('a.v')).toBe('// New Verilog file');
    expect(placeholderTextFor('a.sv')).toBe('// New SystemVerilog file');
    expect(placeholderTextFor('a.c')).toBe('// New C file');
    expect(placeholderTextFor('a.cpp')).toBe('// New C++ file');
    expect(placeholderTextFor('a.cmm')).toBe('// New C± file');
  });

  it('usa o marcador proprio de Python, Assembly e MATLAB', () => {
    expect(placeholderTextFor('a.py')).toBe('# New Python file');
    expect(placeholderTextFor('a.asm')).toBe('; New Assembly file');
    expect(placeholderTextFor('a.m')).toBe('% New MATLAB file');
  });

  it('fecha o comentario onde a linguagem exige', () => {
    expect(placeholderTextFor('a.css')).toBe('/* New CSS file */');
    expect(placeholderTextFor('a.md')).toBe('<!-- New Markdown file -->');
  });

  it('nao inventa comentario em JSON, que nao tem', () => {
    expect(placeholderTextFor('a.json')).toBe('New JSON file');
    // O .spf do projeto e JSON, e a mesma regra vale.
    expect(placeholderTextFor('proj.spf')).toBe('New JSON file');
  });
});

describe('dica de arquivo vazio: todo arquivo tem dica', () => {
  it('cobre extensao desconhecida e arquivo sem extensao', () => {
    expect(placeholderTextFor('leiame.txt')).toBe('Empty file');
    expect(placeholderTextFor('Makefile')).toBe('Empty file');
    expect(placeholderTextFor('')).toBe('Empty file');
  });

  it('nunca devolve vazio, senao o widget apareceria em branco', () => {
    for (const f of ['a.v', 'a.py', 'a.json', 'a.xyz', 'sem_ponto']) {
      expect(placeholderTextFor(f).length).toBeGreaterThan(0);
    }
  });

  it('ignora a caixa da extensao', () => {
    expect(placeholderTextFor('A.V')).toBe('// New Verilog file');
    expect(placeholderTextFor('A.Py')).toBe('# New Python file');
  });
});

describe('dica de arquivo vazio: documento sem titulo troca de linguagem', () => {
  it('a linguagem do modelo vence a extensao do nome provisorio', () => {
    // O sem-titulo nasce .v e vira C+- quando o gatilho e digitado; a dica
    // acompanha o modelo, que e quem sabe.
    expect(placeholderTextFor('untitled-1.v', 'cmm')).toBe('// New C± file');
    expect(placeholderTextFor('untitled-1.v', 'python')).toBe('# New Python file');
  });

  it('cai na extensao quando a linguagem nao foi informada', () => {
    expect(placeholderTextFor('untitled-1.v')).toBe('// New Verilog file');
  });

  it('aguenta linguagem que a tabela nao conhece', () => {
    expect(placeholderTextFor('a.v', 'linguagem-inventada')).toBe('Empty file');
  });
});
