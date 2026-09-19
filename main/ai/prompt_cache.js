// @ts-check
/**
 * prompt_cache.js: onde o cache de prompt da Anthropic e marcado, e por quanto.
 *
 * O QUE SE PAGA SEM ISTO. Cada turno da Aurora Intelligence reenvia o system
 * prompt (uns 8,6 mil tokens medidos em 29/08/2026), as ferramentas (eram 112,
 * uns 14,7 mil tokens, na mesma medida; hoje sao 124, entao aquele numero e piso)
 * e a conversa inteira. Antes, so o system prompt era marcado para
 * cache, por 5 minutos: as ferramentas, a parte maior, eram cobradas cheias em
 * todo turno, e uma pausa de mais de 5 minutos para compilar ou pensar jogava o
 * cache fora.
 *
 * AS QUATRO MARCAS, que e o teto da API:
 *   1. a ultima ferramenta, que fecha o prefixo de ferramentas inteiro;
 *   2. a parte ESTAVEL do system prompt;
 *   3. o bloco FIXO DESTA CONVERSA, quando existe (hoje so o tutorial da API).
 *      Ele nao muda do primeiro ao ultimo turno, mas nao serve para o prefixo
 *      global porque so existe nessa conversa: marca propria, entre o estavel
 *      e o que muda por turno;
 *   4. a ultima mensagem do usuario, que anda a cada turno: tudo antes dela e
 *      identico ao turno anterior, entao a conversa toda vem do cache.
 *
 * QUATRO E O TETO, E ESTAMOS NELE. O provedor conta as marcas e DESCARTA a
 * quinta com um aviso, sem erro nenhum (@ai-sdk/anthropic, MAX_CACHE_BREAKPOINTS
 * = 4). Quem acrescentar uma quinta nao vai ver nada quebrar: vai ver a conta
 * subir. Por isso chat.js registra no log os avisos que o SDK devolve.
 *
 * POR QUE A PARTE ESTAVEL, E NAO O SYSTEM PROMPT INTEIRO. O que a AURORA manda
 * como system e a soma de duas coisas com vidas diferentes: o prompt derivado
 * do yanc e do dominio do SAPHO, que nao muda dentro de uma versao (medido em
 * 13/09/2026: 37.378 chars, uns 10,4 mil tokens), e o contexto do projeto, que
 * e RELIDO DO DISCO a cada turno de proposito, porque a pessoa pode abrir outro
 * projeto, salvar uma memoria ou instalar um componente no meio da conversa
 * (uns 900 chars, 251 tokens).
 *
 * Concatenados num blob so, com a marca no fim, o cache e por prefixo e a marca
 * cobria os dois: mudar 251 tokens de contexto jogava fora os 10,4 mil
 * estaveis. Em dois blocos, com a marca ENTRE eles, o prefixo estavel sobrevive
 * a troca de projeto. Os 2,4% variaveis deixam de custar os outros 97,6%.
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
 * @param {string} [p.system] a parte ESTAVEL: e ela que leva a marca de 1h
 * @param {string} [p.systemFixoDaConversa] o que nao muda DENTRO desta
 *   conversa mas nao vale para as outras (o tutorial da API). Vai entre o
 *   estavel e o variavel, com marca propria de 1 hora.
 * @param {string} [p.systemVariavel] o que muda a cada turno (contexto do
 *   projeto, memorias, componentes). Vai por ULTIMO e SEM marca, para nao
 *   arrastar os prefixos grandes junto quando mudar.
 * @param {Array<{role:string, content:any}>} p.messages mensagens ja no formato do SDK
 * @param {number} [p.minimoChars] abaixo disto o system prompt nao vale a marca
 * @returns {{ instructionsArg: any, messagesArg: Array<any>, comCache: boolean }}
 *   `instructionsArg` vai direto em `instructions` do streamText: string sem
 *   cache, ou a mensagem de sistema marcada.
 */
