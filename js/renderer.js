let editor;
let openFiles = new Map();
let aiAssistantContainer = null;
let currentProvider = 'chatgpt'; // or 'claude'
let editorInstance;
let isVvpRunning = false;
let currentVvpPid = null;
let compilerInstance = null; // Store reference to your compiler class instance
let watcherTimeout = null;
let pollingInterval = null;
const REFRESH_DELAY = 100; // Delay em ms entre atualizações

//MONACO EDITOR ======================================================================================================================================================== ƒ
class EditorManager {
    static editors = new Map();
    static activeEditor = null;
    static editorContainer = null;
    static currentTheme = 'cmm-dark';
    static resizeObserver = null;

    static updateOverlayVisibility() {
        const overlay = document.getElementById('editor-overlay');
        if (this.editors.size === 0) {
            overlay.classList.add('visible');
            this.toggleEditorReadOnly(true);
        } else {
            overlay.classList.remove('visible');
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
            this.initialize();
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
            theme: theme, // ← Use o tema específico
            language: language, // ← Use a linguagem correta
            automaticLayout: true,

            // CONFIGURAÇÕES DE BUSCA MELHORADAS
            find: {
                addExtraSpaceOnTop: true,
                autoFindInSelection: 'never',
                seedSearchStringFromSelection: 'always',
                globalFindClipboard: true, // Permite busca global
                loop: true
            },

            // NOVAS FUNCIONALIDADES NATIVAS
            // Breadcrumbs (navegação de símbolos)
            breadcrumbs: {
                enabled: true,
                filePath: 'on',
                symbolPath: 'on'
            },

            // Outline e símbolos
            outlineFilters: {
                enabled: true
            },

            // Code lens melhorado
            codeLens: true,
            codeLensFontFamily: "'JetBrains Mono', monospace",
            codeLensFontSize: 12,

            // Sugestões melhoradas
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

            // Melhorias de performance
            renderValidationDecorations: 'on',

            // Word wrap inteligente
            wordWrapBreakAfterCharacters: ' \t})]?|/&.,;¢°′′′′‟""‟‟‟‟‟""‟""‟',
            wordWrapBreakBeforeCharacters: '',
            wordWrapColumn: 120,

            // Configurações responsivas melhoradas
            wordWrap: window.innerWidth < 768 ? 'on' : 'bounded',
            minimap: {
                enabled: window.innerWidth > 1024,
                scale: window.innerWidth > 1200 ? 1 : 0.8,
                showSlider: 'mouseover',
                renderCharacters: true,
                maxColumn: 120
            },
            fontSize: window.innerWidth < 768 ? 12 : 14,
            lineNumbers: window.innerWidth < 480 ? 'off' : 'on',
            folding: window.innerWidth > 768,

            // Outras configurações existentes...
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
            fontLigatures: true,
            scrollBeyondLastLine: true,
            renderWhitespace: 'selection',
            mouseWheelZoom: true,
            padding: {
                top: 16,
                bottom: 16
            },
            cursorStyle: 'line',
            cursorWidth: 2,
            cursorBlinking: 'smooth',
            renderLineHighlight: 'all',
            lineNumbersMinChars: 4,
            glyphMargin: true,
            showFoldingControls: 'mouseover',
            bracketPairColorization: {
                enabled: true
            },
            guides: {
                bracketPairs: true,
                indentation: true
            },
            smoothScrolling: true,
            autoClosingBrackets: 'always',
            autoClosingQuotes: 'always',
            formatOnPaste: true,
            formatOnType: true,
            quickSuggestions: true,
            parameterHints: {
                enabled: true
            },
            hover: {
                enabled: true,
                delay: 300
            },
            contextmenu: true,
            dragAndDrop: true,
            links: true,
            scrollbar: {
                vertical: 'auto',
                horizontal: 'auto',
                useShadows: false,
                verticalHasArrows: false,
                horizontalHasArrows: false,
                verticalScrollbarSize: window.innerWidth < 768 ? 8 : 12,
                horizontalScrollbarSize: window.innerWidth < 768 ? 8 : 12,
                arrowSize: 0
            }
        });

        // INICIALIZAR FUNCIONALIDADES MELHORADAS
        this.setupEnhancedFeatures(editor);
        BreakpointManager.initializeBreakpoints(editor, filePath);

        this.editors.set(filePath, {
            editor: editor,
            container: editorDiv
        });
        this.decorateVerticalBar(editor);

        this.setupResponsiveObserver(editor);
        this.updateOverlayVisibility();
        this.setupCursorListener(editor);
        editor.onDidChangeModelContent(() => {
            this.decorateBraKet(editor);

        });

        return editor;
    }

    static findStates = new Map(); // Store find widget states per file
    static decorateBraKet(editor) {
        const model = editor.getModel();
        if (!model) return;

        // Encontra todas as ocorrências de '⟩'
        const matches = model.findMatches('⟩', false, false, false, null, true);

        // Constrói as novas decorações
        const newDecorations = matches.map(m => ({
            range: m.range,
            options: {
                // aplica a classe CSS que vamos definir
                inlineClassName: 'bra-ket-padding'
            }
        }));

        // substitui todas as decorações anteriores dessa categoria
        // (você pode armazenar o array anterior em uma propriedade para removê-las,
        // mas aqui substituímos sem persistir IDs antigos)
        editor.deltaDecorations([], newDecorations);
    }

    static decorateVerticalBar(editor) {
        const model = editor.getModel();
        if (!model) return;

        // encontra todas as ocorrências de '|'
        const matches = model.findMatches('\\|', /* isRegex */ true, false, false, null, true);

        // cria decorações inline para cada ocorrência
        const newDecorations = matches.map(m => ({
            range: m.range,
            options: {
                inlineClassName: 'vertical-bar-lower'
            }
        }));

        // aplica as decorações (substitui as anteriores dessa categoria)
        editor.deltaDecorations([], newDecorations);
    }
    // Modified setupEnhancedFeatures method with per-tab find functionality
    static setupEnhancedFeatures(editor) {
        const commands = [{
                key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF,
                action: () => {
                    // Get the currently active editor instance
                    const activeEditor = EditorManager.activeEditor;
                    if (!activeEditor) return;

                    const findAction = activeEditor.getAction('actions.find');
                    if (findAction) {
                        findAction.run()
                            .then(() => {
                                setTimeout(() => {
                                    const input = document.querySelector('.monaco-findInput input');
                                    if (input) {
                                        input.focus();
                                    }
                                }, 50);
                            });
                    }
                }
            }, {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    if (!activeEditor) return;

                    activeEditor.getAction('editor.action.startFindReplaceAction')
                        .run()
                        .then(() => {
                            setTimeout(() => {
                                const input = document.querySelector('.monaco-findInput input');
                                if (input) input.focus();
                            }, 50);
                        });
                }
            }, {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    if (activeEditor) {
                        activeEditor.getAction('editor.action.formatDocument')
                            .run();
                    }
                }
            }, {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    if (activeEditor) {
                        activeEditor.getAction('editor.action.gotoLine')
                            .run();
                    }
                }
            }, {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP,
                action: () => editor.getAction('editor.action.quickCommand')
                    .run()
            }, {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
                action: () => editor.getAction('workbench.action.showCommands')
                    .run()
            }, {
                key: monaco.KeyCode.F12,
                action: () => editor.getAction('editor.action.revealDefinition')
                    .run()
            }, {
                key: monaco.KeyMod.Alt | monaco.KeyCode.F12,
                action: () => editor.getAction('editor.action.peekDefinition')
                    .run()
            }, {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12,
                action: () => editor.getAction('editor.action.goToImplementation')
                    .run()
            }, {
                key: monaco.KeyMod.Shift | monaco.KeyCode.F12,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    if (activeEditor) {
                        activeEditor.getAction('editor.action.goToReferences')
                            .run();
                    }
                }
            },

            // Add breakpoint-specific commands
            {
                key: monaco.KeyCode.F9,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    const activeFilePath = this.getActiveFilePath();
                    if (activeEditor && activeFilePath) {
                        const position = activeEditor.getPosition();
                        if (position) {
                            BreakpointManager.toggleBreakpoint(activeEditor, activeFilePath, position.lineNumber);
                        }
                    }
                }
            }, {
                key: monaco.KeyMod.Shift | monaco.KeyCode.F9,
                action: () => {
                    const activeEditor = EditorManager.activeEditor;
                    const activeFilePath = this.getActiveFilePath();
                    if (activeEditor && activeFilePath) {
                        BreakpointManager.goToNextBreakpoint(activeEditor, activeFilePath);
                    }
                }
            }, {
                key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.F9,
                action: () => {
                    BreakpointManager.clearAllBreakpoints();
                }
            }
        ];

        commands.forEach(({
            key,
            action
        }) => {
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
        // Find the currently active tab
        const activeTab = document.querySelector('.tab.active');
        return activeTab ? activeTab.dataset.file : null;
    }

    static searchInAllFiles(searchTerm, options = {}) {
        const results = [];
        this.editors.forEach((editorData, filePath) => {
            const {
                editor
            } = editorData;
            const model = editor.getModel();

            if (model) {
                const matches = model.findMatches(
                    searchTerm, true, options.isRegex || false, options.matchCase || false, options.wholeWord ? '\b' + searchTerm + '\b' : null, true
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
            }
        });

        return results;
    }

    static navigateToSearchResult(filePath, lineNumber, column) {
        const editor = this.setActiveEditor(filePath);
        if (editor) {
            editor.setPosition({
                lineNumber,
                column
            });
            editor.revealLineInCenter(lineNumber);
            editor.focus();
        }
    }

    static setupResponsiveObserver(editor) {
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

        this.editors.forEach(({
            editor
        }) => {
            editor.updateOptions({
                wordWrap: isMobile ? 'on' : 'off',
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
        this.editors.forEach(({
            editor
        }, filePath) => {
            const language = this.getLanguageFromPath(filePath);
            let theme;

            if (language === 'cmm') {
                theme = isDark ? 'cmm-dark' : 'cmm-light';
            } else if (language === 'asm') {
                theme = isDark ? 'asm-dark' : 'asm-light';
            } else {
                theme = isDark ? 'vs-dark' : 'vs';
            }

            editor.updateOptions({
                theme: theme
            });
        });

        // Save theme preference
        localStorage.setItem('editorTheme', isDark ? 'dark' : 'light');

    }



    static initialize() {
        // Add this line to ensure relative positioning
        //this.editorContainer.style.position = 'relative';

        this.editorContainer = document.getElementById('monaco-editor');
        if (!this.editorContainer) {
            console.error('Editor container not found');
            return;
        }


        //this.editorContainer.style.position = 'relative';
        this.editorContainer.style.height = '100%';
        this.editorContainer.style.width = '100%';

        // Load saved theme preference
        const savedTheme = localStorage.getItem('editorTheme');
        const isDark = savedTheme ? savedTheme === 'dark' : true;
        this.setTheme(isDark);

        // Setup responsive observer
        this.setupResponsiveObserver(null);

        // Start periodic checking if tabs are already open
        if (this.tabs.size > 0) {
            this.startPeriodicFileCheck();
        }
    }

    static cleanup() {
        this.stopPeriodicFileCheck();
        this.stopAllWatchers();
    }

    static toggleEditorReadOnly(isReadOnly) {
        this.editors.forEach(({
            editor
        }) => {
            editor.updateOptions({
                readOnly: isReadOnly
            });
            if (isReadOnly) {
                editor.blur();
            }
        });
    }

    static getLanguageFromPath(filePath) {
        const extension = filePath.split('.')
            .pop()
            .toLowerCase();
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
            'cmm': 'cmm', // ← ALTERADO: era 'c', agora é 'cmm'
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

            if (this.findStates.has(currentActiveFilePath)) {
                const state = this.findStates.get(currentActiveFilePath);
                state.isOpen = findWidget && findWidget.classList.contains('visible');
                state.searchTerm = findInput ? findInput.value : '';
            }
        }

        this.editors.forEach(({
            editor,
            container
        }) => {
            container.style.display = 'none';
        });

        let editorData = this.editors.get(filePath);
        if (!editorData) {
            this.createEditorInstance(filePath);
            editorData = this.editors.get(filePath);
        }

        editorData.container.style.display = 'block';
        this.activeEditor = editorData.editor;

        setTimeout(() => {
            this.activeEditor.layout();
            this.activeEditor.focus();

            // Restore find widget state for this file
            const state = this.findStates.get(filePath);
            if (state && state.isOpen) {
                const findAction = this.activeEditor.getAction('actions.find');
                if (findAction) {
                    findAction.run()
                        .then(() => {
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

    // Modified closeEditor method - add cleanup
    static closeEditor(filePath) {
        const editorData = this.editors.get(filePath);
        if (editorData) {
            // Cleanup breakpoints before disposing editor
            BreakpointManager.onFileClose(filePath);

            editorData.editor.dispose();
            this.editorContainer.removeChild(editorData.container);
            this.editors.delete(filePath);

            // Clean up find state
            this.findStates.delete(filePath);
        }
        this.updateOverlayVisibility();
    }

    // Add these new methods to EditorManager for breakpoint keyboard shortcuts
    static setupBreakpointKeyboardShortcuts() {
        // Global keyboard shortcuts for breakpoint operations
        document.addEventListener('keydown', (e) => {
            // F9 - Toggle breakpoint
            if (e.key === 'F9' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                const activeEditor = this.activeEditor;
                const activeFilePath = this.getActiveFilePath();

                if (activeEditor && activeFilePath) {
                    const position = activeEditor.getPosition();
                    if (position) {
                        BreakpointManager.toggleBreakpoint(activeEditor, activeFilePath, position.lineNumber);
                    }
                }
            }

            // Shift+F9 - Go to next breakpoint
            if (e.key === 'F9' && e.shiftKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                const activeEditor = this.activeEditor;
                const activeFilePath = this.getActiveFilePath();

                if (activeEditor && activeFilePath) {
                    BreakpointManager.goToNextBreakpoint(activeEditor, activeFilePath);
                }
            }

            // Ctrl+Shift+F9 - Clear all breakpoints
            if (e.key === 'F9' && e.ctrlKey && e.shiftKey && !e.altKey) {
                e.preventDefault();
                BreakpointManager.clearAllBreakpoints();
            }
        });
    }


    static async initialize() {
        await ensureMonacoInitialized();

        this.editorContainer = document.getElementById('monaco-editor');
        if (!this.editorContainer) {
            console.error('Editor container not found');
            return;
        }

        // Initialize breakpoint keyboard shortcuts
        this.setupBreakpointKeyboardShortcuts();

        // Listen for breakpoint change events
        document.addEventListener('breakpointChange', (e) => {
            const {
                filePath,
                lineNumbers
            } = e.detail;
            console.log(`Breakpoints updated for ${filePath}:`, lineNumbers);

            // Here you can integrate with your debugger/compiler
            // For example, send breakpoints to your CMM compiler
            if (window.compiler) {
                window.compiler.setBreakpoints(filePath, lineNumbers);
            }
        });

        this.editorContainer.style.height = '100%';
        this.editorContainer.style.width = '100%';

        // Load saved theme preference
        const savedTheme = localStorage.getItem('editorTheme');
        const isDark = savedTheme ? savedTheme === 'dark' : true;
        this.setTheme(isDark);

        // Setup responsive observer
        this.setupResponsiveObserver(null);

        // Start periodic checking if tabs are already open
        if (this.tabs && this.tabs.size > 0) {
            this.startPeriodicFileCheck();
        }
    }

    // Add utility methods for breakpoint management
    static getBreakpointsForFile(filePath) {
        return BreakpointManager.getFileBreakpoints(filePath);
    }

    static getAllBreakpoints() {
        return BreakpointManager.getAllBreakpoints();
    }

    static setBreakpointsForFile(filePath, lineNumbers) {
        BreakpointManager.setBreakpoints(filePath, lineNumbers);
    }

    static clearBreakpointsForFile(filePath) {
        const editor = this.getEditorForFile(filePath);
        if (editor) {
            BreakpointManager.clearFileBreakpoints(editor, filePath);
        }
    }

    static exportBreakpoints() {
        return BreakpointManager.exportBreakpoints();
    }

    static importBreakpoints(jsonData) {
        return BreakpointManager.importBreakpoints(jsonData);
    }

    // Optional: Add breakpoint panel UI
    static createBreakpointPanel() {
        const panel = document.createElement('div');
        panel.className = 'breakpoint-panel';
        panel.innerHTML = `
    <div class="breakpoint-header">
      <span>Breakpoints</span>
      <div>
        <button class="breakpoint-action-btn" onclick="EditorManager.clearAllBreakpoints()" title="Clear All">
          <i class="fa-solid fa-trash"></i>
        </button>
        <button class="breakpoint-action-btn" onclick="EditorManager.exportBreakpointsToFile()" title="Export">
          <i class="fa-solid fa-download"></i>
        </button>
        <button class="breakpoint-action-btn" onclick="EditorManager.importBreakpointsFromFile()" title="Import">
          <i class="fa-solid fa-upload"></i>
        </button>
      </div>
    </div>
    <div class="breakpoint-list" id="breakpoint-list">
      <div class="no-breakpoints">No breakpoints set</div>
    </div>
  `;

        return panel;
    }

    static updateBreakpointPanel() {
        const listElement = document.getElementById('breakpoint-list');
        if (!listElement) return;

        const allBreakpoints = this.getAllBreakpoints();
        const hasBreakpoints = Object.keys(allBreakpoints)
            .length > 0;

        if (!hasBreakpoints) {
            listElement.innerHTML = '<div class="no-breakpoints">No breakpoints set</div>';
            return;
        }

        let html = '';
        Object.entries(allBreakpoints)
            .forEach(([filePath, lineNumbers]) => {
                const fileName = filePath.split(/[\\/]/)
                    .pop();
                lineNumbers.forEach(lineNumber => {
                    html += `
        <div class="breakpoint-item" onclick="EditorManager.navigateToBreakpoint('${filePath}', ${lineNumber})">
          <div class="breakpoint-indicator"></div>
          <div class="breakpoint-location">
            <strong>${fileName}</strong>:${lineNumber}
          </div>
          <div class="breakpoint-actions">
            <button class="breakpoint-action-btn" 
                    onclick="event.stopPropagation(); EditorManager.removeBreakpoint('${filePath}', ${lineNumber})" 
                    title="Remove">
              <i class="fa-solid fa-times"></i>
            </button>
          </div>
        </div>
      `;
                });
            });

        listElement.innerHTML = html;
    }

    static navigateToBreakpoint(filePath, lineNumber) {
        // Switch to the file if not already active
        if (this.tabs && this.tabs.has(filePath)) {
            this.activateTab(filePath);
        }

        // Navigate to the breakpoint line
        const editor = this.getEditorForFile(filePath);
        if (editor) {
            editor.setPosition({
                lineNumber,
                column: 1
            });
            editor.revealLineInCenter(lineNumber);
            editor.focus();
        }
    }

    static removeBreakpoint(filePath, lineNumber) {
        const editor = this.getEditorForFile(filePath);
        if (editor) {
            BreakpointManager.toggleBreakpoint(editor, filePath, lineNumber);
        }
    }

    static exportBreakpointsToFile() {
        const breakpointData = this.exportBreakpoints();
        const blob = new Blob([breakpointData], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'breakpoints.json';
        a.click();

        URL.revokeObjectURL(url);
    }

    static importBreakpointsFromFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const success = this.importBreakpoints(e.target.result);
                    if (success) {
                        console.log('Breakpoints imported successfully');
                    } else {
                        console.error('Failed to import breakpoints');
                    }
                };
                reader.readAsText(file);
            }
        };

        input.click();
    }

}

async function ensureMonacoInitialized() {
    return new Promise((resolve) => {
        if (window.monaco) {
            resolve();
        } else {
            // Aguarda o Monaco estar disponível
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
            setupCMMLanguage(); // ← Certifique-se de que esta linha está presente
            setupASMLanguage();

            // Define enhanced dark theme
            monaco.editor.defineTheme('cmm-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [{
                    token: 'comment',
                    foreground: '6A9955',
                    fontStyle: 'italic'
                }, {
                    token: 'keyword',
                    foreground: '569CD6',
                    fontStyle: 'bold'
                }, {
                    token: 'keyword.directive.cmm',
                    foreground: '#569CD6'
                }, {
                    token: 'keyword.function.stdlib.cmm',
                    fontStyle: 'bold',
                    foreground: '#DCDCAA'
                }, {
                    token: 'string',
                    foreground: 'CE9178'
                }, {
                    token: 'number',
                    foreground: 'B5CEA8'
                }, {
                    token: 'operator',
                    foreground: 'D4D4D4'
                }, {
                    token: 'operator.shift.arithmetic',
                    fontStyle: 'bold',
                    foreground: '#D4D4D4'
                }, {
                    token: 'delimiter',
                    foreground: 'D4D4D4'
                }, {
                    token: 'delimiter.square.inverted',
                    foreground: '#CE9178'
                }],
                colors: {
                    'editor.background': '#17151f',
                    'editor.foreground': '#e2dcff',
                    'editorLineNumber.foreground': '#776f97',
                    'editorLineNumber.activeForeground': '#9d7fff',
                    'editor.selectionBackground': '#363150',
                    'editor.selectionHighlightBackground': '#2d2a40',
                    'editor.lineHighlightBackground': '#1e1b2c',
                    'editorCursor.foreground': '#9d7fff',
                    'editorWhitespace.foreground': '#776f97',
                    'editorIndentGuide.background': '#2f2a45',
                    'editorIndentGuide.activeBackground': '#9d7fff',
                    'editor.findMatchBackground': '#613d7c',
                    'editor.findMatchHighlightBackground': '#4d2d61',
                    'editorBracketMatch.background': '#613d7c',
                    'editorBracketMatch.border': '#9d7fff',
                    'scrollbar.shadow': '#00000000',
                    'scrollbarSlider.background': '#776f9720',
                    'scrollbarSlider.hoverBackground': '#776f9740',
                    'scrollbarSlider.activeBackground': '#9d7ff760',
                    'minimap.background': '#1e1b2c'
                }
            });

            // Define enhanced light theme
            monaco.editor.defineTheme('cmm-light', {
                base: 'vs',
                inherit: true,
                rules: [{
                    token: 'comment',
                    foreground: '6A9955',
                    fontStyle: 'italic'
                }, {
                    token: 'keyword',
                    foreground: '7c4dff',
                    fontStyle: 'bold'
                }, {
                    token: 'keyword.directive.cmm',
                    fontStyle: 'bold',
                    foreground: '#0000FF'
                }, {
                    token: 'keyword.function.stdlib.cmm',
                    fontStyle: 'bold',
                    foreground: '#795E26'
                }, {
                    token: 'string',
                    foreground: 'A31515'
                }, {
                    token: 'number',
                    foreground: '098658'
                }, {
                    token: 'operator',
                    foreground: '000000'
                }, {
                    token: 'operator.shift.arithmetic',
                    fontStyle: 'bold',
                    foreground: '#000000'
                }, {
                    token: 'delimiter',
                    foreground: '000000'
                }, {
                    token: 'delimiter.square.inverted',
                    foreground: '#A31515'
                }],
                colors: {
                    'editor.background': '#faf9ff',
                    'editor.foreground': '#2d2150',
                    'editorLineNumber.foreground': '#7c6da9',
                    'editorLineNumber.activeForeground': '#7c4dff',
                    'editor.selectionBackground': '#d5cbf2',
                    'editor.selectionHighlightBackground': '#e2dbfa',
                    'editor.lineHighlightBackground': '#f4f1ff',
                    'editorCursor.foreground': '#7c4dff',
                    'editorWhitespace.foreground': '#aaa2c3',
                    'editorIndentGuide.background': '#ded7f3',
                    'editorIndentGuide.activeBackground': '#7c4dff',
                    'editor.findMatchBackground': '#b9a3ff',
                    'editor.findMatchHighlightBackground': '#d2c7f0',
                    'editorBracketMatch.background': '#b9a3ff',
                    'editorBracketMatch.border': '#7c4dff',
                    'scrollbar.shadow': '#00000000',
                    'scrollbarSlider.background': '#7c6da920',
                    'scrollbarSlider.hoverBackground': '#7c6da940',
                    'scrollbarSlider.activeBackground': '#7c4dff60',
                    'minimap.background': '#f4f1ff'
                }
            });

            // Enhanced editor configuration with all built-in features
            const editorConfig = {
                theme: EditorManager.currentTheme,
                language: 'cmm',
                automaticLayout: true,

                // Font and Display
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
                fontLigatures: true,
                fontWeight: '400',
                letterSpacing: 0,
                lineHeight: 1.4,

                // Minimap
                minimap: {
                    enabled: true,
                    side: 'right',
                    size: 'proportional',
                    scale: 1,
                    showSlider: 'mouseover',
                    renderCharacters: true,
                    maxColumn: 120,
                    sectionHeaderFontSize: 9,
                    sectionHeaderLetterSpacing: 1
                },

                // Scrolling
                scrollBeyondLastLine: true,
                scrollBeyondLastColumn: 5,
                smoothScrolling: true,
                mouseWheelZoom: true,
                fastScrollSensitivity: 5,

                // Cursor
                cursorStyle: 'line',
                cursorWidth: 2,
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',

                // Line Numbers and Gutters
                lineNumbers: 'on',
                lineNumbersMinChars: 4,
                glyphMargin: true,
                folding: true,
                foldingStrategy: 'indentation',
                showFoldingControls: 'mouseover',
                foldingHighlight: true,
                unfoldOnClickAfterEndOfLine: false,

                // Selection and Highlighting
                renderLineHighlight: 'all',
                selectionHighlight: true,
                occurrencesHighlight: true,
                codeLens: true,

                // Whitespace and Indentation
                renderWhitespace: 'selection',
                renderControlCharacters: true,
                insertSpaces: true,
                tabSize: 4,
                detectIndentation: true,
                trimAutoWhitespace: true,

                // Bracket Matching
                bracketPairColorization: {
                    enabled: true,
                    independentColorPoolPerBracketType: true
                },
                matchBrackets: 'always',
                guides: {
                    bracketPairs: true,
                    bracketPairsHorizontal: true,
                    highlightActiveBracketPair: true,
                    indentation: true,
                    highlightActiveIndentation: true
                },

                // Editor Behavior
                autoIndent: 'full',
                autoClosingBrackets: 'always',
                autoClosingQuotes: 'always',
                autoSurround: 'languageDefined',
                wordWrap: 'off',
                wordWrapColumn: 80,
                wrappingIndent: 'indent',
                wordBasedSuggestions: 'matchingDocuments',
                wordBasedSuggestionsOnlySameLanguage: false,

                // Find and Replace
                find: {
                    addExtraSpaceOnTop: true,
                    autoFindInSelection: 'never',
                    seedSearchStringFromSelection: 'always',
                    globalFindClipboard: false
                },

                // Hover and Tooltip
                hover: {
                    enabled: true,
                    delay: 300,
                    sticky: true,
                    above: true
                },

                // Parameter Hints
                parameterHints: {
                    enabled: true,
                    cycle: true
                },

                // Suggestions
                quickSuggestions: {
                    other: 'on',
                    comments: 'off',
                    strings: 'off'
                },
                quickSuggestionsDelay: 10,
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: 'on',
                acceptSuggestionOnCommitCharacter: true,
                snippetSuggestions: 'top',
                tabCompletion: 'on',
                wordBasedSuggestions: 'matchingDocuments',

                // Scrollbar
                scrollbar: {
                    vertical: 'auto',
                    horizontal: 'auto',
                    useShadows: false,
                    verticalHasArrows: false,
                    horizontalHasArrows: false,
                    verticalScrollbarSize: 12,
                    horizontalScrollbarSize: 12,
                    arrowSize: 11,
                    handleMouseWheel: true,
                    alwaysConsumeMouseWheel: true
                },

                // Overview Ruler
                overviewRulerLanes: 3,
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: false,

                // Multi-cursor and Selection
                multiCursorModifier: 'alt',
                multiCursorMergeOverlapping: true,
                multiCursorPaste: 'spread',
                columnSelection: false,

                // Accessibility
                accessibilitySupport: 'auto',
                accessibilityPageSize: 10,

                // Performance
                renderValidationDecorations: 'on',
                renderFinalNewline: 'on',
                rulers: [],

                // Layout
                padding: {
                    top: 16,
                    bottom: 16,
                    left: 0,
                    right: 0
                },

                // Links
                links: true,

                // Context Menu
                contextmenu: true,

                // Drag and Drop
                dragAndDrop: true,

                // Copy/Paste
                emptySelectionClipboard: true,
                copyWithSyntaxHighlighting: true,

                // Formatting
                formatOnPaste: true,
                formatOnType: true,

                // Sticky Scroll
                stickyScroll: {
                    enabled: true,
                    maxLineCount: 5,
                    defaultModel: 'outlineModel'
                },

                // Semantic Highlighting
                'semanticHighlighting.enabled': true,

                // Inline Suggestions
                inlineSuggest: {
                    enabled: true,
                    showToolbar: 'onHover'
                },

                // Diff Editor
                enableSplitViewResizing: true,
                renderSideBySide: true,

                // Code Actions
                lightbulb: {
                    enabled: 'on'
                },

                // Rename
                renameOnType: false,

                // Goto Definition
                definitionLinkOpensInPeek: false,
                gotoLocation: {
                    multipleReferences: 'peek',
                    multipleDefinitions: 'peek',
                    multipleDeclarations: 'peek',
                    multipleImplementations: 'peek',
                    multipleTypeDefinitions: 'peek'
                }
            };


            // Add event listeners
            if (editorInstance) {
                editorInstance.onDidChangeCursorPosition(updateCursorPosition);

                // Add command palette actions
                editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
                    editorInstance.getAction('editor.action.quickCommand')
                        .run();
                });

                // Add find/replace shortcuts
                editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
                    editorInstance.getAction('editor.actions.find')
                        .run();
                });

                editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
                    editorInstance.getAction('editor.action.startFindReplaceAction')
                        .run();
                });

                // Add format document shortcut
                editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
                    editorInstance.getAction('editor.action.formatDocument')
                        .run();
                });

                // Add go to line shortcut
                editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
                    editorInstance.getAction('editor.action.gotoLine')
                        .run();
                });
            }
        });
        resolve();
    })
}

document.addEventListener('DOMContentLoaded', async () => {
    // Inicializa o Monaco antes de qualquer outra coisa
    await initMonaco();
    // Handle window resize for responsive behavior
    window.addEventListener('resize', () => {
        if (EditorManager.editors.size > 0) {
            EditorManager.updateResponsiveSettings();
        }
    });
});

function setupASMLanguage() {
    monaco.languages.register({
        id: 'asm'
    });

    monaco.languages.setMonarchTokensProvider('asm', {
        defaultToken: '',
        tokenPostfix: '.asm',

        // Diretivas específicas do ASM
        directives: [
            'PRNAME', 'NUBITS', 'NBMANT', 'NBEXPO', 'NDSTAC', 'SDEPTH', 'NUIOIN', 'NUIOOU', 'NUGAIN', 'FFTSIZ', 'PIPELN', 'array', 'arrays', 'ITRAD'
        ],

        // Instruções do ASM
        instructions: [
            'LOD', 'P_LOD', 'LDI', 'ILI', 'SET', 'SET_P', 'SRF', 'IRF', 'PSH', 'POP', 'P_LOD_V', 'MLT_V', 'F_MLT_V', 'INN', 'OUT', 'STI', 'ISI', 'PST', 'PST_M', 'ADD', 'S_ADD', 'F_ADD', 'SF_ADD', 'P_PST_M', 'MLT', 'S_MLT', 'F_MLT', 'SF_MLT', 'F_PST', 'DIV', 'S_DIV', 'F_DIV', 'SF_DIV', 'F_PST_M', 'MOD', 'S_MOD', 'PF_PST_M', 'ADD_V', 'SGN', 'S_SGN', 'F_SGN', 'SF_SGN', 'F_ADD_V', 'NEG', 'NEG_M', 'P_NEG_M', 'F_NEG', 'F_NEG_M', 'PF_NEG_M', 'ABS', 'ABS_M', 'P_ABS_M', 'F_ABS', 'F_ABS_M', 'PF_ABS_M', 'NRM', 'NRM_M', 'P_NRM_M', 'P_INN', 'NOP', 'I2F', 'I2F_M', 'P_I2F_M', 'F2I', 'F2I_M', 'P_F2I_M', 'AND', 'S_AND', 'ORR', 'S_ORR', 'XOR', 'S_XOR', 'INV', 'INV_M', 'P_INV_M', 'LAN', 'S_LAN', 'LOR', 'S_LOR', 'LOD_V', 'CAL', 'RET', 'SET_V', 'LIN', 'LIN_M', 'P_LIN_M', 'LES', 'S_LES', 'F_LES', 'SF_LES', 'GRE', 'S_GRE', 'F_GRE', 'SF_GRE', 'EQU', 'S_EQU', 'SHL', 'S_SHL', 'SHR', 'S_SHR', 'SRS', 'S_SRS'
        ],

        // Instruções de salto destacadas
        jumpInstructions: [
            'JMP', 'JIZ'
        ],

        symbols: /[=><!~?:&|+\-*\/\^%]+/,

        tokenizer: {
            root: [
                // Diretivas com #
                [/#(PRNAME|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|PIPELN|NUGAIN|FFTSIZ|array|arrays|ITRAD)\b/, 'keyword.directive'],

                // Comentários
                [/\/\/.*$/, 'comment'],
                [/;.*$/, 'comment'],

                // Labels (identificadores seguidos de :)
                [/^\s*[a-zA-Z_]\w*:/, 'type.identifier'],

                // Números (hex, decimal, binário)
                [/\b0x[0-9a-fA-F]+\b/, 'number.hex'],
                [/\b[0-9]+\b/, 'number'],
                [/\b[01]+b\b/, 'number.binary'],

                // Strings
                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/"/, {
                    token: 'string.quote',
                    bracket: '@open',
                    next: '@string'
                }],

                // Instruções de salto (JMP, JIZ) - tratadas com um token especial
                [/\b(JMP|JIZ)\b/, 'keyword.jumpInstruction'],

                // Outras instruções
                [/\b([A-Z][A-Z0-9_]*)\b/, {
                    cases: {
                        '@instructions': 'keyword.instruction',
                        '@directives': 'keyword.directive',
                        '@default': 'identifier'
                    }
                }],

                // Identificadores e outros tokens
                [/[a-zA-Z_]\w*/, 'identifier'],

                // Whitespace
                {
                    include: '@whitespace'
                },

                // Operadores e símbolos
                [/[(),]/, 'delimiter'],
                [/[=<>!+\-*\/]/, 'operator'],

                [/@\w+/, 'annotation.asm'],
            ],

            string: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, {
                    token: 'string.quote',
                    bracket: '@close',
                    next: '@pop'
                }]
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white']
            ],
        }
    });

    // Define tema escuro personalizado para ASM com cores melhoradas
    monaco.editor.defineTheme('asm-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            // Instruções em um tom de azul claro vibrante
            {
                token: 'keyword.instruction',
                foreground: '#569CD6',
                fontStyle: 'bold'
            },

            // JMP e JIZ destacados em amarelo intenso no tema escuro
            {
                token: 'keyword.jumpInstruction',
                foreground: '#FFDD00',
                fontStyle: 'bold'
            },

            // Diretivas mantidas em roxo/rosa
            {
                token: 'keyword.directive',
                foreground: '#C586C0',
                fontStyle: 'bold'
            },

            // Identificadores em um verde água mais vivo
            {
                token: 'type.identifier',
                foreground: '#56B6C2'
            },

            // Comentários em um verde mais suave
            {
                token: 'comment',
                foreground: '#7EC699'
            },

            // Números em um tom mais destacado
            {
                token: 'number',
                foreground: '#D19A66'
            },

            // Strings em um laranja suave
            {
                token: 'string',
                foreground: '#E5C07B'
            },

            // Operadores em um cinza mais claro para melhor visibilidade
            {
                token: 'operator',
                foreground: '#ABB2BF'
            },

            // Delimitadores em um tom distinto
            {
                token: 'delimiter',
                foreground: '#89DDFF'
            }
        ],
        colors: {
            'editor.background': '#282C34',
            'editor.foreground': '#ABB2BF',
            'editor.lineHighlightBackground': '#2C313A',
            'editor.selectionBackground': '#3E4451',
            'editorCursor.foreground': '#528BFF'
        }
    });

    // Define tema claro personalizado para ASM com cores melhoradas
    monaco.editor.defineTheme('asm-light', {
        base: 'vs',
        inherit: true,
        rules: [
            // Instruções em um azul mais vibrante
            {
                token: 'keyword.instruction',
                foreground: '#0550AE',
                fontStyle: 'bold'
            },

            // JMP e JIZ destacados em amarelo mais suave no tema claro
            {
                token: 'keyword.jumpInstruction',
                foreground: '#B58B00',
                fontStyle: 'bold'
            },

            // Diretivas mantidas em verde
            {
                token: 'keyword.directive',
                foreground: '#098658',
                fontStyle: 'bold'
            },

            // Identificadores em um azul esverdeado
            {
                token: 'type.identifier',
                foreground: '#229DB5'
            },

            // Comentários em um verde mais escuro para melhor contraste
            {
                token: 'comment',
                foreground: '#098658'
            },

            // Números em um laranja escuro
            {
                token: 'number',
                foreground: '#CC6633'
            },

            // Strings em um vermelho mais suave
            {
                token: 'string',
                foreground: '#A31515'
            },

            // Operadores em um cinza escuro
            {
                token: 'operator',
                foreground: '#444444'
            },

            // Delimitadores em um azul escuro
            {
                token: 'delimiter',
                foreground: '#0076C4'
            }
        ],
        colors: {
            'editor.background': '#FFFFFF',
            'editor.foreground': '#000000',
            'editor.lineHighlightBackground': '#F7F7F7',
            'editor.selectionBackground': '#ADD6FF',
            'editorCursor.foreground': '#000000'
        }
    });
}

