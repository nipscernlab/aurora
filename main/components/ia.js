// @ts-check
/**
 * ia.js: os agentes de IA (Claude Code e Codex) como componentes do painel.
 *
 * POR QUE ELES ENTRAM NO PAINEL
 * -----------------------------
 * Os dois CLIs ja eram baixados sob demanda (main/ai/cli_downloader.js), no
 * primeiro turno que a pessoa roda contra cada um: sao 90 e 132 MB de download,
 * 287 e 370 MB em disco, e nao ha razao para um aluno que so compila C± ter
 * isso na maquina. O que faltava era a pessoa ENXERGAR: o download acontecia
 * escondido atras do primeiro prompt, nao aparecia em lugar nenhum como
 * instalado, nao tinha botao para remover, e uma versao antiga ficava no disco
 * sem ninguem saber. Aqui eles ganham cartao, estado, tamanho, Baixar, Atualizar
 * e Remover, como qualquer outro componente.
 *
 * POR QUE NAO ENTRAM NO CATALOGO DE registry.js
 * ---------------------------------------------
 * Aquele catalogo descreve coisas que moram em components/ e que um
 * download-*.js instala; a presenca e uma sentinela relativa a components/ e a
 * remocao apaga Packages/<nome>. Os CLIs moram em <userData>/cli-cache, com a
 * versao no nome da pasta, e quem os instala e o cli_downloader, em processo.
 * Forcar os dois mundos numa tabela so obrigaria cada campo a ter dois
 * significados. Este modulo fala a MESMA lingua do painel (chave, estado,
 * tamanhos, versao) e main/ipc/components.js junta as duas listas.
 *
 * VERSAO
 * ------
 * A pasta do cache leva a versao no nome (<pacote>@<versao>), e o downloader
 * so considera instalado o que esta na pasta da versao fixada no manifesto. Uma
 * pasta de outra versao com o binario dentro e exatamente "desatualizado": o
 * painel oferece Atualizar, e o download da versao nova apaga a antiga.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const downloader = require('../ai/cli_downloader');

/**
 * @typedef {{
 *   chave: 'claude'|'codex', nome: string, resumo: string,
 *   tamanhoMB: number, downloadMB: number,
 * }} ComponenteIA
 */

/** @type {ComponenteIA[]} */
const CATALOGO = [
  {
    chave: 'claude',
    nome: 'Claude Code',
    resumo: 'O agente de programação da Anthropic, usado pela Aurora Intelligence no modo Claude Code.',
    tamanhoMB: 287,
    downloadMB: 90,
    icone: 'ai_claude.svg',
  },
  {
    chave: 'codex',
    nome: 'Codex',
    resumo: 'O agente de programação da OpenAI, usado pela Aurora Intelligence no modo Codex.',
    tamanhoMB: 370,
    downloadMB: 132,
    icone: 'ai_codex.svg',
  },
];

const PORCHAVE = new Map(CATALOGO.map((c) => [c.chave, c]));

/** Este modulo responde por esta chave? */
function conhece(chave) {
  return PORCHAVE.has(chave);
}

function obter(chave) {
  return PORCHAVE.get(chave);
}

function existe(p) {
  try { return !!p && fs.statSync(p).isFile(); }
  catch (_) { return false; }
}

/**
 * As pastas de cache deste CLI, de qualquer versao, com a versao de cada uma.
 *
 * O nome da pasta e `<pacote-seguro>@<versao>`; o prefixo ate o arroba
 * identifica o pacote, igual ao pruneStaleVersions do downloader.
 *
 * @returns {{ pasta: string, versao: string }[]}
 */
function pastasDoCache(chave) {
  const ip = downloader.installPaths(chave);
  if (!ip) return [];
  const raiz = path.dirname(ip.dir);
  const nome = path.basename(ip.dir);
  const prefixo = nome.replace(/@[^@]*$/, '@');
  if (prefixo === nome) return [];
  let nomes = [];
  try { nomes = fs.readdirSync(raiz); } catch (_) { return []; }
  return nomes
    .filter((n) => n.startsWith(prefixo))
    .map((n) => ({ pasta: path.join(raiz, n), versao: n.slice(prefixo.length) }));
}

/**
 * @returns {{chave: string, estado: 'ok'|'ausente'|'desatualizado', faltando: string[], versaoInstalada: string|null}}
 */
