/**
 * pylib_manager.ts: instalar, desinstalar, reparar e listar as bibliotecas
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
 * .pyd compilado para o CPython da Microsoft, verificado na pratica, o erro e
 * "DLL load failed". Entao a checagem acontece ANTES do download, tanto para o
 * catalogo quanto para uma biblioteca arbitraria pedida pelo usuario, e a
 * resposta explica o motivo em vez de deixar quebrar no import.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import log from 'electron-log';

import fetcher from '../net/fetcher.js';
import {
  pylibRoot, pylibSite, manifestFile, stagingDir, ensureDirs, sitePthFile,
} from './pylib_paths.js';
import catalogSource from './pylib_catalog.js';
import { getBundledPythonPath } from '../compile/python_locator.js';

/* ── Tipos ────────────────────────────────────────────────────────────────── */

/** Uma wheel do catalogo, com o sha256 que o gerador fixou. */
interface CatalogWheel {
  name: string;
  version: string;
  filename: string;
  url: string;
  sha256: string;
  size?: number;
}

/** Uma biblioteca do catalogo. As compiladas vem sem wheel, so informativas. */
interface CatalogLibrary {
  id: string;
  name: string;
  version: string;
  kind: 'pure' | 'compiled';
  wheels: CatalogWheel[];
  [campo: string]: unknown;
}

interface Catalog {
  schemaVersion: number;
  source?: 'remote' | 'embedded';
  fetchedAt?: string | null;
  python: { abiTag?: string; [campo: string]: unknown };
  categories: Record<string, unknown>;
  libraries: CatalogLibrary[];
}

/** Inventario de um arquivo, tirado do RECORD da wheel. */
interface FileHash {
  sha256: string | null;
  size: number | null;
}

/** O que o manifesto guarda de cada biblioteca instalada. */
interface ManifestRecord {
  external?: boolean;
  name?: string;
  version: string;
  installedAt: string;
  wheels: Array<{ name: string; version: string; sha256?: string }>;
  files: string[];
  hashes: Record<string, FileHash>;
}

interface Manifest {
  schemaVersion: number;
  abiTag: string | null;
  installed: Record<string, ManifestRecord>;
}

interface Progress {
  id: string;
  phase: 'download' | 'verify' | 'extract' | 'done';
  pct: number;
  detail?: string;
}

type OnProgress = (p: Progress) => void;

/** Um achado do doutor: a ABI que mudou, ou os arquivos de uma biblioteca. */
type Issue =
  | { kind: 'abi-drift'; message: string }
  | {
    kind: 'corrupt-files' | 'missing-files';
    id: string;
    counts: { missing: number; resized: number; corrupt: number };
    sample: string[];
    message: string;
  };

interface FileProblem {
  file: string;
  problem: 'missing' | 'size' | 'corrupt' | 'unreadable';
}

interface VerifyResult {
  ok: boolean;
  problems: FileProblem[];
  missing: string[];
}

/** A resposta da PyPI, so os campos que se le. */
interface PypiUrl {
  packagetype?: string;
  filename: string;
  url: string;
  size?: number;
  digests?: { sha256?: string };
}

interface PypiMeta {
  info?: {
    name?: string;
    version?: string;
    summary?: string;
    home_page?: string;
    project_urls?: { Homepage?: string };
    license_expression?: string;
    license?: string;
    requires_dist?: string[];
  };
  urls?: PypiUrl[];
}

type ResolveResult =
  | { ok: false; reason: 'invalid-name' | 'not-found' | 'network'; message: string }
  | {
    ok: false;
    reason: 'compiled';
    name: string;
    version: string;
    summary: string;
    homepage: string;
    message: string;
  }
  | {
    ok: true;
    name: string;
    version: string;
    summary: string;
    homepage: string;
    license: string | null;
    requiresDist: string[];
    wheel: {
      name: string;
      version: string;
      filename: string;
      url: string;
      sha256: string | undefined;
      size: number | undefined;
    };
  };

/** Caminho do Python embarcado. */
function bundledPython(): string {
  return getBundledPythonPath();
}

const MANIFEST_VERSION = 1;
/** Sufixo que identifica uma wheel sem nada compilado dentro. */
export const PURE_SUFFIX = '-none-any.whl';
const PYPI_JSON = (name: string) => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;

/* ── Catalogo ─────────────────────────────────────────────────────────────── */

