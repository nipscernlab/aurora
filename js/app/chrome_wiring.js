// Fiacao do cromo da janela: era o <script> inline no fim do index.html e
// saiu do HTML para a CSP do aplicativo poder viver sem 'unsafe-inline' em
// script-src. Modulo deferido: roda depois do parse, com todos os elementos
// presentes, e antes de DOMContentLoaded, entao os listeners chegam a tempo.
//
// O bloco inline carregava tambem quatro funcoes globais (activateButton,
// activateTerminal, open/closeAuroraAboutModal) e dois lacos de hover sobre
// .keyword/.terminal-keyword: nada disso tinha chamador nem elemento no
// repositorio — codigo morto de uma tela de boas-vindas antiga — e ficou para
// tras na extracao.

document.getElementById('reload-everything-terminal')?.addEventListener('click', () => {
  if (window.electronAPI?.reloadApp) window.electronAPI.reloadApp();
});

document.addEventListener('DOMContentLoaded', () => {
  const buttons = ['newProjectBtn', 'newProjectBtnWelcome', 'processorHub', 'openProjectBtn', 'openProjectBtnWelcome', 'allcomp', 'cancel-everything', 'clear-terminal', 'aiButton', 'sidebarMenu'];
  buttons.forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.classList.add('button-highlight');
  });
  document.getElementById('open-folder-button')?.classList.add('button-highlight');

  const terminals = ['tcmm', 'tasm', 'tveri', 'twave'];
  terminals.forEach((id) => {
    const terminal = document.querySelector(`[data-terminal="${id}"]`);
    if (terminal) terminal.classList.add('button-highlight');
  });
});

/* ----------------------------------------------------------------------
 *  Custom title bar wiring
 *  - traffic-light buttons: minimize / maximize-toggle / close via IPC
 *  - double-click on toolbar drag area: maximize-toggle
 *  - listen to window state to swap the [□] / [❐] glyph
 * ---------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const api = window.electronAPI;
  if (!api) return;

  document.getElementById('win-min')?.addEventListener('click', () => api.windowMinimize?.());
  document.getElementById('win-max')?.addEventListener('click', () => api.windowMaximizeToggle?.());
  document.getElementById('win-close')?.addEventListener('click', () => api.windowClose?.());

  const titlebar = document.getElementById('custom-titlebar');
  if (titlebar) {
    titlebar.addEventListener('dblclick', (e) => {
      // Only trigger when the dblclick happened on the drag region itself,
      // not on a nested button/select/etc.
      if (e.target.closest('button, input, select, textarea, label, .glyph, .window-dot')) return;
      api.windowMaximizeToggle?.();
    });
  }

  function applyMaximizedClass(state) {
    document.body.classList.toggle('window-maximized', !!state?.isMaximized);
    document.body.classList.toggle('window-fullscreen', !!state?.isFullScreen);
  }

  if (api.windowGetState) {
    api.windowGetState().then(applyMaximizedClass).catch(() => {});
  }
  api.onWindowState?.(applyMaximizedClass);
});
