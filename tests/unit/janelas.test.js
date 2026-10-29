/**
 * main/windows.ts: as fabricas de janela (principal, abertura, atualizacao), o
 * jump list do Windows e os controles de janela da barra propria.
 *
 * O ponto que motivou o teste e o fechamento (#245): a toolchain so pode
 * morrer quando a janela FECHOU (o `closed`), e nao quando o fechamento foi
 * pedido (o `close`), porque entre um e outro a guarda de arquivos nao salvos
 * ainda pode cancelar. O resto passa pelas linhas que a conversao para .ts
 * tocou.
 *
 * O Electron e falso: nenhuma janela nasce, nenhum registro do Windows e lido
 * e nenhum processo morre (o stopAllToolchain e um espiao).
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);

/** Um emissor minimo: on, once e o disparo pelo teste. */
function emissor(alvo = {}) {
  const ouvintes = {};
  alvo.on = (ev, fn) => { (ouvintes[ev] ||= []).push(fn); return alvo; };
  alvo.once = alvo.on;
  alvo.emitir = (ev, ...a) => { for (const fn of ouvintes[ev] || []) fn(...a); };
  alvo.ouve = (ev) => (ouvintes[ev] || []).length > 0;
  return alvo;
}

const eletron = vi.hoisted(() => ({ janelas: [], ipc: {}, handles: {}, jumpLists: [], jumpListStatus: [] }));

class JanelaFalsa {
  constructor(opcoes) {
    emissor(this);
    this.opcoes = opcoes;
    this.destruida = false;
    this.maximizada = false;
    this.telaCheia = false;
    this.visivel = false;
    this.chamadas = [];
    let zoom = 1;
    this.webContents = emissor({
      id: 100 + eletron.janelas.length,
      enviados: [],
      send(canal, dado) { this.enviados.push([canal, dado]); },
      setWindowOpenHandler(fn) { this.abrir = fn; },
      getZoomFactor: () => zoom,
      setZoomFactor: (z) => { zoom = z; },
    });
    eletron.janelas.push(this);
  }
  isDestroyed() { return this.destruida; }
  isMaximized() { return this.maximizada; }
  isFullScreen() { return this.telaCheia; }
  isVisible() { return this.visivel; }
  show() { this.visivel = true; this.chamadas.push('show'); }
  focus() { this.chamadas.push('focus'); }
  maximize() { this.maximizada = true; this.chamadas.push('maximize'); }
  unmaximize() { this.maximizada = false; this.chamadas.push('unmaximize'); }
  minimize() { this.chamadas.push('minimize'); }
  setFullScreen(v) { this.telaCheia = v; this.chamadas.push(`fullscreen:${v}`); }
  close() { this.chamadas.push('close'); }
  /** O fechamento de verdade: close, e depois closed com a janela destruida. */
  fechar() { this.emitir('close', { preventDefault() {} }); this.destruida = true; this.emitir('closed'); }
  static getAllWindows() { return eletron.janelas.filter((j) => !j.destruida); }
  static fromWebContents(wc) {
    if (wc === 'quebra') throw new Error('sem janela');
    return eletron.janelas.find((j) => j.webContents === wc) || null;
  }
}

vi.mock('electron', () => ({
  app: {
    getAppPath: () => 'C:\\app',
    isPackaged: false,
    setAsDefaultProtocolClient: vi.fn(),
    setJumpList: vi.fn((c) => { eletron.jumpLists.push(c); return eletron.jumpListStatus.shift() ?? 'ok'; }),
  },
  BrowserWindow: JanelaFalsa,
  ipcMain: {
    on: (canal, fn) => { eletron.ipc[canal] = fn; },
    once: (canal, fn) => { eletron.ipc[canal] = fn; },
    handle: (canal, fn) => { eletron.handles[canal] = fn; },
  },
}));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const registro = vi.hoisted(() => ({ reg: { politica: null, rastreia: null } }));
vi.mock('node:child_process', () => {
  const execFileSync = vi.fn((_cmd, args) => {
    const valor = args.includes('NoRecentDocsHistory') ? registro.reg.politica : registro.reg.rastreia;
    if (valor === null) throw new Error('chave ausente');
    return `    ${args[3]}    REG_DWORD    0x${valor.toString(16)}\r\n`;
  });
  return { default: { execFileSync }, execFileSync };
});
const parar = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../main/process_registry.js', () => ({ stopAllToolchain: parar }));
vi.mock('../../main/render_loader.js', () => ({
  loadPage: vi.fn(),
  pageUrl: (p) => ({ ok: true, url: `file:///C:/app/${p}` }),
}));
const recentes = vi.hoisted(() => ({ lista: [] }));
vi.mock('../../main/recents.js', () => ({ default: { prune: () => recentes.lista } }));

