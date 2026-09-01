// @ts-check
/**
 * slang_lsp.js: SystemVerilog SEMANTIC language server bridge (O11).
 *
 * Spawns a single long-lived `slang-server` (hudson-trading/slang-server,
 * bundled in components/Packages/slang-server/bin via
 * download-slang-server.js) and speaks Content-Length-framed JSON-RPC over
 * stdio. Unlike Verible (O2, syntactic + per-file), slang ELABORATES the
 * whole design, so it catches semantic errors Verible can't (undeclared
 * identifiers, type/port mismatches, unused signals, …) and offers
 * symbol completion.
 *
 * Per the chosen split ("meio-termo"), the renderer
 * (js/editor/slang_integration.js) only consumes slang's DIAGNOSTICS
 * (owner 'slang', coexisting with Verible's) and COMPLETION, hover,
 * definition, references, outline and formatting stay with Verible. slang
 * can be toggled off (it elaborates on every change and can be noisy on
 * incomplete designs).
 *
 * slang is WORKSPACE-coupled: it indexes the open project's tree, so this
 * bridge starts it with the project dir as rootUri and transparently
 * restarts it when the project changes. Everything is best-effort: if the
 * binary is missing or the toggle is off, calls no-op and the editor
 * behaves as before.
 *
 * O indice do slang e um retrato, tirado uma vez quando o servidor sobe. Um
 * modulo so e reconhecido se o arquivo que o declara estava la naquele
 * instante, e e dai que vinha o erro falso mais visto: o testbench instancia
 * o top level, os dois moram em arquivos diferentes, e o editor sublinha
 * `unknown module` num projeto que compila. Duas situacoes produzem isso.
 *
 * A primeira e o arquivo ter nascido depois. Criar um .v pela arvore, gerar o
 * Hardware/<proc>.v pelo C±, trocar de branch: nada disso chegava ao
 * servidor, porque o slang pede um file watcher ao cliente e este bridge
 * nunca respondia. Agora responde, via chokidar sobre a pasta do projeto
 * ([watchProject](#)), e cutuca os buffers abertos depois de avisar, senao o
 * erro velho ficaria na tela ate a pessoa digitar alguma coisa.
 *
 * A segunda e o arquivo morar fora da pasta do projeto. Importar um .v de
 * outro lugar guarda o caminho absoluto no .spf e nao copia nada, entao o
 * arquivo existe para a compilacao e nao para o indice. Para esses, e so
 * para esses, escrevemos `.slang/local/server.json` dizendo tambem quais
 * pastas de fora indexar. O arquivo e do slang, nao nosso: se ja existir sem
 * a nossa marca, e do usuario e nao encostamos nele.
 *
 * The transport mirrors verible_lsp.js on purpose; slang's extras live
 * here (workspace rootUri, server→client request replies, enable/disable,
 * project-change restart, completion) so the live-validated O2 bridge is
 * left untouched.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const { ipcMain } = require('electron');
const log = require('electron-log');
const chokidar = require('chokidar');

const state = require('../state');
const { componentsPath } = require('../paths');
const { spawnTracked } = require('../process_registry');
const { isAllowed } = require('../compile/binary_allowlist');
const { criarDisjuntor } = require('./disjuntor');

// ── Configuration ────────────────────────────────────────────────────────────

const LS_BIN = path.join(componentsPath, 'Packages', 'slang-server', 'bin', 'slang-server.exe');
const REQUEST_TIMEOUT_MS = 20000; // elaboration can be heavier than a lint

/** Extensoes que o indice do slang cobre (as mesmas do glob default dele). */
const WATCHED_EXTS = new Set(['.v', '.sv', '.vh', '.svh']);
/** Uma janela de rebuild costuma mexer em dezenas de arquivos; agrupa. */
const WATCH_DEBOUNCE_MS = 350;
/** LSP FileChangeType. */
const FILE_CREATED = 1;
const FILE_CHANGED = 2;
const FILE_DELETED = 3;

