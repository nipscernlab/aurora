// @ts-check
/**
 * components.js: instalar e remover componentes durante o uso da AURORA.
 *
 * QUEM BAIXA É O MESMO SCRIPT DE SEMPRE
 * -------------------------------------
 * Os `components/Scripts/download-*.js` já existiam e já são o que monta a
 * máquina de desenvolvimento e o instalador. Reescrever a lógica de download
 * aqui criaria duas verdades sobre qual versão de cada componente é a certa, e
 * as duas divergiriam no primeiro bump que alguém fizesse num lado só. Então
 * este módulo não baixa nada: ele executa aquele script.
 *
 * COMO ELE EXECUTA
 * ----------------
 * Num processo filho, com o próprio Electron rodando em modo Node. Não há Node
 * instalado na máquina do usuário, e não pode haver: o SAPHO é um instalador só.
 * `ELECTRON_RUN_AS_NODE` faz o executável que já está aqui se comportar como
 * Node puro, que é exatamente o que esses scripts esperam.
 *
 * Em processo filho, e não aqui dentro, por dois motivos. Um download de
 * novecentos megabytes com extração no fim seguraria o processo principal, e
 * com ele a janela inteira. E um script que falhe derruba o filho, não a
 * AURORA.
 *
 * O PROGRESSO
 * -----------
 * Os scripts já escrevem "[surfer] 42% (18.1 / 43.0 MB)" na saída. Em vez de
 * inventar um protocolo, lemos o que eles já dizem. Quando a linha não casa, o
 * texto vai como está para o painel: uma linha de log verdadeira informa mais
 * do que uma barra parada.
 *
 * A REMOÇÃO
 * ---------
 * Só do que não é essencial, e por caminho montado aqui a partir do catálogo,
 * nunca por caminho vindo do renderer. Apagar diretório é a operação em que um
 * caminho recebido de fora custa mais caro.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ipcMain, BrowserWindow, shell } = require('electron');
const log = require('electron-log');

const registro = require('../components/registry');
const { componentsPath } = require('../paths');

/** Um download por vez. Dois puxando ao mesmo tempo só disputam a mesma banda. */
let emAndamento = null;

/** A pasta dos instaladores, ao lado dos componentes. */
function pastaDosScripts() {
  return path.join(componentsPath, 'Scripts');
}

/** Manda uma linha de progresso para a janela que pediu. */
function avisar(janela, carga) {
  try {
    if (janela && !janela.isDestroyed()) janela.webContents.send('componentes:progresso', carga);
  } catch (_) { /* a janela pode ter fechado no meio do download */ }
}

