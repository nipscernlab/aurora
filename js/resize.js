const verticalResizer = document.querySelector('.resizer-vertical');
const horizontalResizer = document.querySelector('.resizer-horizontal');
const fileTreeContainer = document.querySelector('.file-tree-container');
const terminalContainer = document.querySelector('.terminal-container');
const editorContainer = document.querySelector('.editor-container');

// Handle horizontal resizing for the file tree panel
verticalResizer.addEventListener('mousedown', (event) => {
  event.preventDefault(); // Prevent default behavior to avoid text selection
  document.addEventListener('mousemove', resizeFileTree);
  document.addEventListener('mouseup', stopResize);
});

// Adjust the width of the file tree panel dynamically
function resizeFileTree(event) {
  fileTreeContainer.style.width = `${event.clientX}px`;
}

// Stop resizing the file tree panel
function stopResize() {
  document.removeEventListener('mousemove', resizeFileTree);
  document.removeEventListener('mouseup', stopResize);
}

// Handle vertical resizing for the terminal panel
horizontalResizer.addEventListener('mousedown', (event) => {
  event.preventDefault(); // Prevent default behavior to avoid text selection
  document.addEventListener('mousemove', resizeTerminal);
  document.addEventListener('mouseup', stopTerminalResize);
});

// Adjust the height of the terminal panel dynamically
function resizeTerminal(event) {
  const tabsHeight = document.querySelector('#tabs-container').offsetHeight; // Height of the tabs
  const terminalHeight = window.innerHeight - event.clientY; // Calculate new terminal height

  terminalContainer.style.height = `${terminalHeight}px`; // Apply new height to the terminal
  editorContainer.style.height = `${window.innerHeight - terminalHeight - tabsHeight}px`; // Adjust editor height
}

// Adjust the editor height when the window is resized
window.addEventListener('resize', () => {
  const tabsHeight = document.querySelector('#tabs-container').offsetHeight; // Height of the tabs
  const terminalHeight = terminalContainer.offsetHeight; // Current terminal height

  editorContainer.style.height = `${window.innerHeight - terminalHeight - tabsHeight}px`; // Adjust editor height
});

// Stop resizing the terminal panel
function stopTerminalResize() {
  document.removeEventListener('mousemove', resizeTerminal);
  document.removeEventListener('mouseup', stopTerminalResize);
}
