/**
 * Aurora Shortcut Manager
 * Handles global keyboard shortcuts based on user configuration.
 */
(() => {
    const SHORTCUTS_STORAGE_KEY = 'aurora-shortcuts';

    const defaultShortcuts = {
        'compileAll': { ctrlKey: true, shiftKey: true, altKey: false, key: 'B' },
        'closeTab': { ctrlKey: true, shiftKey: false, altKey: false, key: 'W' },
        'reopenTab': { ctrlKey: true, shiftKey: true, altKey: false, key: 'T' },
        'saveFile': { ctrlKey: true, shiftKey: false, altKey: false, key: 'S' },
        'saveAllFiles': { ctrlKey: true, shiftKey: true, altKey: false, key: 'S' },
        'openSettings': { ctrlKey: true, shiftKey: true, altKey: false, key: 'C' }
    };

    let activeShortcuts = {};

    const actions = {
        compileAll: () => {
            document.getElementById('allcomp')?.click();
        },
        closeTab: () => {
            // Supondo que você tenha um TabManager global
            if (window.TabManager && TabManager.activeTab) {
                TabManager.closeTab(TabManager.activeTab);
            }
        },
        reopenTab: () => {
            if (window.TabManager) TabManager.reopenLastClosedTab();
        },
        saveFile: () => {
            if (window.TabManager) TabManager.saveCurrentFile();
        },
        saveAllFiles: () => {
            if (window.TabManager) TabManager.saveAllFiles();
        },
        openSettings: () => {
            // Lógica para abrir settings de projeto ou o modal principal
            const toggleUi = document.getElementById('toggle-ui');
            if (toggleUi && toggleUi.classList.contains('active')) {
                document.getElementById('settings-project')?.showModal();
            } else {
                document.getElementById('aurora-settings')?.click();
            }
        }
    };
    
    function loadShortcuts() {
        const stored = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
        activeShortcuts = stored ? JSON.parse(stored) : JSON.parse(JSON.stringify(defaultShortcuts));
    }

    function handleKeyDown(e) {
        // Ignora atalhos enquanto um input, textarea, etc. estiver focado
        const activeEl = document.activeElement;
        if (activeEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName) || activeEl.isContentEditable) {
            return;
        }

        for (const actionName in activeShortcuts) {
            const shortcut = activeShortcuts[actionName];
            const match =
                e.key.toUpperCase() === shortcut.key &&
                e.ctrlKey === shortcut.ctrlKey &&
                e.shiftKey === shortcut.shiftKey &&
                e.altKey === shortcut.altKey;

            if (match) {
                e.preventDefault();
                if (actions[actionName]) {
                    actions[actionName]();
                }
                break; // Impede que múltiplos atalhos com a mesma combinação sejam acionados
            }
        }
    }

    // Carrega os atalhos na inicialização
    loadShortcuts();
    
    // Adiciona o listener de evento principal
    document.addEventListener('keydown', handleKeyDown);

    // Ouve por atualizações do modal de configurações
    window.addEventListener('aurora-shortcuts-updated', loadShortcuts);

})();