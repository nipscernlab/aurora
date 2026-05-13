/**
 * locale_toggle.js — Toolbar button that flips Aurora's active locale
 * (PT ↔ EN). Replaces the yanc-only toggle: now controls UI strings
 * AND the -pt/-en flag passed to cmmcomp/appcomp/asmcomp, since the
 * preference is unified under `aurora-locale`.
 *
 * State lives in i18n.js (localStorage `aurora-locale`); this file
 * is purely the visual control: render label/tooltip, call
 * `window.setLocale`, react to `aurora:locale-changed` so the label
 * stays in sync if the locale flips from elsewhere.
 */

const LABELS = {
    pt: { label: 'PT', tooltipKey: 'locale.compilerMessages.pt' },
    en: { label: 'EN', tooltipKey: 'locale.compilerMessages.en' },
};

class LocaleToggle {
    constructor() {
        this.btn = null;
        this.labelEl = null;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._init(), { once: true });
        } else {
            this._init();
        }
    }

    _init() {
        this.btn = document.getElementById('localeToggle');
        this.labelEl = document.getElementById('localeLabel');
        if (!this.btn || !this.labelEl) {
            console.warn('LocaleToggle: button or label not found');
            return;
        }
        this._render(window.getLocale ? window.getLocale() : 'pt');
        this.btn.addEventListener('click', () => this._toggle());
        // Stay in sync if another component flips the locale.
        window.addEventListener('aurora:locale-changed', (e) => this._render(e.detail.locale));
    }

    _toggle() {
        const current = window.getLocale ? window.getLocale() : 'pt';
        const next = current === 'pt' ? 'en' : 'pt';
        if (window.setLocale) window.setLocale(next);
    }

    _render(lang) {
        const conf = LABELS[lang] || LABELS.pt;
        this.labelEl.textContent = conf.label;
        // Bind via data-i18n-tooltip so applyDOM() resolves the
        // current locale's string for the tooltip. Keep data-tooltip
        // populated as a fallback in case i18n hasn't loaded yet.
        this.btn.setAttribute('data-i18n-tooltip', conf.tooltipKey);
        if (window.t) this.btn.setAttribute('data-tooltip', window.t(conf.tooltipKey));
    }
}

const localeToggle = new LocaleToggle();
window.localeToggle = localeToggle;
