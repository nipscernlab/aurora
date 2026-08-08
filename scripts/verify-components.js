#!/usr/bin/env node
// @ts-check
/**
 * verify-components.js — Aurora toolchain "doctor".
 *
 * Verifica os EXECUTAVEIS instalados em components/ (verilator, os compiladores
 * YANC, gtkwave, surfer, verible, slang-server, clang-format) e, para cada
 * componente que estiver FALTANDO ou DESATUALIZADO, oferece re-baixar/atualizar
 * a partir dos releases pinados da AURORA.
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * O bootstrap (os download-*.js) roda no `prestart`/`prebuild`. Este script
 * adiciona duas portas de entrada a mais:
 *   - `npm install`  -> via hook `postinstall` (modo --postinstall): restaura
 *                       automaticamente qualquer executavel FALTANDO (silencioso
 *                       quando tudo esta OK, pula em CI, nunca quebra o install).
 *   - manual          -> `npm run components:verify` (ou este .bat): relatorio
 *                       completo + prompts pra baixar faltantes e dar upgrade.
 * Antes disso, apagar um binario (ex.: surfer-aurora.exe) e rodar `npm install`
 * nao re-baixava nada.
 *
 * COMO FUNCIONA (resiliente a mudanca de arquivos)
 * ------------------------------------------------
 * Nao checa arquivo-por-arquivo (a lista muda entre versoes). Em vez disso usa
 * a MESMA sentinela que cada download-*.js usa como prova-de-instalacao — 1
 * sentinela por componente. Cada modulo e carregado via require() (seguro: o
 * main() deles e gated por `require.main === module`, entao nada baixa no
 * import) so pra ler a TAG pinada, a sentinela e a funcao de checagem.
 *
 * VERSAO
 * ------
 * So o YANC grava um marcador da versao instalada (bin/.yanc-version), entao so
 * ele permite comparacao real "instalada vs pinada" e deteccao de bump. Os
 * demais nao registram versao no disco — mostramos a TAG pinada e, mesmo quando
 * o componente ja esta presente, oferecemos re-download (--force) pra cobrir um
 * bump silencioso.
 *
 * USO
 *   node scripts/verify-components.js            # relatorio + prompts interativos
 *   node scripts/verify-components.js --report   # so relatorio, sem prompts
 *   node scripts/verify-components.js --json      # relatorio em JSON (sem prompts)
 *   node scripts/verify-components.js --yes       # baixa faltantes + upgrade, sem perguntar
 *   node scripts/verify-components.js --force-all # re-baixa TUDO (--force em todos)
 *   node scripts/verify-components.js --only yanc,surfer   # restringe aos componentes
 *   node scripts/verify-components.js --strict    # exit 1 se algo faltar (uso em CI)
 *
 * Tambem exposto como `npm run components:verify`.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'components', 'Scripts');

// Manifesto de versoes que o DOCTOR mantem: { key: tag_instalada }. Existe pra
// detectar BUMP nos componentes que nao gravam versao no disco (todos menos o
// YANC, que tem seu proprio bin/.yanc-version). Fica dentro de components/ —
// gitignored (nunca comitado; e estado por-maquina) e some junto se voce apagar
// a toolchain, o que e o certo (ai tudo re-baixa).
const MANIFEST_FILE = path.join(REPO_ROOT, 'components', '.aurora-versions.json');

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')) || {};
  } catch (_e) {
    return {};
  }
}
function writeManifestEntry(key, tag) {
  if (!key || !tag) return;
  const m = readManifest();
  if (m[key] === tag) return;
  m[key] = tag;
  try {
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 2) + '\n');
  } catch (e) {
    console.log(dim(`  (aviso: nao consegui gravar ${rel(MANIFEST_FILE)}: ${e instanceof Error ? e.message : String(e)})`));
  }
}

// ── ANSI (degrada pra vazio se nao for TTY) ───────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const green = (s) => c('32', s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const cyan = (s) => c('36', s);
const dim = (s) => c('2', s);

// ── Manifesto dos componentes que instalam executaveis ────────────────────────
// Cada entrada carrega o download-*.js correspondente e le dele:
//   pinnedTag       -> a versao fixada (o que o repo quer instalar)
//   isPresent(mod)  -> ha executavel no disco? (funcao de checagem do proprio modulo)
//   installedVer    -> versao gravada no disco, se o componente registrar (so YANC)
//   extraNote       -> observacao de saude adicional (ex.: cocotb no toolchain)
// So os download-*.js sao a fonte da verdade; aqui nao ha lista de .exe hardcoded.
/** @type {Array<{key:string,label:string,script:string,build:(m:any)=>object}>} */
const COMPONENTS = [
  {
    key: 'toolchain',
    label: 'Toolchain MSYS/mingw64 (verilator, iverilog, yosys, g++, python, cocotb)',
    script: 'download-toolchain.js',
    build: (m) => ({
      pinnedTag: m.MSYS_TAG,
      sentinel: m.MSYS_SENTINEL,
      isPresent: () => m.bundleInstalled(),
      installedVer: null, // nao grava marcador de versao
      extraNote: m.cocotbInstalled && !m.cocotbInstalled() ? 'cocotb ausente (fluxo cocotb indisponivel)' : null,
    }),
  },
  {
    key: 'yanc',
    label: 'YANC (compiladores C±/ASM/C++/App + HDL/Header/Macros do SAPHO)',
    script: 'download-yanc.js',
    build: (m) => ({
      pinnedTag: m.YANC_TAG,
      sentinel: m.SENTINEL_FILE,
      isPresent: () => m.binariesPresent(),
      installedVer: m.installedTag ? m.installedTag() : null, // .yanc-version
      extraNote: null,
    }),
  },
  {
    key: 'gtkwave',
    label: 'GTKWave (NIPS-CERN) — visualizador de waveforms',
    script: 'download-gtkwave-nipscern.js',
    build: (m) => ({
      pinnedTag: m.GTKWAVE_TAG,
      sentinel: m.SENTINEL_FILE,
      isPresent: () => m.alreadyInstalled(),
      installedVer: null,
      extraNote: null,
    }),
  },
  {
    key: 'surfer',
    label: 'Surfer-AURORA — visualizador de waveforms (fork NIPS-CERN)',
    script: 'download-surfer.js',
    build: (m) => ({
      pinnedTag: m.FORK_ARTIFACT ? m.FORK_ARTIFACT.tag : null,
      sentinel: m.SENTINEL_FILE,
      isPresent: () => m.alreadyInstalled(),
      installedVer: null,
      // Quando o CI do fork ainda nao publicou o binario, o download nao ocorre
      // de proposito — o exe vem de build local. Sinalizamos isso.
      unavailable: !m.PUBLISHED ? 'nao publicado (build local; nada a baixar)' : null,
      extraNote: null,
    }),
  },
  {
    key: 'verible',
    label: 'Verible (verible-verilog-ls) — language server Verilog',
    script: 'download-verible.js',
    build: (m) => ({
      pinnedTag: m.VERIBLE_TAG,
      sentinel: m.SENTINEL_FILE,
      isPresent: () => m.alreadyInstalled(),
      installedVer: null,
      extraNote: null,
    }),
  },
  {
    key: 'slang',
    label: 'slang-server — language server SystemVerilog',
    script: 'download-slang-server.js',
    build: (m) => ({
      pinnedTag: m.SLANG_SERVER_TAG,
      sentinel: m.SENTINEL_FILE,
      isPresent: () => m.alreadyInstalled(),
      installedVer: null,
      extraNote: null,
    }),
  },
  {
    key: 'clang-format',
    label: 'clang-format — formatador C/C++',
    script: 'download-clang-format.js',
    build: (m) => ({
      pinnedTag: m.CLANG_FORMAT_TAG,
      sentinel: m.SENTINEL_FILE,
      isPresent: () => m.alreadyInstalled(),
      installedVer: null,
      extraNote: null,
    }),
  },
];

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const FLAG = {
  report: has('--report') || has('--check'),
  json: has('--json'),
  yes: has('--yes') || has('-y'),
  forceAll: has('--force-all'),
  strict: has('--strict'),
  // Modo chamado pelo `postinstall`: restaura SO o que falta, silencioso quando
  // tudo esta OK, pula em CI, e nunca falha o install (sempre exit 0).
  postinstall: has('--postinstall'),
};
let onlyKeys = null;
{
  const i = argv.indexOf('--only');
  if (i !== -1 && argv[i + 1]) onlyKeys = argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
}

