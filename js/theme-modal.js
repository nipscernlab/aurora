// Theme Customizer JavaScript
// Initialize variables first
let currentTheme = {};
let originalTheme = {};

// Color definitions for the customizer
const colorDefinitions = {
    background: [
        { name: 'Primary Background', variable: '--bg-primary', description: 'Main background color' },
        { name: 'Secondary Background', variable: '--bg-secondary', description: 'Secondary areas' },
        { name: 'Tertiary Background', variable: '--bg-tertiary', description: 'Cards and panels' },
        { name: 'Hover Background', variable: '--bg-hover', description: 'Hover state' },
        { name: 'Active Background', variable: '--bg-active', description: 'Active state' }
    ],
    accent: [
        { name: 'Primary Accent', variable: '--accent-primary', description: 'Main accent color' },
        { name: 'Secondary Accent', variable: '--accent-secondary', description: 'Secondary accent' },
        { name: 'Hover Accent', variable: '--accent-hover', description: 'Accent hover state' },
        { name: 'Focus Accent', variable: '--accent-focus', description: 'Focus indicator' },
        { name: 'Muted Accent', variable: '--accent-muted', description: 'Subdued accent' }
    ],
    text: [
        { name: 'Primary Text', variable: '--text-primary', description: 'Main text color' },
        { name: 'Secondary Text', variable: '--text-secondary', description: 'Secondary text' },
        { name: 'Muted Text', variable: '--text-muted', description: 'Subtle text' },
        { name: 'Disabled Text', variable: '--text-disabled', description: 'Disabled elements' }
    ],
    border: [
        { name: 'Primary Border', variable: '--border-primary', description: 'Main borders' },
        { name: 'Secondary Border', variable: '--border-secondary', description: 'Subtle borders' },
        { name: 'Focus Border', variable: '--border-focus', description: 'Focus outline' }
    ],
    status: [
        { name: 'Error', variable: '--error', description: 'Error states' },
        { name: 'Warning', variable: '--warning', description: 'Warning states' },
        { name: 'Success', variable: '--success', description: 'Success states' },
        { name: 'Info', variable: '--info', description: 'Information states' }
    ]
};

// Preset themes
const presetThemes = {
    'elegant-purple': {
        '--bg-primary': '#17151f',
        '--bg-secondary': '#1e1b2c',
        '--bg-tertiary': '#252236',
        '--bg-hover': '#2d2a40',
        '--bg-active': '#363150',
        '--accent-primary': '#9d7fff',
        '--accent-secondary': '#7b5cd6',
        '--accent-hover': '#b18fff',
        '--accent-focus': '#cbb2ff',
        '--accent-muted': '#6842c2',
        '--text-primary': '#e2dcff',
        '--text-secondary': '#bbb2e0',
        '--text-muted': '#776f97',
        '--text-disabled': '#504a68',
        '--border-primary': '#2f2a45',
        '--border-secondary': '#252236',
        '--border-focus': '#9d7fff',
        '--error': '#ff7eb6',
        '--warning': '#ffb86c',
        '--success': '#a5e075',
        '--info': '#82cffb'
    },
    'ocean-blue': {
        '--bg-primary': '#0f172a',
        '--bg-secondary': '#1e293b',
        '--bg-tertiary': '#334155',
        '--bg-hover': '#475569',
        '--bg-active': '#64748b',
        '--accent-primary': '#0ea5e9',
        '--accent-secondary': '#0284c7',
        '--accent-hover': '#38bdf8',
        '--accent-focus': '#7dd3fc',
        '--accent-muted': '#0369a1',
        '--text-primary': '#f1f5f9',
        '--text-secondary': '#cbd5e1',
        '--text-muted': '#94a3b8',
        '--text-disabled': '#64748b',
        '--border-primary': '#475569',
        '--border-secondary': '#334155',
        '--border-focus': '#0ea5e9',
        '--error': '#ef4444',
        '--warning': '#f59e0b',
        '--success': '#10b981',
        '--info': '#06b6d4'
    },
    'forest-green': {
        '--bg-primary': '#064e3b',
        '--bg-secondary': '#065f46',
        '--bg-tertiary': '#047857',
        '--bg-hover': '#059669',
        '--bg-active': '#10b981',
        '--accent-primary': '#10b981',
        '--accent-secondary': '#059669',
        '--accent-hover': '#34d399',
        '--accent-focus': '#6ee7b7',
        '--accent-muted': '#047857',
        '--text-primary': '#ecfdf5',
        '--text-secondary': '#d1fae5',
        '--text-muted': '#a7f3d0',
        '--text-disabled': '#6ee7b7',
        '--border-primary': '#047857',
        '--border-secondary': '#065f46',
        '--border-focus': '#10b981',
        '--error': '#ef4444',
        '--warning': '#f59e0b',
        '--success': '#22c55e',
        '--info': '#06b6d4'
    },
    'sunset-orange': {
        '--bg-primary': '#1c1917',
        '--bg-secondary': '#292524',
        '--bg-tertiary': '#44403c',
        '--bg-hover': '#57534e',
        '--bg-active': '#78716c',
        '--accent-primary': '#f97316',
        '--accent-secondary': '#ea580c',
        '--accent-hover': '#fb923c',
        '--accent-focus': '#fdba74',
        '--accent-muted': '#dc2626',
        '--text-primary': '#fef7ed',
        '--text-secondary': '#fed7aa',
        '--text-muted': '#fdba74',
        '--text-disabled': '#fb923c',
        '--border-primary': '#57534e',
        '--border-secondary': '#44403c',
        '--border-focus': '#f97316',
        '--error': '#ef4444',
        '--warning': '#eab308',
        '--success': '#22c55e',
        '--info': '#06b6d4'
    },
    'rose-pink': {
        '--bg-primary': '#1f1315',
        '--bg-secondary': '#27181d',
        '--bg-tertiary': '#3c2329',
        '--bg-hover': '#4c2a2f',
        '--bg-active': '#633339',
        '--accent-primary': '#f43f5e',
        '--accent-secondary': '#e11d48',
        '--accent-hover': '#fb7185',
        '--accent-focus': '#fda4af',
        '--accent-muted': '#be123c',
        '--text-primary': '#fff1f2',
        '--text-secondary': '#fecdd3',
        '--text-muted': '#fda4af',
        '--text-disabled': '#fb7185',
        '--border-primary': '#4c2a2f',
        '--border-secondary': '#3c2329',
        '--border-focus': '#f43f5e',
        '--error': '#dc2626',
        '--warning': '#f59e0b',
        '--success': '#22c55e',
        '--info': '#06b6d4'
    },
    'cyber-teal': {
        '--bg-primary': '#0f1419',
        '--bg-secondary': '#1a2332',
        '--bg-tertiary': '#233444',
        '--bg-hover': '#2d4356',
        '--bg-active': '#3a5568',
        '--accent-primary': '#14b8a6',
        '--accent-secondary': '#0d9488',
        '--accent-hover': '#2dd4bf',
        '--accent-focus': '#5eead4',
        '--accent-muted': '#0f766e',
        '--text-primary': '#f0fdfa',
        '--text-secondary': '#ccfbf1',
        '--text-muted': '#99f6e4',
        '--text-disabled': '#5eead4',
        '--border-primary': '#2d4356',
        '--border-secondary': '#233444',
        '--border-focus': '#14b8a6',
        '--error': '#ef4444',
        '--warning': '#f59e0b',
        '--success': '#22c55e',
        '--info': '#0ea5e9'
    }
};

