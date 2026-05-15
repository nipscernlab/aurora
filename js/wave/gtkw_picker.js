/**
 * gtkw_picker.js — Toolbar dropdown for the active GTKWave save file.
 *
 * Companion to the WaveStore: cada testbench tem sua propria lista
 * `gtkwFiles[]` com um entry marcado `isActive: true`. O picker mostra
 * a lista do testbench ATUAL (definido por `testbenchFile` em
 * structure do .spf) e troca de lista automaticamente quando o
 * testbench muda — listas isoladas, tb A nao ve .gtkw de tb B.
 *
 * Operacoes:
 *   - Listar registrados, escolher o ativo (atualiza `isActive`).
 *   - "default" limpa a selecao (wave flow auto-gera o layout).
 *   - "+ Add .gtkw file..." abre dialog, registra no WaveStore.
 *
 * Persistencia via `WaveStore.update(projectPath, tbKey, ...)`. Escritas
 * concorrentes serializam per-(projectPath, tbKey).
 */

import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { WaveStore } from './wave_state_store.js';

// i18n shim — fallback pra key path se i18n nao bootou ainda.
// O picker re-renderiza o <select> dinamicamente, entao precisa
// traduzir em runtime (data-i18n do HTML so cobre o markup inicial,
// que e jogado fora no innerHTML = '').
const tr = (k, p) => (window.t ? window.t(k, p) : k);

const NONE_VALUE = '';
const ADD_VALUE = '__add__';

function tbKeyFromPath(tbPath) {
    if (!tbPath) return '';
    return tbPath.split(/[\\/]/).pop().replace(/\.v$/i, '');
}

class GtkwPickerManager {
    constructor() {
        this.select = null;
        this._initialized = false;
        // Cached so we can revert the <select> on a cancelled "Add file"
        // dialog without re-reading the config.
        this._lastValue = NONE_VALUE;
        // tbKey do testbench atual — recalculado em cada refresh. Vazio
        // = sem testbench selecionado (= picker disabled).
        this._currentTbKey = '';
    }

    initialize() {
        if (this._initialized) return;
        this.select = document.getElementById('gtkwPickerSelect');
        if (!this.select) return;
        this.select.addEventListener('change', () => this._onChange());
        // Re-render quando o locale termina de carregar (boot inicial)
        // ou quando o toggle troca de lingua. Sem isso, options
        // renderizados antes do i18n estar pronto ficam presos em EN
        // (ou na key literal) ate o proximo refresh manual.
        window.addEventListener('aurora:locale-changed', () => this.refresh());
        this._initialized = true;
        // Initial population: a project may already be loaded by the
        // time this fires (e.g. .spf passed on the command line).
        this.refresh();
    }

    /**
     * Re-read the active testbench's WaveStore entry and rebuild the
     * <select>. Safe to call any time; idempotent.
     *
     * Called on:
     *   - first init (constructor)
     *   - after a project loads (project_manager wiring)
     *   - after the user changes the testbench top (file tree marks a
     *     different .v as testbench) — caller invokes this manually
     */
    async refresh() {
        if (!this.select) return;
        const projectPath = ProjectStore.getProjectPath();
        const spfPath = ProjectStore.getSpfPath();
        if (!projectPath || !spfPath) {
            this._renderEmpty('toolbar.gtkwPicker.noProject');
            return;
        }
        const config = await SpfStore.read(spfPath);
        const tbKey = tbKeyFromPath(config.testbenchFile);
        this._currentTbKey = tbKey;
        if (!tbKey) {
            this._renderEmpty('toolbar.gtkwPicker.noTestbench');
            return;
        }
        const state = await WaveStore.read(projectPath, tbKey);
        const files = Array.isArray(state.gtkwFiles) ? state.gtkwFiles : [];
        const active = files.find((f) => f && f.isActive === true);
        this._renderOptions(files, active?.path ?? NONE_VALUE);
    }