// ── Coleta de status ──────────────────────────────────────────────────────────
// status: 'ok' | 'missing' | 'outdated' | 'unavailable' | 'error'
function collect() {
  const rows = [];
  const manifest = readManifest();
  for (const comp of COMPONENTS) {
    if (onlyKeys && !onlyKeys.includes(comp.key)) continue;
    const scriptPath = path.join(SCRIPTS_DIR, comp.script);
    const row = { key: comp.key, label: comp.label, script: comp.script, scriptPath };
    try {
      // require seguro: o main() de cada download-*.js e gated por require.main.
      const mod = require(scriptPath);
      const info = comp.build(mod);
      row.pinnedTag = info.pinnedTag || null;
      row.sentinel = info.sentinel || null;
      row.extraNote = info.extraNote || null;

      // Versao instalada: preferimos o marcador NATIVO do componente (so o YANC
      // tem, via bin/.yanc-version); senao caimos no manifesto que o proprio
      // doctor mantem. Com isso, bump vira detectavel pra TODOS os componentes.
      const nativeVer = info.installedVer || null;
      const recordedVer = manifest[comp.key] || null;
      row.installedVer = nativeVer || recordedVer || null;
      row.recorded = !!recordedVer;

      const present = safe(() => info.isPresent());
      if (info.unavailable) {
        row.status = 'unavailable';
        row.note = info.unavailable;
      } else if (!present) {
        // Sentinela ausente sempre ganha: falta o binario -> baixa, ignorando
        // qualquer versao registrada (um manifesto orfao nao segura o download).
        row.status = 'missing';
      } else if (row.installedVer && row.pinnedTag && row.installedVer !== row.pinnedTag) {
        row.status = 'outdated'; // BUMP: presente, mas versao != a pinada
      } else if (!row.installedVer && row.pinnedTag) {
        // Presente, mas sem registro de versao (instalado antes do manifesto, ou
        // pelo prestart que nao grava marcador). Nao da pra saber se ha bump;
        // tratamos como OK e SEMEAMOS o registro (assume = pinada) pra que o
        // PROXIMO bump seja detectado. Evita re-download em massa nesse 1o run.
        row.status = 'ok';
        row.needsSeed = true;
      } else {
        row.status = 'ok';
      }
    } catch (e) {
      row.status = 'error';
      row.error = e instanceof Error ? e.message : String(e);
    }
    rows.push(row);
  }
  return rows;
}

