/**
 * surfer_window_preference.js: Quantas janelas do Surfer o botao Wave mantem.
 *
 * Default: false (uma janela so, a AURORA fecha a janela anterior antes de
 * abrir a nova, pra nao empilhar janelas a cada simulacao). Quando true,
 * permite VARIAS janelas abertas ao mesmo tempo, pra comparar resultados de
 * simulacoes diferentes lado a lado (a anterior NAO e fechada).
 *
 * Escolha do usuario, global, persistida em localStorage, espelha
 * viewer_preference.js / simulator_preference.js.
 *
 * Quem le: js/compilation/compilation_module.js (_waveLaunchSurfer passa a flag
 *   pro launch-surfer no main, que decide fechar ou nao a janela anterior).
 * Quem escreve: o checkbox do modal Wave Configuration (wave_config_manager.js).
 *
 * So afeta o Surfer, o GTKWave tem seu proprio ciclo de janela.
 */

const STORAGE_KEY = 'aurora.surferMultiWindow';

/**
 * true = permitir varias janelas do Surfer (comparar); false = uma janela so.
 * Default false. Nunca lanca, chamado no hot path (cada clique no Wave).
 */
export function getSurferMultiWindow() {
    try {
        return (typeof localStorage !== 'undefined')
            && localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (_e) {
        return false;
    }
}

/** Persiste a escolha (coage pra boolean). Idempotente, nunca lanca. */
export function setSurferMultiWindow(value) {
    const normalized = value === true;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, normalized ? 'true' : 'false');
        }
    } catch (_e) { /* storage cheio / private mode — ignora */ }
    return normalized;
}
