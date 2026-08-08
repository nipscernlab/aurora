/**
 * Testes da pilha de desfazer da árvore de arquivos.
 *
 * A pilha não toca disco: quem executa é o CRUD, que passa os executores. Aqui
 * eles são falsos, então dá para testar as regras que realmente importam sem
 * criar arquivo nenhum.
 *
 * A regra que mais custa errar é o descarte. Uma operação que sai do alcance,
 * seja pelo limite da pilha ou porque o ramo de refazer morreu, ainda pode
 * estar segurando um arquivo na área de espera. Se ninguém devolver aquilo à
 * Lixeira, a espera cresce a sessão inteira guardando arquivos que o usuário
 * acha que já deletou.
 */

import { describe, it, expect } from 'vitest';

import { TreeHistory, Op, LIMITE } from '../../js/tree/tree_history.js';

/** Executores falsos que registram o que foi pedido. */
function fakeExec({ moverOk = true, guardarOk = true, restaurarOk = true } = {}) {
    const log = { movidos: [], guardados: [], restaurados: [], descartados: [] };
    let n = 0;
    return {
        log,
        exec: {
            mover: async (de, para) => { log.movidos.push([de, para]); return moverOk; },
            guardar: async (c) => { log.guardados.push(c); return guardarOk ? `t${++n}` : null; },
            restaurar: async (t, c) => { log.restaurados.push([t, c]); return restaurarOk; },
            descartar: async (t) => { log.descartados.push(t); },
        },
    };
}

describe('TreeHistory, o basico', () => {
    it('nasce sem nada para desfazer nem refazer', () => {
        const h = new TreeHistory(fakeExec().exec);
        expect(h.podeDesfazer()).toBe(false);
        expect(h.podeRefazer()).toBe(false);
    });

    it('desfazer um move renomeia de volta, refazer renomeia de novo', async () => {
        const { exec, log } = fakeExec();
        const h = new TreeHistory(exec);
        h.registrar(Op.move('a/x.c', 'b/x.c'));

        expect((await h.desfazer()).ok).toBe(true);
        expect(log.movidos).toEqual([['b/x.c', 'a/x.c']]);
        expect(h.podeDesfazer()).toBe(false);
        expect(h.podeRefazer()).toBe(true);

        expect((await h.refazer()).ok).toBe(true);
        expect(log.movidos[1]).toEqual(['a/x.c', 'b/x.c']);
    });

    it('desfazer uma criacao guarda o arquivo em vez de apaga-lo', async () => {
        // O usuario pode ja ter escrito no arquivo recem-criado. Guardar em vez
        // de apagar e o que garante que refazer devolve o conteudo.
        const { exec, log } = fakeExec();
        const h = new TreeHistory(exec);
        h.registrar(Op.criado('novo.py'));

        await h.desfazer();
        expect(log.guardados).toEqual(['novo.py']);
        expect(log.descartados).toEqual([]);

        await h.refazer();
        expect(log.restaurados).toEqual([['t1', 'novo.py']]);
    });

    it('desfazer uma delecao restaura do token guardado', async () => {
        const { exec, log } = fakeExec();
        const h = new TreeHistory(exec);
        h.registrar(Op.removido('velho.v', 'tok9'));

        await h.desfazer();
        expect(log.restaurados).toEqual([['tok9', 'velho.v']]);
    });

    it('devolve o caminho que a arvore deve selecionar depois', async () => {
        const h = new TreeHistory(fakeExec().exec);
        h.registrar(Op.move('a/x.c', 'b/x.c'));
        expect((await h.desfazer()).foco).toBe('a/x.c');
    });
});

describe('quando o executor falha', () => {
    it('a operacao volta para a pilha em vez de sumir', async () => {
        const h = new TreeHistory(fakeExec({ moverOk: false }).exec);
        h.registrar(Op.move('a/x.c', 'b/x.c'));

        const r = await h.desfazer();
        expect(r.ok).toBe(false);
        // Sem isto o usuario perderia o passo: falhou e tambem sumiu da pilha.
        expect(h.podeDesfazer()).toBe(true);
        expect(h.podeRefazer()).toBe(false);
    });

    it('desfazer uma delecao sem token falha em vez de fingir sucesso', async () => {
        const h = new TreeHistory(fakeExec().exec);
        h.registrar({ kind: 'existence', caminho: 'x.c', presente: false, token: null });
        const r = await h.desfazer();
        expect(r.ok).toBe(false);
    });
});

