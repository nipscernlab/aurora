/**
 * split_editor.js — Split Monaco Editor Manager
 * Supports up to 3 independent editor panes side-by-side.
 * Each pane has its own tab bar and Monaco instances.
 * Non-focused panes receive a subtle dim overlay.
 * Drag resizers sit between each pane pair.
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager, showUnsavedChangesDialog } from '../tabs/tab_manager.js';
import { EditorManager } from './monaco_editor.js';
import { SharedModelRegistry } from './shared_models.js';
import { attachAiSelectionWidget } from './ai_selection_widget.js';
import { renderMarkdown, highlightCodeBlocks, linkifyFileRefs } from '../ai/chat_render.js';

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
            const filePath = e.dataTransfer.getData('application/x-aurora-tab-path');
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

        // Font ligatures per language (see monaco_editor.js): kill them in
        // Verilog so the `<=` non-blocking assignment isn't rendered as '≤',
        // keep them everywhere else. Re-applied on model/language change.
        const syncLigatures = () => {
            const lang = editor.getModel()?.getLanguageId();
            editor.updateOptions({ fontLigatures: lang !== 'verilog' });
        };
        editor.onDidChangeModel(syncLigatures);
        editor.onDidChangeModelLanguage(syncLigatures);
        syncLigatures();

        // AI "ask about this" star — same selection widget the main pane uses.
        attachAiSelectionWidget(editor, { getFilePath: () => filePath });

        // Cursor in this editor → activate this pane's tab + take pane focus.
        editor.onDidFocusEditorWidget(() => {
            SplitEditorManager.setFocus(this.paneIndex);
            if (this.activeFile !== filePath) {
                this._activateFile(filePath);
            }
            document.dispatchEvent(new CustomEvent('aurora-editor-focusstate', { detail: { focused: true } }));
        });
        editor.onDidBlurEditorWidget(() => {
            document.dispatchEvent(new CustomEvent('aurora-editor-focusstate', { detail: { focused: false } }));
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
            if (TabManager.isUntitledPath?.(filePath)) {
                if (TabManager.expandUntitledSnippet?.(filePath, editor)) {
                    TabManager.markFileAsModified(filePath);
                    return;
                }
                TabManager.updateUntitledDocumentType?.(filePath, editor.getValue());
                TabManager.markFileAsModified(filePath);
                return;
            }
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

    /**
     * Host a RENDERED preview (not a Monaco editor) in this pane: Markdown → HTML
     * via the chat renderer, or an <iframe> for a full HTML document (e.g. a
     * Plotly plot). Keyed by a SYNTHETIC path ("<source>::preview") so it stays
     * invisible to the dirty / save / instance-count machinery. The tab info
     * carries an editor STUB (layout/focus/dispose) so every existing pane method
     * — tab switching, close, relayout — works unchanged with NO per-call guards;
     * the synthetic key flows harmlessly through SharedModelRegistry (all no-ops
     * on an unknown key), and createSplit refuses to split it (the stub has no
     * getValue). Markdown live-syncs to the source model while it stays open.
     */
    openRenderedPreview(key, opts) {
        const sourcePath = opts.sourcePath;
        const kind = opts.kind;
        const content = opts.content;
        if (this.tabs.has(key)) { this._activateFile(key); return; }

        const editorArea = this.element.querySelector('.split-pane-editor-area');
        const div = document.createElement('div');
        div.className = 'split-editor-instance md-preview';
        div.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:none;overflow:auto;';

        let previewId = opts.previewId || null;
        let sub = null;

        if (kind === 'html') {
            const iframe = document.createElement('iframe');
            iframe.className = 'md-preview-frame';
            // Served over aurora-preview:// (main/ipc/preview.js), NOT a blob URL.
            // A blob: document inherits the app's CSP, which blocked the CDN
            // <script> every Plotly/Bokeh export needs — the pane just went white.
            // A real scheme carries its own policy, resolves the page's relative
            // paths, and keeps it cross-origin to the renderer.
            iframe.src = opts.previewUrl;
            // allow-same-origin refers to aurora-preview://<id> here, not to the
            // app's origin, so the page still reaches its own sibling files while
            // staying locked out of the real DOM.
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
            div.appendChild(iframe);
        } else {
            div.classList.add('md-preview-doc');
            const paint = (md) => {
                div.innerHTML = renderMarkdown(md || '');
                try { highlightCodeBlocks(div); } catch (_) { /* best-effort */ }
                try { linkifyFileRefs(div); } catch (_) { /* best-effort */ }
            };
            paint(content);
            // Live re-render while the source buffer is open (shared model).
            const model = window.SharedModelRegistry?.getModel?.(sourcePath);
            if (model && typeof model.onDidChangeContent === 'function') {
                let raf = null;
                sub = model.onDidChangeContent(() => {
                    if (raf) cancelAnimationFrame(raf);
                    raf = requestAnimationFrame(() => paint(model.getValue()));
                });
            }
        }
        editorArea.appendChild(div);

        // Rolagem casada entre o codigo e o texto renderizado, como no VS Code:
        // rolar um leva o outro. Vale so para o markdown; o HTML e um iframe em
        // outra origem (aurora-preview://) e a rolagem dele nao e legivel daqui,
        // que e justamente o isolamento que queremos.
        //
        // A correspondencia e proporcional, e nao linha a linha. Mapear linha do
        // fonte para no renderizado exigiria carimbar cada bloco na conversao e
        // ainda erraria em tabela, bloco de codigo e imagem, onde uma linha do
        // fonte vira muita ou pouca altura. Proporcional acerta o suficiente e
        // nao mente sobre precisao.
        let sincronia = null;
        if (kind !== 'html') {
            const fonte = () => window.EditorManager?.getEditorForFile?.(sourcePath) || null;
            // Quem esta mexendo agora. Sem isto, um lado move o outro, que
            // dispara o evento de volta, e os dois entram em cabo de guerra.
            let mexendo = null;
            const solta = () => { mexendo = null; };

            const doCodigoParaOTexto = () => {
                if (mexendo === 'texto') return;
                mexendo = 'codigo';
                const ed = fonte();
                if (ed) {
                    const alturaRolavel = ed.getScrollHeight() - ed.getLayoutInfo().height;
                    const fracao = alturaRolavel > 0 ? ed.getScrollTop() / alturaRolavel : 0;
                    div.scrollTop = fracao * Math.max(0, div.scrollHeight - div.clientHeight);
                }
                requestAnimationFrame(solta);
            };
            const doTextoParaOCodigo = () => {
                if (mexendo === 'codigo') return;
                mexendo = 'texto';
                const ed = fonte();
                if (ed) {
                    const sobra = Math.max(0, div.scrollHeight - div.clientHeight);
                    const fracao = sobra > 0 ? div.scrollTop / sobra : 0;
                    const alturaRolavel = ed.getScrollHeight() - ed.getLayoutInfo().height;
                    ed.setScrollTop(fracao * Math.max(0, alturaRolavel));
                }
                requestAnimationFrame(solta);
            };

            div.addEventListener('scroll', doTextoParaOCodigo, { passive: true });
            // O editor do fonte pode ainda nao existir quando o preview abre.
            const ligar = () => {
                const ed = fonte();
                if (!ed?.onDidScrollChange) return false;
                sincronia = ed.onDidScrollChange(doCodigoParaOTexto);
                return true;
            };
            if (!ligar()) {
                let tentativas = 0;
                const t = setInterval(() => {
                    if (ligar() || ++tentativas > 20) clearInterval(t);
                }, 150);
            }
        }

        const stub = {
            layout() { /* CSS-sized — nothing to relayout */ },
            focus() { /* not a text input */ },
            dispose() {
                try { sub?.dispose?.(); } catch (_) { /* noop */ }
                try { sincronia?.dispose?.(); } catch (_) { /* noop */ }
                // Release the aurora-preview:// slot so its directory stops
                // being reachable the moment the tab closes.
                if (previewId) {
                    try { electronAPI.previewUnregister(previewId); } catch (_) { /* noop */ }
                    previewId = null;
                }
            },
            // No getValue on purpose → createSplit won't try to split a preview.
        };
        this.tabs.set(key, { editor: stub, editorDiv: div });
        this._addTabElement(key, {});

        // Friendlier tab: source basename + magnifier icon, and NOT draggable
        // (a synthetic preview key has no meaning in another pane).
        const tabEl = this.element.querySelector(`.split-tab[data-path="${CSS.escape(key)}"]`);
        if (tabEl) {
            const base = sourcePath.split(/[\\/]/).pop();
            const nameEl = tabEl.querySelector('.tab-name');
            if (nameEl) nameEl.textContent = base;
            const iconEl = tabEl.querySelector('i');
            if (iconEl) iconEl.className = 'ph ph-magnifying-glass';
            tabEl.title = 'Preview — ' + sourcePath;
            tabEl.draggable = false;
        }

        this._activateFile(key);
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
        const fileName = TabManager.getDisplayName?.(filePath) ?? filePath.split(/[\\/]/).pop();
        const iconClass = TabManager.getFileIcon?.(fileName) ?? 'ph ph-file';

        const tab = document.createElement('div');
        tab.className = 'tab split-tab';
        if (options.preview === true) tab.classList.add('preview');
        tab.dataset.path = filePath;
        tab.title = filePath;
        tab.innerHTML = `
            <i class="${iconClass}"></i>
            <span class="tab-name">${fileName}</span>
            <button class="close-tab">×</button>
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

        // Middle-click (mouse wheel button) closes split tabs too, parity
        // with the main pane (tab_manager.js#auxclick). Without this, the
        // user gets used to scroll-button-to-close in the main pane and
        // hits dead air when trying the same gesture on a split.
        tab.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            this._closeFile(filePath);
        });
        // Suppress the default middle-button autoscroll cursor that
        // would otherwise flash on mousedown before auxclick fires.
        tab.addEventListener('mousedown', (e) => {
            if (e.button === 1) e.preventDefault();
        });

        // Make split tabs draggable too, so a file can be moved to the main
        // pane or another split. Flags the drag on SplitEditorManager so drop
        // targets know it's one of ours and where it came from.
        tab.draggable = true;
        tab.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            // Custom MIME — see tab_drag.js for rationale (avoids Monaco
            // pasting the file path on drop into the editor area).
            e.dataTransfer.setData('application/x-aurora-tab-path', filePath);
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
            const fileName = TabManager.getDisplayName?.(filePath) ?? filePath.split(/[\\/]/).pop();
            const result = await showUnsavedChangesDialog(fileName);
            if (result === 'cancel') return;
            if (result === 'save') {
                try {
                    if (TabManager.isUntitledPath?.(filePath)) {
                        const saved = await TabManager.saveUntitledFile(filePath);
                        if (saved === false) return;
                        return;
                    } else {
                        const content = SharedModelRegistry.getModel(filePath)?.getValue() ?? '';
                        await electronAPI.writeFile(filePath, content);
                        SharedModelRegistry.markSaved(filePath);
                        TabManager.markFileAsSaved(filePath);
                    }
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
            if (TabManager.isUntitledPath?.(filePath)) {
                TabManager.untitledDocuments?.delete?.(filePath);
            }
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
            md: 'markdown', txt: 'plaintext', asm: 'asm', cmm: 'cmm', spf: 'json',
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
    // The split control floats inside the focused pane's editor area rather
    // than living in the top toolbar — one shared button, re-parented to
    // whichever instance currently has focus. Created lazily by _updateButton.
    splitFloatBtn: null,
    // The markdown/HTML preview (magnifier) button — same floating pattern as
    // splitFloatBtn, parked in the focused pane, shown only for .md/.html.
    lupaBtn: null,
    // A varinha de formatar — mesmo padrão flutuante, à esquerda do split.
    // Ela e a lupa nunca aparecem juntas (uma é para código, a outra para
    // markdown e HTML), então dividem a mesma vaga ao lado do split.
    formatBtn: null,
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
            const filePath = e.dataTransfer.getData('application/x-aurora-tab-path');
            this.moveFileToPane(filePath, 0);
        });

        // The split button is no longer a fixed toolbar element — _updateButton
        // (called below + on every focus/tab change) creates the floating
        // in-pane button and keeps it parked in the focused instance.

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
        // Pane budget is 3 panes side-by-side. The main pane only counts
        // when it actually has content — so after the user empties the main
        // pane (it gets hidden), the freed slot lets them split again
        // instead of being stuck at "max panes reached" with a blank main.
        const mainCount = this._mainHasContent() ? 1 : 0;
        if (mainCount + this.panes.length >= 3) return false;
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

        // Unique index = max existing + 1. Using `panes.length + 1` collided
        // after a middle pane was closed (e.g. close pane 2 of [1,2] → next
        // split would also pick index 2, clashing with the surviving pane).
        const newIndex = this.panes.reduce((m, p) => Math.max(m, p.paneIndex), 0) + 1;
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
        //
        // State model (editor.css): the overlay ALWAYS keeps `visible`;
        // `hidden` toggles the welcome off. We must NOT remove `visible`
        // here — doing so left it in a `hidden`-without-`visible` limbo that
        // showed neither the welcome nor an editor (the grey-screen bug).
        const overlay = document.getElementById('editor-overlay');
        if (overlay) {
            overlay.classList.add('visible');
            overlay.classList.toggle('hidden', anyContent);
        }

        // If the focused pane is no longer visible (e.g. the main pane was
        // just emptied and hidden), hand focus to a visible pane. Otherwise
        // every remaining pane stays dimmed (focus points at a hidden pane)
        // and canSplit() reads the wrong source — the "everything's buggy
        // after closing the original instance" state.
        const focusedVisible =
            (this.focusedPane === 0 && this.mainShell.style.display !== 'none' && mainHasContent) ||
            this.panes.some((p) => p.paneIndex === this.focusedPane
                && p.element.style.display !== 'none' && p.tabs.size > 0);
        if (!focusedVisible) {
            if (mainHasContent && this.mainShell.style.display !== 'none') {
                this.setFocus(0);
            } else if (splitsWithContent.length > 0) {
                this.setFocus(splitsWithContent[0].paneIndex);
            }
        }

        // Monaco needs an explicit layout() when its container's size or
        // visibility changes (display:none → block, flex resize). Without
        // this, panes that were just shown/resized render blank until the
        // next user interaction — the "tabs ficam sem conteúdo" bug.
        this._relayoutVisibleEditors();
    },

    /** Re-measure every currently-visible Monaco editor (main + splits). */
    _relayoutVisibleEditors() {
        requestAnimationFrame(() => {
            if (this.mainShell && this.mainShell.style.display !== 'none') {
                try { EditorManager.activeEditor?.layout?.(); } catch (_) { /* ignore */ }
            }
            for (const p of this.panes) {
                if (p.element.style.display === 'none') continue;
                const info = p.activeFile ? p.tabs.get(p.activeFile) : null;
                try { info?.editor?.layout?.(); } catch (_) { /* ignore */ }
            }
        });
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

    /** Instância do Monaco do pane focado, ou null. O shell principal guarda
     *  seus editores no EditorManager; um split guarda no próprio pane. */
    getFocusedEditor() {
        if (this.focusedPane === 0) {
            const f = TabManager.activeTab;
            return f ? (EditorManager.getEditorForFile?.(f) ?? null) : null;
        }
        const pane = this.panes.find(p => p.paneIndex === this.focusedPane);
        if (!pane?.activeFile) return null;
        return pane.tabs.get(pane.activeFile)?.editor ?? null;
    },

    /** Lazily build the single floating split button (icon only). */
    _ensureSplitFloatBtn() {
        if (this.splitFloatBtn) return this.splitFloatBtn;
        const btn = document.createElement('button');
        btn.id = 'split-editor-float-btn';
        btn.type = 'button';
        btn.className = 'split-float-btn toolbar-button icon-only';
        btn.innerHTML = '<i class="ph ph-columns"></i>';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.createSplit();
        });
        this.splitFloatBtn = btn;
        return btn;
    },

    /** Root element of the currently focused pane (the floating button's host).
     *  Both the main shell and a split pane are `.split-pane` (position:
     *  relative, overflow: hidden), so the absolutely-positioned button lands
     *  in the same top-right corner of whichever instance has focus. */
    _focusedPaneEl() {
        if (this.focusedPane === 0) return this.mainShell || null;
        const pane = this.panes.find(p => p.paneIndex === this.focusedPane);
        return pane?.element || null;
    },

    _updateButton() {
        const btn = this._ensureSplitFloatBtn();

        // Park the button in the focused pane so the control always rides with
        // the instance that has focus. No host (e.g. mid teardown) → detach it
        // for now; the next focus/layout pass re-homes it.
        const host = this._focusedPaneEl();
        if (!host) { btn.remove(); return; }
        if (btn.parentElement !== host) host.appendChild(btn);

        // Hide entirely when the focused pane holds no file — there is nothing
        // to split, and the welcome overlay owns the empty-editor state.
        const hasFile = this.focusedPane === 0
            ? TabManager.activeTab !== null
            : !!this.panes.find(p => p.paneIndex === this.focusedPane)?.activeFile;
        btn.classList.toggle('hidden', !hasFile);

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
        this._updateLupaButton();
        this._updateFormatButton();
    },

    /**
     * Open a rendered preview of the focused Markdown/HTML file in a NEW split
     * pane, side-by-side with the source. Backs the floating magnifier button.
     * The preview is a synthetic tab (SplitPane.openRenderedPreview); if one for
     * this source already exists anywhere, just focus it.
     */
    async openRenderedPreview(sourcePath) {
        if (!sourcePath) return;
        const ext = sourcePath.split('.').pop().toLowerCase();
        const kind = (ext === 'html' || ext === 'htm') ? 'html'
            : (ext === 'md' || ext === 'markdown') ? 'markdown' : null;
        if (!kind) return;

        const key = sourcePath + '::preview';
        for (const pane of this.panes) {
            if (pane.tabs.has(key)) { this.setFocus(pane.paneIndex); pane._activateFile(key); return; }
        }

        // Respect the 3-pane budget (main counts only when it has content).
        const mainCount = this._mainHasContent() ? 1 : 0;
        if (mainCount + this.panes.length >= 3) return;

        // Content: the live buffer if the file is open, else read from disk.
        let content = window.SharedModelRegistry?.getModel?.(sourcePath)?.getValue?.();
        if (content == null) {
            try { content = await electronAPI.readFile(sourcePath); }
            catch (_) { content = ''; }
        }

        // HTML renders in an iframe served by the aurora-preview:// protocol, so
        // claim a slot for this file first: main maps it to the file's directory
        // and hands back the URL to point the frame at. `content` goes with it so
        // an unsaved buffer previews its unsaved text, exactly as Markdown does.
        let previewUrl = null;
        let previewId = null;
        if (kind === 'html') {
            try {
                const slot = await electronAPI.previewRegister(sourcePath, content || '');
                previewUrl = slot?.url;
                previewId = slot?.id;
            } catch (e) {
                console.error('[preview] could not open a preview slot:', e);
            }
            if (!previewUrl) return;
        }

        const newIndex = this.panes.reduce((m, p) => Math.max(m, p.paneIndex), 0) + 1;
        const newPane = new SplitPane(newIndex);
        this.panes.push(newPane);
        this.wrapper.appendChild(newPane.element);
        newPane.openRenderedPreview(key, { sourcePath, kind, content: content || '', previewUrl, previewId });
        this.refreshLayout();
        this.setFocus(newIndex);
        this._updateButton();
    },

    /** Lazily build the single floating markdown/HTML preview (magnifier) button. */
    _ensureLupaBtn() {
        if (this.lupaBtn) return this.lupaBtn;
        const btn = document.createElement('button');
        btn.id = 'md-preview-float-btn';
        btn.type = 'button';
        btn.className = 'md-preview-float-btn toolbar-button icon-only';
        btn.innerHTML = '<i class="ph ph-magnifying-glass"></i>';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openRenderedPreview(this.getFocusedFile());
        });
        this.lupaBtn = btn;
        return btn;
    },

    /** Varinha: formata o buffer do pane focado.
     *
     *  Não escolhemos o formatador aqui. Cada idioma registra o seu provedor no
     *  Monaco (clang-format para C, C++ e C±, com C± pegando as regras de C;
     *  black para Python; Verible pelo LSP para Verilog) e a ação padrão do
     *  editor despacha para o provedor do buffer em foco. Assim a varinha é a
     *  mesma coisa que Shift+Alt+F, e um idioma novo aparece sozinho no botão. */
    _ensureFormatBtn() {
        if (this.formatBtn) return this.formatBtn;
        const btn = document.createElement('button');
        btn.id = 'format-float-btn';
        btn.type = 'button';
        btn.className = 'format-float-btn toolbar-button icon-only';
        btn.innerHTML = '<i class="ph ph-magic-wand"></i>';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.formatFocused();
        });
        this.formatBtn = btn;
        return btn;
    },

    /** Roda a ação de formatar no editor em foco. */
    async formatFocused() {
        const editor = this.getFocusedEditor();
        const action = editor?.getAction?.('editor.action.formatDocument');
        if (!action) return;
        editor.focus();
        try { await action.run(); } catch (e) {
            console.warn('[format] falhou:', e);
        }
    },

    /** Estaciona a varinha no pane focado; some quando o idioma não tem quem
     *  o formate. `isSupported()` da ação já reflete os provedores registrados,
     *  então nada aqui precisa saber a lista de idiomas. */
    _updateFormatButton() {
        const btn = this._ensureFormatBtn();
        const host = this._focusedPaneEl();
        if (!host) { btn.remove(); return; }
        if (btn.parentElement !== host) host.appendChild(btn);

        const editor = this.getFocusedEditor();
        const action = editor?.getAction?.('editor.action.formatDocument');
        let podeFormatar = false;
        try { podeFormatar = !!action && action.isSupported(); } catch { podeFormatar = false; }
        btn.classList.toggle('hidden', !podeFormatar);
        btn.setAttribute('data-i18n-tooltip', 'toolbar.format.tooltip');
        btn.setAttribute('data-tooltip',
            window.t ? window.t('toolbar.format.tooltip') : 'Format this file');
        btn.removeAttribute('title');
        delete btn.dataset.originalTitle;
    },

    /** Park the preview button in the focused pane; show it only for md/html. */
    _updateLupaButton() {
        const btn = this._ensureLupaBtn();
        const host = this._focusedPaneEl();
        if (!host) { btn.remove(); return; }
        if (btn.parentElement !== host) host.appendChild(btn);
        const file = this.getFocusedFile() || '';
        const ext = file.split('.').pop().toLowerCase();
        const isHtml = ext === 'html' || ext === 'htm';
        const previewable = isHtml || ext === 'md' || ext === 'markdown';
        btn.classList.toggle('hidden', !previewable);
        btn.setAttribute('data-tooltip',
            isHtml ? 'Preview rendered HTML in a split' : 'Preview rendered Markdown in a split');
        btn.removeAttribute('title');
    },
};

export { SplitEditorManager };
