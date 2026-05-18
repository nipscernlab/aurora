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

const log = require('electron-log');

// `ai` is loaded defensively so a broken install (missing transitive dep
// like `zod/v4`) disables AI features rather than crashing the main process.
let streamText, generateText, stepCountIs;
try {
  ({ streamText, generateText, stepCountIs } = require('ai'));
} catch (err) {
  log.warn(`[ai.chat] Failed to load "ai" SDK (${err?.code || err?.message}). Chat features will be unavailable.`);
}

const provider = require('./provider');
const tools = require('./tools');
const toolBridge = require('./tool_bridge');
const audit = require('./audit');

/** sessionId → { abort: AbortController } */
const sessions = new Map();

// Upper bound on tool round-trips per turn — keeps a runaway model
// from looping forever. Each "step" is one model generation; a step
// that calls tools is followed by another step to use the results.
const MAX_STEPS = 24;

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
  if (!streamText) {
    throw new Error('AI SDK ("ai" package) failed to load. Reinstall the app or run `npm install` if running from source.');
  }
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

    // Remove tool-call artefacts that some models (Llama, Qwen) emit as plain
    // text alongside (or instead of) proper function-calling API responses.
    // Patterns handled:
    //   1. <tool_call>…</tool_call> (standard XML format)
    //   2. {"name":"…","arguments":{…}} </tool_call>  (Qwen inline format,
    //      optionally preceded by a CJK prefix character like 岊)
    //   3. Orphan </tool_call> closing tags
    const TOOL_XML_RE  = /<(?:tool_call|function_calls|invoke)(?:\s[^>]*)?>[\s\S]*?<\/(?:tool_call|function_calls|invoke)>/g;
    const TOOL_JSON_RE = /[⺀-鿿]*\s*\{"name"\s*:\s*"[a-z_][a-z_0-9]*"\s*,\s*"arguments"\s*:[\s\S]*?\}\s*\}\s*(?:<\/tool_call>)?/g;
    const stripToolXml = (t) => t
      .replace(TOOL_XML_RE, '')
      .replace(TOOL_JSON_RE, '')
      .replace(/<\/tool_call>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Extract complete tool-call JSON objects from a text string — used as a
    // fallback for models that output {"name":"…","arguments":{…}} as plain
    // text instead of via the OpenAI tool_calls API field.
    // Handles empty args `{}` as well as single-level nested objects.
    function extractTextToolCalls(text, knownTools) {
      const calls = [];
      const re = /[⺀-鿿]*\s*\{"name"\s*:\s*"([a-z_][a-z_0-9]*)"\s*,\s*"arguments"\s*:\s*(\{(?:[^{}]|\{[^{}]*\})*\})\s*\}/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const name = m[1];
        if (!knownTools[name]) continue;
        try { calls.push({ name, args: JSON.parse(m[2]) }); } catch (_) { /* malformed args */ }
      }
      return calls;
    }

    let fullText = '';
    let earlyExit = false;
    let nativeToolCallCount = 0;
    for await (const part of result.fullStream) {
      if (abort.signal.aborted || earlyExit) break;
      switch (part.type) {
        case 'text-delta': {
          const delta = part.text ?? part.textDelta ?? '';
          fullText += delta;
          sendEvent(webContents, sessionId, 'text-delta', { delta });
          break;
        }
        case 'tool-call':
          nativeToolCallCount++;
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
        case 'error': {
          const errMsg = part.error?.message || String(part.error ?? '');
          // Vercel AI SDK / Anthropic prompt-caching compat bug: after a tool
          // result, the SDK sometimes encodes it as an "item_reference" type
          // that the Anthropic API does not understand. Treat it as a graceful
          // finish with whatever text has already been generated.
          if (errMsg.includes('unknown input item type') || errMsg.includes('item_reference')) {
            log.warn(`[ai.chat] Anthropic item_reference compat error — finishing early: ${errMsg}`);
            earlyExit = true;
            break;
          }
          throw part.error || new Error('stream error');
        }
        default:
          // step-start, step-finish, finish, reasoning, ... — ignored.
          break;
      }
    }

    if (abort.signal.aborted) {
      sendEvent(webContents, sessionId, 'aborted', { text: stripToolXml(fullText) });
      return;
    }

    if (earlyExit) {
      const text = stripToolXml(fullText);
      if (text) {
        sendEvent(webContents, sessionId, 'finish', { text, usage: null });
      } else {
        // Tool ran but response generation failed (SDK/provider compat issue).
        // Re-send a one-step request without tools so the model can still
        // summarise what it found.
        try {
          const fallback = await generateText({
            model,
            messages: [...messages, { role: 'assistant', content: '(tool executed, now summarise the results in plain text)' }],
            ...(system ? { system } : {}),
            abortSignal: abort.signal,
          });
          const fb = (fallback.text || '').trim();
          sendEvent(webContents, sessionId, 'finish', { text: fb || '(no response)', usage: fallback.usage || null });
        } catch (_) {
          sendEvent(webContents, sessionId, 'error', { message: 'Tool ran but response generation failed. Please try again.' });
        }
      }
      return;
    }

    // ── Text-based tool call fallback ─────────────────────────────────────
    // Some Ollama-hosted models output tool calls as JSON text in the message
    // content instead of using the OpenAI `tool_calls` API field. When that
    // happens, nativeToolCallCount stays 0 and the tools are never executed.
    // We detect the JSON in fullText, execute the tools via the bridge, inject
    // the results into a follow-up generateText call, and stream its reply as
    // additional text-delta events — all before sending the finish event.
    if (!abort.signal.aborted && nativeToolCallCount === 0) {
      const textCalls = extractTextToolCalls(fullText, aiTools);
      if (textCalls.length > 0) {
        const toolResultMsgs = [];
        for (const call of textCalls) {
          audit.append({ sessionId, kind: 'tool-call', tool: call.name, args: call.args });
          sendEvent(webContents, sessionId, 'tool-call', { toolName: call.name, args: call.args });
          let res;
          try {
            res = await toolBridge.runTool(webContents, call.name, call.args);
          } catch (e) {
            res = { ok: false, error: e?.message || String(e) };
          }
          audit.append({
            sessionId, kind: 'tool-result', tool: call.name,
            ok: !(res && res.ok === false),
            error: res?.ok === false ? res.error : undefined,
          });
          sendEvent(webContents, sessionId, 'tool-result', { toolName: call.name, result: res });
          toolResultMsgs.push({
            role: 'user',
            content: `[Tool result for "${call.name}"]: ${JSON.stringify(res)}`,
          });
        }

        if (toolResultMsgs.length > 0 && !abort.signal.aborted) {
          try {
            const follow = await generateText({
              model,
              messages: [
                ...messages,
                { role: 'assistant', content: stripToolXml(fullText) },
                ...toolResultMsgs,
              ],
              ...(system ? { system } : {}),
              abortSignal: abort.signal,
            });
            const extra = (follow.text || '').trim();
            if (extra) {
              // Prepend a blank line so the follow-up reads as a new paragraph.
              sendEvent(webContents, sessionId, 'text-delta', { delta: '\n\n' + extra });
              fullText += '\n\n' + extra;
            }
          } catch (e) {
            log.warn(`[ai.chat] text-tool follow-up failed: ${e?.message}`);
          }
        }
      }
    }

    // `totalUsage` sums every step (tool turns included); fall back to
    // the last-step `usage` if a provider doesn't surface the total.
    let usage = null;
    try { usage = await result.totalUsage; }
    catch (_) {
      try { usage = await result.usage; }
      catch (_2) { /* usage is best-effort */ }
    }

    sendEvent(webContents, sessionId, 'finish', { text: stripToolXml(fullText), usage });
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