// Function declarations after variable initialization

// Load current theme from CSS variables already in DOM
function loadCurrentTheme() {
    try {
        // Get computed styles from document root
        const rootStyles = getComputedStyle(document.documentElement);
        
        // Extract all CSS custom properties
        Object.entries(colorDefinitions).forEach(([category, colors]) => {
            colors.forEach(color => {
                const value = rootStyles.getPropertyValue(color.variable).trim();
                if (value) {
                    currentTheme[color.variable] = value;
                }
            });
        });
        
        originalTheme = { ...currentTheme };
        console.log('Theme loaded successfully');
    } catch (error) {
        console.error('Error loading theme:', error);
        showStatus('Error loading current theme', 'error');
    }
}

// Convert various color formats to hex
function convertToHex(color) {
    if (color.startsWith('#')) {
        return color.length === 7 ? color : color + '000000'.substr(color.length - 1);
    }
    
    if (color.startsWith('rgb')) {
        const values = color.match(/\d+/g);
        if (values && values.length >= 3) {
            const hex = values.slice(0, 3).map(val => {
                const hex = parseInt(val).toString(16);
                return hex.length === 1 ? '0' + hex : hex;
            }).join('');
            return '#' + hex;
        }
    }
    
    return '#000000';
}

// Generate color input elements
function generateColorInputs() {
    const containers = {
        background: document.getElementById('backgroundColors'),
        accent: document.getElementById('accentColors'),
        text: document.getElementById('textColors'),
        border: document.getElementById('borderColors'),
        status: document.getElementById('statusColors')
    };

    Object.entries(colorDefinitions).forEach(([category, colors]) => {
        const container = containers[category];
        if (!container) return;

        container.innerHTML = colors.map(color => {
            const currentValue = currentTheme[color.variable] || '#000000';
            const hexValue = convertToHex(currentValue);
            
            return `
                <div class="color-item">
                    <div class="color-picker-wrapper">
                        <input type="color" 
                               class="color-picker" 
                               data-variable="${color.variable}"
                               value="${hexValue}"
                               title="Click to change ${color.name}">
                    </div>
                    <div class="color-info">
                        <div class="color-label">${color.name}</div>
                        <div class="color-variable">${color.variable}</div>
                        <div class="color-value" data-value="${color.variable}">${currentValue}</div>
                    </div>
                </div>
            `;
        }).join('');
    });
}

