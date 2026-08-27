// @ts-check
/**
 * oauth_device.js: as regras do fluxo de dispositivo, que são da RFC 8628 e
 * não de nenhuma forja.
 *
 * Estavam dentro do `github_api.js` porque o GitHub foi o primeiro a usá-las.
 * Quando o GitLab entrou, em 23/08/2026, ficou claro que não são dele nem do
 * outro: o "digite este código no navegador" é o mesmo protocolo nos dois, com
 * os mesmos nomes de erro (`authorization_pending`, `slow_down`,
 * `expired_token`, `access_denied`), porque os dois implementam a mesma RFC.
 * Copiar seria manter duas cópias de uma decisão que erra de cinco jeitos
 * diferentes; deixar no módulo do GitHub seria o GitLab importar do vizinho.
 *
 * O `github_api.js` reexporta as duas para não quebrar quem já importava de lá.
 *
 * Puro: não conhece `https`, nem `safeStorage`, nem `ipcMain`.
 */

'use strict';

/**
 * De quanto em quanto tempo perguntar "já autorizou?".
 *
 * O servidor manda o mínimo em `interval` (5 s quando não manda). Somamos um
 * segundo porque bater exatamente no mínimo é o que faz o servidor responder
 * `slow_down`, e um segundo a mais não é nada perceptível para quem está
 * digitando o código no navegador.
 *
 * @param {any} inicio resposta do pedido de código
 */
function intervaloInicialMs(inicio) {
  const s = Number(inicio && inicio.interval);
  return ((Number.isFinite(s) && s > 0 ? s : 5) + 1) * 1000;
}

/**
 * O que fazer com uma resposta do endpoint de token.
 *
 * Esta é a decisão que vivia presa dentro de um laço com `sleep`, e por isso
 * inalcançável por teste. Ela tem cinco saídas e cada uma erra de um jeito
 * diferente se trocada: tratar `authorization_pending` como falha aborta o
 * fluxo enquanto o usuário ainda está digitando o código; tratar `slow_down`
 * como "continuar igual" faz o servidor cortar; e tratar erro desconhecido
 * como "continuar" deixa o laço rodando até o prazo acabar sem dizer por quê.
 *
 * @param {any} tok resposta da API
 * @returns {{acao:'pronto', token:string}
 *          |{acao:'esperar'}
 *          |{acao:'desacelerar', acrescimoMs:number}
 *          |{acao:'falhar', mensagem:string}}
 */
function decidirPolling(tok) {
  if (tok && tok.access_token) return { acao: 'pronto', token: String(tok.access_token) };

  const erro = tok && tok.error;
  if (erro === 'authorization_pending') return { acao: 'esperar' };
  if (erro === 'slow_down') {
    const s = Number(tok && tok.interval);
    return { acao: 'desacelerar', acrescimoMs: (Number.isFinite(s) && s > 0 ? s : 5) * 1000 };
  }
  if (erro === 'expired_token') return { acao: 'falhar', mensagem: 'The code expired, please try again.' };
  if (erro === 'access_denied') return { acao: 'falhar', mensagem: 'Authorization was denied.' };
  return { acao: 'falhar', mensagem: (tok && tok.error_description) || erro || 'OAuth failed.' };
}

module.exports = { intervaloInicialMs, decidirPolling };
