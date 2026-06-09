// @ts-check
/**
 * keystore.js — encrypted vault for per-provider API keys.
 *
 * Keys are encrypted with Electron's `safeStorage`, which delegates to
 * the OS keychain (DPAPI on Windows, Keychain on macOS, libsecret on
 * Linux). Plaintext never lives on disk and never crosses the IPC
 * boundary — the renderer can only ask "is a key set for provider X?"
 * and "test that key against the provider"; reading the bytes is a
 * main-process-only operation.
 *
 * Layout of the on-disk vault (`userData/aurora-ai-keys.json`):
 *
 *     {
 *       "openai":    "<base64 ciphertext>",
 *       "anthropic": "<base64 ciphertext>",
 *       ...
 *     }
 *
 * A fresh install just doesn't have the file. If `safeStorage` reports
 * encryption is unavailable (rare — typically a misconfigured Linux
 * session without a working keyring), `setKey()` throws so the caller
 * can surface a useful error to the user instead of writing plaintext.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const log = require('electron-log');

const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'groq', 'ollama'];

function vaultPath() {
  return path.join(app.getPath('userData'), 'aurora-ai-keys.json');
}

function readVault() {
  try {
    const raw = fs.readFileSync(vaultPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    if (err && err.code !== 'ENOENT') log.warn('keystore: read failed:', e);
    return {};
  }
}

function writeVault(/** @type {Record<string, string>} */ vault) {
  try {
    fs.mkdirSync(path.dirname(vaultPath()), { recursive: true });
    fs.writeFileSync(vaultPath(), JSON.stringify(vault, null, 2));
  } catch (e) {
    log.error('keystore: write failed:', e);
    throw e;
  }
}

function assertSupported(/** @type {string} */ provider) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
}

function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain encryption is not available on this system');
  }
}

/**
 * Persist `apiKey` for `provider`, encrypted via OS keychain. Throws
 * if the platform doesn't support `safeStorage` (we refuse to write
 * plaintext silently).
 * @param {string} provider
 * @param {string} apiKey
 */
function setKey(provider, apiKey) {
  assertSupported(provider);
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('apiKey must be a non-empty string');
  }
  assertEncryptionAvailable();
  const vault = readVault();
  const ciphertext = safeStorage.encryptString(apiKey).toString('base64');
  vault[provider] = ciphertext;
  writeVault(vault);
}

/**
 * Decrypt and return the API key for `provider`, or `null` if no key
 * is stored. Returns `null` (not throws) on decryption failure — a
 * mis-keychained vault is something the caller wants to surface to
 * the user, not crash on.
 * @param {string} provider
 */
function getKey(provider) {
  assertSupported(provider);
  const vault = readVault();
  const ciphertext = vault[provider];
  if (!ciphertext) return null;
  try {
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
  } catch (e) {
    log.warn(`keystore: decrypt failed for ${provider}:`, e);
    return null;
  }
}

/** Cheap presence check that never touches the keychain. */
function hasKey(/** @type {string} */ provider) {
  assertSupported(provider);
  return Object.prototype.hasOwnProperty.call(readVault(), provider);
}

function clearKey(/** @type {string} */ provider) {
  assertSupported(provider);
  const vault = readVault();
  if (!(provider in vault)) return false;
  delete vault[provider];
  writeVault(vault);
  return true;
}

/** Providers that currently have a key stored. Order is stable (read order). */
function listConfiguredProviders() {
  return Object.keys(readVault()).filter((p) => SUPPORTED_PROVIDERS.includes(p));
}

module.exports = {
  SUPPORTED_PROVIDERS,
  setKey,
  getKey,
  hasKey,
  clearKey,
  listConfiguredProviders,
};