function diagnosticar(chave) {
  const ip = downloader.installPaths(chave);
  if (!ip) return { chave, estado: 'ausente', faltando: [], versaoInstalada: null };
  if (existe(ip.exe)) return { chave, estado: 'ok', faltando: [], versaoInstalada: ip.entry.version };

  // Outra versao com o binario dentro: instalado, mas nao o que esta AURORA
  // espera. Pasta sem o binario e resto de download interrompido, e conta
  // como ausente: o proximo download limpa.
  const relativo = ip.entry.exe.split('/');
  const antiga = pastasDoCache(chave).find((p) => existe(path.join(p.pasta, ...relativo)));
  if (antiga) return { chave, estado: 'desatualizado', faltando: [], versaoInstalada: antiga.versao };
  return { chave, estado: 'ausente', faltando: [], versaoInstalada: null };
}

function diagnosticarTudo() {
  return CATALOGO.map((c) => ({ ...diagnosticar(c.chave), essencial: false, nome: c.nome }));
}

/** A lista para o painel, no mesmo formato do catalogo de registry.js. */
function listar() {
  return CATALOGO.map((c) => {
    const d = diagnosticar(c.chave);
    const ip = downloader.installPaths(c.chave);
    return {
      ...c,
      essencial: false,
      requerParaCompilar: false,
      script: null,
      sentinela: ip ? ip.exe : null,
      arquivosChave: [],
      versao: ip ? ip.entry.version : null,
      instalado: d.estado !== 'ausente',
      estado: d.estado,
      versaoInstalada: d.versaoInstalada,
      caminho: ip ? ip.exe : null,
      // Sem manifesto para esta plataforma nao ha o que baixar; o painel
      // continua mostrando o cartao, e o botao falha com a frase certa.
      baixavel: downloader.isDownloadable(c.chave),
    };
  });
}

/**
 * Baixa (ou atualiza) um CLI, relatando o progresso em linhas no mesmo formato
 * dos instaladores de componentes: "[claude] 42% (38.1 / 90.4 MB)".
 *
 * O downloader ja apaga a versao antiga depois de a nova chegar inteira.
 *
 * @param {'claude'|'codex'} chave
 * @param {(linha: string, percentual: number|null) => void} avisar
 */
async function instalar(chave, avisar) {
  const c = obter(chave);
  if (!c) throw new Error('componente desconhecido');
  if (!downloader.isDownloadable(chave)) {
    throw new Error(`${c.nome} não tem download para esta plataforma`);
  }
  await downloader.ensureCli(chave, {
    onProgress: (p) => {
      if (p.phase === 'download') {
        const mb = (n) => (n / 1e6).toFixed(1);
        const detalhe = p.total ? ` (${mb(p.received || 0)} / ${mb(p.total)} MB)` : '';
        avisar(`[${chave}] ${p.pct}%${detalhe}`, p.pct);
      } else if (p.phase === 'verify') {
        avisar(`[${chave}] conferindo a integridade`, 100);
      } else if (p.phase === 'extract') {
        avisar(`[${chave}] extraindo`, 100);
      }
    },
  });
}

/**
 * Remove o CLI: todas as versoes no cache, nao so a atual. O que a pessoa quer
 * ao clicar em Remover e o espaco de volta, e uma versao antiga esquecida
 * seria o contrario disso.
 */
async function remover(chave) {
  const c = obter(chave);
  if (!c) return { ok: false, erro: 'componente desconhecido' };
  const pastas = pastasDoCache(chave);
  const raiz = path.resolve(downloader.cliCacheRoot());
  try {
    for (const { pasta } of pastas) {
      // Cinto de seguranca: so apaga o que esta debaixo do cache.
      if (!path.resolve(pasta).startsWith(raiz + path.sep)) continue;
      await fs.promises.rm(pasta, { recursive: true, force: true });
    }
    // O localizador guarda o caminho resolvido; sem isto a proxima chamada de
    // IA tentaria um binario que acabou de sumir.
    try { require('../ai/cli_locator').invalidate(); } catch (_) { /* opcional */ }
    return { ok: true, chave, liberadoMB: pastas.length ? c.tamanhoMB : 0 };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

module.exports = {
  CATALOGO,
  conhece,
  obter,
  diagnosticar,
  diagnosticarTudo,
  listar,
  instalar,
  remover,
  pastasDoCache,
};
