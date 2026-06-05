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
const prefs = require('../ai/prefs');
const chat = require('../ai/chat');
const claudeCode = require('../ai/claude_code');
const codexCli = require('../ai/codex_cli');
const tools = require('../ai/tools');
const toolBridge = require('../ai/tool_bridge');
const conversations = require('../ai/conversations');
const audit = require('../ai/audit');

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
      // `model` is what a chat would actually use — the user's override
      // if set, otherwise the default. The settings card shows this.
      model: provider.getModelFor(name),
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

  // Persist (or, with an empty value, clear) the model override for a
  // provider. Returns the effective model so the renderer can re-sync.
  ipcMain.handle('ai:set-model', (_event, payload) => {
    const { provider: name, model } = payload || {};
    try {
      prefs.setModel(name, model);
      return ok({ model: provider.getModelFor(name) });
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

  // One-shot generation (prompt -> text, no tools/streaming). Used by the AI
  // harness generator. claude-code routes to the subscription CLI (print mode);
  // everything else goes through the Vercel-SDK API providers. (chatgpt/codex
  // one-shot isn't wired yet — provider.generateOneshot returns a clear error.)
  ipcMain.handle('ai:generate-oneshot', async (_event, payload) => {
    try {
      if (payload?.provider === 'claude-code') {
        return await claudeCode.generateOneshot(payload || {});
      }
      return await provider.generateOneshot(payload || {});
    } catch (e) {
      return fail(e?.message);
    }
  });

  /* ---- Claude Code (subscription) bridge ----
   * Probe the local `claude` CLI install + subscription login, and
   * surface live rate-limit / token usage for the panel's usage bars.
   */
  ipcMain.handle('ai:claude-code-status', async () => {
    try { return ok({ status: await claudeCode.detect() }); }
    catch (e) { return fail(e?.message); }
  });

  ipcMain.handle('ai:claude-code-usage', () => {
    try { return ok({ usage: claudeCode.getUsage() }); }
    catch (e) { return fail(e?.message); }
  });

  /* ---- Codex / ChatGPT (subscription) bridge ----
   * Probe the local `codex` CLI install + ChatGPT login, and surface
   * accumulated token usage for the panel's usage bars.
   */
  ipcMain.handle('ai:codex-status', async () => {
    try { return ok({ status: await codexCli.detect() }); }
    catch (e) { return fail(e?.message); }
  });

  ipcMain.handle('ai:codex-usage', () => {
    try { return ok({ usage: codexCli.getUsage() }); }
    catch (e) { return fail(e?.message); }
  });

  // Fire-and-forget: the actual streaming runs detached and pushes
  // ai:chat-event messages back. We return as soon as the session is
  // registered so the renderer doesn't sit on an open invoke promise.
  // The `claude-code` and `chatgpt` providers route to their CLI
  // bridges; everything else goes through the Vercel-AI-SDK chat loop.
  ipcMain.handle('ai:chat-start', (event, payload) => {
    try {
      let runner = chat;
      if (payload?.provider === 'claude-code') runner = claudeCode;
      else if (payload?.provider === 'chatgpt') runner = codexCli;
      runner.start(payload, event.sender).catch((e) => {
        log.warn('[ai] chat start crashed:', e?.message || e);
      });
      return ok({ sessionId: payload?.sessionId });
    } catch (e) {
      return fail(e?.message);
    }
  });

  // A turn lives in exactly one runner; aborting all three is harmless.
  ipcMain.handle('ai:chat-abort', (_event, payload) => {
    const stopped = chat.abort(payload?.sessionId) ||
                    claudeCode.abort(payload?.sessionId) ||
                    codexCli.abort(payload?.sessionId);
    return ok({ stopped });
  });

  // The renderer's tool_runner pulls this once at boot to learn which
  // tools exist and how to dispatch them against window.AuroraAPI.
  ipcMain.handle('ai:get-tool-manifest', () => ({ tools: tools.getManifest() }));

  // Renderer → main reply for a tool round-trip started by tool_bridge.
  // `.on` (not `.handle`) because it's a one-way completion signal.
  ipcMain.on('ai:tool-result', (_event, payload) => {
    if (payload && payload.requestId) {
      toolBridge.resolveToolResult(payload.requestId, payload.result);
    }
  });

  // Audit-log entry the renderer fires every time a CommandSpec runs
  // through spec_runner with an active override. Separate from the
  // tool-call audit (which records "the AI called set_command_override")
  // — this one records "an override actually fired on this step run".
  ipcMain.on('ai:audit-override-applied', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    audit.append({
      kind: 'compile-override-applied',
      step: payload.step,
      processorName: payload.processorName || null,
      sources: payload.sources || [],
      diff: payload.diff || null,
      note: payload.note || null,
    });
  });

  /* ---- conversation history ----
   * One JSON file per conversation under userData; the chat panel
   * lists/loads/saves through these channels.
   */
  ipcMain.handle('ai:conv-list', () => ({ chats: conversations.listAll() }));
  ipcMain.handle('ai:conv-read', (_e, payload) => conversations.read(payload?.id));
  ipcMain.handle('ai:conv-save', (_e, payload) => {
    try { return { ok: true, chat: conversations.save(payload) }; }
    catch (e) { return fail(e?.message); }
  });
  ipcMain.handle('ai:conv-delete', (_e, payload) => ({ ok: conversations.remove(payload?.id) }));
  ipcMain.handle('ai:conv-rename', (_e, payload) => {
    const chatRow = conversations.rename(payload?.id, payload?.title);
    return chatRow ? { ok: true, chat: chatRow } : fail('chat not found');
  });
  ipcMain.handle('ai:conv-new-id', () => ({ id: conversations.generateId() }));
}

module.exports = { register };
