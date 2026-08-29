/**
 * prism_mode.js: onde o PRISM abre, numa janela propria ou numa aba do editor.
 *
 * O Surfer oferece a escolha, dentro ou fora do Monaco, e o PRISM oferece a
 * mesma. A escolha mora nas Configuracoes, ao lado da do Surfer, e nao na
 * toolbar: e uma preferencia que se muda uma vez, e um interruptor na barra
 * era mais um botao a ler a cada compilacao. Guardada em localStorage como a
 * do visualizador de ondas (viewer_preference.js). Quem le e o
 * compilation_flow, na hora do clique.
 *
 * Padrao: janela. E o que sempre existiu; a aba e uma escolha.
 */

const STORAGE_KEY = 'aurora.prismMode';
const VALID = new Set(['window', 'tab']);

/** 'window' ou 'tab'. Nunca lanca. */
export function getPrismMode() {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return VALID.has(v) ? v : 'window';
    } catch (_) {
        return 'window';
    }
}

export function setPrismMode(value) {
    const v = VALID.has(value) ? value : 'window';
    try { localStorage.setItem(STORAGE_KEY, v); } catch (_) { /* storage indisponivel */ }
    window.dispatchEvent(new CustomEvent('aurora:prism-mode-changed', { detail: { mode: v } }));
    return v;
}
