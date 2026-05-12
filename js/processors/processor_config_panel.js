/**
 * processor_config_panel.js — popover de configuracoes por processador.
 *
 * Ancora a partir do botao chevron `#procConfigToggle`, posicionado a
 * direita do C± na toolbar. Mostra clk, numClocks e showArrays do
 * processador ATIVO (.cmm em foco no Monaco, mesma logica que o status
 * bar usa pro indicador de processador ativo).
 *
 * Persistencia: campos sao gravados em `structure.processors[i]` do
 * .spf — clk/numClocks/showArrays vivem em cada entry do array (que
 * antes so tinha `name`). Defaults aplicados na leitura mantem
 * compatibilidade com .spf antigos.
 *
 * Por que dentro de `processors[]` em vez de uma nova chave: o
 * conjunto canonico de processadores ja mora la (single source of
 * truth pra existencia + identidade). Acoplar config no mesmo array
 * elimina drift entre listas paralelas e simplifica delete-processor
 * (entry sai, config some junto).
 */

const DEFAULT_CONFIG = Object.freeze({
    clk: 100,
    numClocks: 2000,
    showArrays: false,
});

class ProcessorConfigPanel {
    constructor() {
        this.anchor = null;
        this.panel = null;
        this.titleEl = null;
        this.clkInput = null;
        this.numClocksInput = null;
        this.showArraysInput = null;
        this.activeProc = null;
        this.processors = [];
        this._refreshSeq = 0;
        this._isOpen = false;

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._init(), { once: true });
        } else {
            this._init();
        }
    }

    _init() {
        this.anchor = document.getElementById('procConfigToggle');
        this.panel = document.getElementById('procConfigPanel');
        this.titleEl = document.getElementById('procConfigPanelTitle');
        this.clkInput = document.getElementById('procConfigClk');
        this.numClocksInput = document.getElementById('procConfigNumClocks');
        this.showArraysInput = document.getElementById('procConfigShowArrays');
        if (!this.anchor || !this.panel) {
            console.warn('ProcessorConfigPanel: anchor or panel not found');
            return;
        }

        this.anchor.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.anchor.disabled) return;
            this._toggle();
        });

        // Outside-click fecha. Usa capture pra preceder handlers
        // internos que pudessem stopPropagation. mousedown em vez de
        // click pra fechar antes do .focus() que um outro botao
        // emitiria.
        document.addEventListener('mousedown', (e) => {
            if (!this._isOpen) return;
            if (this.panel.contains(e.target)) return;
            if (this.anchor.contains(e.target)) return;
            this._close();
        }, true);

        // Reposiciona em resize enquanto aberto.
        window.addEventListener('resize', () => {
            if (this._isOpen) this._position();
        });

        // Persiste em mudanca. `change` em number inputs dispara no
        // blur — bom, evita salvar a cada keystroke.
        this.clkInput?.addEventListener('change', () => this._save({ clk: this._numericValue(this.clkInput) }));
        this.numClocksInput?.addEventListener('change', () => this._save({ numClocks: this._numericValue(this.numClocksInput) }));
        this.showArraysInput?.addEventListener('change', () => this._save({ showArrays: !!this.showArraysInput.checked }));

        // Atualiza quando o projeto abre/fecha, o arquivo em foco
        // muda, ou processadores sao criados/deletados pelo main.
        window.ProjectStore?.subscribe?.(() => this.refresh());
        document.addEventListener('aurora:editing-file-changed', () => this.refresh());
        window.electronAPI?.onProcessorCreated?.(() => this.refresh());
        window.electronAPI?.onProcessorsUpdated?.(() => this.refresh());

        this.refresh();
    }

    async refresh() {
        if (!this.anchor) return;
        const seq = ++this._refreshSeq;
        let processors = [];
        const spfPath = window.ProjectStore?.getSpfPath?.();
        if (spfPath && window.SpfStore) {
            try {
                const structure = await window.SpfStore.read(spfPath);
                processors = (structure.processors || [])
                    .filter((p) => p && (typeof p === 'string' ? p : p.name));
            } catch (err) {
                console.warn('ProcessorConfigPanel: failed reading .spf', err);
            }
        }
        if (seq !== this._refreshSeq) return;

        this.processors = processors;
        const procNames = processors.map((p) => (typeof p === 'string' ? p : p.name));
        const editingPath = window.TabManager?.getEditingFilePath?.() || '';
        this.activeProc = this._matchProcessorFromPath(editingPath, procNames);

        const enabled = !!this.activeProc;
        this.anchor.disabled = !enabled;
        this.anchor.style.cursor = enabled ? 'pointer' : 'not-allowed';
        // Sem processador ativo, nao faz sentido manter o painel
        // aberto — fecharia exibindo campos disabled com valores
        // stale.
        if (!enabled && this._isOpen) this._close();

        this._populateFields();
    }

    _populateFields() {
        if (!this.titleEl) return;
        if (!this.activeProc) {
            this.titleEl.textContent = 'No active processor';
            this._setInput(this.clkInput, '', true);
            this._setInput(this.numClocksInput, '', true);
            this._setCheckbox(this.showArraysInput, false, true);
            return;
        }

        const cfg = this._readConfig(this.activeProc);
        this.titleEl.textContent = this.activeProc;
        this._setInput(this.clkInput, cfg.clk, false);
        this._setInput(this.numClocksInput, cfg.numClocks, false);
        this._setCheckbox(this.showArraysInput, cfg.showArrays, false);
    }

    _readConfig(procName) {
        const entry = this.processors.find((p) => {
            const n = typeof p === 'string' ? p : p?.name;
            return n === procName;
        });
        const raw = entry && typeof entry === 'object' ? entry : {};
        return {
            clk: Number.isFinite(raw.clk) ? raw.clk : DEFAULT_CONFIG.clk,
            numClocks: Number.isFinite(raw.numClocks) ? raw.numClocks : DEFAULT_CONFIG.numClocks,
            showArrays: !!raw.showArrays,
        };
    }

    async _save(patch) {
        if (!this.activeProc) return;
        const spfPath = window.ProjectStore?.getSpfPath?.();
        if (!spfPath || !window.SpfStore) return;
        try {
            await window.SpfStore.update(spfPath, (structure) => {
                // Normaliza entries string-only (ex: .spf com schema
                // antigo). Cada entry vira `{ name, clk, numClocks,
                // showArrays }` — sem perder o `name`.
                const procs = Array.isArray(structure.processors) ? structure.processors : [];
                let touched = false;
                structure.processors = procs.map((p) => {
                    const name = typeof p === 'string' ? p : p?.name;
                    if (name !== this.activeProc) {
                        return typeof p === 'string' ? { name: p } : p;
                    }
                    touched = true;
                    const prev = typeof p === 'object' && p ? p : { name };
                    return { ...prev, name, ...patch };
                });
                if (!touched) {
                    // Edge: processador ativo nao existe no array. Nao
                    // criamos do nada — algo upstream esta inconsistente,
                    // melhor logar do que esconder.
                    console.warn('ProcessorConfigPanel: active processor not in .spf', this.activeProc);
                }
            });
            // Atualiza nossa view local sem re-disparar refresh full
            // (o write nao notifica subscribers do ProjectStore).
            const idx = this.processors.findIndex((p) => {
                const n = typeof p === 'string' ? p : p?.name;
                return n === this.activeProc;
            });
            if (idx >= 0) {
                const prev = this.processors[idx];
                const base = typeof prev === 'string' ? { name: prev } : { ...prev };
                this.processors[idx] = { ...base, ...patch };
            }
        } catch (err) {
            console.error('ProcessorConfigPanel: failed saving config', err);
        }
    }

    _toggle() {
        if (this._isOpen) this._close();
        else this._open();
    }

    _open() {
        if (!this.panel) return;
        this._position();
        this.panel.classList.remove('hidden');
        this.anchor.classList.add('open');
        this._isOpen = true;
    }

    _close() {
        if (!this.panel) return;
        this.panel.classList.add('hidden');
        this.anchor.classList.remove('open');
        this._isOpen = false;
    }

    _position() {
        if (!this.panel || !this.anchor) return;
        const rect = this.anchor.getBoundingClientRect();
        // Alinhar canto esquerdo do panel com canto esquerdo do anchor.
        // Se ultrapassar a janela a direita, shifta pra esquerda o
        // suficiente pra encaixar (com 8px de respiro).
        let left = rect.left;
        const panelWidth = this.panel.offsetWidth || 240;
        const maxLeft = window.innerWidth - panelWidth - 8;
        if (left > maxLeft) left = Math.max(8, maxLeft);
        this.panel.style.left = `${left}px`;
        this.panel.style.top = `${rect.bottom}px`;
    }

    _matchProcessorFromPath(filePath, processors) {
        if (!filePath || !filePath.toLowerCase().endsWith('.cmm')) return null;
        const parts = filePath.split(/[\\/]/);
        const swIdx = parts.findIndex((p) => p.toLowerCase() === 'software');
        if (swIdx > 0) {
            const candidate = parts[swIdx - 1];
            if (processors.includes(candidate)) return candidate;
        }
        const base = parts[parts.length - 1].replace(/\.cmm$/i, '');
        if (processors.includes(base)) return base;
        return null;
    }

    _numericValue(input) {
        if (!input) return DEFAULT_CONFIG.clk;
        const v = Number(input.value);
        return Number.isFinite(v) && v > 0 ? v : DEFAULT_CONFIG.clk;
    }

    _setInput(input, value, disabled) {
        if (!input) return;
        input.value = value === '' ? '' : String(value);
        input.disabled = disabled;
    }

    _setCheckbox(input, value, disabled) {
        if (!input) return;
        input.checked = !!value;
        input.disabled = disabled;
    }
}

const processorConfigPanel = new ProcessorConfigPanel();
window.processorConfigPanel = processorConfigPanel;
