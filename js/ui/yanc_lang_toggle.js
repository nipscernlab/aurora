/**
 * yanc_lang_toggle.js — toggle Portuguese/English nas mensagens dos
 * compiladores yanc (cmmcomp / appcomp / asmcomp).
 *
 * O toolbar button na zona direita gira entre 'pt' e 'en'; o valor
 * vive em localStorage com a chave LANG_STORAGE_KEY. compilation_module
 * le esse valor antes de invocar cada .exe e injeta `-pt` ou `-en` no
 * comando (flag unica, no novo formato do yanc).
 *
 * Preferencia global (nao per-project) — uma vez que voce escolhe a
 * lingua, ela vale pra todos os projetos. Faz sentido: e setting do
 * IDE, nao do projeto.
 */

const LANG_STORAGE_KEY = 'aurora-yanc-lang';
const LANG_DEFAULT = 'pt';
const LANG_LABELS = {
    pt: { label: 'PT', tooltip: 'Compiler messages: Portuguese' },
    en: { label: 'EN', tooltip: 'Compiler messages: English' },
};

function readLang() {
    try {
        const v = localStorage.getItem(LANG_STORAGE_KEY);
        return v === 'en' || v === 'pt' ? v : LANG_DEFAULT;
    } catch {
        return LANG_DEFAULT;
    }
}

function writeLang(lang) {
    try {
        localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
        // localStorage indisponivel (modo privado, etc) — silencioso.
    }
}

class YancLangToggle {
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
        this.btn = document.getElementById('yancLangToggle');
        this.labelEl = document.getElementById('yancLangLabel');
        if (!this.btn || !this.labelEl) {
            console.warn('YancLangToggle: button or label not found');
            return;
        }
        this._render(readLang());
        this.btn.addEventListener('click', () => this._toggle());
    }

    _toggle() {
        const next = readLang() === 'pt' ? 'en' : 'pt';
        writeLang(next);
        this._render(next);
    }

    _render(lang) {
        const conf = LANG_LABELS[lang] || LANG_LABELS[LANG_DEFAULT];
        this.labelEl.textContent = conf.label;
        this.btn.setAttribute('data-tooltip', conf.tooltip);
    }
}

const yancLangToggle = new YancLangToggle();
window.yancLangToggle = yancLangToggle;

// Expor uma funcao standalone pros consumidores (compilation_module)
// nao precisarem mexer em localStorage diretamente. Falha-segura:
// retorna o default se algo der errado.
window.getYancLang = readLang;
