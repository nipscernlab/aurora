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
 *   - "+ Add .gtkw file..." abre dialog filtrado por .gtkw e registra.
 *   - "X" inline (hover-revealed) remove o entry da lista.
 *
 * UI: um dropdown custom (button + menu div) em vez de um <select>
 * nativo, justamente porque <select> nao deixa adicionar botoes
 * per-option. O padrao de UX espelha o file tree (row + delete btn
 * que aparece no hover), entao remover entradas e familiar e nao
 * precisa de modo separado.
 *
 * Persistencia via `WaveStore.update(projectPath, tbKey, ...)`. Escritas
 * concorrentes serializam per-(projectPath, tbKey).
 */

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { WaveStore } from './wave_state_store.js';
import { getViewer } from './viewer_preference.js';

const tr = (k, p) => (window.t ? window.t(k, p) : k);

const NONE_VALUE = '';
const ADD_VALUE = '__add__';

function tbKeyFromPath(tbPath) {
    if (!tbPath) return '';
    return tbPath.split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
}

class GtkwPickerManager {
    constructor() {
        this.root = null;
        this.button = null;
        this.labelEl = null;
        this.menu = null;
        this._initialized = false;
        this._open = false;
        this._currentTbKey = '';
        this._files = [];
        this._activePath = NONE_VALUE;
        // Viewer-aware: 'gtkwave' → manages gtkwFiles[] (.gtkw); 'surfer' →
        // surferFiles[] (.surf.ron/.sucl). Re-derived on every refresh().
        this._field = 'gtkwFiles';
        this._isSurfer = false;
    }

