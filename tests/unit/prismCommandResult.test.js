/**
 * A resposta de um comando do PRISM so vale de quem recebeu o comando
 * (main/ipc/prism.js).
 *
 * O comando vai por um canal e a resposta volta por outro, correlacionados
 * por um id. O id era a unica credencial: qualquer renderer que falasse
 * `prism:command-result` com o id certo respondia pelo comando de outra
 * janela. O id e dificil de adivinhar, mas isso e obscuridade, nao controle,
 * e quem consome a resposta e a AuroraAPI, por onde a Aurora Intelligence
 * opera o Simular.
 *
 * O modulo e CommonJS e faz `require('electron')` por dentro, entao o
 * Electron falso entra pelo cache do require nativo antes de ele carregar
 * (ver reference: testar main CJS com createRequire).
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);

/** Os handlers que o modulo registra, para o teste poder aciona-los. */
const canais = { on: new Map(), handle: new Map() };

const electronPath = req.resolve('electron');
req.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true, children: [], paths: [],
    exports: {
        ipcMain: {
            on: (c, fn) => canais.on.set(c, fn),
            handle: (c, fn) => canais.handle.set(c, fn),
        },
        app: { getAppPath: () => process.cwd(), getPath: () => process.cwd() },
        BrowserWindow: class { static getAllWindows() { return []; } },
        dialog: {},
        shell: {},
        session: { defaultSession: {} },
    },
};

const state = req('../../main/state.js');
const prism = req('../../main/ipc/prism.js');

/** Uma superficie de PRISM de mentira: guarda o que recebeu. */
function superficie(id) {
    return {
        id,
        recebidos: [],
        isDestroyed: () => false,
        send(canal, ...args) { this.recebidos.push({ canal, args }); },
        once() {},
        removeListener() {},
    };
}

beforeEach(() => {
    canais.on.clear();
    canais.handle.clear();
    state.prismWindow = null;
    state.prismTabContents = new Map();
    state.prismDono = null;
    prism.register();
});

describe('prism:command-result', () => {
    /** Dispara um comando e devolve { promessa, id, pagina }. */
    function comandar(idDaPagina = 7) {
        const pagina = superficie(idDaPagina);
        state.prismTabContents.set(1, pagina);
        const promessa = canais.handle.get('prism:command')(
            { sender: { id: 1 } }, { tipo: 'simular' },
        );
        const [envio] = pagina.recebidos;
        return { promessa, id: envio.args[0], pagina };
    }

    it('a pagina que recebeu o comando responde por ele', async () => {
        const { promessa, id, pagina } = comandar();
        canais.on.get('prism:command-result')({ sender: { id: pagina.id } }, id, { ok: true, valor: 42 });
        await expect(promessa).resolves.toEqual({ ok: true, valor: 42 });
    });

    it('outro renderer com o id certo NAO responde', async () => {
        const { promessa, id, pagina } = comandar();
        // Um id diferente do da pagina que recebeu: janela vizinha, webview
        // qualquer, o que for.
        canais.on.get('prism:command-result')({ sender: { id: pagina.id + 1 } }, id, { ok: true, valor: 'mentira' });

        // O comando continua em voo: ninguem o encerrou.
        let resolvida = false;
        promessa.then(() => { resolvida = true; });
        await Promise.resolve();
        expect(resolvida).toBe(false);

        // E a resposta legitima ainda funciona depois da tentativa.
        canais.on.get('prism:command-result')({ sender: { id: pagina.id } }, id, { ok: true, valor: 1 });
        await expect(promessa).resolves.toEqual({ ok: true, valor: 1 });
    });

    it('resposta sem remetente nao passa', async () => {
        const { promessa, id, pagina } = comandar();
        canais.on.get('prism:command-result')({}, id, { ok: true, valor: 'mentira' });
        canais.on.get('prism:command-result')(null, id, { ok: true, valor: 'mentira' });
        canais.on.get('prism:command-result')({ sender: { id: pagina.id } }, id, { ok: true });
        await expect(promessa).resolves.toEqual({ ok: true });
    });

    it('id desconhecido nao quebra nada', () => {
        expect(() => canais.on.get('prism:command-result')(
            { sender: { id: 99 } }, 'prism-cmd-inexistente', { ok: true },
        )).not.toThrow();
    });

    it('sem PRISM aberto, o comando recusa sem esperar resposta', async () => {
        state.prismTabContents = new Map();
        await expect(canais.handle.get('prism:command')({ sender: { id: 1 } }, { tipo: 'x' }))
            .resolves.toMatchObject({ ok: false });
    });
});
