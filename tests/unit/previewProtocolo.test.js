/**
 * main/ipc/preview: o handler do esquema aurora-preview e os dois canais que
 * abrem e fecham uma pre-visualizacao. O previewScheme.test.js cobre as regras
 * isoladas (regrasDePreview, temSegmentoOculto, mimeFor); estes chamam o
 * handler de verdade, com arquivos numa pasta temporaria, e fixam o que cada
 * pedido recebe. E a fronteira entre "a pagina ve os vizinhos dela" e "a
 * pagina ve o disco de quem usa".
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);

const electronFalso = vi.hoisted(() => ({
  protocol: {
    handle: (esquema, fn) => { globalThis.__previewProtocolo.set(esquema, fn); },
    registerSchemesAsPrivileged: (specs) => { globalThis.__previewSpecs.push(...specs); },
  },
  ipcMain: { handle: (canal, fn) => { globalThis.__previewHandlers.set(canal, fn); } },
}));
const protocolo = new Map();
const handlers = new Map();
const specs = [];
globalThis.__previewProtocolo = protocolo;
globalThis.__previewHandlers = handlers;
globalThis.__previewSpecs = specs;
vi.mock('electron', () => ({ default: electronFalso, ...electronFalso }));
req.cache[req.resolve('electron')] = { id: 'electron', loaded: true, exports: electronFalso };

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-preview-'));
const site = path.join(raiz, 'site');
const doc = path.join(site, 'index.html');

let preview;
let servir;

beforeAll(async () => {
  fs.mkdirSync(path.join(site, 'css'), { recursive: true });
  fs.mkdirSync(path.join(site, '.git'), { recursive: true });
  fs.writeFileSync(doc, '<h1>do disco</h1>');
  fs.writeFileSync(path.join(site, 'css', 'estilo.css'), 'h1{}');
  fs.writeFileSync(path.join(site, '.git', 'config'), 'segredo');
  fs.writeFileSync(path.join(raiz, 'fora.txt'), 'fora da pasta');
  preview = await import('../../main/ipc/preview.js');
  preview.register();
  preview.installProtocol();
  servir = protocolo.get(preview.SCHEME);
});

afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
});

const abrir = (arquivo, conteudo = null) => handlers.get('preview:register')({}, arquivo, conteudo);
const pedir = async (url) => {
  const r = await servir({ url });
  return { status: r.status, tipo: r.headers.get('Content-Type'), csp: r.headers.get('Content-Security-Policy'), cache: r.headers.get('Cache-Control'), corpo: await r.text() };
};

describe('preview:register e unregister', () => {
  it('devolve um id imprevisivel e a url do documento no esquema proprio', () => {
    const { id, url } = abrir(doc);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(url).toBe(`aurora-preview://${id}/index.html`);
    expect(abrir(doc).id).not.toBe(id);
  });

  it('depois de fechada, a pre-visualizacao nao responde mais', async () => {
    const { id, url } = abrir(doc);
    expect(handlers.get('preview:unregister')({}, id)).toBe(true);
    expect((await pedir(url)).status).toBe(404);
  });
});

describe('o handler do esquema', () => {
  it('o documento sai do texto que o renderer mandou, com o tipo, a politica e sem cache', async () => {
    const { url } = abrir(doc, '<h1>nao salvo</h1>');
    expect(await pedir(url)).toEqual({
      status: 200, tipo: preview.mimeFor(doc), csp: preview.PREVIEW_CSP, cache: 'no-store', corpo: '<h1>nao salvo</h1>',
    });
  });

  it('sem texto do renderer, o documento sai do disco', async () => {
    const { url } = abrir(doc);
    expect((await pedir(url)).corpo).toBe('<h1>do disco</h1>');
  });

  it('um vizinho da pagina sai do disco, com o tipo dele', async () => {
    const { id } = abrir(doc);
    const r = await pedir(`aurora-preview://${id}/css/estilo.css`);
    expect(r).toMatchObject({ status: 200, tipo: preview.mimeFor('x.css'), corpo: 'h1{}' });
  });

  it('pedido fora da pasta da pagina e recusado', async () => {
    const { id } = abrir(doc);
    expect((await pedir(`aurora-preview://${id}/%2e%2e%2ffora.txt`)).status).toBe(403);
  });

  it('vizinho oculto, como .git, e recusado mesmo dentro da pasta', async () => {
    const { id } = abrir(doc);
    expect((await pedir(`aurora-preview://${id}/.git/config`)).status).toBe(403);
  });

  it('arquivo que nao existe e 404, e nao erro do aplicativo', async () => {
    const { id } = abrir(doc);
    expect(await pedir(`aurora-preview://${id}/nao-existe.js`)).toMatchObject({ status: 404, corpo: 'Not found' });
  });

  it('id que nao foi aberto e 404', async () => {
    expect((await pedir('aurora-preview://0123456789abcdef/index.html')).status).toBe(404);
  });

  it('pagina solta na home: so o documento sai, nenhum vizinho', async () => {
    const regras = preview.regrasDePreview(path.join(os.homedir(), 'solto.html'));
    expect(regras.docOnly).toBe(true);
  });

  it('url que nem e url cai no 404 do catch', async () => {
    expect((await pedir('isto nao e url')).status).toBe(404);
  });
});

describe('registerScheme', () => {
  it('registra o esquema proprio junto dos que vierem por parametro, numa chamada so', () => {
    preview.registerScheme([{ scheme: 'outro', privileges: {} }]);
    expect(specs.map((s) => s.scheme)).toEqual(['aurora-preview', 'outro']);
    expect(specs[0].privileges).toMatchObject({ standard: true, secure: true, supportFetchAPI: true });
  });
});
