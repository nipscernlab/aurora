// O layout do Surfer sob encomenda (js/wave/surfer_custom.ts), o irmao do
// gtkw_custom. A IA escrevia um .sucl, que nao monta grupo nem cor por sinal e
// erra o sinal em silencio; o app ja gerava .surf.ron no layout automatico e
// no PRISM. Agora o pedido explicito sai no mesmo formato (#185).

import { describe, expect, it } from 'vitest';

import { buildCustomSurfer, RADIX_SURFER, CORES_SURFER } from '../../js/wave/surfer_custom.ts';

/** O trecho de uma variavel no RON, achado pelo nome. */
function variavel(ron, nome) {
    const i = ron.indexOf(`name: "${nome}",`);
    expect(i).toBeGreaterThan(-1);
    // A variavel fecha numa linha so com `)),`; o `Wellen((1)),` de dentro nao.
    return ron.slice(ron.lastIndexOf('Variable((', i), ron.indexOf('\n            )),', i));
}

describe('buildCustomSurfer', () => {
    it('caminho em texto vira variavel com o escopo partido e o formato padrao do Surfer', () => {
        const { conteudo, sinais, ignorados } = buildCustomSurfer({ signals: ['tb.dut.acc', 'tb.clk'] });
        expect(sinais).toBe(2);
        expect(ignorados).toEqual([]);
        const acc = variavel(conteudo, 'acc');
        expect(acc).toMatch(/strs: \[\s*"tb",\s*"dut",\s*\]/);
        expect(acc).toContain('format: None');
        expect(conteudo.indexOf('name: "acc"')).toBeLessThan(conteudo.indexOf('name: "clk"'));
    });

    it('o range do barramento sai do nome, porque o Surfer acha o sinal pelo nome cru', () => {
        const { conteudo } = buildCustomSurfer({ signals: ['tb.dut.out[15:0]'] });
        expect(variavel(conteudo, 'out')).toBeTruthy();
    });

    it('objeto escolhe base, cor e rotulo', () => {
        const { conteudo } = buildCustomSurfer({
            signals: [{ path: 'tb.dut.acc', radix: 'signed', color: 'Red', alias: 'ACC' }],
        });
        const acc = variavel(conteudo, 'acc');
        expect(acc).toContain('format: Some("Signed")');
        expect(acc).toContain('color: Some("Red")');
        expect(acc).toContain('manual_name: Some("ACC")');
    });

    it('cada base pedida vira o tradutor do Surfer; base ou cor desconhecida fica no padrao', () => {
        expect(RADIX_SURFER).toEqual(['bin', 'dec', 'signed', 'hex', 'oct']);
        const { conteudo } = buildCustomSurfer({
            signals: RADIX_SURFER.map((r) => ({ path: `tb.${r}`, radix: r }))
                .concat([{ path: 'tb.x', radix: 'real', color: 'Roxo' }]),
        });
        expect(variavel(conteudo, 'bin')).toContain('Some("Binary")');
        expect(variavel(conteudo, 'dec')).toContain('Some("Unsigned")');
        expect(variavel(conteudo, 'hex')).toContain('Some("Hexadecimal")');
        expect(variavel(conteudo, 'oct')).toContain('Some("Octal")');
        expect(variavel(conteudo, 'x')).toContain('format: None');
        expect(variavel(conteudo, 'x')).toContain('color: None');
        expect(CORES_SURFER).toContain('Green');
    });

    it('sinais vizinhos com o mesmo grupo viram um grupo aberto do Surfer', () => {
        const { conteudo } = buildCustomSurfer({
            signals: [
                { path: 'tb.a', group: 'Entradas' },
                { path: 'tb.b', group: 'Entradas' },
                'tb.c',
            ],
        });
        expect(conteudo.match(/Group\(\(/g)).toHaveLength(1);
        expect(conteudo).toContain('name: "Entradas"');
        expect(conteudo).toContain('is_open: true');
        // Na arvore, os dois filhos um nivel abaixo do grupo, e o solto no topo.
        const niveis = [...conteudo.matchAll(/level: (\d+)/g)].map((m) => Number(m[1]));
        expect(niveis).toEqual([0, 1, 1, 0]);
    });

    it('o que nao da para achar no dump fica de fora e volta em ignorados', () => {
        const { sinais, ignorados } = buildCustomSurfer({
            signals: ['tb.ok', 'clk', '', null, { path: ' ' }, { radix: 'hex' }],
        });
        expect(sinais).toBe(1);
        expect(ignorados).toEqual(['clk', '', 'null', '{"path":" "}', '{"radix":"hex"}']);
    });

    it('nada aproveitavel: conteudo vazio', () => {
        expect(buildCustomSurfer({ signals: ['clk'] })).toEqual({ conteudo: '', sinais: 0, ignorados: ['clk'] });
        expect(buildCustomSurfer()).toEqual({ conteudo: '', sinais: 0, ignorados: [] });
    });
});