/**
 * A lista em vigor. Quem escolhe entre o catalogo remoto (nipscernlab/
 * aurora-pylibs) e a copia embutida no app e o pylib_catalog; aqui so se
 * consome o resultado, entao instalar, remover e verificar funcionam igual
 * independentemente de onde a lista veio.
 */
export function loadCatalog(): Catalog {
  return catalogSource.active() as Catalog;
}

export function catalogEntry(id: string): CatalogLibrary | null {
  return loadCatalog().libraries.find((l) => l.id === id) || null;
}

/* ── Manifesto do que esta instalado ──────────────────────────────────────── */

export function readManifest(): Manifest {
  try {
    const m = JSON.parse(fs.readFileSync(manifestFile(), 'utf8'));
    if (m && typeof m === 'object' && m.installed) return m;
  } catch (_) { /* inexistente ou corrompido — comeca limpo */ }
  return { schemaVersion: MANIFEST_VERSION, abiTag: null, installed: {} };
}

function writeManifest(m: Manifest) {
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
export function isSafeEntry(entry: string): boolean {
  const p = String(entry || '').replace(/\\/g, '/');
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  return !p.split('/').includes('..');
}

/** Remove diretorios que ficaram vazios depois de uma desinstalacao. */
function pruneEmptyDirs(root: string) {
  /** true se `dir` ficou (ou ja estava) vazio e foi removido */
  const walk = (dir: string): boolean => {
    let entries: fs.Dirent[];
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
function filesOwnedByOthers(manifest: Manifest, exceptId: string): Set<string> {
  const set = new Set<string>();
  for (const [id, rec] of Object.entries(manifest.installed || {})) {
    if (id === exceptId) continue;
    for (const f of (rec.files || [])) set.add(f);
  }
  return set;
}

/** O primeiro segmento de cada caminho, os diretorios de topo que a wheel criou. */
function topLevelDirs(files: string[]): Set<string> {
  const set = new Set<string>();
  for (const f of files || []) {
    const head = String(f).split('/')[0];
    if (head && head !== f) set.add(head); // ignora arquivo solto na raiz
  }
  return set;
}

/* ── Integridade ──────────────────────────────────────────────────────────── */

/**
 * Le o RECORD que toda wheel traz dentro do `.dist-info/`.
 *
 * O RECORD e o inventario oficial da wheel, no formato
 * `caminho,sha256=<base64url>,tamanho` por linha. Usar ele significa que temos
 * hash de CADA arquivo instalado sem calcular nada na instalacao: a wheel ja
 * chega com essa informacao pronta e assinada pelo proprio empacotador.
 *
 * (A ultima linha do proprio RECORD vem sem hash e sem tamanho, porque ele nao
 * pode conter o hash de si mesmo. Essas linhas viram entradas sem verificacao.)
 *
 * @param text conteudo do RECORD
 */
export function parseRecord(text: string): Record<string, FileHash> {
  const out: Record<string, FileHash> = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // O caminho pode conter virgula (raro, mas legal no formato), entao o parse
    // e feito pela DIREITA: os dois ultimos campos sao sempre hash e tamanho.
    const lastComma = line.lastIndexOf(',');
    if (lastComma < 0) continue;
    const prevComma = line.lastIndexOf(',', lastComma - 1);
    if (prevComma < 0) continue;

    const file = line.slice(0, prevComma).replace(/\\/g, '/');
    const hash = line.slice(prevComma + 1, lastComma);
    const size = line.slice(lastComma + 1);
    if (!file) continue;

    out[file] = {
      sha256: hash.startsWith('sha256=') ? hash.slice('sha256='.length) : null,
      size: size ? Number(size) : null,
    };
  }
  return out;
}

/** Acha e le o RECORD de uma wheel ja extraida no site/. */
function readRecordFor(entries: string[]): Record<string, FileHash> {
  const rec = entries.find((e) => /(^|\/)[^/]+\.dist-info\/RECORD$/.test(e));
  if (!rec) return {};
  try {
    return parseRecord(fs.readFileSync(path.join(pylibSite(), rec), 'utf8'));
  } catch (_) {
    return {};
  }
}

/** sha256 de um buffer no formato base64url sem padding, como o RECORD usa. */
function hashDeBuffer(buf: Buffer): string {
  const h = crypto.createHash('sha256');
  h.update(buf);
  return h.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** sha256 de um arquivo no formato base64url sem padding, como o RECORD usa. */
function fileHash(abs: string): string {
  return hashDeBuffer(fs.readFileSync(abs));
}

/**
 * Verifica os arquivos de uma biblioteca instalada.
 *
 * Dois niveis, porque tem custo bem diferente:
 *
 *   rapido, so `stat`: o arquivo existe e o tamanho bate. Nao le conteudo
 *            nenhum, entao roda sobre milhares de arquivos em milissegundos.
 *            Pega o caso comum: o antivirus removeu ou pos em quarentena, o
 *            disco encheu no meio da extracao, alguem apagou a pasta.
 *
 *   fundo , le cada arquivo e compara o sha256 com o do RECORD. Pega
 *            corrupcao silenciosa, em que o tamanho continua certo mas o
 *            conteudo mudou. Custa I/O de verdade, entao nao roda sozinho:
 *            e o botao "verificacao completa" do painel.
 *
 * @param rec entrada do manifesto
 */
export function verifyFiles(rec: ManifestRecord, opts: { deep?: boolean; maxReport?: number } = {}): VerifyResult {
  const site = pylibSite();
  const deep = !!opts.deep;
  const maxReport = opts.maxReport ?? 20;
  const hashes = rec.hashes || {};
  const problems: FileProblem[] = [];

  for (const rel of rec.files || []) {
    if (problems.length >= maxReport) break;
    const abs = path.join(site, rel);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch (_) {
      problems.push({ file: rel, problem: 'missing' });
      continue;
    }

    const expected = hashes[rel];
    if (!expected) continue; // sem inventario para este arquivo — nada a comparar

    if (expected.size != null && st.size !== expected.size) {
      problems.push({ file: rel, problem: 'size' });
      continue;
    }
    if (deep && expected.sha256) {
      try {
        if (fileHash(abs) !== expected.sha256) problems.push({ file: rel, problem: 'corrupt' });
      } catch (_) {
        problems.push({ file: rel, problem: 'unreadable' });
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    // Mantido para quem so quer a contagem do que sumiu.
    missing: problems.filter((p) => p.problem === 'missing').map((p) => p.file),
  };
}

/**
 * A mesma verificacao, sem bloquear o thread principal.
 *
 * O `verifyFiles` sincrono faz `statSync` em cada arquivo de cada biblioteca,
 * e o vigia (pylib_watch.js) o chamava no instante em que a janela recuperava
 * o foco: milhares de stats seguidos no thread do main, bem quando a interface
 * precisa responder. Aqui os stats saem em lotes com `fs.promises`, entao o
 * event loop respira entre um lote e outro. O resultado tem a mesma forma.
 *
 * @param rec entrada do manifesto
 */
async function verifyFilesAsync(
  rec: ManifestRecord,
  opts: { deep?: boolean; maxReport?: number } = {},
): Promise<VerifyResult> {
  const site = pylibSite();
  const deep = !!opts.deep;
  const maxReport = opts.maxReport ?? 20;
  const hashes = rec.hashes || {};
  const files = rec.files || [];
  const problems: FileProblem[] = [];
  const LOTE = 64;

  for (let i = 0; i < files.length && problems.length < maxReport; i += LOTE) {
    const lote = files.slice(i, i + LOTE);
    const stats = await Promise.all(
      lote.map((rel) => fs.promises.stat(path.join(site, rel)).catch(() => null)),
    );
    for (let k = 0; k < lote.length && problems.length < maxReport; k++) {
      const rel = lote[k];
      const st = stats[k];
      if (!st) { problems.push({ file: rel, problem: 'missing' }); continue; }
      const expected = hashes[rel];
      if (!expected) continue;
      if (expected.size != null && st.size !== expected.size) {
        problems.push({ file: rel, problem: 'size' });
        continue;
      }
      if (deep && expected.sha256) {
        try {
          const buf = await fs.promises.readFile(path.join(site, rel));
          if (hashDeBuffer(buf) !== expected.sha256) problems.push({ file: rel, problem: 'corrupt' });
        } catch (_) {
          problems.push({ file: rel, problem: 'unreadable' });
        }
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    missing: problems.filter((p) => p.problem === 'missing').map((p) => p.file),
  };
}

/**
 * Faltou alguma sentinela da biblioteca? Sao poucos `stat` (o RECORD e o
 * `__init__` do pacote de topo), por isso serve para o painel abrir e para o
 * instante antes de simular, onde a verificacao completa nao cabe.
 * @param rec entrada do manifesto
 * @param site pylibSite()
 */
function sentinelasFaltando(rec: ManifestRecord, site: string): boolean {
  const files = rec.files || [];
  const sentinels = files.filter((f) => /\.dist-info\/RECORD$/.test(f) || /^[^/]+\/__init__\.py$/.test(f));
  for (const rel of sentinels.slice(0, 4)) {
    if (!fs.existsSync(path.join(site, rel))) return true;
  }
  return false;
}

/* ── Ligacao com o interpretador ──────────────────────────────────────────── */

/**
 * Garante que o `.pth` que aponta para o PyLibs existe e esta correto.
 *
 * Idempotente e barato (uma leitura e, no maximo, uma escrita de uma linha), de
 * modo que pode rodar na abertura do app e depois de cada instalacao. E o que
 * faz as bibliotecas valerem para qualquer arquivo Python, e nao so para o
 * fluxo do cocotb, ver o comentario em pylib_paths.sitePthFile.
 *
 */
export function ensureSitePth(): { ok: boolean; path?: string; reason?: string } {
  const pth = sitePthFile();
  if (!pth) return { ok: false, reason: 'bundle do Python nao encontrado' };

  const site = pylibSite();
  if (!fs.existsSync(site)) return { ok: false, reason: 'nenhuma biblioteca instalada' };

  // O Python precisa do caminho no formato nativo do Windows.
  const line = `${path.normalize(site)}\n`;
  try {
    if (fs.existsSync(pth) && fs.readFileSync(pth, 'utf8') === line) {
      return { ok: true, path: pth };
    }
    fs.writeFileSync(pth, line);
    log.info(`[pylibs] ligacao com o interpretador escrita em ${pth}`);
    return { ok: true, path: pth };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Desfaz a ligacao. Usado quando a ultima biblioteca e removida. */
export function removeSitePth(): void {
  const pth = sitePthFile();
  if (!pth) return;
  try { fs.rmSync(pth, { force: true }); } catch (_) { /* best-effort */ }
}

/* ── Estado para o painel ─────────────────────────────────────────────────── */

/**
 * Tudo que o painel precisa numa chamada: o catalogo, o que esta instalado e a
 * saude do runtime.
 */
export function getState() {
  const catalog = loadCatalog();
  const manifest = readManifest();
  const pythonPath = bundledPython();
  const pythonPresent = !!pythonPath && fs.existsSync(pythonPath);

  const site = pylibSite();
  const libraries = catalog.libraries.map((lib) => {
    const rec = manifest.installed[lib.id] || null;
    return {
      ...lib,
      installed: !!rec,
      installedVersion: rec ? rec.version : null,
      installedAt: rec ? rec.installedAt : null,
      // `broken` = manifesto diz instalado mas os arquivos sumiram. E o que o
      // botao Reparar existe para resolver. Pela sentinela, e nao pela
      // verificacao completa: o painel pede este estado a cada abertura, e a
      // completa (milhares de stats) ja roda no vigia e chega por
      // `pylibs:health`.
      broken: rec ? sentinelasFaltando(rec, site) : false,
    };
  });

  return {
    schemaVersion: catalog.schemaVersion,
    // De onde a lista veio ('remote' | 'embedded') e quando. O painel mostra
    // isso: sem essa informacao, uma lista desatualizada por falha de rede
    // seria indistinguivel de uma lista atual.
    catalogSource: catalog.source || 'embedded',
    catalogFetchedAt: catalog.fetchedAt || null,
    python: { ...catalog.python, present: pythonPresent, path: pythonPath },
    categories: catalog.categories,
    site: pylibSite(),
    root: pylibRoot(),
    libraries,
  };
}

/* ── Instalacao ───────────────────────────────────────────────────────────── */

interface InstallOpts {
  onProgress?: OnProgress;
  force?: boolean;
}

const inFlight = new Map<string, ReturnType<typeof _install>>();

/** Instala uma biblioteca do catalogo. */
export function install(id: string, opts: InstallOpts = {}) {
  const pending = inFlight.get(id);
  if (pending) return pending;
  const job = _install(id, opts).finally(() => inFlight.delete(id));
  inFlight.set(id, job);
  return job;
}

async function _install(id: string, opts: InstallOpts) {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`biblioteca desconhecida: ${id}`);
  if (entry.kind === 'compiled' || !entry.wheels?.length) {
    throw new Error(
      `${entry.name} tem extensao em C e nao roda no Python embarcado (build MinGW). `
      + 'Use o terminal TCMD com o seu proprio Python.',
    );
  }

  const onProgress: OnProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  // Leitura de ENTRADA, so para o atalho "ja esta". O manifesto e relido no
  // commit, la embaixo: entre aqui e la ha downloads, e uma segunda
  // instalacao (ou uma desinstalacao) que terminasse no meio era sobrescrita
  // por esta copia velha, deixando a biblioteca dela orfa no disco.
  if (readManifest().installed[id] && !opts.force) {
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
  const files: string[] = [];
  const hashes: Record<string, FileHash> = {};

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
      const entries: string[] = await fetcher.listArchive(whl);
      const unsafe = entries.filter((e) => !isSafeEntry(e));
      if (unsafe.length) {
        throw new Error(`${w.filename} contem caminho invalido (${unsafe[0]}) — instalacao abortada`);
      }

      await fetcher.extractArchive(whl, site);
      for (const e of entries) {
        if (e.endsWith('/')) continue; // diretorio
        files.push(e.replace(/\\/g, '/'));
      }
      // O inventario da propria wheel (sha256 + tamanho por arquivo), lido do
      // RECORD que ela ja traz. E o que permite ao doutor dizer depois se um
      // arquivo sumiu, encolheu ou mudou de conteudo, sem isso, "instalada"
      // seria so uma anotacao de fe.
      Object.assign(hashes, readRecordFor(entries));
      try { fs.unlinkSync(whl); } catch (_) { /* best-effort */ }
    }

    // 4. anotar. Sem isso, desinstalar viraria adivinhacao. Ler-modificar-
    //    escrever SEM await no meio: e o que torna o commit atomico frente a
    //    outra instalacao ou a uma desinstalacao concorrente (o JS e um so
    //    thread, e uninstall e sincrono).
    const manifest = readManifest();
    manifest.schemaVersion = MANIFEST_VERSION;
    manifest.abiTag = loadCatalog().python?.abiTag || null;
    manifest.installed[id] = {
      version: entry.version,
      installedAt: new Date().toISOString(),
      wheels: wheels.map((w) => ({ name: w.name, version: w.version, sha256: w.sha256 })),
      files,
      hashes,
    };
    writeManifest(manifest);
    ensureSitePth();

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
 */
export function uninstall(id: string) {
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
  // Sem biblioteca nenhuma, o ponteiro nao tem mais razao de existir: deixa o
  // interpretador exatamente como estava antes do painel ser usado.
  if (!Object.keys(manifest.installed).length) removeSitePth();

  log.info(`[pylibs] removida ${id} (${removed} arquivos, ${kept} preservados por outra lib)`);
  return { id, removed, kept };
}

/* ── Reparo ───────────────────────────────────────────────────────────────── */

/**
 * Reinstala por cima. Serve para o caso "o manifesto diz que esta instalado mas
 * os arquivos sumiram" e para forcar o re-download quando algo ficou estranho.
 */
export async function repair(id: string, opts: { onProgress?: OnProgress } = {}) {
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
 * nao um palpite, se a PyPI publica wheel `*-none-any.whl`, roda; se so publica
 * wheel compilada, nao roda de jeito nenhum e o caminho e o TCMD.
 *
 */
export async function resolveExternal(name: string): Promise<ResolveResult> {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/.test(clean)) {
    return { ok: false, reason: 'invalid-name', message: 'Nome de pacote invalido.' };
  }

  let meta: PypiMeta;
  try {
    meta = await fetcher.getJson(PYPI_JSON(clean));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('HTTP 404')) {
      return { ok: false, reason: 'not-found', message: `"${clean}" nao existe na PyPI.` };
    }
    // O erro de rede sai inteiro (URL, prazo ou codigo HTTP, que o fetcher ja
    // poe) e com o que fazer: sem isso a pessoa le "expirou" e fica sem saber
    // se a culpa e da PyPI, da conexao ou do nome digitado.
    return { ok: false, reason: 'network', message: `Nao consegui consultar a PyPI: ${msg}. Confira a conexao e tente de novo.` };
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
 */
export async function installExternal(name: string, opts: { onProgress?: OnProgress } = {}) {
  const resolved = await resolveExternal(name);
  if (!resolved.ok) throw new Error(resolved.message);

  const onProgress: OnProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
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
    const entries: string[] = await fetcher.listArchive(whl);
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
      hashes: readRecordFor(entries),
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
export function listExternal() {
  const manifest = readManifest();
  return Object.entries(manifest.installed)
    .filter(([, rec]) => rec.external)
    .map(([id, rec]) => ({
      id,
      name: rec.name,
      version: rec.version,
      installedAt: rec.installedAt,
      broken: sentinelasFaltando(rec, pylibSite()),
    }));
}

/* ── Doutor ───────────────────────────────────────────────────────────────── */

/**
 * Diagnostico do conjunto. Alem de arquivo faltando, detecta a armadilha que
 * derruba tudo em silencio: o bundle subir de versao do Python e as bibliotecas
 * instaladas ficarem para uma ABI que nao existe mais.
 */
export function doctor(opts: { deep?: boolean } = {}) {
  const deep = !!opts.deep;
  const manifest = readManifest();
  const checks = new Map<string, VerifyResult>();
  for (const [id, rec] of Object.entries(manifest.installed)) checks.set(id, verifyFiles(rec, { deep }));
  return diagnosticoDe(manifest, checks, deep);
}

/**
 * O mesmo diagnostico, com a verificacao assincrona: e o que o vigia usa, para
 * a ronda de milhares de stats nao segurar o thread principal.
 */
export async function doctorAsync(opts: { deep?: boolean } = {}) {
  const deep = !!opts.deep;
  const manifest = readManifest();
  const checks = new Map<string, VerifyResult>();
  for (const [id, rec] of Object.entries(manifest.installed)) {
    checks.set(id, await verifyFilesAsync(rec, { deep }));
  }
  return diagnosticoDe(manifest, checks, deep);
}

/**
 * Monta o veredito a partir das verificacoes por biblioteca. Comum ao doctor
 * sincrono e ao assincrono, para os dois dizerem exatamente a mesma coisa.
 */
function diagnosticoDe(manifest: Manifest, checks: Map<string, VerifyResult>, deep: boolean) {
  const catalog = loadCatalog();
  const expectedAbi = catalog.python?.abiTag || null;
  const issues: Issue[] = [];

  if (manifest.abiTag && expectedAbi && manifest.abiTag !== expectedAbi) {
    issues.push({
      kind: 'abi-drift',
      message:
        `As bibliotecas foram instaladas para ${manifest.abiTag} e o catalogo agora espera `
        + `${expectedAbi}. Reinstale-as (Reparar) para acompanhar o Python novo.`,
    });
  }

  for (const [id, check] of checks) {
    if (check.ok) continue;

    // Separa por CAUSA, porque a acao do usuario e a mesma (Reparar) mas o que
    // aconteceu com a maquina dele nao e: arquivo que sumiu costuma ser
    // antivirus ou limpeza manual; arquivo com hash errado e corrupcao de
    // verdade, e vale desconfiar do disco ou do download.
    const missing = check.problems.filter((p) => p.problem === 'missing').length;
    const corrupt = check.problems.filter((p) => p.problem === 'corrupt' || p.problem === 'unreadable').length;
    const resized = check.problems.filter((p) => p.problem === 'size').length;

    const parts: string[] = [];
    if (missing) parts.push(`${missing}+ arquivo(s) faltando`);
    if (resized) parts.push(`${resized}+ com tamanho errado`);
    if (corrupt) parts.push(`${corrupt}+ corrompido(s)`);

    issues.push({
      kind: corrupt ? 'corrupt-files' : 'missing-files',
      id,
      counts: { missing, resized, corrupt },
      sample: check.problems.slice(0, 3).map((p) => p.file),
      message: `${id}: ${parts.join(', ')}. Use Reparar para reinstalar.`,
    });
  }

  return {
    ok: issues.length === 0,
    deep,
    issues,
    installed: Object.keys(manifest.installed).length,
    // Carimbo de quando rodou, para o painel dizer "verificado ha 3 minutos"
    // em vez de deixar o usuario no escuro sobre a idade do diagnostico.
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Checagem de sentinela: existe e tem o tamanho certo o arquivo mais
 * caracteristico de cada biblioteca instalada.
 *
 * Serve para o momento em que a verificacao mais importa e o custo menos pode
 * aparecer: logo antes de rodar um testbench. Sao poucos `stat` por biblioteca
 * em vez de milhares, entao nao adiciona latencia perceptivel a simulacao, e
 * pega o caso comum de o antivirus ter posto a pasta inteira em quarentena.
 */
export function sentinelCheck() {
  const manifest = readManifest();
  const site = pylibSite();
  const broken: string[] = [];

  // O RECORD e o __init__ do pacote de topo: se um dos dois sumiu, a
  // biblioteca nao importa mais.
  for (const [id, rec] of Object.entries(manifest.installed)) {
    if (sentinelasFaltando(rec, site)) broken.push(id);
  }

  return { ok: broken.length === 0, broken };
}
