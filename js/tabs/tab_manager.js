import '../components/aurora-tabs.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { tabViewers } from './tab_viewers.js';
import { tabDrag } from './tab_drag.js';
import { tabWatchers } from './tab_watchers.js';
import { abasEmbutidas } from './abas_embutidas.js';
import { salvarAbas } from './salvar_abas.js';
import { documentoSemNome } from './documento_sem_nome.js';
import { fecharAbas } from './fechar_abas.js';
import { isImageFile, isPdfFile, isBinaryFile, getFileIcon } from './tab_utils.js';
import { isUntitled, untitledDisplayName } from './untitled_docs.js';
import { showUnsavedChangesDialog } from './dialogo_nao_salvo.js';

// O split_editor importa a pergunta daqui; ela mora em dialogo_nao_salvo.ts.
export { showUnsavedChangesDialog };

export class TabManager {
    static tabs = new Map();
    static activeTab = null;
    static previewTab = null; // path of current preview (italic) tab, or null
    static editorStates = new Map();
    static unsavedChanges = new Set();
    static closedTabsStack = [];
    static fileWatchers = new Map();
    static lastModifiedTimes = new Map();
    static externalChangeQueue = new Set();
    static periodicCheckInterval = null;
    static isCheckingFiles = false;
    static viewerInstances = new Map();

    // Abas do Surfer: caminho da onda → { tabId, pageUrl }. O tabId amarra o
    // servidor headless no main (surfer-tab:serve/stop); fechar a aba derruba
    // o servidor. Registrado por openSurferWave ANTES do addTab, porque o
    // roteamento (isSurferView) e consultado dentro do proprio addTab.
    static surferViews = new Map();
    // A aba do PRISM: uma so, na chave PRISM_TAB. Guarda o ultimo resultado
    // de compilacao para entregar a pagina quando o <webview> ficar pronto, e
    // de novo a cada recompilacao vinda da toolbar.
    static prismViews = new Map();
    static pdfViewerStates = new Map();
    static untitledCounter = 0;
    static untitledDocuments = new Map();
    static applyingSnippet = new Set();
    // filePath -> setInterval id for the PDF state-tracking poll. Tracked so
    // closing a PDF tab can clear it; otherwise each opened PDF left a 2s
    // interval running forever against a detached iframe.
    static pdfStateIntervals = new Map();
    // Optional delegate for the welcome-overlay decision. SplitEditorManager
    // registers one so the overlay reflects ALL panes (main + splits), not
    // just the main pane. When null, show/hideOverlay do the plain toggle.
    // (Replaces an older monkey-patch that reassigned show/hideOverlay.)
    static overlayDelegate = null;

