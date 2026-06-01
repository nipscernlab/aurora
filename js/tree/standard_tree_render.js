/**
 * standard_tree_render.js — the 'standard' file-tree view: a plain
 * folder/file hierarchy rooted at the project (.spf) directory.
 *
 * This is the third view in the toggle cycle (verilog flat files →
 * toplevel module hierarchy → folder tree). Unlike the verilog view
 * (processor-grouped) and the hierarchy view (Yosys module instances),
 * this one mirrors the actual on-disk folder structure under
 * `window.currentProjectPath`, the way a generic file explorer would.
 *
 * Reads are LAZY: only the project root is listed up front; a folder's
 * children are fetched (electronAPI.getFolderFiles) the first time it's
 * expanded, then kept in the DOM so re-expanding is instant. Expanded
 * paths are remembered in a Set so a full re-render (refresh / view
 * re-entry) restores the open folders.
 *
 * Single file-open path — readFile → focused split pane or TabManager
 * preview, double-click promotes to a permanent tab — identical to the
 * verilog view (file_mode.openTreeFile). There is intentionally no
 * second handler here; the duplicate-handler bug that got the old
 * standard view deleted in 2026-05 does not come back.
 */

import { treeView } from './tree_view.js';
import { TabManager } from '../tabs/tab_manager.js';

// Files that never belong in the explorer: legacy config blobs, the
// .spf project file itself, and dotfiles. Mirrors the old standard
// tree's filter so behaviour is unchanged for existing projects.
const IGNORED_FILES = ['projectOriented.json', 'processorConfig.json', 'fileOriented.json'];

function isIgnored(entry) {
    if (entry.isDirectory) return false;
    const name = entry.name || '';
    return name.startsWith('.')
        || IGNORED_FILES.includes(name)
        || name.endsWith('.spf');
}

