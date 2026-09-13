// @ts-check
/**
 * history.js: o historico local de cada arquivo do projeto.
 *
 * O QUE ISTO RESOLVE. Aluno perde trabalho. Salva por cima do que funcionava,
 * deixa a IA reescrever um arquivo e se arrepende, apaga o que nao devia. O
 * git ajuda quem faz commit, e quem esta aprendendo raramente faz na hora
 * certa. O VS Code guarda cada gravacao de cada arquivo e deixa voltar; e o
 * que se faz aqui.
 *
 * ONDE MORA. `<projeto>/.aurora/historico/<chave>/`, uma pasta por arquivo,
 * com `indice.json` (o caminho do arquivo e a lista de versoes) e um `.txt`
 * por versao. Dentro do projeto, e nao no perfil do usuario, pela mesma razao
 * do registro de execucoes (run_log.js): copiar o projeto leva o historico
 * junto, apagar o projeto apaga o historico junto. A `.aurora` ja e oculta e o
 * `historico/` entra no `.gitignore` dela (project_temp.js): e da maquina, nao
 * do repositorio.
 *
 * A CHAVE E UM HASH do caminho relativo, e nao o caminho: o caminho tem barras,
 * pode ter espaco e acento, e no Windows `Top.v` e `top.v` sao o mesmo arquivo.
 * O caminho legivel fica dentro do indice, que e quem o mostra.
 *
 * QUEM GRAVA. O funil `write-file` de main/ipc/files.js, por onde passam TODAS
 * as gravacoes: o salvar do editor, o `create_file` da Aurora Intelligence, a
 * substituicao em arquivos. Um funil so, entao nenhum caminho de escrita fica
 * de fora sem que alguem o tenha tirado de proposito. Alem dele, o apagar
 * (`delete-file` e `file:trash`) grava a ultima versao ANTES de apagar, senao
 * a unica copia iria junto.
 *
 * A PRIMEIRA GRAVACAO GUARDA O ANTES. Se um arquivo nunca teve historico e vai
 * ser sobrescrito, o conteudo que estava no disco e guardado primeiro, como
 * versao inicial. Sem isso, a primeira edicao depois de ligar o historico
 * perderia justamente o estado de que se quer voltar.
 *
 * O QUE NAO ENTRA. Arquivo fora do projeto, arquivo dentro da propria
 * `.aurora` (guardar o historico do historico e recursao sem fim), binario
 * (byte NUL nos primeiros 4 KB) e arquivo acima de 1,5 MB, que nao e codigo.
 * Conteudo identico a ultima versao tambem nao entra: salvar sem mudar nada e
 * o gesto mais comum que existe, e cada um viraria uma copia igual.
 *
 * LIMITES. 50 versoes por arquivo, e 20 MB por arquivo. Passou, sai a mais
 * antiga. O valor do historico esta nas ultimas horas e dias de trabalho, e
 * cinquenta gravacoes cobrem isso com folga.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('electron-log');

const { ocultarPastaDeSistemaEm } = require('../pastas_ocultas');

const PASTA = path.join('.aurora', 'historico');
const LIMITE_VERSOES = 50;
const LIMITE_BYTES_POR_ARQUIVO = 20 * 1024 * 1024;
const MAX_ARQUIVO_BYTES = 1.5 * 1024 * 1024;
const BYTES_SONDA_BINARIO = 4096;

/** O `indice.json` de um arquivo, como fica no disco. */
const INDICE_VAZIO = () => ({ formato: 1, arquivo: '', versoes: [] });

// ── caminhos ─────────────────────────────────────────────────────────────────────

/**
 * A pasta de historico do projeto, ou null quando o projeto nao serve.
 * @param {unknown} projeto
 */
function pastaDoProjeto(projeto) {
  if (!projeto || typeof projeto !== 'string' || !path.isAbsolute(projeto)) return null;
  return path.join(path.resolve(projeto), PASTA);
}

/**
 * O caminho do arquivo relativo ao projeto, com barras normais, ou null quando
 * o arquivo esta fora do projeto ou dentro da `.aurora`.
 *
 * Fora do projeto nao ha onde guardar (o historico e do projeto); dentro da
 * `.aurora` seria guardar o historico do proprio historico.
 *
 * @param {string} projeto
 * @param {string} arquivo
 */
