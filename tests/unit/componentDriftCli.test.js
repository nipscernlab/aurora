/**
 * O guarda de deriva (scripts/check-component-drift) rodado como o workflow
 * semanal o roda: le a tag fixada de cada download-*.js, consulta o upstream e
 * imprime o relatorio, o JSON ou o corpo da issue. O decisor puro (evaluate)
 * tem o teste dele em componentDrift.test.js; aqui fica o resto.
 *
 * A rede e o fetch global falso, com a FORMA das duas APIs (lista de releases
 * do GitHub, lista de pacotes do GitLab). Os download-*.js sao falsos, no cache
 * do require nativo, para a tag fixada ser a do caso.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'check-component-drift.mts');
const SCRIPTS = path.join(RAIZ, 'components', 'Scripts');
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** O unico ponto que sabe como o script e rodado como programa. */
const chamar = {
  // O .mts roda o main quando process.argv[1] e ele (o rodar() abaixo o poe).
  rodar: async () => {
    vi.resetModules();
    await import(pathToFileURL(SCRIPT).href);
  },
  comoModulo: async () => {
    vi.resetModules();
    return import(pathToFileURL(SCRIPT).href);
  },
};

const TAGS = {
  toolchain: ['download-toolchain.js', 'MSYS_TAG'],
  yanc: ['download-yanc.js', 'YANC_TAG'],
  gtkwave: ['download-gtkwave-nipscern.js', 'GTKWAVE_TAG'],
  surfer: ['download-surfer.js', null],
  verible: ['download-verible.js', 'VERIBLE_TAG'],
  slang: ['download-slang-server.js', 'SLANG_SERVER_TAG'],
  'clang-format': ['download-clang-format.js', 'CLANG_FORMAT_TAG'],
};

/** Fixa as tags do caso; `null` num componente faz o require dele lancar. */
function fixar(tags) {
  for (const [chave, [arquivo, campo]] of Object.entries(TAGS)) {
    const p = path.join(SCRIPTS, arquivo);
    const tag = tags[chave];
    const exports = tag === null
      ? new Proxy({}, { get() { throw new Error(`modulo ${chave} quebrado`); } })
      : campo ? { [campo]: tag } : { FORK_ARTIFACT: tag === undefined ? null : { tag } };
    req.cache[p] = { id: p, filename: p, loaded: true, children: [], paths: [], exports };
  }
}

/** As respostas do upstream por URL; um Error vira falha de rede, um numero vira HTTP != 2xx. */
let respostas;
let pedidos;
let log;
let erros;
let exit;
const argvOriginal = process.argv;
const envOriginal = { ...process.env };
const ttyOriginal = process.stdout.isTTY;

const gh = (repo) => `https://api.github.com/repos/${repo}/releases?per_page=30`;
const GITLAB = 'https://gitlab.com/api/v4/projects/84576006/packages?package_type=generic&order_by=created_at&sort=desc&per_page=50';
const rel = (tag, extra = {}) => ({ tag_name: tag, published_at: '2026-09-20T10:00:00Z', ...extra });

beforeEach(() => {
  respostas = {};
  pedidos = [];
  log = [];
  erros = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    pedidos.push({ url, headers: opts?.headers });
    const r = respostas[url];
    if (r instanceof Error) throw r;
    if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => (r === undefined ? [] : r) };
  }));
  vi.spyOn(console, 'log').mockImplementation((...a) => { log.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { erros.push(a.join(' ')); });
  exit = vi.spyOn(process, 'exit').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.argv = argvOriginal;
  for (const k of Object.keys(process.env)) if (!(k in envOriginal)) delete process.env[k];
  Object.assign(process.env, envOriginal);
  Object.defineProperty(process.stdout, 'isTTY', { value: ttyOriginal, configurable: true, writable: true });
});

async function rodar(args = [], { tty = false, env = {} } = {}) {
  process.argv = [argvOriginal[0], SCRIPT, ...args];
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.NO_COLOR;
  Object.assign(process.env, env);
  Object.defineProperty(process.stdout, 'isTTY', { value: tty, configurable: true, writable: true });
  await chamar.rodar();
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}

const saida = () => log.map((l) => l.replace(ANSI, '')).join('\n');