    static hideOverlay() {
        if (TabManager.overlayDelegate) { TabManager.overlayDelegate(); return; }
        const overlay = document.getElementById('editor-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    static updateTabsContainerVisibility() {
        const tabsContainer = document.getElementById('tabs-container');
        if (tabsContainer) {
            // If there are more than 0 tabs, display it, otherwise hide it.
            if (this.tabs.size > 0) {
                tabsContainer.style.display = 'flex';
            } else {
                tabsContainer.style.display = 'none';
            }
        }
    }

    // Show overlay when no content
    static showOverlay() {
        if (TabManager.overlayDelegate) { TabManager.overlayDelegate(); return; }
        const overlay = document.getElementById('editor-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    }

    // Pure untitled metadata logic lives in untitled_docs.js; the state (the
    // untitledDocuments Map + untitledCounter) stays owned here, so these are
    // thin delegators. Their monaco/DOM-heavy siblings (updateUntitledDocumentType,
    // expandUntitledSnippet, updateUntitledTabPresentation) stay full in the class.
    static isUntitledPath(filePath) {
        return isUntitled(this.untitledDocuments, filePath);
    }

    static getDisplayName(filePath) {
        return untitledDisplayName(this.untitledDocuments, filePath);
    }

    // File-type detection, pure logic lives in tab_utils.js. These stay as
    // static delegators because they're called ~20× internally as this.X
    // (the bare calls below resolve to the tab_utils imports, not recursion).
    static isImageFile(filePath) {
        return isImageFile(filePath);
    }

    static isPdfFile(filePath) {
        return isPdfFile(filePath);
    }

    static isBinaryFile(filePath) {
        return isBinaryFile(filePath);
    }


    // Enhanced updateContextPath method
    static updateContextPath(filePath) {
        const contextContainer = document.getElementById('context-path');
        if (!contextContainer) return;

        if (!filePath) {
            contextContainer.className = 'context-path-container empty';
            contextContainer.innerHTML = '';
            return;
        }

        contextContainer.className = 'context-path-container';

        const segments = filePath.split(/[\\/]/);
        segments.pop();
        const fileName = this.getDisplayName(filePath);

        let html = '<i class="ph ph-folder-open"></i>';

        if (segments.length > 0) {
            html += segments.map(segment =>
                    `<span class="context-path-segment">${segment}</span>`
                )
                .join('<span class="context-path-separator">/</span>');

            html += '<span class="context-path-separator">/</span>';
        }

        const fileIcon = TabManager.getFileIcon(fileName);
        html += `<i class="${fileIcon}" style="color: var(--text)"></i>`;
        html += `<span class="context-path-filename">${fileName}</span>`;

        // Add file type indicator for binary files
        if (this.isBinaryFile(filePath) || this.isEmbeddedView(filePath)) {
            const fileType = this.isSurferView(filePath) ? 'Wave'
                : this.isPrismView(filePath) ? 'RTL'
                : this.isImageFile(filePath) ? 'Image' : 'PDF';
            html += `<span class="file-type-indicator">${fileType}</span>`;
        }

        contextContainer.innerHTML = html;
    }


    // Improved method to mark files as modified.
    //
    // Broadcasts the dirty marker to EVERY tab DOM element bound to this
    // file path, that's the main pane tab plus one entry per split pane
    // showing the same file. Querying with `.tab[data-path=...]` matches
    // both `.tab` (main) and `.tab.split-tab` (splits) because both share
    // the base class. VS Code-equivalent behaviour: edit in any pane, every
    // instance shows the dirty dot.
    static markFileAsModified(filePath) {
        if (!filePath) return;

        this.unsavedChanges.add(filePath);
        document
            .querySelectorAll(`.tab[data-path="${CSS.escape(filePath)}"]`)
            .forEach((tab) => {
                const closeButton = tab.querySelector('.close-tab');
                if (closeButton) {
                    closeButton.innerHTML = '•';
                    closeButton.style.color = '#ffd700';
                    closeButton.style.fontSize = '20px';
                }
            });
    }

    // Improved method to mark files as saved. Mirror of markFileAsModified
    //, every instance of the file (main + splits) drops the dirty dot.
    static markFileAsSaved(filePath) {
        if (!filePath) return;

        this.unsavedChanges.delete(filePath);
        document
            .querySelectorAll(`.tab[data-path="${CSS.escape(filePath)}"]`)
            .forEach((tab) => {
                const closeButton = tab.querySelector('.close-tab');
                if (closeButton) {
                    closeButton.innerHTML = '×';
                    closeButton.style.color = '';
                    closeButton.style.fontSize = '';
                }
            });
    }

    // (Removed dead saveEditorState/restoreEditorState: they were never called
    // and referenced an undeclared `editor`, a latent ReferenceError. Per-model
    // view state is owned by Monaco's model registry, not here.)

    // getFileIcon, Phosphor icon class for a filename. Pure logic in
    // tab_utils.js; this static delegator preserves the 4 external callers
    // (file tree, project tree, split editor, hierarchy view).
    static getFileIcon(filename) {
        return getFileIcon(filename);
    }

    // Promote preview tab to permanent (remove italic, keep tab)
    static promotePreviewToPermanent(filePath) {
        if (this.previewTab !== filePath) return;
        this.previewTab = null;
        const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
        if (tab) tab.classList.remove('preview');
    }

    /** A chave da aba do PRISM. So existe uma: o PRISM mostra UM projeto. */
    static PRISM_TAB = 'prism://PRISM';

    // Enhanced addTab method with binary file support
    // options: { preview: false } , preview=true opens as italic preview tab (VS Code style)
    static addTab(filePath, content = null, options = {}) {
        // A new tab always lands in the focused split when one is focused, the
        // "open in the focused split, necessarily" rule, no matter which open
        // path (tree click, import, AI) called addTab. Safe from recursion:
        // openInFocusedPane only re-enters addTab for the MAIN pane
        // (focusedPane 0), which this guard doesn't re-route, and pane.openFile
        // manages its own editors without calling back here.
        const sem = window.SplitEditorManager;
        if (sem && sem.focusedPane > 0 && !options._fromSplit) {
            sem.openInFocusedPane(filePath, content ?? '', options);
            return;
        }

        const isPreview = options.preview === true;

        // Check if tab already exists
        if (this.tabs.has(filePath)) {
            // If file is currently a preview tab and we want permanent, promote it
            if (this.previewTab === filePath && !isPreview) {
                this.promotePreviewToPermanent(filePath);
            }
            this.activateTab(filePath);
            return;
        }

        // If opening as preview, silently close the existing preview tab first
        if (isPreview && this.previewTab && this.previewTab !== filePath) {
            this._closePreviewSilently(this.previewTab);
        }

        // Create tab element
        const tabContainer = document.querySelector('#tabs-container');
        if (!tabContainer) {
            console.error('Tabs container not found');
            return;
        }

        const tab = document.createElement('div');
        tab.classList.add('tab');
        tab.setAttribute('data-path', filePath);
        tab.setAttribute('draggable', 'true');
        tab.setAttribute('title', this.isUntitledPath(filePath) ? this.getDisplayName(filePath) : filePath);

        // Add binary file indicator. A aba do Surfer entra pelo mesmo
        // caminho das binarias: nada de editor de texto para uma onda.
        const isBinary = this.isBinaryFile(filePath) || this.isEmbeddedView(filePath);
        if (isBinary) {
            tab.classList.add('binary-file');
        }

        // data-i18n-title pra que o applyDOM atualize o tooltip em
        // locale changes, sem ele, um tab criado em EN ficaria
        // preso em EN apos o toggle pra PT.
        const closeTitle = window.t ? window.t('tabs.close') : 'Close';
        const displayName = this.getDisplayName(filePath);
        // As abas do Surfer e do PRISM levam o logo da ferramenta, e nao o
        // icone generico de arquivo: o que esta aberto ali e a ferramenta, e
        // o logo e o mesmo que a toolbar ja usa para ela.
        const logo = this.isPrismView(filePath) ? './assets/icons/aurora_prism.svg'
            : this.isSurferView(filePath) ? './assets/icons/Surfer_logo.svg' : null;
        const icone = logo ? `<img class="tab-logo" src="${logo}" alt="">`
            : `<i class="${this.getFileIcon(displayName)}"></i>`;
        tab.innerHTML = `
      ${icone}
      <span class="tab-name">${displayName}</span>
      <button class="close-tab" title="${closeTitle}" data-i18n-title="tabs.close">×</button>
    `;
        if (this.isPrismView(filePath)) tab.setAttribute('title', 'PRISM');

        // Mark as preview if needed
        if (isPreview) {
            tab.classList.add('preview');
            this.previewTab = filePath;
        }

        // Add event listeners. Single click activates without promoting:
        // a preview tab stays italic until the user double-clicks it or
        // starts editing the buffer. VS Code parity.
        tab.addEventListener('click', () => {
            // Main pane is paneIndex 0, clicking its tab must flip the
            // SplitEditorManager focus back here, otherwise a split pane
            // remains "focused" (un-dimmed) even though the user just
            // clicked a main-pane tab.
            window.SplitEditorManager?.setFocus?.(0);
            this.activateTab(filePath);
        });
        tab.addEventListener('dblclick', () => {
            // Double-click always promotes preview to permanent
            this.promotePreviewToPermanent(filePath);
            this.activateTab(filePath);
        });
        const closeBtn = tab.querySelector('.close-tab');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(filePath);
        });

        // Middle-click (mouse wheel button) on any part of the tab
        // closes it, same convention as browsers and VS Code. Bound on
        // `auxclick` so the browser already filtered out primary/secondary
        // buttons for us; we still gate by `button === 1` defensively in
        // case some envs surface other auxiliary buttons through this
        // event (e.g. back/forward thumb buttons on a mouse).
        tab.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            this.closeTab(filePath);
        });
        // Firefox/Electron-on-Linux occasionally autoscrolls on a
        // middle-button mousedown before auxclick fires; suppress that
        // for tabs so the close happens cleanly.
        tab.addEventListener('mousedown', (e) => {
            if (e.button === 1) e.preventDefault();
        });

