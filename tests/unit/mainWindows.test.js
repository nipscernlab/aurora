/**
 * Qual janela principal recebe cada mensagem (main/main_windows.js).
 *
 * O processo principal guardava uma janela so, sobrescrita a cada janela nova.
 * Como reabrir a AURORA cria outra janela no MESMO processo, tudo o que o main
 * mandava para a interface (saida do PRISM, diagnosticos do servidor de
 * linguagem, processador criado) ia para a ULTIMA criada, e quem trabalhava na
 * primeira via a segunda responder por ela.
 *
 * O que se prova aqui e a ordem da escolha: quem pediu ganha de quem abriu o
 * projeto, que ganha da reserva; e que `reserva: false` prefere nao mandar
 * nada a mandar o conteudo de um projeto para a janela de outro.
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);
const state = req('../../main/state.js');
const janelas = req('../../main/main_windows.js');

/** Uma janela de mentira com o minimo que o modulo toca. */
function janela(id, { morta = false } = {}) {
    const handlers = {};
    return {
        id,
        enviados: [],
        destruida: morta,
        webContents: {
            id,
            isDestroyed() { return this._dono.destruida; },
            send(canal, ...args) { this._dono.enviados.push({ canal, args }); },
        },
        isDestroyed() { return this.destruida; },
        on(ev, fn) { handlers[ev] = fn; },
        fechar() { this.destruida = true; handlers.closed?.(); },
    };
}

/** Liga o webContents de volta na janela (o send precisa saber onde anotar). */
function nova(id, opts) {
    const w = janela(id, opts);
    w.webContents._dono = w;
    janelas.registrar(w);
    return w;
}

beforeEach(() => {
    state.mainWindows.clear();
    state.projectPathsBySender.clear();
    state.mainWindow = null;
});

describe('registrar e todas', () => {
    it('conhece as janelas na ordem de criacao e esquece quem fecha', () => {
        const a = nova(1);
        const b = nova(2);
        expect(janelas.todas()).toEqual([a, b]);
        a.fechar();
        expect(janelas.todas()).toEqual([b]);
    });

    it('janela destruida sem evento de fechamento sai do conjunto na proxima leitura', () => {
        const a = nova(1);
        const b = nova(2);
        a.destruida = true;                 // crash do renderer: nenhum `closed`
        expect(janelas.todas()).toEqual([b]);
        expect(state.mainWindows.size).toBe(1);
    });

    it('registrar null nao quebra nada', () => {
        expect(() => janelas.registrar(null)).not.toThrow();
        expect(janelas.todas()).toEqual([]);
    });
});

describe('doSender', () => {
    it('acha a janela pelo event, pelo webContents e pela propria janela', () => {
        const a = nova(1);
        nova(2);
        expect(janelas.doSender({ sender: { id: 1 } })).toBe(a);
        expect(janelas.doSender({ webContents: { id: 1 } })).toBe(a);
        expect(janelas.doSender({ id: 1 })).toBe(a);
    });

    it('pedido que nao veio de uma janela principal nao acha nenhuma', () => {
        nova(1);
        // A janela do PRISM, a de atualizacao, um <webview>: ids que nao estao
        // no conjunto.
        expect(janelas.doSender({ sender: { id: 99 } })).toBeNull();
        expect(janelas.doSender(null)).toBeNull();
        expect(janelas.doSender({})).toBeNull();
    });
});

describe('doProjeto', () => {
    it('acha quem abriu aquele .spf, e nao a mais recente', () => {
        const a = nova(1);
        const b = nova(2);
        state.projectPathsBySender.set(1, 'C:/A/A.spf');
        state.projectPathsBySender.set(2, 'C:/B/B.spf');
        expect(janelas.doProjeto('C:/A/A.spf')).toBe(a);
        expect(janelas.doProjeto('C:/B/B.spf')).toBe(b);
    });

    it('compara sem diferenciar caixa, que e como o Windows trata caminho', () => {
        const a = nova(1);
        state.projectPathsBySender.set(1, 'C:/A/A.spf');
        expect(janelas.doProjeto('c:/a/a.spf')).toBe(a);
    });

    it('projeto que nenhuma janela abriu, ou sem projeto, nao acha nada', () => {
        nova(1);
        state.projectPathsBySender.set(1, 'C:/A/A.spf');
        expect(janelas.doProjeto('C:/Z/Z.spf')).toBeNull();
        expect(janelas.doProjeto(null)).toBeNull();
        expect(janelas.doProjeto('')).toBeNull();
    });
});

describe('principal', () => {
    it('prefere a mais recente enquanto ela vive', () => {
        nova(1);
        const b = nova(2);
        state.mainWindow = b;
        expect(janelas.principal()).toBe(b);
    });

    it('com a mais recente morta, cai na primeira viva', () => {
        const a = nova(1);
        const b = nova(2);
        state.mainWindow = b;
        b.fechar();
        expect(janelas.principal()).toBe(a);
    });

    it('sem janela nenhuma, null', () => {
        expect(janelas.principal()).toBeNull();
    });
});

describe('escolher', () => {
    it('quem pediu ganha de quem abriu o projeto', () => {
        const a = nova(1);
        const b = nova(2);
        state.projectPathsBySender.set(2, 'C:/B/B.spf');
        expect(janelas.escolher({ origem: { sender: { id: 1 } }, spf: 'C:/B/B.spf' })).toBe(a);
        expect(janelas.escolher({ spf: 'C:/B/B.spf' })).toBe(b);
    });

    it('sem pedido e sem projeto, cai na reserva', () => {
        const a = nova(1);
        state.mainWindow = a;
        expect(janelas.escolher({})).toBe(a);
    });

    it('reserva false prefere nao mandar a mandar para a janela errada', () => {
        const a = nova(1);
        state.mainWindow = a;
        state.projectPathsBySender.set(1, 'C:/A/A.spf');
        expect(janelas.escolher({ spf: 'C:/B/B.spf', reserva: false })).toBeNull();
    });
});

describe('mandar', () => {
    it('entrega na janela escolhida e em nenhuma outra', () => {
        const a = nova(1);
        const b = nova(2);
        state.projectPathsBySender.set(1, 'C:/A/A.spf');
        expect(janelas.mandar({ spf: 'C:/A/A.spf' }, 'prism:saida', 'oi')).toBe(true);
        expect(a.enviados).toEqual([{ canal: 'prism:saida', args: ['oi'] }]);
        expect(b.enviados).toEqual([]);
    });

    it('sem destino, devolve false sem lancar', () => {
        expect(janelas.mandar({ spf: 'C:/A/A.spf', reserva: false }, 'x')).toBe(false);
    });

    it('janela fechando no meio do envio nao derruba o processo principal', () => {
        const a = nova(1);
        state.mainWindow = a;
        a.webContents.send = () => { throw new Error('Object has been destroyed'); };
        expect(janelas.mandar({}, 'x')).toBe(false);
    });

    it('webContents ja destruido nao recebe', () => {
        const a = nova(1);
        state.mainWindow = a;
        const espiao = vi.fn();
        a.webContents.send = espiao;
        a.webContents.isDestroyed = () => true;
        expect(janelas.mandar({}, 'x')).toBe(false);
        expect(espiao).not.toHaveBeenCalled();
    });
});
