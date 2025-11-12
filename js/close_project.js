/**
 * @file Manages the logic for closing a project.
 * @author Your Name
 * @date November 12, 2025
 */

function disableCompileButtons() {
    const buttonIds = [
        'cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp', 
        'cancel-everything', 'fractalcomp', 'settings', 'importBtn', 'backupFolderBtn', 
        'projectInfo', 'settings-project'
    ];

    buttonIds.forEach(id => {
        const button = document.getElementById(id);
        if (button) {
            button.disabled = true;
            button.style.cursor = 'not-allowed';
        }
    });

    const statusElement = document.getElementById('ready');
    if (!statusElement) return;

    statusElement.classList.add('fading');
    statusElement.style.cursor = 'pointer';
    const onFadeOutComplete = () => {
        statusElement.removeEventListener('transitionend', onFadeOutComplete);

        const icon = statusElement.querySelector('i');
        const statusText = document.getElementById('status-text');

        if (icon) {
            icon.classList.remove('fa-plug-circle-check');
            icon.classList.add('fa-plug-circle-xmark');
        }
        if (statusText) {
            statusText.textContent = 'Offline';
        }
        
        statusElement.classList.remove('online');
        statusElement.classList.remove('fading');
    };

    statusElement.addEventListener('transitionend', onFadeOutComplete);
}

function clearProjectInterface() {
    const selectors = {
        '#file-tree': el => el.innerHTML = '',
        '#processor-list': el => el.innerHTML = '',
        '#editor': el => el.innerHTML = '',
        '#project-title': el => el.textContent = 'No project open',
        '#current-spf-name': el => el.textContent = 'No project open'
    };

    for (const selector in selectors) {
        const element = document.querySelector(selector);
        if (element) {
            selectors[selector](element);
        }
    }

    disableCompileButtons();

    const projectActionButtons = document.querySelectorAll('.project-action-button');
    projectActionButtons.forEach(button => {
        button.disabled = true;
        button.style.cursor = 'not-allowed';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const closeButton = document.querySelector('#close-button');

    if (!closeButton) return;

    closeButton.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to close the current project?')) {
            return;
        }

        closeButton.disabled = true;
        closeButton.style.cursor = 'not-allowed';

        try {
            const result = await window.electronAPI.closeProject();

            if (result.success) {
                clearProjectInterface();
            } else {
                console.error('Failed to close project:', result.error);
                alert(`Error: Could not close the project. Reason: ${result.error}`);
            }
        } catch (error) {
            console.error('An unexpected error occurred while closing the project:', error);
            alert('An unexpected error occurred. Please check the console for details.');
        } finally {
            closeButton.disabled = false;
            closeButton.style.cursor = 'pointer';
        }
    });
});