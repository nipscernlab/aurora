// @ts-check
'use strict';

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
    clickModule: 'Click to open · double-click for source: ',
    clickWire:   'Click to highlight connection',
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
    clickModule: 'Clique para abrir · duplo-clique p/ o código: ',
    clickWire:   'Clique para destacar conexão',
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
    this.tempDir = null;
    this._lastTouchPoint = null;
    this._lastTouchDist = null;

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
    this.fitBtn.addEventListener('click',      () => this.fitToScreen());
    this.downloadBtn?.addEventListener('click',() => this.downloadSVG());
    this.zoomInBtn.addEventListener('click',   () => this._zoomButton(1.25));
    this.zoomOutBtn.addEventListener('click',  () => this._zoomButton(0.8));
    this.resetZoomBtn.addEventListener('click',() => this.resetView());

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
      e.preventDefault();
      if (!this.svgContainer.contains(e.target)) this._onWheel(e);
    }, { passive: false });

    // Window resize → re-fit
    window.addEventListener('resize', () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this.fitToScreen(), 250);
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
      this._setupSVGInteractions();
      this._adjustBusLabels();
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

  _adjustBusLabels() {
    const labels = this.svgContent.querySelectorAll('text[class*="busLabel_"]');
    labels.forEach((label) => {
      label.setAttribute('dx', '5');
      const rect = label.previousElementSibling;
      if (rect && rect.tagName.toLowerCase() === 'rect') rect.setAttribute('width', '20');
    });
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
      const result = await window.electronAPI.prismRecompile(paths);
      if (!result.success) this._showStatus(`Compilation Error: ${result.message}`, true);
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
        // Single click navigates, but a double click on the SAME cell opens
        // its source. Defer navigation by one dblclick window so the dblclick
        // handler below can cancel it — otherwise the first click of a
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

    // Wire highlighting
    svg.querySelectorAll('path, line, polyline').forEach((wire) => {
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
          wPts.forEach((p) => {
            if (!toCheck.some((q) => Math.abs(q.x - p.x) <= TOL && Math.abs(q.y - p.y) <= TOL)) toCheck.push(p);
          });
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
      switch (e.key) {
        case '=': case '+': e.preventDefault(); this.zoom(1.2); break;
        case '-':           e.preventDefault(); this.zoom(0.8); break;
        case '0':           e.preventDefault(); this.resetView();    break;
        case 'f':           e.preventDefault(); this.fitToScreen();  break;
        case 'r':           e.preventDefault(); this.recompile();    break;
      }
    }
    if (e.key === 'Escape' && !this.backBtn.disabled) this.navigateBack();
    if (e.key === 'F11') {
      e.preventDefault();
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    }
  }

  // -------------------------------------------------------------------------
  //  Context menu
  // -------------------------------------------------------------------------
  _onContextMenu(e) {
    // Source cells no longer claim right-click (it opens via double-click now),
    // so the zoom/recompile menu is available everywhere on the canvas.
    e.preventDefault();

    let menu = document.getElementById('contextMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'contextMenu';
      menu.className = 'context-menu';
      menu.innerHTML = `
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
        menu.classList.remove('show');
      });
      document.body.appendChild(menu);
    }

    menu.style.left = e.pageX + 'px';
    menu.style.top  = e.pageY + 'px';
    menu.classList.add('show');

    const hide = (ev) => {
      if (!menu.contains(ev.target)) { menu.classList.remove('show'); document.removeEventListener('click', hide); }
    };
    setTimeout(() => document.addEventListener('click', hide), 10);
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