function setupCMMLanguage() {
    // Register CMM language
    monaco.languages.register({
        id: 'cmm'
    });

    // Define CMM language configuration
    monaco.languages.setMonarchTokensProvider('cmm', {
        defaultToken: '',
        tokenPostfix: '.cmm',

        keywords: [
            'if', 'else', 'for', 'while', 'do', 'struct', 'return', 'break', 'continue', 'switch', 'case', 'default', 'goto', 'sizeof', 'volatile', 'typedef', 'enum', 'union', 'register', 'extern', 'inline', 'void', 'int', 'comp', 'char', 'float', 'double', 'bool', 'long', 'short', 'signed', 'unsigned', 'const', 'static', 'auto', 'Jussara', 'Anon', 'Chrysthofer'
        ],

        typeKeywords: [
            'bool', 'int', 'long', 'float', 'double', 'char', 'void', 'unsigned', 'signed', 'short'
        ],

        operators: [
            '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>='
        ],

        symbols: /[=><!~?:&|+\-*\/\^%]+/,

        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

        tokenizer: {
            root: [
                // CMM directives (including new ones)
                [/#(USEMAC|ENDMAC|INTERPOINT|PRNAME|DATYPE|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|PIPELN|NUGAIN|FFTSIZ)/, 'keyword.directive.cmm'],

                // StdLib functions
                [/\b(in|out|norm|pset|abs|vtv|sin|cos|complex|sqrt|atan|mod2|sign|real|imag|fase)\b(?=\s*\()/, 'keyword.function.stdlib.cmm'],

                // Dirac notation - Complex assignment statements
                // Pattern: variable # expression|vector⟩ or variable # |matrix|vector⟩
                [/(\w+)\s*(#)\s*([^⟨|⟩]+)?\s*(\|)([^⟨|⟩\s]+)(\|)\s*([^⟨|⟩\s]+)?\s*(⟩)/, ['identifier', 'operator', 'identifier', 'dirac.bar', 'identifier', 'dirac.bar', 'identifier', 'dirac.bracket']],

                // Pattern: variable # constant|matrix| (identity matrix case)
                [/(\w+)\s*(#)\s*([^⟨|⟩]+)?\s*(\|)([BI])(\|)/, ['identifier', 'operator', 'identifier', 'dirac.bar', 'keyword.special.dirac', 'dirac.bar']],

                // Pattern: variable # |vector⟩⟨vector| (outer product)
                [/(\w+)\s*(#)\s*(\|)([^⟨|⟩\s]+)(⟩⟨)([^⟨|⟩\s]+)(\|)/, ['identifier', 'operator', 'dirac.bar', 'identifier', 'dirac.bracket', 'identifier', 'dirac.bar']],

                // Pattern: variable # |matrix| - |vector⟩⟨vector| (matrix subtraction)
                [/(\w+)\s*(#)\s*(\|)([^⟨|⟩\s]+)(\|)\s*(-)\s*(\|)([^⟨|⟩\s]+)(⟩⟨)([^⟨|⟩\s]+)(\|)/, ['identifier', 'operator', 'dirac.bar', 'identifier', 'dirac.bar', 'operator', 'dirac.bar', 'identifier', 'dirac.bracket', 'identifier', 'dirac.bar']],

                // Pattern: variable # |0⟩ (zero vector assignment)
                [/(\w+)\s*(#)\s*(\|)(0)(⟩)/, ['identifier', 'operator', 'dirac.bar', 'keyword.special.dirac', 'dirac.bracket']],

                // Pattern: variable # constant|in(port)⟩ (input with gain)
                [/(\w+)\s*(#)\s*([^⟨|⟩\s]+)\s*(\|)(in\([^)]+\))(⟩)/, ['identifier', 'operator', 'identifier', 'dirac.bar', 'keyword.function.stdlib.cmm', 'dirac.bracket']],

                // Pattern: out(port, constant|vector⟩) (output function)
                [/(out)\s*\(\s*([^,]+)\s*,\s*([^⟨|⟩\s]+)?\s*(\|)([^⟨|⟩\s]+)(⟩)\s*\)/, ['keyword.function.stdlib.cmm', 'identifier', 'identifier', 'dirac.bar', 'identifier', 'dirac.bracket']],

                // Dirac notation - Basic patterns
                // Inner product ⟨a|b⟩
                [/(⟨)([^⟨⟩|]+)(\|)([^⟨⟩|]+)(⟩)/, ['dirac.bracket', 'identifier', 'dirac.bar', 'identifier', 'dirac.bracket']],

                // Ket |a⟩
                [/(\|)([^⟨⟩|\s]+)(⟩)/, ['dirac.bar', 'identifier', 'dirac.bracket']],

                // Bra ⟨a|
                [/(⟨)([^⟨⟩|]+)(\|)/, ['dirac.bracket', 'identifier', 'dirac.bar']],

                // Special cases - identity matrix |I|, basis matrix |B|
                [/(\|)([IB])(\|)/, ['dirac.bar', 'keyword.special.dirac', 'dirac.bar']],

                // Special case - zero vector |0⟩
                [/(\|)(0)(⟩)/, ['dirac.bar', 'keyword.special.dirac', 'dirac.bracket']],

                // Special functions in Dirac notation - |in(x)⟩
                [/(\|)(in\([^)]+\))(⟩)/, ['dirac.bar', 'keyword.function.stdlib.cmm', 'dirac.bracket']],

                // Standalone Dirac brackets and bars
                [/[⟨⟩]/, 'dirac.bracket'],
                [/\|/, 'dirac.bar'],

                // Array initialization from file
                [/(\[\s*\d+\s*\])\s*("[^"]*")/, ['delimiter.square', 'string']],

                // Inverted array index
                [/\[\s*\w+\s*\)/, 'delimiter.square.inverted'],

                // Identifiers and keywords
                [/[a-zA-Z_]\w*/, {
                    cases: {
                        '@typeKeywords': 'keyword.type',
                        '@keywords': 'keyword',
                        '@default': 'identifier'
                    }
                }],

                // Whitespace
                {
                    include: '@whitespace'
                },

                // Strings
                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/"/, {
                    token: 'string.quote',
                    bracket: '@open',
                    next: '@string'
                }],

                // Characters
                [/'[^\\']'/, 'string'],
                [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
                [/'/, 'string.invalid'],

                // Operators
                [/>>>/, 'operator.shift.arithmetic'],
                [/@symbols/, {
                    cases: {
                        '@operators': 'operator',
                        '@default': ''
                    }
                }],

                // Numbers
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
                [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                [/\d+/, 'number']
            ],

            comment: [
                [/[^\/*]+/, 'comment'],
                [/\/\*/, 'comment', '@push'],
                ["\\*/", 'comment', '@pop'],
                [/[\/*]/, 'comment']
            ],

            string: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape.invalid'],
                [/"/, {
                    token: 'string.quote',
                    bracket: '@close',
                    next: '@pop'
                }]
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white'],
                [/\/\*/, 'comment', '@comment'],
                [/\/\/.*$/, 'comment'],
            ],
        }
    });

    // Define dark theme for CMM with enhanced Dirac notation styling
    monaco.editor.defineTheme('cmm-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [{
                token: 'keyword.directive.cmm',
                foreground: '#569CD6'
            }, {
                token: 'keyword.function.stdlib.cmm',
                fontStyle: 'bold',
                foreground: '#DCDCAA'
            }, {
                token: 'operator.shift.arithmetic',
                fontStyle: 'bold',
                foreground: '#D4D4D4'
            }, {
                token: 'delimiter.square.inverted',
                foreground: '#CE9178'
            },

            // Enhanced Dirac notation styling - Dark purple that works on both themes
            {
                token: 'dirac.bracket',
                fontStyle: 'bold',
                foreground: '#8B5CF6'
            }, {
                token: 'dirac.bar',
                fontStyle: 'bold',
                foreground: '#8B5CF6'
            }, {
                token: 'keyword.special.dirac',
                fontStyle: 'bold',
                foreground: '#A855F7'
            }
        ],
        colors: {}
    });

    // Define light theme for CMM with enhanced Dirac notation styling
    monaco.editor.defineTheme('cmm-light', {
        base: 'vs',
        inherit: true,
        rules: [{
                token: 'keyword.directive.cmm',
                fontStyle: 'bold',
                foreground: '#0000FF'
            }, {
                token: 'keyword.function.stdlib.cmm',
                fontStyle: 'bold',
                foreground: '#795E26'
            }, {
                token: 'operator.shift.arithmetic',
                fontStyle: 'bold',
                foreground: '#000000'
            }, {
                token: 'delimiter.square.inverted',
                foreground: '#A31515'
            },

            // Enhanced Dirac notation styling - Same dark purple for light theme
            {
                token: 'dirac.bracket',
                fontStyle: 'bold',
                foreground: '#7C3AED'
            }, {
                token: 'dirac.bar',
                fontStyle: 'bold',
                foreground: '#7C3AED'
            }, {
                token: 'keyword.special.dirac',
                fontStyle: 'bold',
                foreground: '#8B5CF6'
            }
        ],
        colors: {}
    });
}

// Enhanced version with smooth animation
function updateCursorPosition(event) {
    const position = event.position;
    const statusElement = document.getElementById('editorStatus');

    if (statusElement && position) {
        const lineNumber = position.lineNumber;
        const columnNumber = position.column;

        // Add updating class for animation
        statusElement.classList.add('updating');

        // Update content
        statusElement.innerHTML = `<i class="fa-solid fa-align-left"></i> Ln ${lineNumber}, Col ${columnNumber}`;

        // Remove animation class after transition
        setTimeout(() => {
            statusElement.classList.remove('updating');
        }, 150);
    }
}

// BreakpointManager - Handles all breakpoint functionality for Monaco Editor
class BreakpointManager {
    static breakpoints = new Map(); // Map<filePath, Set<lineNumber>>
    static decorations = new Map(); // Map<filePath, decorationIds[]>
    static glyphDecorations = new Map(); // Map<filePath, glyphDecorationIds[]>
    static isEnabled = true;

    /**
     * Initialize breakpoint functionality for an editor instance
     */
    static initializeBreakpoints(editor, filePath) {
        if (!editor || !filePath) return;

        // Initialize breakpoint storage for this file
        if (!this.breakpoints.has(filePath)) {
            this.breakpoints.set(filePath, new Set());
            this.decorations.set(filePath, []);
            this.glyphDecorations.set(filePath, []);
        }

        // Add click listener for gutter margin
        editor.onMouseDown((e) => {
            if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                this.toggleBreakpoint(editor, filePath, e.target.position.lineNumber);
            }
        });

        // Restore existing breakpoints for this file
        this.restoreBreakpoints(editor, filePath);

        // Add context menu items
        this.addContextMenuItems(editor, filePath);
    }

    /**
     * Toggle breakpoint on a specific line
     */
    static toggleBreakpoint(editor, filePath, lineNumber) {
        if (!this.isEnabled) return;

        const fileBreakpoints = this.breakpoints.get(filePath);
        if (!fileBreakpoints) return;

        if (fileBreakpoints.has(lineNumber)) {
            // Remove breakpoint
            fileBreakpoints.delete(lineNumber);
            this.removeBreakpointDecoration(editor, filePath, lineNumber);
        } else {
            // Add breakpoint
            fileBreakpoints.add(lineNumber);
            this.addBreakpointDecoration(editor, filePath, lineNumber);
        }

        // Trigger breakpoint change event
        this.onBreakpointChange(filePath, Array.from(fileBreakpoints));
    }

    /**
     * Add breakpoint decoration to editor
     */
    static addBreakpointDecoration(editor, filePath, lineNumber) {
        const model = editor.getModel();
        if (!model) return;

        // Add line decoration (red background)
        const lineDecorations = editor.deltaDecorations([], [{
            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
            options: {
                isWholeLine: true,
                className: 'breakpoint-line',
                glyphMarginClassName: 'breakpoint-glyph',
                glyphMarginHoverMessage: {
                    value: 'Breakpoint'
                },
                overviewRuler: {
                    color: '#ff0000',
                    position: monaco.editor.OverviewRulerLane.Left
                }
            }
        }]);

        // Store decoration IDs
        const existingDecorations = this.decorations.get(filePath) || [];
        this.decorations.set(filePath, [...existingDecorations, ...lineDecorations]);
    }

    /**
     * Remove breakpoint decoration from editor
     */
    static removeBreakpointDecoration(editor, filePath, lineNumber) {
        const decorationIds = this.decorations.get(filePath) || [];
        const model = editor.getModel();
        if (!model) return;

        // Find decorations for this line
        const decorationsToRemove = [];
        decorationIds.forEach(decorationId => {
            const decoration = model.getDecorationRange(decorationId);
            if (decoration && decoration.startLineNumber === lineNumber) {
                decorationsToRemove.push(decorationId);
            }
        });

        // Remove decorations
        editor.deltaDecorations(decorationsToRemove, []);

        // Update stored decorations
        const remainingDecorations = decorationIds.filter(id =>
            !decorationsToRemove.includes(id)
        );
        this.decorations.set(filePath, remainingDecorations);
    }

    /**
     * Restore breakpoints when opening a file
     */
    static restoreBreakpoints(editor, filePath) {
        const fileBreakpoints = this.breakpoints.get(filePath);
        if (!fileBreakpoints) return;

        fileBreakpoints.forEach(lineNumber => {
            this.addBreakpointDecoration(editor, filePath, lineNumber);
        });
    }

    /**
     * Clear all breakpoints for a file
     */
    static clearFileBreakpoints(editor, filePath) {
        const decorationIds = this.decorations.get(filePath) || [];

        if (decorationIds.length > 0) {
            editor.deltaDecorations(decorationIds, []);
        }

        this.breakpoints.set(filePath, new Set());
        this.decorations.set(filePath, []);
        this.glyphDecorations.set(filePath, []);

        this.onBreakpointChange(filePath, []);
    }

    /**
     * Clear all breakpoints in all files
     */
    static clearAllBreakpoints() {
        EditorManager.editors.forEach(({
            editor
        }, filePath) => {
            this.clearFileBreakpoints(editor, filePath);
        });
    }

    /**
     * Get breakpoints for a specific file
     */
    static getFileBreakpoints(filePath) {
        const fileBreakpoints = this.breakpoints.get(filePath);
        return fileBreakpoints ? Array.from(fileBreakpoints)
            .sort((a, b) => a - b) : [];
    }

    /**
     * Get all breakpoints across all files
     */
    static getAllBreakpoints() {
        const allBreakpoints = {};
        this.breakpoints.forEach((lineNumbers, filePath) => {
            if (lineNumbers.size > 0) {
                allBreakpoints[filePath] = Array.from(lineNumbers)
                    .sort((a, b) => a - b);
            }
        });
        return allBreakpoints;
    }

    /**
     * Set breakpoints programmatically
     */
    static setBreakpoints(filePath, lineNumbers) {
        const editor = EditorManager.getEditorForFile(filePath);
        if (!editor) return;

        // Clear existing breakpoints
        this.clearFileBreakpoints(editor, filePath);

        // Add new breakpoints
        const fileBreakpoints = new Set(lineNumbers);
        this.breakpoints.set(filePath, fileBreakpoints);

        lineNumbers.forEach(lineNumber => {
            this.addBreakpointDecoration(editor, filePath, lineNumber);
        });

        this.onBreakpointChange(filePath, lineNumbers);
    }

    /**
     * Enable/disable breakpoint functionality
     */
    static setEnabled(enabled) {
        this.isEnabled = enabled;

        if (!enabled) {
            // Hide all breakpoint decorations
            EditorManager.editors.forEach(({
                editor
            }, filePath) => {
                const decorationIds = this.decorations.get(filePath) || [];
                if (decorationIds.length > 0) {
                    editor.deltaDecorations(decorationIds, []);
                }
            });
        } else {
            // Restore all breakpoint decorations
            EditorManager.editors.forEach(({
                editor
            }, filePath) => {
                this.restoreBreakpoints(editor, filePath);
            });
        }
    }

    /**
     * Add context menu items for breakpoint operations
     */
    static addContextMenuItems(editor, filePath) {
        editor.addAction({
            id: 'toggle-breakpoint',
            label: 'Toggle Breakpoint',
            keybindings: [monaco.KeyCode.F9],
            contextMenuGroupId: 'debug',
            contextMenuOrder: 1,
            run: () => {
                const position = editor.getPosition();
                if (position) {
                    this.toggleBreakpoint(editor, filePath, position.lineNumber);
                }
            }
        });

        editor.addAction({
            id: 'clear-all-breakpoints',
            label: 'Remove All Breakpoints',
            contextMenuGroupId: 'debug',
            contextMenuOrder: 2,
            run: () => {
                this.clearFileBreakpoints(editor, filePath);
            }
        });

        editor.addAction({
            id: 'clear-all-breakpoints-workspace',
            label: 'Remove All Breakpoints in Workspace',
            contextMenuGroupId: 'debug',
            contextMenuOrder: 3,
            run: () => {
                this.clearAllBreakpoints();
            }
        });
    }

    /**
     * Handle file close - cleanup breakpoints if needed
     */
    static onFileClose(filePath) {
        // Keep breakpoints in memory for when file is reopened
        // Only clear decorations map since editor instance is destroyed
        this.decorations.delete(filePath);
        this.glyphDecorations.delete(filePath);
    }

    /**
     * Export breakpoints to JSON
     */
    static exportBreakpoints() {
        const breakpointData = {};
        this.breakpoints.forEach((lineNumbers, filePath) => {
            if (lineNumbers.size > 0) {
                breakpointData[filePath] = Array.from(lineNumbers);
            }
        });
        return JSON.stringify(breakpointData, null, 2);
    }

    /**
     * Import breakpoints from JSON
     */
    static importBreakpoints(jsonData) {
        try {
            const breakpointData = JSON.parse(jsonData);

            // Clear existing breakpoints
            this.clearAllBreakpoints();

            // Import new breakpoints
            Object.entries(breakpointData)
                .forEach(([filePath, lineNumbers]) => {
                    if (Array.isArray(lineNumbers)) {
                        this.setBreakpoints(filePath, lineNumbers);
                    }
                });

            return true;
        } catch (error) {
            console.error('Failed to import breakpoints:', error);
            return false;
        }
    }

    /**
     * Event handler for breakpoint changes - override this in your application
     */
    static onBreakpointChange(filePath, lineNumbers) {
        // Emit custom event for external listeners
        const event = new CustomEvent('breakpointChange', {
            detail: {
                filePath,
                lineNumbers
            }
        });
        document.dispatchEvent(event);

        // You can also call your debugger/compiler integration here
        console.log(`Breakpoints changed for ${filePath}:`, lineNumbers);
    }

    /**
     * Navigate to next breakpoint
     */
    static goToNextBreakpoint(editor, filePath) {
        const fileBreakpoints = this.getFileBreakpoints(filePath);
        if (fileBreakpoints.length === 0) return;

        const currentPosition = editor.getPosition();
        const currentLine = currentPosition ? currentPosition.lineNumber : 1;

        // Find next breakpoint after current line
        let nextBreakpoint = fileBreakpoints.find(line => line > currentLine);

        // If no breakpoint after current line, wrap to first breakpoint
        if (!nextBreakpoint) {
            nextBreakpoint = fileBreakpoints[0];
        }

        // Navigate to breakpoint
        editor.setPosition({
            lineNumber: nextBreakpoint,
            column: 1
        });
        editor.revealLineInCenter(nextBreakpoint);
    }

    /**
     * Navigate to previous breakpoint
     */
    static goToPreviousBreakpoint(editor, filePath) {
        const fileBreakpoints = this.getFileBreakpoints(filePath);
        if (fileBreakpoints.length === 0) return;

        const currentPosition = editor.getPosition();
        const currentLine = currentPosition ? currentPosition.lineNumber : 1;

        // Find previous breakpoint before current line
        let previousBreakpoint = fileBreakpoints.slice()
            .reverse()
            .find(line => line < currentLine);

        // If no breakpoint before current line, wrap to last breakpoint
        if (!previousBreakpoint) {
            previousBreakpoint = fileBreakpoints[fileBreakpoints.length - 1];
        }

        // Navigate to breakpoint
        editor.setPosition({
            lineNumber: previousBreakpoint,
            column: 1
        });
        editor.revealLineInCenter(previousBreakpoint);
    }
}

//TAB MANAGER   ======================================================================================================================================================== ƒ
class TabManager {
    static tabs = new Map();
    static activeTab = null;
    static editorStates = new Map();
    static unsavedChanges = new Set();
    static closedTabsStack = [];
    static fileWatchers = new Map();
    static lastModifiedTimes = new Map();
    static externalChangeQueue = new Set();
    static periodicCheckInterval = null;
    static isCheckingFiles = false;
    static viewerInstances = new Map();
    static pdfViewerStates = new Map();

    // Image and PDF extensions
    static imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico']);
    static pdfExtensions = new Set(['pdf']);
    static hideOverlay() {
        const overlay = document.getElementById('editor-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    // Show overlay when no content
    static showOverlay() {
        const overlay = document.getElementById('editor-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    }
    // Utility method to check if file is an image
    static isImageFile(filePath) {
        const extension = filePath.split('.')
            .pop()
            .toLowerCase();
        return this.imageExtensions.has(extension);
    }

    // Utility method to check if file is a PDF
    static isPdfFile(filePath) {
        const extension = filePath.split('.')
            .pop()
            .toLowerCase();
        return this.pdfExtensions.has(extension);
    }

    // Utility method to check if file is binary (image or PDF)
    static isBinaryFile(filePath) {
        return this.isImageFile(filePath) || this.isPdfFile(filePath);
    }

    // Create image viewer
    // Enhanced createImageViewer with drag and pan
    static createImageViewer(filePath, container) {
        // Check if viewer already exists
        if (this.viewerInstances.has(filePath)) {
            return this.viewerInstances.get(filePath);
        }

        const imageViewer = document.createElement('div');
        imageViewer.className = 'image-viewer';
        imageViewer.innerHTML = `
    <div class="image-viewer-toolbar">
      <div class="image-viewer-controls">
        <button class="image-control-btn" id="zoom-in-btn" title="Zoom In">
          <i class="fas fa-search-plus"></i>
        </button>
        <button class="image-control-btn" id="zoom-out-btn" title="Zoom Out">
          <i class="fas fa-search-minus"></i>
        </button>
        <button class="image-control-btn" id="zoom-reset-btn" title="Reset Zoom">
          <i class="fas fa-expand-arrows-alt"></i>
        </button>
        <span class="zoom-level" id="zoom-level">100%</span>
      </div>
      <div class="image-info">
        <span id="image-name">${filePath.split(/[\\/]/).pop()}</span>
      </div>
    </div>
    <div class="image-viewer-content" id="image-content">
      <div class="image-container" id="image-container">
        <img id="image-display" src="" alt="Image" />
      </div>
    </div>
  `;

        // Get elements
        const zoomInBtn = imageViewer.querySelector('#zoom-in-btn');
        const zoomOutBtn = imageViewer.querySelector('#zoom-out-btn');
        const zoomResetBtn = imageViewer.querySelector('#zoom-reset-btn');
        const zoomLevel = imageViewer.querySelector('#zoom-level');
        const imageDisplay = imageViewer.querySelector('#image-display');
        const imageContent = imageViewer.querySelector('#image-content');
        const imageContainer = imageViewer.querySelector('#image-container');

        let currentZoom = 1;
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let scrollLeft = 0;
        let scrollTop = 0;

        // Zoom functionality
        const updateZoom = (newZoom) => {
            currentZoom = Math.max(0.1, Math.min(5, newZoom));
            imageDisplay.style.transform = `scale(${currentZoom})`;
            zoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
        };

        // Zoom controls
        zoomInBtn.addEventListener('click', () => updateZoom(currentZoom * 1.2));
        zoomOutBtn.addEventListener('click', () => updateZoom(currentZoom / 1.2));
        zoomResetBtn.addEventListener('click', () => {
            updateZoom(1);
            imageContent.scrollLeft = 0;
            imageContent.scrollTop = 0;
        });

        // Mouse wheel zoom
        imageContent.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                updateZoom(currentZoom * delta);
            }
        });

        // Drag and pan functionality
        imageContent.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left mouse button
                isDragging = true;
                imageContent.classList.add('dragging');
                startX = e.pageX - imageContent.offsetLeft;
                startY = e.pageY - imageContent.offsetTop;
                scrollLeft = imageContent.scrollLeft;
                scrollTop = imageContent.scrollTop;
                e.preventDefault();
            }
        });

        imageContent.addEventListener('mouseleave', () => {
            isDragging = false;
            imageContent.classList.remove('dragging');
        });

        imageContent.addEventListener('mouseup', () => {
            isDragging = false;
            imageContent.classList.remove('dragging');
        });

        imageContent.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const x = e.pageX - imageContent.offsetLeft;
            const y = e.pageY - imageContent.offsetTop;
            const walkX = (x - startX) * 2;
            const walkY = (y - startY) * 2;
            imageContent.scrollLeft = scrollLeft - walkX;
            imageContent.scrollTop = scrollTop - walkY;
        });

        // Touch support for mobile drag and pan
        let touchStartX = 0;
        let touchStartY = 0;
        let touchScrollLeft = 0;
        let touchScrollTop = 0;

        imageContent.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                touchStartX = touch.pageX;
                touchStartY = touch.pageY;
                touchScrollLeft = imageContent.scrollLeft;
                touchScrollTop = imageContent.scrollTop;
            }
        });

        imageContent.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                const touch = e.touches[0];
                const walkX = touchStartX - touch.pageX;
                const walkY = touchStartY - touch.pageY;
                imageContent.scrollLeft = touchScrollLeft + walkX;
                imageContent.scrollTop = touchScrollTop + walkY;
            }
        });

        // Load image
        this.loadImageFile(filePath, imageDisplay);

        // Store viewer instance
        this.viewerInstances.set(filePath, imageViewer);

        return imageViewer;
    }

    // Enhanced createPdfViewer with state preservation
    static createPdfViewer(filePath, container) {
        // Check if viewer already exists
        if (this.viewerInstances.has(filePath)) {
            const existingViewer = this.viewerInstances.get(filePath);
            // Restore the saved state if available
            this.restorePdfViewerState(filePath, existingViewer);
            return existingViewer;
        }

        const pdfViewer = document.createElement('div');
        pdfViewer.className = 'pdf-viewer';
        pdfViewer.innerHTML = `
    <div class="pdf-viewer-content">
      <iframe id="pdf-frame" src="" style="width: 100%; height: 100%; border: none;"></iframe>
    </div>
  `;

        const pdfFrame = pdfViewer.querySelector('#pdf-frame');

        // Add event listeners to track PDF state changes
        pdfFrame.addEventListener('load', () => {
            this.setupPdfStateTracking(filePath, pdfFrame);
        });

        // Load PDF
        this.loadPdfFile(filePath, pdfFrame);

        // Store viewer instance
        this.viewerInstances.set(filePath, pdfViewer);

        return pdfViewer;
    }

    // Setup PDF state tracking
    static setupPdfStateTracking(filePath, iframe) {
        try {
            // Listen for scroll and other changes in the PDF viewer
            const saveState = () => {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (iframeDoc) {
                        const state = {
                            scrollTop: iframeDoc.documentElement.scrollTop || iframeDoc.body.scrollTop,
                            scrollLeft: iframeDoc.documentElement.scrollLeft || iframeDoc.body.scrollLeft,
                            zoom: iframe.contentWindow.PDFViewerApplication?.pdfViewer?.currentScale || 1
                        };
                        this.pdfViewerStates.set(filePath, state);
                    }
                } catch (error) {
                    // Cross-origin restrictions, ignore
                }
            };

            // Save state periodically and on events
            iframe.contentWindow.addEventListener('scroll', saveState);
            iframe.contentWindow.addEventListener('resize', saveState);

            // Save state every 2 seconds
            setInterval(saveState, 2000);
        } catch (error) {
            // Handle cross-origin restrictions
            console.log('PDF state tracking limited due to security restrictions');
        }
    }

    // Restore PDF viewer state
    static restorePdfViewerState(filePath, viewer) {
        const state = this.pdfViewerStates.get(filePath);
        if (!state) return;

        const iframe = viewer.querySelector('#pdf-frame');
        if (!iframe) return;

        iframe.addEventListener('load', () => {
            setTimeout(() => {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (iframeDoc) {
                        iframeDoc.documentElement.scrollTop = state.scrollTop;
                        iframeDoc.documentElement.scrollLeft = state.scrollLeft;

                        // Try to restore zoom if PDF.js is available
                        if (iframe.contentWindow.PDFViewerApplication) {
                            iframe.contentWindow.PDFViewerApplication.pdfViewer.currentScale = state.zoom;
                        }
                    }
                } catch (error) {
                    // Cross-origin restrictions, ignore
                }
            }, 500);
        });
    }

    // Load image file
    static async loadImageFile(filePath, imgElement) {
        try {
            const buffer = await window.electronAPI.readFileBuffer(filePath);
            // converter:
            let arrayBuffer;
            if (buffer instanceof ArrayBuffer) {
                arrayBuffer = buffer;
            } else if (ArrayBuffer.isView(buffer)) {
                arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            } else if (buffer.buffer && buffer.byteLength) {
                arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            } else {
                arrayBuffer = Uint8Array.from(buffer)
                    .buffer;
            }
            const blob = new Blob([arrayBuffer]);
            const url = URL.createObjectURL(blob);
            imgElement.src = url;
            imgElement.onload = () => {
                if (imgElement.dataset.previousUrl) {
                    URL.revokeObjectURL(imgElement.dataset.previousUrl);
                }
                imgElement.dataset.previousUrl = url;
            };
        } catch (error) {
            console.error('Error loading image:', error);
            imgElement.alt = 'Failed to load image';
        }
    }


    static async loadPdfFile(filePath, iframeElement) {
        try {
            const buffer = await window.electronAPI.readFileBuffer(filePath);
            let arrayBuffer;
            if (buffer instanceof ArrayBuffer) {
                arrayBuffer = buffer;
            } else if (ArrayBuffer.isView(buffer)) {
                arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            } else if (buffer.buffer && buffer.byteLength) {
                arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            } else {
                arrayBuffer = Uint8Array.from(buffer)
                    .buffer;
            }
            const blob = new Blob([arrayBuffer], {
                type: 'application/pdf'
            });
            const url = URL.createObjectURL(blob);
            iframeElement.src = url;
            iframeElement.onload = () => {
                if (iframeElement.dataset.previousUrl) {
                    URL.revokeObjectURL(iframeElement.dataset.previousUrl);
                }
                iframeElement.dataset.previousUrl = url;
            };
        } catch (error) {
            console.error('Error loading PDF:', error);
            iframeElement.src = 'data:text/html,<html><body><h3>Failed to load PDF</h3></body></html>';
        }
    }


    static startPeriodicFileCheck() {
        // Clear any existing interval
        if (this.periodicCheckInterval) {
            clearInterval(this.periodicCheckInterval);
        }

        // Check every 2 seconds (economical but responsive)
        this.periodicCheckInterval = setInterval(async () => {
            if (this.isCheckingFiles || this.tabs.size === 0) {
                return;
            }

            this.isCheckingFiles = true;
            try {
                await this.checkAllOpenFilesForChanges();
            } catch (error) {
                console.error('Error in periodic file check:', error);
            } finally {
                this.isCheckingFiles = false;
            }
        }, 2000);
    }

    // Stop periodic checking
    static stopPeriodicFileCheck() {
        if (this.periodicCheckInterval) {
            clearInterval(this.periodicCheckInterval);
            this.periodicCheckInterval = null;
        }
    }

    // Check all open files for changes
    static async checkAllOpenFilesForChanges() {
        const filesToCheck = Array.from(this.tabs.keys());

        // Check files in batches to avoid overwhelming the system
        const batchSize = 3;
        for (let i = 0; i < filesToCheck.length; i += batchSize) {
            const batch = filesToCheck.slice(i, i + batchSize);
            await Promise.allSettled(
                batch.map(filePath => this.checkSingleFileForChanges(filePath))
            );

            // Small delay between batches
            if (i + batchSize < filesToCheck.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }

    // Check a single file for changes
    static async checkSingleFileForChanges(filePath) {
        try {
            if (!this.tabs.has(filePath)) {
                return;
            }

            const stats = await window.electronAPI.getFileStats(filePath);
            const lastKnownTime = this.lastModifiedTimes.get(filePath);

            if (!lastKnownTime || stats.mtime > lastKnownTime) {
                // File has been modified
                await this.handleExternalFileChange(filePath);
            }
        } catch (error) {
            // File might have been deleted or become inaccessible
            if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
                console.log(`File ${filePath} no longer exists, keeping tab open`);
                // Don't close the tab, just stop watching
                this.stopWatchingFile(filePath);
            } else {
                console.error(`Error checking file ${filePath}:`, error);
            }
        }
    }

    // Enhanced file change listener initialization
    static initFileChangeListeners() {
        // Listen for file changes from main process
        window.electronAPI.onFileChanged((filePath) => {
            this.handleExternalFileChange(filePath);
        });

        // Listen for file watcher errors
        window.electronAPI.onFileWatcherError((filePath, error) => {
            console.error(`File watcher error for ${filePath}:`, error);

            // Try to restart watching after a delay
            setTimeout(() => {
                this.restartFileWatcher(filePath);
            }, 2000);
        });
    }

    // Method to restart a file watcher
    static async restartFileWatcher(filePath) {
        try {
            if (!this.tabs.has(filePath)) {
                return;
            }

            console.log(`Restarting file watcher for: ${filePath}`);

            // Stop existing watcher
            this.stopWatchingFile(filePath);

            // Wait a bit before restarting
            await new Promise(resolve => setTimeout(resolve, 500));

            // Start watching again
            await this.startWatchingFile(filePath);
        } catch (error) {
            console.error(`Failed to restart watcher for ${filePath}:`, error);
        }
    }

    // Enhanced startWatchingFile method
    static async startWatchingFile(filePath) {
        if (this.fileWatchers.has(filePath)) {
            return; // Already watching
        }

        try {
            // Get initial file stats
            const stats = await window.electronAPI.getFileStats(filePath);
            this.lastModifiedTimes.set(filePath, stats.mtime);

            // Start watching the file
            const watcherId = await window.electronAPI.watchFile(filePath);
            this.fileWatchers.set(filePath, watcherId);

            console.log(`Started watching file: ${filePath}`);
        } catch (error) {
            console.error(`Error starting file watcher for ${filePath}:`, error);

            // Even if watcher fails, we can still rely on periodic checking
            const stats = await window.electronAPI.getFileStats(filePath);
            this.lastModifiedTimes.set(filePath, stats.mtime);
        }
    }

    // Update the startWatchingFile method
    static async startWatchingFile(filePath) {
        if (this.fileWatchers.has(filePath)) {
            return; // Already watching
        }

        try {
            // Get initial file stats
            const stats = await window.electronAPI.getFileStats(filePath);
            this.lastModifiedTimes.set(filePath, stats.mtime);

            // Start watching the file
            const watcherId = await window.electronAPI.watchFile(filePath);
            this.fileWatchers.set(filePath, watcherId);
        } catch (error) {
            console.error(`Error starting file watcher for ${filePath}:`, error);
        }
    }

    // Stop watching a file
    static stopWatchingFile(filePath) {
        const watcher = this.fileWatchers.get(filePath);
        if (watcher) {
            window.electronAPI.stopWatchingFile(watcher);
            this.fileWatchers.delete(filePath);
            this.lastModifiedTimes.delete(filePath);
        }
    }

    // Enhanced handleExternalFileChange method
    static async handleExternalFileChange(filePath) {
        // Prevent multiple simultaneous checks for the same file
        if (this.externalChangeQueue.has(filePath)) {
            return;
        }

        this.externalChangeQueue.add(filePath);

        try {
            // Double-check that file still exists and is accessible
            const stats = await window.electronAPI.getFileStats(filePath);
            const lastKnownTime = this.lastModifiedTimes.get(filePath);

            // Check if file was actually modified (with small tolerance for clock differences)
            if (lastKnownTime && Math.abs(stats.mtime - lastKnownTime) < 1000) {
                return; // No significant change
            }

            // Update last known modification time
            this.lastModifiedTimes.set(filePath, stats.mtime);

            // Check if file is currently open in a tab
            if (!this.tabs.has(filePath)) {
                return; // File not open, nothing to do
            }

            // Get current editor content
            const editor = EditorManager.getEditorForFile(filePath);
            if (!editor) {
                return;
            }

            const currentEditorContent = editor.getValue();
            const originalTabContent = this.tabs.get(filePath);

            // Read the new file content from disk
            const newFileContent = await window.electronAPI.readFile(filePath);

            // CRITICAL FIX: Check if this change was caused by our own save operation
            const hasUnsavedChanges = this.unsavedChanges.has(filePath);
            const editorContentChanged = currentEditorContent !== originalTabContent;

            // If editor content matches the new file content, this was likely our own save
            if (currentEditorContent === newFileContent) {
                // This was our own save operation - just update the stored content
                // DO NOT call updateTabWithExternalContent as it destroys undo history
                this.tabs.set(filePath, newFileContent);
                this.markFileAsSaved(filePath);
                return;
            }

            if (hasUnsavedChanges || editorContentChanged) {
                // There are local changes - show conflict resolution dialog
                const resolution = await this.showFileConflictDialog(filePath, newFileContent, currentEditorContent);
                await this.handleConflictResolution(filePath, resolution, newFileContent, currentEditorContent);
            } else {
                // No local changes - safe to update with external content
                await this.updateTabWithExternalContent(filePath, newFileContent, editor);
            }

        } catch (error) {
            console.error(`Error handling external change for ${filePath}:`, error);
        } finally {
            this.externalChangeQueue.delete(filePath);
        }
    }

    // Update tab with external content
    static async updateTabWithExternalContent(filePath, newContent, editor) {
        const currentContent = editor.getValue();

        // If content is the same, don't do anything to preserve undo history
        if (currentContent === newContent) {
            this.tabs.set(filePath, newContent);
            this.markFileAsSaved(filePath);
            return;
        }

        // Save current cursor position and scroll
        const position = editor.getPosition();
        const scrollTop = editor.getScrollTop();

        // CRITICAL: Use pushEditOperations instead of setValue to preserve undo history
        const model = editor.getModel();
        const fullRange = model.getFullModelRange();

        // Create an edit operation that can be undone
        const editOperation = {
            range: fullRange,
            text: newContent,
            forceMoveMarkers: true
        };

        // Apply the edit operation - this preserves undo history
        model.pushEditOperations([], [editOperation], () => null);

        // Restore cursor position if still valid
        try {
            const lineCount = model.getLineCount();
            if (position.lineNumber <= lineCount) {
                const maxColumn = model.getLineMaxColumn(position.lineNumber);
                const newPosition = {
                    lineNumber: position.lineNumber,
                    column: Math.min(position.column, maxColumn)
                };
                editor.setPosition(newPosition);
            }
        } catch (error) {
            // Position restoration failed, place cursor at start
            editor.setPosition({
                lineNumber: 1,
                column: 1
            });
        }

        // Restore scroll position
        editor.setScrollTop(scrollTop);

        // Update stored content
        this.tabs.set(filePath, newContent);

        // Mark as saved (no unsaved changes)
        this.markFileAsSaved(filePath);

        // Show notification
        this.showExternalChangeNotification(filePath, 'updated');
    }

    // Show file conflict dialog
    static async showFileConflictDialog(filePath, diskContent, editorContent) {
        const fileName = filePath.split(/[\\/]/)
            .pop();

        return new Promise((resolve) => {
            const modalHTML = `
        <div class="conflict-modal" id="file-conflict-modal">
          <div class="conflict-modal-content">
            <div class="conflict-modal-header">
              <div class="conflict-modal-icon">⚠️</div>
              <h3 class="conflict-modal-title">File Modified Externally</h3>
            </div>
            <div class="conflict-modal-message">
              The file "<strong>${fileName}</strong>" has been modified outside the editor.
              <br><br>
              You have unsaved changes in the editor. What would you like to do?
            </div>
            <div class="conflict-modal-actions">
              <button class="conflict-btn keep-editor" data-action="keep-editor">
                Keep Editor Version
              </button>
              <button class="conflict-btn use-disk" data-action="use-disk">
                Use Disk Version
              </button>
              <button class="conflict-btn save-and-reload" data-action="save-and-reload">
                Save & Reload
              </button>
            </div>
          </div>
        </div>
      `;

            document.body.insertAdjacentHTML('beforeend', modalHTML);
            const modal = document.getElementById('file-conflict-modal');

            modal.addEventListener('click', (e) => {
                const action = e.target.getAttribute('data-action');
                if (action) {
                    modal.remove();
                    resolve(action);
                }
            });

            // Handle escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', handleEscape);
                    resolve('keep-editor'); // Default action
                }
            };
            document.addEventListener('keydown', handleEscape);

            // Show modal
            setTimeout(() => modal.classList.add('show'), 10);
        });
    }

    // Handle conflict resolution
    static async handleConflictResolution(filePath, resolution, diskContent, editorContent) {
        const editor = EditorManager.getEditorForFile(filePath);
        if (!editor) return;

        switch (resolution) {
        case 'keep-editor':
            // Save current editor content to disk
            await this.saveFile(filePath);
            this.showExternalChangeNotification(filePath, 'kept-editor');
            break;

        case 'use-disk':
            // Replace editor content with disk content - use the fixed method
            await this.updateTabWithExternalContent(filePath, diskContent, editor);
            break;

        case 'save-and-reload':
            // Save current content first, then reload from disk
            await this.saveFile(filePath);
            // Read again in case save triggered another change
            const freshContent = await window.electronAPI.readFile(filePath);
            await this.updateTabWithExternalContent(filePath, freshContent, editor);
            this.showExternalChangeNotification(filePath, 'saved-and-reloaded');
            break;
        }
    }

    // Show notification for external changes
    static showExternalChangeNotification(filePath, action) {
        const fileName = filePath.split(/[\\/]/)
            .pop();
        let message = '';

        switch (action) {
        case 'updated':
            message = `${fileName} was updated with external changes`;
            break;
        case 'kept-editor':
            message = `Kept your version of ${fileName}`;
            break;
        case 'saved-and-reloaded':
            message = `Saved and reloaded ${fileName}`;
            break;
        }

        // You can customize this notification system
        console.log(message);
        // Or use your existing notification system:
        // showCardNotification(message, 'info', 2000);
    }

    // Add this method to close all tabs
    static async closeAllTabs() {
        // Create a copy of the tabs keys to avoid modification during iteration
        const openTabs = Array.from(this.tabs.keys());

        // Close each tab
        for (const filePath of openTabs) {
            await this.closeTab(filePath);
        }
    }

    // Enhanced formatCurrentFile with undo history preservation
    static async formatCurrentFile() {
        if (!this.activeTab) {
            console.warn('No active tab to format');
            return;
        }

        const filePath = this.activeTab;

        // Don't format binary files
        if (this.isBinaryFile(filePath)) {
            console.warn('Cannot format binary files');
            return;
        }

        const editor = EditorManager.getEditorForFile(filePath);

        if (!editor) {
            console.error('No editor found for active tab');
            return;
        }

        // Show loading indicator
        this.showFormattingIndicator(true);

        try {
            const originalCode = editor.getValue();

            if (!originalCode.trim()) {
                console.warn('No code to format');
                return;
            }

            // Format the code
            const formattedCode = await CodeFormatter.formatCode(originalCode, filePath);

            if (formattedCode && formattedCode !== originalCode) {
                // Create undo stop before formatting
                editor.pushUndoStop();

                // Store cursor position and selection
                const position = editor.getPosition();
                const selection = editor.getSelection();

                // Update editor content
                editor.setValue(formattedCode);

                // Create undo stop after formatting to make it undoable
                editor.pushUndoStop();

                // Try to restore cursor position (approximate)
                if (position) {
                    const lineCount = editor.getModel()
                        .getLineCount();
                    const restoredPosition = {
                        lineNumber: Math.min(position.lineNumber, lineCount),
                        column: Math.min(position.column, editor.getModel()
                            .getLineLength(Math.min(position.lineNumber, lineCount)) + 1)
                    };
                    editor.setPosition(restoredPosition);
                }

                // Mark file as modified
                this.markFileAsModified(filePath);

                // Show success feedback
                if (typeof showCardNotification === 'function') {
                    showCardNotification('Code formatted successfully', 'success');
                }
            } else {
                if (typeof showCardNotification === 'function') {
                    showCardNotification('Code is already properly formatted', 'info');
                }
            }

        } catch (error) {
            console.error('Code formatting failed:', error);
            if (typeof showCardNotification === 'function') {
                showCardNotification(`Formatting failed: ${error.message}`, 'error');
            }
        } finally {
            // Hide loading indicator
            this.showFormattingIndicator(false);
        }
    }

    static showFormattingIndicator(show) {
        const broomIcon = document.querySelector('.context-refactor-button');
        if (!broomIcon) return;

        if (show) {
            broomIcon.classList.add('formatting');
            broomIcon.title = 'Formatting code...';
        } else {
            broomIcon.classList.remove('formatting');
            broomIcon.style.animation = '';
            broomIcon.title = 'Code Formatter';
        }
    }

    // Enhanced drag & drop functionality for tabs
    static initSortableTabs() {
        const tabsContainer = document.getElementById('tabs-container');
        if (!tabsContainer) return;
        window.addEventListener('dragover', e => e.preventDefault());
        window.addEventListener('drop', e => e.preventDefault());
        let draggedTab = null;
        let draggedTabPath = null;
        let dropIndicator = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let hasMovedEnough = false;

        // Create drop indicator
        const createDropIndicator = () => {
            if (dropIndicator) return dropIndicator;
            dropIndicator = document.createElement('div');
            dropIndicator.className = 'drop-indicator';
            tabsContainer.appendChild(dropIndicator);
            return dropIndicator;
        };

        // Remove drop indicator
        const removeDropIndicator = () => {
            if (dropIndicator) {
                dropIndicator.remove();
                dropIndicator = null;
            }
        };


        // Get tab position in container
        const getTabIndex = (tab) => {
            return Array.from(tabsContainer.children)
                .indexOf(tab);
        };

        // Find drop position based on mouse coordinates
        const getDropPosition = (x, y) => {
            const tabs = Array.from(tabsContainer.querySelectorAll('.tab:not(.dragging)'));

            for (let i = 0; i < tabs.length; i++) {
                const tab = tabs[i];
                const rect = tab.getBoundingClientRect();
                const midpoint = rect.left + rect.width / 2;

                if (x < midpoint) {
                    return {
                        index: i,
                        side: 'left',
                        tab
                    };
                }
            }

            // Drop at the end
            return {
                index: tabs.length,
                side: 'right',
                tab: tabs[tabs.length - 1]
            };
        };

        // Update drop indicator position
        const updateDropIndicator = (dropPosition) => {
            const indicator = createDropIndicator();

            if (!dropPosition.tab) {
                indicator.classList.remove('active');
                return;
            }

            const rect = dropPosition.tab.getBoundingClientRect();
            const containerRect = tabsContainer.getBoundingClientRect();

            let left;
            if (dropPosition.side === 'left') {
                left = rect.left - containerRect.left - 1;
            } else {
                left = rect.right - containerRect.left - 1;
            }

            indicator.style.left = left + 'px';
            indicator.classList.add('active');
        };

        // Reorder tabs in DOM
        const reorderTabs = (draggedPath, targetIndex) => {
            const tabs = Array.from(tabsContainer.querySelectorAll('.tab'));
            const draggedTabElement = tabs.find(tab => tab.getAttribute('data-path') === draggedPath);

            if (!draggedTabElement) return;

            // Remove dragged tab
            draggedTabElement.remove();

            // Insert at new position
            if (targetIndex >= tabs.length - 1) {
                tabsContainer.appendChild(draggedTabElement);
            } else {
                const referenceTab = tabs[targetIndex];
                tabsContainer.insertBefore(draggedTabElement, referenceTab);
            }
        };

        // Event handlers
        const handleDragStart = (e) => {
            const tab = e.target.closest('.tab');
            if (!tab) return;

            draggedTab = tab;
            draggedTabPath = tab.getAttribute('data-path');
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            hasMovedEnough = false;

            // Set drag data
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedTabPath);

            // Create custom drag image (transparent)
            const dragImage = document.createElement('div');
            dragImage.style.opacity = '0';
            document.body.appendChild(dragImage);
            e.dataTransfer.setDragImage(dragImage, 0, 0);
            setTimeout(() => dragImage.remove(), 0);

            // Add dragging class after a brief delay to allow drag image setup
            setTimeout(() => {
                if (draggedTab) {
                    tab.classList.add('dragging');
                    tabsContainer.classList.add('dragging-active');
                }
            }, 10);
        };

        const handleDrag = (e) => {
            if (!draggedTab) return;

            // Check if mouse has moved enough to start visual feedback
            if (!hasMovedEnough) {
                const distance = Math.sqrt(
                    Math.pow(e.clientX - dragStartX, 2) + Math.pow(e.clientY - dragStartY, 2)
                );
                if (distance > 10) {
                    hasMovedEnough = true;
                }
            }

            if (hasMovedEnough) {

                // Update drop indicator
                const dropPosition = getDropPosition(e.clientX, e.clientY);
                updateDropIndicator(dropPosition);
            }
        };

        const handleDragEnd = () => {
            // Clean up
            if (draggedTab) {
                draggedTab.classList.remove('dragging');
            }

            tabsContainer.classList.remove('dragging-active');
            removeDropIndicator();

            // Clear drag over states
            tabsContainer.querySelectorAll('.tab')
                .forEach(tab => {
                    tab.classList.remove('drag-over', 'drag-over-right');
                });

            draggedTab = null;
            draggedTabPath = null;
            hasMovedEnough = false;
        };

        const handleDragOver = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        };

        const handleDrop = (e) => {
            e.preventDefault();

            if (!draggedTabPath) return;

            const dropPosition = getDropPosition(e.clientX, e.clientY);

            // Calculate target index accounting for the dragged tab removal
            let targetIndex = dropPosition.index;
            const currentIndex = getTabIndex(draggedTab);

            if (currentIndex < targetIndex) {
                targetIndex--;
            }

            // Only reorder if position actually changed
            if (targetIndex !== currentIndex) {
                reorderTabs(draggedTabPath, targetIndex);
                this.saveTabOrder(); // Save new order
            }
            e.dataTransfer.clearData();

            handleDragEnd();
        };

        // Add event listeners to all tabs
        const addTabListeners = (tab) => {
            tab.draggable = true;
            tab.addEventListener('dragstart', handleDragStart);
            tab.addEventListener('drag', handleDrag);
            tab.addEventListener('dragend', handleDragEnd);
        };

        // Initialize existing tabs
        tabsContainer.querySelectorAll('.tab')
            .forEach(addTabListeners);

        // Container event listeners
        tabsContainer.addEventListener('dragover', handleDragOver);
        tabsContainer.addEventListener('drop', handleDrop);


        // Observer to add listeners to new tabs
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && node.matches('.tab')) {
                        addTabListeners(node);
                    }
                });
            });
        });

        observer.observe(tabsContainer, {
            childList: true
        });

        // Store observer reference for cleanup
        this.tabObserver = observer;
    }

    // Clean up method (call when destroying TabManager)
    static cleanup() {
        if (this.tabObserver) {
            this.tabObserver.disconnect();
            this.tabObserver = null;
        }
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
        const fileName = segments.pop();

        let html = '<i class="fas fa-folder-open"></i>';

        if (segments.length > 0) {
            html += segments.map(segment =>
                    `<span class="context-path-segment">${segment}</span>`
                )
                .join('<span class="context-path-separator">/</span>');

            html += '<span class="context-path-separator">/</span>';
        }

        const fileIcon = TabManager.getFileIcon(fileName);
        html += `<i class="${fileIcon}" style="color: var(--icon-primary)"></i>`;
        html += `<span class="context-path-filename">${fileName}</span>`;

        // Add file type indicator for binary files
        if (this.isBinaryFile(filePath)) {
            const fileType = this.isImageFile(filePath) ? 'Image' : 'PDF';
            html += `<span class="file-type-indicator">${fileType}</span>`;
        } else {
            // Add formatting button (broom icon) only for text files
            html += `<i class="fa-solid fa-broom context-refactor-button toolbar-button" title="Code Formatter" style="margin-left: auto; cursor: pointer;"></i>`;

            //html += `<i class="fa-solid fa-table-columns context-split-button toolbar-button" title="Split Monaco Editor" style="margin-left: auto; cursor: pointer;"></i>`;
        }

        contextContainer.innerHTML = html;

        // Add click listener for formatting (only for text files)
        if (!this.isBinaryFile(filePath)) {
            const broomIcon = contextContainer.querySelector('.context-refactor-button');
            if (broomIcon) {
                broomIcon.addEventListener('click', async () => {
                    await TabManager.formatCurrentFile();
                });
            }
        }
    }


    static highlightFileInTree(filePath) {
        // Remove highlight from all items
        document.querySelectorAll('.file-tree-item')
            .forEach(item => {
                item.classList.remove('active');
            });

        if (!filePath) return;

        // Find and highlight the corresponding file tree item
        const fileItem = document.querySelector(`.file-tree-item[data-path="${CSS.escape(filePath)}"]`);
        if (fileItem) {
            fileItem.classList.add('active');

            // Ensure the highlighted item is visible by expanding parent folders
            let parent = fileItem.parentElement;
            while (parent) {
                if (parent.classList.contains('folder-content')) {
                    parent.style.display = 'block';
                    const folderItem = parent.previousElementSibling;
                    if (folderItem) {
                        folderItem.querySelector('.folder-icon')
                            ?.classList.add('expanded');
                        const folderPath = folderItem.getAttribute('data-path');
                        if (folderPath) {
                            FileTreeState.expandedFolders.add(folderPath);
                        }
                    }
                }
                parent = parent.parentElement;
            }

            // Scroll the file item into view
            fileItem.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
    }


    // Helper method to determine insertion point
    static getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.tab:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;

                if (offset < 0 && offset > closest.offset) {
                    return {
                        offset: offset,
                        element: child
                    };
                } else {
                    return closest;
                }
            }, {
                offset: Number.NEGATIVE_INFINITY
            })
            .element;
    }

    // Method to get current tab order
    static getTabOrder() {
        const tabContainer = document.getElementById('tabs-container');
        return Array.from(tabContainer.querySelectorAll('.tab'))
            .map(tab => tab.getAttribute('data-path'));
    }

    // Optional: Save tab order to localStorage
    static saveTabOrder() {
        const tabOrder = this.getTabOrder();
        localStorage.setItem('editorTabOrder', JSON.stringify(tabOrder));
    }

    // Optional: Restore tab order from localStorage
    static restoreTabOrder() {
        const savedOrder = localStorage.getItem('editorTabOrder');
        if (savedOrder) {
            const tabContainer = document.getElementById('tabs-container');
            const tabOrder = JSON.parse(savedOrder);

            tabOrder.forEach(filePath => {
                const tab = tabContainer.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
                if (tab) {
                    tabContainer.appendChild(tab);
                }
            });
        }
    }
    // Improved method to mark files as modified
    static markFileAsModified(filePath) {
        if (!filePath) return;

        this.unsavedChanges.add(filePath);
        const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
        if (tab) {
            const closeButton = tab.querySelector('.close-tab');
            if (closeButton) {
                closeButton.innerHTML = '•';
                closeButton.style.color = '#ffd700'; // Gold color for unsaved changes
                closeButton.style.fontSize = '20px';
            }
        }
    }

    // Improved method to mark files as saved
    static markFileAsSaved(filePath) {
        if (!filePath) return;

        this.unsavedChanges.delete(filePath);
        const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
        if (tab) {
            const closeButton = tab.querySelector('.close-tab');
            if (closeButton) {
                closeButton.innerHTML = '×';
                closeButton.style.color = ''; // Reset to default color
                closeButton.style.fontSize = ''; // Reset to default size
            }
        }
    }

    // Add this method to save editor state
    static saveEditorState(filePath) {
        if (!editor || !filePath) return;

        const state = {
            selections: editor.getSelections(),
            viewState: editor.saveViewState(),
            scrollPosition: {
                top: editor.getScrollTop(),
                left: editor.getScrollLeft()
            }
        };

        this.editorStates.set(filePath, state);
    }


    // Add this method to restore editor state
    static restoreEditorState(filePath) {
        if (!editor || !filePath) return;

        const state = this.editorStates.get(filePath);
        if (state) {
            // Restore view state (includes scroll position and folded code sections)
            if (state.viewState) {
                editor.restoreViewState(state.viewState);
            }

            // Restore selections
            if (state.selections && state.selections.length > 0) {
                editor.setSelections(state.selections);
            }
        }
    }

    // Enhanced getFileIcon method with more file types and better icons
    static getFileIcon(filename) {
        const extension = filename.split('.')
            .pop()
            .toLowerCase();

        // Image file icons
        if (this.imageExtensions.has(extension)) {
            const imageIconMap = {
                'jpg': 'fas fa-file-image',
                'jpeg': 'fas fa-file-image',
                'png': 'fas fa-file-image',
                'gif': 'fas fa-file-image',
                'bmp': 'fas fa-file-image',
                'webp': 'fas fa-file-image',
                'svg': 'fas fa-file-code',
                'ico': 'fas fa-file-image'
            };
            return imageIconMap[extension] || 'fas fa-file-image';
        }

        // PDF file icons
        if (extension === 'pdf') {
            return 'fas fa-file-pdf';
        }

        // Enhanced text file icons
        const iconMap = {
            // JavaScript/TypeScript
            'js': 'fab fa-js-square',
            'jsx': 'fab fa-react',
            'ts': 'fab fa-js-square',
            'tsx': 'fab fa-react',
            'mjs': 'fab fa-js-square',
            'vue': 'fab fa-vuejs',

            // Web technologies
            'html': 'fab fa-html5',
            'htm': 'fab fa-html5',
            'css': 'fab fa-css3-alt',
            'scss': 'fab fa-sass',
            'sass': 'fab fa-sass',
            'less': 'fas fa-file-code',

            // Data formats
            'json': 'fas fa-file-code',
            'xml': 'fas fa-file-code',
            'yaml': 'fas fa-file-code',
            'yml': 'fas fa-file-code',
            'toml': 'fas fa-file-code',

            // Documentation
            'md': 'fab fa-markdown',
            'markdown': 'fab fa-markdown',
            'txt': 'fas fa-file-alt',
            'rtf': 'fas fa-file-alt',

            // Programming languages
            'py': 'fab fa-python',
            'java': 'fab fa-java',
            'c': 'fas fa-file-code',
            'cpp': 'fas fa-file-code',
            'cc': 'fas fa-file-code',
            'cxx': 'fas fa-file-code',
            'h': 'fas fa-file-code',
            'hpp': 'fas fa-file-code',
            'cs': 'fas fa-file-code',
            'php': 'fab fa-php',
            'rb': 'fas fa-file-code',
            'go': 'fas fa-file-code',
            'rs': 'fas fa-file-code',
            'swift': 'fab fa-swift',
            'kt': 'fas fa-file-code',
            'scala': 'fas fa-file-code',

            // Shell scripts
            'sh': 'fas fa-terminal',
            'bash': 'fas fa-terminal',
            'zsh': 'fas fa-terminal',
            'fish': 'fas fa-terminal',
            'ps1': 'fas fa-terminal',
            'bat': 'fas fa-terminal',
            'cmd': 'fas fa-terminal',

            // Configuration files
            'ini': 'fas fa-cog',
            'conf': 'fas fa-cog',
            'config': 'fas fa-cog',
            'env': 'fas fa-cog',

            // Archive files
            'zip': 'fas fa-file-archive',
            'rar': 'fas fa-file-archive',
            '7z': 'fas fa-file-archive',
            'tar': 'fas fa-file-archive',
            'gz': 'fas fa-file-archive',

            // Audio files
            'mp3': 'fas fa-file-audio',
            'wav': 'fas fa-file-audio',
            'flac': 'fas fa-file-audio',
            'ogg': 'fas fa-file-audio',

            // Video files
            'mp4': 'fas fa-file-video',
            'avi': 'fas fa-file-video',
            'mkv': 'fas fa-file-video',
            'mov': 'fas fa-file-video',

            // Office documents
            'doc': 'fas fa-file-word',
            'docx': 'fas fa-file-word',
            'xls': 'fas fa-file-excel',
            'xlsx': 'fas fa-file-excel',
            'ppt': 'fas fa-file-powerpoint',
            'pptx': 'fas fa-file-powerpoint'
        };

        return iconMap[extension] || 'fas fa-file';
    }

    // Enhanced addTab method with binary file support
    static addTab(filePath, content = null) {
        // Check if tab already exists
        if (this.tabs.has(filePath)) {
            this.activateTab(filePath);
            return;
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
        tab.setAttribute('title', filePath);

        // Add binary file indicator
        const isBinary = this.isBinaryFile(filePath);
        if (isBinary) {
            tab.classList.add('binary-file');
        }

        tab.innerHTML = `
      <i class="${this.getFileIcon(filePath.split(/[\\/]/).pop())}"></i>
      <span class="tab-name">${filePath.split(/[\\/]/).pop()}</span>
      <button class="close-tab" title="Close">×</button>
    `;

        // Add event listeners
        tab.addEventListener('click', () => this.activateTab(filePath));
        const closeBtn = tab.querySelector('.close-tab');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(filePath);
        });

        // Add to container
        tabContainer.appendChild(tab);

        // Start watching file and periodic checking if this is the first tab
        this.startWatchingFile(filePath);
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

            try {
                // Create editor and set content
                const editor = EditorManager.createEditorInstance(filePath);
                editor.setValue(content || '');

                // Setup change listener
                this.setupContentChangeListener(filePath, editor);
                this.activateTab(filePath);
            } catch (error) {
                console.error('Error creating editor:', error);
                this.closeTab(filePath);
            }
        }

        this.initSortableTabs();
    }



    static addDragListeners(tab) {
        tab.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', tab.getAttribute('data-path'));
            tab.classList.add('dragging');

            // Desativa a transição para todas as abas
            const tabContainer = tab.parentElement;
            if (tabContainer) {
                tabContainer.classList.add('dragging');
            }
        });

        tab.addEventListener('dragend', () => {
            tab.classList.remove('dragging');

            // Reativa a transição para todas as abas
            const tabContainer = tab.parentElement;
            if (tabContainer) {
                tabContainer.classList.remove('dragging');
            }
        });

        tab.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingTab = document.querySelector('.tab.dragging');
            if (draggingTab && draggingTab !== tab) {
                const tabContainer = tab.parentElement;
                const rect = tab.getBoundingClientRect();
                const afterElement = (e.clientX - rect.left) > (rect.width / 2);

                if (afterElement) {
                    tab.after(draggingTab);
                } else {
                    tab.before(draggingTab);
                }
            }
        });
    }

    // Enhanced activateTab with better viewer management
    static activateTab(filePath) {
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => tab.classList.remove('active'));

        const activeTab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
        if (activeTab) {
            activeTab.classList.add('active');
            this.activeTab = filePath;

            // Update context path
            this.updateContextPath(filePath);
            this.highlightFileInTree(filePath);

            const editorContainer = document.getElementById('monaco-editor');
            this.hideOverlay();

            // Handle binary files
            if (this.isBinaryFile(filePath)) {
                // Save current PDF state before switching
                if (this.activeTab && this.isPdfFile(this.activeTab)) {
                    this.savePdfViewerState(this.activeTab);
                }

                // Hide ALL editor instances
                const editorInstances = editorContainer.querySelectorAll('.editor-instance');
                editorInstances.forEach(el => {
                    el.style.display = 'none';
                    el.classList.remove('active');
                });

                // Hide all viewers first
                const allViewers = editorContainer.querySelectorAll('.image-viewer, .pdf-viewer');
                allViewers.forEach(viewer => {
                    viewer.style.display = 'none';
                });

                // Get or create appropriate viewer
                let viewer = this.viewerInstances.get(filePath);
                if (!viewer) {
                    if (this.isImageFile(filePath)) {
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
                const allViewers = editorContainer.querySelectorAll('.image-viewer, .pdf-viewer');
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

    // Save PDF viewer state before switching tabs
    static savePdfViewerState(filePath) {
        const viewer = this.viewerInstances.get(filePath);
        if (!viewer) return;

        const iframe = viewer.querySelector('#pdf-frame');
        if (!iframe) return;

        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (iframeDoc) {
                const state = {
                    scrollTop: iframeDoc.documentElement.scrollTop || iframeDoc.body.scrollTop,
                    scrollLeft: iframeDoc.documentElement.scrollLeft || iframeDoc.body.scrollLeft,
                    zoom: iframe.contentWindow.PDFViewerApplication?.pdfViewer?.currentScale || 1
                };
                this.pdfViewerStates.set(filePath, state);
            }
        } catch (error) {
            // Cross-origin restrictions, ignore
        }
    }

    // Comprehensive save method
    static async saveCurrentFile() {
        const currentPath = this.activeTab;
        if (!currentPath) return;

        try {
            const currentEditor = EditorManager.getEditorForFile(currentPath);
            if (!currentEditor) return;

            const content = currentEditor.getValue();

            // Update stored content first
            this.tabs.set(currentPath, content);

            // Save file without interfering with undo history
            await window.electronAPI.writeFile(currentPath, content);
            this.markFileAsSaved(currentPath);

            // Update last modified time
            try {
                const stats = await window.electronAPI.getFileStats(currentPath);
                this.lastModifiedTimes.set(currentPath, stats.mtime);
            } catch (error) {
                // Ignore stats errors
            }

        } catch (error) {
            console.error('Error saving file:', error);
        }
    }

    // Enhanced saveAllFiles method with undo history preservation
    static async saveAllFiles() {
        for (const [filePath, originalContent] of this.tabs.entries()) {
            // Skip binary files
            if (this.isBinaryFile(filePath)) continue;

            const editor = EditorManager.getEditorForFile(filePath);
            if (!editor) continue;

            const currentContent = editor.getValue();

            // Only save if modified
            if (currentContent !== originalContent) {
                try {
                    // Update stored content first
                    this.tabs.set(filePath, currentContent);

                    // Save without creating undo stops
                    await window.electronAPI.writeFile(filePath, currentContent);
                    this.markFileAsSaved(filePath);

                    // Update last modified time
                    try {
                        const stats = await window.electronAPI.getFileStats(filePath);
                        this.lastModifiedTimes.set(filePath, stats.mtime);
                    } catch (error) {
                        // Ignore stats errors
                    }

                } catch (error) {
                    console.error(`Error saving file ${filePath}:`, error);
                }
            }
        }
    }

    // Add listener for content changes
    static setupContentChangeListener(filePath, editor) {
        editor.onDidChangeModelContent(() => {
            const currentContent = editor.getValue();
            const originalContent = this.tabs.get(filePath);

            if (currentContent !== originalContent) {
                this.markFileAsModified(filePath);
            } else {
                this.markFileAsSaved(filePath);
            }
        });
    }



    static isClosingTab = false; // Prevent double closing

    // Enhanced closeTab method
    // Enhanced closeTab with viewer cleanup
    static async closeTab(filePath) {
        // Prevent multiple simultaneous closes
        if (this.isClosingTab) return;
        this.isClosingTab = true;

        try {
            // Handle unsaved changes for text files
            if (!this.isBinaryFile(filePath) && this.unsavedChanges.has(filePath)) {
                const fileName = filePath.split(/[\\/]/)
                    .pop();
                const result = await showUnsavedChangesDialog(fileName);

                switch (result) {
                case 'save':
                    try {
                        await this.saveFile(filePath);
                    } catch (error) {
                        console.error('Failed to save file:', error);
                    }
                    break;
                case 'dont-save':
                    break;
                case 'cancel':
                default:
                    return;
                }
            }

            // Clean up viewer instance
            if (this.viewerInstances.has(filePath)) {
                const viewer = this.viewerInstances.get(filePath);
                if (viewer && viewer.parentNode) {
                    viewer.remove();
                }
                this.viewerInstances.delete(filePath);
            }

            // Add to closed tabs stack
            const currentContent = this.tabs.get(filePath);
            this.closedTabsStack.push({
                filePath: filePath,
                content: currentContent,
                timestamp: Date.now()
            });

            if (this.closedTabsStack.length > 10) {
                this.closedTabsStack.shift();
            }

            // Remove tab from UI
            const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
            if (tab) {
                tab.remove();
            }

            this.stopWatchingFile(filePath);

            if (this.tabs.size === 0) {
                this.stopPeriodicFileCheck();
            }

            // Clean up editor and data
            if (!this.isBinaryFile(filePath)) {
                EditorManager.closeEditor(filePath);
            }

            this.tabs.delete(filePath);
            this.unsavedChanges.delete(filePath);
            this.editorStates.delete(filePath);

            // Handle active tab switching
            if (this.activeTab === filePath) {
                this.highlightFileInTree(null);
                const remainingTabs = Array.from(this.tabs.keys());

                if (remainingTabs.length > 0) {
                    this.activateTab(remainingTabs[remainingTabs.length - 1]);
                } else {
                    // No tabs left - show overlay
                    this.activeTab = null;
                    this.updateContextPath(null);
                    this.showOverlay();

                    // Clear the editor
                    const mainEditor = EditorManager.activeEditor;
                    if (mainEditor) {
                        mainEditor.setValue('');
                        const model = mainEditor.getModel();
                        if (model) {
                            monaco.editor.setModelLanguage(model, 'plaintext');
                        }
                    }
                }
            }

        } finally {
            this.isClosingTab = false;
        }
    }

    // Enhanced cleanup method
    static cleanup() {
        // Save all PDF states before cleanup
        for (const [filePath, viewer] of this.viewerInstances.entries()) {
            if (this.isPdfFile(filePath)) {
                this.savePdfViewerState(filePath);
            }
        }

        this.viewerInstances.clear();
        this.pdfViewerStates.clear();
        this.stopAllWatchers();
    }
    // Method to stop all file watchers (call on app close)
    static stopAllWatchers() {
        for (const filePath of this.fileWatchers.keys()) {
            this.stopWatchingFile(filePath);
        }
    }

    // Enhanced reopenLastClosedTab method
    static async reopenLastClosedTab() {
        if (this.closedTabsStack.length === 0) return;

        const closedTab = this.closedTabsStack.pop();
        const {
            filePath,
            content
        } = closedTab;

        try {
            // Check if tab is already open
            if (this.tabs.has(filePath)) {
                this.activateTab(filePath);
                return;
            }

            // Try to read current file content
            let currentContent;
            try {
                currentContent = await window.electronAPI.readFile(filePath);
            } catch (error) {
                // File might not exist anymore, use stored content
                currentContent = content;
            }

            // Recreate the tab
            this.addTab(filePath, currentContent);

            // If content was different when closed, restore it and mark as modified
            if (content !== currentContent) {
                const editor = EditorManager.getEditorForFile(filePath);
                if (editor) {
                    editor.setValue(content);
                    this.markFileAsModified(filePath);
                }
            }

        } catch (error) {
            console.error('Error reopening tab:', error);
        }
    }


    // Handling unsaved changes with dialog
    static async handleUnsavedChanges(filePath) {
        const fileName = filePath.split(/[\\/]/)
            .pop();
        const result = await showUnsavedChangesDialog(fileName);

        switch (result) {
        case 'save':
            try {
                await this.saveFile(filePath);
                return true;
            } catch (error) {
                console.error('Error saving file:', error);
                return true; // Continue closing even if save failed
            }
        case 'dont-save':
            this.unsavedChanges.delete(filePath);
            return true;
        case 'cancel':
        default:
            return false;
        }
    }

    // Enhanced saveFile method with undo history preservation
    static async saveFile(filePath = null) {
        const currentPath = filePath || this.activeTab;
        if (!currentPath) return;

        // Don't save binary files
        if (this.isBinaryFile(currentPath)) return;

        try {
            const currentEditor = EditorManager.getEditorForFile(currentPath);
            if (!currentEditor) {
                throw new Error('Editor not found for file');
            }

            const content = currentEditor.getValue();

            // IMPORTANT: Update our stored content BEFORE writing to disk
            // This helps the external change handler recognize this as our own save
            this.tabs.set(currentPath, content);

            // Save file without interfering with undo history
            await window.electronAPI.writeFile(currentPath, content);

            // Mark as saved
            this.markFileAsSaved(currentPath);

            // Update the last modified time to prevent false external change detection
            try {
                const stats = await window.electronAPI.getFileStats(currentPath);
                this.lastModifiedTimes.set(currentPath, stats.mtime);
            } catch (error) {
                // If we can't get stats, that's okay - the content comparison will handle it
            }

        } catch (error) {
            console.error('Error saving file:', error);
            throw error;
        }
    }

    // Optional: Method to manually create undo stops when needed
    static createUndoStop(filePath = null) {
        const currentPath = filePath || this.activeTab;
        if (!currentPath) return;

        const editor = EditorManager.getEditorForFile(currentPath);
        if (editor && typeof editor.pushUndoStop === 'function') {
            editor.pushUndoStop();
        }
    }

    // Optional: Method to get undo/redo state information
    static getUndoRedoState(filePath = null) {
        const currentPath = filePath || this.activeTab;
        if (!currentPath) return null;

        const editor = EditorManager.getEditorForFile(currentPath);
        if (!editor) return null;

        return {
            canUndo: editor.getModel() ? editor.getModel()
                .canUndo() : false,
            canRedo: editor.getModel() ? editor.getModel()
                .canRedo() : false
        };
    }

    // Fixed reopenLastClosedTab method
    static async reopenLastClosedTab() {
        if (this.closedTabsStack.length === 0) return;

        const closedTab = this.closedTabsStack.pop();
        const {
            filePath,
            content
        } = closedTab;

        try {
            // Check if tab is already open
            if (this.tabs.has(filePath)) {
                this.activateTab(filePath);
                return;
            }

            // Try to read current file content
            let currentContent;
            try {
                currentContent = await window.electronAPI.readFile(filePath);
            } catch (error) {
                // File might not exist anymore, use stored content
                currentContent = content;
            }

            // Recreate the tab
            this.addTab(filePath, currentContent);

            // If content was different when closed, restore it and mark as modified
            if (content !== currentContent) {
                const editor = EditorManager.getEditorForFile(filePath);
                if (editor) {
                    editor.setValue(content);
                    this.markFileAsModified(filePath);
                }
            }

        } catch (error) {
            console.error('Error reopening tab:', error);
        }
    }

    static updateEditorContent(filePath) {
        const content = this.tabs.get(filePath); // Obtém o conteúdo da aba ativa
        if (editor && content !== undefined) {
            // Atualiza o conteúdo do Monaco Editor
            editor.setValue(content);

            // Determina a linguagem do arquivo com base na extensão
            const extension = filePath.split('.')
                .pop()
                .toLowerCase();
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
                'hpp': 'cpp'
            };
            const language = languageMap[extension] || 'plaintext';

            // Atualiza o modelo do Monaco Editor com o novo conteúdo e linguagem
            editor.getModel()
                ?.dispose();
            editor.setModel(monaco.editor.createModel(content, language));
        } else {
            console.error(`No content found for ${filePath}`);
        }
    }
    // Initialize on script load
    static initialize() {
        this.initSortableTabs();
        this.restoreTabOrder();
        this.initFileChangeListeners(); // Add this line

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

// Call initialization when the script loads
TabManager.initialize();

// Atualizar a função de inicialização do contexto
function initContextPath() {
    const editorContainer = document.getElementById('monaco-editor')
        .parentElement;
    const contextContainer = document.createElement('div');
    contextContainer.id = 'context-path';
    contextContainer.className = 'context-path-container empty';

    // Inserir após o container de tabs
    const tabsContainer = document.getElementById('editor-tabs');
    if (tabsContainer) {
        tabsContainer.after(contextContainer);
    }
}

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


    if (!document.getElementById('editor-tabs')) {
        const tabsContainer = document.createElement('div');
        tabsContainer.id = 'editor-tabs';
        editorContainer.insertBefore(tabsContainer, editorContainer.firstChild);
    }

    if (!document.getElementById('context-path')) {
        initContextPath();
    }
}

window.addEventListener('load', () => {
    initTabs();

});

document.addEventListener('keydown', (e) => {
    // Prevent default browser shortcuts that might interfere
    if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
        case 'w':
            e.preventDefault();
            if (TabManager.activeTab) {
                TabManager.closeTab(TabManager.activeTab);
            }
            break;

        case 't':
            if (e.shiftKey) {
                e.preventDefault();
                TabManager.reopenLastClosedTab();
            }
            break;

        case 's':
            e.preventDefault();
            if (e.shiftKey) {
                TabManager.saveAllFiles();
            } else {
                TabManager.saveCurrentFile();
            }
            break;
        }
    }
});

