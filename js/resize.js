/**
 * Panel Resizer - Smooth resizing for file tree (vertical) and terminal (horizontal).
 * Also supports simultaneous corner resize by dragging the intersection point.
 */

const verticalResizer = document.querySelector('.resizer-vertical');
const horizontalResizer = document.querySelector('.resizer-horizontal');
const fileTreeContainer = document.querySelector('.file-tree-container');
const terminalContainer = document.querySelector('.terminal-container');

const MIN_FILE_TREE_WIDTH = 10;
const MIN_TERMINAL_HEIGHT = 30;
const MAX_FILE_TREE_RATIO = 0.5;

// Inject global resize CSS
const style = document.createElement('style');
style.textContent = `
  body.resizing-vertical { cursor: col-resize !important; }
  body.resizing-vertical * { cursor: col-resize !important; user-select: none !important; }
  body.resizing-horizontal { cursor: row-resize !important; }
  body.resizing-horizontal * { cursor: row-resize !important; user-select: none !important; }
  body.resizing-corner { cursor: nwse-resize !important; }
  body.resizing-corner * { cursor: nwse-resize !important; user-select: none !important; }

  .resizer-vertical {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 5px;
    cursor: col-resize;
    background: transparent;
    transition: background-color 0.15s ease;
    z-index: 10;
  }
  .resizer-vertical:hover { background-color: var(--accent-primary); opacity: 0.7; }

  .resizer-horizontal {
    height: 5px;
    cursor: row-resize;
    background: transparent;
    transition: background-color 0.15s ease;
    position: relative;
    z-index: 10;
    width: 100%;
  }
  .resizer-horizontal:hover { background-color: var(--accent-primary); opacity: 0.7; }

  /* Corner handle at the intersection */
  #resize-corner-handle {
    position: fixed;
    width: 14px;
    height: 14px;
    background: transparent;
    cursor: nwse-resize;
    z-index: 100;
    border-radius: 0;
  }
  #resize-corner-handle:hover {
    background: var(--accent-primary);
    opacity: 0.5;
  }
`;
document.head.appendChild(style);

function clamp(val, min, max) { return Math.max(min, Math.min(val, max)); }

function constrainFileTreeWidth(w) {
  return clamp(w, MIN_FILE_TREE_WIDTH, window.innerWidth * MAX_FILE_TREE_RATIO);
}
function getMaxTerminalHeight() {
  const toolbar = document.querySelector('.toolbar');
  const statusBar = document.querySelector('.status-bar');
  const toolbarH = toolbar ? toolbar.offsetHeight : 44;
  const statusH = statusBar ? statusBar.offsetHeight : 22;
  const resizerH = 6; // resizer bar itself
  return window.innerHeight - toolbarH - statusH - resizerH;
}
function constrainTerminalHeight(h) {
  return clamp(h, MIN_TERMINAL_HEIGHT, getMaxTerminalHeight());
}

// ── Vertical (file tree width) ────────────────────────────────────────────────
function setupVerticalResizer() {
  let active = false, startX = 0, startW = 0, raf = null;

  verticalResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    active = true;
    startX = e.clientX;
    startW = fileTreeContainer.offsetWidth;
    document.body.classList.add('resizing-vertical');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    if (!active) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = constrainFileTreeWidth(startW + (e.clientX - startX));
      fileTreeContainer.style.width = w + 'px';
    });
  }

  function onUp() {
    if (!active) return;
    active = false;
    localStorage.setItem('fileTreeWidth', fileTreeContainer.offsetWidth);
    document.body.classList.remove('resizing-vertical');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (raf) cancelAnimationFrame(raf);
  }
}

// ── Horizontal (terminal height) ──────────────────────────────────────────────
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
    localStorage.setItem('terminalHeight', terminalContainer.offsetHeight);
    document.body.classList.remove('resizing-horizontal');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (raf) cancelAnimationFrame(raf);
  }
}

// ── Corner handle (both axes simultaneously) ─────────────────────────────────
function setupCornerHandle() {
  const corner = document.createElement('div');
  corner.id = 'resize-corner-handle';
  document.body.appendChild(corner);

  function positionCorner() {
    const ftRect = fileTreeContainer.getBoundingClientRect();
    const termRect = terminalContainer.getBoundingClientRect();
    corner.style.left = (ftRect.right - 7) + 'px';
    corner.style.top = (termRect.top - 7) + 'px';
  }

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
      fileTreeContainer.style.width = w + 'px';
      terminalContainer.style.height = h + 'px';
      positionCorner();
    });
  }

  function onUp() {
    if (!active) return;
    active = false;
    localStorage.setItem('fileTreeWidth', fileTreeContainer.offsetWidth);
    localStorage.setItem('terminalHeight', terminalContainer.offsetHeight);
    document.body.classList.remove('resizing-corner');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (raf) cancelAnimationFrame(raf);
  }

  // Update corner position on any resize
  const observer = new MutationObserver(positionCorner);
  if (fileTreeContainer) observer.observe(fileTreeContainer, { attributes: true, attributeFilter: ['style'] });
  if (terminalContainer) observer.observe(terminalContainer, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', positionCorner);
  positionCorner();
}

// ── Init ─────────────────────────────────────────────────────────────────────
function initPanelSizes() {
  const savedW = parseInt(localStorage.getItem('fileTreeWidth'), 10);
  if (!isNaN(savedW) && fileTreeContainer) {
    fileTreeContainer.style.width = constrainFileTreeWidth(savedW) + 'px';
  }
  const savedH = parseInt(localStorage.getItem('terminalHeight'), 10);
  if (!isNaN(savedH) && terminalContainer) {
    terminalContainer.style.height = constrainTerminalHeight(savedH) + 'px';
  }
}

if (verticalResizer && fileTreeContainer) setupVerticalResizer();
if (horizontalResizer && terminalContainer) setupHorizontalResizer();
if (fileTreeContainer && terminalContainer) setupCornerHandle();

window.addEventListener('resize', () => {
  if (fileTreeContainer) {
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
