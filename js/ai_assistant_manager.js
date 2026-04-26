// ai_assistant_manager.js

class AIAssistantManager {
    constructor() {
        this.container = null;
        this.backdrop = null;
        this.currentProvider = 'chatgpt';
    }

    toggle() {
        if (!this.container) this.initialize();

        const isOpen = this.container.classList.toggle('open');
        // No backdrop, no body scroll lock — user keeps coding while panel is open.
        document.body.classList.toggle('ai-assistant-open', isOpen);
    }

    initialize() {
        this.container = document.createElement('div');
        this.container.className = 'ai-assistant-container';
        this.container.innerHTML = `
            <div class="ai-assistant-header">
                <div class="ai-header-left">
                    <span class="ai-assistant-mark">
                        <img id="ai-provider-icon" src="./assets/icons/ai_chatgpt.svg" alt="" class="ai-provider-icon">
                    </span>
                    <h3 class="ai-assistant-title">AI Assistant</h3>
                </div>
                <div class="ai-header-right">
                    <div class="ai-provider-section">
                        <select id="ai-provider-select" class="ai-provider-select">
                            <option value="chatgpt">ChatGPT</option>
                            <option value="claude">Claude</option>
                            <option value="gemini">Gemini</option>
                            <option value="deepseek">DeepSeek</option>
                        </select>
                        <i class="ph ph-caret-down ai-provider-caret" aria-hidden="true"></i>
                    </div>
                    <button class="ai-assistant-close" aria-label="Close AI Assistant">
                        <i class="ph ph-x"></i>
                    </button>
                </div>
            </div>
            <div class="ai-assistant-content">
                <div class="ai-loading-overlay">
                    <div class="ai-loading-spinner"></div>
                    <span class="ai-loading-text">Loading conversation…</span>
                </div>
                <webview class="ai-assistant-webview" src="https://chatgpt.com/?model=auto" nodeintegration="false" webSecurity="true"></webview>
                <div class="ai-resize-handle" aria-label="Resize AI panel"></div>
            </div>`;
        document.body.appendChild(this.container);

        this.addEventListeners();
    }

    addEventListeners() {
        const header = this.container.querySelector('.ai-assistant-header');
        const closeButton = header.querySelector('.ai-assistant-close');
        const providerSelect = header.querySelector('#ai-provider-select');
        const providerIcon = header.querySelector('#ai-provider-icon');
        const webview = this.container.querySelector('webview');
        const loadingOverlay = this.container.querySelector('.ai-loading-overlay');
        const resizeHandle = this.container.querySelector('.ai-resize-handle');

        closeButton.addEventListener('click', () => this.toggle());

        providerSelect.addEventListener('change', (e) => {
            this.currentProvider = e.target.value;
            loadingOverlay.style.opacity = '1';
            loadingOverlay.style.pointerEvents = 'auto';
            loadingOverlay.classList.remove('hidden');
            providerIcon.style.opacity = '0';
            
            const urlMap = { chatgpt: 'https://chatgpt.com/?model=auto', claude: 'https://claude.ai', gemini: 'https://gemini.google.com/', deepseek: 'https://www.deepseek.com/' };
            const iconMap = { chatgpt: './assets/icons/ai_chatgpt.svg', gemini: './assets/icons/ai_gemini.webp', claude: './assets/icons/ai_claude.svg', deepseek: './assets/icons/ai_deepseek.svg' };

            webview.src = urlMap[this.currentProvider];
            setTimeout(() => {
                providerIcon.src = iconMap[this.currentProvider];
                providerIcon.onload = () => providerIcon.style.opacity = '1';
            }, 150);
        });

        webview.addEventListener('dom-ready', () => {
            setTimeout(() => {
                loadingOverlay.style.opacity = '0';
                loadingOverlay.style.pointerEvents = 'none';
                loadingOverlay.classList.add('hidden');
            }, 500);
        });
        
        this.setupResize(resizeHandle, this.container);
    }

    setupResize(handle, container) {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            let active = true;
            let raf = null;
            const startX = e.clientX;
            const startWidth = parseInt(document.defaultView.getComputedStyle(container).width, 10);

            document.body.classList.add('resizing-vertical');

            const onMove = (ev) => {
                if (!active) return;
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => {
                    const newWidth = Math.max(320, Math.min(startWidth + (startX - ev.clientX), window.innerWidth * 0.6));
                    container.style.width = newWidth + 'px';
                });
            };

            const onUp = () => {
                active = false;
                document.body.classList.remove('resizing-vertical');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (raf) cancelAnimationFrame(raf);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }
}

const aiAssistantManager = new AIAssistantManager();
export { aiAssistantManager };