import { describe, it, expect } from 'vitest';
import { montarLayoutDaOndaDoPrism } from '../../js/wave/prism_wave_layout.js';

// O .vcd do monitor do PRISM abria vazio no visualizador: a lista de sinais a
// esquerda e nenhuma onda na tela. O layout que sai daqui e o que poe cada
// sinal no lugar, na base do monitor, agrupado por papel. Os nomes tem de ser
// EXATAMENTE os do .vcd (main/ipc/prism_vcd.js), senao o visualizador nao os
// reencontra e a onda volta a abrir vazia, sem erro nenhum.

const SINAIS = [
    { nome: 'clk', caminho: [], bits: 1, base: 'bin', papel: 'clock' },
    { nome: 'enable', caminho: [], bits: 1, base: 'bin', papel: 'input' },
    { nome: 'valor', caminho: [], bits: 8, base: 'dec', papel: 'input' },
    { nome: 'conta', caminho: [], bits: 8, base: 'hex', papel: 'output' },
    { nome: 'y', caminho: ['u_inc'], bits: 8, base: 'bin', papel: 'internal' },
];

describe('montarLayoutDaOndaDoPrism', () => {
    it('agrupa por papel, na ordem relogio, entradas, saidas, internos, com divisor por grupo', () => {
        const { surfer, gtkw, quantidade } = montarLayoutDaOndaDoPrism({ modulo: 'contador', vcdPath: 'C:/t/contador.sim.vcd', sinais: SINAIS });
        expect(quantidade).toBe(5);
        // A ordem dos itens no estado do Surfer e a ordem de leitura.
        // So o campo `name` de cada item: o `display_name` repete o nome e o
        // `manual_name` e None, entao a ancora no comeco da linha e o que separa.
        const ordem = [...surfer.matchAll(/^\s+name: (?:Some\("([^"]+)"\)|"([^"]+)")/gm)].map((m) => m[1] || m[2]);
        expect(ordem).toEqual(['Clock', 'clk', 'Inputs', 'enable', 'valor', 'Outputs', 'conta', 'Internal', 'y']);
        // No .gtkw os grupos abrem EXPANDIDOS (@800200, sem o TR_CLOSED): com
        // eles recolhidos a onda abria mostrando so os rotulos, e parecia que
        // a exportacao tinha falhado.
        expect(gtkw).toContain('@800200');
        expect(gtkw).not.toContain('@c00200');
        expect(gtkw).toContain('-Clock');
        expect(gtkw).toContain('contador.clk');
        expect(gtkw).toContain('-Inputs');
        expect(gtkw).toContain('contador.valor[7:0]');
        expect(gtkw).toContain('contador.conta[7:0]');
        expect(gtkw).toContain('contador.u_inc.y[7:0]');
    });

    it('cada sinal na base do monitor: 1 bit e onda quadrada, barramento no tradutor da base', () => {
        const { surfer, gtkw } = montarLayoutDaOndaDoPrism({ modulo: 'contador', vcdPath: '', sinais: SINAIS });
        expect(surfer).toContain('format: Some("Bit")');
        expect(surfer).toContain('format: Some("Unsigned")');
        expect(surfer).toContain('format: Some("Hexadecimal")');
        expect(surfer).toContain('format: Some("Binary")');
        // As flags do .gtkw sao as mesmas do layout automatico: 28 bin, 24 dec, 22 hex.
        expect(gtkw).toMatch(/@28\ncontador\.clk/);
        expect(gtkw).toMatch(/@24\ncontador\.valor\[7:0\]/);
        expect(gtkw).toMatch(/@22\ncontador\.conta\[7:0\]/);
    });

    it('o escopo de cada sinal e o modulo seguido do caminho de submodulos', () => {
        const { surfer } = montarLayoutDaOndaDoPrism({ modulo: 'contador', vcdPath: '', sinais: SINAIS });
        // O estado do Surfer guarda o escopo como lista de segmentos.
        expect(surfer).toContain('"contador"');
        expect(surfer).toContain('"u_inc"');
    });

    it('um grupo so nao ganha divisor', () => {
        const { surfer, gtkw } = montarLayoutDaOndaDoPrism({
            modulo: 'm', vcdPath: '', sinais: [{ nome: 'a', bits: 1, papel: 'input' }, { nome: 'b', bits: 4, papel: 'input' }],
        });
        expect(surfer).not.toContain('Inputs');
        expect(gtkw).not.toContain('-Inputs');
    });

    it('papel desconhecido vai para os internos, e base desconhecida cai em hex', () => {
        const { surfer, gtkw } = montarLayoutDaOndaDoPrism({
            modulo: 'm', vcdPath: '', sinais: [{ nome: 'q', bits: 8, base: 'romano', papel: 'coisa' }, { nome: 'r', bits: 1, papel: 'input' }],
        });
        expect(surfer).toContain('Internal');
        expect(surfer).toContain('format: Some("Hexadecimal")');
        expect(gtkw).toMatch(/@22\nm\.q\[7:0\]/);
    });

    it('sem modulo ou sem sinais nao ha layout', () => {
        expect(montarLayoutDaOndaDoPrism({ modulo: '', vcdPath: '', sinais: SINAIS })).toEqual({ surfer: null, gtkw: null, quantidade: 0 });
        expect(montarLayoutDaOndaDoPrism({ modulo: 'm', vcdPath: '', sinais: [] })).toEqual({ surfer: null, gtkw: null, quantidade: 0 });
        expect(montarLayoutDaOndaDoPrism()).toEqual({ surfer: null, gtkw: null, quantidade: 0 });
    });
});
