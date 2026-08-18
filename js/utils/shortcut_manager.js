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
        // O11: liga/desliga a análise semântica do slang. Ctrl+Alt+S (S de
        // slang/semântico), inclui Ctrl pra disparar com o editor Monaco
        // focado; Ctrl+Shift+P é do command palette, não daqui.
        'toggleSlang': { ctrlKey: true, shiftKey: false, altKey: true, key: 'S' },
    };

    let activeShortcuts = {};

    // Phase B: every shortcut routes through window.AuroraAPI so the same
    // entry point handles keyboard, toolbar clicks and AI tool calls.
    // The optional-chaining `?.` is for the boot window before
    // initAuroraAPI() runs, the user can't fire a shortcut that early,
    // but the guard keeps the module test-safe.
    const actions = {
        newFile:      () => window.AuroraAPI?.editor.newFile(),
        closeTab:     () => window.AuroraAPI?.editor.closeTab(),
        reopenTab:    () => window.AuroraAPI?.editor.reopenLastTab(),
        saveFile:     () => window.AuroraAPI?.editor.save(),
        saveAllFiles: () => window.AuroraAPI?.editor.saveAll(),
        toggleSlang:  () => window.AuroraSlang?.toggle?.(),
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
        // Auto-repeat (a held key) must NOT re-fire these actions, holding
        // Ctrl+W used to close every tab, one repeat at a time (and raced the
        // editor teardown into a null-layout crash). One press = one action.
        if (e.repeat) return;
        // Skip ONLY genuine text-entry contexts (a search box, a rename field,
        // the AI composer). Ctrl/Cmd-modified combos are IDE commands (close
        // tab, save, new, reopen), never typed text, so they must still fire
        // with the Monaco editor (a textarea) or a field focused. The
        // shortcut-recording field stops propagation in the capture phase, so
        // recording a new binding stays safe.
        if (!e.ctrlKey && !e.metaKey) {
            const activeEl = document.activeElement;
            if (activeEl && (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName) || activeEl.isContentEditable)) {
                return;
            }
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
