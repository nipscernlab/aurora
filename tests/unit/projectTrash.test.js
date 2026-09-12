/**
 * Excluir projeto: quem pode, o que, e a insistencia (main/ipc/project_trash.js).
 *
 * A pasta vai para a Lixeira, nunca e apagada de vez. So a janela que acabou
 * de fechar o projeto pode manda-lo, e so aquele projeto: e a lembranca de
 * qual projeto ela fechou que autoriza, e ela vale para um pedido so. E no
 * Windows uma pasta com processo dentro nao se move de primeira, entao a
 * lixeira insiste com pausas antes de desistir.
 */

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);
const { autorizarExclusao, caminhosIguais, dentroDe, criarLixeiraDeProjeto } = req('../../main/ipc/project_trash.js');

const A = 'C:\\alunos\\somador\\somador.spf';
const B = 'C:\\alunos\\contador\\contador.spf';

describe('autorizarExclusao', () => {
    it('a janela que acabou de fechar o projeto pode exclui-lo, uma vez', () => {
        const ultimos = new Map([[1, A]]);
        expect(autorizarExclusao(ultimos, 1, A)).toEqual({ ok: true, spf: A });
        // Consumida: um segundo pedido igual nao vale.
        expect(autorizarExclusao(ultimos, 1, A).ok).toBe(false);
    });

    it('so o projeto que ela fechou, nao outro', () => {
        const ultimos = new Map([[1, A]]);
        const r = autorizarExclusao(ultimos, 1, B);
        expect(r.ok).toBe(false);
        expect(ultimos.get(1)).toBe(A);   // recusa nao consome
    });

    it('janela que nao fechou nada nao exclui nada', () => {
        expect(autorizarExclusao(new Map(), 1, A).ok).toBe(false);
        expect(autorizarExclusao(new Map([[2, A]]), 1, A).ok).toBe(false);
    });

    it('pedido sem janela ou sem caminho e recusado', () => {
        const ultimos = new Map([[1, A]]);
        expect(autorizarExclusao(ultimos, null, A).ok).toBe(false);
        expect(autorizarExclusao(ultimos, 1, '').ok).toBe(false);
        expect(autorizarExclusao(ultimos, 1, null).ok).toBe(false);
    });

    it('o caminho e comparado como o Windows compara', () => {
        const ultimos = new Map([[1, A]]);
        expect(autorizarExclusao(ultimos, 1, 'c:/ALUNOS/somador/SOMADOR.spf').ok).toBe(true);
    });
});

describe('caminhosIguais e dentroDe', () => {
    it('ignoram caixa e barras', () => {
        expect(caminhosIguais('C:\\a\\b', 'c:/A/B/')).toBe(true);
        expect(caminhosIguais('C:\\a\\b', 'C:\\a\\c')).toBe(false);
    });
    it('dentroDe exige o separador: um prefixo de nome nao e "dentro"', () => {
        expect(dentroDe('C:\\p\\.aurora\\Temp', 'C:\\p')).toBe(true);
        expect(dentroDe('C:\\p', 'C:\\p')).toBe(true);
        expect(dentroDe('C:\\p-outro\\x', 'C:\\p')).toBe(false);
        expect(dentroDe('', 'C:\\p')).toBe(false);
    });
});

describe('criarLixeiraDeProjeto', () => {
    it('vai na primeira quando a pasta esta livre', async () => {
        const trashItem = vi.fn(async () => {});
        const lixeira = criarLixeiraDeProjeto({ trashItem, sleep: async () => {} });
        expect(await lixeira('C:\\p')).toEqual({ success: true, tentativas: 1 });
        expect(trashItem).toHaveBeenCalledTimes(1);
    });

    it('insiste enquanto os descritores caem, e vence', async () => {
        let vez = 0;
        const trashItem = vi.fn(async () => { if (++vez < 3) throw new Error('EBUSY: resource busy'); });
        const esperas = [];
        const lixeira = criarLixeiraDeProjeto({ trashItem, sleep: async (ms) => { esperas.push(ms); }, esperaMs: 50 });
        expect(await lixeira('C:\\p')).toEqual({ success: true, tentativas: 3 });
        expect(esperas).toEqual([50, 50]);   // pausa entre tentativas, nunca depois da ultima
    });

    it('desiste depois do limite, dizendo por que', async () => {
        const trashItem = vi.fn(async () => { throw new Error('EPERM: operation not permitted'); });
        const lixeira = criarLixeiraDeProjeto({ trashItem, sleep: async () => {}, tentativas: 3 });
        const r = await lixeira('C:\\p');
        expect(r.success).toBe(false);
        expect(r.tentativas).toBe(3);
        expect(r.message).toContain('EPERM');
        expect(trashItem).toHaveBeenCalledTimes(3);
    });
});
