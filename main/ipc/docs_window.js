// @ts-check
/**
 * docs_window.js: o manual do SAPHO dentro da AURORA, numa janela própria.
 *
 * Por que existe: quem tem internet abre o manual no navegador e ganha abas,
 * busca e favoritos de graça. Quem não tem, ou está numa máquina onde a
 * associação de .html foi removida, ficava sem manual nenhum. Esta janela fecha
 * esse ciclo sem depender de nada instalado, porque a própria AURORA é um
 * Chromium.
 *
 * Como é montada: a janela é frameless e a barra de cima é HTML nosso
 * (html/docs-browser.html), com o logo, o título e os controles. O manual em si
 * não é um iframe daquela página, e sim um WebContentsView filho posicionado
 * embaixo da barra. Um iframe file:// não serviria: o Chromium trata cada
 * arquivo local como origem opaca, então a barra não conseguiria ler o
 * histórico dele para acender voltar e avançar. Com um view separado a
 * navegação é do webContents, que responde a goBack/goForward/reload.
 *
 * Fronteira: o view só navega dentro da pasta do manual. Link para fora vai
 * para o navegador do sistema, que é onde link externo deve abrir. Sem isto a
 * janela viraria um navegador irrestrito embutido no aplicativo.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { app, shell, ipcMain, BrowserWindow, WebContentsView } = require('electron');
const log = require('electron-log');

const { loadPage } = require('../render_loader');
// A fronteira de navegacao mora ao lado, em docs_nav.js: e a unica decisao de
// seguranca deste arquivo e e pura, entao da para prova-la sem abrir janela.
const { decidirNavegacao } = require('./docs_nav');

/** Altura da barra de cima, em pixels de layout. Espelha o CSS da página. */
const CHROME_H = 44;

/** @type {import('electron').BrowserWindow|null} */
let win = null;
/** @type {import('electron').WebContentsView|null} */
let view = null;
/** Pasta do manual desta sessão, para decidir o que é navegação interna. */
let raizDocs = '';

/** Reposiciona o view sob a barra sempre que a janela muda de tamanho. */
function ajustarView() {
  if (!win || !view) return;
  const { width, height } = win.getContentBounds();
  view.setBounds({ x: 0, y: CHROME_H, width, height: Math.max(0, height - CHROME_H) });
}

/** Manda o estado de navegação para a barra acender ou apagar os botões. */
function avisarEstado() {
  if (!win || win.isDestroyed() || !view) return;
  const wc = view.webContents;
  try {
    win.webContents.send('docs-window:state', {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      title: wc.getTitle(),
    });
  } catch (_) { /* janela fechando */ }
}

/**
 * Abre (ou traz para frente) a janela do manual.
 * @param {string} dir pasta do manual já resolvida pelo chamador
 * @param {string} [relPage] página inicial, relativa e já validada (docs.js)
 * @param {string} [hash] âncora sem o '#'
 * @returns {import('electron').BrowserWindow}
 */
function open(dir, relPage = 'index.html', hash = '') {
  const indexPath = path.join(dir, relPage);
  if (win && !win.isDestroyed()) {
    // Janela já aberta: navega para a página pedida em vez de só focar.
    if (view) {
      view.webContents.loadFile(indexPath, hash ? { hash } : undefined).catch(() => { /* pagina sumiu */ });
    }
    win.show();
    win.focus();
    return win;
  }

  raizDocs = path.resolve(dir);

  const preloadPath = path.join(app.getAppPath(), 'js', 'app', 'preload_docs.js');
  if (!fs.existsSync(preloadPath)) {
    throw new Error(`Preload do manual nao encontrado: ${preloadPath}`);
  }

  win = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 760,
    minHeight: 520,
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'assets', 'icons', 'sapho_aurora_icon.ico'),
    // Frameless com a barra desenhada pela página, como a janela principal e a
    // do PRISM. thickFrame mantém o Aero snap e o redimensionamento nas bordas.
    frame: false,
    thickFrame: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#0A0D14',
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  view = new WebContentsView({
    webPreferences: {
      // O manual é HTML estático e confiável, mas não ganha ponte nenhuma para
      // o aplicativo: este view só renderiza documentação.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.contentView.addChildView(view);
  view.webContents.loadFile(indexPath, hash ? { hash } : undefined);

  // Link externo é assunto do navegador do sistema, não desta janela.
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => { /* ignore */ });
    return { action: 'deny' };
  });
  view.webContents.on('will-navigate', (e, url) => {
    const { acao } = decidirNavegacao(raizDocs, url);
    if (acao === 'seguir') return;
    e.preventDefault();
    if (acao === 'externa') shell.openExternal(url).catch(() => { /* ignore */ });
    // 'bloquear' nao abre nada, e e o desfecho de file: fora da pasta do manual
    // e de esquemas como javascript: e data:.
  });

  const wc = view.webContents;
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
    wc.on(/** @type {any} */ (ev), () => avisarEstado());
  }

  win.on('resize', ajustarView);
  win.on('closed', () => { win = null; view = null; raizDocs = ''; });
  win.once('ready-to-show', () => {
    ajustarView();
    win?.show();
    avisarEstado();
  });

  loadPage(win, 'html/docs-browser.html').catch((e) => {
    log.error('[docs] falha ao carregar a barra da janela do manual:', e);
  });

  return win;
}

function register() {
  // As duas respondem {ok, error}, e nunca um `false` mudo: quem chama tem
  // que saber se a janela nao existe, se a acao e desconhecida, ou se ela
  // nao se aplica agora (voltar sem historico atras).
  ipcMain.handle('docs-window:nav', (_e, acao) => {
    if (!view) return { ok: false, error: 'a janela do manual nao esta aberta' };
    const wc = view.webContents;
    if (acao === 'back') {
      if (!wc.navigationHistory.canGoBack()) return { ok: false, error: 'nao ha pagina anterior' };
      wc.navigationHistory.goBack();
    } else if (acao === 'forward') {
      if (!wc.navigationHistory.canGoForward()) return { ok: false, error: 'nao ha pagina seguinte' };
      wc.navigationHistory.goForward();
    } else if (acao === 'reload') wc.reload();
    else if (acao === 'home') wc.loadFile(path.join(raizDocs, 'index.html'));
    else return { ok: false, error: `acao de navegacao desconhecida: "${acao}" (esperava back, forward, reload ou home)` };
    return { ok: true };
  });

  ipcMain.handle('docs-window:control', (_e, acao) => {
    if (!win || win.isDestroyed()) return { ok: false, error: 'a janela do manual nao esta aberta' };
    if (acao === 'minimize') win.minimize();
    else if (acao === 'maximize') { win.isMaximized() ? win.unmaximize() : win.maximize(); }
    else if (acao === 'close') win.close();
    else return { ok: false, error: `acao de janela desconhecida: "${acao}" (esperava minimize, maximize ou close)` };
    return { ok: true };
  });

  /** A barra pede o estado assim que carrega, para não nascer com os botões errados. */
  ipcMain.handle('docs-window:sync', () => { avisarEstado(); return true; });
}

module.exports = { open, register };
