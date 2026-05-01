// ui_components.js

class UIComponentsManager {
    initialize() {
        this.initInfoBox();
        this.initVerilogBlockModal();
    }

    initInfoBox() {
        const showInfoButton = document.getElementById('showInfo');
        const infoBox = document.getElementById('infoBox');
        const closeInfoButton = infoBox?.querySelector('.info-box-close');

        if (showInfoButton && infoBox && closeInfoButton) {
            showInfoButton.addEventListener('click', () => infoBox.classList.add('visible'));
            closeInfoButton.addEventListener('click', () => infoBox.classList.remove('visible'));
        }
    }

    initVerilogBlockModal() {
        const verilogBlockBtn = document.getElementById('verilog-block');
        const modal = document.getElementById('verilog-block-modal');
        const closeModalBtn = document.getElementById('close-modal');

        if (!verilogBlockBtn || !modal || !closeModalBtn) return;

        const openModal = () => {
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('show'), 10);
        };

        const closeModal = () => {
            modal.classList.remove('show');
            setTimeout(() => modal.style.display = 'none', 300);
        };

        verilogBlockBtn.addEventListener('click', openModal);
        closeModalBtn.addEventListener('click', closeModal);
        window.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
        });
    }
}

const uiComponentsManager = new UIComponentsManager();
export { uiComponentsManager };