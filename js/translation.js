// i18n.js - Internationalization system
class I18nManager {
    constructor() {
        this.currentLanguage = this.getSavedLanguage() || 'en';
        this.translations = {};
        this.languageDropdown = null;
        this.isDropdownOpen = false;
        this.availableLanguages = {
            'en': { name: 'English', flag: '🇺🇸' },
            'pt': { name: 'Português', flag: '🇧🇷' },
            'fr': { name: 'Français', flag: '🇫🇷' },
            'no': { name: 'Norsk', flag: '🇳🇴' },
            'ru': { name: 'Русский', flag: '🇷🇺' }
        };
        
        this.init();
    }

    getSavedLanguage() {
        try {
            // Try to get from localStorage first
            const savedLang = localStorage.getItem('aurora-language');
            if (savedLang && this.isValidLanguage(savedLang)) {
                return savedLang;
            }
            
            // In Electron, you might also want to check system preferences
            if (typeof navigator !== 'undefined' && navigator.language) {
                const browserLang = navigator.language.split('-')[0];
                if (this.isValidLanguage(browserLang)) {
                    return browserLang;
                }
            }
            
            return 'en'; // Default fallback
        } catch (error) {
            console.warn('Failed to get saved language:', error);
            return 'en';
        }
    }

    isValidLanguage(langCode) {
        return Object.keys(this.availableLanguages).includes(langCode);
    }

    saveLanguagePreference(languageCode) {
        try {
            localStorage.setItem('aurora-language', languageCode);
            console.log(`Language preference saved: ${languageCode}`);
            
            // Only try to save to Electron if the API is available and the function exists
            if (typeof window !== 'undefined' && 
                window.electronAPI && 
                typeof window.electronAPI.saveUserPreference === 'function') {
                try {
                    window.electronAPI.saveUserPreference('language', languageCode);
                    console.log('Language preference also saved to Electron config');
                } catch (electronError) {
                    console.warn('Failed to save to Electron config:', electronError);
                }
            }
        } catch (error) {
            console.error('Failed to save language preference:', error);
        }
    }

    async init() {
        // Load translations
        await this.loadTranslations();
        
        // Create language dropdown
        this.createLanguageDropdown();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Apply initial language
        this.applyLanguage(this.currentLanguage);
    }

