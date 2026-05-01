/**
 * Panel Resizer — file tree (vertical) + terminal (horizontal) + corner.
 *
 * Fix: durante o drag, desabilitamos transitions de width/height nos containers
 * (via `body.resizing-*`), evitando o lag de 280ms causado pelo
 * `transition: width 0.28s` que existia em layout.css.
 */

const verticalResizer   = document.querySelector('.resizer-vertical');
const horizontalResizer = document.querySelector('.resizer-horizontal');
const fileTreeContainer = document.querySelector('.file-tree-container');
const terminalContainer = document.querySelector('.terminal-container');

// File tree always keeps a minimum width while visible — guarantees the
// vertical resizer is reachable. Use the toolbar sidebar toggle to fully
// hide / restore the panel.
const MIN_FILE_TREE_WIDTH  = 180;
const SNAP_THRESHOLD       = 0;
const COLLAPSED_THRESHOLD  = 24;
const DEFAULT_OPEN_WIDTH   = 260;
const MIN_TERMINAL_HEIGHT  = 30;
const MAX_FILE_TREE_RATIO  = 0.5;

const STORAGE_FT_WIDTH = 'fileTreeWidth';
const STORAGE_TERM_H   = 'terminalHeight';

// Inject runtime CSS para hit-area do corner handle e estados de drag.
// (As classes `resizing-vertical/horizontal/corner` são consumidas em styles.css)
const style = document.createElement('style');
style.textContent = `
  body.resizing-vertical,
  body.resizing-vertical * { cursor: col-resize !important; user-select: none !important; }
  body.resizing-horizontal,
  body.resizing-horizontal * { cursor: row-resize !important; user-select: none !important; }
  body.resizing-corner,
  body.resizing-corner * { cursor: all-scroll !important; user-select: none !important; }

  #resize-corner-handle {
    position: fixed;
    /* Generous invisible hit area so the meeting point of the two resizers
       is easy to grab. Visual highlighting of the resizers on hover/active
       gives the user the discovery cue. */
    width: 22px;
    height: 22px;
    background: transparent;
    cursor: all-scroll;
    z-index: 100;
  }
`;
document.head.appendChild(style);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

function constrainFileTreeWidth(w) {
  return clamp(w, MIN_FILE_TREE_WIDTH, window.innerWidth * MAX_FILE_TREE_RATIO);
}

function getMaxTerminalHeight() {
  const toolbar  = document.querySelector('.toolbar');
  const statusBar = document.querySelector('.status-bar');
  const toolbarH = toolbar ? toolbar.offsetHeight : 44;
  const statusH  = statusBar ? statusBar.offsetHeight : 22;
  const resizerH = 6;
  return window.innerHeight - toolbarH - statusH - resizerH;
}

function constrainTerminalHeight(h) {
  return clamp(h, MIN_TERMINAL_HEIGHT, getMaxTerminalHeight());
}

function applyFileTreeWidth(w) {
  if (!fileTreeContainer) return;
  fileTreeContainer.style.width = w + 'px';
  if (w < COLLAPSED_THRESHOLD) {
    fileTreeContainer.classList.add('is-collapsed');
  } else {
    fileTreeContainer.classList.remove('is-collapsed');
  }
}

// Public toggle for the sidebar — exposed on window so the toolbar button
// `<button id="sidebarMenu" onclick="toggleSidebar()">` can reach it.
function toggleSidebar() {
  if (!fileTreeContainer) return;
  const isHidden = fileTreeContainer.classList.contains('is-collapsed') ||
                   fileTreeContainer.offsetWidth < COLLAPSED_THRESHOLD;
  if (isHidden) {
    const last = parseInt(localStorage.getItem(STORAGE_FT_WIDTH), 10);
    const target = (!isNaN(last) && last >= MIN_FILE_TREE_WIDTH) ? last : DEFAULT_OPEN_WIDTH;
    applyFileTreeWidth(target);
    localStorage.setItem(STORAGE_FT_WIDTH, target);
  } else {
    // Persist the current width so we can restore it later.
    const current = fileTreeContainer.offsetWidth;
    if (current >= MIN_FILE_TREE_WIDTH) {
      localStorage.setItem(STORAGE_FT_WIDTH, current);
    }
    applyFileTreeWidth(0);
  }
}

if (typeof window !== 'undefined') {
  window.toggleSidebar = toggleSidebar;
}

// ── Vertical (file tree width) ────────────────────────────────────────────
function setupVerticalResizer() {
  let active = false, startX = 0, startW = 0, raf = null, lastW = 0;

  verticalResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    active = true;
    startX = e.clientX;
    startW = fileTreeContainer.offsetWidth;
    lastW  = startW;
    document.body.classList.add('resizing-vertical');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    if (!active) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      lastW = constrainFileTreeWidth(startW + (e.clientX - startX));
      fileTreeContainer.style.width = lastW + 'px';
    });
  }

  function onUp() {
    if (!active) return;
    active = false;

    // Snap se estiver muito perto do colapso
    let finalW = fileTreeContainer.offsetWidth;
    if (finalW < SNAP_THRESHOLD) finalW = 0;
    applyFileTreeWidth(finalW);

    localStorage.setItem(STORAGE_FT_WIDTH, finalW);
    document.body.classList.remove('resizing-vertical');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (raf) cancelAnimationFrame(raf);
  }

  // Double-click toggles between fully-hidden and the saved/default width.
  verticalResizer.addEventListener('dblclick', () => {
    toggleSidebar();
  });
}

