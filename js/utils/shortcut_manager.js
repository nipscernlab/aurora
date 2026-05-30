/**
 * Aurora Shortcut Manager
 * Handles global keyboard shortcuts based on user configuration.
 */
(() => {
    const SHORTCUTS_STORAGE_KEY = 'aurora-shortcuts';

    // Shortcuts pra 'compileAll' (Ctrl+Shift+B) e 'openSettings'
    // (Ctrl+Shift+C) sairam quando os botoes correspondentes (allcomp,
    // settings) viraram dead UI.
    const defaultShortcuts = {
        'newFile': { ctrlKey: true, shiftKey: false, altKey: false, key: 'N' },
        'closeTab': { ctrlKey: true, shiftKey: false, altKey: false, key: 'W' },
        'reopenTab': { ctrlKey: true, shiftKey: true, altKey: false, key: 'T' },
        'saveFile': { ctrlKey: true, shiftKey: false, altKey: false, key: 'S' },
        'saveAllFiles': { ctrlKey: true, shiftKey: true, altKey: false, key: 'S' },
    };

    let activeShortcuts = {};

    // Phase B: every shortcut routes through window.AuroraAPI so the same
    // entry point handles keyboard, toolbar clicks and AI tool calls.
    // The optional-chaining `?.` is for the boot window before
    // initAuroraAPI() runs — the user can't fire a shortcut that early,
    // but the guard keeps the module test-safe.
    const actions = {
        newFile:      () => window.AuroraAPI?.editor.newFile(),
        closeTab:     () => window.AuroraAPI?.editor.closeTab(),
        reopenTab:    () => window.AuroraAPI?.editor.reopenLastTab(),
        saveFile:     () => window.AuroraAPI?.editor.save(),
        saveAllFiles: () => window.AuroraAPI?.editor.saveAll(),
    };
    
    function loadShortcuts() {
        const stored = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        activeShortcuts = {
            ...JSON.parse(JSON.stringify(defaultShortcuts)),
            ...parsed,
        };
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