// SHOW DIALOG  ======================================================================================================================================================== ƒ
// Simple, reliable confirmation dialog
function showUnsavedChangesDialog(fileName) {
    return new Promise((resolve) => {
        // Remove any existing modals
        const existingModal = document.querySelector('.confirm-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal HTML
        const modalHTML = `
            <div class="confirm-modal" id="unsaved-changes-modal">
                <div class="confirm-modal-content">
                    <div class="confirm-modal-header">
                        <div class="confirm-modal-icon">⚠</div>
                        <h3 class="confirm-modal-title">Unsaved Changes</h3>
                    </div>
                    <div class="confirm-modal-message">
                        Do you want to save the changes you made to "<strong>${fileName}</strong>"?<br>
                        Your changes will be lost if you don't save them.
                    </div>
                    <div class="confirm-modal-actions">
                        <button class="confirm-btn cancel" data-action="cancel">Cancel</button>
                        <button class="confirm-btn dont-save" data-action="dont-save">Don't Save</button>
                        <button class="confirm-btn save" data-action="save">Save</button>
                    </div>
                </div>
            </div>
        `;

        // Add modal to document
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('unsaved-changes-modal');

        // Handle button clicks
        modal.addEventListener('click', (e) => {
            const action = e.target.getAttribute('data-action');
            if (action) {
                closeModal(action);
            }
        });

        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal('cancel');
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Close modal function
        function closeModal(result) {
            document.removeEventListener('keydown', handleEscape);
            modal.classList.remove('show');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 300);
        }

        // Show modal with animation
        setTimeout(() => {
            modal.classList.add('show');
            // Focus the Save button by default
            modal.querySelector('.confirm-btn.save')
                .focus();
        }, 10);
    });
}

