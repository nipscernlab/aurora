// @ts-check
/**
 * pylib_manager.js — instalar, desinstalar, reparar e listar as bibliotecas
 * Python do painel da AURORA.
 *
 * COMO FUNCIONA
 * -------------
 * Uma wheel do Python e um zip. Sem pip no runtime embarcado, "instalar" e
 * literalmente: baixar a wheel, conferir o sha256 que o catalogo fixou,
 * descompactar em components/PyLibs/site/ e anotar no manifesto o que foi
 * escrito. "Desinstalar" e apagar exatamente esses arquivos.
 *
 * Nao ha resolvedor de dependencias, e isso e proposital: o catalogo ja traz o
 * fecho completo pronto (scripts/gen-pylib-catalog.js monta e fixa), entao o
 * instalador so obedece a lista. Menos codigo, resultado deterministico, e o
 * mesmo conjunto de bytes em todas as maquinas.
 *
 * DEPENDENCIA COMPARTILHADA
 * -------------------------
 * `packaging` chega junto do plotly E do pytest; `pygments` junto do pytest E do
 * rich. Desinstalar um nao pode quebrar o outro. Por isso a remocao consulta os
 * arquivos de TODAS as outras bibliotecas instaladas e so apaga o que ninguem
 * mais reivindica.
 *
 * O QUE ELE RECUSA
 * ----------------
 * Wheel com extensao em C. O Python embarcado e um build MinGW e nao carrega o
 * .pyd compilado para o CPython da Microsoft — verificado na pratica, o erro e
 * "DLL load failed". Entao a checagem acontece ANTES do download, tanto para o
 * catalogo quanto para uma biblioteca arbitraria pedida pelo usuario, e a
 * resposta explica o motivo em vez de deixar quebrar no import.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const fetcher = require('../net/fetcher');
const { pylibRoot, pylibSite, manifestFile, stagingDir, ensureDirs } = require('./pylib_paths');

/**
 * Caminho do Python embarcado, resolvido tarde. O python_locator depende de
 * `main/paths.js`, que so existe dentro do Electron; carregar no topo quebraria
 * os testes e o gerador de catalogo, que rodam em node puro.
 */
function bundledPython() {
  try {
    return require('../compile/python_locator').getBundledPythonPath();
  } catch (_) {
    return '';
  }
}

let log;
try { log = require('electron-log'); } catch (_) { log = console; }

const MANIFEST_VERSION = 1;
/** Sufixo que identifica uma wheel sem nada compilado dentro. */
const PURE_SUFFIX = '-none-any.whl';
const PYPI_JSON = (name) => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;

/* ── Catalogo ─────────────────────────────────────────────────────────────── */

/** @type {any|null} */
let catalogCache = null;

/**
 * O catalogo curado, versionado junto com o app em resources/pylib-catalog.json.
 * Ele guarda metadados e hashes; os bytes vem da PyPI na instalacao.
 */
function loadCatalog() {
  if (catalogCache) return catalogCache;
  const file = path.join(__dirname, '..', '..', 'resources', 'pylib-catalog.json');
  try {
    catalogCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    log.error('[pylibs] catalogo ilegivel:', e);
    catalogCache = { schemaVersion: MANIFEST_VERSION, python: {}, categories: {}, libraries: [] };
  }
  return catalogCache;
}

function catalogEntry(/** @type {string} */ id) {
  return loadCatalog().libraries.find((l) => l.id === id) || null;
}

/* ── Manifesto do que esta instalado ──────────────────────────────────────── */

function readManifest() {
  try {
    const m = JSON.parse(fs.readFileSync(manifestFile(), 'utf8'));
    if (m && typeof m === 'object' && m.installed) return m;
  } catch (_) { /* inexistente ou corrompido — comeca limpo */ }
  return { schemaVersion: MANIFEST_VERSION, abiTag: null, installed: {} };
}

function writeManifest(/** @type {any} */ m) {
  ensureDirs();
  fs.writeFileSync(manifestFile(), `${JSON.stringify(m, null, 2)}\n`);
}

/* ── Utilidades ───────────────────────────────────────────────────────────── */

/**
 * Recusa caminhos que escapam do diretorio de destino. Uma wheel e um zip
 * qualquer da internet; entrada com `..` ou caminho absoluto escreveria fora do
 * PyLibs/site. O libarchive ja resiste a isso, mas a checagem e barata e a
 * consequencia de errar e grave.
 */
