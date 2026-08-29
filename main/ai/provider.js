// @ts-check
/**
 * provider.js: Vercel AI SDK plumbing for Aurora Intelligence.
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
 * `DEFAULT_MODELS` is the fallback per provider, the smallest
 * tool-capable model that is reliably on the free/cheap tier. The user
 * can override it per provider in Settings → AI Assistant; that
 * override lives in `prefs` and `getModelFor()` resolves it.
 *
 *   - openai     → gpt-4o-mini    (cheap, fast, tools)
 *   - anthropic  → claude-haiku-4-5
 *   - google     → gemini-2.5-flash  (gemini-2.0-flash is NOT on the
 *                  free tier, it returns HTTP 429 limit:0)
 *   - deepseek   → deepseek-chat
 */

'use strict';

const log = require('electron-log');

// All AI SDK packages, including the base `ai` package, are loaded via
// tryRequire so any module-level failure (missing package, mismatched
// transitive dep like `zod/v4`, ESM/CJS interop bug) disables AI features
// instead of crashing the main process during boot.
/** @param {string} pkg @param {string} [exportName] */
function tryRequire(pkg, exportName) {
  try {
    const mod = require(pkg);
    return exportName ? mod[exportName] : mod;
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    log.warn(`[ai.provider] Failed to load "${pkg}" (${e?.code || e?.message}). AI features depending on this package will be disabled.`);
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

// G6, model governance. Per-provider rename map: a retired/renamed model id →
// its current replacement, so an aged conversation or a stale prefs override
// keeps working instead of dead-ending at runtime. Seed as providers retire ids
// (an empty map per provider is fine, `resolveModelId` still handles the
// 'latest'/'default' aliases and the runtime fallback covers the rest).
const MODEL_MIGRATIONS = Object.freeze({
  openai:    {},
  // Aposentados na API de primeira parte (tabela de precos de 29/08/2026):
  // Opus 4 e 4.1 (que custavam 15/75) vao para o Opus 5 (5/25), Sonnet 4 para
  // o Sonnet 5, Haiku 3.5 para o Haiku 4.5. Sempre para o mais novo da familia,
  // que e mais barato ou igual e nao e o que vai aposentar em seguida.
  anthropic: {
    'claude-opus-4-1': 'claude-opus-5',
    'claude-opus-4-1-20250805': 'claude-opus-5',
    'claude-opus-4-0': 'claude-opus-5',
    'claude-opus-4-20250514': 'claude-opus-5',
    'claude-sonnet-4-0': 'claude-sonnet-5',
    'claude-sonnet-4-20250514': 'claude-sonnet-5',
    'claude-3-5-haiku-latest': 'claude-haiku-4-5',
    'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
  },
  google:    {},
  deepseek:  {},
  groq:      {},
  ollama:    {},
});

/**
 * Os modelos que a tela oferece por provedor, do recomendado para baixo. E uma
 * lista de sugestao (datalist), nao um cerco: quem digitar outro id continua
 * podendo. Familia 5 da Anthropic conferida na tabela de precos de 29/08/2026;
 * Sonnet 5 a 2/10 por MTok virou preco padrao, e e o primeiro a testar.
 */
const MODEL_PRESETS = Object.freeze({
  anthropic: [
    { id: 'claude-sonnet-5',           nota: 'recomendado: codigo, ferramentas, 1M de contexto, 2/10 USD por MTok' },
    { id: 'claude-opus-5',             nota: 'o mais forte para problemas dificeis, 5/25' },
    { id: 'claude-haiku-4-5-20251001', nota: 'o mais barato, 1/5' },
    { id: 'claude-fable-5',            nota: 'escrita longa e estilo, 10/50' },
  ],
  openai:   [{ id: 'gpt-4o-mini', nota: 'barato, com ferramentas' }],
  google:   [{ id: 'gemini-2.5-flash', nota: 'rapido, com ferramentas' }],
  deepseek: [{ id: 'deepseek-chat', nota: '' }],
  groq:     [{ id: 'llama-3.3-70b-versatile', nota: '' }],
  ollama:   [],
});

/**
 * Se o par provedor/modelo aceita o parametro `effort` da API da Anthropic.
 * Conferido na documentacao do provedor do AI SDK e na tabela de modelos de
 * 29/08/2026: familia 5 inteira e Opus 4.6 a 4.8 e Sonnet 4.6. Nas outras o
 * parametro e recusado com 400, entao fora da lista ele nem vai.
 * @param {string} provider
 * @param {string|null|undefined} modelId
 */
function efeitoSuportado(provider, modelId) {
  if (provider !== 'anthropic' || !modelId) return false;
  return /^claude-(fable-5|opus-5|sonnet-5|opus-4-[678]|sonnet-4-6)(-|$)/.test(String(modelId));
}

/**
 * Resolve a requested model id to one we should actually call:
 *   - empty / 'default' / 'latest' → the provider's current default
 *   - a known-retired id           → its migrated replacement
 *   - anything else                → unchanged
 * @param {string} provider
 * @param {string|null} [requested]
 */
function resolveModelId(provider, requested) {
  const def = DEFAULT_MODELS[/** @type {keyof typeof DEFAULT_MODELS} */ (provider)] || null;
  const id = (requested || '').trim();
  if (!id || id === 'default' || id === 'latest') return def;
  const map = MODEL_MIGRATIONS[/** @type {keyof typeof MODEL_MIGRATIONS} */ (provider)];
  return (map && map[id]) || id;
}

/**
 * Heuristic: does this AI-SDK error mean "the model id is bad" (retired,
 * renamed, typo'd, or not enabled for this key)? Drives the fallback to the
 * provider default instead of dead-ending the turn with a cryptic message.
 * @param {any} e
 */
function isModelUnavailableError(e) {
  if (!e) return false;
  const status = e.statusCode ?? e.status ?? (e.data && e.data.statusCode);
  if (status === 404) return true;
  // Scan message + body + error code. "model" is matched as a substring (not a
  // word boundary) and the failure token allows `_`/`-` separators, so codes
  // like OpenAI's `model_not_found` (often returned with status 400) are caught
  // too. The failure-token requirement keeps false positives (rate limit, bad
  // key, overloaded) out.
  const text = String((e && (e.message || e.responseBody)) || '').toLowerCase() +
    ' ' + String((e && e.code) || '').toLowerCase();
  return /model/.test(text) &&
    /(not[\s_-]*found|does[\s_-]*not[\s_-]*exist|deprecat|unknown|invalid|unsupported|no[\s_-]*such|is not a)/.test(text);
}

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
    return (/** @type {string} */ modelId) => ollamaFactory.chat(modelId);
  }
  const factory = PROVIDER_FACTORIES[name];
  if (!factory) throw new Error(`Unknown provider: ${name}`);
  const apiKey = keystore.getKey(name);
  if (!apiKey) throw new Error(`No API key configured for "${name}"`);
  return factory({ apiKey });
}

