/**
 * O orquestrador da atualizacao (main/updater.js).
 *
 * O que se prova aqui e o contrato de que o laboratorio depende: a maquina
 * NUNCA para de procurar atualizacao enquanto roda (toda saida arma a proxima
 * verificacao), baixar e escolha do usuario, nada abre sozinho (o botao da
 * status bar acende e espera o clique), a atualizacao baixada se instala na
 * ABERTURA seguinte e nao no fechamento, e o diagnostico conta o que houve.
 *
 * O modulo e CommonJS e faz `require('electron')`, `require('electron-updater')`
 * e `require('electron-log')` por dentro. O vi.mock do vitest so alcanca
 * imports ESM, entao os falsos entram pelo cache do require nativo, ANTES de o
 * modulo carregar (o mesmo caminho do updateNotify.test.js). O state, o
 * main_windows e o update_notify sao os de verdade, pelo mesmo require, para
 * serem as mesmas instancias que o updater enxerga; a janela de atualizacao
 * (main/windows.js) e falsa, porque a real cria um BrowserWindow.
 *
 * Cada teste recarrega o updater: ele guarda timers, a serie de falhas e o
 * payload pendente em variaveis de modulo.
 */
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);

function injetar(id, exports) {
  const p = req.resolve(id);
  req.cache[p] = { id: p, filename: p, loaded: true, children: [], paths: [], exports };
  return p;
}

// ── os falsos ────────────────────────────────────────────────────────────────

let userData;
let versaoAtual = '6.20.0';
const handles = new Map();   // ipcMain.handle
const ouvintes = new Map();  // ipcMain.on
const shellFalso = { showItemInFolder: vi.fn(), openExternal: vi.fn(async () => {}) };

class NotificacaoFalsa {
  static isSupported() { return true; }
  constructor(opts) { this.opts = opts; this.handlers = {}; NotificacaoFalsa.criadas.push(this); }
  on(ev, fn) { this.handlers[ev] = fn; }
  show() {}
  close() {}
}
NotificacaoFalsa.criadas = [];

injetar('electron', {
  app: {
    getVersion: () => versaoAtual,
    getPath: () => userData,
    isPackaged: true,
  },
  ipcMain: {
    handle: (canal, fn) => handles.set(canal, fn),
    on: (canal, fn) => ouvintes.set(canal, fn),
  },
  shell: shellFalso,
  Notification: NotificacaoFalsa,
});

const logFalso = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  transports: { file: { getFile: () => ({ path: 'C:/falso/main.log' }) } },
};
injetar('electron-log', logFalso);

/** O electron-updater falso: um emissor com os quatro metodos que o updater usa. */
function novoAutoUpdater() {
  const au = new EventEmitter();
  au.checkForUpdates = vi.fn(async () => ({ updateInfo: null }));
  au.downloadUpdate = vi.fn(async () => []);
  au.quitAndInstall = vi.fn();
  au.setFeedURL = vi.fn();
  return au;
}
const moduloUpdater = { autoUpdater: novoAutoUpdater() };
injetar('electron-updater', moduloUpdater);

const pathsFalso = { isDev: false };
injetar('../../main/paths.js', pathsFalso);

/** A janela de atualizacao falsa: o que o updater manda para ela fica em `enviados`. */
function novaJanelaDeUpdate() {
  const w = {
    enviados: [],
    destruida: false,
    carregando: false,
    isDestroyed: () => w.destruida,
    hide: vi.fn(),
    close: vi.fn(),
    getSize: () => [540, 660],
    setSize: vi.fn(),
    center: vi.fn(),
    webContents: {
      isLoading: () => w.carregando,
      once: vi.fn(),
      send: (canal, carga) => w.enviados.push({ canal, carga }),
    },
  };
  return w;
}
let janelaDeUpdate;
const windowsFalso = {
  createUpdateWindow: vi.fn(() => {
    if (!janelaDeUpdate) janelaDeUpdate = novaJanelaDeUpdate();
    state.updateWindow = janelaDeUpdate;
    return janelaDeUpdate;
  }),
};
injetar('../../main/windows.js', windowsFalso);

