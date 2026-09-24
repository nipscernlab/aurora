/**
 * main/ipc/github_forget: a limpeza em si (esquecerTudo), a limpeza ao sair e a
 * preferencia gravada em disco. O githubForget.test.js e o
 * githubForgetOnExit.test.js cobrem as duas regras puras; estes cobrem os
 * passos que apagam.
 *
 * E o modulo mais perigoso de testar da AURORA: rodado de verdade, ele pede ao
 * git para esquecer a credencial do github.com, apaga o ~/.git-credentials e
 * chama cmdkey /delete no Gerenciador de Credenciais do Windows. Apagaria o
 * login do GitHub de quem roda o teste. Tres camadas impedem isso, todas
 * montadas no topo deste arquivo, antes de o modulo carregar:
 *
 *   1. o execFile do child_process e trocado por um falso, que so anota o
 *      pedido e responde o que o teste mandar. O modulo desestrutura o execFile
 *      na carga, entao a troca tem de vir antes (ver o processRegistry.test.js);
 *   2. o PATH aponta para uma pasta vazia: se a troca falhar, git e cmdkey nao
 *      sao encontrados e nada roda;
 *   3. os.homedir e o userData do Electron apontam para uma pasta temporaria, e
 *      o .git-credentials que sai e um que o proprio teste criou.
 */

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);

// ── As tres camadas ──────────────────────────────────────────────────────────
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-forget-'));
const casa = path.join(raiz, 'casa');
const userData = path.join(raiz, 'userData');
const semNada = path.join(raiz, 'path-vazio');
for (const d of [casa, userData, semNada]) fs.mkdirSync(d, { recursive: true });

const pathOriginal = process.env.PATH;
process.env.PATH = semNada;
os.homedir = () => casa;

const cp = req('node:child_process');
/** cada chamada: { cmd, args, entrada } */
const execs = [];
/** como responder, por chave `${cmd} ${args[0]}`: { erro?, stdout? } ou funcao */
let respostas = {};
cp.execFile = (cmd, args, _opcoes, aoTerminar) => {
  const pedido = { cmd, args, entrada: undefined };
  execs.push(pedido);
  const chave = `${cmd} ${args[0]}`;
  let r = respostas[chave] ?? {};
  if (typeof r === 'function') r = r(args);
  if (r.lanca) throw new Error(r.lanca);
  const filho = new EventEmitter();
  filho.stdin = { on() {}, end(dado) { pedido.entrada = dado; } };
  setImmediate(() => aoTerminar(r.erro ? new Error(r.erro) : null, r.stdout || '', ''));
  return filho;
};

const electronFalso = vi.hoisted(() => ({
  app: { getPath: () => globalThis.__forgetUserData },
  ipcMain: { handle: (canal, fn) => { globalThis.__forgetHandlers.set(canal, fn); } },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '' },
  shell: {},
  BrowserWindow: class {},
}));
globalThis.__forgetUserData = userData;
const handlers = new Map();
globalThis.__forgetHandlers = handlers;
vi.mock('electron', () => ({ default: electronFalso, ...electronFalso }));
req.cache[req.resolve('electron')] = { id: 'electron', loaded: true, exports: electronFalso };

let forget;
const preferencia = path.join(userData, 'aurora-github-exit.json');
const credenciais = [path.join(casa, '.git-credentials'), path.join(casa, '.config', 'git', 'credentials')];

beforeAll(async () => {
  forget = await import('../../main/ipc/github_forget.js');
  forget.register();
  // As camadas estao de pe? Se nao, parar antes de qualquer limpeza.
  if (os.homedir() !== casa || process.env.PATH !== semNada || !handlers.has('github:forget-everything')) {
    throw new Error('o cercado do teste nao montou: parar antes de apagar credencial de verdade');
  }
  // E o execFile falso pega mesmo o que o modulo dispara? Uma limpeza dentro do
  // cercado: com o PATH vazio, mesmo sem a troca nada real rodaria, e aqui se
  // confere que os pedidos cairam no falso.
  fs.writeFileSync(preferencia, JSON.stringify({ limparAoSair: true }));
  await forget.aoEncerrar();
  if (!execs.some((e) => e.cmd === 'git')) {
    throw new Error('o execFile falso nao intercepta o github_forget: parar');
  }
});

