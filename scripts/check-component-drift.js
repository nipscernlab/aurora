#!/usr/bin/env node
// @ts-check
/**
 * check-component-drift.js: descobre quando um componente fixado ficou para
 * trás do que o upstream já publicou.
 *
 * POR QUE ISTO EXISTE
 *
 * A AURORA baixa sete componentes por tag fixada à mão dentro dos
 * `components/Scripts/download-*.js`. Nada olhava o outro lado: o dependabot
 * cobre npm e github-actions, e o `verify-components.js` sabe dizer se ESTA
 * MÁQUINA está diferente do declarado, mas não se o declarado está velho.
 *
 * O buraco foi medido em 10/08/2026. O fork do Surfer estava pinado na
 * `v0.7.0-nips.2`, de 18/07, e já tinha publicado até a `nips.7`, de 24/07:
 * cinco versões, incluindo o painel lateral retrátil, sem que ninguém notasse.
 * Não houve descuido de pessoa nenhuma; simplesmente não havia quem olhasse.
 *
 * O QUE ELE COMPARA, E O QUE ELE NÃO TENTA FAZER
 *
 * A pergunta é uma só: a tag fixada é a mais recente da própria família? Ele
 * NÃO tenta ordenar versões. Os formatos aqui são incomparáveis entre si
 * (`msys-v1`, `v5.3`, `v0.1.2-nipscern`, `v0.7.0-nips.7`, `master-796e77c`), e
 * um comparador genérico erraria em silêncio, que é pior do que não ter.
 * Em vez disso ele pega a lista publicada, que já vem da mais nova para a mais
 * velha, filtra pela família e olha em que posição a fixada caiu. A posição é o
 * número que torna a deriva visível: "cinco atrás" diz mais que "desatualizado".
 *
 * FAMÍLIA É DECLARADA, NÃO ADIVINHADA
 *
 * Cada componente diz, por expressão regular, como são as tags dele. Isso é
 * necessário porque num mesmo repositório convivem linhagens diferentes: o
 * `aurora-toolchain` publica `msys-*` e `pins-*`, e o fork do Surfer carrega as
 * tags do upstream (`v0.7.0`) ao lado das nossas (`v0.7.0-nips.7`). Sem o
 * filtro, cada release do upstream apareceria como se nós estivéssemos atrás.
 * Inferir a família a partir do texto da tag foi tentado e não fecha: qualquer
 * regra que separe `v0.7.0` de `v0.7.0-nips.7` junta `master-796e77c` com
 * `master-abc1234`, ou o contrário.
 *
 * ONDE ELE RODA
 *
 * No `.github/workflows/component-drift.yml`, semanalmente e por acionamento
 * manual, de propósito FORA do CI de pull request. Uma release nova lá fora
 * não é defeito do código que está sendo revisado, e reprovar um PR por causa
 * dela treinaria todo mundo a ignorar o vermelho. O workflow mantém UMA issue
 * aberta, atualizada enquanto houver deriva e fechada sozinha quando não houver.
 *
 * Uso:
 *   node scripts/check-component-drift.js
 *   node scripts/check-component-drift.js --json
 *   node scripts/check-component-drift.js --only surfer,yanc
 *   node scripts/check-component-drift.js --fail-on-drift   # sai 1 se houver
 */

'use strict';

const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'components', 'Scripts');

/* ────────────────────────────────────────────────────────────────────────────
 * Núcleo puro. É o que o teste exercita, sem rede, sem disco.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {{ tag: string, date?: string }} Published
 * @typedef {'ok'|'behind'|'absent'|'unknown'|'bad-family'} DriftStatus
 */

/**
 * Decide o estado de um componente a partir da tag fixada e da lista publicada.
 *
 * `published` vem da mais NOVA para a mais velha; é assim que tanto a API de
 * releases do GitHub quanto a de pacotes do GitLab devolvem, e a ordem é a
 * única informação de recência em que dá para confiar sem comparar versões.
 *
 * Os cinco estados:
 *   'bad-family', a própria tag fixada não casa com a família declarada. É bug
 *                  de configuração deste arquivo, e precisa gritar em vez de
 *                  virar uma deriva falsa.
 *   'unknown'   , o upstream não devolveu nenhuma tag da família. Sem base de
 *                  comparação, e afirmar qualquer coisa seria invenção.
 *   'absent'    , a fixada não está entre as publicadas. Tag apagada, pacote
 *                  despublicado, ou erro de digitação; em qualquer dos casos é
 *                  mais grave que estar atrás, porque o bootstrap vai falhar.
 *   'ok'        , a fixada é a mais nova da família.
 *   'behind'    , está atrás, e `behind` diz por quantas.
 *
 * @param {{ pinned: string, family: RegExp, published: Published[] }} input
 * @returns {{ status: DriftStatus, latest: string|null, latestDate: string|null, behind: number }}
 */
