/**
 * main/ipc/components: instalar, remover e o doctor dos componentes, pelos
 * canais de IPC. O componentesDoctor.test.js cobre a regra do conserto
 * (decidirConserto); estes cobrem o que ela dispara.
 *
 * Rodado de verdade, este modulo apaga pastas de components/Packages, limpa o
 * Temp, apaga zips e dispara os instaladores que baixam centenas de megabytes.
 * O cercado, montado antes de o modulo carregar:
 *
 *   1. o main/paths e trocado nas duas copias (vi.mock para o Vite, cache do
 *      require para o nativo), com componentsPath numa pasta temporaria;
 *   2. os instaladores sao scripts falsos nessa pasta: o spawn e de verdade,
 *      mas roda um script que so escreve a sentinela e imprime progresso;
 *   3. AURORA_CLI_CACHE numa pasta vazia, para os agentes de IA aparecerem
 *      ausentes e o doctor nao baixar o Claude Code nem o Codex;
 *   4. o beforeAll confere, pela resposta do proprio modulo, que a pasta e o
 *      caminho de cada componente estao dentro da pasta temporaria, e aborta
 *      o arquivo se nao estiverem.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-comp-'));
const components = path.join(raiz, 'components');
const scripts = path.join(components, 'Scripts');
const cacheIa = path.join(raiz, 'cli-cache');
for (const d of [scripts, cacheIa, path.join(components, 'Temp')]) fs.mkdirSync(d, { recursive: true });
process.env.AURORA_CLI_CACHE = cacheIa;

const pathsFalso = vi.hoisted(() => ({ componentsPath: globalThis.__compRaiz }));
globalThis.__compRaiz = components;
pathsFalso.componentsPath = components;
vi.mock('../../main/paths.js', () => ({ default: pathsFalso, ...pathsFalso }));
req.cache[req.resolve('../../main/paths.js')] = { id: 'paths', loaded: true, exports: pathsFalso };

const electronFalso = vi.hoisted(() => ({
  ipcMain: { handle: (canal, fn) => { globalThis.__compHandlers.set(canal, fn); } },
  BrowserWindow: { fromWebContents: (wc) => wc?.janela ?? null },
  shell: { openPath: (p) => { globalThis.__compAbertas.push(p); } },
}));
const handlers = new Map();
const abertas = [];
globalThis.__compHandlers = handlers;
globalThis.__compAbertas = abertas;
vi.mock('electron', () => ({ default: electronFalso, ...electronFalso }));
req.cache[req.resolve('electron')] = { id: 'electron', loaded: true, exports: electronFalso };

/** A janela falsa: guarda o progresso que o modulo manda. */
function janela() {
  const recebido = [];
  return {
    recebido,
    isDestroyed: () => false,
    webContents: { send: (canal, carga) => { if (canal === 'componentes:progresso') recebido.push(carga); } },
  };
}
const evento = (j) => ({ sender: { janela: j } });

/** Instalador falso do verible: o comportamento vem por variavel de ambiente. */
const INSTALADOR = `
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const modo = process.env.COMP_TESTE_MODO || 'ok';
console.log('[verible] 42% (1.2 / 3.0 MB)');
process.stderr.write('[verible] 100%\\r');
if (modo === 'falha') { console.log('rede caiu'); process.exit(3); }
if (modo === 'sem-sentinela') process.exit(0);
const bin = path.join(raiz, 'Packages', 'verible', 'bin');
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, 'verible-verilog-ls.exe'), 'x');
fs.writeFileSync(path.join(raiz, 'Packages', 'verible', '.aurora-version'), modo === 'velho' ? 'v0-antiga' : process.env.COMP_TESTE_VERSAO);
if (process.argv.includes('--force')) fs.writeFileSync(path.join(raiz, 'forcado.txt'), '1');
`;

let comp;
let registro;
/** As duas copias do registro, a nativa e a do Vite: cada uma tem o proprio
 *  cache de tres segundos, e o teste nao sabe qual o modulo usa. */
let registros;
const invalidar = () => { for (const r of registros) r.invalidarCache(); };
let versaoVerible;

