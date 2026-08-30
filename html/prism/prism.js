// @ts-check
'use strict';

// DigitalJS (interactive logic simulation, O9) is loaded LAZILY in
// _loadDigitalJS() — only when the user enters "Simular" mode. Keeping it out
// of the top-level import means the schematic flow never evaluates it (so a
// load error can't break the whole PRISM window), the ~2MB chunk is fetched on
// demand, and we can expose the global `jQuery` that jquery-ui needs BEFORE
// digitaljs evaluates. The sync browser engine + dagre layout avoid any Worker.

// ---------------------------------------------------------------------------
//  i18n — locale-aware string lookup (no access to the main Aurora i18n layer)
// ---------------------------------------------------------------------------
const PRISM_STRINGS = {
  en: {
    title:       'PRISM RTL Viewer',
    loading:     'Loading…',
    preparing:   'Preparing compilation…',
    compiling:   'Compiling RTL design…',
    back:        'Back',
    fit:         'Fit',
    download:    'Download',
    recompile:   'Recompile',
    fitToScreen: 'Fit to Screen',
    resetZoom:   'Reset Zoom',
    clickModule: 'Click to open · Shift+click highlights connections · double-click for source: ',
    clickWire:   'Click to highlight connection',
    highlightCell: 'Highlight connections',
    simulate:    'Simulate',
    schematic:   'Schematic',
    building:    'Building simulation…',
    simError:    'Could not build the simulation',
    simTooLarge: '{m} is too large to simulate interactively ({n} cells, the limit is {l}).',
    simRun: 'Run', simPause: 'Pause', simStep: 'Tick', simNext: 'Next event', simFast: 'Fast',
    simRunTip: 'Runs the simulation at the chosen speed (Space)',
    simPauseTip: 'Stops the simulation; the state stays where it is (Space)',
    simStepTip: 'Advances one tick and stops (Right arrow)',
    simNextTip: 'Advances to the next signal change and stops (Shift+Right arrow)',
    simFastTip: 'Runs with no wait between ticks, as fast as it goes',
    simReset: 'Restart',
    simResetTip: 'Back to tick zero with the registers at their initial value; the switches stay as they are',
    simRestarted: 'Simulation restarted from tick zero.',
    simExport: 'Open in WAVE',
    simExportTip: 'Writes a .vcd with these signals and opens it in the wave viewer',
    simExportEmpty: 'Nothing to export: add a signal to the monitor first.',
    simExported: 'Wave written to {f}; the viewer is opening.',
    simExportError: 'Could not write the wave',
    simStoppedAt: 'Stopped at tick {t}: {s} = {v}',
    simCursorTip: 'Values at this tick; click a wave to move it, Escape clears it',
    simCursorClear: 'Clear the cursor',
    simIo: 'Inputs and outputs', simMonitor: 'Waveforms',
    simIoTip: 'Panel to read and change this module’s ports',
    simMonitorTip: 'Monitor of the chosen signals over time',
    simTick: 'tick', simTicks: 'ticks', simTicksTip: 'Ticks since the simulation started',
    simNoClock: 'No clock in this module: use Tick to advance.',
    simPeriodLabel: 'half period', simPeriod: 'Clock half period, in ticks',
    simSpeedLabel: 'speed', simSpeedUnit: 'tick/s', simSpeed: 'Ticks per second while it runs',
    simInputs: 'Inputs', simOutputs: 'Outputs', simRemove: 'Remove from the monitor',
    simSignal: 'signal', simBase: 'base', simBaseTip: 'Base the value is read in',
    simStopAt: 'stop at', simValue: 'value',
    simStopAtTip: 'Stops the simulation when this signal reaches the value',
    simLive: 'Live', simLiveTip: 'Follows the present; drag the wave to look back',
    simZoomIn: 'Closer in time', simZoomOut: 'Further out in time',
    simMonitorHint: 'Hover a wire and press its monitor button to add it here. Click a wave to read every signal at that tick.',
    simTimeout:  'Synthesizing {m} took longer than {s} s.',
    simHint:     'Open a smaller submodule in the schematic and simulate that one.',
  },
  pt: {
    title:       'Visualizador RTL PRISM',
    loading:     'Carregando…',
    preparing:   'Preparando compilação…',
    compiling:   'Compilando design RTL…',
    back:        'Voltar',
    fit:         'Ajustar',
    download:    'Baixar',
    recompile:   'Recompilar',
    fitToScreen: 'Ajustar à Tela',
    resetZoom:   'Resetar Zoom',
    clickModule: 'Clique para abrir · Shift+clique destaca conexões · duplo-clique p/ o código: ',
    clickWire:   'Clique para destacar conexão',
    highlightCell: 'Destacar conexões',
    simulate:    'Simular',
    schematic:   'Esquemático',
    building:    'Montando a simulação…',
    simError:    'Não foi possível montar a simulação',
    simTooLarge: '{m} é grande demais para simular ao vivo ({n} células, o limite é {l}).',
    simRun: 'Rodar', simPause: 'Pausar', simStep: 'Tick', simNext: 'Próximo evento', simFast: 'Rápido',
    simRunTip: 'Roda a simulação na velocidade escolhida (Espaço)',
    simPauseTip: 'Para a simulação; o estado fica onde está (Espaço)',
    simStepTip: 'Avança um tick e para (seta para a direita)',
    simNextTip: 'Avança até a próxima mudança de sinal e para (Shift+seta para a direita)',
    simFastTip: 'Roda sem espera entre os ticks, o mais rápido que der',
    simReset: 'Reiniciar',
    simResetTip: 'Volta ao tick zero com os registradores no valor inicial; as chaves ficam como estão',
    simRestarted: 'Simulação reiniciada do tick zero.',
    simExport: 'Abrir no WAVE',
    simExportTip: 'Grava um .vcd com estes sinais e abre no visualizador de ondas',
    simExportEmpty: 'Nada para exportar: traga um sinal para o monitor antes.',
    simExported: 'Onda gravada em {f}; o visualizador está abrindo.',
    simExportError: 'Não foi possível gravar a onda',
    simStoppedAt: 'Parou no tick {t}: {s} = {v}',
    simCursorTip: 'Valores neste tick; clique numa onda para movê-lo, Esc tira',
    simCursorClear: 'Tirar o cursor',
    simIo: 'Entradas e saídas', simMonitor: 'Formas de onda',
    simIoTip: 'Painel para ler e mudar as portas deste módulo',
    simMonitorTip: 'Monitor dos sinais escolhidos ao longo do tempo',
    simTick: 'tick', simTicks: 'ticks', simTicksTip: 'Ticks desde o começo da simulação',
    simNoClock: 'Este módulo não tem relógio: avance com Tick.',
    simPeriodLabel: 'meio período', simPeriod: 'Meio período do relógio, em ticks',
    simSpeedLabel: 'velocidade', simSpeedUnit: 'tick/s', simSpeed: 'Ticks por segundo enquanto roda',
    simInputs: 'Entradas', simOutputs: 'Saídas', simRemove: 'Tirar do monitor',
    simSignal: 'sinal', simBase: 'base', simBaseTip: 'Base em que o valor é lido',
    simStopAt: 'parar em', simValue: 'valor',
    simStopAtTip: 'Para a simulação quando este sinal chegar ao valor',
    simLive: 'Ao vivo', simLiveTip: 'Acompanha o presente; arraste a onda para olhar para trás',
    simZoomIn: 'Mais perto no tempo', simZoomOut: 'Mais longe no tempo',
    simMonitorHint: 'Passe o mouse num fio e use o botão de monitor dele para trazê-lo para cá. Clique numa onda para ler todos os sinais naquele tick.',
    simTimeout:  'Sintetizar {m} passou de {s} s.',
    simHint:     'Abra um submódulo menor no esquemático e simule aquele.',
  },
};

function detectLocale() {
  try {
    const v = localStorage.getItem('aurora-locale');
    if (v === 'en' || v === 'pt') return v;
    const legacy = localStorage.getItem('aurora-yanc-lang');
    if (legacy === 'en' || legacy === 'pt') return legacy;
  } catch (_) { /* ignore */ }
  return 'pt';
}

const locale = detectLocale();
const T = PRISM_STRINGS[locale] || PRISM_STRINGS.pt;

// Expose for context menu builder
window.__prismI18n = T;

// Apply initial text
document.title = T.title;
const _setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
_setText('t-title',     T.title);
_setText('t-back',      T.back);
_setText('t-fit',       T.fit);
_setText('t-download',  T.download);
_setText('t-recompile', T.recompile);
_setText('t-simulate',  T.simulate);
_setText('t-compiling', T.compiling);
_setText('currentModule', T.loading);
_setText('currentPath',   T.preparing);

// ---------------------------------------------------------------------------
//  gotosrc no-op — netlistsvg emits onclick="gotosrc(...)" on cells; we
//  replace these with dblclick listeners in setupSVGInteractions.
// ---------------------------------------------------------------------------
window.gotosrc = () => {};

// ---------------------------------------------------------------------------
//  PRISMViewer class
// ---------------------------------------------------------------------------
class PRISMViewer {
  constructor() {
    this.currentScale = 1;
    this.targetScale = 1;       // smooth-zoom goal; currentScale eases toward it
    this._zoomRAF = null;
    this._zoomAnchor = null;
    this.currentX = 0;
    this.currentY = 0;
    this.isDragging = false;
    this.draggingStartedInside = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.navigationHistory = [];
    this.forwardHistory = [];
    this.currentModule = null;
    // Dentro de uma aba do editor (embedded=1) nao ha janela para minimizar
    // nem fechar: os controles saem, e o resto da barra fica igual.
    this.embedded = new URLSearchParams(window.location.search).get('embedded') === '1';
    if (this.embedded) {
      document.body.classList.add('embedded');
      document.querySelector('.window-controls')?.remove();
    }
    this.tempDir = null;
    this._lastTouchPoint = null;
    this._lastTouchDist = null;

    // DigitalJS interactive simulation (O9): null until the user enters Sim mode.
    this.simMode = false;
    this.circuit = null;
    this._paper = null;     // the JointJS paper view, so we can dispose it
    this._simBusy = false;  // re-entrancy guard while a build is in flight
    this._Circuit = null;   // cached DigitalJS Circuit class (lazy-loaded)
    // Sim-mode pan/zoom — a CSS transform on a wrapper around the paper, with
    // the SAME values as the schematic so the two views feel identical.
    this.djsWrapper = null;
    this.paperHost = null;
    this._paperScale = 1;
    this._paperTx = 0;
    this._paperTy = 0;
    this._paperPan = null;
    // A pilha de niveis da simulacao: o topo e, abaixo dele, cada submodulo
    // que a pessoa abriu pela lupa; so o ultimo fica visivel.
    this._simPilha = [];
    this._simDados = null;    // o circuito como veio do main, para o Reiniciar
    this._simChave = null;    // projeto + modulo: a chave das escolhas guardadas
    this._escolhas = null;    // o que a pessoa escolheu nesta simulacao (ver _guardarEscolhas)
    this._cursorTick = null;  // o tick do cursor do monitor, ou null

    this._initElements();
    this._setupListeners();
  }

  _initElements() {
    this.svgContainer    = document.getElementById('svgContainer');
    this.svgWrapper      = document.getElementById('svgWrapper');
    this.svgContent      = document.getElementById('svgContent');
    this.statusOverlay   = document.getElementById('statusOverlay');
    this.currentModuleEl = document.getElementById('currentModule');
    this.currentPathEl   = document.getElementById('currentPath');
    this.breadcrumbsEl   = document.getElementById('breadcrumbs');
    this.backBtn         = document.getElementById('backBtn');
    this.compileBtn      = document.getElementById('compileBtn');
    this.fitBtn          = document.getElementById('fitBtn');
    this.downloadBtn     = document.getElementById('downloadBtn');
    this.zoomInBtn       = document.getElementById('zoomInBtn');
    this.zoomOutBtn      = document.getElementById('zoomOutBtn');
    this.resetZoomBtn    = document.getElementById('resetZoomBtn');
    this.tooltip         = document.getElementById('tooltip');
    this.simToggle       = document.getElementById('simToggle');
    this.djsContainer    = document.getElementById('djsContainer');
  }

  _setupListeners() {
    // Pan / zoom
    this.svgContainer.addEventListener('mousedown', this._onMouseDown.bind(this));
    this.svgContainer.addEventListener('mousemove', this._onMouseMove.bind(this));
    this.svgContainer.addEventListener('mouseup',   this._onMouseUp.bind(this));
    this.svgContainer.addEventListener('mouseleave',this._onMouseUp.bind(this));
    this.svgContainer.addEventListener('wheel',     this._onWheel.bind(this), { passive: false });

    // Touch gestures
    this.svgContainer.addEventListener('touchstart',  this._onTouchStart.bind(this), { passive: false });
    this.svgContainer.addEventListener('touchmove',   this._onTouchMove.bind(this),  { passive: false });
    this.svgContainer.addEventListener('touchend',    this._onTouchEnd.bind(this));
    this.svgContainer.addEventListener('touchcancel', this._onTouchEnd.bind(this));

    // Toolbar buttons
    this.backBtn.addEventListener('click',     () => this.navigateBack());
    this.compileBtn.addEventListener('click',  () => this.recompile());
    this.fitBtn.addEventListener('click',      () => (this.simMode ? this._fitPaper() : this.fitToScreen()));
    this.downloadBtn?.addEventListener('click',() => this.downloadSVG());
    this.zoomInBtn.addEventListener('click',   () => (this.simMode ? this._paperZoom(1.25) : this._zoomButton(1.25)));
    this.zoomOutBtn.addEventListener('click',  () => (this.simMode ? this._paperZoom(0.8)  : this._zoomButton(0.8)));
    this.resetZoomBtn.addEventListener('click',() => (this.simMode ? this._fitPaper() : this.resetView()));
    this.simToggle?.addEventListener('click',  () => this.toggleSimMode());

    // DigitalJS sim: wheel-zoom (same feel as the schematic) on the paper.
    this.djsContainer?.addEventListener('wheel', (e) => {
      if (!this.simMode) return;
      // Sobre um painel ou a barra, a roda e do painel (rolagem), nao do papel:
      // sem isto rolar o monitor dava zoom no circuito por baixo.
      if (e.target instanceof Element && e.target.closest('.sim-panel, .sim-bar')) return;
      e.preventDefault();
      this._paperZoom(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY);
    }, { passive: false });
    // Blank-drag pan: started by the paper's blank:pointerdown, tracked here.
    document.addEventListener('mousemove', (e) => {
      if (!this._paperPan) return;
      this._paperTx = this._paperPan.tx + (e.clientX - this._paperPan.x);
      this._paperTy = this._paperPan.ty + (e.clientY - this._paperPan.y);
      this._applyPaperTransform();
    });
    document.addEventListener('mouseup', () => {
      if (this._paperPan) { this._paperPan = null; this.djsContainer?.classList.remove('panning'); }
    });

    // IPC — compilation complete
    if (window.electronAPI?.onCompilationComplete) {
      window.electronAPI.onCompilationComplete(this._onCompilationComplete.bind(this));
    }

    // A AuroraAPI (e por ela a Aurora Intelligence) opera o Simular daqui de
    // fora: o main entrega o comando, esta pagina o executa e responde.
    window.electronAPI?.onPrismCommand?.((id, cmd) => {
      Promise.resolve()
        .then(() => this._comandoDaApi(cmd))
        .then((r) => window.electronAPI.replyPrismCommand(id, r))
        .catch((e) => window.electronAPI.replyPrismCommand(id, { ok: false, error: e?.message || String(e) }));
    });

    // Window controls
    document.getElementById('win-min')?.addEventListener('click', () => window.electronAPI?.windowMinimize?.());
    document.getElementById('win-max')?.addEventListener('click', () => window.electronAPI?.windowMaximizeToggle?.());
    document.getElementById('win-close')?.addEventListener('click', () => window.electronAPI?.windowClose?.());

    // Maximize/restore button state
    if (window.electronAPI?.onWindowState) {
      window.electronAPI.onWindowState((state) => {
        document.body.classList.toggle('window-maximized', !!state.isMaximized);
      });
    }

    // Double-click on drag region to maximize/restore
    const toolbar = document.getElementById('prism-titlebar');
    if (toolbar) {
      toolbar.addEventListener('dblclick', (e) => {
        if (e.target.closest('button, .prism-module-info, .window-controls')) return;
        window.electronAPI?.windowMaximizeToggle?.();
      });
    }

    // Document-level: clear wire highlights on click outside SVG
    document.addEventListener('click', this._onDocumentClick.bind(this));

    // Mouse side buttons walk the module click history like a browser:
    // X1 (button 3) = back, X2 (button 4) = forward. preventDefault on mousedown
    // suppresses Chromium's own page back/forward for these buttons.
    window.addEventListener('mousedown', (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 3) { e.preventDefault(); this.navigateBack(); }
      else if (e.button === 4) { e.preventDefault(); this.navigateForward(); }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', this._onKeyDown.bind(this));

    // Context menu
    document.addEventListener('contextmenu', this._onContextMenu.bind(this));

    // Ctrl+wheel anywhere: block the browser's page-zoom and zoom the canvas.
    // Over the container the element-level wheel handler already runs, so only
    // act here when the cursor is OUTSIDE it (avoids a double zoom step).
    document.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();                 // block the browser's page-zoom in both modes
      if (this.simMode) return;           // sim mode: leave the circuit to JointJS
      if (!this.svgContainer.contains(e.target)) this._onWheel(e);
    }, { passive: false });

