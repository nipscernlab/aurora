// @ts-check
/**
 * App-wide lifecycle: single-instance lock, before-quit cleanup, activate
 * + window-all-closed, command-line .spf detection.
 */

const path = require('path');
const fs = require('fs').promises;
const { app, BrowserWindow } = require('electron');
const log = require('electron-log');

const state = require('./state');
const { componentsPath } = require('./paths');
const { stopAllToolchain, reapOrphans } = require('./process_registry');

function register() {
  // Detect a .spf passed on the command line; the main window will pick it
  // up after did-finish-load.
  // .spf abre o projeto; .cmm e .v abrem soltos no editor (associacoes de
  // arquivo do instalador). O renderer decide pelo sufixo.
  state.fileToOpen = process.argv.find((arg) => /\.(spf|cmm|v)$/i.test(arg)) ?? null;

  // Single-instance lock, pass any .spf the second instance had to the
  // first, then quit the second instance. Tests run with their own
  // user-data-dir but Electron's lock is per app name, so a test instance
  // would still collide with a real Aurora the developer has open.
  // SAPHO_SKIP_SINGLE_INSTANCE=1 bypasses the lock for that case only.
  const skipLock = process.env.SAPHO_SKIP_SINGLE_INSTANCE === '1';
  const gotTheLock = skipLock ? true : app.requestSingleInstanceLock();
  if (!gotTheLock) {
    // Log loudly to BOTH the electron-log file AND stdout. Otherwise the
    // user just sees `npm start` return immediately with no explanation,
    // which is exactly what bug report #3 was: a leftover SAPHO/electron
    // process held the lock and the new instance vanished silently.
    const msg =
      'SAPHO is already running (single-instance lock held by another process). ' +
      'Close the existing window or kill leftover electron.exe / SAPHO.exe processes ' +
      '(Task Manager) and try again.';
    log.warn(msg);
    process.stderr.write(`[SAPHO] ${msg}\n`);
    app.quit();
    return false;
  }

  // Somos a unica instancia a partir daqui, entao qualquer processo rodando de
  // dentro de components/ e sobra de uma sessao anterior que nao morreu bem.
  // Nao esperamos o resultado: e faxina, e o arranque nao deve nada a ela.
  reapOrphans();

  app.on('second-instance', (_event, commandLine) => {
    // Each subsequent SAPHO launch opens a NEW window in the same process
    // rather than just focusing the existing one. Users can have several
    // projects side-by-side without launching duplicate Electron processes
    // (which would race on the shared components/Temp folder and on the
    // single-instance lock anyway). Each window owns its own renderer state
    // and its own active editor; main-side resources (watchers, temp dir,
    // cleanup) stay coordinated under a single process lifecycle.
    const { createMainWindow } = require('./windows');
    const newWin = createMainWindow();

    const fileArg = commandLine.find((arg) => /\.(spf|cmm|v)$/i.test(arg));
    if (fileArg && newWin) {
      // Espera o load nos dois casos: mandar antes de o renderer registrar o
      // listener e falar com ninguem.
      newWin.webContents.once('did-finish-load', () => {
        if (/\.spf$/i.test(fileArg)) {
          newWin.webContents.send('open-spf-file', { filePaths: [fileArg] });
        } else {
          newWin.webContents.send('aurora:open-loose-file', { filePath: fileArg });
        }
      });
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const { createMainWindow } = require('./windows');
      createMainWindow();
    }
  });

  // Cleanup em duas fases serializadas pra evitar EBUSY no rmdir de Temp:
  // file watchers do chokidar (ReadDirectoryChangesW no Windows) e vvp/
  // gtkwave seguram handles em Temp/, se a fase 2 (rm) rodar antes da
  // fase 1 terminar, o Windows bloqueia o rmdir e a Temp/ acumula lixo
  // de runs anteriores. 5s de safety timeout por fase pra nao travar
  // quit em caso de hang.
  app.on('before-quit', async () => {
    state.isQuitting = true;

    // Rede de seguranca da saida. Um filho que ignora o taskkill, um rm que
    // encalha num arquivo travado pelo antivirus: qualquer um deles deixa a
    // faxina abaixo pendurada, e um SAPHO.exe sem janela e pior que um
    // encerramento sujo, porque bloqueia a proxima abertura e a proxima
    // instalacao. Dez segundos e folgado para tudo que ha aqui; passou disso,
    // o processo morre de qualquer jeito. O unref evita que este timer seja,
    // ele proprio, o motivo de o processo continuar vivo.
    if (!state.updateDownloaded) {
      const t = setTimeout(() => {
        log.warn('[lifecycle] faxina passou de 10s; encerrando a forca.');
        app.exit(0);
      }, 10000);
      if (typeof t.unref === 'function') t.unref();
    }

    // Credenciais do GitHub, se o usuário pediu que saiam ao fechar. Vem antes
    // da faxina de arquivos porque é a parte que protege alguém: um encerramento
    // que trava depois disto ainda deixou a máquina limpa.
    try { await require('./ipc/github_forget').aoEncerrar(); }
    catch (e) { log.warn('[lifecycle] falha ao limpar credenciais ao sair:', e); }

    // O que a árvore removeu está esperando em userData para poder ser
    // desfeito. Fechando o aplicativo não há mais o que desfazer, então vai
    // para a Lixeira, que é onde o usuário espera encontrar. Best-effort: a
    // limpeza de boot pega o que sobrar se isto não terminar.
    try { await require('./ipc/tree_undo').drain(); }
    catch (e) { log.warn('[lifecycle] falha ao esvaziar a espera do desfazer:', e); }

    // Fase 1: solta tudo que pode segurar handle em Temp/, watchers
    // (file + dir) e processos filhos (vvp.exe, gtkwave.exe).
    const releasePromises = [];

    releasePromises.push(
      (async () => {
        const watcherClosePromises = [];
        for (const [filePath, info] of state.activeWatchers.entries()) {
          watcherClosePromises.push(
            info.watcher
              .close()
              .catch((err) => log.error(`Error closing watcher for ${filePath}:`, err)),
          );
        }
        await Promise.all(watcherClosePromises);
        state.activeWatchers.clear();
        state.fileStatsCache.clear();
      })(),
    );

    releasePromises.push(
      (async () => {
        const dirWatcherClosePromises = [];
        for (const [directoryPath, info] of state.activeDirectoryWatchers.entries()) {
          dirWatcherClosePromises.push(
            info.watcher
              .close()
              .catch((err) => log.error(`Error closing directory watcher for ${directoryPath}:`, err)),
          );
        }
        await Promise.all(dirWatcherClosePromises);
        state.activeDirectoryWatchers.clear();
        state.directoryStatsCache.clear();
      })(),
    );

    // Every toolchain child (compiles, simulations, yosys/PRISM, gtkwave,
    // cocotb) + the Verilator scratch-tree sweep + the AI agent CLIs + any
    // in-flight AI (gemini) stream. Centralised in process_registry so this
    // quit path and the main-window close path tear everything down the same
    // way, releasing the Temp/ handles before the phase-2 rmdir below.
    releasePromises.push(stopAllToolchain());

    // Close the Aurora MCP bridge (the localhost HTTP server that hands
    // Claude Code our tool surface). It holds no Temp/ handle, but
    // releasing the port on quit keeps a relaunch from racing on it.
    releasePromises.push(
      (async () => {
        try {
          await require('./ai/aurora_mcp_server').stop();
        } catch (err) {
          log.error('Error stopping Aurora MCP server:', err);
        }
      })(),
    );

    await Promise.race([
      Promise.all(releasePromises),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);

    // Fase 2: agora que ninguem segura mais handle, apaga Temp/.
    try {
      const tempFolderPath = path.join(componentsPath, 'Temp');
      await fs.rm(tempFolderPath, { recursive: true, force: true, maxRetries: 3 });
      await fs.mkdir(tempFolderPath, { recursive: true });
    } catch (error) {
      log.error('Failed to clear Temp folder on app exit:', error);
    }

    // ── Saida garantida ───────────────────────────────────────────────────
    // O Electron NAO espera promessa devolvida por handler de evento, entao
    // tudo acima corre em paralelo com o encerramento. Quando um filho demora
    // a morrer, o processo do SAPHO pode ficar de pe sem janela nenhuma: ele
    // segura o bloqueio de instancia unica, e a partir dai um duplo clique no
    // atalho nao abre nada, porque a segunda instancia encontra o bloqueio e
    // sai calada. E o mesmo processo pendurado que faz o instalador nao
    // conseguir substituir arquivo em uso e terminar deixando a pasta vazia.
    //
    // Depois da faxina, matamos o processo em vez de torcer para ele morrer.
    //
    // Com uma excecao que nao pode ser esquecida: se ha atualizacao baixada,
    // quem a instala e o electron-updater, no caminho normal de quit, e
    // app.exit() pula justamente os eventos que ele escuta. Nesse caso saimos
    // do caminho e deixamos o encerramento seguir sozinho, senao a promessa de
    // atualizar sem visita presencial morre aqui.
    if (state.updateDownloaded) {
      log.info('[lifecycle] atualizacao pendente: saida normal, quem instala e o updater.');
      return;
    }
    log.info('[lifecycle] faxina concluida, encerrando o processo.');
    app.exit(0);
  });

  return true;
}

module.exports = { register };
