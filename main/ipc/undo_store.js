// @ts-check
/**
 * undo_store.js: a mecânica da área de espera que torna o Ctrl+Z da árvore
 * possível.
 *
 * Isto saiu do `tree_undo.js` para poder ser provado. O que ficou lá é a cola
 * com o Electron: onde fica a pasta de espera (`app.getPath('userData')`) e o
 * que significa "mandar para a Lixeira" (`shell.trashItem`). Aqui não há
 * import de electron, e as duas coisas entram por parâmetro, o que também
 * documenta a fronteira: esta camada nunca decide ONDE guardar nem COMO
 * descartar, só faz.
 *
 * O PROBLEMA QUE A ESPERA RESOLVE
 *
 * `shell.trashItem` manda para a Lixeira e não existe API para trazer de volta.
 * Sem a espera, desfazer uma deleção seria impossível, e o Ctrl+Z funcionaria
 * para tudo menos justamente para o que mais dói errar.
 *
 * Por isso o que a árvore remove não vai direto para a Lixeira: primeiro é
 * movido para uma pasta de espera, e só de lá vai para a Lixeira quando sai da
 * pilha de desfazer, quando o projeto fecha ou quando o aplicativo encerra.
 * Enquanto está esperando, desfazer é um `rename` de volta, instantâneo e sem
 * cópia.
 *
 * VOLUMES DIFERENTES
 *
 * `rename` não atravessa volume, e o projeto pode estar no D: com o userData no
 * C:. Nesse caso cai para copiar e apagar, que é mais lento mas funciona. É o
 * único caminho que duplica bytes, e só ele.
 */

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/**
 * Move de verdade, caindo para copiar e apagar quando o destino está em outro
 * volume (`EXDEV`).
 *
 * @param {string} origem
 * @param {string} destino
 */
async function moverOuCopiar(origem, destino) {
  try {
    await fsp.rename(origem, destino);
    return;
  } catch (e) {
    if (!e || /** @type {any} */ (e).code !== 'EXDEV') throw e;
  }
  await fsp.cp(origem, destino, { recursive: true, force: true });
  await fsp.rm(origem, { recursive: true, force: true });
}

/**
 * Caminho do único item guardado sob `token`, ou '' se não houver.
 *
 * Cada token tem uma caixa própria com um item só dentro, e é isso que permite
 * guardar dois arquivos de mesmo nome sem que um cubra o outro.
 *
 * @param {string} raiz
 * @param {string} token
 */
function itemDe(raiz, token) {
  const caixa = path.join(raiz, token);
  let nomes = [];
  try { nomes = fs.readdirSync(caixa); } catch (_) { return ''; }
  return nomes.length ? path.join(caixa, nomes[0]) : '';
}

/**
 * Tira `alvo` do lugar e guarda na espera.
 *
 * @param {string} raiz
 * @param {string} alvo
 * @returns {Promise<{success: boolean, token?: string, error?: string}>}
 */
async function guardar(raiz, alvo) {
  try {
    const token = crypto.randomBytes(12).toString('hex');
    const caixa = path.join(raiz, token);
    await fsp.mkdir(caixa, { recursive: true });
    await moverOuCopiar(alvo, path.join(caixa, path.basename(alvo)));
    return { success: true, token };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Devolve o que estava guardado para `destino`.
 *
 * Recusa quando o destino já existe, em vez de sobrescrever: se alguma coisa
 * ocupou o lugar depois da remoção, desfazer não pode apagar essa coisa em
 * silêncio. Desfazer que destrói é pior que não ter desfazer.
 *
 * @param {string} raiz
 * @param {string} token
 * @param {string} destino
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function devolver(raiz, token, destino) {
  try {
    const item = itemDe(raiz, token);
    if (!item) return { success: false, error: 'nada guardado sob este token' };
    if (fs.existsSync(destino)) return { success: false, error: 'o caminho ja esta ocupado' };
    await fsp.mkdir(path.dirname(destino), { recursive: true });
    await moverOuCopiar(item, destino);
    await fsp.rm(path.join(raiz, token), { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Desiste de poder desfazer: o que estava guardado vai para a Lixeira, que é
 * onde o usuário espera encontrá-lo.
 *
 * A caixa some mesmo quando o descarte falha. Deixá-la ali faria a espera
 * crescer para sempre, e o conteúdo já não é mais alcançável pelo desfazer.
 *
 * @param {string} raiz
 * @param {string} token
 * @param {(item: string) => Promise<any>} paraLixeira
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function descartar(raiz, token, paraLixeira) {
  const caixa = path.join(raiz, token);
  try {
    const item = itemDe(raiz, token);
    if (item) await paraLixeira(item);
    await fsp.rm(caixa, { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    try { await fsp.rm(caixa, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Esvazia a espera inteira. Roda no arranque, para recolher o que sobrou de uma
 * queda, e ao encerrar.
 *
 * Uma caixa que falhe não interrompe as outras: o objetivo é esvaziar, e parar
 * na primeira falha deixaria o resto acumulado para sempre.
 *
 * @param {string} raiz
 * @param {(item: string) => Promise<any>} paraLixeira
 * @returns {Promise<{descartadas: number, falhas: number}>}
 */
async function esvaziar(raiz, paraLixeira) {
  let tokens = [];
  try { tokens = await fsp.readdir(raiz); } catch (_) { return { descartadas: 0, falhas: 0 }; }
  let descartadas = 0;
  let falhas = 0;
  for (const t of tokens) {
    const r = await descartar(raiz, t, paraLixeira);
    if (r.success) descartadas++; else falhas++;
  }
  return { descartadas, falhas };
}

module.exports = { itemDe, guardar, devolver, descartar, esvaziar };
