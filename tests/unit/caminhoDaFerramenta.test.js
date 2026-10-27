// O caminho que cada ferramenta da cadeia recusa. Os conjuntos de caracteres
// vem de uma medicao com a toolchain real (27/10/2026, ver o cabecalho de
// caminho_da_ferramenta.ts): recusar de menos devolve o erro obscuro do
// Verilator, recusar demais tranca o aluno fora de uma pasta que funciona.
import { describe, it, expect } from 'vitest';
import {
    caracteresQueOVerilatorRecusa, caracteresForaDoAscii, caminhosDoSpec,
    recusaDoSpec, recusaDosCaminhos, explicarRecusa,
} from '../../js/compilation/caminho_da_ferramenta.js';

const build = (cwd, extra = {}) => ({
    step: 'verilator-build',
    cwd,
    args: ['C:\\comp\\verilator', '--binary', '+define+YANC_TRACE', '-Mdir', `${cwd}\\obj_dir`, '-y', 'C:\\comp\\SAPHO', 'p_tb.v'],
    ...extra,
});

describe('caracteresQueOVerilatorRecusa', () => {
    it('aceita o que passou na medicao: letras, digitos, _ - + = . e a unidade', () => {
        expect(caracteresQueOVerilatorRecusa('C:\\Users\\ana\\proj-fft_v2.1+x=y')).toEqual([]);
        expect(caracteresQueOVerilatorRecusa('/home/ana/proj')).toEqual([]);
    });

    it.each([
        ['espaco', 'C:\\Meus Projetos\\p', [' ']],
        ['e comercial', 'C:\\a&b\\p', ['&']],
        ['parenteses', 'C:\\p (copia)', [' ', '(', ')']],
        ['til do nome curto', 'C:\\Users\\RUNNER~1\\p', ['~']],
        ['acento', 'C:\\Área\\p', ['Á']],
        ['dois-pontos fora da unidade', 'C:\\a:b', [':']],
    ])('recusa %s', (_n, caminho, esperado) => {
        expect(caracteresQueOVerilatorRecusa(caminho)).toEqual(esperado);
    });

    it('nao repete o caractere', () => {
        expect(caracteresQueOVerilatorRecusa('C:\\a b c')).toEqual([' ']);
    });
});

describe('caracteresForaDoAscii', () => {
    it('so o que passa de 126', () => {
        expect(caracteresForaDoAscii('C:\\Meus Projetos & (x)')).toEqual([]);
        expect(caracteresForaDoAscii('C:\\Área de Trabalho\\ação')).toEqual(['Á', 'ç', 'ã']);
    });
});

describe('caminhosDoSpec', () => {
    it('o cwd, os argumentos que nomeiam arquivo e os caminhos do ambiente, sem o PATH', () => {
        const spec = {
            cwd: 'C:\\p',
            args: ['-Mdir', 'C:\\p\\obj', '+incdir+C:\\x', '-Wno-fatal', 'p.v', 'sub/q.v'],
            env: {
                PATH: 'C:\\Program Files\\x',
                AURORA_COCOTB_SOURCES_JSON: JSON.stringify(['C:\\p\\a.v', 'b.v']),
                AURORA_COCOTB_PYTHONPATH: 'C:\\p\\tb;C:\\p',
                AURORA_COCOTB_BUILD_ARGS_JSON: '[nao e json',
                SIM: 'icarus',
            },
        };
        expect(caminhosDoSpec(spec)).toEqual(['C:\\p', 'C:\\p\\obj', 'sub/q.v', 'C:\\p\\a.v', 'C:\\p\\tb', 'C:\\p']);
    });

    it('spec sem cwd, sem args e sem env nao tem caminho', () => {
        expect(caminhosDoSpec({})).toEqual([]);
        expect(caminhosDoSpec({ env: { N: 3 } })).toEqual([]);
    });
});

