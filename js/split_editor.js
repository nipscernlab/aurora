/**
 * split_editor.js — Split Monaco Editor Manager
 * Supports up to 3 independent editor panes side-by-side.
 * Each pane has its own tab bar and Monaco instances.
 * Non-focused panes receive a subtle dim overlay.
 * Drag resizers sit between each pane pair.
 */

import { TabManager } from './tab_manager.js';
import { EditorManager } from './monaco_editor.js';

const MIN_PANE_WIDTH = 120;

// ─── SplitResizer ─────────────────────────────────────────────────────────────

class SplitResizer {
    constructor(leftEl, rightEl) {
        this.leftEl  = leftEl;
        this.rightEl = rightEl;
        this.element = this._build();
    }

    _build() {
        const el = document.createElement('div');
        el.className = 'split-pane-resizer';

        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            let active = true;
            let raf = null;
            const startX      = e.clientX;
            const startLeftW  = this.leftEl.offsetWidth;
            const startRightW = this.rightEl.offsetWidth;
            const total       = startLeftW + startRightW;

            document.body.classList.add('resizing-vertical');

            const onMove = (ev) => {
                if (!active) return;
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => {
                    const delta    = ev.clientX - startX;
                    const newLeft  = Math.max(MIN_PANE_WIDTH, Math.min(startLeftW + delta, total - MIN_PANE_WIDTH));
                    const newRight = total - newLeft;
                    this.leftEl.style.flex  = `0 0 ${newLeft}px`;
                    this.rightEl.style.flex = `0 0 ${newRight}px`;
                });
            };

            const onUp = () => {
                active = false;
                document.body.classList.remove('resizing-vertical');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (raf) cancelAnimationFrame(raf);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        return el;
    }

    destroy() {
        this.element.remove();
    }
}

// ─── SplitPane ────────────────────────────────────────────────────────────────

class SplitPane {
    constructor(paneIndex) {
        this.paneIndex  = paneIndex;
        this.tabs       = new Map(); // filePath → { editor, editorDiv }
        this.activeFile = null;
        this.element    = this._buildDOM();
    }

    _buildDOM() {
        const pane = document.createElement('div');
        pane.className = 'split-pane';
        pane.dataset.paneIndex = this.paneIndex;

        const tabsBar = document.createElement('div');
        tabsBar.className = 'split-pane-tabs';

        const editorArea = document.createElement('div');
        editorArea.className = 'split-pane-editor-area';

        const dimOverlay = document.createElement('div');
        dimOverlay.className = 'split-pane-dim';

        pane.appendChild(tabsBar);
        pane.appendChild(editorArea);
        pane.appendChild(dimOverlay);

        pane.addEventListener('mousedown', () => {
            SplitEditorManager.setFocus(this.paneIndex);
        });

        return pane;
    }

    async openFile(filePath, content) {
        if (this.tabs.has(filePath)) {
            this._activateFile(filePath);
            return;
        }

        const editorArea = this.element.querySelector('.split-pane-editor-area');

        const editorDiv = document.createElement('div');
        editorDiv.className = 'split-editor-instance';
        editorDiv.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:none;';
        editorArea.appendChild(editorDiv);

        const lang = this._langFromPath(filePath);

        // Try to share model with main pane for live sync
        let model = null;
        try {
            const mainEditor = EditorManager?.getEditorForFile?.(filePath);
            if (mainEditor) model = mainEditor.getModel();
        } catch (_) { /* ignore */ }

        const editorOptions = {
            theme: EditorManager?.currentTheme ?? 'vs-dark',
            language: lang,
            automaticLayout: true,
            fontFamily: "'JetBrains Mono', monospace",
            fontLigatures: true,
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            cursorSmoothCaretAnimation: 'on',
            cursorBlinking: 'smooth',
        };

        const editor = model
            ? monaco.editor.create(editorDiv, { ...editorOptions, model })
            : monaco.editor.create(editorDiv, editorOptions);

        if (!model) editor.setValue(content || '');

        this.tabs.set(filePath, { editor, editorDiv });
        this._addTabElement(filePath);
        this._activateFile(filePath);
    }

    _addTabElement(filePath) {
        const tabsBar  = this.element.querySelector('.split-pane-tabs');
        const fileName = filePath.split(/[\\/]/).pop();
        const iconClass = TabManager.getFileIcon?.(fileName) ?? 'fas fa-file';

        const tab = document.createElement('div');
        tab.className = 'tab split-tab';
        tab.dataset.path = filePath;
        tab.title = filePath;
        tab.innerHTML = `
            <i class="${iconClass}"></i>
            <span class="tab-name">${fileName}</span>
            <button class="close-tab" title="Close">×</button>
        `;

        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('close-tab')) {
                SplitEditorManager.setFocus(this.paneIndex);
                this._activateFile(filePath);
            }
        });
        tab.querySelector('.close-tab').addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeFile(filePath);
        });

        tabsBar.appendChild(tab);
    }

    _activateFile(filePath) {
        this.activeFile = filePath;

        this.element.querySelectorAll('.split-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.path === filePath);
        });

        this.tabs.forEach(({ editorDiv }, path) => {
            editorDiv.style.display = path === filePath ? 'block' : 'none';
        });

        const info = this.tabs.get(filePath);
        if (info) {
            setTimeout(() => info.editor.layout(), 0);
            info.editor.focus();
        }
    }

    _closeFile(filePath) {
        const info = this.tabs.get(filePath);
        if (!info) return;

        info.editor.dispose();
        info.editorDiv.remove();
        this.tabs.delete(filePath);

        const tabEl = this.element.querySelector(`.split-tab[data-path="${CSS.escape(filePath)}"]`);
        if (tabEl) tabEl.remove();

        if (this.tabs.size === 0) {
            SplitEditorManager.closePane(this.paneIndex);
            return;
        }

        const lastPath = Array.from(this.tabs.keys()).pop();
        this._activateFile(lastPath);
    }

    _langFromPath(filePath) {
        const ext = filePath.split('.').pop().toLowerCase();
        const map = {
            v: 'verilog', sv: 'systemverilog', vh: 'verilog',
            js: 'javascript', ts: 'typescript', py: 'python',
            c: 'c', cpp: 'cpp', h: 'c', json: 'json',
            md: 'markdown', txt: 'plaintext', asm: 'asm', cmm: 'cmm',
            css: 'css', html: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml',
        };
        return map[ext] || 'plaintext';
    }

    setDimmed(dimmed) {
        this.element.classList.toggle('split-pane-dimmed', dimmed);
    }

    destroy() {
        this.tabs.forEach(({ editor }) => { try { editor.dispose(); } catch (_) {} });
        this.tabs.clear();
        this.element.remove();
    }
}