    // Window resize → re-fit (schematic only; DigitalJS lays itself out)
    window.addEventListener('resize', () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => { if (!this.simMode) this.fitToScreen(); }, 250);
    });
  }

  // -------------------------------------------------------------------------
  //  IPC handlers
  // -------------------------------------------------------------------------
  _onCompilationComplete(data) {
    if (!data.success) {
      this._showStatus(`Compilation Error: ${data.message}`, true);
      return;
    }
    // A fresh (re)compile returns to the schematic; the live circuit is stale.
    if (this.simMode) this.exitSimMode();
    this.currentModule = data.topLevelModule;
    this.tempDir = data.tempDir;
    this.navigationHistory = [{ module: data.topLevelModule, svgPath: data.svgPath }];
    this.forwardHistory = [];
    this._loadSVG(data.svgPath, data.topLevelModule);
  }

  // -------------------------------------------------------------------------
  //  SVG loading
  // -------------------------------------------------------------------------
  async _loadSVG(svgPath, moduleName, { retomando = false } = {}) {
    try {
      this._showStatus(`Loading ${moduleName}…`, false);

      const svgText = await window.electronAPI.readFile(svgPath);
      if (!svgText || !svgText.includes('<svg')) throw new Error('Invalid SVG content');

      // Fade-in
      this.svgContent.classList.remove('fade-enter', 'fade-enter-active');
      this.svgContent.classList.add('fade-enter');
      this.svgContent.innerHTML = svgText;
      this.currentModule = moduleName;
      requestAnimationFrame(() => this.svgContent.classList.add('fade-enter-active'));

      this._updateModuleInfo(moduleName, svgPath);
      this._updateBreadcrumbs();
      // Labels first: cutting a wire around a label replaces it by two
      // segments, and the listeners below must land on the segments.
      this._adjustBusLabels();
      this._setupSVGInteractions();
      this._hideStatus();

      // An SVG is now on screen — allow downloading it. Enabled on every
      // load so the button works at any navigation level, not just the top.
      if (this.downloadBtn) this.downloadBtn.disabled = false;

      setTimeout(() => this.fitToScreen(), 100);
    } catch (err) {
      // O SVG de um modulo ja visitado pode ter sumido do Temp (outra
      // compilacao limpou a pasta, por exemplo). O Voltar nao pode morrer por
      // isso: o modulo e reconstruivel, entao reconstroi, e se nem o JSON do
      // modulo existe mais, recompila o projeto e volta a ele. Uma tentativa
      // so, para um erro persistente nao virar laco.
      const sumiu = /ENOENT|no such file/i.test(String(err && err.message));
      if (sumiu && !retomando && this.tempDir) {
        this._log(`${moduleName}: the drawing was gone from Temp, rebuilding it`, 'warning');
        const r = await this._reconstruirModulo(moduleName);
        if (r && r.svgPath) {
          const entrada = this.navigationHistory.find((h) => h.module === moduleName);
          if (entrada) entrada.svgPath = r.svgPath;
          return this._loadSVG(r.svgPath, moduleName, { retomando: true });
        }
      }
      console.error('[PRISM] Failed to load SVG:', err);
      this._showStatus(`Failed to load SVG: ${err.message}`, true);
      this._log(`failed to load the drawing of ${moduleName}: ${err.message}`, 'error');
    }
  }

  /** Regenera o SVG de um modulo; sem o JSON dele, recompila antes. */
  async _reconstruirModulo(moduleName) {
    try {
      let r = await window.electronAPI.generateSVGFromModule(moduleName, this.tempDir);
      if (r && r.success) return r;
      this._log(`${moduleName}: module JSON is gone too, recompiling the project`, 'warning');
      const paths = await window.electronAPI.getPrismCompilationPaths();
      paths.prismMode = this.embedded ? 'tab' : 'window';
      const c = await window.electronAPI.prismRecompile(paths);
      if (!c || !c.success) { this._log(`recompile failed: ${c && c.message ? c.message : 'no reason given'}`, 'error'); return null; }
      this.tempDir = c.tempDir || this.tempDir;
      r = await window.electronAPI.generateSVGFromModule(moduleName, this.tempDir);
      return r && r.success ? r : null;
    } catch (e) {
      this._log(`could not rebuild ${moduleName}: ${e && e.message ? e.message : e}`, 'error');
      return null;
    }
  }

  /** Manda uma linha ao terminal PRISM da AURORA. Nunca lanca. */
  _log(message, type = 'info') {
    try { window.electronAPI.logToTerminal?.(message, type); } catch (_) { /* sem ponte */ }
  }

  /**
   * Ajusta as marcas de largura do barramento (o "/32/" em cima do fio).
   *
   * O netlistsvg desenha o numero dentro de um retangulo dimensionado por
   * contagem de caracteres, e antes daqui saia um `dx` fixo por cima disso: o
   * numero ficava empurrado para a direita e sobrava um vao a esquerda, dentro
   * de uma caixa que nao era do tamanho de nada. O retangulo agora e so a
   * mascara que impede o fio de cruzar os digitos, medida no proprio texto
   * depois de ele existir na tela; a borda dele sai no CSS.
   */
  _adjustBusLabels() {
    const svg = this.svgContent.querySelector('svg');
    if (!svg) return;
    const labels = this.svgContent.querySelectorAll('text[class*="busLabel_"]');
    const caixas = [];
    labels.forEach((label) => {
      label.removeAttribute('dx');
      const rect = label.previousElementSibling;
      if (!rect || rect.tagName.toLowerCase() !== 'rect') return;
      let caixa;
      // getBBox exige o elemento renderizado; num SVG ainda sem layout ele
      // lanca, e ai a caixa fica como o netlistsvg a deixou.
      try { caixa = label.getBBox(); } catch (_) { return; }
      if (!caixa || !caixa.width) return;
      const folga = 1;
      caixas.push({
        x: caixa.x - folga,
        y: caixa.y - folga,
        width: caixa.width + folga * 2,
        height: caixa.height + folga * 2,
      });
      // O retangulo do netlistsvg sai do documento. Ele so existia para
      // esconder o fio, e o corte abaixo faz isso na geometria; um elemento
      // que nao precisa existir nao pode ser pintado por regra nenhuma.
      rect.remove();
    });
    this._cutWiresUnderLabels(svg, caixas);
  }

  /**
   * O fio nao passa por tras do numero, e o fundo continua sendo o fundo.
   *
   * Duas versoes anteriores erraram de jeitos diferentes. A primeira pintava
   * o retangulo da etiqueta com a cor do fundo; mas o canvas nao e uma cor, e
   * a caixa solida aparecia por cima da grade de pontos e da vinheta. A
   * segunda escondia o retangulo e cortava o fio com uma mascara do SVG; so
   * que a mascara corta tambem o brilho do fio destacado, com borda reta, e
   * a caixa voltava como um buraco retangular no meio do realce.
   *
   * Aqui o corte e na GEOMETRIA: cada <line> que cruza uma etiqueta vira
   * dois segmentos, um que termina na borda de ca e outro que comeca na
   * borda de la. Nao ha nada a pintar nem a mascarar, entao o brilho de
   * cada ponta se desfaz sozinho, como o de qualquer ponta de fio. Os dois
   * segmentos carregam o mesmo `data-cut-group`, e o preenchimento do
   * realce (_findConnectedWires) atravessa o vao por ele, senao o destaque
   * pararia na etiqueta. O netlistsvg desenha fio como <line>; um fio de
   * outro tipo que cruze uma etiqueta fica como esta, que e raro e so
   * custa o numero por cima da linha.
   */
  _cutWiresUnderLabels(svg, caixas) {
    if (!caixas.length) return;
    let grupo = 0;
    const linhas = Array.from(svg.querySelectorAll('line')).filter((l) => !l.closest('g[data-cell-type]'));
    for (const caixa of caixas) {
      const x0 = caixa.x, x1 = caixa.x + caixa.width, y0 = caixa.y, y1 = caixa.y + caixa.height;
      for (const linha of linhas) {
        if (!linha.isConnected) continue;
        const a = { x: +linha.getAttribute('x1'), y: +linha.getAttribute('y1') };
        const b = { x: +linha.getAttribute('x2'), y: +linha.getAttribute('y2') };
        let partes = null;
        if (a.y === b.y && a.y >= y0 && a.y <= y1) {
          // Horizontal: sobrevive o que fica fora de [x0, x1], em cada lado.
          const esq = Math.min(a.x, b.x), dir = Math.max(a.x, b.x);
          if (dir <= x0 || esq >= x1) continue;
          partes = [];
          if (esq < x0) partes.push([{ x: esq, y: a.y }, { x: x0, y: a.y }]);
          if (dir > x1) partes.push([{ x: x1, y: a.y }, { x: dir, y: a.y }]);
        } else if (a.x === b.x && a.x >= x0 && a.x <= x1) {
          const topo = Math.min(a.y, b.y), base = Math.max(a.y, b.y);
          if (base <= y0 || topo >= y1) continue;
          partes = [];
          if (topo < y0) partes.push([{ x: a.x, y: topo }, { x: a.x, y: y0 }]);
          if (base > y1) partes.push([{ x: a.x, y: y1 }, { x: a.x, y: base }]);
        }
        if (!partes) continue;
        const id = `cut-${++grupo}`;
        for (const [p, q] of partes) {
          const seg = /** @type {SVGLineElement} */ (linha.cloneNode(false));
          seg.setAttribute('x1', String(p.x)); seg.setAttribute('y1', String(p.y));
          seg.setAttribute('x2', String(q.x)); seg.setAttribute('y2', String(q.y));
          seg.dataset.cutGroup = id;
          linha.parentNode.insertBefore(seg, linha);
          linhas.push(seg);
        }
        linha.remove();
      }
    }
  }

  // -------------------------------------------------------------------------
  //  SVG download
  // -------------------------------------------------------------------------
  /**
   * Save the diagram currently on screen as a standalone .svg file. Reads
   * whatever module is loaded right now, so it works at any navigation
   * level (top-level or a drilled-into submodule). The file is named after
   * the active module. Uses a Blob + <a download>; Electron surfaces its
   * native Save dialog with no extra IPC.
   */
  downloadSVG() {
    const svg = this.svgContent.querySelector('svg');
    if (!svg) return;

    // Clone so the namespace tweaks below never touch the live, interactive
    // SVG (highlights, listeners) the user is still viewing.
    const clone = /** @type {SVGElement} */ (svg.cloneNode(true));
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    const serialized = new XMLSerializer().serializeToString(clone);
    const source = '<?xml version="1.0" encoding="UTF-8"?>\n' + serialized;
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${this._safeFileName(this.currentModule || 'diagram')}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Strip characters that can't live in a filename, keeping the module name readable. */
  _safeFileName(name) {
    return String(name).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'diagram';
  }

  // -------------------------------------------------------------------------
  //  Navigation
  // -------------------------------------------------------------------------
  async navigateToModule(moduleName) {
    if (moduleName === this.currentModule || !this.tempDir) return;
    this._showStatus(`Generating diagram for: ${moduleName}…`, false);
    try {
      const result = await window.electronAPI.generateSVGFromModule(moduleName, this.tempDir);
      if (result.success) {
        this.navigationHistory.push({ module: moduleName, svgPath: result.svgPath });
        this.forwardHistory = []; // a new drill-in invalidates the forward stack
        await this._loadSVG(result.svgPath, moduleName);
        this.backBtn.disabled = false;
      } else {
        this._showStatus(result.message || `Module not found: ${moduleName}`, true);
        setTimeout(() => this._hideStatus(), 3000);
      }
    } catch (err) {
      this._showStatus(`Error loading module: ${err.message}`, true);
      setTimeout(() => this._hideStatus(), 3000);
    }
  }

  navigateBack() {
    // Na simulacao, Voltar sobe um nivel de submodulo; o historico do
    // esquematico fica onde esta, esperando a volta.
    if (this.simMode) {
      if (this._simPilha.length > 1) this._voltarNivel(this._simPilha.length - 2);
      return;
    }
    if (this.navigationHistory.length <= 1) return;
    this.forwardHistory.push(this.navigationHistory.pop());
    const prev = this.navigationHistory[this.navigationHistory.length - 1];
    this._loadSVG(prev.svgPath, prev.module);
    this.backBtn.disabled = this.navigationHistory.length <= 1;
  }

  // Re-enter a module the user backed out of (mouse forward / X2 button).
  navigateForward() {
    if (this.simMode || this.forwardHistory.length === 0) return;
    const next = this.forwardHistory.pop();
    this.navigationHistory.push(next);
    this._loadSVG(next.svgPath, next.module);
    this.backBtn.disabled = this.navigationHistory.length <= 1;
  }

  async recompile() {
    this.navigationHistory = [];
    this.forwardHistory = [];
    this.backBtn.disabled = true;
    this._showStatus('Recompiling RTL design…', false);
    try {
      const paths = await window.electronAPI.getPrismCompilationPaths();
      if (!paths) throw new Error('Failed to acquire compilation paths');
      // Na aba nao ha janela do PRISM para o main avisar: o resultado volta
      // por aqui e a propria pagina o aplica.
      paths.prismMode = this.embedded ? 'tab' : 'window';
      const result = await window.electronAPI.prismRecompile(paths);
      if (!result.success) this._showStatus(`Compilation Error: ${result.message}`, true);
      else if (this.embedded) this._onCompilationComplete(result);
    } catch (err) {
      this._showStatus(`Compilation Failed: ${err.message}`, true);
    }
  }

  // -------------------------------------------------------------------------
  //  SVG interactions
  // -------------------------------------------------------------------------
  _isClickableModuleType(type) {
    if (!type) return false;
    const skip = [
      /^\$_/, /^\$dff/, /^\$mux/, /^\$add/, /^\$sub/, /^\$mul/,
      /^\$div/, /^\$mod/, /^\$eq/, /^\$ne/, /^\$lt/, /^\$le/,
      /^\$gt/, /^\$ge/, /^\$and/, /^\$or/, /^\$xor/, /^\$not/,
      /^\$reduce/, /^\$logic/, /^\$shift/, /^\$pmux/, /^\$lut/,
      /^\$assert/, /^\$assume/, /^\$cover/, /^\$specify/,
    ];
    for (const re of skip) if (re.test(type)) return false;
    return type.startsWith('$paramod') ||
      (!type.startsWith('$') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(type));
  }

  _setupSVGInteractions() {
    const svg = this.svgContent.querySelector('svg');
    if (!svg) return;

    // Module cells — left-click to navigate
    svg.querySelectorAll('g[data-cell-type]').forEach((group) => {
      const type = group.dataset.cellType;
      if (!type || !this._isClickableModuleType(type)) return;

      group.style.cursor = 'pointer';
      group.classList.add('module-clickable');

      group.addEventListener('mouseenter', (e) => {
        group.style.opacity = '0.75';
        this._showTooltip(e, T.clickModule + type);
      });
      group.addEventListener('mouseleave', () => {
        group.style.opacity = '1';
        this._hideTooltip();
      });
      group.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Shift+click keeps the old "what does this cell connect to" gesture
        // that used to live, by accident, on the cell body: the body is a
        // <path>, and the generic wire listener caught it before the click
        // reached this group, so the name opened the module and the rectangle
        // highlighted. Now the whole cell opens, and the highlight has a
        // gesture of its own (also in the context menu).
        if (e.shiftKey) { clearTimeout(this._navTimer); this._highlightCellConnections(group); return; }
        // Single click navigates, but a double click on the SAME cell opens
        // its source. Defer navigation by one dblclick window so the dblclick
        // handler below can cancel it, otherwise the first click of a
        // double-click would navigate away before the source ever opens.
        clearTimeout(this._navTimer);
        this._navTimer = setTimeout(() => this.navigateToModule(type), 250);
      });
    });

    // Source-file double-click — opens the .v at the line that cell came from
    svg.querySelectorAll('g[onclick^="gotosrc"]').forEach((group) => {
      const m = (group.getAttribute('onclick') || '').match(/gotosrc\(\s*['"]([^'"]+)['"]\s*\)/);
      if (!m) return;
      group.removeAttribute('onclick');
      group.dataset.src = m[1];
      group.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(this._navTimer);  // cancel the pending single-click navigation
        this._openSourceFromLocator(group.dataset.src);
      });
    });

    // Wire highlighting. Anything drawn inside a clickable module cell (its
    // body, pins, skin strokes) is part of the cell's click area and must let
    // the click bubble up to the group above, so it gets no listener here.
    svg.querySelectorAll('path, line, polyline').forEach((wire) => {
      if (wire.closest('g.module-clickable')) return;
      wire.style.cursor = 'pointer';
      wire.addEventListener('click', (e) => { e.stopPropagation(); this._highlightWireConnection(wire); });
      wire.addEventListener('mouseenter', (e) => { this._showTooltip(e, T.clickWire); });
      wire.addEventListener('mouseleave', () => this._hideTooltip());
    });
  }

  async _openSourceFromLocator(locator) {
    if (!locator) return;
    const m = locator.match(/^(.+?):(\d+)(?:\.(\d+))?/);
    if (!m) return;
    const [, filePath, lineStr, colStr] = m;
    try {
      await window.electronAPI.openSourceFile({
        filePath,
        line: parseInt(lineStr, 10),
        column: colStr ? parseInt(colStr, 10) : 1,
      });
    } catch (e) { console.error('[PRISM] openSource failed:', e); }
  }

  // -------------------------------------------------------------------------
  //  Wire highlighting
  // -------------------------------------------------------------------------
  _highlightWireConnection(clicked) {
    const svg = this.svgContent.querySelector('svg');
    if (!svg) return;
    this._clearWireHighlights();
    const pts = this._wireEndpoints(clicked);
    this._findConnectedWires(pts, svg).forEach((w) => this._applyHighlight(w));
    this._applyHighlight(clicked);
  }

  /**
   * Highlight every wire that touches a module cell. The cell's own strokes
   * (body, pins) give the starting points; the flood fill in
   * _findConnectedWires does the rest, exactly as a click on a wire would.
   * The cell's strokes are not themselves highlighted: the glow belongs to
   * the connections, the cell already has its hover affordance.
   */
  _highlightCellConnections(group) {
    const svg = this.svgContent.querySelector('svg');
    if (!svg) return;
    this._clearWireHighlights();
    // netlistsvg puts every cell inside a <g transform="translate(...)">, so
    // the cell's own strokes are in LOCAL coordinates and the wires in the
    // SVG's; comparing the two raw only matched by coincidence (the clk pin
    // and nothing else). The cell's box is converted to the SVG's space, and
    // every wire that ENDS against that box is a seed; the usual flood fill
    // then follows each seed to the far end of its net.
    const box = this._rootBBox(group, svg);
    if (!box) return;
    const TOL = 5;
    const touchesBox = (w) => {
      const m = this._toRoot(w, svg);
      return this._wireEndpoints(w).some((p) => {
        const q = m ? new DOMPoint(p.x, p.y).matrixTransform(m) : p;
        return q.x >= box.x - TOL && q.x <= box.x + box.width + TOL
            && q.y >= box.y - TOL && q.y <= box.y + box.height + TOL;
      });
    };
    const found = new Set();
    svg.querySelectorAll('path, line, polyline').forEach((w) => {
      if (group.contains(w) || !touchesBox(w)) return;
      found.add(w);
      this._findConnectedWires(this._wireEndpoints(w), svg).forEach((c) => {
        if (!group.contains(c)) found.add(c);
      });
    });
    found.forEach((w) => this._applyHighlight(w));
  }

  /** Matrix taking `el`'s local coordinates to the SVG root's, or null. */
  _toRoot(el, svg) {
    try {
      const root = svg.getScreenCTM();
      const own = el.getScreenCTM();
      if (!root || !own) return null;
      return root.inverse().multiply(own);
    } catch (_) { return null; }
  }

  /** `group`'s bounding box in the SVG root's coordinates, or null. */
  _rootBBox(group, svg) {
    let local;
    try { local = group.getBBox(); } catch (_) { return null; }
    const m = this._toRoot(group, svg);
    if (!m) return local;
    const corners = [
      [local.x, local.y], [local.x + local.width, local.y],
      [local.x, local.y + local.height], [local.x + local.width, local.y + local.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  _wireEndpoints(wire) {
    const pts = [];
    if (wire.tagName === 'path') {
      const d = wire.getAttribute('d') || '';
      const cmds = d.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi) || [];
      cmds.forEach((cmd) => {
        const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);
        if (coords.length >= 2) pts.push({ x: coords[coords.length - 2], y: coords[coords.length - 1] });
      });
    } else if (wire.tagName === 'line') {
      pts.push({ x: +wire.getAttribute('x1'), y: +wire.getAttribute('y1') });
      pts.push({ x: +wire.getAttribute('x2'), y: +wire.getAttribute('y2') });
    } else if (wire.tagName === 'polyline') {
      const raw = (wire.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i + 1 < raw.length; i += 2) pts.push({ x: raw[i], y: raw[i + 1] });
    }
    return pts;
  }

  _findConnectedWires(startPts, svg) {
    const TOL = 5;
    const connected = new Set();
    const checked = new Set();
    const toCheck = [...startPts];
    const allWires = svg.querySelectorAll('path, line, polyline');

    while (toCheck.length > 0) {
      const pt = toCheck.pop();
      allWires.forEach((w) => {
        if (checked.has(w)) return;
        const wPts = this._wireEndpoints(w);
        const hits = wPts.some((wp) => Math.abs(wp.x - pt.x) <= TOL && Math.abs(wp.y - pt.y) <= TOL);
        if (hits) {
          connected.add(w);
          checked.add(w);
          const pushPts = (pts) => pts.forEach((p) => {
            if (!toCheck.some((q) => Math.abs(q.x - p.x) <= TOL && Math.abs(q.y - p.y) <= TOL)) toCheck.push(p);
          });
          pushPts(wPts);
          // A wire cut around a bus label is two segments with a gap wider
          // than TOL between them; the shared cut group carries the flood
          // across the gap, so the highlight does not stop at the label.
          const grupo = w.dataset && w.dataset.cutGroup;
          if (grupo) {
            svg.querySelectorAll(`[data-cut-group="${grupo}"]`).forEach((irmao) => {
              if (checked.has(irmao)) return;
              connected.add(irmao);
              checked.add(irmao);
              pushPts(this._wireEndpoints(irmao));
            });
          }
        }
      });
    }
    return Array.from(connected);
  }

  _applyHighlight(wire) {
    wire.classList.add('highlighted');
    wire.dataset.origStroke = wire.getAttribute('stroke') || '';
    wire.dataset.origWidth  = wire.getAttribute('stroke-width') || '';
    wire.style.stroke = 'var(--aurora-mint)';
    wire.style.strokeWidth = String(Math.max(+wire.dataset.origWidth * 2 || 2, 3));
    wire.style.filter = 'drop-shadow(0 0 4px rgba(95, 224, 176, 0.7))';
  }

  _clearWireHighlights() {
    const svg = this.svgContent.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.highlighted').forEach((w) => {
      w.classList.remove('highlighted');
      if (w.dataset.origStroke !== undefined) { w.style.stroke = w.dataset.origStroke; delete w.dataset.origStroke; }
      if (w.dataset.origWidth  !== undefined) { w.style.strokeWidth = w.dataset.origWidth; delete w.dataset.origWidth; }
      w.style.filter = '';
    });
  }

  // -------------------------------------------------------------------------
  //  Pan / zoom
  // -------------------------------------------------------------------------
  _onMouseDown(e) {
    if (e.button !== 0) return;
    const svg = this.svgContent.querySelector('svg');
    this.draggingStartedInside = !!(svg && svg.contains(e.target));
    if (!this.draggingStartedInside) { this._clearWireHighlights(); this.isDragging = false; return; }
    this.isDragging = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this.svgContainer.classList.add('dragging');
  }

  _onMouseMove(e) {
    if (!this.isDragging) return;
    this.currentX += e.clientX - this.lastMouseX;
    this.currentY += e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this._applyTransform();
  }

  _onMouseUp(e) {
    if (e.button !== 0) return;
    if (this.isDragging) {
      const svg = this.svgContent.querySelector('svg');
      if (this.draggingStartedInside && svg && !svg.contains(e.target)) this._clearWireHighlights();
    }
    this.isDragging = false;
    this.svgContainer.classList.remove('dragging');
  }

  _onDocumentClick(e) {
    const svg = this.svgContent.querySelector('svg');
    if (svg && !svg.contains(e.target)) this._clearWireHighlights();
  }

  _onWheel(e) {
    e.preventDefault();
    // Plain mouse wheel = zoom (no Ctrl needed), anchored under the cursor.
    // Shift+wheel still pans horizontally for trackpad-less users.
    if (e.shiftKey) {
      this.currentX -= (e.deltaY || e.deltaX);
      this._applyTransform();
      return;
    }
    const factor = Math.exp(-e.deltaY * 0.0016);   // gentle per-notch step
    this._zoomTo((this.targetScale || this.currentScale) * factor, e.clientX, e.clientY);
  }

  /**
   * Smooth zoom: set a target scale + cursor anchor and ease `currentScale`
   * toward it each frame. Scrolling fast pushes the target ahead (accelerates);
   * the ease catches up and settles (decelerates) — a gentle, "levelled" feel.
   */
  _zoomTo(target, cx, cy) {
    this.targetScale = Math.max(0.1, Math.min(5, target));
    this._zoomAnchor = { x: cx, y: cy };
    if (!this._zoomRAF) this._zoomRAF = requestAnimationFrame(() => this._zoomStep());
  }

  _zoomStep() {
    const diff = this.targetScale - this.currentScale;
    if (Math.abs(diff) < 0.0006) {
      this._applyScaleAnchored(this.targetScale);
      this._zoomRAF = null;
      return;
    }
    this._applyScaleAnchored(this.currentScale + diff * 0.18);
    this._zoomRAF = requestAnimationFrame(() => this._zoomStep());
  }

  _applyScaleAnchored(newScale) {
    const a = this._zoomAnchor;
    if (a) {
      const rect = this.svgContainer.getBoundingClientRect();
      const rx = a.x - rect.left, ry = a.y - rect.top;
      const sf = newScale / this.currentScale;
      this.currentX = rx - (rx - this.currentX) * sf;
      this.currentY = ry - (ry - this.currentY) * sf;
    }
    this.currentScale = newScale;
    this._applyTransform();
  }

  _cancelZoomAnim() {
    if (this._zoomRAF) { cancelAnimationFrame(this._zoomRAF); this._zoomRAF = null; }
    this.targetScale = this.currentScale;
  }

  /** Smooth zoom from the +/- buttons, anchored on the canvas centre. */
  _zoomButton(factor) {
    const r = this.svgContainer.getBoundingClientRect();
    this._zoomTo((this.targetScale || this.currentScale) * factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  // Touch
  _touchDist(t) { return Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY); }
  _touchCenter(t) { return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 }; }

  _onTouchStart(e) {
    if (e.touches.length === 1) { this._lastTouchPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY }; this._lastTouchDist = null; }
    else if (e.touches.length === 2) { this._lastTouchDist = this._touchDist(e.touches); this._lastTouchPoint = this._touchCenter(e.touches); }
  }

  _onTouchMove(e) {
    if (e.touches.length === 1 && this._lastTouchPoint) {
      e.preventDefault();
      this.currentX += e.touches[0].clientX - this._lastTouchPoint.x;
      this.currentY += e.touches[0].clientY - this._lastTouchPoint.y;
      this._lastTouchPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      this._applyTransform();
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const newDist = this._touchDist(e.touches);
      const center = this._touchCenter(e.touches);
      if (this._lastTouchDist && this._lastTouchPoint) {
        this.currentX += center.x - this._lastTouchPoint.x;
        this.currentY += center.y - this._lastTouchPoint.y;
        this.zoom(newDist / this._lastTouchDist, center.x, center.y);
      }
      this._lastTouchDist = newDist;
      this._lastTouchPoint = center;
    }
  }

  _onTouchEnd() { this._lastTouchPoint = null; this._lastTouchDist = null; }

  zoom(factor, cx = null, cy = null) {
    const newScale = Math.max(0.1, Math.min(5, this.currentScale * factor));
    if (cx !== null && cy !== null) {
      const rect = this.svgContainer.getBoundingClientRect();
      const rx = cx - rect.left;
      const ry = cy - rect.top;
      const sf = newScale / this.currentScale;
      this.currentX = rx - (rx - this.currentX) * sf;
      this.currentY = ry - (ry - this.currentY) * sf;
    }
    this.currentScale = newScale;
    this.targetScale = newScale;   // keep the smooth-zoom goal in sync
    this._applyTransform();
  }

  fitToScreen() {
    const svg = this.svgContent.querySelector('svg');
    if (!svg || !svg.viewBox.baseVal.width) return;
    const cr = this.svgContainer.getBoundingClientRect();
    const scaleX = (cr.width  * 0.9) / svg.viewBox.baseVal.width;
    const scaleY = (cr.height * 0.9) / svg.viewBox.baseVal.height;
    this.currentScale = Math.min(scaleX, scaleY, 1);
    this.currentX = 0;
    this.currentY = 0;
    this._cancelZoomAnim();
    this._applyTransform();
  }

  resetView() {
    this.currentScale = 1;
    this.currentX = 0;
    this.currentY = 0;
    this._cancelZoomAnim();
    this._applyTransform();
  }

  _applyTransform() {
    this.svgWrapper.style.transform = `translate(${this.currentX}px, ${this.currentY}px) scale(${this.currentScale})`;
  }

  // -------------------------------------------------------------------------
  //  UI helpers
  // -------------------------------------------------------------------------
  _showStatus(msg, isError = false) {
    const txt = this.statusOverlay.querySelector('.status-text');
    const spin = this.statusOverlay.querySelector('.loading-spinner');
    txt.textContent = msg;
    if (isError) { txt.classList.add('error-text'); spin.style.display = 'none'; }
    else         { txt.classList.remove('error-text'); spin.style.display = 'block'; }
    this.statusOverlay.style.display = 'block';
  }

  _hideStatus() { this.statusOverlay.style.display = 'none'; }

  _updateModuleInfo(name, path) {
    this.currentModuleEl.textContent = name;
    this.currentPathEl.textContent   = path;
  }

  _updateBreadcrumbs() {
    if (this.simMode && this._simPilha.length) { this._migalhasDaSimulacao(); return; }
    this.breadcrumbsEl.innerHTML = '';
    this.navigationHistory.forEach((item, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-separator';
        sep.textContent = '›';
        this.breadcrumbsEl.appendChild(sep);
      }
      const bc = document.createElement('span');
      bc.className = `breadcrumb-item${i === this.navigationHistory.length - 1 ? ' active' : ''}`;
      bc.textContent = item.module;
      if (i < this.navigationHistory.length - 1) {
        bc.addEventListener('click', () => {
          this.navigationHistory = this.navigationHistory.slice(0, i + 1);
          this.forwardHistory = []; // a breadcrumb jump redefines the path
          this._loadSVG(item.svgPath, item.module);
          this.backBtn.disabled = this.navigationHistory.length <= 1;
        });
      }
      this.breadcrumbsEl.appendChild(bc);
    });
  }

  _showTooltip(e, text) {
    this.tooltip.textContent = text;
    this.tooltip.style.left = (e.pageX + 12) + 'px';
    this.tooltip.style.top  = (e.pageY - 32) + 'px';
    this.tooltip.classList.add('show');
  }

  _hideTooltip() { this.tooltip.classList.remove('show'); }

  // -------------------------------------------------------------------------
  //  Keyboard shortcuts
  // -------------------------------------------------------------------------
  _onKeyDown(e) {
    if (e.ctrlKey || e.metaKey) {
      // Recompile works in either mode; the pan/zoom keys act on the schematic,
      // so skip them while the DigitalJS canvas is showing.
      if (e.key === 'r') { e.preventDefault(); this.recompile(); }
      else if (!this.simMode) {
        switch (e.key) {
          case '=': case '+': e.preventDefault(); this.zoom(1.2); break;
          case '-':           e.preventDefault(); this.zoom(0.8); break;
          case '0':           e.preventDefault(); this.resetView();    break;
          case 'f':           e.preventDefault(); this.fitToScreen();  break;
        }
      }
    }
    if (!this.simMode && e.key === 'Escape' && !this.backBtn.disabled) this.navigateBack();
    if (this.simMode && !e.ctrlKey && !e.metaKey && !e.altKey && this._atalhoDaSimulacao(e)) return;
    if (e.key === 'F11') {
      e.preventDefault();
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    }
  }

  // -------------------------------------------------------------------------
  //  Context menu
  // -------------------------------------------------------------------------
  _onContextMenu(e) {
    // Sim mode: let DigitalJS/JointJS handle right-click on the live circuit.
    if (this.simMode) return;
    // Source cells no longer claim right-click (it opens via double-click now),
    // so the zoom/recompile menu is available everywhere on the canvas.
    e.preventDefault();

    // Right-click on a module cell offers the cell's connection highlight, the
    // same thing Shift+click does; elsewhere that entry stays hidden.
    this._ctxCell = e.target.closest?.('g.module-clickable') || null;

    let menu = document.getElementById('contextMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'contextMenu';
      menu.className = 'context-menu';
      menu.innerHTML = `
        <div class="context-item" data-action="highlight-cell">
          <span>${T.highlightCell}</span><span class="shortcut">Shift+Click</span>
        </div>
        <div class="context-separator" data-for="highlight-cell"></div>
        <div class="context-item" data-action="fit">
          <span>${T.fitToScreen}</span><span class="shortcut">Ctrl+F</span>
        </div>
        <div class="context-item" data-action="reset">
          <span>${T.resetZoom}</span><span class="shortcut">Ctrl+0</span>
        </div>
        <div class="context-separator"></div>
        <div class="context-item" data-action="recompile">
          <span>${T.recompile}</span><span class="shortcut">Ctrl+R</span>
        </div>
      `;
      menu.addEventListener('click', (ev) => {
        const action = ev.target.closest('.context-item')?.dataset.action;
        if (action === 'fit')       this.fitToScreen();
        if (action === 'reset')     this.resetView();
        if (action === 'recompile') this.recompile();
        if (action === 'highlight-cell' && this._ctxCell) this._highlightCellConnections(this._ctxCell);
        menu.classList.remove('show');
      });
      document.body.appendChild(menu);
    }
    const onCell = !!this._ctxCell;
    menu.querySelector('[data-action="highlight-cell"]').hidden = !onCell;
    menu.querySelector('[data-for="highlight-cell"]').hidden = !onCell;

    menu.style.left = e.pageX + 'px';
    menu.style.top  = e.pageY + 'px';
    menu.classList.add('show');

    const hide = (ev) => {
      if (!menu.contains(ev.target)) { menu.classList.remove('show'); document.removeEventListener('click', hide); }
    };
    setTimeout(() => document.addEventListener('click', hide), 10);
  }

  // -------------------------------------------------------------------------
  //  DigitalJS interactive simulation (O9)
  //  Toggle between the static netlistsvg schematic and a live DigitalJS
  //  circuit the user can poke (flip inputs, step the clock, read monitors).
  // -------------------------------------------------------------------------

  /**
   * Lazy-load DigitalJS on first entry to Sim mode. jquery-ui (pulled in by
   * digitaljs) references the GLOBAL `jQuery`/`$` at evaluation time, so we set
   * them BEFORE importing digitaljs. Keeping this out of a top-level import is
   * what keeps the schematic flow from ever evaluating digitaljs (a load error
   * can't break the whole PRISM window) and defers the ~2MB chunk. Cached.
   * @returns {Promise<any>} the DigitalJS Circuit class
   */
  async _loadDigitalJS() {
    if (!this._Circuit) {
      const jQuery = (await import('jquery')).default;
      window.jQuery = jQuery;
      window.$ = jQuery;
      // digitaljs pulls in jquery-ui widgets (dialog) that call $.widget AT LOAD
      // time. Load the COMPLETE jquery-ui onto the global jQuery FIRST (in its
      // own correct internal order: version → widget factory → widgets) so
      // $.widget / $.fn.dialog exist before digitaljs's bundled dialog.js runs —
      // otherwise it throws "e.widget is not a function".
      await import('jquery-ui/dist/jquery-ui.js');
      const djs = await import('digitaljs');
      this._Circuit = djs.Circuit;
      // O resto do que o DigitalJS oferece e que o Simular passa a usar: o
      // painel de entradas e saidas e o monitor de formas de onda.
      this._djs = { Monitor: djs.Monitor, MonitorView: djs.MonitorView, IOPanelView: djs.IOPanelView };
      this._pintarMuxes(djs.cells);
      this._pintarBaloesDeFio(djs.cells);
    }
    return this._Circuit;
  }

  async toggleSimMode() {
    if (this.simMode) this.exitSimMode();
    else await this.enterSimMode();
  }

  async enterSimMode() {
    // Re-entrancy guard: the build spawns yosys (seconds) and the toggle stays
    // visible — a second click must NOT start a second concurrent build.
    if (this._simBusy || this.simMode || !window.electronAPI?.buildDigitalJS) return;
    this._simBusy = true;
    if (this.simToggle) this.simToggle.disabled = true;
    // Veu de pagina inteira enquanto monta: o esquematico continuava clicavel
    // por baixo do aviso, e um clique num modulo trocava o desenho no meio da
    // montagem, deixando a simulacao de um modulo sobre o esquematico de outro.
    document.body.classList.add('sim-montando');
    this._showStatus(T.building, false);

    try {
      let res;
      let paths = null;
      try {
        paths = await window.electronAPI.getPrismCompilationPaths();
        // O modulo que esta na tela, e nao o topo do projeto: a simulacao
        // responde a mesma pergunta que o esquematico, "este modulo aqui".
        res = await window.electronAPI.buildDigitalJS(paths, this.currentModule);
      } catch (err) {
        this._showSimError(`${T.simError}: ${err?.message || err}`);
        return;
      }
      if (!res || !res.ok || !res.circuit) {
        this._showSimError(this._simFailureText(res));
        return;
      }

      try {
        await this._loadDigitalJS();
        this._simDados = res.circuit;
        // As escolhas (sinais no monitor, base, velocidade) sao por projeto e
        // modulo: trocar de modulo troca de conjunto.
        const chave = `prism-sim:${(paths && paths.projectPath) || ''}:${this.currentModule || res.topLevelModule || ''}`;
        if (chave !== this._simChave) { this._simChave = chave; this._escolhas = null; }
        this._simNome = this.currentModule || res.topLevelModule || 'top';
        this._montarSimulacao(res.circuit);
      } catch (err) {
        console.error('[PRISM] DigitalJS render failed:', err);
        this._destroyCircuit();
        this._showSimError(`${T.simError}: ${err?.message || err}`);
        return;
      }

      this.simMode = true;
      this.svgContainer.style.display = 'none';
      this.djsContainer.style.display = 'block';
      this.simToggle?.classList.add('active');
      this._setSimToggleLabel(T.schematic);
      this._hideStatus();
      this._restaurarEscolhas();
      this._updateBreadcrumbs();
      this.backBtn.disabled = true;
    } finally {
      this._simBusy = false;
      document.body.classList.remove('sim-montando');
      if (this.simToggle) this.simToggle.disabled = false;
    }
  }

  exitSimMode() {
    this._destroyCircuit();
    this._guardarEscolhas(true);
    this.simMode = false;
    this.djsContainer.style.display = 'none';
    this.svgContainer.style.display = '';
    this.simToggle?.classList.remove('active');
    this._setSimToggleLabel(T.simulate);
    this._updateBreadcrumbs();
    this.backBtn.disabled = this.navigationHistory.length <= 1;
  }

  // -------------------------------------------------------------------------
  //  Montagem, niveis e reinicio
  // -------------------------------------------------------------------------

  /**
   * Monta o circuito vivo a partir do JSON do DigitalJS: o papel do topo, a
   * barra e os ganchos. E o miolo do Simular e tambem o do Reiniciar, que
   * passa por aqui de novo com o mesmo desenho.
   */
  _montarSimulacao(data) {
    this._destroyCircuit();
    // Fresh wrapper: the pan/zoom layer every level's paper lives in.
    const wrapper = document.createElement('div');
    wrapper.className = 'djs-wrapper';
    this.djsContainer.appendChild(wrapper);
    this.djsWrapper = wrapper;
    this._paperScale = 1; this._paperTx = 0; this._paperTy = 0;
    // Synchronous browser engine (default) + dagre layout: no Web Worker, so
    // it renders under file:// without elkjs's worker.
    this.circuit = new this._Circuit(data, { layoutEngine: 'dagre' });
    this._ligarGatilhos();
    this._abrirNivel(this.circuit._graph, this._simNome || this.currentModule || 'top');
    this.circuit.start();
    this._montarBarraDaSimulacao();
  }

  /**
   * Abre um nivel da simulacao: o topo, ou um submodulo por dentro.
   *
   * Cada nivel e um papel do JointJS sobre o grafo daquele modulo, numa caixa
   * propria dentro do wrapper (que e quem carrega o pan e o zoom). Os niveis
   * de baixo ficam escondidos, nao destruidos: voltar a eles e so mostrar de
   * novo, com as posicoes e os valores que ja tinham. O motor simula tudo o
   * tempo todo, de qualquer nivel; o que muda e o que se ve.
   *
   * O DigitalJS abriria o submodulo num dialogo flutuante por cima do topo.
   * Aqui ele abre NO LUGAR, com migalhas, como no esquematico: o ouvinte da
   * biblioteca sai e o nosso entra no mesmo evento, o da lupa da caixa.
   */
  _abrirNivel(graph, nome, modelo = null) {
    const el = document.createElement('div');
    el.className = 'djs-nivel';
    const host = document.createElement('div');
    host.className = 'djs-paper';
    el.appendChild(host);
    this.djsWrapper.appendChild(el);
    for (const n of this._simPilha) n.el.hidden = true;
    // Um grafo que ja vem com posicoes (o Reiniciar, ou um nivel que a pessoa
    // ja tinha aberto) nao passa pelo layout de novo, e por isso tambem nao
    // pela expansao: ela ja esta nas posicoes.
    const jaPosicionado = !!graph.get('laid_out');
    // O mesmo que displayOn faz para o topo, so que para qualquer grafo.
    const paper = this.circuit._makePaper(host, graph);
    this.circuit.stopListening(paper, 'open:subcircuit');
    paper.on('open:subcircuit', (m) => this._entrarNoSubcircuito(m));
    // Pan by dragging blank space (gates stay draggable via JointJS).
    paper.on('blank:pointerdown', (/** @type {any} */ evt) => {
      const oe = (evt && evt.originalEvent) || evt || {};
      this._paperPan = { x: oe.clientX, y: oe.clientY, tx: this._paperTx, ty: this._paperTy };
      this.djsContainer.classList.add('panning');
    });
    const nivel = { el, host, paper, graph, nome, modelo, sobreposicoes: [] };
    this._simPilha.push(nivel);
    this._paper = paper;
    this.paperHost = host;
    // Center + fit, and lay the 0/1 digits, once the (async) layout lands.
    // O dagre do DigitalJS tem espacamento fixo (nodeSep 20, rankSep 110)
    // e nao aceita opcao: num modulo com dez portas por lado os rotulos
    // caem uns sobre os outros. Expandir as posicoes DEPOIS do layout da o
    // ar que ele nao da; os fios saem das portas e se refazem sozinhos.
    paper.once('render:done', () => {
      if (!jaPosicionado) this._expandirLayout(nivel, 1.6, 1.35);
      this._fitPaper();
      this._buildValueOverlays(nivel);
    });
    setTimeout(() => {
      if (this._simPilha.includes(nivel)) { this._fitPaper(); this._buildValueOverlays(nivel); }
    }, 150);
    return nivel;
  }

  _entrarNoSubcircuito(modelo) {
    const graph = modelo && modelo.get('graph');
    if (!graph || !this.circuit) return;
    const rotulo = modelo.get('label');
    const nome = `${modelo.get('celltype') || ''}${rotulo ? ` ${rotulo}` : ''}`.trim() || '?';
    this._porCursor(null);
    this._abrirNivel(graph, nome, modelo);
    this._updateBreadcrumbs();
    this.backBtn.disabled = false;
  }

  /** Volta ao nivel de indice `ate`, fechando os que estao acima dele. */
  _voltarNivel(ate) {
    while (this._simPilha.length - 1 > Math.max(0, ate)) {
      const n = this._simPilha.pop();
      try { n.paper.remove?.(); } catch (_) { /* best-effort */ }
      n.el.remove();
    }
    const topo = this._simPilha[this._simPilha.length - 1];
    if (!topo) return;
    topo.el.hidden = false;
    this._paper = topo.paper;
    this.paperHost = topo.host;
    this._fitPaper();
    this._updateBreadcrumbs();
    this.backBtn.disabled = this._simPilha.length <= 1;
  }

  /** As migalhas da simulacao: o topo e os submodulos abertos por dentro. */
  _migalhasDaSimulacao() {
    this.breadcrumbsEl.innerHTML = '';
    this._simPilha.forEach((n, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-separator';
        sep.textContent = '›';
        this.breadcrumbsEl.appendChild(sep);
      }
      const bc = document.createElement('span');
      const ultimo = i === this._simPilha.length - 1;
      bc.className = `breadcrumb-item${ultimo ? ' active' : ''}`;
      bc.textContent = n.nome;
      if (!ultimo) bc.addEventListener('click', () => this._voltarNivel(i));
      this.breadcrumbsEl.appendChild(bc);
    });
  }

  /**
   * Reinicia sem recompilar: o mesmo desenho, do tick zero.
   *
   * O DigitalJS nao tem "voltar ao inicio"; o que ha e montar o circuito de
   * novo. Ate aqui isso pedia sair do Simular e entrar outra vez, e a entrada
   * roda o yosys: segundos de espera para voltar a um estado que ja se tinha.
   * O circuito e serializado com as posicoes (o que a pessoa arrastou fica) e
   * montado de novo; os registradores voltam ao valor inicial, o contador de
   * ticks a zero. As chaves ficam como estao: e um religar, e numa bancada as
   * chaves nao se mexem sozinhas quando se religa. O monitor e os paineis
   * voltam pelas escolhas guardadas.
   */
  _reiniciarSimulacao() {
    const c = this.circuit;
    if (!c || this._simBusy) return;
    let dados = null;
    try {
      dados = c.toJSON(true);
    } catch (err) {
      console.warn('[PRISM] toJSON failed, restarting from the original circuit:', err);
      dados = this._simDados;
    }
    if (!dados) return;
    const entradas = [];
    for (const cell of c.getInputCells()) {
      if (cell.get('type') !== 'Input') continue;
      entradas.push([cell.get('id'), (cell.get('outputSignals') || {}).out]);
    }
    this._guardarEscolhas(true);
    this._porCursor(null);
    this._montarSimulacao(dados);
    const g = this.circuit._graph;
    for (const [id, sig] of entradas) {
      const cell = g.getCell(id);
      if (!cell || !sig || typeof cell.setInput !== 'function') continue;
      try { cell.setInput(sig); } catch (_) { /* largura diferente: fica o padrao */ }
    }
    this._restaurarEscolhas();
    this._updateBreadcrumbs();
    this.backBtn.disabled = true;
    this._log(T.simRestarted, 'tips');
  }

  /**
   * Quem para a simulacao diz por que.
   *
   * O "parar em" do monitor registra no motor um gatilho que para a simulacao
   * quando o sinal chega ao valor; o motor para e mais nada acontece na tela,
   * e a pessoa fica sem saber se foi o gatilho ou um clique. O unico ponto por
   * onde todo gatilho passa e o monitorWire do circuito; embrulhado aqui, o
   * disparo escreve na barra qual sinal parou a simulacao, em que tick e com
   * que valor.
   */
  _ligarGatilhos() {
    const c = this.circuit;
    if (!c || c._prismGatilhos) return;
    const original = c.monitorWire.bind(c);
    c.monitorWire = (wire, callback, options = {}) => {
      if (!options || !options.stopOnTrigger) return original(wire, callback, options);
      return original(wire, (tick, sig) => {
        const r = callback(tick, sig);
        if (r) this._avisarParada(wire, tick, sig);
        return r;
      }, options);
    };
    c._prismGatilhos = true;
  }

  _avisarParada(wire, tick, sig) {
    const d = this.circuit && this.circuit._display3vl;
    if (!d) return;
    const nome = wire.get('netname') || T.simSignal;
    const v = wire.get('bits') > 1 ? d.show('hex', sig) : d.show('bin', sig);
    this._avisar(T.simStoppedAt.replace('{t}', String(tick)).replace('{s}', nome).replace('{v}', v));
  }

  /** Um aviso curto debaixo da barra, que some sozinho; vai ao terminal tambem. */
  _avisar(texto, erro = false) {
    this._log(texto, erro ? 'error' : 'tips');
    const el = this._simAviso;
    if (!el) return;
    el.textContent = texto;
    el.classList.toggle('erro', !!erro);
    el.hidden = false;
    clearTimeout(this._avisoTimer);
    this._avisoTimer = setTimeout(() => { el.hidden = true; }, 7000);
  }

  /**
   * Os atalhos do Simular: espaco roda e pausa, a seta para a direita avanca
   * um tick, com Shift avanca ate o proximo evento, e Esc tira o cursor do
   * monitor ou sobe um nivel. Nada disto vale enquanto se digita num campo,
   * e um botao com foco fica com o seu proprio espaco.
   */
  _atalhoDaSimulacao(e) {
    const alvo = e.target instanceof Element ? e.target : null;
    if (alvo && alvo.closest('input, select, textarea, [contenteditable="true"], button')) return false;
    const clicar = (id) => { const b = this._simBar && this._simBar.querySelector(id); if (b) b.click(); };
    if (e.key === ' ') { e.preventDefault(); clicar('#simRun'); return true; }
    if (e.key === 'ArrowRight') { e.preventDefault(); clicar(e.shiftKey ? '#simNext' : '#simStep'); return true; }
    if (e.key === 'Escape') {
      if (this._cursorTick != null) { this._porCursor(null); return true; }
      if (this._simPilha.length > 1) { this._voltarNivel(this._simPilha.length - 2); return true; }
    }
    return false;
  }

  /**
   * A barra da simulacao: o que faz o Simular fazer jus ao nome.
   *
   * O DigitalJS ja tinha tudo isto e o PRISM nao expunha nada: o circuito
   * rodava sozinho, sem pausa, sem passo, sem relogio, sem ver o sinal no
   * tempo. A barra fica em cima do papel, como os controles de zoom, em quatro
   * grupos separados por um traco: o que roda (Rodar/Pausar, um tick, o proximo
   * evento, o modo rapido), o que se le (o contador de ticks), o que se regula
   * (meio periodo do relogio e velocidade) e o que se abre (os dois paineis).
   *
   * Cada campo leva o nome escrito ao lado, e nao so um icone com dica: um
   * numero solto ao lado de um relogio nao diz se e periodo, frequencia ou
   * atraso. A velocidade vira uma lista de ticks por segundo, que e a unidade
   * que a pessoa enxerga; o milissegundo por tick, que crescia para a esquerda,
   * era um numero ao contrario do que se quer dizer.
   *
   * Os dois paineis que se abrem: entradas e saidas em formulario
   * (IOPanelView), para digitar um valor de 32 bits em vez de clicar bit a bit,
   * e o monitor (Monitor + MonitorView), que desenha os fios escolhidos no
   * tempo; o botao de monitor que aparece ao passar o mouse num fio o
   * acrescenta la, e as saidas e o relogio entram por padrao.
   */
  _montarBarraDaSimulacao() {
    if (!this.circuit || !this.djsContainer) return;
    this._desmontarBarraDaSimulacao();
    const c = this.circuit;
    const barra = document.createElement('div');
    barra.className = 'sim-bar';
    const btn = (id, icone, rotulo, titulo) => `<button class="sim-btn" id="${id}" title="${titulo || rotulo}"><i class="ph ${icone}" aria-hidden="true"></i><span>${rotulo}</span></button>`;
    // Ticks por segundo; o motor conta em milissegundos por tick, entao o valor
    // da opcao ja vai no que ele espera.
    const velocidades = [1, 2, 5, 10, 20, 50, 100]
      .map((tps) => `<option value="${Math.round(1000 / tps)}">${tps} ${T.simSpeedUnit}</option>`).join('');
    barra.innerHTML = `
      ${btn('simRun', 'ph-pause', T.simPause, T.simPauseTip)}
      ${btn('simStep', 'ph-skip-forward', T.simStep, T.simStepTip)}
      ${btn('simNext', 'ph-fast-forward', T.simNext, T.simNextTip)}
      ${btn('simFast', 'ph-lightning', T.simFast, T.simFastTip)}
      ${btn('simReset', 'ph-arrow-counter-clockwise', T.simReset, T.simResetTip)}
      <span class="sim-sep" aria-hidden="true"></span>
      <span class="sim-ticks" title="${T.simTicksTip}"><span id="simTick">0</span> <span id="simTickUnit">${T.simTicks}</span></span>
      <span class="sim-sep" aria-hidden="true"></span>
      <label class="sim-campo sim-period" title="${T.simPeriod}"><span class="sim-campo-nome">${T.simPeriodLabel}</span><input id="simPeriod" type="number" min="1" max="100000" step="1"></label>
      <label class="sim-campo sim-speed" title="${T.simSpeed}"><span class="sim-campo-nome">${T.simSpeedLabel}</span><select id="simSpeed">${velocidades}</select></label>
      <span class="sim-sep" aria-hidden="true"></span>
      ${btn('simIo', 'ph-sliders-horizontal', T.simIo, T.simIoTip)}
      ${btn('simMonitor', 'ph-waveform', T.simMonitor, T.simMonitorTip)}`;
    this.djsContainer.appendChild(barra);
    this._simBar = barra;
    // Um botao clicado nao guarda o foco: senao o espaco, que e o atalho de
    // rodar e pausar, apertaria de novo o ultimo botao clicado.
    barra.addEventListener('mousedown', (e) => { if (e.target instanceof Element && e.target.closest('button')) e.preventDefault(); });
    const aviso = document.createElement('div');
    aviso.className = 'sim-aviso';
    aviso.hidden = true;
    this.djsContainer.appendChild(aviso);
    this._simAviso = aviso;

    const relogios = () => c._graph.getElements().filter((el) => el.get('type') === 'Clock');
    const periodo = barra.querySelector('#simPeriod');
    const rel = relogios();
    if (rel.length) periodo.value = rel[0].get('propagation') || 50;
    else { periodo.parentElement.hidden = true; this._log(T.simNoClock, 'tips'); }
    periodo.addEventListener('change', () => {
      const n = Math.max(1, Math.floor(Number(periodo.value) || 1));
      for (const r of relogios()) r.set('propagation', n);
      this._escolha('period', n);
    });

    // A velocidade escrita em ticks por segundo; o motor guarda o inverso, o
    // intervalo em ms por tick. O valor que ele ja tem raramente cai numa das
    // opcoes, entao a lista comeca na mais proxima e o motor passa a valer
    // aquela, para o que esta escrito ser o que acontece.
    const vel = barra.querySelector('#simSpeed');
    const opcoes = [...vel.options].map((o) => Number(o.value));
    const perto = opcoes.reduce((a, b) => (Math.abs(b - c.interval) < Math.abs(a - c.interval) ? b : a));
    vel.value = String(perto);
    c.interval = perto;
    vel.addEventListener('change', () => {
      c.interval = Math.max(1, Number(vel.value) || 10);
      // O motor so le o intervalo ao (re)ligar o timer.
      if (c.running) { c.stop(); c.start(); }
      this._escolha('speed', c.interval);
    });

    const run = barra.querySelector('#simRun');
    const pintarRun = () => {
      const rodando = !!c.running;
      run.innerHTML = `<i class="ph ${rodando ? 'ph-pause' : 'ph-play'}" aria-hidden="true"></i><span>${rodando ? T.simPause : T.simRun}</span>`;
      run.title = rodando ? T.simPauseTip : T.simRunTip;
      run.classList.toggle('active', rodando);
    };
    run.addEventListener('click', () => { if (c.running) c.stop(); else c.start(); pintarRun(); });
    barra.querySelector('#simStep').addEventListener('click', () => { if (c.running) c.stop(); c.updateGates(); pintarRun(); });
    barra.querySelector('#simNext').addEventListener('click', () => { if (c.running) c.stop(); c.updateGatesNext(); pintarRun(); });
    barra.querySelector('#simFast').addEventListener('click', () => { if (c.running) c.stop(); else c.startFast(); pintarRun(); });
    const tick = barra.querySelector('#simTick');
    const tickUnidade = barra.querySelector('#simTickUnit');
    c.on('postUpdateGates', (t) => {
      tick.textContent = String(t);
      tickUnidade.textContent = t === 1 ? T.simTick : T.simTicks;
    });
    c.on('changeRunning', pintarRun);
    pintarRun();

    barra.querySelector('#simReset').addEventListener('click', () => this._reiniciarSimulacao());
    barra.querySelector('#simIo').addEventListener('click', () => this._alternarPainelIo());
    barra.querySelector('#simMonitor').addEventListener('click', () => this._alternarMonitor());
  }

  _alternarPainelIo() {
    if (this._ioPanel) {
      this._ioView?.shutdown?.();
      this._ioPanel.remove();
      this._ioPanel = null; this._ioView = null;
      this._simBar?.querySelector('#simIo')?.classList.remove('active');
      if (!this._desmontando) this._escolha('io', false);
      return;
    }
    const painel = document.createElement('div');
    painel.className = 'sim-panel sim-io';
    painel.innerHTML = `<h4>${T.simIo}</h4><div class="sim-io-corpo"></div>`;
    this.djsContainer.appendChild(painel);
    this._ioPanel = painel;
    // Marcacao da casa em vez dos <input type=checkbox> de fabrica: um
    // interruptor para a entrada de 1 bit, uma lampada para a saida de 1 bit, e
    // um campo mono para os barramentos. O IOPanelView aceita cada pedaco.
    this._ioView = new this._djs.IOPanelView({
      model: this.circuit,
      el: painel.querySelector('.sim-io-corpo'),
      rowMarkup: '<div class="sim-io-row"></div>',
      colMarkup: '<div class="sim-io-col"></div>',
      labelMarkup: '<label class="sim-io-nome"></label>',
      buttonMarkup: '<label class="sim-switch"><input type="checkbox"><span class="sim-switch-track" aria-hidden="true"></span></label>',
      // A saida de 1 bit mostra o digito que ela vale: 1 aceso, 0 apagado, x
      // quando indefinida. Antes era um check verde e um x vermelho, e um x
      // vermelho num sinal chamado "estouro" se le como erro, nao como zero,
      // alem de ter cara de botao que se pode apertar. O digito diz o valor e
      // e o mesmo que aparece sobre a porta no desenho.
      lampMarkup: '<span class="sim-led"><input type="checkbox"><span class="sim-led-on" aria-hidden="true">1</span><span class="sim-led-off" aria-hidden="true">0</span><span class="sim-led-x" aria-hidden="true">x</span></span>',
      inputMarkup: '<input type="text" class="sim-num" spellcheck="false">',
      baseSelectorMarkup: (d, bits, base) => this._marcacaoDeBase(d, bits, base),
    });
    this._organizarPainelIo(painel);
    this._simBar?.querySelector('#simIo')?.classList.add('active');
    this._escolha('io', true);
  }

  /**
   * O IOPanelView do DigitalJS pendura entradas e saidas na MESMA div, uma
   * atras da outra, sem titulo e sem largura. Aqui entra um titulo antes da
   * primeira linha de cada grupo, e cada barramento ganha a faixa de bits ao
   * lado do nome, [7:0], como se le em Verilog: sem ela "valor" nao dizia
   * quantos digitos cabem no campo. As linhas saem na ordem em que o painel
   * as monta, entradas e depois saidas, que e a ordem das celulas.
   */
  _organizarPainelIo(painel) {
    const linhas = [...painel.querySelectorAll('.sim-io-row')];
    const celulas = [...this.circuit.getInputCells(), ...this.circuit.getOutputCells()];
    let grupo = null;
    linhas.forEach((linha, i) => {
      const celula = celulas[i];
      const saida = celula ? !!celula.isOutput : !!linha.querySelector('.sim-led, input:disabled');
      const g = saida ? 'saidas' : 'entradas';
      if (g !== grupo) {
        grupo = g;
        const h = document.createElement('div');
        h.className = 'sim-io-grupo';
        h.textContent = saida ? T.simOutputs : T.simInputs;
        linha.before(h);
      }
      const bits = celula && celula.get('bits');
      if (bits > 1) {
        const b = document.createElement('span');
        b.className = 'sim-io-bits';
        b.textContent = `[${bits - 1}:0]`;
        linha.querySelector('.sim-io-nome')?.appendChild(b);
      }
    });
  }

  /**
   * A lista de base (hex, dec, bin) que os dois paineis usam. A de fabrica vem
   * sem nome e sem dica, e um "hex" solto ao lado do valor nao diz que ali se
   * escolhe COMO ler o numero, e nao o que ele vale.
   */
  _marcacaoDeBase(display3vl, bits, base) {
    const opcoes = display3vl.usableDisplays('read', bits)
      .map((n) => `<option value="${n}"${n === base ? ' selected' : ''}>${n}</option>`).join('');
    return `<select name="base" class="sim-sel" title="${T.simBaseTip}">${opcoes}</select>`;
  }

  /**
   * O monitor: uma linha por fio, com o nome, a onda, e tres controles no fim.
   *
   * Os tres controles nao diziam o que faziam. Agora a lista tem cabecalho
   * (sinal, base, parar em) e o painel ganhou o que faltava para a onda ser
   * navegavel: aproximar e afastar no tempo, e o "ao vivo". Este ultimo nao era
   * so falta de rotulo e sim de caminho de volta: arrastar a onda para olhar o
   * passado desliga o acompanhamento dentro do DigitalJS, e nao havia nada na
   * tela que o religasse. O autoredraw entra pelo mesmo motivo: sem ele,
   * arrastar, aproximar ou trocar a base com a simulacao parada nao redesenhava
   * nada, e o controle parecia quebrado.
   */
  _alternarMonitor() {
    if (this._monitorPanel) {
      // O que esta no monitor fica guardado antes de ele ir embora: e o que o
      // Reiniciar e a proxima entrada devolvem.
      if (!this._escolhas) this._escolhas = this._lerEscolhas();
      this._escolhas.wires = this._sinaisDoMonitor();
      this._monitorView?.shutdown?.();
      this._monitorPanel.remove();
      this._monitorPanel = null; this._monitorView = null; this._monitor = null;
      this._cursorLinha = null; this._cursorTick = null;
      this._simBar?.querySelector('#simMonitor')?.classList.remove('active');
      if (!this._desmontando) this._escolha('monitor', false);
      return;
    }
    const painel = document.createElement('div');
    painel.className = 'sim-panel sim-monitor';
    const mini = (id, icone, titulo, rotulo) => `<button type="button" class="sim-mini" id="${id}" title="${titulo}" aria-label="${titulo}"><i class="ph ${icone}" aria-hidden="true"></i>${rotulo ? `<span>${rotulo}</span>` : ''}</button>`;
    // O cabecalho da lista mora DENTRO do corpo que rola, e nao acima dele: e a
    // unica forma de continuar alinhado com as colunas quando aparece a barra
    // de rolagem. O MonitorView so limpa a lista, entao o cabecalho sobrevive.
    painel.innerHTML = `
      <div class="sim-panel-cab">
        <h4>${T.simMonitor}</h4>
        <div class="sim-panel-acoes">
          ${mini('simMonExport', 'ph-arrow-square-out', T.simExportTip, T.simExport)}
          <span class="sim-chip" id="simMonCursor" hidden title="${T.simCursorTip}"><span class="sim-chip-txt"></span><button type="button" class="sim-x" id="simMonCursorX" title="${T.simCursorClear}" aria-label="${T.simCursorClear}"><i class="ph ph-x" aria-hidden="true"></i></button></span>
          ${mini('simMonLive', 'ph-broadcast', T.simLiveTip, T.simLive)}
          ${mini('simMonOut', 'ph-magnifying-glass-minus', T.simZoomOut)}
          ${mini('simMonIn', 'ph-magnifying-glass-plus', T.simZoomIn)}
        </div>
      </div>
      <div class="sim-monitor-corpo">
        <div class="sim-monitor-cab" aria-hidden="true">
          <span>${T.simSignal}</span><span></span><span>${T.simBase}</span><span>${T.simStopAt}</span><span></span>
        </div>
        <div class="sim-monitor-lista"></div>
      </div>`;
    this.djsContainer.appendChild(painel);
    this._monitorPanel = painel;
    this._monitor = new this._djs.Monitor(this.circuit);
    // Os papeis que ja existem (o topo e os submodulos abertos); os que vierem
    // depois o monitor pega sozinho, pelo new:paper.
    for (const n of this._simPilha) this._monitor.attachTo(n.paper);
    this._monitorView = new this._djs.MonitorView({
      model: this._monitor,
      el: painel.querySelector('.sim-monitor-lista'),
      baseSelectorMarkup: (d, bits, base) => this._marcacaoDeBase(d, bits, base),
      removeButtonMarkup: `<button type="button" name="remove" class="sim-x" title="${T.simRemove}" aria-label="${T.simRemove}"><i class="ph ph-x" aria-hidden="true"></i></button>`,
      bitTriggerMarkup: `<select name="trigger" class="sim-sel" title="${T.simStopAtTip}"><option value="none">&#8212;</option><option value="rising">&#8593;</option><option value="falling">&#8595;</option><option value="risefall">&#8597;</option><option value="undef">x</option></select>`,
      busTriggerMarkup: `<input type="text" name="trigger" class="sim-num sim-trig" title="${T.simStopAtTip}" placeholder="${T.simValue}" pattern="[0-9a-fx]*" spellcheck="false">`,
    });
    this._monitorView.autoredraw = true;
    this._ligarControlesDoMonitor(painel);
    this._decorarLinhasDoMonitor();
    this._ligarCursorDoMonitor(painel);
    // Base e gatilho mudados a mao entram nas escolhas guardadas.
    painel.addEventListener('input', () => this._guardarEscolhas());
    painel.addEventListener('change', () => this._guardarEscolhas());
    const dica = document.createElement('p');
    dica.className = 'sim-monitor-dica';
    dica.textContent = T.simMonitorHint;
    painel.querySelector('.sim-monitor-corpo').after(dica);
    // O canvas nao le CSS: as cores do wavecanvas (salmao, cinza, verde, azul
    // e texto preto) entram como valores, lidos dos tokens da casa. As linhas
    // por fio herdam destas por prototipo, entao basta trocar aqui, antes das
    // primeiras linhas.
    const cor = (v, alt) => (getComputedStyle(document.documentElement).getPropertyValue(v).trim() || alt);
    // Os padroes do wavecanvas sao congelados, entao nao se atribui em cima:
    // deriva-se um objeto novo, e as linhas por fio derivam deste.
    const props = {
      bitColors: [cor('--aurora-pink', '#E68FB8'), cor('--text-muted', '#6b7280'), cor('--aurora-mint', '#5FE0B0'), cor('--accent', '#8E83E8')],
      gridColor: cor('--border', '#2a2f3d'),
      textColor: cor('--text', '#E8ECF3'),
      font: `10px ${cor('--font-mono', 'monospace')}`,
      // A grade de fabrica quer uma linha a cada 10 px, o que na escala em que
      // a onda cabe na tela vira um hachurado que come o sinal. Uma linha a
      // cada 40 px e referencia; menos que isso e textura.
      gridMinDist: 40,
    };
    const desc = {};
    for (const [k, v] of Object.entries(props)) desc[k] = { value: v, writable: true, enumerable: true, configurable: true };
    this._monitorView._settings = Object.create(this._monitorView._settings, desc);
    // O que a pessoa tinha no monitor da ultima vez, com base e gatilho; na
    // primeira vez, o que se quer ver sem pedir: o relogio e as saidas.
    const salvos = this._escolhas && Array.isArray(this._escolhas.wires) ? this._escolhas.wires : null;
    if (salvos) {
      this._monitor.loadWiresDesc(salvos.map((w) => ({ name: w.name, path: w.path, bits: w.bits })));
      this._aplicarBasesEGatilhos(salvos);
    } else {
      // Um mesmo net que se divide em dois destinos sao dois links, e o
      // monitor os aceitaria como duas linhas iguais: o relogio que alimenta
      // dois flip-flops aparecia duas vezes, com o mesmo nome e a mesma onda.
      // Uma linha por nome.
      const graph = this.circuit._graph;
      const vistos = new Set();
      for (const link of graph.getLinks()) {
        const src = link.getSourceElement();
        const dst = link.getTargetElement();
        if (!((src && src.get('type') === 'Clock') || (dst && dst.get('type') === 'Output'))) continue;
        const nome = link.get('netname');
        if (nome) {
          if (vistos.has(nome)) continue;
          vistos.add(nome);
        }
        this._monitor.addWire(link);
      }
    }
    this._simBar?.querySelector('#simMonitor')?.classList.add('active');
    this._escolha('monitor', true);
  }

  /**
   * Os controles do cabecalho do monitor: acompanhar o presente e a distancia
   * no tempo. Os dois mexem na janela de desenho do MonitorView (start e
   * pixelsPerTick), que ate aqui so respondia ao arrastar e a roda do mouse,
   * dois gestos que ninguem descobre sozinho.
   */
  _ligarControlesDoMonitor(painel) {
    const v = this._monitorView;
    if (!v) return;
    const aoVivo = painel.querySelector('#simMonLive');
    const pintarAoVivo = () => aoVivo.classList.toggle('active', !!v.live);
    aoVivo.addEventListener('click', () => {
      if (v.live) { v.live = false; return; }
      // Voltar ao vivo e voltar ao presente: o DigitalJS so recoloca a janela
      // no fim no proximo tick, e com a simulacao parada esse tick nao vem.
      v.live = true;
      v.start = (this.circuit?.tick || 0) - v.width / v.pixelsPerTick;
    });
    v.on('change:live', pintarAoVivo);
    pintarAoVivo();
    // O presente fica preso na direita: aproximar a partir do meio faria a
    // onda escorregar para fora da janela.
    const distancia = (f) => {
      const alvo = Math.min(40, Math.max(0.25, v.pixelsPerTick * f));
      const fim = v.live ? (this.circuit?.tick || 0) : v.start + v.width / v.pixelsPerTick;
      v.pixelsPerTick = alvo;
      v.start = fim - v.width / alvo;
    };
    painel.querySelector('#simMonIn').addEventListener('click', () => distancia(2));
    painel.querySelector('#simMonOut').addEventListener('click', () => distancia(0.5));
    painel.querySelector('#simMonExport').addEventListener('click', () => this._exportarOnda());
    // Como na barra: o botao clicado nao fica com o foco, e o espaco continua
    // sendo o atalho de rodar e pausar.
    painel.addEventListener('mousedown', (e) => { if (e.target instanceof Element && e.target.closest('.sim-panel-acoes button')) e.preventDefault(); });
  }

  /**
   * O cursor de tempo do monitor: um clique numa onda marca um tick, e cada
   * linha passa a mostrar o valor que o sinal tinha ali. E a leitura que o
   * desenho sozinho nao da: o valor de um barramento so aparece quando o
   * trecho e largo o bastante para o texto caber.
   */
  _ligarCursorDoMonitor(painel) {
    const lista = painel.querySelector('.sim-monitor-lista');
    if (!lista) return;
    const linha = document.createElement('div');
    linha.className = 'sim-cursor';
    linha.hidden = true;
    lista.appendChild(linha);
    this._cursorLinha = linha;
    lista.addEventListener('click', (e) => {
      const canvas = e.target instanceof Element ? e.target.closest('canvas.wavecanvas') : null;
      const v = this._monitorView;
      if (!canvas || !v) return;
      const x = e.clientX - canvas.getBoundingClientRect().left;
      this._porCursor(Math.max(0, Math.round(v.start + x / v.pixelsPerTick)));
    });
    painel.querySelector('#simMonCursorX')?.addEventListener('click', () => this._porCursor(null));
    // A janela de tempo anda (ao vivo, arraste, zoom) e o cursor anda junto.
    this._monitorView.on('change', () => this._pintarCursor());
    this._monitor.on('add remove', () => setTimeout(() => this._pintarCursor(), 0));
  }

  _porCursor(tick) {
    this._cursorTick = tick == null ? null : tick;
    this._pintarCursor();
  }

  _pintarCursor() {
    const painel = this._monitorPanel;
    const v = this._monitorView;
    const linha = this._cursorLinha;
    if (!painel || !v || !linha) return;
    const chip = painel.querySelector('#simMonCursor');
    const linhas = painel.querySelectorAll('table.monitor tr');
    const t = this._cursorTick;
    if (t == null) {
      linha.hidden = true;
      if (chip) chip.hidden = true;
      linhas.forEach((tr) => { const s = tr.querySelector('.sim-mon-valor'); if (s) s.textContent = ''; });
      return;
    }
    if (chip) {
      chip.hidden = false;
      const txt = chip.querySelector('.sim-chip-txt');
      if (txt) txt.textContent = `${T.simTick} ${t}`;
    }
    // A posicao vem por retangulos, e nao por offsetLeft: o canvas mora numa
    // celula de tabela, e offsetLeft de quem esta numa celula conta a partir
    // da celula, nao da lista.
    const canvas = painel.querySelector('canvas.wavecanvas');
    const lista = linha.parentElement;
    if (canvas && lista) {
      const rc = canvas.getBoundingClientRect();
      const rl = lista.getBoundingClientRect();
      const x = rc.left - rl.left + (t - v.start) * v.pixelsPerTick;
      const dentro = x >= rc.left - rl.left && x <= rc.right - rl.left;
      linha.hidden = !dentro;
      linha.style.left = `${x}px`;
    } else {
      linha.hidden = true;
    }
    const d = this.circuit && this.circuit._display3vl;
    linhas.forEach((tr) => {
      let s = tr.querySelector('.sim-mon-valor');
      if (!s) {
        s = document.createElement('span');
        s.className = 'sim-mon-valor';
        tr.querySelector('td.name')?.appendChild(s);
      }
      const w = this._monitor && this._monitor._wires.get(tr.getAttribute('wireid') || '');
      const sig = w ? this._valorNoTick(w.waveform, t) : null;
      const base = tr.querySelector('select[name=base]')?.value || 'hex';
      // Antes da primeira amostra o sinal ainda nao estava no monitor: nao e
      // x, e "nao se sabe", e o sinal de interrogacao diz isso.
      s.textContent = sig && d ? d.show(w.wire.get('bits') > 1 ? base : 'bin', sig) : '?';
    });
  }

  /** O valor que a onda tinha no tick: a ultima mudanca ate ali, ou null antes da primeira. */
  _valorNoTick(waveform, tick) {
    const dados = waveform && waveform._data;
    if (!dados || !dados.length || tick < dados[0][0]) return null;
    let lo = 0;
    let hi = dados.length - 1;
    while (lo < hi) {
      const meio = (lo + hi + 1) >> 1;
      if (dados[meio][0] <= tick) lo = meio; else hi = meio - 1;
    }
    return dados[lo][1];
  }

  /**
   * Cada linha nova do monitor ganha o nome num span proprio (para o
   * reticencias continuar valendo ao lado do valor do cursor), a faixa de
   * bits quando e barramento, e o nome cru guardado na linha, que e a chave
   * pela qual as escolhas guardadas se reencontram com ela.
   */
  _decorarLinhasDoMonitor() {
    this._monitor.on('add', (wire) => {
      const tr = this._monitorPanel && this._monitorPanel.querySelector('table.monitor tr:last-child');
      const td = tr && tr.querySelector('td.name');
      if (!td || td.dataset.pronto) return;
      td.dataset.pronto = '1';
      const nome = td.textContent || '';
      tr.dataset.nome = nome;
      td.textContent = '';
      const n = document.createElement('span');
      n.className = 'sim-mon-nome';
      n.textContent = nome;
      n.title = nome;
      td.appendChild(n);
      const bits = wire.get('bits');
      if (bits > 1) {
        const b = document.createElement('span');
        b.className = 'sim-mon-bits';
        b.textContent = `[${bits - 1}:0]`;
        td.appendChild(b);
      }
    });
  }

  /**
   * A onda do monitor vai para o visualizador de ondas da casa.
   *
   * O monitor guarda cada fio como uma lista de [tick, valor]; isso e um VCD
   * preso numa faixa de 30 px. Aqui vira um retrato plano (nome, caminho de
   * submodulos, bits, mudancas em binario) que o main escreve como .vcd no
   * Temp do PRISM e manda a janela principal abrir, GTKWave ou Surfer
   * conforme a preferencia: a simulacao interativa passa a ter cursor,
   * medida e zoom de verdade.
   */
  async _exportarOnda() {
    if (!this._monitor || !this.circuit || !window.electronAPI?.exportWave) {
      return { ok: false, error: 'the waveform monitor is not open' };
    }
    const sinais = [];
    for (const { wire, waveform } of this._monitor._wires.values()) {
      const src = wire.get('source') || {};
      const cel = wire.getSourceElement();
      const nome = wire.get('netname') || `${src.port || 'out'}_${(cel && (cel.get('label') || cel.get('id'))) || 'fio'}`;
      sinais.push({
        nome,
        caminho: wire.getWirePath() || [],
        bits: wire.get('bits'),
        mudancas: (waveform && waveform._data ? waveform._data : []).map(([t, v]) => [t, v.toBin()]),
      });
    }
    if (!sinais.length) { this._avisar(T.simExportEmpty, true); return { ok: false, error: T.simExportEmpty }; }
    let r;
    try {
      r = await window.electronAPI.exportWave({ modulo: this.currentModule || 'simulacao', presente: this.circuit.tick, sinais });
    } catch (err) {
      r = { ok: false, error: err && err.message ? err.message : String(err) };
    }
    if (!r || !r.ok) {
      const erro = `${T.simExportError}${r && r.error ? `: ${r.error}` : ''}`;
      this._avisar(erro, true);
      return { ok: false, error: erro };
    }
    this._avisar(T.simExported.replace('{f}', r.vcdPath || ''));
    return { ok: true, data: { vcdPath: r.vcdPath, sinais: sinais.map((s) => s.nome) } };
  }

  // -------------------------------------------------------------------------
  //  As escolhas da pessoa, guardadas por projeto e modulo
  // -------------------------------------------------------------------------

  /**
   * O que a pessoa escolheu nesta simulacao: os sinais do monitor (com base e
   * gatilho), a velocidade, o meio periodo e quais paineis estao abertos.
   * Sem isto cada entrada no Simular, e cada Reiniciar, comecava do zero, e
   * montar o monitor de novo era a primeira coisa a fazer toda vez. Fica no
   * localStorage, por projeto e modulo; a gravacao espera um pouco, porque
   * uma troca de base ou um arraste disparam varias vezes seguidas.
   */
  _guardarEscolhas(agora = false) {
    if (!this._simChave) return;
    if (!this._escolhas) this._escolhas = this._lerEscolhas();
    if (this._monitor && this._monitorPanel) this._escolhas.wires = this._sinaisDoMonitor();
    clearTimeout(this._escolhasTimer);
    const gravar = () => {
      try { localStorage.setItem(this._simChave, JSON.stringify(this._escolhas)); } catch (_) { /* sem espaco, ou modo privado */ }
    };
    if (agora) gravar(); else this._escolhasTimer = setTimeout(gravar, 250);
  }

  /** Muda uma escolha e guarda. */
  _escolha(chave, valor) {
    if (!this._escolhas) this._escolhas = this._lerEscolhas();
    this._escolhas[chave] = valor;
    this._guardarEscolhas();
  }

  _escolhasPadrao() {
    return { speed: null, period: null, io: false, monitor: false, wires: null };
  }

  _lerEscolhas() {
    try {
      const cru = this._simChave && localStorage.getItem(this._simChave);
      const lido = cru ? JSON.parse(cru) : null;
      return lido && typeof lido === 'object' ? { ...this._escolhasPadrao(), ...lido } : this._escolhasPadrao();
    } catch (_) {
      return this._escolhasPadrao();
    }
  }

  /**
   * Os fios do monitor como se guardam: nome, caminho, bits, base e gatilho,
   * linha a linha. Um fio sem nome de rede nao tem como ser reencontrado num
   * circuito montado de novo, e fica de fora; e o que o proprio DigitalJS
   * faz ao salvar.
   */
  _sinaisDoMonitor() {
    if (!this._monitor || !this._monitorPanel) return this._escolhas ? this._escolhas.wires : null;
    const porNome = new Map();
    for (const w of this._monitor.getWiresDesc()) {
      if (!Array.isArray(w.path)) continue;
      porNome.set([...w.path, w.name].join('.'), w);
    }
    const lista = [];
    for (const tr of this._monitorPanel.querySelectorAll('table.monitor tr')) {
      const w = porNome.get(tr.dataset.nome || '');
      if (!w) continue;
      const base = tr.querySelector('select[name=base]')?.value || null;
      const gatilho = tr.querySelector('[name=trigger]')?.value || '';
      lista.push({ name: w.name, path: w.path, bits: w.bits, base, trigger: gatilho });
    }
    return lista;
  }

  /** Devolve a cada linha do monitor a base e o gatilho que ela tinha. */
  _aplicarBasesEGatilhos(salvos) {
    const porNome = new Map(salvos.map((w) => [[...(w.path || []), w.name].join('.'), w]));
    for (const tr of this._monitorPanel.querySelectorAll('table.monitor tr')) {
      const w = porNome.get(tr.dataset.nome || '');
      if (!w) continue;
      const base = tr.querySelector('select[name=base]');
      if (base && w.base && [...base.options].some((o) => o.value === w.base)) {
        base.value = w.base;
        base.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const g = tr.querySelector('[name=trigger]');
      if (g && w.trigger && w.trigger !== 'none') {
        g.value = w.trigger;
        g.dispatchEvent(new Event(g.tagName === 'SELECT' ? 'input' : 'change', { bubbles: true }));
      }
    }
  }

  /** Aplica as escolhas guardadas ao circuito recem-montado. */
  _restaurarEscolhas() {
    const c = this.circuit;
    if (!c) return;
    if (!this._escolhas) this._escolhas = this._lerEscolhas();
    const e = this._escolhas;
    const barra = this._simBar;
    if (e.speed && barra) {
      const vel = barra.querySelector('#simSpeed');
      const n = Number(e.speed);
      if (vel && [...vel.options].some((o) => Number(o.value) === n)) {
        vel.value = String(n);
        c.interval = n;
        if (c.running) { c.stop(); c.start(); }
      }
    }
    if (e.period && barra) {
      const p = barra.querySelector('#simPeriod');
      const n = Math.max(1, Math.floor(Number(e.period) || 0));
      if (p && n) {
        p.value = String(n);
        for (const r of c._graph.getElements()) if (r.get('type') === 'Clock') r.set('propagation', n);
      }
    }
    if (e.io && !this._ioPanel) this._alternarPainelIo();
    if (e.monitor && !this._monitorPanel) this._alternarMonitor();
  }

  _desmontarBarraDaSimulacao() {
    // Fechar os paineis por aqui nao e escolha da pessoa: as escolhas ficam.
    this._desmontando = true;
    try {
      if (this._ioPanel) this._alternarPainelIo();
      if (this._monitorPanel) this._alternarMonitor();
    } finally {
      this._desmontando = false;
    }
    if (this._simBar) { this._simBar.remove(); this._simBar = null; }
    if (this._simAviso) { this._simAviso.remove(); this._simAviso = null; }
    clearTimeout(this._avisoTimer);
  }

  /** Stop + dispose the live circuit (best-effort) and clear its host. */
  _destroyCircuit() {
    this._desmontarBarraDaSimulacao();
    this._cursorTick = null;
    // Dispose every level's JointJS paper view (shutdown() doesn't): drops
    // its DOM + Backbone listeners so repeated enter/exit cycles don't leak.
    while (this._simPilha.length) {
      const n = this._simPilha.pop();
      try { n.paper.remove?.(); } catch (_) { /* best-effort */ }
      n.el.remove();
    }
    this._paper = null;
    if (this.circuit) {
      try { this.circuit.stop?.(); } catch (_) { /* best-effort */ }
      try { this.circuit.shutdown?.(); } catch (_) { /* best-effort */ }
      this.circuit = null;
    }
    this.djsWrapper = null;
    this.paperHost = null;
    this._paperPan = null;
    if (this.djsContainer) { this.djsContainer.innerHTML = ''; this.djsContainer.classList.remove('panning'); }
  }

  _setSimToggleLabel(text) {
    const label = document.getElementById('t-simulate');
    if (label) label.textContent = text;
  }

  /**
   * O aviso de uma simulacao que nao coube, no idioma da pessoa.
   *
   * O main classifica a falha (too-large, timeout) e manda os numeros; quem
   * escreve a frase e esta janela, que sabe o idioma. Nos dois casos a saida e
   * a mesma, abrir um submodulo menor e simular aquele, e por isso a dica vai
   * junto: um aviso que so diz "grande demais" deixa a pessoa parada.
   */
  _simFailureText(res) {
    const r = res || {};
    const enche = (tpl) => String(tpl)
      .replace('{m}', r.module || this.currentModule || '?')
      .replace('{n}', String(r.cells ?? '?'))
      .replace('{l}', String(r.limit ?? '?'))
      .replace('{s}', String(r.seconds ?? '?'));
    if (r.reason === 'too-large') return `${enche(T.simTooLarge)} ${T.simHint}`;
    if (r.reason === 'timeout') return `${enche(T.simTimeout)} ${T.simHint}`;
    return r.message ? `${T.simError}: ${r.message}` : T.simError;
  }

  /** Show a sim-mode error and auto-clear it so the schematic stays usable. */
  _showSimError(msg) {
    this._log(msg, 'error');
    this._showStatus(msg, true);
    clearTimeout(this._simErrTimer);
    this._simErrTimer = setTimeout(() => this._hideStatus(), 7000);
  }

  // -------------------------------------------------------------------------
  //  A simulacao pela AuroraAPI
  //
  //  Tudo o que a barra e os dois paineis fazem com o mouse tem aqui um nome
  //  e uma resposta em JSON, para a AuroraAPI, e por ela a Aurora
  //  Intelligence, operar o Simular sem depender de pixel nenhum. O ganho nao
  //  e conveniencia: ate aqui a assistente nao tinha como LER um valor de
  //  simulacao. O GTKWave e uma janela externa, o Surfer tambem; a onda era
  //  sempre uma figura para o humano olhar. Este e o primeiro caminho pelo
  //  qual ela observa o circuito rodando, e por isso o `correrAte` existe:
  //  avancar um numero exato de ticks, ou ate um sinal valer o que se espera,
  //  e ler o que deu, que e o laco de um teste.
  //
  //  Cada comando devolve { ok, data } ou { ok:false, error }, a mesma forma
  //  da AuroraAPI, para atravessar o IPC sem traducao.
  // -------------------------------------------------------------------------

  async _comandoDaApi(cmd) {
    const c = cmd && typeof cmd === 'object' ? cmd : {};
    const op = String(c.op || '');
    const bom = (data) => ({ ok: true, data });
    const ruim = (error) => ({ ok: false, error });
    // O estado e o unico comando que responde com a simulacao fechada: e por
    // ele que quem chama descobre que precisa abrir.
    if (op === 'status') return bom(this._estadoDaSimulacao());
    if (op === 'enter') {
      if (this.simMode) return bom(this._estadoDaSimulacao());
      if (!window.electronAPI?.buildDigitalJS) return ruim('this PRISM window cannot build a simulation');
      await this.enterSimMode();
      if (!this.simMode) return ruim('the simulation could not be built; the PRISM terminal has the reason');
      return bom(this._estadoDaSimulacao());
    }
    if (op === 'exit') {
      if (this.simMode) this.exitSimMode();
      return bom(this._estadoDaSimulacao());
    }
    if (!this.simMode || !this.circuit) {
      return ruim('the simulation is not running: call it with op "enter" first');
    }
    const circuito = this.circuit;
    switch (op) {
      case 'control': {
        const acao = String(c.acao || '');
        const acoes = {
          run:   () => { if (!circuito.running) circuito.start(); },
          pause: () => { if (circuito.running) circuito.stop(); },
          tick:  () => { if (circuito.running) circuito.stop(); circuito.updateGates(); },
          next:  () => { if (circuito.running) circuito.stop(); circuito.updateGatesNext(); },
          fast:  () => { if (circuito.running) circuito.stop(); circuito.startFast(); },
          reset: () => this._reiniciarSimulacao(),
        };
        if (!acoes[acao]) return ruim(`unknown action "${acao}": use run, pause, tick, next, fast or reset`);
        acoes[acao]();
        return bom(this._estadoDaSimulacao());
      }
      case 'speed': {
        const tps = Number(c.ticksPorSegundo);
        if (!Number.isFinite(tps) || tps <= 0) return ruim('ticksPorSegundo must be a positive number');
        const sel = this._simBar?.querySelector('#simSpeed');
        const opcoes = sel ? [...sel.options].map((o) => Number(o.value)) : [];
        const ms = Math.max(1, Math.round(1000 / tps));
        // A barra so tem as velocidades da lista: escolhe-se a mais proxima,
        // e o que a resposta diz e a que passou a valer, nao a pedida.
        const perto = opcoes.length ? opcoes.reduce((a, b) => (Math.abs(b - ms) < Math.abs(a - ms) ? b : a)) : ms;
        circuito.interval = perto;
        if (sel) sel.value = String(perto);
        if (circuito.running) { circuito.stop(); circuito.start(); }
        this._escolha('speed', perto);
        return bom(this._estadoDaSimulacao());
      }
      case 'period': {
        const n = Math.floor(Number(c.ticks));
        if (!Number.isFinite(n) || n < 1) return ruim('ticks must be an integer of 1 or more');
        const relogios = circuito._graph.getElements().filter((el) => el.get('type') === 'Clock');
        if (!relogios.length) return ruim('this module has no clock: advance it with control tick');
        for (const r of relogios) r.set('propagation', n);
        const p = this._simBar?.querySelector('#simPeriod');
        if (p) p.value = String(n);
        this._escolha('period', n);
        return bom(this._estadoDaSimulacao());
      }
      case 'input': {
        const r = this._escreverEntrada(String(c.nome || ''), c.valor, c.base);
        return r.ok ? bom(this._estadoDaSimulacao()) : r;
      }
      case 'wires':
        return bom({ fios: this._fiosVisiveis() });
      case 'monitor':
        return this._comandoDoMonitor(c);
      case 'runUntil':
        return this._correrAte(c);
      case 'export': {
        if (!this._monitorPanel) this._alternarMonitor();
        const r = await this._exportarOnda();
        return r;
      }
      case 'level': {
        const acao = String(c.acao || 'back');
        if (acao === 'top') this._voltarNivel(0);
        else if (acao === 'back') this._voltarNivel(this._simPilha.length - 2);
        else if (acao === 'enter') {
          const alvo = String(c.nome || '');
          const cel = this._paper.model.getElements().find((el) => el.get('type') === 'Subcircuit'
            && (el.get('label') === alvo || el.get('celltype') === alvo));
          if (!cel) {
            const nomes = this._paper.model.getElements().filter((el) => el.get('type') === 'Subcircuit')
              .map((el) => el.get('label') || el.get('celltype'));
            return ruim(`no submodule "${alvo}" at this level${nomes.length ? `; there is ${nomes.join(', ')}` : ' (this level has none)'}`);
          }
          this._entrarNoSubcircuito(cel);
        } else return ruim(`unknown action "${acao}": use enter, back or top`);
        return bom(this._estadoDaSimulacao());
      }
      default:
        return ruim(`unknown op "${op}"`);
    }
  }

  /** O retrato da simulacao: o que a barra, os paineis e as migalhas mostram. */
  _estadoDaSimulacao() {
    const c = this.circuit;
    const base = {
      modulo: this.currentModule || null,
      modo: this.simMode ? 'simulacao' : 'esquematico',
      simulando: !!(this.simMode && c),
    };
    if (!this.simMode || !c) return base;
    const d = c._display3vl;
    const mostrar = (sig, bits) => (sig ? d.show(bits > 1 ? 'hex' : 'bin', sig) : 'x');
    const porta = (cel, entrada) => ({
      nome: cel.get('net') || cel.get('label'),
      bits: cel.get('bits') || 1,
      valor: mostrar(entrada ? (cel.get('outputSignals') || {}).out : cel.getOutput(), cel.get('bits') || 1),
    });
    const relogio = c._graph.getElements().find((el) => el.get('type') === 'Clock');
    return {
      ...base,
      tick: c.tick,
      rodando: !!c.running,
      ticksPorSegundo: Math.round(1000 / (c.interval || 10)),
      meioPeriodo: relogio ? relogio.get('propagation') : null,
      niveis: this._simPilha.map((n) => n.nome),
      entradas: c.getInputCells().map((cel) => porta(cel, true)),
      saidas: c.getOutputCells().map((cel) => porta(cel, false)),
      monitor: this._sinaisMonitorados(),
      paineis: { entradasSaidas: !!this._ioPanel, formasDeOnda: !!this._monitorPanel },
    };
  }

  /** Os fios do nivel visivel que se pode levar ao monitor, com o valor de agora. */
  _fiosVisiveis() {
    if (!this._paper) return [];
    const d = this.circuit._display3vl;
    const monitorados = new Set(this._monitor ? this._monitor.getWires().map((w) => w.get('netname')) : []);
    const vistos = new Set();
    const fios = [];
    for (const link of this._paper.model.getLinks()) {
      const nome = link.get('netname');
      if (!nome || vistos.has(nome)) continue;
      vistos.add(nome);
      const bits = link.get('bits') || 1;
      fios.push({
        nome,
        bits,
        valor: d.show(bits > 1 ? 'hex' : 'bin', link.get('signal')),
        monitorado: monitorados.has(nome),
      });
    }
    return fios;
  }

  /** As linhas do monitor: nome, bits, base, gatilho e valor de agora. */
  _sinaisMonitorados() {
    if (!this._monitor) return [];
    const d = this.circuit._display3vl;
    const linhas = this._monitorPanel
      ? [...this._monitorPanel.querySelectorAll('table.monitor tr')]
      : [];
    return this._monitor.getWires().map((wire) => {
      const nome = wire.get('netname') || '';
      const tr = linhas.find((l) => l.dataset.nome === nome);
      const bits = wire.get('bits') || 1;
      // Na base da linha, e nao sempre em hex: dizer "base dec" e mostrar o
      // valor em hexadecimal e pior do que nao dizer base nenhuma.
      const base = bits > 1 ? (tr?.querySelector('select[name=base]')?.value || 'hex') : 'bin';
      return {
        nome,
        bits,
        base,
        pararEm: tr?.querySelector('[name=trigger]')?.value || null,
        valor: d.show(base, wire.get('signal')),
      };
    });
  }

  /** A celula de entrada com este nome, no nivel do topo. */
  _acharEntrada(nome) {
    return this.circuit.getInputCells().find((cel) => (cel.get('net') || cel.get('label')) === nome) || null;
  }

  /**
   * Escreve numa entrada. Um bit aceita 0 e 1; um barramento aceita o valor na
   * base pedida (hex de fabrica, como o painel). O relogio nao se escreve: ele
   * bate sozinho, e mexer nele a mao so confundiria a onda.
   */
  _escreverEntrada(nome, valor, base) {
    const cel = this._acharEntrada(nome);
    if (!cel) {
      // O relogio nao esta entre as entradas: ele nao e um botao, e um
      // oscilador. Dizer isso vale mais do que "nao existe".
      const ehRelogio = this.circuit._graph.getElements()
        .some((el) => el.get('type') === 'Clock' && (el.get('net') || el.get('label')) === nome);
      if (ehRelogio) return { ok: false, error: `"${nome}" is the clock: it toggles on its own, set its half period with op "period"` };
      const nomes = this.circuit.getInputCells().map((e) => e.get('net') || e.get('label'));
      return { ok: false, error: `no input named "${nome}"; this module has ${nomes.join(', ') || 'none'}` };
    }
    const bits = cel.get('bits') || 1;
    const b = String(base || (bits > 1 ? 'hex' : 'bin'));
    const d = this.circuit._display3vl;
    const texto = String(valor == null ? '' : valor).trim();
    if (!d.validate(b, texto, bits)) return { ok: false, error: `"${texto}" is not a valid ${b} value for ${nome} (${bits} bits)` };
    cel.setInput(d.read(b, texto, bits));
    return { ok: true };
  }

  /** Um fio pelo nome, entre os do nivel visivel. */
  _acharFio(nome) {
    if (!this._paper) return null;
    return this._paper.model.getLinks().find((l) => l.get('netname') === nome) || null;
  }

  _comandoDoMonitor(c) {
    const acao = String(c.acao || '');
    if (acao === 'clear') {
      if (this._monitor) for (const w of this._monitor.getWires()) this._monitor.removeWire(w);
      this._guardarEscolhas();
      return { ok: true, data: { monitor: this._sinaisMonitorados() } };
    }
    if (!this._monitorPanel) this._alternarMonitor();
    const nome = String(c.sinal || '');
    if (acao === 'add') {
      const fio = this._acharFio(nome);
      if (!fio) return { ok: false, error: `no wire named "${nome}" at this level; call op "wires" for the list` };
      this._monitor.addWire(fio);
      this._guardarEscolhas();
      return { ok: true, data: { monitor: this._sinaisMonitorados() } };
    }
    const wire = this._monitor.getWires().find((w) => w.get('netname') === nome);
    if (!wire) return { ok: false, error: `"${nome}" is not in the monitor` };
    if (acao === 'remove') {
      this._monitor.removeWire(wire);
      this._guardarEscolhas();
      return { ok: true, data: { monitor: this._sinaisMonitorados() } };
    }
    // Base e "parar em" moram nos controles da linha; mexer neles pelo mesmo
    // caminho do mouse (o evento que o MonitorView escuta) evita um segundo
    // caminho de verdade dentro da biblioteca.
    const tr = [...this._monitorPanel.querySelectorAll('table.monitor tr')].find((l) => l.dataset.nome === nome);
    if (!tr) return { ok: false, error: `"${nome}" has no row in the monitor` };
    if (acao === 'base') {
      const sel = tr.querySelector('select[name=base]');
      const b = String(c.base || '');
      if (!sel) return { ok: false, error: `"${nome}" is one bit: it has no base` };
      if (![...sel.options].some((o) => o.value === b)) {
        return { ok: false, error: `unknown base "${b}"; use ${[...sel.options].map((o) => o.value).join(', ')}` };
      }
      sel.value = b;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      this._guardarEscolhas();
      return { ok: true, data: { monitor: this._sinaisMonitorados() } };
    }
    if (acao === 'trigger') {
      const campo = tr.querySelector('[name=trigger]');
      if (!campo) return { ok: false, error: `"${nome}" has no stop-at control` };
      const v = c.valor == null ? '' : String(c.valor);
      if (campo.tagName === 'SELECT' && v && ![...campo.options].some((o) => o.value === v)) {
        return { ok: false, error: `unknown stop-at "${v}"; use ${[...campo.options].map((o) => o.value).join(', ')}` };
      }
      campo.value = v;
      campo.dispatchEvent(new Event(campo.tagName === 'SELECT' ? 'input' : 'change', { bubbles: true }));
      this._guardarEscolhas();
      return { ok: true, data: { monitor: this._sinaisMonitorados() } };
    }
    return { ok: false, error: `unknown action "${acao}": use add, remove, base, trigger or clear` };
  }

  /**
   * Avanca a simulacao um numero exato de ticks, ou ate um sinal valer o que
   * se espera, e responde com onde parou e o que os sinais valem ali.
   *
   * O passo e dado a mao (updateGates avanca um tick e confere os gatilhos),
   * e nao pelo motor de relogio: assim o tick de parada e exato, o resultado
   * nao depende de quantos milissegundos passaram, e a resposta chega quando
   * a conta termina. Em blocos, cedendo o fio entre eles, para a janela nao
   * congelar num laco de cem mil ticks.
   */
  async _correrAte(c) {
    const circuito = this.circuit;
    const ticks = c.ticks == null ? null : Math.floor(Number(c.ticks));
    const nome = c.sinal == null ? '' : String(c.sinal);
    if (ticks != null && (!Number.isFinite(ticks) || ticks < 1)) return { ok: false, error: 'ticks must be an integer of 1 or more' };
    if (ticks == null && !nome) return { ok: false, error: 'say how far to run: ticks, or sinal plus valor' };
    const limiteMs = Math.min(60000, Math.max(100, Number(c.limiteMs) || 10000));
    const tetoTicks = ticks == null ? 1000000 : ticks;

    let casou = () => false;
    if (nome) {
      const d = circuito._display3vl;
      const fio = this._acharFio(nome);
      const saida = fio ? null : circuito.getOutputCells().find((cel) => (cel.get('net') || cel.get('label')) === nome);
      if (!fio && !saida) return { ok: false, error: `no wire or output named "${nome}"; call op "wires" for the list` };
      const bits = (fio ? fio.get('bits') : saida.get('bits')) || 1;
      const ler = () => (fio ? fio.get('signal') : saida.getOutput());
      if (c.valor == null) return { ok: false, error: `pass valor: which value of "${nome}" to stop at` };
      const base = String(c.base || (bits > 1 ? 'hex' : 'bin'));
      const texto = String(c.valor).trim();
      if (!d.validate(base, texto, bits)) return { ok: false, error: `"${texto}" is not a valid ${base} value for ${nome} (${bits} bits)` };
      const alvo = d.read(base, texto, bits);
      casou = () => { const s = ler(); return !!s && s.eq(alvo); };
    }

    if (circuito.running) circuito.stop();
    const inicio = Date.now();
    const tickInicial = circuito.tick;
    let motivo = 'ticks';
    if (casou()) motivo = 'valor';
    while (motivo === 'ticks' && circuito.tick - tickInicial < tetoTicks) {
      for (let i = 0; i < 200 && circuito.tick - tickInicial < tetoTicks; i++) {
        circuito.updateGates();
        // Um "parar em" do monitor tambem para aqui: quem pediu um valor e a
        // pessoa, e a corrida da API nao passa por cima dele.
        if (casou()) { motivo = 'valor'; break; }
      }
      if (motivo !== 'ticks') break;
      if (Date.now() - inicio > limiteMs) { motivo = 'tempo'; break; }
      await new Promise((r) => setTimeout(r, 0));
    }
    if (nome && motivo === 'ticks' && ticks == null) motivo = 'tempo';
    return {
      ok: true,
      data: {
        motivo,
        tick: circuito.tick,
        ticksAndados: circuito.tick - tickInicial,
        ...this._estadoDaSimulacao(),
      },
    };
  }

  // -------------------------------------------------------------------------
  //  DigitalJS paper pan/zoom — CSS transform on the wrapper, mirroring the
  //  schematic's values (factor exp(-deltaY*0.0016), clamp 0.1–5, ~90% fit).
  // -------------------------------------------------------------------------
  _applyPaperTransform() {
    if (this.djsWrapper) {
      this.djsWrapper.style.transformOrigin = '0 0';
      this.djsWrapper.style.transform =
        `translate(${this._paperTx}px, ${this._paperTy}px) scale(${this._paperScale})`;
    }
  }

  /** Afasta os elementos entre si, mantendo a forma do layout. Uma vez por grafo. */
  _expandirLayout(nivel, fx, fy) {
    const graph = nivel && nivel.graph;
    if (!graph || graph.get('prismExpandido')) return;
    graph.set('prismExpandido', true);
    for (const el of graph.getElements()) {
      const p = el.position();
      el.position(p.x * fx, p.y * fy);
    }
    for (const l of graph.getLinks()) {
      const vs = l.vertices ? l.vertices() : [];
      if (vs && vs.length) l.vertices(vs.map((v) => ({ x: v.x * fx, y: v.y * fy })));
    }
    try { nivel.paper.fitToContent({ padding: 40, allowNewOrigin: 'any' }); } catch (_) { /* versao sem fitToContent */ }
  }

  /** Center + fit the circuit in the viewport. */
  _fitPaper() {
    if (!this.djsWrapper || !this.paperHost || !this.djsContainer) return;
    const cw = this.djsContainer.clientWidth;
    const ch = this.djsContainer.clientHeight;
    const pw = this.paperHost.offsetWidth;
    const ph = this.paperHost.offsetHeight;
    if (!cw || !ch || !pw || !ph) return;
    this._paperScale = Math.max(0.1, Math.min((cw * 0.9) / pw, (ch * 0.9) / ph, 2.5));
    this._paperTx = (cw - pw * this._paperScale) / 2;
    this._paperTy = (ch - ph * this._paperScale) / 2;
    this._applyPaperTransform();
  }

  /** Zoom the paper, anchored at (clientX,clientY) when given, else the centre. */
  _paperZoom(factor, clientX = null, clientY = null) {
    if (!this.djsWrapper) return;
    const cur = this._paperScale;
    const next = Math.max(0.1, Math.min(5, cur * factor));
    if (Math.abs(next - cur) < 1e-4) return;
    const rect = this.djsContainer.getBoundingClientRect();
    const ox = clientX == null ? rect.width / 2 : clientX - rect.left;
    const oy = clientY == null ? rect.height / 2 : clientY - rect.top;
    this._paperTx = ox - (ox - this._paperTx) * (next / cur);
    this._paperTy = oy - (oy - this._paperTy) * (next / cur);
    this._paperScale = next;
    this._applyPaperTransform();
  }

  /**
   * A marca da entrada escolhida do multiplexador: check verde de um lado, x
   * vermelho do outro.
   *
   * O DigitalJS marca a entrada que esta valendo com um risco preto de tres
   * pontos, do tamanho de um til, e ESCONDE o das outras. Fica um sinal fraco,
   * na cor do texto, e quem olha nao sabe se a outra entrada esta descartada ou
   * se aquela marca nem existe naquele mux. Aqui a escolhida ganha um check
   * verde e as demais um x vermelho: as duas metades da resposta ficam na tela
   * ao mesmo tempo, que e o que se le de longe.
   *
   * A troca e no proprio _updateMux da biblioteca, o unico ponto que sabe qual
   * entrada esta valendo e que roda a cada mudanca de sinal. Um no injetado no
   * DOM depois do desenho sumiria no proximo redesenho de portas.
   */
  _pintarMuxes(cells) {
    const Vista = cells && cells.GenMuxView;
    if (!Vista || Vista.prototype._prismDecor) return;
    const CHECK = 'M0.5 0.5 L4 4.5 L10 -5';
    const XIS = 'M1.5 -4 L8.5 3 M8.5 -4 L1.5 3';
    Vista.prototype._updateMux = function (data) {
      const escolhida = this.model.muxInput(data.sel);
      for (const num of this.ins.keys()) {
        const marca = this.$(`[port=in${num}] path.decor`);
        // Solto de proposito, como na biblioteca: muxInput devolve string.
        const vale = escolhida == num;
        marca.attr('d', vale ? CHECK : XIS);
        marca.attr('class', `decor ${vale ? 'prism-mux-sim' : 'prism-mux-nao'}`);
        marca.css('visibility', 'visible');
      }
    };
    Vista.prototype._prismDecor = true;
  }

  /**
   * Overlay a live 0/1/x digit on each 1-bit input/output box so the value is
   * readable at a glance (DigitalJS only fills the box black/white). The
   * overlays live inside .djs-wrapper, so they pan/zoom with the circuit, and
   * update on every signal change (e.g. when the user clicks an input).
   */
  _buildValueOverlays(nivel) {
    if (!nivel || !nivel.paper || !nivel.el.isConnected) return;
    // Montar de novo tira os ouvintes da vez anterior: sem isto cada montagem
    // (o render:done e a folga de 150 ms) deixava um par a mais por celula.
    for (const s of nivel.sobreposicoes) {
      s.cell.off(s.evento, s.update);
      s.cell.off('change:position change:size', s.place);
    }
    nivel.sobreposicoes = [];
    nivel.el.querySelectorAll('.djs-valnum').forEach((e) => e.remove());
    const graph = nivel.paper.model;
    const digit = (/** @type {any} */ sig) => (!sig ? 'x' : sig.isHigh ? '1' : sig.isLow ? '0' : 'x');
    for (const cell of graph.getElements()) {
      const type = cell.get('type');
      if ((type !== 'Input' && type !== 'Output' && type !== 'Clock') || (type !== 'Clock' && cell.get('bits') !== 1)) continue;
      const sigKey = type === 'Output' ? 'inputSignals' : 'outputSignals';
      const port = type === 'Output' ? 'in' : 'out';
      const el = document.createElement('div');
      el.className = 'djs-valnum';
      nivel.el.appendChild(el);
      const place = () => {
        const b = cell.getBBox();
        // Map model coords → paper pixels so we account for the paper's own
        // origin/scale (digitaljs fitToContent moves it); the overlay lives in
        // the level's box alongside its paper, so our pan/zoom transform
        // applies to both equally and they stay aligned.
        const p = nivel.paper.localToPaperPoint(b.x + b.width / 2, b.y + b.height / 2);
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
      };
      const update = () => {
        const d = digit((cell.get(sigKey) || {})[port]);
        el.textContent = d;
        el.dataset.v = d;
      };
      place(); update();
      const evento = `change:${sigKey}`;
      cell.on(evento, update);
      cell.on('change:position change:size', place);
      nivel.sobreposicoes.push({ cell, evento, update, place });
    }
  }

  /**
   * O balao de valor do fio, para todo fio.
   *
   * O DigitalJS mostra hex, dec, oct e bin ao passar o mouse num barramento, e
   * nada num fio de 1 bit, que so tem a cor. A cor diz 0, 1 ou x para quem
   * decorou a legenda; o balao diz em letra, e diz de QUAL fio, que o de
   * fabrica tambem nao dizia: num emaranhado de dez fios, o valor sem o nome
   * e meio caminho.
   */
  _pintarBaloesDeFio(cells) {
    const Vista = cells && cells.WireView;
    const $ = window.jQuery;
    if (!Vista || !$ || Vista.prototype._prismBalao) return;
    const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    Vista.prototype._addTooltip = function (pos) {
      if (this.wire_hover) return;
      this.wire_hover = $('<div class="wire_hover">').css('left', pos.x).css('top', pos.y).appendTo($(document.body));
      this._generateTextForTooltip();
      this.listenTo(this.model, 'change:signal', this._generateTextForTooltip);
    };
    Vista.prototype._generateTextForTooltip = function () {
      if (!this.wire_hover) return;
      const sig = this.model.get('signal');
      const d = this.model.graph._display3vl;
      const bits = this.model.get('bits');
      const nome = this.model.get('netname');
      const linhas = [];
      if (nome) linhas.push(`<b>${escapar(nome)}</b>${bits > 1 ? ` [${bits - 1}:0]` : ''}`);
      if (bits > 1) linhas.push(`hex ${d.show('hex', sig)}`, `dec ${d.show('dec', sig)}`, `bin ${d.show('bin', sig)}`);
      else linhas.push(d.show('bin', sig));
      this.wire_hover.html(linhas.join('<br>'));
    };
    Vista.prototype._prismBalao = true;
  }
}

// ---------------------------------------------------------------------------
//  Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  window.prismViewer = new PRISMViewer();
});

// Global error boundary
window.addEventListener('error', (e) => {
  window.prismViewer?._showStatus(`Error: ${e.error?.message || e.message}`, true);
});
window.addEventListener('unhandledrejection', (e) => {
  window.prismViewer?._showStatus(`Error: ${e.reason?.message || e.reason}`, true);
});
