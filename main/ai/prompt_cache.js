// @ts-check
/**
 * prompt_cache.js: onde o cache de prompt da Anthropic e marcado, e por quanto.
 *
 * O QUE SE PAGA SEM ISTO. Cada turno da Aurora Intelligence reenvia o system
 * prompt (uns 8,6 mil tokens medidos em 29/08/2026), as 112 ferramentas (uns
 * 14,7 mil) e a conversa inteira. Antes, so o system prompt era marcado para
 * cache, por 5 minutos: as ferramentas, a parte maior, eram cobradas cheias em
 * todo turno, e uma pausa de mais de 5 minutos para compilar ou pensar jogava o
 * cache fora.
 *
 * AS TRES MARCAS (a API aceita ate quatro):
 *   1. a ultima ferramenta, que fecha o prefixo de ferramentas inteiro;
 *   2. o system prompt;
 *   3. a ultima mensagem do usuario, que anda a cada turno: tudo antes dela e
 *      identico ao turno anterior, entao a conversa toda vem do cache.
 * As duas primeiras por 1 hora, porque o que elas cobrem nao muda dentro de
 * uma sessao e o ritmo de uma IDE tem pausas longas; a terceira por 5 minutos,
 * porque ela e refeita a cada turno de qualquer jeito.
 *
 * O PRECO, da tabela da Anthropic: escrever por 1 hora custa 2x a entrada,
 * escrever por 5 minutos 1,25x, e ler 0,1x. A marca de 1 hora se paga na
 * segunda leitura; a de 5 minutos na primeira. Numa conversa de tres turnos ou
 * mais, que e a regra, as duas compensam.
 *
 * ONDE O SYSTEM PROMPT VAI. No AI SDK 7 ele vai em `instructions`, como uma
 * mensagem de sistema com providerOptions; uma mensagem `role: 'system'`
 * dentro de `messages` e recusada com InvalidPromptError. Era assim que a
 * versao anterior marcava o cache, e por isso o caminho de API da Anthropic
 * com o system prompt grande estourava antes de mandar qualquer coisa. O
 * teste de forma do pedido (anthropicRequestShape) e o que pegou isso.
 *
 * Puro: monta objetos, nao chama nada. Os testes cobrem a forma exata que o
 * Vercel AI SDK espera, porque uma marca no lugar errado nao da erro, so
 * deixa de pegar, e a fatura e o unico sintoma.
 */

'use strict';

/** O tempo que o system prompt e as ferramentas ficam no cache. */
const TTL_LONGO = '1h';

/** @typedef {{ type: 'ephemeral', ttl?: '1h' }} CacheControl */

/** A marca, no formato de providerOptions do AI SDK. */
function marca(/** @type {'1h'|'5m'} */ prazo = '5m') {
  /** @type {CacheControl} */
  const cc = { type: 'ephemeral' };
  if (prazo === '1h') cc.ttl = TTL_LONGO;
  return { anthropic: { cacheControl: cc } };
}

/**
 * Se este provedor/modelo cacheia. So a Anthropic le a marca; nos outros ela
 * seria carga morta no pedido.
 * @param {string} providerName
 */
function cacheia(providerName) {
  return providerName === 'anthropic';
}

/**
 * Monta `system` e `messages` para o streamText, com as marcas de cache.
 *
 * @param {object} p
 * @param {string} p.providerName
 * @param {string} [p.system]
 * @param {Array<{role:string, content:any}>} p.messages mensagens ja no formato do SDK
 * @param {number} [p.minimoChars] abaixo disto o system prompt nao vale a marca
 * @returns {{ instructionsArg: any, messagesArg: Array<any>, comCache: boolean }}
 *   `instructionsArg` vai direto em `instructions` do streamText: string sem
 *   cache, ou a mensagem de sistema marcada.
 */
function montarComCache({ providerName, system, messages, minimoChars = 1024 }) {
  const msgs = Array.isArray(messages) ? messages : [];
  if (!cacheia(providerName)) {
    return { instructionsArg: system || undefined, messagesArg: msgs, comCache: false };
  }

  /** @type {Array<any>} */
  const out = [];
  let comCache = false;
  let instructionsArg = system || undefined;
  if (system && system.length > minimoChars) {
    instructionsArg = [{ role: 'system', content: system, providerOptions: marca('1h') }];
    comCache = true;
  }

  // A ultima mensagem do usuario leva a marca movel. So a ULTIMA: a API limita
  // as marcas a quatro, e uma por turno as esgotaria no quarto.
  let ultimaUsuario = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i] && msgs[i].role === 'user') { ultimaUsuario = i; break; }
  }
  msgs.forEach((m, i) => {
    if (i !== ultimaUsuario) { out.push(m); return; }
    out.push(comMarcaMovel(m));
    comCache = true;
  });

  return { instructionsArg, messagesArg: comCache ? out : msgs, comCache };
}

/**
 * Poe a marca de 5 minutos na mensagem. Conteudo em texto vira um bloco de
 * texto marcado; conteudo em blocos (anexos, imagens) recebe a marca no ultimo
 * bloco, que e onde a API a espera.
 */
function comMarcaMovel(/** @type {any} */ m) {
  if (typeof m.content === 'string') {
    return { ...m, content: [{ type: 'text', text: m.content, providerOptions: marca('5m') }] };
  }
  if (Array.isArray(m.content) && m.content.length) {
    const blocos = m.content.slice();
    const ultimo = blocos[blocos.length - 1];
    blocos[blocos.length - 1] = { ...ultimo, providerOptions: { ...(ultimo.providerOptions || {}), ...marca('5m') } };
    return { ...m, content: blocos };
  }
  return m;
}

/**
 * A marca para a ULTIMA ferramenta do manifesto, que fecha o prefixo de todas.
 * Quem monta as ferramentas (tools.buildTools) a poe so na ultima.
 */
function marcaDaUltimaFerramenta() {
  return marca('1h');
}

/**
 * O que o cache rendeu num turno, a partir do `usage` do AI SDK. Devolve os
 * tokens lidos do cache, os escritos nele e os cobrados inteiros, para a tela
 * dizer quanto do turno veio de graca. Nunca lanca: usage vem em formas
 * diferentes conforme a versao e o provedor.
 * @param {any} usage
 */
function leituraDoCache(usage) {
  const d = (usage && usage.inputTokenDetails) || {};
  const lidos = Number(d.cacheReadTokens ?? usage?.cachedInputTokens ?? 0) || 0;
  const escritos = Number(d.cacheWriteTokens ?? 0) || 0;
  const entrada = Number(usage?.inputTokens ?? 0) || 0;
  return { lidos, escritos, entrada };
}

module.exports = { montarComCache, marcaDaUltimaFerramenta, leituraDoCache, cacheia, TTL_LONGO };
