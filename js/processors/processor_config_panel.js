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

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { getActiveProcessorName } from '../project/active_processor.js';

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
        this.simTimeEl = null;
        this.simTimeRow = null;
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
        this.simTimeEl = document.getElementById('procConfigSimTime');
        this.simTimeRow = document.getElementById('procConfigSimTimeRow');
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

        // Sim-time readout updates live as the user types — `input` fires
        // on every keystroke (unlike `change` which waits for blur), so
        // the duration label tracks the values without writing the .spf
        // on every digit. Persistence still flows through `change`.
        this.clkInput?.addEventListener('input', () => this._updateSimTime());
        this.numClocksInput?.addEventListener('input', () => this._updateSimTime());

        // Atualiza quando o projeto abre/fecha, o arquivo em foco
        // muda, ou processadores sao criados/deletados pelo main.
        ProjectStore.subscribe(() => this.refresh());
        document.addEventListener('aurora:editing-file-changed', () => this.refresh());
        electronAPI?.onProcessorCreated?.(() => this.refresh());
        electronAPI?.onProcessorsUpdated?.(() => this.refresh());

        this.refresh();
    }

    async refresh() {
        if (!this.anchor) return;
        const seq = ++this._refreshSeq;
        let processors = [];
        const spfPath = ProjectStore.getSpfPath();
        if (spfPath) {
            try {
                const structure = await SpfStore.read(spfPath);
                processors = (structure.processors || [])
                    .filter((p) => p && (typeof p === 'string' ? p : p.name));
            } catch (err) {
                console.warn('ProcessorConfigPanel: failed reading .spf', err);
            }
        }
        if (seq !== this._refreshSeq) return;

        this.processors = processors;
        const procNames = processors.map((p) => (typeof p === 'string' ? p : p.name));
        this.activeProc = getActiveProcessorName(procNames);

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
            this._updateSimTime();
            return;
        }

        const cfg = this._readConfig(this.activeProc);
        this.titleEl.textContent = this.activeProc;
        this._setInput(this.clkInput, cfg.clk, false);
        this._setInput(this.numClocksInput, cfg.numClocks, false);
        this._setCheckbox(this.showArraysInput, cfg.showArrays, false);
        this._updateSimTime();
    }

    /**
     * Recompute the simulation duration readout from the live input
     * values. Formula:
     *
     *   period = 1 / clk        (clk is in MHz, so period is in µs)
     *   duration = numClocks * period = numClocks / clk   [µs]
     *
     * So at the defaults (clk=100 MHz, numClocks=2000) the testbench
     * runs 20.00 µs of simulated time — same number Aurora bakes into
     * the `#${proc_clk}*${numClocks}` $finish line of the testbench.
     */
    _updateSimTime() {
        if (!this.simTimeEl) return;
        const disabled = !this.activeProc;
        if (this.simTimeRow) this.simTimeRow.classList.toggle('disabled', disabled);

        const clk = Number(this.clkInput?.value);
        const numClocks = Number(this.numClocksInput?.value);
        if (!Number.isFinite(clk) || clk <= 0 ||
            !Number.isFinite(numClocks) || numClocks <= 0) {
            this.simTimeEl.textContent = '—';
            return;
        }
        const us = numClocks / clk;
        // Once the duration crosses 2 000 000 µs (= 2 s of simulated
        // time) decimal notation loses readability fast — by 1e7 it's a
        // wall of zeros. Switch to scientific notation from there on and
        // *stay* there: even values that drop back below 2e6 mid-edit
        // would otherwise jitter between formats while the user types,
        // which is noisier than just committing to e-notation once the
        // ceiling is crossed.
        if (us > 2_000_000 || this._simTimeIsScientific) {
            this._simTimeIsScientific = true;
            this.simTimeEl.textContent = `${us.toExponential(2)} µs`;
            return;
        }
        // Pick a sensible precision: small durations get more decimals
        // so the readout stays informative under sub-microsecond clocks.
        const formatted = us >= 100 ? us.toFixed(0)
                       : us >= 10  ? us.toFixed(1)
                                   : us.toFixed(2);
        this.simTimeEl.textContent = `${formatted} µs`;
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
        const spfPath = ProjectStore.getSpfPath();
        if (!spfPath) return;
        try {
            await SpfStore.update(spfPath, (structure) => {
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
        // Drop a small vertical gap below the anchor so the panel's
        // accent ring stays visible (instead of being clipped by the
        // toolbar hairline) and the popover reads as a separate surface
        // floating beneath the gear button.
        this.panel.style.top = `${rect.bottom + 8}px`;
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

export const processorConfigPanel = new ProcessorConfigPanel();
