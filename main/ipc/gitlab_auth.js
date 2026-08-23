// @ts-check
/**
 * gitlab_auth.js, "conecte sua conta GitLab" para o painel de controle de
 * versão. Irmão do `github_auth.js`, com três diferenças que valem explicação.
 *
 * OS DOIS CAMINHOS, IGUAIS AOS DO GITHUB. Entrar de um clique (o fluxo de
 * dispositivo, aquele "digite este código no navegador") e colar um token
 * pessoal. O protocolo do primeiro é o mesmo nas duas forjas, a RFC 8628, e as
 * decisões dele moram em `oauth_device.js`, compartilhadas.
 *
 * A diferença entre as duas não é de importância, é de registro: o fluxo de
 * dispositivo exige um OAuth App registrado NA INSTÂNCIA, e a AURORA tem um no
 * GitHub e ainda não tem no gitlab.com. Sem o identificador, o botão de um
 * clique não aparece e sobra o token, que é exatamente como o `github_auth.js`
 * se comporta quando o identificador dele está vazio. Registrado o aplicativo,
 * basta preencher a constante abaixo, e nenhum outro código muda.
 *
 * A INSTÂNCIA É PARTE DA CONTA. `gitlab.com` é só a instância mais comum: o
 * grupo do laboratório vive lá, mas uma universidade que suba a sua própria
 * continua sendo GitLab. Por isso o host entra junto com o token, é guardado
 * ao lado dele, e toda chamada sai para o host guardado. Só https, porque um
 * token pessoal em texto puro numa rede de laboratório é exatamente o que não
 * pode acontecer.
 *
 * SEM AVATAR EM `data:`. O GitHub precisou disso porque a CSP do renderer
 * bloqueia imagem remota e o avatar vem de outro domínio. Aqui o avatar é
 * buscado do mesmo jeito e virado em `data:` pela mesma razão, então na
 * prática a diferença é só o cabeçalho de autenticação.
 *
 * Cofre (`userData/aurora-gitlab.json`):
 *   { "token": "<base64 cifrado>", "host": "gitlab.com", "tipo": "pat"|"oauth",
 *     "user": { ... } }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app, safeStorage, ipcMain, shell, BrowserWindow } = require('electron');
const log = require('electron-log');

// As decisoes (o que a resposta significa) moram ao lado, em gitlab_api.js, sem
// conhecer https nem safeStorage. Aqui fica o que fala rede e guarda segredo.
const {
  nomeProjetoValido, normalizarHost, mapProject, fimDaPaginacao, erroDeCriacao, mapUser,
} = require('./gitlab_api');
// O fluxo de dispositivo e da RFC 8628, e nao de uma forja: as mesmas decisoes
// servem aqui e no github_auth.js.
const { intervaloInicialMs, decidirPolling } = require('./oauth_device');
const { GITLAB_API_MS, GITLAB_AVATAR_MS } = require('../net/timeouts');

/**
 * OAuth App do GitLab, para o login de um clique. O identificador e PUBLICO,
 * como o do GitHub: o fluxo de dispositivo nao usa segredo de cliente, entao
 * ele viaja dentro do aplicativo instalado e pode ser versionado. O `Secret`
 * que o GitLab mostra ao lado NAO e usado por este fluxo e nao entra aqui.
 *
 * Registrado em 23/08/2026 pelo Chrysthofer, em gitlab.com, com
 * "Device authorization grant" marcado, "Confidential" desmarcado e o escopo
 * `api`. Vazio (o estado anterior) significa: sem botao de um clique, so o
 * token, que e o que o github_auth.js faz quando o dele esta vazio. A variavel
 * de ambiente continua valendo para testar outro aplicativo sem mexer aqui.
 */
const OAUTH_CLIENT_ID = process.env.AURORA_GITLAB_CLIENT_ID
  || 'b70359b267755ce70d4ebbb61ca9f801ab7f1cb6220e30d8def9ff34098ea450';
