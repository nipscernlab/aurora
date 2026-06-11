/**
 * Troca a aba visivel do painel de terminais (tcmm/tasm/tveri/twave/...).
 *
 * Unica implementacao — compilation_flow.js e wave_config_manager.js
 * importam daqui (havia uma copia local em compilation_flow e um
 * window.switchTerminal global; consolidado em 2026-06).
 */
export function switchTerminal(targetId) {
  const targetContent = document.getElementById(targetId);

  // Verificacao de seguranca: se o terminal nao existir no HTML, bail
  // antes de esconder os outros — senao o painel inteiro fica em branco.
  if (!targetContent) {
    console.error(`Erro: O elemento terminal com ID "${targetId}" nao foi encontrado no HTML.`);
    return;
  }

  // Hide all terminal content sections
  document.querySelectorAll('.terminal-content').forEach(content => content.classList.add('hidden'));

  // Remove the 'active' class from all tabs
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));

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

// Compilation buttons focus the terminal their output lands in.
document.getElementById('cmmcomp')?.addEventListener('click', () => {
  switchTerminal('terminal-tcmm');
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

// Terminal tab strip.
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTerminal = tab.getAttribute('data-terminal');
    if (targetTerminal) {
      switchTerminal(`terminal-${targetTerminal}`);
    }
  });
});
