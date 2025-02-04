
const verticalResizer = document.querySelector('.resizer-vertical');
const horizontalResizer = document.querySelector('.resizer-horizontal');
const fileTreeContainer = document.querySelector('.file-tree-container');
const terminalContainer = document.querySelector('.terminal-container');
const editorContainer = document.querySelector('.editor-container');

// Redimensionamento horizontal (file-tree)
verticalResizer.addEventListener('mousedown', (event) => {
  event.preventDefault();
  
  document.addEventListener('mousemove', resizeFileTree);
  document.addEventListener('mouseup', stopResize);
});

function resizeFileTree(event) {
  fileTreeContainer.style.width = `${event.clientX}px`;
}

function stopResize() {
  document.removeEventListener('mousemove', resizeFileTree);
  document.removeEventListener('mouseup', stopResize);
}

// Redimensionamento vertical (terminal)
horizontalResizer.addEventListener('mousedown', (event) => {
  event.preventDefault();
  
  document.addEventListener('mousemove', resizeTerminal);
  document.addEventListener('mouseup', stopTerminalResize);
});

function resizeTerminal(event) {
  // Altura do terminal com ajuste para abas e outros elementos
  const tabsHeight = document.querySelector('#tabs-container').offsetHeight;
  const terminalHeight = window.innerHeight - event.clientY;

  // Aplica o novo tamanho ao terminal e ajusta o editor
  terminalContainer.style.height = `${terminalHeight}px`;
  editorContainer.style.height = `${window.innerHeight - terminalHeight - tabsHeight}px`; // Subtrai abas
}

window.addEventListener('resize', () => {
  const tabsHeight = document.querySelector('#tabs-container').offsetHeight;
  const terminalHeight = terminalContainer.offsetHeight;

  editorContainer.style.height = `${window.innerHeight - terminalHeight - tabsHeight}px`;
});



function stopTerminalResize() {
  document.removeEventListener('mousemove', resizeTerminal);
  document.removeEventListener('mouseup', stopTerminalResize);
}