function isSafeEntry(/** @type {string} */ entry) {
  const p = String(entry || '').replace(/\\/g, '/');
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  return !p.split('/').includes('..');
}

/** Remove diretorios que ficaram vazios depois de uma desinstalacao. */
function pruneEmptyDirs(/** @type {string} */ root) {
  /** @returns {boolean} true se `dir` ficou (ou ja estava) vazio e foi removido */
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return false; }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
    }
    try {
      if (fs.readdirSync(dir).length === 0 && path.resolve(dir) !== path.resolve(root)) {
        fs.rmdirSync(dir);
        return true;
      }
    } catch (_) { /* em uso — fica para a proxima */ }
    return false;
  };
  walk(root);
}

/** Arquivos reivindicados por qualquer biblioteca instalada que nao seja `exceptId`. */
function filesOwnedByOthers(/** @type {any} */ manifest, /** @type {string} */ exceptId) {
  const set = new Set();
  for (const [id, rec] of Object.entries(manifest.installed || {})) {
    if (id === exceptId) continue;
    for (const f of (/** @type {any} */ (rec).files || [])) set.add(f);
  }
  return set;
}

/** O primeiro segmento de cada caminho — os diretorios de topo que a wheel criou. */
function topLevelDirs(/** @type {string[]} */ files) {
  const set = new Set();
  for (const f of files || []) {
    const head = String(f).split('/')[0];
    if (head && head !== f) set.add(head); // ignora arquivo solto na raiz
  }
  return set;
}

/* ── Estado para o painel ─────────────────────────────────────────────────── */

/**
 * Tudo que o painel precisa numa chamada: o catalogo, o que esta instalado e a
 * saude do runtime.
 */
function getState() {
  const catalog = loadCatalog();
  const manifest = readManifest();
  const pythonPath = bundledPython();
  const pythonPresent = !!pythonPath && fs.existsSync(pythonPath);

  const libraries = catalog.libraries.map((lib) => {
    const rec = manifest.installed[lib.id] || null;
    return {
      ...lib,
      installed: !!rec,
      installedVersion: rec ? rec.version : null,
      installedAt: rec ? rec.installedAt : null,
      // `broken` = manifesto diz instalado mas os arquivos sumiram. E o que o
      // botao Reparar existe para resolver.
      broken: rec ? !verifyFiles(rec).ok : false,
    };
  });

  return {
    schemaVersion: catalog.schemaVersion,
    python: { ...catalog.python, present: pythonPresent, path: pythonPath },
    categories: catalog.categories,
    site: pylibSite(),
    root: pylibRoot(),
    libraries,
  };
}

/** Confere se os arquivos anotados no manifesto ainda existem no disco. */
function verifyFiles(/** @type {any} */ rec) {
  const site = pylibSite();
  const missing = [];
  for (const rel of rec.files || []) {
    if (!fs.existsSync(path.join(site, rel))) {
      missing.push(rel);
      if (missing.length > 20) break; // amostra basta para decidir
    }
  }
  return { ok: missing.length === 0, missing };
}

/* ── Instalacao ───────────────────────────────────────────────────────────── */

/** @type {Map<string, Promise<any>>} */
const inFlight = new Map();

/**
 * Instala uma biblioteca do catalogo.
 *
 * @param {string} id
 * @param {{onProgress?: (p:any)=>void, force?: boolean}} [opts]
 */
function install(id, opts = {}) {
  const pending = inFlight.get(id);
  if (pending) return pending;
  const job = _install(id, opts).finally(() => inFlight.delete(id));
  inFlight.set(id, job);
  return job;
}

