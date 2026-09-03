// @ts-check
/**
 * docs.js: abre o manual do SAPHO e o mantém atualizado.
 *
 * A documentação vive em outro repositório (nipscernlab/docs_aurora), que a
 * publica em dois canais: o site em nipscern.com/library/sapho e um pacote .zip
 * anexado a uma Release. O instalador traz uma cópia desse pacote, para que o
 * manual abra na primeira execução e sem rede.
 *
 * ATUALIZAÇÃO
 * -----------
 * Documentação corrigida não deveria esperar uma release da AURORA. Por isso o
 * aplicativo relê o manifesto publicado e, havendo versão mais nova, baixa o
 * pacote para userData. A resolução prefere userData e cai para a cópia do
 * instalador, então uma falha de download nunca deixa o usuário sem manual.
 *
 * SEGURANÇA
 * ---------
 * O IPC `open-external` (main/ipc/files.js) recusa file:// de propósito: a URL
 * vem do renderer e pode ter origem, por exemplo, numa mensagem da IA. Este
 * módulo não afrouxa aquela guarda nem aceita caminho do renderer, ele monta o
 * caminho a partir de constantes e só então entrega ao sistema.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { app, shell, ipcMain, BrowserWindow } = require('electron');
const log = require('electron-log');

const busca = require('../docs/busca');
// O guarda de caminho da janela do manual. Reaproveitado pelo openHelp: duas
// checagens diferentes para a mesma fronteira divergem com o tempo.
const { dentroDaRaiz } = require('./docs_nav');

const ONLINE_URL = 'https://www.nipscern.com/library/sapho/';
const MANIFEST_URL = 'https://nipscernlab.github.io/docs_aurora/docs-manifest.json';

/** Cópia que veio no instalador (extraResources), somente leitura. */
function bundledDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'docs')
    : path.join(app.getAppPath(), 'resources', 'docs');
}

/** Cópia atualizada em execução, gravável. */
function userDir() {
  return path.join(app.getPath('userData'), 'docs');
}

/**
 * Remove um BOM inicial. JSON.parse o recusa, e ferramentas do Windows gravam
 * UTF-8 com BOM por padrão, como o manifesto vem da rede, toleramos aqui.
 */
function stripBom(/** @type {string} */ text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function readManifest(/** @type {string} */ dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'docs-manifest.json'), 'utf8');
    const m = JSON.parse(raw);
    return (m && typeof m.version === 'string') ? m : null;
  } catch (_) {
    return null;
  }
}

function hasDocs(/** @type {string} */ dir) {
  try { return fs.existsSync(path.join(dir, 'index.html')); }
  catch (_) { return false; }
}

/**
 * Compara versões no formato 1.2.3. Devolve true se `a` é mais nova que `b`.
 * Comparar como texto erraria em 6.10.0 contra 6.9.0.
 */
function isNewer(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da > db;
  }
  return false;
}

/** Diretório que deve ser servido: o mais novo entre userData e instalador. */
function activeDir() {
  const user = userDir();
  const bundled = bundledDir();
  const userHas = hasDocs(user);
  const bundledHas = hasDocs(bundled);

  if (userHas && bundledHas) {
    const uv = readManifest(user)?.version;
    const bv = readManifest(bundled)?.version;
    // Empate vai para o instalador: se a AURORA foi atualizada e trouxe a mesma
    // versao, a copia baixada nao acrescenta nada.
    return isNewer(uv, bv) ? user : bundled;
  }
  if (userHas) return user;
  if (bundledHas) return bundled;
  return '';
}

function status() {
  const dir = activeDir();
  return {
    hasOffline: Boolean(dir),
    version: dir ? (readManifest(dir)?.version || '') : '',
    onlineUrl: ONLINE_URL,
  };
}

/**
 * A URL e uma pagina do manual offline (da copia do instalador ou da baixada)?
 *
 * O main.js pergunta isto para NAO carimbar a politica de seguranca do
 * aplicativo nas paginas do manual. A politica sem 'unsafe-inline' (03/09/2026)
 * bloqueava o <script> inline com que o tema Furo define `data-theme` no body
 * antes da primeira pintura: sem ele, num Windows escuro o Furo escurecia a
 * pagina por `body:not([data-theme=light])` e o CSS do manual, que so conhece
 * `auto` e `dark`, deixava cartoes, admonicoes e a marca da barra lateral nas
 * cores claras, ilegiveis sobre o fundo escuro. O manual e HTML estatico
 * nosso, numa view sem preload e sem ponte; ele fica como sempre esteve, sem
 * a politica do aplicativo.
 * @param {string} url
 */
function isDocsUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return false;
  let alvo;
  try {
    alvo = path.resolve(decodeURIComponent(new URL(url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
  } catch (_) {
    return false;
  }
  const chave = (/** @type {string} */ p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  for (const raiz of [bundledDir(), userDir()]) {
    const r = chave(path.resolve(raiz));
    const a = chave(alvo);
    if (a === r || a.startsWith(r + path.sep)) return true;
  }
  return false;
}

/* ---------------------------------------------------------------------------
 *  Abertura
 * ------------------------------------------------------------------------ */

/**
 * Última linha de defesa: a própria AURORA é um Chromium, então mesmo sem
 * navegador associado a .html o manual abre. Cobre a máquina corporativa com a
 * associação removida, e serve a quem prefere não sair do aplicativo.
 */
function openInAppWindow(/** @type {string} */ indexPath) {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'SAPHO & AURORA — Manual',
    autoHideMenuBar: true,
    webPreferences: {
      // Conteúdo local e confiável, mas sem nenhuma ponte para o aplicativo:
      // esta janela só precisa renderizar HTML estático.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(indexPath);
  return win;
}

/**
 * Abre o manual local.
 *
 * @param {'browser'|'aurora'} [onde] Escolha do usuário. Com 'aurora' vai
 *   direto para a janela própria (main/ipc/docs_window.js). Sem escolha, ou com
 *   'browser', tenta o navegador do sistema e cai para a janela própria se a
 *   associação de .html estiver quebrada, que é o caso real de falha.
 */
async function openOffline(onde) {
  const dir = activeDir();
  if (!dir) return { ok: false, reason: 'missing' };

  const indexPath = path.join(dir, 'index.html');

  if (onde === 'aurora') {
    try {
      require('./docs_window').open(dir);
      return { ok: true, where: 'window', dir };
    } catch (e) {
      log.error('[docs] falha ao abrir a janela do manual:', e instanceof Error ? e.message : e);
      return { ok: false, reason: 'open-failed' };
    }
  }

  // shell.openPath devolve '' em sucesso e a mensagem de erro em falha. O caso
  // real nao e "nao existe navegador" (todo Windows traz o Edge), e sim a
  // associacao de .html removida ou quebrada.
  let failure = '';
  try {
    failure = await shell.openPath(indexPath);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }

  if (!failure) return { ok: true, where: 'browser', dir };

  log.warn('[docs] navegador indisponivel, abrindo na propria janela:', failure);
  try {
    // A janela completa é melhor do que a crua, e é o mesmo destino que o
    // usuário escolheria; openInAppWindow fica como último recurso se ela
    // falhar por qualquer motivo.
    try {
      require('./docs_window').open(dir);
    } catch (_) {
      openInAppWindow(indexPath);
    }
    return { ok: true, where: 'window', dir };
  } catch (e) {
    log.error('[docs] falha ao abrir a janela interna:', e instanceof Error ? e.message : e);
    return { ok: false, reason: 'open-failed' };
  }
}

/* ---------------------------------------------------------------------------
 *  Atualização
 * ------------------------------------------------------------------------ */

function fetchBuffer(/** @type {string} */ url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }
    https.get(url, { headers: { 'User-Agent': 'aurora-ide' } }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        fetchBuffer(res.headers.location, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (code !== 200) { res.resume(); reject(new Error(`HTTP ${code}`)); return; }
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Consulta o manifesto publicado e, se houver versão mais nova que a ativa,
 * baixa o pacote para userData. Silencioso por natureza: sem rede, com o site
 * fora do ar ou com o pacote corrompido, o usuário continua com o que já tem.
 */
async function checkForUpdate() {
  try {
    const remote = JSON.parse(stripBom((await fetchBuffer(MANIFEST_URL)).toString('utf8')));
    if (!remote?.version || !remote.package || !remote.sha256) return { ok: false, reason: 'bad-manifest' };

    const currentDir = activeDir();
    const current = currentDir ? (readManifest(currentDir)?.version || '') : '';
    if (current && !isNewer(remote.version, current)) {
      return { ok: true, updated: false, version: current };
    }

    const zip = await fetchBuffer(remote.package);
    const digest = crypto.createHash('sha256').update(zip).digest('hex');
    if (digest !== String(remote.sha256).toLowerCase()) {
      log.warn('[docs] SHA-256 do pacote nao confere; atualizacao descartada.');
      return { ok: false, reason: 'checksum' };
    }

    // Extrai ao lado e so entao troca, para que uma falha no meio do caminho
    // nao deixe o usuario com uma documentacao pela metade.
    const staging = `${userDir()}.new`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });

    const tmpZip = path.join(app.getPath('temp'), `sapho-docs-${remote.version}.zip`);
    fs.writeFileSync(tmpZip, zip);
    await extractZip(tmpZip, staging);
    fs.rmSync(tmpZip, { force: true });

    if (!hasDocs(staging)) {
      fs.rmSync(staging, { recursive: true, force: true });
      return { ok: false, reason: 'bad-package' };
    }

    fs.writeFileSync(path.join(staging, 'docs-manifest.json'), JSON.stringify(remote, null, 2), 'utf8');
    fs.rmSync(userDir(), { recursive: true, force: true });
    fs.renameSync(staging, userDir());

    log.info(`[docs] documentacao atualizada para ${remote.version}.`);
    return { ok: true, updated: true, version: remote.version };
  } catch (e) {
    log.warn('[docs] verificacao de atualizacao falhou:', e instanceof Error ? e.message : e);
    return { ok: false, reason: 'offline' };
  }
}

function extractZip(/** @type {string} */ zipPath, /** @type {string} */ destDir) {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ], (error) => (error ? reject(error) : resolve(undefined)));
  });
}

