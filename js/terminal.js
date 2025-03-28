// Função para alternar as abas do terminal
function switchTerminal(targetId) {
  // Esconde todas as abas
  const terminalContents = document.querySelectorAll('.terminal-content');
  terminalContents.forEach(content => content.classList.add('hidden'));

  // Remove a classe 'active' de todas as tabs
  const allTabs = document.querySelectorAll('.tab');
  allTabs.forEach(tab => tab.classList.remove('active'));

  // Mostra a aba selecionada
  const targetContent = document.getElementById(targetId);
  targetContent.classList.remove('hidden');

  // Marca a tab correspondente como ativa
  const activeTab = document.querySelector(`.tab[data-terminal="${targetId.replace('terminal-', '')}"]`);
  if (activeTab) {
    activeTab.classList.add('active');
  }
}

// Event listeners para os botões de compilação
document.getElementById('cmmcomp').addEventListener('click', () => {
  switchTerminal('terminal-tcmm');
});

document.getElementById('asmcomp').addEventListener('click', () => {
  switchTerminal('terminal-tasm');
});

document.getElementById('vericomp').addEventListener('click', () => {
  switchTerminal('terminal-tveri');
});

document.getElementById('wavecomp').addEventListener('click', () => {
  switchTerminal('terminal-twave');
});

document.getElementById('prismcomp').addEventListener('click', () => {
  switchTerminal('terminal-tprism');
});


// Event listeners para as tabs do terminal
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', (event) => {
    const targetTerminal = tab.getAttribute('data-terminal');
    switchTerminal(`terminal-${targetTerminal}`);
  });
});
