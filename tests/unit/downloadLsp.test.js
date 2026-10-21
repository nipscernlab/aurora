/**
 * Os scripts de download dos dois language servers de terceiros, o Verible e
 * o slang-server (components/Scripts/download-verible e
 * download-slang-server). Caracterizacao escrita antes da conversao para .cts
 * (issue 81: subir as versoes deles pede, pela regra da casa, converter
 * antes), sobre os .js de entao.
 *
 * Sem rede: o https.get e trocado por um falso que responde o que cada caso
 * manda. O download grava numa pasta temporaria; a instalacao de verdade
 * (extractLsOnly, main) escreve em components/Packages e fica de fora.
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
const tmp = () => (scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-lsp-dl-')));

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCRIPTS = [
    {
        nome: 'verible',
        arquivo: 'download-verible',
        tag: 'VERIBLE_TAG',
        exe: 'verible-verilog-ls.exe',
        extrair: 'extractLsOnly',
        pasta: 'verible',
        url: (m) => `https://github.com/chipsalliance/verible/releases/download/${m.VERIBLE_TAG}/verible-${m.VERIBLE_TAG}-win64.zip`,
    },
    {
        nome: 'slang-server',
        arquivo: 'download-slang-server',
        tag: 'SLANG_SERVER_TAG',
        exe: 'slang-server.exe',
        extrair: 'extractExeOnly',
        pasta: 'slang-server',
        url: (m) => `https://github.com/hudson-trading/slang-server/releases/download/${m.SLANG_SERVER_TAG}/slang-server-windows-x64.zip`,
    },
];

/** O script, na extensao que ele tiver (.js antes da conversao, .cts depois). */
function carregar(arquivo) {
    const base = path.join(RAIZ, 'components', 'Scripts', arquivo);
    const ext = ['.cts', '.js'].find((e) => fs.existsSync(base + e));
    return req(base + ext);
}

describe.each(SCRIPTS)('download do $nome', (s) => {
    let m;
    beforeAll(() => { m = carregar(s.arquivo); });

    it('carregar por require nao baixa nada: o main so roda chamado direto', () => {
        expect(pedidos).toEqual([]);
        expect(typeof m.downloadFile).toBe('function');
        expect(typeof m.extractZip).toBe('function');
        expect(typeof m[s.extrair]).toBe('function');
    });

    it('a URL sai da tag fixada, e os caminhos ficam em components/Packages/<componente>', () => {
        expect(m[s.tag]).toMatch(/^v\d/);
        expect(m.DOWNLOAD_URL).toBe(s.url(m));
        expect(m.INSTALL_DIR).toBe(path.join(RAIZ, 'components', 'Packages', s.pasta));
        expect(m.BIN_DIR).toBe(path.join(m.INSTALL_DIR, 'bin'));
        expect(m.SENTINEL_FILE).toBe(path.join(m.BIN_DIR, s.exe));
        expect(path.dirname(m.VERSION_STAMP)).toBe(m.INSTALL_DIR);
    });

    it('instalado e a sentinela existir', () => {
        expect(m.alreadyInstalled()).toBe(fs.existsSync(m.SENTINEL_FILE));
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
        expect(pedidos[0].agente).toMatch(/^aurora-ide-/);
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
