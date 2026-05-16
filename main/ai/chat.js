// @ts-check
/**
 * chat.js — streaming chat + tool loop for Aurora Intelligence.
 *
 * One concurrent stream per session, identified by a renderer-generated
 * `sessionId`. The renderer subscribes to `ai:chat-event` (multicast),
 * filters by sessionId, and assembles the streamed text into the
 * assistant bubble.
 *
 * Tools (sub-step 4c): the model can call the curated `AuroraAPI`
 * surface defined in `tools.js`. Each call round-trips to the renderer
 * via `tool_bridge` (which also runs the ask-before-write
 * confirmation) and is recorded in the `audit` log. We consume
 * `fullStream` rather than `textStream` so tool-call / tool-result
 * parts surface to the panel as activity chips.
 *
 * Event lifecycle (always one `aborted | finish | error` to close):
 *
 *   { type:'text-delta',  delta }
 *   { type:'tool-call',   toolName, args }
 *   { type:'tool-result', toolName, result }
 *   { type:'finish',      text, usage }
 *   { type:'aborted',     text }
 *   { type:'error',       message }
 */

'use strict';

const { streamText, stepCountIs } = require('ai');
const log = require('electron-log');

const provider = require('./provider');
const tools = require('./tools');
const toolBridge = require('./tool_bridge');
const audit = require('./audit');

/** sessionId → { abort: AbortController } */
const sessions = new Map();

// Upper bound on tool round-trips per turn — keeps a runaway model
// from looping forever. Each "step" is one model generation; a step
// that calls tools is followed by another step to use the results.
const MAX_STEPS = 12;

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
 * finishes, errors, or is aborted — the IPC handler does not await
 * this, so callers fire-and-forget.
 *
 * @param {object} payload
 * @param {string} payload.sessionId
 * @param {string} payload.provider
 * @param {string} [payload.modelId]
 * @param {{role:string, content:string}[]} payload.messages
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
    const modelKey = modelId || provider.getModelFor(providerName);
    if (!modelKey) throw new Error(`no model configured for "${providerName}"`);
    const model = prov(modelKey);

    // Each tool call ships to the renderer (ask-before-write happens
    // there) and is bracketed by audit entries.
    const aiTools = tools.buildTools(async (toolName, args) => {
      audit.append({ sessionId, kind: 'tool-call', tool: toolName, args });
      const result = await toolBridge.runTool(webContents, toolName, args);
      audit.append({
        sessionId,
        kind: 'tool-result',
        tool: toolName,
        ok: !(result && result.ok === false),
        error: result && result.ok === false ? result.error : undefined,
      });
      return result;
    });

    const result = streamText({
      model,
      messages,
      ...(system ? { system } : {}),
      tools: aiTools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal: abort.signal,
    });

    let fullText = '';
    for await (const part of result.fullStream) {
      if (abort.signal.aborted) break;
      switch (part.type) {
        case 'text-delta': {
          const delta = part.text ?? part.textDelta ?? '';
          fullText += delta;
          sendEvent(webContents, sessionId, 'text-delta', { delta });
          break;
        }
        case 'tool-call':
          sendEvent(webContents, sessionId, 'tool-call', {
            toolName: part.toolName,
            args: part.input ?? part.args ?? {},
          });
          break;
        case 'tool-result':
          sendEvent(webContents, sessionId, 'tool-result', {
            toolName: part.toolName,
            result: part.output ?? part.result ?? null,
          });
          break;
        case 'error':
          throw part.error || new Error('stream error');
        default:
          // step-start, step-finish, finish, reasoning, ... — ignored.
          break;
      }
    }

    if (abort.signal.aborted) {
      sendEvent(webContents, sessionId, 'aborted', { text: fullText });
      return;
    }

    // `totalUsage` sums every step (tool turns included); fall back to
    // the last-step `usage` if a provider doesn't surface the total.
    let usage = null;
    try { usage = await result.totalUsage; }
    catch (_) {
      try { usage = await result.usage; }
      catch (_2) { /* usage is best-effort */ }
    }

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
