/**
 * status_bar.js — Renderiza tres indicadores do projeto na status bar.
 *
 * Zona direita (design — top-level + testbench):
 *   Le `structure.topLevelFile` e `structure.testbenchFile` do .spf.
 *   - ambos vazios (ou sem projeto): mostra apenas #designEmptyStatus
 *     com X "No top-level or testbench yet";
 *   - caso contrario: mostra #topLevelStatus e #testbenchStatus lado a
 *     lado. Cada um aparece com check verde + nome do arquivo (sem .v)
 *     quando configurado, ou X vermelho + "No top-level"/"No testbench"
 *     quando faltando.
 *
 * Zona esquerda (processador ativo):
 *   Cruza `structure.processors` do .spf com o .cmm em foco no Monaco
 *   (TabManager.getEditingFilePath — mesmo sinal que gate-ia o botao
 *   C±). Tres estados:
 *   - projeto sem processadores: #activeProcessorStatus hidden. Nao faz
 *     sentido falar de ativo/inativo sem candidatos.
 *   - tem processadores mas o arquivo em foco nao mapeia pra nenhum:
 *     X vermelho + "No active processor".
 *   - .cmm em foco mapeia pra um processador conhecido: check verde +
 *     nome do processador.
 *
 * Refresh hooks:
 *   - ProjectStore.subscribe — captura open/close de projeto.
 *   - aurora:editing-file-changed — captura mudanca do .cmm em foco.
 *   - electronAPI.onProcessorCreated / onProcessorsUpdated — captura
 *     criar/deletar processadores em runtime (o .spf ja foi reescrito
 *     pelo main process quando esses chegam).
 *   - window.statusBarManager.refresh() — chamada explicita pelo
 *     ProjectTreeManager apos saveConfiguration; mudancas no conteudo
 *     do .spf nao alteram o spfPath e portanto nao disparam
 *     subscribers do ProjectStore.
 */

// Nomes de exibicao dos motores de simulacao (nomes proprios — nao
// traduzidos). A chave casa com getWaveSimulator() / simulator_preference.
const ENGINE_LABELS = { iverilog: 'Icarus Verilog', verilator: 'Verilator' };

class StatusBarManager {
    constructor() {
        this.topEl = null;
        this.tbEl = null;
        this.emptyEl = null;
        this.activeProcEl = null;
        this.engineEl = null;
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
        this.activeProcEl = document.getElementById('activeProcessorStatus');
        this.engineEl = document.getElementById('simulatorEngineStatus');
        if (!this.topEl || !this.tbEl || !this.emptyEl || !this.activeProcEl) {
            console.warn('StatusBarManager: status bar elements not found');
            return;
        }
        // Auto-refresh quando o projeto e aberto/fechado.
        window.ProjectStore?.subscribe?.(() => this.refresh());
        // Mudanca do arquivo em foco no Monaco (mesmo evento que gate-ia
        // o botao C±).
        document.addEventListener('aurora:editing-file-changed', () => this.refresh());
        // Criacao/delete de processadores no main process — o .spf ja
        // foi reescrito quando esses eventos chegam aqui.
        window.electronAPI?.onProcessorCreated?.(() => this.refresh());
        window.electronAPI?.onProcessorsUpdated?.(() => this.refresh());
        // Locale flip re-renders too: "No top-level"/"No testbench" and
        // "No active processor" live in JS-set textContent and would
        // otherwise stay stuck in the previous language.
        window.addEventListener('aurora:locale-changed', () => this.refresh());
        // SPF structure changed (top-level/testbench set, files added/removed).
        // ProjectStore.subscribe won't fire because the spfPath itself didn't change.
        window.addEventListener('aurora:spf-changed', () => this.refresh());
        // Simulator engine flipped on the toolbar switch (or via AuroraAPI).
        window.addEventListener('aurora:wave-simulator-changed', () => this.refresh());
        // Pintura inicial — caso o app abra direto num projeto (auto-
        // reopen) o setProject pode ja ter rodado antes do nosso init.
        this.refresh();
    }

    async refresh() {
        if (!this.emptyEl) return;
        const seq = ++this._refreshSeq;
        let topPath = '';
        let tbPath = '';
        let processors = [];
        const spfPath = window.ProjectStore?.getSpfPath?.();
        if (spfPath && window.SpfStore) {
            try {
                const structure = await window.SpfStore.read(spfPath);
                topPath = structure.topLevelFile || '';
                tbPath = structure.testbenchFile || '';
                processors = (structure.processors || [])
                    .map((p) => (typeof p === 'string' ? p : p?.name))
                    .filter(Boolean);
            } catch (err) {
                console.warn('StatusBarManager: failed reading .spf', err);
            }
        }
        if (seq !== this._refreshSeq) return;
        // Cache da ultima lista de processadores do .spf — getActiveProcessorName()
        // recalcula contra o arquivo em foco ATUAL usando esta lista (sincrono),
        // sem precisar reler o .spf. Atualizada nos mesmos eventos que pintam a
        // status bar (spf/processor/projeto).
        this._lastProcessors = processors;
        this._renderDesign(topPath, tbPath);
        this._renderActiveProcessor(processors);
    }

