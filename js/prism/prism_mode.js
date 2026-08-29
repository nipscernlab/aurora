/**
 * prism_mode.js: onde o PRISM abre, numa janela propria ou numa aba do editor.
 *
 * O Surfer ja oferece a escolha, dentro ou fora do Monaco, e o PRISM passa a
 * oferecer a mesma, pelo mesmo gesto: um interruptor de dois segmentos ao lado
 * do botao, guardado em localStorage como a preferencia do visualizador de
 * ondas (viewer_preference.js). Quem le e o compilation_flow, na hora do
 * clique; quem escreve e o interruptor.
 *
 * Padrao: janela. E o que sempre existiu, e uma aba dentro do editor e uma
 * escolha de quem prefere nao trocar de janela, nao uma imposicao.
 */
import { showCardNotification } from '../ui/notification.js';

const STORAGE_KEY = 'aurora.prismMode';
const VALID = new Set(['window', 'tab']);

const tr = (k, fallback) => {
    const t = window.t ? window.t(k) : k;
    return t === k ? fallback : t;
};

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
    return v;
}

let lastAnnounced = getPrismMode();
function announce(mode) {
    if (mode === lastAnnounced) return;
    lastAnnounced = mode;
    showCardNotification(
        mode === 'tab' ? tr('toolbar.prismMode.nowTab', 'PRISM: in an editor tab')
                       : tr('toolbar.prismMode.nowWindow', 'PRISM: in its own window'),
        'info', 4000, 'PRISM');
}

function render(segments) {
    const mode = getPrismMode();
    for (const seg of segments) {
        const active = seg.dataset.prismMode === mode;
        seg.classList.toggle('active', active);
        seg.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
}

function init() {
    const sw = document.getElementById('prismModeSwitch');
    const segments = sw ? Array.from(sw.querySelectorAll('.prism-mode-seg')) : [];
    if (!segments.length) return;
    render(segments);
    for (const seg of segments) {
        seg.addEventListener('click', () => {
            const applied = setPrismMode(seg.dataset.prismMode);
            render(segments);
            window.dispatchEvent(new CustomEvent('aurora:prism-mode-changed', { detail: { mode: applied } }));
        });
    }
    window.addEventListener('aurora:prism-mode-changed', (e) => {
        render(segments);
        announce(e?.detail?.mode || getPrismMode());
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
