/**
 * As pastas da AURORA nascem ocultas no Windows (main/pastas_ocultas.js).
 *
 * No Windows o ponto no comeco do nome nao esconde nada, ao contrario dos
 * outros sistemas. O aluno abria a pasta do projeto e via `.aurora` e
 * `.slang` no meio dos arquivos dele, sem saber se podia apagar.
 *
 * Marcar so na abertura do projeto nao bastava: os tres caminhos que criam a
 * `.aurora` (a Temp da compilacao, o registro de execucoes, a memoria de
 * projeto) podem cria-la antes, e ela ficava a vista ate a proxima abertura.
 * O que se prova aqui e a escolha de QUAL pasta marcar a partir de um caminho
 * qualquer recem-criado, que e a peca que decide.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);

/** Os caminhos que o modulo mandou marcar. */
const marcados = [];
let falhar = false;

const cpPath = req.resolve('child_process');
const cpReal = req(cpPath);
req.cache[cpPath] = {
    id: cpPath, filename: cpPath, loaded: true, children: [], paths: [],
    exports: {
        ...cpReal,
        execFile: (bin, args, opts, cb) => {
            marcados.push({ bin, args });
            setImmediate(() => cb(falhar ? new Error('acesso negado') : null));
        },
    },
};

const ocultas = req('../../main/pastas_ocultas.js');

let raiz;
beforeEach(() => {
    marcados.length = 0;
    falhar = false;
    ocultas.esquecerMarcadas();
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-ocultas-'));
});
afterEach(() => {
    fs.rmSync(raiz, { recursive: true, force: true });
});

const soWindows = process.platform === 'win32' ? it : it.skip;

describe('ocultarPastaDeSistemaEm', () => {
    soWindows('marca a .aurora a partir de um neto recem-criado', async () => {
        const fundo = path.join(raiz, '.aurora', 'Temp', 'obj_dir_tb');
        expect(await ocultas.ocultarPastaDeSistemaEm(fundo)).toBe(true);
        expect(marcados).toHaveLength(1);
        expect(marcados[0].args).toEqual(['+h', path.join(raiz, '.aurora')]);
    });

    soWindows('marca a .slang do mesmo jeito', async () => {
        await ocultas.ocultarPastaDeSistemaEm(path.join(raiz, '.slang', 'local'));
        expect(marcados[0].args[1]).toBe(path.join(raiz, '.slang'));
    });

    soWindows('marca o ancestral MAIS ALTO, que e o que o Explorer mostra', async () => {
        // Uma `.aurora` dentro de outra: quem precisa sumir e a de cima.
        await ocultas.ocultarPastaDeSistemaEm(path.join(raiz, '.aurora', 'x', '.aurora', 'y'));
        expect(marcados[0].args[1]).toBe(path.join(raiz, '.aurora'));
    });

    soWindows('marca uma vez so, por mais arquivos que nasçam ali', async () => {
        await ocultas.ocultarPastaDeSistemaEm(path.join(raiz, '.aurora', 'Temp', 'a'));
        await ocultas.ocultarPastaDeSistemaEm(path.join(raiz, '.aurora', 'Temp', 'b'));
        await ocultas.ocultarPastaDeSistemaEm(path.join(raiz, '.aurora', 'execucoes'));
        expect(marcados).toHaveLength(1);
    });

    soWindows('uma falha nao cala a proxima tentativa', async () => {
        falhar = true;
        expect(await ocultas.ocultarPastaDeSistemaEm(path.join(raiz, '.aurora', 'Temp'))).toBe(false);
        falhar = false;
        expect(await ocultas.ocultarPastaDeSistemaEm(path.join(raiz, '.aurora', 'Temp'))).toBe(true);
        expect(marcados).toHaveLength(2);
    });

    it('caminho sem pasta nossa nao marca nada', async () => {
        expect(await ocultas.ocultarPastaDeSistemaEm(path.join(raiz, 'Hardware', 'somador.v'))).toBe(false);
        expect(await ocultas.ocultarPastaDeSistemaEm('')).toBe(false);
        expect(await ocultas.ocultarPastaDeSistemaEm(null)).toBe(false);
        expect(marcados).toHaveLength(0);
    });

    soWindows('uma .aurora na raiz do disco marca a PASTA, nunca a raiz', async () => {
        const naRaiz = path.join(path.parse(raiz).root, '.aurora');
        expect(await ocultas.ocultarPastaDeSistemaEm(naRaiz)).toBe(true);
        expect(marcados[0].args[1]).toBe(naRaiz);
        // O que o guarda `i <= 0` impede e marcar a propria raiz do disco.
        expect(marcados[0].args[1]).not.toBe(path.parse(raiz).root);
    });
});

describe('ocultarPasta', () => {
    it('recusa caminho relativo, que resolveria contra o diretorio de trabalho', async () => {
        expect(await ocultas.ocultarPasta('.aurora')).toBe(false);
        expect(await ocultas.ocultarPasta('')).toBe(false);
        expect(marcados).toHaveLength(0);
    });

    soWindows('marca o que recebe, quando e absoluto', async () => {
        const alvo = path.join(raiz, '.aurora');
        expect(await ocultas.ocultarPasta(alvo)).toBe(true);
        expect(marcados[0].args).toEqual(['+h', alvo]);
    });
});

describe('fora do Windows', () => {
    it('nao tenta marcar nada: o ponto no nome ja basta', async () => {
        if (process.platform === 'win32') return;
        expect(await ocultas.ocultarPasta(path.join(raiz, '.aurora'))).toBe(false);
        expect(marcados).toHaveLength(0);
    });
});

// O modulo nao pode ser carregado por engano com o child_process de verdade.
it('o falso do child_process esta de pe', () => {
    expect(vi.isMockFunction(cpReal.execFile)).toBe(false);
    expect(typeof req('child_process').execFile).toBe('function');
});
