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
 * Defaults
 * --------
 * `DEFAULT_MODELS` picks the smallest tool-capable model per provider.
 * The user will override these from the settings UI later, but for the
 * "Test connection" flow we always want the cheapest possible call.
 *
 *   - openai     → gpt-4o-mini      (cheap, fast, tools)
 *   - anthropic  → claude-haiku-4-5 (cheap, fast, tools)
 *   - google     → gemini-2.0-flash (cheap, fast, tools)
 *   - deepseek   → deepseek-chat    (only generally-available model)
 */

'use strict';

const log = require('electron-log');
const { generateText } = require('ai');
const { createOpenAI }            = require('@ai-sdk/openai');
const { createAnthropic }         = require('@ai-sdk/anthropic');
const { createGoogleGenerativeAI }= require('@ai-sdk/google');
const { createDeepSeek }          = require('@ai-sdk/deepseek');

const keystore = require('./keystore');

const DEFAULT_MODELS = Object.freeze({
  openai:    'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  google:    'gemini-2.0-flash',
  deepseek:  'deepseek-chat',
});

const PROVIDER_FACTORIES = Object.freeze({
  openai:    createOpenAI,
  anthropic: createAnthropic,
  google:    createGoogleGenerativeAI,
  deepseek:  createDeepSeek,
});

/**
 * Build a provider instance bound to the user's stored API key.
 * Throws when no key is configured for that provider so the caller
 * doesn't have to second-guess.
 *
 * @param {keyof typeof PROVIDER_FACTORIES} name
 */
function getProvider(name) {
  const factory = PROVIDER_FACTORIES[name];
  if (!factory) throw new Error(`Unknown provider: ${name}`);
  const apiKey = keystore.getKey(name);
  if (!apiKey) throw new Error(`No API key configured for "${name}"`);
  return factory({ apiKey });
}

/** Returns the default model ID for `provider`, or `null` if unknown. */
function getDefaultModel(provider) {
  return DEFAULT_MODELS[provider] || null;
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
  const model = modelId || DEFAULT_MODELS[providerName];
  if (!model) {
    return { ok: false, error: `No default model for "${providerName}"` };
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
  testConnection,
};