/** `api` cobre listar, criar projeto e as operacoes de repositorio. */
const OAUTH_SCOPE = 'api';

/**
 * Da prazo a uma requisicao. Sem isto, uma rede que aceita a conexao e nao
 * responde, que e o portal cativo de laboratorio, deixaria o handler IPC sem
 * resolver e o painel girando para sempre.
 * @param {import('http').ClientRequest} req
 * @param {number} ms
 * @param {string} rotulo para a mensagem de erro
 */
function comPrazo(req, ms, rotulo) {
  req.setTimeout(ms, () => {
    req.destroy(new Error(`O GitLab nao respondeu em ${Math.round(ms / 1000)}s (${rotulo}).`));
  });
}

function vaultPath() {
  return path.join(app.getPath('userData'), 'aurora-gitlab.json');
}

function readVault() {
  try {
    const parsed = JSON.parse(fs.readFileSync(vaultPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    if (err && err.code !== 'ENOENT') log.warn('[gitlab_auth] read failed:', e);
    return {};
  }
}

function writeVault(/** @type {Record<string, any>} */ vault) {
  fs.mkdirSync(path.dirname(vaultPath()), { recursive: true });
  fs.writeFileSync(vaultPath(), JSON.stringify(vault, null, 2));
}

/**
 * Uma chamada a API v4 da instancia.
 *
 * O cabecalho depende de COMO o token foi obtido: token pessoal vai em
 * `PRIVATE-TOKEN`, token de OAuth vai em `Authorization: Bearer`. Usar o
 * errado devolve 401 sem dizer por que, e por isso o tipo e guardado junto com
 * o token no cofre em vez de adivinhado aqui.
 *
 * @param {string} metodo
 * @param {string} base ex: https://gitlab.com
 * @param {string} rota ex: /user
 * @param {string} token
 * @param {any} [corpo]
 * @param {'pat'|'oauth'} [tipo]
 */
function apiCall(metodo, base, rota, token, corpo, tipo = 'pat') {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(`${base}/api/v4${rota}`); }
    catch (e) { reject(new Error(`Endereco invalido: ${base}`)); return; }
    const dados = corpo === undefined ? null : JSON.stringify(corpo);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: metodo,
      headers: {
        ...(tipo === 'oauth' ? { Authorization: `Bearer ${token}` } : { 'PRIVATE-TOKEN': token }),
        'User-Agent': 'aurora-ide',
        Accept: 'application/json',
        ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        const sc = res.statusCode || 0;
        if (sc >= 200 && sc < 300) {
          try { resolve(body ? JSON.parse(body) : null); } catch (e) { reject(e); }
          return;
        }
        if (sc === 401) { reject(new Error('401 Unauthorized: token invalido ou expirado.')); return; }
        // A mensagem util do GitLab vem em `message` ou `error`, e pode ser
        // objeto ({ name: ["has already been taken"] }); achatar aqui evita
        // que o painel mostre "[object Object]".
        let detalhe = body.slice(0, 200);
        try {
          const j = JSON.parse(body);
          const m = j.message ?? j.error;
          detalhe = typeof m === 'string' ? m : JSON.stringify(m ?? j).slice(0, 200);
        } catch (_) { /* corpo nao e JSON */ }
        reject(new Error(`GitLab ${sc}: ${detalhe}`));
      });
    });
    req.on('error', reject);
    comPrazo(req, GITLAB_API_MS, `${metodo} ${rota}`);
    if (dados) req.write(dados);
    req.end();
  });
}

const apiGet = (base, rota, token, tipo) => apiCall('GET', base, rota, token, undefined, tipo);
const apiPost = (base, rota, token, corpo, tipo) => apiCall('POST', base, rota, token, corpo, tipo);

