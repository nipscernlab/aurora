import { describe, it, expect } from 'vitest';
import { montarComCache, marcaDaUltimaFerramenta, leituraDoCache, proporcaoEstavel } from '../../main/ai/prompt_cache.js';

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

/**
 * A fronteira entre o que e estavel e o que muda a cada turno.
 *
 * O cache da Anthropic e por PREFIXO: a marca diz "tudo ate aqui pode ser
 * reaproveitado". O system prompt da AURORA e a soma de duas coisas com vidas
 * diferentes, e ate 13/09/2026 elas iam concatenadas numa string so, com a
 * marca no fim:
 *
 *   - o prompt derivado do yanc e do dominio do SAPHO, que nao muda dentro de
 *     uma versao (medido: 37.378 chars, uns 10,4 mil tokens);
 *   - o contexto do projeto, RELIDO DO DISCO a cada turno de proposito, porque
 *     a pessoa pode trocar de projeto, salvar uma memoria ou instalar um
 *     componente no meio da conversa (uns 900 chars, 251 tokens).
 *
 * Com a marca depois dos dois, mudar 2,4% do conteudo jogava fora os outros
 * 97,6%. O que estes testes fixam e que o bloco estavel e SEPARADO e que o
 * conteudo dele nao depende do contexto: e isso, e so isso, que faz o prefixo
 * sobreviver a uma troca de projeto.
 */