async function _install(/** @type {string} */ id, /** @type {any} */ opts) {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`biblioteca desconhecida: ${id}`);
  if (entry.kind === 'compiled' || !entry.wheels?.length) {
    throw new Error(
      `${entry.name} tem extensao em C e nao roda no Python embarcado (build MinGW). `
      + 'Use o terminal TCMD com o seu proprio Python.',
    );
  }

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const manifest = readManifest();
  if (manifest.installed[id] && !opts.force) {
    onProgress({ id, phase: 'done', pct: 100 });
    return { id, alreadyInstalled: true };
  }

  ensureDirs();
  const staging = path.join(stagingDir(), id);
  fetcher.rmrf(staging);
  fs.mkdirSync(staging, { recursive: true });

  const site = pylibSite();
  const wheels = entry.wheels;
  const totalBytes = wheels.reduce((n, w) => n + (w.size || 0), 0) || 1;
  let doneBytes = 0;
  /** @type {string[]} */
  const files = [];

  try {
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      const label = `${w.name} ${w.version}`;
      const whl = path.join(staging, w.filename);

      // 1. baixar, com o progresso agregado de TODAS as wheels da biblioteca
      //    (o usuario ve uma barra so, nao uma por dependencia).
      onProgress({ id, phase: 'download', pct: Math.round((doneBytes / totalBytes) * 100), detail: label });
      const { digest } = await fetcher.downloadToFile(w.url, whl, {
        algorithm: 'sha256',
        userAgent: 'aurora-ide-pylibs',
        onChunk: (received) => {
          const pct = Math.round(((doneBytes + received) / totalBytes) * 100);
          onProgress({ id, phase: 'download', pct: Math.min(99, pct), detail: label });
        },
      });
      doneBytes += w.size || 0;

      // 2. conferir o hash ANTES de descompactar: byte trocado nunca vira
      //    arquivo instalado.
      onProgress({ id, phase: 'verify', pct: Math.round((doneBytes / totalBytes) * 100), detail: label });
      if (!fetcher.digestMatches(digest, w.sha256)) {
        throw new Error(`hash nao confere para ${w.filename} — download recusado`);
      }

      // 3. inspecionar antes de extrair; recusa caminho que escapa do destino.
        onProgress({ id, phase: 'extract', pct: Math.round((doneBytes / totalBytes) * 100), detail: label });
      const entries = await fetcher.listArchive(whl);
      const unsafe = entries.filter((e) => !isSafeEntry(e));
      if (unsafe.length) {
        throw new Error(`${w.filename} contem caminho invalido (${unsafe[0]}) — instalacao abortada`);
      }

      await fetcher.extractArchive(whl, site);
      for (const e of entries) {
        if (e.endsWith('/')) continue; // diretorio
        files.push(e.replace(/\\/g, '/'));
      }
      try { fs.unlinkSync(whl); } catch (_) { /* best-effort */ }
    }

    // 4. anotar. Sem isso, desinstalar viraria adivinhacao.
    manifest.schemaVersion = MANIFEST_VERSION;
    manifest.abiTag = loadCatalog().python?.abiTag || null;
    manifest.installed[id] = {
      version: entry.version,
      installedAt: new Date().toISOString(),
      wheels: wheels.map((w) => ({ name: w.name, version: w.version, sha256: w.sha256 })),
      files,
    };
    writeManifest(manifest);

    onProgress({ id, phase: 'done', pct: 100 });
    log.info(`[pylibs] instalada ${id} ${entry.version} (${files.length} arquivos)`);
    return { id, version: entry.version, files: files.length };
  } finally {
    fetcher.rmrf(staging);
  }
}

/* ── Desinstalacao ────────────────────────────────────────────────────────── */

/**
 * Remove uma biblioteca, preservando os arquivos que outra biblioteca instalada
 * tambem reivindica (dependencia compartilhada).
 * @param {string} id
 */
function uninstall(id) {
  const manifest = readManifest();
  const rec = manifest.installed[id];
  if (!rec) return { id, removed: 0, kept: 0, notInstalled: true };

  const site = pylibSite();
  const shared = filesOwnedByOthers(manifest, id);
  let removed = 0;
  let kept = 0;

  for (const rel of rec.files || []) {
    if (shared.has(rel)) { kept++; continue; }
    try {
      fs.rmSync(path.join(site, rel), { force: true });
      removed++;
    } catch (_) { /* travado — o prune da proxima vez pega */ }
  }

  // Apagar so os arquivos anotados nao basta: assim que o Python importa a
  // biblioteca uma vez, ele escreve bytecode em __pycache__/ ao lado de cada
  // modulo. Esses .pyc nao existiam na wheel, entao nao estao no manifesto, e
  // sem esta varredura a pasta da biblioteca sobrevive a desinstalacao cheia de
  // cache orfao (medido: `plotly/` continuava no disco depois de remover os
  // 1828 arquivos dela).
  //
  // A regra e conservadora: um diretorio de topo so e apagado inteiro quando
  // NENHUMA outra biblioteca instalada reivindica arquivo dentro dele. Um
  // diretorio compartilhado (`packaging`, que chega com o plotly e com o pytest)
  // fica de pe.
  for (const dir of topLevelDirs(rec.files || [])) {
    const stillClaimed = [...shared].some((f) => f.startsWith(`${dir}/`));
    if (stillClaimed) continue;
    fetcher.rmrf(path.join(site, dir));
  }

  delete manifest.installed[id];
  writeManifest(manifest);
  pruneEmptyDirs(site);

  log.info(`[pylibs] removida ${id} (${removed} arquivos, ${kept} preservados por outra lib)`);
  return { id, removed, kept };
}