/** Busca uma imagem e devolve como `data:`, para passar pela CSP do renderer. */
function fetchDataUrl(url, depth = 0) {
  return new Promise((resolve) => {
    if (depth > 3) return resolve(null);
    try {
      const req = https.get(url, { headers: { 'User-Agent': 'aurora-ide' } }, (res) => {
        const sc = res.statusCode || 0;
        if (sc >= 300 && sc < 400 && res.headers.location) {
          res.resume();
          return resolve(fetchDataUrl(res.headers.location, depth + 1));
        }
        if (sc !== 200) { res.resume(); return resolve(null); }
        const type = res.headers['content-type'] || 'image/png';
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(`data:${type};base64,${Buffer.concat(chunks).toString('base64')}`));
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      // Avatar e decoracao: sem resposta, segue sem ele em vez de segurar o login.
      req.setTimeout(GITLAB_AVATAR_MS, () => req.destroy());
    } catch (_) { resolve(null); }
  });
}

/** Só do lado do main: o token guardado, decifrado, ou null. */
function getToken() {
  const { token } = readVault();
  if (!token) return null;
  try {
    return safeStorage.decryptString(Buffer.from(token, 'base64'));
  } catch (e) {
    log.warn('[gitlab_auth] decrypt failed:', e);
    return null;
  }
}

/** A instância guardada, ou gitlab.com quando não há conta conectada. */
function getHost() {
  const { host } = readVault();
  return typeof host === 'string' && host ? host : 'gitlab.com';
}

/** O que sobra depois do cofre: base para as chamadas, ou null sem conta. */
function contaAtual() {
  const token = getToken();
  if (!token) return null;
  const { tipo } = readVault();
  return {
    token,
    host: getHost(),
    base: `https://${getHost()}`,
    // Cofre antigo, gravado antes de o login de um clique existir, nao tem o
    // campo: era token pessoal, e e o padrao certo.
    tipo: tipo === 'oauth' ? 'oauth' : 'pat',
  };
}

/** Valida o token contra a instância, guarda cifrado e cacheia o usuário. */
async function connect(token, hostBruto) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('O token está vazio.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('A cifragem do sistema não está disponível nesta máquina.');
  }
  const alvo = normalizarHost(hostBruto);
  if (!alvo) {
    throw new Error('Endereço inválido. Use algo como gitlab.com, com https.');
  }
  const me = await apiGet(alvo.base, '/user', token.trim(), 'pat');
  const user = mapUser(me, alvo.host);
  // O avatar vira `data:` na hora, porque a CSP do renderer bloqueia imagem
  // remota e assim ele continua aparecendo offline depois de conectar.
  user.avatarDataUrl = user.avatarUrl ? await fetchDataUrl(user.avatarUrl) : null;
  writeVault({
    token: safeStorage.encryptString(token.trim()).toString('base64'),
    host: alvo.host,
    tipo: 'pat',
    user,
  });
  return user;
}

/**
 * Lista todo projeto que o token alcança.
 *
 * `membership=true` traz o que é do usuário e o que ele acessa por grupo, que
 * é o equivalente do `affiliation` do GitHub e é o que faz o grupo nips-cern
 * aparecer. `min_access_level` não entra de propósito: quem só tem leitura num
 * projeto ainda quer cloná-lo.
 */
async function listProjects() {
  const conta = contaAtual();
  if (!conta) throw new Error('Conecte sua conta GitLab primeiro.');
  const perPage = 100;
  const maxPages = 5; // ate ~500 projetos, e limita o pior caso
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const lote = await apiGet(
      conta.base,
      `/projects?membership=true&per_page=${perPage}&order_by=last_activity_at&page=${page}`,
      conta.token,
      conta.tipo,
    );
    if (Array.isArray(lote)) all.push(...lote);
    if (fimDaPaginacao(lote, perPage)) break;
  }
  return all.map(mapProject);
}

/**
 * Cria um projeto na conta do usuário.
 *
 * `namespace_id` fica de fora: sem ele o GitLab cria no espaço pessoal, que é
 * o que "criar um repositório meu" quer dizer. Criar dentro de um grupo é
 * outra decisão (qual grupo?) e pede interface própria.
 */
