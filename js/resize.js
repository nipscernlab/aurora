/**
 * Panel Resizer - Smooth, responsive resizing for panels.
 *
 * This module standardizes the logic for vertical and horizontal panel resizing.
 * It uses requestAnimationFrame for smooth visual updates and defers expensive
 * operations like writing to localStorage until the resize operation is complete,
 * preventing UI stuttering.
 */

// Cache DOM elements for better performance.
const verticalResizer = document.querySelector('.resizer-vertical');
const horizontalResizer = document.querySelector('.resizer-horizontal');
const fileTreeContainer = document.querySelector('.file-tree-container');
const terminalContainer = document.querySelector('.terminal-container');
const editorContainer = document.querySelector('.editor-container');
const tabsContainer = document.querySelector('#tabs-container');

// Minimum panel sizes.
const MIN_FILE_TREE_WIDTH = 10; // px
const MIN_TERMINAL_HEIGHT = 40; // px

// --- Inject CSS for cursor styles and to prevent text selection during resize ---
const style = document.createElement('style');
style.textContent = `
  /* Add a class to the body to apply global styles during resize */
  body.resizing, body.resizing * {
    cursor: inherit; /* Ensure all children inherit the resize cursor */
    user-select: none;
    -webkit-user-select: none;
  }
  body.resizing-vertical {
    cursor: col-resize !important;
  }
  body.resizing-horizontal {
    cursor: row-resize !important;
  }
  .resizer-vertical, .resizer-horizontal {
    transition: background-color 0.2s ease;
  }
  .resizer-vertical:hover, .resizer-horizontal:hover {
    background-color: var(--accent-primary, #007acc);
    opacity: 0.6;
  }
  .resizer-vertical {
    cursor: col-resize;
  }
  .resizer-horizontal {
    cursor: row-resize;
    background-color: var(--bg-secondary);
    width: 100%;
    left: 50%; 
    transform: translateX(-50%);
    position: relative;
    border-radius: 16px;
  }
`;
document.head.appendChild(style);


/**
 * Constrains a given width for the file tree within reasonable minimum and maximum bounds.
 * @param {number} width - The target width.
 * @returns {number} The constrained width.
 */
function constrainFileTreeWidth(width) {
  const maxWidth = window.innerWidth * 0.5; // Do not allow file tree to be more than 50% of window
  return Math.max(MIN_FILE_TREE_WIDTH, Math.min(width, maxWidth));
}

/**
 * Constrains a given height for the terminal within reasonable minimum and maximum bounds.
 * @param {number} height - The target height.
 * @returns {number} The constrained height.
 */
function constrainTerminalHeight(height) {
  const maxHeight = window.innerHeight * 0.8; // Do not allow terminal to be more than 80% of window
  return Math.max(MIN_TERMINAL_HEIGHT, Math.min(height, maxHeight));
}

/**
 * Adjusts the editor container's height to fill the available space.
 * This is called after the terminal is resized or the window is resized.
 */
function adjustEditorHeight() {
  if (!editorContainer || !terminalContainer || !tabsContainer) return;
  
  const tabsHeight = tabsContainer.offsetHeight;
  const terminalHeight = terminalContainer.offsetHeight;
  const newEditorHeight = window.innerHeight - terminalHeight - tabsHeight;

  editorContainer.style.height = `${newEditorHeight}px`;
}

/**
 * A unified and optimized function to handle panel resizing logic.
 * @param {object} options - Configuration for the resizer.
 * @param {HTMLElement} options.resizerEl - The resizer handle element.
 * @param {HTMLElement} options.panelEl - The panel element to be resized.
 * @param {'vertical' | 'horizontal'} options.orientation - The resize direction.
 * @param {function(number): number} options.constrainFn - Function to constrain the new size.
 * @param {function(number): void} options.applySizeFn - Function to apply the new size to the DOM.
 * @param {function(number): void} options.persistFn - Function to save the final size.
 * @param {function(): void} [options.onResizeCallback] - Optional callback to run during resize.
 */