describe('descarte do que sai do alcance', () => {
    it('uma acao nova mata o ramo de refazer e devolve o que ele segurava', async () => {
        const { exec } = fakeExec();
        const h = new TreeHistory(exec);
        h.registrar(Op.removido('velho.v', 'tok-A'));
        await h.desfazer();          // volta para o disco, some o token
        h.registrar(Op.criado('outro.c'));

        // O ramo de refazer morreu. Nada a descartar aqui, porque o restore ja
        // consumiu o token.
        expect(h.podeRefazer()).toBe(false);
    });

    it('o ramo de refazer descartado devolve o token que ainda segurava', async () => {
        const { exec, log } = fakeExec();
        const h = new TreeHistory(exec);
        h.registrar(Op.criado('novo.py'));
        await h.desfazer();          // agora ha um token segurando novo.py
        h.registrar(Op.criado('outro.py')); // mata o ramo de refazer

        expect(log.descartados).toEqual(['t1']);
    });

    it('estourar o limite descarta a operacao mais antiga', async () => {
        const { exec, log } = fakeExec();
        const h = new TreeHistory(exec);
        // A mais antiga segura um token; as seguintes sao moves, que nao seguram.
        h.registrar(Op.removido('primeiro.v', 'tok-velho'));
        for (let i = 0; i < LIMITE; i++) h.registrar(Op.move(`a${i}`, `b${i}`));

        expect(log.descartados).toEqual(['tok-velho']);
    });

    it('limpar devolve tudo, dos dois lados da pilha', async () => {
        const { exec, log } = fakeExec();
        const h = new TreeHistory(exec);
        h.registrar(Op.removido('a.v', 'tok-1'));
        h.registrar(Op.removido('b.v', 'tok-2'));
        h.limpar();

        expect(log.descartados.sort()).toEqual(['tok-1', 'tok-2']);
        expect(h.podeDesfazer()).toBe(false);
        expect(h.podeRefazer()).toBe(false);
    });
});

describe('idas e voltas seguidas', () => {
    it('desfazer e refazer varias vezes continua alternando os dois estados', async () => {
        // O bug que este teste guarda: `presente` descreve a operacao original
        // e e constante. Invertendo ele a cada volta, refazer uma criacao
        // guardava o arquivo de novo em vez de traze-lo, e a partir da segunda
        // volta o Ctrl+Shift+Z fazia o oposto do que devia.
        const { exec, log } = fakeExec();
        const h = new TreeHistory(exec);
        h.registrar(Op.criado('novo.py'));

        for (let volta = 0; volta < 3; volta++) {
            await h.desfazer();
            await h.refazer();
        }
        // Tres voltas completas: guardou tres vezes, restaurou tres vezes.
        expect(log.guardados).toEqual(['novo.py', 'novo.py', 'novo.py']);
        expect(log.restaurados.map((r) => r[1])).toEqual(['novo.py', 'novo.py', 'novo.py']);
        // E cada restauracao usou o token da guarda correspondente.
        expect(log.restaurados.map((r) => r[0])).toEqual(['t1', 't2', 't3']);
        expect(h.podeDesfazer()).toBe(true);
        expect(h.podeRefazer()).toBe(false);
    });
});

describe('a pilha nao grava a si mesma', () => {
    it('registrar durante um desfazer e ignorado', async () => {
        // O CRUD grava as operacoes que executa. Desfazer executa uma operacao
        // inversa pelo mesmo caminho, entao sem esta guarda a pilha gravaria o
        // proprio desfazer e o Ctrl+Z ficaria preso alternando dois estados.
        const { exec } = fakeExec();
        const h = new TreeHistory({
            ...exec,
            mover: async (de, para) => {
                h.registrar(Op.move(de, para));
                return true;
            },
        });
        h.registrar(Op.move('a', 'b'));
        await h.desfazer();

        expect(h.podeDesfazer()).toBe(false);
        expect(h.podeRefazer()).toBe(true);
    });
});
