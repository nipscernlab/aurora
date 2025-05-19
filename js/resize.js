/**
 * Panel Resizer - Smooth, responsive resizing for panels in an Electron app
 */

// Cache DOM elements for better performance
const verticalResizer = document.querySelector('.resizer-vertical');
const horizontalResizer = document.querySelector('.resizer-horizontal');
const fileTreeContainer = document.querySelector('.file-tree-container');
const terminalContainer = document.querySelector('.terminal-container');
const editorContainer = document.querySelector('.editor-container');
const tabsContainer = document.querySelector('#tabs-container');

// State variables to help improve responsiveness
let isFileTreeResizing = false;
let isTerminalResizing = false;
let lastX = 0;
let lastY = 0;
let rafId = null;
let minFileTreeWidth = 100; // Minimum width for file tree
let maxFileTreeWidth = window.innerWidth * 0.5; // Maximum width for file tree
let minTerminalHeight = 50; // Minimum height for terminal
let maxTerminalHeight = window.innerHeight * 0.8; // Maximum height for terminal
let initialFileTreeWidth = 0;
let initialTerminalHeight = 0;

// Apply some initial CSS to improve dragging experience
document.documentElement.style.setProperty('--cursor-resizing-vertical', 'col-resize');
document.documentElement.style.setProperty('--cursor-resizing-horizontal', 'row-resize');

// Apply CSS to prevent unwanted text selection during resize
const style = document.createElement('style');
style.textContent = `
  body.resizing {
    cursor: inherit;
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
  }
`;
document.head.appendChild(style);

// Initialize panel sizes - should be called on load
function initPanelSizes() {
  const savedFileTreeWidth = localStorage.getItem('fileTreeWidth');
  const savedTerminalHeight = localStorage.getItem('terminalHeight');
  
  // Apply saved sizes if available
  if (savedFileTreeWidth) {
    fileTreeContainer.style.width = `${savedFileTreeWidth}px`;
  }
  
  if (savedTerminalHeight) {
    terminalContainer.style.height = `${savedTerminalHeight}px`;
  }
  
  // Adjust editor height 
  adjustEditorHeight();
}

// Calculate and set the proper editor height
function adjustEditorHeight() {
  const tabsHeight = tabsContainer?.offsetHeight || 0;
  const terminalHeight = terminalContainer?.offsetHeight || 0;
  
  if (editorContainer) {
    editorContainer.style.height = `${window.innerHeight - terminalHeight - tabsHeight}px`;
  }
}

// Use requestAnimationFrame for smoother resizing of file tree
function resizeFileTreeAnimated(newWidth) {
  // Constrain width within min and max bounds
  newWidth = Math.max(minFileTreeWidth, Math.min(newWidth, maxFileTreeWidth));
  
  if (fileTreeContainer) {
    fileTreeContainer.style.width = `${newWidth}px`;
  }
  
  // Save state for future page loads
  localStorage.setItem('fileTreeWidth', newWidth);
}

// Use requestAnimationFrame for smoother resizing of terminal
function resizeTerminalAnimated(newHeight) {
  // Constrain height within min and max bounds
  newHeight = Math.max(minTerminalHeight, Math.min(newHeight, maxTerminalHeight));
  
  if (terminalContainer) {
    terminalContainer.style.height = `${newHeight}px`;
  }
  
  // Always adjust editor height when terminal changes
  adjustEditorHeight();
  
  // Save state for future page loads
  localStorage.setItem('terminalHeight', newHeight);
}

// Handle mousedown on vertical resizer
verticalResizer.addEventListener('mousedown', (e) => {
  e.preventDefault();
  isFileTreeResizing = true;
  lastX = e.clientX;
  initialFileTreeWidth = fileTreeContainer.offsetWidth;
  
  // Add resizing class to body to handle cursor everywhere on the screen
  document.body.classList.add('resizing', 'resizing-vertical');
  
  document.addEventListener('mousemove', handleFileTreeResize);
  document.addEventListener('mouseup', stopFileTreeResize);
});

// Handle mousemove for file tree resizing, using RAF for smoother rendering
function handleFileTreeResize(e) {
  if (!isFileTreeResizing) return;
  
  // Calculate delta (change in mouse position)
  const deltaX = e.clientX - lastX;
  const newWidth = initialFileTreeWidth + deltaX;
  
  // Use requestAnimationFrame to smoothly update UI
  if (rafId) cancelAnimationFrame(rafId);
  
  rafId = requestAnimationFrame(() => {
    resizeFileTreeAnimated(newWidth);
    rafId = null;
  });
}

// Handle stopping file tree resize
function stopFileTreeResize() {
  isFileTreeResizing = false;
  document.removeEventListener('mousemove', handleFileTreeResize);
  document.removeEventListener('mouseup', stopFileTreeResize);
  document.body.classList.remove('resizing', 'resizing-vertical');
}

// Handle mousedown on horizontal resizer
horizontalResizer.addEventListener('mousedown', (e) => {
  e.preventDefault();
  isTerminalResizing = true;
  lastY = e.clientY;
  initialTerminalHeight = terminalContainer.offsetHeight;
  
  // Add resizing class to body
  document.body.classList.add('resizing', 'resizing-horizontal');
  
  document.addEventListener('mousemove', handleTerminalResize);
  document.addEventListener('mouseup', stopTerminalResize);
});

// Handle mousemove for terminal resizing, using RAF for smoother rendering
function handleTerminalResize(e) {
  if (!isTerminalResizing) return;
  
  // Calculate new height based on distance from bottom
  const newHeight = window.innerHeight - e.clientY;
  
  // Use requestAnimationFrame to smoothly update UI
  if (rafId) cancelAnimationFrame(rafId);
  
  rafId = requestAnimationFrame(() => {
    resizeTerminalAnimated(newHeight);
    rafId = null;
  });
}

// Handle stopping terminal resize
function stopTerminalResize() {
  isTerminalResizing = false;
  document.removeEventListener('mousemove', handleTerminalResize);
  document.removeEventListener('mouseup', stopTerminalResize);
  document.body.classList.remove('resizing', 'resizing-horizontal');
}

// Handle window resize - update max dimensions and adjust panels
window.addEventListener('resize', () => {
  // Update maximum sizes based on new window dimensions
  maxFileTreeWidth = window.innerWidth * 0.5;
  maxTerminalHeight = window.innerHeight * 0.8;
  
  // Re-adjust editor height 
  adjustEditorHeight();
  
  // Check if panel sizes are still within bounds
  const currentFileTreeWidth = fileTreeContainer.offsetWidth;
  const currentTerminalHeight = terminalContainer.offsetHeight;
  
  // Adjust file tree if needed
  if (currentFileTreeWidth > maxFileTreeWidth) {
    resizeFileTreeAnimated(maxFileTreeWidth);
  }
  
  // Adjust terminal if needed
  if (currentTerminalHeight > maxTerminalHeight) {
    resizeTerminalAnimated(maxTerminalHeight);
  }
});

// Initialize panels when DOM is loaded
document.addEventListener('DOMContentLoaded', initPanelSizes);

// Export functions for potential use in other modules
export {
  adjustEditorHeight,
  resizeFileTreeAnimated,
  resizeTerminalAnimated
};