        // Add to container
        tabContainer.appendChild(tab);

        // Start watching file and periodic checking if this is the first tab.
        // A onda do Surfer fica de fora: recompilar REESCREVE o arquivo, e o
        // fluxo de re-serve (openSurferWave) ja recarrega o iframe; o dialogo
        // de "mudou no disco" so atrapalharia.
        if (!this.isEmbeddedView(filePath)) this.startWatchingFile(filePath);
        if (this.tabs.size === 0) {
            this.startPeriodicFileCheck();
        }

        // Handle binary files differently
        if (isBinary) {
            // Store file path for binary files
            this.tabs.set(filePath, '[BINARY_FILE]');
            this.activateTab(filePath);
        } else {
            // Handle text files normally
            this.tabs.set(filePath, content || '');

            // Editor creation needs Monaco's AMD modules + EditorManager
            // to be initialized. If the user opens a file before that
            // finishes (e.g. clicks a fresh .v right after app launch),
            // wait on EditorManager.ready before creating the instance.
            (async () => {
                try {
                    await EditorManager.ready;
                    const editor = EditorManager.createEditorInstance(filePath, content || '');
                    if (!editor) {
                        // initialize() couldn't bind the container; bail.
                        this.closeTab(filePath);
                        return;
                    }
                    this.setupContentChangeListener(filePath, editor);
                    this.activateTab(filePath);
                    // Optional jump-to-line (PRISM right-click → module
                    // definition). Done here, right after the editor exists,
                    // so it can't race the deferred creation, positioning
                    // straight after addTab() would hit a null editor.
                    // Deferred to the next frame + an explicit layout() so the
                    // just-shown editor has real dimensions: revealLineInCenter
                    // on an un-laid-out editor sets the cursor but doesn't
                    // scroll the viewport to the line.
                    if (options.revealPosition && typeof editor.revealLineInCenter === 'function') {
                        const ln = options.revealPosition.line || 1;
                        const col = options.revealPosition.column || 1;
                        requestAnimationFrame(() => {
                            editor.layout();
                            editor.setPosition({ lineNumber: ln, column: col });
                            editor.revealLineInCenter(ln);
                            editor.focus();
                        });
                    } else if (options.viewState && typeof editor.restoreViewState === 'function') {
                        // Cursor, seleção e rolagem de um editor que foi
                        // fechado e reaberto no mesmo gesto (renomear pela
                        // árvore). Mesmo lugar e mesmo adiamento do
                        // revealPosition acima, porque o problema é o mesmo:
                        // antes daqui o editor não existe, e sem o layout()
                        // ele ainda não tem altura para rolar até a linha.
                        // Um revealPosition explícito ganha, porque é um
                        // pedido de ir a outro lugar.
                        requestAnimationFrame(() => {
                            editor.layout();
                            try { editor.restoreViewState(options.viewState); }
                            catch (_) { /* estado de outra versão do Monaco */ }
                        });
                    }
                } catch (error) {
                    console.error('Error creating editor:', error);
                    this.closeTab(filePath);
                }
            })();
        }
        this.updateTabsContainerVisibility();
        this.initSortableTabs();
    }



    // Enhanced activateTab with better viewer management
    static activateTab(filePath) {
        // Only the MAIN pane's tab bar, split panes own their .split-tab active
        // state (SplitEditorManager._activateFile). Querying all `.tab` here used
        // to strip the active class off split tabs, so a split's tab stopped
        // following its own editor's focus.
        const tabs = document.querySelectorAll('.tab:not(.split-tab)');
        tabs.forEach(tab => tab.classList.remove('active'));

        const activeTab = document.querySelector(`.tab:not(.split-tab)[data-path="${CSS.escape(filePath)}"]`);
        if (activeTab) {
            activeTab.classList.add('active');
            // Capture the OUTGOING tab before overwriting activeTab, so the
            // PDF-state snapshot below saves the tab we're leaving, not the one
            // we're switching to (it used to read the already-updated value).
            const previousTab = this.activeTab;
            this.activeTab = filePath;
            // Notifica botoes gated-por-extensao (ex: C± so habilitado em
            // .cmm). Listeners em compilation_flow.js / outros consumers.
            document.dispatchEvent(new CustomEvent('aurora:editing-file-changed', {
                detail: { filePath },
            }));

            // Update context path
            this.updateContextPath(filePath);

            const editorContainer = document.getElementById('monaco-editor');
            this.hideOverlay();

            // Handle binary files
            if (this.isBinaryFile(filePath) || this.isEmbeddedView(filePath)) {
                // Save the OUTGOING tab's PDF state before switching away.
                if (previousTab && previousTab !== filePath && this.isPdfFile(previousTab)) {
                    this.savePdfViewerState(previousTab);
                }

                // Hide ALL editor instances
                const editorInstances = editorContainer.querySelectorAll('.editor-instance');
                editorInstances.forEach(el => {
                    el.style.display = 'none';
                    el.classList.remove('active');
                });

                // Hide all viewers first
                const allViewers = editorContainer.querySelectorAll('.image-viewer, .pdf-viewer, .surfer-viewer, .prism-viewer');
                allViewers.forEach(viewer => {
                    viewer.style.display = 'none';
                });

                // Get or create appropriate viewer
                let viewer = this.viewerInstances.get(filePath);
                if (!viewer) {
                    if (this.isSurferView(filePath)) {
                        viewer = this.createSurferViewer(filePath, this.surferViews.get(filePath).pageUrl);
                    } else if (this.isPrismView(filePath)) {
                        viewer = this.createPrismViewer(filePath);
                    } else if (this.isImageFile(filePath)) {
                        viewer = this.createImageViewer(filePath, editorContainer);
                    } else if (this.isPdfFile(filePath)) {
                        viewer = this.createPdfViewer(filePath, editorContainer);
                    }
                }

                // Add viewer to container if not already present
                if (viewer && !editorContainer.contains(viewer)) {
                    editorContainer.appendChild(viewer);
                }

                // Show only the current viewer
                if (viewer) {
                    viewer.style.display = 'flex';

                    // Restore PDF state if it's a PDF
                    if (this.isPdfFile(filePath)) {
                        this.restorePdfViewerState(filePath, viewer);
                    }
                }

            } else {
                // Hide all viewers for text files
                const allViewers = editorContainer.querySelectorAll('.image-viewer, .pdf-viewer, .surfer-viewer, .prism-viewer');
                allViewers.forEach(viewer => {
                    viewer.style.display = 'none';
                });

                // Show and activate the appropriate editor instance
                const editorInstances = editorContainer.querySelectorAll('.editor-instance');
                editorInstances.forEach(el => {
                    if (el.dataset.filePath === filePath) {
                        el.style.display = 'block';
                        el.classList.add('active');
                    } else {
                        el.style.display = 'none';
                        el.classList.remove('active');
                    }
                });

                EditorManager.setActiveEditor(filePath);
            }
        }
    }
    // Resolve "the file the user is currently editing", main pane uses
    // TabManager.activeTab, splits override with their own focused file.
    // Falls back to the main active tab if no split is focused.
    static getEditingFilePath() {
        const split = window.SplitEditorManager;
        if (split && typeof split.getFocusedFile === 'function') {
            const focused = split.getFocusedFile();
            if (focused) return focused;
        }
        return this.activeTab;
    }

    // Add listener for content changes.
    //
    // Uses the SharedModelRegistry's altVersionId snapshot rather than a
    // string-compare against this.tabs.get(filePath). The registry is the
    // pane-agnostic source of truth, so an edit made in a split pane that
    // shares the same model correctly clears/sets dirty here too, and
    // undoing all the way back to the saved state crosses the snapshot
    // and clears the dot, exactly like VS Code.
    static setupContentChangeListener(filePath, editor) {
        // Idempotent guard. createEditorInstance returns the SAME editor on
        // reopen, and addTab re-calls this, so without the guard every reopen
        // stacked another onDidChangeModelContent listener on the same editor:
        // a listener leak AND a callback that fired N times per keystroke.
        // Register exactly once per live editor; Monaco disposes the listener
        // when the editor itself is disposed (closeEditor), so a fresh editor
        // created after a close re-registers cleanly.
        if (editor.__auroraContentDisposable) return;
        editor.__auroraContentDisposable = editor.onDidChangeModelContent(() => {
            if (this.isUntitledPath(filePath)) {
                if (this.expandUntitledSnippet(filePath, editor)) {
                    this.markFileAsModified(filePath);
                    return;
                }
                this.updateUntitledDocumentType(filePath, editor.getValue());
                this.markFileAsModified(filePath);
                if (this.previewTab === filePath) {
                    this.promotePreviewToPermanent(filePath);
                }
                return;
            }
            const dirty = window.SharedModelRegistry?.isDirty?.(filePath) ?? false;
            if (dirty) {
                this.markFileAsModified(filePath);
                if (this.previewTab === filePath) {
                    this.promotePreviewToPermanent(filePath);
                }
            } else {
                this.markFileAsSaved(filePath);
            }
        });
    }



    static isClosingTab = false; // Prevent double closing

    // Whenever a Monaco editor (main or split) gets keyboard focus, it
    // dispatches `aurora-editor-focused` with the file path it's showing.
    // We use that to keep the tab UI in sync with where the cursor really
    // lives, the user shouldn't have to click the tab manually after
    // tabbing through panes or focusing a split via the keyboard.
    static _bindEditorFocusActivation() {
        if (this._editorFocusBound) return;
        this._editorFocusBound = true;
        // VS Code-style: the file tree's open-file highlight is BRIGHT while an
        // editor has focus and MUTED otherwise. Toggle a body class from the
        // editors' focus/blur, debounced so switching main<->split (blur then
        // focus) doesn't flicker the highlight off for a frame.
        let _editorBlurTimer = null;
        document.addEventListener('aurora-editor-focusstate', (e) => {
            if (e.detail && e.detail.focused) {
                if (_editorBlurTimer) { clearTimeout(_editorBlurTimer); _editorBlurTimer = null; }
                document.body.classList.add('editor-has-focus');
            } else {
                if (_editorBlurTimer) clearTimeout(_editorBlurTimer);
                _editorBlurTimer = setTimeout(() => {
                    document.body.classList.remove('editor-has-focus');
                    _editorBlurTimer = null;
                }, 150);
            }
        });
        document.addEventListener('aurora-editor-focused', (e) => {
            const detail = e.detail || {};
            const { filePath, paneIndex } = detail;
            if (!filePath) return;

            if (paneIndex === 0) {
                // Main pane, promote preview if needed and activate. Re-activate
                // not just when the active FILE differs, but also when the file
                // is active yet its tab lost the visual `.active` class (a split
                // pane's own activation, or the global activateTab, can strip it)
                //, so focusing the editor ALWAYS leaves its tab highlighted.
                const tabEl = document.querySelector(`.tab:not(.split-tab)[data-path="${CSS.escape(filePath)}"]`);
                if (this.activeTab !== filePath || !tabEl?.classList.contains('active')) {
                    if (this.previewTab === filePath) {
                        this.promotePreviewToPermanent(filePath);
                    }
                    this.activateTab(filePath);
                }
                // Cross-pane focus: clicking into the main editor (or its
                // tab) must flip the SplitEditorManager focus back to 0,
                // otherwise a split pane stays "focused" (un-dimmed) even
                // though the cursor is in the main pane.
                window.SplitEditorManager?.setFocus?.(0);
            }
            // Split panes are handled inside SplitEditorManager so they can
            // reach into their own pane's tab bar without going through us.
        });
    }

    // Initialize on script load
    static initialize() {
        // Idempotent: this runs at module load (bottom of this file) AND from
        // renderer.js on DOMContentLoaded. Without the guard every listener
        // here, including onFileChanged, was registered twice, so an external
        // change fired its handler (and a reload) twice (P5).
        if (this._initialized) return;
        this._initialized = true;
        this.initSortableTabs();
        this.restoreTabOrder();
        this.initFileChangeListeners();
        this.updateTabsContainerVisibility();
        this._bindEditorFocusActivation();

        // Add event listener to save tab order when tabs change
        const tabContainer = document.getElementById('tabs-container');
        if (tabContainer) {
            const observer = new MutationObserver(() => {
                this.saveTabOrder();
            });

            observer.observe(tabContainer, {
                childList: true,
                subtree: true
            });
        }
    }
}

