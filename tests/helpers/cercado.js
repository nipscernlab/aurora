/**
 * tests/helpers/cercado.js: as travas que um teste do main/ monta antes de
 * carregar o modulo que testa.
 *
 * POR QUE EXISTE
 * --------------
 * Varios modulos do main/ apagam pastas, matam processo por nome, apagam
 * credencial ou falam com a rede. Rodados de verdade num teste, fazem isso na
 * maquina de quem roda. Cada teste montava a propria protecao, e foi montando a
 * mao que a primeira versao do processRegistry.test.js rodou taskkill de
 * verdade (o espiao foi posto depois de o modulo guardar a funcao original).
 * Aqui cada trava e montada do jeito certo uma vez, e cada uma devolve como
 * provar que pegou.
 *
 * AS DUAS COPIAS DE CADA MODULO
 * -----------------------------
 * No vitest, um modulo do main/ pode ser carregado por dois caminhos: pelo
 * Vite (import, e o que um .ts usa) e pelo require nativo (o que um .js
 * CommonJS usa por dentro). Cada caminho tem a sua copia. Por isso as travas
 * valem para as duas: vi.doMock para o Vite e o cache do require para o
 * nativo, e, no caso dos modulos do Node, a troca e feita no proprio objeto do
 * modulo, que e o mesmo para os dois.
 *
 * COMO USAR
 * ---------
 * Chamar no TOPO do arquivo de teste, antes de qualquer import do modulo
 * testado (que entao vem por `await import(...)` num beforeAll). O modulo
 * desestrutura o que importa na carga; uma troca feita depois nao pega.
 *
 *   import { cercar } from '../helpers/cercado.js';
 *   const c = cercar({ electron: true, processos: true, paths: { componentsPath: 'tmp' } });
 *   beforeAll(async () => { mod = await import('../../main/x.js'); c.provar(); });
 */

import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

const req = createRequire(import.meta.url);
const RAIZ_DO_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Poe `exports` no cache do require nativo, como se o modulo ja tivesse carregado. */
function noCacheDoRequire(especificador, exports) {
  req.cache[req.resolve(especificador)] = { id: especificador, loaded: true, exports };
}

/**
 * Uma pasta temporaria propria do teste. `apagar()` no afterAll.
 * @param {string} prefixo
 */
