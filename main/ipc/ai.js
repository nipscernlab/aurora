// @ts-check
/**
 * IPC handlers for Aurora Intelligence.
 *
 * Surface (sub-step 4a — key management + connectivity check):
 *
 *     ai:list-providers       → { providers: [{ name, defaultModel }] }
 *     ai:get-key-status       → { configured: { openai: bool, ... } }
 *     ai:set-key              ({ provider, apiKey })   → { ok }
 *     ai:clear-key            ({ provider })           → { ok, removed }
 *     ai:test-connection      ({ provider, modelId? }) → testConnection result
 *
 * The chat / tool-call streaming channels (`ai:chat-start`,
 * `ai:chat-stream`, `ai:chat-abort`) land in sub-step 4b once the
 * provider plumbing has been proven end-to-end.
 *
 * Plaintext API keys never cross the IPC boundary on the way out — the
 * renderer can ask whether a key is configured but never read its
 * bytes. That's enforced by simply not exposing a `getKey` channel.
 */

'use strict';

const { ipcMain } = require('electron');
const log = require('electron-log');

const keystore = require('../ai/keystore');
const provider = require('../ai/provider');
const chat = require('../ai/chat');

function ok(data) {
  return { ok: true, ...(data || {}) };
}
function fail(message) {
  return { ok: false, error: String(message || 'Unknown error') };
}

function register() {
  ipcMain.handle('ai:list-providers', () => ({
    providers: keystore.SUPPORTED_PROVIDERS.map((name) => ({
      name,
      defaultModel: provider.getDefaultModel(name),
    })),
  }));

  // Booleans only — the renderer doesn't get to learn which keys
  // actually decrypt cleanly, only that *something* is stored.
  ipcMain.handle('ai:get-key-status', () => {
    const configured = {};
    for (const name of keystore.SUPPORTED_PROVIDERS) {
      configured[name] = keystore.hasKey(name);
    }
    return { configured };
  });

  ipcMain.handle('ai:set-key', (_event, payload) => {
    const { provider: name, apiKey } = payload || {};
    try {
      keystore.setKey(name, apiKey);
      log.info(`[ai] stored key for provider: ${name}`);
      return ok();
    } catch (e) {
      return fail(e?.message);
    }
  });

  ipcMain.handle('ai:clear-key', (_event, payload) => {
    const { provider: name } = payload || {};
    try {
      const removed = keystore.clearKey(name);
      if (removed) log.info(`[ai] cleared key for provider: ${name}`);
      return ok({ removed });
    } catch (e) {
      return fail(e?.message);
    }
  });

  // testConnection already returns `{ ok, ... }` shaped data, so we
  // pass it through verbatim.
  ipcMain.handle('ai:test-connection', async (_event, payload) => {
    const { provider: name, modelId } = payload || {};
    try {
      return await provider.testConnection(name, modelId);
    } catch (e) {
      return fail(e?.message);
    }
  });

  // Fire-and-forget: the actual streaming runs detached and pushes
  // ai:chat-event messages back. We return as soon as the session is
  // registered so the renderer doesn't sit on an open invoke promise.
  ipcMain.handle('ai:chat-start', (event, payload) => {
    try {
      chat.start(payload, event.sender).catch((e) => {
        log.warn('[ai] chat start crashed:', e?.message || e);
      });
      return ok({ sessionId: payload?.sessionId });
    } catch (e) {
      return fail(e?.message);
    }
  });

  ipcMain.handle('ai:chat-abort', (_event, payload) => {
    const stopped = chat.abort(payload?.sessionId);
    return ok({ stopped });
  });
}

module.exports = { register };