function montarComCache({ providerName, system, systemFixoDaConversa, systemVariavel, messages, minimoChars = 1024 }) {
  const msgs = Array.isArray(messages) ? messages : [];
  const estavel = system || '';
  const daConversa = systemFixoDaConversa || '';
  const variavel = systemVariavel || '';

  if (!cacheia(providerName)) {
    // Sem cache, os tres viram de novo uma string so: e exatamente o que os
    // outros provedores recebiam antes desta separacao existir. A ORDEM e a
    // mesma de sempre, entao o texto que o modelo le nao muda.
    const inteiro = estavel + daConversa + variavel;
    return { instructionsArg: inteiro || undefined, messagesArg: msgs, comCache: false };
  }

  /** @type {Array<any>} */
  const out = [];
  let comCache = false;
  /** @type {string | Array<{ role: string, content: string, providerOptions?: any }> | undefined} */
  let instructionsArg = (estavel + daConversa + variavel) || undefined;
  if (estavel && estavel.length > minimoChars) {
    // A marca fica no FIM DO ESTAVEL, e nao no fim de tudo. O bloco variavel
    // vem por ultimo e sem marca: ele e recobrado a cada turno de qualquer
    // jeito, e marca-lo so gastaria uma das quatro que a API permite.
    instructionsArg = [{ role: 'system', content: estavel, providerOptions: marca('1h') }];
    // O bloco fixo DESTA conversa entra no meio, com marca propria. Marca
    // propria, e nao coladinho no estavel, porque o estavel e o mesmo em TODA
    // conversa: junta-lo criaria um prefixo diferente para quem esta no
    // tutorial e o prefixo comum deixaria de servir aos dois.
    if (daConversa) {
      instructionsArg.push({ role: 'system', content: daConversa, providerOptions: marca('1h') });
    }
    if (variavel) instructionsArg.push({ role: 'system', content: variavel });
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
 * Os tamanhos do que foi montado, para o log dizer quanto do prompt e estavel.
 * Puro: nao mede tokens (so a API sabe), mede caracteres, que e a proporcao.
 * @param {string} [estavel]
 * @param {string} [variavel]
 * @param {string} [daConversa]
 */
function proporcaoEstavel(estavel, variavel, daConversa) {
  const e = (estavel || '').length;
  const v = (variavel || '').length;
  const c = (daConversa || '').length;
  const total = e + v + c;
  return {
    estavel: e,
    variavel: v,
    daConversa: c,
    total,
    pctEstavel: total ? Math.round((e / total) * 1000) / 10 : 0,
  };
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

/**
 * O DOCUMENTO CITAVEL NAO LEVA MARCA, E ISSO E DECISAO.
 *
 * Quem ler este arquivo depois de ver main/ai/citacoes.js vai procurar aqui a
 * quarta marca, a do documento do manual, e nao vai achar. Nao foi esquecimento.
 *
 * A API permite quatro marcas e usamos tres, entao sobrava uma. O impedimento e
 * outro, e e de ORDEM. Citacao so existe em bloco de documento dentro de
 * mensagem de USUARIO, e toda mensagem vem depois de todo o bloco de sistema. O
 * nosso bloco variavel (projeto, memorias, componentes) mora no sistema e muda a
 * cada turno. Como o cache e por prefixo, qualquer marca posta atras dele e
 * invalidada sempre que ele muda, que e o tempo todo. Cachear o documento
 * obrigaria a tirar o contexto variavel de dentro do `instructions` e joga-lo no
 * fluxo de mensagens, depois do documento.
 *
 * O QUE ISSO COMPRARIA: uma pagina do manual tem uns 5.550 caracteres, uns 1.500
 * tokens (a proporcao vem do bloco estavel, 37.378 chars para uns 10,4 mil
 * tokens; e deducao, nao medida). Reestruturar o que o modelo ve, mudando um
 * bloco de sistema em mensagem de usuario, por 1.500 tokens por turno, nao se
 * paga. Fixar o manual INTEIRO seria outra conversa, 205.348 chars, uns 55 mil
 * tokens, e ai a conta vira a do prefixo frio de effort_policy.js, com um numero
 * dez vezes maior: a 1 hora a escrita custa 2x, e quem pergunta do manual duas
 * vezes por semana nunca acha o prefixo quente.
 *
 * Se um dia o contexto variavel sair do sistema por OUTRO motivo, esta decisao
 * muda junto, e ai a marca do documento passa a valer.
 */

module.exports = { montarComCache, marcaDaUltimaFerramenta, leituraDoCache, cacheia, proporcaoEstavel, TTL_LONGO };