/** "[surfer] 42% (18.1 / 43.0 MB)" -> 42 */
function lerPercentual(linha) {
  const m = /(\d{1,3})%/.exec(linha);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/**
 * Executa o instalador de um componente.
 *
 * @param {string} chave
 * @param {import('electron').BrowserWindow|null} janela
 */
function instalar(chave, janela) {
  const comp = registro.obter(chave);
  if (!comp) return Promise.resolve({ ok: false, erro: 'componente desconhecido' });
  if (emAndamento) return Promise.resolve({ ok: false, erro: 'ja-ha-download', chave: emAndamento });

  const script = path.join(pastaDosScripts(), comp.script);
  if (!fs.existsSync(script)) {
    return Promise.resolve({ ok: false, erro: `instalador ausente: ${comp.script}` });
  }

  emAndamento = chave;
  avisar(janela, { chave, estado: 'iniciando', percentual: 0, linha: `Baixando ${comp.nome}` });

  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [script], {
      cwd: path.dirname(componentsPath),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
    });

    let ultimaLinha = '';
    const digerir = (buf) => {
      // O progresso vem com \r, sem \n, para reescrever a mesma linha no
      // terminal. Separar pelos dois e o que faz cada atualizacao chegar.
      for (const parte of String(buf).split(/[\r\n]+/)) {
        const linha = parte.trim();
        if (!linha) continue;
        ultimaLinha = linha;
        avisar(janela, { chave, estado: 'baixando', percentual: lerPercentual(linha), linha });
      }
    };
    filho.stdout.on('data', digerir);
    filho.stderr.on('data', digerir);

    filho.on('error', (e) => {
      emAndamento = null;
      log.warn(`[componentes] ${chave} nao executou:`, e);
      avisar(janela, { chave, estado: 'erro', linha: e.message });
      resolve({ ok: false, erro: e.message });
    });

    filho.on('close', (codigo) => {
      emAndamento = null;
      // A prova nao e o codigo de saida, e a sentinela. Um script pode sair
      // zero tendo baixado um arquivo truncado, e quem responde "esta
      // instalado?" para o resto da AURORA e o mesmo arquivo que o allowlist
      // consulta. Conferir aqui e conferir com o mesmo criterio.
      registro.invalidarCache(chave);
      const instalado = registro.estaInstalado(chave);
      if (codigo === 0 && instalado) {
        log.info(`[componentes] ${chave} instalado`);
        avisar(janela, { chave, estado: 'pronto', percentual: 100, linha: `${comp.nome} instalado` });
        resolve({ ok: true, chave });
        return;
      }
      // A causa tecnica vai para o log; para o usuario vai o que ele pode
      // fazer. "Terminou sem deixar a sentinela" nao diz nada a um aluno; a
      // causa de longe mais comum e a conexao cair no meio do download.
      const detalheTecnico = instalado
        ? `o instalador saiu com codigo ${codigo}`
        : `o instalador terminou sem deixar ${comp.sentinela}`;
      log.warn(`[componentes] ${chave} falhou: ${detalheTecnico} | ultima linha: ${ultimaLinha}`);
      const erro = 'o download não chegou ao fim. Confira a internet e clique em Baixar de novo';
      avisar(janela, { chave, estado: 'erro', linha: erro });
      resolve({ ok: false, erro, detalhe: `${detalheTecnico} | ${ultimaLinha}` });
    });
  });
}

/**
 * Remove um componente, para recuperar espaço.
 *
 * O caminho apagado é o diretório do componente, derivado da sentinela do
 * catálogo. Nada vem do renderer além da chave.
 */
async function remover(chave) {
  const comp = registro.obter(chave);
  if (!comp) return { ok: false, erro: 'componente desconhecido' };
  if (comp.essencial) return { ok: false, erro: 'componente essencial' };

  // A sentinela de todo componente removivel mora dentro da pasta dele, em
  // Packages/<nome>[/bin]. Apagamos a pasta do componente, que e o primeiro
  // nivel abaixo de Packages, e nunca acima disso.
  const partes = comp.sentinela.split('/');
  if (partes[0] !== 'Packages' || partes.length < 3) {
    return { ok: false, erro: 'caminho do componente fora do esperado' };
  }
  const alvo = path.join(componentsPath, 'Packages', partes[1]);

  // Cinto de seguranca: o alvo tem que estar mesmo debaixo de components.
  const dentro = path.resolve(alvo).startsWith(path.resolve(componentsPath) + path.sep);
  if (!dentro) return { ok: false, erro: 'caminho fora de components' };

  try {
    await fs.promises.rm(alvo, { recursive: true, force: true });
    registro.invalidarCache(chave);
    log.info(`[componentes] ${chave} removido`);
    return { ok: true, chave, liberadoMB: comp.tamanhoMB };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

function register() {
  ipcMain.handle('componentes:listar', () => ({
    componentes: registro.listar(),
    baixando: emAndamento,
    pasta: componentsPath,
  }));

  ipcMain.handle('componentes:instalar', (evento, chave) =>
    instalar(chave, BrowserWindow.fromWebContents(evento.sender)));

  ipcMain.handle('componentes:remover', (_e, chave) => remover(chave));

  // Usado pela interface para decidir se mostra o aviso num botao, e pelo
  // prompt da Aurora Intelligence. Le do disco, entao acompanha o que o
  // usuario acabou de baixar sem precisar reiniciar.
  ipcMain.handle('componentes:instalado', (_e, chave) => registro.estaInstalado(chave));

  ipcMain.handle('componentes:abrirPasta', () => {
    try { shell.openPath(componentsPath); return { ok: true }; }
    catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) }; }
  });
}

module.exports = { register, instalar, remover, lerPercentual };
