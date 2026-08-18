/**
 * Testes do painel de bibliotecas Python.
 *
 * Cobrem a superficie deterministica e offline: o catalogo commitado, a regra
 * que decide se uma wheel roda no Python embarcado, a guarda de caminho na
 * extracao e o ciclo instalar/desinstalar sobre um manifesto de mentira.
 *
 * O download real NAO e exercitado aqui (dependeria da rede e da PyPI estar de
 * pe); o que se testa e a logica que decide, anota e remove. `AURORA_PYLIBS_ROOT`
 * aponta a arvore inteira para um diretorio descartavel, entao nada toca o
 * components/ de verdade, mesmo recurso que o cliDownloader.test.js usa com
 * AURORA_CLI_CACHE.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { pickPureWheel, PURE_SUFFIX } from '../../scripts/gen-pylib-catalog.js';

const CATALOG = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'resources', 'pylib-catalog.json'), 'utf8'),
);

describe('catalogo de bibliotecas', () => {
  it('declara o schema e a ABI do Python contra a qual foi validado', () => {
    expect(CATALOG.schemaVersion).toBe(1);
    expect(CATALOG.python.abiTag).toBe('cp312');
    expect(CATALOG.python.platform).toBe('mingw_x86_64_msvcrt_gnu');
  });

  it('toda biblioteca instalavel so aponta para wheel pura', () => {
    const pure = CATALOG.libraries.filter((l) => l.kind === 'pure');
    expect(pure.length).toBeGreaterThan(0);
    for (const lib of pure) {
      expect(lib.wheels.length).toBeGreaterThan(0);
      for (const w of lib.wheels) {
        // A regra inteira do painel cabe nesta linha: ABI `none`, plataforma
        // `any`. Qualquer outra coisa nao carrega no Python MinGW.
        expect(w.filename.endsWith(PURE_SUFFIX)).toBe(true);
        expect(w.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(w.url.startsWith('https://')).toBe(true);
      }
    }
  });

  it('toda biblioteca compilada e informativa: sem wheel, com motivo', () => {
    const compiled = CATALOG.libraries.filter((l) => l.kind === 'compiled');
    expect(compiled.map((l) => l.id)).toContain('numpy');
    for (const lib of compiled) {
      expect(lib.wheels).toEqual([]);
      expect(lib.unavailable).toBe('compiled-abi');
    }
  });

  it('toda entrada tem descricao e usos nos dois idiomas', () => {
    for (const lib of CATALOG.libraries) {
      expect(lib.summary.pt.length).toBeGreaterThan(10);
      expect(lib.summary.en.length).toBeGreaterThan(10);
      expect(lib.uses.pt.length).toBeGreaterThan(0);
      expect(lib.uses.en.length).toBeGreaterThan(0);
      expect(CATALOG.categories[lib.category]).toBeTruthy();
    }
  });

  it('nao repete id', () => {
    const ids = CATALOG.libraries.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('pickPureWheel', () => {
  const wheel = (filename) => ({ packagetype: 'bdist_wheel', filename });

  it('aceita py3-none-any', () => {
    expect(pickPureWheel([wheel('plotly-6.9.0-py3-none-any.whl')])).toBeTruthy();
  });

  it('aceita py2.py3-none-any — o colorama publica assim e e igualmente puro', () => {
    expect(pickPureWheel([wheel('colorama-0.4.6-py2.py3-none-any.whl')])).toBeTruthy();
  });

  it('recusa wheel compilada', () => {
    expect(pickPureWheel([
      wheel('numpy-2.5.1-cp312-cp312-win_amd64.whl'),
      wheel('numpy-2.5.1-cp313-cp313-manylinux_2_17_x86_64.whl'),
    ])).toBeNull();
  });

  it('escolhe a pura quando o release tem as duas formas', () => {
    const picked = pickPureWheel([
      wheel('x-1.0-cp312-cp312-win_amd64.whl'),
      wheel('x-1.0-py3-none-any.whl'),
    ]);
    expect(picked.filename).toBe('x-1.0-py3-none-any.whl');
  });

  it('ignora sdist', () => {
    expect(pickPureWheel([{ packagetype: 'sdist', filename: 'x-1.0.tar.gz' }])).toBeNull();
  });
});

describe('pylib_manager', () => {
  let tmp;
  let manager;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-pylibs-'));
    process.env.AURORA_PYLIBS_ROOT = tmp;
    // Import depois de fixar a env: pylibRoot() a le a cada chamada, mas o
    // modulo tambem guarda o catalogo em cache entre testes.
    manager = await import('../../main/python/pylib_manager.js');
  });

  afterEach(() => {
    delete process.env.AURORA_PYLIBS_ROOT;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('isSafeEntry barra caminho que escapa do destino', () => {
    const { isSafeEntry } = manager;
    expect(isSafeEntry('plotly/__init__.py')).toBe(true);
    expect(isSafeEntry('plotly-6.9.0.dist-info/RECORD')).toBe(true);
    // Uma wheel e um zip vindo da internet: estes tres escreveriam fora do site.
    expect(isSafeEntry('../evil.py')).toBe(false);
    expect(isSafeEntry('plotly/../../evil.py')).toBe(false);
    expect(isSafeEntry('/etc/passwd')).toBe(false);
    expect(isSafeEntry('C:/Windows/System32/evil.dll')).toBe(false);
    expect(isSafeEntry('')).toBe(false);
  });

  it('getState marca tudo como nao instalado num diretorio limpo', () => {
    const st = manager.getState();
    expect(st.libraries.length).toBe(CATALOG.libraries.length);
    expect(st.libraries.every((l) => l.installed === false)).toBe(true);
    expect(st.site).toBe(path.join(tmp, 'site'));
  });

  it('recusa instalar biblioteca compilada, antes de tocar a rede', async () => {
    await expect(manager.install('numpy')).rejects.toThrow(/extensao em C/i);
  });

  it('recusa id que nao existe no catalogo', async () => {
    await expect(manager.install('nao-existe')).rejects.toThrow(/desconhecida/i);
  });

  it('desinstalar preserva o arquivo que outra biblioteca instalada reivindica', () => {
    const site = path.join(tmp, 'site');
    fs.mkdirSync(path.join(site, 'shared'), { recursive: true });
    fs.mkdirSync(path.join(site, 'solo'), { recursive: true });
    fs.writeFileSync(path.join(site, 'shared', 'mod.py'), '# compartilhado');
    fs.writeFileSync(path.join(site, 'solo', 'mod.py'), '# so da libA');

    // Manifesto de mentira: libA e libB dividem shared/mod.py.
    fs.writeFileSync(path.join(tmp, 'installed.json'), JSON.stringify({
      schemaVersion: 1,
      abiTag: 'cp312',
      installed: {
        libA: { version: '1', installedAt: '', wheels: [], files: ['solo/mod.py', 'shared/mod.py'] },
        libB: { version: '1', installedAt: '', wheels: [], files: ['shared/mod.py'] },
      },
    }));

    const res = manager.uninstall('libA');
    expect(res.removed).toBe(1);
    expect(res.kept).toBe(1);
    expect(fs.existsSync(path.join(site, 'solo', 'mod.py'))).toBe(false);
    // libB continua funcionando.
    expect(fs.existsSync(path.join(site, 'shared', 'mod.py'))).toBe(true);
  });

  it('desinstalar leva junto o __pycache__ que o Python criou depois', () => {
    const site = path.join(tmp, 'site');
    fs.mkdirSync(path.join(site, 'lonely', '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(site, 'lonely', 'mod.py'), '# codigo');
    // Bytecode: nao veio na wheel, entao nao esta no manifesto. Sem a varredura
    // de diretorio de topo, a pasta sobreviveria a desinstalacao.
    fs.writeFileSync(path.join(site, 'lonely', '__pycache__', 'mod.cpython-312.pyc'), 'x');

    fs.writeFileSync(path.join(tmp, 'installed.json'), JSON.stringify({
      schemaVersion: 1,
      installed: { lonely: { version: '1', installedAt: '', wheels: [], files: ['lonely/mod.py'] } },
    }));

    manager.uninstall('lonely');
    expect(fs.existsSync(path.join(site, 'lonely'))).toBe(false);
  });

  it('desinstalar o que nao esta instalado nao quebra', () => {
    const res = manager.uninstall('plotly');
    expect(res.notInstalled).toBe(true);
  });

  it('doctor acusa arquivo faltando e deriva do ABI', () => {
    fs.mkdirSync(path.join(tmp, 'site'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'installed.json'), JSON.stringify({
      schemaVersion: 1,
      abiTag: 'cp311', // instalado num Python anterior ao do catalogo (cp312)
      installed: { ghost: { version: '1', installedAt: '', wheels: [], files: ['ghost/mod.py'] } },
    }));

    const d = manager.doctor();
    expect(d.ok).toBe(false);
    expect(d.issues.map((i) => i.kind)).toContain('abi-drift');
    expect(d.issues.map((i) => i.kind)).toContain('missing-files');
  });

  it('resolveExternal recusa nome invalido sem consultar a rede', async () => {
    const r = await manager.resolveExternal('../../etc/passwd');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid-name');
  });
});

describe('integridade (o doutor)', () => {
  let tmp;
  let manager;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-pylibs-doc-'));
    process.env.AURORA_PYLIBS_ROOT = tmp;
    manager = await import('../../main/python/pylib_manager.js');
  });

  afterEach(() => {
    delete process.env.AURORA_PYLIBS_ROOT;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('parseRecord le o inventario da wheel', () => {
    const rec = manager.parseRecord(
      'plotly/__init__.py,sha256=AbC-_9xY,1234\n'
      + 'plotly/io/_html.py,sha256=ZZZ,42\n'
      + 'plotly-6.9.0.dist-info/RECORD,,\n',
    );
    expect(rec['plotly/__init__.py']).toEqual({ sha256: 'AbC-_9xY', size: 1234 });
    expect(rec['plotly/io/_html.py'].size).toBe(42);
    // O RECORD nao pode conter o hash de si mesmo, vira entrada sem verificacao.
    expect(rec['plotly-6.9.0.dist-info/RECORD']).toEqual({ sha256: null, size: null });
  });

  it('parseRecord aguenta virgula no caminho', () => {
    const rec = manager.parseRecord('pkg/a,b.py,sha256=HHH,10\n');
    expect(rec['pkg/a,b.py']).toEqual({ sha256: 'HHH', size: 10 });
  });

  /** Escreve um arquivo e devolve a entrada de RECORD correspondente. */
  const plant = (site, rel, content) => {
    const abs = path.join(site, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    const sha = crypto.createHash('sha256').update(content)
      .digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return { sha256: sha, size: Buffer.byteLength(content) };
  };

  it('a checagem rapida ve arquivo apagado, a funda ve conteudo trocado', () => {
    const site = path.join(tmp, 'site');
    const a = plant(site, 'lib/a.py', 'conteudo A');
    const b = plant(site, 'lib/b.py', 'conteudo B');

    fs.writeFileSync(path.join(tmp, 'installed.json'), JSON.stringify({
      schemaVersion: 1,
      abiTag: 'cp312',
      installed: {
        lib: {
          version: '1', installedAt: '', wheels: [],
          files: ['lib/a.py', 'lib/b.py'],
          hashes: { 'lib/a.py': a, 'lib/b.py': b },
        },
      },
    }));

    expect(manager.doctor().ok).toBe(true);
    expect(manager.doctor({ deep: true }).ok).toBe(true);

    // 1. Antivirus apaga um arquivo, a checagem rapida (so stat) ja pega.
    fs.rmSync(path.join(site, 'lib', 'a.py'));
    const afterDelete = manager.doctor();
    expect(afterDelete.ok).toBe(false);
    expect(afterDelete.issues[0].counts.missing).toBe(1);

    // 2. Corrupcao silenciosa: MESMO tamanho, conteudo diferente. A checagem
    //    rapida nao tem como ver, e e exatamente por isso que a funda existe.
    fs.writeFileSync(path.join(site, 'lib', 'b.py'), 'CONTEUDO X');
    const quick = manager.doctor();
    expect(quick.issues.some((i) => i.counts.corrupt > 0)).toBe(false);
    const deep = manager.doctor({ deep: true });
    expect(deep.issues.some((i) => i.counts.corrupt > 0)).toBe(true);
  });

  it('sentinelCheck acusa a biblioteca sem o __init__ do pacote de topo', () => {
    const site = path.join(tmp, 'site');
    plant(site, 'lib/__init__.py', 'x');
    fs.writeFileSync(path.join(tmp, 'installed.json'), JSON.stringify({
      schemaVersion: 1,
      installed: { lib: { version: '1', installedAt: '', wheels: [], files: ['lib/__init__.py'], hashes: {} } },
    }));

    expect(manager.sentinelCheck().ok).toBe(true);
    fs.rmSync(path.join(site, 'lib', '__init__.py'));
    const r = manager.sentinelCheck();
    expect(r.ok).toBe(false);
    expect(r.broken).toContain('lib');
  });
});

