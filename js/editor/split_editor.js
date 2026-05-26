/**
 * split_editor.js — Split Monaco Editor Manager
 * Supports up to 3 independent editor panes side-by-side.
 * Each pane has its own tab bar and Monaco instances.
 * Non-focused panes receive a subtle dim overlay.
 * Drag resizers sit between each pane pair.
 */

import { TabManager, showUnsavedChangesDialog } from '../tabs/tab_manager.js';
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
        // Path of the current preview (italic) tab in THIS pane, or null.
        // Each pane carries its own preview slot — opening a preview in
        // the main pane doesn't displace the one in a split, and vice
        // versa. Mirrors TabManager.previewTab semantics.
        this.previewTab = null;
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

        // Accept tabs dragged from the main pane (or another split): dropping
        // here MOVES the file into this pane. We only react to Aurora's own
        // tab drags (flagged on SplitEditorManager at dragstart) so unrelated
        // OS drags don't get a misleading drop affordance.
        pane.addEventListener('dragover', (e) => {
            if (!SplitEditorManager._dragActive) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            pane.classList.add('split-pane-drop-target');
        });
        pane.addEventListener('dragleave', (e) => {
            if (!pane.contains(e.relatedTarget)) {
                pane.classList.remove('split-pane-drop-target');
            }
        });
        pane.addEventListener('drop', (e) => {
            pane.classList.remove('split-pane-drop-target');
            if (!SplitEditorManager._dragActive) return;
            e.preventDefault();
            e.stopPropagation();
            const filePath = e.dataTransfer.getData('text/plain');
            SplitEditorManager.moveFileToPane(filePath, this.paneIndex);
        });

        return pane;
    }

    async openFile(filePath, content, options = {}) {
        const isPreview = options.preview === true;

        if (this.tabs.has(filePath)) {
            // Existing tab: promote it from preview if the new request is
            // permanent. Same semantics as TabManager.addTab.
            if (this.previewTab === filePath && !isPreview) {
                this.promotePreviewToPermanent(filePath);
            }
            this._activateFile(filePath);
            return;
        }

        // Opening a fresh preview into a pane that already has one: silently
        // discard the old preview before we add the new tab. The old preview's
        // editor is disposed via the same _closeFile path used by the close
        // button — minus the unsaved-changes dialog, since a preview cannot
        // be dirty (typing in it would have promoted it first).
        if (isPreview && this.previewTab && this.previewTab !== filePath) {
            await this._closePreviewSilently(this.previewTab);
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
        // TabManager so the dirty dot lands on every tab (main + splits)
        // for this file, and through SharedModelRegistry.isDirty so the
        // result is the same regardless of which pane fired the event.
        // VS Code parity: undoing all the way back to the saved state
        // clears the dot in every instance. Editing also auto-promotes a
        // preview tab — typing means commitment, italics make no sense
        // on something the user is actively changing.
        editor.onDidChangeModelContent(() => {
            if (SharedModelRegistry.isDirty(filePath)) {
                TabManager.markFileAsModified(filePath);
                if (this.previewTab === filePath) {
                    this.promotePreviewToPermanent(filePath);
                }
            } else {
                TabManager.markFileAsSaved(filePath);
            }
        });

        this.tabs.set(filePath, { editor, editorDiv });
        this._addTabElement(filePath, { preview: isPreview });
        if (isPreview) this.previewTab = filePath;
        this._activateFile(filePath);
    }

    /** Strip the italic from a preview tab in this pane (no-op otherwise). */
    promotePreviewToPermanent(filePath) {
        if (this.previewTab !== filePath) return;
        this.previewTab = null;
        const tabEl = this.element.querySelector(
            `.split-tab[data-path="${CSS.escape(filePath)}"]`,
        );
        if (tabEl) tabEl.classList.remove('preview');
    }

    /**
     * Drop a preview tab without prompting. Preview tabs cannot be dirty
     * (the content listener promotes on first edit), so we skip the
     * save/cancel dialog that _closeFile would otherwise show.
     */
    async _closePreviewSilently(filePath) {
        const info = this.tabs.get(filePath);
        if (!info) { this.previewTab = null; return; }
        try { info.editor.dispose(); } catch (_) { /* model is shared */ }
        info.editorDiv.remove();
        this.tabs.delete(filePath);
        const tabEl = this.element.querySelector(
            `.split-tab[data-path="${CSS.escape(filePath)}"]`,
        );
        if (tabEl) tabEl.remove();
        // Release this pane's reference on the shared model so the
        // registry's instance count stays accurate.
        if (typeof SharedModelRegistry?.release === 'function') {
            SharedModelRegistry.release(filePath);
        }
        if (this.activeFile === filePath) this.activeFile = null;
        this.previewTab = null;
    }

    _addTabElement(filePath, options = {}) {
        const tabsBar  = this.element.querySelector('.split-pane-tabs');
        const fileName = filePath.split(/[\\/]/).pop();
        const iconClass = TabManager.getFileIcon?.(fileName) ?? 'fas fa-file';

        const tab = document.createElement('div');
        tab.className = 'tab split-tab';
        if (options.preview === true) tab.classList.add('preview');
        tab.dataset.path = filePath;
        tab.title = filePath;
        // Mesmo padrao do tab_manager: usa tr('tabs.close') com
        // fallback EN se i18n nao bootou ainda. data-i18n-title faz
        // o applyDOM re-traduzir o tooltip em locale changes (sem
        // ele, um tab criado em EN ficaria preso em EN apos o
        // toggle pra PT).
        const closeTitle = window.t ? window.t('tabs.close') : 'Close';
        tab.innerHTML = `
            <i class="${iconClass}"></i>
            <span class="tab-name">${fileName}</span>
            <button class="close-tab" title="${closeTitle}" data-i18n-title="tabs.close">×</button>
        `;

        // Single click activates without promoting — VS Code parity. The
        // tab stays italic until the user double-clicks it or starts
        // editing the buffer.
        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('close-tab')) {
                SplitEditorManager.setFocus(this.paneIndex);
                this._activateFile(filePath);
            }
        });
        // Double click promotes the preview to permanent (pin).
        tab.addEventListener('dblclick', (e) => {
            if (e.target.classList.contains('close-tab')) return;
            this.promotePreviewToPermanent(filePath);
            this._activateFile(filePath);
        });
        tab.querySelector('.close-tab').addEventListener('click', (e) => {
            e.stopPropagation();
            // Fire-and-forget — _closeFile is async because of the
            // unsaved-changes prompt on the file's last instance.
            this._closeFile(filePath);
        });

        // Make split tabs draggable too, so a file can be moved to the main
        // pane or another split. Flags the drag on SplitEditorManager so drop
        // targets know it's one of ours and where it came from.
        tab.draggable = true;
        tab.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', filePath);
            SplitEditorManager._dragActive = true;
            SplitEditorManager._dragSourcePane = this.paneIndex;
        });
        tab.addEventListener('dragend', () => {
            SplitEditorManager._dragActive = false;
            SplitEditorManager._dragSourcePane = null;
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

        // Se esta pane esta focada, mudar activeFile muda o resultado
        // de SplitEditorManager.getFocusedFile() — notifica consumers
        // gated-por-extensao (ex: botão C± so em .cmm).
        const splitMgr = window.SplitEditorManager;
        if (splitMgr && splitMgr.focusedPane === this.paneIndex) {
            document.dispatchEvent(new CustomEvent('aurora:editing-file-changed', {
                detail: { filePath },
            }));
        }
    }

    async _closeFile(filePath) {
        const info = this.tabs.get(filePath);
        if (!info) return;

        // Last-instance prompt: if this is the only pane still holding the
        // file (main pane's TabManager doesn't have it AND no other split
        // does), closing here will dispose the shared model and DROP the
        // unsaved edits. In that case we run the same VS Code-style "save /
        // don't save / cancel" dialog the main pane uses. With other
        // instances still alive, the model survives — close silently.
        const isLastInstance = TabManager.getInstanceCount(filePath) <= 1;
        const isDirty = SharedModelRegistry.isDirty(filePath);
        if (isLastInstance && isDirty) {
            const fileName = filePath.split(/[\\/]/).pop();
            const result = await showUnsavedChangesDialog(fileName);
            if (result === 'cancel') return;
            if (result === 'save') {
                try {
                    const content = SharedModelRegistry.getModel(filePath)?.getValue() ?? '';
                    await window.electronAPI.writeFile(filePath, content);
                    SharedModelRegistry.markSaved(filePath);
                    TabManager.markFileAsSaved(filePath);
                } catch (err) {
                    console.error('Failed to save before close:', err);
                }
            }
            // 'dont-save' falls through and disposes; edits are lost.
        }

        // Dispose the editor view, then release our hold on the shared
        // model. The model only goes away once every pane (main + splits)
        // has released it.
        info.editor.dispose();
        info.editorDiv.remove();
        SharedModelRegistry.release(filePath);
        this.tabs.delete(filePath);
        if (this.previewTab === filePath) this.previewTab = null;

        const tabEl = this.element.querySelector(`.split-tab[data-path="${CSS.escape(filePath)}"]`);
        if (tabEl) tabEl.remove();

        // If the model fully went away (no instances left) AND it had been
        // dirty, clear the global flag so the unsavedChanges set doesn't
        // hold a stale entry.
        if (!SharedModelRegistry.has(filePath)) {
            TabManager.unsavedChanges.delete(filePath);
        }

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
    // Cross-pane tab drag state. Set at dragstart (by main tab_drag.js and by
    // split tabs here), read by pane drop targets so they only accept Aurora's
    // own tab drags and know which pane the tab came from (for move semantics).
    _dragActive: false,
    _dragSourcePane: null,

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

        // Main pane accepts tabs dragged from a split: dropping here moves the
        // file back into the main pane. Mirror of the per-split drop target.
        this.mainShell.addEventListener('dragover', (e) => {
            if (!this._dragActive || this._dragSourcePane === 0) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.mainShell.classList.add('split-pane-drop-target');
        });
        this.mainShell.addEventListener('dragleave', (e) => {
            if (!this.mainShell.contains(e.relatedTarget)) {
                this.mainShell.classList.remove('split-pane-drop-target');
            }
        });
        this.mainShell.addEventListener('drop', (e) => {
            this.mainShell.classList.remove('split-pane-drop-target');
            if (!this._dragActive || this._dragSourcePane === 0) return;
            e.preventDefault();
            e.stopPropagation();
            const filePath = e.dataTransfer.getData('text/plain');
            this.moveFileToPane(filePath, 0);
        });

        // Wire up the fixed split button in the toolbar
        const btn = document.getElementById('split-editor-btn');
        if (btn) btn.addEventListener('click', () => this.createSplit());

        // Expose globally so tab_manager (which already imports us indirectly
        // via monaco_editor) can call refreshLayout without a hard import cycle.
        if (typeof window !== 'undefined') window.SplitEditorManager = this;

        // Own the welcome-overlay decision: TabManager calls show/hideOverlay,
        // we route both through refreshLayout so the overlay reflects ALL
        // panes (main + splits). A registered delegate replaces the old
        // monkey-patch that reassigned TabManager.show/hideOverlay.
        TabManager.overlayDelegate = () => this.refreshLayout();

        // Keep the split button's enabled/tooltip state in sync with the
        // editing context. TabManager dispatches aurora:editing-file-changed
        // on every activateTab AND on preview close (both the "switch to
        // another tab" and the "no tabs left → filePath:null" paths), so
        // listening here covers what a fragile monkey-patch of activateTab /
        // _closePreviewSilently used to do — without reassigning their
        // methods. (setFocus / createSplit / closePane call _updateButton
        // directly; this just adds the tab-side trigger.)
        document.addEventListener('aurora:editing-file-changed', () => this._updateButton());

        // Sync the button to the real initial state (no file open → disabled
        // with the right tooltip) instead of relying on the static HTML attrs.
        this._updateButton();
    },

    canSplit() {
        if (this.panes.length >= 2) return false;
        // Match createSplit's source resolution: from the main pane the source
        // is TabManager.activeTab; from a focused split it's that pane's
        // activeFile. Gating only on TabManager.activeTab used to wrongly
        // disable the button when the main pane was empty but a focused split
        // still held a splittable file.
        if (this.focusedPane === 0) return TabManager.activeTab !== null;
        const pane = this.panes.find(p => p.paneIndex === this.focusedPane);
        return !!pane?.activeFile;
    },

    /**
     * Open filePath+content in the currently focused split pane.
     * `options.preview` flows through so a single click in the file tree
     * with a split focused opens an italic preview tab in that split,
     * just like a click with the main pane focused does for TabManager.
     */
    async openInFocusedPane(filePath, content, options = {}) {
        if (this.focusedPane === 0) {
            // Main pane is managed by TabManager, not this.panes (which holds split panes only)
            TabManager.addTab(filePath, content, options);
            return;
        }
        const pane = this.panes.find(p => p.paneIndex === this.focusedPane);
        if (!pane) return;
        await pane.openFile(filePath, content, options);
    },

    /**
     * Move a file (dragged from its source tab) into the target pane.
     * paneIndex 0 is the main pane; >0 is a split. "Move" means: open it in
     * the target, then close it at the source. Because every pane shares the
     * file's model, opening in the target before closing the source keeps the
     * instance count ≥ 1 throughout — the model (and any unsaved edits) is
     * never disposed mid-move, and closeFile sees it's not the last instance
     * so it never prompts.
     */
    async moveFileToPane(filePath, targetPaneIndex) {
        const source = this._dragSourcePane;
        this._dragActive = false;
        this._dragSourcePane = null;
        if (!filePath || source === null || source === targetPaneIndex) return;

        if (targetPaneIndex === 0) {
            if (!TabManager.tabs.has(filePath)) {
                TabManager.addTab(filePath, this._contentFor(filePath));
            } else {
                TabManager.activateTab(filePath);
            }
            this.setFocus(0);
        } else {
            const pane = this.panes.find(p => p.paneIndex === targetPaneIndex);
            if (!pane) return;
            if (!pane.tabs.has(filePath)) {
                await pane.openFile(filePath, this._contentFor(filePath));
            } else {
                pane._activateFile(filePath);
            }
            this.setFocus(targetPaneIndex);
        }

        await this._removeFromPane(filePath, source);
    },

    /** Live buffer text for an open file, via the shared model (never disk). */
    _contentFor(filePath) {
        const model = window.SharedModelRegistry?.getModel?.(filePath);
        return model ? model.getValue() : '';
    },

    /** Close a file's view in a specific pane (main or split). */
    async _removeFromPane(filePath, paneIndex) {
        if (paneIndex === 0) {
            if (TabManager.tabs.has(filePath)) await TabManager.closeTab(filePath);
        } else {
            const pane = this.panes.find(p => p.paneIndex === paneIndex);
            if (pane && pane.tabs.has(filePath)) await pane._closeFile(filePath);
        }
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
    refreshLayout() {
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
        // canSplit() now depends on which pane is focused, so refresh the
        // button whenever focus moves.
        this._updateButton();
        // Foco entre panes muda qual arquivo TabManager.getEditingFilePath
        // retorna — propaga pra botoes gated-por-extensao (ex: C± so em .cmm).
        document.dispatchEvent(new CustomEvent('aurora:editing-file-changed', {
            detail: { filePath: this.getFocusedFile() },
        }));
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

        // The Aurora tooltip system (js/ui/tooltip.js) reads `data-tooltip`
        // with priority over the native `title`, and i18n.applyDOM() rewrites
        // `data-tooltip` from `data-i18n-tooltip` on locale change. So we must
        // drive BOTH: the i18n key (so re-translation stays correct) and the
        // resolved `data-tooltip` text (so the change shows immediately).
        // Setting `title` here would be dead — data-tooltip always wins.
        const key = canSplit
            ? 'toolbar.splitEditor.tooltipEnabled'
            : this.panes.length >= 2
                ? 'toolbar.splitEditor.tooltipMax'
                : 'toolbar.splitEditor.tooltipDisabled';
        const fallback = {
            'toolbar.splitEditor.tooltipEnabled':  'Split editor — open current file in a new pane',
            'toolbar.splitEditor.tooltipMax':      'Maximum of 3 panes reached',
            'toolbar.splitEditor.tooltipDisabled': 'Open a file first to enable split',
        }[key];
        btn.setAttribute('data-i18n-tooltip', key);
        btn.setAttribute('data-tooltip', window.t ? window.t(key) : fallback);
        // Drop any stale native title the tooltip system may have stashed, so
        // it can't resurface as originalTitle.
        btn.removeAttribute('title');
        delete btn.dataset.originalTitle;
    },
};

export { SplitEditorManager };
