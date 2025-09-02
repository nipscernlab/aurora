document.addEventListener('DOMContentLoaded', () => {
    const settingsButton = document.getElementById('aurora-settings');
    const modalOverlay = document.getElementById('settings-modal');
    if (!settingsButton || !modalOverlay) return;

    const closeModalButton = document.getElementById('close-modal-btn');
    const saveButton = document.getElementById('save-settings-btn');
    const resetButton = document.getElementById('reset-settings-btn');
    const shortcutList = document.getElementById('shortcut-list');
    const shortcutWarning = document.getElementById('shortcut-warning');

    const SHORTCUTS_STORAGE_KEY = 'aurora-shortcuts';

    const defaultShortcuts = {
        'compileAll': { label: 'Compile All', ctrlKey: true, shiftKey: true, altKey: false, key: 'B' },
        'closeTab': { label: 'Close Active Tab', ctrlKey: true, shiftKey: false, altKey: false, key: 'W' },
        'reopenTab': { label: 'Reopen Last Closed Tab', ctrlKey: true, shiftKey: true, altKey: false, key: 'T' },
        'saveFile': { label: 'Save Current File', ctrlKey: true, shiftKey: false, altKey: false, key: 'S' },
        'saveAllFiles': { label: 'Save All Files', ctrlKey: true, shiftKey: true, altKey: false, key: 'S' },
        'openSettings': { label: 'Open Settings / Project', ctrlKey: true, shiftKey: true, altKey: false, key: 'C' }
    };

    let currentShortcuts = {};

    const formatShortcutText = ({ ctrlKey, shiftKey, altKey, key }) => {
        if (!key) return 'Not Set';
        const parts = [];
        if (ctrlKey) parts.push('Ctrl');
        if (shiftKey) parts.push('Shift');
        if (altKey) parts.push('Alt');
        parts.push(key.length === 1 ? key.toUpperCase() : key);
        return parts.join(' + ');
    };

    const renderShortcuts = () => {
        shortcutList.innerHTML = '';
        for (const action in currentShortcuts) {
            const item = document.createElement('div');
            item.className = 'shortcut-item';
            item.innerHTML = `
                <span class="action">${currentShortcuts[action].label}</span>
                <div class="shortcut-input" data-action="${action}" tabindex="0">${formatShortcutText(currentShortcuts[action])}</div>
            `;
            shortcutList.appendChild(item);
        }
    };

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
        
        recordingInput.textContent = parts.join(' + ');
    };
    
    const isShortcutDuplicate = (newShortcut, actionToExclude) => {
        for (const action in currentShortcuts) {
            if (action === actionToExclude) continue;
            const existing = currentShortcuts[action];
            if (existing.key === newShortcut.key && existing.ctrlKey === newShortcut.ctrlKey && existing.shiftKey === newShortcut.shiftKey && existing.altKey === newShortcut.altKey) {
                return true;
            }
        }
        return false;
    };

    const handleRecordingKeyUp = (e) => {
        // <<<<<<<<<<<<<<<<<<<< FIX IS HERE >>>>>>>>>>>>>>>>>>>>>>>>>
        if (!recordingInput) return; // Prevents error if recording stops before keyup
        // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<>>>>>>>>>>>>>>>>>>>>>>>>>>>>

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
            shortcutWarning.style.display = 'block';
            setTimeout(() => shortcutWarning.style.display = 'none', 2500);
        } else {
            currentShortcuts[action] = finalShortcut;
            shortcutWarning.style.display = 'none';
        }
        stopRecording();
    };

    shortcutList.addEventListener('click', (e) => {
        const target = e.target.closest('.shortcut-input');
        if (!target) return;
        if (recordingInput) stopRecording();

        recordingInput = target;
        recordingInput.textContent = 'Recording...';
        recordingInput.classList.add('recording');
        
        document.addEventListener('keydown', handleRecordingKeyDown, { capture: true });
        document.addEventListener('keyup', handleRecordingKeyUp, { capture: true });
    });

    const openModal = () => {
        currentShortcuts = JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY)) || JSON.parse(JSON.stringify(defaultShortcuts));
        renderShortcuts();
        modalOverlay.style.display = 'flex';
        setTimeout(() => modalOverlay.classList.add('visible'), 10);
    };

    const closeModal = () => {
        stopRecording();
        modalOverlay.classList.remove('visible');
        setTimeout(() => modalOverlay.style.display = 'none', 300);
    };
    
    saveButton.addEventListener('click', () => {
        localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(currentShortcuts));
        window.dispatchEvent(new CustomEvent('aurora-shortcuts-updated'));
        closeModal();
    });
    
    resetButton.addEventListener('click', () => {
        currentShortcuts = JSON.parse(JSON.stringify(defaultShortcuts));
        renderShortcuts();
    });

    settingsButton.addEventListener('click', openModal);
    closeModalButton.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => (e.target === modalOverlay) && closeModal());
    document.addEventListener('keydown', (e) => (e.key === 'Escape' && modalOverlay.classList.contains('visible')) && closeModal());
});