const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const infoButton = document.getElementById('info-aurora');
    const modal = document.getElementById('modal');
    const closeModal = document.querySelector('.close');
    const appVersionElement = document.getElementById('app-version');

    // Recebe a versão do app enviada pelo main.js
    ipcRenderer.on('app-version', (event, version) => {
        appVersionElement.textContent = version;
    });

    infoButton.addEventListener('click', () => {
        modal.style.display = 'block';
    });

    closeModal.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
});
