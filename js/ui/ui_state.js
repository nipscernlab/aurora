/**
 * =====================================================================================
 * Aurora IDE - UI State Manager
 *
 * FASE 2 da elimicacao dos 3 modos: este manager foi simplificado pra
 * gerenciar so o "Project Mode" — modo unico. O toggle de modo na
 * toolbar esta escondido, e localStorage de mode foi descontinuado.
 * Resta a logica de status indicator (#compmode no rodape) e
 * transitions visuais — fica como utility code, ja que o body glow
 * + status text continuam util ate alguem decidir tirar tambem.
 * =====================================================================================
 */

class UIStateManager {
    constructor() {
        this.currentMode = null;
        this.glowTimeout = null;
        this.statusElement = null;

        this.modeConfig = {
            'Project Mode': {
                icon: 'fa-solid fa-compass-drafting',
                text: 'Project Mode',
            },
        };

        this.initializeStatusElement();
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
     * Set initial mode. FASE 2: hardcoded 'Project Mode' — modo unico.
     * Mantemos a chamada ao handleModeChange pra que o status
     * indicator no rodape (#compmode) seja preenchido na primeira
     * pintura, evitando flash de texto vazio.
     */
    setInitialMode() {
        this.handleModeChange('Project Mode', true);
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
     * Aplica o estado de modo. FASE 2: so existe Project Mode, mas a
     * funcao continua existindo pra atualizar o status indicator de
     * forma idempotente (chamada de setInitialMode).
     */
    handleModeChange(mode, skipGlow = false) {
        if (this.currentMode === mode && !skipGlow) return;
        this.updateStatusIndicator(mode);
        this.enableAllElements();
        this.currentMode = mode;
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
            /*
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
            'settings-project' */
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

}

// Initialize UI State Manager when DOM is ready (constructor wires DOM listeners
// — we keep the instance alive but never read the reference back).
let _uiStateManager;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        _uiStateManager = new UIStateManager();
    });
} else {
    _uiStateManager = new UIStateManager();
}

// Export for external access if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIStateManager;
}