// ── State ────────────────────────────────────────────────────────────────────

/** @type {import('child_process').ChildProcess | null} */
let proc = null;
let ready = false;
let enabled = true; // toggle; the renderer syncs the persisted state at boot
/** @type {Promise<void> | null} */
let startPromise = null;
let nextId = 1;
/** @type {Map<number, {resolve:(v:any)=>void, reject:(e:any)=>void, timer:NodeJS.Timeout}>} */
const pending = new Map();
/** @type {Map<string, {version:number, text:string, languageId:string}>} */
const openDocs = new Map();
let stdoutBuf = Buffer.alloc(0);
/** Project dir the live server was started for (null = none / not started). */
let currentProjectDir = null;
/** @type {import('chokidar').FSWatcher | null} */
let watcher = null;
/** Mudancas de disco acumuladas ate o debounce fechar: path → FileChangeType. */
const pendingFileChanges = new Map();
/** @type {NodeJS.Timeout | null} */
let fileChangeTimer = null;
/** Assinatura das pastas extras indexadas, pra so reiniciar quando ela muda. */
let extraDirsSignature = '';

// ── Helpers ──────────────────────────────────────────────────────────────────

function binInstalled() {
  try { return fs.existsSync(LS_BIN); } catch { return false; }
}

/** The open project's root dir (parent of the .spf), or null. */
function projectDirNow() {
  const spf = state.currentOpenProjectPath;
  return spf ? path.dirname(spf) : null;
}

/** Caminho comparavel no Windows: barras iguais, sem barra final, minusculo. */
function chave(/** @type {string} */ p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** `alvo` esta dentro de `base` (ou e o proprio). */
function dentroDe(/** @type {string} */ alvo, /** @type {string} */ base) {
  const a = chave(alvo);
  const b = chave(base);
  return !!a && !!b && (a === b || a.startsWith(b + '/'));
}

// ── Pastas de fonte fora da pasta do projeto ─────────────────────────────────

/**
 * As pastas que o .spf referencia e que nao estao debaixo da raiz do projeto.
 *
 * Importar um .v guarda o caminho e nao copia o arquivo, entao um projeto pode
 * apontar para qualquer lugar do disco. O indice do slang so varre a raiz, e um
 * modulo declarado la fora vira `unknown module` na instanciacao.
 *
 * Le o .spf direto (o renderer e o dono da escrita; aqui e so leitura) e devolve
 * a lista ordenada, sem repetir, das pastas de fora.
 */
function extraSourceDirs(/** @type {string} */ projectDir) {
  const spf = state.currentOpenProjectPath;
  if (!spf || !projectDir) return [];
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(spf, 'utf8'));
  } catch {
    return []; // .spf ausente ou meio-escrito: sem extras, o indice padrao serve
  }
  const structure = doc && doc.structure;
  if (!structure) return [];
  const base = typeof structure.basePath === 'string' && structure.basePath
    ? structure.basePath
    : projectDir;

  const dirs = new Map(); // chave comparavel → caminho como esta no disco
  for (const campo of ['synthesizableFiles', 'testbenchFiles']) {
    const arr = Array.isArray(structure[campo]) ? structure[campo] : [];
    for (const entry of arr) {
      const raw = entry && typeof entry.path === 'string' ? entry.path : '';
      if (!raw) continue;
      // .spf novo grava relativo quando o arquivo esta dentro; .spf antigo
      // grava absoluto sempre. Resolver contra a base cobre os dois.
      const abs = path.resolve(base, raw);
      if (dentroDe(abs, projectDir)) continue;
      const dir = path.dirname(abs);
      if (!dirs.has(chave(dir))) dirs.set(chave(dir), dir);
    }
  }
  return [...dirs.values()].sort();
}

/** Onde o slang procura a config local do workspace, e a nossa marca de posse. */
function slangConfigPaths(/** @type {string} */ projectDir) {
  const dir = path.join(projectDir, '.slang', 'local');
  return { dir, config: path.join(dir, 'server.json'), marker: path.join(dir, '.aurora') };
}

