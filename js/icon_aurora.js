/**
 * Aurora Icon Manager
 * Manages loading, storing, and displaying the application icon across multiple
 * elements with support for fallback and persistence using localStorage.
 */
(() => {
    // Constants
    const DEFAULT_ICON_PATH = './assets/icons/sapho_aurora_icon.svg';
    const IMAGE_KEY = 'auroraIconPath';
    const IMAGE_DATA_KEY = 'auroraIconData';

    // DOM Elements - These will be collections of all matching elements
    let iconUploadInput;
    let auroraIcons;
    let fallbackIcons;

    /**
     * Updates all aurora icon images with the new source.
     * @param {string} iconSrc - The image source (DataURL or path).
     */
    function showIcons(iconSrc) {
        console.log(`Updating ${auroraIcons.length} icon(s)`);

        auroraIcons.forEach(icon => {
            // Set up handlers for each icon instance
            icon.onload = () => {
                icon.style.display = 'inline-block';
                isIconLoaded = true;
            };
            icon.onerror = () => {
                console.error(`Failed to load icon: ${iconSrc.substring(0, 30)}...`);
                if (iconSrc !== DEFAULT_ICON_PATH) {
                    loadDefaultIcon();
                } else {
                    showFallbackIcons();
                }
            };
            // Set the source to trigger load/error
            icon.src = iconSrc;
        });

        // Hide all fallback icons
        fallbackIcons.forEach(icon => icon.style.display = 'none');
    }

    /**
     * Displays the fallback icon for all instances.
     */
    function showFallbackIcons() {
        auroraIcons.forEach(icon => icon.style.display = 'none');
        fallbackIcons.forEach(icon => icon.style.display = 'inline-block');
        isIconLoaded = false;
    }

    /**
     * Saves the icon's DataURL and optional file path to localStorage.
     * @param {string} dataURL 
     * @param {string} [filePath] 
     */
    function saveIconData(dataURL, filePath) {
        try {
            localStorage.setItem(IMAGE_DATA_KEY, dataURL);
            if (filePath) {
                localStorage.setItem(IMAGE_KEY, filePath);
            }
        } catch (err) {
            console.error('Error saving data to localStorage:', err);
        }
    }

    /**
     * Resets all icons to the default image and clears storage.
     */
    function loadDefaultIcon() {
        console.log('Loading default icon for all instances');
        localStorage.removeItem(IMAGE_KEY);
        localStorage.removeItem(IMAGE_DATA_KEY);
        showIcons(DEFAULT_ICON_PATH);
    }

    /**
     * Loads the icon from localStorage and applies it to all instances.
     */
    function loadPersistedIcon() {
        const iconDataURL = localStorage.getItem(IMAGE_DATA_KEY);
        if (iconDataURL) {
            console.log('Found DataURL in localStorage, applying to all instances');
            showIcons(iconDataURL);
        } else {
            console.log('No icon found in localStorage, loading default.');
            loadDefaultIcon();
        }
    }

    /**
     * Processes a new user-selected image file.
     * @param {File} file 
     */
    function processNewIcon(file) {
        if (!file || !file.type.startsWith('image/')) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const dataURL = e.target.result;
            const filePath = file.path; // Available in Electron
            saveIconData(dataURL, filePath);
            showIcons(dataURL);
        };
        reader.onerror = function() {
            console.error('Error reading image file');
        };
        reader.readAsDataURL(file);
    }

    /**
     * Initializes the module, finds all elements, and sets up event listeners.
     */
    function init() {
        // Cache collections of DOM elements using classes
        iconUploadInput = document.getElementById('icon-upload');
        auroraIcons = document.querySelectorAll('.aurora-icon');
        fallbackIcons = document.querySelectorAll('.fallback-icon');

        if (!iconUploadInput || auroraIcons.length === 0) {
            console.error('Aurora Icon Manager: Required elements (.aurora-icon or #icon-upload) not found.');
            return;
        }

        // --- Event Listeners using Delegation ---

        // Listen for clicks on any "change icon" button
        document.addEventListener('click', (event) => {
            if (event.target.closest('.change-icon-btn')) {
                iconUploadInput.click();
            }
        });

        // Listen for a new file selection from the single input
        iconUploadInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                processNewIcon(file);
            }
        });
        
        // Listen for double right-clicks on any icon container to reset
        document.addEventListener('contextmenu', (event) => {
            const container = event.target.closest('.icon-container');
            if (!container) return;

            event.preventDefault();
            const now = Date.now();
            const DOUBLE_CLICK_DELAY = 400;

            if (now - (container.lastRightClick || 0) < DOUBLE_CLICK_DELAY) {
                console.log('Double right-click detected, resetting icon.');
                loadDefaultIcon();
                container.lastRightClick = null; // Reset timer
            } else {
                container.lastRightClick = now;
            }
        });

        console.log('Initializing Aurora Icon Manager for all instances');
        loadPersistedIcon();
    }

    // Run initialization after the DOM is fully loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();