function relativoAoProjeto(projeto, arquivo) {
  if (!projeto || !arquivo || !path.isAbsolute(arquivo)) return null;
  const rel = path.relative(path.resolve(projeto), path.resolve(arquivo));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const partes = rel.split(path.sep);
  if (partes.some((p) => p.toLowerCase() === '.aurora')) return null;
  return partes.join('/');
}

/**
 * A chave (nome da pasta) de um arquivo do projeto.
 *
 * Hash do caminho relativo em minusculas: no Windows `Top.v` e `top.v` sao o
 * mesmo arquivo, e duas pastas para um arquivo so quebrariam a linha do
 * historico ao primeiro renomear de caixa.
 *
 * @param {string} relativo caminho relativo com barras normais
 */
function chaveDe(relativo) {
  return crypto.createHash('sha1').update(String(relativo).toLowerCase(), 'utf8').digest('hex').slice(0, 20);
}

function pastaDoArquivo(projeto, relativo) {
  const base = pastaDoProjeto(projeto);
  return base ? path.join(base, chaveDe(relativo)) : null;
}

/** `2026-09-13T10-42-07-318`: ordena por nome e e seguro como nome de arquivo. */
function idDe(agora) {
  return new Date(agora).toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
}

const ID_VALIDO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}(-[0-9]+)?$/;

// ── o que nao entra ────────────────────────────────────────────────────────────────

/** Binario pela sonda de NUL, o mesmo criterio da busca em arquivos. */
function pareceBinario(/** @type {string|Buffer} */ conteudo) {
  const b = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(String(conteudo), 'utf8');
  const fim = Math.min(b.length, BYTES_SONDA_BINARIO);
  for (let i = 0; i < fim; i += 1) if (b[i] === 0) return true;
  return false;
}

/**
 * Decide se um conteudo pode virar versao.
 * @param {string|Buffer} conteudo
 * @returns {{ ok: true } | { ok: false, motivo: string }}
 */
function conteudoGuardavel(conteudo) {
  const bytes = Buffer.isBuffer(conteudo) ? conteudo.length : Buffer.byteLength(String(conteudo), 'utf8');
  if (bytes > MAX_ARQUIVO_BYTES) return { ok: false, motivo: 'grande' };
  if (pareceBinario(conteudo)) return { ok: false, motivo: 'binario' };
  return { ok: true };
}

/**
 * Quais versoes sair para caber nos limites: as mais antigas primeiro.
 * Puro, para o teste: recebe a lista (mais antiga primeiro) e devolve os ids.
 *
 * @param {Array<{id:string, bytes:number}>} versoes da mais antiga para a mais nova
 * @param {{ limiteVersoes?: number, limiteBytes?: number }} [limites]
 */
function podarVersoes(versoes, { limiteVersoes = LIMITE_VERSOES, limiteBytes = LIMITE_BYTES_POR_ARQUIVO } = {}) {
  const sair = [];
  let restantes = versoes.slice();
  let bytes = restantes.reduce((s, v) => s + (v.bytes || 0), 0);
  while (restantes.length > limiteVersoes || (bytes > limiteBytes && restantes.length > 1)) {
    const velha = restantes.shift();
    if (!velha) break;
    bytes -= velha.bytes || 0;
    sair.push(velha.id);
  }
  return sair;
}

// ── indice ───────────────────────────────────────────────────────────────────────

function lerIndice(pasta) {
  try {
    const bruto = fs.readFileSync(path.join(pasta, 'indice.json'), 'utf8');
    const d = JSON.parse(bruto);
    if (!d || !Array.isArray(d.versoes)) return INDICE_VAZIO();
    return d;
  } catch {
    return INDICE_VAZIO();
  }
}

function gravarIndice(pasta, indice) {
  const alvo = path.join(pasta, 'indice.json');
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(indice, null, 2), 'utf8');
  fs.renameSync(tmp, alvo);
}

function sha1De(/** @type {string} */ texto) {
  return crypto.createHash('sha1').update(texto, 'utf8').digest('hex');
}

// ── gravar, listar, ler ───────────────────────────────────────────────────────────────

