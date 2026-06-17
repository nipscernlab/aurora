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
const { app, safeStorage, ipcMain } = require('electron');
const log = require('electron-log');

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
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('Nome de repositório inválido.');
  try {
    const repo = await apiPost('/user/repos', token, { name, private: !!isPrivate, auto_init: false });
    return { fullName: repo.full_name, cloneUrl: repo.clone_url, htmlUrl: repo.html_url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Fine-grained tokens (and classic ones without `repo`) can't create repos.
    if (/not accessible|forbidden|403/i.test(msg)) {
      throw new Error('O token não pode criar repositórios. Use um token CLÁSSICO com o escopo "repo" — github.com/settings/tokens/new');
    }
    if (/already exists|name already/i.test(msg)) {
      throw new Error(`Já existe um repositório "${name}" na sua conta.`);
    }
    throw new Error(msg);
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

/** List the connected account's repositories (owner affiliation). */
async function listRepos() {
  const token = getToken();
  if (!token) throw new Error('Conecte sua conta GitHub primeiro.');
  const repos = await apiGet('/user/repos?per_page=100&sort=updated&affiliation=owner', token);
  return repos.map((r) => ({
    name: r.name,
    fullName: r.full_name,
    cloneUrl: r.clone_url,
    private: r.private,
    description: r.description || '',
    updatedAt: r.updated_at,
  }));
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

function register() {
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