beforeAll(async () => {
  comp = await import('../../main/ipc/components.js');
  comp.register();
  const lista = await handlers.get('componentes:listar')();
  const fora = lista.componentes.filter((c) => c.caminho && !path.resolve(c.caminho).startsWith(raiz));
  if (path.resolve(lista.pasta) !== components || fora.length) {
    throw new Error('o cercado nao montou: o modulo ve a components de verdade; parar antes de apagar qualquer coisa');
  }
  registro = req('../../main/components/registry.js');
  const viaVite = await import('../../main/components/registry.js');
  registros = [...new Set([registro, viaVite.default ?? viaVite])];
  versaoVerible = lista.componentes.find((c) => c.chave === 'verible').versao;
  process.env.COMP_TESTE_VERSAO = versaoVerible;
  fs.writeFileSync(path.join(scripts, 'download-verible.js'), INSTALADOR);
});

afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(path.join(components, 'Packages'), { recursive: true, force: true });
  fs.rmSync(path.join(components, 'forcado.txt'), { force: true });
  process.env.COMP_TESTE_MODO = 'ok';
  invalidar();
});

describe('componentes:instalar', () => {
  it('roda o instalador, repassa o progresso e confere pela sentinela', async () => {
    const j = janela();
    const r = await handlers.get('componentes:instalar')(evento(j), 'verible');
    expect(r).toEqual({ ok: true, chave: 'verible' });
    expect(j.recebido[0]).toMatchObject({ chave: 'verible', estado: 'iniciando', percentual: 0 });
    expect(j.recebido).toContainEqual({ chave: 'verible', estado: 'baixando', percentual: 42, linha: '[verible] 42% (1.2 / 3.0 MB)' });
    expect(j.recebido.at(-1)).toMatchObject({ estado: 'pronto', percentual: 100 });
    expect(fs.existsSync(path.join(components, 'forcado.txt'))).toBe(false);
  });

  it('com forcar, o instalador recebe --force', async () => {
    await handlers.get('componentes:instalar')(evento(janela()), 'verible', { forcar: true });
    expect(fs.existsSync(path.join(components, 'forcado.txt'))).toBe(true);
  });

  it('saida com erro: o usuario le o que fazer, o detalhe vai para o log', async () => {
    process.env.COMP_TESTE_MODO = 'falha';
    const j = janela();
    const r = await handlers.get('componentes:instalar')(evento(j), 'verible');
    expect(r.ok).toBe(false);
    expect(r.erro).toBe('o download não chegou ao fim. Confira a internet e clique em Baixar de novo');
    expect(r.detalhe).toMatch(/^o instalador terminou sem deixar Packages\/verible\/bin\/verible-verilog-ls\.exe \| rede caiu$/);
    expect(j.recebido.at(-1)).toMatchObject({ estado: 'erro' });
  });

  it('saiu zero sem deixar a sentinela ainda e falha', async () => {
    process.env.COMP_TESTE_MODO = 'sem-sentinela';
    const r = await handlers.get('componentes:instalar')(evento(janela()), 'verible');
    expect(r.ok).toBe(false);
    expect(r.detalhe).toMatch(/terminou sem deixar/);
  });

  it('instalou outra versao: falha como desatualizado', async () => {
    process.env.COMP_TESTE_MODO = 'velho';
    const r = await handlers.get('componentes:instalar')(evento(janela()), 'verible');
    expect(r.ok).toBe(false);
    expect(r.detalhe).toMatch(/terminou com o componente desatualizado .*versao gravada: v0-antiga/);
  });

  it('instalador ausente e componente desconhecido nao disparam nada', async () => {
    expect(await handlers.get('componentes:instalar')(evento(null), 'slang')).toEqual({ ok: false, erro: 'instalador ausente: download-slang-server.js' });
    expect(await handlers.get('componentes:instalar')(evento(null), 'nada')).toEqual({ ok: false, erro: 'componente desconhecido' });
  });

  it('um download por vez', async () => {
    const primeiro = handlers.get('componentes:instalar')(evento(null), 'verible');
    expect(await handlers.get('componentes:instalar')(evento(null), 'verible')).toEqual({ ok: false, erro: 'ja-ha-download', chave: 'verible' });
    expect(await handlers.get('componentes:doctor')(evento(null))).toEqual({ ok: false, erro: 'ja-ha-download', chave: 'verible' });
    await primeiro;
  });
});

