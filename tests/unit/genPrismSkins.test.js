/**
 * scripts/gen-prism-skins: o gerador das skins de base do PRISM e do
 * inventario assets/prism-skins/COMPONENTS.md. Ele le cada modulo de
 * components/SAPHO/*.v, pula quem ja tem skin feita a mao (s:type ou s:alias
 * numa SVG sem a marca AUTO-GENERATED), escreve a skin de base dos outros e o
 * inventario. Com --check so relata.
 *
 * O script roda o main ao ser carregado; o fs vai espionado, com um HDL e uma
 * pasta de skins de mentira, e o que se prova e QUAIS pastas ele le, o que ele
 * grava e o que ele imprime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'gen-prism-skins.mts');
const SKINS = path.join(RAIZ, 'assets', 'prism-skins');
const HDL = path.join(RAIZ, 'components', 'SAPHO');
const temHdl = fs.existsSync(path.join(HDL, 'core.v'));

const AUTO_MARK = 'AUTO-GENERATED baseline skin (gen-prism-skins.js)';

/**
 * Roda o script como `node scripts/gen-prism-skins.mts ...args`: com o
 * process.argv[1] apontando para ele, o import passa pela guarda e roda o main.
 */
async function rodar(args) {
  const argv = process.argv;
  process.argv = [argv[0], SCRIPT, ...args];
  try {
    vi.resetModules();
    await import(pathToFileURL(SCRIPT).href);
  } finally {
    process.argv = argv;
  }
}

afterEach(() => vi.restoreAllMocks());

/**
 * Espiona o fs: as pastas em `pastas` ({dir: {arquivo: texto}}) passam a ter
 * so esses arquivos, e o que for gravado em SKINS fica em `gravados` em vez de
 * ir para o disco. `lidas` guarda as pastas listadas.
 */
function fsFalso(pastas, { gravarDeVerdade = false } = {}) {
  const readdir = fs.readdirSync.bind(fs);
  const read = fs.readFileSync.bind(fs);
  const lidas = [];
  const gravados = {};
  vi.spyOn(fs, 'readdirSync').mockImplementation((p, ...r) => {
    if (p in pastas) { lidas.push(p); return Object.keys(pastas[p]); }
    return readdir(p, ...r);
  });
  vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...r) => {
    const dir = typeof p === 'string' ? path.dirname(p) : null;
    if (dir in pastas && path.basename(p) in pastas[dir]) return pastas[dir][path.basename(p)];
    return read(p, ...r);
  });
  vi.spyOn(fs, 'writeFileSync').mockImplementation((p, dado) => {
    if (gravarDeVerdade || path.dirname(p) !== SKINS) throw new Error(`gravacao inesperada: ${p}`);
    gravados[path.basename(p)] = dado;
  });
  const log = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { log.push(a.join(' ')); });
  return { lidas, gravados, log };
}

const HDL_FALSO = {
  'a.v': [
    '/* module comentado ( input x ); */',
    'module novo',
    '#( parameter N = 8 )',
    '(',
    '  input clk, // relogio',
    '  input [N-1:0] d = 0,',
    '`ifdef YANC_SIM_VIS',
    '  output [N-1:0] sim,',
    '`elsif OUTRO',
    '  output lixo,',
    '`endif',
    '  output reg [N-1:0] q',
    ');',
    'endmodule',
    'module feito_a_mao (input a, output b);',
    'module por_alias (input a);',
    'module automatico (input a, output b, output c);',
    'module sem_portas;',
    'module auto_sem_portas;',
  ].join('\n'),
  'b.v': [
    '`ifdef X',
    '`ifndef Y',
    '`endif',
    '`endif',
    'module inout_so (inout io, input 9ruim);',
    'module p1 # ;',
    'module p2 (input a, output b',
  ].join('\n'),
  'leia.txt': 'module nao_entra (input x);',
};

const SKINS_FALSAS = {
  'feito_a_mao.svg': '<g s:type="feito_a_mao"><s:alias val="$outro_nome"/></g>',
  'alias.svg': '<g s:type="qualquer"><s:alias val="$por_alias"/></g>',
  'automatico.svg': `<!-- ${AUTO_MARK}. --><g s:type="automatico"><s:alias val="auto_sem_portas"/></g>`,
  'COMPONENTS.md': 's:type="nao_conta"',
};