/**
 * Escreve (ou apaga) `.slang/local/server.json` com as pastas extras a indexar.
 *
 * O arquivo e do slang, nao da AURORA: se ja existir sem a marca `.aurora` ao
 * lado, e do usuario e nao encostamos nele, nem para atualizar. Sem pastas
 * extras nao ha o que dizer, entao o nosso arquivo sai de cena em vez de ficar
 * repetindo o comportamento padrao.
 *
 * Roda antes de subir o servidor: a config so e lida no boot dele.
 */
function syncSlangConfig(/** @type {string} */ projectDir, /** @type {string[]} */ extraDirs) {
  if (!projectDir) return;
  const { dir, config, marker } = slangConfigPaths(projectDir);
  const nosso = fs.existsSync(marker);
  const existe = fs.existsSync(config);

  if (existe && !nosso) {
    log.info('[slang-ls] .slang/local/server.json e do usuario, mantendo como esta');
    return;
  }
  try {
    if (extraDirs.length === 0) {
      if (existe) fs.rmSync(config, { force: true });
      if (nosso) fs.rmSync(marker, { force: true });
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    // `index` SUBSTITUI o default (varrer o workspace), entao a raiz do projeto
    // precisa entrar na lista junto com as pastas de fora.
    const body = { index: [{ dirs: [projectDir, ...extraDirs] }] };
    fs.writeFileSync(config, JSON.stringify(body, null, 2) + '\n', 'utf8');
    fs.writeFileSync(marker, 'Gerado pela AURORA. Apagar este arquivo faz a AURORA parar de mexer no server.json ao lado.\n', 'utf8');
    log.info(`[slang-ls] indexando tambem ${extraDirs.length} pasta(s) fora do projeto`);
  } catch (e) {
    log.warn('[slang-ls] nao consegui escrever a config do slang:', e instanceof Error ? e.message : e);
  }
}

function sendMain(/** @type {string} */ channel, /** @type {any} */ payload) {
  const w = state.mainWindow;
  if (w && !w.isDestroyed()) {
    try { w.webContents.send(channel, payload); } catch { /* tearing down */ }
  }
}

function writeMessage(/** @type {any} */ msg) {
  if (!proc || !proc.stdin || !proc.stdin.writable) return;
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  try {
    proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    proc.stdin.write(body);
  } catch (e) {
    log.warn('[slang-ls] write failed:', e instanceof Error ? e.message : e);
  }
}

function notify(/** @type {string} */ method, /** @type {any} */ params) {
  writeMessage({ jsonrpc: '2.0', method, params });
}

function request(/** @type {string} */ method, /** @type {any} */ params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`LSP request timed out: ${method}`)); }
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    writeMessage({ jsonrpc: '2.0', id, method, params });
  });
}

// ── File watcher (disco → indice do slang) ───────────────────────────────────

/**
 * Reapresenta os buffers abertos ao servidor com o texto que ja tinham.
 *
 * O slang so republica diagnostico de um documento quando esse documento se
 * mexe. Depois de avisar que o disco mudou, os erros na tela ainda sao os do
 * indice velho: criar o arquivo do top level limpava o `unknown module` so na
 * proxima tecla digitada. Um didChange sem alteracao nenhuma refaz a analise e
 * a linha vermelha some sozinha.
 */
function nudgeOpenDocs() {
  if (!ready) return;
  for (const [uri, doc] of openDocs) {
    doc.version += 1;
    notify('textDocument/didChange', {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text: doc.text }],
    });
  }
}

/**
 * O arquivo esta aberto no editor?
 *
 * Compara caminho com caminho, e nao URI com URI: a URI que o Monaco manda vem
 * com o `:` da unidade escapado (`file:///c%3A/...`) e a que o Node monta aqui
 * nao, entao a comparacao textual daria "nao" para o mesmo arquivo.
 */
