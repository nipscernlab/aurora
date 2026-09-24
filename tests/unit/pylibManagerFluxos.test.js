/**
 * Os fluxos do pylib_manager que dependem de rede: instalar do catalogo,
 * resolver e instalar da PyPI, reparar, e a verificacao assincrona do vigia.
 *
 * O pylibs.test.js cobre o que e offline. Estes testes existem para a
 * conversao do modulo para TypeScript: e nestes caminhos que estavam os erros
 * de tipo, e nenhum teste passava por eles. Eles fixam o comportamento de hoje
 * (progresso, o que vai para o manifesto, as recusas) para a conversao provar
 * que nao mudou nada.
 *
 * A rede sai trocando os metodos do proprio objeto do fetcher. Sao duas copias:
 * a do require nativo, que o pylib_manager.js usa, e a do Vite, que um .ts
 * importado pelo vitest usa. O teste troca nas duas, entao vale para o modulo
 * antes e depois da conversao sem saber qual dos dois esta carregado.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CATALOG = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'resources', 'pylib-catalog.json'), 'utf8'),
);
const AXI = CATALOG.libraries.find((l) => l.id === 'cocotbext-axi');
const BUS = CATALOG.libraries.find((l) => l.id === 'cocotb-bus');

const req = createRequire(import.meta.url);
const fetcherNativo = req('../../main/net/fetcher.js');

/** sha256 em base64url sem padding, o formato do RECORD. */
const b64 = (buf) => crypto.createHash('sha256').update(buf).digest('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * O conteudo falso de uma wheel: um pacote com __init__ e o RECORD dele. O
 * nome do pacote vem do nome do arquivo, como numa wheel de verdade.
 */
function wheelFalsa(filename) {
  const [pkg, version] = filename.split('-');
  const init = `# ${pkg}\n`;
  const dist = `${pkg}-${version}.dist-info`;
  const record = [
    `${pkg}/__init__.py,sha256=${b64(Buffer.from(init))},${Buffer.byteLength(init)}`,
    `${dist}/RECORD,,`,
    '',
  ].join('\n');
  return {
    entries: [`${pkg}/`, `${pkg}/__init__.py`, `${dist}/`, `${dist}/RECORD`],
    files: { [`${pkg}/__init__.py`]: init, [`${dist}/RECORD`]: record },
  };
}

describe('pylib_manager: fluxos com rede', () => {
  let tmp;
  let bundleSite;
  let manager;
  let paths;
  /** o que cada wheel baixada "contem", pelo nome do arquivo */
  let conteudo;
  /** o que o download devolve de digest, pela url; ausente = o sha certo */
  let digestFalso;
  let chamadas;

  function trocar(nome, impl) {
    for (const f of new Set([fetcherNativo, globalThis.__fetcherVite])) {
      vi.spyOn(f, nome).mockImplementation(impl);
    }
  }

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-pylibs-rede-'));
    bundleSite = path.join(tmp, 'bundle-site-packages');
    fs.mkdirSync(bundleSite, { recursive: true });
    process.env.AURORA_PYLIBS_ROOT = tmp;
    process.env.AURORA_BUNDLE_SITE = bundleSite;
    const viaVite = await import('../../main/net/fetcher.js');
    globalThis.__fetcherVite = viaVite.default ?? viaVite;
    manager = await import('../../main/python/pylib_manager.js');
    paths = await import('../../main/python/pylib_paths.js');

    conteudo = new Map();
    digestFalso = new Map();
    chamadas = { download: [], getJson: [] };
    const shaPorUrl = new Map();
    for (const lib of CATALOG.libraries) {
      for (const w of lib.wheels) {
        shaPorUrl.set(w.url, w.sha256);
        conteudo.set(w.filename, wheelFalsa(w.filename));
      }
    }

    trocar('downloadToFile', async (url, dest, opts = {}) => {
      chamadas.download.push({ url, dest, opts });
      fs.writeFileSync(dest, 'wheel');
      if (opts.onChunk) {
        opts.onChunk(10, 20);
        opts.onChunk(20, 0);
      }
      return { digest: digestFalso.get(url) ?? shaPorUrl.get(url) ?? 'sem-sha' };
    });
    trocar('listArchive', async (whl) => conteudo.get(path.basename(whl)).entries);
    trocar('extractArchive', async (whl, site) => {
      for (const [rel, texto] of Object.entries(conteudo.get(path.basename(whl)).files)) {
        fs.mkdirSync(path.dirname(path.join(site, rel)), { recursive: true });
        fs.writeFileSync(path.join(site, rel), texto);
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.__fetcherVite;
    delete process.env.AURORA_PYLIBS_ROOT;
    delete process.env.AURORA_BUNDLE_SITE;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('install', () => {
    it('baixa todas as wheels, anota arquivos e hashes do RECORD e liga o .pth', async () => {
      const progresso = [];
      const r = await manager.install(AXI.id, { onProgress: (p) => progresso.push(p) });

      expect(r).toEqual({ id: AXI.id, version: AXI.version, files: 4 });
      expect(chamadas.download.map((c) => c.url)).toEqual(AXI.wheels.map((w) => w.url));
      expect(chamadas.download[0].opts).toMatchObject({ algorithm: 'sha256', userAgent: 'aurora-ide-pylibs' });

      const rec = manager.readManifest().installed[AXI.id];
      expect(rec.version).toBe(AXI.version);
      expect(rec.wheels).toEqual(AXI.wheels.map((w) => ({ name: w.name, version: w.version, sha256: w.sha256 })));
      expect(rec.files).toEqual([
        'cocotbext_axi/__init__.py', 'cocotbext_axi-0.1.28.dist-info/RECORD',
        'cocotb_bus/__init__.py', 'cocotb_bus-0.3.0.dist-info/RECORD',
      ]);
      expect(rec.hashes['cocotb_bus/__init__.py']).toEqual({
        sha256: b64(Buffer.from('# cocotb_bus\n')), size: Buffer.byteLength('# cocotb_bus\n'),
      });
      expect(rec.hashes['cocotb_bus-0.3.0.dist-info/RECORD']).toEqual({ sha256: null, size: null });
      expect(manager.readManifest().abiTag).toBe(CATALOG.python.abiTag);

      // O .pth passa a apontar para o site, e a staging nao sobra.
      expect(fs.readFileSync(paths.sitePthFile(), 'utf8')).toBe(`${path.normalize(paths.pylibSite())}\n`);
      expect(fs.readdirSync(paths.stagingDir())).toEqual([]);

      // Uma barra so para as duas wheels: as fases na ordem, pct nunca volta,
      // e o download para em 99 ate a instalacao acabar.
      const fases = progresso.map((p) => p.phase);
      expect(fases[0]).toBe('download');
      expect(fases.at(-1)).toBe('done');
      expect(fases).toContain('verify');
      expect(fases).toContain('extract');
      expect(progresso.at(-1)).toEqual({ id: AXI.id, phase: 'done', pct: 100 });
      for (const p of progresso.filter((x) => x.phase === 'download')) expect(p.pct).toBeLessThanOrEqual(99);
      expect(progresso.find((p) => p.detail)?.detail).toBe(`${AXI.wheels[0].name} ${AXI.wheels[0].version}`);
      const total = AXI.wheels.reduce((n, w) => n + w.size, 0);
      const extract2 = progresso.filter((p) => p.phase === 'extract')[1];
      expect(extract2.pct).toBe(Math.round((total / total) * 100));
    });

    it('ja instalada: responde sem baixar, a menos que force', async () => {
      await manager.install(BUS.id);
      expect(chamadas.download).toHaveLength(1);
      const progresso = [];
      expect(await manager.install(BUS.id, { onProgress: (p) => progresso.push(p) }))
        .toEqual({ id: BUS.id, alreadyInstalled: true });
      expect(progresso).toEqual([{ id: BUS.id, phase: 'done', pct: 100 }]);
      expect(chamadas.download).toHaveLength(1);
      await manager.install(BUS.id, { force: true });
      expect(chamadas.download).toHaveLength(2);
    });

    it('duas chamadas ao mesmo tempo viram uma instalacao so', async () => {
      const a = manager.install(BUS.id);
      const b = manager.install(BUS.id);
      expect(b).toBe(a);
      await a;
      expect(chamadas.download).toHaveLength(1);
    });

    it('hash que nao confere recusa antes de extrair e nao anota nada', async () => {
      digestFalso.set(BUS.wheels[0].url, 'f'.repeat(64));
      await expect(manager.install(BUS.id)).rejects.toThrow(`hash nao confere para ${BUS.wheels[0].filename}`);
      expect(manager.readManifest().installed[BUS.id]).toBeUndefined();
      expect(fs.existsSync(path.join(paths.pylibSite(), 'cocotb_bus'))).toBe(false);
      expect(fs.readdirSync(paths.stagingDir())).toEqual([]);
    });

    it('wheel com caminho que escapa do destino e recusada', async () => {
      conteudo.get(BUS.wheels[0].filename).entries.push('../fora.py');
      await expect(manager.install(BUS.id)).rejects.toThrow('contem caminho invalido (../fora.py)');
      expect(manager.readManifest().installed[BUS.id]).toBeUndefined();
    });

    it('repair reinstala por cima quem ja estava instalado', async () => {
      await manager.install(BUS.id);
      fs.rmSync(path.join(paths.pylibSite(), 'cocotb_bus', '__init__.py'));
      expect(manager.sentinelCheck()).toEqual({ ok: false, broken: [BUS.id] });
      const r = await manager.repair(BUS.id);
      expect(r).toEqual({ id: BUS.id, version: BUS.version, files: 2 });
      expect(manager.sentinelCheck()).toEqual({ ok: true, broken: [] });
      expect(chamadas.download).toHaveLength(2);
    });

    it('repair de quem nao estava instalado so instala', async () => {
      expect(await manager.repair(BUS.id)).toEqual({ id: BUS.id, version: BUS.version, files: 2 });
    });
  });

  describe('resolveExternal', () => {
    const PURA = { packagetype: 'bdist_wheel', filename: 'foo_bar-1.2-py3-none-any.whl', url: 'https://f/x.whl', digests: { sha256: 'a'.repeat(64) }, size: 321 };
    const COMPILADA = { packagetype: 'bdist_wheel', filename: 'foo_bar-1.2-cp312-cp312-win_amd64.whl', url: 'https://f/y.whl' };
    const SDIST = { packagetype: 'sdist', filename: 'foo_bar-1.2.tar.gz' };

    function pypi(resposta) {
      trocar('getJson', async (url) => {
        chamadas.getJson.push(url);
        if (resposta instanceof Error) throw resposta;
        return resposta;
      });
    }

    it('consulta a URL da PyPI com o nome escapado', async () => {
      pypi({ info: { version: '1' }, urls: [] });
      await manager.resolveExternal('  foo.bar  ');
      expect(chamadas.getJson).toEqual(['https://pypi.org/pypi/foo.bar/json']);
    });

    it('404 vira not-found, outro erro vira network com a mensagem inteira', async () => {
      pypi(new Error('HTTP 404 em https://pypi.org'));
      expect(await manager.resolveExternal('nada')).toEqual({ ok: false, reason: 'not-found', message: '"nada" nao existe na PyPI.' });
      pypi(new Error('prazo de 20 s expirou'));
      const r = await manager.resolveExternal('nada');
      expect(r.reason).toBe('network');
      expect(r.message).toBe('Nao consegui consultar a PyPI: prazo de 20 s expirou. Confira a conexao e tente de novo.');
      trocar('getJson', async () => { throw 'so texto'; });
      expect((await manager.resolveExternal('nada')).message).toContain('so texto');
    });

    it('so wheel compilada: recusa com o motivo e os dados do pacote', async () => {
      pypi({ info: { name: 'Foo-Bar', version: '1.2', summary: 's', project_urls: { Homepage: 'https://h' } }, urls: [COMPILADA, SDIST] });
      expect(await manager.resolveExternal('foo-bar')).toEqual({
        ok: false,
        reason: 'compiled',
        name: 'Foo-Bar',
        version: '1.2',
        summary: 's',
        homepage: 'https://h',
        message: 'Foo-Bar 1.2 so publica wheel com extensao em C. '
          + 'O Python embarcado da AURORA e um build MinGW e nao carrega esse formato. '
          + 'Use o terminal TCMD com o seu proprio Python.',
      });
    });

    it('resposta sem info nem urls cai nos valores vazios', async () => {
      pypi({});
      expect(await manager.resolveExternal('vazio')).toMatchObject({ ok: false, reason: 'compiled', name: 'vazio', version: '', summary: '', homepage: '' });
    });

    it('com wheel pura: devolve a wheel, licenca e dependencias', async () => {
      pypi({
        info: { name: 'Foo-Bar', version: '1.2', summary: 's', home_page: 'https://home', license: 'MIT', requires_dist: ['x>=1'] },
        urls: [COMPILADA, PURA],
      });
      expect(await manager.resolveExternal('foo-bar')).toEqual({
        ok: true,
        name: 'Foo-Bar',
        version: '1.2',
        summary: 's',
        homepage: 'https://home',
        license: 'MIT',
        requiresDist: ['x>=1'],
        wheel: { name: 'Foo-Bar', version: '1.2', filename: PURA.filename, url: PURA.url, sha256: PURA.digests.sha256, size: 321 },
      });
    });

    it('license_expression tem precedencia, e sem licenca vem null', async () => {
      pypi({ info: { version: '1', license_expression: 'Apache-2.0', license: 'x' }, urls: [PURA] });
      expect((await manager.resolveExternal('a')).license).toBe('Apache-2.0');
      pypi({ info: { version: '1' }, urls: [PURA] });
      expect((await manager.resolveExternal('a')).license).toBeNull();
    });
  });

  describe('installExternal e listExternal', () => {
    const FILE = 'foo_bar-1.2-py3-none-any.whl';

    function pypiPura(extra = {}) {
      conteudo.set(FILE, wheelFalsa(FILE));
      trocar('getJson', async () => ({
        info: { name: 'Foo_Bar', version: '1.2' },
        urls: [{ packagetype: 'bdist_wheel', filename: FILE, url: 'https://f/foo.whl', size: 5, ...extra }],
      }));
    }

    it('instala, anota como externa e aparece na lista', async () => {
      pypiPura({ digests: { sha256: 'abc' } });
      digestFalso.set('https://f/foo.whl', 'abc');
      const progresso = [];
      const r = await manager.installExternal('foo_bar', { onProgress: (p) => progresso.push(p) });
      expect(r).toEqual({ id: 'pypi:foo_bar', name: 'Foo_Bar', version: '1.2' });

      const rec = manager.readManifest().installed['pypi:foo_bar'];
      expect(rec).toMatchObject({
        external: true,
        name: 'Foo_Bar',
        version: '1.2',
        wheels: [{ name: 'Foo_Bar', version: '1.2', sha256: 'abc' }],
        files: ['foo_bar/__init__.py', 'foo_bar-1.2.dist-info/RECORD'],
      });
      expect(rec.hashes['foo_bar/__init__.py'].size).toBe(Buffer.byteLength('# foo_bar\n'));

      // onChunk(10, 20) e onChunk(20, 0): metade, e zero quando nao se sabe o total.
      expect(progresso.map((p) => [p.phase, p.pct])).toEqual([
        ['download', 0], ['download', 50], ['download', 0], ['verify', 100], ['extract', 100], ['done', 100],
      ]);
      expect(progresso[0].detail).toBe('Foo_Bar 1.2');
      expect(fs.readdirSync(paths.stagingDir())).toEqual([]);

      const lista = manager.listExternal();
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({ id: 'pypi:foo_bar', name: 'Foo_Bar', version: '1.2', broken: false });
      expect(typeof lista[0].installedAt).toBe('string');
      fs.rmSync(path.join(paths.pylibSite(), 'foo_bar', '__init__.py'));
      expect(manager.listExternal()[0].broken).toBe(true);
    });

    it('lista externa ignora o que veio do catalogo', async () => {
      await manager.install(BUS.id);
      expect(manager.listExternal()).toEqual([]);
    });

    it('sem sha256 publicado, instala sem conferir', async () => {
      pypiPura();
      digestFalso.set('https://f/foo.whl', 'qualquer');
      await expect(manager.installExternal('foo_bar')).resolves.toMatchObject({ id: 'pypi:foo_bar' });
    });

    it('hash publicado que nao confere e recusado', async () => {
      pypiPura({ digests: { sha256: 'abc' } });
      digestFalso.set('https://f/foo.whl', 'xyz');
      await expect(manager.installExternal('foo_bar')).rejects.toThrow(`hash nao confere para ${FILE}`);
    });

    it('caminho que escapa do destino e recusado', async () => {
      pypiPura();
      conteudo.get(FILE).entries.push('/etc/x');
      await expect(manager.installExternal('foo_bar')).rejects.toThrow(`${FILE} contem caminho invalido (/etc/x)`);
      expect(manager.readManifest().installed['pypi:foo_bar']).toBeUndefined();
    });

    it('o que o resolveExternal recusa vira erro com a mesma mensagem', async () => {
      await expect(manager.installExternal('nome invalido!')).rejects.toThrow('Nome de pacote invalido.');
    });
  });

  describe('doctorAsync, a verificacao do vigia', () => {
    it('diz o mesmo que o doctor sincrono, rapido e fundo', async () => {
      await manager.install(AXI.id);
      await manager.install(BUS.id);
      const site = paths.pylibSite();
      fs.rmSync(path.join(site, 'cocotbext_axi', '__init__.py'));
      // mesmo tamanho, conteudo trocado: so a verificacao funda ve
      fs.writeFileSync(path.join(site, 'cocotb_bus', '__init__.py'), '# cocotb_bux\n');

      const semHora = ({ checkedAt, ...resto }) => resto;
      for (const deep of [false, true]) {
        const a = await manager.doctorAsync({ deep });
        expect(semHora(a)).toEqual(semHora(manager.doctor({ deep })));
        expect(typeof a.checkedAt).toBe('string');
      }
      const fundo = await manager.doctorAsync({ deep: true });
      expect(fundo.issues.map((i) => [i.id, i.kind])).toEqual([
        [AXI.id, 'corrupt-files'],
        [BUS.id, 'corrupt-files'],
      ]);
      expect((await manager.doctorAsync()).issues.map((i) => [i.id, i.counts])).toEqual([
        [AXI.id, { missing: 1, resized: 0, corrupt: 0 }],
      ]);
    });

    it('tamanho errado, arquivo ilegivel e o limite de 20 problemas, em lotes de 64', async () => {
      const site = paths.pylibSite();
      fs.mkdirSync(path.join(site, 'lib'), { recursive: true });
      const files = [];
      const hashes = {};
      for (let i = 0; i < 70; i++) {
        const rel = `lib/f${i}.py`;
        files.push(rel);
        if (i < 66) {
          fs.writeFileSync(path.join(site, rel), 'abc');
          hashes[rel] = { sha256: b64(Buffer.from('abc')), size: 3 };
        }
      }
      hashes['lib/f0.py'] = { sha256: null, size: 99 }; // tamanho errado
      delete hashes['lib/f1.py']; // sem inventario: nada a comparar
      fs.rmSync(path.join(site, 'lib/f2.py'));
      fs.mkdirSync(path.join(site, 'lib/f2.py')); // stat ok, leitura falha
      hashes['lib/f2.py'] = { sha256: 'x', size: null };
      fs.writeFileSync(paths.manifestFile(), JSON.stringify({
        schemaVersion: 1, abiTag: null, installed: { lib: { version: '1', files, hashes } },
      }));

      const fundo = await manager.doctorAsync({ deep: true });
      expect(fundo.issues[0].counts).toEqual({ missing: 4, resized: 1, corrupt: 1 });
      expect(fundo.issues[0].sample).toEqual(['lib/f0.py', 'lib/f2.py', 'lib/f66.py']);
      expect(semVerificar(manager.doctor({ deep: true }))).toEqual(semVerificar(fundo));

      // 25 faltando: o relatorio para em 20, nos dois.
      for (let i = 3; i < 24; i++) fs.rmSync(path.join(site, `lib/f${i}.py`));
      const cheio = await manager.doctorAsync();
      const total = (c) => c.missing + c.resized + c.corrupt;
      expect(total(cheio.issues[0].counts)).toBe(20);
      expect(total(manager.doctor().issues[0].counts)).toBe(20);
    });

    function semVerificar({ checkedAt, ...resto }) {
      return resto;
    }
  });
});
