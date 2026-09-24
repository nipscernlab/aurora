/**
 * main/ai/provider: montar o provedor com a chave guardada e o "Testar
 * conexao" das Configuracoes. O modelGovernance.test.js cobre as regras puras
 * (qual modelo, qual migracao); estes cobrem o que depende da chave e do SDK.
 *
 * Sem rede e sem as chaves de verdade de quem roda o teste:
 *   - o Electron falso aponta o userData para uma pasta temporaria, entao o
 *     keystore e o prefs de verdade gravam e leem ali uma chave de mentira;
 *   - os pacotes do AI SDK (ai, @ai-sdk/*) sao trocados no cache do require
 *     antes de o provider carregar, e o generateText falso responde "pong";
 *   - o beforeAll confere, sem chamada nenhuma, que o require visto do
 *     provider devolve o pacote falso.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-provider-'));

const electronFalso = vi.hoisted(() => ({
  app: { getPath: () => globalThis.__providerUserData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`cifrado:${s}`),
    decryptString: (b) => Buffer.from(b).toString().replace(/^cifrado:/, ''),
  },
}));
globalThis.__providerUserData = userData;
vi.mock('electron', () => ({ default: electronFalso, ...electronFalso }));
req.cache[req.resolve('electron')] = { id: 'electron', loaded: true, exports: electronFalso };

// ── O SDK falso ─────────────────────────────────────────────────────────────
/** cada chamada ao generateText: { model, prompt } */
const geradas = [];
/** o que o generateText faz para um modelo: lancar este erro, ou responder */
let falhaPorModelo = {};
const sdk = {
  ai: {
    generateText: async ({ model, prompt }) => {
      geradas.push({ model, prompt });
      const erro = falhaPorModelo[model.modelId];
      if (erro) throw erro;
      return { text: '  pong  ', usage: { totalTokens: 3 } };
    },
  },
  '@ai-sdk/anthropic': { createAnthropic: ({ apiKey }) => (modelId) => ({ provedor: 'anthropic', apiKey, modelId }) },
  '@ai-sdk/openai': {
    createOpenAI: (opcoes) => {
      const fabrica = (modelId) => ({ provedor: 'openai', ...opcoes, modelId });
      fabrica.chat = (modelId) => ({ provedor: 'openai-chat', ...opcoes, modelId });
      return fabrica;
    },
  },
  '@ai-sdk/google': { createGoogleGenerativeAI: () => (modelId) => ({ provedor: 'google', modelId }) },
  '@ai-sdk/deepseek': { createDeepSeek: () => (modelId) => ({ provedor: 'deepseek', modelId }) },
  '@ai-sdk/groq': { createGroq: () => (modelId) => ({ provedor: 'groq', modelId }) },
};
const reqDoProvider = createRequire(path.resolve('main/ai/provider.js'));
for (const [pacote, exports] of Object.entries(sdk)) {
  req.cache[reqDoProvider.resolve(pacote)] = { id: pacote, loaded: true, exports };
}

let provider;
let keystore;

beforeAll(async () => {
  if (reqDoProvider('ai') !== sdk.ai || reqDoProvider('@ai-sdk/anthropic') !== sdk['@ai-sdk/anthropic']) {
    throw new Error('o SDK falso nao e o que o provider vai carregar: parar antes de qualquer chamada');
  }
  provider = await import('../../main/ai/provider.js');
  keystore = req('../../main/ai/keystore.js');
});

