/**
 * locale_toggle.js — Binds the language <select> in Aurora Settings to
 * the active locale (PT ↔ EN).
 *
 * The locale toggle used to live in the toolbar as a PT/EN button; it was
 * moved into Settings → Language because the toolbar was running out of
 * horizontal room and a dedicated select reads better at small widths
 * (full names, no ambiguous abbreviation).
 *
 * The locale itself still controls BOTH UI strings (via i18n.js /
 * `aurora-locale`) AND the yanc compiler flag (-pt/-en), since the
 * preference is intentionally unified. This file is purely the visual
 * control: render the select value, call `window.setLocale`, react to
 * `aurora:locale-changed` so the select stays in sync if the locale
 * flips from elsewhere.
 */

class LocaleToggle {
    constructor() {
        this.select = null;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._init(), { once: true });
        } else {
            this._init();
        }
    }

    _init() {
        this.select = document.getElementById('settings-language-select');
        if (!this.select) {
            // Settings modal is part of index.html so the select is always
            // in the DOM — a missing element here means a structural
            // regression, not a normal "feature off" path. Log loudly.
            console.warn('LocaleToggle: #settings-language-select not found');
            return;
        }
        this._render(window.getLocale ? window.getLocale() : 'pt');
        this.select.addEventListener('change', (e) => {
            const next = e.target.value === 'en' ? 'en' : 'pt';
            if (window.setLocale) window.setLocale(next);
        });
        // Stay in sync if another component flips the locale.
        window.addEventListener('aurora:locale-changed', (e) => this._render(e.detail.locale));
    }

    _render(lang) {
        const normalized = lang === 'en' ? 'en' : 'pt';
        if (this.select.value !== normalized) {
            this.select.value = normalized;
        }
    }
}

const localeToggle = new LocaleToggle();
window.localeToggle = localeToggle;
