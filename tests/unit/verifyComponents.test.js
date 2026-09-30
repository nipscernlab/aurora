/**
 * O "doctor" dos componentes (scripts/verify-components): o relatorio, os
 * modos sem pergunta, o interativo e o do postinstall.
 *
 * O script roda o main ao ser carregado, entao cada caso monta o mundo e o
 * importa de novo. O mundo e:
 *   - os download-*.js de components/Scripts, falsos, no cache do require
 *     nativo (o script os le por require para saber a tag e a sentinela);
 *   - o fs espionado so no manifesto de versoes e nas sentinelas, para nao
 *     tocar o components/.aurora-versions.json de quem roda o teste;
 *   - o spawnSync TRAVADO antes de tudo, com prova, porque o de verdade
 *     rodaria os downloads;
 *   - o readline falso, com as respostas de cada caso.
 */
import { createRequire, syncBuiltinESMExports } from 'node:module';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── a trava do spawnSync, antes de qualquer carga do script ──────────────────
const spawnFalso = vi.fn();
cp.spawnSync = spawnFalso;
syncBuiltinESMExports();

const req = createRequire(import.meta.url);
/** As sequencias de cor do terminal (ESC [ ... m). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'verify-components.mts');
const SCRIPTS = path.join(RAIZ, 'components', 'Scripts');
const MANIFESTO = path.join(RAIZ, 'components', '.aurora-versions.json');

/** O unico ponto que sabe como o script e carregado. */
const chamar = {
  carregar: () => import(pathToFileURL(SCRIPT).href),
};

beforeAll(async () => {
  // A prova: pelos dois caminhos por onde o script pode pegar o spawnSync.
  expect(req('child_process').spawnSync).toBe(spawnFalso);
  const { spawnSync } = await import('node:child_process');
  expect(spawnSync).toBe(spawnFalso);
});

// ── o mundo ───────────────────────────────────────────────────────────────────
const sentinela = (k) => path.join(RAIZ, 'components', 'teste-sentinela', k);
let mundo;

function mundoPadrao() {
  return {
    presente: { toolchain: true, yanc: true, gtkwave: true, surfer: true, verible: true, slang: true, 'clang-format': true },
    yancInstalado: 'v5.6',
    cocotb: true,
    publicado: true,
    manifesto: JSON.stringify({ gtkwave: 'g1', verible: 'v1', slang: 's1', 'clang-format': 'c1', toolchain: 't1', surfer: 'f1' }),
    gravacaoFalha: false,
    gravacoes: [],
    sentinelasDepois: new Set(Object.keys({ toolchain: 1, yanc: 1, gtkwave: 1, surfer: 1, verible: 1, slang: 1, 'clang-format': 1 })),
    statusDoSpawn: 0,
    spawnLanca: false,
    respostas: [],
    perguntas: [],
    quebrar: {},
  };
}

/** Um download-*.js falso; `quebrar[chave]` faz o require dele lancar. */
function modulo(chave, campos) {
  return new Proxy(campos, {
    get(alvo, nome) {
      if (mundo.quebrar[chave]) throw new Error(`modulo ${chave} quebrado`);
      return alvo[nome];
    },
  });
}

function injetar(arquivo, exports) {
  const p = path.join(SCRIPTS, arquivo);
  req.cache[p] = { id: p, filename: p, loaded: true, children: [], paths: [], exports };
}

