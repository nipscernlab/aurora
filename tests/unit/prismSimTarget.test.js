import { describe, it, expect } from 'vitest';
import { alvoDaSimulacao, valorDeParametro } from '../../main/ipc/prism_sim_target.js';

// O PRISM guarda o nome CRU do yosys. Mandar `$paramod\ula_fdiv\NBMANT=...`
// para `hierarchy -top` nao acha nada, e a primeira versao caia no topo do
// projeto em silencio: Simular na ula_fdiv sintetizava o processador inteiro.
// Os nomes abaixo sao os que o yosys escreveu de verdade nos JSONs da casa.

describe('alvoDaSimulacao', () => {
    it('modulo simples passa como esta', () => {
        expect(alvoDaSimulacao('ula')).toEqual({ modulo: 'ula', chparams: [], parametrosPerdidos: false });
    });

    it('paramod com parametro no nome vira modulo mais -chparam', () => {
        const r = alvoDaSimulacao("$paramod\\ula_mux\\NUBITS=s32'00000000000000000000000000100000");
        expect(r.modulo).toBe('ula_mux');
        expect(r.chparams).toEqual([['NUBITS', '32']]);
        expect(r.parametrosPerdidos).toBe(false);
    });

    it('varios parametros, na ordem do nome', () => {
        const r = alvoDaSimulacao("$paramod\\ula_fdiv\\NBMANT=s32'00000000000000000000000000010111\\NBEXPO=s32'00000000000000000000000000001000");
        expect(r.chparams).toEqual([['NBMANT', '23'], ['NBEXPO', '8']]);
    });

    it('a forma com hash nao carrega os parametros, e diz isso', () => {
        const r = alvoDaSimulacao('$paramod$4f84db355a9debea4d018f4fb55fb2cc125e642d\\core');
        expect(r.modulo).toBe('core');
        expect(r.chparams).toEqual([]);
        expect(r.parametrosPerdidos).toBe(true);
    });

    it('valor com sinal e bit alto ligado e negativo', () => {
        expect(valorDeParametro("s8'11111111")).toBe('-1');
        expect(valorDeParametro("8'11111111")).toBe('255');
        expect(valorDeParametro('42')).toBe('42');
        expect(valorDeParametro("s4'1x01")).toBeNull();
    });
});