//FILETREE      ======================================================================================================================================================== ƒ
// Gerenciador de estado para a file tree
const FileTreeState = {
    expandedFolders: new Set(),
    isRefreshing: false,

    isExpanded(path) {
        return this.expandedFolders.has(path);
    },

    toggleFolder(path, expanded) {
        if (expanded) {
            this.expandedFolders.add(path);
        } else {
            this.expandedFolders.delete(path);
        }
    }
};

// Atualizar a função refreshFileTree
async function refreshFileTree() {
    try {
        if (!currentProjectPath) {
            console.warn('No project is currently open');
            return;
        }

        const isDirectory = await window.electronAPI.isDirectory(currentProjectPath);
        if (!isDirectory) {
            // If not a directory, try to get the directory from the .spf file
            const directoryPath = path.dirname(currentSpfPath);
            currentProjectPath = directoryPath;
            const currentProjectPath = window.currentProjectPath || localStorage.getItem('currentProjectPath');
            if (currentProjectPath) {
                await window.electronAPI.getCurrentProject(currentProjectPath);
            }
        }

        // Prevenir múltiplas atualizações simultâneas
        if (FileTreeState.isRefreshing) {
            return;
        }

        FileTreeState.isRefreshing = true;
        const refreshButton = document.getElementById('refresh-button');

        if (refreshButton) {
            refreshButton.style.pointerEvents = 'none'; // Desabilitar cliques durante refresh
            refreshButton.classList.add('spinning');
        }

        const result = await window.electronAPI.refreshFolder(currentProjectPath);

        if (result) {
            const fileTree = document.getElementById('file-tree');
            if (fileTree) {
                // Aplicar fade-out antes de limpar
                fileTree.style.transition = 'opacity 0.2s ease';
                fileTree.style.opacity = '0';

                setTimeout(() => {
                    fileTree.innerHTML = '';
                    renderFileTree(result.files, fileTree);

                    // Aplicar fade-in depois de renderizar
                    fileTree.style.opacity = '1';
                }, 300);
            }
        }

        if (refreshButton) {
            refreshButton.style.pointerEvents = 'auto'; // Reabilitar cliques
            refreshButton.classList.remove('spinning');
            refreshButton.style.visibility = 'visible';
        }

    } catch (error) {
        console.error('Error refreshing file tree:', error);
    } finally {
        FileTreeState.isRefreshing = false;
    }
}

const style = document.createElement('style');
style.textContent = `
  @keyframes refresh-fade {
    0% { opacity: 0.5; }
    100% { opacity: 1; }
  }

  #refresh-button {
    transition: transform 0.3s ease;
  }

  #refresh-button.spinning {
    transform: rotate(180deg);
  }

  .file-tree-item {
    width: 100%;
  }

  .file-item {
    display: flex;
    align-items: center;
    padding: 4px 0;
    cursor: pointer;
  }

  .file-item:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .folder-toggle {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 4px;
    transition: transform 0.2s;
  }

  .folder-content {
    width: 100%;
  }

  .hidden {
    display: none;
  }

  .file-item-icon {
    margin-right: 8px;
  }

  .file-item span {
    margin-left: 4px;
  }

  #refresh-button {
    transition: transform 0.3s ease;
    visibility: visible !important; /* Forçar visibilidade */
    opacity: 1 !important; /* Garantir opacidade */
    pointer-events: auto; /* Garantir que cliques funcionem */
  }

  #refresh-button.spinning {
    transform: rotate(180deg);
    pointer-events: none;
  }

  @keyframes blinkEffect {
    0% { opacity: 1; }
    50% { opacity: 0.3; }
    100% { opacity: 1; }
  }

  .blink {
    animation: blinkEffect 0.3s ease-in-out;
  }


`;
document.head.appendChild(style);

function renderFileTree(files, container, level = 0, parentPath = '') {
    const filteredFiles = files.filter(file => {
        // sempre mostrar diretórios
        if (file.type === 'directory') return true;

        // esconder projectConfig.json
        if (file.name === 'projectOriented.json') return false;

        if (file.name === 'processorConfig.json') return false;

        // esconder .spf
        const extension = file.name.split('.')
            .pop()
            .toLowerCase();
        return extension !== 'spf';
    });

    filteredFiles.forEach(file => {
        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'file-tree-item';

        const item = document.createElement('div');
        item.className = 'file-item';
        item.style.paddingLeft = `${level * 20}px`;

        const icon = document.createElement('i');
        const filePath = parentPath ? `${parentPath}/${file.name}` : file.name;

        if (file.type === 'directory') {
            const folderToggle = document.createElement('i');
            folderToggle.className = 'fa-solid fa-caret-right folder-toggle';
            item.appendChild(folderToggle);

            icon.className = 'fas fa-folder file-item-icon';
            item.appendChild(icon);

            const childContainer = document.createElement('div');
            childContainer.className = 'folder-content';

            const wasExpanded = FileTreeState.isExpanded(filePath);
            if (!wasExpanded) {
                childContainer.classList.add('hidden');
                icon.classList.remove('fa-folder-open');
                icon.classList.add('fa-folder');
            } else {
                folderToggle.classList.toggle('rotated');
                icon.classList.remove('fa-folder');
                icon.classList.add('fa-folder-open');
            }

            const toggleFolder = () => {
                const isExpanded = !childContainer.classList.contains('hidden');
                childContainer.classList.toggle('hidden');
                folderToggle.classList.toggle('rotated');

                icon.classList.toggle('fa-folder');
                icon.classList.toggle('fa-folder-open');

                FileTreeState.toggleFolder(filePath, !isExpanded);

                if (!isExpanded) {
                    // Adicionar delay dinâmico nos itens filhos ao expandir
                    const visibleItems = childContainer.querySelectorAll('.file-tree-item');
                    visibleItems.forEach((item, index) => {
                        item.style.animation = 'none'; // reset
                        item.offsetHeight; // force reflow
                        item.style.animation = `fadeInDown 0.3s ease forwards`;
                        item.style.animationDelay = `${index * 50}ms`;
                    });
                }
            };


            item.addEventListener('click', toggleFolder);

            if (file.children) {
                renderFileTree(file.children, childContainer, level + 1, filePath);
            }

            itemWrapper.appendChild(item);
            itemWrapper.appendChild(childContainer);
        } else {
            const extension = file.name.split('.')
                .pop()
                .toLowerCase();
            if (extension === 'gtkw') {
                icon.className = 'fa-solid fa-file-waveform file-item-icon';
            } else if (extension === 'v') {
                icon.className = 'fa-solid fa-file-pen file-item-icon';
            } else if (extension === 'txt') {
                icon.className = 'fa-solid fa-file-lines';
            } else if (extension === 'zip' || extension === '7z') {
                icon.className = 'fa-solid fa-file-zipper file-item-icon';
            } else if (file.name === 'house_report.json') {
                icon.className = 'fa-solid fa-file-export file-item-icon';
            } else if (extension === 'cmm') {

                icon.className = 'fa-solid fa-microchip file-item-icon';
                /* Em vez de remover o ícone existente, use-o como container
        icon.className = 'cmm-icon-container';
        icon.innerHTML = ''; // Limpa o conteúdo anterior
        icon.style.display = 'inline-flex';
        icon.style.alignItems = 'center';
        icon.style.gap = '2px'; // Espaçamento uniforme entre os ícones (mais moderno que margin)
        
        // Adicionar os ícones dentro do container existente
        const iconC = document.createElement('i');
        iconC.className = 'fa-solid fa-c';
        
        const iconPlusMinus = document.createElement('i');
        iconPlusMinus.className = 'fa-solid fa-plus-minus';
        
        icon.appendChild(iconC);
        icon.appendChild(iconPlusMinus); */
            } else if (extension === 'mif') {
                icon.className = 'fa-solid fa-square-binary file-item-icon';
            } else {
                icon.className = TabManager.getFileIcon(file.name);
            }

            itemWrapper.setAttribute('data-path', file.path);

            item.addEventListener('click', async () => {
                try {
                    const content = await window.electronAPI.readFile(file.path);
                    TabManager.addTab(file.path, content);
                } catch (error) {
                    console.error('Error opening file:', error);
                }
            });
            item.addEventListener('click', () => openFile(file.path));

            item.appendChild(icon);
            itemWrapper.appendChild(item);
        }

        const name = document.createElement('span');
        name.textContent = file.name;
        item.appendChild(name);

        container.appendChild(itemWrapper);
    });
}

// Função para monitorar mudanças na pasta com debounce
async function setupFileWatcher() {
    if (!currentProjectPath) {
        console.warn('No project is currently open');
        return;
    }

    try {
        // Configurar watcher usando Electron
        await window.electronAPI.watchFolder(currentProjectPath, async (eventType, filename) => {
            // Usar debounce para evitar múltiplas atualizações simultâneas
            if (watcherTimeout) {
                clearTimeout(watcherTimeout);
            }

            watcherTimeout = setTimeout(() => {
                refreshFileTree();
            }, REFRESH_DELAY);
        });

        // Iniciar polling de backup para garantir atualizações
        startPollingRefresh();

    } catch (error) {
        console.error('Error setting up file watcher:', error);
    }
}

// Polling de backup para garantir atualizações

function startPollingRefresh() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }

    // Fazer polling a cada 2 segundos como backup
    pollingInterval = setInterval(() => {
        if (!FileTreeState.isRefreshing) {
            refreshFileTree();
        }
    }, 2000);
}

function stopPollingRefresh() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

// Modify the openFile function to work with the new TabManager
async function openFile(filePath) {
    try {
        // Check if file is already open
        if (TabManager.tabs.has(filePath)) {
            TabManager.activateTab(filePath);
            return;
        }

        // Read file content
        const content = await window.electronAPI.readFile(filePath);

        // Add tab and open file
        TabManager.addTab(filePath, content);
    } catch (error) {
        console.error('Error opening file:', error);
        // Optional: Show error dialog to user
    }
}


function setActiveFile(filePath) {
    if (!editor) return;

    // Obter conteúdo do arquivo
    const content = openFiles.get(filePath);
    if (!content) return;

    // Atualizar conteúdo do Monaco Editor
    editor.setValue(content);
    activeFile = filePath;

    // Atualizar linguagem com base na extensão
    const extension = filePath.split('.')
        .pop()
        .toLowerCase();
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
        'hpp': 'cpp'
    };
    const language = languageMap[extension] || 'plaintext';
    editor.getModel()
        ?.dispose();
    editor.setModel(monaco.editor.createModel(content, language));

    // Atualizar o estado da aba
    const tab = document.querySelector(`.tab[data-path="${filePath}"]`);
    if (tab) {
        // Ativar a aba clicada
        TabManager.activateTab(filePath); // Alteração: Passe diretamente o filePath aqui
    }
}

// Show modal when "New Project" button is clicked
newProjectBtn.addEventListener('click', () => {
    newProjectModal.classList.remove('hidden'); // Remove the "hidden" class to show the modal
});

// Atualizar a inicialização do projeto
function initializeProject(projectPath) {
    currentProjectPath = projectPath;
    refreshFileTree();
    setupFileWatcher();
}

// Atualizar event listener do botão de refresh
document.addEventListener('DOMContentLoaded', () => {
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.addEventListener('click', async () => {
            if (!FileTreeState.isRefreshing) {
                await refreshFileTree();
            }
        });
    }

    // Limpar intervalos quando a janela for fechada
    window.addEventListener('beforeunload', () => {
        stopPollingRefresh();
        if (watcherTimeout) {
            clearTimeout(watcherTimeout);
        }
    });
});


// Adicione um listener para o evento customizado
document.addEventListener('refresh-file-tree', () => {
    refreshFileTree();
});

// File Tree Search System
class FileTreeSearch {
    constructor() {
        this.searchInput = null;
        this.clearButton = null;
        this.resultsCounter = null;
        this.originalFileTree = new Map(); // Store original file tree state
        this.searchResults = [];
        this.isSearchActive = false;
        this.debounceTimer = null;

        this.init();
    }

    init() {
        // A injeção de estilo foi removida daqui
        this.setupEventListeners();
    }

    // O MÉTODO createStyles() FOI COMPLETAMENTE REMOVIDO

    setupEventListeners() {
        document.addEventListener('DOMContentLoaded', () => {
            this.searchInput = document.getElementById('file-search-input');
            this.clearButton = document.getElementById('clear-search');
            this.resultsCounter = document.getElementById('search-results-count');

            if (!this.searchInput || !this.clearButton || !this.resultsCounter) {
                console.warn('Search elements not found in the DOM.');
                return;
            }

            // Search input events
            this.searchInput.addEventListener('input', (e) => {
                this.handleSearchInput(e.target.value);
            });

            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.clearSearch();
                    this.searchInput.blur();
                }
            });

            // Clear button event
            this.clearButton.addEventListener('click', () => {
                this.clearSearch();
                this.searchInput.focus();
            });

            // Update clear button visibility
            this.searchInput.addEventListener('input', () => {
                const wrapper = this.searchInput.closest('.search-input-wrapper');
                if (this.searchInput.value.length > 0) {
                    wrapper.classList.add('has-content');
                } else {
                    wrapper.classList.remove('has-content');
                }
            });

            // Listen for file tree refreshes
            document.addEventListener('refresh-file-tree', () => {
                if (this.isSearchActive) {
                    // Reapply search after tree refresh
                    setTimeout(() => {
                        this.performSearch(this.searchInput.value);
                    }, 100);
                }
            });
        });
    }

    handleSearchInput(query) {
        // Clear previous debounce timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // Debounce search to avoid excessive calls
        this.debounceTimer = setTimeout(() => {
            this.performSearch(query);
        }, 300);
    }

    performSearch(query) {
        const trimmedQuery = query.trim()
            .toLowerCase();

        if (trimmedQuery === '') {
            this.clearSearch();
            return;
        }

        this.isSearchActive = true;
        this.showSearchingState();

        // Get all file tree items
        const fileTreeItems = document.querySelectorAll('.file-tree-item');
        const fileTree = document.getElementById('file-tree');

        if (fileTree) {
            fileTree.classList.add('searching');
        }

        let matchCount = 0;
        const matches = [];

        fileTreeItems.forEach(item => {
            const nameSpan = item.querySelector('.file-item span');
            const filePath = item.getAttribute('data-path');

            if (!nameSpan) return;

            const fileName = nameSpan.textContent.toLowerCase();
            const isMatch = fileName.includes(trimmedQuery) ||
                (filePath && filePath.toLowerCase()
                    .includes(trimmedQuery));

            if (isMatch) {
                item.classList.remove('search-hidden');
                item.classList.add('search-match');
                this.highlightMatchInText(nameSpan, trimmedQuery);
                matchCount++;
                matches.push(item);

                // Show parent folders
                this.showParentFolders(item);
            } else {
                item.classList.add('search-hidden');
                item.classList.remove('search-match');
                this.removeHighlights(nameSpan);
            }
        });

        // Update results counter
        this.updateResultsCounter(matchCount, trimmedQuery);

        // Show empty state if no matches
        if (matchCount === 0) {
            this.showEmptyState(trimmedQuery);
        } else {
            this.hideEmptyState();
        }

        this.hideSearchingState();
        this.searchResults = matches;
    }

    showParentFolders(item) {
        let parent = item.parentElement;
        while (parent && parent.classList.contains('folder-content')) {
            const folderItem = parent.previousElementSibling;
            if (folderItem && folderItem.classList.contains('file-item')) {
                const folderContainer = folderItem.parentElement;
                if (folderContainer) {
                    folderContainer.classList.remove('search-hidden');

                    // Expand parent folder if it's collapsed
                    const folderContent = folderContainer.querySelector('.folder-content');
                    if (folderContent && folderContent.classList.contains('hidden')) {
                        folderContent.classList.remove('hidden');
                        const toggleIcon = folderItem.querySelector('.folder-toggle');
                        const folderIcon = folderItem.querySelector('.file-item-icon');
                        if (toggleIcon) toggleIcon.classList.add('rotated');
                        if (folderIcon) {
                            folderIcon.classList.remove('fa-folder');
                            folderIcon.classList.add('fa-folder-open');
                        }
                    }
                }
            }
            parent = parent.parentElement?.parentElement;
        }
    }

    highlightMatchInText(element, query) {
        const originalText = element.getAttribute('data-original-text') || element.textContent;
        element.setAttribute('data-original-text', originalText);

        const regex = new RegExp(`(${this.escapeRegExp(query)})`, 'gi');
        const highlightedText = originalText.replace(regex, '<span class="search-highlight">$1</span>');
        element.innerHTML = highlightedText;
    }

    removeHighlights(element) {
        const originalText = element.getAttribute('data-original-text');
        if (originalText) {
            element.textContent = originalText;
            element.removeAttribute('data-original-text');
        }
    }

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    showSearchingState() {
        const wrapper = this.searchInput.closest('.search-input-wrapper');
        if (wrapper) {
            wrapper.classList.add('searching');
        }
    }

    hideSearchingState() {
        const wrapper = this.searchInput.closest('.search-input-wrapper');
        if (wrapper) {
            wrapper.classList.remove('searching');
        }
    }

    updateResultsCounter(count, query) {
        if (!this.resultsCounter) return;

        this.resultsCounter.parentElement.classList.add('active');

        if (count === 0) {
            this.resultsCounter.textContent = `No results for "${query}"`;
        } else if (count === 1) {
            this.resultsCounter.textContent = `1 file found`;
        } else {
            this.resultsCounter.textContent = `${count} files found`;
        }
    }

    showEmptyState(query) {
        this.hideEmptyState();

        const fileTree = document.getElementById('file-tree');
        if (!fileTree) return;

        const emptyState = document.createElement('div');
        emptyState.className = 'search-empty-state';
        emptyState.innerHTML = `
      <i class="fa-solid fa-magnifying-glass"></i>
      <div>No files found matching "${query}"</div>
    `;

        fileTree.appendChild(emptyState);
    }

    hideEmptyState() {
        const emptyState = document.querySelector('.search-empty-state');
        if (emptyState) {
            emptyState.remove();
        }
    }

    clearSearch() {
        this.isSearchActive = false;

        if (this.searchInput) {
            this.searchInput.value = '';
            const wrapper = this.searchInput.closest('.search-input-wrapper');
            if (wrapper) {
                wrapper.classList.remove('has-content', 'searching');
            }
        }

        // Remove all search classes and restore original state
        const fileTreeItems = document.querySelectorAll('.file-tree-item');
        fileTreeItems.forEach(item => {
            item.classList.remove('search-hidden', 'search-match');
            const nameSpan = item.querySelector('.file-item span');
            if (nameSpan) {
                this.removeHighlights(nameSpan);
            }
        });

        const fileTree = document.getElementById('file-tree');
        if (fileTree) {
            fileTree.classList.remove('searching');
        }

        // Clear results counter
        if (this.resultsCounter) {
            this.resultsCounter.textContent = '';
            this.resultsCounter.parentElement.classList.remove('active');
        }

        // Hide empty state
        this.hideEmptyState();

        // Clear search results
        this.searchResults = [];
    }

    // Public API methods
    focusSearch() {
        if (this.searchInput) {
            this.searchInput.focus();
        }
    }

    getSearchResults() {
        return this.searchResults;
    }

    isSearching() {
        return this.isSearchActive;
    }
}

// Initialize the search system
const fileSearchSystem = new FileTreeSearch();
// Add keyboard shortcut (Ctrl+F or Cmd+F)
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        fileSearchSystem.focusSearch();
    }
});

// Export for use in other modules if needed
window.FileTreeSearch = fileSearchSystem;

// Directory watcher management
class DirectoryWatcher {
    constructor() {
        this.currentWatchedDirectory = null;
        this.isWatching = false;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Listen for directory changes
        window.electronAPI.onDirectoryChanged((directoryPath, files) => {
            if (directoryPath === this.currentWatchedDirectory) {
                console.log('Directory changed, refreshing file tree');
                this.updateFileTreeFromFiles(files);
            }
        });

        // Listen for watcher errors
        window.electronAPI.onDirectoryWatcherError((directoryPath, error) => {
            console.error(`Directory watcher error for ${directoryPath}:`, error);
            // Attempt to restart watching after a delay
            setTimeout(() => {
                this.startWatching(directoryPath);
            }, 2000);
        });
    }

    async startWatching(directoryPath) {
        try {
            // Stop watching previous directory if any
            await this.stopWatching();

            if (!directoryPath) {
                console.warn('No directory path provided for watching');
                return;
            }

            console.log(`Starting to watch directory: ${directoryPath}`);

            const watcherId = await window.electronAPI.watchDirectory(directoryPath);
            this.currentWatchedDirectory = directoryPath;
            this.isWatching = true;

            console.log(`Directory watcher started with ID: ${watcherId}`);
        } catch (error) {
            console.error('Failed to start directory watching:', error);
            this.isWatching = false;
        }
    }

    async stopWatching() {
        if (this.currentWatchedDirectory && this.isWatching) {
            try {
                console.log(`Stopping directory watcher for: ${this.currentWatchedDirectory}`);
                await window.electronAPI.stopWatchingDirectory(this.currentWatchedDirectory);
                this.currentWatchedDirectory = null;
                this.isWatching = false;
            } catch (error) {
                console.error('Failed to stop directory watching:', error);
            }
        }
    }

    updateFileTreeFromFiles(files) {
        try {
            // Update the file tree with new structure
            updateFileTree(files);

            // Dispatch custom event to notify other components
            document.dispatchEvent(new CustomEvent('refresh-file-tree'));

            // If search is active, reapply search
            if (window.FileTreeSearch && window.FileTreeSearch.isSearching()) {
                setTimeout(() => {
                    const searchInput = document.getElementById('file-search-input');
                    if (searchInput && searchInput.value) {
                        window.FileTreeSearch.performSearch(searchInput.value);
                    }
                }, 100);
            }
        } catch (error) {
            console.error('Error updating file tree from watcher:', error);
        }
    }

    getCurrentWatchedDirectory() {
        return this.currentWatchedDirectory;
    }

    isCurrentlyWatching() {
        return this.isWatching;
    }
}

// Initialize directory watcher
const directoryWatcher = new DirectoryWatcher();

// Update your existing loadProject function to start watching
async function loadProject(spfPath) {
    try {
        const result = await window.electronAPI.openProject(spfPath);
        currentProjectPath = result.projectData.structure.basePath;

        console.log('Loading project from SPF:', spfPath);

        // Store both paths
        currentProjectPath = result.projectData.structure.basePath;
        currentSpfPath = spfPath;

        updateProjectNameUI(result.projectData);
        await TabManager.closeAllTabs();

        console.log('Current SPF path:', currentSpfPath);
        console.log('Current project path:', currentProjectPath);

        // Enable the processor hub button
        enableCompileButtons();
        refreshFileTree();

        // Start watching project directory
        await directoryWatcher.startWatching(currentProjectPath);

        // Check if folders exist
        const missingFolders = result.projectData.structure.folders.filter(folder => !folder.exists);
        if (missingFolders.length > 0) {
            const shouldRecreate = await showConfirmDialog(
                'Missing Folders', 'Some project folders are missing. Would you like to recreate them?'
            );

            if (shouldRecreate) {
                const newResult = await window.electronAPI.createStructure(
                    result.projectData.structure.basePath, spfPath
                );
                updateFileTree(newResult.files);
                await TabManager.closeAllTabs();
            } else {
                updateFileTree(result.files);
            }
        } else {
            updateFileTree(result.files);
        }
        addToRecentProjects(currentSpfPath);

    } catch (error) {
        console.error('Error loading project:', error);
        showCardNotification(`Error loading project: ${error.message}'`, 'error', 3000);
    }
}

// Clean up watcher when closing project or app
window.addEventListener('beforeunload', async () => {
    await directoryWatcher.stopWatching();
    window.electronAPI.removeDirectoryListeners();
});

// Export for global access
window.DirectoryWatcher = directoryWatcher;

//PROJECTBUTTON ======================================================================================================================================================== ƒ

let currentProjectPath = null; // Store the current project path
let currentSpfPath = null;

// Adicionar listener para mudanças no estado do projeto
window.electronAPI.onProjectStateChange((event, {
    projectPath,
    spfPath
}) => {
    currentProjectPath = projectPath;
    currentSpfPath = spfPath;

    // Atualizar o nome do projeto quando o estado mudar
    const projectName = path.basename(projectPath);
    updateProjectNameUI({
        metadata: {
            projectName: projectName
        }
    });
});


document.getElementById('open-folder-button')
    .addEventListener('click', async () => {
        if (currentProjectPath) {
            try {
                await window.electronAPI.openFolder(currentProjectPath);
            } catch (error) {
                console.error('Error opening folder:', error);
            }
        }
    });

document.getElementById('open-hdl-button')
    .addEventListener('click', async () => {
        const hdlDir = await window.electronAPI.joinPath('saphoComponents', 'HDL');
        if (hdlDir) {
            try {
                await window.electronAPI.openFolder(hdlDir);
            } catch (error) {
                console.error('Error opening HDL folder:', error);
            }
        }
    });

document.addEventListener('keydown', (event) => {
    if (event.key === 'F2' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        if (currentProjectPath) {
            try {
                window.electronAPI.openFolder(currentProjectPath);
            } catch (error) {
                console.error('Error opening folder:', error);
            }
        }
    }
});

// Função para atualizar o nome do projeto na UI
function updateProjectNameUI(projectData) {
    const spfNameElement = document.getElementById('current-spf-name');
    if (projectData && projectData.metadata && projectData.metadata.projectName) {
        const projectName = `${projectData.metadata.projectName}.spf`;
        console.log('Updating project name to:', projectName);
        spfNameElement.textContent = projectName;
    } else {
        console.log('No project data available');
        spfNameElement.textContent = 'No project open';
    }
}

