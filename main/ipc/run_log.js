// @ts-check
/**
 * Onde o registro de execucoes mora no disco.
 *
 * `<projeto>/.aurora/execucoes/<id>.json`, um arquivo por execucao. Dentro do
 * projeto, e nao no perfil do usuario, porque o registro so faz sentido ao lado
 * do que ele descreve: copiar o projeto para outra maquina leva o historico
 * junto, e apagar o projeto apaga o historico junto, que e o que qualquer um
 * espera.
 *
 * O NOME DO ARQUIVO E MONTADO AQUI, e nao aceito do renderer. O id vem de la,
 * mas passa por um filtro que so deixa passar o que o proprio gerador produz;
 * sem isso, um id com `..` escreveria fora da pasta. E a mesma razao pela qual
 * a pasta e derivada do caminho do projeto e nao recebida pronta.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const log = require('electron-log');

const { podar } = require('../../js/compilation/run_log.js');

const PASTA = path.join('.aurora', 'execucoes');
/** O mesmo formato que `idDe` produz: data, hora e o pedido. */
const ID_VALIDO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[\w-]{1,32}$/;

function pastaDe(projeto) {
  if (!projeto || typeof projeto !== 'string' || !path.isAbsolute(projeto)) return null;
  return path.join(projeto, PASTA);
}

/** Grava uma execucao e poda as antigas. */
async function gravar(projeto, exec) {
  const dir = pastaDe(projeto);
  if (!dir || !exec || !ID_VALIDO.test(String(exec.id || ''))) {
    return { ok: false, erro: 'projeto ou id invalido' };
  }
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, `${exec.id}.json`),
    JSON.stringify(exec, null, 2),
    'utf8',
  );

  // A poda e melhor esforco: falhar em apagar o velho nao pode fazer parecer
  // que a gravacao do novo falhou.
  try {
    const nomes = await fs.promises.readdir(dir);
    for (const velho of podar(nomes, 50)) {
      await fs.promises.unlink(path.join(dir, velho)).catch(() => {});
    }
  } catch (e) {
    log.warn('[run-log] poda falhou:', e);
  }
  return { ok: true, id: exec.id };
}

/** As execucoes gravadas, da mais recente para a mais antiga, so o resumo. */
async function listar(projeto) {
  const dir = pastaDe(projeto);
  if (!dir) return { ok: false, execucoes: [] };
  let nomes = [];
  try {
    nomes = (await fs.promises.readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, execucoes: [] };
    return { ok: false, erro: String(e && e.message), execucoes: [] };
  }
  const execucoes = [];
  for (const nome of nomes.sort().reverse()) {
    try {
      const bruto = JSON.parse(await fs.promises.readFile(path.join(dir, nome), 'utf8'));
      execucoes.push({
        id: bruto.id,
        pedido: bruto.pedido,
        inicio: bruto.inicio,
        ms: bruto.ms ?? null,
        ok: bruto.ok,
        cancelada: !!bruto.cancelada,
        passos: Array.isArray(bruto.passos) ? bruto.passos.length : 0,
      });
    } catch (_) { /* arquivo corrompido nao derruba a listagem */ }
  }
  return { ok: true, execucoes };
}

/** Uma execucao inteira, para a tela de detalhe. */
async function ler(projeto, id) {
  const dir = pastaDe(projeto);
  if (!dir || !ID_VALIDO.test(String(id || ''))) return { ok: false, erro: 'id invalido' };
  try {
    return { ok: true, execucao: JSON.parse(await fs.promises.readFile(path.join(dir, `${id}.json`), 'utf8')) };
  } catch (e) {
    return { ok: false, erro: String(e && e.message) };
  }
}

function register() {
  ipcMain.handle('runlog:gravar', (_e, projeto, exec) => gravar(projeto, exec));
  ipcMain.handle('runlog:listar', (_e, projeto) => listar(projeto));
  ipcMain.handle('runlog:ler', (_e, projeto, id) => ler(projeto, id));
}

module.exports = { register, gravar, listar, ler, pastaDe, ID_VALIDO };
