// @ts-check
/**
 * gitlab_auth.js, "conecte sua conta GitLab" para o painel de controle de
 * versão. Irmão do `github_auth.js`, com três diferenças que valem explicação.
 *
 * SÓ TOKEN PESSOAL. O GitHub ganhou o fluxo de dispositivo porque a AURORA tem
 * um OAuth App registrado lá; no GitLab isso exigiria registrar um aplicativo
 * em cada instância, inclusive nas próprias, e o laboratório usa mais de uma.
 * O token pessoal funciona igual nas duas e não depende de registro nenhum.
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
 *   { "token": "<base64 cifrado>", "host": "gitlab.com", "user": { ... } }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app, safeStorage, ipcMain } = require('electron');
const log = require('electron-log');

// As decisoes (o que a resposta significa) moram ao lado, em gitlab_api.js, sem
// conhecer https nem safeStorage. Aqui fica o que fala rede e guarda segredo.
const {
  nomeProjetoValido, normalizarHost, mapProject, fimDaPaginacao, erroDeCriacao, mapUser,
} = require('./gitlab_api');
const { GITLAB_API_MS, GITLAB_AVATAR_MS } = require('../net/timeouts');

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
 * O cabecalho e `PRIVATE-TOKEN`, que e o do token pessoal; `Authorization:
 * Bearer` vale so para token de OAuth, e usar o errado devolve 401 sem dizer
 * por que.
 *
 * @param {string} metodo
 * @param {string} base ex: https://gitlab.com
 * @param {string} rota ex: /user
 * @param {string} token
 * @param {any} [corpo]
 */
function apiCall(metodo, base, rota, token, corpo) {
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
        'PRIVATE-TOKEN': token,
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

const apiGet = (base, rota, token) => apiCall('GET', base, rota, token);
const apiPost = (base, rota, token, corpo) => apiCall('POST', base, rota, token, corpo);

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
  return { token, host: getHost(), base: `https://${getHost()}` };
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
  const me = await apiGet(alvo.base, '/user', token.trim());
  const user = mapUser(me, alvo.host);
  // O avatar vira `data:` na hora, porque a CSP do renderer bloqueia imagem
  // remota e assim ele continua aparecendo offline depois de conectar.
  user.avatarDataUrl = user.avatarUrl ? await fetchDataUrl(user.avatarUrl) : null;
  writeVault({
    token: safeStorage.encryptString(token.trim()).toString('base64'),
    host: alvo.host,
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
    });
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

function register() {
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
  register, getToken, getUser, getHost, connect, disconnect, createProject, listProjects,
};
