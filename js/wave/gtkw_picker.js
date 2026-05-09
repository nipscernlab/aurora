/**
 * gtkw_picker.js — Toolbar dropdown for the active GTKWave save file.
 *
 * The user-facing companion to projectOriented.json's `gtkwFiles[]`.
 * Exposes a <select> in the toolbar that:
 *   - Lists every registered .gtkw by filename.
 *   - Has a "default" option that clears the selection (wave flow
 *     will then auto-generate a layout from the VCD's testbench scope).
 *   - Has an "+ Add .gtkw file..." action that opens a file dialog,
 *     registers the picked file in `gtkwFiles[]`, and marks it active.
 *
 * Selection mechanics: there's exactly one active .gtkw per project,
 * tracked via the existing `isTopLevel` flag on each entry — same
 * field the wave flow's `_waveResolveGtkwSaveFile` reads (Source 1).
 * Picking a value sets that entry's flag and clears it on the others.
 *
 * Persistence goes through `ProjectConfigStore.update` so concurrent
 * writes from Project Settings serialize cleanly.
 *
 * The wave flow itself is unchanged — this module is purely a
 * shortcut UI for what was previously buried inside Project Settings.
 */

import { ProjectStore } from '../project/project_store.js';
import { ProjectConfigStore } from '../project/project_config_store.js';

const NONE_VALUE = '';
const ADD_VALUE = '__add__';

class GtkwPickerManager {
    constructor() {
        this.select = null;
        this._initialized = false;
        // Cached so we can revert the <select> on a cancelled "Add file"
        // dialog without re-reading the config.
        this._lastValue = NONE_VALUE;
    }

    initialize() {
        if (this._initialized) return;
        this.select = document.getElementById('gtkwPickerSelect');
        if (!this.select) return;
        this.select.addEventListener('change', () => this._onChange());
        this._initialized = true;
        // Initial population: a project may already be loaded by the
        // time this fires (e.g. .spf passed on the command line).
        this.refresh();
    }

    /**
     * Re-read the project config and rebuild the <select> options.
     * Safe to call any time; idempotent.
     *
     * Called on:
     *   - first init (constructor)
     *   - after a project loads (project_manager wiring)
     *   - after Project Settings save (so manual edits there reflect)
     */
    async refresh() {
        if (!this.select) return;
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath) {
            this._renderEmpty();
            return;
        }
        const config = await ProjectConfigStore.read(projectPath);
        const files = Array.isArray(config.gtkwFiles) ? config.gtkwFiles : [];
        const active = files.find((f) => f && f.isTopLevel === true);
        this._renderOptions(files, active?.path ?? NONE_VALUE);
    }

    _renderEmpty() {
        this.select.innerHTML = '';
        this.select.appendChild(this._makeOption(NONE_VALUE, 'default'));
        this.select.appendChild(this._makeOption(ADD_VALUE, '+ Add .gtkw file...'));
        this.select.value = NONE_VALUE;
        this._lastValue = NONE_VALUE;
        this.select.disabled = true;
    }

    _renderOptions(files, selectedPath) {
        this.select.innerHTML = '';
        this.select.disabled = false;
        this.select.appendChild(this._makeOption(NONE_VALUE, 'default'));
        for (const f of files) {
            if (!f?.path) continue;
            const label = f.name || f.path.split(/[\\/]/).pop();
            this.select.appendChild(this._makeOption(f.path, label));
        }
        this.select.appendChild(this._makeOption(ADD_VALUE, '+ Add .gtkw file...'));
        const valueExists = [...this.select.options].some((o) => o.value === selectedPath);
        const finalValue = valueExists ? selectedPath : NONE_VALUE;
        this.select.value = finalValue;
        this._lastValue = finalValue;
    }

    _makeOption(value, label) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
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
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath) return;

        await ProjectConfigStore.update(projectPath, (cfg) => {
            const files = Array.isArray(cfg.gtkwFiles) ? cfg.gtkwFiles : [];
            // De-dup by absolute path: if the same .gtkw was added
            // before, just toggle it active rather than appending a
            // second entry.
            let existing = files.find((f) => f?.path === filePath);
            if (!existing) {
                existing = { name: fileName, path: filePath, isTopLevel: false };
                files.push(existing);
            }
            for (const f of files) {
                f.isTopLevel = (f === existing);
            }
            cfg.gtkwFiles = files;
        });
        await this.refresh();
    }

    async _setActive(targetPath) {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath) return;
        await ProjectConfigStore.update(projectPath, (cfg) => {
            const files = Array.isArray(cfg.gtkwFiles) ? cfg.gtkwFiles : [];
            for (const f of files) {
                f.isTopLevel = (f?.path === targetPath);
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
