// @ts-check
/**
 * github_auth.js — "connect your GitHub account" for the source-control panel.
 *
 * The user pastes a GitHub Personal Access Token (classic or fine-grained with
 * `repo` scope). We validate it against the GitHub API, then store it encrypted
 * with Electron's `safeStorage` (DPAPI on Windows) — exactly like the AI API
 * keys (main/ai/keystore.js). Plaintext never hits disk. The token is read
 * main-side only (git.js injects it for push/pull); the renderer can ask "who
 * is connected?" but never gets the bytes.
 *
 * Vault (`userData/aurora-github.json`):
 *   { "token": "<base64 ciphertext>", "user": { login, name, avatarUrl } }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app, safeStorage, ipcMain, shell, BrowserWindow } = require('electron');
const log = require('electron-log');

// As decisoes (o que a resposta significa) moram ao lado, em github_api.js, sem
// conhecer https nem safeStorage. Aqui fica o que fala rede e guarda segredo.
const {
  nomeRepoValido, mapRepo, fimDaPaginacao, erroDeCriacao,
  intervaloInicialMs, decidirPolling,
} = require('./github_api');

// GitHub OAuth App (Device Flow). The Client ID is PUBLIC — it ships in the app
// and the device flow needs NO client secret, so this is safe to commit. Fill it
// in after registering the OAuth App at github.com/settings/developers with
// "Enable Device Flow" ticked. Empty ⇒ the "Sign in with GitHub" button is
// disabled and only the manual-token path is offered. Can also be supplied via
// the AURORA_GITHUB_CLIENT_ID env var for local testing before it's hard-coded.
const OAUTH_CLIENT_ID = process.env.AURORA_GITHUB_CLIENT_ID || 'Ov23linD078LyGE5aDvg';
// Scopes mirror what a classic PAT needs for AURORA: repo (clone/push/create) +
// read:org (so organization repos show in the clone list).
const OAUTH_SCOPE = 'repo read:org';

function vaultPath() {
  return path.join(app.getPath('userData'), 'aurora-github.json');
}

function readVault() {
  try {
    const parsed = JSON.parse(fs.readFileSync(vaultPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    if (err && err.code !== 'ENOENT') log.warn('[github_auth] read failed:', e);
    return {};
  }
}

function writeVault(/** @type {Record<string, any>} */ vault) {
  fs.mkdirSync(path.dirname(vaultPath()), { recursive: true });
  fs.writeFileSync(vaultPath(), JSON.stringify(vault, null, 2));
}

