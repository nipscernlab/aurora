/**
 * status_bar.js — Renderiza o estado do design (top-level / testbench)
 * na zona direita da status bar.
 *
 * Le `structure.topLevelFile` e `structure.testbenchFile` do .spf do
 * projeto aberto. Tres estados:
 *   - ambos vazios (ou sem projeto): mostra apenas #designEmptyStatus
 *     com X "No top-level or testbench yet";
 *   - caso contrario: mostra #topLevelStatus e #testbenchStatus lado a
 *     lado. Cada um aparece com check verde + nome do arquivo (sem .v)
 *     quando configurado, ou X vermelho + "No top-level"/"No testbench"
 *     quando faltando.
 *
 * Refresh hooks:
 *   - ProjectStore.subscribe — captura open/close de projeto automatico
 *     (setProject e clearProject disparam notify).
 *   - window.statusBarManager.refresh() — chamada explicita pelo
 *     ProjectTreeManager apos saveConfiguration, ja que mudancas no
 *     conteudo do .spf nao alteram o spfPath e portanto nao disparam
 *     subscribers do ProjectStore.
 */

class StatusBarManager {
    constructor() {
        this.topEl = null;
        this.tbEl = null;
        this.emptyEl = null;
        // _refreshSeq guarda a ultima refresh disparada. Se uma segunda
        // refresh chega enquanto a primeira esta no await SpfStore.read,
        // a primeira nao pode mais pintar — ficaria stale. Comparar
        // contra _refreshSeq descarta o resultado obsoleto.
        this._refreshSeq = 0;

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._init(), { once: true });
        } else {
            this._init();
        }
    }

    _init() {
        this.topEl = document.getElementById('topLevelStatus');
        this.tbEl = document.getElementById('testbenchStatus');
        this.emptyEl = document.getElementById('designEmptyStatus');
        if (!this.topEl || !this.tbEl || !this.emptyEl) {
            console.warn('StatusBarManager: status bar elements not found');
            return;
        }
        // Auto-refresh quando o projeto e aberto/fechado. Subscribe
        // retorna unsubscribe, mas o manager vive enquanto a janela vive.
        window.ProjectStore?.subscribe?.(() => this.refresh());
        // Pintura inicial — caso o app abra direto num projeto (auto-
        // reopen) o setProject pode ja ter rodado antes do nosso init.
        this.refresh();
    }

    async refresh() {
        if (!this.emptyEl) return;
        const seq = ++this._refreshSeq;
        let topPath = '';
        let tbPath = '';
        const spfPath = window.ProjectStore?.getSpfPath?.();
        if (spfPath && window.SpfStore) {
            try {
                const structure = await window.SpfStore.read(spfPath);
                topPath = structure.topLevelFile || '';
                tbPath = structure.testbenchFile || '';
            } catch (err) {
                console.warn('StatusBarManager: failed reading .spf', err);
            }
        }
        if (seq !== this._refreshSeq) return;
        this._render(topPath, tbPath);
    }

    _render(topPath, tbPath) {
        const bothEmpty = !topPath && !tbPath;
        this._toggle(this.emptyEl, bothEmpty);
        this._toggle(this.topEl, !bothEmpty);
        this._toggle(this.tbEl, !bothEmpty);
        if (!bothEmpty) {
            this._setSlot(this.topEl, topPath, 'No top-level');
            this._setSlot(this.tbEl, tbPath, 'No testbench');
        }
    }

    _toggle(el, visible) {
        if (!el) return;
        el.classList.toggle('hidden', !visible);
    }

    _setSlot(el, filePath, missingLabel) {
        if (!el) return;
        const icon = el.querySelector('i');
        const text = el.querySelector('span');
        if (!icon || !text) return;
        if (filePath) {
            const name = filePath.split(/[\\/]/).pop().replace(/\.v$/i, '');
            icon.className = 'ph ph-check-circle status-icon-success';
            text.textContent = name;
        } else {
            icon.className = 'ph ph-x status-icon-error';
            text.textContent = missingLabel;
        }
    }
}

const statusBarManager = new StatusBarManager();
window.statusBarManager = statusBarManager;