const SKIN_TINY = `<?xml version="1.0" encoding="UTF-8"?>
<!-- AUTO-GENERATED baseline skin (gen-prism-skins.js).
     Module "novo" — 2 input(s), 1 output(s).
     Baseline scaffold: correct ports, neutral look. Redesign the body freely;
     KEEP the s:type / s:alias / s:pid names so PRISM keeps routing. -->
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:s="https://github.com/nturley/netlistsvg">

  <g s:type="novo" transform="translate(0, 0)" s:width="88" s:height="64">
    <s:alias val="novo"/>

    <rect width="88" height="64" rx="4" ry="4"
          class="$cell_id"
          style="fill: var(--prism-module-fill, rgba(95,224,176,0.14));
                 stroke: var(--prism-module-stroke, #5FE0B0);
                 stroke-width: 1.4;"/>

    <text x="44" y="36"
          class="nodelabel $cell_id" s:attribute=""
          style="text-anchor: middle; font-weight: 700; font-size: 11px;
                 fill: var(--prism-module-glyph, #e6e9f0);">novo</text>

    <text x="44" y="-4"
          class="nodelabel $cell_id" s:attribute="ref"
          style="text-anchor: middle; font-size: 8px; font-style: italic;
                 fill: var(--prism-module-accent, #5FE0B0); opacity: 0.8;">u</text>

    <text x="5" y="19" class="$cell_id" style="font-size:7px; fill: var(--prism-port-label, #8a93a6);">clk</text>
    <text x="5" y="37" class="$cell_id" style="font-size:7px; fill: var(--prism-port-label, #8a93a6);">d</text>
    <text x="83" y="19" class="$cell_id" style="text-anchor:end; font-size:7px; fill: var(--prism-port-label, #8a93a6);">q</text>

    <g s:x="0" s:y="16" s:pid="clk"/>
    <g s:x="0" s:y="34" s:pid="d"/>
    <g s:x="88" s:y="16" s:pid="q"/>
  </g>

</svg>
`;

describe('gen-prism-skins', () => {
  it('--check le components/SAPHO e as skins, relata e nao grava nada', async () => {
    const { lidas, gravados, log } = fsFalso({ [HDL]: HDL_FALSO, [SKINS]: SKINS_FALSAS });
    await rodar(['--check']);
    expect(lidas).toEqual([SKINS, HDL]);
    expect(gravados).toEqual({});
    expect(log).toEqual([
      '[gen-prism-skins] HDL modules: 9',
      '  baseline skins to write: 3',
      '  skipped (hand-crafted / portless): 6',
      '    - auto_sem_portas  (no ports parsed)',
      '    - feito_a_mao  (hand-crafted (feito_a_mao.svg))',
      '    - p1  (no ports parsed)',
      '    - p2  (no ports parsed)',
      '    - por_alias  (hand-crafted (alias.svg))',
      '    - sem_portas  (no ports parsed)',
    ]);
  });

  it('sem --check grava a skin de base de quem nao tem skin feita a mao, e o inventario', async () => {
    const { gravados, log } = fsFalso({ [HDL]: HDL_FALSO, [SKINS]: SKINS_FALSAS });
    await rodar([]);
    expect(Object.keys(gravados).sort()).toEqual(['COMPONENTS.md', 'automatico.svg', 'inout_so.svg', 'novo.svg']);
    expect(gravados['novo.svg']).toBe(SKIN_TINY);
    expect(gravados['inout_so.svg']).toContain('Module "inout_so" — 1 input(s), 0 output(s).');
    expect(gravados['inout_so.svg']).toContain('s:width="88" s:height="46"');
    expect(gravados['automatico.svg']).toContain('<g s:x="88" s:y="34" s:pid="c"/>');
    expect(log[1]).toBe('  baseline skins written: 3');

    const md = gravados['COMPONENTS.md'];
    expect(md).toContain('> Auto-generated by `scripts/gen-prism-skins.mts`. Lists every component PRISM\n'
      + '> can give a custom skin. Re-run `node scripts/gen-prism-skins.mts` after the\n> HDL changes.\n');
    expect(md).toContain([
      '| module | source | ports | skin | port list (→in ←out) |',
      '| ------ | ------ | ----: | ---- | -------------------- |',
      '| `auto_sem_portas` | `a.v` | 0 | baseline | — |',
      '| `automatico` | `a.v` | 3 | baseline | →a ←b ←c |',
      '| `feito_a_mao` | `a.v` | 2 | hand-crafted (`feito_a_mao.svg`) | →a ←b |',
      '| `inout_so` | `b.v` | 1 | baseline | →io |',
      '| `novo` | `a.v` | 3 | baseline | →clk →d ←q |',
      '| `p1` | `b.v` | 0 | none | — |',
      '| `p2` | `b.v` | 0 | none | — |',
      '| `por_alias` | `a.v` | 1 | hand-crafted (`alias.svg`) | →a |',
      '| `sem_portas` | `a.v` | 0 | none | — |',
      '',
    ].join('\n'));
    expect(md).toContain('\n```\n_AOI3_, _AOI4_, _OAI3_, _OAI4_, add, and, andnot, buf, constant, dff,');
    expect(md.endsWith('are netlistsvg-internal, leave them.)_\n')).toBe(true);
  });
});

describe.skipIf(!temHdl)('gen-prism-skins contra o HDL de verdade', () => {
  it('o inventario gerado e o COMPONENTS.md versionado', async () => {
    const readdir = fs.readdirSync.bind(fs);
    const gravados = {};
    vi.spyOn(fs, 'readdirSync').mockImplementation((p, ...r) => readdir(p, ...r));
    vi.spyOn(fs, 'writeFileSync').mockImplementation((p, dado) => { gravados[path.relative(RAIZ, p)] = dado; });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await rodar([]);
    const md = path.join('assets', 'prism-skins', 'COMPONENTS.md');
    expect(Object.keys(gravados)).toEqual([md]);
    expect(gravados[md]).toBe(fs.readFileSync(path.join(RAIZ, md), 'utf8').replace(/\r\n/g, '\n'));
  });
});