async function createProject(name, isPrivate) {
  const conta = contaAtual();
  if (!conta) throw new Error('Conecte sua conta GitLab primeiro.');
  if (!nomeProjetoValido(name)) throw new Error('Nome de projeto inválido.');
  try {
    const p = await apiPost(conta.base, '/projects', conta.token, {
      name,
      path: name,
      visibility: isPrivate ? 'private' : 'public',
      initialize_with_readme: false,
    }, conta.tipo);
    return { fullName: p.path_with_namespace, cloneUrl: p.http_url_to_repo, htmlUrl: p.web_url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(erroDeCriacao(msg, name), { cause: e });
  }
}

/** O usuário conectado (sem o token), ou null. */
function getUser() {
  const { user, token } = readVault();
  return token && user ? user : null;
}

function disconnect() {
  try { fs.unlinkSync(vaultPath()); } catch (_) { /* ja nao existe */ }
  return true;
}

/**
 * Sono que acorda antes da hora quando o sinal e abortado, para o laco parar
 * na hora em que o usuario desiste, e nao no proximo tique.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
const sleep = (ms, signal) => new Promise((r) => {
  const t = setTimeout(() => { signal?.removeEventListener('abort', acordar); r(); }, ms);
  function acordar() { clearTimeout(t); r(); }
  signal?.addEventListener('abort', acordar, { once: true });
});

/**
 * O fluxo em andamento, se houver. Um so: comecar outro cancela o anterior,
 * fechar a janela cancela, e o botao Cancelar do painel cancela. Sem isto,
 * quem desiste deixa a AURORA batendo na instancia por um quarto de hora.
 * @type {AbortController|null}
 */
let fluxoAtual = null;

function cancelarFluxo() {
  if (fluxoAtual) { fluxoAtual.abort(); fluxoAtual = null; }
}

/**
 * POST nos endpoints de OAuth, que ficam FORA da API v4 e falam formulario.
 *
 * O corpo de erro tambem e JSON, e e ele que diz "ainda nao autorizou":
 * rejeitar por codigo de status trataria a espera normal como falha.
 */
function oauthPostJson(base, rota, payload) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(base + rota); }
    catch (e) { reject(new Error(`Endereco invalido: ${base}`)); return; }
    const dados = new URLSearchParams(payload).toString();
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(dados),
        'User-Agent': 'aurora-ide',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`OAuth ${res.statusCode}: ${body.slice(0, 160)}`)); }
      });
    });
    req.on('error', reject);
    comPrazo(req, GITLAB_API_MS, `POST ${rota}`);
    req.write(dados);
    req.end();
  });
}

/**
 * Entrar de um clique: pede o codigo, mostra ao usuario, abre o navegador e
 * pergunta ate ele autorizar. No fim guarda o token igual ao caminho do token
 * pessoal, entao o resto do modulo nao muda.
 *
 * @param {any} sender webContents que pediu, para receber o codigo ao vivo
 * @param {string} [hostBruto] a instancia; vazio significa gitlab.com
 */