/** Um componente em cada estado. */
function mundoMisturado() {
  fixar({
    toolchain: 'msys-v2', yanc: 'v5.4', gtkwave: 'v0.1.2-nipscern', surfer: 'v0.7.0-nips.2',
    verible: 'nao-casa', slang: 'v0.3', 'clang-format': 'master-abc1234',
  });
  respostas[gh('nipscernlab/aurora-toolchain')] = [rel('pins-9'), rel('msys-v3'), rel('msys-v3-rc', { draft: true }), rel('msys-v2')];
  respostas[gh('nipscernlab/yanc')] = [{ tag_name: 'v5.6' }, rel('v5.5'), rel('v5.4', { published_at: null, created_at: '2026-01-01T00:00:00Z' })];
  respostas[gh('nipscernlab/gtkwave-nipscern')] = [rel('v0.1.2-nipscern')];
  respostas[GITLAB] = [
    { name: 'outro', version: 'v9.9.9-nips.1', created_at: '2026-09-28T00:00:00Z' },
    { name: 'surfer-aurora', version: 'v0.7.0-nips.7', created_at: '2026-07-24T00:00:00Z' },
    { name: 'surfer-aurora', version: 'v0.7.0-nips.1' },
  ];
  respostas[gh('hudson-trading/slang-server')] = 403;
  respostas[gh('muttleyxd/clang-tools-static-binaries')] = [rel('v1.0')];
}

describe('o relatorio no terminal', () => {
  it('um bloco por componente, com o selo, o escopo e o detalhe de cada estado', async () => {
    mundoMisturado();
    await rodar();
    const s = saida();
    expect(s).toContain('Componentes fixados x o que o upstream publicou');
    expect(s).toMatch(/\[ ATRAS {2}\] {2}toolchain {5}nosso\n {12}Toolchain MSYS\/mingw64\n {12}fixado msys-v2 -> publicado msys-v3 \(2026-09-20\), 1 versao atras/);
    expect(s).toContain('fixado v5.4 -> publicado v5.6 (sem data), 2 versoes atras');
    expect(s).toMatch(/\[ EM DIA \] {2}gtkwave {7}nosso\n.*\n {12}v0\.1\.2-nipscern/);
    expect(s).toContain('fixado v0.7.0-nips.2 NAO esta publicado; o mais novo e v0.7.0-nips.7');
    expect(s).toContain('o bootstrap vai falhar em maquina limpa');
    expect(s).toMatch(/\[ CONFIG \] {2}verible {7}terceiro/);
    expect(s).toContain('a tag fixada nao-casa nao casa com a familia declarada');
    expect(s).toContain('e bug de configuracao do check-component-drift.js, nao deriva');
    expect(s).toContain(`HTTP 403 em ${gh('hudson-trading/slang-server')}`);
    expect(s).toMatch(/\[ {3}\? {4}\] {2}clang-format/);
    expect(s).toContain('sem base de comparacao');
    expect(s).toContain('1 em dia   2 atras   1 sumidos   1 config   1 erro');
    expect(exit).not.toHaveBeenCalled();
  });

  it('tag fixada vazia, modulo que nao carrega, e rede fora', async () => {
    fixar({ toolchain: null, yanc: 'v5.6', surfer: undefined });
    respostas[gh('nipscernlab/yanc')] = new Error('getaddrinfo ENOTFOUND');
    await rodar(['--only', 'toolchain,yanc,surfer']);
    const s = saida();
    expect(s).toContain('nao consegui ler a tag fixada: modulo toolchain quebrado');
    expect(s).toContain('getaddrinfo ENOTFOUND');
    expect(s).toContain('sem tag fixada (componente desligado neste momento)');
    expect(s).toContain('0 em dia   0 atras   0 sumidos   0 config   2 erro');
    expect(pedidos.map((p) => p.url)).toEqual([gh('nipscernlab/yanc')]);
  });

  it('colorido so com terminal e sem NO_COLOR', async () => {
    fixar({ gtkwave: 'v0.1.2-nipscern' });
    respostas[gh('nipscernlab/gtkwave-nipscern')] = [rel('v0.1.2-nipscern')];
    await rodar(['--only', 'gtkwave'], { tty: true });
    expect(log.join('\n')).toContain(`${String.fromCharCode(27)}[32m[ EM DIA ]`);
    log = [];
    await rodar(['--only', 'gtkwave'], { tty: true, env: { NO_COLOR: '1' } });
    expect(log.join('\n')).not.toContain(String.fromCharCode(27));
  });
});

describe('a consulta ao upstream', () => {
  it('GitHub: a lista de releases, com o token quando existe; GitLab: os pacotes do nome', async () => {
    mundoMisturado();
    await rodar(['--json'], { env: { GH_TOKEN: 'tok-gh' } });
    const yanc = pedidos.find((p) => p.url === gh('nipscernlab/yanc'));
    expect(yanc.headers).toEqual({ 'User-Agent': 'aurora-component-drift', Accept: 'application/vnd.github+json', Authorization: 'Bearer tok-gh' });
    expect(pedidos.find((p) => p.url === GITLAB).headers).toEqual({ 'User-Agent': 'aurora-component-drift' });

    pedidos = [];
    await rodar(['--json', '--only', 'yanc'], { env: { GITHUB_TOKEN: 'tok-1', GH_TOKEN: 'tok-2' } });
    expect(pedidos[0].headers.Authorization).toBe('Bearer tok-1');
    pedidos = [];
    await rodar(['--json', '--only', 'yanc']);
    expect(pedidos[0].headers).not.toHaveProperty('Authorization');
  });

  it('resposta que nao e lista conta como lista vazia', async () => {
    fixar({ yanc: 'v5.6', surfer: 'v0.7.0-nips.7' });
    respostas[gh('nipscernlab/yanc')] = { message: 'Not Found' };
    respostas[GITLAB] = { message: 'x' };
    await rodar(['--json', '--only', 'yanc,surfer']);
    expect(JSON.parse(log.join('\n')).map((r) => r.status)).toEqual(['unknown', 'unknown']);
  });
});

