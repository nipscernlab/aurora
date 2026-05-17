// @ts-check
/**
 * provider.js — Vercel AI SDK plumbing for Aurora Intelligence.
 *
 * Builds a Vercel AI SDK provider instance keyed on the user's stored
 * API key (via `keystore`), and exposes a thin `testConnection()`
 * helper used by the settings panel's "Test" button.
 *
 * The full chat / tool-call loop lives in a sibling module
 * (`chat.js`, landing in sub-step 4b/4c). This file only owns the
 * provider plumbing so the keystore + IPC layer can ship first and
 * the user can verify their key from devtools before the UI exists.
 *
 * Models
 * ------
 * `DEFAULT_MODELS` is the fallback per provider — the smallest
 * tool-capable model that is reliably on the free/cheap tier. The user
 * can override it per provider in Settings → AI Assistant; that
 * override lives in `prefs` and `getModelFor()` resolves it.
 *
 *   - openai     → gpt-4o-mini    (cheap, fast, tools)
 *   - anthropic  → claude-haiku-4-5
 *   - google     → gemini-2.5-flash  (gemini-2.0-flash is NOT on the
 *                  free tier — it returns HTTP 429 limit:0)
 *   - deepseek   → deepseek-chat
 */

'use strict';

const log = require('electron-log');

// All AI SDK packages — including the base `ai` package — are loaded via
// tryRequire so any module-level failure (missing package, mismatched
// transitive dep like `zod/v4`, ESM/CJS interop bug) disables AI features
// instead of crashing the main process during boot.
function tryRequire(pkg, exportName) {
  try {
    const mod = require(pkg);
    return exportName ? mod[exportName] : mod;
  } catch (err) {
    log.warn(`[ai.provider] Failed to load "${pkg}" (${err?.code || err?.message}). AI features depending on this package will be disabled.`);
    return null;
  }
}

const aiSdk        = tryRequire('ai');
const generateText = aiSdk ? aiSdk.generateText : null;

const createOpenAI             = tryRequire('@ai-sdk/openai',    'createOpenAI');
const createAnthropic          = tryRequire('@ai-sdk/anthropic', 'createAnthropic');
const createGoogleGenerativeAI = tryRequire('@ai-sdk/google',    'createGoogleGenerativeAI');
const createDeepSeek           = tryRequire('@ai-sdk/deepseek',  'createDeepSeek');
const createGroq               = tryRequire('@ai-sdk/groq',      'createGroq');

const keystore = require('./keystore');
const prefs = require('./prefs');

const DEFAULT_MODELS = Object.freeze({
  openai:    'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  google:    'gemini-2.5-flash',
  deepseek:  'deepseek-chat',
  groq:      'llama-3.3-70b-versatile',
  ollama:    'llama3.1:8b',
});

// Only include providers whose SDK package was successfully loaded.
const PROVIDER_FACTORIES = Object.freeze(
  Object.fromEntries(
    [
      ['openai',    createOpenAI],
      ['anthropic', createAnthropic],
      ['google',    createGoogleGenerativeAI],
      ['deepseek',  createDeepSeek],
      ['groq',      createGroq],
    ].filter(([, fn]) => fn != null),
  ),
);

const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';

/**
 * Build a provider instance bound to the user's stored API key.
 * Throws when no key is configured for that provider so the caller
 * doesn't have to second-guess.
 *
 * For Ollama the stored "key" is the base URL; if not set the default
 * local URL is used so Ollama works without any configuration.
 *
 * @param {string} name
 */
function getProvider(name) {
  if (name === 'ollama') {
    const baseURL = keystore.getKey('ollama') || OLLAMA_DEFAULT_BASE_URL;
    const ollamaFactory = createOpenAI({ baseURL, apiKey: 'ollama', compatibility: 'compatible' });
    // @ai-sdk/openai v2+ defaults to /v1/responses; Ollama only has /v1/chat/completions.
    // Wrap the factory so every prov(modelId) call goes to the chat completions endpoint.
    return (modelId) => ollamaFactory.chat(modelId);
  }
  const factory = PROVIDER_FACTORIES[name];
  if (!factory) throw new Error(`Unknown provider: ${name}`);
  const apiKey = keystore.getKey(name);
  if (!apiKey) throw new Error(`No API key configured for "${name}"`);
  return factory({ apiKey });
}

/** The hard-coded fallback model for `provider`, or `null` if unknown. */
function getDefaultModel(provider) {
  return DEFAULT_MODELS[provider] || null;
}

/** The model to actually use: the user's override, else the default. */
function getModelFor(provider) {
  return prefs.getModel(provider) || DEFAULT_MODELS[provider] || null;
}

/**
 * Make a minimal generateText call to verify the configured key works.
 * Designed to be cheap — small prompt, capped output — so a user can
 * click "Test connection" without worrying about token spend.
 *
 * Returns a structured result instead of throwing so the IPC handler
 * can hand it back to the renderer as-is.
 *
 * @param {keyof typeof PROVIDER_FACTORIES} providerName
 * @param {string} [modelId]
 */
async function testConnection(providerName, modelId) {
  if (!generateText) {
    return { ok: false, error: 'AI SDK ("ai" package) failed to load. Reinstall the app or run `npm install` if running from source.' };
  }
  const model = modelId || getModelFor(providerName);
  if (!model) {
    return { ok: false, error: `No model configured for "${providerName}"` };
  }
  try {
    const provider = getProvider(providerName);
    const started = Date.now();
    const result = await generateText({
      model: provider(model),
      prompt: 'Reply with the single word: pong.',
    });
    return {
      ok: true,
      provider: providerName,
      model,
      sample: (result.text || '').trim().slice(0, 80),
      latencyMs: Date.now() - started,
      usage: result.usage || null,
    };
  } catch (e) {
    const message = e?.message || String(e);
    log.warn(`[ai.provider] testConnection ${providerName} failed: ${message}`);
    return { ok: false, provider: providerName, model, error: message };
  }
}

module.exports = {
  DEFAULT_MODELS,
  getProvider,
  getDefaultModel,
  getModelFor,
  testConnection,
};