describe('origem do catalogo (local vs remoto)', () => {
  let tmp;
  let catalog;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-pylibs-cat-'));
    process.env.AURORA_PYLIBS_ROOT = tmp;
    catalog = await import('../../main/python/pylib_catalog.js');
    catalog.invalidate();
  });

  afterEach(() => {
    delete process.env.AURORA_PYLIBS_ROOT;
    catalog.invalidate();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const valid = (over = {}) => ({
    schemaVersion: 1,
    python: { abiTag: 'cp312' },
    categories: { viz: { pt: 'V', en: 'V' } },
    libraries: [{
      id: 'x', name: 'X', kind: 'pure', category: 'viz',
      summary: { pt: 'a', en: 'a' }, uses: { pt: [], en: [] },
      wheels: [{
        name: 'x', version: '1', filename: 'x-1-py3-none-any.whl',
        url: 'https://files.pythonhosted.org/x.whl', sha256: 'a'.repeat(64),
      }],
    }],
    ...over,
  });

  it('sem cache, vale a copia embutida no app', () => {
    const a = catalog.active();
    expect(a.source).toBe('embedded');
    expect(a.libraries.length).toBeGreaterThan(0);
  });

  it('com cache valido, o remoto tem precedencia', () => {
    fs.writeFileSync(path.join(tmp, 'catalog-cache.json'), JSON.stringify({
      fetchedAt: new Date().toISOString(), catalog: valid(),
    }));
    catalog.invalidate();
    const a = catalog.active();
    expect(a.source).toBe('remote');
    expect(a.libraries[0].id).toBe('x');
  });

  it('cache com formato mais novo e RECUSADO — o embutido assume', () => {
    // O cenario que essa guarda existe para cobrir: o catalogo do repo evolui e
    // uma AURORA antiga o encontra. Ler errado seria pior do que ficar velho.
    fs.writeFileSync(path.join(tmp, 'catalog-cache.json'), JSON.stringify({
      fetchedAt: new Date().toISOString(), catalog: valid({ schemaVersion: 99 }),
    }));
    catalog.invalidate();
    expect(catalog.active().source).toBe('embedded');
  });

  it('cache corrompido nao derruba nada', () => {
    fs.writeFileSync(path.join(tmp, 'catalog-cache.json'), '{ isso nao e json');
    catalog.invalidate();
    expect(catalog.active().source).toBe('embedded');
  });

  it('validate recusa wheel sem sha256 utilizavel', () => {
    const bad = valid();
    bad.libraries[0].wheels[0].sha256 = 'curto-demais';
    expect(catalog.validate(bad).ok).toBe(false);
  });

  it('validate recusa url que nao e https', () => {
    const bad = valid();
    bad.libraries[0].wheels[0].url = 'http://files.pythonhosted.org/x.whl';
    expect(catalog.validate(bad).ok).toBe(false);
  });

  it('validate recusa id repetido', () => {
    const bad = valid();
    bad.libraries.push({ ...bad.libraries[0] });
    expect(catalog.validate(bad).ok).toBe(false);
  });

  it('categoria desconhecida cai em "Outras" em vez de sumir da tela', () => {
    const c = catalog.normalize({
      schemaVersion: 1,
      categories: { viz: { pt: 'V', en: 'V' } },
      libraries: [{ id: 'a', category: 'viz' }, { id: 'b', category: 'inventada-no-futuro' }],
    });
    expect(c.libraries[0].category).toBe('viz');
    expect(c.libraries[1].category).toBe(catalog.FALLBACK_CATEGORY);
    expect(c.libraries[1].originalCategory).toBe('inventada-no-futuro');
    expect(c.categories[catalog.FALLBACK_CATEGORY]).toBeTruthy();
  });
});

