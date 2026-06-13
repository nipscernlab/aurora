/* eslint-disable no-undef */
// monaco is loaded globally via index.html
// require is the AMD loader from monaco-editor/min/vs/loader.js

import { SharedModelRegistry } from './shared_models.js';
import { attachAiSelectionWidget } from './ai_selection_widget.js';

class EditorManager {
    static editors = new Map();
    static activeEditor = null;
    static editorContainer = null;
    static currentTheme = 'cmm-dark';
    static resizeObserver = null;
    static findStates = new Map();
    static decorationCollections = new Map();

    static updateOverlayVisibility() {
        const overlay = document.getElementById('editor-overlay');
        // Account for split panes too: the welcome must stay suppressed
        // while ANY pane (main or split) is showing a file.
        const splitMgr = window.SplitEditorManager;
        const splitsHaveContent = !!(splitMgr && Array.isArray(splitMgr.panes)
            && splitMgr.panes.some((p) => p?.tabs?.size > 0));
        const hasContent = this.editors.size > 0 || splitsHaveContent;

        // State model (see editor.css): the overlay ALWAYS keeps `visible`;
        // `hidden` is what toggles the welcome off when a file is open. The
        // old code removed `visible` here instead — which left the overlay
        // in a `hidden`-without-`visible` limbo that showed neither the
        // welcome NOR an editor: the "everything went grey" bug after
        // closing an (AI-)opened file.
        if (overlay) {
            overlay.classList.add('visible');
            overlay.classList.toggle('hidden', hasContent);
        }
        this.toggleEditorReadOnly(this.editors.size === 0);
    }

    static setupCursorListener(editor) {
        if (editor) {
            editor.onDidChangeCursorPosition(updateCursorPosition);
        }
    }

    static createEditorInstance(filePath, initialContent = '') {
        // Lazy fallback: setActiveEditor can fire before initialize() runs
        // (e.g. activateTab dispatched from a tab click during Monaco's
        // AMD-loading window). If Monaco itself is loaded the container is
        // safe to grab from the DOM, so do that instead of bailing.
        if (!this.editorContainer) {
            this.editorContainer = document.getElementById('monaco-editor');
        }
        if (!this.editorContainer || !window.monaco) {
            console.error('EditorManager has not been initialized. Please call EditorManager.initialize() on DOMContentLoaded.');
            return;
        }

        // ONE editor for the whole main pane (P1): register the file + its
        // shared model, then reuse the single editor — switching files happens
        // via setModel in setActiveEditor, not by stacking an editor per file.
        // Per-file view state (cursor/scroll) is kept in the map so switching
        // away and back restores the caret.
        const language = this.getLanguageFromPath(filePath);
        const model = SharedModelRegistry.acquire(filePath, initialContent, language);
        if (typeof initialContent === 'string' && initialContent !== '' && model.getValue() === '') {
            model.setValue(initialContent);
        }
        if (!this.editors.has(filePath)) this.editors.set(filePath, { viewState: null });
        if (this.sharedEditor) return this.sharedEditor;

        const editorDiv = document.createElement('div');
        editorDiv.className = 'editor-instance';
        editorDiv.id = 'editor-main-pane';
        editorDiv.dataset.filePath = filePath;
        editorDiv.style.cssText = `
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            display: block;
        `;

        this.editorContainer.appendChild(editorDiv);

        const theme = language === 'cmm' ? (this.currentTheme === 'cmm-dark' ? 'cmm-dark' : 'cmm-light') : this.currentTheme;

        const editor = monaco.editor.create(editorDiv, {
            theme: theme,
            model,
            automaticLayout: true,

            // SMOOTH CURSOR ANIMATION - Enhancement #2
            cursorSmoothCaretAnimation: 'on',
            cursorStyle: 'line',
            cursorWidth: 2,
            cursorBlinking: 'smooth',

            // ENHANCED SEARCH SETTINGS
            find: {
                addExtraSpaceOnTop: true,
                autoFindInSelection: 'never',
                seedSearchStringFromSelection: 'always',
                globalFindClipboard: true,
                loop: true
            },

            // BREADCRUMBS (symbol navigation)
            breadcrumbs: {
                enabled: true,
                filePath: 'on',
                symbolPath: 'on'
            },

            // OUTLINE AND SYMBOLS
            outlineFilters: {
                enabled: true
            },

            // ENHANCED CODE LENS
            codeLens: true,
            codeLensFontFamily: "'JetBrains Mono', monospace",
            codeLensFontSize: 12,

            // ENHANCED SUGGESTIONS
            suggest: {
                enabled: true,
                enableExtensions: true,
                showMethods: true,
                showFunctions: true,
                showConstructors: true,
                showFields: true,
                showVariables: true,
                showClasses: true,
                showStructs: true,
                showInterfaces: true,
                showModules: true,
                showProperties: true,
                showEvents: true,
                showOperators: true,
                showUnits: true,
                showValues: true,
                showConstants: true,
                showEnums: true,
                showEnumMembers: true,
                showKeywords: true,
                showWords: true,
                showColors: true,
                showFiles: true,
                showReferences: true,
                showFolders: true,
                showTypeParameters: true,
                showSnippets: true,
                filterGraceful: true,
                snippetsPreventQuickSuggestions: false,
                localityBonus: true,
                shareSuggestSelections: true
            },

            // PERFORMANCE IMPROVEMENTS
            renderValidationDecorations: 'on',

            // SMART WORD WRAP
            wordWrapBreakAfterCharacters: ' \t})]?|/&.,;¢°′″‴‶‷‸‹›«»',
            wordWrapBreakBeforeCharacters: '',
            wordWrapColumn: 120,

            // RESPONSIVE SETTINGS
            wordWrap: window.innerWidth < 768 ? 'on' : 'bounded',
            minimap: {
                enabled: window.innerWidth > 1024,
                scale: window.innerWidth > 1200 ? 1 : 0.8,
                showSlider: 'mouseover',
                renderCharacters: true,
                maxColumn: 120
            },
            // Default text smaller and tighter — matches the rest of the IDE
            // (status bar, file tree). Mobile breakpoint scales down further.
            fontSize: window.innerWidth < 768 ? 11 : 12,
            lineNumbers: window.innerWidth < 480 ? 'off' : 'on',
            folding: window.innerWidth > 768,

            // FONT SETTINGS
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
            fontLigatures: true,

            // EDITOR BEHAVIOR
            scrollBeyondLastLine: true,
            renderWhitespace: 'selection',
            // mouseWheelZoom disabled — accidental Ctrl+wheel was blowing up the
            // font and breaking the just-set defaults. Window-level zoom (zoom.js)
            // is still available as the intentional path.
            mouseWheelZoom: false,
            padding: {
                top: 12,
                bottom: 12
            },
            renderLineHighlight: 'all',
            lineNumbersMinChars: 4,
            glyphMargin: true,
            showFoldingControls: 'mouseover',
            
            // BRACKET PAIR COLORIZATION
            bracketPairColorization: {
                enabled: true
            },
            guides: {
                bracketPairs: true,
                indentation: true
            },
            
            // SMOOTH SCROLLING
            smoothScrolling: true,
            
            // AUTO-CLOSING
            autoClosingBrackets: 'always',
            autoClosingQuotes: 'always',
            
            // FORMATTING
            formatOnPaste: true,
            formatOnType: true,
            
            // SUGGESTIONS AND HINTS
            quickSuggestions: true,
            parameterHints: {
                enabled: true
            },
            hover: {
                enabled: true,
                delay: 300
            },
            
            // CONTEXT MENU AND INTERACTION
            contextmenu: true,
            dragAndDrop: true,
            links: true,
            
            // SCROLLBAR SETTINGS - Enhancement #1: Remove white dot
            scrollbar: {
                vertical: 'auto',
                horizontal: 'auto',
                useShadows: false,
                verticalHasArrows: false,
                horizontalHasArrows: false,
                verticalScrollbarSize: window.innerWidth < 768 ? 8 : 12,
                horizontalScrollbarSize: window.innerWidth < 768 ? 8 : 12,
                arrowSize: 0,
                // Additional settings to remove scrollbar decorations
                alwaysConsumeMouseWheel: true
            }
        });

        // INITIALIZE ENHANCED FEATURES
        this.setupEnhancedFeatures(editor);

        // The single shared editor. activeEditor stays === sharedEditor; the
        // file it currently shows is tracked in _activeFilePath (the listeners
        // below read THAT, not a captured filePath, since the editor switches
        // files via setModel).
        this.sharedEditor = editor;
        this.sharedContainer = editorDiv;
        this.activeEditor = editor;
        this._activeFilePath = filePath;

        // AI "ask about this" star — reads the currently-shown file.
        attachAiSelectionWidget(editor, { getFilePath: () => this._activeFilePath });

        // Auto-activate the focused editor's tab (mouse or keyboard). Custom
        // event to avoid importing TabManager (circular dep). Uses the file the
        // editor currently shows.
        editor.onDidFocusEditorWidget(() => {
            document.dispatchEvent(new CustomEvent('aurora-editor-focused', {
                detail: { filePath: this._activeFilePath, paneIndex: 0 },
            }));
        });

        // Re-decorate when the shown file changes (setModel), so bra-ket /
        // vertical-bar decorations track the new buffer.
        editor.onDidChangeModel(() => this._scheduleRedecorate(editor));

        this.decorateVerticalBar(editor);
        this.setupResponsiveObserver();
        this.updateOverlayVisibility();
        this.setupCursorListener(editor);

        // Font ligatures per language. Verilog uses `<=` as a non-blocking
        // assignment, but the JetBrains Mono ligature renders it as '≤' — and a
        // ligature is purely visual, so it can't tell assignment from the `<=`
        // comparison. We disable ligatures while editing Verilog (where `<=` is
        // mostly assignment) and keep them on for every other language.
        // Re-applied whenever the active model or its language changes.
        const syncLigatures = () => {
            const lang = editor.getModel()?.getLanguageId();
            editor.updateOptions({ fontLigatures: lang !== 'verilog' });
        };
        editor.onDidChangeModel(syncLigatures);
        editor.onDidChangeModelLanguage(syncLigatures);
        syncLigatures();

        // Re-decorate bra-ket + vertical-bar on edits AND on scroll/layout —
        // both now scan only the visible range (P11), so they must re-run when
        // the visible range changes. Debounced so a burst of keystrokes or a
        // scroll fling coalesces into one visible-range scan.
        editor.onDidChangeModelContent(() => this._scheduleRedecorate(editor));
        editor.onDidScrollChange(() => this._scheduleRedecorate(editor));
        editor.onDidLayoutChange(() => this._scheduleRedecorate(editor));

        return editor;
    }

