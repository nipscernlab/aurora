// @ts-check
/**
 * pylib_catalog.js: de onde vem a lista de bibliotecas.
 *
 * DUAS FONTES, UMA PREFERIDA
 * --------------------------
 * A lista mora em nipscernlab/aurora-pylibs, um repositorio publico separado da
 * IDE. O motivo e ritmo: acrescentar ou tirar uma biblioteca passa a ser um
 * commit naquele repo, sem esperar uma versao nova da AURORA.
 *
 * A IDE embarca uma copia (resources/pylib-catalog.json) que serve de reserva.
 * Ela nao e um detalhe: e o que faz o painel funcionar sem internet, no primeiro
 * uso antes de qualquer busca, e se o repositorio estiver fora do ar.
 *
 * A ordem e: cache do remoto, se existir e for valido; senao, a copia embutida.
 * Nunca o contrario, e nunca nada.
 *
 * O QUE A LISTA CONSEGUE MUDAR
 * ----------------------------
 * Ela carrega DADO, nome, descricao, usos, versao, hash, categoria. Nao carrega
 * codigo nem desenho: as integracoes nativas e os icones vivem dentro do app.
 * Uma biblioteca acrescentada remotamente instala e funciona, mas so ganha botao
 * proprio na interface quando sair uma AURORA nova.
 *
 * Por isso `icon` e `category` sao NOMES, nao conteudo. Um nome que esta versao
 * da AURORA nao conhece cai num padrao em vez de quebrar a tela, e a regra que
 * permite ao catalogo descrever mais do que o app instalado entende.
 *
 * COMPATIBILIDADE
 * ---------------
 * `schemaVersion` protege quem nao atualizou. Um catalogo com formato mais novo
 * do que esta versao sabe ler e RECUSADO, e a copia embutida assume. Melhor uma
 * lista velha e correta do que uma nova lida errado.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const fetcher = require('../net/fetcher');
const { pylibRoot, ensureDirs } = require('./pylib_paths');

let log;
try { log = require('electron-log'); } catch (_) { log = console; }

/** O maior formato que esta versao sabe ler. */
const SUPPORTED_SCHEMA = 1;

const CATALOG_URL = 'https://raw.githubusercontent.com/nipscernlab/aurora-pylibs/main/catalog.json';

/** Nao rebusca antes disso, o painel abre varias vezes por sessao. */
const REFRESH_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h

/** Categoria de recuo, para uma entrada que declare categoria desconhecida. */
const FALLBACK_CATEGORY = 'other';

/** @type {any|null} */
let memo = null;

function embeddedFile() {
  return path.join(__dirname, '..', '..', 'resources', 'pylib-catalog.json');
}

/**
 * Onde o remoto fica guardado. Devolve '' quando a raiz nao e resolvivel, fora
 * do Electron (testes, gerador de catalogo) o `main/paths.js` nao existe, e nesse
 * caso simplesmente nao ha cache: o embutido responde por tudo.
 */
function cacheFile() {
  try {
    return path.join(pylibRoot(), 'catalog-cache.json');
  } catch (_) {
    return '';
  }
}

/* ── Validacao ────────────────────────────────────────────────────────────── */

/**
 * Um catalogo so e aceito se tiver a forma esperada E um formato que saibamos
 * ler. A checagem e deliberadamente chata: este JSON vem da rede e alimenta a
 * tela inteira, entao um campo faltando vira erro de render dificil de rastrear.
 *
 * @param {any} obj
 * @returns {{ok:true, catalog:any} | {ok:false, reason:string}}
 */
function validate(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'nao e um objeto' };

  const schema = Number(obj.schemaVersion);
  if (!Number.isFinite(schema)) return { ok: false, reason: 'schemaVersion ausente' };
  if (schema > SUPPORTED_SCHEMA) {
    return {
      ok: false,
      reason: `formato ${schema} e mais novo que o suportado (${SUPPORTED_SCHEMA}) — atualize a AURORA`,
    };
  }

  if (!Array.isArray(obj.libraries)) return { ok: false, reason: 'libraries nao e uma lista' };
  if (!obj.categories || typeof obj.categories !== 'object') {
    return { ok: false, reason: 'categories ausente' };
  }

  const seen = new Set();
  for (const lib of obj.libraries) {
    if (!lib || typeof lib.id !== 'string' || !lib.id) return { ok: false, reason: 'biblioteca sem id' };
    if (seen.has(lib.id)) return { ok: false, reason: `id repetido: ${lib.id}` };
    seen.add(lib.id);
    if (!lib.summary || typeof lib.summary !== 'object') {
      return { ok: false, reason: `${lib.id}: summary ausente` };
    }
    if (lib.kind === 'pure') {
      if (!Array.isArray(lib.wheels) || !lib.wheels.length) {
        return { ok: false, reason: `${lib.id}: marcada como pura mas sem wheels` };
      }
      for (const w of lib.wheels) {
        // Estes tres campos sao o que separa uma instalacao verificavel de um
        // download as cegas. Sem eles a entrada nao entra, ponto.
        if (typeof w.url !== 'string' || !w.url.startsWith('https://')) {
          return { ok: false, reason: `${lib.id}: url invalida` };
        }
        if (typeof w.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(w.sha256)) {
          return { ok: false, reason: `${lib.id}: sha256 invalido` };
        }
        if (typeof w.filename !== 'string' || !w.filename.endsWith('.whl')) {
          return { ok: false, reason: `${lib.id}: filename invalido` };
        }
      }
    }
  }

  return { ok: true, catalog: obj };
}

