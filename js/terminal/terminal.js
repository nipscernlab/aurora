// Function to switch between terminal tabs
// Function to switch between terminal tabs
function switchTerminal(targetId) {
  const targetContent = document.getElementById(targetId);

  // Verificacao de seguranca: Se o terminal nao existir no HTML, para a execucao
  if (!targetContent) {
    console.error(`Erro: O elemento terminal com ID "${targetId}" nao foi encontrado no HTML.`);
    return;
  }

  // Hide all terminal content sections
  const terminalContents = document.querySelectorAll('.terminal-content');
  terminalContents.forEach(content => content.classList.add('hidden'));

  // Remove the 'active' class from all tabs
  const allTabs = document.querySelectorAll('.tab');
  allTabs.forEach(tab => tab.classList.remove('active'));

  // Show the selected terminal content
  targetContent.classList.remove('hidden');

  // Mark the corresponding tab as active
  // O replace remove o prefixo 'terminal-' para achar o data-terminal correto
  const dataTerm = targetId.replace('terminal-', '');
  const activeTab = document.querySelector(`.tab[data-terminal="${dataTerm}"]`);
  
  if (activeTab) {
    activeTab.classList.add('active');
  }
}

// Event listeners for compilation buttons
document.getElementById('cmmcomp')?.addEventListener('click', () => {
  switchTerminal('terminal-tcmm');
});

document.getElementById('asmcomp')?.addEventListener('click', () => {
  switchTerminal('terminal-tasm');
});

document.getElementById('vericomp')?.addEventListener('click', () => {
  switchTerminal('terminal-tveri');
});

document.getElementById('wavecomp')?.addEventListener('click', () => {
  switchTerminal('terminal-twave');
});

document.getElementById('prismcomp')?.addEventListener('click', () => {
  switchTerminal('terminal-tveri'); 
});

// Event listeners for terminal tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', (event) => {
    const targetTerminal = tab.getAttribute('data-terminal');
    if (targetTerminal) {
        switchTerminal(`terminal-${targetTerminal}`);
    }
  });
});
// Event listeners for compilation buttons
document.getElementById('cmmcomp').addEventListener('click', () => {
  switchTerminal('terminal-tcmm'); // Switch to the CMM terminal
});

document.getElementById('asmcomp').addEventListener('click', () => {
  switchTerminal('terminal-tasm'); // Switch to the ASM terminal
});

document.getElementById('vericomp').addEventListener('click', () => {
  switchTerminal('terminal-tveri'); // Switch to the Verilog terminal
});

document.getElementById('wavecomp').addEventListener('click', () => {
  switchTerminal('terminal-twave'); // Switch to the Wave terminal
});

document.getElementById('prismcomp').addEventListener('click', () => {
  switchTerminal('terminal-tveri'); // Switch to the PRISM terminal
});

// Event listeners for terminal tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', (event) => {
    const targetTerminal = tab.getAttribute('data-terminal');
    switchTerminal(`terminal-${targetTerminal}`); // Switch to the corresponding terminal
  });
});