    // Debounced, per-editor re-decoration of both visible-range scans. Coalesces
    // keystroke bursts and scroll flings into one pass (~120ms).
    static _scheduleRedecorate(editor) {
        if (editor.__redecorateTimer) clearTimeout(editor.__redecorateTimer);
        editor.__redecorateTimer = setTimeout(() => {
            editor.__redecorateTimer = null;
            this.decorateBraKet(editor);
            this.decorateVerticalBar(editor);
        }, 120);
    }

    static decorateBraKet(editor) {
        const model = editor.getModel();
        if (!model) return;

        try {
            // Scan only the visible lines, not the whole model (P11) — re-run on
            // scroll. Off-screen '⟩' decorations aren't visible anyway. Bail if
            // the editor isn't laid out yet; the scroll/layout listener re-runs.
            const ranges = editor.getVisibleRanges();
            if (!ranges.length) return;
            const matches = model.findMatches('⟩', ranges, false, false, null, true);

            // Build new decorations
            const newDecorations = matches.map(m => ({
                range: m.range,
                options: {
                    inlineClassName: 'bra-ket-padding'
                }
            }));

            // Get or create decoration collection for this editor
            const editorId = this.getEditorId(editor);
            let decorations = this.decorationCollections.get(editorId)?.braKet || [];
            
            // Apply decorations
            decorations = editor.deltaDecorations(decorations, newDecorations);
            
            // Store decoration IDs
            if (!this.decorationCollections.has(editorId)) {
                this.decorationCollections.set(editorId, {});
            }
            this.decorationCollections.get(editorId).braKet = decorations;
        } catch (error) {
            console.error('Error decorating bra-ket notation:', error);
        }
    }

    static decorateVerticalBar(editor) {
        const model = editor.getModel();
        if (!model) return;

        try {
            // Scan only the visible lines, not the whole model (P11): '|' is
            // everywhere in Verilog (OR), so a full-model scan applied hundreds
            // of decorations on every pass. Re-run on scroll/layout.
            const ranges = editor.getVisibleRanges();
            if (!ranges.length) return;
            const matches = model.findMatches('\\|', ranges, false, false, null, true);

            // Create inline decorations for each occurrence
            const newDecorations = matches.map(m => ({
                range: m.range,
                options: {
                    inlineClassName: 'vertical-bar-lower'
                }
            }));

            // Get or create decoration collection for this editor
            const editorId = this.getEditorId(editor);
            let decorations = this.decorationCollections.get(editorId)?.verticalBar || [];
            
            // Apply decorations
            decorations = editor.deltaDecorations(decorations, newDecorations);
            
            // Store decoration IDs
            if (!this.decorationCollections.has(editorId)) {
                this.decorationCollections.set(editorId, {});
            }
            this.decorationCollections.get(editorId).verticalBar = decorations;
        } catch (error) {
            console.error('Error decorating vertical bars:', error);
        }
    }

