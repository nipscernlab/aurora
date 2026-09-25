/**
 * main/ipc/git: os canais do painel Git contra repositorios de verdade, numa
 * pasta temporaria. O gitParse.test.js cobre as funcoes puras e o
 * gitPorJanela.test.js a regra de qual projeto cada janela ve; estes cobrem os
 * handlers, que nao tinham teste nenhum.
 *
 * Sem rede e sem tocar na configuracao do git de quem roda: o remoto e um
 * repositorio bare local (clone, push, fetch e pull vao ate ele pelo disco),
 * GIT_CONFIG_GLOBAL aponta para um arquivo vazio e GIT_CONFIG_NOSYSTEM desliga
 * o do sistema, entao assinatura de commit, hooks e helpers de credencial do
 * ~/.gitconfig nao entram e nada e gravado nele. O userData do Electron falso e
 * uma pasta temporaria: o cofre do GitHub esta vazio e nenhum token vai junto.
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cercar, pastaTemporaria } from '../helpers/cercado.js';

const req = createRequire(import.meta.url);
const pasta = pastaTemporaria('aurora-gitipc-');
const c = cercar({ electron: { userData: path.join(pasta.raiz, 'userData') } });
fs.mkdirSync(path.join(pasta.raiz, 'userData'), { recursive: true });
const handlers = c.electron.handlers;

const envOriginal = { ...process.env };
const configVazia = path.join(pasta.raiz, 'gitconfig-vazio');
fs.writeFileSync(configVazia, '');
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: configVazia,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Teste', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'Teste', GIT_COMMITTER_EMAIL: 't@t',
  GIT_TERMINAL_PROMPT: '0',
});

const remoto = path.join(pasta.raiz, 'remoto.git');
const proj = path.join(pasta.raiz, 'proj');
const spf = path.join(proj, 'proj.spf');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
const escrever = (rel, texto) => {
  fs.mkdirSync(path.dirname(path.join(proj, rel)), { recursive: true });
  fs.writeFileSync(path.join(proj, rel), texto);
};
const ev = { sender: { id: 1, once() {}, send: (canal, carga) => enviados.push([canal, carga]) } };
const enviados = [];
const chamar = (canal, ...args) => handlers.get(canal)(ev, ...args);

beforeAll(async () => {
  fs.mkdirSync(proj, { recursive: true });
  git(pasta.raiz, 'init', '-q', '--bare', remoto);
  git(proj, 'init', '-q');
  escrever('proj.spf', '{}\n');
  escrever('a.v', 'module a; endmodule\n');
  escrever('.gitignore', 'build/\n');
  git(proj, 'add', '.');
  git(proj, 'commit', '-q', '-m', 'inicial');

  const mod = await import('../../main/ipc/git.js');
  (mod.default ?? mod).register();
  // A janela 1 tem o proj aberto, nas duas copias do project_paths (a do Vite,
  // que o .ts usa, e a nativa, que o .js usa).
  const viaVite = await import('../../main/ipc/project_paths.js');
  for (const pp of new Set([viaVite.default ?? viaVite, req('../../main/ipc/project_paths.js')])) {
    pp.registrarSpfDaJanela(ev, spf);
  }
  const r = await chamar('git:is-repo');
  if (!r.ok || r.isRepo !== true || path.resolve(r.dir) !== path.resolve(proj)) {
    throw new Error(`o painel nao ve o repositorio do teste (${JSON.stringify(r)}); parar`);
  }
});

afterAll(() => {
  for (const k of Object.keys(process.env)) if (!(k in envOriginal)) delete process.env[k];
  Object.assign(process.env, envOriginal);
  pasta.apagar();
});

describe('leitura', () => {
  it('status com +/- por arquivo, e o ignorado a parte', async () => {
    escrever('a.v', 'module a; wire x; endmodule\n');
    escrever('novo.v', 'module novo; endmodule\n');
    escrever('build/saida.bin', 'x');
    const s = await chamar('git:status', { stats: true });
    expect(s).toMatchObject({ ok: true, isRepo: true, branch: 'main', clean: false });
    expect(s.modified).toEqual(['a.v']);
    expect(s.notAdded).toEqual(['novo.v']);
    expect(s.files.find((f) => f.path === 'a.v')).toMatchObject({ additions: 1, deletions: 1 });
    expect((await chamar('git:ignored')).paths).toEqual(['build/']);
  });

  it('diff do arquivo, da arvore e do que esta no stage', async () => {
    const d = await chamar('git:diff', { file: 'a.v' });
    expect(d.ok).toBe(true);
    expect(JSON.stringify(d)).toContain('wire x');
    expect(JSON.stringify(await chamar('git:diff', { staged: true }))).not.toContain('wire x');
    expect(JSON.stringify(await chamar('git:diff'))).toContain('wire x');
  });

  it('pasta que nao e repositorio', async () => {
    const solta = path.join(pasta.raiz, 'solta');
    fs.mkdirSync(solta, { recursive: true });
    expect(await chamar('git:is-repo', { dir: solta })).toMatchObject({ ok: true, isRepo: false });
    expect(await chamar('git:status', { dir: solta })).toMatchObject({ ok: true, isRepo: false });
    expect(await chamar('git:ignored', { dir: solta })).toMatchObject({ ok: true, isRepo: false, paths: [] });
  });
});

describe('stage, commit e historico', () => {
  it('stage e unstage de um arquivo, e stage de tudo', async () => {
    expect(await chamar('git:stage', ['a.v'])).toMatchObject({ ok: true });
    expect((await chamar('git:status')).staged).toEqual(['a.v']);
    await chamar('git:unstage', 'a.v');
    expect((await chamar('git:status')).staged).toEqual([]);
    await chamar('git:stage-all');
    expect((await chamar('git:status')).staged.sort()).toEqual(['a.v', 'novo.v']);
  });

  it('commit sem mensagem e recusado; com mensagem entra no log', async () => {
    expect(await chamar('git:commit', { message: '  ' })).toMatchObject({ ok: false });
    const r = await chamar('git:commit', { message: 'segundo' });
    expect(r.ok).toBe(true);
    expect(r.commit).toMatch(/^[0-9a-f]+$/);
    const log = await chamar('git:log', { maxCount: 5 });
    expect(log.commits.map((x) => x.message)).toEqual(['segundo', 'inicial']);
    expect(log.commits[0]).toMatchObject({ author: 'Teste', email: 't@t' });
  });

  it('arquivos de um commit com +/- e binario, e o diff de um deles', async () => {
    escrever('img.bin', Buffer.from([0, 1, 2, 0, 255]).toString('latin1'));
    fs.writeFileSync(path.join(proj, 'img.bin'), Buffer.from([0, 1, 2, 0, 255]));
    await chamar('git:stage', ['img.bin']);
    await chamar('git:commit', { message: 'binario' });
    const hash = (await chamar('git:log', { maxCount: 1 })).commits[0].hash;
    expect((await chamar('git:commit-files', { hash })).files).toEqual([{ path: 'img.bin', additions: 0, deletions: 0, binary: true }]);
    const anterior = (await chamar('git:log', { maxCount: 2 })).commits[1].hash;
    const arquivos = (await chamar('git:commit-files', { hash: anterior })).files;
    expect(arquivos.find((f) => f.path === 'a.v')).toMatchObject({ additions: 1, deletions: 1, binary: false });
    expect(JSON.stringify(await chamar('git:show', { hash: anterior, file: 'a.v' }))).toContain('wire x');
    expect((await chamar('git:show', { hash: anterior })).ok).toBe(true);
    expect(await chamar('git:commit-files', {})).toMatchObject({ ok: false });
    expect(await chamar('git:show', null)).toMatchObject({ ok: false });
  });

  it('amend e desfazer o ultimo commit', async () => {
    expect(await chamar('git:commit', { message: 'binario, corrigido', amend: true })).toMatchObject({ ok: true, commit: 'amended' });
    expect((await chamar('git:log', { maxCount: 1 })).commits[0].message).toBe('binario, corrigido');
    await chamar('git:undo-last-commit');
    expect((await chamar('git:status')).staged).toEqual(['img.bin']);
    await chamar('git:commit', { message: 'binario de novo' });
  });

  it('descartar em lote: o que e rastreado volta, o arquivo novo sai nomeado', async () => {
    escrever('a.v', 'module a; mexido; endmodule\n');
    escrever('outro-novo.v', 'x');
    expect(await chamar('git:discard', [])).toMatchObject({ ok: true, descartados: [], ignorados: [] });
    const r = await chamar('git:discard', ['a.v', 'outro-novo.v']);
    expect(r).toMatchObject({ ok: true, descartados: ['a.v'], ignorados: ['outro-novo.v'] });
    expect(fs.readFileSync(path.join(proj, 'a.v'), 'utf8')).toBe('module a; wire x; endmodule\n');
    expect(await chamar('git:discard', 'a.v')).toMatchObject({ ok: true, descartados: ['a.v'] });
    fs.rmSync(path.join(proj, 'outro-novo.v'));
  });
});

describe('remoto, clone e ramos', () => {
  it('sem origin: info diz a pasta; adicionar o remoto e empurrar criando o upstream', async () => {
    expect(await chamar('git:info')).toMatchObject({ ok: true, name: 'proj', folder: 'proj', originUrl: null, hasOrigin: false });
    expect(await chamar('git:add-remote', {})).toMatchObject({ ok: false });
    expect(await chamar('git:add-remote', { url: remoto })).toMatchObject({ ok: true });
    expect((await chamar('git:remotes')).remotes).toEqual([{ name: 'origin', fetch: remoto, push: remoto }]);
    expect(await chamar('git:push', { setUpstream: true })).toMatchObject({ ok: true });
    expect((await chamar('git:status')).tracking).toBe('origin/main');
    const info = await chamar('git:info');
    expect(info).toMatchObject({ hasOrigin: true, originUrl: remoto });
  });

  it('clone do remoto, com progresso repassado, e busca de .spf no clone', async () => {
    enviados.length = 0;
    const dest = path.join(pasta.raiz, 'clonado');
    const r = await chamar('git:clone', { url: remoto, dest });
    expect(r).toEqual({ ok: true, dest });
    expect(enviados.at(-1)).toEqual(['git:clone-progress', { stage: 'done', progress: 100 }]);
    expect((await chamar('git:scan-spf', { dir: dest })).spfs.map((p) => path.basename(p))).toEqual(['proj.spf']);
    expect(await chamar('git:scan-spf', {})).toMatchObject({ ok: false });
    expect(await chamar('git:clone', { url: ' ', dest })).toEqual({ ok: false, error: 'url required' });
    expect(await chamar('git:clone', { url: remoto })).toEqual({ ok: false, error: 'dest required' });
    expect(enviados.at(-1)).toEqual(['git:clone-progress', { stage: 'error', progress: 0 }]);
    // um commit novo no clone, empurrado, para o fetch e o pull do proj trazerem
    git(dest, 'checkout', '-q', '-b', 'so-remoto');
    fs.writeFileSync(path.join(dest, 'r.v'), 'module r; endmodule\n');
    git(dest, 'add', '.');
    git(dest, 'commit', '-q', '-m', 'do remoto');
    git(dest, 'push', '-q', 'origin', 'so-remoto');
    git(dest, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(dest, 'm.v'), 'module m; endmodule\n');
    git(dest, 'add', '.');
    git(dest, 'commit', '-q', '-m', 'main no remoto');
    git(dest, 'push', '-q', 'origin', 'main');
  });

  it('fetch e pull trazem o que o remoto tem, e o ramo so do remoto aparece', async () => {
    expect(await chamar('git:fetch')).toMatchObject({ ok: true });
    const b = await chamar('git:branches');
    expect(b.current).toBe('main');
    expect(b.remoteBranches).toEqual([{ full: 'origin/so-remoto', name: 'so-remoto' }]);
    expect(await chamar('git:pull')).toMatchObject({ ok: true });
    expect(fs.existsSync(path.join(proj, 'm.v'))).toBe(true);
    expect(await chamar('git:push')).toMatchObject({ ok: true });
  });

  it('checkout de ramo novo, do ramo do remoto e de volta, e merge', async () => {
    expect(await chamar('git:checkout', { branch: 'origin/so-remoto', track: true })).toMatchObject({ ok: true });
    expect((await chamar('git:status')).branch).toBe('so-remoto');
    expect(await chamar('git:checkout', { branch: 'novo', create: true })).toMatchObject({ ok: true });
    expect((await chamar('git:branches')).branches.sort()).toEqual(['main', 'novo', 'so-remoto']);
    await chamar('git:checkout', { branch: 'main' });
    expect(await chamar('git:merge', {})).toMatchObject({ ok: false });
    expect(await chamar('git:merge', { branch: 'so-remoto' })).toMatchObject({ ok: true });
    expect(fs.existsSync(path.join(proj, 'r.v'))).toBe(true);
  });

  it('stash com arquivo novo, listar, aplicar de volta e descartar', async () => {
    escrever('rascunho.v', 'x');
    expect((await chamar('git:stash', { message: 'guardado' })).ok).toBe(true);
    expect(fs.existsSync(path.join(proj, 'rascunho.v'))).toBe(false);
    expect((await chamar('git:stash-list')).stashes).toEqual([expect.stringContaining('guardado')]);
    expect((await chamar('git:stash-pop')).ok).toBe(true);
    expect(fs.existsSync(path.join(proj, 'rascunho.v'))).toBe(true);
    await chamar('git:stash');
    expect(await chamar('git:stash-drop')).toMatchObject({ ok: true });
    expect((await chamar('git:stash-list')).stashes).toEqual([]);
  });
});

describe('sem projeto aberto', () => {
  it('init numa pasta nova; e as mutacoes sem projeto dao erro limpo', async () => {
    const semProjeto = { sender: { id: 99, once() {}, send() {} } };
    expect(await handlers.get('git:stage')(semProjeto, ['a.v'])).toMatchObject({ ok: false });
    expect(await handlers.get('git:push')(semProjeto)).toMatchObject({ ok: false });
    expect(await handlers.get('git:log')(semProjeto)).toMatchObject({ ok: false });
    expect(await handlers.get('git:is-repo')(semProjeto)).toMatchObject({ ok: true, isRepo: false });
  });
});
