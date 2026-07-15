// @ts-check
/**
 * retry.js — transient-error classification + backoff for the AI turns
 * (ESTUDO §18.5 item 4). Pure module: no electron, no logging — callers log.
 *
 * Policy: a turn is retried ONLY when it failed before ANYTHING reached the
 * user (no delta, no tool chip) — retrying after output would duplicate
 * text or re-run tools. The CLI engines apply this via their `anyEvent`
 * flag; the Vercel-AI-SDK path delegates to the SDK's own `maxRetries`
 * (same request-level semantics, built in).
 *
 * Backoff: "full jitter" (AWS-style) — delay = random(0 … min(cap, base·2^n)).
 * Jitter matters: several clients hitting the same 429 must NOT all come
 * back at the same instant.
 */

'use strict';

/** Attempts for a CLI-engine turn (1 original + 2 retries). */
const TRANSIENT_MAX_ATTEMPTS = 3;

/** maxRetries handed to the Vercel AI SDK's streamText (its default is 2). */
const AI_SDK_MAX_RETRIES = 3;

// Deliberately ENUMERATED status codes (not 5\d\d — that would match stray
// numbers like "512 ms" in an error string) + the transport-level errno /
// phrase set seen from Anthropic/OpenAI/undici in practice.
const TRANSIENT_RE = new RegExp(
  [
    '\\b(?:429|500|502|503|504|529)\\b',
    'too many requests',
    'rate.?limit',
    'overloaded',
    'internal server error',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'EAI_AGAIN',
    'ENETUNREACH',
    'socket hang up',
    'network error',
    'fetch failed',
    'connection (?:error|closed|reset)',
  ].join('|'),
  'i',
);

/**
 * True when the error looks like a transient transport/provider hiccup
 * worth retrying (429, 5xx, network reset) — NOT a real failure (bad auth,
 * unknown model, invalid request), which retrying would only repeat.
 * @param {unknown} err  Error, string, or anything with a message
 */
function isTransientAiError(err) {
  const msg = err instanceof Error
    ? `${err.message} ${/** @type {any} */ (err).code || ''}`
    : String(err ?? '');
  return TRANSIENT_RE.test(msg);
}

/**
 * Full-jitter backoff delay for the Nth attempt (1-based): a uniform random
 * pick in [floor … min(cap, base·2^(n-1))].
 * @param {number} attempt 1-based attempt number that just FAILED
 * @param {{baseMs?: number, capMs?: number, floorMs?: number}} [opts]
 */
function backoffDelay(attempt, { baseMs = 1000, capMs = 8000, floorMs = 250 } = {}) {
  const ceil = Math.min(capMs, baseMs * 2 ** (Math.max(1, attempt) - 1));
  return Math.max(floorMs, Math.round(Math.random() * ceil));
}

/** setTimeout as a promise. */
function sleep(/** @type {number} */ ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  TRANSIENT_MAX_ATTEMPTS,
  AI_SDK_MAX_RETRIES,
  isTransientAiError,
  backoffDelay,
  sleep,
};