// ── Horizontal (terminal height) ──────────────────────────────────────────
function setupHorizontalResizer() {
  let active = false, startY = 0, startH = 0, raf = null;

  horizontalResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    active = true;
    startY = e.clientY;
    startH = terminalContainer.offsetHeight;
    document.body.classList.add('resizing-horizontal');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    if (!active) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const h = constrainTerminalHeight(startH - (e.clientY - startY));
      terminalContainer.style.height = h + 'px';
    });
  }

  function onUp() {
    if (!active) return;
    active = false;
    localStorage.setItem(STORAGE_TERM_H, terminalContainer.offsetHeight);
    document.body.classList.remove('resizing-horizontal');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (raf) cancelAnimationFrame(raf);
  }
}

// ── Corner handle (both axes simultaneously) ─────────────────────────────
function setupCornerHandle() {
  const corner = document.createElement('div');
  corner.id = 'resize-corner-handle';
  document.body.appendChild(corner);

  function positionCorner() {
    const ftRect   = fileTreeContainer.getBoundingClientRect();
    const termRect = terminalContainer.getBoundingClientRect();
    // Center the (now larger) handle on the resizer junction.
    const size = corner.offsetWidth || 22;
    const half = size / 2;
    corner.style.left = (ftRect.right - half) + 'px';
    corner.style.top  = (termRect.top   - half) + 'px';
  }

  // Hover discovery: lighting up both resizers when the user grazes the
  // junction is the cue that this corner is grabbable.
  corner.addEventListener('mouseenter', () => {
    document.body.classList.add('corner-hovering');
  });
  corner.addEventListener('mouseleave', () => {
    document.body.classList.remove('corner-hovering');
  });

  let active = false, startX = 0, startY = 0, startW = 0, startH = 0, raf = null;

  corner.addEventListener('mousedown', (e) => {
    e.preventDefault();
    active = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = fileTreeContainer.offsetWidth;
    startH = terminalContainer.offsetHeight;
    document.body.classList.add('resizing-corner');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    if (!active) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = constrainFileTreeWidth(startW + (e.clientX - startX));
      const h = constrainTerminalHeight(startH - (e.clientY - startY));
      fileTreeContainer.style.width  = w + 'px';
      terminalContainer.style.height = h + 'px';
      positionCorner();
    });
  }

  function onUp() {
    if (!active) return;
    active = false;
    let finalW = fileTreeContainer.offsetWidth;
    if (finalW < SNAP_THRESHOLD) finalW = 0;
    applyFileTreeWidth(finalW);
    localStorage.setItem(STORAGE_FT_WIDTH, finalW);
    localStorage.setItem(STORAGE_TERM_H, terminalContainer.offsetHeight);
    document.body.classList.remove('resizing-corner');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (raf) cancelAnimationFrame(raf);
  }

  const observer = new MutationObserver(positionCorner);
  if (fileTreeContainer) observer.observe(fileTreeContainer, { attributes: true, attributeFilter: ['style'] });
  if (terminalContainer) observer.observe(terminalContainer, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', positionCorner);
  positionCorner();
}

// ── Init ─────────────────────────────────────────────────────────────────
function initPanelSizes() {
  const savedW = parseInt(localStorage.getItem(STORAGE_FT_WIDTH), 10);
  if (!isNaN(savedW) && fileTreeContainer) {
    applyFileTreeWidth(constrainFileTreeWidth(savedW));
  }
  const savedH = parseInt(localStorage.getItem(STORAGE_TERM_H), 10);
  if (!isNaN(savedH) && terminalContainer) {
    terminalContainer.style.height = constrainTerminalHeight(savedH) + 'px';
  }
}

if (verticalResizer && fileTreeContainer)   setupVerticalResizer();
if (horizontalResizer && terminalContainer) setupHorizontalResizer();
if (fileTreeContainer && terminalContainer) setupCornerHandle();

window.addEventListener('resize', () => {
  if (fileTreeContainer && !fileTreeContainer.classList.contains('is-collapsed')) {
    const w = constrainFileTreeWidth(fileTreeContainer.offsetWidth);
    fileTreeContainer.style.width = w + 'px';
  }
  if (terminalContainer) {
    const h = constrainTerminalHeight(terminalContainer.offsetHeight);
    terminalContainer.style.height = h + 'px';
  }
});

document.addEventListener('DOMContentLoaded', initPanelSizes);

export { constrainFileTreeWidth, constrainTerminalHeight };