    static getEditorId(editor) {
        // One shared editor → one decoration bucket. Decorations are re-applied
        // per visible range on model switch / scroll, so a constant key is fine.
        return (editor && editor === this.sharedEditor) ? '__main__' : null;
    }

    static setupEnhancedFeatures(editor) {
        const commands = [
            {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    if (!activeEditor) return;

                    const findAction = activeEditor.getAction('actions.find');
                    if (findAction) {
                        findAction.run().then(() => {
                            setTimeout(() => {
                                const input = document.querySelector('.monaco-findInput input');
                                if (input) {
                                    input.focus();
                                }
                            }, 50);
                        });
                    }
                }
            },
            {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    if (!activeEditor) return;

                    activeEditor.getAction('editor.action.startFindReplaceAction').run().then(() => {
                        setTimeout(() => {
                            const input = document.querySelector('.monaco-findInput input');
                            if (input) input.focus();
                        }, 50);
                    });
                }
            },
            {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    if (activeEditor) {
                        activeEditor.getAction('editor.action.formatDocument').run();
                    }
                }
            },
            {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    if (activeEditor) {
                        activeEditor.getAction('editor.action.gotoLine').run();
                    }
                }
            },
            {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP,
                action: () => editor.getAction('editor.action.quickCommand').run()
            },
            {
                key: monaco.KeyCode.F12,
                action: () => editor.getAction('editor.action.revealDefinition').run()
            },
            {
                key: monaco.KeyMod.Alt | monaco.KeyCode.F12,
                action: () => editor.getAction('editor.action.peekDefinition').run()
            },
            {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12,
                action: () => editor.getAction('editor.action.goToImplementation').run()
            },
            {
                key: monaco.KeyMod.Shift | monaco.KeyCode.F12,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    if (activeEditor) {
                        activeEditor.getAction('editor.action.goToReferences').run();
                    }
                }
            }
        ];

        commands.forEach(({ key, action }) => {
            editor.addCommand(key, action);
        });

        // Detect the find widget being dismissed. Guard FIRST on our own tracked
        // state so the DOM query (.find-widget) only runs while a find is open —
        // the common case is closed, so this drops a per-keystroke querySelector
        // from the hot typing path (P11).
        editor.onDidChangeModelContent(() => {
            const state = this.findStates.get(this.getActiveFilePath());
            if (!state || !state.isOpen) return;
            const findWidget = document.querySelector('.find-widget');
            if (findWidget && !findWidget.classList.contains('visible')) {
                state.isOpen = false;
            }
        });
    }

    static getActiveFilePath() {
        const activeTab = document.querySelector('.tab.active');
        return activeTab ? activeTab.dataset.file : null;
    }

    static searchInAllFiles(searchTerm, options = {}) {
        const results = [];
        this.editors.forEach((_state, filePath) => {
            const model = SharedModelRegistry.getModel(filePath);

            if (model) {
                try {
                    const matches = model.findMatches(
                        searchTerm,
                        true,
                        options.isRegex || false,
                        options.matchCase || false,
                        options.wholeWord ? '\\b' + searchTerm + '\\b' : null,
                        true
                    );

                    if (matches.length > 0) {
                        results.push({
                            filePath,
                            matches: matches.map(match => ({
                                lineNumber: match.range.startLineNumber,
                                column: match.range.startColumn,
                                text: model.getLineContent(match.range.startLineNumber),
                                range: match.range
                            }))
                        });
                    }
                } catch (error) {
                    console.error(`Error searching in file ${filePath}:`, error);
                }
            }
        });

        return results;
    }

    static navigateToSearchResult(filePath, lineNumber, column) {
        const editor = this.setActiveEditor(filePath);
        if (editor) {
            editor.setPosition({ lineNumber, column });
            editor.revealLineInCenter(lineNumber);
            editor.focus();
        }
    }

    static setupResponsiveObserver() {
        if (!this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => {
                // Coalesce a burst of resize callbacks (one per frame of a window
                // drag / panel animation) into a single update — without this,
                // every frame iterated every editor calling updateOptions.
                if (this._responsiveRaf) return;
                this._responsiveRaf = requestAnimationFrame(() => {
                    this._responsiveRaf = 0;
                    this.updateResponsiveSettings();
                });
            });
            this.resizeObserver.observe(document.body);
        }
    }

    static updateResponsiveSettings() {
        const isMobile = window.innerWidth < 768;
        const isTablet = window.innerWidth < 1024;

        // The options below only change when one of these thresholds is crossed.
        // Skip the per-editor updateOptions entirely while the width stays in the
        // same band — the common case during a resize is "nothing crossed".
        const sig = [isMobile, isTablet, window.innerWidth > 1200, window.innerWidth < 480].join('|');
        if (sig === this._responsiveSig) return;
        this._responsiveSig = sig;

        this.sharedEditor?.updateOptions({
            wordWrap: isMobile ? 'on' : 'bounded',
            minimap: {
                enabled: !isTablet,
                scale: window.innerWidth > 1200 ? 1 : 0.8
            },
            fontSize: isMobile ? 12 : 14,
            lineNumbers: window.innerWidth < 480 ? 'off' : 'on',
            folding: !isMobile,
            scrollbar: {
                verticalScrollbarSize: isMobile ? 8 : 12,
                horizontalScrollbarSize: isMobile ? 8 : 12
            }
        });
    }

    static setTheme(isDark) {
        this.currentTheme = isDark ? 'cmm-dark' : 'cmm-light';

        // Apply to body for global theme
        document.body.className = isDark ? 'theme-dark' : 'theme-light';

        // One editor → theme the currently-shown file (re-themed on each switch
        // in setActiveEditor).
        this.applyThemeForActiveFile(isDark);

        // Save theme preference
        localStorage.setItem('editorTheme', isDark ? 'dark' : 'light');
    }

    // Theme the single editor for whatever file it currently shows. Called on a
    // global theme change AND on every file switch (setActiveEditor), since the
    // theme is language-specific and one editor now serves all files.
    static applyThemeForActiveFile(isDark = this.currentTheme !== 'cmm-light') {
        if (!this.sharedEditor || !this._activeFilePath) return;
        const language = this.getLanguageFromPath(this._activeFilePath);
        let theme;
        if (language === 'cmm') theme = isDark ? 'cmm-dark' : 'cmm-light';
        else if (language === 'asm') theme = isDark ? 'asm-dark' : 'asm-light';
        else theme = isDark ? 'vs-dark' : 'vs';
        this.sharedEditor.updateOptions({ theme });
    }

    static cleanup() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        this.sharedEditor?.dispose();
        this.sharedEditor = null;
        this.sharedContainer = null;
        this._activeFilePath = null;
        this.editors.forEach((_state, filePath) => SharedModelRegistry.release(filePath));

        this.editors.clear();
        this.findStates.clear();
        this.decorationCollections.clear();
        this.activeEditor = null;
    }

    static toggleEditorReadOnly(isReadOnly) {
        if (!this.sharedEditor) return;
        this.sharedEditor.updateOptions({ readOnly: isReadOnly });
    }

    static getLanguageFromPath(filePath) {
        const extension = filePath.split('.').pop().toLowerCase();
        const languageMap = {
            'js': 'javascript',
            'jsx': 'javascript',
            'ts': 'typescript',
            'tsx': 'typescript',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'md': 'markdown',
            'py': 'python',
            'c': 'c',
            'cpp': 'cpp',
            'h': 'c',
            'hpp': 'cpp',
            'cmm': 'cmm',
            'asm': 'asm',
            'v': 'verilog'
        };
        return languageMap[extension] || 'plaintext';
    }

    static setActiveEditor(filePath) {
        // Save current find state before switching
        const currentActiveFilePath = this.getActiveFilePath();
        if (currentActiveFilePath && this.activeEditor) {
            const findWidget = document.querySelector('.find-widget');
            const findInput = document.querySelector('.monaco-findInput input');

            if (!this.findStates.has(currentActiveFilePath)) {
                this.findStates.set(currentActiveFilePath, {});
            }
            
            const state = this.findStates.get(currentActiveFilePath);
            state.isOpen = findWidget && findWidget.classList.contains('visible');
            state.searchTerm = findInput ? findInput.value : '';
        }

        // The file must be registered (TabManager.addTab → createEditorInstance
        // does that). Bail quietly if not — the addTab IIFE calls us again once
        // it is. With one editor we never auto-create here either.
        const fileState = this.editors.get(filePath);
        if (!fileState || !this.sharedEditor) {
            return this.sharedEditor || null;
        }

        // Switch the single editor to this file's model (P1). Save the outgoing
        // file's view state (cursor/scroll) so switching back restores the caret.
        if (this._activeFilePath && this._activeFilePath !== filePath) {
            const outgoing = this.editors.get(this._activeFilePath);
            if (outgoing) outgoing.viewState = this.sharedEditor.saveViewState();
        }
        const model = SharedModelRegistry.getModel(filePath);
        if (model && this.sharedEditor.getModel() !== model) {
            this.sharedEditor.setModel(model);
        }
        this._activeFilePath = filePath;
        this.activeEditor = this.sharedEditor;
        this.applyThemeForActiveFile();
        // A binary viewer may have hidden the editor div — show it again.
        if (this.sharedContainer) this.sharedContainer.style.display = 'block';

        // Layout + restore state next frame (after display/model settle), with
        // the same split-focus guard as before so a tree click doesn't steal
        // focus into the main pane while the user works in a split.
        requestAnimationFrame(() => {
            if (!this.sharedEditor) return;
            this.sharedEditor.layout();
            if (fileState.viewState) this.sharedEditor.restoreViewState(fileState.viewState);

            if (!(window.SplitEditorManager && window.SplitEditorManager.focusedPane > 0)) {
                this.sharedEditor.focus();
            }

            const state = this.findStates.get(filePath);
            if (state && state.isOpen) {
                const findAction = this.sharedEditor.getAction('actions.find');
                if (findAction) {
                    findAction.run().then(() => {
                        setTimeout(() => {
                            const input = document.querySelector('.monaco-findInput input');
                            if (input && state.searchTerm) {
                                input.value = state.searchTerm;
                            }
                        }, 50);
                    });
                }
            }
        });

        this.updateOverlayVisibility();
        return this.sharedEditor;
    }

    static getEditorForFile(filePath) {
        // One editor — it "shows" a file only when that file is the active one.
        return (this._activeFilePath === filePath) ? this.sharedEditor : null;
    }

    static closeEditor(filePath) {
        if (!this.editors.has(filePath)) { this.updateOverlayVisibility(); return; }

        this.editors.delete(filePath);
        this.findStates.delete(filePath);
        SharedModelRegistry.release(filePath);

        // If the closed file was the one on screen, the caller (TabManager)
        // activates another tab immediately, which setModels the editor onto it.
        // If nothing is left, blank the single editor (don't dispose it — it's
        // reused for the next file).
        if (this._activeFilePath === filePath) {
            this._activeFilePath = null;
            if (this.sharedEditor && this.editors.size === 0) {
                this.sharedEditor.setModel(null);
            }
        }
        this.updateOverlayVisibility();
    }

    static async initialize() {
        await ensureMonacoInitialized();

        this.editorContainer = document.getElementById('monaco-editor');
        if (!this.editorContainer) {
            console.error('Editor container not found');
            return;
        }

        this.editorContainer.style.height = '100%';
        this.editorContainer.style.width = '100%';

        // Load saved theme preference
        const savedTheme = localStorage.getItem('editorTheme');
        const isDark = savedTheme ? savedTheme === 'dark' : true;
        this.setTheme(isDark);

        // Setup responsive observer
        this.setupResponsiveObserver();
    }
}