/** GET https://api.github.com<path> with a bearer token → parsed JSON. */
function apiGet(/** @type {string} */ apiPath, /** @type {string} */ token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'aurora-ide',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        } else if (res.statusCode === 401) {
          reject(new Error('Invalid or expired token (401).'));
        } else {
          reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** POST JSON to https://api.github.com<path> with a bearer token → parsed JSON. */
function apiPost(apiPath, token, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'aurora-ide',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        const sc = res.statusCode || 0;
        if (sc >= 200 && sc < 300) { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }
        else {
          let msg = `GitHub API ${sc}`;
          try { msg = JSON.parse(body).message || msg; } catch (_) { /* keep */ }
          reject(new Error(msg));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** Create a repo under the connected account. Returns clone/html URLs. */
async function createRepo(name, isPrivate) {
  const token = getToken();
  if (!token) throw new Error('Conecte sua conta GitHub primeiro.');
  if (!nomeRepoValido(name)) throw new Error('Nome de repositório inválido.');
  try {
    const repo = await apiPost('/user/repos', token, { name, private: !!isPrivate, auto_init: false });
    return { fullName: repo.full_name, cloneUrl: repo.clone_url, htmlUrl: repo.html_url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(erroDeCriacao(msg, name), { cause: e });
  }
}

/** Fetch an image URL and return it as a `data:` URL (so it passes the renderer
 *  CSP `img-src 'self' data:` without loosening the policy for github.com). */
function fetchDataUrl(url, depth = 0) {
  return new Promise((resolve) => {
    if (depth > 3) return resolve(null);
    try {
      https.get(url, { headers: { 'User-Agent': 'aurora-ide' } }, (res) => {
        const sc = res.statusCode || 0;
        if (sc >= 300 && sc < 400 && res.headers.location) {
          res.resume();
          return resolve(fetchDataUrl(res.headers.location, depth + 1));
        }
        if (sc !== 200) { res.resume(); return resolve(null); }
        const type = res.headers['content-type'] || 'image/png';
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(`data:${type};base64,${Buffer.concat(chunks).toString('base64')}`));
        res.on('error', () => resolve(null));
      }).on('error', () => resolve(null));
    } catch (_) { resolve(null); }
  });
}

/** Main-side only: the stored token, decrypted, or null. */
function getToken() {
  const { token } = readVault();
  if (!token) return null;
  try {
    return safeStorage.decryptString(Buffer.from(token, 'base64'));
  } catch (e) {
    log.warn('[github_auth] decrypt failed:', e);
    return null;
  }
}

/** Validate a token against the API, then store it encrypted + cache the user. */
async function connect(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Token is empty.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain encryption is not available on this system.');
  }
  const me = await apiGet('/user', token.trim());
  // Bake the avatar into a data: URL up front — the renderer CSP blocks remote
  // images, and this also makes it work offline after connecting.
  const avatarDataUrl = me.avatar_url ? await fetchDataUrl(me.avatar_url) : null;
  // Keep the URL too: the CSP allows avatars.githubusercontent.com, so the panel
  // can fall back to it if the data: bake ever fails.
  const user = { login: me.login, name: me.name || me.login, avatarDataUrl, avatarUrl: me.avatar_url };
  writeVault({
    token: safeStorage.encryptString(token.trim()).toString('base64'),
    user,
  });
  return user;
}

/**
 * List EVERY repository the token can reach — the user's own, ones they
 * collaborate on, AND organization repos (when the user is an org member and the
 * token was granted access to that org). That's the `affiliation` triad
 * GitHub recommends; `/user/repos` already spans owners, so no per-org calls are
 * needed. We paginate (the Link header isn't exposed by apiGet, so we walk pages
 * until a short page) up to a sane cap, and surface `owner`/`ownerType` so the
 * panel can group "your repos" apart from each organization.
 */
async function listRepos() {
  const token = getToken();
  if (!token) throw new Error('Conecte sua conta GitHub primeiro.');
  const perPage = 100;
  const maxPages = 5; // up to ~500 repos — plenty, and bounds the worst case
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const repos = await apiGet(
      `/user/repos?per_page=${perPage}&sort=updated&affiliation=owner,collaborator,organization_member&page=${page}`,
      token,
    );
    if (Array.isArray(repos)) all.push(...repos);
    if (fimDaPaginacao(repos, perPage)) break;
  }
  return all.map(mapRepo);
}

/** The connected user (no token), or null. */
function getUser() {
  const { user, token } = readVault();
  return token && user ? user : null;
}

function disconnect() {
  try { fs.unlinkSync(vaultPath()); } catch (_) { /* already gone */ }
  return true;
}

/** One-time backfill: accounts connected before avatars existed have no photo
 *  stored. On the next status check, fetch + persist it (no reconnect needed). */
async function ensureUserAvatar() {
  const vault = readVault();
  if (!vault.token || !vault.user) return;
  if (vault.user.avatarDataUrl || vault.user.avatarUrl) return;
  const token = getToken();
  if (!token) return;
  try {
    const me = await apiGet('/user', token);
    const avatarDataUrl = me.avatar_url ? await fetchDataUrl(me.avatar_url) : null;
    vault.user = { login: me.login, name: me.name || me.login, avatarDataUrl, avatarUrl: me.avatar_url };
    writeVault(vault);
  } catch (_) { /* keep what we have */ }
}

/** POST JSON to https://github.com<path> (the OAuth endpoints live on the web
 *  host, not api.github.com) and parse the JSON reply. */
function oauthPostJson(pathname, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'github.com', path: pathname, method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'aurora-ide',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`OAuth ${res.statusCode}: ${body.slice(0, 160)}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GitHub OAuth Device Flow: request a device/user code, show it to the user (the
 * renderer displays it + we open the verification page), then poll until they
 * authorize. On success we store the access token exactly like the PAT path, so
 * the rest of git.js is unchanged. `sender` is the webContents for the live code.
 */
async function deviceFlowLogin(sender) {
  if (!OAUTH_CLIENT_ID) throw new Error('OAuth is not configured (missing Client ID).');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS keychain encryption is not available on this system.');
  const start = await oauthPostJson('/login/device/code', { client_id: OAUTH_CLIENT_ID, scope: OAUTH_SCOPE });
  if (!start || !start.device_code) throw new Error((start && start.error_description) || 'Failed to start device flow.');
  try {
    sender && sender.send('github:oauth-code', {
      userCode: start.user_code,
      verificationUri: start.verification_uri,
      expiresIn: start.expires_in,
    });
  } catch (_) { /* window gone */ }
  try { await shell.openExternal(start.verification_uri); } catch (_) { /* user can open it manually */ }

  let intervalMs = intervaloInicialMs(start);
  const deadline = Date.now() + ((start.expires_in || 900) * 1000);
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const tok = await oauthPostJson('/login/oauth/access_token', {
      client_id: OAUTH_CLIENT_ID,
      device_code: start.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    // A decisao (o que a resposta significa) esta em github_api.js, com teste.
    const passo = decidirPolling(tok);
    if (passo.acao === 'esperar') continue;
    if (passo.acao === 'desacelerar') { intervalMs += passo.acrescimoMs; continue; }
    if (passo.acao === 'falhar') throw new Error(passo.mensagem);

    const me = await apiGet('/user', passo.token);
    const avatarDataUrl = me.avatar_url ? await fetchDataUrl(me.avatar_url) : null;
    const user = { login: me.login, name: me.name || me.login, avatarDataUrl, avatarUrl: me.avatar_url };
    writeVault({ token: safeStorage.encryptString(passo.token).toString('base64'), user });
    return user;
  }
  throw new Error('Timed out waiting for authorization.');
}

function register() {
  ipcMain.handle('github:oauth-configured', () => ({ configured: !!OAUTH_CLIENT_ID }));
  ipcMain.handle('github:oauth-login', async (event) => {
    try {
      const user = await deviceFlowLogin(event.sender);
      // The user just authorized in the BROWSER — pull Aurora back to the front
      // so they don't have to alt-tab. The alwaysOnTop toggle forces Windows to
      // raise the window even when it would otherwise deny a focus-steal.
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.setAlwaysOnTop(true);
          win.focus();
          win.setAlwaysOnTop(false);
          // Fallback if the OS denies the focus-steal: flash the taskbar button so
          // the user notices Aurora is ready.
          try { win.flashFrame(true); setTimeout(() => { try { win.flashFrame(false); } catch (_) { /* gone */ } }, 2500); } catch (_) { /* optional */ }
        }
      } catch (_) { /* best-effort */ }
      return { ok: true, user };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  ipcMain.handle('github:status', async () => {
    await ensureUserAvatar();
    const user = getUser();
    return { connected: !!user, user };
  });
  ipcMain.handle('github:connect', async (_event, token) => {
    try {
      const user = await connect(token);
      return { ok: true, user };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('github:disconnect', () => {
    disconnect();
    return { ok: true };
  });
  ipcMain.handle('github:create-repo', async (_event, opts) => {
    try {
      const r = await createRepo(opts && opts.name, opts && opts.private);
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('github:list-repos', async () => {
    try {
      return { ok: true, repos: await listRepos() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  log.info('[ipc.github_auth] handlers registered');
}

module.exports = { register, getToken, getUser, connect, disconnect, createRepo, listRepos };
