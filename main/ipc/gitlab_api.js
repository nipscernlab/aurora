// @ts-check
/**
 * gitlab_api.js: as decisões do `gitlab_auth.js`, separadas do que fala rede.
 *
 * Mesma divisão do `github_api.js`, e pelo mesmo motivo: o módulo de
 * autenticação mistura requisição HTTPS, guarda de token cifrado e um punhado
 * de decisões sobre o que a resposta significa. Só a terceira parte precisa de
 * prova, e é a única que não daria para testar sem um servidor falso.
 *
 * O que mora aqui não conhece `https`, nem `safeStorage`, nem `ipcMain`.
 *
 * POR QUE O GITLAB PRECISA DE UM MÓDULO PRÓPRIO, E NÃO DE UM `if`
 * ---------------------------------------------------------------
 * As duas APIs respondem a mesma pergunta com palavras diferentes, e a
 * tradução é o trabalho: no GitHub um repositório é `full_name` e `clone_url`,
 * no GitLab é `path_with_namespace` e `http_url_to_repo`; lá privado é um
 * booleano, aqui é `visibility` com três valores; lá o dono é `owner.type`
 * com 'User' ou 'Organization', aqui é `namespace.kind` com 'user' ou 'group'.
 * Um `if` espalhado por dentro do outro módulo esconderia essas seis decisões
 * no meio do código de rede.
 *
 * A saída de `mapProject` é DELIBERADAMENTE a mesma forma de `mapRepo`, para o
 * painel listar as duas origens sem saber de qual vieram.
 */

'use strict';

/**
 * Caminho de projeto aceito pelo GitLab.
 *
 * Regra do próprio GitLab: letras, dígitos, `_`, `-` e `.`; tem que começar
 * com letra ou dígito; e não pode terminar em `.git` nem em `.atom`, que são
 * sufixos que a interface web usa para outra coisa e o servidor recusa.
 */
const CAMINHO_PROJETO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * O nome serve para criar projeto?
 * @param {any} nome
 * @returns {boolean}
 */
function nomeProjetoValido(nome) {
  if (typeof nome !== 'string' || !CAMINHO_PROJETO.test(nome)) return false;
  const min = nome.toLowerCase();
  return !min.endsWith('.git') && !min.endsWith('.atom');
}

/**
 * A instância do GitLab, a partir do que o usuário digitou.
 *
 * Aceita `gitlab.com`, `https://gitlab.com`, `https://gitlab.com/` e
 * `gitlab.exemplo.edu.br:8443`, porque quem copia o endereço da barra do
 * navegador traz o esquema e a barra final junto. Devolve null para o que não
 * é host, em vez de montar uma URL que só falharia na hora da requisição.
 *
 * Só https: um token pessoal em texto puro numa rede de laboratório é
 * exatamente o que não pode acontecer.
 *
 * @param {any} entrada
 * @returns {{ host: string, base: string } | null}
 */
function normalizarHost(entrada) {
  const cru = String(entrada ?? '').trim();
  if (!cru) return { host: 'gitlab.com', base: 'https://gitlab.com' };
  if (/^http:\/\//i.test(cru)) return null;
  const semEsquema = cru.replace(/^https:\/\//i, '').replace(/\/+$/, '');
  // Sobra host (e porta). Caminho, credencial embutida e consulta caem fora.
  const host = semEsquema.split('/')[0].split('?')[0].split('#')[0];
  if (!host || !/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) return null;
  return { host, base: `https://${host}` };
}

/**
 * Uma entrada da lista de projetos, na forma que o painel consome (a mesma do
 * `mapRepo` do GitHub).
 *
 * Tudo que vem do `namespace` é opcional de propósito: um projeto sem
 * namespace no corpo da resposta é raro, mas um acesso direto a
 * `p.namespace.kind` derrubaria a listagem inteira por causa de uma linha.
 *
 * @param {any} p
 */
function mapProject(p) {
  const ns = p && p.namespace;
  return {
    name: p.name,
    fullName: p.path_with_namespace,
    cloneUrl: p.http_url_to_repo,
    htmlUrl: p.web_url,
    // `visibility` tem três valores; para o painel só interessa se é público.
    // 'internal' (visível a quem tem conta na instância) conta como privado,
    // que é o lado seguro do erro: mostrar cadeado a mais, nunca a menos.
    private: p.visibility !== 'public',
    description: p.description || '',
    updatedAt: p.last_activity_at,
    owner: ns ? (ns.full_path || ns.path || null) : null,
    // Traduzido para o vocabulário do painel, que já agrupa por 'Organization'.
    ownerType: ns ? (ns.kind === 'group' ? 'Organization' : 'User') : null,
    fork: !!p.forked_from_project,
    forge: 'gitlab',
  };
}

/**
 * Acabou a paginação?
 *
 * Mesma regra do GitHub, e pelo mesmo motivo: o cabeçalho `x-total-pages`
 * existe no GitLab, mas o `apiGet` não expõe cabeçalho, então a parada é por
 * página curta. Página vazia também para.
 *
 * @param {any[]} pagina
 * @param {number} porPagina
 */
function fimDaPaginacao(pagina, porPagina) {
  return !Array.isArray(pagina) || pagina.length === 0 || pagina.length < porPagina;
}

/**
 * Traduz a recusa da API ao criar projeto para uma frase que diz o que fazer.
 *
 * As mensagens cruas do GitLab não ajudam: um token sem o escopo `api` recebe
 * "403 Forbidden", que não diz que o problema é o ESCOPO e não a permissão no
 * grupo; e nome repetido recebe "has already been taken", sem dizer qual nome
 * nem onde.
 *
 * @param {string} mensagem mensagem crua da API
 * @param {string} nome nome que se tentou criar
 * @returns {string} mensagem para o usuário
 */
function erroDeCriacao(mensagem, nome) {
  const m = String(mensagem || '');
  if (/already been taken|already exists/i.test(m)) {
    return `Já existe um projeto chamado "${nome}" nessa conta.`;
  }
  if (/\b403\b|forbidden|insufficient_scope/i.test(m)) {
    return 'O token não tem o escopo "api", que é o necessário para criar projeto. '
      + 'Gere outro em Preferences > Access tokens marcando "api".';
  }
  if (/\b401\b|unauthorized|invalid_token/i.test(m)) {
    return 'O token foi recusado. Ele pode ter expirado ou sido revogado.';
  }
  return m;
}

/**
 * O que o painel mostra sobre a conta conectada, a partir da resposta de
 * `/user`.
 *
 * O GitLab chama de `username` o que o GitHub chama de `login`; o painel já
 * fala `login`, então a tradução acontece aqui e não na interface.
 *
 * @param {any} me
 * @param {string} host
 */
function mapUser(me, host) {
  return {
    login: me.username,
    name: me.name || me.username,
    avatarUrl: me.avatar_url || null,
    webUrl: me.web_url || null,
    host,
  };
}

module.exports = {
  nomeProjetoValido,
  normalizarHost,
  mapProject,
  fimDaPaginacao,
  erroDeCriacao,
  mapUser,
};