    _renderEmpty(reasonKey) {
        this.select.innerHTML = '';
        // Pra options com texto fixo, anexamos data-i18n tambem — isso
        // serve de seguro caso o picker re-renderize ANTES do i18n
        // terminar de bootar: o applyDOM() no fim do boot atualiza
        // textContent via data-i18n mesmo que tr() ainda retorne EN.
        const placeholderKey = reasonKey || 'toolbar.gtkwPicker.default';
        this.select.appendChild(this._makeOption(NONE_VALUE, tr(placeholderKey), placeholderKey));
        this.select.appendChild(this._makeOption(ADD_VALUE, tr('toolbar.gtkwPicker.add'), 'toolbar.gtkwPicker.add'));
        this.select.value = NONE_VALUE;
        this._lastValue = NONE_VALUE;
        // Mantemos o select habilitado pra que "Add file" continue
        // funcionando mesmo sem testbench (caso o usuario queira
        // registrar a .gtkw antes de marcar o testbench). Mas se nao
        // tem project, ai sim disable.
        this.select.disabled = !ProjectStore.getProjectPath();
    }

    _renderOptions(files, selectedPath) {
        this.select.innerHTML = '';
        this.select.disabled = false;
        this.select.appendChild(this._makeOption(NONE_VALUE, tr('toolbar.gtkwPicker.default'), 'toolbar.gtkwPicker.default'));
        for (const f of files) {
            if (!f?.path) continue;
            const label = f.name || f.path.split(/[\\/]/).pop();
            // Sem data-i18n: label vem de filename, nao tem traducao.
            this.select.appendChild(this._makeOption(f.path, label));
        }
        this.select.appendChild(this._makeOption(ADD_VALUE, tr('toolbar.gtkwPicker.add'), 'toolbar.gtkwPicker.add'));
        const valueExists = [...this.select.options].some((o) => o.value === selectedPath);
        const finalValue = valueExists ? selectedPath : NONE_VALUE;
        this.select.value = finalValue;
        this._lastValue = finalValue;
    }

    _makeOption(value, label, i18nKey = null) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        if (i18nKey) opt.setAttribute('data-i18n', i18nKey);
        return opt;
    }

    async _onChange() {
        const value = this.select.value;
        if (value === ADD_VALUE) {
            await this._handleAddFile();
            return;
        }
        await this._setActive(value);
        this._lastValue = value;
    }

    async _handleAddFile() {
        // Revert visually until the dialog returns — if the user
        // cancels, the <select> shouldn't sit on the "Add" sentinel.
        this.select.value = this._lastValue;

        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath) return;
        // tbKey vem do refresh — se nao tem tb selecionado, abortar
        // (o "Add" so faz sentido vinculado a um tb).
        if (!this._currentTbKey) return;

        const result = await window.electronAPI.showOpenDialogImport({
            properties: ['openFile'],
            filters: [
                { name: 'GTKWave Save Files', extensions: ['gtkw'] },
                { name: 'All Files', extensions: ['*'] },
            ],
        });
        if (!result || result.canceled || !result.filePaths?.length) return;

        const filePath = result.filePaths[0];
        const fileName = filePath.split(/[\\/]/).pop();
        const tbKey = this._currentTbKey;

        await WaveStore.update(projectPath, tbKey, (cfg) => {
            const files = Array.isArray(cfg.gtkwFiles) ? cfg.gtkwFiles : [];
            // De-dup pelo path absoluto: se o mesmo .gtkw foi adicionado
            // antes pra ESTE testbench, so toggle active em vez de
            // dupliar.
            let existing = files.find((f) => f?.path === filePath);
            if (!existing) {
                existing = { name: fileName, path: filePath, isActive: false };
                files.push(existing);
            }
            for (const f of files) {
                f.isActive = (f === existing);
            }
            cfg.gtkwFiles = files;
        });
        await this.refresh();
    }

    async _setActive(targetPath) {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath || !this._currentTbKey) return;
        await WaveStore.update(projectPath, this._currentTbKey, (cfg) => {
            const files = Array.isArray(cfg.gtkwFiles) ? cfg.gtkwFiles : [];
            for (const f of files) {
                f.isActive = (f?.path === targetPath);
            }
            cfg.gtkwFiles = files;
        });
    }
}

const gtkwPickerManager = new GtkwPickerManager();

if (typeof window !== 'undefined') {
    // Exposed so the project_manager can call refresh() after a load
    // without an import cycle.
    window.gtkwPickerManager = gtkwPickerManager;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => gtkwPickerManager.initialize());
} else {
    gtkwPickerManager.initialize();
}

export { gtkwPickerManager, GtkwPickerManager };
