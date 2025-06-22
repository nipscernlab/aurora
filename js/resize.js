/**
 * Panel Resizer - Smooth, responsive resizing for panels in an Electron app
 * 
 * This module standardizes the logic for vertical and horizontal panel resizing.
 * It sets up resizers that constrain sizes within bounds and persist sizes in localStorage.
 */

// Cache DOM elements for better performance
const verticalResizer = document.querySelector('.resizer-vertical');
const horizontalResizer = document.querySelector('.resizer-horizontal');
const fileTreeContainer = document.querySelector('.file-tree-container');
const terminalContainer = document.querySelector('.terminal-container');
const editorContainer = document.querySelector('.editor-container');
const tabsContainer = document.querySelector('#tabs-container');

// State and constants
let rafIdVertical = null;
let rafIdHorizontal = null;

// Minimum sizes
const MIN_FILE_TREE_WIDTH = 15; // px
const MIN_TERMINAL_HEIGHT = 40; // px

// CSS for cursor and no-select during resizing
document.documentElement.style.setProperty('--cursor-resizing-vertical', 'col-resize');
document.documentElement.style.setProperty('--cursor-resizing-horizontal', 'row-resize');

const style = document.createElement('style');
style.textContent = `
  body.resizing {
    cursor: inherit;
    user-select: none;
    -webkit-user-select: none;
  }
  body.resizing-vertical {
    cursor: var(--cursor-resizing-vertical) !important;
  }
  body.resizing-horizontal {
    cursor: var(--cursor-resizing-horizontal) !important;
  }
  .resizer-vertical, .resizer-horizontal {
    transition: background-color 0.2s ease;
  }
  .resizer-vertical:hover, .resizer-horizontal:hover {
    background-color: var(--accent-primary, #007acc);
    opacity: 0.6;
  }
  .resizer-vertical {
    cursor: var(--cursor-resizing-vertical);
  }
  .resizer-horizontal {
    cursor: var(--cursor-resizing-horizontal);
  }
`;
document.head.appendChild(style);

/**
 * Initialize saved panel sizes on load.
 * Loads file tree width and terminal height from localStorage if present.
 * Also adjusts editor height accordingly.
 */
function initPanelSizes() {
  const savedFileTreeWidth = parseInt(localStorage.getItem('fileTreeWidth'), 10);
  const savedTerminalHeight = parseInt(localStorage.getItem('terminalHeight'), 10);

  if (!isNaN(savedFileTreeWidth)) {
    fileTreeContainer.style.width = `${constrainFileTreeWidth(savedFileTreeWidth)}px`;
  }

  if (!isNaN(savedTerminalHeight)) {
    terminalContainer.style.height = `${constrainTerminalHeight(savedTerminalHeight)}px`;
  }

  adjustEditorHeight();
}

/**
 * Adjust the editor container height based on window height, tabs height, and terminal height.
 */
function adjustEditorHeight() {
  const tabsHeight = tabsContainer?.offsetHeight || 0;
  const terminalHeight = terminalContainer?.offsetHeight || 0;
  if (editorContainer) {
    const newEditorHeight = window.innerHeight - terminalHeight - tabsHeight;
    editorContainer.style.height = `${newEditorHeight}px`;
  }
}

/**
 * Constrain file tree width within min and max bounds.
 * @param {number} width 
 * @returns {number}
 */
function constrainFileTreeWidth(width) {
  const max = window.innerWidth * 0.5;
  return Math.max(MIN_FILE_TREE_WIDTH, Math.min(width, max));
}

/**
 * Constrain terminal height within min and max bounds.
 * @param {number} height 
 * @returns {number}
 */
function constrainTerminalHeight(height) {
  const max = window.innerHeight * 0.8;
  return Math.max(MIN_TERMINAL_HEIGHT, Math.min(height, max));
}


function setupResizer({
  resizerEl,
  panelEl,
  orientation,
  constrainFn,
  applySizeFn,
  persistFn,
  onResizeCallback = () => {}
}) {
  let isResizing = false;
  let startPos = 0;
  let initialSize = 0;
  let rafIdRef = null;

  const mouseMoveHandler = (e) => {
    if (!isResizing) return;
    let delta;
    let newSize;

    if (orientation === 'vertical') {
      delta = e.clientX - startPos;
      newSize = initialSize + delta;
    } else { // horizontal
      delta = e.clientY - startPos;
      newSize = initialSize - delta;
    }

    // Constrain and animate with requestAnimationFrame
    if (rafIdRef) cancelAnimationFrame(rafIdRef);
    rafIdRef = requestAnimationFrame(() => {
      const constrained = constrainFn(newSize);
      applySizeFn(constrained);
      persistFn(constrained);
      onResizeCallback();
      rafIdRef = null;
    });
  };

  const mouseUpHandler = () => {
    if (!isResizing) return;
    isResizing = false;
    document.removeEventListener('mousemove', mouseMoveHandler);
    document.removeEventListener('mouseup', mouseUpHandler);
    document.body.classList.remove('resizing', orientation === 'vertical' ? 'resizing-vertical' : 'resizing-horizontal');
  };

  resizerEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isResizing = true;
    if (orientation === 'vertical') {
      startPos = e.clientX;
      initialSize = panelEl.offsetWidth;
    } else {
      startPos = e.clientY;
      initialSize = panelEl.offsetHeight;
    }
    document.body.classList.add('resizing', orientation === 'vertical' ? 'resizing-vertical' : 'resizing-horizontal');
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
  });
}

// Setup vertical (file tree) resizer
setupResizer({
  resizerEl: verticalResizer,
  panelEl: fileTreeContainer,
  orientation: 'vertical',
  constrainFn: constrainFileTreeWidth,
  applySizeFn: (w) => { fileTreeContainer.style.width = `${w}px`; },
  persistFn: (w) => { localStorage.setItem('fileTreeWidth', w); },
  onResizeCallback: () => { /* no extra callback needed for width */ }
});

// Setup horizontal (terminal) resizer
setupResizer({
  resizerEl: horizontalResizer,
  panelEl: terminalContainer,
  orientation: 'horizontal',
  constrainFn: constrainTerminalHeight,
  applySizeFn: (h) => { terminalContainer.style.height = `${h}px`; },
  persistFn: (h) => { localStorage.setItem('terminalHeight', h); },
  onResizeCallback: adjustEditorHeight
});

// Handle window resize: update constraints and adjust panels if out of bounds
window.addEventListener('resize', () => {
  // Re-adjust editor height
  adjustEditorHeight();

  // Constrain file tree width if needed
  const currentFileTreeWidth = fileTreeContainer.offsetWidth;
  const constrainedWidth = constrainFileTreeWidth(currentFileTreeWidth);
  if (currentFileTreeWidth !== constrainedWidth) {
    fileTreeContainer.style.width = `${constrainedWidth}px`;
    localStorage.setItem('fileTreeWidth', constrainedWidth);
  }

  // Constrain terminal height if needed
  const currentTerminalHeight = terminalContainer.offsetHeight;
  const constrainedHeight = constrainTerminalHeight(currentTerminalHeight);
  if (currentTerminalHeight !== constrainedHeight) {
    terminalContainer.style.height = `${constrainedHeight}px`;
    localStorage.setItem('terminalHeight', constrainedHeight);
    adjustEditorHeight();
  }
});

// Initialize panels when DOM is loaded
document.addEventListener('DOMContentLoaded', initPanelSizes);

// Export functions if needed elsewhere
export {
  adjustEditorHeight,
  // Expose constrain and apply functions if needed for tests or other modules
  constrainFileTreeWidth,
  constrainTerminalHeight
};