/**
 * Guarda uma versao de um arquivo. Sincrona e de melhor esforco: quem chama
 * ja gravou (ou vai apagar) o arquivo de verdade, e falhar aqui nao pode
 * virar erro para a pessoa.
 *
 * @param {string} projeto raiz do projeto
 * @param {string} arquivo caminho absoluto do arquivo
 * @param {string|Buffer} conteudo
 * @param {{ origem?: string, rotulo?: string|null, agora?: number }} [meta]
 * @returns {{ ok: boolean, id?: string, motivo?: string }}
 */
function gravarVersao(projeto, arquivo, conteudo, { origem = 'salvar', rotulo = null, agora = Date.now() } = {}) {
  const relativo = relativoAoProjeto(projeto, arquivo);
  if (!relativo) return { ok: false, motivo: 'fora' };
  const cabe = conteudoGuardavel(conteudo);
  if (!cabe.ok) return { ok: false, motivo: cabe.motivo };

  const texto = Buffer.isBuffer(conteudo) ? conteudo.toString('utf8') : String(conteudo);
  const pasta = pastaDoArquivo(projeto, relativo);
  if (!pasta) return { ok: false, motivo: 'projeto' };

  fs.mkdirSync(pasta, { recursive: true });
  // A `.aurora` pode nascer aqui, antes de qualquer abertura marca-la.
  ocultarPastaDeSistemaEm(pasta);

  const indice = lerIndice(pasta);
  indice.arquivo = relativo;
  const hash = sha1De(texto);
  const ultima = indice.versoes[indice.versoes.length - 1];
  // Salvar sem mudar nada e o gesto mais comum que existe. Cada um viraria uma
  // copia igual a anterior, e a lista ficaria cheia de versoes que nao sao.
  if (ultima && ultima.hash === hash) return { ok: true, id: ultima.id, motivo: 'igual' };

  let id = idDe(agora);
  // Duas gravacoes no mesmo milissegundo (o "antes" e o "depois" da primeira
  // gravacao, por exemplo): a segunda ganha um sufixo em vez de sobrescrever.
  let n = 1;
  while (indice.versoes.some((v) => v.id === id)) { id = `${idDe(agora)}-${n}`; n += 1; }

  const alvo = path.join(pasta, `${id}.txt`);
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, texto, 'utf8');
  fs.renameSync(tmp, alvo);

  indice.versoes.push({
    id,
    quando: agora,
    bytes: Buffer.byteLength(texto, 'utf8'),
    linhas: texto.split('\n').length,
    hash,
    origem,
    rotulo: rotulo || null,
  });

  for (const velha of podarVersoes(indice.versoes)) {
    indice.versoes = indice.versoes.filter((v) => v.id !== velha);
    try { fs.unlinkSync(path.join(pasta, `${velha}.txt`)); } catch { /* ja nao estava */ }
  }
  gravarIndice(pasta, indice);
  return { ok: true, id };
}

/**
 * O "antes" da primeira gravacao. Se o arquivo ainda nao tem historico e ja
 * existe no disco, o conteudo atual do disco vira a versao inicial, para que
 * o estado anterior a primeira edicao tambem tenha para onde voltar.
 *
 * @param {string} projeto
 * @param {string} arquivo
 * @param {number} [agora]
 */
function guardarAntesSePrimeira(projeto, arquivo, agora = Date.now()) {
  const relativo = relativoAoProjeto(projeto, arquivo);
  if (!relativo) return { ok: false, motivo: 'fora' };
  const pasta = pastaDoArquivo(projeto, relativo);
  if (!pasta) return { ok: false, motivo: 'projeto' };
  if (fs.existsSync(path.join(pasta, 'indice.json'))) return { ok: true, motivo: 'ja-tem' };
  let antes;
  try { antes = fs.readFileSync(arquivo); } catch { return { ok: true, motivo: 'novo' }; }
  // Um milissegundo antes, para a versao inicial ordenar antes da gravacao
  // que a motivou mesmo quando as duas cabem no mesmo instante.
  return gravarVersao(projeto, arquivo, antes, { origem: 'inicial', agora: agora - 1 });
}

/**
 * As versoes de um arquivo, da mais nova para a mais antiga, sem o conteudo.
 * @param {string} projeto
 * @param {string} arquivo
 */