// Modified event listener for opening a project
document.getElementById('openProjectBtn')
    .addEventListener('click', async () => {
        try {
            const result = await window.electronAPI.showOpenDialog();

            if (!result.canceled && result.filePaths.length > 0) {
                // Close all open tabs before loading the new project
                await TabManager.closeAllTabs();

                currentProjectPath = result.filePaths[0];
                currentSpfPath = `${currentProjectPath}.spf`;

                await loadProject(currentProjectPath);
                // Atualiza o nome do projeto na interface
                const projectName = window.electronAPI.getBasename(currentProjectPath);
                updateProjectNameUI({
                    metadata: {
                        projectName: projectName
                    }
                });
            }
        } catch (error) {
            console.error('Error opening project:', error);
        }
    });

const projectInfoButton = document.createElement('button');
projectInfoButton.className = 'toolbar-button disabled';
projectInfoButton.id = 'projectInfo';
projectInfoButton.disabled = true; // desabilita o botão
projectInfoButton.style.cursor = 'not-allowed'; // altera o cursor

projectInfoButton.innerHTML = `
  <i class="fa-solid fa-circle-question"></i>
  <span>Project Info</span>
`;

document.getElementById('openProjectBtn')
    .insertAdjacentElement('afterend', projectInfoButton);

// Atualize esta função no seu renderer.js para usar openProject em vez de loadProject
window.electronAPI.onSimulateOpenProject(async (result) => {
    try {
        if (!result.canceled && result.filePaths.length > 0) {
            const spfPath = result.filePaths[0];

            // Fechar todas as abas antes de carregar o novo projeto
            if (typeof TabManager !== 'undefined' && TabManager.closeAllTabs) {
                await TabManager.closeAllTabs();
            }

            // Definir o caminho atual
            currentSpfPath = spfPath;

            // Usar openProject em vez de loadProject, conforme sua implementação existente
            await loadProject(spfPath);

            console.log(`Projeto carregado com sucesso!`);
        }
    } catch (error) {
        console.error('Erro ao abrir o projeto:', error);
        showCardNotification(`Error running project: ${error.message}'`, 'error', 3000);

    }
});

// Update project info button handler
projectInfoButton.addEventListener('click', async () => {
    try {
        if (!currentSpfPath) {
            showCardNotification('No project is currently open', 'error', 3000);
            return;
        }

        if (!currentSpfPath.endsWith('.spf')) {
            const projectName = path.basename(currentProjectPath);
            currentSpfPath = path.join(currentProjectPath, `${projectName}.spf`);
        }

        console.log('Getting project info from SPF:', currentSpfPath);
        const projectData = await window.electronAPI.getProjectInfo(currentSpfPath);
        showProjectInfoDialog(projectData);
    } catch (error) {
        console.error('Error getting project info:', error);
        showCardNotification(`Failed to load project information: ${error.message}`, 'error', 3000);

    }
});

function showProjectInfoDialog(projectData) {
    // Create the modal backdrop and container
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'aurora-modal-backdrop';

    const modalContainer = document.createElement('div');
    modalContainer.className = 'aurora-modal-container';

    // Extract project metadata and folder structure
    const metadata = projectData.metadata;
    const folderStructure = projectData.structure.folders;

    // Format timestamps
    const formatDate = (timestamp) => {
        const date = new Date(timestamp);
        return new Intl.DateTimeFormat('default', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
            .format(date);
    };

    // Calculate project age
    const calculateAge = (createdAt) => {
        const created = new Date(createdAt);
        const now = new Date();
        const diffTime = Math.abs(now - created);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 1) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 30) return `${diffDays} days ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        return `${Math.floor(diffDays / 365)} years ago`;
    };

    // Render the modal content
    modalContainer.innerHTML = `
    <div class="aurora-modal">
      <div class="aurora-modal-header">
        <h2 class="aurora-modal-title">Project Information</h2>
        <button class="aurora-modal-close" aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      
      <div class="aurora-modal-body">
        <div class="aurora-modal-section">
          <div class="aurora-modal-section-header">
            <h3>Project Details</h3>
            <div class="aurora-modal-badge">${metadata.appVersion}</div>
          </div>
          
          <div class="aurora-modal-grid">
            <div class="aurora-modal-info-item">
              <div class="aurora-modal-info-label">Project Name</div>
              <div class="aurora-modal-info-value">${metadata.projectName}</div>
            </div>
            
            <div class="aurora-modal-info-item">
              <div class="aurora-modal-info-label">Created</div>
              <div class="aurora-modal-info-value" title="${formatDate(metadata.createdAt)}">
                ${calculateAge(metadata.createdAt)}
              </div>
            </div>
            
            <div class="aurora-modal-info-item">
              <div class="aurora-modal-info-label">Last Modified</div>
              <div class="aurora-modal-info-value" title="${formatDate(metadata.lastModified)}">
                ${calculateAge(metadata.lastModified)}
              </div>
            </div>
            
            <div class="aurora-modal-info-item">
              <div class="aurora-modal-info-label">Computer</div>
              <div class="aurora-modal-info-value">${metadata.computerName}</div>
            </div>
          </div>
        </div>

        
        <div class="aurora-modal-section">
          <div class="aurora-modal-section-header">
            <h3>System Information</h3>
          </div>
          
          <div class="aurora-modal-grid">
            <div class="aurora-modal-info-item">
              <div class="aurora-modal-info-label">App Version</div>
              <div class="aurora-modal-info-value">${metadata.appVersion}</div>
            </div>
            
            <div class="aurora-modal-info-item">
              <div class="aurora-modal-info-label">Operating System</div>
              <div class="aurora-modal-info-value" id="aurora-os-info">Loading...</div>
            </div>
            
            <div class="aurora-modal-info-item">
              <div class="aurora-modal-info-label">Node Version</div>
              <div class="aurora-modal-info-value" id="aurora-node-version">Loading...</div>
            </div>
            
            <div class="aurora-modal-info-item">
              <div class="aurora-modal-info-label">Electron Version</div>
              <div class="aurora-modal-info-value" id="aurora-electron-version">Loading...</div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="aurora-modal-footer">
        <button class="aurora-modal-button aurora-modal-button-primary">Close</button>
      </div>
    </div>
  `;

    // Append the modal to the document body
    document.body.appendChild(modalBackdrop);
    document.body.appendChild(modalContainer);

    // Function to update the file structure display
    const updateFileStructureDisplay = (fileStructure) => {
        const structureContainer = document.getElementById('project-structure');
        if (!structureContainer) return;

        // Clear loading indicator
        structureContainer.innerHTML = '';

        if (!fileStructure) {
            structureContainer.innerHTML = '<div class="aurora-modal-empty-state">No file structure data available</div>';
            return;
        }

        // Check if fileStructure is an array
        if (!Array.isArray(fileStructure)) {
            console.error('Expected array for file structure but received:', typeof fileStructure, fileStructure);

            // If it's an object with properties, try to convert it to array
            if (typeof fileStructure === 'object' && fileStructure !== null) {
                // Try to convert object to array if possible
                try {
                    if (Object.keys(fileStructure)
                        .length > 0) {
                        const fileArray = Object.values(fileStructure);
                        if (Array.isArray(fileArray)) {
                            fileStructure = fileArray;
                        } else {
                            fileStructure = [fileStructure]; // Make it a single item array
                        }
                    } else {
                        fileStructure = []; // Empty object becomes empty array
                    }
                } catch (e) {
                    fileStructure = [fileStructure]; // Make it a single item array as fallback
                }
            } else {
                fileStructure = []; // Default to empty array if conversion isn't possible
            }
        }

        if (fileStructure.length === 0) {
            structureContainer.innerHTML = '<div class="aurora-modal-empty-state">No files found</div>';
            return;
        }

        // Create a tree structure
        const createTreeItem = (item, level = 0) => {
            // Add defensive checks
            if (!item) return '';

            const isFolder = item.type === 'directory';
            const itemName = item.name || 'Unnamed item';
            const indentation = level * 16; // 16px per level

            return `
        <div class="aurora-modal-file-item" style="padding-left: ${indentation}px">
          <div class="aurora-modal-file-icon ${isFolder ? 'folder' : 'file'}">
            ${isFolder ? 
              `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>` : 
              `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>`
            }
          </div>
          <div class="aurora-modal-file-name">${itemName}</div>
          ${isFolder ? `<div class="aurora-modal-file-count">${item.children && Array.isArray(item.children) ? item.children.length : 0} items</div>` : ''}
        </div>
        ${isFolder && item.children && Array.isArray(item.children) && item.children.length > 0 
          ? item.children.map(child => createTreeItem(child, level + 1)).join('') 
          : ''}
      `;
        };

        try {
            // Render the file structure with error handling
            structureContainer.innerHTML = fileStructure.map(item => createTreeItem(item))
                .join('');
        } catch (error) {
            console.error('Error rendering file structure:', error);
            structureContainer.innerHTML = `<div class="aurora-modal-empty-state">Error rendering files: ${error.message}</div>`;
        }
    };

    // Load system information
    if (window.electronAPI && window.electronAPI.getAppInfo) {
        window.electronAPI.getAppInfo()
            .then((info) => {
                const osInfoElement = document.getElementById('aurora-os-info');
                const nodeVersionElement = document.getElementById('aurora-node-version');
                const electronVersionElement = document.getElementById('aurora-electron-version');

                if (osInfoElement) osInfoElement.textContent = info.osInfo || 'Unknown';
                if (nodeVersionElement) nodeVersionElement.textContent = info.nodeVersion || 'Unknown';
                if (electronVersionElement) electronVersionElement.textContent = info.electronVersion || 'Unknown';
            })
            .catch((error) => {
                // Handle error with more information
                console.error('Failed to get app info:', error);

                const osInfoElement = document.getElementById('aurora-os-info');
                const nodeVersionElement = document.getElementById('aurora-node-version');
                const electronVersionElement = document.getElementById('aurora-electron-version');

                if (osInfoElement) osInfoElement.textContent = 'Error loading';
                if (nodeVersionElement) nodeVersionElement.textContent = 'Error loading';
                if (electronVersionElement) electronVersionElement.textContent = 'Error loading';
            });
    }

    // Add event listeners for closing the modal
    const closeModal = () => {
        modalBackdrop.classList.add('aurora-modal-fade-out');
        modalContainer.classList.add('aurora-modal-fade-out');

        setTimeout(() => {
            document.body.removeChild(modalBackdrop);
            document.body.removeChild(modalContainer);
        }, 300);
    };

    modalBackdrop.addEventListener('click', closeModal);

    modalContainer.querySelector('.aurora-modal-close')
        .addEventListener('click', closeModal);
    modalContainer.querySelector('.aurora-modal-button')
        .addEventListener('click', closeModal);

    modalContainer.querySelector('.aurora-modal')
        .addEventListener('click', (e) => {
            e.stopPropagation();
        });

    // Trigger entrance animation
    setTimeout(() => {
        modalBackdrop.classList.add('aurora-modal-fade-in');
        modalContainer.classList.add('aurora-modal-fade-in');
    }, 10);
}

function enableCompileButtons() {
    const buttons = ['cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp', 'cancel-everything', 'fractalcomp', 'settings', 'importBtn', 'backupFolderBtn', 'projectInfo', 'settings-project'];
    const projectSettingsButton = document.createElement('button');
    projectSettingsButton.disabled = false; // <-- ESSENCIAL

    buttons.forEach(id => {
        const button = document.getElementById(id);
        if (button) {
            button.disabled = false;
            button.style.cursor = 'pointer';
        }
    });
}

// Function to update file tree
function updateFileTree(files) {
    const fileTree = document.getElementById('file-tree');
    fileTree.innerHTML = '';
    renderFileTree(files, fileTree);

    /*
    // Add refresh animation
    fileTree.style.animation = 'refresh-fade 0.5s ease';
    setTimeout(() => {
      fileTree.style.animation = '';
    }, 500);
    */
}

window.addEventListener('DOMContentLoaded', () => {
    const btnExportLog = document.getElementById('export-log');
    if (!btnExportLog) {
        console.warn('Botão export-log não encontrado no DOM');
        return;
    }

    btnExportLog.addEventListener('click', async () => {
        try {
            // Identificar todas as abas de terminal atualmente definidas:
            // Exemplo: botões com classe 'tab' e data-terminal.
            const tabButtons = document.querySelectorAll('.tab[data-terminal]');
            const report = {};

            tabButtons.forEach(tabBtn => {
                const termId = tabBtn.getAttribute('data-terminal'); // e.g., "tcmm", "tasm", etc.
                // No HTML, cada terminal-content tem id="terminal-<termId>"
                const container = document.getElementById(`terminal-${termId}`);
                if (container) {
                    // Dentro de cada terminal-content, há um div.terminal-body
                    const body = container.querySelector('.terminal-body');
                    if (body) {
                        // Captura as linhas atuais exibidas no terminal:
                        // Dependendo de como você injeta as linhas (por innerText, ou <div> por linha), aqui usamos innerText.
                        const text = body.innerText || '';
                        // Opcional: dividir em array de linhas:
                        const lines = text.split('\n')
                            .map(line => line.trimEnd());
                        report[termId] = lines;
                    } else {
                        report[termId] = [];
                    }
                } else {
                    // Se o terminal não existir no DOM (talvez nenhuma aba correspondente): pula ou coloca array vazio
                    report[termId] = [];
                }
            });

            // Agora report é um objeto: { tcmm: [...], tasm: [...], ... }

            // Chama API exposta pelo preload:
            const result = await window.electronAPI.exportLog(report);

            // Notificar o usuário. Você pode usar alert ou outra UI customizada:
            if (result && result.success) {
                // Exemplo simples:
                alert(result.message);
            } else {
                alert('Falha ao exportar log: ' + (result && result.message ? result.message : 'Erro desconhecido'));
            }
        } catch (err) {
            console.error('Erro no handler export-log:', err);
            alert('Erro ao exportar log: ' + err.message);
        }
    });
});

// BUTTONS      ======================================================================================================================================================== ƒ

// Event listener para abrir o site no navegador padrão
const websiteLink = document.getElementById('websiteLink');
if (websiteLink) {
    websiteLink.addEventListener('click', () => {
        window.electronAPI.openExternal('https://nipscern.com'); // Abra o navegador padrão
    });
}

// Selecionar elementos do modal
const showInfoButton = document.getElementById('showInfo'); // Botão para abrir o modal
const infoBox = document.getElementById('infoBox'); // O próprio modal
const closeInfoButton = document.querySelector('.info-box-close'); // Botão de fechar

// Função para abrir o modal
function openInfoBox() {
    infoBox.classList.remove('hidden'); // Remove a classe que esconde o modal
    infoBox.classList.add('visible'); // Adiciona a classe que exibe o modal
}

// Função para fechar o modal
function closeInfoBox() {
    infoBox.classList.remove('visible'); // Remove a classe de visibilidade
    infoBox.classList.add('hidden'); // Adiciona a classe que esconde o modal
}

// Event listener para abrir o modal ao clicar no botão
if (showInfoButton) {
    showInfoButton.addEventListener('click', (event) => {
        event.preventDefault(); // Prevenir comportamentos inesperados
        openInfoBox();
    });
}

// Event listener para fechar o modal ao clicar no botão "x"
if (closeInfoButton) {
    closeInfoButton.addEventListener('click', (event) => {
        event.preventDefault();
        closeInfoBox();
    });
}


// Toggle function to show/hide assistant
function toggleAIAssistant() {
    if (!window.aiAssistantContainer) {
        initAIAssistant();
        return;
    }

    const container = aiAssistantContainer;
    const backdrop = document.getElementById('ai-assistant-backdrop');

    if (container.classList.contains('open')) {
        container.classList.remove('open');
        backdrop.classList.remove('open');
        document.body.style.overflow = '';
    } else {
        container.classList.add('open');
        backdrop.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

// Initialize assistant structure (hidden by default)
function initAIAssistant() {
    // Inject modern styles using CSS root variables
    if (!document.getElementById('ai-assistant-styles')) {
        const style = document.createElement('style');
        style.id = 'ai-assistant-styles';
        style.textContent = `
     
    `;
        document.head.appendChild(style);
    }

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'ai-assistant-backdrop';
    backdrop.className = 'ai-assistant-backdrop';
    backdrop.addEventListener('click', toggleAIAssistant);
    document.body.appendChild(backdrop);

    // Main container
    aiAssistantContainer = document.createElement('div');
    aiAssistantContainer.className = 'ai-assistant-container';

    // Header
    const header = document.createElement('div');
    header.className = 'ai-assistant-header';
    header.innerHTML = `
    <div class="ai-header-left">
      <img style="width:30px" src="./assets/icons/ai_gemini.webp" 
           alt="AI Toggle"
           class="ai-toggle-icon"
           onclick="toggleAIAssistant()">
      <h3 class="ai-assistant-title">AI Assistant</h3>
      <div class="ai-provider-section">
        <img id="ai-provider-icon" 
             src="./assets/icons/ai_chatgpt.svg"
             alt="Provider Icon" 
             class="ai-provider-icon">
        <select id="ai-provider-select" class="ai-provider-select">
          <option value="chatgpt">ChatGPT</option>
          <option value="claude">Claude</option>
          <option value="gemini">Gemini</option>
          <option value="deepseek">DeepSeek</option>
        </select>
      </div>
    </div>
    <button class="ai-assistant-close" aria-label="Close AI Assistant">
      <i class="fas fa-times"></i>
    </button>
  `;

    // Content area with loading state
    const contentContainer = document.createElement('div');
    contentContainer.className = 'ai-assistant-content';

    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'ai-loading-overlay';
    loadingOverlay.innerHTML = `
    <div class="ai-loading-spinner"></div>
    <div class="ai-loading-text">Loading AI Assistant...</div>
  `;

    const webview = document.createElement('webview');
    webview.className = 'ai-assistant-webview';
    webview.src = 'https://chatgpt.com/?model=auto';
    webview.nodeintegration = 'false';
    webview.webSecurity = 'true';

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'ai-resize-handle';

    contentContainer.appendChild(loadingOverlay);
    contentContainer.appendChild(webview);
    contentContainer.appendChild(resizeHandle);

    // Assemble components
    aiAssistantContainer.appendChild(header);
    aiAssistantContainer.appendChild(contentContainer);
    document.body.appendChild(aiAssistantContainer);

    // Event listeners
    const closeButton = header.querySelector('.ai-assistant-close');
    closeButton.addEventListener('click', toggleAIAssistant);

    // Provider selection
    const providerSelect = header.querySelector('#ai-provider-select');
    const providerIcon = header.querySelector('#ai-provider-icon');

    providerSelect.addEventListener('change', (e) => {
        currentProvider = e.target.value;

        // Show loading
        loadingOverlay.style.opacity = '1';
        loadingOverlay.style.visibility = 'visible';

        // Fade out icon
        providerIcon.style.opacity = '0';

        const urlMap = {
            chatgpt: 'https://chatgpt.com/?model=auto',
            claude: 'https://claude.ai',
            gemini: 'https://gemini.google.com/',
            deepseek: 'https://www.deepseek.com/'
        };

        const iconMap = {
            chatgpt: './assets/icons/ai_chatgpt.svg',
            gemini: './assets/icons/ai_gemini.webp',
            claude: './assets/icons/ai_claude.svg',
            deepseek: './assets/icons/ai_deepseek.svg'
        };

        // Update webview source
        webview.src = urlMap[currentProvider] || urlMap.chatgpt;

        // Update icon with fade in effect
        setTimeout(() => {
            providerIcon.src = iconMap[currentProvider] || iconMap.chatgpt;
            providerIcon.onload = () => {
                providerIcon.style.opacity = '1';
            };
        }, 150);
    });

    // Webview load event
    webview.addEventListener('dom-ready', () => {
        setTimeout(() => {
            loadingOverlay.style.opacity = '0';
            loadingOverlay.style.visibility = 'hidden';
        }, 500);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // ESC to close
        if (e.key === 'Escape' && aiAssistantContainer.classList.contains('open')) {
            toggleAIAssistant();
        }

        // Ctrl/Cmd + K to toggle
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            toggleAIAssistant();
        }
    });

    // Basic resize functionality
    setupResizeHandle(resizeHandle, aiAssistantContainer);

    // Store reference globally
    window.aiAssistantContainer = aiAssistantContainer;
}

// Resize functionality
function setupResizeHandle(handle, container) {
    let isResizing = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', initResize);

    function initResize(e) {
        isResizing = true;
        startX = e.clientX;
        startWidth = parseInt(document.defaultView.getComputedStyle(container)
            .width, 10);

        // Adicionar listeners no document
        document.addEventListener('mousemove', handleResize, {
            passive: false
        });
        document.addEventListener('mouseup', stopResize, {
            once: true
        });
        document.addEventListener('mouseleave', stopResize, {
            once: true
        });

        document.body.style.userSelect = 'none';
        document.body.style.pointerEvents = 'none';
        handle.style.pointerEvents = 'auto';

        e.preventDefault();
        e.stopPropagation();
    }

    function handleResize(e) {
        if (!isResizing) return;

        // Calcular nova largura (movimento para esquerda aumenta)
        const width = startWidth + (startX - e.clientX);

        // Limites de tamanho
        const minWidth = 320;
        const maxWidth = Math.min(window.innerWidth * 0.8, 800);

        const newWidth = Math.max(minWidth, Math.min(width, maxWidth));
        container.style.width = newWidth + 'px';

        e.preventDefault();
        e.stopPropagation();
    }

    function stopResize(e) {
        if (!isResizing) return;

        isResizing = false;

        // Remover listeners
        document.removeEventListener('mousemove', handleResize);
        document.removeEventListener('mouseup', stopResize);
        document.removeEventListener('mouseleave', stopResize);

        // Restaurar estilos
        document.body.style.userSelect = '';
        document.body.style.pointerEvents = '';
        handle.style.pointerEvents = '';

        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
}

// Auto-bind toggle to global scope
window.toggleAIAssistant = toggleAIAssistant;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure all assets are loaded
    setTimeout(() => {
        initAIAssistant();
    }, 100);
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        toggleAIAssistant,
        initAIAssistant
    };
}

document.addEventListener('DOMContentLoaded', () => {
    // Configurar o evento de clique no botão verilog-block
    const verilogBlockBtn = document.getElementById('verilog-block');
    if (verilogBlockBtn) {
        verilogBlockBtn.addEventListener('click', () => {
            // Mostrar o modal - sem verificação de arquivo .v
            const modal = document.getElementById('verilog-block-modal');
            if (modal) {
                modal.style.display = 'flex';
                setTimeout(() => {
                    modal.classList.add('show');
                    const searchBox = document.getElementById('block-search');
                    if (searchBox) searchBox.focus();
                }, 10);
            }
        });
    }

    // Configurar o botão de fechar modal
    const closeModalBtn = document.getElementById('close-modal');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            const modal = document.getElementById('verilog-block-modal');
            if (modal) {
                modal.classList.remove('show');
                setTimeout(() => {
                    modal.style.display = 'none';
                }, 300);
            }
        });
    }

    // Fechar modal com ESC ou clicando fora
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('verilog-block-modal');
        if (event.target === modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            const modal = document.getElementById('verilog-block-modal');
            if (modal && modal.style.display === 'flex') {
                modal.classList.remove('show');
                setTimeout(() => {
                    modal.style.display = 'none';
                }, 300);
            }
        }
    });
});

function setupAIAssistantResize(resizer) {
    let isResizing = false;
    let startX, startWidth;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault(); // ESSENCIAL!
        isResizing = true;
        startX = e.clientX;
        startWidth = parseInt(window.getComputedStyle(aiAssistantContainer)
            .width, 10);

        // Desativa o pointer no webview (porque ele "bloqueia" mousemove/mouseup)
        aiAssistantContainer.querySelector('webview')
            .style.pointerEvents = 'none';

        document.body.style.cursor = 'ew-resize';
    });

    function onMouseMove(e) {
        if (!isResizing) return;
        const newWidth = startWidth - (e.clientX - startX);
        aiAssistantContainer.style.width = `${Math.max(240, newWidth)}px`;
    }

    function onMouseUp() {
        if (isResizing) {
            isResizing = false;
            aiAssistantContainer.querySelector('webview')
                .style.pointerEvents = 'auto';
            document.body.style.cursor = '';
        }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}


document.addEventListener('DOMContentLoaded', () => {
    const refreshButton = document.getElementById('refresh-button');

    if (refreshButton) {
        refreshButton.addEventListener('click', async () => {
            // Add spinning animation
            refreshButton.classList.add('spinning');

            // Disable the button temporarily
            refreshButton.style.pointerEvents = 'none';

            await refreshFileTree();

            // Remove spinning animation and re-enable button
            setTimeout(() => {
                refreshButton.classList.remove('spinning');
                refreshButton.style.pointerEvents = 'auto';
            }, 300);
        });
    }
});

//COMP          ======================================================================================================================================================== ƒ

class CompilationModule {
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.config = null;
        this.projectConfig = null;
        this.terminalManager = new TerminalManager();
        this.isProjectOriented = false;
    }

    async loadConfig() {
        try {
            const toggleButton = document.getElementById('toggle-ui');
            this.isProjectOriented = toggleButton && toggleButton.classList.contains('active');

            const projectInfo = await window.electronAPI.getCurrentProject();
            const currentProjectPath = projectInfo.projectPath || this.projectPath;

            if (!currentProjectPath) {
                throw new Error('No current project path available for loading configuration');
            }

            const configFilePath = await window.electronAPI.joinPath(currentProjectPath, 'processorConfig.json');
            const config = await window.electronAPI.loadConfigFromPath(configFilePath);
            this.config = config;
            console.log("Processor config loaded:", config);

            if (this.isProjectOriented) {
                const projectConfigPath = await window.electronAPI.joinPath(currentProjectPath, 'projectOriented.json');
                const projectConfigData = await window.electronAPI.readFile(projectConfigPath);
                this.projectConfig = JSON.parse(projectConfigData);
                console.log("Project config loaded:", this.projectConfig);
            }
        } catch (error) {
            console.error("Failed to load configuration:", error);
            throw error;
        }
    }

    async ensureDirectories(name) {
        try {
            const saphoComponentsDir = await window.electronAPI.joinPath('saphoComponents');
            await window.electronAPI.mkdir(saphoComponentsDir);
            const tempBaseDir = await window.electronAPI.joinPath('saphoComponents', 'Temp');
            await window.electronAPI.mkdir(tempBaseDir);
            const tempProcessorDir = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
            await window.electronAPI.mkdir(tempProcessorDir);
            const scriptsPath = await window.electronAPI.joinPath('saphoComponents', 'Scripts', 'fix.vcd');
            const destPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name, 'fix.vcd');
            await window.electronAPI.copyFile(scriptsPath, destPath);
            return tempProcessorDir;
        } catch (error) {
            console.error("Failed to ensure directories:", error);
            throw error;
        }
    }

    async getSelectedCmmFile(processor) {
        let selectedCmmFile = null;
        if (this.config && this.config.selectedCmmFile) {
            selectedCmmFile = this.config.selectedCmmFile;
        } else if (processor.cmmFile) {
            selectedCmmFile = processor.cmmFile;
        } else {
            throw new Error('No C± file selected. Please select one to compile.');
        }
        return selectedCmmFile;
    }

    async getTestbenchInfo(processor, cmmBaseName) {
        let tbModule, tbFile;
        const testbenchFilePath = processor.testbenchFile;

        if (testbenchFilePath && testbenchFilePath !== 'standard') {
            if (this.isProjectOriented) {
                // Project mode - use the path as is
                tbFile = testbenchFilePath;
            } else {
                // Processor mode - testbenchFilePath is just the filename
                const simulationPath = await window.electronAPI.joinPath(this.projectPath, processor.name, 'Simulation');
                tbFile = await window.electronAPI.joinPath(simulationPath, testbenchFilePath);
            }
            // Extract just the filename from the path to get the module name
            const tbFileName = testbenchFilePath.split(/[\\\/]/)
                .pop();
            tbModule = tbFileName.replace(/\.v$/i, '');
        } else {
            tbModule = `${cmmBaseName}_tb`;
            const simulationPath = await window.electronAPI.joinPath(this.projectPath, processor.name, 'Simulation');
            tbFile = await window.electronAPI.joinPath(simulationPath, `${tbModule}.v`);
        }

        return {
            tbModule,
            tbFile
        };
    }

    async modifyTestbenchForSimulation(testbenchPath, tbModuleName, tempBaseDir, simuDelay = "200000") {
        try {
            const originalContent = await window.electronAPI.readFile(testbenchPath, {
                encoding: 'utf8'
            });
            const blockRegex = /(\s*integer\s+progress,\s+chrys;[\s\S]*?\$finish;\s*end)/im;
            const fixedTempBaseDir = tempBaseDir.replace(/\//g, '\\\\')
                .replace(/\\/g, '\\\\');
            const numericSimuDelay = parseFloat(simuDelay) || 200000.0;

            const newSimulationCode = `

integer progress, chrys;
initial begin
    $dumpfile("${tbModuleName}.vcd");
    $dumpvars(0, ${tbModuleName});
    progress = $fopen("${fixedTempBaseDir}\\\\progress.txt", "w");
    for (chrys = 10; chrys <= 100; chrys = chrys + 10) begin
        #${numericSimuDelay};
        $fdisplay(progress,"%0d",chrys);
        $fflush(progress);
    end
    $fclose(progress);
    $finish;
end`;

            const existingBlockMatch = originalContent.match(blockRegex);
            let modifiedContent = originalContent;
            let needsWrite = false;

            if (existingBlockMatch) {
                const existingBlock = existingBlockMatch[0];
                const delayRegex = /#\s*([\d.]+)/;
                const existingDelayMatch = existingBlock.match(delayRegex);
                let existingDelayValue = null;
                if (existingDelayMatch && existingDelayMatch[1]) {
                    existingDelayValue = parseFloat(existingDelayMatch[1]);
                }
                if (existingDelayValue !== numericSimuDelay) {
                    modifiedContent = originalContent.replace(blockRegex, newSimulationCode);
                    needsWrite = true;
                }
            } else {
                modifiedContent = originalContent.replace(/(\s*endmodule\s*)$/, `${newSimulationCode}\n$1`);
                needsWrite = true;
            }

            if (needsWrite) {
                await window.electronAPI.writeFile(testbenchPath, modifiedContent);
            }
        } catch (error) {
            throw new Error(`Failed to modify testbench: ${error.message}`);
        }
    }

    getSimulationDelay(processor = null) {
        if (this.isProjectOriented && this.projectConfig && this.projectConfig.simuDelay) {
            return this.projectConfig.simuDelay;
        }
        if (!this.isProjectOriented && processor && processor.numClocks) {
            return processor.numClocks;
        }
        return "200000";
    }

    async cmmCompilation(processor) {
        const {name, showArraysInGtkwave} = processor;
        const showArraysFlag = showArraysInGtkwave === 1 ? '1' : '0';
        this.terminalManager.appendToTerminal('tcmm', `Starting C± compilation for ${name}...`);
        try {
            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
            const macrosPath = await window.electronAPI.joinPath('saphoComponents', 'Macros');
            const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
            const cmmCompPath = await window.electronAPI.joinPath('saphoComponents', 'bin', 'cmmcomp.exe');
            const projectPath = await window.electronAPI.joinPath(this.projectPath, name);
            const softwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Software');
            const asmPath = await window.electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);

            await TabManager.saveAllFiles();
            statusUpdater.startCompilation('cmm');

            const cmd = `"${cmmCompPath}" ${selectedCmmFile} ${cmmBaseName} "${projectPath}" "${macrosPath}" "${tempPath}" ${showArraysFlag}`;
            this.terminalManager.appendToTerminal('tcmm', `Executing command: ${cmd}`);

            const result = await window.electronAPI.execCommand(cmd);
            this.terminalManager.processExecutableOutput('tcmm', result);
            await refreshFileTree();

            if (result.code !== 0) {
                statusUpdater.compilationError('cmm', `CMM compilation failed with code ${result.code}`);
                throw new Error(`CMM compilation failed with code ${result.code}`);
            }
            statusUpdater.compilationSuccess('cmm');
            return asmPath;
        } catch (error) {
            this.terminalManager.appendToTerminal('tcmm', `Error: ${error.message}`, 'error');
            statusUpdater.compilationError('cmm', error.message);
            throw error;
        }
    }

    async asmCompilation(processor, projectParam = null) {
        const {
            name,
            clk,
            numClocks
        } = processor;
        this.terminalManager.appendToTerminal('tasm', `Starting ASM compilation process for ${name}...`);

        try {
            const projectPath = await window.electronAPI.joinPath(this.projectPath, name);
            const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
            const appCompPath = await window.electronAPI.joinPath('saphoComponents', 'bin', 'appcomp.exe');
            const asmCompPath = await window.electronAPI.joinPath('saphoComponents', 'bin', 'asmcomp.exe');
            const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
            const softwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Software');
            const asmPath = await window.electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);
            const {
                tbFile
            } = await this.getTestbenchInfo(processor, cmmBaseName);

            statusUpdater.startCompilation('asm');
            await TabManager.saveAllFiles();

            let cmd = `"${appCompPath}" "${asmPath}" "${tempPath}"`;
            this.terminalManager.appendToTerminal('tasm', `Executing ASM Preprocessor: ${cmd}`);
            const appResult = await window.electronAPI.execCommand(cmd);
            this.terminalManager.processExecutableOutput('tasm', appResult);

            if (appResult.code !== 0) {
                statusUpdater.compilationError('asm', `ASM Preprocessor failed with code ${appResult.code}`);
                throw new Error(`ASM Preprocessor failed with code ${appResult.code}`);
            }

            if (projectParam === null) {
                projectParam = this.isProjectOriented ? 1 : 0;
            }

            cmd = `"${asmCompPath}" "${asmPath}" "${projectPath}" "${hdlPath}" "${tempPath}" ${clk || 0} ${numClocks || 0} ${projectParam}`;
            this.terminalManager.appendToTerminal('tasm', `Executing ASM Compiler: ${cmd}`);

            const asmResult = await window.electronAPI.execCommand(cmd);

            this.terminalManager.processExecutableOutput('tasm', asmResult);
            await refreshFileTree();

            if (asmResult.code !== 0) {
                statusUpdater.compilationError('asm', `ASM compilation failed with code ${asmResult.code}`);
                throw new Error(`ASM compilation failed with code ${asmResult.code}`);
            }

            if (!this.isProjectOriented && processor.testbenchFile == 'standard') {
                const tbFileName = tbFile.split(/[\\\/]/)
                    .pop();
                const sourceTestbench = await window.electronAPI.joinPath(tempPath, tbFileName);
                const destinationTestbench = tbFile;

                this.terminalManager.appendToTerminal('tasm', `Copying testbench from "${sourceTestbench}" to "${destinationTestbench}"`);
                await window.electronAPI.copyFile(sourceTestbench, destinationTestbench);
                this.terminalManager.appendToTerminal('tasm', 'Testbench updated in project folder.', 'tips');
            }

            statusUpdater.compilationSuccess('asm');
        } catch (error) {
            this.terminalManager.appendToTerminal('tasm', `Error: ${error.message}`, 'error');
            statusUpdater.compilationError('asm', error.message);
            throw error;
        }
    }

    async iverilogProjectCompilation() {
        this.terminalManager.appendToTerminal('tveri', `Starting Icarus Verilog verification for project...`);
        statusUpdater.startCompilation('verilog');
        try {
            if (!this.projectConfig) {
                throw new Error("Project configuration not loaded");
            }

            const tempBaseDir = await window.electronAPI.joinPath('saphoComponents', 'Temp');
            const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'iverilog.exe');
            const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');

            // Get testbench file (topLevel file in project mode)
            const topLevelFile = this.projectConfig.topLevelFile;
            if (!topLevelFile) {
                throw new Error("No top level file specified in project configuration");
            }

            // Get testbench file (topLevel file in project mode)
            const testbenchFile = this.projectConfig.testbenchFile;
            if (!testbenchFile) {
                throw new Error("No top level file specified in project configuration");
            }

            // Extract top module name from testbench file
            const topLevelFileName = topLevelFile.split(/[\/\\]/)
                .pop();
            const topModuleName = topLevelFileName.replace('.v', '');

            // Extract top module name from testbench file
            const tbFile = testbenchFile;

            // Get synthesizable files
            const synthesizableFiles = this.projectConfig.synthesizableFiles || [];
            if (synthesizableFiles.length === 0) {
                throw new Error("No synthesizable files defined in project configuration");
            }

            // Build list of all synthesizable file paths
            let synthesizableFilePaths = "";
            for (const file of synthesizableFiles) {
                synthesizableFilePaths += `"${file.path}" `;
            }

            // Build list of verilog files to compile from HDL directory
            const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
            const verilogFilesString = verilogFiles
                .map(f => `"${hdlPath}\\${f}"`)
                .join(' ');

            // Get flags
            const flags = this.projectConfig.iverilogFlags || "";

            await TabManager.saveAllFiles();

            // Build the iverilog command for project verification
            const projectName = this.projectPath.split(/[\/\\]/)
                .pop();

            // Fixed: Output path should be properly constructed
            const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, `${projectName}.vvp`);

            // Fixed: Command should change directory to tempBaseDir and use proper output path
            const cmd = `cd "${tempBaseDir}" && "${iveriCompPath}" ${flags} -s ${topModuleName} -tnull ${synthesizableFilePaths} ${verilogFilesString} ${tbFile}`;

            this.terminalManager.appendToTerminal('tveri', `Executing Icarus Verilog verification:\n${cmd}`);

            const result = await window.electronAPI.execCommand(cmd);
            this.terminalManager.processExecutableOutput('tveri', result);

            if (result.stdout) {
                this.terminalManager.appendToTerminal('tveri', result.stdout, 'stdout');
            }
            if (result.stderr) {
                this.terminalManager.appendToTerminal('tveri', result.stderr, 'stderr');
            }

            if (result.code !== 0) {
                statusUpdater.compilationError('verilog', `Icarus Verilog verification failed with code ${result.code}`);
                throw new Error(`Icarus Verilog verification failed with code ${result.code}`);
            }

            this.terminalManager.appendToTerminal('tveri', 'Project Verilog verification completed successfully.', 'success');
            statusUpdater.compilationSuccess('verilog');

            await refreshFileTree();

        } catch (error) {
            this.terminalManager.appendToTerminal('tveri', `Error: ${error.message}`, 'error');
            statusUpdater.compilationError('verilog', error.message);
            throw error;
        }
    }

    // Updated iverilogCompilation method for processor mode
    async iverilogCompilation(processor) {
        if (this.isProjectOriented) {
            return this.iverilogProjectCompilation();
        }

        const {
            name
        } = processor;
        this.terminalManager.appendToTerminal('tveri', `Starting Icarus Verilog compilation for ${name}...`);
        statusUpdater.startCompilation('verilog');

        try {
            const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
            const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
            const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
            const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'iverilog.exe');

            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');

            const {
                tbModule,
                tbFile
            } = await this.getTestbenchInfo(processor, cmmBaseName);

            const tbFilePath = tbFile;
            const flags = this.config.iverilogFlags ? this.config.iverilogFlags.join(' ') : '';

            const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
            const verilogFilesString = verilogFiles
                .map(f => `"${hdlPath}\\${f}"`)
                .join(' ');

            await TabManager.saveAllFiles();

            const outputFile = await window.electronAPI.joinPath(tempPath, `${cmmBaseName}.vvp`);
            const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}.v`);

            const cmd = `"${iveriCompPath}" ${flags} -s ${cmmBaseName} -o "${outputFile}" "${tbFilePath}" "${hardwareFile}" ${verilogFilesString}`;

            this.terminalManager.appendToTerminal('tveri', `Executing Icarus Verilog compilation:\n${cmd}`);

            const result = await window.electronAPI.execCommand(cmd);
            this.terminalManager.processExecutableOutput('tveri', result);

            if (result.stdout) this.terminalManager.appendToTerminal('tveri', result.stdout, 'stdout');
            if (result.stderr) this.terminalManager.appendToTerminal('tveri', result.stderr, 'stderr');

            if (result.code !== 0) {
                statusUpdater.compilationError('verilog', `Icarus Verilog compilation failed with code ${result.code}`);
                throw new Error(`Icarus Verilog compilation failed with code ${result.code}`);
            }

            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_data.mif`), await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_data.mif`)
            );

            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_inst.mif`), await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_inst.mif`)
            );

            this.terminalManager.appendToTerminal('tveri', 'Verilog compilation completed successfully.', 'success');
            statusUpdater.compilationSuccess('verilog');

            await refreshFileTree();

        } catch (error) {
            this.terminalManager.appendToTerminal('tveri', `Error: ${error.message}`, 'error');
            statusUpdater.compilationError('verilog', error.message);
            throw error;
        }
    }

    async runOptimizedVVP(command, workingDir, terminalTag = 'twave') {
  const cardId = `vvp-run-${Date.now()}`;
  let cardContent = [];
  let vvpProcessPid = null;

  const outputListener = (event, payload) => {
    if (payload.type === 'pid') {
      vvpProcessPid = payload.pid;
      cardContent.push(`High-performance VVP started (PID: ${vvpProcessPid})`);
      this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'running');
      if (typeof window !== 'undefined') window.setCurrentVvpPid(vvpProcessPid);
    }
  };

  window.electronAPI.onCommandOutputStream(outputListener);

  try {
    cardContent.push('Starting optimized VVP execution...');
    this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'running');

    const systemInfo = await window.electronAPI.getSystemPerformance();
    cardContent.push(`System: ${systemInfo.cpuCount} cores, ${systemInfo.totalMemory}GB RAM, ${systemInfo.freeMemory}GB free`);
    this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'running');

    if (typeof window !== 'undefined') window.setVvpRunning(true);
    
    // Enhanced VVP command without FST dumper for stability
    const enhancedCommand = command.replace(/\s*-fst\s*/g, ' ');
    const vvpResult = await window.electronAPI.execVvpOptimized(enhancedCommand, workingDir);
    
    if (typeof window !== 'undefined') {
      window.setVvpRunning(false);
      window.setCurrentVvpPid(null);
    }

    this.terminalManager.processExecutableOutput(terminalTag, vvpResult);

    checkCancellation(); 
    if (vvpResult.code !== 0) {
      hideVVPProgress();
      throw new Error(`VVP simulation failed with code ${vvpResult.code}`);
    }

    cardContent.push(`<b>VVP completed successfully using ${vvpResult.performance?.cpuCount || 'N/A'} cores</b>`);
    this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'success');
    
    // Play success sound
    try {
      const audio = new Audio('./assets/audio/audio_compilation.wav');
      audio.play().catch(e => console.log('Could not play success sound:', e));
    } catch (e) {
      console.log('Audio not available:', e);
    }
    
    return vvpResult;

  } catch (error) {
    if (typeof window !== 'undefined') {
      window.setVvpRunning(false);
      window.setCurrentVvpPid(null);
    }
    
    if (error.message === 'Compilation canceled by user') {
      cardContent.push('<b>VVP process terminated due to cancellation.</b>');
      this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'canceled');
    } else {
      cardContent.push(`<b>VVP simulation failed:</b> ${error.message}`);
      this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'error');
    }
    
    throw error;

  } finally {
    window.electronAPI.removeCommandOutputListener(outputListener);
  }
}

