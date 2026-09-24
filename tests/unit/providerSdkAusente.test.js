/**
 * main/ai/provider: um pacote do AI SDK que nao carrega desliga so aquele
 * provedor. E para isso que o tryRequire existe: um pacote faltando, ou uma
 * dependencia transitiva quebrada, nao pode derrubar o processo principal no
 * boot.
 *
 * Arquivo proprio porque precisa de um carregamento do provider com o pacote
 * do Groq quebrado: no cache do require ele vira um objeto que lanca ao ser
 * lido, que e o que acontece com um modulo cujo codigo falha ao ser avaliado.
 * Os outros pacotes tambem sao falsos, para nada carregar de verdade.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const reqDoProvider = createRequire(path.resolve('main/ai/provider.js'));
const quebrado = new Proxy({}, { get() { throw new Error('dependencia transitiva quebrada'); } });
const falsos = {
  ai: { generateText: async () => ({ text: 'pong' }) },
  '@ai-sdk/openai': { createOpenAI: () => () => ({}) },
  '@ai-sdk/anthropic': { createAnthropic: () => () => ({}) },
  '@ai-sdk/google': { createGoogleGenerativeAI: () => () => ({}) },
  '@ai-sdk/deepseek': { createDeepSeek: () => () => ({}) },
  '@ai-sdk/groq': quebrado,
};
for (const [pacote, exports] of Object.entries(falsos)) {
  req.cache[reqDoProvider.resolve(pacote)] = { id: pacote, loaded: true, exports };
}

let provider;
beforeAll(async () => {
  provider = await import('../../main/ai/provider.js');
});

describe('pacote do SDK que nao carrega', () => {
  it('o modulo carrega mesmo assim, e so aquele provedor fica de fora', () => {
    expect(() => provider.getProvider('groq')).toThrow('Unknown provider: groq');
    // Os outros continuam existindo. Sem Electron aqui, montar o Anthropic
    // falha adiante, na leitura da chave; o que importa e nao falhar por ser
    // provedor desconhecido.
    let erro = '';
    try { provider.getProvider('anthropic'); } catch (e) { erro = e.message; }
    expect(erro).not.toMatch(/Unknown provider/);
  });

  it('as regras que nao dependem do SDK seguem valendo para ele', () => {
    expect(provider.getDefaultModel('groq')).toBe('llama-3.3-70b-versatile');
  });
});