/* ------------------------------------------------------------------------ */

/**
 * Abre o manual numa página específica: é o que os botões de ajuda dos modais
 * chamam, para levar direto ao capítulo do assunto em vez de despejar a pessoa
 * no índice e deixá-la procurar.
 *
 * A validação de caminho NÃO é opcional aqui, e não é a mesma do `docs:ler`. A
 * página vem do renderer, e sem checagem um `../../` sairia da pasta do manual
 * e abriria qualquer arquivo do disco dentro de uma janela com a cara da
 * AURORA. `dentroDaRaiz` (main/ipc/docs_nav.js) é o mesmo guarda que a
 * navegação por links da janela já usa; reaproveitá-lo é deliberado, porque
 * duas checagens diferentes para a mesma fronteira divergem com o tempo.
 *
 * A âncora é separada do caminho de propósito: ela nunca toca o sistema de
 * arquivos, então não precisa passar pelo guarda, e misturá-la ao caminho faria
 * o `#secao` virar parte do nome do arquivo.
 *
 * @param {string} pagina caminho relativo dentro do manual, ex: 'verilog/ondas.html'
 * @returns {{ok: true} | {ok: false, motivo: string}}
 */
function openHelp(pagina) {
  const dir = activeDir();
  if (!dir) return { ok: false, motivo: 'manual-ausente' };
  if (typeof pagina !== 'string' || !pagina.trim()) return { ok: false, motivo: 'pagina-invalida' };

  const [rel, ancoraDaPagina = ''] = pagina.split('#');
  const alvo = path.join(dir, rel);
  if (!dentroDaRaiz(dir, alvo) || !fs.existsSync(alvo)) return { ok: false, motivo: 'pagina-invalida' };

  try {
    require('./docs_window').open(dir, rel, ancoraDaPagina);
    return { ok: true };
  } catch (e) {
    log.error('[docs] falha ao abrir a ajuda:', e instanceof Error ? e.message : e);
    return { ok: false, motivo: 'abrir-falhou' };
  }
}

function register() {
  /** O renderer usa isto para decidir se mostra o botão da versão offline. */
  ipcMain.handle('docs:status', () => status());

  /** Abre o manual local. Não recebe caminho: o destino é montado aqui. */
  ipcMain.handle('docs:open-offline', (_e, onde) => openOffline(onde));

  /**
   * Procura versão nova. Disparado uma vez por sessão pelo renderer, bem depois
   * da inicialização, para não competir com o que o usuário está esperando.
   */
  ipcMain.handle('docs:check-update', () => checkForUpdate());

  /**
   * Procurar e ler o manual, para a Aurora Intelligence.
   *
   * O caminho da pasta NAO vem do renderer: sai do `activeDir()` daqui, que ja
   * decide entre a copia atualizada e a do instalador. O modelo escolhe o que
   * procurar e qual pagina ler, nunca onde procurar.
   */
  ipcMain.handle('docs:buscar', (_e, consulta, opcoes) => {
    try {
      const dir = activeDir();
      if (!dir) return { ok: false, erro: 'manual nao esta instalado nesta maquina' };
      return { ok: true, resultados: busca.buscar(dir, consulta, opcoes || {}), online: ONLINE_URL };
    } catch (e) {
      log.warn('[docs] busca falhou:', e);
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  });

  // Ajuda contextual dos modais. Devolve {ok:false} em vez de lancar quando o
  // manual nao esta instalado, porque quem chama tem um plano B: abrir a mesma
  // pagina do manual publico no navegador.
  ipcMain.handle('docs:open-help', (_e, pagina) => openHelp(pagina));

  ipcMain.handle('docs:ler', (_e, caminho, opcoes) => {
    try {
      const dir = activeDir();
      if (!dir) return { ok: false, erro: 'manual nao esta instalado nesta maquina' };
      return busca.ler(dir, caminho, opcoes || {});
    } catch (e) {
      log.warn('[docs] leitura falhou:', e);
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  });
}

// isNewer e stripBom sao exportados para teste. Sao puros e decidem se o manual
// baixado substitui o que veio no instalador; errar ali serve documentacao velha
// em silencio. Ver tests/unit/docsVersion.test.js.
module.exports = { register, status, isNewer, stripBom, isDocsUrl };
