// @ts-check
/**
 * chat.js — streaming chat loop for Aurora Intelligence.
 *
 * One concurrent stream per session, identified by a renderer-generated
 * `sessionId`. The renderer subscribes to `ai:chat-event` (multicast),
 * filters by sessionId, and assembles the streamed text into the
 * assistant bubble.
 *
 * Event lifecycle (always one `aborted | finish | error` to close):
 *
 *   { sessionId, type:'text-delta', delta }   // 1..N chunks
 *   { sessionId, type:'finish',     text, usage }
 *   { sessionId, type:'aborted',    text }    // user stopped mid-stream
 *   { sessionId, type:'error',      message } // SDK or network error
 *
 * The IPC `ai:chat-start` handler returns *immediately* with the
 * sessionId — the actual streaming work runs detached so the renderer
 * doesn't sit on an open invoke promise for the whole turn.
 */

'use strict';

const { streamText } = require('ai');
const log = require('electron-log');
const provider = require('./provider');

/** sessionId → { abort: AbortController } */
const sessions = new Map();

function sendEvent(webContents, sessionId, type, data) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    webContents.send('ai:chat-event', { sessionId, type, ...(data || {}) });
  } catch (e) {
    log.warn('[ai.chat] send failed:', e?.message || e);
  }
}

/**
 * Start a streaming chat for `payload`. Resolves once the stream
 * either finishes, errors, or is aborted — the IPC handler does not
 * await this, so callers can fire-and-forget.
 *
 * @param {object} payload
 * @param {string} payload.sessionId
 * @param {string} payload.provider
 * @param {string} [payload.modelId]
 * @param {{role:'user'|'assistant'|'system', content:string}[]} payload.messages
 * @param {string} [payload.system]
 * @param {Electron.WebContents} webContents
 */
async function start(payload, webContents) {
  const {
    sessionId,
    provider: providerName,
    modelId,
    messages,
    system,
  } = payload || {};

  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('sessionId is required');
  }
  if (sessions.has(sessionId)) {
    throw new Error(`session already active: ${sessionId}`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  const abort = new AbortController();
  sessions.set(sessionId, { abort });

  try {
    const prov = provider.getProvider(providerName);
    const modelKey = modelId || provider.getDefaultModel(providerName);
    if (!modelKey) throw new Error(`no default model for "${providerName}"`);
    const model = prov(modelKey);

    const result = streamText({
      model,
      messages,
      ...(system ? { system } : {}),
      abortSignal: abort.signal,
    });

    let fullText = '';
    for await (const delta of result.textStream) {
      if (abort.signal.aborted) break;
      fullText += delta;
      sendEvent(webContents, sessionId, 'text-delta', { delta });
    }

    if (abort.signal.aborted) {
      sendEvent(webContents, sessionId, 'aborted', { text: fullText });
      return;
    }

    // `usage` resolves once the stream is fully consumed. Some providers
    // surface null fields here (e.g. cached tokens) — pass through as-is.
    let usage = null;
    try { usage = await result.usage; }
    catch (_) { /* usage is best-effort */ }

    sendEvent(webContents, sessionId, 'finish', { text: fullText, usage });
  } catch (e) {
    if (abort.signal.aborted || e?.name === 'AbortError') {
      sendEvent(webContents, sessionId, 'aborted', { text: '' });
    } else {
      const message = e?.message || String(e);
      log.warn(`[ai.chat] session ${sessionId} failed: ${message}`);
      sendEvent(webContents, sessionId, 'error', { message });
    }
  } finally {
    sessions.delete(sessionId);
  }
}

/** Abort an in-flight session. Returns `true` if a session was stopped. */
function abort(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return false;
  s.abort.abort();
  return true;
}

module.exports = { start, abort };
