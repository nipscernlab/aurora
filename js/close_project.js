/**
 * @file Manages the logic for closing a project.
 * @author Your Name
 * @date November 12, 2025
 */

// Import the generic dialog module
import { showDialog } from './dialogManager.js'; // Adjust path as necessary
import { TabManager } from './tab_manager.js';

function disableCompileButtons() {
    const buttonIds = [
        /*
        'cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp', 
        'cancel-everything', 'fractalcomp', 'importBtn', 'backupFolderBtn', 
        'projectInfo', 'settings-project' */
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
            statusText.textContent = 'Not Ready';
        }
        
        statusElement.classList.remove('Ready');
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
        
        // 1. Replace native confirm with custom dialog
        const userChoice = await showDialog({
            title: 'Close Project',
            message: 'Are you sure you want to close the current project?',
            buttons: [
                { label: 'Cancel', action: 'cancel', type: 'cancel' },
                { label: 'Close Project', action: 'confirm', type: 'save' } // Using 'save' class for the primary button style
            ]
        });

        if (userChoice !== 'confirm') {
            return;
        }

        closeButton.disabled = true;
        closeButton.style.cursor = 'not-allowed';

        try {
            const result = await window.electronAPI.closeProject();

            if (result.success) {
                // Close all open tabs properly using TabManager
                // This ensures watchers are stopped and UI state is cleared
                const openFiles = Array.from(TabManager.tabs.keys());
                for (const file of openFiles) {
                    await TabManager.closeTab(file);
                }

                clearProjectInterface();
            } else {
                console.error('Failed to close project:', result.error);
                
                // 2. Replace native alert (Error) with custom dialog
                await showDialog({
                    title: 'Error',
                    message: `Could not close the project.<br>Reason: ${result.error}`,
                    buttons: [
                        { label: 'OK', action: 'ok', type: 'cancel' } // Using 'cancel' style for neutral 'OK'
                    ]
                });
            }
        } catch (error) {
            console.error('An unexpected error occurred while closing the project:', error);
            
            // 3. Replace native alert (Exception) with custom dialog
            await showDialog({
                title: 'Unexpected Error',
                message: 'An unexpected error occurred. Please check the console for details.',
                buttons: [
                    { label: 'OK', action: 'ok', type: 'cancel' }
                ]
            });
        } finally {
            closeButton.disabled = false;
            closeButton.style.cursor = 'pointer';
        }
    });
});