function evaluate({ pinned, family, published }) {
  const nothing = { latest: /** @type {string|null} */ (null), latestDate: /** @type {string|null} */ (null), behind: 0 };

  if (!pinned || !family.test(pinned)) {
    return { status: 'bad-family', ...nothing };
  }

  const mine = (published || []).filter((p) => p && typeof p.tag === 'string' && family.test(p.tag));
  if (mine.length === 0) return { status: 'unknown', ...nothing };

  const latest = mine[0].tag;
  const latestDate = mine[0].date || null;
  const at = mine.findIndex((p) => p.tag === pinned);

  if (at === -1) return { status: 'absent', latest, latestDate, behind: 0 };
  if (at === 0) return { status: 'ok', latest, latestDate, behind: 0 };
  return { status: 'behind', latest, latestDate, behind: at };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Quem é fixado, e onde fica o outro lado.
 *
 * A tag NUNCA é escrita aqui: sai do próprio `download-*.js`, que continua
 * sendo a fonte única. Este arquivo só sabe onde procurar o que foi publicado.
 * ──────────────────────────────────────────────────────────────────────── */

/** @type {Array<{key:string,label:string,ours:boolean,script:string,tagOf:(m:any)=>string|null,family:RegExp,upstream:any}>} */
const COMPONENTS = [
  {
    key: 'toolchain',
    label: 'Toolchain MSYS/mingw64',
    ours: true,
    script: 'download-toolchain.js',
    tagOf: (m) => m.MSYS_TAG,
    // O repositorio publica duas linhagens: `msys-*` (o bundle) e `pins-*`
    // (a lista de pacotes MSYS2 fixados). Sao artefatos diferentes.
    family: /^msys-/,
    upstream: { kind: 'github-releases', repo: 'nipscernlab/aurora-toolchain' },
  },
  {
    key: 'yanc',
    label: 'YANC — compiladores do SAPHO',
    ours: true,
    script: 'download-yanc.js',
    tagOf: (m) => m.YANC_TAG,
    family: /^v\d/,
    upstream: { kind: 'github-releases', repo: 'nipscernlab/yanc' },
  },
  {
    key: 'gtkwave',
    label: 'GTKWave (fork NIPS-CERN)',
    ours: true,
    script: 'download-gtkwave-nipscern.js',
    tagOf: (m) => m.GTKWAVE_TAG,
    family: /-nipscern$/,
    upstream: { kind: 'github-releases', repo: 'nipscernlab/gtkwave-nipscern' },
  },
  {
    key: 'surfer',
    label: 'Surfer-AURORA (fork NIPS-CERN)',
    ours: true,
    script: 'download-surfer.js',
    tagOf: (m) => (m.FORK_ARTIFACT ? m.FORK_ARTIFACT.tag : null),
    // O fork carrega as tags do upstream (`v0.7.0`) ao lado das nossas.
    family: /-nips\.\d+$/,
    // Pacotes, e nao tags: uma tag sem zip publicado no registro nao e
    // instalavel, entao anunciá-la como disponivel seria alarme falso.
    upstream: { kind: 'gitlab-packages', project: 84576006, name: 'surfer-aurora' },
  },
  {
    key: 'verible',
    label: 'Verible — language server Verilog',
    ours: false,
    script: 'download-verible.js',
    tagOf: (m) => m.VERIBLE_TAG,
    family: /^v\d/,
    upstream: { kind: 'github-releases', repo: 'chipsalliance/verible' },
  },
  {
    key: 'slang',
    label: 'slang-server — language server SystemVerilog',
    ours: false,
    script: 'download-slang-server.js',
    tagOf: (m) => m.SLANG_SERVER_TAG,
    family: /^v\d/,
    upstream: { kind: 'github-releases', repo: 'hudson-trading/slang-server' },
  },
  {
    key: 'clang-format',
    label: 'clang-format — formatador C/C++',
    ours: false,
    script: 'download-clang-format.js',
    tagOf: (m) => m.CLANG_FORMAT_TAG,
    family: /^master-/,
    upstream: { kind: 'github-releases', repo: 'muttleyxd/clang-tools-static-binaries' },
  },
];

/* ────────────────────────────────────────────────────────────────────────────
 * Rede
 * ──────────────────────────────────────────────────────────────────────── */

const UA = 'aurora-component-drift';

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

/** @returns {Promise<Published[]>} mais novas primeiro */
async function fetchPublished(upstream) {
  if (upstream.kind === 'github-releases') {
    // Sem `/releases/latest`: ele ignora pre-release, e o bundle da toolchain e
    // publicado exatamente assim. A lista traz tudo, ja da mais nova pra mais
    // velha. O token, quando existe, so sobe o limite de requisicoes.
    const headers = { Accept: 'application/vnd.github+json' };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const rel = await getJson(`https://api.github.com/repos/${upstream.repo}/releases?per_page=30`, headers);
    return (Array.isArray(rel) ? rel : [])
      .filter((r) => !r.draft)
      .map((r) => ({ tag: r.tag_name, date: (r.published_at || r.created_at || '').slice(0, 10) }));
  }

  if (upstream.kind === 'gitlab-packages') {
    const url = `https://gitlab.com/api/v4/projects/${upstream.project}`
      + '/packages?package_type=generic&order_by=created_at&sort=desc&per_page=50';
    const pkgs = await getJson(url);
    return (Array.isArray(pkgs) ? pkgs : [])
      .filter((p) => !upstream.name || p.name === upstream.name)
      .map((p) => ({ tag: p.version, date: (p.created_at || '').slice(0, 10) }));
  }

  throw new Error(`fonte desconhecida: ${upstream.kind}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Execução
 * ──────────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const FLAG = {
  json: has('--json'),
  markdown: has('--markdown'),
  failOnDrift: has('--fail-on-drift'),
  only: (valueOf('--only') || '').split(',').map((s) => s.trim()).filter(Boolean),
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const green = (s) => c('32', s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const dim = (s) => c('2', s);

async function inspect(comp) {
  const row = {
    key: comp.key,
    label: comp.label,
    ours: comp.ours,
    pinned: /** @type {string|null} */ (null),
    latest: /** @type {string|null} */ (null),
    latestDate: /** @type {string|null} */ (null),
    behind: 0,
    status: /** @type {DriftStatus|'error'} */ ('unknown'),
    error: /** @type {string|null} */ (null),
  };

  try {
    const mod = require(path.join(SCRIPTS_DIR, comp.script));
    row.pinned = comp.tagOf(mod);
  } catch (e) {
    row.status = 'error';
    row.error = `nao consegui ler a tag fixada: ${e instanceof Error ? e.message : String(e)}`;
    return row;
  }

  if (!row.pinned) {
    // Caso legitimo: o download-surfer.js zera o artefato quando PUBLISHED e
    // falso, e ai nao ha o que comparar.
    row.status = 'unknown';
    row.error = 'sem tag fixada (componente desligado neste momento)';
    return row;
  }

  let published;
  try {
    published = await fetchPublished(comp.upstream);
  } catch (e) {
    // Rede fora, limite de requisicoes, repositorio privado: nada disso e
    // deriva, e tratar como se fosse produziria issue falsa toda semana.
    row.status = 'error';
    row.error = e instanceof Error ? e.message : String(e);
    return row;
  }

  const verdict = evaluate({ pinned: row.pinned, family: comp.family, published });
  row.status = verdict.status;
  row.latest = verdict.latest;
  row.latestDate = verdict.latestDate;
  row.behind = verdict.behind;
  return row;
}

function render(rows) {
  const LABEL = {
    ok: green('[ EM DIA ]'),
    behind: yellow('[ ATRAS  ]'),
    absent: red('[ SUMIU  ]'),
    unknown: dim('[   ?    ]'),
    'bad-family': red('[ CONFIG ]'),
    error: dim('[  ERRO  ]'),
  };

  console.log('');
  console.log(bold('  Componentes fixados x o que o upstream publicou'));
  console.log('  ' + '─'.repeat(70));

  for (const r of rows) {
    const scope = r.ours ? 'nosso' : 'terceiro';
    console.log(`  ${LABEL[r.status] || r.status}  ${r.key.padEnd(13)} ${dim(scope)}`);
    console.log(`            ${r.label}`);
    if (r.status === 'behind') {
      const quantas = r.behind === 1 ? '1 versao' : `${r.behind} versoes`;
      console.log(`            fixado ${bold(String(r.pinned))} -> publicado ${bold(String(r.latest))}`
        + ` (${r.latestDate || 'sem data'}), ${quantas} atras`);
    } else if (r.status === 'absent') {
      console.log(`            fixado ${bold(String(r.pinned))} NAO esta publicado; o mais novo e ${r.latest}`);
      console.log('            o bootstrap vai falhar em maquina limpa');
    } else if (r.status === 'bad-family') {
      console.log(`            a tag fixada ${r.pinned} nao casa com ${r.family || 'a familia declarada'}`);
      console.log('            e bug de configuracao do check-component-drift.js, nao deriva');
    } else if (r.status === 'error' || r.status === 'unknown') {
      console.log(`            ${r.error || 'sem base de comparacao'}`);
    } else {
      console.log(`            ${r.pinned}`);
    }
  }

  const behind = rows.filter((r) => r.status === 'behind');
  const absent = rows.filter((r) => r.status === 'absent');
  const broken = rows.filter((r) => r.status === 'bad-family');
  const errors = rows.filter((r) => r.status === 'error');
  const ok = rows.filter((r) => r.status === 'ok');

  console.log('  ' + '─'.repeat(70));
  console.log(`  ${ok.length} em dia   ${behind.length} atras   ${absent.length} sumidos`
    + `   ${broken.length} config   ${errors.length} erro`);
  console.log('');
  return { behind, absent, broken, errors, ok };
}

/**
 * Corpo da issue que o workflow mantém. Fica aqui, e não no YAML, porque quem
 * mexe no que é reportado é quem mexe nesta tabela, e YAML com lógica dentro é
 * onde erro de formatação passa despercebido.
 */
function renderMarkdown(rows) {
  const out = [];
  const problems = rows.filter((r) => r.status === 'behind' || r.status === 'absent' || r.status === 'bad-family');

  out.push('Gerado por `scripts/check-component-drift.js`, do workflow semanal.');
  out.push('');
  out.push('A tag fixada de cada componente vive no `components/Scripts/download-*.js`,');
  out.push('que continua sendo a fonte única. Para subir: nova tag, novo `sha256` quando');
  out.push('o script verifica hash, e `node scripts/verify-components.js --only <chave>`');
  out.push('para provar na máquina antes de comitar.');
  out.push('');

  if (problems.length === 0) {
    out.push('Nada atrasado nesta rodada.');
  } else {
    out.push('| | Componente | Fixado | Publicado | |');
    out.push('|---|---|---|---|---|');
    for (const r of problems) {
      const quem = r.ours ? 'nosso' : 'terceiro';
      const nota = r.status === 'behind'
        ? `${r.behind} atrás (${r.latestDate || 'sem data'})`
        : r.status === 'absent' ? 'fixado NÃO está publicado — bootstrap falha em máquina limpa'
          : 'a tag fixada não casa com a família declarada; é bug do guarda';
      out.push(`| ${quem} | \`${r.key}\` | \`${r.pinned}\` | \`${r.latest || '—'}\` | ${nota} |`);
    }
  }

  const errors = rows.filter((r) => r.status === 'error');
  if (errors.length) {
    out.push('');
    out.push('Não deu para consultar, e isto não é deriva:');
    out.push('');
    for (const r of errors) out.push(`- \`${r.key}\`: ${r.error}`);
  }

  const ok = rows.filter((r) => r.status === 'ok').map((r) => `\`${r.key}\``);
  if (ok.length) {
    out.push('');
    out.push(`Em dia: ${ok.join(', ')}.`);
  }
  return out.join('\n');
}

async function main() {
  const wanted = FLAG.only.length
    ? COMPONENTS.filter((c2) => FLAG.only.includes(c2.key))
    : COMPONENTS;

  const rows = [];
  for (const comp of wanted) rows.push(await inspect(comp));

  if (FLAG.json) {
    console.log(JSON.stringify(rows, null, 2));
  } else if (FLAG.markdown) {
    console.log(renderMarkdown(rows));
  } else {
    render(rows);
  }

  // Erro de rede NUNCA reprova: a semana em que o GitHub estiver fora nao pode
  // virar uma issue dizendo que o componente esta atrasado.
  const drifted = rows.some((r) => r.status === 'behind' || r.status === 'absent' || r.status === 'bad-family');
  if (FLAG.failOnDrift && drifted) process.exit(1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[drift] falhou: ${e instanceof Error ? e.stack : String(e)}`);
    process.exit(2);
  });
}

module.exports = { evaluate, renderMarkdown, COMPONENTS };