/** The hard-coded fallback model for `provider`, or `null` if unknown. */
function getDefaultModel(/** @type {string} */ provider) {
  return DEFAULT_MODELS[/** @type {keyof typeof DEFAULT_MODELS} */ (provider)] || null;
}

/** The model to actually use: the user's override (alias/migration-resolved), else the default. */
function getModelFor(/** @type {string} */ provider) {
  return resolveModelId(provider, prefs.getModel(provider));
}

/**
 * Make a minimal generateText call to verify the configured key works.
 * Designed to be cheap, small prompt, capped output, so a user can
 * click "Test connection" without worrying about token spend.
 *
 * Returns a structured result instead of throwing so the IPC handler
 * can hand it back to the renderer as-is.
 *
 * @param {string} providerName
 * @param {string} [modelId]
 */
async function testConnection(providerName, modelId) {
  if (!generateText) {
    return { ok: false, error: 'AI SDK ("ai" package) failed to load. Reinstall the app or run `npm install` if running from source.' };
  }
  const model = modelId ? resolveModelId(providerName, modelId) : getModelFor(providerName);
  if (!model) {
    return { ok: false, error: `No model configured for "${providerName}"` };
  }
  const probe = async (/** @type {string} */ m) => {
    const provider = getProvider(providerName);
    const started = Date.now();
    const result = await generateText({
      model: provider(m),
      prompt: 'Reply with the single word: pong.',
    });
    return {
      ok: true,
      provider: providerName,
      model: m,
      sample: (result.text || '').trim().slice(0, 80),
      latencyMs: Date.now() - started,
      usage: result.usage || null,
    };
  };
  try {
    return await probe(model);
  } catch (e) {
    // G6: a retired/invalid model id shouldn't dead-end the check, fall back
    // to the provider default and report which model actually answered.
    const def = getDefaultModel(providerName);
    if (isModelUnavailableError(e) && def && def !== model) {
      try { return { ...(await probe(def)), fellBackFrom: model }; }
      catch (_) { /* fall through to the original error below */ }
    }
    const message = e instanceof Error ? e.message : String(e);
    log.warn(`[ai.provider] testConnection ${providerName} failed: ${message}`);
    return { ok: false, provider: providerName, model, error: message };
  }
}

