/**
 * scripts/prism-skin-standard: o padrao dos simbolos do PRISM. Ele le cada
 * modulo de components/HDL/*.v e desenha a skin de cada um em
 * assets/prism-skins/<modulo>.svg.
 *
 * A caracterizacao mais forte e a das skins versionadas: cada uma foi gerada
 * pelo script a partir do HDL de verdade, e a lista de ancoras (s:pid) de cada
 * SVG e a lista de portas que ele leu, na ordem em que ele as desenhou. Refazer
 * as portas a partir das ancoras e renderizar de novo tem de devolver o arquivo
 * byte a byte, sem precisar do HDL, que nao existe no CI.
 *
 * A leitura do HDL vai por fs espionado: o que se prova e QUAL pasta ele le e
 * como ele tira as portas do texto Verilog.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { renderModule, classify, allModules } = require('../../scripts/prism-skin-standard.js');

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'prism-skin-standard.js');
const SKINS = path.join(RAIZ, 'assets', 'prism-skins');
const HDL = path.join(RAIZ, 'components', 'HDL');
const temHdl = fs.existsSync(path.join(HDL, 'core.v'));

const lf = (s) => s.replace(/\r\n/g, '\n');

afterEach(() => vi.restoreAllMocks());

/** Espiona o fs para que a pasta `dir` contenha exatamente `arquivos`. */
function hdlFalso(dir, arquivos) {
  const readdir = fs.readdirSync.bind(fs);
  const read = fs.readFileSync.bind(fs);
  const lidas = [];
  vi.spyOn(fs, 'readdirSync').mockImplementation((p, ...r) => {
    if (p === dir) { lidas.push(p); return Object.keys(arquivos); }
    return readdir(p, ...r);
  });
  vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...r) => {
    const nome = typeof p === 'string' && path.dirname(p) === dir ? path.basename(p) : null;
    if (nome && nome in arquivos) return arquivos[nome];
    return read(p, ...r);
  });
  return lidas;
}

describe('allModules', () => {
  it('le components/HDL, so os .v, e tira as portas de cada modulo', () => {
    const lidas = hdlFalso(HDL, {
      'a.v': [
        '// module comentado (ignorado)',
        '/* module outro_comentado ( input x ); */',
        'module pc',
        '#(',
        '  parameter NBITS = 8',
        ')(',
        '   input                 clk , rst,',
        '   input     [NBITS-1:0] data,',
        '  output reg [NBITS-1:0] addr = 0',
        '`ifdef YANC_SIM_VIS',
        '  , output [NBITS-1:0] sim',
        '`else',
        '  , output nada',
        '`endif',
        ');',
        'endmodule',
        'module sem_portas;',
        'endmodule',
      ].join('\n'),
      'b.v': 'module b (inout wire [3:0] io, input signed [7:0] s);\nendmodule\n',
      'leia.txt': 'module nao_entra (input x);',
    });
    const mods = allModules();
    expect(lidas).toEqual([HDL]);
    expect(mods).toEqual([
      {
        name: 'pc',
        file: 'a.v',
        ports: [
          { name: 'clk', dir: 'input', bus: false },
          { name: 'rst', dir: 'input', bus: false },
          { name: 'data', dir: 'input', bus: true },
          { name: 'addr', dir: 'output', bus: true },
        ],
      },
      { name: 'sem_portas', file: 'a.v', ports: [] },
      {
        name: 'b',
        file: 'b.v',
        ports: [
          { name: 'io', dir: 'inout', bus: true },
          { name: 's', dir: 'input', bus: true },
        ],
      },
    ]);
  });

  it('bloco de parametro sem parentese, parentese sem fechar e ifdef aninhado', () => {
    hdlFalso(HDL, {
      'c.v': [
        'module p1 # ;',
        'module p2 (input a, output b',
        '',
      ].join('\n'),
      'd.v': [
        'module p3 (',
        '  input a,',
        '`ifdef X',
        '`ifndef Y',
        '  input b,',
        '`endif',
        '`elsif Z',
        '  input c,',
        '`endif',
        '`endif',
        '  output [1:0] q, r,',
        '  input 9bad',
        ');',
      ].join('\n'),
    });
    expect(allModules()).toEqual([
      { name: 'p1', file: 'c.v', ports: [] },
      { name: 'p2', file: 'c.v', ports: [] },
      {
        name: 'p3',
        file: 'd.v',
        ports: [
          { name: 'a', dir: 'input', bus: false },
          { name: 'q', dir: 'output', bus: true },
          { name: 'r', dir: 'output', bus: false },
        ],
      },
    ]);
  });
});