function safe(fn) {
  try { return fn(); } catch (_e) { return false; }
}

// ── Impressao do relatorio ────────────────────────────────────────────────────
const BADGE = {
  ok: green('[ OK ]'),
  missing: red('[FALTA]'),
  outdated: yellow('[UPGRADE]'),
  unavailable: dim('[N/D ]'),
  error: red('[ERRO]'),
};

function versionCell(row) {
  if (row.status === 'error') return dim('—');
  const pinned = row.pinnedTag ? cyan(row.pinnedTag) : dim('n/d');
  if (row.installedVer && row.installedVer !== row.pinnedTag) {
    return `${yellow(row.installedVer)} ${dim('→')} ${pinned}`;
  }
  if (row.installedVer) return `${green(row.installedVer)}`;
  if (row.status === 'ok') return `${pinned} ${dim('(versao instalada nao registrada)')}`;
  return pinned;
}

function printReport(rows) {
  console.log('');
  console.log(bold('  Verificacao de componentes da AURORA'));
  console.log(dim('  ' + '─'.repeat(70)));
  for (const row of rows) {
    console.log(`  ${BADGE[row.status]}  ${bold(row.key.padEnd(13))} ${versionCell(row)}`);
    console.log(`         ${dim(row.label)}`);
    if (row.status === 'missing') console.log(`         ${dim('sentinela ausente: ' + rel(row.sentinel))}`);
    if (row.status === 'error') console.log(`         ${red('erro ao ler modulo: ' + row.error)}`);
    if (row.note) console.log(`         ${dim(row.note)}`);
    if (row.extraNote) console.log(`         ${yellow('! ' + row.extraNote)}`);
  }
  console.log(dim('  ' + '─'.repeat(70)));
  const n = (s) => rows.filter((r) => r.status === s).length;
  console.log(
    `  ${green(n('ok') + ' ok')}   ` +
    `${red(n('missing') + ' faltando')}   ` +
    `${yellow(n('outdated') + ' desatualizado')}   ` +
    `${dim(n('unavailable') + ' n/d')}   ` +
    `${n('error') ? red(n('error') + ' erro') : dim('0 erro')}`,
  );
  console.log('');
}