afterAll(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

beforeEach(() => {
  geradas.length = 0;
  falhaPorModelo = {};
  for (const f of fs.readdirSync(userData)) fs.rmSync(path.join(userData, f), { force: true });
});

describe('getProvider', () => {
  it('monta o provedor com a chave guardada', () => {
    keystore.setKey('anthropic', 'sk-teste');
    expect(provider.getProvider('anthropic')('claude-x')).toEqual({ provedor: 'anthropic', apiKey: 'sk-teste', modelId: 'claude-x' });
  });

  it('sem chave guardada, lanca dizendo qual falta', () => {
    expect(() => provider.getProvider('anthropic')).toThrow('No API key configured for "anthropic"');
  });

  it('provedor desconhecido lanca', () => {
    expect(() => provider.getProvider('nenhum')).toThrow('Unknown provider: nenhum');
  });

  it('o Ollama vai sempre ao chat completions, na URL guardada ou na local', () => {
    expect(provider.getProvider('ollama')('llama3')).toEqual({
      provedor: 'openai-chat', baseURL: 'http://localhost:11434/v1', apiKey: 'ollama', compatibility: 'compatible', modelId: 'llama3',
    });
    keystore.setKey('ollama', 'http://maquina:11434/v1');
    expect(provider.getProvider('ollama')('llama3').baseURL).toBe('http://maquina:11434/v1');
  });
});

describe('getModelFor', () => {
  it('sem preferencia, o padrao do provedor', () => {
    expect(provider.getModelFor('anthropic')).toBe(provider.getDefaultModel('anthropic'));
  });
});

describe('testConnection', () => {
  it('uma chamada curta, e o que respondeu', async () => {
    keystore.setKey('anthropic', 'sk-teste');
    const r = await provider.testConnection('anthropic', 'claude-x');
    expect(r).toMatchObject({ ok: true, provider: 'anthropic', model: 'claude-x', sample: 'pong', usage: { totalTokens: 3 } });
    expect(typeof r.latencyMs).toBe('number');
    expect(geradas).toEqual([{ model: { provedor: 'anthropic', apiKey: 'sk-teste', modelId: 'claude-x' }, prompt: 'Reply with the single word: pong.' }]);
  });

  it('sem modelo pedido, usa o do provedor', async () => {
    keystore.setKey('anthropic', 'sk-teste');
    const r = await provider.testConnection('anthropic');
    expect(r.model).toBe(provider.getDefaultModel('anthropic'));
  });

  it('modelo aposentado cai no padrao, e diz de qual caiu', async () => {
    keystore.setKey('anthropic', 'sk-teste');
    falhaPorModelo['claude-velho'] = Object.assign(new Error('model not found'), { statusCode: 404 });
    const r = await provider.testConnection('anthropic', 'claude-velho');
    expect(r).toMatchObject({ ok: true, model: provider.getDefaultModel('anthropic'), fellBackFrom: 'claude-velho' });
  });

  it('se o padrao tambem falha, devolve o erro original', async () => {
    keystore.setKey('anthropic', 'sk-teste');
    const def = provider.getDefaultModel('anthropic');
    falhaPorModelo['claude-velho'] = Object.assign(new Error('model not found'), { statusCode: 404 });
    falhaPorModelo[def] = new Error('overloaded');
    expect(await provider.testConnection('anthropic', 'claude-velho'))
      .toEqual({ ok: false, provider: 'anthropic', model: 'claude-velho', error: 'model not found' });
  });

  it('erro que nao e de modelo nao tenta outro', async () => {
    keystore.setKey('anthropic', 'sk-teste');
    falhaPorModelo['claude-x'] = new Error('invalid x-api-key');
    expect(await provider.testConnection('anthropic', 'claude-x'))
      .toEqual({ ok: false, provider: 'anthropic', model: 'claude-x', error: 'invalid x-api-key' });
    expect(geradas).toHaveLength(1);
  });

  it('sem chave: falha estruturada, sem lancar', async () => {
    expect(await provider.testConnection('anthropic', 'claude-x'))
      .toEqual({ ok: false, provider: 'anthropic', model: 'claude-x', error: 'No API key configured for "anthropic"' });
  });

  it('provedor sem modelo nenhum: diz isso', async () => {
    expect(await provider.testConnection('nenhum')).toEqual({ ok: false, error: 'No model configured for "nenhum"' });
  });
});