// Install all mixins. Methods reference `this`, which resolves to TabManager
// when called as TabManager.foo(...). Order doesn't matter, none of the
// mixins shadow each other or the core class methods.
Object.assign(TabManager, tabViewers, tabDrag, tabWatchers, abasEmbutidas, salvarAbas, documentoSemNome, fecharAbas);

// Call initialization when the script loads
TabManager.initialize();

window.addEventListener('beforeunload', () => {
    TabManager.stopAllWatchers();
});

// Initialize tab container
function initTabs() {

    const editorContainer = document.getElementById('monaco-editor')
        .parentElement;
    const tabsContainer = document.createElement('div');
    if (document.getElementById('editor-tabs')) return;

    tabsContainer.id = 'editor-tabs';
    editorContainer.insertBefore(tabsContainer, editorContainer.firstChild);
}

window.addEventListener('load', () => {
    initTabs();
});

// NOTE: the editor shortcuts (Ctrl+N / Ctrl+W / Ctrl+S / Ctrl+Shift+T /
// Ctrl+Shift+S) USED to live here as a SECOND document 'keydown' handler. It
// duplicated shortcut_manager.js, the Phase-B unified entry that routes
// through AuroraAPI, whose editor.closeTab()/reopenLastTab()/save()/saveAll()/
// newFile() call the IDENTICAL TabManager methods (so the split-to-split close
// behaviour is preserved). Having both meant Ctrl+W closed TWO tabs at once:
// this handler had no input-focus guard, so outside the Monaco editor BOTH
// handlers fired (the shortcut_manager skipped textareas, hence inside the
// editor only this one ran → a single close, which is why the doubling only
// showed up outside the editor). Removed, shortcut_manager.js is now the sole
// owner of these shortcuts (Ctrl+W closes exactly one tab; Ctrl+Shift+W no
// longer closes anything since shortcut_manager's closeTab requires shift:off).