function estaAberto(/** @type {string} */ file) {
  const alvo = chave(file);
  for (const uri of openDocs.keys()) {
    let p;
    try { p = fileURLToPath(uri); } catch { continue; }
    if (chave(p) === alvo) return true;
  }
  return false;
}

/** Fecha o lote acumulado: avisa o slang do que mudou no disco e cutuca. */
function flushFileChanges() {
  fileChangeTimer = null;
  const lote = [...pendingFileChanges.entries()];
  pendingFileChanges.clear();
  if (lote.length === 0) return;

  // Mexeu no .spf: se o conjunto de pastas de fora mudou, a config do indice
  // ficou velha, e ela so e lida no boot. Reiniciar e o unico caminho.
  const spf = state.currentOpenProjectPath;
  if (spf && lote.some(([p]) => chave(p) === chave(spf))) {
    const dir = projectDirNow();
    const assinatura = dir ? extraSourceDirs(dir).join('|') : '';
    if (assinatura !== extraDirsSignature) {
      log.info('[slang-ls] pastas de fonte mudaram no .spf, reiniciando o indice');
      restart();
      return;
    }
  }

  const changes = lote
    .filter(([p]) => WATCHED_EXTS.has(path.extname(p).toLowerCase()))
    .map(([p, type]) => ({ uri: pathToFileURL(p).toString(), type }));
  if (changes.length === 0 || !ready) return;

  notify('workspace/didChangeWatchedFiles', { changes });
  nudgeOpenDocs();
}

function queueFileChange(/** @type {string} */ file, /** @type {number} */ type) {
  const ext = path.extname(file).toLowerCase();
  const spf = state.currentOpenProjectPath;
  const eSpf = !!spf && chave(file) === chave(spf);
  if (!eSpf && !WATCHED_EXTS.has(ext)) return;
  // Edicao de arquivo aberto no editor nao entra: o proprio Monaco ja manda
  // didChange, e o buffer, nao o disco, e quem manda no conteudo. Criacao e
  // remocao passam, porque essas o editor nao conta.
  if (type === FILE_CHANGED && !eSpf && estaAberto(file)) return;
  pendingFileChanges.set(file, type);
  if (fileChangeTimer) clearTimeout(fileChangeTimer);
  fileChangeTimer = setTimeout(flushFileChanges, WATCH_DEBOUNCE_MS);
}

/**
 * Observa a pasta do projeto e repassa o que mexer para o slang.
 *
 * O servidor pede este watcher via `client/registerCapability` logo depois do
 * initialize; sem ele o indice fica congelado no que existia quando o projeto
 * abriu. Ignora pastas ocultas e as de saida (Temp, Backup), que so trariam
 * copia de arquivo ja indexado.
 */
function startWatcher(/** @type {string | null} */ dir) {
  stopWatcher();
  if (!dir) return;
  // O teste e sempre RELATIVO a raiz observada. Testar o caminho inteiro
  // parecia equivalente e nao e: um projeto guardado em `...\Temp\meu_projeto`
  // casaria com a propria regra de exclusao e o watcher nasceria vendo nada.
  const ignorado = (/** @type {string} */ p) => {
    const rel = path.relative(dir, p);
    if (!rel || rel.startsWith('..')) return false;
    return rel.split(/[\\/]/).some((seg) => (
      seg.startsWith('.') || seg === 'node_modules' || seg === 'Temp' || seg === 'Backup'
    ));
  };
  try {
    watcher = chokidar.watch(dir, {
      ignored: ignorado,
      persistent: true,
      ignoreInitial: true,
      depth: 12,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    });
    watcher.on('add', (p) => queueFileChange(p, FILE_CREATED));
    watcher.on('change', (p) => queueFileChange(p, FILE_CHANGED));
    watcher.on('unlink', (p) => queueFileChange(p, FILE_DELETED));
    watcher.on('error', (e) => log.warn('[slang-ls] watcher:', e instanceof Error ? e.message : e));
  } catch (e) {
    watcher = null;
    log.warn('[slang-ls] nao consegui observar o projeto:', e instanceof Error ? e.message : e);
  }
}