async runGtkWave(processor) {
  if (this.isProjectOriented) {
    checkCancellation();
    return this.runProjectGtkWave();
  }
  
  const { name } = processor;
  this.terminalManager.appendToTerminal('twave', `Starting GTKWave for ${name}...`);
  statusUpdater.startCompilation('wave');
  
  let testbenchBackupInfo = null;
  let vvpFinishedHandler = null;
  let gtkwaveOutputHandler = null;

  try {
    // Setup paths and configuration
    const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
    const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
    const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
    const simulationPath = await window.electronAPI.joinPath(this.projectPath, name, 'Simulation');
    const scriptsPath = await window.electronAPI.joinPath('saphoComponents', 'Scripts');
    const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'iverilog.exe');
    const vvpCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'vvp.exe');
    const gtkwCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'gtkwave', 'bin', 'gtkwave.exe');
    
    const selectedCmmFile = await this.getSelectedCmmFile(processor);
    const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
    const { tbModule, tbFile } = await this.getTestbenchInfo(processor, cmmBaseName);

    if (processor.testbenchFile && processor.testbenchFile !== 'standard') {
      const simuDelay = this.getSimulationDelay(processor);
      testbenchBackupInfo = await this.modifyTestbenchForSimulation(tbFile, tbModule, tempPath, simuDelay);
    }

    // Icarus Verilog compilation
    await TabManager.saveAllFiles();
    const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
    const verilogFilesString = verilogFiles.join(' ');
    const outputFile = await window.electronAPI.joinPath(tempPath, `${cmmBaseName}.vvp`);
    const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}.v`);
    const iverilogCmd = `cd "${hdlPath}" && "${iveriCompPath}" -s ${tbModule} -o "${outputFile}" "${tbFile}" "${hardwareFile}" ${verilogFilesString}`;
    
    const iverilogResult = await window.electronAPI.execCommand(iverilogCmd);
    this.terminalManager.processExecutableOutput('twave', iverilogResult);
    
    if (iverilogResult.code !== 0) {
      throw new Error('Icarus Verilog compilation failed');
    }

    // Copy memory files
    const dataMemSource = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_data.mif`);
    await window.electronAPI.copyFile(dataMemSource, await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_data.mif`));
    
    const instMemSource = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_inst.mif`);
    await window.electronAPI.copyFile(instMemSource, await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_inst.mif`));

    // Setup VCD path and commands
    const vcdPath = await window.electronAPI.joinPath(tempPath, `${tbModule}.vcd`);
    await window.electronAPI.deleteFileOrDirectory(vcdPath);

    // Enhanced VVP command without FST for stability
    const vvpCmd = `"${vvpCompPath}" "${cmmBaseName}.vvp"`;
    
    const useStandardGtkw = !processor.gtkwFile || processor.gtkwFile === 'standard';
    let gtkwCmd;
    
    if (useStandardGtkw) {
      const scriptPath = await window.electronAPI.joinPath(scriptsPath, 'gtk_proc_init.tcl');
      gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --dark "${vcdPath}" --script="${scriptPath}"`;
    } else {
      const gtkwPath = await window.electronAPI.joinPath(simulationPath, processor.gtkwFile);
      const posScript = await window.electronAPI.joinPath(scriptsPath, 'pos_gtkw.tcl');
      gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --dark "${gtkwPath}" --script="${posScript}"`;
    }

    // Setup GTKWave output handler
    gtkwaveOutputHandler = (event, payload) => {
      switch (payload.type) {
        case 'stdout':
        case 'stderr':
          if (payload.data.trim()) {
            this.terminalManager.processStreamedLine('twave', payload.data.trim());
          }
          break;
        case 'completion':
          this.terminalManager.appendToTerminal('twave', payload.message, 
            payload.code === 0 ? 'success' : 'warning');
          break;
        case 'error':
          this.terminalManager.appendToTerminal('twave', payload.data, 'error');
          break;
      }
    };
    
    window.electronAPI.onGtkwaveOutput(gtkwaveOutputHandler);

    // Show progress and setup completion handler
    await showVVPProgress(String(name));
    
    vvpFinishedHandler = () => hideVVPProgress();
    window.electronAPI.once('vvp-finished', vvpFinishedHandler);

    this.terminalManager.appendToTerminal('twave', 'Starting VVP simulation and waiting for VCD file...');

    // Launch enhanced parallel simulation with output monitoring
    const result = await window.electronAPI.launchParallelSimulation({
      vvpCmd: vvpCmd,
      gtkwCmd: gtkwCmd,
      vcdPath: vcdPath,
      workingDir: tempPath
    });

    if (result.success) {
      this.terminalManager.appendToTerminal('twave', 'GTKWave launched with output monitoring and TCL script execution.', 'success');
    } else {
      hideVVPProgress();
      throw new Error(`Failed to launch parallel simulation: ${result.message}`);
    }

    statusUpdater.compilationSuccess('wave');

  } catch (error) {
    hideVVPProgress();
    this.terminalManager.appendToTerminal('twave', `Error: ${error.message}`, 'error');
    statusUpdater.compilationError('wave', error.message);
    throw error;
    
  } finally {
    if (vvpFinishedHandler) {
      window.electronAPI.removeListener('vvp-finished', vvpFinishedHandler);
    }
    if (gtkwaveOutputHandler) {
      window.electronAPI.removeGtkwaveOutputListener(gtkwaveOutputHandler);
    }
    if (testbenchBackupInfo) {
      await window.electronAPI.restoreOriginalTestbench(testbenchBackupInfo.originalPath, testbenchBackupInfo.backupPath);
    }
  }
}

async runProjectGtkWave() {
  this.terminalManager.appendToTerminal('twave', 'Starting GTKWave for project...');
  statusUpdater.startCompilation('wave');
  
  let testbenchBackupInfo = null;
  let vvpFinishedHandler = null;
  let gtkwaveOutputHandler = null;

  try {
    if (!this.projectConfig) throw new Error("Project configuration not loaded");
    
    // Setup paths
    const tempBaseDir = await window.electronAPI.joinPath('saphoComponents', 'Temp');
    const scriptsPath = await window.electronAPI.joinPath('saphoComponents', 'Scripts');
    const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'iverilog.exe');
    const vvpCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'vvp.exe');
    const gtkwCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'gtkwave', 'bin', 'gtkwave.exe');
    const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
    
    const testbenchFile = this.projectConfig.testbenchFile;
    if (!testbenchFile) throw new Error("No testbench file specified");
    
    const testbenchFileName = testbenchFile.split(/[\/\\]/).pop();
    const tbModule = testbenchFileName.replace(/\.v$/i, '');
    const simuDelay = this.getSimulationDelay();
    
    testbenchBackupInfo = await this.modifyTestbenchForSimulation(testbenchFile, tbModule, tempBaseDir, simuDelay);
    
    // Icarus Verilog compilation
    const synthesizableFilePaths = (this.projectConfig.synthesizableFiles || [])
      .map(file => `"${file.path}"`)
      .join(' ');
    const verilogFilesString = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v']
      .map(f => `"${hdlPath}\\${f}"`)
      .join(' ');
    
    await TabManager.saveAllFiles();
    const projectName = this.projectPath.split(/[\/\\]/).pop();
    const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, projectName);
    
    const iverilogCmd = `cd "${tempBaseDir}" && "${iveriCompPath}" ${this.projectConfig.iverilogFlags || ""} -s ${tbModule} -o "${outputFilePath}" ${synthesizableFilePaths} ${verilogFilesString} "${testbenchFile}"`;
    
    const iverilogResult = await window.electronAPI.execCommand(iverilogCmd);
    this.terminalManager.processExecutableOutput('twave', iverilogResult);
    
    if (iverilogResult.code !== 0) {
      throw new Error('Icarus Verilog compilation failed');
    }

    // Setup VCD and commands
    const vcdPath = await window.electronAPI.joinPath(tempBaseDir, `${tbModule}.vcd`);
    await window.electronAPI.deleteFileOrDirectory(vcdPath);

    const vvpCmd = `"${vvpCompPath}" "${outputFilePath}"`;
    let gtkwCmd;
    
    const gtkwaveFile = this.projectConfig.gtkwaveFile;
    if (gtkwaveFile && gtkwaveFile !== "Standard") {
      const posScriptPath = await window.electronAPI.joinPath(scriptsPath, 'pos_gtkw.tcl');
      gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --dark "${gtkwaveFile}" --script="${posScriptPath}"`;
    } else {
      const initScriptPath = await window.electronAPI.joinPath(scriptsPath, 'gtk_proj_init.tcl');
      gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --dark "${vcdPath}" --script="${initScriptPath}"`;
    }

    // Setup GTKWave output handler
    gtkwaveOutputHandler = (event, payload) => {
      switch (payload.type) {
        case 'stdout':
        case 'stderr':
          if (payload.data.trim()) {
            this.terminalManager.processStreamedLine('twave', payload.data.trim());
          }
          break;
        case 'completion':
          this.terminalManager.appendToTerminal('twave', payload.message, 
            payload.code === 0 ? 'success' : 'warning');
          break;
        case 'error':
          this.terminalManager.appendToTerminal('twave', payload.data, 'error');
          break;
      }
    };
    
    window.electronAPI.onGtkwaveOutput(gtkwaveOutputHandler);

    // Show progress and setup completion handler
    await showVVPProgress(projectName);
    
    vvpFinishedHandler = () => hideVVPProgress();
    window.electronAPI.once('vvp-finished', vvpFinishedHandler);

    this.terminalManager.appendToTerminal('twave', 'Starting VVP simulation and waiting for VCD file...');

    // Launch enhanced parallel simulation with output monitoring
    const result = await window.electronAPI.launchParallelSimulation({
      vvpCmd: vvpCmd,
      gtkwCmd: gtkwCmd,
      vcdPath: vcdPath,
      workingDir: tempBaseDir
    });

    if (result.success) {
      this.terminalManager.appendToTerminal('twave', 'GTKWave launched with output monitoring and TCL script execution.', 'success');
    } else {
      hideVVPProgress();
      throw new Error(`Failed to launch parallel simulation: ${result.message}`);
    }

    statusUpdater.compilationSuccess('wave');

  } catch (error) {
    hideVVPProgress();
    this.terminalManager.appendToTerminal('twave', `Error: ${error.message}`, 'error');
    statusUpdater.compilationError('wave', error.message);
    throw error;
    
  } finally {
    if (vvpFinishedHandler) {
      window.electronAPI.removeListener('vvp-finished', vvpFinishedHandler);
    }
    if (gtkwaveOutputHandler) {
      window.electronAPI.removeGtkwaveOutputListener(gtkwaveOutputHandler);
    }
    if (testbenchBackupInfo) {
      await this.restoreOriginalTestbench(testbenchBackupInfo.originalPath, testbenchBackupInfo.backupPath);
    }
  }
}
    // Generate hierarchy using Yosys
    async generateHierarchyWithYosys(yosysPath, tempBaseDir) {
        this.terminalManager.appendToTerminal('twave', 'Generating hierarchy with Yosys...');

        const projectConfigPath = await window.electronAPI.joinPath(currentProjectPath, 'projectOriented.json');
        const projectConfigData = await window.electronAPI.readFile(projectConfigPath);
        this.projectConfig = JSON.parse(projectConfigData);

        // Get top-level module from project config - extract module name from file path
        const topLevelFile = this.projectConfig.topLevelFile;
        if (!topLevelFile) {
            throw new Error(`No top-level module specified in project configuration`);
        }

        // Extract module name from file path (remove path and extension)
        const topLevelModule = topLevelFile.split(/[\/\\]/)
            .pop()
            .replace(/\.v$/i, '');

        // Prepare Yosys command to generate JSON with correct path
        const jsonOutputPath = await window.electronAPI.joinPath(tempBaseDir, `${topLevelModule}.json`);

        // Create Yosys script content with corrected write_json path
        const yosysScript = `
# Read all synthesizable files
${this.projectConfig.synthesizableFiles.map(file => `read_verilog "${file.path}"`).join('\n')}

# Set hierarchy with top-level module
hierarchy -top ${topLevelModule}

# Convert processes (always blocks, etc.) to netlists
proc

# Generate JSON output with correct path
write_json ${jsonOutputPath}
`;

        const yosysScriptPath = await window.electronAPI.joinPath(tempBaseDir, 'hierarchy_gen.ys');
        await window.electronAPI.writeFile(yosysScriptPath, yosysScript);

        // Execute Yosys command
        const yosysCmd = `cd "${tempBaseDir}" && "${yosysPath}" -s "${yosysScriptPath}"`;

        this.terminalManager.appendToTerminal('twave', `Running Yosys command: ${yosysCmd}`);

        const yosysResult = await window.electronAPI.execCommand(yosysCmd);

        if (yosysResult.stdout) this.terminalManager.appendToTerminal('twave', yosysResult.stdout, 'stdout');
        if (yosysResult.stderr) this.terminalManager.appendToTerminal('twave', yosysResult.stderr, 'stderr');

        if (yosysResult.code !== 0) {
            throw new Error(`Yosys synthesis failed with code ${yosysResult.code}`);
        }

        // Verify JSON file was created
        const jsonExists = await window.electronAPI.fileExists(jsonOutputPath);
        if (!jsonExists) {
            throw new Error(`Yosys JSON output file not generated: ${jsonOutputPath}`);
        }

        // Read and parse the JSON hierarchy
        const jsonContent = await window.electronAPI.readFile(jsonOutputPath, {
            encoding: 'utf8'
        });
        const hierarchyData = JSON.parse(jsonContent);

        // Store hierarchy data for later use
        this.hierarchyData = this.parseYosysHierarchy(hierarchyData, topLevelModule);

        this.terminalManager.appendToTerminal('twave', `Hierarchy generated successfully for top-level module: ${topLevelModule}`, 'success');

        // Enable the hierarchical tree toggle button after successful generation
        this.enableHierarchicalTreeToggle();
    }

    // Function to clean module names
    cleanModuleName(moduleName) {
        // Remove $paramod prefixes and hash suffixes
        let cleanName = moduleName;

        // Handle $paramod patterns
        if (cleanName.startsWith('$paramod')) {
            // Extract the actual module name from $paramod patterns
            if (cleanName.includes('\\\\')) {
                // Pattern: $paramod$hash\\moduleName or $paramod\\moduleName\\params
                const parts = cleanName.split('\\\\');
                if (parts.length >= 2) {
                    cleanName = parts[1];
                    // Remove parameter specifications if present
                    if (cleanName.includes('\\')) {
                        cleanName = cleanName.split('\\')[0];
                    }
                }
            } else if (cleanName.includes('\\')) {
                // Pattern: $paramod\moduleName\params
                const parts = cleanName.split('\\');
                if (parts.length >= 2) {
                    cleanName = parts[1];
                }
            }
        }

        // Remove hash patterns like $747e370037f20148f8b166e3c93decd0b83cff70
        cleanName = cleanName.replace(/\$[a-f0-9]{40,}/g, '');

        // Remove parameter specifications like NUBITS=s32'00000000000000000000000000100000
        cleanName = cleanName.replace(/\\[A-Z_]+=.*$/g, '');

        // Clean up any remaining backslashes or dollar signs at the beginning
        cleanName = cleanName.replace(/^[\\\$]+/, '');

        return cleanName;
    }

    // Parse Yosys JSON hierarchy - Enhanced to capture all dependencies with cleaned names
    parseYosysHierarchy(jsonData, topLevelModule) {
        const modules = jsonData.modules || {};
        const hierarchy = {
            topLevel: topLevelModule,
            modules: {},
            dependencies: new Map(),
            allModules: new Set(),
            cleanNameMap: new Map() // Map original names to clean names
        };

        // First pass: collect all modules and create clean name mapping
        for (const moduleName of Object.keys(modules)) {
            const cleanName = this.cleanModuleName(moduleName);
            hierarchy.allModules.add(moduleName);
            hierarchy.cleanNameMap.set(moduleName, cleanName);
        }

        // Second pass: parse each module and its dependencies
        for (const [moduleName, moduleData] of Object.entries(modules)) {
            const cells = moduleData.cells || {};
            const submodules = [];
            const allDependencies = new Set();

            // Extract all cell instances (both user modules and primitives)
            for (const [cellName, cellData] of Object.entries(cells)) {
                if (cellData.type) {
                    const cleanCellType = this.cleanModuleName(cellData.type);
                    submodules.push({
                        instance: cellName,
                        type: cellData.type,
                        cleanType: cleanCellType,
                        parameters: cellData.parameters || {},
                        isUserModule: hierarchy.allModules.has(cellData.type)
                    });
                    allDependencies.add(cellData.type);
                }
            }

            const cleanModuleName = this.cleanModuleName(moduleName);
            hierarchy.modules[moduleName] = {
                name: moduleName,
                cleanName: cleanModuleName,
                submodules: submodules,
                ports: moduleData.ports || {},
                attributes: moduleData.attributes || {}
            };

            // Store all dependencies (both user modules and primitives)
            hierarchy.dependencies.set(moduleName, Array.from(allDependencies));
        }

        return hierarchy;
    }

    getModuleNumber(moduleName, parentNumber = '', moduleIndex = 0) {
        if (moduleName === this.hierarchyData.topLevel) {
            return ''; // Top level has no number prefix
        }

        if (parentNumber === '') {
            return `${moduleIndex + 1}`;
        }

        return `${parentNumber}.${moduleIndex + 1}`;
    }


    // Enable hierarchical tree toggle button
    enableHierarchicalTreeToggle() {
        const toggleButton = document.getElementById('hierarchy-tree');
        if (toggleButton) {
            toggleButton.classList.remove('disabled');
            toggleButton.style.opacity = '1';
            toggleButton.style.cursor = 'pointer';

            // Update text and icon
            const icon = toggleButton.querySelector('i');
            if (icon) {
                icon.className = 'fa-solid fa-list-ul';
            }

            // Add click event listener if not already added
            if (!toggleButton.hasAttribute('data-listener-added')) {
                toggleButton.addEventListener('click', (e) => this.handleHierarchicalToggle(e));
                toggleButton.setAttribute('data-listener-added', 'true');
            }
        }
    }

    // Disable hierarchical tree toggle button
    disableHierarchicalTreeToggle() {
        const toggleButton = document.getElementById('hierarchy-tree');
        if (toggleButton) {
            toggleButton.classList.add('disabled');
            toggleButton.classList.remove('active');
            toggleButton.style.opacity = '0.5';
            toggleButton.style.cursor = 'not-allowed';

            // Reset to standard tree
            toggleButton.innerHTML = 'Standard Tree <i class="fa-solid fa-list-ul"></i>';

            // Reset tree view if currently hierarchical
            if (this.isHierarchicalView) {
                this.isHierarchicalView = false;
                this.refreshFileTree();
            }
        }
    }

    // Handle hierarchical toggle with smooth effects
    handleHierarchicalToggle(event) {
        const toggleButton = event.currentTarget;

        // Check if button is disabled
        if (toggleButton.classList.contains('disabled')) {
            return;
        }

        // Add click effect
        this.addClickEffect(toggleButton);

        // Toggle after a short delay for the effect
        setTimeout(() => {
            this.toggleHierarchicalView();
        }, 150);
    }

    // Add smooth click effect
    addClickEffect(element) {
        element.classList.add('clicked');

        // Remove the effect after animation completes
        setTimeout(() => {
            element.classList.remove('clicked');
        }, 300);
    }

    // Toggle between standard and hierarchical view
    toggleHierarchicalView() {
        const toggleButton = document.getElementById('hierarchy-tree');
        const fileTree = document.getElementById('file-tree');

        if (toggleButton && !toggleButton.classList.contains('disabled')) {
            // Add transitioning class for smooth opacity change
            if (fileTree) {
                fileTree.classList.add('transitioning');
            }

            // Toggle state
            this.isHierarchicalView = !this.isHierarchicalView;

            // Update button appearance - keep all other icons intact
            const buttonContent = toggleButton.innerHTML;
            if (this.isHierarchicalView) {
                // Replace only the tree icon and text, preserve other buttons
                const updatedContent = buttonContent.replace(
                        'Standard Tree', 'Hierarchical Tree'
                    )
                    .replace(
                        'fa-list-ul', 'fa-sitemap'
                    );
                toggleButton.innerHTML = updatedContent;
                toggleButton.classList.add('active');
            } else {
                // Replace only the tree icon and text, preserve other buttons
                const updatedContent = buttonContent.replace(
                        'Hierarchical Tree', 'Standard Tree'
                    )
                    .replace(
                        'fa-sitemap', 'fa-list-ul'
                    );
                toggleButton.innerHTML = updatedContent;
                toggleButton.classList.remove('active');
            }

            // Switch views with smooth transition
            setTimeout(() => {
                if (this.isHierarchicalView) {
                    this.renderHierarchicalTree();
                } else {
                    refreshFileTree(); // Return to standard file tree view
                }

                // Remove transitioning class
                if (fileTree) {
                    setTimeout(() => {
                        fileTree.classList.remove('transitioning');
                    }, 100);
                }
            }, 150);
        }
    }


    // Render hierarchical tree view
    // Enhanced render hierarchical tree view with numbering
    renderHierarchicalTree() {
        const fileTreeElement = document.getElementById('file-tree');
        if (!fileTreeElement || !this.hierarchyData) {
            return;
        }

        // Clear current tree
        fileTreeElement.innerHTML = '';

        // Create hierarchical structure
        const hierarchyContainer = document.createElement('div');
        hierarchyContainer.className = 'hierarchy-container';

        // Add top-level module (no numbering, chip icon)
        const topLevelItem = this.createHierarchyItem(
            this.hierarchyData.topLevel, 'top-level', 'fa-solid fa-microchip', true, '' // No number for top level
        );

        hierarchyContainer.appendChild(topLevelItem);

        // Build hierarchy tree recursively starting from top level
        this.buildHierarchyTree(topLevelItem, this.hierarchyData.topLevel, new Set(), 0, '');

        fileTreeElement.appendChild(hierarchyContainer);

        // Trigger fade-in animation
        setTimeout(() => {
            hierarchyContainer.style.opacity = '1';
        }, 50);
    }

    // Create hierarchy item element with click-to-expand functionality
    createHierarchyItem(name, type, icon, isExpanded = false, moduleNumber = '') {
        const itemContainer = document.createElement('div');
        itemContainer.className = 'file-tree-item hierarchy-item';
        itemContainer.setAttribute('data-type', type);

        const itemElement = document.createElement('div');
        itemElement.className = 'file-item hierarchy-file-item';

        // Add toggle for expandable items
        if (type === 'top-level' || type === 'module') {
            const toggle = document.createElement('div');
            toggle.className = `folder-toggle ${isExpanded ? 'rotated' : ''}`;
            toggle.innerHTML = '<i class="fa-solid fa-caret-right"></i>';

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleHierarchyItem(itemContainer);
            });

            itemElement.appendChild(toggle);
        } else {
            // Add spacing for non-expandable items
            const spacer = document.createElement('div');
            spacer.style.width = '16px';
            spacer.style.marginRight = '6px';
            itemElement.appendChild(spacer);
        }

        // Add icon (keep original icons)
        const iconElement = document.createElement('div');
        iconElement.className = 'file-item-icon';
        iconElement.innerHTML = `<i class="${icon}"></i>`;
        itemElement.appendChild(iconElement);

        // Add label with numbering
        const label = document.createElement('span');
        if (moduleNumber && type !== 'top-level') {
            label.textContent = `${moduleNumber}. ${name}`;
        } else {
            label.textContent = name;
        }
        label.className = 'hierarchy-label';
        itemElement.appendChild(label);

        itemContainer.appendChild(itemElement);

        // Add container for children
        const childrenContainer = document.createElement('div');
        childrenContainer.className = `folder-content ${isExpanded ? '' : 'hidden'}`;
        itemContainer.appendChild(childrenContainer);

        // Make expandable items clickable
        if (type === 'top-level' || type === 'module') {
            itemElement.addEventListener('click', (e) => {
                if (!e.target.closest('.folder-toggle')) {
                    this.toggleHierarchyItem(itemContainer);
                }
            });
            itemElement.style.cursor = 'pointer';
        }

        return itemContainer;
    }

    // Build hierarchy tree recursively with standardized icons
    buildHierarchyTree(parentItem, moduleName, visited = new Set(), depth = 0, parentNumber = '') {
        if (visited.has(moduleName) || depth > 15) { // Prevent infinite recursion
            return;
        }

        visited.add(moduleName);

        const moduleData = this.hierarchyData.modules[moduleName];
        if (!moduleData || !moduleData.submodules || moduleData.submodules.length === 0) {
            return;
        }

        const childrenContainer = parentItem.querySelector('.folder-content');

        // Group all submodules by type (both user modules and primitives)
        const moduleGroups = new Map();

        moduleData.submodules.forEach(submodule => {
            if (!moduleGroups.has(submodule.type)) {
                moduleGroups.set(submodule.type, []);
            }
            moduleGroups.get(submodule.type)
                .push(submodule);
        });

        // Sort module types: user modules first, then primitives
        const sortedTypes = Array.from(moduleGroups.keys())
            .sort((a, b) => {
                const aIsUser = this.hierarchyData.modules[a];
                const bIsUser = this.hierarchyData.modules[b];

                if (aIsUser && !bIsUser) return -1;
                if (!aIsUser && bIsUser) return 1;
                return a.localeCompare(b);
            });

        // Create items for each module type with numbering
        let moduleIndex = 0;
        for (const moduleType of sortedTypes) {
            const instances = moduleGroups.get(moduleType);
            const currentModuleNumber = this.getModuleNumber(moduleType, parentNumber, moduleIndex);

            if (this.hierarchyData.modules[moduleType]) {
                // User-defined module - create expandable item
                const moduleItem = this.createHierarchyItem(
                    `${moduleType} (${instances.length} instance${instances.length > 1 ? 's' : ''})`, 'module', 'fa-solid fa-cube', // Use cube icon instead of 'A'
                    false, currentModuleNumber
                );

                moduleItem.style.setProperty('--index', moduleIndex);
                childrenContainer.appendChild(moduleItem);

                // Add instances as children with sub-numbering
                instances.forEach((instance, instanceIndex) => {
                    const instanceNumber = `${currentModuleNumber}.${instanceIndex + 1}`;
                    const instanceItem = this.createHierarchyItem(
                        instance.instance, 'instance', 'fa-solid fa-microchip', // Use microchip icon instead of 'B'
                        false, instanceNumber
                    );

                    instanceItem.style.setProperty('--index', instanceIndex);

                    const moduleChildrenContainer = moduleItem.querySelector('.folder-content');
                    moduleChildrenContainer.appendChild(instanceItem);

                    // Recursively build for this module type
                    this.buildHierarchyTree(instanceItem, moduleType, new Set(visited), depth + 1, currentModuleNumber);
                });
            } else {
                // Primitive or external module - create leaf items
                instances.forEach((instance, instanceIndex) => {
                    const primitiveNumber = `${currentModuleNumber}.${instanceIndex + 1}`;
                    const primitiveItem = this.createHierarchyItem(
                        `${instance.instance} (${instance.type})`, 'primitive', 'fa-solid fa-square', // Use square icon for primitives
                        false, primitiveNumber
                    );

                    primitiveItem.style.setProperty('--index', moduleIndex);
                    childrenContainer.appendChild(primitiveItem);
                });
            }

            moduleIndex++;
        }
    }

    // Toggle hierarchy item expansion with improved animation
    toggleHierarchyItem(itemElement) {
        const content = itemElement.querySelector('.folder-content');
        const toggle = itemElement.querySelector('.folder-toggle');

        if (!content) return;

        const isExpanded = !content.classList.contains('hidden');

        if (isExpanded) {
            // Collapse
            content.classList.add('hidden');
            if (toggle) toggle.classList.remove('rotated');
        } else {
            // Expand
            content.classList.remove('hidden');
            if (toggle) toggle.classList.add('rotated');

            // Add staggered animation to children
            const visibleItems = content.querySelectorAll('.hierarchy-item');
            visibleItems.forEach((item, index) => {
                item.style.animation = 'none';
                item.offsetHeight; // force reflow
                item.style.animation = `fadeInDown 0.25s ease forwards`;
                item.style.animationDelay = `${index * 30}ms`;
            });
        }
    }

    // Add this method to your class for launching fractal visualizer
    async launchFractalVisualizerAsync(processorName, palette = 'grayscale') {
        try {
            const outputFilePath = await window.electronAPI.joinPath(
                this.projectPath, processorName, 'Simulation', 'output_0.txt'
            );

            const fancyFractalPath = await window.electronAPI.joinPath(
                'saphoComponents', 'Packages', 'FFPGA', 'fancyFractal.exe'
            );

            // Limpar arquivo anterior

            // Verificar se executável existe
            const executableExists = await window.electronAPI.pathExists(fancyFractalPath);
            if (!executableExists) {
                throw new Error(`Visualizador não encontrado em: ${fancyFractalPath}`);
            }

            // Comando com paleta
            const command = `"${fancyFractalPath}" "${outputFilePath}"`;

            await window.electronAPI.deleteFileOrDirectory(outputFilePath);

            this.terminalManager.appendToTerminal('tcmm', `Iniciando visualizador de fractal (${palette})...`);
            this.terminalManager.appendToTerminal('tcmm', `Comando: ${command}`);

            // Executar comando assíncrono
            window.electronAPI.execCommand(command)
                .then(result => {
                    if (result.code === 0) {
                        this.terminalManager.appendToTerminal('tcmm', `Visualizador concluído com sucesso`);
                    } else {
                        this.terminalManager.appendToTerminal('tcmm', `Visualizador finalizou com código: ${result.code}`, 'warning');
                    }
                })
                .catch(error => {
                    this.terminalManager.appendToTerminal('tcmm', `Erro no visualizador: ${error.message}`, 'error');
                });

            return true;

        } catch (error) {
            this.terminalManager.appendToTerminal('tcmm', `Erro ao iniciar visualizador: ${error.message}`, 'error');
            console.error('Falha ao iniciar visualizador:', error);
            return false;
        }
    }

    // Method to launch fractal visualizer for all processors at once
    async launchFractalVisualizersForProject(palette = 'fire') {
        if (!this.isProjectOriented) {
            const activeProcessor = this.config.processors.find(p => p.isActive === true);
            if (activeProcessor) {
                await this.launchFractalVisualizerAsync(activeProcessor.name, palette);
            }
        }
    }

    // Refactored compileAll method
    async compileAll() {
        try {
            startCompilation();
            await this.loadConfig();

            if (this.isProjectOriented) {
                // Project mode: compile all processors, then run project verilog and GTKWave
                if (this.projectConfig && this.projectConfig.processors) {
                    const processedTypes = new Set();

                    // Switch to CMM terminal for processor compilation
                    switchTerminal('terminal-tcmm');

                    for (const processor of this.projectConfig.processors) {
                        checkCancellation();

                        if (processedTypes.has(processor.type)) {
                            this.terminalManager.appendToTerminal('tcmm', `Skipping duplicate processor type: ${processor.type}`);
                            continue;
                        }

                        processedTypes.add(processor.type);

                        try {
                            const processorObj = {
                                name: processor.type,
                                type: processor.type,
                                instance: processor.instance
                            };

                            checkCancellation();
                            this.terminalManager.appendToTerminal('tcmm', `Processing ${processor.type}...`);
                            await this.ensureDirectories(processor.type);

                            // CMM compilation
                            const asmPath = await this.cmmCompilation(processorObj);
                            checkCancellation();

                            // ASM compilation with project parameter = 1
                            await this.asmCompilation(processor, 1);
                        } catch (error) {
                            this.terminalManager.appendToTerminal('tcmm', `Error processing processor ${processor.type}: ${error.message}`, 'error');
                        }
                    }
                }

                // Switch to Verilog terminal
                switchTerminal('terminal-tveri');
                checkCancellation();
                await this.iverilogProjectCompilation();

                // Switch to Wave terminal
                switchTerminal('terminal-twave');
                checkCancellation();
                await this.runProjectGtkWave();

            } else {
                // Processor mode: run full pipeline for active processor
                const activeProcessor = this.config.processors.find(p => p.isActive === true);
                if (!activeProcessor) {
                    throw new Error("No active processor found. Please set one processor as active.");
                }

                const processor = activeProcessor;
                await this.ensureDirectories(processor.name);

                // Switch to CMM terminal
                switchTerminal('terminal-tcmm');
                checkCancellation();
                const asmPath = await this.cmmCompilation(processor);

                checkCancellation();
                // ASM compilation with project parameter = 0
                await this.asmCompilation(processor, 0);

                // Switch to Verilog terminal
                switchTerminal('terminal-tveri');
                checkCancellation();
                await this.iverilogCompilation(processor);

                // Switch to Wave terminal
                switchTerminal('terminal-twave');
                checkCancellation();
                await this.runGtkWave(processor);
            }

            endCompilation();
            return true;
        } catch (error) {
            this.terminalManager.appendToTerminal('tcmm', `Error in compilation process: ${error.message}`, 'error');
            console.error('Complete compilation failed:', error);
            endCompilation();
            return false;
        }
    }

}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, setting up PRISM button...');

    const prismButton = document.getElementById('prismcomp');
    let isCompiling = false;

    if (!prismButton) {
        console.error('PRISM button not found!');
        return;
    }

    console.log('PRISM button found:', prismButton);

    // Function to update button appearance based on PRISM window status
    function updatePrismButton(isOpen) {
        if (!prismButton) return;

        console.log('Updating PRISM button, isOpen:', isOpen);

        if (isOpen) {
            prismButton.classList.add('active');
            if (!isCompiling) {
                prismButton.innerHTML = '<img src="./assets/icons/aurora_prism.svg" style="height: inherit; width: 35px; flex-shrink: 0;"> PRISM (Recompile)';
            }
        } else {
            prismButton.classList.remove('active');
            if (!isCompiling) {
                prismButton.innerHTML = '<img src="./assets/icons/aurora_prism.svg" style="height: inherit; width: 35px; flex-shrink: 0;"> PRISM';
            }
        }
    }

    // Function to acquire all necessary paths for PRISM compilation
    async function acquirePrismPaths() {
        console.log('=== ACQUIRING PRISM PATHS ===');

        try {
            // Get project path - fix global reference issue
            let projectPath = null;
            if (window.currentProjectPath) {
                projectPath = window.currentProjectPath;
            } else if (window.currentOpenProjectPath) {
                projectPath = await window.electronAPI.dirname(window.currentOpenProjectPath);
            } else if (window.currentProject && window.currentProject.path) {
                projectPath = window.currentProject.path;
            }

            if (!projectPath) {
                throw new Error('No project path available. Please open a project first.');
            }

            console.log('✓ Project path acquired:', projectPath);

            // Acquire component paths using electronAPI
            console.log('Acquiring saphoComponents path...');
            const saphoComponentsPath = await window.electronAPI.joinPath('saphoComponents');
            console.log('✓ SaphoComponents path:', saphoComponentsPath);

            console.log('Acquiring HDL path...');
            const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
            console.log('✓ HDL path:', hdlPath);

            console.log('Acquiring temp path...');
            const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', 'PRISM');
            console.log('✓ Temp path:', tempPath);

            console.log('Acquiring Yosys executable path...');
            const yosysPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'PRISM', 'yosys', 'yosys.exe');
            console.log('✓ Yosys executable path:', yosysPath);

            console.log('Acquiring NetlistSVG executable path...');
            const netlistsvgPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe');
            console.log('✓ NetlistSVG executable path:', netlistsvgPath);

            // Configuration file paths
            console.log('Acquiring processor config path...');
            const processorConfigPath = await window.electronAPI.joinPath(projectPath, 'processorConfig.json');
            console.log('✓ Processor config path:', processorConfigPath);

            console.log('Acquiring project oriented config path...');
            const projectOrientedConfigPath = await window.electronAPI.joinPath(projectPath, 'projectOriented.json');
            console.log('✓ Project oriented config path:', projectOrientedConfigPath);

            // TopLevel directory path
            console.log('Acquiring TopLevel directory path...');
            const topLevelPath = await window.electronAPI.joinPath(projectPath, 'TopLevel');
            console.log('✓ TopLevel directory path:', topLevelPath);

            const compilationPaths = {
                projectPath,
                saphoComponentsPath,
                hdlPath,
                tempPath,
                yosysPath,
                netlistsvgPath,
                processorConfigPath,
                projectOrientedConfigPath,
                topLevelPath
            };

            console.log('=== ALL PRISM PATHS ACQUIRED SUCCESSFULLY ===');
            console.log('Compilation paths object:', compilationPaths);

            return compilationPaths;

        } catch (error) {
            console.error('Failed to acquire PRISM paths:', error);
            throw new Error(`Path acquisition failed: ${error.message}`);
        }
    }

    // Enable the button initially
    prismButton.disabled = false;
    prismButton.style.cursor = 'pointer';
    console.log('PRISM button enabled');

    // Listen for PRISM window status updates
    if (window.electronAPI && window.electronAPI.onPrismStatus) {
        console.log('Setting up PRISM status listener...');
        window.electronAPI.onPrismStatus((isOpen) => {
            console.log('PRISM status update received:', isOpen);
            updatePrismButton(isOpen);
        });
    } else {
        console.warn('electronAPI.onPrismStatus not available');
    }

    // PRISM button click handler - UNIFIED FOR BOTH COMPILE AND RECOMPILE
    prismButton.addEventListener('click', async () => {
        console.log('=== PRISM BUTTON CLICKED ===');
        console.log('Button disabled:', prismButton.disabled);
        console.log('Is compiling:', isCompiling);

        // Check if button is disabled or already compiling
        if (prismButton.disabled || isCompiling) {
            console.log('PRISM button is disabled or compilation in progress - ignoring click');
            return;
        }

        try {
            // Set compilation state
            isCompiling = true;
            console.log('Starting PRISM compilation process...');

            // Update button appearance
            prismButton.disabled = true;
            prismButton.style.cursor = 'not-allowed';
            prismButton.innerHTML = '<img src="./assets/icons/aurora_prism.svg" style="height: inherit; width: 35px; flex-shrink: 0;"> Preparing...';

            // Step 1: Acquire all necessary paths
            console.log('Step 1: Acquiring compilation paths...');
            const compilationPaths = await acquirePrismPaths();

            // Step 2: Check if PRISM window is already open
            let isPrismOpen = false;
            try {
                if (window.electronAPI && window.electronAPI.checkPrismWindowOpen) {
                    isPrismOpen = await window.electronAPI.checkPrismWindowOpen();
                    console.log('PRISM window open status:', isPrismOpen);
                }
            } catch (error) {
                console.warn('Error checking PRISM window status:', error);
                isPrismOpen = false;
            }

            // Step 3: Update button text based on operation type
            if (isPrismOpen) {
                prismButton.innerHTML = '<img src="./assets/icons/aurora_prism.svg" style="height: inherit; width: 35px; flex-shrink: 0;"> Recompiling...';
                console.log('Starting PRISM recompilation...');
            } else {
                prismButton.innerHTML = '<img src="./assets/icons/aurora_prism.svg" style="height: inherit; width: 35px; flex-shrink: 0;"> Compiling...';
                console.log('Starting PRISM compilation...');
            }

            // Step 4: Send paths and execute compilation - FIXED VERSION
            console.log('Step 4: Executing PRISM compilation with acquired paths...');
            let result;

            if (isPrismOpen) {
                // Use recompile for existing window
                if (window.electronAPI.prismRecompile) {
                    console.log('Using prismRecompile method...');
                    result = await window.electronAPI.prismRecompile(compilationPaths);
                } else if (window.electronAPI.prismCompileWithPaths) {
                    console.log('prismRecompile not available, using prismCompileWithPaths...');
                    result = await window.electronAPI.prismCompileWithPaths(compilationPaths);
                } else {
                    console.log('Using legacy openPrismCompile with paths...');
                    result = await window.electronAPI.openPrismCompile(compilationPaths);
                }
            } else {
                // Use the best available method for new compilation
                if (window.electronAPI.prismCompileWithPaths) {
                    console.log('Using prismCompileWithPaths method...');
                    result = await window.electronAPI.prismCompileWithPaths(compilationPaths);
                } else if (window.electronAPI.prismCompile) {
                    console.log('Using prismCompile method...');
                    result = await window.electronAPI.prismCompile(compilationPaths);
                } else if (window.electronAPI.openPrismCompile) {
                    console.log('Using legacy openPrismCompile with paths...');
                    result = await window.electronAPI.openPrismCompile(compilationPaths);
                } else {
                    throw new Error('No PRISM compilation method available in electronAPI');
                }
            }

            console.log('PRISM compilation result:', result);

            // Check if result is valid and has success property
            if (result && result.success) {
                console.log('PRISM compilation successful:', result.message);

                // Show success message if terminal is available
                if (window.terminalManager) {
                    window.terminalManager.appendToTerminal('tprism', 'PRISM compilation completed successfully', 'success');
                }

                // Update button status after a delay to allow window to open
                setTimeout(async () => {
                    try {
                        const newStatus = await window.electronAPI.checkPrismWindowOpen();
                        console.log('Post-compilation window status:', newStatus);
                        updatePrismButton(newStatus);
                    } catch (error) {
                        console.warn('Error updating button status:', error);
                        // Default to showing recompile mode if compilation was successful
                        updatePrismButton(true);
                    }
                }, 2000);

            } else {
                // Handle failed compilation
                const errorMessage = result && result.message ?
                    result.message :
                    result && result.error ?
                    result.error :
                    'Unknown error occurred during compilation';

                console.error('PRISM compilation failed:', errorMessage);

                // Show error in terminal if available
                if (window.terminalManager) {
                    window.terminalManager.appendToTerminal('tprism', `Compilation failed: ${errorMessage}`, 'error');
                }

                // Show error dialog
                if (window.electronAPI) {
                    showCardNotification(`PRISM Error: ${errorMessage}'`, 'error', 3000);

                } else {
                    alert(`PRISM Compilation Failed: ${errorMessage}`);
                }
            }

        } catch (error) {
            console.error('PRISM compilation error:', error);

            // Show error in terminal if available
            if (window.terminalManager) {
                window.terminalManager.appendToTerminal('tprism', `Compilation error: ${error.message}`, 'error');
            }

            // Show error dialog
            if (window.electronAPI) {
                showCardNotification(`PRISM Error: ${error.message}'`, 'error', 3000);
                

            } else {
                alert(`PRISM Error: ${error.message}`);
            }

        } finally {
            console.log('PRISM compilation process finished, resetting button...');

            // Reset compilation state and button
            isCompiling = false;
            prismButton.disabled = false;
            prismButton.style.cursor = 'pointer';

            // Check current PRISM window status to set correct button text
            try {
                const isPrismOpenFinal = await window.electronAPI.checkPrismWindowOpen();
                console.log('Final PRISM window status:', isPrismOpenFinal);
                updatePrismButton(isPrismOpenFinal);
            } catch (error) {
                console.error('Error checking PRISM window status in finally:', error);
                // Default button text
                prismButton.innerHTML = '<img src="./assets/icons/aurora_prism.svg" style="width: 35px; height: inherit; flex-shrink: 0;"> PRISM';
            }

            console.log('=== PRISM BUTTON PROCESS COMPLETE ===');
        }
    });

    // Listen for toggle UI state requests from PRISM window
    if (window.electronAPI && window.electronAPI.onGetToggleUIState) {
        console.log('Setting up toggle UI state listener...');
        window.electronAPI.onGetToggleUIState((sendResponse) => {
            console.log('Received request for toggle UI state');

            // Get the actual toggle state from your UI
            const toggleElement = document.getElementById('toggle-ui') ||
                document.querySelector('.toggle-switch') ||
                document.querySelector('[data-toggle]');

            let isActive = false;

            if (toggleElement) {
                // Check different types of toggle
                if (toggleElement.type === 'checkbox') {
                    isActive = toggleElement.checked;
                } else if (toggleElement.classList.contains('active')) {
                    isActive = true;
                } else if (toggleElement.getAttribute('data-active') === 'true') {
                    isActive = true;
                }
            }

            console.log('Toggle element found:', !!toggleElement);
            console.log('Sending toggle UI state:', isActive);
            sendResponse(isActive);
        });
    } else {
        console.warn('electronAPI.onGetToggleUIState not available');
    }

    console.log('PRISM button setup complete');
});

