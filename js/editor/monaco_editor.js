/* eslint-disable no-undef */
// monaco is loaded globally via index.html
// require is the AMD loader from monaco-editor/min/vs/loader.js

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
        if (this.editors.size === 0) {
            overlay?.classList.add('visible');
            this.toggleEditorReadOnly(true);
        } else {
            overlay?.classList.remove('visible');
            this.toggleEditorReadOnly(false);
        }
    }

    static setupCursorListener(editor) {
        if (editor) {
            editor.onDidChangeCursorPosition(updateCursorPosition);
        }
    }

    static createEditorInstance(filePath) {
        if (!this.editorContainer) {
            console.error('EditorManager has not been initialized. Please call EditorManager.initialize() on DOMContentLoaded.');
            return;
        }

        const editorDiv = document.createElement('div');
        editorDiv.className = 'editor-instance';
        editorDiv.id = `editor-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
        editorDiv.style.cssText = `
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            display: none;
        `;

        this.editorContainer.appendChild(editorDiv);

        const language = this.getLanguageFromPath(filePath);
        const theme = language === 'cmm' ? (this.currentTheme === 'cmm-dark' ? 'cmm-dark' : 'cmm-light') : this.currentTheme;

        const editor = monaco.editor.create(editorDiv, {
            theme: theme,
            language: language,
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

        this.editors.set(filePath, {
            editor: editor,
            container: editorDiv
        });

        this.decorateVerticalBar(editor);
        this.setupResponsiveObserver();
        this.updateOverlayVisibility();
        this.setupCursorListener(editor);

        // Debounce bra-ket re-decoration: it scans the whole model with a
        // regex, so running it on every keystroke stutters typing in large
        // Verilog files. 150 ms feels live but avoids per-character scans.
        let braKetTimer = null;
        editor.onDidChangeModelContent(() => {
            if (braKetTimer) clearTimeout(braKetTimer);
            braKetTimer = setTimeout(() => {
                braKetTimer = null;
                this.decorateBraKet(editor);
            }, 150);
        });

        return editor;
    }

    static decorateBraKet(editor) {
        const model = editor.getModel();
        if (!model) return;

        try {
            // Find all occurrences of '⟩'
            const matches = model.findMatches('⟩', false, false, false, null, true);

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
            // Find all occurrences of '|'
            const matches = model.findMatches('\\|', true, false, false, null, true);

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

        // Listen for find widget close events
        editor.onDidChangeModelContent(() => {
            const activeFilePath = this.getActiveFilePath();
            const findWidget = document.querySelector('.find-widget');

            if (findWidget && !findWidget.classList.contains('visible')) {
                const state = this.findStates.get(activeFilePath);
                if (state) {
                    state.isOpen = false;
                }
            }
        });
    }

    static getActiveFilePath() {
        const activeTab = document.querySelector('.tab.active');
        return activeTab ? activeTab.dataset.file : null;
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
                this.updateResponsiveSettings();
            });
            this.resizeObserver.observe(document.body);
        }
    }

    static updateResponsiveSettings() {
        const isMobile = window.innerWidth < 768;
        const isTablet = window.innerWidth < 1024;

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

            if (language === 'cmm') {
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
        
        this.editors.forEach(({ editor }) => {
            editor.dispose();
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

        // Hide all editors
        this.editors.forEach(({ container }) => {
            container.style.display = 'none';
        });

        // Get or create editor for this file
        let editorData = this.editors.get(filePath);
        if (!editorData) {
            this.createEditorInstance(filePath);
            editorData = this.editors.get(filePath);
        }

        if (!editorData) {
            console.error(`Failed to create editor for ${filePath}`);
            return null;
        }

        // Show and activate this editor
        editorData.container.style.display = 'block';
        this.activeEditor = editorData.editor;

        // Layout and restore state
        setTimeout(() => {
            this.activeEditor.layout();
            this.activeEditor.focus();

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
        }, 50);

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
            editorData.editor.dispose();
            this.editorContainer.removeChild(editorData.container);
            this.editors.delete(filePath);
            this.findStates.delete(filePath);
            this.decorationCollections.delete(filePath);
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
async function initMonaco() {
    return new Promise((resolve) => {
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
                    { token: 'string',                           foreground: 'E68FB8' },
                    { token: 'number',                           foreground: '5FE0B0' },
                    { token: 'number.complex.imaginary.cmm',     foreground: 'E26C6C', fontStyle: 'bold' },
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
                    { token: 'string',                           foreground: 'B8568C' },
                    { token: 'number',                           foreground: '3A9D6E' },
                    { token: 'number.complex.imaginary.cmm',     foreground: 'C5453F', fontStyle: 'bold' },
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
}

function setupASMLanguage() {
    monaco.languages.register({ id: 'asm' });

    monaco.languages.setMonarchTokensProvider('asm', {
        defaultToken: '',
        tokenPostfix: '.asm',

        directives: [
            'PRNAME', 'NUBITS', 'NBMANT', 'NBEXPO', 'NDSTAC', 'SDEPTH', 
            'NUIOIN', 'NUIOOU', 'NUGAIN', 'FFTSIZ', 'array', 'arrays', 'ITRAD'
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
                [/#(PRNAME|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|NUGAIN|FFTSIZ|array|arrays|ITRAD)\b/, 'keyword.directive'],
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

function setupCMMLanguage() {
    monaco.languages.register({ id: 'cmm' });

    monaco.languages.setMonarchTokensProvider('cmm', {
        defaultToken: '',
        tokenPostfix: '.cmm',

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
                [/#(USEMAC|ENDMAC|INTERPOINT|PRNAME|DATYPE|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|NUGAIN|FFTSIZ)/, 'keyword.directive.cmm'],
                [/\b(in|fin|out|fout|norm|sign|pset|abs|copy|sqrt|atan|sin|cos|real|imag|fase|mod2|complex|vtv)\b(?=\s*\()/, 'keyword.function.stdlib.cmm'],
                
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

                [/(\[\s*\d+\s*\])\s*("[^"]*")/, ['delimiter.square', 'string']],
                [/\[\s*\w+\s*\)/, 'delimiter.square.inverted'],

                // Complex numbers - imaginary unit
                [/(\d*\.?\d+)(i)\b/, ['number', 'number.complex.imaginary.cmm']],

                [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
                [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                [/\d+/, 'number'],

                [/[a-zA-Z_]\w*/, {
                    cases: {
                        '@typeKeywords': 'keyword.type',
                        '@keywords': 'keyword',
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
    });
}

function updateCursorPosition(event) {
    const position = event.position;
    const statusElement = document.getElementById('editorStatus');

    if (statusElement && position) {
        const lineNumber = position.lineNumber;
        const columnNumber = position.column;

        statusElement.classList.add('updating');
        statusElement.innerHTML = `<i class="fa-solid fa-align-left"></i> Ln ${lineNumber}, Col ${columnNumber}`;

        setTimeout(() => {
            statusElement.classList.remove('updating');
        }, 150);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await initMonaco();
    await EditorManager.initialize();

    window.addEventListener('resize', () => {
        if (EditorManager.editors.size > 0) {
            EditorManager.updateResponsiveSettings();
        }
    });
});

export { EditorManager, initMonaco };