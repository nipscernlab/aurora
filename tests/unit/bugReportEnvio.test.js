/**
 * main/ipc/bug_report: o envio do relato, a coleta do diagnostico e os
 * handlers de IPC. O bugReport.test.js e o bugReportCorte.test.js cobrem as
 * funcoes puras; estes cobrem o que fala com a rede e com o Electron, que e
 * onde estavam os erros de tipo do modulo.
 *
 * Tres travas contra um POST de verdade, que abriria uma issue no
 * sapho-relatos: o https.request e trocado no proprio modulo do Node, antes de
 * o bug_report carregar (ele chama `https.request` pelo objeto, entao a troca
 * vale para o .js e para o .ts); a URL de destino e um dominio .invalid, que por
 * norma nunca resolve; e o beforeAll prova que a troca pegou antes de qualquer
 * envio.
 *
 * O Electron nao existe em node puro. O falso entra por vi.mock, para quem
 * importa pelo Vite, e pelo cache do require, para quem carrega nativo.
 */

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);

const handlers = new Map();
const electronFalso = vi.hoisted(() => ({
  app: {
    getVersion: () => '9.9.9',
    getPath: () => 'C:\\nao\\existe\\userData',
    isPackaged: false,
  },
  ipcMain: { handle: (canal, fn) => { globalThis.__bugHandlers.set(canal, fn); } },
}));
globalThis.__bugHandlers = handlers;
vi.mock('electron', () => ({ default: electronFalso, ...electronFalso }));
req.cache[req.resolve('electron')] = { id: 'electron', loaded: true, exports: electronFalso };

// ── A trava da rede ─────────────────────────────────────────────────────────
const https = req('node:https');
/** cada pedido: { opcoes, corpo } */
const pedidos = [];
/** respostas em fila, uma por pedido: { status, headers?, corpo?, evento? } */
let respostas = [];
https.request = (opcoes, aoResponder) => {
  const reqFalso = new EventEmitter();
  const pedido = { opcoes, corpo: null };
  pedidos.push(pedido);
  const r = respostas.shift() ?? { status: 200, corpo: '{}' };
  reqFalso.destroy = () => { reqFalso.destruido = true; };
  reqFalso.end = (dados) => {
    pedido.corpo = dados ? JSON.parse(Buffer.from(dados).toString('utf8')) : null;
    setImmediate(() => {
      if (r.evento === 'timeout') { reqFalso.emit('timeout'); return; }
      if (r.evento === 'error') { reqFalso.emit('error', new Error('ECONNRESET')); return; }
      const res = new EventEmitter();
      res.statusCode = r.status;
      res.headers = r.headers || {};
      res.resume = () => {};
      aoResponder(res);
      if (r.corpo !== undefined) res.emit('data', r.corpo);
      res.emit('end');
    });
  };
  return reqFalso;
};

const DESTINO = 'https://relato.exemplo.invalid/api?x=1';
let bug;

beforeAll(async () => {
  process.env.AURORA_BUGREPORT_URL = DESTINO;
  bug = await import('../../main/ipc/bug_report.js');
  // A troca pegou? Se nao, o envio iria para um dominio que nao resolve.
  respostas = [{ status: 200, corpo: '{}' }];
  await bug.enviar({ oQueAconteceu: 'sonda' });
  if (pedidos.length !== 1) throw new Error('o https.request falso nao intercepta o bug_report: parar');
});

beforeEach(() => {
  process.env.AURORA_BUGREPORT_URL = DESTINO;
  pedidos.length = 0;
  respostas = [];
});

afterEach(() => {
  delete process.env.AURORA_BUGREPORT_URL;
});

