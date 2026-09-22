/**
 * A config de simulacao de um processador (js/project/processor_sim_config.ts).
 *
 * O defeito que estes casos fecham: a leitura estava escrita a mao em quatro
 * lugares e o tempo simulado ja tinha divergido. Com `clk` zero num `.spf`
 * editado a mao, o processo principal respondia `Infinity`, a API respondia
 * `null` e o `setProcessorConfig` nao guardava nada. A tela sempre mostrou um
 * travessao, entao e a guarda que esta certa.
 */

import { describe, expect, it } from 'vitest';

import {
    PADROES_DE_SIMULACAO,
    configComTempo,
    lerConfigDeSimulacao,
    tempoDeSimulacaoUs,
} from '../../js/project/processor_sim_config.ts';

describe('lerConfigDeSimulacao', () => {
    it('le os tres campos da entrada', () => {
        expect(lerConfigDeSimulacao({ name: 'p', clk: 50, numClocks: 4000, showArrays: true }))
            .toEqual({ clk: 50, numClocks: 4000, showArrays: true });
    });

    it('entrada so com nome, string ou ausente cai nos padroes', () => {
        for (const entrada of [{ name: 'p' }, 'p', null, undefined, 0]) {
            expect(lerConfigDeSimulacao(entrada)).toEqual({ ...PADROES_DE_SIMULACAO });
        }
    });

    it('campo torto nao contamina: cai no padrao daquele campo so', () => {
        expect(lerConfigDeSimulacao({ clk: 'rapido', numClocks: 4000 }))
            .toEqual({ clk: 100, numClocks: 4000, showArrays: false });
    });

    it('os padroes sao os 20 us que a AURORA escreve no $finish do testbench', () => {
        expect(PADROES_DE_SIMULACAO.clk).toBe(100);
        expect(PADROES_DE_SIMULACAO.numClocks).toBe(2000);
        expect(tempoDeSimulacaoUs(PADROES_DE_SIMULACAO.numClocks, PADROES_DE_SIMULACAO.clk))
            .toBe(20);
    });
});

describe('tempoDeSimulacaoUs', () => {
    it('e numClocks dividido por clk', () => {
        expect(tempoDeSimulacaoUs(4000, 50)).toBe(80);
    });

    it('clk zero devolve null, e nao Infinity', () => {
        // Era exatamente aqui que os dois caminhos discordavam.
        expect(tempoDeSimulacaoUs(2000, 0)).toBeNull();
    });

    it('zero ciclos devolve null: nao ha simulacao a medir', () => {
        expect(tempoDeSimulacaoUs(0, 100)).toBeNull();
    });

    it('negativo e entrada torta tambem devolvem null', () => {
        for (const [n, c] of [[-1, 100], [2000, -1], ['x', 100], [2000, null], [NaN, 100]]) {
            expect(tempoDeSimulacaoUs(n, c)).toBeNull();
        }
    });

    it('aceita texto de campo de formulario, que e como a tela chama', () => {
        expect(tempoDeSimulacaoUs('2000', '100')).toBe(20);
        expect(tempoDeSimulacaoUs('', '100')).toBeNull();
    });
});

describe('configComTempo', () => {
    it('junta os tres campos com o tempo, que e o que a API devolve', () => {
        expect(configComTempo({ clk: 200, numClocks: 1000 }))
            .toEqual({ clk: 200, numClocks: 1000, showArrays: false, simTime_us: 5 });
    });

    it('um .spf com clk zero devolve o tempo ausente, nao um numero errado', () => {
        expect(configComTempo({ clk: 0, numClocks: 2000 }).simTime_us).toBeNull();
    });
});
