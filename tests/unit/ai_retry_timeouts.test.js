import { describe, it, expect } from 'vitest';
import {
  isTransientAiError, backoffDelay, TRANSIENT_MAX_ATTEMPTS, AI_SDK_MAX_RETRIES,
} from '../../main/ai/retry.js';
import * as T from '../../main/ai/timeouts.js';

// Pure modules behind ESTUDO §18.5 items 4 (retry/backoff) and 5 (the single
// timeout table). timeouts.js also self-checks its hierarchy at import time —
// merely importing it here fails the suite if an edit breaks the ordering.

describe('isTransientAiError', () => {
  it('flags rate limits, 5xx and transport resets', () => {
    expect(isTransientAiError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isTransientAiError('Rate limit exceeded, retry later')).toBe(true);
    expect(isTransientAiError(new Error('Overloaded'))).toBe(true);
    expect(isTransientAiError('503 Service Unavailable')).toBe(true);
    expect(isTransientAiError('upstream returned 529')).toBe(true);
    expect(isTransientAiError(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransientAiError('socket hang up')).toBe(true);
    expect(isTransientAiError('TypeError: fetch failed')).toBe(true);
    const withCode = Object.assign(new Error('request failed'), { code: 'ETIMEDOUT' });
    expect(isTransientAiError(withCode)).toBe(true);
  });

  it('does NOT flag real failures or stray numbers', () => {
    expect(isTransientAiError(new Error('Invalid API key'))).toBe(false);
    expect(isTransientAiError('model claude-9 not found')).toBe(false);
    expect(isTransientAiError('The user denied this action.')).toBe(false);
    // enumerated codes only — "512 ms" must not look like a 5xx
    expect(isTransientAiError('operation took 512 ms')).toBe(false);
    expect(isTransientAiError('')).toBe(false);
    expect(isTransientAiError(null)).toBe(false);
  });
});

describe('backoffDelay (full jitter)', () => {
  it('stays within [floor, min(cap, base·2^(n-1))] and grows the ceiling', () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      for (let i = 0; i < 50; i++) {
        const d = backoffDelay(attempt, { baseMs: 1000, capMs: 8000, floorMs: 250 });
        expect(d).toBeGreaterThanOrEqual(250);
        expect(d).toBeLessThanOrEqual(Math.min(8000, 1000 * 2 ** (attempt - 1)));
      }
    }
  });
  it('respects the cap on late attempts', () => {
    for (let i = 0; i < 50; i++) {
      expect(backoffDelay(10, { baseMs: 1000, capMs: 8000 })).toBeLessThanOrEqual(8000);
    }
  });
});

describe('retry policy constants', () => {
  it('allows at least one retry on both paths', () => {
    expect(TRANSIENT_MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(AI_SDK_MAX_RETRIES).toBeGreaterThanOrEqual(2);
  });
});

describe('timeouts table hierarchy', () => {
  it('MCP ceiling out-waits every tool_bridge leash', () => {
    expect(T.MCP_TOOL_CALL_MS).toBeGreaterThanOrEqual(T.TOOL_INTERACTIVE_MS);
    expect(T.TOOL_INTERACTIVE_MS).toBeGreaterThan(T.TOOL_SLOW_MS);
    expect(T.TOOL_SLOW_MS).toBeGreaterThan(T.TOOL_DEFAULT_MS);
  });
  it('liveness reapers are shorter than the tool leashes they must not race', () => {
    expect(T.CLI_INACTIVITY_MS).toBeLessThanOrEqual(T.TOOL_DEFAULT_MS);
    expect(T.STREAM_IDLE_MS).toBeLessThanOrEqual(T.TOOL_DEFAULT_MS);
  });
  it('renderer watchdogs (documented in ai_metadata.js) out-wait main', async () => {
    const { STREAM_STALL_MS, STREAM_STALL_HARD_MS } = await import('../../js/ai/ai_metadata.js');
    expect(STREAM_STALL_MS).toBeGreaterThan(T.CLI_INACTIVITY_MS);
    expect(STREAM_STALL_HARD_MS).toBeGreaterThan(T.MCP_TOOL_CALL_MS);
  });
});