function stopWatcher() {
  if (fileChangeTimer) { clearTimeout(fileChangeTimer); fileChangeTimer = null; }
  pendingFileChanges.clear();
  const w = watcher;
  watcher = null;
  if (w) { try { w.close(); } catch { /* ja fechado */ } }
}

function handleMessage(/** @type {any} */ msg) {
  // Response to one of our requests.
  if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
    const entry = pending.get(msg.id);
    if (entry) {
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(msg.error.message || 'LSP error'));
      else entry.resolve(msg.result);
    }
    return;
  }
  // Server → client notification.
  if (typeof msg.method === 'string' && (msg.id === undefined || msg.id === null)) {
    if (msg.method === 'textDocument/publishDiagnostics' && msg.params) {
      sendMain('slang:diagnostics', {
        uri: msg.params.uri,
        diagnostics: Array.isArray(msg.params.diagnostics) ? msg.params.diagnostics : [],
      });
    }
    // Other notifications (window/logMessage, $/progress, telemetry, …) ignored.
    return;
  }
  // Server → client REQUEST (has id + method), slang sends a few
  // (registerCapability, workspace/configuration, workDoneProgress/create).
  // We must reply so the server isn't left waiting.
  if (msg.id !== undefined && msg.id !== null && typeof msg.method === 'string') {
    let result = null;
    if (msg.method === 'workspace/configuration' && msg.params && Array.isArray(msg.params.items)) {
      result = msg.params.items.map(() => null); // no per-section overrides
    }
    writeMessage({ jsonrpc: '2.0', id: msg.id, result });
  }
}

function onStdout(/** @type {Buffer} */ chunk) {
  stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
  for (;;) {
    const sep = stdoutBuf.indexOf('\r\n\r\n');
    if (sep < 0) break;
    const header = stdoutBuf.slice(0, sep).toString('ascii');
    const m = /content-length:\s*(\d+)/i.exec(header);
    if (!m) { stdoutBuf = stdoutBuf.slice(sep + 4); continue; }
    const len = parseInt(m[1], 10);
    if (stdoutBuf.length < sep + 4 + len) break;
    const body = stdoutBuf.slice(sep + 4, sep + 4 + len).toString('utf8');
    stdoutBuf = stdoutBuf.slice(sep + 4 + len);
    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    try { handleMessage(msg); } catch (e) {
      log.warn('[slang-ls] message handler error:', e instanceof Error ? e.message : e);
    }
  }
}

/** Reset live-process state and reject anything in flight. Keeps openDocs. */
function handleProcessGone() {
  ready = false;
  proc = null;
  startPromise = null;
  stdoutBuf = Buffer.alloc(0);
  currentProjectDir = null;
  stopWatcher();
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    try { entry.reject(new Error('slang-server stopped')); } catch { /* ignore */ }
  }
  pending.clear();
}