// Add to existing window message listeners
window.addEventListener('message', (event) => {
    if (event.data.type === 'terminal-log') {
        if (window.terminalManager) {
            window.terminalManager.appendToTerminal(
                event.data.terminal, event.data.message, event.data.logType
            );
        }
    }
});

// Debug function to check if all required APIs are available
function debugElectronAPI() {
    console.log('=== ELECTRON API DEBUG ===');
    console.log('window.electronAPI available:', !!window.electronAPI);

    if (window.electronAPI) {
        console.log('prismCompile available:', !!window.electronAPI.prismCompile);
        console.log('openPrismCompile available:', !!window.electronAPI.openPrismCompile);
        console.log('prismRecompile available:', !!window.electronAPI.prismRecompile);
        console.log('checkPrismWindowOpen available:', !!window.electronAPI.checkPrismWindowOpen);
        console.log('onPrismStatus available:', !!window.electronAPI.onPrismStatus);
        console.log('onGetToggleUIState available:', !!window.electronAPI.onGetToggleUIState);
    }

    console.log('terminalManager available:', !!window.terminalManager);
    console.log('=== END ELECTRON API DEBUG ===');
}

// Run debug on load
debugElectronAPI();
// Add to existing window message listeners
window.addEventListener('message', (event) => {
    if (event.data.type === 'terminal-log') {
        if (window.terminalManager) {
            window.terminalManager.appendToTerminal(
                event.data.terminal, event.data.message, event.data.logType
            );
        }
    }
});


//TERMINAL      ======================================================================================================================================================== ƒ
class TerminalManager {
    constructor() {
        this.terminals = {
            tcmm: document.querySelector('#terminal-tcmm .terminal-body'),
            tasm: document.querySelector('#terminal-tasm .terminal-body'),
            tveri: document.querySelector('#terminal-tveri .terminal-body'),
            twave: document.querySelector('#terminal-twave .terminal-body'),
            tprism: document.querySelector('#terminal-tprism .terminal-body'),
            tcmd: document.querySelector('#terminal-tcmd .terminal-body'),
        };

        this.setupTerminalTabs();
        this.setupAutoScroll();
        this.setupGoDownButton();
        this.setupTerminalLogListener();
this.updatableCards = {};
        // Initialize current session grouped cards for each terminal
        this.currentSessionCards = {};
        Object.keys(this.terminals)
            .forEach(id => {
                this.currentSessionCards[id] = {};
            });

        if (!TerminalManager.clearButtonInitialized) {
            this.setupClearButton();
            TerminalManager.clearButtonInitialized = true;
        }

        this.activeFilters = new Set();
        this.setupFilterButtons();
    }

    resetSessionCards(terminalId) {
        if (this.currentSessionCards[terminalId]) {
            this.currentSessionCards[terminalId] = {};
        }
    }
createOrUpdateCard(terminalId, cardId, lines, type, status = 'running') {
    const terminal = this.terminals[terminalId];
    if (!terminal) return;

    if (!this.updatableCards[terminalId]) {
        this.updatableCards[terminalId] = {};
    }

    let card = this.updatableCards[terminalId][cardId];
    const timestamp = new Date().toLocaleString('pt-BR', { hour12: false });
    
    // Constrói o HTML para as linhas de mensagem.
    const contentHTML = lines.map(line => `<div>${line}</div>`).join('');

    if (!card) {
        // Card não existe, vamos criá-lo com a ESTRUTURA CORRETA.
        card = document.createElement('div');
        card.classList.add('log-entry', type);
        
        // A estrutura agora é idêntica à de createGroupedCard/createLogEntry
        card.innerHTML = `
            <span class="timestamp">[${timestamp}]</span>
            <div class="message-content">
                <div class="message-lines">${contentHTML}</div>
            </div>
        `;
        
        terminal.appendChild(card);
        this.updatableCards[terminalId][cardId] = card;

        // Animação de entrada
        card.style.opacity = '0';
        requestAnimationFrame(() => {
            card.style.transition = 'opacity 0.3s ease';
            card.style.opacity = '1';
        });

    } else {
        // Card já existe, vamos apenas atualizar seu conteúdo.
        const messageContainer = card.querySelector('.message-lines');
        if (messageContainer) {
            messageContainer.innerHTML = contentHTML;
        }
    }
    
    // O atributo [data-status] é a chave para o CSS dinâmico funcionar.
    card.setAttribute('data-status', status);
    this.scrollToBottom(terminalId);
    return card;
}
    processExecutableOutput(terminalId, result) {
        const terminal = this.terminals[terminalId];
        if (!terminal || (!result.stdout && !result.stderr)) {
            return;
        }

        // 1. Reseta os cards para este novo bloco de saída
        this.resetSessionCards(terminalId);

        const output = (result.stdout || '') + (result.stderr || '');
        const lines = output.split('\n').filter(line => line.trim());

        if (lines.length === 0) return;

        // 2. Processa cada linha para agrupá-la no card apropriado
        lines.forEach(line => {
            const messageType = this.detectMessageType(line);

            if (messageType && messageType !== 'plain') {
                this.addToSessionCard(terminalId, line.trim(), messageType);
            } else {
                const timestamp = new Date().toLocaleString('pt-BR', { hour12: false });
                this.createLogEntry(terminal, line.trim(), 'plain', timestamp);
            }
        });

        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
    }

    filterGtkWaveOutput(result) {
        const noisePrefixes = [
            'GTKWave Analyzer',
            'FSTLOAD |',
            'GTKWAVE |',
            'WM Destroy',
            '[0] start time',
            '[0] end time'
        ];

        const filterLines = (text) => {
            if (!text) return '';
            return text.split('\n')
                .filter(line => {
                    // Mantém a linha se ela NÃO começar com nenhum dos prefixos de ruído
                    return !noisePrefixes.some(prefix => line.trim().startsWith(prefix));
                })
                .join('\n');
        };

        return {
            ...result,
            stdout: filterLines(result.stdout),
            stderr: filterLines(result.stderr),
        };
    }

    setupTerminalLogListener() {
        window.electronAPI.onTerminalLog((event, terminal, message, type = 'info') => {
            this.appendToTerminal(terminal, message, type);
        });
    }

    setupTerminalTabs() {
        const tabs = document.querySelectorAll('.terminal-tabs .tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const contents = document.querySelectorAll('.terminal-content');
                contents.forEach(content => content.classList.add('hidden'));

                const terminalId = tab.getAttribute('data-terminal');
                const terminal = document.getElementById(`terminal-${terminalId}`);
                terminal.classList.remove('hidden');

                this.scrollToBottom(terminalId);
            });
        });
    }

    setupFilterButtons() {
        const errorBtn = document.getElementById('filter-error');
        const warningBtn = document.getElementById('filter-warning');
        const infoBtn = document.getElementById('filter-tip');
        const successBtn = document.getElementById('filter-success');

        if (!errorBtn || !warningBtn || !infoBtn || !successBtn) return;

        // It's good practice to re-clone nodes to avoid stale event listeners
        const buttons = {
            error: errorBtn.cloneNode(true),
            warning: warningBtn.cloneNode(true),
            tips: infoBtn.cloneNode(true),
            success: successBtn.cloneNode(true)
        };

        errorBtn.parentNode.replaceChild(buttons.error, errorBtn);
        warningBtn.parentNode.replaceChild(buttons.warning, warningBtn);
        infoBtn.parentNode.replaceChild(buttons.tips, infoBtn);
        successBtn.parentNode.replaceChild(buttons.success, successBtn);

        buttons.error.addEventListener('click', () => this.toggleFilter('error', buttons.error));
        buttons.warning.addEventListener('click', () => this.toggleFilter('warning', buttons.warning));
        buttons.tips.addEventListener('click', () => this.toggleFilter('tips', buttons.tips));
        buttons.success.addEventListener('click', () => this.toggleFilter('success', buttons.success));
    }

    toggleFilter(filterType, clickedBtn, allButtons) {
        if (this.activeFilter === filterType) {
            this.activeFilter = null;
            clickedBtn.classList.remove('active');
        } else {
            this.activeFilter = filterType;
            allButtons.forEach(btn => btn.classList.remove('active'));
            clickedBtn.classList.add('active');
        }

        this.applyFilterToAllTerminals();
    }

    applyFilterToAllTerminals() {
        Object.keys(this.terminals)
            .forEach(terminalId => {
                this.applyFilter(terminalId);
            });
    }

    toggleFilter(filterType, clickedBtn) {
        // Check if the filter is already active
        if (this.activeFilters.has(filterType)) {
            // If so, remove it from the set and deactivate the button
            this.activeFilters.delete(filterType);
            clickedBtn.classList.remove('active');
        } else {
            // If not, add it to the set and activate the button
            this.activeFilters.add(filterType);
            clickedBtn.classList.add('active');
        }

        // Apply the updated filters to all terminals
        this.applyFilterToAllTerminals();
    }

    applyFilter(terminalId) {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        const cards = terminal.querySelectorAll('.log-entry');
        const hasActiveFilters = this.activeFilters.size > 0;

        cards.forEach(card => {
            if (!hasActiveFilters) {
                // If no filters are active, show all cards
                card.style.display = '';
                return;
            }

            // Check if the card has at least one of the active filter classes
            const shouldShow = [...this.activeFilters].some(filter => card.classList.contains(filter));

            if (shouldShow) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });
    }

    detectMessageType(content) {
        const text = typeof content === 'string' ?
            content :
            (content.stdout || '') + ' ' + (content.stderr || '');

        // Portuguese keywords detection
        if (text.includes('Atenção') || text.includes('Warning')) return 'warning';
        if (text.includes('Erro') || text.includes('ERROR')) return 'error';
        if (text.includes('Sucesso') || text.includes('Success')) return 'success';
        if (text.includes('Info') || text.includes('Tip')) return 'tips';

        // Additional detection patterns
        if (text.includes('não está sendo usada') || text.includes('Economize memória')) return 'tips';
        if (text.includes('de sintaxe') || text.includes('cadê a função')) return 'error';

        return 'plain';
    }

    makeLineNumbersClickable(text) {
        // Replace "linha" or "line" followed by space and number with clickable link
        return text.replace(/\b(?:linha|line)\s+(\d+)/gi, (match, lineNumber) => {
            return `<span title="Opa. Bão?" class="line-link" data-line="${lineNumber}" ` +
                `style="cursor: pointer; text-decoration: none; filter: brightness(1.4);">` +
                `${match}</span>`;
        });
    }
// Adicione este método à sua classe TerminalManager

processStreamedLine(terminalId, line) {
    const terminal = this.terminals[terminalId];
    if (!terminal || !line) return;

    const messageType = this.detectMessageType(line);

    if (messageType && messageType !== 'plain') {
        this.addToSessionCard(terminalId, line, messageType);
    } else {
        const timestamp = new Date().toLocaleString('pt-BR', { hour12: false });
        this.createLogEntry(terminal, line, 'plain', timestamp);
    }

    this.applyFilter(terminalId);
    this.scrollToBottom(terminalId);
}
    // In the TerminalManager class...

    appendToTerminal(terminalId, content, type = 'info') {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;
        
        // Esta função agora é usada para mensagens de status individuais.
        // A lógica de processamento de blocos de saída foi movida para processExecutableOutput.
        let text = (typeof content === 'string') ? content : (content.stdout || '') + (content.stderr || '');
        if (!text.trim()) return;
        
        const lines = text.split('\n').filter(line => line.trim());
        
        lines.forEach(line => {
             const timestamp = new Date().toLocaleString('pt-BR', { hour12: false });
             // Mensagens gerais não serão agrupadas em cards de sessão, elas aparecem como entradas individuais
             this.createLogEntry(terminal, line.trim(), type, timestamp);
        });

        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
    }

    addToSessionCard(terminalId, text, type) {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        let card = this.currentSessionCards[terminalId][type];

        if (!card) {
            const timestamp = new Date().toLocaleString('pt-BR', { hour12: false });
            card = this.createGroupedCard(terminal, type, timestamp);
            this.currentSessionCards[terminalId][type] = card;
        }

        this.addMessageToCard(card, text, type);
    }

    createGroupedCard(terminal, type, timestamp) {
        const logEntry = document.createElement('div');
        logEntry.classList.add('log-entry', type);

        // Add timestamp
        const timestampElement = document.createElement('span');
        timestampElement.classList.add('timestamp');
        timestampElement.textContent = `[${timestamp}]`;

        // Container for all messages in this group
        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        // Only messages container—no separate header
        const messagesContainer = document.createElement('div');
        messagesContainer.classList.add('messages-container');

        messageContent.appendChild(messagesContainer);
        logEntry.appendChild(timestampElement);
        logEntry.appendChild(messageContent);
        terminal.appendChild(logEntry);

        // Fade‑in
        logEntry.style.opacity = '0';
        logEntry.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            logEntry.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            logEntry.style.opacity = '1';
            logEntry.style.transform = 'translateY(0)';
        });

        return logEntry;
    }

    addMessageToCard(card, text, type) {
        const messagesContainer = card.querySelector('.messages-container');
        if (!messagesContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.classList.add('grouped-message');
        messageDiv.style.marginBottom = '0.25rem';

        // 1) make line‑numbers clickable
        // 2) bold the keyword at the start of the message
        let processedText = this.makeLineNumbersClickable(text);
        processedText = processedText.replace(
            /^(Atenção|Erro|Sucesso|Info)(:)?/i, (_, word, colon) => `<strong style="font-weight:900">${word}</strong>${colon || ''}`
        );

        messageDiv.innerHTML = processedText;

        const lineLinks = messageDiv.querySelectorAll('.line-link');
        lineLinks.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineNumber = parseInt(link.getAttribute('data-line'));
                console.log(`Clicked on line ${lineNumber}`);

                try {
                    // Extract CMM file path from recent compilation data
                    let cmmFilePath = null;

                    // First, try to get from compilation manager if available
                    if (window.compilationManager?.getCurrentProcessor) {
                        const currentProcessor = window.compilationManager.getCurrentProcessor();
                        if (currentProcessor) {
                            try {
                                const selectedCmmFile = await window.compilationManager.getSelectedCmmFile(currentProcessor);
                                if (selectedCmmFile) {
                                    // Construct full path: project path + processor name + Software + selectedCmmFile
                                    const projectPath = window.compilationManager.projectPath;
                                    const softwarePath = await window.electronAPI.joinPath(projectPath, currentProcessor.name, 'Software');
                                    cmmFilePath = await window.electronAPI.joinPath(softwarePath, selectedCmmFile);
                                }
                            } catch (error) {
                                console.log('Error getting CMM file from compilation manager:', error);
                            }
                        }
                    }

                    // If that fails, try to extract from terminal content
                    if (!cmmFilePath) {
                        const terminalContent = card.closest('.terminal-content');
                        if (terminalContent) {
                            const logEntries = terminalContent.querySelectorAll('.log-entry');

                            // Look for compilation command in recent log entries
                            for (const entry of Array.from(logEntries)
                                    .reverse()) {
                                const entryText = entry.textContent || '';

                                // Look for cmmcomp.exe command
                                const cmmCompMatch = entryText.match(/cmmcomp\.exe["\s]+([^\s"]+\.cmm)\s+([^\s"]+)\s+"([^"]+)"/);
                                if (cmmCompMatch) {
                                    const cmmFileName = cmmCompMatch[1];
                                    const processorName = cmmCompMatch[2];
                                    const projectPath = cmmCompMatch[3];

                                    // Construct full CMM file path
                                    cmmFilePath = await window.electronAPI.joinPath(projectPath, 'Software', cmmFileName);
                                    break;
                                }
                            }
                        }
                    }

                    if (!cmmFilePath) {
                        console.log('Could not determine CMM file path');
                        return;
                    }

                    // Check if file exists
                    const fileExists = await window.electronAPI.fileExists(cmmFilePath);
                    if (!fileExists) {
                        console.log(`CMM file does not exist: ${cmmFilePath}`);
                        return;
                    }

                    // Check if the CMM file is already open in tabs
                    const isFileOpen = TabManager.tabs.has(cmmFilePath);

                    if (!isFileOpen) {
                        // Read file content and open it in a new tab
                        const content = await window.electronAPI.readFile(cmmFilePath, {
                            encoding: 'utf8'
                        });
                        TabManager.addTab(cmmFilePath, content);
                    } else {
                        // File is already open, just activate it
                        TabManager.activateTab(cmmFilePath);
                    }

                    // Navigate to line in Monaco editor after a small delay to ensure tab is active
                    setTimeout(() => {
                        this.goToLine(lineNumber);
                    }, 100);

                } catch (error) {
                    console.error('Error opening CMM file and navigating to line:', error);
                }
            });
        });

        messagesContainer.appendChild(messageDiv);
    }

    // Helper method to navigate to a specific line in Monaco Editor
    goToLine(lineNumber) {
        // Get the active editor from EditorManager
        const activeEditor = EditorManager.activeEditor;
        if (!activeEditor) {
            console.warn('No active editor found');
            return;
        }

        // Ensure line number is valid
        const model = activeEditor.getModel();
        if (!model) {
            console.warn('No model found in active editor');
            return;
        }

        const totalLines = model.getLineCount();
        const targetLine = Math.max(1, Math.min(lineNumber, totalLines));

        // Set cursor position to the beginning of the target line
        activeEditor.setPosition({
            lineNumber: targetLine,
            column: 1
        });

        // Center the line in the viewport
        activeEditor.revealLineInCenter(targetLine);

        // Focus the editor
        activeEditor.focus();

        // Optional: Select the entire line
        activeEditor.setSelection({
            startLineNumber: targetLine,
            startColumn: 1,
            endLineNumber: targetLine,
            endColumn: model.getLineMaxColumn(targetLine)
        });
    }

    createLogEntry(terminal, text, type, timestamp) {
        const logEntry = document.createElement('div');
        logEntry.classList.add('log-entry', type);

        const timestampElement = document.createElement('span');
        timestampElement.classList.add('timestamp');
        timestampElement.textContent = `[${timestamp}]`;

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        let processedText = this.makeLineNumbersClickable(text);
        processedText = processedText.replace(
            /^(Atenção|Erro|Sucesso|Info)(:)?/i, (_, word, colon) => `<strong>${word}</strong>${colon || ''}`
        );
        messageContent.innerHTML = processedText;

        logEntry.appendChild(timestampElement);
        logEntry.appendChild(messageContent);
        terminal.appendChild(logEntry);

        logEntry.style.opacity = '0';
        logEntry.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            logEntry.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            logEntry.style.opacity = '1';
            logEntry.style.transform = 'translateY(0)';
        });
    }

    setupGoDownButton() {
        const goDownButton = document.getElementById('godown-terminal');
        const goUpButton = document.getElementById('goup-terminal');

        if (!goDownButton && !goUpButton) return;

        let isScrolling = false;
        let animationFrameId = null;
        const STEP = 200;

        const startScrolling = (direction, e) => {
            if (e.type === 'touchstart') e.preventDefault();
            if (isScrolling) return;
            isScrolling = true;

            const activeTab = document.querySelector('.terminal-tabs .tab.active');
            if (!activeTab) return;
            const termId = activeTab.getAttribute('data-terminal');
            const terminal = this.terminals[termId];
            if (!terminal) return;

            const scrollLoop = () => {
                if (!isScrolling) return;

                const maxScroll = terminal.scrollHeight - terminal.clientHeight;
                let next = terminal.scrollTop + direction;
                next = Math.max(0, Math.min(next, maxScroll));
                terminal.scrollTop = next;

                if ((direction > 0 && next < maxScroll) || (direction < 0 && next > 0)) {
                    animationFrameId = requestAnimationFrame(scrollLoop);
                } else {
                    isScrolling = false;
                }
            };

            animationFrameId = requestAnimationFrame(scrollLoop);
        };

        const stopScrolling = () => {
            cancelAnimationFrame(animationFrameId);
            isScrolling = false;
        };

        if (goDownButton) {
            goDownButton.addEventListener('mousedown', e => startScrolling(+STEP, e));
            goDownButton.addEventListener('touchstart', e => startScrolling(+STEP, e), {
                passive: false
            });
        }
        if (goUpButton) {
            goUpButton.addEventListener('mousedown', e => startScrolling(-STEP, e));
            goUpButton.addEventListener('touchstart', e => startScrolling(-STEP, e), {
                passive: false
            });
        }

        document.addEventListener('mouseup', stopScrolling);
        document.addEventListener('touchend', stopScrolling);
        document.addEventListener('mouseleave', stopScrolling);
        document.addEventListener('touchcancel', stopScrolling);
    }

    setupClearButton() {
        const clearButton = document.getElementById('clear-terminal');

        clearButton.removeEventListener('click', this.handleClearClick);
        clearButton.removeEventListener('contextmenu', this.handleClearContextMenu);

        this.handleClearClick = (event) => {
            if (event.button === 0) {
                const icon = clearButton.querySelector('i');
                if (icon.classList.contains('fa-trash-can')) {
                    const activeTab = document.querySelector('.terminal-tabs .tab.active');
                    if (activeTab) {
                        const terminalId = activeTab.getAttribute('data-terminal');
                        this.clearTerminal(terminalId);
                    }
                } else if (icon.classList.contains('fa-dumpster')) {
                    this.clearAllTerminals();
                }
            }
        };

        this.handleClearContextMenu = (event) => {
            event.preventDefault();
            if (event.button === 2) {
                setTimeout(() => {
                    this.changeClearIcon(clearButton);
                }, 50);
            }
        };

        clearButton.addEventListener('click', this.handleClearClick);
        clearButton.addEventListener('contextmenu', this.handleClearContextMenu);
    }

    setupAutoScroll() {
        const config = {
            childList: true,
            subtree: true
        };

        Object.entries(this.terminals)
            .forEach(([id, terminal]) => {
                const observer = new MutationObserver(() => this.scrollToBottom(id));
                if (terminal) {
                    observer.observe(terminal, config);
                }
            });
    }

    scrollToBottom(terminalId) {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        requestAnimationFrame(() => {
            terminal.scrollTop = terminal.scrollHeight;

            setTimeout(() => {
                terminal.scrollTop = terminal.scrollHeight;
            }, 100);
        });
    }

    clearTerminal(terminalId) {
        const terminal = this.terminals[terminalId];
        if (terminal) {
            terminal.innerHTML = '';
            this.currentSessionCards[terminalId] = {};
        }
    }

    clearAllTerminals() {
        Object.keys(this.terminals)
            .forEach(terminalId => {
                this.clearTerminal(terminalId);
            });
    }

    changeClearIcon(clearButton) {
        const icon = clearButton.querySelector('i');
        if (icon.classList.contains('fa-trash-can')) {
            icon.classList.remove('fa-trash-can');
            icon.classList.add('fa-dumpster');
            clearButton.setAttribute('titles', 'Clear All Terminals');
        } else {
            icon.classList.remove('fa-dumpster');
            icon.classList.add('fa-trash-can');
            clearButton.setAttribute('titles', 'Clear Terminal');
        }
    }

    formatOutput(text) {
        return text
            .split('\n')
            .map(line => {
                const indent = line.match(/^\s*/)[0].length;
                const indentSpaces = '&nbsp;'.repeat(indent);
                return indentSpaces + line.trim();
            })
            .join('<br>');
    }
}