// O que o windows.ts carrega so na hora, pelo require do Node: entra pelo cache.
function injetar(modulo, exports) {
  const caminho = req.resolve(`../../main/${modulo}`);
  req.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports };
  return exports;
}
const principais = injetar('main_windows.js', { registrar: vi.fn() });
const claude = injetar('ai/claude_code.js', { killAll: vi.fn() });
const codex = injetar('ai/codex_cli.js', { killAll: vi.fn() });
const aviso = injetar('update_notify.js', { desativar: vi.fn() });
const atualizador = injetar('updater.js', { initializeUpdateSystem: vi.fn() });

const state = (await import('../../main/state.js')).default;
const janelas = await import('../../main/windows.ts');

beforeEach(() => {
  eletron.janelas.length = 0;
  eletron.jumpLists.length = 0;
  eletron.jumpListStatus.length = 0;
  parar.mockClear();
  state.isQuitting = false;
  state.prismWindow = null;
  state.splashWindow = null;
  state.updateWindow = null;
  state.downloadInProgress = false;
  state.fileToOpen = null;
  recentes.lista = [];
  registro.reg = { politica: null, rastreia: null };
});

describe('fechar a janela principal (#245)', () => {
  it('pedir o fechamento nao mata nada: a guarda ainda pode cancelar', () => {
    const j = janelas.createMainWindow();
    j.emitir('close', { preventDefault() {} });
    expect(parar).not.toHaveBeenCalled();
  });

  it('fechada de fato, a ultima janela para a toolchain e fecha o PRISM', () => {
    const prism = new JanelaFalsa({});
    state.prismWindow = prism;
    const j = janelas.createMainWindow();
    j.fechar();
    expect(parar).toHaveBeenCalledTimes(1);
    expect(prism.chamadas).toContain('close');
  });

  it('com outra janela principal aberta, ou saindo do app, nada para aqui', () => {
    const a = janelas.createMainWindow();
    janelas.createMainWindow();
    a.fechar();
    expect(parar).not.toHaveBeenCalled();

    eletron.janelas.length = 0;
    const b = janelas.createMainWindow();
    state.isQuitting = true;
    b.fechar();
    expect(parar).not.toHaveBeenCalled();
  });
});

