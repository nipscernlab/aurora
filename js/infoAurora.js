// renderer.js
// Wait for the DOM to fully load before executing the script
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('aurora-info-modal');
    const infoButton = document.getElementById('info-aurora');
    //const closeButton = modal.querySelector('.aurora-modal__close');

    // Fetch application information using the exposed Electron API
    window.electronAPI.getAppInfo().then((info) => {
        document.getElementById('aurora-app-version').textContent = info.appVersion;
        document.getElementById('aurora-electron-version').textContent = info.electronVersion;
        document.getElementById('aurora-chrome-version').textContent = info.chromeVersion;
        document.getElementById('aurora-node-version').textContent = info.nodeVersion;
        document.getElementById('aurora-os-info').textContent = info.osInfo;
    });

    // Open the modal when the info button is clicked
    infoButton.addEventListener('click', () => {
        modal.classList.remove('aurora-modal--hidden');
    });

    // Close the modal when the close button is clicked
    closeButton.addEventListener('click', () => {
        modal.classList.add('aurora-modal--hidden');
    });

    // Close the modal when clicking on the overlay
    modal.querySelector('.aurora-modal__overlay').addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
            modal.classList.add('aurora-modal--hidden');
        }
    });

});