    /**
     * Nome do processador ATIVO — exatamente o que a status bar mostra: o
     * .cmm em foco cruzado com a lista de processadores do projeto.
     * Recalcula a cada chamada a partir do arquivo em foco atual (sincrono),
     * usando a ultima lista lida do .spf. Retorna null quando nao ha
     * processador ativo (nenhum .cmm de processador em foco). Fonte unica
     * usada tambem pelo gate e pelo alvo do botao Verilator (processador).
     */
    getActiveProcessorName() {
        const editingPath = window.TabManager?.getEditingFilePath?.() || '';
        // Prefere a lista lida do .spf; cai pra window.availableProcessors
        // (mesmo conjunto de nomes) enquanto a 1a refresh ainda nao rodou,
        // pra nao reportar "sem ativo" so por ordem de inicializacao.
        const procs = (this._lastProcessors && this._lastProcessors.length)
            ? this._lastProcessors
            : (Array.isArray(window.availableProcessors) ? window.availableProcessors : []);
        return this._matchProcessorFromPath(editingPath, procs);
    }

    _renderDesign(topPath, tbPath) {
        const bothEmpty = !topPath && !tbPath;
        this._toggle(this.emptyEl, bothEmpty);
        this._toggle(this.topEl, !bothEmpty);
        this._toggle(this.tbEl, !bothEmpty);
        if (!bothEmpty) {
            const tr = (k) => (window.t ? window.t(k) : k);
            this._setSlot(this.topEl, topPath, tr('statusBar.noTopLevel'),  /\.v$/i);
            this._setSlot(this.tbEl,  tbPath,  tr('statusBar.noTestbench'), /\.v$/i);
        }
        this._renderSimulatorEngine(tbPath);
    }

    /**
     * Mostra o motor que vai simular o testbench (Icarus Verilog /
     * Verilator), logo apos o slot do testbench. So aparece quando ha um
     * testbench configurado — sem testbench nao ha o que simular. A
     * Para testbench .v: usa a preferencia global (window.getWaveSimulator,
     * de simulator_preference) — espelha o switch da toolbar. Para testbench
     * cocotb (.py): mostra SEMPRE Icarus Verilog, porque o backend
     * (runGtkWave) desvia o fluxo Python pro iverilog independente do
     * switch — mostrar a preferencia aqui enganaria o usuario.
     */
    _renderSimulatorEngine(tbPath) {
        if (!this.engineEl) return;
        const show = !!tbPath;
        this._toggle(this.engineEl, show);
        if (!show) return;
        const isCocotb = /\.py$/i.test(tbPath);
        const sim = isCocotb
            ? 'iverilog'
            : ((typeof window.getWaveSimulator === 'function') ? window.getWaveSimulator() : 'iverilog');
        const text = this.engineEl.querySelector('span');
        if (text) text.textContent = ENGINE_LABELS[sim] || ENGINE_LABELS.iverilog;
    }

    _renderActiveProcessor(processors) {
        if (!this.activeProcEl) return;
        // Sem processadores no projeto: nada a dizer sobre ativo/inativo.
        if (processors.length === 0) {
            this._toggle(this.activeProcEl, false);
            return;
        }
        this._toggle(this.activeProcEl, true);

        const editingPath = window.TabManager?.getEditingFilePath?.() || '';
        const activeName = this._matchProcessorFromPath(editingPath, processors);

        const icon = this.activeProcEl.querySelector('i');
        const text = this.activeProcEl.querySelector('span');
        if (!icon || !text) return;
        if (activeName) {
            icon.className = 'ph ph-check-circle status-icon-success';
            text.textContent = activeName;
        } else {
            icon.className = 'ph ph-x-circle status-icon-error';
            text.textContent = window.t ? window.t('statusBar.noActiveProcessor') : 'No active processor';
        }
    }

    /**
     * Determina o processador "ativo" a partir do .cmm em foco. Aceita
     * o caminho convencional `<projectDir>/<procName>/Software/<x>.cmm`
     * (prioriza o segmento de pasta — robusto a renames do .cmm) e cai
     * pro basename como fallback. Retorna null se o arquivo em foco
     * nao for .cmm ou nao casar com nenhum processador.
     */
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

    _toggle(el, visible) {
        if (!el) return;
        el.classList.toggle('hidden', !visible);
    }

    _setSlot(el, filePath, missingLabel, stripExtRegex) {
        if (!el) return;
        const icon = el.querySelector('i');
        const text = el.querySelector('span');
        if (!icon || !text) return;
        if (filePath) {
            const name = filePath.split(/[\\/]/).pop().replace(stripExtRegex, '');
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
