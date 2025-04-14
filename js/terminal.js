// Function to switch between terminal tabs
function switchTerminal(targetId) {
  // Hide all terminal content sections
  const terminalContents = document.querySelectorAll('.terminal-content');
  terminalContents.forEach(content => content.classList.add('hidden'));

  // Remove the 'active' class from all tabs
  const allTabs = document.querySelectorAll('.tab');
  allTabs.forEach(tab => tab.classList.remove('active'));

  // Show the selected terminal content
  const targetContent = document.getElementById(targetId);
  targetContent.classList.remove('hidden');

  // Mark the corresponding tab as active
  const activeTab = document.querySelector(`.tab[data-terminal="${targetId.replace('terminal-', '')}"]`);
  if (activeTab) {
    activeTab.classList.add('active');
  }
}

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
  switchTerminal('terminal-tprism'); // Switch to the PRISM terminal
});

// Event listeners for terminal tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', (event) => {
    const targetTerminal = tab.getAttribute('data-terminal');
    switchTerminal(`terminal-${targetTerminal}`); // Switch to the corresponding terminal
  });
});