const state = req('../../main/state.js');
const janelas = req('../../main/main_windows.js');
const notificar = req('../../main/update_notify.js');
const {
  STARTUP_CHECK_DELAY_MS, PERIODIC_CHECK_MS, SILENT_RETRY_SCHEDULE_MS, DOWNLOAD_RETRY_DELAYS_MS,
} = req('../../main/update_schedule.js');

const updaterPath = req.resolve('../../main/updater.js');

/** Uma janela principal falsa registrada no main_windows; o que chega a ela fica em `recebidos`. */
function janelaPrincipal(id) {
  const w = {
    recebidos: [],
    isDestroyed: () => false,
    on: () => {},
    setProgressBar: () => {},
    webContents: { id, isDestroyed: () => false, send: (canal, carga) => w.recebidos.push({ canal, carga }) },
  };
  janelas.registrar(w);
  return w;
}

let au;          // o autoUpdater falso desta rodada
let updater;     // o modulo recarregado
let principal;   // a janela principal falsa

function carregar() {
  delete req.cache[updaterPath];
  updater = req('../../main/updater.js');
  return updater;
}

/** Liga os ouvintes do autoUpdater (e agenda a primeira verificacao, que fica parada no relogio falso). */
function iniciar() {
  state.updateSystemInitialized = false;
  updater.initializeUpdateSystem();
}

const chamar = (canal, ...args) => handles.get(canal)({ sender: principal.webContents }, ...args);
const disparar = (canal, ...args) => ouvintes.get(canal)({ sender: principal.webContents }, ...args);
const esperar = () => vi.advanceTimersByTimeAsync(0);
const pendenteEm = () => path.join(userData, 'aurora-pending-update.json');
const versaoEm = () => path.join(userData, 'aurora-version.json');

beforeEach(() => {
  vi.useFakeTimers();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-updater-'));
  versaoAtual = '6.20.0';
  pathsFalso.isDev = false;
  delete process.env.AURORA_UPDATE_FEED;
  handles.clear();
  ouvintes.clear();
  NotificacaoFalsa.criadas.length = 0;
  shellFalso.openExternal.mockClear();
  windowsFalso.createUpdateWindow.mockClear();
  janelaDeUpdate = null;

  Object.assign(state, {
    updateWindow: null, downloadInProgress: false, updateCheckInProgress: false,
    updateAvailable: false, updateDownloaded: false, updateInfo: null, updateSystemInitialized: false,
  });
  state.mainWindows.clear();
  notificar.desativar();
  principal = janelaPrincipal(1);

  au = novoAutoUpdater();
  moduloUpdater.autoUpdater = au;
  carregar();
  updater.registerIpc();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(userData, { recursive: true, force: true });
});

// ── o que o modulo fixa ao carregar ──────────────────────────────────────────

describe('ao carregar', () => {
  it('baixar e escolha do usuario, e a instalacao NAO acontece no fechamento', () => {
    // As duas ja foram viradas mais de uma vez (ver o comentario no updater);
    // este teste e o que impede a proxima virada por engano.
    expect(au.autoDownload).toBe(false);
    expect(au.autoInstallOnAppQuit).toBe(false);
    expect(au.logger).toBe(logFalso);
  });
});

// ── a verificacao silenciosa ─────────────────────────────────────────────────