injetar('download-toolchain.js', modulo('toolchain', {
  MSYS_TAG: 't1', MSYS_SENTINEL: sentinela('toolchain'),
  bundleInstalled: () => mundo.presente.toolchain,
  cocotbInstalled: () => mundo.cocotb,
}));
injetar('download-yanc.js', modulo('yanc', {
  YANC_TAG: 'v5.6', SENTINEL_FILE: sentinela('yanc'),
  binariesPresent: () => mundo.presente.yanc,
  installedTag: () => mundo.yancInstalado,
}));
injetar('download-gtkwave-nipscern.js', modulo('gtkwave', {
  GTKWAVE_TAG: 'g1', SENTINEL_FILE: sentinela('gtkwave'), alreadyInstalled: () => mundo.presente.gtkwave,
}));
injetar('download-surfer.js', modulo('surfer', {
  FORK_ARTIFACT: { tag: 'f1' }, SENTINEL_FILE: sentinela('surfer'), alreadyInstalled: () => mundo.presente.surfer,
  get PUBLISHED() { return mundo.publicado; },
}));
injetar('download-verible.js', modulo('verible', {
  VERIBLE_TAG: 'v1', SENTINEL_FILE: sentinela('verible'), alreadyInstalled: () => mundo.presente.verible,
}));
injetar('download-slang-server.js', modulo('slang', {
  SLANG_SERVER_TAG: 's1', SENTINEL_FILE: sentinela('slang'), alreadyInstalled: () => mundo.presente.slang,
}));
injetar('download-clang-format.js', modulo('clang-format', {
  CLANG_FORMAT_TAG: 'c1', SENTINEL_FILE: sentinela('clang-format'),
  alreadyInstalled: () => {
    if (mundo.presente['clang-format'] === 'lanca') throw new Error('sonda quebrou');
    return mundo.presente['clang-format'];
  },
}));

let log;
let erros;
let exit;
const envOriginal = { ...process.env };
const argvOriginal = process.argv;
const ttyOriginal = { out: process.stdout.isTTY, in: process.stdin.isTTY };

beforeEach(() => {
  mundo = mundoPadrao();
  log = [];
  erros = [];
  spawnFalso.mockReset().mockImplementation((exe, args) => {
    if (mundo.spawnLanca) throw new Error('spawn quebrou');
    const chave = Object.entries({
      'download-toolchain.js': 'toolchain', 'download-yanc.js': 'yanc', 'download-gtkwave-nipscern.js': 'gtkwave',
      'download-surfer.js': 'surfer', 'download-verible.js': 'verible', 'download-slang-server.js': 'slang',
      'download-clang-format.js': 'clang-format',
    }).find(([f]) => args[0].endsWith(f))[1];
    mundo.baixados = [...(mundo.baixados || []), { chave, args: args.slice(1) }];
    return { status: mundo.statusDoSpawn };
  });
  const read = fs.readFileSync.bind(fs);
  const exists = fs.existsSync.bind(fs);
  vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...r) => {
    if (p === MANIFESTO) {
      if (mundo.manifesto === null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return mundo.manifesto;
    }
    return read(p, ...r);
  });
  vi.spyOn(fs, 'writeFileSync').mockImplementation((p, dado) => {
    if (p !== MANIFESTO) throw new Error(`gravacao inesperada: ${p}`);
    if (mundo.gravacaoFalha) throw new Error('disco cheio');
    mundo.manifesto = dado;
    mundo.gravacoes.push(JSON.parse(dado));
  });
  vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    if (typeof p === 'string' && p.startsWith(sentinela(''))) return mundo.sentinelasDepois.has(path.basename(p));
    return exists(p);
  });
  vi.spyOn(readline, 'createInterface').mockImplementation(() => {
    if (mundo.readlineLanca) throw new Error('sem terminal');
    return {
      question: (q, cb) => { mundo.perguntas.push(q.replace(ANSI, '')); cb(mundo.respostas.shift() ?? ''); },
      close: vi.fn(),
    };
  });
  vi.spyOn(console, 'log').mockImplementation((...a) => { log.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { erros.push(a.join(' ')); });
  exit = vi.spyOn(process, 'exit').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = argvOriginal;
  for (const k of Object.keys(process.env)) if (!(k in envOriginal)) delete process.env[k];
  Object.assign(process.env, envOriginal);
  Object.defineProperty(process.stdout, 'isTTY', { value: ttyOriginal.out, configurable: true, writable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: ttyOriginal.in, configurable: true, writable: true });
});