// Switch between tabs
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.theme-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.theme-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}Tab`);
    });
}

// Handle color picker changes
function handleColorChange(colorPicker) {
    const variable = colorPicker.dataset.variable;
    const newColor = colorPicker.value;
    
    // Add animation effect
    colorPicker.closest('.color-picker-wrapper').classList.add('changing');
    setTimeout(() => {
        colorPicker.closest('.color-picker-wrapper').classList.remove('changing');
    }, 300);

    // Update current theme
    currentTheme[variable] = newColor;
    
    // Update CSS custom property for live preview
    document.documentElement.style.setProperty(variable, newColor);
    
    // Update displayed value
    const valueElement = document.querySelector(`[data-value="${variable}"]`);
    if (valueElement) {
        valueElement.textContent = newColor;
    }

    console.log(`Updated ${variable} to ${newColor}`);
}

// Apply preset theme
function applyPresetTheme(themeName) {
    const theme = presetThemes[themeName];
    if (!theme) return;

    // Update active preset visual
    document.querySelectorAll('.preset-theme').forEach(preset => {
        preset.classList.toggle('active', preset.dataset.theme === themeName);
    });

    // Apply theme colors
    Object.entries(theme).forEach(([variable, value]) => {
        currentTheme[variable] = value;
        document.documentElement.style.setProperty(variable, value);
        
        // Update color picker if it exists
        const colorPicker = document.querySelector(`[data-variable="${variable}"]`);
        if (colorPicker) {
            colorPicker.value = convertToHex(value);
        }
        
        // Update displayed value
        const valueElement = document.querySelector(`[data-value="${variable}"]`);
        if (valueElement) {
            valueElement.textContent = value;
        }
    });

    showStatus(`Applied ${themeName.replace('-', ' ')} theme`, 'success');
}

// Show status message
function showStatus(message, type) {
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `status-message ${type}`;
        statusElement.style.display = 'flex';
        
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 3000);
    }
}

// Setup event listeners
function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.theme-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Color picker changes
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('color-picker')) {
            handleColorChange(e.target);
        }
    });

    // Preset theme selection
    document.querySelectorAll('.preset-theme').forEach(preset => {
        preset.addEventListener('click', () => applyPresetTheme(preset.dataset.theme));
    });

    // Modal backdrop click
    const themeModal = document.getElementById('themeModal');
    if (themeModal) {
        themeModal.addEventListener('click', (e) => {
            if (e.target.id === 'themeModal') {
                closeThemeModal();
            }
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('themeModal')?.classList.contains('active')) {
            closeThemeModal();
        }
    });
}

// Open theme modal
function openThemeModal() {
    const modal = document.getElementById('themeModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Load current theme and refresh UI
        loadCurrentTheme();
        generateColorInputs();
    }
}

// Close theme modal
function closeThemeModal() {
    const modal = document.getElementById('themeModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        
        // Revert to original theme if not saved
        Object.entries(originalTheme).forEach(([variable, value]) => {
            document.documentElement.style.setProperty(variable, value);
        });
    }
}

// Save theme by sending data to main process via window.electronAPI
function saveTheme() {
    try {
        // Check if electronAPI is available
        if (window.electronAPI && window.electronAPI.saveTheme) {
            window.electronAPI.saveTheme(currentTheme);
            
            // Update original theme to current
            originalTheme = { ...currentTheme };
            
            showStatus('Theme saved successfully!', 'success');
            
            // Optional: Restart app to fully apply changes
            setTimeout(() => {
                if (confirm('Theme saved! Would you like to restart the application to ensure all changes are applied?')) {
                    if (window.electronAPI && window.electronAPI.restartApp) {
                        window.electronAPI.restartApp();
                    }
                }
            }, 1000);
        } else {
            // Fallback: save to localStorage for preview
            localStorage.setItem('customTheme', JSON.stringify(currentTheme));
            originalTheme = { ...currentTheme };
            showStatus('Theme saved to browser storage!', 'success');
        }
        
    } catch (error) {
        console.error('Error saving theme:', error);
        showStatus('Error saving theme: ' + error.message, 'error');
    }
}

// Reset theme to original
function resetTheme() {
    if (confirm('Are you sure you want to reset the theme to default? This will discard all current changes.')) {
        // Reset to original elegant purple theme
        const defaultTheme = presetThemes['elegant-purple'];
        
        Object.entries(defaultTheme).forEach(([variable, value]) => {
            currentTheme[variable] = value;
            document.documentElement.style.setProperty(variable, value);
            
            // Update color picker
            const colorPicker = document.querySelector(`[data-variable="${variable}"]`);
            if (colorPicker) {
                colorPicker.value = convertToHex(value);
            }
            
            // Update displayed value
            const valueElement = document.querySelector(`[data-value="${variable}"]`);
            if (valueElement) {
                valueElement.textContent = value;
            }
        });

        // Reset preset selection
        document.querySelectorAll('.preset-theme').forEach(preset => {
            preset.classList.toggle('active', preset.dataset.theme === 'elegant-purple');
        });

        showStatus('Theme reset to default', 'success');
    }
}

// Initialize the theme customizer
function initThemeCustomizer() {
    loadCurrentTheme();
    generateColorInputs();
    setupEventListeners();
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initThemeCustomizer);

// Export functions for global access
window.openThemeModal = openThemeModal;
window.closeThemeModal = closeThemeModal;
window.saveTheme = saveTheme;
window.resetTheme = resetTheme;