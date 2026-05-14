// aurora_settings.js
document.addEventListener('DOMContentLoaded', () => {
    const settingsButton = document.getElementById('aurora-settings');
    const modalOverlay = document.getElementById('settings-modal');
    if (!settingsButton || !modalOverlay) return;

    const closeModalButton = document.getElementById('close-modal-btn');
    const saveButton = document.getElementById('save-settings-btn');
    const resetButton = document.getElementById('reset-settings-btn');
    const shortcutList = document.getElementById('shortcut-list');
    const shortcutWarning = document.getElementById('shortcut-warning');
    const tooltipsToggle = document.getElementById('tooltips-toggle');

    const SHORTCUTS_STORAGE_KEY = 'aurora-shortcuts';
    const SETTINGS_STORAGE_KEY = 'aurora-settings';

    // i18n note: labels resolved at render time via SHORTCUT_LABEL_KEYS,
    // not stored here, so locale switches update the UI without touching
    // localStorage-persisted shortcuts.
    const defaultShortcuts = {
        'compileAll':   { ctrlKey: true,  shiftKey: true,  altKey: false, key: 'B' },
        'closeTab':     { ctrlKey: true,  shiftKey: false, altKey: false, key: 'W' },
        'reopenTab':    { ctrlKey: true,  shiftKey: true,  altKey: false, key: 'T' },
        'saveFile':     { ctrlKey: true,  shiftKey: false, altKey: false, key: 'S' },
        'saveAllFiles': { ctrlKey: true,  shiftKey: true,  altKey: false, key: 'S' },
        'openSettings': { ctrlKey: true,  shiftKey: true,  altKey: false, key: 'C' }
    };

    const SHORTCUT_LABEL_KEYS = {
        'compileAll':   'shortcuts.compileAll',
        'closeTab':     'shortcuts.closeTab',
        'reopenTab':    'shortcuts.reopenTab',
        'saveFile':     'shortcuts.saveFile',
        'saveAllFiles': 'shortcuts.saveAllFiles',
        'openSettings': 'shortcuts.openSettings'
    };

    const tr = (key) => (window.t ? window.t(key) : key);

    const defaultSettings = {
        tooltipsEnabled: true,
        verboseMode: false
    };

    let currentShortcuts = {};
    let currentSettings = {};

    /**
     * Carrega configurações do localStorage (ou usa defaults) e aplica ao UI.
     */
    const loadSettings = () => {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        currentSettings = stored ? JSON.parse(stored) : { ...defaultSettings };

        // Apply to UI toggles (safely)
        if (tooltipsToggle) tooltipsToggle.checked = !!currentSettings.tooltipsEnabled;

        // Aplica estado dos tooltips imediatamente
        updateTooltipsState(!!currentSettings.tooltipsEnabled);
    };

    /**
     * Salva configurações no localStorage e notifica a aplicação.
     */
    const saveSettings = () => {
        currentSettings.tooltipsEnabled = tooltipsToggle?.checked ?? true;

        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
        // Evento global para quem quiser reagir às mudanças de settings
        window.dispatchEvent(new CustomEvent('aurora-settings-updated', { detail: currentSettings }));

        // Notifica especificamente sobre tooltips
        updateTooltipsState(currentSettings.tooltipsEnabled);
    };

    function updateTooltipsState(enabled) {
    window.AURORA_TOOLTIPS_ENABLED = !!enabled;

    // Apenas adiciona um atributo para evitar inicialização futura do tooltip
    const tooltipElements = document.querySelectorAll('[data-tooltip-initialized]');
    tooltipElements.forEach(el => {
        if (enabled) {
            el.removeAttribute('data-no-tooltip');
        } else {
            el.setAttribute('data-no-tooltip', 'true');
        }
    });

    // Esconde ou mostra o tooltip flutuante
    const tooltipDiv = document.querySelector('.custom-tooltip');
    if (tooltipDiv) {
        tooltipDiv.style.display = enabled ? '' : 'none';
        if (!enabled) tooltipDiv.classList.remove('visible');
    }

    // Evento global para outros módulos
    window.dispatchEvent(new CustomEvent('aurora-tooltips-updated', { detail: { enabled: !!enabled } }));
}


    // Listener para toggles com efeito imediato
    if (tooltipsToggle) {
        tooltipsToggle.addEventListener('change', () => {
            const enabled = tooltipsToggle.checked;
            updateTooltipsState(enabled);
        });
    }

    // ---- Shortcuts UI / gravação ----
    const formatShortcutText = ({ ctrlKey, shiftKey, altKey, key }) => {
        if (!key) return tr('shortcuts.notSet');
        const parts = [];
        if (ctrlKey) parts.push('Ctrl');
        if (shiftKey) parts.push('Shift');
        if (altKey) parts.push('Alt');
        parts.push(key.length === 1 ? key.toUpperCase() : key);
        return parts.join(' + ');
    };

    const renderShortcuts = () => {
        if (!shortcutList) return;
        shortcutList.innerHTML = '';
        for (const action in currentShortcuts) {
            const item = document.createElement('div');
            item.className = 'shortcut-item';
            const labelKey = SHORTCUT_LABEL_KEYS[action] || action;
            item.innerHTML = `
                <span class="action">${tr(labelKey)}</span>
                <div class="shortcut-input" data-action="${action}" tabindex="0">${formatShortcutText(currentShortcuts[action])}</div>
            `;
            shortcutList.appendChild(item);
        }
    };

    // Re-render the shortcut list whenever the locale flips, otherwise
    // the action labels and "Not Set" placeholder would stay stuck in
    // the previously-active language.
    window.addEventListener('aurora:locale-changed', () => {
        if (modalOverlay.classList.contains('visible')) renderShortcuts();
    });

    let recordingInput = null;
    let activeKeys = new Set();
    const isModifier = (key) => ['Control', 'Shift', 'Alt', 'Meta'].includes(key);

    const stopRecording = () => {
        if (!recordingInput) return;
        document.removeEventListener('keydown', handleRecordingKeyDown, { capture: true });
        document.removeEventListener('keyup', handleRecordingKeyUp, { capture: true });
        recordingInput.classList.remove('recording');
        const action = recordingInput.dataset.action;
        recordingInput.textContent = formatShortcutText(currentShortcuts[action]);
        recordingInput = null;
        activeKeys.clear();
    };

    const handleRecordingKeyDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isModifier(e.key)) activeKeys.add(e.key.toUpperCase());
        if (e.ctrlKey) activeKeys.add('Control');
        if (e.shiftKey) activeKeys.add('Shift');
        if (e.altKey) activeKeys.add('Alt');

        const parts = [];
        if (activeKeys.has('Control')) parts.push('Ctrl');
        if (activeKeys.has('Shift')) parts.push('Shift');
        if (activeKeys.has('Alt')) parts.push('Alt');
        const mainKey = Array.from(activeKeys).find(k => !isModifier(k));
        if (mainKey) parts.push(mainKey);

        if (recordingInput) recordingInput.textContent = parts.join(' + ');
    };

    const isShortcutDuplicate = (newShortcut, actionToExclude) => {
        for (const action in currentShortcuts) {
            if (action === actionToExclude) continue;
            const existing = currentShortcuts[action];
            if (existing.key === newShortcut.key && existing.ctrlKey === newShortcut.ctrlKey &&
                existing.shiftKey === newShortcut.shiftKey && existing.altKey === newShortcut.altKey) {
                return true;
            }
        }
        return false;
    };

    const handleRecordingKeyUp = (e) => {
        if (!recordingInput) return;

        e.preventDefault();
        e.stopPropagation();
        if (activeKeys.size === 0) return;

        const finalShortcut = {
            ctrlKey: activeKeys.has('Control'),
            shiftKey: activeKeys.has('Shift'),
            altKey: activeKeys.has('Alt'),
            key: Array.from(activeKeys).find(k => !isModifier(k) && k.toUpperCase() !== 'ESCAPE')
        };

        if (!finalShortcut.key) return;

        const action = recordingInput.dataset.action;
        if (isShortcutDuplicate(finalShortcut, action)) {
            if (shortcutWarning) {
                shortcutWarning.style.display = 'block';
                setTimeout(() => { if (shortcutWarning) shortcutWarning.style.display = 'none'; }, 2500);
            }
        } else {
            currentShortcuts[action] = finalShortcut;
            if (shortcutWarning) shortcutWarning.style.display = 'none';
        }
        stopRecording();
    };

    if (shortcutList) {
        shortcutList.addEventListener('click', (e) => {
            const target = e.target.closest('.shortcut-input');
            if (!target) return;
            if (recordingInput) stopRecording();

            recordingInput = target;
            recordingInput.textContent = tr('shortcuts.recording');
            recordingInput.classList.add('recording');

            document.addEventListener('keydown', handleRecordingKeyDown, { capture: true });
            document.addEventListener('keyup', handleRecordingKeyUp, { capture: true });
        });
    }

    // ---- Modal open/close and persistence ----
    const openModal = () => {
        currentShortcuts = JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY)) ||
                          JSON.parse(JSON.stringify(defaultShortcuts));
        loadSettings();
        renderShortcuts();
        modalOverlay.style.display = 'flex';
        setTimeout(() => modalOverlay.classList.add('visible'), 10);
    };

    const closeModal = () => {
        stopRecording();
        modalOverlay.classList.remove('visible');
        setTimeout(() => modalOverlay.style.display = 'none', 300);
    };

    if (saveButton) {
        saveButton.addEventListener('click', () => {
            localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(currentShortcuts));
            saveSettings();
            window.dispatchEvent(new CustomEvent('aurora-shortcuts-updated'));
            closeModal();
        });
    }

    if (resetButton) {
        resetButton.addEventListener('click', () => {
            currentShortcuts = JSON.parse(JSON.stringify(defaultShortcuts));
            currentSettings = { ...defaultSettings };
            loadSettings();
            renderShortcuts();
        });
    }

    settingsButton.addEventListener('click', openModal);
    if (closeModalButton) closeModalButton.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => (e.target === modalOverlay) && closeModal());
    document.addEventListener('keydown', (e) => (e.key === 'Escape' && modalOverlay.classList.contains('visible')) && closeModal());

    // ---- Inicialização ----
    loadSettings();

    // Expose a programmatic API to change tooltips from other modules if needed
    window.auroraSettings = window.auroraSettings || {};
    window.auroraSettings.updateTooltipsState = updateTooltipsState;
    window.auroraSettings.getCurrentSettings = () => ({ ...currentSettings });
});