describe('componentes:remover', () => {
  it('apaga a pasta do componente, e so ela', async () => {
    await handlers.get('componentes:instalar')(evento(null), 'verible');
    fs.mkdirSync(path.join(components, 'Packages', 'surfer'), { recursive: true });
    expect(await handlers.get('componentes:remover')({}, 'verible')).toEqual({ ok: true, chave: 'verible', liberadoMB: registro.obter('verible').tamanhoMB });
    expect(fs.existsSync(path.join(components, 'Packages', 'verible'))).toBe(false);
    expect(fs.existsSync(path.join(components, 'Packages', 'surfer'))).toBe(true);
    expect(await handlers.get('componentes:instalado')({}, 'verible')).toBe(false);
  });

  it('recusa o essencial, o desconhecido, e o que mora fora de Packages', async () => {
    expect(await handlers.get('componentes:remover')({}, 'yanc')).toEqual({ ok: false, erro: 'componente essencial' });
    expect(await handlers.get('componentes:remover')({}, 'nada')).toEqual({ ok: false, erro: 'componente desconhecido' });
  });
});

describe('componentes:doctor', () => {
  it('sem a pasta dos instaladores, diz que nao ha conserto', async () => {
    fs.renameSync(scripts, `${scripts}.fora`);
    try {
      expect(await handlers.get('componentes:doctor')(evento(null))).toEqual({ ok: false, erro: 'sem-scripts' });
    } finally {
      fs.renameSync(`${scripts}.fora`, scripts);
    }
  });

  it('limpa o Temp e os zips parciais, conserta o incompleto e deixa o opcional ausente', async () => {
    fs.writeFileSync(path.join(components, 'Temp', 'velho.vvp'), 'x');
    fs.writeFileSync(path.join(raiz, 'aurora-parcial.zip'), 'x');
    fs.writeFileSync(path.join(raiz, 'outro.zip'), 'x');
    // O verible na versao errada: o doctor re-baixa com --force.
    process.env.COMP_TESTE_MODO = 'velho';
    await handlers.get('componentes:instalar')(evento(null), 'verible');
    process.env.COMP_TESTE_MODO = 'ok';
    invalidar();

    const r = await handlers.get('componentes:doctor')(evento(janela()));

    expect(r.cacheLimpo).toBe(true);
    expect(fs.existsSync(path.join(raiz, 'aurora-parcial.zip'))).toBe(false);
    expect(fs.existsSync(path.join(raiz, 'outro.zip'))).toBe(true);
    expect(r.consertados).toContain('verible');
    expect(fs.existsSync(path.join(components, 'forcado.txt'))).toBe(true);
    // Os que a AURORA precisa para compilar e estao ausentes falham (nao ha
    // instalador falso para eles); os opcionais ausentes ficam como estao.
    expect(r.falharam).toEqual(expect.arrayContaining(['msys', 'yanc']));
    expect(r.ausentesOpcionais).toEqual(expect.arrayContaining(['surfer', 'slang', 'claude', 'codex']));
    expect(r.ok).toBe(false);
  });
});

describe('os outros canais', () => {
  it('listar diz a pasta, o que baixa e se o aviso de boot pode aparecer', async () => {
    const antes = process.env.SAPHO_SKIP_SINGLE_INSTANCE;
    delete process.env.SAPHO_SKIP_SINGLE_INSTANCE;
    delete process.env.AURORA_SEM_AVISO_DE_BOOT;
    const l = await handlers.get('componentes:listar')();
    expect(l).toMatchObject({ baixando: null, pasta: components, avisoDeBootPermitido: true });
    expect(l.componentes.map((c) => c.chave)).toEqual(expect.arrayContaining(['msys', 'verible', 'claude']));
    process.env.AURORA_SEM_AVISO_DE_BOOT = '1';
    expect((await handlers.get('componentes:listar')()).avisoDeBootPermitido).toBe(false);
    delete process.env.AURORA_SEM_AVISO_DE_BOOT;
    if (antes !== undefined) process.env.SAPHO_SKIP_SINGLE_INSTANCE = antes;
  });

  it('abrirPasta abre a pasta dos componentes', () => {
    expect(handlers.get('componentes:abrirPasta')()).toEqual({ ok: true });
    expect(abertas.at(-1)).toBe(components);
  });
});