describe('indice de icones', () => {
  const INDEX = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'assets', 'icons', 'pylibs.json'), 'utf8'),
  );
  const SPRITE = fs.readFileSync(
    path.join(process.cwd(), 'assets', 'icons', 'pylibs.svg'), 'utf8',
  );

  it('todo id do indice existe de fato no sprite', () => {
    for (const id of INDEX.ids) {
      expect(SPRITE).toContain(`id="pylib-${id}"`);
    }
  });

  it('tem o simbolo generico — e o recuo de todo icone desconhecido', () => {
    expect(INDEX.ids).toContain('generic');
  });

  it('todo icone citado pelo catalogo existe no sprite desta versao', () => {
    // Nao e obrigatorio (o painel cai no generico), mas um icone faltando na
    // nossa PROPRIA lista e descuido, nao evolucao do catalogo remoto.
    const ids = new Set(INDEX.ids);
    const faltando = CATALOG.libraries.map((l) => l.icon).filter((i) => i && !ids.has(i));
    expect(faltando).toEqual([]);
  });
});

describe('ligacao com o interpretador (.pth)', () => {
  let tmp;
  let fakeSitePackages;
  let manager;
  let paths;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-pylibs-pth-'));
    fakeSitePackages = path.join(tmp, 'bundle-site-packages');
    fs.mkdirSync(fakeSitePackages, { recursive: true });
    process.env.AURORA_PYLIBS_ROOT = tmp;
    process.env.AURORA_BUNDLE_SITE = fakeSitePackages;
    manager = await import('../../main/python/pylib_manager.js');
    paths = await import('../../main/python/pylib_paths.js');
  });

  afterEach(() => {
    delete process.env.AURORA_PYLIBS_ROOT;
    delete process.env.AURORA_BUNDLE_SITE;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('o ponteiro mora no site-packages do NOSSO interpretador', () => {
    // E disso que vem o isolamento: o site.py de cada Python le apenas os .pth
    // do site-packages dele. O Python do usuario nunca alcanca o nosso PyLibs,
    // entao nao ha colisao com o que ele instalou por pip.
    expect(paths.sitePthFile()).toBe(path.join(fakeSitePackages, 'aurora-pylibs.pth'));
  });

  it('nao escreve ponteiro quando nao ha biblioteca instalada', () => {
    const r = manager.ensureSitePth();
    expect(r.ok).toBe(false);
    expect(fs.existsSync(paths.sitePthFile())).toBe(false);
  });

  it('escreve o caminho do PyLibs, no formato do Windows', () => {
    fs.mkdirSync(path.join(tmp, 'site'), { recursive: true });
    const r = manager.ensureSitePth();
    expect(r.ok).toBe(true);
    const content = fs.readFileSync(paths.sitePthFile(), 'utf8');
    expect(content.trim()).toBe(path.normalize(path.join(tmp, 'site')));
  });

  it('e idempotente: rodar de novo nao reescreve', () => {
    fs.mkdirSync(path.join(tmp, 'site'), { recursive: true });
    manager.ensureSitePth();
    const before = fs.statSync(paths.sitePthFile()).mtimeMs;
    manager.ensureSitePth();
    expect(fs.statSync(paths.sitePthFile()).mtimeMs).toBe(before);
  });

  it('conserta um ponteiro que aponta para o lugar errado', () => {
    fs.mkdirSync(path.join(tmp, 'site'), { recursive: true });
    fs.writeFileSync(paths.sitePthFile(), 'C:\\lugar\\errado\n');
    manager.ensureSitePth();
    expect(fs.readFileSync(paths.sitePthFile(), 'utf8').trim())
      .toBe(path.normalize(path.join(tmp, 'site')));
  });

  it('remover a ULTIMA biblioteca desfaz a ligacao', () => {
    const site = path.join(tmp, 'site');
    fs.mkdirSync(path.join(site, 'solo'), { recursive: true });
    fs.writeFileSync(path.join(site, 'solo', 'mod.py'), 'x');
    fs.writeFileSync(path.join(tmp, 'installed.json'), JSON.stringify({
      schemaVersion: 1,
      installed: { solo: { version: '1', installedAt: '', wheels: [], files: ['solo/mod.py'], hashes: {} } },
    }));
    manager.ensureSitePth();
    expect(fs.existsSync(paths.sitePthFile())).toBe(true);

    manager.uninstall('solo');
    // O interpretador volta exatamente ao estado anterior ao uso do painel.
    expect(fs.existsSync(paths.sitePthFile())).toBe(false);
  });

  it('remover UMA de duas mantem a ligacao', () => {
    const site = path.join(tmp, 'site');
    fs.mkdirSync(path.join(site, 'a'), { recursive: true });
    fs.mkdirSync(path.join(site, 'b'), { recursive: true });
    fs.writeFileSync(path.join(site, 'a', 'mod.py'), 'x');
    fs.writeFileSync(path.join(site, 'b', 'mod.py'), 'y');
    fs.writeFileSync(path.join(tmp, 'installed.json'), JSON.stringify({
      schemaVersion: 1,
      installed: {
        a: { version: '1', installedAt: '', wheels: [], files: ['a/mod.py'], hashes: {} },
        b: { version: '1', installedAt: '', wheels: [], files: ['b/mod.py'], hashes: {} },
      },
    }));
    manager.ensureSitePth();
    manager.uninstall('a');
    expect(fs.existsSync(paths.sitePthFile())).toBe(true);
  });

  it('sem bundle do Python, falha limpo em vez de estourar', () => {
    delete process.env.AURORA_BUNDLE_SITE;
    fs.mkdirSync(path.join(tmp, 'site'), { recursive: true });
    const r = manager.ensureSitePth();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/bundle/i);
  });
});