/* ── Reparo ───────────────────────────────────────────────────────────────── */

/**
 * Reinstala por cima. Serve para o caso "o manifesto diz que esta instalado mas
 * os arquivos sumiram" e para forcar o re-download quando algo ficou estranho.
 * @param {string} id
 * @param {{onProgress?: (p:any)=>void}} [opts]
 */
async function repair(id, opts = {}) {
  const manifest = readManifest();
  if (manifest.installed[id]) uninstall(id);
  return install(id, { ...opts, force: true });
}

/* ── Bibliotecas fora do catalogo ─────────────────────────────────────────── */

/**
 * Consulta a PyPI para uma biblioteca qualquer e responde se ela e instalavel
 * AQUI, antes de baixar um byte.
 *
 * Este e o segundo nivel do painel: fora da lista curada, o usuario digita um
 * nome e a AURORA responde na hora, com o motivo. E uma condicao verificavel,
 * nao um palpite — se a PyPI publica wheel `*-none-any.whl`, roda; se so publica
 * wheel compilada, nao roda de jeito nenhum e o caminho e o TCMD.
 *
 * @param {string} name
 */
async function resolveExternal(name) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/.test(clean)) {
    return { ok: false, reason: 'invalid-name', message: 'Nome de pacote invalido.' };
  }

  let meta;
  try {
    meta = await fetcher.getJson(PYPI_JSON(clean));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('HTTP 404')) {
      return { ok: false, reason: 'not-found', message: `"${clean}" nao existe na PyPI.` };
    }
    return { ok: false, reason: 'network', message: msg };
  }

  const version = meta.info?.version || '';
  const wheels = (meta.urls || []).filter((u) => u.packagetype === 'bdist_wheel');
  const pure = wheels.find((u) => String(u.filename).endsWith(PURE_SUFFIX));

  if (!pure) {
    return {
      ok: false,
      reason: 'compiled',
      name: meta.info?.name || clean,
      version,
      summary: meta.info?.summary || '',
      homepage: meta.info?.home_page || meta.info?.project_urls?.Homepage || '',
      message:
        `${meta.info?.name || clean} ${version} so publica wheel com extensao em C. `
        + 'O Python embarcado da AURORA e um build MinGW e nao carrega esse formato. '
        + 'Use o terminal TCMD com o seu proprio Python.',
    };
  }

  return {
    ok: true,
    name: meta.info?.name || clean,
    version,
    summary: meta.info?.summary || '',
    homepage: meta.info?.home_page || meta.info?.project_urls?.Homepage || '',
    license: meta.info?.license_expression || meta.info?.license || null,
    // Dependencias NAO sao resolvidas: sem pip nao ha resolvedor. O painel avisa
    // que pode ser preciso instalar as dependencias a mao.
    requiresDist: meta.info?.requires_dist || [],
    wheel: {
      name: meta.info?.name || clean,
      version,
      filename: pure.filename,
      url: pure.url,
      sha256: pure.digests?.sha256,
      size: pure.size,
    },
  };
}

/**
 * Instala uma biblioteca resolvida por resolveExternal. Fica registrada no
 * manifesto com `external: true`, para o painel separar o que veio da lista
 * curada do que o usuario trouxe por conta propria.
 *
 * @param {string} name
 * @param {{onProgress?: (p:any)=>void}} [opts]
 */
