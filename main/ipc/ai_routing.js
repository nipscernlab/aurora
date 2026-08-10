// @ts-check
/**
 * ai_routing.js — qual motor atende cada provedor.
 *
 * A Aurora Intelligence tem três caminhos para falar com um modelo, e a regra
 * que escolhe entre eles estava escrita três vezes dentro do `ai.js`, com uma
 * forma diferente em cada lugar: um `if/else if` no início de conversa, um
 * `if` só para o `claude-code` na geração de uma tacada, e um "aborta nos três"
 * no cancelamento. Três cópias da mesma regra é como uma delas fica para trás.
 *
 * OS TRÊS CAMINHOS, E POR QUE SÃO TRÊS
 *
 *   'claude-code' — a CLI do Claude Code, que o usuário já paga por assinatura.
 *   'chatgpt'     — a CLI do Codex, mesma ideia.
 *   'api'         — o Vercel AI SDK, para as chaves de API que o usuário
 *                   forneceu (OpenAI, Anthropic, Google, DeepSeek, Groq, Ollama).
 *
 * O padrão é 'api', e é o padrão certo: provedor desconhecido é quase sempre um
 * provedor de API novo, e mandá-lo para uma CLI de assinatura falharia com uma
 * mensagem sobre binário não encontrado, que não tem nada a ver com o problema.
 */

'use strict';

/** @typedef {'claude-code'|'chatgpt'|'api'} Runner */

/** As duas pontes de assinatura, pelo nome com que o renderer as chama. */
const PONTES_DE_ASSINATURA = Object.freeze(['claude-code', 'chatgpt']);

/**
 * Qual motor atende este provedor.
 *
 * @param {any} provider
 * @returns {Runner}
 */
function runnerDe(provider) {
  const nome = typeof provider === 'string' ? provider : '';
  return /** @type {Runner} */ (PONTES_DE_ASSINATURA.includes(nome) ? nome : 'api');
}

/**
 * É uma ponte de CLI de assinatura?
 *
 * Usado onde o comportamento difere por causa da CLI e não do provedor: só elas
 * têm processo próprio para matar, sessão para retomar e plano com limite de
 * uso para reportar.
 *
 * @param {any} provider
 */
function ehAssinatura(provider) {
  return runnerDe(provider) !== 'api';
}

module.exports = { PONTES_DE_ASSINATURA, runnerDe, ehAssinatura };