function setupSmoothResizer({
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
  let lastConstrainedSize = 0; // Store the last valid size
  let rafId = null;

  const mouseMoveHandler = (e) => {
    if (!isResizing) return;

    // Calculate the difference in mouse position
    const delta = (orientation === 'vertical') ? e.clientX - startPos : e.clientY - startPos;
    
    // For horizontal resizing, a downward drag (positive delta) should decrease height, so we subtract.
    const newSize = (orientation === 'vertical') ? initialSize + delta : initialSize - delta;

    // Use requestAnimationFrame to batch DOM updates for a smoother experience.
    if (rafId) cancelAnimationFrame(rafId);
    
    rafId = requestAnimationFrame(() => {
      lastConstrainedSize = constrainFn(newSize);
      applySizeFn(lastConstrainedSize);
      onResizeCallback(); // Execute any additional visual updates (like adjusting editor height).
    });
  };

  const mouseUpHandler = () => {
    if (!isResizing) return;
    
    // --- The key optimization: persist to localStorage only ONCE on mouse up ---
    persistFn(lastConstrainedSize);

    // Clean up state and event listeners
    isResizing = false;
    document.removeEventListener('mousemove', mouseMoveHandler);
    document.removeEventListener('mouseup', mouseUpHandler);
    document.body.classList.remove('resizing', `resizing-${orientation}`);
    if (rafId) cancelAnimationFrame(rafId);
  };

  resizerEl.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Prevent text selection
    isResizing = true;

    if (orientation === 'vertical') {
      startPos = e.clientX;
      initialSize = panelEl.offsetWidth;
    } else {
      startPos = e.clientY;
      initialSize = panelEl.offsetHeight;
    }
    
    lastConstrainedSize = initialSize;

    document.body.classList.add('resizing', `resizing-${orientation}`);
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
  });
}

/**
 * Initializes panel sizes from localStorage on application start.
 */
function initPanelSizes() {
  const savedFileTreeWidth = parseInt(localStorage.getItem('fileTreeWidth'), 10);
  if (!isNaN(savedFileTreeWidth)) {
    fileTreeContainer.style.width = `${constrainFileTreeWidth(savedFileTreeWidth)}px`;
  }

  const savedTerminalHeight = parseInt(localStorage.getItem('terminalHeight'), 10);
  if (!isNaN(savedTerminalHeight)) {
    terminalContainer.style.height = `${constrainTerminalHeight(savedTerminalHeight)}px`;
  }

  adjustEditorHeight();
}

// --- Setup the resizers ---

// Vertical (File Tree) Resizer
setupSmoothResizer({
  resizerEl: verticalResizer,
  panelEl: fileTreeContainer,
  orientation: 'vertical',
  constrainFn: constrainFileTreeWidth,
  applySizeFn: (width) => { fileTreeContainer.style.width = `${width}px`; },
  persistFn: (width) => { localStorage.setItem('fileTreeWidth', width); },
});

// Horizontal (Terminal) Resizer
setupSmoothResizer({
  resizerEl: horizontalResizer,
  panelEl: terminalContainer,
  orientation: 'horizontal',
  constrainFn: constrainTerminalHeight,
  applySizeFn: (height) => { terminalContainer.style.height = `${height}px`; },
  persistFn: (height) => { localStorage.setItem('terminalHeight', height); },
  onResizeCallback: adjustEditorHeight // Adjust editor height in real-time
});

// --- Global Event Listeners ---

// Handle window resize to ensure panels stay within valid constraints.
window.addEventListener('resize', () => {
  // Constrain file tree width
  const currentFileTreeWidth = fileTreeContainer.offsetWidth;
  const newConstrainedWidth = constrainFileTreeWidth(currentFileTreeWidth);
  if (currentFileTreeWidth !== newConstrainedWidth) {
    fileTreeContainer.style.width = `${newConstrainedWidth}px`;
    localStorage.setItem('fileTreeWidth', newConstrainedWidth);
  }

  // Constrain terminal height
  const currentTerminalHeight = terminalContainer.offsetHeight;
  const newConstrainedHeight = constrainTerminalHeight(currentTerminalHeight);
  if (currentTerminalHeight !== newConstrainedHeight) {
    terminalContainer.style.height = `${newConstrainedHeight}px`;
    localStorage.setItem('terminalHeight', newConstrainedHeight);
  }

  // Always readjust editor height after a window resize
  adjustEditorHeight();
});

// Initialize panels when the document is ready.
document.addEventListener('DOMContentLoaded', initPanelSizes);

// Export functions for potential use in other modules or for testing.
export {
  adjustEditorHeight,
  constrainFileTreeWidth,
  constrainTerminalHeight
};