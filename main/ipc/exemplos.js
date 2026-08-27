// @ts-check
/**
 * exemplos.js: o IPC dos projetos de exemplo.
 *
 * Um canal para listar e um para instalar. A escolha da pasta acontece AQUI, e
 * nao no renderer, porque o dialogo nativo pertence ao processo principal e
 * porque assim o botao da interface fica com uma responsabilidade so: pedir.
 */

'use strict';

const { ipcMain, dialog, BrowserWindow } = require('electron');
const log = require('electron-log');

const exemplos = require('../exemplos/instalar');

/**
 * Poe os exemplos recem-criados na lista de recentes.
 *
 * O ponto e o aluno nao precisar caçar a pasta depois: ele clica no botao e os
 * cinco ja estao na tela inicial, a um clique de abrir. Esta e a MESMA lista
 * que alimenta a jumplist da barra de tarefas do Windows, e o mesmo caminho
 * que o "Novo Projeto" percorre ao criar um projeto.
 *
 * Em ordem inversa de proposito: cada `push` vai para o topo, entao empurrar de
 * tras para frente deixa a lista na ordem do catalogo, com o exemplo mais
 * simples em cima. A lista do renderer (localStorage, tela inicial) e povoada
 * la, porque o processo principal nao a alcança.
 *
 * Best-effort inteiro: os projetos ja estao no disco, e falhar em decorar a
 * lista de recentes nao pode transformar uma instalacao boa num erro.
 */
function registrarNosRecentes(criados) {
  if (!Array.isArray(criados) || criados.length === 0) return;
  try {
    const recents = require('../recents');
    const { app } = require('electron');
    for (const item of [...criados].reverse()) {
      recents.push(item.spf);
      if (typeof app.addRecentDocument === 'function') app.addRecentDocument(item.spf);
    }
    if (process.platform === 'win32') require('../windows').rebuildJumpList?.();
  } catch (e) {
    log.warn('[exemplos] nao consegui atualizar os recentes:', e);
  }
}

function register() {
  ipcMain.handle('exemplos:listar', async () => {
    try {
      return { ok: true, exemplos: exemplos.listar() };
    } catch (e) {
      log.warn('[exemplos] nao consegui ler o catalogo:', e);
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Pergunta onde, cria tudo, e devolve o relatorio.
   *
   * Cancelar o dialogo NAO e erro: devolve `cancelado`, e a interface fica
   * calada. Um aviso de falha para quem simplesmente desistiu seria ruido.
   */
  ipcMain.handle('exemplos:instalar', async (evento) => {
    try {
      const janela = BrowserWindow.fromWebContents(evento.sender);
      const escolha = janela
        ? await dialog.showOpenDialog(janela, {
          title: 'Onde criar os projetos de exemplo',
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Criar aqui',
        })
        : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });

      if (escolha.canceled || !escolha.filePaths?.[0]) return { ok: true, cancelado: true };

      const destino = escolha.filePaths[0];
      const r = exemplos.instalar(destino);
      registrarNosRecentes(r.criados);
      log.info(`[exemplos] ${r.criados.length} criados, ${r.pulados.length} pulados em ${r.pasta}`);
      return { ok: true, cancelado: false, destino, ...r };
    } catch (e) {
      log.error('[exemplos] falha ao instalar:', e);
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  });
}

module.exports = { register };
