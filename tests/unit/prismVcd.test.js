import { describe, it, expect } from 'vitest';
import { vcdDaSimulacao, identificador } from '../../main/ipc/prism_vcd.js';

// O monitor do PRISM guarda, por fio, os pares [tick, binario]; o VCD que sai
// daqui e o que o GTKWave e o Surfer abrem. As saidas abaixo foram escritas a
// mao a partir do formato, e nao lidas de uma rodada: e o arquivo que se
// confere, nao o que o codigo achou que devia escrever.

const DATA = new Date('2026-08-30T12:00:00.000Z');

describe('vcdDaSimulacao', () => {
    it('um bit e um barramento no topo, com cabecalho, valores iniciais e presente', () => {
        const vcd = vcdDaSimulacao({
            modulo: 'contador',
            presente: 300,
            data: DATA,
            sinais: [
                { nome: 'clk', caminho: [], bits: 1, mudancas: [[0, '0'], [50, '1'], [100, '0']] },
                { nome: 'conta', caminho: [], bits: 8, mudancas: [[0, '00000000'], [100, '00000001']] },
            ],
        });
        expect(vcd).toBe([
            '$date 2026-08-30T12:00:00.000Z $end',
            '$version AURORA PRISM (DigitalJS) $end',
            '$comment 1 tick = 1 ns $end',
            '$timescale 1ns $end',
            '$scope module contador $end',
            '$var wire 1 ! clk $end',
            '$var wire 8 " conta [7:0] $end',
            '$upscope $end',
            '$enddefinitions $end',
            '$dumpvars',
            '0!',
            'b00000000 "',
            '$end',
            '#50',
            '1!',
            '#100',
            '0!',
            'b00000001 "',
            '#300',
            '',
        ].join('\n'));
    });

    it('um sinal que entrou no monitor depois comeca em x', () => {
        const vcd = vcdDaSimulacao({
            modulo: 'm', data: DATA, presente: 20,
            sinais: [{ nome: 'q', bits: 1, mudancas: [[10, '1']] }],
        });
        expect(vcd).toContain('$dumpvars\nx!\n$end\n#10\n1!\n#20\n');
    });

    it('o caminho de submodulos vira escopos aninhados', () => {
        const vcd = vcdDaSimulacao({
            modulo: 'topo', data: DATA,
            sinais: [
                { nome: 'a', caminho: [], bits: 1, mudancas: [[0, '0']] },
                { nome: 'b', caminho: ['u_ula', 'u_soma'], bits: 4, mudancas: [[0, '0101']] },
                { nome: 'c', caminho: ['u_ula'], bits: 1, mudancas: [[0, 'x']] },
            ],
        });
        expect(vcd).toContain([
            '$scope module topo $end',
            '$var wire 1 ! a $end',
            '$scope module u_ula $end',
            '$var wire 1 # c $end',
            '$scope module u_soma $end',
            '$var wire 4 " b [3:0] $end',
            '$upscope $end',
            '$upscope $end',
            '$upscope $end',
        ].join('\n'));
        expect(vcd).toContain('$dumpvars\n0!\nb0101 "\nx#\n$end');
    });

    it('nomes repetidos no mesmo escopo ganham sufixo, e espaco vira sublinhado', () => {
        const vcd = vcdDaSimulacao({
            modulo: 'meu modulo', data: DATA,
            sinais: [
                { nome: 'x', bits: 1, mudancas: [] },
                { nome: 'x', bits: 1, mudancas: [] },
                { nome: 'x', bits: 1, mudancas: [] },
            ],
        });
        expect(vcd).toContain('$scope module meu_modulo $end');
        expect(vcd).toContain('$var wire 1 ! x $end\n$var wire 1 " x_2 $end\n$var wire 1 # x_3 $end');
        // Sem mudanca nenhuma o sinal e x do comeco ao fim.
        expect(vcd).toContain('$dumpvars\nx!\nx"\nx#\n$end');
    });

    it('o binario se ajusta pela direita a largura declarada, com x no que falta', () => {
        const vcd = vcdDaSimulacao({
            modulo: 'm', data: DATA,
            sinais: [
                { nome: 'curto', bits: 4, mudancas: [[0, '11']] },
                { nome: 'longo', bits: 2, mudancas: [[0, '10111']] },
            ],
        });
        expect(vcd).toContain('bxx11 !\nb11 "');
    });

    it('mudancas fora de ordem saem ordenadas, e o presente atras da ultima nao se repete', () => {
        const vcd = vcdDaSimulacao({
            modulo: 'm', data: DATA, presente: 5,
            sinais: [{ nome: 'q', bits: 1, mudancas: [[30, '1'], [10, '0'], [20, '1']] }],
        });
        expect(vcd).toContain('$end\n#10\n0!\n#20\n1!\n#30\n1!\n');
        expect(vcd).not.toContain('#5\n');
    });

    it('entrada vazia ainda e um VCD valido', () => {
        const vcd = vcdDaSimulacao({ data: DATA });
        expect(vcd).toContain('$scope module simulacao $end\n$upscope $end\n$enddefinitions $end\n$dumpvars\n$end\n');
    });
});

describe('identificador', () => {
    it('cobre os 94 imprimiveis e passa a dois caracteres', () => {
        expect(identificador(0)).toBe('!');
        expect(identificador(93)).toBe('~');
        expect(identificador(94)).toBe('!!');
        expect(identificador(95)).toBe('!"');
        expect(identificador(94 + 94)).toBe('"!');
        const todos = new Set();
        for (let i = 0; i < 10000; i++) todos.add(identificador(i));
        expect(todos.size).toBe(10000);
    });
});
