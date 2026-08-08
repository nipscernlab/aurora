// @ts-check
/**
 * tree_undo.js — a área de espera que torna o Ctrl+Z da árvore possível.
 *
 * O problema: `shell.trashItem` manda para a Lixeira e não existe API para
 * trazer de volta. Sem isto, desfazer uma deleção seria impossível e o Ctrl+Z
 * funcionaria para tudo menos justamente para o que mais dói errar.
 *
 * A solução: o que a árvore remove não vai direto para a Lixeira. Primeiro é
 * movido para uma pasta de espera em userData, e só de lá vai para a Lixeira
 * quando sai da pilha de desfazer, quando o projeto fecha ou quando o
 * aplicativo encerra. Enquanto está esperando, desfazer é um `rename` de volta,
 * instantâneo e sem cópia.
 *
 * Isto vale também para desfazer uma criação: em vez de apagar o arquivo que o
 * usuário acabou de criar (e talvez já ter escrito nele), guardamos na espera.
 * Refazer é trazer de volta. Nenhum caminho perde conteúdo.
 *
 * VOLUMES DIFERENTES
 * ------------------
 * `rename` não atravessa volume, e o projeto pode estar no D: com o userData no
 * C:. Nesse caso caímos para copiar e apagar, que é mais lento mas funciona. É
 * o único caminho que duplica bytes, e só nele.
 *
 * SOBREVIVÊNCIA A QUEDA
 * ---------------------
 * Se o aplicativo cair com coisa na espera, aquilo fica em userData em vez de
 * estar na Lixeira. Não é perda, é lugar errado. A limpeza de boot esvazia a
 * pasta mandando o que sobrou para a Lixeira, que é onde deveria ter chegado.
 */

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { app, shell, ipcMain } = require('electron');
const log = require('electron-log');

const { safePath } = require('../utils');

/** Pasta de espera. Um nível só: cada item ganha uma subpasta com o próprio nome. */
function stagingRoot() {
  return path.join(app.getPath('userData'), 'undo-staging');
}

/**
 * Move de verdade, caindo para copiar e apagar quando o destino está em outro
 * volume (`EXDEV`).
 */
async function moverOuCopiar(/** @type {string} */ origem, /** @type {string} */ destino) {
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
 * Tira `alvo` do lugar e guarda na espera.
 * @returns {Promise<{success: boolean, token?: string, error?: string}>}
 */
async function stage(/** @type {string} */ alvo) {
  try {
    const token = crypto.randomBytes(12).toString('hex');
    const caixa = path.join(stagingRoot(), token);
    await fsp.mkdir(caixa, { recursive: true });
    await moverOuCopiar(alvo, path.join(caixa, path.basename(alvo)));
    return { success: true, token };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('[tree-undo] falha ao guardar na espera:', msg);
    return { success: false, error: msg };
  }
}

/** Caminho do único item guardado sob `token`, ou '' se não houver. */
function itemDe(/** @type {string} */ token) {
  const caixa = path.join(stagingRoot(), token);
  let nomes = [];
  try { nomes = fs.readdirSync(caixa); } catch (_) { return ''; }
  return nomes.length ? path.join(caixa, nomes[0]) : '';
}

/**
 * Devolve o que estava guardado para `destino`.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function restore(/** @type {string} */ token, /** @type {string} */ destino) {
  try {
    const item = itemDe(token);
    if (!item) return { success: false, error: 'nada guardado sob este token' };
    // Recusar em vez de sobrescrever: se algo ocupou o lugar depois da
    // remoção, desfazer não pode apagar esse algo em silêncio.
    if (fs.existsSync(destino)) return { success: false, error: 'o caminho ja esta ocupado' };
    await fsp.mkdir(path.dirname(destino), { recursive: true });
    await moverOuCopiar(item, destino);
    await fsp.rm(path.join(stagingRoot(), token), { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('[tree-undo] falha ao restaurar:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Desiste de poder desfazer: o que estava guardado vai para a Lixeira, que é
 * onde o usuário espera encontrá-lo.
 */
async function discard(/** @type {string} */ token) {
  const caixa = path.join(stagingRoot(), token);
  try {
    const item = itemDe(token);
    if (item) await shell.trashItem(item);
    await fsp.rm(caixa, { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('[tree-undo] falha ao descartar:', msg);
    // Mesmo falhando o trashItem, a caixa some: deixá-la ali faria a espera
    // crescer para sempre.
    try { await fsp.rm(caixa, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    return { success: false, error: msg };
  }
}

/**
 * Esvazia a espera inteira, mandando o que sobrou para a Lixeira. Roda no boot
 * (restos de uma queda) e ao encerrar.
 */
async function drain() {
  let tokens = [];
  try { tokens = await fsp.readdir(stagingRoot()); } catch (_) { return; }
  for (const t of tokens) await discard(t);
}

function register() {
  ipcMain.handle('undo:stage', (_e, alvo) => stage(safePath(alvo, 'alvo')));
  ipcMain.handle('undo:restore', (_e, token, destino) =>
    restore(String(token || ''), safePath(destino, 'destino')));
  ipcMain.handle('undo:discard', (_e, token) => discard(String(token || '')));
  ipcMain.handle('undo:drain', () => drain());
}

module.exports = { register, stage, restore, discard, drain, stagingRoot };