async function rodar(args = [], { tty = false, env = {} } = {}) {
  process.argv = [argvOriginal[0], SCRIPT, ...args];
  delete process.env.CI;
  delete process.env.AURORA_SKIP_BOOTSTRAP;
  delete process.env.NO_COLOR;
  Object.assign(process.env, env);
  Object.defineProperty(process.stdout, 'isTTY', { value: tty, configurable: true, writable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true, writable: true });
  vi.resetModules();
  await chamar.carregar();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

const semCor = (s) => s.replace(ANSI, '');
const saida = () => log.map(semCor).join('\n');
const baixados = () => (mundo.baixados || []).map((b) => [b.chave, ...b.args].join(' '));

/** Um mundo com um componente em cada estado. */
function mundoMisturado() {
  mundo.presente.toolchain = false;                          // missing
  mundo.cocotb = false;                                      // nota extra
  mundo.yancInstalado = 'v5.5';                              // outdated (marcador nativo)
  mundo.publicado = false;                                   // surfer unavailable
  mundo.manifesto = JSON.stringify({ gtkwave: 'g1' });       // verible sem registro -> semear
  mundo.quebrar.slang = true;                                // error
  mundo.presente['clang-format'] = 'lanca';                  // sonda que lanca -> missing
  mundo.sentinelasDepois = new Set(['toolchain']);           // o download do toolchain acha a sentinela; o do clang nao
}

describe('--json', () => {
  it('cada componente com o seu estado, sem o caminho do script e com a sentinela relativa', async () => {
    mundoMisturado();
    await rodar(['--json']);
    const { components } = JSON.parse(log.join('\n'));
    const porChave = Object.fromEntries(components.map((c) => [c.key, c]));
    expect(Object.keys(porChave)).toEqual(['toolchain', 'yanc', 'gtkwave', 'surfer', 'verible', 'slang', 'clang-format']);
    expect(porChave.toolchain).toMatchObject({ status: 'missing', pinnedTag: 't1', installedVer: null, recorded: false, extraNote: 'cocotb ausente (fluxo cocotb indisponivel)', sentinel: 'components/teste-sentinela/toolchain' });
    expect(porChave.yanc).toMatchObject({ status: 'outdated', installedVer: 'v5.5', pinnedTag: 'v5.6', recorded: false });
    expect(porChave.gtkwave).toMatchObject({ status: 'ok', installedVer: 'g1', recorded: true });
    expect(porChave.surfer).toMatchObject({ status: 'unavailable', note: 'nao publicado (build local; nada a baixar)' });
    expect(porChave.verible).toMatchObject({ status: 'ok', needsSeed: true, installedVer: null });
    expect(porChave.slang).toMatchObject({ status: 'error', error: 'modulo slang quebrado', sentinel: '(desconhecida)' });
    expect(porChave['clang-format']).toMatchObject({ status: 'missing' });
    expect(components.every((c) => !('scriptPath' in c))).toBe(true);
    expect(spawnFalso).not.toHaveBeenCalled();
    expect(mundo.gravacoes).toEqual([]);
    expect(mundo.perguntas).toEqual([]);
  });

  it('manifesto ausente, estragado ou nulo conta como vazio', async () => {
    for (const m of [null, '{nao json', 'null']) {
      mundo = mundoPadrao();
      mundo.manifesto = m;
      log = [];
      await rodar(['--json']);
      const { components } = JSON.parse(log.join('\n'));
      expect(components.find((c) => c.key === 'gtkwave')).toMatchObject({ recorded: false, needsSeed: true });
    }
  });

  it('--only restringe aos componentes pedidos', async () => {
    await rodar(['--json', '--only', ' yanc, surfer ,']);
    expect(JSON.parse(log.join('\n')).components.map((c) => c.key)).toEqual(['yanc', 'surfer']);
    log = [];
    await rodar(['--json', '--only']);
    expect(JSON.parse(log.join('\n')).components).toHaveLength(7);
  });
});

describe('--report', () => {
  it('uma linha por componente, com o selo, a versao, os avisos e o resumo', async () => {
    mundoMisturado();
    await rodar(['--report']);
    const s = saida();
    expect(s).toContain('Verificacao de componentes da AURORA');
    expect(s).toMatch(/\[FALTA\]\s+toolchain\s+t1\n/);
    expect(s).toContain('Toolchain MSYS/mingw64 (verilator, iverilog, yosys, g++, python, cocotb)');
    expect(s).toContain('sentinela ausente: components/teste-sentinela/toolchain');
    expect(s).toContain('! cocotb ausente (fluxo cocotb indisponivel)');
    expect(s).toMatch(/\[UPGRADE\]\s+yanc\s+v5\.5 → v5\.6/);
    expect(s).toMatch(/\[ OK \]\s+gtkwave\s+g1\n/);
    expect(s).toMatch(/\[N\/D \]\s+surfer\s+f1\n/);
    expect(s).toContain('nao publicado (build local; nada a baixar)');
    expect(s).toMatch(/\[ OK \]\s+verible\s+v1 \(versao instalada nao registrada\)/);
    expect(s).toMatch(/\[ERRO\]\s+slang\s+—/);
    expect(s).toContain('erro ao ler modulo: modulo slang quebrado');
    expect(s).toContain('2 ok   2 faltando   1 desatualizado   1 n/d   1 erro');
    expect(spawnFalso).not.toHaveBeenCalled();
    expect(mundo.perguntas).toEqual([]);
  });

  it('--check e o mesmo que --report; sem erro o resumo diz 0 erro; sem tag, n/d', async () => {
    await rodar(['--check']);
    expect(saida()).toContain('7 ok   0 faltando   0 desatualizado   0 n/d   0 erro');
    log = [];
    mundo.presente.gtkwave = false;
    mundo.manifesto = '{}';
    req.cache[path.join(SCRIPTS, 'download-gtkwave-nipscern.js')].exports.GTKWAVE_TAG = '';
    try {
      await rodar(['--report', '--only', 'gtkwave']);
    } finally {
      req.cache[path.join(SCRIPTS, 'download-gtkwave-nipscern.js')].exports.GTKWAVE_TAG = 'g1';
    }
    expect(saida()).toMatch(/\[FALTA\]\s+gtkwave\s+n\/d\n/);
  });

  it('com terminal e sem NO_COLOR, sai colorido; com NO_COLOR, nao', async () => {
    await rodar(['--report'], { tty: true });
    expect(log.join('\n')).toContain('\x1b[32m[ OK ]\x1b[0m');
    log = [];
    await rodar(['--report'], { tty: true, env: { NO_COLOR: '1' } });
    expect(log.join('\n')).not.toContain('\x1b[');
  });
});

describe('sem pergunta', () => {
  it('--yes baixa o que falta (sem --force) e atualiza o desatualizado (com --force), e grava a versao', async () => {
    mundoMisturado();
    await rodar(['--yes']);
    expect(baixados()).toEqual(['toolchain', 'yanc --force', 'clang-format']);
    expect(spawnFalso.mock.calls[0][0]).toBe(process.execPath);
    expect(spawnFalso.mock.calls[0][2]).toEqual({ cwd: RAIZ, stdio: 'inherit' });
    const s = saida();
    expect(s).toContain('RUN   toolchain: node components/Scripts/download-toolchain.js');
    expect(s).toContain('RUN   yanc: node components/Scripts/download-yanc.js --force');
    expect(s).toContain('OK    toolchain: t1');
    expect(s).toContain('FALHA yanc: ainda ausente apos a tentativa (veja o log acima)');
    expect(s).toContain('FALHA clang-format: ainda ausente apos a tentativa');
    expect(mundo.gravacoes.at(-1)).toEqual({ gtkwave: 'g1', toolchain: 't1' });
    expect(mundo.perguntas).toEqual([]);
  });

  it('-y com tudo em dia nao baixa nada', async () => {
    await rodar(['-y']);
    expect(saida()).toContain('Nada a baixar (--yes).');
    expect(spawnFalso).not.toHaveBeenCalled();
  });

  it('--force-all rebaixa tudo com --force, menos o indisponivel e o que deu erro', async () => {
    mundoMisturado();
    await rodar(['--force-all']);
    expect(baixados()).toEqual(['toolchain --force', 'yanc --force', 'gtkwave --force', 'verible --force', 'clang-format --force']);
  });

  it('a versao igual a gravada nao regrava; a gravacao que falha so avisa', async () => {
    mundo.sentinelasDepois = new Set(['gtkwave', 'verible']);
    await rodar(['--force-all', '--only', 'gtkwave']);
    expect(mundo.gravacoes).toEqual([]);

    mundo.manifesto = '{}';
    mundo.gravacaoFalha = true;
    await rodar(['--force-all', '--only', 'verible']);
    expect(saida()).toContain('(aviso: nao consegui gravar components/.aurora-versions.json: disco cheio)');
    expect(saida()).toContain('OK    verible: v1');
  });

  it('sem sentinela conhecida, vale o codigo de saida; sem tag, "instalado"', async () => {
    const mod = req.cache[path.join(SCRIPTS, 'download-verible.js')].exports;
    const orig = { sentinela: mod.SENTINEL_FILE, tag: mod.VERIBLE_TAG };
    mod.SENTINEL_FILE = null;
    mod.VERIBLE_TAG = null;
    try {
      await rodar(['--force-all', '--only', 'verible']);
      expect(saida()).toContain('OK    verible: instalado');
      log = [];
      mundo.statusDoSpawn = 1;
      await rodar(['--force-all', '--only', 'verible']);
      expect(saida()).toContain('FALHA verible');
    } finally {
      mod.SENTINEL_FILE = orig.sentinela;
      mod.VERIBLE_TAG = orig.tag;
    }
  });

  it('sem terminal e sem flag, avisa que nao pergunta', async () => {
    await rodar([]);
    expect(saida()).toContain('(sem TTY — sem prompts. Use --yes, --force-all ou --report.)');
    expect(spawnFalso).not.toHaveBeenCalled();
  });

  it('--strict sai com 1 so quando falta algo', async () => {
    await rodar(['--report', '--strict']);
    expect(exit).not.toHaveBeenCalled();
    mundo.presente.yanc = false;
    await rodar(['--report', '--strict']);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('interativo', () => {
  it('semeia o registro, pergunta um a um, e oferece rebaixar os que estao em dia', async () => {
    mundoMisturado();
    mundo.sentinelasDepois = new Set(['toolchain', 'gtkwave']);
    // toolchain: sim; yanc: nao; clang: sim; forcar: sim; gtkwave: sim; verible: nao
    mundo.respostas = ['s', 'n', 'yes', 'sim', 'y', ''];
    await rodar([], { tty: true });
    expect(mundo.perguntas).toEqual([
      '  ? Baixar toolchain (versao t1)? [s/N] ',
      '  ? Atualizar yanc (v5.5 → v5.6)? [s/N] ',
      '  ? Baixar clang-format (versao c1)? [s/N] ',
      '  ? Forcar re-download de algum componente ja instalado (para pegar um bump silencioso)? [s/N] ',
      '    ? Re-baixar gtkwave (g1)? [s/N] ',
      '    ? Re-baixar verible (v1)? [s/N] ',
    ]);
    expect(baixados()).toEqual(['toolchain', 'clang-format', 'gtkwave --force']);
    expect(mundo.gravacoes[0]).toEqual({ gtkwave: 'g1', verible: 'v1' });     // a semente vem antes
    const s = saida();
    expect(s).toContain('pulado: yanc');
    expect(s).toContain('pulado: verible');
    expect(s).toContain('Dica: rode de novo com --report pra reconferir o estado.');
  });

  it('recusar o rebaixamento nao pergunta um a um; sem tag, "pinada"', async () => {
    const mod = req.cache[path.join(SCRIPTS, 'download-verible.js')].exports;
    const tag = mod.VERIBLE_TAG;
    mod.VERIBLE_TAG = null;
    mundo.presente.verible = false;
    mundo.respostas = ['n', 'n'];
    try {
      await rodar(['--only', 'verible,gtkwave'], { tty: true });
    } finally { mod.VERIBLE_TAG = tag; }
    expect(mundo.perguntas).toEqual([
      '  ? Baixar verible (versao pinada)? [s/N] ',
      '  ? Forcar re-download de algum componente ja instalado (para pegar um bump silencioso)? [s/N] ',
    ]);
    expect(spawnFalso).not.toHaveBeenCalled();

    mundo = mundoPadrao();
    mundo.respostas = ['s', 's'];
    mod.VERIBLE_TAG = null;
    try {
      await rodar(['--only', 'verible'], { tty: true });
    } finally { mod.VERIBLE_TAG = tag; }
    expect(mundo.perguntas.at(-1)).toBe('    ? Re-baixar verible (pinada)? [s/N] ');
  });

  it('so indisponivel ou erro: nada a fazer, sem abrir o terminal', async () => {
    mundo.publicado = false;
    await rodar(['--only', 'surfer'], { tty: true });
    expect(saida()).toContain('Nada a fazer.');
    expect(readline.createInterface).not.toHaveBeenCalled();
  });

  it('o terminal que nao abre derruba o main com a pilha, e sai com 1', async () => {
    mundo.readlineLanca = true;
    await rodar([], { tty: true });
    expect(erros.join('\n')).toContain('verify-components falhou: Error: sem terminal');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('--postinstall', () => {
  it('em CI ou com AURORA_SKIP_BOOTSTRAP, nao faz nada', async () => {
    mundo.presente.yanc = false;
    await rodar(['--postinstall'], { env: { CI: 'true' } });
    await rodar(['--postinstall'], { env: { AURORA_SKIP_BOOTSTRAP: '1' } });
    expect(log).toEqual([]);
    expect(spawnFalso).not.toHaveBeenCalled();
  });

  it('tudo em dia: uma linha so, e semeia o registro', async () => {
    mundo.manifesto = '{}';
    await rodar(['--postinstall']);
    expect(saida()).toBe('  [aurora] componentes: OK (nada a baixar)');
    expect(mundo.gravacoes.at(-1)).toEqual({ toolchain: 't1', gtkwave: 'g1', surfer: 'f1', verible: 'v1', slang: 's1', 'clang-format': 'c1' });
  });

  it('baixa o que falta e atualiza o bump; um download que lanca nao para os outros', async () => {
    mundoMisturado();
    await rodar(['--postinstall', '--strict']);
    const s = saida();
    expect(s).toContain('[aurora] 2 componente(s) faltando — baixando...');
    expect(s).toContain('[aurora] 1 componente(s) com bump de versao — atualizando...');
    expect(baixados()).toEqual(['toolchain', 'clang-format', 'yanc --force']);
    expect(s).toContain('[aurora] pronto. (rode "npm run components:verify" pra conferir/atualizar)');
    expect(exit).not.toHaveBeenCalled();

    log = [];
    mundo = mundoPadrao();
    mundo.presente.yanc = false;
    mundo.spawnLanca = true;
    await rodar(['--postinstall']);
    expect(saida()).toContain('[aurora] falha em yanc: spawn quebrou');
    expect(saida()).not.toContain('com bump');
  });
});
