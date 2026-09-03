/* eslint-disable no-undef */
// monaco is loaded globally via index.html
// require is the AMD loader from monaco-editor/min/vs/loader.js

import '../components/aurora-editor.js';
import { SharedModelRegistry } from './shared_models.js';
import { attachAiSelectionWidget } from './ai_selection_widget.js';
import { initVerilogLSP } from './lsp_integration.js';
import { initClangFormat } from './clang_format_integration.js';
import { initPythonFormat } from './python_format_integration.js';
import { initSlang } from './slang_integration.js';
import { initTreeSitter } from './treesitter_highlight.js';
import { registrarSnippetsDirac } from './dirac_snippets.js';
import { installEmptyPlaceholder } from './empty_placeholder.js';

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
        // old code removed `visible` here instead, which left the overlay
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

        // Idempotent: if an editor for this filePath already exists, reuse it.
        // Without this, racing call sites (setActiveEditor's auto-create +
        // TabManager.addTab's IIFE) end up with two editor-instance divs
        // stacked in the same container, both bound to the same shared model
        //, typing produces visual artefacts and the user can't tell which
        // pane has focus. Seed the shared model from initialContent if it
        // hasn't been seeded yet.
        const existing = this.editors.get(filePath);
        if (existing) {
            if (typeof initialContent === 'string' && initialContent !== '') {
                const model = existing.editor.getModel();
                if (model && model.getValue() === '') {
                    model.setValue(initialContent);
                }
            }
            return existing.editor;
        }

        const editorDiv = document.createElement('div');
        editorDiv.className = 'editor-instance';
        editorDiv.id = `editor-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
        editorDiv.dataset.filePath = filePath;
        editorDiv.style.cssText = `
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            display: none;
        `;

        this.editorContainer.appendChild(editorDiv);

        const language = this.getLanguageFromPath(filePath);
        const theme = language === 'cmm' ? (this.currentTheme === 'cmm-dark' ? 'cmm-dark' : 'cmm-light') : this.currentTheme;

        // Shared model: every editor showing this file (main pane + any split
        // panes) attaches to the same `ITextModel`, so edits propagate
        // automatically and the dirty marker fires once for the file rather
        // than once per pane.
        const model = SharedModelRegistry.acquire(filePath, initialContent, language);

        const editor = monaco.editor.create(editorDiv, {
            theme: theme,
            model,
            automaticLayout: true,

            // O balao de erro (hover) precisa poder sair do editor.
            //
            // Sem isto o Monaco desenha o balao DENTRO do proprio editor, que
            // vive num contexto de empilhamento abaixo da barra de ferramentas
            // e das abas: passar o mouse numa ondinha de erro na primeira linha
            // mostrava o texto por baixo da toolbar, que e justamente onde ele
            // aparece com mais frequencia. Com `fixedOverflowWidgets` o balao
            // vai para uma camada fixa fora do editor, e o CSS
            // (css/editor/editor.css, .monaco-editor .overflowingContentWidgets)
            // a coloca acima da casca.
            fixedOverflowWidgets: true,

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

            // O7: enable semantic tokens (tree-sitter overlay) regardless of
            // theme; the provider only emits for Verilog/SV/C/C++.
            'semanticHighlighting.enabled': true,

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
            // Default text smaller and tighter, matches the rest of the IDE
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
            // mouseWheelZoom disabled, accidental Ctrl+wheel was blowing up the
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

        // AI "ask about this" star, appears on any non-empty selection.
        attachAiSelectionWidget(editor, { getFilePath: () => filePath });

        this.editors.set(filePath, {
            editor: editor,
            container: editorDiv
        });

        // Auto-activate the file's tab whenever the editor gains focus
        // (mouse click *or* keyboard navigation). Dispatched as a custom
        // event so this module doesn't have to import TabManager and risk
        // a circular dependency.
        editor.onDidFocusEditorWidget(() => {
            document.dispatchEvent(new CustomEvent('aurora-editor-focused', {
                detail: { filePath, paneIndex: 0 },
            }));
            // VS Code-style: the tree's open-file highlight brightens while an
            // editor has focus and mutes when it doesn't.
            document.dispatchEvent(new CustomEvent('aurora-editor-focusstate', { detail: { focused: true } }));
        });
        editor.onDidBlurEditorWidget(() => {
            document.dispatchEvent(new CustomEvent('aurora-editor-focusstate', { detail: { focused: false } }));
        });

        // A dica "// New Verilog file" de arquivo vazio (ver empty_placeholder.js).
        installEmptyPlaceholder(editor, filePath);

        this.decorateVerticalBar(editor);
        this.setupResponsiveObserver();
        this.updateOverlayVisibility();
        this.setupCursorListener(editor);

        // Font ligatures per language. Verilog uses `<=` as a non-blocking
        // assignment, but the JetBrains Mono ligature renders it as '≤', and a
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

        // Re-decorate bra-ket + vertical-bar on edits AND on scroll/layout:
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
            // Scan only the visible lines, not the whole model (P11), re-run on
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

    /**
     * Alinha a barra da notacao de Dirac com o angulo que a fecha.
     *
     * `|v⟩` sai torto porque os dois simbolos vem de fontes DIFERENTES: a
     * JetBrains Mono e vendorizada so nos subsets latin e latin-ext, e ⟨ ⟩
     * (U+27E8 e U+27E9) estao fora deles, entao o angulo cai numa fonte de
     * recurso enquanto a barra vem da fonte do editor. Medido dentro da AURORA,
     * com as fontes de verdade carregadas: a 12px a barra ocupa de -10 a +2 em
     * torno da linha de base e o angulo de -9 a +3, a mesma altura deslocada de
     * 1px; a 14px, -12..+2 contra -10..+3. A barra esta ACIMA nos dois casos, e
     * por isso ela DESCE para encontrar o angulo, ao contrario do que a leitura
     * a olho nu sugeria.
     *
     * So em .cmm, e so nas linhas que tem angulo. A versao anterior decorava
     * TODA barra de TODO arquivo, e em Verilog a barra e o operador OR: mexer
     * nela seria entortar um codigo inteiro para endireitar outro. Numa linha
     * sem angulo nao ha notacao de Dirac para alinhar.
     */
    static decorateVerticalBar(editor) {
        const model = editor.getModel();
        if (!model) return;

        try {
            if (model.getLanguageId() !== 'cmm') { this._limparBarras(editor); return; }
            // Scan only the visible lines, not the whole model (P11). Re-run on
            // scroll/layout.
            const ranges = editor.getVisibleRanges();
            if (!ranges.length) return;
            const newDecorations = [];
            for (const r of ranges) {
                for (let ln = r.startLineNumber; ln <= r.endLineNumber; ln++) {
                    const texto = model.getLineContent(ln);
                    if (!texto.includes('⟨') && !texto.includes('⟩')) continue;
                    for (let i = texto.indexOf('|'); i >= 0; i = texto.indexOf('|', i + 1)) {
                        newDecorations.push({
                            range: new monaco.Range(ln, i + 1, ln, i + 2),
                            options: { inlineClassName: 'vertical-bar-lower' },
                        });
                    }
                }
            }

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

    /** Tira as barras decoradas de um editor que deixou de ser .cmm. */
    static _limparBarras(editor) {
        const editorId = this.getEditorId(editor);
        const antigas = this.decorationCollections.get(editorId)?.verticalBar || [];
        if (!antigas.length) return;
        editor.deltaDecorations(antigas, []);
        this.decorationCollections.get(editorId).verticalBar = [];
    }

    static getEditorId(editor) {
        for (const [filePath, data] of this.editors.entries()) {
            if (data.editor === editor) {
                return filePath;
            }
        }
        return null;
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
        // state so the DOM query (.find-widget) only runs while a find is open:
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
        // Tabs store the path in `data-path` (dataset.path), not `data-file`:
        // reading dataset.file always returned undefined, so the per-file find
        // state (findStates) never keyed correctly.
        return activeTab ? activeTab.dataset.path : null;
    }

    static searchInAllFiles(searchTerm, options = {}) {
        const results = [];
        this.editors.forEach((editorData, filePath) => {
            const { editor } = editorData;
            const model = editor.getModel();

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
                // drag / panel animation) into a single update, without this,
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
        // same band, the common case during a resize is "nothing crossed".
        const sig = [isMobile, isTablet, window.innerWidth > 1200, window.innerWidth < 480].join('|');
        if (sig === this._responsiveSig) return;
        this._responsiveSig = sig;

        this.editors.forEach(({ editor }) => {
            editor.updateOptions({
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
        });
    }

    static setTheme(isDark) {
        this.currentTheme = isDark ? 'cmm-dark' : 'cmm-light';

        // Apply to body for global theme
        document.body.className = isDark ? 'theme-dark' : 'theme-light';

        // Apply to all editors with specific theme based on language
        this.editors.forEach(({ editor }, filePath) => {
            const language = this.getLanguageFromPath(filePath);
            let theme;

            if (language === 'cmm' || language === 'matlab') {
                // MATLAB rides the CMM/Aurora palette (single canonical theme):
                // its Monarch tokens are generic (keyword/string/number/…), which
                // the cmm-dark rules already colour, so it blends with the IDE.
                theme = isDark ? 'cmm-dark' : 'cmm-light';
            } else if (language === 'asm') {
                theme = isDark ? 'asm-dark' : 'asm-light';
            } else {
                theme = isDark ? 'vs-dark' : 'vs';
            }

            editor.updateOptions({ theme: theme });
        });

        // Save theme preference
        localStorage.setItem('editorTheme', isDark ? 'dark' : 'light');
    }

    static cleanup() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        this.editors.forEach(({ editor }, filePath) => {
            editor.dispose();
            SharedModelRegistry.release(filePath);
        });

        this.editors.clear();
        this.findStates.clear();
        this.decorationCollections.clear();
        this.activeEditor = null;
    }

    static toggleEditorReadOnly(isReadOnly) {
        this.editors.forEach(({ editor }) => {
            editor.updateOptions({ readOnly: isReadOnly });
            if (isReadOnly) {
                editor.blur();
            }
        });
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
            'cc': 'cpp',
            'cxx': 'cpp',
            'h': 'c',
            'hpp': 'cpp',
            'hh': 'cpp',
            'hxx': 'cpp',
            'cmm': 'cmm',
            'asm': 'asm',
            'm': 'matlab',
            'v': 'verilog',
            'vh': 'verilog',
            'sv': 'systemverilog',
            'svh': 'systemverilog',
            'spf': 'json'   // project file is JSON — gets keys/strings/numbers + folding for free
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

        // Hide all editors
        this.editors.forEach(({ container }) => {
            container.style.display = 'none';
        });

        // No auto-create here. TabManager.addTab owns editor creation (with
        // file content) via its EditorManager.ready-gated IIFE; if we forced
        // a create here we'd race that path and end up with a duplicate
        // empty editor stacked on top. Bail quietly, the IIFE will call us
        // again once the editor is in the map.
        const editorData = this.editors.get(filePath);
        if (!editorData) {
            return null;
        }

        // Show and activate this editor
        editorData.container.style.display = 'block';
        this.activeEditor = editorData.editor;

        // Layout and restore state. requestAnimationFrame fires after the
        // browser has applied the display:block above and computed layout:
        // exactly when editor.layout() can measure the container correctly.
        // The old setTimeout(…, 50) was a guess: too early on a slow frame
        // (mis-measured layout) and, worse, it opened a 50ms window in which
        // the deferred focus() below could steal focus from a pane the user
        // had since switched to (the "file always opens on the left" bug).
        requestAnimationFrame(() => {
            // A rapid close (e.g. holding Ctrl+W) can dispose this editor and
            // null activeEditor before this deferred frame runs, bail so we
            // never call layout()/focus()/getAction() on null.
            if (!this.activeEditor) return;
            this.activeEditor.layout();

            // Don't pull keyboard focus into the main pane while the user is
            // working in a split. This deferred focus() fires
            // onDidFocusEditorWidget → aurora-editor-focused (paneIndex 0),
            // whose listener resets SplitEditorManager.focusedPane to 0. That
            // reset is why a file-tree click would "always open on the left":
            // the main editor silently stole focus a few ms after the last
            // main-pane tab activation, so by click time focusedPane was 0.
            if (!(window.SplitEditorManager && window.SplitEditorManager.focusedPane > 0)) {
                this.activeEditor.focus();
            }

            // Restore find widget state for this file
            const state = this.findStates.get(filePath);
            if (state && state.isOpen) {
                const findAction = this.activeEditor.getAction('actions.find');
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
        return this.activeEditor;
    }

    static getEditorForFile(filePath) {
        const editorData = this.editors.get(filePath);
        return editorData ? editorData.editor : null;
    }

    static closeEditor(filePath) {
        const editorData = this.editors.get(filePath);
        if (editorData) {
            // Clear the dangling active-editor pointer BEFORE disposing, so
            // nothing (e.g. TabManager's "no tabs left" cleanup) ends up
            // calling setValue()/layout() on a disposed instance, which
            // throws and aborts the close mid-way, leaving the editor area
            // grey.
            if (this.activeEditor === editorData.editor) this.activeEditor = null;
            // Dispose the editor view but NOT the model, that's the
            // registry's job. If a split pane is still showing this file,
            // the model has to outlive the main editor.
            editorData.editor.dispose();
            if (editorData.container?.parentNode === this.editorContainer) {
                this.editorContainer.removeChild(editorData.container);
            }
            this.editors.delete(filePath);
            this.findStates.delete(filePath);
            this.decorationCollections.delete(filePath);
            SharedModelRegistry.release(filePath);
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

// How long the editor boot may take before it is declared failed. Monaco's AMD
// modules come from local disk, so on a healthy install this is a couple of
// seconds even on a cold machine. Past this, nothing is still loading: the
// loader failed (the 0.53.0 mode, see ARCHITECTURE section 8) or the bundle is
// incomplete, and waiting longer only hides it.
const MONACO_BOOT_DEADLINE_MS = 30000;

/**
 * Resolves once `window.monaco` exists, rejects on the deadline. This used to
 * poll forever: a loader failure left this promise, and with it
 * `EditorManager.ready`, unresolved, so every addTab blocked in its await,
 * the tab appeared, the editor did not, and nothing was logged.
 */
async function ensureMonacoInitialized() {
    return new Promise((resolve, reject) => {
        if (window.monaco) {
            resolve();
            return;
        }
        const started = Date.now();
        const checkMonaco = setInterval(() => {
            if (window.monaco) {
                clearInterval(checkMonaco);
                resolve();
            } else if (Date.now() - started > MONACO_BOOT_DEADLINE_MS) {
                clearInterval(checkMonaco);
                reject(new Error(`Monaco did not initialize within ${MONACO_BOOT_DEADLINE_MS / 1000}s`));
            }
        }, 100);
    });
}

// Enhanced Monaco initialization with custom themes
let _monacoReady = null;
function initMonaco() {
    // Idempotent: both renderer.js and this module's own DOMContentLoaded
    // bootstrap call initMonaco, so memoize the promise, Monaco's AMD modules
    // load and the languages/theme register exactly once, and both awaiters
    // share the single resolution (P5).
    if (_monacoReady) return _monacoReady;
    _monacoReady = new Promise((resolve, reject) => {
        require(['vs/editor/editor.main'], function () {
            setupCMMLanguage();
            setupASMLanguage();
            setupMatlabLanguage();
            // O2: attach the Verible language server to .v/.sv buffers
            // (diagnostics, formatting, outline, hover, definition/refs).
            // The 'verilog'/'systemverilog' languages are already registered
            // by the vendored Monaco build, so this only wires the providers.
            initVerilogLSP();
            // Shift+Alt+F formatting for C / C++ / CMM via bundled clang-format
            // (CMM borrows C rules). Verilog formats via Verible above; Monaco
            // dispatches by the focused buffer's language automatically.
            initClangFormat();
            // Python fecha a lista de idiomas formatáveis: black pelo
            // interpretador que o localizador já descobre para o cocotb.
            initPythonFormat();
            // O11: slang semantic analysis for Verilog/SystemVerilog:
            // elaboration diagnostics + completion, complementing Verible.
            // Toggleable (command palette); only wires providers here.
            initSlang();
            // O7: tree-sitter precise highlighting (semantic tokens) for
            // Verilog/SV/C/C++ via web-tree-sitter (WASM). Overlays Monarch;
            // best-effort (falls back to Monarch if grammars are absent).
            initTreeSitter();

            // Aurora dark theme, colors mirror theme_variables.css so the
            // editor surface blends with the rest of the IDE chrome.
            // Surfaces: --bg #0A0D14, --bg-elev #0F131C, --border #1F2532
            // Accent:   --accent #8E83E8, --accent-hover #A89EF0
            // Aurora syntax palette, calmer than VS Code defaults, tuned for
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
                    { token: 'constant.language',                foreground: 'E8B86C', fontStyle: 'bold' },
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
                    // Surface, match the IDE canvas so the editor disappears into the chrome
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
                    // Current line, matches --bg-elev
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

            // Aurora light theme, same Aurora hue family but inverted for
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
                    { token: 'constant.language',                foreground: 'B5791F', fontStyle: 'bold' },
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
        }, function (err) {
            // The AMD loader reports a missing or broken module here. Without
            // this errback the promise never settled and the editor boot hung
            // in silence; now it fails loudly and EditorManager.ready still
            // resolves (see the DOMContentLoaded handler at the bottom).
            reject(err instanceof Error ? err : new Error(`Monaco AMD load failed: ${err && err.message ? err.message : err}`));
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

    // Aurora ASM Dark, same surfaces as cmm-dark for visual consistency.
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

    // Aurora ASM Light, same surfaces as cmm-light for visual consistency.
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

// MATLAB / Octave (.m). Not shipped by the vendored Monaco build (see the
// basic-languages folder, matlab is absent), so we register it ourselves with
// a Monarch tokenizer, exactly like CMM and ASM above. Tokens are deliberately
// generic (keyword/string/number/comment/operator/delimiter + constant.language)
// so the cmm-dark/cmm-light Aurora themes colour them with zero extra rules:
// keeping the single canonical theme.
//
// The one MATLAB-specific subtlety is the apostrophe: `'` is BOTH the char-array
// delimiter ('text') AND the (conjugate-)transpose operator (A'). We disambiguate
// with a two-mode tokenizer: in `root` an apostrophe opens a string; right after
// a value (identifier / number / closing bracket / another transpose) we sit in
// the tiny `@transpose` state where a run of apostrophes is an operator instead.
// Lookbehind is avoided on purpose, Monarch anchors each rule at the current
// offset, so `(?<=…)` can't see the preceding character reliably.
function setupMatlabLanguage() {
    monaco.languages.register({
        id: 'matlab',
        extensions: ['.m'],
        aliases: ['MATLAB', 'matlab', 'Octave', 'octave']
    });

    monaco.languages.setLanguageConfiguration('matlab', {
        comments: { lineComment: '%', blockComment: ['%{', '%}'] },
        brackets: [['{', '}'], ['[', ']'], ['(', ')']],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"', notIn: ['string'] },
            { open: "'", close: "'", notIn: ['string', 'comment'] }
        ],
        surroundingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ],
        indentationRules: {
            increaseIndentPattern: /^\s*(if|elseif|else|for|parfor|while|switch|case|otherwise|function|classdef|methods|properties|events|enumeration|try|catch|do|unwind_protect|spmd)\b.*$/,
            decreaseIndentPattern: /^\s*(end|endif|endwhile|endfor|endfunction|endswitch|endclassdef|endmethods|endproperties|endevents|endenumeration|endparfor|else|elseif|case|otherwise|catch|until|unwind_protect_cleanup)\b.*$/
        }
    });

    monaco.languages.setMonarchTokensProvider('matlab', {
        defaultToken: '',
        tokenPostfix: '.matlab',

        // Control flow + declarations. Octave `end*`/`unwind_protect` variants are
        // included so plain-Octave .m files highlight too.
        keywords: [
            'break', 'case', 'catch', 'classdef', 'continue', 'do', 'else',
            'elseif', 'end', 'end_try_catch', 'end_unwind_protect', 'endclassdef',
            'endenumeration', 'endevents', 'endfor', 'endfunction', 'endif',
            'endmethods', 'endparfor', 'endproperties', 'endswitch', 'endwhile',
            'enumeration', 'events', 'for', 'function', 'global', 'if', 'methods',
            'otherwise', 'parfor', 'persistent', 'properties', 'return', 'spmd',
            'switch', 'try', 'until', 'unwind_protect', 'unwind_protect_cleanup',
            'while'
        ],

        // Built-in constants / special values.
        constants: [
            'true', 'false', 'pi', 'eps', 'Inf', 'inf', 'NaN', 'nan', 'NA',
            'ans', 'nargin', 'nargout', 'varargin', 'varargout', 'realmax',
            'realmin'
        ],

        operators: [
            '+', '-', '*', '/', '\\', '^', '.\'', '.^', '.*', './', '.\\',
            '==', '~=', '!=', '<', '>', '<=', '>=', '&', '|', '~', '!', '&&',
            '||', '=', '+=', '-=', '*=', '/=', '^=', '++', '--', ':', '@'
        ],

        symbols: /[=><~&|+\-*/^%@:!.\\]+/,

        tokenizer: {
            root: [
                // Block comment `%{ … %}` / Octave `#{ … #}`, only when the
                // opener is alone on its line (MATLAB rule). Mid-line `%{` falls
                // through to the line-comment rule below.
                [/^\s*%\{[ \t]*$/, { token: 'comment', next: '@blockcomment' }],
                [/^\s*#\{[ \t]*$/, { token: 'comment', next: '@blockcomment' }],

                // Line comments (`%` MATLAB, `#` Octave) and `...` continuation
                // (the tail after `...` is a comment).
                [/%.*$/, 'comment'],
                [/#.*$/, 'comment'],
                [/\.\.\..*$/, 'comment'],

                // Non-conjugate transpose `.'`, a value-position apostrophe run
                // is handled by @transpose instead (see below).
                [/\.'/, 'operator'],

                // Identifiers / keywords / constants. Landing on a value flips us
                // into @transpose so a following `'` reads as transpose.
                [/[a-zA-Z_]\w*/, {
                    cases: {
                        '@keywords':  { token: 'keyword',           next: '@transpose' },
                        '@constants': { token: 'constant.language', next: '@transpose' },
                        '@default':   { token: 'identifier',        next: '@transpose' }
                    }
                }],

                // Function handle: @name
                [/@[a-zA-Z_]\w*/, 'identifier'],

                { include: '@whitespace' },

                // Numbers (optional imaginary suffix i/j). Also value → @transpose.
                [/\d*\.\d+([eE][-+]?\d+)?[ij]?/, { token: 'number.float', next: '@transpose' }],
                [/0[xX][0-9a-fA-F]+/,            { token: 'number.hex',   next: '@transpose' }],
                [/\d+([eE][-+]?\d+)?[ij]?/,      { token: 'number',       next: '@transpose' }],

                // Brackets. A closing bracket is a value, so it also enters
                // @transpose (handles `A(1:end)'`, `[1 2]'`).
                [/[([{]/, '@brackets'],
                [/[)\]}]/, { token: '@brackets', next: '@transpose' }],

                // Strings, apostrophe here (NOT after a value) opens a char array.
                [/"/, { token: 'string.quote', bracket: '@open', next: '@dqstring' }],
                [/'/, { token: 'string.quote', bracket: '@open', next: '@sqstring' }],

                // Operators / delimiters.
                [/@symbols/, { cases: { '@operators': 'operator', '@default': 'delimiter' } }],
                [/[;,]/, 'delimiter']
            ],

            // Entered right after a value: a run of apostrophes is (c)transpose;
            // anything else re-tokenizes in root. Empty on end-of-line, so the
            // state self-heals on the next line's first character.
            transpose: [
                [/'+/, 'operator'],
                [/./, { token: '@rematch', next: '@pop' }]
            ],

            blockcomment: [
                [/^\s*%\}[ \t]*$/, { token: 'comment', next: '@pop' }],
                [/^\s*#\}[ \t]*$/, { token: 'comment', next: '@pop' }],
                [/.*$/, 'comment']
            ],

            dqstring: [
                [/[^"]+/, 'string'],
                [/""/, 'string'],
                [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            sqstring: [
                [/[^']+/, 'string'],
                [/''/, 'string'],
                [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white']
            ]
        }
    });
}

// Names captured from `#define NAME ...` lines across the open .cmm models.
// Baked into the Monarch tokenizer (the `defineConstants` attribute below) and
// refreshed whenever a #define is added/removed, so every later use of NAME
// lights up like a constant. We lean on Monarch for the hard part, this set is
// ONLY consulted by the identifier rule inside `root`, so it never fires inside
// a comment/string (those run in their own states) and reserved words / types /
// stdlib functions are matched first, so a name can never override them.
let cmmDefineConstants = [];

function buildCMMTokenizer(defineConstants) {
    return {
        defaultToken: '',
        tokenPostfix: '.cmm',

        // Live set of object-like #define names, consulted by the identifier
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
                
                // Dirac notation patterns. Os grupos que podem ficar vazios sao
                // `(...*)`, nunca `(...+)?`: numa regra com acao por grupos o
                // Monarch soma o comprimento de CADA grupo capturado, e um grupo
                // opcional que nao participa chega como undefined e derruba o
                // tokenizer inteiro ("Cannot read properties of undefined
                // (reading 'length')") na primeira linha que case sem ele.
                [/(\w+)(\s*)(#)(\s*)([^⟨|⟩]*)(\s*)(\|)([^⟨|⟩\s]+)(\|)(\s*)([^⟨|⟩\s]*)(\s*)(⟩)/, ['identifier', 'white', 'operator', 'white', 'identifier', 'white', 'dirac.bar', 'identifier', 'dirac.bar', 'white', 'identifier', 'white', 'dirac.bracket']],
                [/(\w+)(\s*)(#)(\s*)([^⟨|⟩]*)(\s*)(\|)([BI])(\|)/, ['identifier', 'white', 'operator', 'white', 'identifier', 'white', 'dirac.bar', 'keyword.special.dirac', 'dirac.bar']],
                [/(\w+)(\s*)(#)(\s*)(\|)([^⟨|⟩\s]+)(⟩⟨)([^⟨|⟩\s]+)(\|)/, ['identifier', 'white', 'operator', 'white', 'dirac.bar', 'identifier', 'dirac.bracket', 'identifier', 'dirac.bar']],
                [/(\w+)(\s*)(#)(\s*)(\|)([^⟨|⟩\s]+)(\|)(\s*)(-)(\s*)(\|)([^⟨|⟩\s]+)(⟩⟨)([^⟨|⟩\s]+)(\|)/, ['identifier', 'white', 'operator', 'white', 'dirac.bar', 'identifier', 'dirac.bar', 'white', 'operator', 'white', 'dirac.bar', 'identifier', 'dirac.bracket', 'identifier', 'dirac.bar']],
                [/(\w+)(\s*)(#)(\s*)(\|)(0)(⟩)/, ['identifier', 'white', 'operator', 'white', 'dirac.bar', 'keyword.special.dirac', 'dirac.bracket']],
                [/(\w+)(\s*)(#)(\s*)([^⟨|⟩\s]+)(\s*)(\|)(in\([^)]+\))(⟩)/, ['identifier', 'white', 'operator', 'white', 'identifier', 'white', 'dirac.bar', 'keyword.function.stdlib.cmm', 'dirac.bracket']],
                [/(out)(\s*)(\()(\s*)([^,]+)(\s*)(,)(\s*)([^⟨|⟩\s]*)(\s*)(\|)([^⟨|⟩\s]+)(⟩)(\s*)(\))/, ['keyword.function.stdlib.cmm', 'white', 'delimiter.parenthesis', 'white', 'identifier', 'white', 'delimiter', 'white', 'identifier', 'white', 'dirac.bar', 'identifier', 'dirac.bracket', 'white', 'delimiter.parenthesis']],
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
                // comum), englobar `[7168]` inteiro como delimiter deixava
                // o tamanho cinza/"sem cor", visivel nos blocos de pesos.
                [/(\[\s*)(\d+)(\s*\])(\s*)("[^"]*")/, ['delimiter.square', 'number', 'delimiter.square', 'white', 'string']],
                [/\[\s*\w+\s*\)/, 'delimiter.square.inverted'],

                // Numeros complexos, sufixo imaginario `im`. A parte
                // imaginaria e <magnitude>im: aceita inteiro (8im), decimal
                // (9.234im) ou a parte imaginaria sozinha (4im em `9 + 4im`).
                // A magnitude fica com cor de numero; o `im` recebe o roxo
                // dedicado (number.complex.imaginary.cmm). O \b final impede
                // casar `im` colado num identificador maior (4import).
                // `im8` NAO casa (exige digitos ANTES do `im`), entao cai como
                // identificador comum, comportamento pedido por enquanto.
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
// keystroke, it fires at most when a #define line is edited).
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

    // Os simbolos da notacao de Dirac nao estao no teclado, e o compilador so
    // aceita eles: digitar `ket` e aceitar a sugestao e o caminho. Ver
    // js/editor/dirac_snippets.js.
    registrarSnippetsDirac(monaco);

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
    } catch (err) {
        // The editor will not come up this session. Say it where the user is
        // looking, once, with the one thing they can do about it; the tabs
        // they open will close themselves (createEditorInstance's guard).
        console.error('[monaco] editor boot failed:', err);
        const msg = window.t
            ? window.t('editor.bootFailed', { error: err && err.message ? err.message : String(err) })
            : `The code editor failed to start (${err && err.message ? err.message : err}). Restart SAPHO; if it happens again, reinstall it.`;
        try { window.showNotification?.(msg, 'error', 0); } catch (_) { /* toast not up yet */ }
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