// VVPProgressManager class - A modern, refactored version with completion logic.
class VVPProgressManager {
    constructor() {
        this.overlay = null;
        this.progressFill = null;
        this.progressPercentage = null;
        this.elapsedTimeElement = null;
        this.elapsedTimeMinimizedElement = null; // New element for minimized view
        this.isVisible = false;
        this.isMinimized = false;
        this.isComplete = false;
        this.progressPath = null;
        this.startTime = null;
        this.currentProgress = 0;
        this.targetProgress = 0;
        this.animationFrame = null;
        this.readInterval = null;
        this.timeUpdateInterval = null;
        this.minimizeTimeout = null;

        // Configuration
        this.interpolationSpeed = 0.08;
        this.readIntervalMs = 1000;
        this.autoMinimizeDelayMs = 5000;
        this.completionDelayMs = 3000; // Time to show green bar before hiding
    }

    async resolveProgressPath(name) {
        const toggleBtn = document.getElementById('toggle-ui');
        const useFlat = toggleBtn && toggleBtn.classList.contains('active');

        if (useFlat) {
            return await window.electronAPI.joinPath('saphoComponents', 'Temp', 'progress.txt');
        } else {
            return await window.electronAPI.joinPath('saphoComponents', 'Temp', name, 'progress.txt');
        }
    }

    async deleteProgressFile(name) {
        try {
            const pathToDelete = await this.resolveProgressPath(name);
            if (await window.electronAPI.fileExists(pathToDelete)) {
                await window.electronAPI.deleteFileOrDirectory(pathToDelete);
            }
            return true;
        } catch (err) {
            console.error('Failed to delete progress file:', err);
            return false;
        }
    }

    async show(name) {
        if (this.isVisible) return;

        try {
            await this.deleteProgressFile(name);
            this.progressPath = await this.resolveProgressPath(name);

            if (!this.overlay) this.createOverlay();

            // Reset state for a new run
            this.currentProgress = 0;
            this.targetProgress = 0;
            this.startTime = Date.now();
            this.isMinimized = false;
            this.isComplete = false;
            this.overlay.querySelector('.vvp-progress-info').classList.remove('vvp-complete');
            this.updateUI();

            this.overlay.classList.add('vvp-progress-visible');
            this.isVisible = true;

            this.resetMinimizeTimeout();

            this.startProgressReading();
            this.startAnimationLoop();
            this.startTimeCounter();

        } catch (error) {
            console.error('Error showing VVP progress:', error);
        }
    }

    hide() {
        if (!this.isVisible) return;
        this.isVisible = false;

        clearTimeout(this.minimizeTimeout);
        clearInterval(this.readInterval);
        clearInterval(this.timeUpdateInterval);
        cancelAnimationFrame(this.animationFrame);

        this.minimizeTimeout = null;
        this.readInterval = null;
        this.timeUpdateInterval = null;
        this.animationFrame = null;

        if (this.overlay) {
            this.overlay.classList.remove('vvp-progress-visible');
        }
    }

    minimize() {
        if (!this.overlay || this.isMinimized) return;
        this.isMinimized = true;
        this.overlay.classList.add('minimized');
        clearTimeout(this.minimizeTimeout);
    }

    maximize() {
        if (!this.overlay || !this.isMinimized) return;
        this.isMinimized = false;
        this.overlay.classList.remove('minimized');
        this.resetMinimizeTimeout();
    }

    resetMinimizeTimeout() {
        clearTimeout(this.minimizeTimeout);
        this.minimizeTimeout = setTimeout(() => this.minimize(), this.autoMinimizeDelayMs);
    }

    createOverlay() {
        const overlayHTML = `
      <div class="vvp-progress-overlay">
        <div class="vvp-progress-info">
          <div class="vvp-progress-header">
            <div class="vvp-progress-title">
              <div class="icon-spinner"></div>
              <span>VVP Simulation</span>
            </div>
            <div class="vvp-progress-controls">
              <button class="vvp-progress-control-btn" id="vvp-minimize-btn" title="Minimize">
                <i class="fas fa-minus"></i>
              </button>
              <button class="vvp-progress-control-btn" id="vvp-maximize-btn" title="Maximize">
                <i class="fas fa-clone"></i>
              </button>
            </div>
          </div>
          
          <div class="vvp-progress-bar-wrapper">
            <div class="vvp-progress-bar">
              <div class="vvp-progress-fill" id="vvp-progress-fill"></div>
            </div>
            <div class="vvp-progress-percentage" id="vvp-progress-percentage">0%</div>
            <span class="vvp-progress-time-minimized" id="vvp-time-minimized">0s</span>
          </div>
          
          <div class="vvp-progress-stats">
            <div class="vvp-stat">
              <span class="vvp-stat-label">Elapsed Time:</span>
              <span class="vvp-stat-value" id="vvp-elapsed-time">0s</span>
            </div>
          </div>
        </div>
      </div>
    `;

        const targetElement = document.getElementById('terminal-twave') || document.body;
        targetElement.insertAdjacentHTML(targetElement.id === 'terminal-twave' ? 'afterend' : 'beforeend', overlayHTML);

        this.overlay = document.querySelector('.vvp-progress-overlay');
        this.progressFill = document.getElementById('vvp-progress-fill');
        this.progressPercentage = document.getElementById('vvp-progress-percentage');
        this.elapsedTimeElement = document.getElementById('vvp-elapsed-time');
        this.elapsedTimeMinimizedElement = document.getElementById('vvp-time-minimized');

        document.getElementById('vvp-minimize-btn')?.addEventListener('click', (e) => { e.stopPropagation(); this.minimize(); });
        document.getElementById('vvp-maximize-btn')?.addEventListener('click', (e) => { e.stopPropagation(); this.maximize(); });
    }

    async startProgressReading() {
        const readProgress = async () => {
            if (!this.isVisible) return;
            try {
                if (await window.electronAPI.fileExists(this.progressPath)) {
                    const content = await window.electronAPI.readFile(this.progressPath);
                    const lines = content.split('\n').filter(line => line.trim());
                    if (lines.length > 0) {
                        const progress = parseInt(lines[lines.length - 1].trim(), 10);
                        if (!isNaN(progress) && progress >= 0) {
                            this.targetProgress = Math.min(progress, 100);
                            if (this.targetProgress >= 100) {
                                clearInterval(this.readInterval);
                                this.readInterval = null;
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error reading progress file:', error);
                clearInterval(this.readInterval);
            }
        };

        await readProgress();
        if (this.targetProgress < 100) {
            this.readInterval = setInterval(readProgress, this.readIntervalMs);
        }
    }

    startAnimationLoop() {
        const animate = () => {
            if (!this.isVisible) return;
            const diff = this.targetProgress - this.currentProgress;
            if (Math.abs(diff) > 0.01) {
                this.currentProgress += diff * this.interpolationSpeed;
            } else if (this.targetProgress === 100) {
                this.currentProgress = 100;
            }
            this.updateUI();

            if (this.currentProgress >= 99.9 && !this.isComplete) {
                this.handleCompletion();
                return;
            }

            if (!this.isComplete) {
                this.animationFrame = requestAnimationFrame(animate);
            }
        };
        this.animationFrame = requestAnimationFrame(animate);
    }
    
    handleCompletion() {
        this.isComplete = true;
        this.currentProgress = 100;
        this.updateUI(); // Final UI update to show 100%

        this.overlay.querySelector('.vvp-progress-info').classList.add('vvp-complete');
        
        clearTimeout(this.minimizeTimeout); // Stop auto-minimize on complete
        clearInterval(this.timeUpdateInterval); // Stop time counter
        
        setTimeout(() => this.hide(), this.completionDelayMs);
    }

    startTimeCounter() {
        const update = () => {
            if (!this.isVisible) return;
            const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
            const timeString = `${elapsedSeconds}s`;
            if (this.elapsedTimeElement) this.elapsedTimeElement.textContent = timeString;
            if (this.elapsedTimeMinimizedElement) this.elapsedTimeMinimizedElement.textContent = timeString;
        };
        clearInterval(this.timeUpdateInterval);
        this.timeUpdateInterval = setInterval(update, 1000);
        update();
    }

    updateUI() {
        if (!this.overlay) return;
        const displayProgress = Math.min(100, this.currentProgress);
        this.progressFill.style.width = `${displayProgress}%`;
        this.progressPercentage.textContent = `${Math.floor(displayProgress)}%`;
        this.overlay.classList.toggle('minimized', this.isMinimized);
    }
}

const vvpProgressManager = new VVPProgressManager();

// Global references and state management
let globalTerminalManager = null;
let currentCompiler = null;

// Initialize terminal manager globally
function initializeGlobalTerminalManager() {
    if (!globalTerminalManager) {
        globalTerminalManager = new TerminalManager();
    }
    return globalTerminalManager;
}

// Functions to use in your renderer.js
function showVVPProgress(name) {
    vvpProgressManager.deleteProgressFile(name);
    return vvpProgressManager.show(name);
}

function hideVVPProgress(delay = 4000) {
    setTimeout(() => {
        vvpProgressManager.hide();
    }, delay);
}

// Global flag to track compilation status
let isCompilationRunning = false;
let compilationCanceled = false;

// Adicione este event listener no seu código frontend (renderer)
document.getElementById('cancel-everything')
    .addEventListener('click', async () => {
        try {
            const result = await window.electronAPI.cancelVvpProcess();

            if (result.success) {
                // Processo foi cancelado com sucesso
                globalTerminalManager.appendToTerminal('twave', 'Compilation process canceled by user.', 'warning');
            } else {
                // Nenhum processo estava rodando
                showCardNotification('No compilation process is currently running.', 'info', 3000);
            }
        } catch (error) {
            console.error('Error canceling VVP process:', error);
            //showCardNotification('Error occurred while trying to cancel the process.', 'error', 3000);
        }
    });

// Helper functions to manage VVP process state
window.setCurrentVvpPid = function (pid) {
    currentVvpPid = pid;
    console.log(`Current VVP PID set to: ${pid}`);
};

window.setVvpRunning = function (running) {
    isVvpRunning = running;
    console.log(`VVP running state set to: ${running}`);
};

// Enhanced cancelCompilation function
function cancelCompilation() {
    if (isCompilationRunning || isVvpRunning) {
        compilationCanceled = true;
        isCompilationRunning = false;

        // Kill VVP process if running
        if (isVvpRunning && currentVvpPid) {
            killVvpProcess();
        }

        // Force enable buttons immediately on cancellation
        setCompilationButtonsState(false);

        // Display cancellation message in all terminals
        const terminals = ['tcmm', 'tasm', 'tveri', 'twave'];
        terminals.forEach(terminalId => {
            if (globalTerminalManager) {
                globalTerminalManager.appendToTerminal(terminalId, 'Compilation process canceled by user.', 'warning');
                hideVvpSpinner();
            }
        });

        showCardNotification('Compilation process has been canceled by user.', 'warning', 4000);
        console.log('Compilation canceled by user');

        endCompilation();
    } else {
        showCardNotification('No compilation process is currently running.', 'info', 3000);
    }
}

// Function to kill VVP process
async function killVvpProcess() {
    if (currentVvpPid && isVvpRunning) {
        try {
            console.log(`Attempting to kill VVP process with PID: ${currentVvpPid}`);
            await window.electronAPI.terminateProcess(currentVvpPid);
            console.log('VVP process killed successfully');

            hideVvpSpinner();

            isVvpRunning = false;
            currentVvpPid = null;

            // Also try killing by name as backup
            try {
                await window.electronAPI.terminateProcess('vvp.exe');
                console.log('Additional VVP processes killed by name');
            } catch (nameKillError) {
                // Ignore if no processes found by name
                console.log('No additional VVP processes found by name');
            }

            return true;
        } catch (error) {
            console.error('Error killing VVP process by PID:', error);

            // Fallback: try killing by process name
            try {
                await window.electronAPI.terminateProcess('vvp.exe');
                console.log('VVP process killed by name (fallback method)');

                hideVvpSpinner();
                isVvpRunning = false;
                currentVvpPid = null;

                return true;
            } catch (nameError) {
                console.error('Error killing VVP process by name:', nameError);
                return false;
            }
        }
    }
    return false;
}

// Add this to your existing keyboard event handler or create a new one
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();

        // Simulate click on the compile all button
        const compileButton = document.getElementById('allcomp');
        if (compileButton && !compileButton.disabled) {
            compileButton.click();
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const settingsBtn = document.getElementById('settings');
        if (settingsBtn && !settingsBtn.disabled) {
            settingsBtn.click();
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();

        const toggleUi = document.getElementById('toggle-ui');
        const settingsBtn = document.getElementById('settings');
        const settingsModal = document.getElementById('settings-project');

        // Se o botão "fan" estiver ativo (por exemplo, tem a classe "active")
        if (toggleUi && toggleUi.classList.contains('active')) {
            // Abre o modal de configurações do projeto
            if (settingsModal) {
                if (typeof settingsModal.showModal === 'function') {
                    settingsModal.showModal(); // para <dialog>
                } else {
                    settingsModal.classList.add('open'); // ou remova .hidden / exiba via CSS
                }
            }
        } else {
            // Caso contrário, clica no botão de settings, se não estiver desabilitado
            if (settingsBtn && !settingsBtn.disabled) {
                settingsBtn.click();
            }
        }
    }
});


// Enhanced processor configuration check
function isProcessorConfigured() {
    const processorElement = document.getElementById('processorNameID');
    if (!processorElement) {
        return false;
    }

    const processorText = processorElement.textContent || processorElement.innerText;
    return !processorText.includes('No Processor Configured');
}

// Enhanced compilation state management
function startCompilation() {
    isCompilationRunning = true;
    compilationCanceled = false;
    setCompilationButtonsState(true);

    if (!globalTerminalManager) {
        initializeGlobalTerminalManager();
    }
}

function endCompilation() {
    isCompilationRunning = false;
    compilationCanceled = false;
    setCompilationButtonsState(false);
}

function setCompilationButtonsState(disabled) {
    const buttons = [
        'cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp', 'fractalcomp',
    ];

    buttons.forEach(buttonId => {
        const button = document.getElementById(buttonId);
        if (button) {
            button.disabled = disabled;

            if (disabled) {
                button.style.cursor = 'not-allowed';
                button.style.opacity = '0.6';
                button.style.pointerEvents = 'none';
            } else {
                button.style.cursor = 'pointer';
                button.style.opacity = '1';
                button.style.pointerEvents = 'auto';
            }
        }
    });
}

// Enhanced checkCancellation function
function checkCancellation() {
    if (compilationCanceled) {
        if (globalTerminalManager) {
            const terminals = ['tcmm', 'tasm', 'tveri', 'twave'];
            terminals.forEach(terminalId => {
                globalTerminalManager.appendToTerminal(terminalId, 'Compilation interrupted by user cancellation.', 'warning');
            });
        }
        throw new Error('Compilation canceled by user');
    }
}

// Helper function to switch between terminal tabs
function switchTerminal(targetId) {
    const terminalContents = document.querySelectorAll('.terminal-content');
    terminalContents.forEach(content => content.classList.add('hidden'));

    const allTabs = document.querySelectorAll('.tab');
    allTabs.forEach(tab => tab.classList.remove('active'));

    const targetContent = document.getElementById(targetId);
    if (targetContent) {
        targetContent.classList.remove('hidden');
    }

    const activeTab = document.querySelector(`.tab[data-terminal="${targetId.replace('terminal-', '')}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
    }
}

// ADD individual button event listeners (these are missing):
document.getElementById('cmmcomp')
    .addEventListener('click', async () => {

        if (!currentProjectPath) {
            console.error('No project opened');
            return;
        }

        if (!isProcessorConfigured()) {
            showCardNotification('Please configure a processor first before C± compilation.', 'warning', 4000);
            const toggleButton = document.getElementById('toggle-ui');
            if (toggleButton) {
                const isProjectMode = toggleButton.classList.contains('active') || toggleButton.classList.contains('pressed');
                if (isProjectMode) {
                    document.getElementById('settings-project')
                        .click();
                } else {
                    document.getElementById('settings')
                        .click();
                }
            }
            return;
        }

        isCompilationRunning = true;
        compilationCanceled = false;

        try {
            startCompilation();
            const manager = initializeGlobalTerminalManager();
            manager.clearTerminal('tcmm');
            switchTerminal('terminal-tcmm');

            const compiler = new CompilationModule(currentProjectPath);
            await compiler.loadConfig();

            const activeProcessor = compiler.config.processors.find(p => p.isActive === true);
            if (!activeProcessor) {
                throw new Error("No active processor found. Please set isActive: true for one processor.");
            }

            await compiler.ensureDirectories(activeProcessor.name);
            checkCancellation();
            await compiler.cmmCompilation(activeProcessor);

            if (!compilationCanceled) {
                await refreshFileTree();
            }
        } catch (error) {
            if (!compilationCanceled) {
                console.error('C± compilation error:', error);
                showCardNotification('C± compilation failed. Check terminal for details.', 'error', 4000);
            }
        } finally {
            endCompilation();
        }
    });

document.getElementById('asmcomp')
    .addEventListener('click', async () => {

        if (!currentProjectPath) {
            console.error('No project opened');
            return;
        }

        if (!isProcessorConfigured()) {
            showCardNotification('Please configure a processor first before ASM compilation.', 'warning', 4000);
            const toggleButton = document.getElementById('toggle-ui');
            if (toggleButton) {
                const isProjectMode = toggleButton.classList.contains('active') || toggleButton.classList.contains('pressed');
                if (isProjectMode) {
                    document.getElementById('settings-project')
                        .click();
                } else {
                    document.getElementById('settings')
                        .click();
                }
            }
            return;
        }

        isCompilationRunning = true;
        compilationCanceled = false;

        try {
            startCompilation();
            const manager = initializeGlobalTerminalManager();
            manager.clearTerminal('tasm');
            switchTerminal('terminal-tasm');

            const compiler = new CompilationModule(currentProjectPath);
            await compiler.loadConfig();

            const activeProcessor = compiler.config.processors.find(p => p.isActive === true);
            if (!activeProcessor) {
                throw new Error("No active processor found. Please set isActive: true for one processor.");
            }

            // Find the most recent .asm file
            const softwarePath = await window.electronAPI.joinPath(currentProjectPath, activeProcessor.name, 'Software');
            const files = await window.electronAPI.readDir(softwarePath);
            const asmFile = files.find(file => file.endsWith('.asm'));

            if (!asmFile) {
                throw new Error('No .asm file found. Please compile C± first.');
            }

            checkCancellation();
            const asmPath = await window.electronAPI.joinPath(softwarePath, asmFile);
            const toggleButton = document.getElementById('toggle-ui');
            const isProjectMode = toggleButton.classList.contains('active') || toggleButton.classList.contains('pressed');
            const projectParam = isProjectMode ? 1 : 0;

            await compiler.asmCompilation(activeProcessor, projectParam);

            if (!compilationCanceled) {
                await refreshFileTree();
            }
        } catch (error) {
            if (!compilationCanceled) {
                console.error('ASM compilation error:', error);
                showCardNotification('ASM compilation failed. Check terminal for details.', 'error', 4000);
            }
        } finally {
            endCompilation();
        }
    });

document.getElementById('vericomp')
    .addEventListener('click', async () => {

        if (!currentProjectPath) {
            console.error('No project opened');
            return;
        }

        if (!isProcessorConfigured()) {
            showCardNotification('Please configure a processor first before Verilog compilation.', 'warning', 4000);
            const toggleButton = document.getElementById('toggle-ui');
            if (toggleButton) {
                const isProjectMode = toggleButton.classList.contains('active') || toggleButton.classList.contains('pressed');
                if (isProjectMode) {
                    document.getElementById('settings-project')
                        .click();
                } else {
                    document.getElementById('settings')
                        .click();
                }
            }
            return;
        }


        isCompilationRunning = true;
        compilationCanceled = false;

        try {
            startCompilation();
            const manager = initializeGlobalTerminalManager();
            manager.clearTerminal('tveri');
            switchTerminal('terminal-tveri');

            const compiler = new CompilationModule(currentProjectPath);
            await compiler.loadConfig();

            checkCancellation();

            const toggleButton = document.getElementById('toggle-ui');
            const isProjectMode = toggleButton.classList.contains('active') || toggleButton.classList.contains('pressed');

            if (isProjectMode) {
                // Project oriented: call iverilogProjectCompilation
                await compiler.iverilogProjectCompilation();
            } else {
                // Processor oriented: call iverilogCompilation
                const activeProcessor = compiler.config.processors.find(p => p.isActive === true);
                if (!activeProcessor) {
                    throw new Error("No active processor found. Please set isActive: true for one processor.");
                }
                await compiler.iverilogCompilation(activeProcessor);
            }

            if (!compilationCanceled) {
                await refreshFileTree();
            }
        } catch (error) {
            if (!compilationCanceled) {
                console.error('Verilog compilation error:', error);
                showCardNotification('Verilog compilation failed. Check terminal for details.', 'error', 4000);
            }
        } finally {
            endCompilation();
        }
    });

document.getElementById('wavecomp')
    .addEventListener('click', async () => {

        if (!currentProjectPath) {
            console.error('No project opened');
            return;
        }

        if (!isProcessorConfigured()) {
            showCardNotification('Please configure a processor first before running GTKWave.', 'warning', 4000);
            const toggleButton = document.getElementById('toggle-ui');
            if (toggleButton) {
                const isProjectMode = toggleButton.classList.contains('active') || toggleButton.classList.contains('pressed');
                if (isProjectMode) {
                    document.getElementById('settings-project')
                        .click();
                } else {
                    document.getElementById('settings')
                        .click();
                }
            }
            return;
        }

        isCompilationRunning = true;
        compilationCanceled = false;

        try {
            startCompilation();
            const compiler = new CompilationModule(currentProjectPath);
            await compiler.loadConfig();

            const toggleButton = document.getElementById('toggle-ui');
            const isProjectMode = toggleButton.classList.contains('active') || toggleButton.classList.contains('pressed');

            if (isProjectMode) {
                // Project oriented: run full pipeline (cmmcomp, asmcomp, iverilogprojectcomp, runprojectgtkwave)

                // Load processor configuration
                const configFilePath = await window.electronAPI.joinPath(currentProjectPath, 'processorConfig.json');
                const processorConfigExists = await window.electronAPI.pathExists(configFilePath);
                let processorConfig = null;

                if (processorConfigExists) {
                    const configContent = await window.electronAPI.readFile(configFilePath);
                    processorConfig = JSON.parse(configContent);
                }

                const manager = initializeGlobalTerminalManager();

                // 1. CMM and ASM compilation for all processors
                manager.clearTerminal('tcmm');
                switchTerminal('terminal-tcmm');

                for (const projectProcessor of compiler.projectConfig.processors) {
                    checkCancellation();

                    const configProcessor = processorConfig ?
                        processorConfig.processors.find(p => p.name === projectProcessor.type) : null;

                    if (!configProcessor) {
                        compiler.terminalManager.appendToTerminal('tcmm', `Warning: No configuration found for processor ${projectProcessor.type}`, 'warning');
                        continue;
                    }

                    const processorObj = {
                        name: projectProcessor.type,
                        type: projectProcessor.type,
                        instance: projectProcessor.instance,
                        clk: configProcessor.clk || 1000,
                        numClocks: configProcessor.numClocks || 2000,
                        testbenchFile: configProcessor.testbenchFile || 'standard',
                        gtkwFile: configProcessor.gtkwFile || 'standard',
                        cmmFile: configProcessor.cmmFile || `${projectProcessor.type}.cmm`,
                        isActive: false
                    };

                    try {
                        compiler.terminalManager.appendToTerminal('tcmm', `Processing ${projectProcessor.type}...`);
                        await compiler.ensureDirectories(projectProcessor.type);

                        // CMM compilation
                        checkCancellation();
                        const asmPath = await compiler.cmmCompilation(processorObj);

                        // ASM compilation
                        checkCancellation();
                        manager.clearTerminal('tasm');
                        switchTerminal('terminal-tasm');
                        await compiler.asmCompilation(processorObj, asmPath, 1); // project param = 1
                        switchTerminal('terminal-tcmm');

                    } catch (error) {
                        compiler.terminalManager.appendToTerminal('tcmm', `Error processing processor ${projectProcessor.type}: ${error.message}`, 'error');
                        throw error;
                    }
                }

                // 2. Verilog Project Compilation
                manager.clearTerminal('tveri');
                switchTerminal('terminal-tveri');
                checkCancellation();
                await compiler.iverilogProjectCompilation();

                // 3. Project GTKWave
                manager.clearTerminal('twave');
                switchTerminal('terminal-twave');
                checkCancellation();
                await compiler.runProjectGtkWave();

            } else {
                // Processor oriented: just call runGtkWave
                const manager = initializeGlobalTerminalManager();
                manager.clearTerminal('twave');
                switchTerminal('terminal-twave');

                const activeProcessor = compiler.config.processors.find(p => p.isActive === true);
                if (!activeProcessor) {
                    throw new Error("No active processor found. Please set isActive: true for one processor.");
                }

                checkCancellation();
                await compiler.runGtkWave(activeProcessor);
            }

            if (!compilationCanceled) {
                await refreshFileTree();
            }
        } catch (error) {
            if (!compilationCanceled) {
                console.error('GTKWave execution error:', error);
                showCardNotification('GTKWave execution failed. Check terminal for details.', 'error', 4000);
            }
        } finally {
            endCompilation();
        }
    });

document.getElementById('allcomp')
    .addEventListener('click', async () => {
        // If a processor is configured, proceed with compilation
        if (!currentProjectPath) {
            console.error('No project opened');
            return;
        }

        if (!isProcessorConfigured()) {
            showCardNotification('Please configure a processor first before compilation.', 'warning', 4000);
            const toggleButton = document.getElementById('toggle-ui');
            // Check if toggleButton exists to avoid errors in case it's not in the DOM
            if (toggleButton) {
                const isProjectMode = toggleButton.classList.contains('active') || toggleButton.classList.contains('pressed');
                if (isProjectMode) { // Project Mode
                    document.getElementById('settings-project')
                        .click();
                } else { // Processor Mode
                    document.getElementById('settings')
                        .click();
                }
            }
            return; // Stop execution if processor is not configured
        }

        isCompilationRunning = true;
        compilationCanceled = false;

        try {
            startCompilation();
            const compiler = new CompilationModule(currentProjectPath);
            await compiler.loadConfig();

            const toggleButton = document.getElementById('toggle-ui');
            const isProjectMode = toggleButton.classList.contains('active') || toggleButton.classList.contains('pressed');

            if (isProjectMode) {
                // Project oriented: cmmcomp, asmcomp, iverilogprojectcompilation, runprojectgtkwave
                await runProjectPipeline(compiler);
            } else {
                // Processor oriented: cmmcomp, asmcomp, iverilogcompilation, rungtkwave
                await runProcessorPipeline(compiler);
            }

            if (!compilationCanceled) {
                console.log('All compilations completed successfully');
                await refreshFileTree();
            }
        } catch (error) {
            if (!compilationCanceled) {
                console.error('Compilation error:', error);
                showCardNotification('Compilation failed. Check terminal for details.', 'error', 4000);
            }
        } finally {
            endCompilation();
        }
    });

// ADD these helper functions:
async function runProcessorPipeline(compiler) {
    const activeProcessor = compiler.config.processors.find(p => p.isActive === true);
    if (!activeProcessor) {
        throw new Error("No active processor found. Please set isActive: true for one processor.");
    }

    await compiler.ensureDirectories(activeProcessor.name);

    // 1. CMM Compilation
    const manager = initializeGlobalTerminalManager();
    manager.clearTerminal('tcmm');
    switchTerminal('terminal-tcmm');
    checkCancellation();
    const asmPath = await compiler.cmmCompilation(activeProcessor);

    // 2. ASM Compilation
    manager.clearTerminal('tasm');
    switchTerminal('terminal-tasm');
    checkCancellation();
    await compiler.asmCompilation(activeProcessor, 0); // project param = 0

    // 3. Verilog Compilation
    manager.clearTerminal('tveri');
    switchTerminal('terminal-tveri');
    checkCancellation();
    await compiler.iverilogCompilation(activeProcessor);

    // 4. GTKWave
    manager.clearTerminal('twave');
    switchTerminal('terminal-twave');
    checkCancellation();
    await compiler.runGtkWave(activeProcessor);
}

async function runProjectPipeline(compiler) {
    if (!compiler.projectConfig || !compiler.projectConfig.processors) {
        throw new Error('No processors defined in projectoriented.json');
    }

    // Load processor configuration
    const configFilePath = await window.electronAPI.joinPath(currentProjectPath, 'processorConfig.json');
    const processorConfigExists = await window.electronAPI.pathExists(configFilePath);
    let processorConfig = null;

    if (processorConfigExists) {
        const configContent = await window.electronAPI.readFile(configFilePath);
        processorConfig = JSON.parse(configContent);
    }

    const manager = initializeGlobalTerminalManager();

    // 1. CMM and ASM compilation for all processors
    manager.clearTerminal('tcmm');
    switchTerminal('terminal-tcmm');

    for (const projectProcessor of compiler.projectConfig.processors) {
        checkCancellation();

        const configProcessor = processorConfig ?
            processorConfig.processors.find(p => p.name === projectProcessor.type) : null;

        if (!configProcessor) {
            compiler.terminalManager.appendToTerminal('tcmm', `Warning: No configuration found for processor ${projectProcessor.type}`, 'warning');
            continue;
        }

        const processorObj = {
            name: projectProcessor.type,
            type: projectProcessor.type,
            instance: projectProcessor.instance,
            clk: configProcessor.clk || 1000,
            numClocks: configProcessor.numClocks || 2000,
            testbenchFile: configProcessor.testbenchFile || 'standard',
            gtkwFile: configProcessor.gtkwFile || 'standard',
            cmmFile: configProcessor.cmmFile || `${projectProcessor.type}.cmm`,
            isActive: false
        };

        try {
            compiler.terminalManager.appendToTerminal('tcmm', `Processing ${projectProcessor.type}...`);
            await compiler.ensureDirectories(projectProcessor.type);

            // CMM compilation
            checkCancellation();
            const asmPath = await compiler.cmmCompilation(processorObj);

            // ASM compilation
            checkCancellation();
            manager.clearTerminal('tasm');
            switchTerminal('terminal-tasm');
            await compiler.asmCompilation(processorObj, 1); // project param = 1
            switchTerminal('terminal-tcmm');

        } catch (error) {
            compiler.terminalManager.appendToTerminal('tcmm', `Error processing processor ${projectProcessor.type}: ${error.message}`, 'error');
            throw error;
        }
    }

    // 2. Verilog Project Compilation
    manager.clearTerminal('tveri');
    switchTerminal('terminal-tveri');
    checkCancellation();
    await compiler.iverilogProjectCompilation();

    // 3. Project GTKWave
    manager.clearTerminal('twave');
    switchTerminal('terminal-twave');
    checkCancellation();
    await compiler.runProjectGtkWave();
}



//WINDOW.ONLOAD ======================================================================================================================================================== ƒ
window.onload = () => {
    initMonaco();
    initAIAssistant();

    const aiButton = document.getElementById('aiButton');
    aiButton.id = 'aiAssistant';
    aiButton.addEventListener('click', toggleAIAssistant);
    /*
      // Existing event listeners
      document.getElementById('openFolderBtn').addEventListener('click', async () => {
          const result = await window.electronAPI.openFolder();
          if (result) {
              const fileTree = document.getElementById('file-tree');
              fileTree.innerHTML = '';
              renderFileTree(result.files, fileTree);
          }
      }); */
};