function doStart() {
  return new Promise((resolve, reject) => {
    if (!binInstalled()) { reject(new Error('slang-server not installed')); return; }
    const verdict = isAllowed(LS_BIN);
    if (!verdict.ok) { reject(new Error(verdict.error)); return; }

    const dir = projectDirNow();
    const rootUri = dir ? pathToFileURL(dir).toString() : null;

    // Antes de subir: a config do indice so e lida no boot do servidor.
    const extraDirs = dir ? extraSourceDirs(dir) : [];
    extraDirsSignature = extraDirs.join('|');
    if (dir) syncSlangConfig(dir, extraDirs);

    let initSettled = false;
    let child;
    try {
      child = spawnTracked(LS_BIN, [], { windowsHide: true, cwd: dir || componentsPath });
    } catch (e) { reject(e); return; }
    proc = child;
    currentProjectDir = dir;

    child.stdout.on('data', onStdout);
    child.stderr.on('data', () => { /* slang logs banners/info to stderr */ });
    child.on('error', (err) => {
      log.error('[slang-ls] process error:', err);
      if (!initSettled) { initSettled = true; reject(err); }
      handleProcessGone();
    });
    child.on('exit', (code, sig) => {
      log.info(`[slang-ls] exited (code=${code} sig=${sig})`);
      if (!initSettled) { initSettled = true; reject(new Error(`slang-server exited (code ${code})`)); }
      handleProcessGone();
    });

    request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: dir ? [{ uri: rootUri, name: path.basename(dir) }] : null,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          publishDiagnostics: {},
          completion: {
            contextSupport: true,
            completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'] },
          },
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
          // Sem isto o servidor registra o watcher e fica esperando por avisos
          // que nunca chegam: arquivo criado depois do boot nunca entra no
          // indice, e o testbench acusa `unknown module` para sempre.
          didChangeWatchedFiles: { dynamicRegistration: true },
        },
      },
      clientInfo: { name: 'Aurora', version: '1' },
    }).then(() => {
      notify('initialized', {});
      ready = true;
      initSettled = true;
      for (const [uri, doc] of openDocs) {
        doc.version = 1;
        notify('textDocument/didOpen', {
          textDocument: { uri, languageId: doc.languageId, version: 1, text: doc.text },
        });
      }
      startWatcher(dir);
      resolve();
    }).catch((e) => {
      if (!initSettled) { initSettled = true; reject(e); }
    });
  });
}

function start() {
  if (ready) return Promise.resolve();
  if (startPromise) return startPromise;
  startPromise = doStart();
  startPromise.catch(() => {}).then(() => { if (!ready) startPromise = null; });
  return startPromise;
}

async function ensureReady() {
  if (!enabled) return false;
  if (ready) return true;
  try { await start(); } catch { return false; }
  return ready;
}

/** Kill the live server. clearDiag drops the markers the renderer shows. */
function stop(clearDiag) {
  if (clearDiag) {
    for (const uri of openDocs.keys()) sendMain('slang:diagnostics', { uri, diagnostics: [] });
  }
  // Servidor novo, contagem nova: as falhas eram daquele processo, e carrega-las
  // adiante deixaria o proximo comecar ja calado.
  disjuntorCompletar.zerar();
  const child = proc;
  handleProcessGone();
  if (child) { try { child.kill(); } catch { /* ignore */ } }
}

/**
 * Derruba e sobe de novo na hora, sem esperar a proxima tecla.
 *
 * Usado quando so um boot resolve (a config do indice mudou). O doStart
 * reapresenta os buffers de openDocs, entao os diagnosticos voltam sozinhos.
 */
function restart() {
  if (!enabled) return;
  stop(false);
  start().catch(() => { /* o proximo didOpen/didChange tenta de novo */ });
}

/** If the open project changed under us, restart so slang re-indexes it. */
function maybeRestartForProject() {
  if (ready && projectDirNow() !== currentProjectDir) {
    // Keep openDocs, the renderer disposes old-project models (didClose) and
    // opens the new ones, so openDocs already reflects the new set; doStart
    // re-seeds them against the new root.
    stop(false);
  }
}

// ── Document lifecycle (renderer-driven) ──────────────────────────────────────

async function didOpen(/** @type {string} */ uri, /** @type {string} */ text, /** @type {string} */ languageId) {
  if (!enabled || typeof uri !== 'string' || typeof text !== 'string') return;
  maybeRestartForProject();
  if (!(await ensureReady())) return;
  if (openDocs.has(uri)) return didChange(uri, text);
  openDocs.set(uri, { version: 1, text, languageId: languageId || 'systemverilog' });
  notify('textDocument/didOpen', { textDocument: { uri, languageId: languageId || 'systemverilog', version: 1, text } });
}