export function pastaTemporaria(prefixo = 'aurora-teste-') {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  return { raiz, apagar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

/**
 * O Electron falso. Fora do Electron o pacote `electron` exporta so uma
 * string: sem isto, `import { ipcMain } from 'electron'` nao acha o nome.
 *
 * ipcMain.handle guarda cada handler em `handlers`, pelo canal. app.getPath
 * devolve `userData` (uma pasta temporaria, se nao vier outra). safeStorage
 * "cifra" prefixando o texto, o que basta para o keystore ir e voltar.
 *
 * @param {{ userData?: string, extra?: object }} [opcoes]
 */
export function electronFalso(opcoes = {}) {
  const handlers = new Map();
  const enviados = [];
  const userData = opcoes.userData ?? pastaTemporaria('aurora-userdata-').raiz;
  const electron = {
    app: {
      getPath: () => userData,
      getVersion: () => '0.0.0-teste',
      getAppPath: () => RAIZ_DO_REPO,
      isPackaged: false,
    },
    ipcMain: { handle: (canal, fn) => { handlers.set(canal, fn); }, on: (canal, fn) => { handlers.set(canal, fn); } },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(`cifrado:${s}`),
      decryptString: (b) => Buffer.from(b).toString().replace(/^cifrado:/, ''),
    },
    BrowserWindow: Object.assign(class {}, { fromWebContents: () => null, getAllWindows: () => [] }),
    shell: { openPath: async () => '', openExternal: async () => {} },
    protocol: { handle: () => {}, registerSchemesAsPrivileged: () => {} },
    webContents: { getAllWebContents: () => [] },
    ...(opcoes.extra || {}),
  };
  vi.doMock('electron', () => ({ default: electron, ...electron }));
  noCacheDoRequire('electron', electron);
  return { electron, handlers, enviados, userData };
}

/**
 * Nenhum execFile de verdade: taskkill, PowerShell, git, cmdkey, nada.
 *
 * A troca e no objeto do child_process, e nunca e desfeita. Cada chamada fica
 * em `execs` ([comando, ...args]) e responde o que `responder(cmd, args)`
 * devolver: { codigo?, stdout?, erro?, lanca? }. O process.kill tambem vira
 * nada, para o caminho de fora do Windows do utils.
 *
 * `provar()` chama o killProcessesByName do utils com um nome inventado e
 * confere que o pedido caiu aqui.
 */
export function trancarProcessos() {
  const cp = req('node:child_process');
  const execs = [];
  let responder = () => ({});
  cp.execFile = (cmd, args, opcoesOuCb, talvezCb) => {
    const lista = Array.isArray(args) ? args : [];
    execs.push([cmd, ...lista]);
    const cb = typeof opcoesOuCb === 'function' ? opcoesOuCb : typeof talvezCb === 'function' ? talvezCb : null;
    const r = responder(cmd, lista) || {};
    if (r.lanca) throw new Error(r.lanca);
    const filho = new EventEmitter();
    filho.kill = () => {};
    filho.stdin = { on() {}, write() {}, end() {} };
    setImmediate(() => {
      if (cb) cb(r.erro ? new Error(r.erro) : null, r.stdout || '', r.stderr || '');
      if (r.erro && !cb) filho.emit('error', new Error(r.erro));
      else filho.emit('close', r.codigo ?? 0);
    });
    return filho;
  };
  process.kill = () => true;
  return {
    execs,
    responder: (fn) => { responder = fn; },
    async provar() {
      const nome = `aurora-teste-${process.pid}.exe`;
      await req('../../main/utils.js').killProcessesByName(nome);
      if (!execs.some((e) => e.includes(nome))) {
        throw new Error('cercado: o execFile falso nao intercepta o utils; parar antes de matar processo de verdade');
      }
      execs.length = 0;
    },
  };
}

/**
 * Nenhuma requisicao de rede: https.request, http.request e fetch. Cada pedido
 * fica em `pedidos` e responde o que `responder(pedido)` devolver:
 * { status, headers?, corpo? } ou { erro }. Sem resposta, erro de rede.
 */
export function trancarRede() {
  const pedidos = [];
  let responder = () => ({ erro: 'rede bloqueada pelo cercado do teste' });
  for (const nome of ['node:https', 'node:http']) {
    const mod = req(nome);
    mod.request = (opcoes, aoResponder) => {
      const pedido = { modulo: nome, opcoes, corpo: null };
      pedidos.push(pedido);
      const r = new EventEmitter();
      r.setTimeout = () => r;
      r.destroy = () => {};
      r.write = (d) => { pedido.corpo = (pedido.corpo || '') + String(d); };
      r.end = (d) => {
        if (d) r.write(d);
        setImmediate(() => {
          const resp = responder(pedido) || {};
          if (resp.erro) { r.emit('error', new Error(resp.erro)); return; }
          const res = new EventEmitter();
          Object.assign(res, { statusCode: resp.status ?? 200, headers: resp.headers || {}, resume() {}, setEncoding() {} });
          if (aoResponder) aoResponder(res);
          if (resp.corpo !== undefined) res.emit('data', Buffer.from(String(resp.corpo)));
          res.emit('end');
        });
      };
      return r;
    };
    mod.get = (opcoes, aoResponder) => { const r = mod.request(opcoes, aoResponder); r.end(); return r; };
  }
  globalThis.fetch = async (url, init) => {
    pedidos.push({ modulo: 'fetch', url: String(url), init });
    const resp = responder({ modulo: 'fetch', url: String(url), init }) || {};
    if (resp.erro) throw new TypeError(resp.erro);
    return new globalThis.Response(resp.corpo ?? '', { status: resp.status ?? 200, headers: resp.headers });
  };
  return { pedidos, responder: (fn) => { responder = fn; } };
}

/**
 * O main/paths com outros caminhos, nas duas copias. O que nao vier em
 * `sobrescrever` e o do paths de verdade.
 * @param {Record<string, unknown>} sobrescrever
 */
export function redirecionarPaths(sobrescrever) {
  const real = req('../../main/paths.js');
  const falso = { ...real, ...sobrescrever };
  vi.doMock(path.join(RAIZ_DO_REPO, 'main', 'paths.js'), () => ({ default: falso, ...falso }));
  noCacheDoRequire('../../main/paths.js', falso);
  return falso;
}

/**
 * As travas pedidas, de uma vez. `provar()` confere as que tem prova, e deve
 * ser chamada no beforeAll, depois do import do modulo e antes de qualquer
 * teste que dependa delas.
 *
 * @param {{ electron?: boolean | object, processos?: boolean, rede?: boolean, paths?: Record<string, unknown> }} pedido
 */
export function cercar(pedido = {}) {
  const c = {};
  if (pedido.paths) c.paths = redirecionarPaths(pedido.paths);
  if (pedido.electron) c.electron = electronFalso(pedido.electron === true ? {} : pedido.electron);
  if (pedido.processos) c.processos = trancarProcessos();
  if (pedido.rede) c.rede = trancarRede();
  c.provar = async () => {
    if (c.processos) await c.processos.provar();
    if (c.paths) {
      const visto = req('../../main/paths.js');
      for (const [k, v] of Object.entries(pedido.paths)) {
        if (visto[k] !== v) throw new Error(`cercado: o paths nativo ainda ve ${k}=${visto[k]}; parar`);
      }
    }
  };
  return c;
}