describe('recusaDoSpec', () => {
    it.each(['verilator-build', 'verilator-json', 'verilator-tb-build'])('%s com espaco no caminho e recusado', (step) => {
        expect(recusaDoSpec(build('C:\\Meus Projetos\\p', { step }))).toEqual({
            regra: 'verilator', ferramenta: 'Verilator', caminho: 'C:\\Meus Projetos\\p', caracteres: [' '],
        });
    });

    it('a instalacao com espaco tambem chega ao Verilator, pelo -y', () => {
        const spec = { step: 'verilator-build', cwd: 'C:\\p', args: ['-y', 'C:\\Users\\Ana Lima\\aurora\\SAPHO'] };
        expect(recusaDoSpec(spec).caminho).toBe('C:\\Users\\Ana Lima\\aurora\\SAPHO');
    });

    it('Verilator em pasta limpa roda, e o executavel gerado roda em qualquer pasta', () => {
        expect(recusaDoSpec(build('C:\\lab\\p'))).toBeNull();
        expect(recusaDoSpec({ step: 'verilator-run', cwd: 'C:\\Meus Projetos\\p', args: [] })).toBeNull();
    });

    it('yanc e Icarus aceitam qualquer caminho', () => {
        for (const step of ['cmm', 'asm', 'iverilog-build', 'vvp-run', 'fst2vcd']) {
            expect(recusaDoSpec({ step, cwd: 'C:\\Área & (x)\\p', args: [] }), step).toBeNull();
        }
    });

    it('cocotb no Verilator segue a regra do Verilator', () => {
        const r = recusaDoSpec({ step: 'cocotb-run', cwd: 'C:\\a b', args: [], env: { SIM: 'verilator', WAVES: '0' } });
        expect(r).toMatchObject({ regra: 'verilator', ferramenta: 'cocotb (Verilator)', caracteres: [' '] });
    });

    it('cocotb no Icarus com onda recusa so acento', () => {
        const env = { SIM: 'icarus', WAVES: '1' };
        expect(recusaDoSpec({ step: 'cocotb-run', cwd: 'C:\\a b & (c)', args: [], env })).toBeNull();
        expect(recusaDoSpec({ step: 'cocotb-run', cwd: 'C:\\Área', args: [], env }))
            .toMatchObject({ regra: 'acento', ferramenta: 'cocotb (Icarus)', caracteres: ['Á'] });
    });

    it('cocotb no Icarus sem onda nao grava o $dumpfile e aceita acento', () => {
        expect(recusaDoSpec({ step: 'cocotb-run', cwd: 'C:\\Área', args: [], env: { SIM: 'icarus', WAVES: '0' } })).toBeNull();
    });
});

describe('recusaDosCaminhos', () => {
    it('devolve o primeiro caminho recusado', () => {
        expect(recusaDosCaminhos(['C:/ok', 'C:/Área', 'C:/Ção'], 'acento', 'PRISM (Yosys)'))
            .toEqual({ regra: 'acento', ferramenta: 'PRISM (Yosys)', caminho: 'C:/Área', caracteres: ['Á'] });
        expect(recusaDosCaminhos(['C:/ok'], 'acento', 'PRISM (Yosys)')).toBeNull();
    });
});

describe('explicarRecusa', () => {
    const tr = (k, p) => (p ? `${k}|${p.tool}|${p.chars}|${p.path}` : k);

    it('o espaco vira palavra e cada regra tem a sua frase', () => {
        expect(explicarRecusa({ regra: 'verilator', ferramenta: 'Verilator', caminho: 'C:\\a b&c', caracteres: [' ', '&'] }, tr))
            .toBe('error.compilation.pathRefusedVerilator|Verilator|error.compilation.pathSpace &|C:\\a b&c');
        expect(explicarRecusa({ regra: 'acento', ferramenta: 'PRISM (Yosys)', caminho: 'C:/Á', caracteres: ['Á'] }, tr))
            .toBe('error.compilation.pathRefusedAccent|PRISM (Yosys)|Á|C:/Á');
    });
});