    async loadTranslations() {
        try {
            // Load translations from JSON file
            const response = await fetch('./saphoComponents/Scripts/babilonia.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.translations = await response.json();
            console.log('Translations loaded successfully');
        } catch (error) {
            console.error('Failed to load translations:', error);
            // Fallback to empty translations object
            this.translations = {};
        }
    }

    createLanguageDropdown() {
        // Create dropdown container
        const dropdown = document.createElement('div');
        dropdown.id = 'language-dropdown';
        dropdown.className = 'language-dropdown';
        
        // Create dropdown list
        const dropdownList = document.createElement('ul');
        dropdownList.className = 'language-dropdown-list';
        
        // Add languages to dropdown
        Object.entries(this.availableLanguages).forEach(([code, info]) => {
            const listItem = document.createElement('li');
            listItem.className = 'language-dropdown-item';
            listItem.setAttribute('tabindex', '0'); // Make keyboard accessible
            listItem.setAttribute('role', 'option');
            
            // Mark current language as selected
            if (code === this.currentLanguage) {
                listItem.classList.add('selected');
            }
            
            listItem.innerHTML = `
                <span class="language-flag">${info.flag}</span>
                <span class="language-name">${info.name}</span>
            `;
            
            // Mouse events
            listItem.addEventListener('click', () => this.changeLanguage(code));
            
            // Keyboard events for accessibility
            listItem.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.changeLanguage(code);
                }
            });
            
            dropdownList.appendChild(listItem);
        });
        
        dropdown.appendChild(dropdownList);
        
        // Insert dropdown after the translate button
        const translateButton = document.getElementById('translate');
        translateButton.parentNode.insertBefore(dropdown, translateButton.nextSibling);
        
        this.languageDropdown = dropdown;
    }

    setupEventListeners() {
        const translateButton = document.getElementById('translate');
        
        // Toggle dropdown on button click
        translateButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.languageDropdown.contains(e.target) && !translateButton.contains(e.target)) {
                this.closeDropdown();
            }
        });
        
        // Close dropdown on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isDropdownOpen) {
                this.closeDropdown();
            }
        });
    }

    toggleDropdown() {
        if (this.isDropdownOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    openDropdown() {
        this.languageDropdown.classList.add('open');
        this.isDropdownOpen = true;
        
        // Add fade-in animation
        this.languageDropdown.style.opacity = '0';
        this.languageDropdown.style.transform = 'translateY(-10px)';
        
        requestAnimationFrame(() => {
            this.languageDropdown.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            this.languageDropdown.style.opacity = '1';
            this.languageDropdown.style.transform = 'translateY(0)';
        });
    }

    closeDropdown() {
        this.languageDropdown.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        this.languageDropdown.style.opacity = '0';
        this.languageDropdown.style.transform = 'translateY(-10px)';
        
        setTimeout(() => {
            this.languageDropdown.classList.remove('open');
            this.isDropdownOpen = false;
        }, 300);
    }

    updateSelectedLanguageInDropdown() {
        const dropdownItems = document.querySelectorAll('.language-dropdown-item');
        dropdownItems.forEach((item, index) => {
            const langCode = Object.keys(this.availableLanguages)[index];
            if (langCode === this.currentLanguage) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }

    async changeLanguage(languageCode) {
        if (languageCode === this.currentLanguage) {
            this.closeDropdown();
            return;
        }

        // Add loading state
        this.addLoadingState();
        
        try {
            // Simulate loading delay for smooth fade effect
            await new Promise(resolve => setTimeout(resolve, 200));
            
            this.currentLanguage = languageCode;
            await this.applyLanguage(languageCode);
            
            // Save preference locally and to Electron config
            this.saveLanguagePreference(languageCode);
            
            // Update dropdown selection
            this.updateSelectedLanguageInDropdown();
            
            // Dispatch custom event for other components
            this.dispatchLanguageChangeEvent(languageCode);
            
        } catch (error) {
            console.error('Failed to change language:', error);
            // Show user-friendly error notification
            this.showErrorNotification('Failed to change language. Please try again.');
        } finally {
            this.removeLoadingState();
            this.closeDropdown();
        }
    }

    dispatchLanguageChangeEvent(languageCode) {
        const event = new CustomEvent('languageChanged', {
            detail: { 
                language: languageCode,
                languageInfo: this.availableLanguages[languageCode]
            }
        });
        document.dispatchEvent(event);
    }

    showErrorNotification(message) {
        // Create a modern notification toast
        const notification = document.createElement('div');
        notification.className = 'language-error-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${message}</span>
            </div>
        `;
        
        // Add notification styles
        notification.style.cssText = `
            position: fixed;
            top: var(--space-4);
            right: var(--space-4);
            background: var(--error);
            color: white;
            padding: var(--space-3) var(--space-4);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            z-index: var(--z-max);
            font-family: var(--font-sans);
            font-size: var(--text-sm);
            font-weight: var(--font-medium);
            opacity: 0;
            transform: translateY(-10px);
            transition: all var(--transition-normal);
        `;
        
        document.body.appendChild(notification);
        
        // Animate in
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateY(0)';
        });
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(-10px)';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    addLoadingState() {
        const translateButton = document.getElementById('translate');
        translateButton.classList.add('loading');
        translateButton.style.opacity = '0.6';
        translateButton.style.pointerEvents = 'none';
    }

    removeLoadingState() {
        const translateButton = document.getElementById('translate');
        translateButton.classList.remove('loading');
        translateButton.style.opacity = '1';
        translateButton.style.pointerEvents = 'auto';
    }

    async applyLanguage(languageCode) {
        const translations = this.translations[languageCode];
        if (!translations) {
            console.error(`Translations not found for language: ${languageCode}`);
            return;
        }

        // Add fade out effect
        document.body.style.transition = 'opacity 0.2s ease';
        document.body.style.opacity = '0.8';

        // Update all elements with data-i18n attribute
        const elementsWithI18n = document.querySelectorAll('[data-i18n]');
        elementsWithI18n.forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translatedText = this.getNestedTranslation(translations, key);
            if (translatedText) {
                element.textContent = translatedText;
            }
        });

        // Update all elements with data-i18n-title attribute (tooltips)
        const elementsWithI18nTitle = document.querySelectorAll('[data-i18n-title]');
        elementsWithI18nTitle.forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            const translatedText = this.getNestedTranslation(translations, key);
            if (translatedText) {
                element.setAttribute('title', translatedText);
            }
        });

        // Update all elements with data-i18n-placeholder attribute
        const elementsWithI18nPlaceholder = document.querySelectorAll('[data-i18n-placeholder]');
        elementsWithI18nPlaceholder.forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const translatedText = this.getNestedTranslation(translations, key);
            if (translatedText) {
                element.setAttribute('placeholder', translatedText);
            }
        });

        // Fade back in
        setTimeout(() => {
            document.body.style.opacity = '1';
            setTimeout(() => {
                document.body.style.transition = '';
            }, 200);
        }, 100);
    }

    getNestedTranslation(translations, key) {
        return key.split('.').reduce((obj, k) => obj && obj[k], translations);
    }

    // Method to get current language
    getCurrentLanguage() {
        return this.currentLanguage;
    }

    // Method to get translation by key
    t(key) {
        const translations = this.translations[this.currentLanguage];
        return this.getNestedTranslation(translations, key) || key;
    }
}

// Initialize i18n when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.i18n = new I18nManager();
});

// Export for use in other modules (if using modules)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = I18nManager;
}