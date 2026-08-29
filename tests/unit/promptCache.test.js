import { describe, it, expect } from 'vitest';
import { montarComCache, marcaDaUltimaFerramenta, leituraDoCache } from '../../main/ai/prompt_cache.js';

// Uma marca de cache no lugar errado nao da erro: so deixa de pegar, e a fatura
// e o unico sintoma. Por isso os testes conferem a FORMA exata que o AI SDK
// manda para a Anthropic, e nao so "tem marca".

const SYSTEM = 'x'.repeat(5000);
const conversa = [
    { role: 'user', content: 'primeira' },
    { role: 'assistant', content: 'resposta' },
    { role: 'user', content: 'segunda' },
];

describe('montarComCache', () => {
    it('so a Anthropic recebe marcas; os outros passam intocados', () => {
        const r = montarComCache({ providerName: 'openai', system: SYSTEM, messages: conversa });
        expect(r.comCache).toBe(false);
        expect(r.instructionsArg).toBe(SYSTEM);
        expect(r.messagesArg).toBe(conversa);
    });

    it('system prompt por 1 hora, em instructions e nunca dentro de messages', () => {
        const r = montarComCache({ providerName: 'anthropic', system: SYSTEM, messages: conversa });
        expect(r.comCache).toBe(true);
        // No AI SDK 7 uma mensagem de sistema em messages e InvalidPromptError.
        expect(r.messagesArg.some((m) => m.role === 'system')).toBe(false);
        expect(Array.isArray(r.instructionsArg)).toBe(true);
        const sys = r.instructionsArg[0];
        expect(sys).toEqual({ role: 'system', content: SYSTEM, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } } });
    });

    it('so a ULTIMA mensagem do usuario leva a marca movel, por 5 minutos', () => {
        const r = montarComCache({ providerName: 'anthropic', system: SYSTEM, messages: conversa });
        const msgs = r.messagesArg;
        expect(msgs[0].content).toBe('primeira');                 // intocada
        expect(msgs[1].content).toBe('resposta');                 // intocada
        expect(msgs[2].content[0]).toEqual({ type: 'text', text: 'segunda', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } });
        const marcadas = JSON.stringify([r.instructionsArg, r.messagesArg]).match(/cacheControl/g) || [];
        expect(marcadas.length).toBe(2);                          // system + ultima, nunca mais que 4
    });

    it('mensagem com anexos recebe a marca no ultimo bloco', () => {
        const m = [{ role: 'user', content: [{ type: 'text', text: 'veja' }, { type: 'image', image: 'data:...' }] }];
        const r = montarComCache({ providerName: 'anthropic', system: SYSTEM, messages: m });
        const blocos = r.messagesArg[0].content;
        expect(blocos[0].providerOptions).toBeUndefined();
        expect(blocos[1].providerOptions.anthropic.cacheControl.type).toBe('ephemeral');
    });

    it('system prompt curto nao vale a marca, mas a conversa ainda ganha a movel', () => {
        const r = montarComCache({ providerName: 'anthropic', system: 'curto', messages: conversa });
        expect(r.instructionsArg).toBe('curto');                  // string simples, sem marca
        expect(JSON.stringify(r.messagesArg)).toContain('cacheControl');
    });

    it('sem system e sem usuario nada e marcado e o system volta como string', () => {
        const r = montarComCache({ providerName: 'anthropic', system: '', messages: [{ role: 'assistant', content: 'oi' }] });
        expect(r.comCache).toBe(false);
        expect(r.instructionsArg).toBeUndefined();
    });
});

describe('marcaDaUltimaFerramenta', () => {
    it('e a marca de 1 hora no formato de providerOptions', () => {
        expect(marcaDaUltimaFerramenta()).toEqual({ anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } });
    });
});

describe('leituraDoCache', () => {
    it('le o formato do AI SDK 6/7 e nao lanca em formas estranhas', () => {
        expect(leituraDoCache({ inputTokens: 100, inputTokenDetails: { cacheReadTokens: 80, cacheWriteTokens: 10 } }))
            .toEqual({ lidos: 80, escritos: 10, entrada: 100 });
        expect(leituraDoCache({ inputTokens: 5, cachedInputTokens: 3 })).toEqual({ lidos: 3, escritos: 0, entrada: 5 });
        expect(leituraDoCache(null)).toEqual({ lidos: 0, escritos: 0, entrada: 0 });
    });
});