/**
 * One-shot text generation (no tools, no streaming, no chat history), for
 * features that transform an input into an output in a single call, e.g. the
 * AI harness generator. Returns a structured result instead of throwing so the
 * IPC handler can pass it through. Only the Vercel-SDK API providers are
 * supported here (the claude-code / chatgpt CLI bridges are chat-only).
 *
 * @param {object} opts
 * @param {string}  opts.provider
 * @param {string} [opts.model]
 * @param {string} [opts.system]
 * @param {string}  opts.prompt
 * @param {number} [opts.maxOutputTokens]
 */
async function generateOneshot({ provider: name, model, system, prompt, maxOutputTokens } = /** @type {any} */ ({})) {
  if (!generateText) {
    return { ok: false, error: 'AI SDK ("ai" package) failed to load.' };
  }
  if (!name || !PROVIDER_FACTORIES[name] && name !== 'ollama') {
    return { ok: false, error: `One-shot generation needs an API provider (got "${name || 'none'}"). Pick OpenAI/Anthropic/Google/DeepSeek/Groq/Ollama in the AI panel.` };
  }
  const resolvedModel = model ? resolveModelId(name, model) : getModelFor(name);
  if (!resolvedModel) return { ok: false, error: `No model configured for "${name}"` };
  const once = async (/** @type {string} */ m) => {
    const prov = getProvider(name);
    const result = await generateText({
      model: prov(m),
      ...(system ? { system } : {}),
      prompt,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      // Gemini 2.5 "thinking" spends the output budget on reasoning tokens,
      // which truncated the generated code. Disable it so the whole budget
      // goes to the answer. Other providers ignore the `google` key.
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    });
    return {
      ok: true,
      text: result.text || '',
      finishReason: result.finishReason || null,
      usage: result.usage || null,
      model: m,
    };
  };
  try {
    return await once(resolvedModel);
  } catch (e) {
    // G6: retired/invalid id → fall back to the provider default once.
    const def = getDefaultModel(name);
    if (isModelUnavailableError(e) && def && def !== resolvedModel) {
      try { return { ...(await once(def)), fellBackFrom: resolvedModel }; }
      catch (_) { /* fall through to the original error */ }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

module.exports = {
  MODEL_PRESETS,
  efeitoSuportado,
  DEFAULT_MODELS,
  getProvider,
  getDefaultModel,
  getModelFor,
  resolveModelId,
  isModelUnavailableError,
  testConnection,
  generateOneshot,
};