// Directories first, then alphabetical — case-insensitive, the way a
// file explorer sorts.
function sortEntries(entries) {
    return entries.slice().sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

class StandardTreeRenderer {
    constructor() {
        // Paths the user has expanded — survives re-render so the tree
        // doesn't collapse on refresh / view switch.
        this._expanded = new Set();
        // Guard against overlapping renders racing on the same container.
        this._rendering = false;
    }

    isExpanded(path) { return this._expanded.has(path); }

    /**
     * Full (re)render of the standard view from the project root. Safe
     * to call repeatedly; restores previously-expanded folders.
     */
    async render() {
        const container = treeView.getContainer('standard');
        if (!container) return;

        const root = window.currentProjectPath;
        if (!root) {
            container.innerHTML = '';
            return;
        }

        if (this._rendering) return;
        this._rendering = true;
        try {
            const entries = await this._read(root);
            // Drop expanded paths that no longer exist under the root so
            // the Set doesn't grow unbounded across project switches.
            this._pruneExpanded(root);
            container.innerHTML = '';
            await this._renderLevel(entries, container, 0);
        } catch (err) {
            console.error('StandardTreeRenderer.render failed:', err);
        } finally {
            this._rendering = false;
        }
    }

    // ---------------- private ----------------

    async _read(dirPath) {
        const list = await window.electronAPI?.getFolderFiles?.(dirPath);
        if (!Array.isArray(list)) return [];
        return sortEntries(list.filter((e) => !isIgnored(e)));
    }

    _pruneExpanded(root) {
        const norm = (p) => String(p || '').replace(/\\/g, '/');
        const r = norm(root);
        for (const p of Array.from(this._expanded)) {
            if (!norm(p).startsWith(r)) this._expanded.delete(p);
        }
    }

    /**
     * Render one directory level's entries into `container`. Recurses
     * (awaiting child reads) only for folders the user has expanded.
     */
    async _renderLevel(entries, container, level) {
        for (const entry of entries) {
            const wrapper = this._buildRow(entry, level);
            container.appendChild(wrapper);

            if (entry.isDirectory && this.isExpanded(entry.path)) {
                const childBox = wrapper.querySelector(':scope > .folder-content');
                if (childBox) {
                    const children = await this._read(entry.path);
                    await this._renderLevel(children, childBox, level + 1);
                }
            }
        }
    }

    _buildRow(entry, level) {
        const wrapper = document.createElement('div');
        wrapper.className = 'file-tree-item';
        wrapper.setAttribute('data-path', entry.path);
        wrapper.style.setProperty('--depth', String(level));

        const row = document.createElement('div');
        row.className = 'file-item';

        const inner = document.createElement('div');
        inner.className = 'file-item-row';

        // Chevron (folders) or invisible spacer (files) — same 16px width
        // so names line up across types, VS Code style.
        if (entry.isDirectory) {
            const chevron = document.createElement('i');
            chevron.className = 'ph ph-caret-down folder-toggle-icon';
            if (!this.isExpanded(entry.path)) chevron.classList.add('collapsed');
            inner.appendChild(chevron);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'folder-toggle-spacer';
            inner.appendChild(spacer);
        }

        // Icon
        const icon = document.createElement('i');
        if (entry.isDirectory) {
            icon.className = `file-item-icon ph ${this.isExpanded(entry.path) ? 'ph-folder-open' : 'ph-folder'}`;
        } else {
            icon.className = `${TabManager.getFileIcon(entry.name)} file-item-icon`;
            const ext = (entry.name.split('.').pop() || '').toLowerCase();
            if (ext) wrapper.setAttribute('data-ext', ext);
        }
        inner.appendChild(icon);

        // Name
        const name = document.createElement('span');
        name.className = 'file-item-name';
        name.textContent = entry.name;
        inner.appendChild(name);

        row.appendChild(inner);
        wrapper.appendChild(row);

        // Empty child container created up front for folders so toggling
        // is a class flip; populated lazily on first expand.
        if (entry.isDirectory) {
            const childBox = document.createElement('div');
            childBox.className = 'folder-content';
            if (!this.isExpanded(entry.path)) childBox.classList.add('hidden');
            wrapper.appendChild(childBox);
        }

        row.addEventListener('click', () => {
            if (entry.isDirectory) {
                this._toggleFolder(entry, wrapper, level);
            } else {
                this._openFile(entry.path, entry.name, { preview: true });
            }
        });

        if (!entry.isDirectory) {
            row.addEventListener('dblclick', () => {
                // Single click already opened it as preview; promote the
                // existing tab to permanent without a second readFile.
                if (TabManager.tabs?.has?.(entry.path)) {
                    TabManager.promotePreviewToPermanent(entry.path);
                    TabManager.activateTab(entry.path);
                } else {
                    this._openFile(entry.path, entry.name, { preview: false });
                }
            });
        }

        return wrapper;
    }

    async _toggleFolder(entry, wrapper, level) {
        const willExpand = !this.isExpanded(entry.path);
        const childBox = wrapper.querySelector(':scope > .folder-content');
        const chevron = wrapper.querySelector(':scope > .file-item > .file-item-row > .folder-toggle-icon');
        const icon = wrapper.querySelector(':scope > .file-item .file-item-icon');

        if (willExpand) {
            this._expanded.add(entry.path);
            if (childBox && childBox.childElementCount === 0) {
                const children = await this._read(entry.path);
                await this._renderLevel(children, childBox, level + 1);
            }
        } else {
            this._expanded.delete(entry.path);
        }

        if (chevron) chevron.classList.toggle('collapsed', !willExpand);
        if (childBox) childBox.classList.toggle('hidden', !willExpand);
        if (icon) {
            icon.classList.toggle('ph-folder', !willExpand);
            icon.classList.toggle('ph-folder-open', willExpand);
        }
    }

    async _openFile(filePath, fileName, options) {
        try {
            const content = await window.electronAPI.readFile(filePath);
            const sem = window.SplitEditorManager;
            if (sem && sem.focusedPane > 0) {
                await sem.openInFocusedPane(filePath, content, options);
            } else {
                TabManager.addTab(filePath, content, options);
            }
        } catch (err) {
            console.error('Error opening file:', err);
        }
    }
}

const standardTreeRenderer = new StandardTreeRenderer();

if (typeof window !== 'undefined') {
    window.standardTreeRenderer = standardTreeRenderer;
}

export { standardTreeRenderer, StandardTreeRenderer };