describe('classify', () => {
  it('cada modulo recebe a forma da sua funcao', () => {
    expect(classify('ula_mux')).toEqual({ cls: 'selector', shape: 'selector', wm: null });
    expect(classify('norm_mux')).toEqual({ cls: 'selector', shape: 'selector', wm: null });
    expect(classify('processor')).toEqual({ cls: 'processor', shape: 'chip', wm: 'sapho' });
    expect(classify('core')).toEqual({ cls: 'core', shape: 'chip', wm: null });
    expect(classify('myFIFO')).toEqual({ cls: 'fifo', shape: 'fifo', wm: null });
    expect(classify('mem_data')).toEqual({ cls: 'memory', shape: 'memory', wm: null });
    expect(classify('mem_instr')).toEqual({ cls: 'memory', shape: 'memory', wm: null });
    expect(classify('instr_dec')).toEqual({ cls: 'decoder', shape: 'decoder', wm: null });
    expect(classify('pc')).toEqual({ cls: 'register', shape: 'register', wm: null });
    expect(classify('stack')).toEqual({ cls: 'register', shape: 'register', wm: null });
    expect(classify('ula')).toEqual({ cls: 'alu', shape: 'alu', wm: null });
    expect(classify('ula_add')).toEqual({ cls: 'arithmetic', shape: 'alu', wm: null });
    expect(classify('io_ctrl')).toEqual({ cls: 'control', shape: 'chip', wm: null });
  });
});

/**
 * As portas que o script leu, refeitas das ancoras da skin gerada: a ordem das
 * ancoras e a ordem em que ele desenhou; a ancora na borda leste (s:x igual a
 * s:width) e saida, o resto e entrada. `bus` so pesa no seletor, onde o nome
 * do select ganha `[…]`.
 */
function portasDaSkin(svg) {
  const nome = svg.match(/s:type="([^"]+)"/)[1];
  const largura = svg.match(/s:width="([^"]+)"/)[1];
  const ports = [...svg.matchAll(/<g s:x="([^"]+)" s:y="[^"]+" s:pid="([^"]+)"\/>/g)].map(([, x, n]) => ({
    name: n,
    dir: x === largura ? 'output' : 'input',
    bus: svg.includes(`>${n}[…]</text>`),
  }));
  return { name: nome, ports };
}

// So as que o script gerou: as primitivas desenhadas a mao (constant,
// inputExt...) tambem abrem com "PRISM symbol:", mas nao sao dele.
const geradas = fs.readdirSync(SKINS)
  .filter((f) => f.endsWith('.svg'))
  .filter((f) => /generated by scripts\/prism-skin-standard\./.test(fs.readFileSync(path.join(SKINS, f), 'utf8')));

describe('renderModule reproduz as skins versionadas', () => {
  it('ha skins do padrao de todas as formas', () => {
    const formas = new Set(geradas.map((f) => classify(f.replace(/\.svg$/, '')).shape));
    expect([...formas].sort()).toEqual(['alu', 'chip', 'decoder', 'fifo', 'memory', 'register', 'selector']);
  });

  it.each(geradas)('%s', (f) => {
    const svg = lf(fs.readFileSync(path.join(SKINS, f), 'utf8'));
    expect(renderModule(portasDaSkin(svg))).toBe(svg);
  });
});

describe('renderModule, casos que as skins versionadas nao tem', () => {
  it('ALU com um operando so nao tem entalhe', () => {
    const svg = renderModule({ name: 'ula_x', ports: [{ name: 'a', dir: 'input' }, { name: 'y', dir: 'output' }] });
    expect(svg).toContain('<path d="M 0,18 L 129,18 L 150,27 L 150,79 L 129,88 L 0,88 Z"');
  });

  it('seletor sem select nem saida so tem as entradas', () => {
    const svg = renderModule({ name: 'norm_mux', ports: [{ name: 'a', dir: 'input' }] });
    expect(svg).toContain('s:pid="a"');
    expect(svg).not.toContain('s:pid="op"');
    expect(svg).toContain('1 → 1 selector');
  });

  it('modulo sem portas vira um chip de uma linha', () => {
    const svg = renderModule({ name: 'vazio', ports: [] });
    expect(svg).toContain('s:width="150" s:height="87"');
    expect(svg).toContain('control · 0in 0out');
  });
});

describe.skipIf(!temHdl)('linha de comando, contra o HDL de verdade', () => {
  const rodar = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { cwd: RAIZ, encoding: 'utf8' });

  it('--print pc despeja a skin versionada', () => {
    expect(rodar('--print', 'pc')).toBe(lf(fs.readFileSync(path.join(SKINS, 'pc.svg'), 'utf8')));
  });

  it('--print de modulo que nao existe avisa', () => {
    expect(rodar('--print', 'nao_existe')).toBe('// no module nao_existe\n');
  });
});