function rel(p) {
  if (!p) return '(desconhecida)';
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

// ── Execucao de um download-*.js ──────────────────────────────────────────────
function runDownload(row, { force }) {
  const args = [row.scriptPath];
  if (force) args.push('--force');
  console.log('');
  console.log(bold(`  RUN   ${row.key}: node components/Scripts/${row.script}${force ? ' --force' : ''}`));
  const res = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit' });
  const okExit = res.status === 0;
  // Reavalia a sentinela apos rodar (os download-*.js saem 0 mesmo em falha de
  // rede pra nao travar o npm start — entao o exit code sozinho nao basta).
  const nowPresent = row.sentinel ? fs.existsSync(row.sentinel) : okExit;
  if (nowPresent) {
    // Registra a versao instalada no manifesto do doctor — e isso que permite
    // detectar o PROXIMO bump deste componente.
    writeManifestEntry(row.key, row.pinnedTag);
    console.log(green(`  OK    ${row.key}: ${row.pinnedTag || 'instalado'}`));
  } else {
    console.log(red(`  FALHA ${row.key}: ainda ausente apos a tentativa (veja o log acima)`));
  }
  return nowPresent;
}

// ── Prompt interativo ─────────────────────────────────────────────────────────
function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim().toLowerCase())));
}

async function interactive(rows) {
  // Semeia o registro de versao dos presentes-sem-marcador (converge o manifesto
  // pra que bumps futuros sejam detectaveis), sem baixar nada.
  for (const row of rows.filter((r) => r.needsSeed)) writeManifestEntry(row.key, row.pinnedTag);

  const actionable = rows.filter((r) => r.status === 'missing' || r.status === 'outdated');
  const okRows = rows.filter((r) => r.status === 'ok');

  if (actionable.length === 0 && okRows.length === 0) {
    console.log(dim('  Nada a fazer.'));
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // 1) Faltando / desatualizado — pergunta um a um.
    for (const row of actionable) {
      const verb = row.status === 'missing' ? 'Baixar' : 'Atualizar';
      const detail =
        row.status === 'outdated'
          ? `${row.installedVer} → ${row.pinnedTag}`
          : `versao ${row.pinnedTag || 'pinada'}`;
      const a = await ask(rl, `  ${yellow('?')} ${verb} ${bold(row.key)} (${detail})? [${green('s')}/N] `);
      if (a === 's' || a === 'sim' || a === 'y' || a === 'yes') {
        // 'missing' baixa sem --force (sentinela ausente ja dispara o download);
        // 'outdated' idem no YANC (ele detecta o bump). --force so por seguranca
        // no caso desatualizado pra garantir a sobrescrita.
        runDownload(row, { force: row.status === 'outdated' });
      } else {
        console.log(dim(`    pulado: ${row.key}`));
      }
    }

    // 2) Ja instalados e OK — oferece re-download mesmo assim (bump silencioso).
    if (okRows.length > 0) {
      console.log('');
      const a = await ask(
        rl,
        `  ${yellow('?')} Forcar re-download de algum componente ja instalado (para pegar um bump silencioso)? [s/${bold('N')}] `,
      );
      if (a === 's' || a === 'sim' || a === 'y' || a === 'yes') {
        for (const row of okRows) {
          const b = await ask(rl, `    ${yellow('?')} Re-baixar ${bold(row.key)} (${row.pinnedTag || 'pinada'})? [s/N] `);
          if (b === 's' || b === 'sim' || b === 'y' || b === 'yes') runDownload(row, { force: true });
          else console.log(dim(`      pulado: ${row.key}`));
        }
      }
    }
  } finally {
    rl.close();
  }
  console.log('');
  console.log(dim('  Dica: rode de novo com --report pra reconferir o estado.'));
}

