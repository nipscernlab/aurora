/**
 * As notificacoes do sistema durante a atualizacao (main/update_notify.js).
 *
 * Minimizar o card e o que LIGA este modulo; a partir dai o Windows conta o
 * andamento. O contrato que se prova aqui: nada e dito com o modulo desligado,
 * cada fala sai uma unica vez por atualizacao, o idioma segue o da janela, o
 * clique na notificacao chama a volta do card, e a barra de progresso da
 * barra de tarefas so pinta enquanto o card esta minimizado.
 *
 * O modulo e CommonJS e faz `require('electron')` por dentro. O vi.mock do
 * vitest so alcanca imports ESM, entao o Electron falso entra pelo cache do
 * require nativo, ANTES de o modulo ser carregado, e o modulo e o state vem
 * pelo mesmo require, para serem as mesmas instancias que se falam.
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);

const criadas = [];
let suportado = true;

class NotificacaoFalsa {
    static isSupported() { return suportado; }
    constructor(opts) {
        this.opts = opts;
        this.handlers = {};
        this.mostrada = false;
        this.fechada = false;
        criadas.push(this);
    }
    on(ev, fn) { this.handlers[ev] = fn; }
    show() { this.mostrada = true; }
    close() { this.fechada = true; this.handlers.close?.(); }
}

const electronPath = req.resolve('electron');
req.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true, children: [], paths: [],
    exports: { Notification: NotificacaoFalsa },
};

const state = req('../../main/state.js');
const notificar = req('../../main/update_notify.js');

let barra;
beforeEach(() => {
    criadas.length = 0;
    suportado = true;
    barra = [];
    state.mainWindow = {
        isDestroyed: () => false,
        setProgressBar: (v) => barra.push(v),
    };
    notificar.desativar();
    barra.length = 0;
});

describe('update_notify', () => {
    it('desligado, nao fala nada', () => {
        notificar.avisar('baixando', '7.0.0', () => {});
        expect(criadas).toHaveLength(0);
    });

    it('ligado, fala uma vez por chave e nao repete', () => {
        notificar.ativar('pt');
        notificar.avisar('baixando', '7.0.0', () => {});
        notificar.avisar('baixando', '7.0.0', () => {});
        notificar.avisar('concluido', '7.0.0', () => {});
        expect(criadas.map((n) => n.opts.title)).toEqual([
            'Atualizando o SAPHO',
            'Atualizacao do SAPHO pronta',
        ]);
        expect(criadas.every((n) => n.mostrada)).toBe(true);
        expect(criadas[1].opts.body).toContain('7.0.0');
    });

    it('o idioma vem da janela que minimizou', () => {
        notificar.ativar('en');
        notificar.avisar('baixando', '7.0.0', () => {});
        expect(criadas[0].opts.title).toBe('Updating SAPHO');
    });

    it('idioma desconhecido cai no portugues', () => {
        notificar.ativar('xx');
        notificar.avisar('concluido', '7.0.0', () => {});
        expect(criadas[0].opts.title).toBe('Atualizacao do SAPHO pronta');
    });

    it('clicar na notificacao traz o card de volta', () => {
        const volta = vi.fn();
        notificar.ativar('pt');
        notificar.avisar('concluido', '7.0.0', volta);
        criadas[0].handlers.click();
        expect(volta).toHaveBeenCalledTimes(1);
    });

    it('uma fala nova fecha a anterior, para nao acumular cards do sistema', () => {
        notificar.ativar('pt');
        notificar.avisar('baixando', '7.0.0', () => {});
        notificar.avisar('concluido', '7.0.0', () => {});
        expect(criadas[0].fechada).toBe(true);
        expect(criadas[1].fechada).toBe(false);
    });

    it('desativar limpa a memoria: minimizar de novo fala de novo', () => {
        notificar.ativar('pt');
        notificar.avisar('baixando', '7.0.0', () => {});
        notificar.desativar();
        notificar.ativar('pt');
        notificar.avisar('baixando', '7.0.0', () => {});
        expect(criadas).toHaveLength(2);
    });

    it('sem suporte a notificacao do sistema, fica em silencio sem lancar', () => {
        suportado = false;
        notificar.ativar('pt');
        expect(() => notificar.avisar('baixando', '7.0.0', () => {})).not.toThrow();
        expect(criadas).toHaveLength(0);
    });

    it('a barra de progresso so pinta enquanto ligado, e null a apaga', () => {
        notificar.progresso(0.5);
        expect(barra).toEqual([-1]);              // desligado: apaga
        notificar.ativar('pt');
        notificar.progresso(0.5);
        notificar.progresso(1.7);
        notificar.progresso(null);
        expect(barra).toEqual([-1, 0.5, 1, -1]);  // limitada a [0, 1]
    });

    it('desativar apaga a barra da barra de tarefas', () => {
        notificar.ativar('pt');
        notificar.progresso(0.3);
        barra.length = 0;
        notificar.desativar();
        expect(barra).toEqual([-1]);
    });
});
