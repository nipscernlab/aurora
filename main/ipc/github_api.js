// @ts-check
/**
 * github_api.js: as decisões do `github_auth.js`, separadas do que fala rede.
 *
 * O `github_auth.js` faz três coisas misturadas: requisição HTTPS, guarda de
 * token cifrado, e um punhado de decisões sobre o que a resposta significa.
 * Só a terceira parte precisa de prova, e era a única que não dava para
 * escrever teste sem um servidor falso.
 *
 * O que mora aqui não conhece `https`, nem `safeStorage`, nem `ipcMain`.
 */

'use strict';

/** Nome de repositório aceito pela API do GitHub, na forma que usamos. */
const NOME_REPO = /^[A-Za-z0-9._-]+$/;

/**
 * O nome serve para criar repositório?
 * @param {any} nome
 * @returns {boolean}
 */
function nomeRepoValido(nome) {
  return typeof nome === 'string' && NOME_REPO.test(nome);
}

/**
 * Uma entrada da lista de repositórios, na forma que o painel consome.
 *
 * Tudo que vem do `owner` é opcional de propósito: repositório sem dono no
 * corpo da resposta é raro, mas acontece com token de escopo estreito, e um
 * acesso direto a `r.owner.login` derrubaria a listagem inteira por causa de
 * uma linha.
 *
 * @param {any} r
 */
function mapRepo(r) {
  const dono = r && r.owner;
  return {
    name: r.name,
    fullName: r.full_name,
    cloneUrl: r.clone_url,
    htmlUrl: r.html_url,
    private: r.private,
    description: r.description || '',
    updatedAt: r.updated_at,
    owner: dono ? dono.login : null,
    ownerType: dono ? dono.type : null, // 'User' | 'Organization'
    fork: !!r.fork,
    // De qual forja veio. O painel lista GitHub e GitLab na mesma lista, e sem
    // isto ele nao teria como dizer ao usuario de onde cada linha vem.
    forge: 'github',
  };
}

/**
 * Acabou a paginação?
 *
 * O `apiGet` não expõe o cabeçalho `Link`, então a parada é por página curta:
 * uma página com menos que o pedido é a última. Página vazia também para, e é
 * o caso do usuário cujo total é múltiplo exato do tamanho da página.
 *
 * @param {any[]} pagina
 * @param {number} porPagina
 */
function fimDaPaginacao(pagina, porPagina) {
  return !Array.isArray(pagina) || pagina.length === 0 || pagina.length < porPagina;
}

/**
 * Traduz a recusa da API ao criar repositório para uma frase que diz o que
 * fazer.
 *
 * As duas traduções existem porque a mensagem crua não ajuda ninguém. Um token
 * de escopo fino, ou clássico sem `repo`, recebe "Resource not accessible",
 * que não diz que o problema é o TIPO do token; e nome repetido recebe "name
 * already exists on this account", que não diz qual nome.
 *
 * @param {string} mensagem mensagem crua da API
 * @param {string} nome nome que se tentou criar
 * @returns {string} mensagem para o usuário
 */
function erroDeCriacao(mensagem, nome) {
  const m = String(mensagem || '');
  if (/not accessible|forbidden|403/i.test(m)) {
    return 'O token não pode criar repositórios. Use um token CLÁSSICO com o escopo "repo" — github.com/settings/tokens/new';
  }
  if (/already exists|name already/i.test(m)) {
    return `Já existe um repositório "${nome}" na sua conta.`;
  }
  return m;
}

/**
 * Intervalo inicial entre duas consultas do fluxo de dispositivo.
 *
 * O GitHub diz de quantos em quantos segundos consultar e responde `slow_down`
 * se a gente encostar no limite. O segundo a mais é folga deliberada: bater no
 * limite custa uma rodada inteira de espera, e um segundo a menos não encurta
 * nada perceptível para quem está digitando o código no navegador.
 *
 * @param {any} inicio resposta de /login/device/code
 */
function intervaloInicialMs(inicio) {
  const s = Number(inicio && inicio.interval);
  return ((Number.isFinite(s) && s > 0 ? s : 5) + 1) * 1000;
}

/**
 * O que fazer com uma resposta de `/login/oauth/access_token`.
 *
 * Esta é a decisão que estava presa dentro de um laço com `sleep`, e por isso
 * inalcançável por teste. Ela tem cinco saídas e cada uma erra de um jeito
 * diferente se trocada: tratar `authorization_pending` como falha aborta o
 * fluxo enquanto o usuário ainda está digitando o código; tratar `slow_down`
 * como "continuar igual" faz o GitHub cortar; e tratar erro desconhecido como
 * "continuar" deixa o laço rodando até o prazo acabar sem dizer por quê.
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
  if (erro === 'expired_token') return { acao: 'falhar', mensagem: 'The code expired — please try again.' };
  if (erro === 'access_denied') return { acao: 'falhar', mensagem: 'Authorization was denied.' };
  return { acao: 'falhar', mensagem: (tok && tok.error_description) || erro || 'OAuth failed.' };
}

module.exports = {
  NOME_REPO,
  nomeRepoValido,
  mapRepo,
  fimDaPaginacao,
  erroDeCriacao,
  intervaloInicialMs,
  decidirPolling,
};