/**
 * Conserta o que da para consertar sem recusar o catalogo inteiro.
 *
 * Uma entrada que declare uma categoria que esta versao nao conhece nao pode
 * sumir da tela, ela vai para "Outras". E o mesmo principio do icone: o
 * catalogo pode descrever mais do que o app entende, e o app acomoda em vez de
 * quebrar.
 */
function normalize(catalog) {
  const categories = { ...catalog.categories };
  let needsFallback = false;

  const libraries = catalog.libraries.map((lib) => {
    if (lib.category && categories[lib.category]) return lib;
    needsFallback = true;
    return { ...lib, category: FALLBACK_CATEGORY, originalCategory: lib.category || null };
  });

  if (needsFallback && !categories[FALLBACK_CATEGORY]) {
    categories[FALLBACK_CATEGORY] = { pt: 'Outras', en: 'Other' };
  }

  return { ...catalog, categories, libraries };
}

/* ── Leitura das fontes ───────────────────────────────────────────────────── */

function readJson(/** @type {string} */ file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** A copia que veio junto com o app. E o piso: se ela falhar, nao ha catalogo. */
function embedded() {
  const raw = readJson(embeddedFile());
  const v = validate(raw);
  if (!v.ok) {
    log.error(`[pylibs] catalogo embutido invalido (${v.reason})`);
    return { schemaVersion: SUPPORTED_SCHEMA, python: {}, categories: {}, libraries: [], source: 'none' };
  }
  return normalize({ ...v.catalog, source: 'embedded' });
}

/** O ultimo remoto que baixamos e aceitamos. */
function cached() {
  const file = cacheFile();
  if (!file) return null;
  const raw = readJson(file);
  if (!raw || !raw.catalog) return null;
  const v = validate(raw.catalog);
  if (!v.ok) {
    log.warn(`[pylibs] cache do catalogo descartado (${v.reason})`);
    return null;
  }
  return normalize({ ...v.catalog, source: 'remote', fetchedAt: raw.fetchedAt });
}

/**
 * O catalogo em vigor. Remoto quando ha um valido em cache, senao o embutido.
 * Memoriza porque e lido a cada abertura do painel e a cada consulta de estado.
 */
function active() {
  if (memo) return memo;
  memo = cached() || embedded();
  return memo;
}

/** Esquece o memo, usado depois de um refresh bem-sucedido e nos testes. */
function invalidate() {
  memo = null;
}

/* ── Busca remota ─────────────────────────────────────────────────────────── */

function lastFetchAt() {
  const file = cacheFile();
  if (!file) return 0;
  const raw = readJson(file);
  return raw && raw.fetchedAt ? Date.parse(raw.fetchedAt) || 0 : 0;
}

/**
 * Busca a lista no repositorio publico.
 *
 * Nunca lanca e nunca bloqueia o painel: falha de rede, JSON quebrado ou formato
 * novo demais terminam do mesmo jeito, mantem o que ja havia. O painel abre com
 * a lista que tem e melhora sozinho se a busca der certo.
 *
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<{ok:boolean, source:string, reason?:string, changed?:boolean}>}
 */
async function refresh(opts = {}) {
  if (!opts.force && Date.now() - lastFetchAt() < REFRESH_MIN_INTERVAL_MS) {
    return { ok: true, source: active().source, reason: 'recente' };
  }

  let remote;
  try {
    remote = await fetcher.getJson(CATALOG_URL, { timeoutMs: 15000, maxBytes: 4 * 1024 * 1024 });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log.warn(`[pylibs] nao deu para buscar o catalogo remoto: ${reason}`);
    return { ok: false, source: active().source, reason };
  }

  const v = validate(remote);
  if (!v.ok) {
    // Formato mais novo e o caso interessante: nao e defeito do catalogo, e a
    // AURORA que ficou para tras. Vale log claro, porque o sintoma pro usuario
    // seria "a lista nao atualiza" sem nenhuma pista.
    log.warn(`[pylibs] catalogo remoto recusado: ${v.reason}`);
    return { ok: false, source: active().source, reason: v.reason };
  }

  const before = JSON.stringify(active().libraries.map((l) => `${l.id}@${l.version}`));

  const file = cacheFile();
  if (!file) return { ok: false, source: active().source, reason: 'sem diretorio de cache' };
  ensureDirs();
  fs.writeFileSync(file, `${JSON.stringify({
    fetchedAt: new Date().toISOString(),
    catalog: v.catalog,
  }, null, 2)}\n`);
  invalidate();

  const after = JSON.stringify(active().libraries.map((l) => `${l.id}@${l.version}`));
  const changed = before !== after;
  log.info(`[pylibs] catalogo remoto atualizado (${v.catalog.libraries.length} bibliotecas${changed ? ', com mudancas' : ''})`);
  return { ok: true, source: 'remote', changed };
}

module.exports = {
  active,
  refresh,
  invalidate,
  validate,
  normalize,
  embedded,
  cached,
  cacheFile,
  CATALOG_URL,
  SUPPORTED_SCHEMA,
  FALLBACK_CATEGORY,
  REFRESH_MIN_INTERVAL_MS,
};
