/**
 * Aurora Icon Manager
 *
 * Dono unico do icone do aplicativo: le e grava a escolha do usuario no
 * localStorage e a aplica onde o logo aparece.
 *
 * Sao dois caminhos de entrega, e os dois precisam existir. Os elementos do
 * DOM claro (`.aurora-icon`) recebem o `src` direto daqui. Quem vive dentro
 * de um shadow root, como a marca-d'agua da <aurora-welcome>, e invisivel
 * para `document.querySelectorAll`, entao escuta o evento
 * `aurora:icon-changed` e troca o proprio `src`; `window.auroraIconSrc`
 * guarda o valor corrente para quem montar depois do evento ter passado.
 *
 * Ate 03/09/2026 so o quadrado de previa das configuracoes tinha a classe:
 * trocar a imagem la nao mudava nada em lugar nenhum, embora a descricao do
 * ajuste prometesse o contrario. A marca-d'agua tinha ido para dentro do
 * shadow DOM quando a tela inicial virou componente, e a marca da barra e o
 * logo do Sobre nunca tiveram a classe.
 */
(() => {
    // Constants
    // Absoluta, resolvida contra o documento: a mesma forma que a
    // <aurora-welcome> usa. Relativa, o valor dependia de quem chamava.
    const DEFAULT_ICON_PATH = new URL('assets/icons/sapho_aurora_icon.svg', document.baseURI).href;
    const IMAGE_KEY = 'auroraIconPath';
    const IMAGE_DATA_KEY = 'auroraIconData';

    // DOM Elements - These will be collections of all matching elements
    let iconUploadInput;
    let auroraIcons;
    let fallbackIcons;
    let _isIconLoaded = false;

    /**
     * Updates all aurora icon images with the new source.
     * @param {string} iconSrc - The image source (DataURL or path).
     */
    function showIcons(iconSrc) {
        console.log(`Updating ${auroraIcons.length} icon(s)`);

        auroraIcons.forEach(icon => {
            // Watermark/decorative icons (welcome screen, future hero images)
            // get their display set by their own CSS, touching `display`
            // here would break absolute positioning. Settings/UI icons rely
            // on this module to reveal them on load.
            const isDecorative = icon.classList.contains('welcome-watermark')
                || icon.hasAttribute('data-decorative-icon');
            icon.onload = () => {
                if (!isDecorative) icon.style.display = 'inline-block';
                _isIconLoaded = true;
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

        // Quem vive em shadow DOM nao e alcancavel daqui; o evento e o
        // caminho ate ele, e a variavel atende quem montar depois.
        window.auroraIconSrc = iconSrc;
        window.dispatchEvent(new CustomEvent('aurora:icon-changed', { detail: { src: iconSrc } }));
    }

    /**
     * Displays the fallback icon for all instances. Watermarks/decoratives
     * stay visible (their src already failed; CSS handles their appearance).
     */
    function showFallbackIcons() {
        auroraIcons.forEach(icon => {
            const isDecorative = icon.classList.contains('welcome-watermark')
                || icon.hasAttribute('data-decorative-icon');
            if (!isDecorative) icon.style.display = 'none';
        });
        fallbackIcons.forEach(icon => icon.style.display = 'inline-block');
        _isIconLoaded = false;
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
        // Os elementos do DOM claro que carregam o logo: a previa das
        // configuracoes, a marca da barra de titulo e o logo do Sobre. Os
        // dois ultimos sao decorativos (`data-decorative-icon`), entao o
        // showIcons nao mexe no `display` deles, que e do CSS.
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
                return;
            }
            // Reset button, wipe stored override and reload the bundled
            // default. Lives next to the change-icon-btn inside
            // .icon-actions; see index.html and aurora_settings.css.
            if (event.target.closest('.reset-icon-btn')) {
                loadDefaultIcon();
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