// ─── SplitEditorManager ───────────────────────────────────────────────────────

const SplitEditorManager = {
    /** @type {SplitPane[]} */
    panes: [],
    /** @type {SplitResizer[]} */
    resizers: [],
    focusedPane: 0,
    wrapper: null,
    mainShell: null,

    initialize() {
        const editorContainer = document.querySelector('.editor-container');
        if (!editorContainer) return;

        // Build wrapper
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'split-editor-wrapper';

        // Wrap existing editor container in main-pane shell
        this.mainShell = document.createElement('div');
        this.mainShell.className = 'split-pane split-pane-main';
        this.mainShell.dataset.paneIndex = '0';

        const dimOverlay = document.createElement('div');
        dimOverlay.className = 'split-pane-dim';

        editorContainer.parentNode.insertBefore(this.wrapper, editorContainer);
        this.wrapper.appendChild(this.mainShell);
        this.mainShell.appendChild(editorContainer);
        this.mainShell.appendChild(dimOverlay);

        this.mainShell.addEventListener('mousedown', () => this.setFocus(0));

        // Wire up the fixed split button in the toolbar
        const btn = document.getElementById('split-editor-btn');
        if (btn) btn.addEventListener('click', () => this.createSplit());
    },

    canSplit() {
        return TabManager.activeTab !== null && this.panes.length < 2;
    },

    /** Open filePath+content in the currently focused split pane */
    async openInFocusedPane(filePath, content) {
        const pane = this.panes.find(p => p.paneIndex === this.focusedPane);
        if (!pane) return;
        await pane.openFile(filePath, content);
    },

    async createSplit() {
        if (!this.canSplit()) return;

        let filePath, content;

        if (this.focusedPane === 0) {
            filePath = TabManager.activeTab;
            if (!filePath) return;
            const editor = EditorManager.getEditorForFile?.(filePath);
            content = editor ? editor.getValue() : '';
        } else {
            const pane = this.panes.find(p => p.paneIndex === this.focusedPane);
            if (!pane?.activeFile) return;
            filePath = pane.activeFile;
            const info = pane.tabs.get(filePath);
            content = info ? info.editor.getValue() : '';
        }

        const newIndex = this.panes.length + 1; // 1 or 2
        const newPane  = new SplitPane(newIndex);
        this.panes.push(newPane);

        // Determine the left element for the resizer
        const leftEl = newIndex === 1
            ? this.mainShell
            : this.panes[this.panes.length - 2].element;

        // Append resizer then new pane
        const resizer = new SplitResizer(leftEl, newPane.element);
        this.resizers.push(resizer);
        this.wrapper.appendChild(resizer.element);
        this.wrapper.appendChild(newPane.element);

        // Reset all panes to equal flex so layout is clean
        this._equalizeWidths();

        await newPane.openFile(filePath, content);
        this.setFocus(newIndex);
        this._updateButton();
    },

    closePane(paneIndex) {
        const pane = this.panes.find(p => p.paneIndex === paneIndex);
        if (!pane) return;

        // Remove the resizer associated with this pane (the one whose right side is this pane)
        const resizerIdx = this.resizers.findIndex(r => r.rightEl === pane.element);
        if (resizerIdx !== -1) {
            this.resizers[resizerIdx].destroy();
            this.resizers.splice(resizerIdx, 1);
        }

        pane.destroy();
        this.panes = this.panes.filter(p => p.paneIndex !== paneIndex);

        if (this.focusedPane === paneIndex) this.setFocus(0);

        // Reset remaining panes to equal flex
        this._equalizeWidths();
        this._updateButton();
    },

    /** Reset all panes (main + splits) to equal flex-basis */
    _equalizeWidths() {
        this.mainShell.style.flex = '1';
        this.panes.forEach(p => { p.element.style.flex = '1'; });
    },

    setFocus(paneIndex) {
        this.focusedPane = paneIndex;
        this.mainShell?.classList.toggle('split-pane-dimmed', paneIndex !== 0);
        this.panes.forEach(p => p.setDimmed(p.paneIndex !== paneIndex));
    },

    _updateButton() {
        const btn = document.getElementById('split-editor-btn');
        if (!btn) return;
        const canSplit = this.canSplit();
        btn.disabled = !canSplit;
        btn.title = canSplit
            ? 'Split Editor — open current file in new pane'
            : this.panes.length >= 2
                ? 'Maximum 3 split panes reached'
                : 'Open a file first to enable split';
    },
};

export { SplitEditorManager };
