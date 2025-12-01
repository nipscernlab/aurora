/**
 * =====================================================================================
 * Aurora IDE - UI State Manager
 * Handles smooth transitions between Verilog, Processor, and Project modes
 * Includes localStorage persistence and status indicator updates
 * =====================================================================================
 */

class UIStateManager {
    constructor() {
        this.currentMode = null;
        this.modeRadios = null;
        this.glowTimeout = null;
        this.statusElement = null;
        this.storageKey = 'aurora-ide-compilation-mode';
        
        this.modeConfig = {
            'Verilog Mode': {
                icon: 'fa-solid fa-v fa-sm',
                text: 'Verilog Mode',
            },
            'Processor Mode': {
                icon: 'fa-solid fa-microchip',
                text: 'Processor Mode',
            },
            'Project Mode': {
                icon: 'fa-solid fa-compass-drafting',
                text: 'Project Mode',
        
            }
        };
        
        this.initializeStatusElement();
        this.initializeEventListeners();
        this.setInitialMode();
    }

    /**
     * Initialize reference to status element
     */
    initializeStatusElement() {
        this.statusElement = document.getElementById('compmode');
        if (!this.statusElement) {
            console.warn('Status element #compmode not found');
        }
    }

    /**
     * Initialize event listeners for mode radio buttons
     */
    initializeEventListeners() {
        this.modeRadios = document.querySelectorAll('input[name="mode"]');
        
        this.modeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.handleModeChange(e.target.value);
                }
            });
        });
    }

    /**
     * Set initial mode based on localStorage, checked radio, or default to Verilog Mode
     */
    setInitialMode() {
        // Try to get saved mode from localStorage
        const savedMode = this.loadModeFromStorage();
        
        // Check if there's a checked radio
        const checkedRadio = document.querySelector('input[name="mode"]:checked');
        
        // Determine initial mode (priority: localStorage > checked radio > default)
        let initialMode = savedMode || (checkedRadio ? checkedRadio.value : 'Verilog Mode');
        
        // Validate that the mode exists in our config
        if (!this.modeConfig[initialMode]) {
            console.warn(`Invalid mode "${initialMode}" loaded, defaulting to Verilog Mode`);
            initialMode = 'Verilog Mode';
        }
        
        // Set the appropriate radio button
        const targetRadio = document.getElementById(initialMode);
        if (targetRadio) {
            targetRadio.checked = true;
        } else {
            // Fallback: check Verilog Mode
            const verilogRadio = document.getElementById('Verilog Mode');
            if (verilogRadio) {
                verilogRadio.checked = true;
            }
        }
        
        // Don't show glow on initial load, but do update status
        this.handleModeChange(initialMode, true);
    }

    /**
     * Load mode from localStorage
     * @returns {string|null} Saved mode or null if not found
     */
    loadModeFromStorage() {
        try {
            const savedMode = localStorage.getItem(this.storageKey);
            if (savedMode) {
                console.log(`Loaded mode from storage: ${savedMode}`);
                return savedMode;
            }
        } catch (error) {
            console.error('Error loading mode from localStorage:', error);
        }
        return null;
    }

    /**
     * Save mode to localStorage
     * @param {string} mode - Mode to save
     */
    saveModeToStorage(mode) {
        try {
            localStorage.setItem(this.storageKey, mode);
            console.log(`Saved mode to storage: ${mode}`);
        } catch (error) {
            console.error('Error saving mode to localStorage:', error);
        }
    }


    updateStatusIndicator(mode) {
    if (!this.statusElement) {
        console.warn('Cannot update status: element not found');
        return;
    }

    const config = this.modeConfig[mode];
    if (!config) {
        console.warn(`No config found for mode: ${mode}`);
        return;
    }

    // Add fading class for smooth transition
    this.statusElement.classList.add('status-fading');

    // After fade out, change content
    setTimeout(() => {
        // Update icon
        const iconElement = this.statusElement.querySelector('i');
        if (iconElement) {
            iconElement.className = ''; // Remove all existing icon classes
            config.icon.split(' ').forEach(cls => iconElement.classList.add(cls));
            iconElement.style.color = config.color;
        }

        // --- CORREÇÃO: Alvo específico para o texto ---
        // Busca o span pelo seu ID para uma atualização confiável
        let textElement = this.statusElement.querySelector('#compmode-text');
        if (textElement) {
            // Adiciona um espaço antes do texto para separá-lo do ícone
            textElement.textContent = ` ${config.text}`;
        } else {
            console.warn('Text element #compmode-text not found inside status indicator.');
        }

        // Remove fading class to fade back in
        setTimeout(() => {
            this.statusElement.classList.remove('status-fading');
        }, 50);
    }, 200); // Wait for fade out
}

    /**
     * Handle mode change with smooth transitions
     * @param {string} mode - The selected mode
     * @param {boolean} skipGlow - Skip glow effect (for initial load)
     */
    handleModeChange(mode, skipGlow = false) {
        if (this.currentMode === mode && !skipGlow) return;

        console.log(`Switching from ${this.currentMode || 'initial'} to ${mode}`);
        
        // Update status indicator
        this.updateStatusIndicator(mode);
        
        // Save to localStorage
        this.saveModeToStorage(mode);
        
        // Update body glow effect (only if not initial load)
        if (!skipGlow) {
            this.updateBodyGlow(mode);
        }
        
        // Handle mode-specific UI changes
        switch (mode) {
            case 'Verilog Mode':
                this.activateVerilogMode();
                break;
            case 'Processor Mode':
                this.activateProcessorMode();
                break;
            case 'Project Mode':
                this.activateProjectMode();
                break;
            default:
                console.warn(`Unknown mode: ${mode}`);
        }

        this.currentMode = mode;
    }

    /**
     * Update body glow effect based on mode (temporary, fades after 3 seconds)
     * @param {string} mode - The selected mode
     */
    updateBodyGlow(mode) {
        const body = document.body;
        
        // Clear any existing glow timeout
        if (this.glowTimeout) {
            clearTimeout(this.glowTimeout);
        }
        
        // Remove all mode classes first
        body.classList.remove('verilog-mode-active', 'processor-mode-active', 'project-mode-active', 'glow-fading');
        
        // Force reflow
        void body.offsetWidth;
        
        // Add appropriate mode class
        switch (mode) {
            case 'Verilog Mode':
                body.classList.add('verilog-mode-active');
                break;
            case 'Processor Mode':
                body.classList.add('processor-mode-active');
                break;
            case 'Project Mode':
                body.classList.add('project-mode-active');
                break;
        }
        
        // Remove glow after 3 seconds
        this.glowTimeout = setTimeout(() => {
            body.classList.add('glow-fading');
            
            // After fade completes, remove all classes
            setTimeout(() => {
                body.classList.remove('verilog-mode-active', 'processor-mode-active', 'project-mode-active', 'glow-fading');
            }, 800); // Match CSS transition duration
        }, 3000);
    }

    /**
     * Activate Verilog Mode - Hide specific buttons and tabs
     */
    activateVerilogMode() {
        console.log('Activating Verilog Mode');
        
        // Toolbar buttons to hide in Verilog Mode
        const toolbarButtonsToHide = [
            'cmmcomp',
            'asmcomp',
            'wavecomp',
            'processorHub',
            'cancel-everything',
            'allcomp'
        ];

        // Terminal tabs to hide
        const terminalTabsToHide = [
            'button.tab[data-terminal="tcmm"]',
            'button.tab[data-terminal="tasm"]',
            'button.tab[data-terminal="twave"]'
        ];

        // Terminal content divs to hide
        const terminalContentToHide = [
            'terminal-tcmm',
            'terminal-tasm',
            'terminal-twave'
        ];

        // Hide toolbar buttons
        this.hideElementsById(toolbarButtonsToHide);
        
        // Hide terminal tabs
        this.hideElementsBySelector(terminalTabsToHide);
        
        // Hide terminal content
        this.hideElementsById(terminalContentToHide);

        // Hide compile-all-group container
        const compileAllGroup = document.querySelector('.compile-all-group');
        if (compileAllGroup) {
            this.smoothHide(compileAllGroup);
        }

        // Show TVERI tab if hidden
        const tveriTab = document.querySelector('button.tab[data-terminal="tveri"]');
        if (tveriTab) {
            this.smoothShow(tveriTab);
        }

        // Show TVERI terminal content
        const tveriContent = document.getElementById('terminal-tveri');
        if (tveriContent) {
            this.smoothShow(tveriContent);
            tveriContent.classList.remove('hidden');
        }

        // Activate TVERI tab
        setTimeout(() => {
            if (tveriTab && !tveriTab.classList.contains('active')) {
                tveriTab.click();
            }
        }, 400);
    }

    /**
     * Activate Processor Mode - Show all buttons and tabs
     */
    activateProcessorMode() {
        console.log('Activating Processor Mode');
        this.enableAllElements();
    }

    /**
     * Activate Project Mode - Show all buttons and tabs
     */
    activateProjectMode() {
        console.log('Activating Project Mode');
        this.enableAllElements();
    }

    /**
     * Hide elements by ID with smooth animation
     * @param {Array<string>} elementIds - Array of element IDs to hide
     */
    hideElementsById(elementIds) {
        elementIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                this.smoothHide(element);
            }
        });
    }

    /**
     * Hide elements by selector with smooth animation
     * @param {Array<string>} selectors - Array of CSS selectors
     */
    hideElementsBySelector(selectors) {
        selectors.forEach(selector => {
            const element = document.querySelector(selector);
            if (element) {
                this.smoothHide(element);
            }
        });
    }

    /**
     * Smooth hide animation
     * @param {HTMLElement} element - Element to hide
     */
    smoothHide(element) {
        if (!element || element.classList.contains('ui-state-hidden')) return;

        // Step 1: Start fade out
        element.classList.add('ui-state-hiding');
        
        // Step 2: After fade completes, collapse height
        setTimeout(() => {
            const currentHeight = element.offsetHeight;
            element.style.height = `${currentHeight}px`;
            
            // Force reflow
            void element.offsetHeight;
            
            // Add collapsing class
            element.classList.add('ui-state-collapsing');
            element.style.height = '0';
            element.style.marginTop = '0';
            element.style.marginBottom = '0';
            element.style.paddingTop = '0';
            element.style.paddingBottom = '0';
            
            // Step 3: After collapse, fully hide
            setTimeout(() => {
                element.classList.remove('ui-state-hiding', 'ui-state-collapsing');
                element.classList.add('ui-state-hidden');
                element.style.height = '';
                element.style.marginTop = '';
                element.style.marginBottom = '';
                element.style.paddingTop = '';
                element.style.paddingBottom = '';
            }, 300); // Match transition duration
        }, 200); // Wait for opacity fade
    }

    /**
     * Smooth show animation
     * @param {HTMLElement} element - Element to show
     */
    smoothShow(element) {
        if (!element || !element.classList.contains('ui-state-hidden')) return;

        // Remove hidden class
        element.classList.remove('ui-state-hidden');
        
        // Get natural height
        element.style.height = 'auto';
        const targetHeight = element.offsetHeight;
        element.style.height = '0';
        
        // Force reflow
        void element.offsetHeight;
        
        // Start expanding
        element.classList.add('ui-state-expanding');
        element.style.height = `${targetHeight}px`;
        
        // After expansion, fade in
        setTimeout(() => {
            element.classList.add('ui-state-showing');
            
            // Clean up after animation
            setTimeout(() => {
                element.classList.remove('ui-state-expanding', 'ui-state-showing');
                element.style.height = '';
            }, 300); // Match transition duration
        }, 50);
    }

    /**
     * Enable all elements - Show and enable all buttons and tabs
     */
    enableAllElements() {
        // All toolbar button IDs to enable
        const toolbarButtonIds = [
            'cmmcomp',
            'asmcomp',
            'wavecomp',
            'processorHub',
            'settings',
            'cancel-everything',
            'allcomp',
            'vericomp',
            'prismcomp',
            'fractalcomp',
            'importBtn',
            'backupFolderBtn',
            'projectInfo',
            'settings-project'
        ];

        // Enable and show toolbar buttons
        toolbarButtonIds.forEach(id => {
            const button = document.getElementById(id);
            if (button) {
                button.disabled = false;
                button.style.cursor = 'pointer';
                this.smoothShow(button);
            }
        });

        // Show terminal tabs
        const terminalTabs = [
            'button.tab[data-terminal="tcmm"]',
            'button.tab[data-terminal="tasm"]',
            'button.tab[data-terminal="twave"]'
        ];

        terminalTabs.forEach(selector => {
            const element = document.querySelector(selector);
            if (element) {
                this.smoothShow(element);
            }
        });

        // Show terminal content divs
        const terminalContentIds = [
            'terminal-tcmm',
            'terminal-tasm',
            'terminal-twave'
        ];

        terminalContentIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                this.smoothShow(element);
            }
        });

        // Show compile-all-group container
        const compileAllGroup = document.querySelector('.compile-all-group');
        if (compileAllGroup) {
            this.smoothShow(compileAllGroup);
        }
    }

    /**
     * Get current active mode
     * @returns {string|null} Current mode
     */
    getCurrentMode() {
        return this.currentMode;
    }

    /**
     * Clear saved mode from localStorage (utility method)
     */
    clearSavedMode() {
        try {
            localStorage.removeItem(this.storageKey);
            console.log('Cleared saved mode from storage');
        } catch (error) {
            console.error('Error clearing mode from localStorage:', error);
        }
    }
}

// Initialize UI State Manager when DOM is ready
let uiStateManager;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        uiStateManager = new UIStateManager();
    });
} else {
    uiStateManager = new UIStateManager();
}

// Export for external access if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIStateManager;
}