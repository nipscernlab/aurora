// @ts-check
/**
 * notify.js: avisa a janela quando algo foi barrado por componente ausente.
 *
 * POR QUE ISTO NÃO FICOU NA INTERFACE
 * -----------------------------------
 * Decorar cada botão com "confira antes de clicar" é a mesma armadilha que a
 * verificação espalhada: funciona para os botões de hoje e falha no primeiro
 * caminho novo. Aqui o aviso sai do MESMO ponto que barrou, então vale para
 * botão, para a API de automação, para a Aurora Intelligence e para o que
 * ainda não existe.
 *
 * QUEM CHAMOU CONTINUA RECEBENDO O ERRO
 * -------------------------------------
 * Este aviso não substitui o retorno de erro, ele acompanha. Quem chamou
 * precisa saber que falhou para poder parar; o usuário precisa saber o que
 * fazer a respeito. São duas coisas diferentes e as duas têm que acontecer.
 *
 * O SILÊNCIO ENTRE AVISOS
 * -----------------------
 * Uma compilação tenta vários binários do mesmo componente em seguida. Sem a
 * pausa, uma única compilação empilharia meia dúzia de avisos idênticos, e o
 * efeito de um aviso repetido é a pessoa aprender a fechá-lo sem ler.
 */

'use strict';

/** Quanto tempo o mesmo componente fica sem repetir o aviso. */
const SILENCIO_MS = 30000;

/** @type {Map<string, number>} */
const ultimoAviso = new Map();

/**
 * Anuncia que algo foi recusado por falta de componente.
 *
 * Nunca lança. É chamado de dentro do portão de execução, e um portão que
 * quebra ao tentar avisar seria pior do que um portão calado.
 *
 * @param {string} chave
 * @param {string} mensagem
 */
function anunciarAusencia(chave, mensagem) {
  try {
    const agora = Date.now();
    const antes = ultimoAviso.get(chave) || 0;
    if (agora - antes < SILENCIO_MS) return;
    ultimoAviso.set(chave, agora);

    // Carregado aqui, e não no topo: este módulo é alcançado por
    // binary_allowlist, que os testes carregam fora do Electron.
    const { BrowserWindow } = require('electron');
    if (!BrowserWindow) return;
    for (const janela of BrowserWindow.getAllWindows()) {
      if (janela.isDestroyed()) continue;
      janela.webContents.send('componentes:ausente', { chave, mensagem });
    }
  } catch (_) { /* avisar e cortesia; barrar ja aconteceu */ }
}

module.exports = { anunciarAusencia };