async function ensureMonacoInitialized() {
    return new Promise((resolve) => {
        if (window.monaco) {
            resolve();
        } else {
            const checkMonaco = setInterval(() => {
                if (window.monaco) {
                    clearInterval(checkMonaco);
                    resolve();
                }
            }, 100);
        }
    });
}

// Enhanced Monaco initialization with custom themes
let _monacoReady = null;
function initMonaco() {
    // Idempotent: both renderer.js and this module's own DOMContentLoaded
    // bootstrap call initMonaco, so memoize the promise — Monaco's AMD modules
    // load and the languages/theme register exactly once, and both awaiters
    // share the single resolution (P5).
    if (_monacoReady) return _monacoReady;
    _monacoReady = new Promise((resolve) => {
        require(['vs/editor/editor.main'], function () {
            setupCMMLanguage();
            setupASMLanguage();

            // Aurora dark theme — colors mirror theme_variables.css so the
            // editor surface blends with the rest of the IDE chrome.
            // Surfaces: --bg #0A0D14, --bg-elev #0F131C, --border #1F2532
            // Accent:   --accent #8E83E8, --accent-hover #A89EF0
            // Aurora syntax palette — calmer than VS Code defaults, tuned for
            // long-session legibility on the night-sky background.
            monaco.editor.defineTheme('cmm-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [
                    { token: 'comment',                          foreground: '6A6F7C', fontStyle: 'italic' },
                    { token: 'keyword',                          foreground: '8E83E8', fontStyle: 'bold' },
                    { token: 'keyword.directive.cmm',            foreground: 'B98AE0' },
                    { token: 'keyword.function.stdlib.cmm',      foreground: '5BB8E8', fontStyle: 'bold' },
                    { token: 'constant.define.cmm',              foreground: 'E8B86C', fontStyle: 'bold' },
                    { token: 'string',                           foreground: 'E68FB8' },
                    { token: 'number',                           foreground: '5FE0B0' },
                    { token: 'number.complex.imaginary.cmm',     foreground: 'BD93F9', fontStyle: 'bold' },
                    { token: 'operator',                         foreground: '9CA1AE' },
                    { token: 'operator.shift.arithmetic',        foreground: 'A89EF0', fontStyle: 'bold' },
                    { token: 'delimiter',                        foreground: '9CA1AE' },
                    { token: 'delimiter.square.inverted',        foreground: 'E68FB8' },
                    { token: 'dirac.bracket',                    foreground: 'A89EF0', fontStyle: 'bold' },
                    { token: 'dirac.bar',                        foreground: 'A89EF0', fontStyle: 'bold' },
                    { token: 'keyword.special.dirac',            foreground: 'B98AE0', fontStyle: 'bold' }
                ],
                colors: {
                    // Surface — match the IDE canvas so the editor disappears into the chrome
                    'editor.background':                  '#0A0D14',
                    'editor.foreground':                  '#E8ECF3',
                    'editorGutter.background':            '#0A0D14',
                    'minimap.background':                 '#0A0D14',
                    // Line numbers
                    'editorLineNumber.foreground':        '#3F434E',
                    'editorLineNumber.activeForeground':  '#A89EF0',
                    // Selection (uses --accent-strong rgba)
                    'editor.selectionBackground':         '#8E83E830',
                    'editor.selectionHighlightBackground':'#8E83E81C',
                    'editor.inactiveSelectionBackground': '#8E83E820',
                    // Current line — matches --bg-elev
                    'editor.lineHighlightBackground':     '#0F131C',
                    'editor.lineHighlightBorder':         '#0F131C',
                    // Cursor
                    'editorCursor.foreground':            '#8E83E8',
                    // Whitespace + indent guides
                    'editorWhitespace.foreground':        '#1F2532',
                    'editorIndentGuide.background1':      '#161A23',
                    'editorIndentGuide.activeBackground1':'#8E83E8',
                    // Find / search
                    'editor.findMatchBackground':         '#8E83E866',
                    'editor.findMatchHighlightBackground':'#8E83E833',
                    'editor.findMatchBorder':             '#A89EF0',
                    // Bracket matching
                    'editorBracketMatch.background':      '#8E83E833',
                    'editorBracketMatch.border':          '#8E83E8',
                    // Bracket pair colorization (Aurora ribbon, calmer)
                    'editorBracketHighlight.foreground1': '#5FE0B0',
                    'editorBracketHighlight.foreground2': '#5BB8E8',
                    'editorBracketHighlight.foreground3': '#8E83E8',
                    'editorBracketHighlight.foreground4': '#B98AE0',
                    'editorBracketHighlight.foreground5': '#E68FB8',
                    'editorBracketHighlight.foreground6': '#4FD3C2',
                    'editorBracketHighlight.unexpectedBracket.foreground': '#E26C6C',
                    // Scrollbar
                    'scrollbar.shadow':                   '#00000000',
                    'scrollbarSlider.background':         '#1F253260',
                    'scrollbarSlider.hoverBackground':    '#2A3040A0',
                    'scrollbarSlider.activeBackground':   '#8E83E866',
                    // Minimap selection echoes accent
                    'minimap.selectionHighlight':         '#8E83E844',
                    'minimap.findMatchHighlight':         '#8E83E866',
                    // Status / errors / warnings
                    'editorError.foreground':             '#E26C6C',
                    'editorWarning.foreground':           '#E8B86C',
                    'editorInfo.foreground':              '#5BB8E8'
                }
            });

            // Aurora light theme — same Aurora hue family but inverted for
            // a soft daytime surface. Accent stays the same violet.
            monaco.editor.defineTheme('cmm-light', {
                base: 'vs',
                inherit: true,
                rules: [
                    { token: 'comment',                          foreground: '7B7F8B', fontStyle: 'italic' },
                    { token: 'keyword',                          foreground: '6E63C8', fontStyle: 'bold' },
                    { token: 'keyword.directive.cmm',            foreground: '8B5CB8' },
                    { token: 'keyword.function.stdlib.cmm',      foreground: '2A7AB0', fontStyle: 'bold' },
                    { token: 'constant.define.cmm',              foreground: 'B5791F', fontStyle: 'bold' },
                    { token: 'string',                           foreground: 'B8568C' },
                    { token: 'number',                           foreground: '3A9D6E' },
                    { token: 'number.complex.imaginary.cmm',     foreground: '7C3AED', fontStyle: 'bold' },
                    { token: 'operator',                         foreground: '545A6B' },
                    { token: 'operator.shift.arithmetic',        foreground: '6E63C8', fontStyle: 'bold' },
                    { token: 'delimiter',                        foreground: '545A6B' },
                    { token: 'delimiter.square.inverted',        foreground: 'B8568C' },
                    { token: 'dirac.bracket',                    foreground: '6E63C8', fontStyle: 'bold' },
                    { token: 'dirac.bar',                        foreground: '6E63C8', fontStyle: 'bold' },
                    { token: 'keyword.special.dirac',            foreground: '8B5CB8', fontStyle: 'bold' }
                ],
                colors: {
                    'editor.background':                  '#FAFAFC',
                    'editor.foreground':                  '#2A2D38',
                    'editorGutter.background':            '#FAFAFC',
                    'minimap.background':                 '#FAFAFC',
                    'editorLineNumber.foreground':        '#B5B8C2',
                    'editorLineNumber.activeForeground':  '#6E63C8',
                    'editor.selectionBackground':         '#8E83E830',
                    'editor.selectionHighlightBackground':'#8E83E81C',
                    'editor.lineHighlightBackground':     '#F1F1F5',
                    'editor.lineHighlightBorder':         '#F1F1F5',
                    'editorCursor.foreground':            '#6E63C8',
                    'editorWhitespace.foreground':        '#DDDDE3',
                    'editorIndentGuide.background1':      '#EAEAEF',
                    'editorIndentGuide.activeBackground1':'#6E63C8',
                    'editor.findMatchBackground':         '#8E83E866',
                    'editor.findMatchHighlightBackground':'#8E83E833',
                    'editorBracketMatch.background':      '#8E83E833',
                    'editorBracketMatch.border':          '#6E63C8',
                    'editorBracketHighlight.foreground1': '#3A9D6E',
                    'editorBracketHighlight.foreground2': '#2A7AB0',
                    'editorBracketHighlight.foreground3': '#6E63C8',
                    'editorBracketHighlight.foreground4': '#8B5CB8',
                    'editorBracketHighlight.foreground5': '#B8568C',
                    'editorBracketHighlight.foreground6': '#3FB0A0',
                    'editorBracketHighlight.unexpectedBracket.foreground': '#C5453F',
                    'scrollbar.shadow':                   '#00000000',
                    'scrollbarSlider.background':         '#0000001A',
                    'scrollbarSlider.hoverBackground':    '#00000033',
                    'scrollbarSlider.activeBackground':   '#6E63C866',
                    'editorError.foreground':             '#C5453F',
                    'editorWarning.foreground':           '#C49344',
                    'editorInfo.foreground':              '#2A7AB0'
                }
            });

            resolve();
        });
    });
    return _monacoReady;
}