describe('a janela principal', () => {
  it('registra-se, nega janelas novas e navegacao, e repassa o estado da janela', () => {
    const j = janelas.createMainWindow();
    expect(principais.registrar).toHaveBeenCalledWith(j);
    expect(state.mainWindow).toBe(j);
    expect(j.webContents.abrir()).toEqual({ action: 'deny' });
    const nav = { preventDefault: vi.fn() };
    j.webContents.emitir('will-navigate', nav);
    expect(nav.preventDefault).toHaveBeenCalled();
    j.maximizada = true;
    j.emitir('maximize');
    expect(j.webContents.enviados.at(-1)).toEqual(['window-state', { isMaximized: true, isFullScreen: false }]);
  });

  it('o arquivo pedido na linha de comando abre quando a pagina carrega', () => {
    state.fileToOpen = 'C:\\p\\p.spf';
    const a = janelas.createMainWindow();
    a.webContents.emitir('did-finish-load');
    expect(a.webContents.enviados).toContainEqual(['open-spf-file', { filePaths: ['C:\\p\\p.spf'] }]);
    state.fileToOpen = 'C:\\p\\x.v';
    const b = janelas.createMainWindow();
    b.webContents.emitir('did-finish-load');
    expect(b.webContents.enviados).toContainEqual(['aurora:open-loose-file', { filePath: 'C:\\p\\x.v' }]);
  });

  it('recarregar a pagina ou perder o renderer encerra os turnos de IA dela', () => {
    const j = janelas.createMainWindow();
    j.webContents.emitir('did-start-navigation', {}, 'u', false, true);
    j.webContents.emitir('render-process-gone');
    expect(claude.killAll.mock.calls).toEqual([[j.webContents.id], [j.webContents.id]]);
    expect(codex.killAll).toHaveBeenCalledWith(j.webContents.id);
  });

  it('so mostra e maximiza sozinha fora do fluxo da abertura, e liga o atualizador depois', () => {
    vi.useFakeTimers();
    try {
      const solta = janelas.createMainWindow();
      solta.emitir('ready-to-show');
      expect(solta.chamadas).toEqual(expect.arrayContaining(['maximize', 'show']));
      const adiada = janelas.createMainWindow({ deferShow: true });
      adiada.emitir('ready-to-show');
      expect(adiada.chamadas).not.toContain('show');
      expect(atualizador.initializeUpdateSystem).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2000);
      expect(atualizador.initializeUpdateSystem).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('o jump list', () => {
  it('recentes numa categoria propria quando o Windows aceita', () => {
    recentes.lista = ['C:\\p\\um.spf'];
    janelas.rebuildJumpList();
    const [categorias] = eletron.jumpLists;
    expect(categorias.map((c) => c.type)).toEqual(['custom', 'tasks']);
    expect(categorias[0].items[0]).toEqual(expect.objectContaining({ title: 'um', args: '"C:\\app" "C:\\p\\um.spf"' }));
  });

  it('Windows recusando a categoria: refaz so com as tarefas', () => {
    recentes.lista = ['C:\\p\\um.spf'];
    eletron.jumpListStatus.push('customCategoryAccessDeniedError');
    janelas.rebuildJumpList();
    expect(eletron.jumpLists.at(-1).map((c) => c.type)).toEqual(['tasks']);
  });
});

describe('a janela de atualizacao', () => {
  it('uma so; nao fecha no meio do download, e ao fechar desliga o aviso', () => {
    const j = janelas.createUpdateWindow();
    expect(janelas.createUpdateWindow()).toBe(j);
    expect(j.chamadas).toEqual(['show', 'focus']);
    state.downloadInProgress = true;
    const ev = { preventDefault: vi.fn() };
    j.emitir('close', ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(j.webContents.enviados).toContainEqual(['update:shake', undefined]);
    j.destruida = true;
    j.emitir('closed');
    expect(state.updateWindow).toBeNull();
    expect(aviso.desativar).toHaveBeenCalled();
  });
});

describe('a abertura', () => {
  it('cria a principal escondida e repassa o progresso a tela de abertura', () => {
    vi.useFakeTimers();
    try {
      const splash = janelas.createSplashScreen();
      splash.webContents.emitir('did-finish-load');
      expect(splash.webContents.enviados[0]).toEqual(['splash:progress', { percent: 10, phase: 'boot' }]);
      eletron.ipc['app:renderer-ready']();
      expect(splash.webContents.enviados.at(-1)).toEqual(['splash:progress', { percent: 100, phase: 'ready' }]);
      eletron.ipc['splash:filled']();
      vi.runAllTimers();
      expect(splash.chamadas).toContain('close');
      expect(eletron.janelas[1].chamadas).toEqual(expect.arrayContaining(['maximize', 'show']));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('os controles da barra propria', () => {
  it('minimizar, maximizar, fechar, estado e zoom agem na janela que pediu', async () => {
    janelas.registerWindowControls();
    const j = janelas.createMainWindow();
    const ev = { sender: j.webContents };
    eletron.ipc['window:minimize'](ev);
    eletron.ipc['window:maximize-toggle'](ev);
    eletron.ipc['window:maximize-toggle'](ev);
    j.telaCheia = true;
    eletron.ipc['window:maximize-toggle'](ev);
    eletron.ipc['window:close'](ev);
    expect(j.chamadas.slice(-5)).toEqual(['minimize', 'maximize', 'unmaximize', 'fullscreen:false', 'close']);
    expect(await eletron.handles['window:get-state'](ev)).toEqual({ isMaximized: false, isFullScreen: false });
    eletron.ipc['zoom-in'](ev);
    expect(j.webContents.getZoomFactor()).toBeCloseTo(1.1);
    eletron.ipc['zoom-out']({ sender: 'quebra' });
    expect(j.webContents.getZoomFactor()).toBeCloseTo(1.0);
    eletron.ipc['zoom-reset'](ev);
    expect(j.webContents.getZoomFactor()).toBe(1);
  });
});
