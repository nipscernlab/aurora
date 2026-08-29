/**
 * viewer_preference.js: Qual visualizador de ondas o botao Wave abre.
 *
 * Default: gtkwave (o fork nipscern bundlado; janela EXTERNA, monitorada por
 * poll). Alternativa: surfer (viewer moderno Rust→WASM, embutivel na IDE; lê o
 * mesmo VCD/FST). A escolha e do usuario, global, persistida em localStorage:
 * espelha simulator_preference.js exatamente.
 *
 * Quem le: js/compilation/compilation_module.js (branch no passo Wave).
 * Quem escreve: o toggle da toolbar (viewer_toggle.js) e a AuroraAPI
 * (Aurora Intelligence via set_waveform_viewer).
 */

const STORAGE_KEY = 'aurora.waveViewer';
const VALID = new Set(['gtkwave', 'surfer']);

/**
 * Le a escolha atual. 'gtkwave' como fallback se nada salvo / valor invalido.
 * Nunca lanca, chamado em hot path (cada clique no Wave).
 */
export function getViewer() {
    try {
        const v = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null;
        return VALID.has(v) ? v : 'gtkwave';
    } catch (_e) {
        return 'gtkwave';
    }
}

/** Persiste a escolha. Valores invalidos normalizam pra 'gtkwave'. Idempotente. */
export function setViewer(value) {
    const normalized = VALID.has(value) ? value : 'gtkwave';
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, normalized);
        }
    } catch (_e) { /* storage cheio / private mode — ignora */ }
    return normalized;
}

/**
 * Onde o Surfer abre: 'tab' (dentro do editor, o padrao, quando o bundle web
 * existe) ou 'window' (a janela nativa do Surfer). So vale quando o
 * visualizador escolhido e o Surfer; o GTKWave e sempre janela. A escolha mora
 * nas Configuracoes, ao lado da do PRISM (prism_mode.js).
 */
const SURFER_MODE_KEY = 'aurora.surferMode';
const SURFER_MODES = new Set(['tab', 'window']);

export function getSurferMode() {
    try {
        const v = (typeof localStorage !== 'undefined') ? localStorage.getItem(SURFER_MODE_KEY) : null;
        return SURFER_MODES.has(v) ? v : 'tab';
    } catch (_e) {
        return 'tab';
    }
}

export function setSurferMode(value) {
    const v = SURFER_MODES.has(value) ? value : 'tab';
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(SURFER_MODE_KEY, v); } catch (_e) { /* ignora */ }
    return v;
}
