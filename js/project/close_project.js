/**
 * @file Manages the logic for closing a project.
 * @author Your Name
 * @date November 12, 2025
 */

import { electronAPI } from '../app/electron_api.js';
import { showDialog } from '../ui/dialog_manager.js';
import { TabManager } from '../tabs/tab_manager.js';
import { ProjectStore } from './project_store.js';

// i18n shim, fallback pra key path se i18n nao bootou ainda.
const tr = (k, p) => (window.t ? window.t(k, p) : k);

function disableCompileButtons() {
    const buttonIds = [
        /*
        'cmmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp',
        'cancel-everything', 'fractalcomp', 'backupFolderBtn',
        'projectInfo' */
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
            icon.classList.remove('ph-plugs-connected');
            icon.classList.add('ph-plugs');
        }
        if (statusText) {
            statusText.setAttribute('data-i18n', 'statusBar.notReady');
            statusText.textContent = window.t ? window.t('statusBar.notReady') : 'Not Ready';
        }
        
        statusElement.classList.remove('is-ready');
        statusElement.classList.remove('fading');
    };

    statusElement.addEventListener('transitionend', onFadeOutComplete);
}

function clearProjectInterface() {
    // Wipe every view subcontainer through the controller, keeps the
    // separation invariant intact when the next project opens.
    window.treeView?.clearAll?.();
    window.treeView?.setActive?.('verilog');

    // After clearing, drop the "click here to create a project"
    // empty-state card into the (verilog) file view so the pane is
    // never visually blank. file_tree_manager exposes the renderer on
    // window for non-module callers like this one.
    window.renderTreeEmptyState?.();

    // Helper: re-instala o data-i18n pra que applyDOM em futuros
    // locale changes re-traduza. updateProjectNameUI remove o atributo
    // quando seta um nome de projeto real; aqui voltamos pra label
    // generica e precisamos do binding de volta.
    const resetNoProject = (el) => {
        el.setAttribute('data-i18n', 'fileTree.noProject');
        el.textContent = window.t ? window.t('fileTree.noProject') : 'No project open';
    };

    const selectors = {
        '#processor-list': el => el.innerHTML = '',
        '#editor': el => el.innerHTML = '',
        '#project-title': resetNoProject,
        '#current-spf-name': resetNoProject
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
        button.disabled = false;
        button.style.cursor = 'pointer';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const closeButton = document.querySelector('#close-button');

    if (!closeButton) return;

    closeButton.addEventListener('click', async () => {
        
        // 1. Replace native confirm with custom dialog
        const userChoice = await showDialog({
            title: tr('dialog.closeProject.title'),
            message: tr('dialog.closeProject.message'),
            buttons: [
                { label: tr('dialog.closeProject.cancel'),  action: 'cancel',  type: 'cancel' },
                { label: tr('dialog.closeProject.confirm'), action: 'confirm', type: 'save'   }
            ]
        });

        if (userChoice !== 'confirm') {
            return;
        }

        closeButton.disabled = true;
        closeButton.style.cursor = 'not-allowed';

        try {
            const result = await electronAPI.closeProject();

            if (result.success) {
                // Close all open tabs properly using TabManager
                // This ensures watchers are stopped and UI state is cleared
                const openFiles = Array.from(TabManager.tabs.keys());
                for (const file of openFiles) {
                    await TabManager.closeTab(file);
                }

                clearProjectInterface();

                // Clear the canonical project state, the store mirrors to
                // window.currentProjectPath / window.currentSpfPath for the
                // legacy read sites.
                ProjectStore.clearProject();

                // Forget the last-opened project so the next Aurora launch
                // doesn't auto-reopen what we just closed. The path lives
                // in localStorage (`aurora-last-project-path`); we route
                // through appInitializer instead of touching the key
                // directly so the storage shape stays owned by one module.
                window.appInitializer?.clearLastProject?.();

                // Reset do verilog tree pra que reabrir dispare um
                // re-activate full (le o .spf fresco,
                // pega arquivos fora da pasta do projeto). Sem isso,
                // isTreeActive fica true e o proximo activate
                // cai no early-return.
                window.projectTreeManager?.reset?.();

                window.SplitEditorManager?.refreshLayout?.();
            } else {
                console.error('Failed to close project:', result.error);
                
                // 2. Replace native alert (Error) with custom dialog
                await showDialog({
                    title: tr('dialog.closeProject.errorTitle'),
                    message: tr('dialog.closeProject.errorMessage', { reason: result.error }),
                    buttons: [
                        { label: tr('dialog.common.ok'), action: 'ok', type: 'cancel' }
                    ]
                });
            }
        } catch (error) {
            console.error('An unexpected error occurred while closing the project:', error);
            
            // 3. Replace native alert (Exception) with custom dialog
            await showDialog({
                title: tr('dialog.closeProject.unexpectedTitle'),
                message: tr('dialog.closeProject.unexpectedMessage'),
                buttons: [
                    { label: tr('dialog.common.ok'), action: 'ok', type: 'cancel' }
                ]
            });
        } finally {
            closeButton.disabled = false;
            closeButton.style.cursor = 'pointer';
        }
    });
});