function listar(projeto, arquivo) {
  const relativo = relativoAoProjeto(projeto, arquivo);
  if (!relativo) return { ok: false, erro: 'fora do projeto', versoes: [] };
  const pasta = pastaDoArquivo(projeto, relativo);
  if (!pasta || !fs.existsSync(pasta)) return { ok: true, arquivo: relativo, versoes: [] };
  const indice = lerIndice(pasta);
  const versoes = indice.versoes
    .slice()
    .reverse()
    .map((v) => ({ id: v.id, quando: v.quando, bytes: v.bytes, linhas: v.linhas, origem: v.origem, rotulo: v.rotulo || null }));
  return { ok: true, arquivo: relativo, versoes };
}

/**
 * O conteudo de uma versao.
 * @param {string} projeto
 * @param {string} arquivo
 * @param {string} id
 */
function ler(projeto, arquivo, id) {
  if (!ID_VALIDO.test(String(id || ''))) return { ok: false, erro: 'id invalido' };
  const relativo = relativoAoProjeto(projeto, arquivo);
  if (!relativo) return { ok: false, erro: 'fora do projeto' };
  const pasta = pastaDoArquivo(projeto, relativo);
  if (!pasta) return { ok: false, erro: 'projeto invalido' };
  try {
    return { ok: true, id, conteudo: fs.readFileSync(path.join(pasta, `${id}.txt`), 'utf8') };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

// ── os ganchos que files.js chama ───────────────────────────────────────────────────────

/**
 * Antes de uma gravacao pelo `write-file`: guarda o estado do disco se for a
 * primeira vez. Sincrono porque precisa acontecer ANTES de o arquivo mudar.
 * Nunca lanca.
 * @param {string|null} projeto
 * @param {string} arquivo
 */
function antesDeGravar(projeto, arquivo) {
  if (!projeto) return;
  try { guardarAntesSePrimeira(projeto, arquivo); }
  catch (e) { log.debug('[historico] antes-de-gravar falhou:', e instanceof Error ? e.message : e); }
}

/**
 * Depois de uma gravacao bem sucedida: guarda o que acabou de ser gravado.
 * Fora do caminho critico (setImmediate), porque o `write-file` ja respondeu
 * ao editor e o historico nao pode atrasar o proximo salvar. Nunca lanca.
 * @param {string|null} projeto
 * @param {string} arquivo
 * @param {string|Buffer} conteudo
 * @param {string} [origem]
 */
function depoisDeGravar(projeto, arquivo, conteudo, origem = 'salvar') {
  if (!projeto) return;
  setImmediate(() => {
    try { gravarVersao(projeto, arquivo, conteudo, { origem }); }
    catch (e) { log.debug('[historico] gravar versao falhou:', e instanceof Error ? e.message : e); }
  });
}

/**
 * Antes de apagar: a ultima copia do arquivo vai para o historico, senao ela
 * iria junto com o arquivo. Sincrono porque o unlink vem logo depois.
 * @param {string|null} projeto
 * @param {string} arquivo
 */
function antesDeApagar(projeto, arquivo) {
  if (!projeto) return;
  try {
    const atual = fs.readFileSync(arquivo);
    gravarVersao(projeto, arquivo, atual, { origem: 'apagar' });
  } catch (e) {
    log.debug('[historico] antes-de-apagar falhou:', e instanceof Error ? e.message : e);
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────────

function register() {
  const { ipcMain } = require('electron');
  const { spfDaJanela } = require('./project_paths');
  /** O projeto da janela que pediu, nunca um caminho vindo do renderer. */
  const projetoDe = (/** @type {any} */ event) => {
    const spf = spfDaJanela(event);
    return spf ? path.dirname(spf) : null;
  };
  ipcMain.handle('historico:listar', (event, arquivo) => listar(projetoDe(event) || '', String(arquivo || '')));
  ipcMain.handle('historico:ler', (event, arquivo, id) => ler(projetoDe(event) || '', String(arquivo || ''), String(id || '')));
}

module.exports = {
  register,
  // ganchos
  antesDeGravar,
  depoisDeGravar,
  antesDeApagar,
  // API
  gravarVersao,
  guardarAntesSePrimeira,
  listar,
  ler,
  // puros, para teste
  relativoAoProjeto,
  chaveDe,
  podarVersoes,
  conteudoGuardavel,
  pastaDoProjeto,
  LIMITE_VERSOES,
};