async function installExternal(name, opts = {}) {
  const resolved = await resolveExternal(name);
  if (!resolved.ok) throw new Error(resolved.message);

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const id = `pypi:${resolved.name.toLowerCase()}`;
  const w = resolved.wheel;

  ensureDirs();
  const staging = path.join(stagingDir(), id.replace(/[^\w.-]/g, '_'));
  fetcher.rmrf(staging);
  fs.mkdirSync(staging, { recursive: true });
  const site = pylibSite();
  const whl = path.join(staging, w.filename);

  try {
    onProgress({ id, phase: 'download', pct: 0, detail: `${w.name} ${w.version}` });
    const { digest } = await fetcher.downloadToFile(w.url, whl, {
      algorithm: 'sha256',
      userAgent: 'aurora-ide-pylibs',
      onChunk: (received, total) => {
        const pct = total > 0 ? Math.round((received / total) * 100) : 0;
        onProgress({ id, phase: 'download', pct: Math.min(99, pct), detail: `${w.name} ${w.version}` });
      },
    });

    onProgress({ id, phase: 'verify', pct: 100 });
    if (w.sha256 && !fetcher.digestMatches(digest, w.sha256)) {
      throw new Error(`hash nao confere para ${w.filename} — download recusado`);
    }

    onProgress({ id, phase: 'extract', pct: 100 });
    const entries = await fetcher.listArchive(whl);
    const unsafe = entries.filter((e) => !isSafeEntry(e));
    if (unsafe.length) throw new Error(`${w.filename} contem caminho invalido (${unsafe[0]})`);
    await fetcher.extractArchive(whl, site);

    const manifest = readManifest();
    manifest.schemaVersion = MANIFEST_VERSION;
    manifest.installed[id] = {
      external: true,
      name: resolved.name,
      version: w.version,
      installedAt: new Date().toISOString(),
      wheels: [{ name: w.name, version: w.version, sha256: w.sha256 }],
      files: entries.filter((e) => !e.endsWith('/')).map((e) => e.replace(/\\/g, '/')),
    };
    writeManifest(manifest);

    log.info(`[pylibs] instalada externa ${resolved.name} ${w.version}`);
    onProgress({ id, phase: 'done', pct: 100 });
    return { id, name: resolved.name, version: w.version };
  } finally {
    fetcher.rmrf(staging);
  }
}

/** As bibliotecas trazidas pelo usuario (fora da lista curada). */
function listExternal() {
  const manifest = readManifest();
  return Object.entries(manifest.installed)
    .filter(([, rec]) => (/** @type {any} */ (rec)).external)
    .map(([id, rec]) => ({
      id,
      name: (/** @type {any} */ (rec)).name,
      version: (/** @type {any} */ (rec)).version,
      installedAt: (/** @type {any} */ (rec)).installedAt,
      broken: !verifyFiles(rec).ok,
    }));
}

/* ── Doutor ───────────────────────────────────────────────────────────────── */

/**
 * Diagnostico do conjunto. Alem de arquivo faltando, detecta a armadilha que
 * derruba tudo em silencio: o bundle subir de versao do Python e as bibliotecas
 * instaladas ficarem para uma ABI que nao existe mais.
 */
function doctor() {
  const manifest = readManifest();
  const catalog = loadCatalog();
  const expectedAbi = catalog.python?.abiTag || null;
  const issues = [];

  if (manifest.abiTag && expectedAbi && manifest.abiTag !== expectedAbi) {
    issues.push({
      kind: 'abi-drift',
      message:
        `As bibliotecas foram instaladas para ${manifest.abiTag} e o catalogo agora espera `
        + `${expectedAbi}. Reinstale-as (Reparar) para acompanhar o Python novo.`,
    });
  }

  for (const [id, rec] of Object.entries(manifest.installed)) {
    const check = verifyFiles(rec);
    if (!check.ok) {
      issues.push({
        kind: 'missing-files',
        id,
        message: `${id}: ${check.missing.length}+ arquivo(s) faltando. Use Reparar.`,
      });
    }
  }

  return { ok: issues.length === 0, issues, installed: Object.keys(manifest.installed).length };
}

module.exports = {
  loadCatalog,
  catalogEntry,
  getState,
  install,
  uninstall,
  repair,
  resolveExternal,
  installExternal,
  listExternal,
  doctor,
  readManifest,
  isSafeEntry,
  PURE_SUFFIX,
};