describe('cache: o bloco estavel nao e invalidado pelo variavel', () => {
  const ESTAVEL = 'S'.repeat(4000);
  const msgs = [{ role: 'user', content: 'oi' }];

  it('sao dois blocos de sistema, e so o primeiro leva marca', () => {
    const { instructionsArg } = montarComCache({
      providerName: 'anthropic', system: ESTAVEL, systemVariavel: 'projeto A', messages: msgs,
    });

    expect(Array.isArray(instructionsArg)).toBe(true);
    expect(instructionsArg).toHaveLength(2);
    expect(instructionsArg[0].content).toBe(ESTAVEL);
    expect(instructionsArg[0].providerOptions.anthropic.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(instructionsArg[1].content).toBe('projeto A');
    // O variavel e recobrado a cada turno de qualquer jeito; marca-lo so
    // gastaria uma das quatro que a API permite.
    expect(instructionsArg[1].providerOptions).toBeUndefined();
  });

  it('trocar o contexto NAO muda o bloco estavel, byte a byte', () => {
    const a = montarComCache({
      providerName: 'anthropic', system: ESTAVEL, systemVariavel: 'projeto A', messages: msgs,
    });
    const b = montarComCache({
      providerName: 'anthropic', system: ESTAVEL, systemVariavel: 'projeto B, outra memoria, outro componente', messages: msgs,
    });

    // E esta igualdade que o cache le como "mesmo prefixo".
    expect(a.instructionsArg[0].content).toBe(b.instructionsArg[0].content);
    expect(a.instructionsArg[0]).toEqual(b.instructionsArg[0]);
    expect(a.instructionsArg[1].content).not.toBe(b.instructionsArg[1].content);
  });

  it('a ordem e estavel primeiro, senao o prefixo nao existe', () => {
    const { instructionsArg } = montarComCache({
      providerName: 'anthropic', system: ESTAVEL, systemVariavel: 'v', messages: msgs,
    });
    expect(instructionsArg[0].content.length).toBeGreaterThan(instructionsArg[1].content.length);
    expect(instructionsArg[0].content).toBe(ESTAVEL);
  });

  it('sem parte variavel, continua um bloco so', () => {
    const { instructionsArg } = montarComCache({
      providerName: 'anthropic', system: ESTAVEL, messages: msgs,
    });
    expect(instructionsArg).toHaveLength(1);
  });

  it('quem nao cacheia recebe a string inteira, como antes da separacao', () => {
    const { instructionsArg, comCache } = montarComCache({
      providerName: 'openai', system: ESTAVEL, systemVariavel: 'projeto A', messages: msgs,
    });
    expect(comCache).toBe(false);
    expect(instructionsArg).toBe(ESTAVEL + 'projeto A');
  });

  it('system curto demais nao vale a marca, e os dois voltam a ser um', () => {
    const { instructionsArg, comCache } = montarComCache({
      providerName: 'anthropic', system: 'curto', systemVariavel: 'ctx', messages: [],
    });
    expect(comCache).toBe(false);
    expect(instructionsArg).toBe('curtoctx');
  });
});

describe('cache: a proporcao que o log reporta', () => {
  it('mede a fatia estavel em caracteres', () => {
    expect(proporcaoEstavel('a'.repeat(976), 'b'.repeat(24)))
      .toEqual({ estavel: 976, variavel: 24, daConversa: 0, total: 1000, pctEstavel: 97.6 });
  });

  it('conta tambem o bloco fixo da conversa, que entra no total', () => {
    // O tutorial da API e o unico hoje. Sem ele no total, o log diria que o
    // system tem 1.000 caracteres num turno em que ele tem 1.500, e a fatia
    // estavel pareceria maior do que e.
    expect(proporcaoEstavel('a'.repeat(750), 'b'.repeat(250), 'c'.repeat(1000)))
      .toEqual({ estavel: 750, variavel: 250, daConversa: 1000, total: 2000, pctEstavel: 37.5 });
  });

  it('nao divide por zero quando nao ha nada', () => {
    expect(proporcaoEstavel('', '')).toEqual({ estavel: 0, variavel: 0, daConversa: 0, total: 0, pctEstavel: 0 });
  });
});

describe('cache: o bloco fixo DESTA conversa', () => {
  // Ele nao muda do primeiro ao ultimo turno, mas so existe nesta conversa.
  // Colado no estavel criaria um prefixo diferente para quem esta no tutorial,
  // e o prefixo comum deixaria de servir aos dois; colado no variavel seria
  // reescrito inteiro todo turno, que era o que acontecia ate 13/09/2026.
  const FIXO = 'TUTORIAL: '.repeat(200);

  it('vai em mensagem propria, ENTRE a estavel e a variavel', () => {
    const { instructionsArg } = montarComCache({
      providerName: 'anthropic',
      system: SYSTEM,
      systemFixoDaConversa: FIXO,
      systemVariavel: 'contexto do projeto',
      messages: conversa,
    });
    expect(instructionsArg).toHaveLength(3);
    expect(instructionsArg[0].content).toBe(SYSTEM);
    expect(instructionsArg[1].content).toBe(FIXO);
    expect(instructionsArg[2].content).toBe('contexto do projeto');
  });

  it('leva marca de uma hora, como o estavel', () => {
    const { instructionsArg } = montarComCache({
      providerName: 'anthropic',
      system: SYSTEM,
      systemFixoDaConversa: FIXO,
      systemVariavel: 'ctx',
      messages: conversa,
    });
    expect(instructionsArg[1].providerOptions.anthropic.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
    // E o variavel continua SEM marca: ele e recobrado todo turno de qualquer
    // jeito, e marca-lo gastaria uma das quatro que a API permite.
    expect(instructionsArg[2].providerOptions).toBeUndefined();
  });

  it('sem bloco fixo, nada muda: continuam duas mensagens', () => {
    const { instructionsArg } = montarComCache({
      providerName: 'anthropic', system: SYSTEM, systemVariavel: 'ctx', messages: conversa,
    });
    expect(instructionsArg).toHaveLength(2);
  });

  it('sao QUATRO marcas no total, que e exatamente o teto da API', () => {
    // ferramentas (fora daqui) + estavel + fixo da conversa + ultima do usuario.
    // A quinta o provedor descarta com um aviso, sem erro: quem acrescentar
    // outra nao vai ver nada quebrar, vai ver a conta subir.
    const { instructionsArg, messagesArg } = montarComCache({
      providerName: 'anthropic',
      system: SYSTEM,
      systemFixoDaConversa: FIXO,
      systemVariavel: 'ctx',
      messages: conversa,
    });
    const noSystem = instructionsArg.filter((m) => m.providerOptions).length;
    const naConversa = messagesArg.filter(
      (m) => Array.isArray(m.content) && m.content.some((c) => c.providerOptions),
    ).length;
    expect(noSystem + naConversa).toBe(3);   // a quarta e a da ultima ferramenta
  });

  it('quem nao cacheia recebe os tres juntos, na mesma ordem', () => {
    // O texto que o modelo le nao pode mudar por causa de cache. Este teste e o
    // que garante que a CLI de assinatura continua vendo o mesmo prompt.
    const { instructionsArg } = montarComCache({
      providerName: 'openai',
      system: 'ESTAVEL',
      systemFixoDaConversa: 'FIXO',
      systemVariavel: 'VARIAVEL',
      messages: conversa,
    });
    expect(instructionsArg).toBe('ESTAVELFIXOVARIAVEL');
  });
});
