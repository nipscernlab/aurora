// @ts-check
/**
 * search_worker.js: o corpo do worker thread da busca no projeto.
 *
 * NAO e carregado por caminho: o search.js le este arquivo e o search_core.js
 * como texto e os concatena num unico `new Worker(codigo, { eval: true })`.
 * Por isso este arquivo nao faz require do search_core: as funcoes dele ja
 * estao no mesmo escopo quando isto roda. A razao de nao usar `new
 * Worker(caminho)` e o app.asar: o processo principal le de dentro do
 * arquivo pelo fs remendado do Electron, e um worker thread tem carregador
 * de modulos proprio, que nao tem a garantia de enxergar la dentro. Com o
 * codigo em texto, o worker so precisa dos modulos nativos do Node.
 *
 * Entrada (workerData): { rootDir, payload }. Saida (uma mensagem): o objeto
 * que `buscar` devolve.
 */

/* global buscar */

'use strict';

const { parentPort, workerData } = require('worker_threads');

try {
  const resultado = buscar(workerData.rootDir, workerData.payload);
  parentPort.postMessage(resultado);
} catch (e) {
  parentPort.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
}