    initialize() {
        if (this._initialized) return;
        this.root   = document.getElementById('gtkwPicker');
        this.button = document.getElementById('gtkwPickerButton');
        this.menu   = document.getElementById('gtkwPickerMenu');
        if (!this.root || !this.button || !this.menu) return;
        this.labelEl = this.button.querySelector('.gtkw-picker-label');
        // Track the menu's original home so we can put it back on close.
        // We move the menu to <body> while open because the toolbar zone
        // uses `overflow: hidden` to keep its layout tidy — that clips
        // any absolutely-positioned descendant. A body-level portal
        // bypasses the clip entirely and stacks above Monaco/welcome.
        this._menuHome = this.menu.parentNode;
        this.menu.classList.add('gtkw-picker-menu--portal');

        this.button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleOpen();
        });

        // Outside click closes the menu. mousedown (capture) wins over
        // any internal listener that might stopPropagation. The menu
        // sits in <body> while open so `root.contains` would miss it
        // — check both root AND menu.
        document.addEventListener('mousedown', (e) => {
            if (!this._open) return;
            if (this.root.contains(e.target)) return;
            if (this.menu.contains(e.target)) return;
            this._closeMenu();
        }, true);

        // Reposition the open menu on resize / scroll so it stays
        // glued to the trigger button.
        window.addEventListener('resize', () => {
            if (this._open) this._positionMenu();
        });
        window.addEventListener('scroll', () => {
            if (this._open) this._positionMenu();
        }, true);

        // Locale change rebuilds the menu so "default" + "+ Add" pick
        // up the new translations.
        window.addEventListener('aurora:locale-changed', () => this.refresh());

        // Viewer change (GTKWave ↔ Surfer) swaps which list this picker
        // shows — refresh so the menu + label track the active viewer.
        window.addEventListener('aurora:wave-viewer-changed', () => this.refresh());

        this._initialized = true;
        this.refresh();
    }

    async refresh() {
        if (!this.root) return;
        // Pick which list (and file kind) this refresh manages from the
        // current viewer, so the one dropdown serves GTKWave and Surfer.
        this._isSurfer = (typeof getViewer === 'function' ? getViewer() : 'gtkwave') === 'surfer';
        this._field = this._isSurfer ? 'surferFiles' : 'gtkwFiles';
        const projectPath = ProjectStore.getProjectPath();
        const spfPath = ProjectStore.getSpfPath();
        if (!projectPath || !spfPath) {
            this._currentTbKey = '';
            this._files = [];
            this._activePath = NONE_VALUE;
            this._setLabelKey('toolbar.gtkwPicker.noProject');
            this.button.disabled = true;
            this._renderMenu();
            return;
        }
        const config = await SpfStore.read(spfPath);
        const tbKey = tbKeyFromPath(config.testbenchFile);
        this._currentTbKey = tbKey;
        if (!tbKey) {
            this._files = [];
            this._activePath = NONE_VALUE;
            this._setLabelKey('toolbar.gtkwPicker.noTestbench');
            this.button.disabled = true;        // sem testbench: lista desabilitada
            this._renderMenu();
            return;
        }
        const state = await WaveStore.read(projectPath, tbKey);
        const list = state[this._field];
        this._files = Array.isArray(list) ? list.filter((f) => f?.path) : [];
        const active = this._files.find((f) => f.isActive === true);
        this._activePath = active?.path || NONE_VALUE;
        this._updateLabelFromState();
        this.button.disabled = false;
        this._renderMenu();
    }

    _updateLabelFromState() {
        if (!this.labelEl) return;
        if (this._activePath && this._activePath !== NONE_VALUE) {
            const f = this._files.find((x) => x.path === this._activePath);
            const name = f?.name || this._activePath.split(/[\\/]/).pop();
            this.labelEl.textContent = name;
            this.labelEl.removeAttribute('data-i18n');
        } else {
            this._setLabelKey('toolbar.gtkwPicker.default');
        }
    }

    _setLabelKey(key) {
        if (!this.labelEl) return;
        this.labelEl.textContent = tr(key);
        this.labelEl.setAttribute('data-i18n', key);
    }

    _renderMenu() {
        if (!this.menu) return;
        this.menu.innerHTML = '';

        // Default row — clears the active selection.
        this.menu.appendChild(this._makeMenuRow({
            value: NONE_VALUE,
            label: tr('toolbar.gtkwPicker.default'),
            i18nKey: 'toolbar.gtkwPicker.default',
            removable: false,
            active: this._activePath === NONE_VALUE,
        }));

        for (const f of this._files) {
            const name = f.name || f.path.split(/[\\/]/).pop();
            this.menu.appendChild(this._makeMenuRow({
                value: f.path,
                label: name,
                title: f.path,
                removable: true,
                active: this._activePath === f.path,
            }));
        }

        // + Add row — sentinel, opens dialog. Label tracks the viewer so it
        // reads "Surfer layout" instead of ".gtkw" under Surfer.
        this.menu.appendChild(this._makeMenuRow({
            value: ADD_VALUE,
            label: this._isSurfer ? '+ Add Surfer layout…' : tr('toolbar.gtkwPicker.add'),
            i18nKey: this._isSurfer ? null : 'toolbar.gtkwPicker.add',
            removable: false,
            adder: true,
        }));
    }

    _makeMenuRow({ value, label, i18nKey, title, removable, active, adder }) {
        const row = document.createElement('div');
        row.className = 'gtkw-picker-row';
        if (active)  row.classList.add('active');
        if (adder)   row.classList.add('adder');
        row.dataset.value = value;
        if (title) row.title = title;

        const labelEl = document.createElement('span');
        labelEl.className = 'gtkw-picker-row-label';
        labelEl.textContent = label;
        if (i18nKey) labelEl.setAttribute('data-i18n', i18nKey);
        row.appendChild(labelEl);

        if (removable) {
            // The X is inside the row, hidden until hover — mirrors the
            // file tree's per-row delete affordance so the gesture is
            // familiar (and crucially, can't be triggered by mistake
            // while scanning the list).
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'gtkw-picker-row-remove';
            x.title = tr('toolbar.gtkwPicker.removeTooltip') || 'Remove from list';
            x.setAttribute('aria-label', x.title);
            x.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
            x.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this._removeEntry(value);
            });
            row.appendChild(x);
        }

        row.addEventListener('click', () => this._onRowClick(value));
        return row;
    }

    _toggleOpen() {
        if (this._open) this._closeMenu();
        else this._openMenu();
    }

    _openMenu() {
        if (!this.menu) return;
        // Move the menu out of the clipped toolbar zone and onto the
        // body, then position it under the button. Without this the
        // toolbar's `overflow: hidden` clips the menu away entirely
        // (which is what made it look like nothing happened on click).
        if (this.menu.parentNode !== document.body) {
            document.body.appendChild(this.menu);
        }
        this.menu.classList.remove('hidden');
        this.root.classList.add('open');
        this._open = true;
        this._positionMenu();
    }

    _closeMenu() {
        if (!this.menu) return;
        this.menu.classList.add('hidden');
        this.root.classList.remove('open');
        this._open = false;
        // Park the menu back in the picker root so a fresh open()
        // doesn't have to hunt for it (and inspecting the picker in
        // devtools shows the canonical structure).
        if (this._menuHome && this.menu.parentNode !== this._menuHome) {
            this._menuHome.appendChild(this.menu);
        }
    }

    _positionMenu() {
        if (!this._open || !this.button || !this.menu) return;
        const rect = this.button.getBoundingClientRect();
        // Glue the menu's left edge to the button. If the menu would
        // run off the right edge of the window, shift it left so it
        // stays on screen (with a small 8px breathing margin).
        const menuW = this.menu.offsetWidth || 240;
        const maxLeft = window.innerWidth - menuW - 8;
        const left = Math.min(rect.left, Math.max(8, maxLeft));
        this.menu.style.left = `${left}px`;
        this.menu.style.top  = `${rect.bottom + 4}px`;
    }

    async _onRowClick(value) {
        if (value === ADD_VALUE) {
            this._closeMenu();
            await this._handleAddFile();
            return;
        }
        this._closeMenu();
        await this._setActive(value);
    }

    async _handleAddFile() {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath) return;
        if (!this._currentTbKey) return;

        // Dialog filtered by .gtkw only — "All Files" intentionally
        // not offered because the wave flow can't consume anything
        // else and would fail at simulation time with a less obvious
        // error.
        // Dialog filtered to the active viewer's layout kind — "All Files"
        // intentionally not offered (the wave flow can't consume anything
        // else and would fail later with a less obvious error).
        const filters = this._isSurfer
            ? [{ name: 'Surfer layout (*.surf.ron, *.sucl)', extensions: ['ron', 'sucl'] }]
            : [{ name: 'GTKWave Save Files (*.gtkw)', extensions: ['gtkw'] }];
        const result = await electronAPI.showOpenDialogImport({
            properties: ['openFile'],
            filters,
        });
        if (!result || result.canceled || !result.filePaths?.length) return;

        const filePath = result.filePaths[0];
        const fileName = filePath.split(/[\\/]/).pop();
        const tbKey = this._currentTbKey;
        const field = this._field;

        await WaveStore.update(projectPath, tbKey, (cfg) => {
            const files = Array.isArray(cfg[field]) ? cfg[field] : [];
            let existing = files.find((f) => f?.path === filePath);
            if (!existing) {
                existing = { name: fileName, path: filePath, isActive: false };
                files.push(existing);
            }
            for (const f of files) f.isActive = (f === existing);
            cfg[field] = files;
        });
        await this.refresh();
    }

    async _setActive(targetPath) {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath || !this._currentTbKey) return;
        const field = this._field;
        await WaveStore.update(projectPath, this._currentTbKey, (cfg) => {
            const files = Array.isArray(cfg[field]) ? cfg[field] : [];
            for (const f of files) {
                f.isActive = (f?.path === targetPath);
            }
            cfg[field] = files;
        });
        await this.refresh();
    }

    async _removeEntry(targetPath) {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath || !this._currentTbKey) return;
        if (!targetPath || targetPath === NONE_VALUE || targetPath === ADD_VALUE) return;
        const field = this._field;
        await WaveStore.update(projectPath, this._currentTbKey, (cfg) => {
            const files = Array.isArray(cfg[field]) ? cfg[field] : [];
            cfg[field] = files.filter((f) => f?.path !== targetPath);
        });
        await this.refresh();
        // Keep the menu open if it was open so the user can remove
        // several in a row without re-opening between clicks.
        if (this._open) this._renderMenu();
    }
}

const gtkwPickerManager = new GtkwPickerManager();

if (typeof window !== 'undefined') {
    window.gtkwPickerManager = gtkwPickerManager;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => gtkwPickerManager.initialize());
} else {
    gtkwPickerManager.initialize();
}

export { gtkwPickerManager, GtkwPickerManager };