function setupASMLanguage() {
    monaco.languages.register({ id: 'asm' });

    monaco.languages.setMonarchTokensProvider('asm', {
        defaultToken: '',
        tokenPostfix: '.asm',

        directives: [
            'PRNAME', 'NUBITS', 'NBMANT', 'NBEXPO', 'NDSTAC', 'SDEPTH',
            'NUIOIN', 'NUIOOU', 'NUGAIN', 'FFTSIZ', 'array', 'arrays', 'ITRAD', 'TOAQUI'
        ],

        instructions: [
            'LOD', 'P_LOD', 'LDI', 'ILI', 'SET', 'SET_P', 'SRF', 'IRF', 'PSH', 'POP', 
            'P_LOD_V', 'MLT_V', 'F_MLT_V', 'INN', 'OUT', 'STI', 'ISI', 'PST', 'PST_M', 
            'ADD', 'S_ADD', 'F_ADD', 'SF_ADD', 'P_PST_M', 'MLT', 'S_MLT', 'F_MLT', 
            'SF_MLT', 'F_PST', 'DIV', 'S_DIV', 'F_DIV', 'SF_DIV', 'F_PST_M', 'MOD', 
            'S_MOD', 'PF_PST_M', 'ADD_V', 'SGN', 'S_SGN', 'F_SGN', 'SF_SGN', 'F_ADD_V', 
            'NEG', 'NEG_M', 'P_NEG_M', 'F_NEG', 'F_NEG_M', 'PF_NEG_M', 'ABS', 'ABS_M', 
            'P_ABS_M', 'F_ABS', 'F_ABS_M', 'PF_ABS_M', 'NRM', 'NRM_M', 'P_NRM_M', 'P_INN', 
            'NOP', 'I2F', 'I2F_M', 'P_I2F_M', 'F2I', 'F2I_M', 'P_F2I_M', 'AND', 'S_AND', 
            'ORR', 'S_ORR', 'XOR', 'S_XOR', 'INV', 'INV_M', 'P_INV_M', 'LAN', 'S_LAN', 
            'LOR', 'S_LOR', 'LOD_V', 'CAL', 'RET', 'SET_V', 'LIN', 'LIN_M', 'P_LIN_M', 
            'LES', 'S_LES', 'F_LES', 'SF_LES', 'GRE', 'S_GRE', 'F_GRE', 'SF_GRE', 'EQU', 
            'S_EQU', 'SHL', 'S_SHL', 'SHR', 'S_SHR', 'SRS', 'S_SRS', 'F_INN', 'PF_INN', 
            'JMP', 'JIZ', 'F_ROT', 'F_SU1', 'F_SU2', 'SF_SU1', 'SF_SU2'
        ],

        jumpInstructions: ['JMP', 'JIZ'],

        symbols: /[=><!~?:&|+*/%^-]+/,

        tokenizer: {
            root: [
                [/#(PRNAME|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|NUGAIN|FFTSIZ|array|arrays|ITRAD|TOAQUI)\b/, 'keyword.directive'],
                [/\/\/.*$/, 'comment'],
                [/;.*$/, 'comment'],
                [/^\s*[a-zA-Z_]\w*:/, 'type.identifier'],
                [/\b0x[0-9a-fA-F]+\b/, 'number.hex'],
                [/\b[0-9]+\b/, 'number'],
                [/\b[01]+b\b/, 'number.binary'],
                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
                [/\b(JMP|JIZ)\b/, 'keyword.jumpInstruction'],
                [/\b([A-Z][A-Z0-9_]*)\b/, {
                    cases: {
                        '@instructions': 'keyword.instruction',
                        '@directives': 'keyword.directive',
                        '@default': 'identifier'
                    }
                }],
                [/[a-zA-Z_]\w*/, 'identifier'],
                { include: '@whitespace' },
                [/[(),]/, 'delimiter'],
                [/[=<>!+\-*/]/, 'operator'],
                [/@\w+/, 'annotation.asm']
            ],

            string: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white']
            ]
        }
    });

    // Aurora ASM Dark — same surfaces as cmm-dark for visual consistency.
    monaco.editor.defineTheme('asm-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'keyword.instruction',     foreground: '8E83E8', fontStyle: 'bold' },
            { token: 'keyword.jumpInstruction', foreground: 'E8B86C', fontStyle: 'bold' },
            { token: 'keyword.directive',       foreground: 'B98AE0', fontStyle: 'bold' },
            { token: 'type.identifier',         foreground: '5FE0B0' },
            { token: 'comment',                 foreground: '6A6F7C', fontStyle: 'italic' },
            { token: 'number',                  foreground: '5FE0B0' },
            { token: 'number.hex',              foreground: '5BB8E8' },
            { token: 'number.binary',           foreground: '4FD3C2' },
            { token: 'string',                  foreground: 'E68FB8' },
            { token: 'operator',                foreground: '9CA1AE' },
            { token: 'delimiter',               foreground: '9CA1AE' },
            { token: 'annotation.asm',          foreground: 'A89EF0', fontStyle: 'italic' }
        ],
        colors: {
            'editor.background':                  '#0A0D14',
            'editor.foreground':                  '#E8ECF3',
            'editorGutter.background':            '#0A0D14',
            'minimap.background':                 '#0A0D14',
            'editorLineNumber.foreground':        '#3F434E',
            'editorLineNumber.activeForeground':  '#A89EF0',
            'editor.selectionBackground':         '#8E83E830',
            'editor.selectionHighlightBackground':'#8E83E81C',
            'editor.lineHighlightBackground':     '#0F131C',
            'editor.lineHighlightBorder':         '#0F131C',
            'editorCursor.foreground':            '#8E83E8',
            'editorWhitespace.foreground':        '#1F2532',
            'editorIndentGuide.background1':      '#161A23',
            'editorIndentGuide.activeBackground1':'#8E83E8',
            'editor.findMatchBackground':         '#8E83E866',
            'editor.findMatchHighlightBackground':'#8E83E833',
            'editorBracketMatch.background':      '#8E83E833',
            'editorBracketMatch.border':          '#8E83E8',
            'scrollbar.shadow':                   '#00000000',
            'scrollbarSlider.background':         '#1F253260',
            'scrollbarSlider.hoverBackground':    '#2A3040A0',
            'scrollbarSlider.activeBackground':   '#8E83E866'
        }
    });

    // Aurora ASM Light — same surfaces as cmm-light for visual consistency.
    monaco.editor.defineTheme('asm-light', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'keyword.instruction',     foreground: '6E63C8', fontStyle: 'bold' },
            { token: 'keyword.jumpInstruction', foreground: 'C49344', fontStyle: 'bold' },
            { token: 'keyword.directive',       foreground: '8B5CB8', fontStyle: 'bold' },
            { token: 'type.identifier',         foreground: '3A9D6E' },
            { token: 'comment',                 foreground: '7B7F8B', fontStyle: 'italic' },
            { token: 'number',                  foreground: '3A9D6E' },
            { token: 'number.hex',              foreground: '2A7AB0' },
            { token: 'number.binary',           foreground: '3FB0A0' },
            { token: 'string',                  foreground: 'B8568C' },
            { token: 'operator',                foreground: '545A6B' },
            { token: 'delimiter',               foreground: '545A6B' },
            { token: 'annotation.asm',          foreground: '6E63C8', fontStyle: 'italic' }
        ],
        colors: {
            'editor.background':                  '#FAFAFC',
            'editor.foreground':                  '#2A2D38',
            'editorGutter.background':            '#FAFAFC',
            'minimap.background':                 '#FAFAFC',
            'editorLineNumber.foreground':        '#B5B8C2',
            'editorLineNumber.activeForeground':  '#6E63C8',
            'editor.selectionBackground':         '#8E83E830',
            'editor.selectionHighlightBackground':'#8E83E81C',
            'editor.lineHighlightBackground':     '#F1F1F5',
            'editor.lineHighlightBorder':         '#F1F1F5',
            'editorCursor.foreground':            '#6E63C8',
            'editorWhitespace.foreground':        '#DDDDE3',
            'editorIndentGuide.background1':      '#EAEAEF',
            'editorIndentGuide.activeBackground1':'#6E63C8'
        }
    });
}

