import { describe, it, expect } from 'vitest';
import {
    isComplexName, hasComplexSignals, ComplexVcdScanner, buildComplexMapping,
} from '../../js/wave/complex_decode.js';
import { buildSurferLayout } from '../../js/wave/surfer_layout_writer.js';

// Valores reais validados contra o comp2gtkw.exe (nbm=4, nbe=3 → 32 bits):
//   A = 12.000 -1.000i   B = 1.000 0.000i
const A = '00000100000000110010001110000001';
const B = '00000100000000110000000100000000';

function scope(path, signals) {
    return { name: path.split('.').pop(), path, signals: signals.map((s) => ({ name: s.name, range: s.range ?? null })) };
}

describe('complex_decode — deteccao', () => {
    it('isComplexName cobre scalar e array', () => {
        expect(isComplexName('comp_me3_f_global_v_z_e_')).toBe(true);
        expect(isComplexName('comp_arr_me3_f_fft_v_x_e_0000')).toBe(true);
        expect(isComplexName('me2_f_global_v_acc_e_')).toBe(false);
        expect(isComplexName('valr2')).toBe(false);
    });
    it('hasComplexSignals varre os scopes', () => {
        expect(hasComplexSignals([scope('tb.p', [{ name: 'comp_me3_f_global_v_z_e_' }])])).toBe(true);
        expect(hasComplexSignals([scope('tb', [{ name: 'clk' }, { name: 'valr2' }])])).toBe(false);
    });
});

describe('ComplexVcdScanner — extracao de valores distintos', () => {
    const vcd = [
        '$scope module tb $end',
        '$scope module proc $end',
        '$var logic 32 ! comp_me3_f_global_v_z_e_ [31:0] $end',
        '$var wire 1 " clk $end',
        '$upscope $end', '$upscope $end',
        '$enddefinitions $end',
        '#0',
        `b${A} !`,
        '0"',
        '#5', '1"',
        '#10',
        `b${B} !`,
        `b${A} !`,          // duplicado → dedup
        '',
    ].join('\n');

    it('coleta os valores distintos do sinal complexo (ignora clk/tempo)', () => {
        const sc = new ComplexVcdScanner();
        sc.feed(vcd); sc.end();
        const vals = sc.distinctValues().sort();
        expect(vals).toEqual([B, A].sort());
    });

    it('zero-extend de valores com zeros a esquerda truncados pelo VCD', () => {
        const stripped = B.replace(/^0+/, ''); // VCD pode omitir zeros a' esquerda
        const sc = new ComplexVcdScanner();
        sc.feed([
            '$var logic 32 ! comp_me3_f_global_v_z_e_ [31:0] $end',
            '$enddefinitions $end',
            `b${stripped} !`, '',
        ].join('\n'));
        sc.end();
        expect(sc.distinctValues()).toEqual([B]); // restaurado pra 32 bits
    });

    it('feed em chunks arbitrarios (split no meio de linha) funciona', () => {
        const sc = new ComplexVcdScanner();
        const full = [
            '$var logic 32 ! comp_me3_f_global_v_z_e_ [31:0] $end',
            '$enddefinitions $end', `b${A} !`, '',
        ].join('\n');
        for (let i = 0; i < full.length; i += 7) sc.feed(full.slice(i, i + 7));
        sc.end();
        expect(sc.distinctValues()).toEqual([A]);
    });
});

describe('buildComplexMapping', () => {
    it('monta o mapping (Name, sem Bits) com 0b<bits> <re imi>', () => {
        const m = buildComplexMapping('aurora_cpx_tb', new Map([[A, '12.000 -1.000i'], [B, '1.000 0.000i']]));
        expect(m.name).toBe('aurora_cpx_tb');
        expect(m.content).toContain('Name = aurora_cpx_tb');
        expect(m.content).not.toContain('Bits ='); // largura varia → sem Bits
        expect(m.content).toContain(`0b${A} 12.000 -1.000i`);
        expect(m.content).toContain(`0b${B} 1.000 0.000i`);
    });
    it('sem entradas decodadas → null (nao cria mapping vazio)', () => {
        expect(buildComplexMapping('x', new Map())).toBeNull();
        expect(buildComplexMapping('x', new Map([[A, '']]))).toBeNull();
    });
});

describe('buildSurferLayout — wiring do mapping complexo', () => {
    const scopes = [
        scope('tb', [{ name: 'clk' }]),
        scope('tb.proc', [
            { name: 'valr2', range: '31:0' },
            { name: 'linetabs', range: '19:0' }, // valr2+linetabs → detecta o processador
            { name: 'comp_me3_f_global_v_z_e_', range: '31:0' },
        ]),
    ];
    it('sem complexMapping: comp_me3 fica Binary, mappings sem cpx', () => {
        const { content, mappings } = buildSurferLayout({ vcdPath: 'x', scopes, tbModule: 'tb' });
        expect(content).toContain('manual_name: Some("comp z in global")');
        expect(content).toContain('format: Some("Binary")');
        expect(mappings.some((m) => m.name.startsWith('aurora_cpx'))).toBe(false);
    });
    it('com complexMapping: format aponta pro cpx e o mapping e retornado', () => {
        const complexMapping = { name: 'aurora_cpx_tb', content: 'Name = aurora_cpx_tb\n0b' + A + ' 12.000 -1.000i\n' };
        const { content, mappings } = buildSurferLayout({ vcdPath: 'x', scopes, tbModule: 'tb', complexMapping });
        expect(content).toContain('format: Some("aurora_cpx_tb")');
        expect(mappings.some((m) => m.name === 'aurora_cpx_tb')).toBe(true);
    });
});
