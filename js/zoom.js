

// Este script é executado no ambiente do navegador (renderizador)
window.addEventListener('keydown', (event) => {
  // Verifica se a tecla Ctrl (Windows/Linux) ou Command (macOS) está pressionada
  if (event.ctrlKey || event.metaKey) {
    let handled = false;

    switch (event.key) {
      case '+':
      case '=': // O sinal de '+' geralmente requer Shift, então pegamos '=' também
        // Chama a função exposta pelo preload.js
        window.electronAPI.zoomIn();
        handled = true;
        break;

      case '-':
        window.electronAPI.zoomOut();
        handled = true;
        break;

      case '0':
        window.electronAPI.zoomReset();
        handled = true;
        break;
    }

    // Impede a ação padrão do navegador para esses atalhos
    if (handled) {
      event.preventDefault();
    }
  }
});