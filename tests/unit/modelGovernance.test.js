/**
 * Unit tests for G6 — AI model governance (main/ai/provider.js).
 *
 * Covers the two pure helpers that make a retired/renamed model id survive
 * instead of dead-ending a turn: resolveModelId (alias + migration resolution)
 * and isModelUnavailableError (the heuristic that drives the runtime fallback).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveModelId, isModelUnavailableError, getDefaultModel, DEFAULT_MODELS,
} from '../../main/ai/provider.js';

describe('resolveModelId', () => {
  it("maps 'default' / 'latest' / empty to the provider's current default", () => {
    expect(resolveModelId('openai', 'default')).toBe(DEFAULT_MODELS.openai);
    expect(resolveModelId('openai', 'latest')).toBe(DEFAULT_MODELS.openai);
    expect(resolveModelId('openai', '')).toBe(DEFAULT_MODELS.openai);
    expect(resolveModelId('openai', null)).toBe(DEFAULT_MODELS.openai);
    expect(resolveModelId('anthropic', '   ')).toBe(DEFAULT_MODELS.anthropic);
  });

  it('passes an explicit/unknown model id through unchanged', () => {
    expect(resolveModelId('openai', 'gpt-4.1-custom')).toBe('gpt-4.1-custom');
    expect(resolveModelId('anthropic', 'claude-opus-4-8')).toBe('claude-opus-4-8');
  });

  it('returns null for an unknown provider with no real id', () => {
    expect(resolveModelId('nope', 'default')).toBeNull();
    expect(resolveModelId('nope', '')).toBeNull();
  });

  it('getDefaultModel agrees with DEFAULT_MODELS', () => {
    expect(getDefaultModel('groq')).toBe(DEFAULT_MODELS.groq);
    expect(getDefaultModel('nope')).toBeNull();
  });
});

describe('isModelUnavailableError', () => {
  it('flags 404 / not-found / retired-model errors', () => {
    expect(isModelUnavailableError({ statusCode: 404 })).toBe(true);
    expect(isModelUnavailableError({ status: 404 })).toBe(true);
    expect(isModelUnavailableError({ message: 'The model `gpt-x` does not exist' })).toBe(true);
    expect(isModelUnavailableError({ message: 'model not found' })).toBe(true);
    expect(isModelUnavailableError({ message: 'This model is deprecated' })).toBe(true);
    expect(isModelUnavailableError({ message: 'unknown model: foo' })).toBe(true);
    expect(isModelUnavailableError({ message: 'invalid model id' })).toBe(true);
    // OpenAI returns `model_not_found` (underscores) often with status 400, not 404.
    expect(isModelUnavailableError({ statusCode: 400, code: 'model_not_found' })).toBe(true);
    expect(isModelUnavailableError({ message: 'error code: model_not_found' })).toBe(true);
  });

  it('does NOT flag unrelated errors', () => {
    expect(isModelUnavailableError(null)).toBe(false);
    expect(isModelUnavailableError(undefined)).toBe(false);
    expect(isModelUnavailableError({ message: 'rate limit exceeded' })).toBe(false);
    expect(isModelUnavailableError({ message: 'invalid api key' })).toBe(false);
    expect(isModelUnavailableError({ statusCode: 500, message: 'internal server error' })).toBe(false);
  });
});