describe('--json', () => {
  it('as linhas inteiras, na ordem da tabela', async () => {
    mundoMisturado();
    await rodar(['--json']);
    const linhas = JSON.parse(log.join('\n'));
    expect(linhas.map((r) => [r.key, r.status, r.behind])).toEqual([
      ['toolchain', 'behind', 1], ['yanc', 'behind', 2], ['gtkwave', 'ok', 0], ['surfer', 'absent', 0],
      ['verible', 'bad-family', 0], ['slang', 'error', 0], ['clang-format', 'unknown', 0],
    ]);
    expect(linhas[0]).toEqual({
      key: 'toolchain', label: 'Toolchain MSYS/mingw64', ours: true, pinned: 'msys-v2',
      latest: 'msys-v3', latestDate: '2026-09-20', behind: 1, status: 'behind', error: null,
    });
    expect(linhas[1].latestDate).toBe(null);
    expect(linhas[3]).toMatchObject({ latest: 'v0.7.0-nips.7', latestDate: '2026-07-24' });
  });
});

describe('--markdown, o corpo da issue', () => {
  it('a tabela dos problemas, o que nao deu para consultar e o que esta em dia', async () => {
    mundoMisturado();
    await rodar(['--markdown']);
    const md = log.join('\n');
    expect(md).toContain('Gerado por `scripts/check-component-drift.js`, do workflow semanal.');
    expect(md).toContain('| nosso | `toolchain` | `msys-v2` | `msys-v3` | 1 atrás (2026-09-20) |');
    expect(md).toContain('| nosso | `yanc` | `v5.4` | `v5.6` | 2 atrás (sem data) |');
    expect(md).toContain('| nosso | `surfer` | `v0.7.0-nips.2` | `v0.7.0-nips.7` | fixado NÃO está publicado — bootstrap falha em máquina limpa |');
    expect(md).toContain('| terceiro | `verible` | `nao-casa` | `—` | a tag fixada não casa com a família declarada; é bug do guarda |');
    expect(md).toContain(`- \`slang\`: HTTP 403 em ${gh('hudson-trading/slang-server')}`);
    expect(md).toContain('Em dia: `gtkwave`.');
  });

  it('sem problema nem erro: nada atrasado, e so a lista dos em dia', async () => {
    fixar({ gtkwave: 'v0.1.2-nipscern' });
    respostas[gh('nipscernlab/gtkwave-nipscern')] = [rel('v0.1.2-nipscern')];
    await rodar(['--markdown', '--only', 'gtkwave', '--fail-on-drift']);
    const md = log.join('\n');
    expect(md).toContain('Nada atrasado nesta rodada.');
    expect(md).not.toContain('Não deu para consultar');
    expect(exit).not.toHaveBeenCalled();

    log = [];
    fixar({ yanc: 'v5.6' });
    respostas[gh('nipscernlab/yanc')] = 500;
    await rodar(['--markdown', '--only', 'yanc']);
    expect(log.join('\n')).not.toContain('Em dia:');
  });
});

describe('a saida do processo', () => {
  it('--fail-on-drift sai com 1 quando ha deriva; erro de rede nao conta', async () => {
    mundoMisturado();
    await rodar(['--json', '--fail-on-drift']);
    expect(exit).toHaveBeenCalledWith(1);

    exit.mockClear();
    fixar({ slang: 'v0.3' });
    respostas[gh('hudson-trading/slang-server')] = 403;
    await rodar(['--json', '--only', 'slang', '--fail-on-drift']);
    expect(exit).not.toHaveBeenCalled();
  });

  it('o guarda que quebra sai com 2 e a pilha', async () => {
    fixar({ gtkwave: 'v0.1.2-nipscern' });
    console.log.mockImplementation(() => { throw new Error('stdout fechado'); });
    await rodar(['--only', 'gtkwave']);
    expect(erros.join('\n')).toContain('[drift] falhou: Error: stdout fechado');
    expect(exit).toHaveBeenCalledWith(2);
  });

  it('carregado como modulo, nao roda nada', async () => {
    fixar({});
    const mod = await chamar.comoModulo();
    expect(Object.keys(mod).sort()).toEqual(['COMPONENTS', 'evaluate', 'renderMarkdown']);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });
});