describe('a verificacao silenciosa', () => {
  it('aponta para as releases de nipscernlab/sapho e faz a primeira verificacao 6 s depois de subir', async () => {
    updater.initializeUpdateSystem();
    expect(au.setFeedURL).toHaveBeenCalledWith({
      provider: 'github', owner: 'nipscernlab', repo: 'sapho', releaseType: 'release',
    });
    expect(au.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('inicializar duas vezes configura uma vez so', () => {
    updater.initializeUpdateSystem();
    updater.initializeUpdateSystem();
    expect(au.setFeedURL).toHaveBeenCalledTimes(1);
  });

  it('em dev nao agenda nada, para a AURORA de quem desenvolve nao bater no GitHub', async () => {
    pathsFalso.isDev = true;
    carregar();
    updater.initializeUpdateSystem();
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_MS * 2);
    expect(au.checkForUpdates).not.toHaveBeenCalled();
  });

  it('AURORA_UPDATE_FEED troca o feed, mas em dev a verificacao continua bloqueada', async () => {
    // O feed de teste existe para exercitar a atualizacao ponta a ponta sem
    // publicar release (scripts/feed-local.js), e o initializeUpdateSystem
    // abre excecao para ele: em dev COM feed, ele agenda em vez de sair.
    //
    // O que este teste fixa e que a excecao para ali: runSilentCheck e
    // checkForUpdates tem `if (isDev) return` incondicional, entao a
    // verificacao agendada nasce e morre calada, sem nem reagendar. O
    // caminho documentado no feed-local.js e o app INSTALADO (isDev falso),
    // onde nada disso se aplica e o fluxo funciona; em dev, apontar o feed
    // nao basta. Se um dia a excecao tiver de valer de ponta a ponta, sao os
    // dois guardas que precisam olhar o feed, e este teste muda junto.
    process.env.AURORA_UPDATE_FEED = 'http://127.0.0.1:8399/';
    pathsFalso.isDev = true;
    carregar();
    iniciar();
    expect(au.forceDevUpdateConfig).toBe(true);
    expect(au.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'http://127.0.0.1:8399/' });
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(au.checkForUpdates).not.toHaveBeenCalled();
    // E, por causa do retorno sem reagendamento, nao ha proxima.
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_MS * 2);
    expect(au.checkForUpdates).not.toHaveBeenCalled();
  });

  it('sem novidade, a proxima verificacao vem na cadencia periodica', async () => {
    updater.initializeUpdateSystem();
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    au.emit('checking-for-update');
    au.emit('update-not-available');
    // Nada e dito a ninguem numa verificacao silenciosa que nao achou nada.
    expect(principal.recebidos).toEqual([]);
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_MS - 1);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('cada falha recua pela tabela e depois fica de hora em hora, sem nunca parar', async () => {
    updater.initializeUpdateSystem();
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    for (let i = 0; i < SILENT_RETRY_SCHEDULE_MS.length + 2; i++) {
      expect(au.checkForUpdates).toHaveBeenCalledTimes(i + 1);
      au.emit('checking-for-update');
      au.emit('error', new Error('ENOTFOUND api.github.com'));
      const espera = SILENT_RETRY_SCHEDULE_MS[Math.min(i, SILENT_RETRY_SCHEDULE_MS.length - 1)];
      await vi.advanceTimersByTimeAsync(espera - 1);
      expect(au.checkForUpdates).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(au.checkForUpdates).toHaveBeenCalledTimes(SILENT_RETRY_SCHEDULE_MS.length + 3);
    expect(chamar('updates:diagnostics').consecutiveFailures).toBe(SILENT_RETRY_SCHEDULE_MS.length + 2);
  });

  it('quando checkForUpdates rejeita SEM emitir erro, a verificacao ainda e reagendada', async () => {
    // O feed que nao resolve rejeita a promessa e nao dispara o evento; sem o
    // reagendamento neste caminho a maquina ficaria em silencio ate reabrir.
    au.checkForUpdates = vi.fn(async () => { throw new Error('feed indisponivel'); });
    updater.initializeUpdateSystem();
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SILENT_RETRY_SCHEDULE_MS[0]);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(chamar('updates:diagnostics').lastError).toBe('feed indisponivel');
  });

  it('achou uma versao: acende o botao em TODA janela, para de perguntar e nao abre nada sozinho', async () => {
    const segunda = janelaPrincipal(2);
    updater.initializeUpdateSystem();
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    au.emit('checking-for-update');
    au.emit('update-available', {
      version: '7.0.0', releaseNotes: 'Notas da 7.0.0', files: [{ size: 104857600 }],
    });
    await esperar();

    const esperado = {
      state: 'available', newVersion: '7.0.0', currentVersion: '6.20.0', sizeMB: '100.0',
      releaseUrl: 'https://github.com/nipscernlab/sapho/releases/tag/v7.0.0',
    };
    expect(principal.recebidos).toEqual([{ canal: 'updates:available', carga: esperado }]);
    expect(segunda.recebidos).toEqual([{ canal: 'updates:available', carga: esperado }]);
    expect(windowsFalso.createUpdateWindow).not.toHaveBeenCalled();
    expect(chamar('updates:state')).toEqual(esperado);

    // A janela de atualizacao e dona do fluxo agora: sem nova verificacao.
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_MS * 2);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('sem notas na release, o texto vem da API do GitHub, e uma falha ali nao trava o fluxo', async () => {
    const respostas = [JSON.stringify({ body: 'Corpo da release' }), null];
    vi.spyOn(https, 'get').mockImplementation((_opts, cb) => {
      const corpo = respostas.shift();
      const pedido = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      if (corpo === null) {
        pedido.on = (ev, fn) => { if (ev === 'error') setTimeout(() => fn(new Error('sem rede')), 0); };
        return pedido;
      }
      const res = new EventEmitter();
      setTimeout(() => { cb(res); res.emit('data', corpo); res.emit('end'); }, 0);
      return pedido;
    });

    iniciar();
    windowsFalso.createUpdateWindow();
    au.emit('update-available', { version: '7.0.0', releaseNotes: null, files: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(janelaDeUpdate.enviados.at(-1).carga.releaseNotes).toBe('Corpo da release');

    au.emit('update-available', { version: '7.0.1', releaseNotes: [{ note: 'a' }], files: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(janelaDeUpdate.enviados.at(-1).carga.releaseNotes).toBe('');
    expect(janelaDeUpdate.enviados.at(-1).carga.newVersion).toBe('7.0.1');
  });

  it('a verificacao manual avisa "em dia" na janela principal; em dev, avisa que esta desligada', async () => {
    iniciar();
    chamar('check-for-updates');
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
    au.emit('checking-for-update');
    au.emit('update-not-available');
    expect(principal.recebidos).toEqual([{
      canal: 'updates:notice',
      carga: { kind: 'info', titleKey: 'updates.noUpdateTitle', bodyKey: 'updates.noUpdateBody', vars: { version: '6.20.0' } },
    }]);

    pathsFalso.isDev = true;
    carregar();
    updater.registerIpc();
    iniciar();
    principal.recebidos.length = 0;
    chamar('check-for-updates');
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(principal.recebidos[0].carga.titleKey).toBe('updates.devDisabledTitle');
  });
});

// ── o download ───────────────────────────────────────────────────────────────

describe('o download', () => {
  async function versaoDisponivel() {
    iniciar();
    au.emit('update-available', { version: '7.0.0', releaseNotes: 'Notas', files: [{ size: 1048576 }] });
    await esperar();
  }

  it('so comeca pelo IPC, uma vez, e so quando ha versao disponivel', async () => {
    chamar('download-update');
    expect(au.downloadUpdate).not.toHaveBeenCalled();
    await versaoDisponivel();
    chamar('download-update');
    chamar('download-update');
    expect(au.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(state.downloadInProgress).toBe(true);
  });

  it('o progresso vira porcentagem limitada, megabytes e tempo restante para a janela', async () => {
    await versaoDisponivel();
    windowsFalso.createUpdateWindow();
    au.emit('download-progress', { percent: 142, transferred: 52428800, total: 104857600, bytesPerSecond: 1048576 });
    expect(janelaDeUpdate.enviados.at(-1)).toEqual({
      canal: 'update:progress',
      carga: { percent: 100, transferredMB: '50.0', totalMB: '100.0', speedMBs: '1.0', etaSec: 50 },
    });
  });

  it('baixado: grava o registro da pendente, o botao muda para "downloaded" e o sistema e avisado', async () => {
    await versaoDisponivel();
    chamar('download-update');
    principal.recebidos.length = 0;
    au.emit('update-downloaded', { version: '7.0.0' });

    const registro = JSON.parse(fs.readFileSync(pendenteEm(), 'utf8'));
    expect(registro.versao).toBe('7.0.0');
    expect(typeof registro.em).toBe('number');
    expect(state.updateDownloaded).toBe(true);
    expect(state.downloadInProgress).toBe(false);
    expect(principal.recebidos[0].carga).toMatchObject({ state: 'downloaded', newVersion: '7.0.0' });
    expect(chamar('updates:state').state).toBe('downloaded');
  });

  it('uma falha no meio do download tenta de novo pela tabela antes de desistir', async () => {
    await versaoDisponivel();
    windowsFalso.createUpdateWindow();
    chamar('download-update');
    for (let i = 0; i < DOWNLOAD_RETRY_DELAYS_MS.length; i++) {
      au.emit('error', new Error('net::ERR_CONNECTION_RESET'));
      expect(janelaDeUpdate.enviados.at(-1).canal).toBe('update:retrying');
      expect(janelaDeUpdate.enviados.at(-1).carga.attempt).toBe(i + 1);
      await vi.advanceTimersByTimeAsync(DOWNLOAD_RETRY_DELAYS_MS[i]);
      expect(au.downloadUpdate).toHaveBeenCalledTimes(i + 2);
    }
    au.emit('error', new Error('net::ERR_CONNECTION_RESET'));
    expect(janelaDeUpdate.enviados.at(-1)).toEqual({
      canal: 'update:error',
      carga: { message: 'Could not reach the update server. Check your internet connection.' },
    });
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_MS);
    expect(au.downloadUpdate).toHaveBeenCalledTimes(DOWNLOAD_RETRY_DELAYS_MS.length + 1);
  });

  it('a rejeicao do downloadUpdate sem evento de erro conta uma tentativa; com o evento, nao conta duas', async () => {
    await versaoDisponivel();
    windowsFalso.createUpdateWindow();
    au.downloadUpdate = vi.fn(async () => { throw new Error('ENOSPC'); });
    chamar('download-update');
    await esperar();
    const tentativas = janelaDeUpdate.enviados.filter((e) => e.canal === 'update:retrying');
    expect(tentativas).toHaveLength(1);
    expect(tentativas[0].carga.attempt).toBe(1);

    au.downloadUpdate = vi.fn(async () => { au.emit('error', new Error('ENOSPC')); throw new Error('ENOSPC'); });
    await vi.advanceTimersByTimeAsync(DOWNLOAD_RETRY_DELAYS_MS[0]);
    await esperar();
    expect(janelaDeUpdate.enviados.filter((e) => e.canal === 'update:retrying')).toHaveLength(2);
  });

  it('erros ganham uma frase humana na janela de atualizacao', async () => {
    iniciar();
    windowsFalso.createUpdateWindow();
    const casos = [
      ['getaddrinfo ENOTFOUND github.com', 'Could not reach the update server. Check your internet connection.'],
      ['New version has invalid signature', 'Update verification failed. Please try again later.'],
      ['EACCES: permission denied', 'Permission denied while installing the update.'],
      ['algo inesperado', 'algo inesperado'],
    ];
    for (const [bruto, humano] of casos) {
      au.emit('error', new Error(bruto));
      expect(janelaDeUpdate.enviados.at(-1)).toEqual({ canal: 'update:error', carga: { message: humano } });
    }
  });
});

// ── a atualizacao pendente, no arranque ──────────────────────────────────────

describe('aplicarAtualizacaoPendente', () => {
  it('sem registro, nao toca na rede e o arranque segue', async () => {
    await expect(updater.aplicarAtualizacaoPendente()).resolves.toBe(false);
    expect(au.checkForUpdates).not.toHaveBeenCalled();
  });

  it('registro da versao que ja roda: apaga o registro e segue', async () => {
    fs.writeFileSync(pendenteEm(), JSON.stringify({ versao: '6.20.0', em: Date.now() }));
    await expect(updater.aplicarAtualizacaoPendente()).resolves.toBe(false);
    expect(fs.existsSync(pendenteEm())).toBe(false);
    expect(au.checkForUpdates).not.toHaveBeenCalled();
  });

  // Nota do mutation-check: REMOVER o limparPendente daqui quebra este teste
  // (e e o laco de boot que ele existe para impedir), mas MOVE-LO para depois
  // do quitAndInstall nao quebra nada, e nao e falha do teste: o
  // quitAndInstall e diferido por setImmediate, entao as duas ordens apagam o
  // registro no mesmo turno, antes de o processo sair. A ordem no arquivo e
  // intencao escrita, nao comportamento observavel.
  it('registro mais novo: reconstroi o estado pela rede, limpa o registro ANTES de instalar, e instala', async () => {
    fs.writeFileSync(pendenteEm(), JSON.stringify({ versao: '7.0.0', em: Date.now() }));
    au.checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '7.0.0' } }));
    const registroAoInstalar = [];
    au.quitAndInstall = vi.fn(() => registroAoInstalar.push(fs.existsSync(pendenteEm())));
    au.downloadUpdate = vi.fn(async () => { au.emit('update-downloaded', { version: '7.0.0' }); return []; });

    const promessa = updater.aplicarAtualizacaoPendente();
    await esperar();
    await expect(promessa).resolves.toBe(true);
    await vi.runAllTimersAsync();
    expect(au.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(registroAoInstalar).toEqual([false]);
  });

  it('sem rede na hora do boot, o prazo vence e o arranque segue', async () => {
    fs.writeFileSync(pendenteEm(), JSON.stringify({ versao: '7.0.0', em: Date.now() }));
    au.checkForUpdates = vi.fn(() => new Promise(() => {}));
    const promessa = updater.aplicarAtualizacaoPendente({ prazoMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(promessa).resolves.toBe(false);
    expect(au.quitAndInstall).not.toHaveBeenCalled();
  });

  it('o servidor nao tem a versao (release retirada): segue sem instalar', async () => {
    fs.writeFileSync(pendenteEm(), JSON.stringify({ versao: '7.0.0', em: Date.now() }));
    au.checkForUpdates = vi.fn(async () => { au.emit('update-not-available'); return { updateInfo: null }; });
    await expect(updater.aplicarAtualizacaoPendente()).resolves.toBe(false);
    expect(au.downloadUpdate).not.toHaveBeenCalled();
  });
});

// ── depois de atualizar ──────────────────────────────────────────────────────

describe('depois de atualizar', () => {
  it('a confirmacao "voce foi atualizado" sai uma vez so, e nunca numa instalacao nova', () => {
    // Instalacao nova: nao ha versao guardada, entao nao ha o que confirmar.
    expect(chamar('updates:post-update-status')).toEqual({
      justUpdated: false, previousVersion: null, currentVersion: '6.20.0',
    });
    expect(JSON.parse(fs.readFileSync(versaoEm(), 'utf8'))).toEqual({ version: '6.20.0' });

    // A sessao seguinte sobe numa versao nova.
    versaoAtual = '7.0.0';
    carregar();
    updater.registerIpc();
    expect(chamar('updates:post-update-status')).toEqual({
      justUpdated: true, previousVersion: '6.20.0', currentVersion: '7.0.0',
    });
    // Uma segunda janela na mesma sessao nao repete o aviso.
    expect(chamar('updates:post-update-status').justUpdated).toBe(false);
  });

  it('o diagnostico diz o que a maquina andou fazendo', async () => {
    updater.initializeUpdateSystem();
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    au.emit('checking-for-update');
    au.emit('error', new Error('ENOTFOUND'));
    const d = chamar('updates:diagnostics');
    expect(d).toMatchObject({
      currentVersion: '6.20.0', feed: 'nipscernlab/sapho', isDev: false, checking: false,
      checksAttempted: 1, lastCheckResult: 'error', lastError: 'ENOTFOUND', consecutiveFailures: 1,
      logPath: 'C:/falso/main.log',
    });
    expect(d.nextCheckAt).toBeGreaterThan(Date.now());
  });
});

// ── os canais IPC ────────────────────────────────────────────────────────────

describe('os canais IPC', () => {
  it('sao estes, e nenhum outro', () => {
    expect([...handles.keys()].sort()).toEqual([
      'check-for-updates', 'download-update', 'get-app-version', 'quit-and-install',
      'updates:diagnostics', 'updates:open-log', 'updates:open-window', 'updates:post-update-status', 'updates:state',
    ]);
    expect([...ouvintes.keys()].sort()).toEqual([
      'update:dismiss', 'update:download', 'update:install', 'update:minimize', 'update:open-external', 'update:resize',
    ]);
    expect(chamar('get-app-version')).toBe('6.20.0');
  });

  it('abrir a janela so com algo pendente, e ela recebe o estado ao abrir', async () => {
    iniciar();
    expect(chamar('updates:open-window')).toEqual({ ok: false });
    expect(windowsFalso.createUpdateWindow).not.toHaveBeenCalled();

    au.emit('update-available', { version: '7.0.0', releaseNotes: 'Notas', files: [] });
    await esperar();
    expect(chamar('updates:open-window')).toEqual({ ok: true });
    expect(windowsFalso.createUpdateWindow).toHaveBeenCalledTimes(1);
    expect(janelaDeUpdate.enviados).toEqual([{
      canal: 'update:state',
      carga: { state: 'available', currentVersion: '6.20.0', newVersion: '7.0.0', releaseName: '', releaseNotes: 'Notas', sizeMB: '' },
    }]);
  });

  it('a janela que ainda carrega recebe o estado quando terminar', async () => {
    iniciar();
    au.emit('update-available', { version: '7.0.0', releaseNotes: 'Notas', files: [] });
    await esperar();
    janelaDeUpdate = novaJanelaDeUpdate();
    janelaDeUpdate.carregando = true;
    chamar('updates:open-window');
    expect(janelaDeUpdate.enviados).toEqual([]);
    expect(janelaDeUpdate.webContents.once).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
    janelaDeUpdate.webContents.once.mock.calls[0][1]();
    expect(janelaDeUpdate.enviados[0].canal).toBe('update:state');
  });

  it('instalar pelo botao reinicia na versao nova, sem modo silencioso', async () => {
    disparar('update:install');
    await vi.runAllTimersAsync();
    expect(au.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('update:open-external so abre http(s) e mailto', () => {
    disparar('update:open-external', 'file:///C:/Windows/system32/cmd.exe');
    disparar('update:open-external', 42);
    expect(shellFalso.openExternal).not.toHaveBeenCalled();
    disparar('update:open-external', 'https://github.com/nipscernlab/sapho/commit/abc');
    expect(shellFalso.openExternal).toHaveBeenCalledWith('https://github.com/nipscernlab/sapho/commit/abc');
  });

  it('update:resize limita a altura entre 220 e 820 e ignora o que nao e numero', () => {
    windowsFalso.createUpdateWindow();
    disparar('update:resize', 100);
    disparar('update:resize', 5000);
    disparar('update:resize', 'abc');
    disparar('update:resize', 661);   // a 1 px de onde ja esta: nao treme
    expect(janelaDeUpdate.setSize.mock.calls).toEqual([[540, 220, false], [540, 820, false]]);
    expect(janelaDeUpdate.center).toHaveBeenCalledTimes(2);
  });

  it('update:dismiss nao fecha a janela no meio de um download', () => {
    windowsFalso.createUpdateWindow();
    state.downloadInProgress = true;
    disparar('update:dismiss');
    expect(janelaDeUpdate.close).not.toHaveBeenCalled();
    state.downloadInProgress = false;
    disparar('update:dismiss');
    expect(janelaDeUpdate.close).toHaveBeenCalledTimes(1);
  });

  it('update:minimize esconde o card e liga a narracao do sistema no idioma pedido', async () => {
    iniciar();
    au.emit('update-available', { version: '7.0.0', releaseNotes: 'Notas', files: [] });
    await esperar();
    windowsFalso.createUpdateWindow();
    chamar('download-update');
    disparar('update:minimize', 'en');
    expect(janelaDeUpdate.hide).toHaveBeenCalledTimes(1);
    expect(NotificacaoFalsa.criadas.map((n) => n.opts.title)).toEqual(['Updating SAPHO']);
    // Clicar na notificacao traz o card de volta, com o estado pendente.
    NotificacaoFalsa.criadas[0].handlers.click();
    expect(windowsFalso.createUpdateWindow).toHaveBeenCalledTimes(2);
    expect(janelaDeUpdate.enviados.at(-1).carga.newVersion).toBe('7.0.0');
  });
});
