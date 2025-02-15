// renderer.js
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('aurora-info-modal');
    const infoButton = document.getElementById('info-aurora');
    const closeButton = modal.querySelector('.aurora-modal__close');
  
    // Usando a API exposta pelo preload
    window.electronAPI.getAppInfo().then((info) => {
      document.getElementById('aurora-app-version').textContent = info.appVersion;
      document.getElementById('aurora-electron-version').textContent = info.electronVersion;
      document.getElementById('aurora-chrome-version').textContent = info.chromeVersion;
      document.getElementById('aurora-node-version').textContent = info.nodeVersion;
      document.getElementById('aurora-os-info').textContent = info.osInfo;
    });
  
    // Abrir modal
    infoButton.addEventListener('click', () => {
      modal.classList.remove('aurora-modal--hidden');
    });
  
    // Fechar modal
    closeButton.addEventListener('click', () => {
      modal.classList.add('aurora-modal--hidden');
    });
  
    // Fechar modal ao clicar no overlay
    modal.querySelector('.aurora-modal__overlay').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        modal.classList.add('aurora-modal--hidden');
      }
    });
  });