describe('enviar', () => {
  it('sem descricao nao envia nada', async () => {
    expect(await bug.enviar({ oQueAconteceu: '   ' })).toEqual({ ok: false, erro: 'sem-descricao' });
    expect(await bug.enviar()).toEqual({ ok: false, erro: 'sem-descricao' });
    expect(pedidos).toEqual([]);
  });

  it('endpoint desligado: nao envia, e o disponivel diz que nao', async () => {
    process.env.AURORA_BUGREPORT_URL = '';
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: false, erro: 'sem-endpoint' });
    expect(pedidos).toEqual([]);
  });

  it('monta a carga, posta em JSON e devolve a url da issue', async () => {
    respostas = [{ status: 201, corpo: JSON.stringify({ url: 'https://github.com/x/1' }) }];
    const r = await bug.enviar({
      oQueAconteceu: 'titulo\nresto', oQueEsperava: ' e ', comoReproduzir: ' c ',
      email: 'a@b.co', terminal: 'erro na linha 3',
    });
    expect(r).toEqual({ ok: true, url: 'https://github.com/x/1' });
    const { opcoes, corpo } = pedidos[0];
    expect(opcoes).toMatchObject({ hostname: 'relato.exemplo.invalid', path: '/api?x=1', method: 'POST', timeout: 20000 });
    expect(opcoes.headers['Content-Type']).toBe('application/json');
    expect(opcoes.headers['Content-Length']).toBe(Buffer.byteLength(JSON.stringify(corpo)));
    expect(corpo).toMatchObject({
      titulo: 'titulo', oQueAconteceu: 'titulo\nresto', oQueEsperava: 'e', comoReproduzir: 'c',
      email: 'a@b.co', terminal: 'erro na linha 3',
    });
    expect(corpo.diagnostico).toMatchObject({ versao: '9.9.9', empacotado: false, log: '(sem arquivo de log)' });
    expect(typeof corpo.diagnostico.sistema).toBe('string');
    expect(typeof corpo.diagnostico.componentes).toBe('string');
  });

  it('2xx sem corpo JSON ainda e sucesso, sem url', async () => {
    respostas = [{ status: 204 }];
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: true, url: null });
  });

  it('segue redirect re-enviando o corpo, com endereco relativo', async () => {
    respostas = [
      { status: 301, headers: { location: 'https://www.exemplo.invalid/api' } },
      { status: 308, headers: { location: '/outra' } },
      { status: 200, corpo: '{"url":"u"}' },
    ];
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: true, url: 'u' });
    expect(pedidos.map((p) => `${p.opcoes.hostname}${p.opcoes.path}`)).toEqual([
      'relato.exemplo.invalid/api?x=1', 'www.exemplo.invalid/api', 'www.exemplo.invalid/outra',
    ]);
    expect(pedidos[2].corpo).toEqual(pedidos[0].corpo);
  });

  it('para no quarto redirect', async () => {
    respostas = Array.from({ length: 5 }, () => ({ status: 302, headers: { location: '/de-novo' } }));
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: false, erro: 'redirects demais' });
    expect(pedidos).toHaveLength(4);
  });

  it('redirect sem location e tratado como resposta comum', async () => {
    respostas = [{ status: 301, corpo: 'movido' }];
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: false, erro: 'HTTP 301', detalhe: 'movido' });
  });

  it('429: muitos relatos, com o prazo do corpo, do cabecalho ou 300 s', async () => {
    respostas = [
      { status: 429, corpo: '{"esperar":42}', headers: { 'retry-after': '7' } },
      { status: 429, corpo: 'x', headers: { 'retry-after': '7' } },
      { status: 429, corpo: '{"esperar":-1}' },
    ];
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: false, erro: 'muitos-relatos', esperar: 42 });
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: false, erro: 'muitos-relatos', esperar: 7 });
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: false, erro: 'muitos-relatos', esperar: 300 });
  });

  it('outro status devolve o codigo e o comeco da resposta', async () => {
    respostas = [{ status: 500, corpo: 'e'.repeat(400) }];
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: false, erro: 'HTTP 500', detalhe: 'e'.repeat(300) });
  });

  it('tempo esgotado e erro de rede viram falha com o motivo', async () => {
    respostas = [{ evento: 'timeout' }, { evento: 'error' }];
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: false, erro: 'tempo esgotado' });
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: false, erro: 'ECONNRESET' });
  });

  it('endereco que nao e URL nao chega a postar', async () => {
    process.env.AURORA_BUGREPORT_URL = 'nao e url';
    expect(await bug.enviar({ oQueAconteceu: 'x' })).toEqual({ ok: false, erro: 'endereco invalido' });
    expect(pedidos).toEqual([]);
  });
});

describe('register', () => {
  it('liga os tres canais: diagnostico, enviar e disponivel', async () => {
    handlers.clear();
    bug.register();
    expect([...handlers.keys()].sort()).toEqual(['bugreport:diagnostico', 'bugreport:disponivel', 'bugreport:enviar']);
    expect(handlers.get('bugreport:diagnostico')()).toMatchObject({ versao: '9.9.9' });
    expect(handlers.get('bugreport:disponivel')()).toBe(true);
    respostas = [{ status: 200, corpo: '{}' }];
    expect(await handlers.get('bugreport:enviar')({}, { oQueAconteceu: 'via ipc' })).toEqual({ ok: true, url: null });
    process.env.AURORA_BUGREPORT_URL = '';
    expect(handlers.get('bugreport:disponivel')()).toBe(false);
  });
});
