import { describe, it, expect } from 'vitest';
import {
  parseYosysIdentifier,
  extractFileInfoFromSource,
  parseYosysHierarchy,
} from '../../js/compilation/hierarchy_parser.js';

describe('parseYosysIdentifier', () => {
  it('passes a plain module name through unchanged', () => {
    expect(parseYosysIdentifier('mymodule')).toEqual({ cleanName: 'mymodule', filePath: null });
  });

  it('unwraps a $paramod name to the real module', () => {
    expect(parseYosysIdentifier('$paramod\\myfifo\\WIDTH=8').cleanName).toBe('myfifo');
  });

  it('strips a trailing 32+ hex Yosys hash', () => {
    expect(parseYosysIdentifier('foo$0123456789abcdef0123456789abcdef').cleanName).toBe('foo');
  });

  it('extracts an embedded windows source path', () => {
    const r = parseYosysIdentifier('top$childC:\\proj\\child.v');
    expect(r.filePath).toBe('C:\\proj\\child.v');
  });

  it('falls back to a non-empty name when cleaning empties it', () => {
    expect(parseYosysIdentifier('$$$').cleanName.length).toBeGreaterThan(0);
  });
});

describe('extractFileInfoFromSource', () => {
  it('parses a path.v:line.col-line.col src attribute', () => {
    expect(extractFileInfoFromSource('C:/proj/top.v:42.5-42.10')).toEqual({
      filePath: 'C:/proj/top.v',
      lineNumber: 42,
    });
  });

  it('parses a path.v:line.col (no range) src attribute', () => {
    expect(extractFileInfoFromSource('top.v:7.1')).toEqual({ filePath: 'top.v', lineNumber: 7 });
  });

  it('returns null for non-matching / empty input', () => {
    expect(extractFileInfoFromSource('not a src')).toBeNull();
    expect(extractFileInfoFromSource('')).toBeNull();
    expect(extractFileInfoFromSource(null)).toBeNull();
  });
});

describe('parseYosysHierarchy', () => {
  const json = {
    modules: {
      top: {
        attributes: { src: 'top.v:1.1-10.5' },
        cells: {
          inst_a: { type: 'child' },
          g1: { type: '$and' }, // primitive → filtered out
        },
      },
      child: {
        attributes: { src: 'child.v:3.1-5.2' },
        cells: {},
      },
    },
  };

  it('builds the user-module tree, filtering Yosys primitives', () => {
    const tree = parseYosysHierarchy(json, 'top');
    expect(tree.name).toBe('top');
    expect(tree.filePath).toBe('top.v');
    expect(tree.lineNumber).toBe(1);
    expect(tree.children).toHaveLength(1); // $and primitive excluded
    expect(tree.children[0].instanceName).toBe('inst_a');
    expect(tree.children[0].type).toBe('instance');
    expect(tree.children[0].moduleDefinition.name).toBe('child');
    expect(tree.children[0].moduleDefinition.lineNumber).toBe(3);
  });

  it('returns an empty top node when the top module is absent', () => {
    const tree = parseYosysHierarchy({ modules: {} }, 'missing');
    expect(tree).toEqual({ name: 'missing', filePath: null, lineNumber: null, children: [] });
  });

  it('is tolerant of missing/empty input', () => {
    expect(parseYosysHierarchy({}, 'x').children).toEqual([]);
  });

  // Modulo sem `src` e o que o Yosys cria sozinho (blackbox, caixa gerada):
  // com celulas ele ainda e do projeto e entra; sem celulas e tratado como
  // primitivo e some. O mesmo modulo instanciado duas vezes aponta para o MESMO
  // no, pelo memo, em vez de ser montado de novo.
  it('sem src: entra se tem celulas, some se nao tem, e o no e compartilhado', () => {
    const tree = parseYosysHierarchy({
      modules: {
        top: {
          attributes: { src: 'top.v:1.1-9.9' },
          cells: {
            u1: { type: 'gerado' },
            u2: { type: 'gerado' },
            u3: { type: 'caixa_vazia' },
          },
        },
        gerado: { cells: { f: { type: 'folha' } } },
        caixa_vazia: { attributes: {}, cells: {} },
        folha: { attributes: { src: 'sem_linha' }, cells: {} },
      },
    }, 'top');
    expect(tree.children.map((c) => c.instanceName)).toEqual(['u1', 'u2']);
    const [a, b] = tree.children;
    expect(a.moduleDefinition).toBe(b.moduleDefinition);
    expect(a.moduleDefinition).toMatchObject({ name: 'gerado', filePath: null, lineNumber: null });
    // `src` que nao casa o formato path.v:linha.coluna deixa o no sem arquivo.
    expect(a.moduleDefinition.children[0].moduleDefinition)
      .toMatchObject({ name: 'folha', filePath: null, lineNumber: null });
  });
});
