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
  async _loadSVG(svgPath, moduleName) {
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
      console.error('[PRISM] Failed to load SVG:', err);
      this._showStatus(`Failed to load SVG: ${err.message}`, true);
    }
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
    if (this.navigationHistory.length <= 1) return;
    this.forwardHistory.push(this.navigationHistory.pop());
    const prev = this.navigationHistory[this.navigationHistory.length - 1];
    this._loadSVG(prev.svgPath, prev.module);
    this.backBtn.disabled = this.navigationHistory.length <= 1;
  }

  // Re-enter a module the user backed out of (mouse forward / X2 button).
  navigateForward() {
    if (this.forwardHistory.length === 0) return;
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
      this._Circuit = (await import('digitaljs')).Circuit;
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
    this._showStatus(T.building, false);

    try {
      let res;
      try {
        const paths = await window.electronAPI.getPrismCompilationPaths();
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

      // Fresh paper host inside a transformed wrapper (pan/zoom layer).
      this._destroyCircuit();
      const wrapper = document.createElement('div');
      wrapper.className = 'djs-wrapper';
      const paperHost = document.createElement('div');
      paperHost.className = 'djs-paper';
      wrapper.appendChild(paperHost);
      this.djsContainer.appendChild(wrapper);
      this.djsWrapper = wrapper;
      this.paperHost = paperHost;
      this._paperScale = 1; this._paperTx = 0; this._paperTy = 0;

      try {
        const Circuit = await this._loadDigitalJS();
        // Synchronous browser engine (default) + dagre layout → NO Web Worker,
        // so it renders under file:// without elkjs's worker.
        this.circuit = new Circuit(res.circuit, { layoutEngine: 'dagre' });
        this._paper = this.circuit.displayOn(paperHost);
        this.circuit.start();
        // Pan by dragging blank space (gates stay draggable via JointJS).
        this._paper.on('blank:pointerdown', (/** @type {any} */ evt) => {
          const oe = (evt && evt.originalEvent) || evt || {};
          this._paperPan = { x: oe.clientX, y: oe.clientY, tx: this._paperTx, ty: this._paperTy };
          this.djsContainer.classList.add('panning');
        });
        // Center + fit, and lay the 0/1 digits, once the (async) layout lands.
        this._paper.once('render:done', () => { this._fitPaper(); this._buildValueOverlays(); });
        setTimeout(() => { this._fitPaper(); this._buildValueOverlays(); }, 150);
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
    } finally {
      this._simBusy = false;
      if (this.simToggle) this.simToggle.disabled = false;
    }
  }

  exitSimMode() {
    this._destroyCircuit();
    this.simMode = false;
    this.djsContainer.style.display = 'none';
    this.svgContainer.style.display = '';
    this.simToggle?.classList.remove('active');
    this._setSimToggleLabel(T.simulate);
  }

  /** Stop + dispose the live circuit (best-effort) and clear its host. */
  _destroyCircuit() {
    if (this.circuit) {
      try { this.circuit.stop?.(); } catch (_) { /* best-effort */ }
      try { this.circuit.shutdown?.(); } catch (_) { /* best-effort */ }
      this.circuit = null;
    }
    // Dispose the JointJS paper view (shutdown() doesn't): drops its DOM +
    // Backbone listeners so repeated enter/exit cycles don't leak views.
    if (this._paper) {
      try { this._paper.remove?.(); } catch (_) { /* best-effort */ }
      this._paper = null;
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
    this._showStatus(msg, true);
    clearTimeout(this._simErrTimer);
    this._simErrTimer = setTimeout(() => this._hideStatus(), 7000);
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
   * Overlay a live 0/1/x digit on each 1-bit input/output box so the value is
   * readable at a glance (DigitalJS only fills the box black/white). The
   * overlays live inside .djs-wrapper, so they pan/zoom with the circuit, and
   * update on every signal change (e.g. when the user clicks an input).
   */
  _buildValueOverlays() {
    if (!this._paper || !this.djsWrapper) return;
    this.djsWrapper.querySelectorAll('.djs-valnum').forEach((e) => e.remove());
    const graph = this._paper.model;
    const digit = (/** @type {any} */ sig) => (!sig ? 'x' : sig.isHigh ? '1' : sig.isLow ? '0' : 'x');
    for (const cell of graph.getElements()) {
      const type = cell.get('type');
      if ((type !== 'Input' && type !== 'Output') || cell.get('bits') !== 1) continue;
      const sigKey = type === 'Input' ? 'outputSignals' : 'inputSignals';
      const port = type === 'Input' ? 'out' : 'in';
      const el = document.createElement('div');
      el.className = 'djs-valnum';
      this.djsWrapper.appendChild(el);
      const place = () => {
        const b = cell.getBBox();
        // Map model coords → paper pixels so we account for the paper's own
        // origin/scale (digitaljs fitToContent moves it); the overlay lives in
        // .djs-wrapper alongside the paper, so our pan/zoom transform applies to
        // both equally and they stay aligned.
        const p = this._paper.localToPaperPoint(b.x + b.width / 2, b.y + b.height / 2);
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
      };
      const update = () => {
        const d = digit((cell.get(sigKey) || {})[port]);
        el.textContent = d;
        el.dataset.v = d;
      };
      place(); update();
      cell.on(`change:${sigKey}`, update);
      cell.on('change:position change:size', place);
    }
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
