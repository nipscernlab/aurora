import { describe, it, expect } from 'vitest';
import { streamText, stepCountIs } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { montarComCache } from '../../main/ai/prompt_cache.js';
import { buildTools, TOOL_MANIFEST } from '../../main/ai/tools.js';

// O double check do cache e do esforco. Um teste da forma dos objetos do SDK
// prova que a gente montou o que ACHA que o SDK quer; este prova o que sai na
// linha: o provedor Anthropic real do AI SDK, com um fetch falso que guarda o
// corpo do pedido e devolve um stream vazio. Se o SDK mudar o nome de um campo,
// e aqui que se ve, e nao na fatura.

function fetchFalso(capturado) {
    return async (_url, init) => {
        capturado.body = JSON.parse(init.body);
        capturado.headers = init.headers;
        const sse = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
}

async function pedido({ providerOptions, messages, system }) {
    const capturado = {};
    const anthropic = createAnthropic({ apiKey: 'sk-teste', fetch: fetchFalso(capturado) });
    const { instructionsArg, messagesArg } = montarComCache({ providerName: 'anthropic', system, messages });
    const tools = buildTools(async () => ({ ok: true }));
    const r = streamText({
        model: anthropic('claude-sonnet-5'),
        messages: messagesArg,
        ...(instructionsArg ? { instructions: instructionsArg } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        tools,
        stopWhen: stepCountIs(1),
        maxRetries: 0,
    });
    // Consome o stream para o pedido sair.
    try { for await (const _ of r.textStream) { /* vazio */ } } catch (_) { /* stream vazio e o esperado */ }
    return capturado.body;
}

const SYSTEM = 'S'.repeat(6000);
const conversa = [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'ola' },
    { role: 'user', content: 'compila' },
];

describe('o pedido que sai para a Anthropic', () => {
    it('system prompt vai com cache de 1 hora', async () => {
        const body = await pedido({ system: SYSTEM, messages: conversa });
        expect(Array.isArray(body.system)).toBe(true);
        expect(body.system[0].text).toBe(SYSTEM);
        expect(body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    });

    it('a ultima ferramenta fecha o prefixo com cache de 1 hora, e so ela', async () => {
        const body = await pedido({ system: SYSTEM, messages: conversa });
        expect(body.tools.length).toBe(TOOL_MANIFEST.length);
        const marcadas = body.tools.filter((t) => t.cache_control);
        expect(marcadas.length).toBe(1);
        expect(body.tools[body.tools.length - 1].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    });

    it('a ultima mensagem do usuario leva a marca movel de 5 minutos, e as outras nao', async () => {
        const body = await pedido({ system: SYSTEM, messages: conversa });
        const msgs = body.messages;
        const ultima = msgs[msgs.length - 1];
        expect(ultima.role).toBe('user');
        expect(ultima.content[0].cache_control).toEqual({ type: 'ephemeral' });
        const comMarca = msgs.filter((m) => JSON.stringify(m).includes('cache_control'));
        expect(comMarca.length).toBe(1);
    }, 15000);

    it('no maximo quatro marcas no pedido inteiro', async () => {
        const body = await pedido({ system: SYSTEM, messages: conversa });
        const total = (JSON.stringify(body).match(/"cache_control"/g) || []).length;
        expect(total).toBeLessThanOrEqual(4);
        expect(total).toBe(3);
    });

    it('effort chega como campo de topo do pedido', async () => {
        const body = await pedido({ system: SYSTEM, messages: conversa, providerOptions: { anthropic: { effort: 'low' } } });
        expect(JSON.stringify(body)).toContain('"effort"');
        expect(body.effort ?? body.output_config?.effort ?? body.thinking?.effort).toBe('low');
    });
});