async function deviceFlowLogin(sender, hostBruto) {
  if (!OAUTH_CLIENT_ID) throw new Error('O login de um clique ainda nao esta configurado para o GitLab.');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('A cifragem do sistema nao esta disponivel nesta maquina.');
  }
  const alvo = normalizarHost(hostBruto);
  if (!alvo) throw new Error('Endereco invalido. Use algo como gitlab.com, com https.');

  const start = await oauthPostJson(alvo.base, '/oauth/authorize_device', {
    client_id: OAUTH_CLIENT_ID,
    scope: OAUTH_SCOPE,
  });
  if (!start || !start.device_code) {
    throw new Error((start && start.error_description) || 'Nao consegui iniciar o login.');
  }
  try {
    sender && sender.send('gitlab:oauth-code', {
      userCode: start.user_code,
      verificationUri: start.verification_uri,
      expiresIn: start.expires_in,
    });
  } catch (_) { /* janela sumiu */ }
  // O `_complete` ja leva o codigo na URL, entao o usuario so confirma.
  try { await shell.openExternal(start.verification_uri_complete || start.verification_uri); }
  catch (_) { /* da para abrir a mao */ }

  cancelarFluxo();
  const fluxo = new AbortController();
  fluxoAtual = fluxo;
  const aoSumir = () => fluxo.abort();
  try { sender && sender.once('destroyed', aoSumir); } catch (_) { /* sem sender */ }

  try {
    let intervalMs = intervaloInicialMs(start);
    const deadline = Date.now() + ((start.expires_in || 900) * 1000);
    while (Date.now() < deadline) {
      await sleep(intervalMs, fluxo.signal);
      if (fluxo.signal.aborted) throw new Error('Login cancelado.');
      const tok = await oauthPostJson(alvo.base, '/oauth/token', {
        client_id: OAUTH_CLIENT_ID,
        device_code: start.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
      const passo = decidirPolling(tok);
      if (passo.acao === 'esperar') continue;
      if (passo.acao === 'desacelerar') { intervalMs += passo.acrescimoMs; continue; }
      if (passo.acao === 'falhar') throw new Error(passo.mensagem);

      // Token de OAuth vai por Bearer, e nao por PRIVATE-TOKEN; o tipo e
      // guardado para as chamadas seguintes nao terem que adivinhar.
      const me = await apiGet(alvo.base, '/user', passo.token, 'oauth');
      const user = mapUser(me, alvo.host);
      user.avatarDataUrl = user.avatarUrl ? await fetchDataUrl(user.avatarUrl) : null;
      writeVault({
        token: safeStorage.encryptString(passo.token).toString('base64'),
        host: alvo.host,
        tipo: 'oauth',
        user,
      });
      return user;
    }
    throw new Error('O tempo de autorizacao acabou.');
  } finally {
    try { sender && sender.removeListener('destroyed', aoSumir); } catch (_) { /* sem sender */ }
    if (fluxoAtual === fluxo) fluxoAtual = null;
  }
}

function register() {
  ipcMain.handle('gitlab:oauth-configured', () => ({ configured: !!OAUTH_CLIENT_ID }));
  ipcMain.handle('gitlab:oauth-cancel', () => { cancelarFluxo(); return { ok: true }; });
  ipcMain.handle('gitlab:oauth-login', async (event, opts) => {
    try {
      const user = await deviceFlowLogin(event.sender, opts && opts.host);
      // O usuario acabou de autorizar no NAVEGADOR: traz a AURORA de volta
      // para a frente para ele nao ter que procurar a janela.
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.setAlwaysOnTop(true);
          win.focus();
          win.setAlwaysOnTop(false);
        }
      } catch (_) { /* melhor esforco */ }
      return { ok: true, user };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  ipcMain.handle('gitlab:status', () => {
    const user = getUser();
    return { connected: !!user, user, host: getHost() };
  });
  ipcMain.handle('gitlab:connect', async (_event, opts) => {
    try {
      const token = typeof opts === 'string' ? opts : (opts && opts.token);
      const host = typeof opts === 'string' ? '' : (opts && opts.host);
      const user = await connect(token, host);
      return { ok: true, user };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('gitlab:disconnect', () => {
    disconnect();
    return { ok: true };
  });
  ipcMain.handle('gitlab:create-repo', async (_event, opts) => {
    try {
      const r = await createProject(opts && opts.name, opts && opts.private);
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('gitlab:list-repos', async () => {
    try {
      return { ok: true, repos: await listProjects() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  log.info('[ipc.gitlab_auth] handlers registered');
}

module.exports = {
  register, getToken, getUser, getHost, connect, disconnect, createProject,
  cancelarFluxo,
};
