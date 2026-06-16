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
  const user = { login: me.login, name: me.name || me.login, avatarUrl: me.avatar_url };
  writeVault({
    token: safeStorage.encryptString(token.trim()).toString('base64'),
    user,
  });
  return user;
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

function register() {
  ipcMain.handle('github:status', () => ({ connected: !!getUser(), user: getUser() }));
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
  log.info('[ipc.github_auth] handlers registered');
}

module.exports = { register, getToken, getUser, connect, disconnect };