afterAll(() => {
  process.env.PATH = pathOriginal;
  fs.rmSync(raiz, { recursive: true, force: true });
});

beforeEach(() => {
  execs.length = 0;
  respostas = {};
  fs.rmSync(preferencia, { recursive: true, force: true });
  for (const f of credenciais) fs.rmSync(f, { force: true });
});

const LISTA_DO_CMDKEY = [
  'Currently stored credentials:',
  '',
  '    Destino: git:https://github.com',
  '    Target: LegacyGeneric:target=git:https://gitlab.com',
  '    Alvo: MicrosoftOffice16_Data:orgid',
  '    Target: git:https://github.com.exemplo.net',
  '',
].join('\r\n');

describe('esquecerTudo (o botao do painel)', () => {
  it('os quatro passos, e so o que e das forjas sai do Gerenciador', async () => {
    fs.writeFileSync(credenciais[0], 'https://aluno:segredo@github.com\n');
    fs.mkdirSync(path.dirname(credenciais[1]), { recursive: true });
    fs.writeFileSync(credenciais[1], 'x');
    fs.writeFileSync(path.join(userData, 'aurora-github.json'), '{}');
    respostas['cmdkey /list'] = { stdout: LISTA_DO_CMDKEY };

    const r = await handlers.get('github:forget-everything')();

    expect(r.ok).toBe(true);
    expect(r.passos.map((p) => p.passo)).toEqual([
      'cofre-aurora', 'git-credential-reject', 'arquivo-git-credentials', 'gerenciador-windows',
    ]);
    expect(fs.existsSync(path.join(userData, 'aurora-github.json'))).toBe(false);
    for (const f of credenciais) expect(fs.existsSync(f)).toBe(false);
    expect(r.passos[2].detalhe).toBe('2 arquivo(s) removido(s)');

    // Um reject por host de forja, com o pedido no formato do protocolo do git.
    const rejeitados = execs.filter((e) => e.cmd === 'git');
    expect(rejeitados.map((e) => e.args)).toEqual(Array(rejeitados.length).fill(['credential', 'reject']));
    expect(rejeitados.map((e) => e.entrada)).toContain('protocol=https\nhost=github.com\n\n');
    expect(rejeitados.map((e) => e.entrada)).toContain('protocol=https\nhost=gitlab.com\n\n');
    expect(r.passos[1].detalhe).toBe(`${rejeitados.length} hosts pedidos ao helper do git`);

    const apagados = execs.filter((e) => e.cmd === 'cmdkey' && e.args[0] !== '/list').map((e) => e.args[0]);
    if (process.platform === 'win32') {
      expect(apagados).toEqual(['/delete:git:https://github.com', '/delete:LegacyGeneric:target=git:https://gitlab.com']);
      expect(r.passos[3].detalhe).toBe('2 credencial(is) do GitHub removida(s)');
    } else {
      expect(apagados).toEqual([]);
      expect(r.passos[3].detalhe).toBe('nao se aplica fora do Windows');
    }
  });

  it('sem nada guardado: sucesso, com nada encontrado', async () => {
    respostas['cmdkey /list'] = { stdout: 'Currently stored credentials:\r\n\r\n* NONE *\r\n' };
    const r = await handlers.get('github:forget-everything')();
    expect(r.ok).toBe(true);
    expect(r.passos[2].detalhe).toBe('nenhum encontrado');
    if (process.platform === 'win32') expect(r.passos[3].detalhe).toBe('nenhuma encontrada');
  });

  it('um passo que falha nao impede os outros, e o relatorio diz qual', async () => {
    fs.writeFileSync(credenciais[0], 'x');
    respostas['git credential'] = { erro: 'helper quebrado' };
    respostas['cmdkey /list'] = { stdout: LISTA_DO_CMDKEY };
    respostas['cmdkey /delete:git:https://github.com'] = { erro: 'acesso negado' };

    const r = await handlers.get('github:forget-everything')();

    expect(r.ok).toBe(false);
    expect(r.passos[1].ok).toBe(false);
    expect(r.passos[1].detalhe).toMatch(/^falhou em: github\.com, /);
    // O arquivo em texto puro sai mesmo com o git falhando.
    expect(r.passos[2].ok).toBe(true);
    expect(fs.existsSync(credenciais[0])).toBe(false);
    if (process.platform === 'win32') {
      expect(r.passos[3]).toMatchObject({ ok: false, detalhe: '1 removida(s), falhou em 1' });
    }
  });

  it('sem conseguir listar o Gerenciador, e sem conseguir nem disparar o comando', async () => {
    if (process.platform !== 'win32') return;
    respostas['cmdkey /list'] = { erro: 'cmdkey ausente' };
    expect((await handlers.get('github:forget-everything')()).passos[3])
      .toEqual({ passo: 'gerenciador-windows', ok: false, detalhe: 'nao consegui listar as credenciais' });
    respostas['cmdkey /list'] = { lanca: 'spawn EPERM' };
    expect((await handlers.get('github:forget-everything')()).passos[3].ok).toBe(false);
  });
});

