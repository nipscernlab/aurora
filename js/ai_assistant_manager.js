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
        this.backdrop.classList.toggle('open');
        document.body.style.overflow = isOpen ? 'hidden' : '';
    }

    initialize() {
        this.backdrop = document.createElement('div');
        this.backdrop.id = 'ai-assistant-backdrop';
        this.backdrop.className = 'ai-assistant-backdrop';
        this.backdrop.addEventListener('click', () => this.toggle());
        document.body.appendChild(this.backdrop);

        this.container = document.createElement('div');
        this.container.className = 'ai-assistant-container';
        this.container.innerHTML = `
            <div class="ai-assistant-header">
                <div class="ai-header-left">
                    <img style="width:30px" src="./assets/icons/ai_gemini.webp" alt="AI Toggle" class="ai-toggle-icon">
                    <h3 class="ai-assistant-title">AI Assistant</h3>
                    <div class="ai-provider-section">
                        <img id="ai-provider-icon" src="./assets/icons/ai_chatgpt.svg" alt="Provider Icon" class="ai-provider-icon">
                        <select id="ai-provider-select" class="ai-provider-select">
                            <option value="chatgpt">ChatGPT</option>
                            <option value="claude">Claude</option>
                            <option value="gemini">Gemini</option>
                            <option value="deepseek">DeepSeek</option>
                        </select>
                    </div>
                </div>
                <button class="ai-assistant-close" aria-label="Close AI Assistant"><i class="fas fa-times"></i></button>
            </div>
            <div class="ai-assistant-content">
                <div class="ai-loading-overlay"><div class="ai-loading-spinner"></div></div>
                <webview class="ai-assistant-webview" src="https://chatgpt.com/?model=auto" nodeintegration="false" webSecurity="true"></webview>
                <div class="ai-resize-handle"></div>
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
            setTimeout(() => loadingOverlay.style.opacity = '0', 500);
        });
        
        this.setupResize(resizeHandle, this.container);
    }

    setupResize(handle, container) {
        let isResizing = false;
        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            let startX = e.clientX;
            let startWidth = parseInt(document.defaultView.getComputedStyle(container).width, 10);
            
            const doDrag = (e) => {
                if (!isResizing) return;
                const newWidth = Math.max(320, startWidth + (startX - e.clientX));
                container.style.width = newWidth + 'px';
            };
            
            const stopDrag = () => {
                isResizing = false;
                document.removeEventListener('mousemove', doDrag);
                document.removeEventListener('mouseup', stopDrag);
            };

            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
        });
    }
}

const aiAssistantManager = new AIAssistantManager();
export { aiAssistantManager };