// Names captured from `#define NAME ...` lines across the open .cmm models.
// Baked into the Monarch tokenizer (the `defineConstants` attribute below) and
// refreshed whenever a #define is added/removed, so every later use of NAME
// lights up like a constant. We lean on Monarch for the hard part — this set is
// ONLY consulted by the identifier rule inside `root`, so it never fires inside
// a comment/string (those run in their own states) and reserved words / types /
// stdlib functions are matched first, so a name can never override them.
let cmmDefineConstants = [];

function buildCMMTokenizer(defineConstants) {
    return {
        defaultToken: '',
        tokenPostfix: '.cmm',

        // Live set of object-like #define names — consulted by the identifier
        // rule's `@defineConstants` case (see root below).
        defineConstants,

        keywords: [
            'if', 'else', 'for', 'while', 'do', 'struct', 'return', 'break', 'continue', 
            'switch', 'case', 'default', 'goto', 'sizeof', 'volatile', 'typedef', 'enum', 
            'union', 'register', 'extern', 'inline', 'void', 'int', 'comp', 'char', 'float', 
            'double', 'bool', 'long', 'short', 'signed', 'unsigned', 'const', 'static', 
            'auto', 'Jussara', 'Anon', 'Chrysthofer'
        ],

        typeKeywords: [
            'bool', 'int', 'long', 'float', 'double', 'char', 'void', 'unsigned', 
            'signed', 'short'
        ],

        operators: [
            '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||', 
            '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>', 
            '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>='
        ],

        symbols: /[=><!~?:&|+*/%^-]+/,

        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

        tokenizer: {
            root: [
                [/#(PRNAME|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|NUGAIN|FFTSIZ|PRACA|TOAQUI)/, 'keyword.directive.cmm'],

                // Object-like macro: `#define NAME body`. The directive + the
                // name being defined are coloured here; every later use of NAME
                // is picked up by the identifier rule's @defineConstants case.
                [/(#define)(\s+)([a-zA-Z_]\w*)/, ['keyword.directive.cmm', 'white', 'constant.define.cmm']],
                [/#define\b/, 'keyword.directive.cmm'],

                [/\b(in|fin|out|fout|norm|sign|pset|abs|copy|sqrt|atan|sin|cos|tan|exp|log|pow|real|imag|fase|mod2|complex|vtv)\b(?=\s*\()/, 'keyword.function.stdlib.cmm'],
                
                // Dirac notation patterns
                [/(\w+)\s*(#)\s*([^⟨|⟩]+)?\s*(\|)([^⟨|⟩\s]+)(\|)\s*([^⟨|⟩\s]+)?\s*(⟩)/, ['identifier', 'operator', 'identifier', 'dirac.bar', 'identifier', 'dirac.bar', 'identifier', 'dirac.bracket']],
                [/(\w+)\s*(#)\s*([^⟨|⟩]+)?\s*(\|)([BI])(\|)/, ['identifier', 'operator', 'identifier', 'dirac.bar', 'keyword.special.dirac', 'dirac.bar']],
                [/(\w+)\s*(#)\s*(\|)([^⟨|⟩\s]+)(⟩⟨)([^⟨|⟩\s]+)(\|)/, ['identifier', 'operator', 'dirac.bar', 'identifier', 'dirac.bracket', 'identifier', 'dirac.bar']],
                [/(\w+)\s*(#)\s*(\|)([^⟨|⟩\s]+)(\|)\s*(-)\s*(\|)([^⟨|⟩\s]+)(⟩⟨)([^⟨|⟩\s]+)(\|)/, ['identifier', 'operator', 'dirac.bar', 'identifier', 'dirac.bar', 'operator', 'dirac.bar', 'identifier', 'dirac.bracket', 'identifier', 'dirac.bar']],
                [/(\w+)\s*(#)\s*(\|)(0)(⟩)/, ['identifier', 'operator', 'dirac.bar', 'keyword.special.dirac', 'dirac.bracket']],
                [/(\w+)\s*(#)\s*([^⟨|⟩\s]+)\s*(\|)(in\([^)]+\))(⟩)/, ['identifier', 'operator', 'identifier', 'dirac.bar', 'keyword.function.stdlib.cmm', 'dirac.bracket']],
                [/(out)\s*\(\s*([^,]+)\s*,\s*([^⟨|⟩\s]+)?\s*(\|)([^⟨|⟩\s]+)(⟩)\s*\)/, ['keyword.function.stdlib.cmm', 'identifier', 'identifier', 'dirac.bar', 'identifier', 'dirac.bracket']],
                [/(⟨)([^⟨⟩|]+)(\|)([^⟨⟩|]+)(⟩)/, ['dirac.bracket', 'identifier', 'dirac.bar', 'identifier', 'dirac.bracket']],
                [/(\|)([^⟨⟩|\s]+)(⟩)/, ['dirac.bar', 'identifier', 'dirac.bracket']],
                [/(⟨)([^⟨⟩|]+)(\|)/, ['dirac.bracket', 'identifier', 'dirac.bar']],
                [/(\|)([IB])(\|)/, ['dirac.bar', 'keyword.special.dirac', 'dirac.bar']],
                [/(\|)(0)(⟩)/, ['dirac.bar', 'keyword.special.dirac', 'dirac.bracket']],
                [/(\|)(in\([^)]+\))(⟩)/, ['dirac.bar', 'keyword.function.stdlib.cmm', 'dirac.bracket']],
                [/[⟨⟩]/, 'dirac.bracket'],
                [/\|/, 'dirac.bar'],

                // Array-from-file: nome[TAM] "arquivo.txt". O TAM precisa
                // sair com cor de numero (igual a `[112]` numa declaracao
                // comum) — englobar `[7168]` inteiro como delimiter deixava
                // o tamanho cinza/"sem cor", visivel nos blocos de pesos.
                [/(\[\s*)(\d+)(\s*\])(\s*)("[^"]*")/, ['delimiter.square', 'number', 'delimiter.square', 'white', 'string']],
                [/\[\s*\w+\s*\)/, 'delimiter.square.inverted'],

                // Numeros complexos — sufixo imaginario `im`. A parte
                // imaginaria e <magnitude>im: aceita inteiro (8im), decimal
                // (9.234im) ou a parte imaginaria sozinha (4im em `9 + 4im`).
                // A magnitude fica com cor de numero; o `im` recebe o roxo
                // dedicado (number.complex.imaginary.cmm). O \b final impede
                // casar `im` colado num identificador maior (4import).
                // `im8` NAO casa (exige digitos ANTES do `im`), entao cai como
                // identificador comum — comportamento pedido por enquanto.
                [/(\d*\.?\d+)(im)\b/, ['number', 'number.complex.imaginary.cmm']],

                [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
                [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                [/\d+/, 'number'],

                [/[a-zA-Z_]\w*/, {
                    cases: {
                        '@typeKeywords': 'keyword.type',
                        '@keywords': 'keyword',
                        '@defineConstants': 'constant.define.cmm',
                        '@default': 'identifier'
                    }
                }],

                { include: '@whitespace' },

                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
                [/'[^\\']'/, 'string'],
                [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
                [/'/, 'string.invalid'],
                [/>>>/, 'operator.shift.arithmetic'],
                [/@symbols/, {
                    cases: {
                        '@operators': 'operator',
                        '@default': ''
                    }
                }]
            ],

            comment: [
                [/[^/*]+/, 'comment'],
                [/\/\*/, 'comment', '@push'],
                [/\*\//, 'comment', '@pop'],
                [/[/*]/, 'comment']
            ],

            string: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape.invalid'],
                [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white'],
                [/\/\*/, 'comment', '@comment'],
                [/\/\/.*$/, 'comment']
            ]
        }
    };
}

// Scan every open .cmm model for object-like `#define NAME …` declarations and
// return the unique set of NAMEs. The anchored regex only matches a #define at
// the start of a line (leading whitespace allowed), so a `#define` written
// inside a string or after code never registers a phantom constant.
function collectCMMDefineNames() {
    const names = new Set();
    const re = /^[ \t]*#define[ \t]+([a-zA-Z_]\w*)/gm;
    for (const model of monaco.editor.getModels()) {
        if (model.getLanguageId() !== 'cmm') continue;
        const text = model.getValue();
        let m;
        while ((m = re.exec(text))) names.add(m[1]);
    }
    return [...names];
}

// Re-bake the Monarch tokenizer only when the #define name set actually changed
// (re-registering re-tokenizes every cmm model, so we avoid doing it on every
// keystroke — it fires at most when a #define line is edited).
function refreshCMMDefines() {
    const names = collectCMMDefineNames();
    const changed = names.length !== cmmDefineConstants.length
        || names.some(n => !cmmDefineConstants.includes(n));
    if (!changed) return;
    cmmDefineConstants = names;
    monaco.languages.setMonarchTokensProvider('cmm', buildCMMTokenizer(cmmDefineConstants));
}

function setupCMMLanguage() {
    monaco.languages.register({ id: 'cmm' });
    monaco.languages.setMonarchTokensProvider('cmm', buildCMMTokenizer(cmmDefineConstants));

    // Keep the dynamic #define set in sync with the open .cmm buffers. A short
    // debounce coalesces bursts of keystrokes; refreshCMMDefines() itself is a
    // no-op unless the set of names changed.
    let debounceTimer = null;
    const scheduleRefresh = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(refreshCMMDefines, 300);
    };

    const watched = new WeakSet();
    const watch = (model) => {
        if (!model || watched.has(model) || model.getLanguageId() !== 'cmm') return;
        watched.add(model);
        model.onDidChangeContent(scheduleRefresh);
        scheduleRefresh();
    };

    monaco.editor.getModels().forEach(watch);
    monaco.editor.onDidCreateModel(watch);
    // A buffer can be created as plaintext and only later flipped to cmm.
    monaco.editor.onDidChangeModelLanguage(({ model }) => watch(model));
}

function updateCursorPosition(event) {
    const position = event.position;
    const statusElement = document.getElementById('editorStatus');

    if (statusElement && position) {
        const lineNumber = position.lineNumber;
        const columnNumber = position.column;

        statusElement.classList.add('updating');
        const lineColText = window.t
            ? window.t('editor.lineCol', { line: lineNumber, col: columnNumber })
            : `Ln ${lineNumber}, Col ${columnNumber}`;
        statusElement.innerHTML = `<i class="ph ph-text-align-left"></i> ${lineColText}`;

        setTimeout(() => {
            statusElement.classList.remove('updating');
        }, 150);
    }
}

// Promise that resolves once Monaco's AMD modules + EditorManager.initialize()
// have finished. addTab/setActiveEditor await this so files opened during the
// brief window between app launch and Monaco being ready don't try to create
// an editor against a still-null container.
let _resolveEditorManagerReady;
EditorManager.ready = new Promise((resolve) => {
    _resolveEditorManagerReady = resolve;
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initMonaco();
        await EditorManager.initialize();
    } finally {
        _resolveEditorManagerReady();
    }

    window.addEventListener('resize', () => {
        if (EditorManager.editors.size > 0) {
            EditorManager.updateResponsiveSettings();
        }
    });
});

export { EditorManager, initMonaco };