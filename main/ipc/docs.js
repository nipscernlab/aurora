// @ts-check
/**
 * docs.js — abre o manual do SAPHO e o mantém atualizado.
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
 * módulo não afrouxa aquela guarda nem aceita caminho do renderer — ele monta o
 * caminho a partir de constantes e só então entrega ao sistema.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { app, shell, ipcMain, BrowserWindow } = require('electron');
const log = require('electron-log');

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
 * UTF-8 com BOM por padrão — como o manifesto vem da rede, toleramos aqui.
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
}

// isNewer e stripBom sao exportados para teste. Sao puros e decidem se o manual
// baixado substitui o que veio no instalador; errar ali serve documentacao velha
// em silencio. Ver tests/unit/docsVersion.test.js.
module.exports = { register, status, ONLINE_URL, isNewer, stripBom };
