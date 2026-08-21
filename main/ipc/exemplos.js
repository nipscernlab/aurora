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
      log.info(`[exemplos] ${r.criados.length} criados, ${r.pulados.length} pulados em ${destino}`);
      return { ok: true, cancelado: false, destino, ...r };
    } catch (e) {
      log.error('[exemplos] falha ao instalar:', e);
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  });
}

module.exports = { register };
