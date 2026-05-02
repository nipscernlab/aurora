/**
 * split_editor.js — Split Monaco Editor Manager
 * Supports up to 3 independent editor panes side-by-side.
 * Each pane has its own tab bar and Monaco instances.
 * Non-focused panes receive a subtle dim overlay.
 * Drag resizers sit between each pane pair.
 */

import { TabManager } from '../tabs/tab_manager.js';
import { EditorManager } from './monaco_editor.js';
import { SharedModelRegistry } from './shared_models.js';

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

        // Attach to the file's shared model. Every pane (main + splits) that
        // shows this file points to the same `ITextModel`, so typing here
        // appears in every other pane in real time, undo/redo is a single
        // shared stack, and the dirty marker fires once for the file.
        const model = SharedModelRegistry.acquire(filePath, content || '', lang);

        const editor = monaco.editor.create(editorDiv, {
            theme: EditorManager?.currentTheme ?? 'vs-dark',
            model,
            automaticLayout: true,
            fontFamily: "'JetBrains Mono', monospace",
            fontLigatures: true,
            fontSize: 12,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            cursorSmoothCaretAnimation: 'on',
            cursorBlinking: 'smooth',
        });

        // Cursor in this editor → activate this pane's tab + take pane focus.
        editor.onDidFocusEditorWidget(() => {
            SplitEditorManager.setFocus(this.paneIndex);
            if (this.activeFile !== filePath) {
                this._activateFile(filePath);
            }
        });

        // Mirror typing into the dirty marker. The shared model already
        // notifies every editor's listeners on change; we go through
        // TabManager so the (single) main-tab close-button dot and the
        // unsavedChanges set stay coherent regardless of where the edit
        // originated.
        editor.onDidChangeModelContent(() => {
            const stored = TabManager.tabs.get(filePath);
            if (typeof stored === 'string' && model.getValue() !== stored) {
                TabManager.markFileAsModified(filePath);
            }
        });

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

        // Dispose the editor view, then release our hold on the shared
        // model. The model only goes away once every pane (main + splits)
        // has released it.
        info.editor.dispose();
        info.editorDiv.remove();
        SharedModelRegistry.release(filePath);
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
        this.tabs.forEach(({ editor }, filePath) => {
            try { editor.dispose(); } catch (_) { /* ignore */ }
            SharedModelRegistry.release(filePath);
        });
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

        // Expose globally so tab_manager (which already imports us indirectly
        // via monaco_editor) can call refreshLayout without a hard import cycle.
        if (typeof window !== 'undefined') window.SplitEditorManager = this;
        this._patchTabManagerOverlay();
    },

    /**
     * Wrap TabManager.showOverlay / hideOverlay so that:
     *  - Welcome only appears when ALL panes (main + splits) are empty.
     *  - Empty panes are hidden and resizers are rebuilt cleanly.
     */
    _patchTabManagerOverlay() {
        if (this._patched) return;
        this._patched = true;

        const origShow = TabManager.showOverlay.bind(TabManager);
        const origHide = TabManager.hideOverlay.bind(TabManager);

        TabManager.showOverlay = () => {
            // Defer to refreshLayout which decides whether the welcome overlay
            // should actually be shown based on the global pane state.
            this.refreshLayout(origShow, origHide);
        };
        TabManager.hideOverlay = () => {
            this.refreshLayout(origShow, origHide);
        };
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

        // Resolve the source file + content from whichever pane currently has
        // focus. We require an actual Monaco editor — splitting a binary
        // viewer (image/PDF) or a tab whose editor hasn't been instantiated
        // yet would otherwise produce a blank pane.
        let filePath = null;
        let editor = null;

        if (this.focusedPane === 0) {
            filePath = TabManager.activeTab;
            if (filePath) editor = EditorManager.getEditorForFile?.(filePath) ?? null;
        } else {
            const pane = this.panes.find(p => p.paneIndex === this.focusedPane);
            if (pane?.activeFile) {
                filePath = pane.activeFile;
                editor = pane.tabs.get(filePath)?.editor ?? null;
            }
        }

        if (!filePath || !editor || typeof editor.getValue !== 'function') {
            // No usable source — bail instead of opening an empty pane.
            // Re-sync the button so its tooltip reflects current state.
            this._updateButton();
            return;
        }

        const content = editor.getValue();

        const newIndex = this.panes.length + 1; // 1 or 2
        const newPane  = new SplitPane(newIndex);
        this.panes.push(newPane);

        // Append the new pane; refreshLayout will (re)build resizers cleanly.
        this.wrapper.appendChild(newPane.element);

        await newPane.openFile(filePath, content);
        this.refreshLayout();
        this.setFocus(newIndex);
        this._updateButton();
    },

    closePane(paneIndex) {
        const pane = this.panes.find(p => p.paneIndex === paneIndex);
        if (!pane) return;

        pane.destroy();
        this.panes = this.panes.filter(p => p.paneIndex !== paneIndex);

        if (this.focusedPane === paneIndex) this.setFocus(0);

        this.refreshLayout();
        this._updateButton();
    },

    /**
     * Single source of truth for split layout. Responsibilities:
     *  1. Hide panes that have no tabs (main shell included).
     *  2. Tear down ALL existing resizers and rebuild fresh ones between
     *     consecutive visible panes — this kills any orphan resizer left
     *     behind when a middle pane was removed.
     *  3. Equalize visible panes via flex:1.
     *  4. Show the welcome overlay only when EVERY pane is empty;
     *     otherwise keep it hidden so visible panes can be used.
     */
    refreshLayout(origShowOverlay, origHideOverlay) {
        if (!this.wrapper || !this.mainShell) return;

        const mainHasContent = this._mainHasContent();
        const splitsWithContent = this.panes.filter(p => p.tabs.size > 0);
        const anyContent = mainHasContent || splitsWithContent.length > 0;

        // Main shell: hide only if it's empty AND splits still exist (so the
        // splits can fill the wrapper). If everything is empty, leave it
        // visible so the welcome overlay sits in its natural spot.
        if (!mainHasContent && splitsWithContent.length > 0) {
            this.mainShell.style.display = 'none';
        } else {
            this.mainShell.style.display = '';
            this.mainShell.style.flex = '1';
        }

        // Empty split panes get hidden (they may still be in this.panes if a
        // close hasn't fully propagated yet — defensive).
        this.panes.forEach(p => {
            if (p.tabs.size === 0) {
                p.element.style.display = 'none';
            } else {
                p.element.style.display = '';
                p.element.style.flex = '1';
            }
        });

        // Rebuild resizers from scratch — cheap and avoids orphan-pointer bugs.
        this.resizers.forEach(r => r.destroy());
        this.resizers = [];

        const visibleEls = [];
        if (this.mainShell.style.display !== 'none') visibleEls.push(this.mainShell);
        this.panes.forEach(p => {
            if (p.element.style.display !== 'none') visibleEls.push(p.element);
        });

        for (let i = 0; i < visibleEls.length - 1; i++) {
            const left = visibleEls[i];
            const right = visibleEls[i + 1];
            const resizer = new SplitResizer(left, right);
            this.resizers.push(resizer);
            this.wrapper.insertBefore(resizer.element, right);
        }

        // Welcome overlay: show whenever no pane has any tab open. This
        // mirrors the original (pre-split) behaviour where the welcome
        // screen is the empty-editor state, regardless of whether a project
        // is loaded — closing the last file should always bring it back.
        const overlay = document.getElementById('editor-overlay');
        if (overlay) {
            if (anyContent) {
                overlay.classList.add('hidden');
                overlay.classList.remove('visible');
            } else {
                overlay.classList.remove('hidden');
                overlay.classList.add('visible');
            }
        }
    },

    _mainHasContent() {
        // TabManager.tabs is the source of truth for the main pane.
        return TabManager?.tabs?.size > 0;
    },

    setFocus(paneIndex) {
        this.focusedPane = paneIndex;
        this.mainShell?.classList.toggle('split-pane-dimmed', paneIndex !== 0);
        this.panes.forEach(p => p.setDimmed(p.paneIndex !== paneIndex));
    },

    /**
     * Returns the file currently being edited in the focused pane. Used by
     * Ctrl+S so saving works the same regardless of which pane has the
     * cursor: main pane → TabManager.activeTab, split pane → that pane's
     * activeFile.
     */
    getFocusedFile() {
        if (this.focusedPane === 0) return TabManager.activeTab;
        const pane = this.panes.find(p => p.paneIndex === this.focusedPane);
        return pane?.activeFile ?? TabManager.activeTab;
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