async function didChange(/** @type {string} */ uri, /** @type {string} */ text) {
  if (!enabled || typeof uri !== 'string' || typeof text !== 'string') return;
  if (!(await ensureReady())) return;
  const doc = openDocs.get(uri);
  if (!doc) {
    openDocs.set(uri, { version: 1, text, languageId: 'systemverilog' });
    notify('textDocument/didOpen', { textDocument: { uri, languageId: 'systemverilog', version: 1, text } });
    return;
  }
  doc.version += 1;
  doc.text = text;
  notify('textDocument/didChange', { textDocument: { uri, version: doc.version }, contentChanges: [{ text }] });
}

function didClose(/** @type {string} */ uri) {
  if (typeof uri !== 'string') return;
  openDocs.delete(uri);
  if (ready) notify('textDocument/didClose', { textDocument: { uri } });
  sendMain('slang:diagnostics', { uri, diagnostics: [] });
}

/**
 * Disjuntor do completar codigo.
 *
 * O slang responde `bad allocation` quando o buffer esta no meio de uma edicao
 * e o desenho ainda nao fecha. Como o editor pede sugestao a cada tecla, uma
 * digitacao normal virava cinco, dez pedidos identicos, todos falhando: o log
 * enchia de linhas iguais e o servidor refazia a elaboracao do projeto inteiro
 * de graca. A falha e do servidor, escrita em C++, e nao ha o que corrigir
 * daqui; o que da para corrigir e a insistencia.
 *
 * Depois de tres falhas seguidas ele para de perguntar por um minuto. Uma
 * resposta boa fecha o disjuntor, entao o caso comum, que e o arquivo voltar a
 * fechar assim que a pessoa termina de digitar, se resolve sozinho.
 */
const disjuntorCompletar = criarDisjuntor({
  nome: 'slang completion',
  aoAbrir: ({ falhas, motivo, pausaMs }) => {
    log.warn(
      `[slang-ls] completar codigo falhou ${falhas}x seguidas (${motivo}); `
      + `pausando por ${Math.round(pausaMs / 1000)}s. As sugestoes do proprio editor continuam.`,
    );
  },
  aoFechar: () => log.info('[slang-ls] completar codigo voltou a responder.'),
});

async function completion(/** @type {string} */ uri, /** @type {any} */ position) {
  if (!enabled) return null;
  if (!disjuntorCompletar.podeTentar()) return null;
  if (!(await ensureReady())) return null;
  try {
    const r = await request('textDocument/completion', { textDocument: { uri }, position });
    disjuntorCompletar.registrarSucesso();
    return r;
  } catch (e) {
    // O aviso sai do disjuntor, uma vez por pausa, e nao a cada tecla.
    disjuntorCompletar.registrarFalha(e);
    return null;
  }
}

function setEnabled(/** @type {boolean} */ on) {
  on = !!on;
  if (on === enabled) return { enabled };
  enabled = on;
  if (!on) stop(true); // disabling → kill + clear slang markers
  // enabling → lazy start on the next didOpen (the renderer re-opens its models)
  return { enabled };
}

// ── IPC registration ──────────────────────────────────────────────────────────

function register() {
  ipcMain.handle('slang:status', () => ({ installed: binInstalled(), ready, enabled }));
  ipcMain.handle('slang:set-enabled', (_e, on) => setEnabled(on));
  ipcMain.handle('slang:did-open', (_e, { uri, text, languageId } = {}) => didOpen(uri, text, languageId));
  ipcMain.handle('slang:did-change', (_e, { uri, text } = {}) => didChange(uri, text));
  ipcMain.handle('slang:did-close', (_e, { uri } = {}) => didClose(uri));
  ipcMain.handle('slang:completion', (_e, { uri, position } = {}) => completion(uri, position));
}

// extraSourceDirs/syncSlangConfig saem daqui para o teste: sao as duas pecas
// que decidem o que entra no indice, e errar nelas devolve o `unknown module`
// sem barulho nenhum.
module.exports = { register, extraSourceDirs, syncSlangConfig };