describe('a preferencia de limpar ao sair', () => {
  it('sem arquivo vale o padrao ligado; o interruptor grava e le de volta', () => {
    expect(handlers.get('github:forget-on-exit-get')()).toBe(true);
    expect(handlers.get('github:forget-on-exit-set')({}, false)).toBe(true);
    expect(JSON.parse(fs.readFileSync(preferencia, 'utf8'))).toEqual({ limparAoSair: false });
    expect(handlers.get('github:forget-on-exit-get')()).toBe(false);
    expect(handlers.get('github:forget-on-exit-set')({}, 1)).toBe(true);
    expect(handlers.get('github:forget-on-exit-get')()).toBe(true);
  });

  it('arquivo ilegivel cai no padrao, e nao gravar e respondido com false', () => {
    fs.mkdirSync(preferencia); // uma pasta no lugar do arquivo: le e grava falham
    expect(handlers.get('github:forget-on-exit-get')()).toBe(true);
    expect(handlers.get('github:forget-on-exit-set')({}, false)).toBe(false);
  });

  it('o escopo mostra os dois cofres, dentro do userData', () => {
    expect(handlers.get('github:forget-scope')()).toEqual({
      nota: 'user.name e user.email do git nao sao credenciais e continuam configurados.',
      caminhoCofre: path.join(userData, 'aurora-github.json'),
      caminhoCofreGitlab: path.join(userData, 'aurora-gitlab.json'),
    });
  });
});

describe('aoEncerrar', () => {
  it('no padrao, sem conta conectada nesta instalacao, nao apaga nada', async () => {
    expect(await forget.aoEncerrar()).toEqual({ ok: true, pulado: true });
    expect(execs).toEqual([]);
  });

  it('desligado explicitamente, nao apaga nada', async () => {
    fs.writeFileSync(preferencia, JSON.stringify({ limparAoSair: false }));
    expect(await forget.aoEncerrar()).toEqual({ ok: true, pulado: true });
    expect(execs).toEqual([]);
  });

  it('ligado explicitamente, limpa mesmo sem conta conectada', async () => {
    fs.writeFileSync(preferencia, JSON.stringify({ limparAoSair: true }));
    respostas['cmdkey /list'] = { stdout: '' };
    const r = await forget.aoEncerrar();
    expect(r.passos).toHaveLength(4);
    expect(execs.some((e) => e.cmd === 'git')).toBe(true);
  });
});
