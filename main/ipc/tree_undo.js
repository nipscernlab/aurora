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

const path = require('path');
const { app, shell, ipcMain } = require('electron');
const log = require('electron-log');

const { safePath } = require('../utils');
// A mecânica (mover, devolver, descartar, esvaziar) mora em undo_store.js, sem
// electron e com teste. Aqui fica só a cola: onde é a pasta de espera e o que
// significa mandar para a Lixeira.
const store = require('./undo_store');

/** Pasta de espera. Um nível só: cada item ganha uma subpasta com o próprio nome. */
function stagingRoot() {
  return path.join(app.getPath('userData'), 'undo-staging');
}

/** O que "mandar para a Lixeira" significa. Entra no store por parâmetro. */
const paraLixeira = (/** @type {string} */ item) => shell.trashItem(item);

/** @returns {Promise<{success: boolean, token?: string, error?: string}>} */
async function stage(/** @type {string} */ alvo) {
  const r = await store.guardar(stagingRoot(), alvo);
  if (!r.success) log.warn('[tree-undo] falha ao guardar na espera:', r.error);
  return r;
}

/** @returns {Promise<{success: boolean, error?: string}>} */
async function restore(/** @type {string} */ token, /** @type {string} */ destino) {
  const r = await store.devolver(stagingRoot(), token, destino);
  if (!r.success) log.warn('[tree-undo] falha ao restaurar:', r.error);
  return r;
}

/** @returns {Promise<{success: boolean, error?: string}>} */
async function discard(/** @type {string} */ token) {
  const r = await store.descartar(stagingRoot(), token, paraLixeira);
  if (!r.success) log.warn('[tree-undo] falha ao descartar:', r.error);
  return r;
}

/**
 * Esvazia a espera inteira, mandando o que sobrou para a Lixeira. Roda no boot
 * (restos de uma queda) e ao encerrar.
 */
async function drain() {
  const r = await store.esvaziar(stagingRoot(), paraLixeira);
  if (r.falhas) log.warn(`[tree-undo] ${r.falhas} caixa(s) nao foram para a Lixeira`);
  return r;
}

function register() {
  ipcMain.handle('undo:stage', (_e, alvo) => stage(safePath(alvo, 'alvo')));
  ipcMain.handle('undo:restore', (_e, token, destino) =>
    restore(String(token || ''), safePath(destino, 'destino')));
  ipcMain.handle('undo:discard', (_e, token) => discard(String(token || '')));
  ipcMain.handle('undo:drain', () => drain());
}

module.exports = { register, stage, restore, discard, drain, stagingRoot };
