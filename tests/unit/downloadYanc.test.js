/**
 * O script que baixa o YANC (components/Scripts/download-yanc). Caracterizacao
 * escrita antes da conversao para .cts (issue 213: a correcao pede, pela regra
 * da casa, converter antes), sobre o .js de entao.
 *
 * Sem rede: o https.get e trocado por um falso que responde o que cada caso
 * manda. O download grava numa pasta temporaria; a instalacao de verdade
 * (main) escreve em components/ e fica de fora.
 */

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const https = req('node:https');
const getOriginal = https.get;

/** Respostas do servidor falso, por URL completa. */
let respostas = {};
const pedidos = [];

beforeAll(() => {
    https.get = (opts, aoResponder) => {
        const url = `https://${opts.hostname}${opts.path}`;
        pedidos.push({ url, agente: opts.headers['User-Agent'] });
        const pedido = new EventEmitter();
        const r = respostas[url] || { status: 404 };
        setImmediate(() => {
            const res = Readable.from(r.corpo ? [Buffer.from(r.corpo)] : []);
            res.statusCode = r.status;
            res.headers = { ...(r.location ? { location: r.location } : {}), ...(r.corpo ? { 'content-length': String(r.corpo.length) } : {}) };
            aoResponder(res);
        });
        return pedido;
    };
});
afterAll(() => { https.get = getOriginal; });

let scratch;
afterEach(() => {
    respostas = {};
    pedidos.length = 0;
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = null;
});
const tmp = () => (scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-yanc-dl-')));

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(RAIZ, 'components', 'bin');

/** O script, na extensao que ele tiver (.js antes da conversao, .cts depois). */
function carregar() {
    const base = path.join(RAIZ, 'components', 'Scripts', 'download-yanc');
    const ext = ['.cts', '.js'].find((e) => fs.existsSync(base + e));
    return req(base + ext);
}

describe('download do yanc', () => {
    let m;
    beforeAll(() => { m = carregar(); });

    it('carregar por require nao baixa nada: o main so roda chamado direto', () => {
        expect(pedidos).toEqual([]);
        expect(typeof m.downloadFile).toBe('function');
        expect(typeof m.extractZip).toBe('function');
    });

    it('a URL sai da tag fixada, e a sentinela e o carimbo ficam em components/bin', () => {
        expect(m.YANC_TAG).toMatch(/^v\d/);
        expect(m.YANC_FILENAME).toBe(`yanc-bin-${m.YANC_TAG}.zip`);
        expect(m.DOWNLOAD_URL).toBe(`https://github.com/nipscernlab/yanc/releases/download/${m.YANC_TAG}/${m.YANC_FILENAME}`);
        expect(m.SENTINEL_FILE).toBe(path.join(BIN, 'cppcomp.exe'));
        expect(m.VERSION_SENTINEL).toBe(path.join(BIN, '.yanc-version'));
    });

    it('a tag instalada e a do carimbo, ou null sem ele', () => {
        let carimbo = null;
        try { carimbo = fs.readFileSync(m.VERSION_SENTINEL, 'utf8').trim() || null; } catch { /* sem carimbo */ }
        expect(m.installedTag()).toBe(carimbo);
    });

    it('instalado e ter as quatro sentinelas E o carimbo da tag fixada', () => {
        const quatro = ['bin/cppcomp.exe', 'SAPHO/core.v', 'Header/cmath', 'Macros/float_sin.asm']
            .every((p) => fs.existsSync(path.join(RAIZ, 'components', p)));
        expect(m.binariesPresent()).toBe(quatro);
        expect(m.alreadyInstalled()).toBe(quatro && m.installedTag() === m.YANC_TAG);
    });

    it('baixa seguindo o redirecionamento e grava o corpo', async () => {
        const dest = path.join(tmp(), 'x.zip');
        respostas = {
            'https://exemplo.test/a?b=1': { status: 302, location: 'https://cdn.test/final' },
            'https://cdn.test/final': { status: 200, corpo: 'conteudo do zip' },
        };
        const escrita = process.stdout.write;
        process.stdout.write = () => true;
        try {
            await m.downloadFile('https://exemplo.test/a?b=1', dest);
        } finally {
            process.stdout.write = escrita;
        }
        expect(fs.readFileSync(dest, 'utf8')).toBe('conteudo do zip');
        expect(pedidos.map((p) => p.url)).toEqual(['https://exemplo.test/a?b=1', 'https://cdn.test/final']);
        expect(pedidos[0].agente).toBe('aurora-ide-yanc-bootstrap');
    });

    it('resposta que nao e 200 rejeita com o status', async () => {
        respostas = { 'https://exemplo.test/sumiu': { status: 404 } };
        await expect(m.downloadFile('https://exemplo.test/sumiu', path.join(tmp(), 'x.zip')))
            .rejects.toThrow('HTTP 404 from https://exemplo.test/sumiu');
    });

    it('mais de cinco redirecionamentos rejeita', async () => {
        respostas = { 'https://exemplo.test/laco': { status: 301, location: 'https://exemplo.test/laco' } };
        await expect(m.downloadFile('https://exemplo.test/laco', path.join(tmp(), 'x.zip')))
            .rejects.toThrow('Too many redirects');
    });
});
