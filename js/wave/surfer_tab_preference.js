/**
 * surfer_tab_preference.js: o Surfer abre numa aba do editor ou em janela?
 *
 * Default: true (aba). O visualizador dentro do editor mantem o fluxo
 * compilar→olhar a onda→voltar ao codigo sem trocar de janela, entao ele e o
 * comportamento de fabrica. Quem desmarcar no modal Wave Configuration volta
 * ao Surfer como programa a parte, exatamente o comportamento anterior — e a
 * opcao de varias janelas (surfer_window_preference.js) so se aplica la,
 * porque a aba e uma so por definicao.
 *
 * A aba tambem exige o bundle web instalado (components/Packages/surfer/web);
 * quem decide a queda para janela quando ele falta e o chamador, consultando
 * electronAPI.surferTabAvailable(), porque este modulo roda no hot path do
 * botao Wave e nao pode fazer IPC.
 *
 * Escolha do usuario, global, persistida em localStorage, espelha
 * viewer_preference.js / surfer_window_preference.js.
 */

const STORAGE_KEY = 'aurora.surferInTab';

/**
 * true = abrir o Surfer numa aba do editor (default); false = janela nativa.
 * Nunca lanca, chamado no hot path (cada clique no Wave).
 */
export function getSurferInTab() {
    try {
        if (typeof localStorage === 'undefined') return true;
        return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch (_e) {
        return true;
    }
}

/** Persiste a escolha (coage pra boolean). Idempotente, nunca lanca. */
export function setSurferInTab(value) {
    const normalized = value === true;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, normalized ? 'true' : 'false');
        }
    } catch (_e) {
        // localStorage indisponivel: a sessao segue com o default.
    }
}