// ── Modos nao-interativos ─────────────────────────────────────────────────────
function nonInteractive(rows) {
  if (FLAG.forceAll) {
    for (const row of rows) {
      if (row.status === 'error' || row.status === 'unavailable') continue;
      runDownload(row, { force: true });
    }
    return;
  }
  // --yes: baixa faltantes + atualiza desatualizados (nao mexe nos OK).
  const todo = rows.filter((r) => r.status === 'missing' || r.status === 'outdated');
  if (todo.length === 0) {
    console.log(dim('  Nada a baixar (--yes).'));
    return;
  }
  for (const row of todo) runDownload(row, { force: row.status === 'outdated' });
}

// ── Modo postinstall (chamado pelo hook do npm) ───────────────────────────────
// Objetivo: depois de `npm install`, restaurar automaticamente qualquer
// executavel que esteja FALTANDO (ex.: apagado a mao) — sem prompts, sem
// upgrade de quem ja esta la, silencioso quando nao ha nada a fazer, e SEMPRE
// exit 0 pra jamais quebrar o `npm install`.
function runPostinstall() {
  // Nao rodar em CI: o `npm ci` do GitHub Actions nao precisa dos binarios pros
  // testes, e baixar a toolchain inteira a cada run seria lento/desnecessario.
  // Opt-out manual tambem: AURORA_SKIP_BOOTSTRAP=1.
  if (process.env.CI || process.env.AURORA_SKIP_BOOTSTRAP) {
    return;
  }
  const rows = collect();
  const missing = rows.filter((r) => r.status === 'missing');
  const outdated = rows.filter((r) => r.status === 'outdated');

  // Semeia o registro de versao dos que estao presentes mas sem marcador, pra
  // que um bump FUTURO seja detectado (sem baixar nada agora).
  for (const row of rows.filter((r) => r.needsSeed)) writeManifestEntry(row.key, row.pinnedTag);

  const todo = [...missing, ...outdated];
  if (todo.length === 0) {
    // Tudo presente e na versao pinada — so uma linha discreta (nao polui o log).
    console.log(dim('  [aurora] componentes: OK (nada a baixar)'));
    return;
  }
  console.log('');
  if (missing.length) console.log(bold(`  [aurora] ${missing.length} componente(s) faltando — baixando...`));
  if (outdated.length) console.log(bold(`  [aurora] ${outdated.length} componente(s) com bump de versao — atualizando...`));
  for (const row of todo) {
    try {
      // faltando: sentinela ausente ja dispara o download (sem --force).
      // bump: --force pra garantir a sobrescrita pela versao nova.
      runDownload(row, { force: row.status === 'outdated' });
    } catch (e) {
      // Best-effort: um download que falha (offline etc.) nao pode travar o install.
      console.log(red(`  [aurora] falha em ${row.key}: ${e instanceof Error ? e.message : String(e)}`));
    }
  }
  console.log(dim('  [aurora] pronto. (rode "npm run components:verify" pra conferir/atualizar)'));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (FLAG.postinstall) {
    runPostinstall();
    return; // sempre exit 0
  }

  const rows = collect();

  if (FLAG.json) {
    const clean = rows.map(({ scriptPath, ...r }) => ({ ...r, sentinel: rel(r.sentinel) }));
    console.log(JSON.stringify({ components: clean }, null, 2));
  } else {
    printReport(rows);
  }

  const missing = rows.filter((r) => r.status === 'missing').length;

  if (!FLAG.json && !FLAG.report) {
    if (FLAG.forceAll || FLAG.yes) {
      nonInteractive(rows);
    } else if (process.stdin.isTTY && process.stdout.isTTY) {
      await interactive(rows);
    } else {
      console.log(dim('  (sem TTY — sem prompts. Use --yes, --force-all ou --report.)'));
    }
  }

  if (FLAG.strict && missing > 0) process.exit(1);
}

main().catch((e) => {
  console.error(red('verify-components falhou: ' + (e instanceof Error ? e.stack : String(e))));
  process.exit(1);
});
