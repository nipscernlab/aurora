let editor;
let openFiles = new Map();
let aiAssistantContainer = null;
let currentProvider = 'chatgpt'; // or 'claude'
let editorInstance;
let isVvpRunning = false;
let currentVvpPid = null;
let compilerInstance = null; // Store reference to your compiler class instance

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

  // Configuração aprimorada do editor
  const editor = monaco.editor.create(editorDiv, {
    theme: this.currentTheme,
    language: this.getLanguageFromPath(filePath),
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
    padding: { top: 16, bottom: 16 },
    cursorStyle: 'line',
    cursorWidth: 2,
    cursorBlinking: 'smooth',
    renderLineHighlight: 'all',
    lineNumbersMinChars: 4,
    glyphMargin: true,
    showFoldingControls: 'mouseover',
    bracketPairColorization: { enabled: true },
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
    parameterHints: { enabled: true },
    hover: { enabled: true, delay: 300 },
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
  
  this.editors.set(filePath, {
    editor: editor,
    container: editorDiv
  });

  this.setupResponsiveObserver(editor);
  this.updateOverlayVisibility();
  this.setupCursorListener(editor);

  return editor;
}

static findStates = new Map(); // Store find widget states per file

// Modified setupEnhancedFeatures method with per-tab find functionality
static setupEnhancedFeatures(editor) {
  const commands = [
    {
      key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF,
      action: () => {
        const activeFilePath = this.getActiveFilePath();
        
        // Get or create find state for this file
        if (!this.findStates.has(activeFilePath)) {
          this.findStates.set(activeFilePath, {
            isOpen: false,
            searchTerm: '',
            position: null
          });
        }
        
        const findAction = editor.getAction('actions.find');
        if (findAction) {
          findAction.run().then(() => {
            // Mark find widget as open for this file
            const state = this.findStates.get(activeFilePath);
            state.isOpen = true;
            
            setTimeout(() => {
              const input = document.querySelector('.monaco-findInput input');
              if (input) {
                // Restore previous search term if exists
                if (state.searchTerm) {
                  input.value = state.searchTerm;
                }
                input.focus();
                
                // Save search term when it changes
                input.addEventListener('input', () => {
                  state.searchTerm = input.value;
                });
              }
            }, 50);
          });
        }
      }
    },
    {
      key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH,
      action: () => editor.getAction('editor.action.startFindReplaceAction').run().then(() => {
        setTimeout(() => {
          const input = document.querySelector('.monaco-findInput input');
          if (input) input.focus();
        }, 50);
      })
    },
    {
      key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
      action: () => editor.getAction('editor.action.formatDocument').run()
    },
    {
      key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG,
      action: () => editor.getAction('editor.action.gotoLine').run()
    },
    {
      key: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP,
      action: () => editor.getAction('editor.action.quickCommand').run()
    },
    {
      key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
      action: () => editor.getAction('workbench.action.showCommands').run()
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
      action: () => editor.getAction('editor.action.goToReferences').run()
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
  // Find the currently active tab
  const activeTab = document.querySelector('.tab.active');
  return activeTab ? activeTab.dataset.file : null;
}

  static searchInAllFiles(searchTerm, options = {}) {
    const results = [];
    this.editors.forEach((editorData, filePath) => {
      const { editor } = editorData;
      const model = editor.getModel();
      
      if (model) {
        const matches = model.findMatches(
          searchTerm,
          true,
          options.isRegex || false,
          options.matchCase || false,
          options.wholeWord ? '\b' + searchTerm + '\b' : null,
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
    
    this.editors.forEach(({ editor }) => {
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
    
    // Apply to all editors
    this.editors.forEach(({editor}) => {
      editor.updateOptions({ theme: this.currentTheme });
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
      'cmm': 'c', // Changed from 'cmm' to 'c'
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

  this.editors.forEach(({editor, container}) => {
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
      
      // Clean up find state
      this.findStates.delete(filePath);
    }
    this.updateOverlayVisibility();
  }
}

// Enhanced Monaco initialization with custom themes
async function initMonaco() {
  require(['vs/editor/editor.main'], function() {
    setupCMMLanguage();
    setupASMLanguage();
    
    // Define enhanced dark theme
    monaco.editor.defineTheme('cmm-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
        { token: 'keyword.directive.cmm', foreground: '#569CD6' },
        { token: 'keyword.function.stdlib.cmm', fontStyle: 'bold', foreground: '#DCDCAA' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'operator', foreground: 'D4D4D4' },
        { token: 'operator.shift.arithmetic', fontStyle: 'bold', foreground: '#D4D4D4' },
        { token: 'delimiter', foreground: 'D4D4D4' },
        { token: 'delimiter.square.inverted', foreground: '#CE9178' }
      ],
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
      rules: [
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7c4dff', fontStyle: 'bold' },
        { token: 'keyword.directive.cmm', fontStyle: 'bold', foreground: '#0000FF' },
        { token: 'keyword.function.stdlib.cmm', fontStyle: 'bold', foreground: '#795E26' },
        { token: 'string', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
        { token: 'operator', foreground: '000000' },
        { token: 'operator.shift.arithmetic', fontStyle: 'bold', foreground: '#000000' },
        { token: 'delimiter', foreground: '000000' },
        { token: 'delimiter.square.inverted', foreground: '#A31515' }
      ],
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
    
     editorInstance = monaco.editor.create(document.getElementById('monaco-editor'), editorConfig);
    
    // Add event listeners
    if (editorInstance) {
      editorInstance.onDidChangeCursorPosition(updateCursorPosition);
      
      // Add command palette actions
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
        editorInstance.getAction('editor.action.quickCommand').run();
      });
      
      // Add find/replace shortcuts
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
        editorInstance.getAction('editor.actions.find').run();
      });
      
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
        editorInstance.getAction('editor.action.startFindReplaceAction').run();
      });
      
      // Add format document shortcut
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
        editorInstance.getAction('editor.action.formatDocument').run();
      });
      
      // Add go to line shortcut
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
        editorInstance.getAction('editor.action.gotoLine').run();
      });
    }
  });
}

function setupASMLanguage() {
  monaco.languages.register({ id: 'asm' });

  monaco.languages.setMonarchTokensProvider('asm', {
    defaultToken: '',
    tokenPostfix: '.asm',

    // Diretivas específicas do ASM
    directives: [
      'PRNAME', 'NUBITS', 'NBMANT', 'NBEXPO', 'NDSTAC',
      'SDEPTH', 'NUIOIN', 'NUIOOU', 'NUGAIN', 'FFTSIZ',
      'PIPELN',
      'array' , 'arrays', 'ITRAD'
    ],

    // Instruções do ASM
    instructions: [
        'LOD', 'P_LOD', 'LDI'    , 'ILI'   ,
        'SET', 'SET_P', 'SRF'    , 'IRF'   ,
        'PSH', 'POP'  ,
        'INN', 'OUT'  ,
        'ADD', 'S_ADD', 'F_ADD'  , 'SF_ADD',
        'MLT', 'S_MLT', 'F_MLT'  , 'SF_MLT',
        'DIV', 'S_DIV', 'F_DIV'  , 'SF_DIV',
        'MOD', 'S_MOD',
        'SGN', 'S_SGN', 'F_SGN'  , 'SF_SGN',
        'NEG', 'NEG_M', 'P_NEG_M', 'F_NEG' , 'F_NEG_M', 'PF_NEG_M',
        'ABS', 'ABS_M', 'P_ABS_M', 'F_ABS' , 'F_ABS_M', 'PF_ABS_M',
        'NRM', 'NRM_M', 'P_NRM_M', 'P_INN', 'NOP',
        'I2F', 'I2F_M', 'P_I2F_M',
        'F2I', 'F2I_M', 'P_F2I_M',
        'AND', 'S_AND', 'ORR'    , 'S_ORR' , 'XOR'    , 'S_XOR'   ,
        'INV', 'INV_M', 'P_INV_M',
        'LAN', 'S_LAN', 'LOR'    , 'S_LOR' ,
        'LIN', 'LIN_M', 'P_LIN_M',
        'LES', 'S_LES', 'F_LES'  , 'SF_LES',
        'GRE', 'S_GRE', 'F_GRE'  , 'SF_GRE',
        'EQU', 'S_EQU',
        'SHL', 'S_SHL', 'SHR'    , 'S_SHR', 'SRS'     , 'S_SRS'
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
        [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

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
        { include: '@whitespace' },

        // Operadores e símbolos
        [/[(),]/, 'delimiter'],
        [/[=<>!+\-*\/]/, 'operator'],

        [/@\w+/, 'annotation.asm'],
      ],

      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
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
      { token: 'keyword.instruction', foreground: '#569CD6', fontStyle: 'bold' },
      
      // JMP e JIZ destacados em amarelo intenso no tema escuro
      { token: 'keyword.jumpInstruction', foreground: '#FFDD00', fontStyle: 'bold' },
      
      // Diretivas mantidas em roxo/rosa
      { token: 'keyword.directive', foreground: '#C586C0', fontStyle: 'bold' },
      
      // Identificadores em um verde água mais vivo
      { token: 'type.identifier', foreground: '#56B6C2' },
      
      // Comentários em um verde mais suave
      { token: 'comment', foreground: '#7EC699' },
      
      // Números em um tom mais destacado
      { token: 'number', foreground: '#D19A66' },
      
      // Strings em um laranja suave
      { token: 'string', foreground: '#E5C07B' },
      
      // Operadores em um cinza mais claro para melhor visibilidade
      { token: 'operator', foreground: '#ABB2BF' },
      
      // Delimitadores em um tom distinto
      { token: 'delimiter', foreground: '#89DDFF' }
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
      { token: 'keyword.instruction', foreground: '#0550AE', fontStyle: 'bold' },
      
      // JMP e JIZ destacados em amarelo mais suave no tema claro
      { token: 'keyword.jumpInstruction', foreground: '#B58B00', fontStyle: 'bold' },
      
      // Diretivas mantidas em verde
      { token: 'keyword.directive', foreground: '#098658', fontStyle: 'bold' },
      
      // Identificadores em um azul esverdeado
      { token: 'type.identifier', foreground: '#229DB5' },
      
      // Comentários em um verde mais escuro para melhor contraste
      { token: 'comment', foreground: '#098658' },
      
      // Números em um laranja escuro
      { token: 'number', foreground: '#CC6633' },
      
      // Strings em um vermelho mais suave
      { token: 'string', foreground: '#A31515' },
      
      // Operadores em um cinza escuro
      { token: 'operator', foreground: '#444444' },
      
      // Delimitadores em um azul escuro
      { token: 'delimiter', foreground: '#0076C4' }
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
  monaco.languages.register({ id: 'cmm' });

  // Define CMM language configuration
  monaco.languages.setMonarchTokensProvider('cmm', {
    defaultToken: '',
    tokenPostfix: '.cmm',

    keywords: [
      'if', 'else', 'for', 'while', 'do', 'struct', 'return', 'break',
      'continue', 'switch', 'case', 'default', 'goto', 'sizeof', 'volatile',
      'typedef', 'enum', 'union', 'register', 'extern', 'inline', 'void',
      'int', 'comp', 'char', 'float', 'double', 'bool', 'long', 'short', 'signed',
      'unsigned', 'const', 'static', 'auto'
    ],

    typeKeywords: [
      'bool', 'int', 'long', 'float', 'double', 'char', 'void', 'unsigned',
      'signed', 'short'
    ],

    operators: [
      '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
      '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
      '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
      '<<=', '>>=', '>>>='
    ],

    symbols: /[=><!~?:&|+\-*\/\^%]+/,

    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    tokenizer: {
      root: [
        // CMM directives (incluindo as novas)
        [/#(USEMAC|ENDMAC|INTERPOINT|PRNAME|DATYPE|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|PIPELN|NUGAIN|FFTSIZ)/, 'keyword.directive.cmm'],

        // StdLib functions
        [/\b(in|out|norm|pset|abs|sin|cos|complex|sqrt|atan|sign|real|imag|fase)\b(?=\s*\()/, 'keyword.function.stdlib.cmm'],

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
        { include: '@whitespace' },

        // Strings
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

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
        [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
      ],

      whitespace: [
        [/[ \t\r\n]+/, 'white'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
      ],
    }
  });

  // Define tema escuro personalizado para CMM
  monaco.editor.defineTheme('cmm-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword.directive.cmm', foreground: '#569CD6' },
      { token: 'keyword.function.stdlib.cmm', fontStyle: 'bold', foreground: '#DCDCAA' },
      { token: 'operator.shift.arithmetic', fontStyle: 'bold', foreground: '#D4D4D4' },
      { token: 'delimiter.square.inverted', foreground: '#CE9178' }
    ],
    colors: {}
  });

  // Define tema claro personalizado para CMM
  monaco.editor.defineTheme('cmm-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword.directive.cmm', fontStyle: 'bold', foreground: '#0000FF' },
      { token: 'keyword.function.stdlib.cmm', fontStyle: 'bold', foreground: '#795E26' },
      { token: 'operator.shift.arithmetic', fontStyle: 'bold', foreground: '#000000' },
      { token: 'delimiter.square.inverted', foreground: '#A31515' }
    ],
    colors: {}
  });
}

// Enhanced theme toggle system
let isDarkTheme = true;

function initializeTheme() {
  const savedTheme = localStorage.getItem('editorTheme');
  isDarkTheme = savedTheme ? savedTheme === 'dark' : true;
  
  // Apply theme to body immediately
  document.body.className = isDarkTheme ? 'theme-dark' : 'theme-light';
  
  const themeToggleBtn = document.getElementById('themeToggle');
  const themeIcon = themeToggleBtn?.querySelector('i');
  
  if (themeIcon) {
    themeIcon.classList.remove(isDarkTheme ? 'fa-sun' : 'fa-moon');
    themeIcon.classList.add(isDarkTheme ? 'fa-moon' : 'fa-sun');
  }
}

function toggleTheme() {
  isDarkTheme = !isDarkTheme;
  
  const themeToggleBtn = document.getElementById('themeToggle');
  const themeIcon = themeToggleBtn?.querySelector('i');
  
  if (themeIcon) {
    themeIcon.classList.remove(isDarkTheme ? 'fa-sun' : 'fa-moon');
    themeIcon.classList.add(isDarkTheme ? 'fa-moon' : 'fa-sun');
  }
  
  // Apply theme changes
  EditorManager.setTheme(isDarkTheme);
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

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
  initializeTheme();
  
  const themeToggleBtn = document.getElementById('themeToggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }
  
  // Handle window resize for responsive behavior
  window.addEventListener('resize', () => {
    if (EditorManager.editors.size > 0) {
      EditorManager.updateResponsiveSettings();
    }
  });
});

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
    const extension = filePath.split('.').pop().toLowerCase();
    return this.imageExtensions.has(extension);
  }

  // Utility method to check if file is a PDF
  static isPdfFile(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
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
      arrayBuffer = Uint8Array.from(buffer).buffer;
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
      arrayBuffer = Uint8Array.from(buffer).buffer;
    }
    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
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

      // Check if there are unsaved changes in the editor
      const hasUnsavedChanges = this.unsavedChanges.has(filePath);
      const editorContentChanged = currentEditorContent !== originalTabContent;

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
    // Save current cursor position and scroll
    const position = editor.getPosition();
    const scrollTop = editor.getScrollTop();

    // Update editor content
    editor.setValue(newContent);

    // Restore cursor position if still valid
    try {
      const model = editor.getModel();
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
      editor.setPosition({ lineNumber: 1, column: 1 });
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
    const fileName = filePath.split(/[\\/]/).pop();
    
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
        // Replace editor content with disk content
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
    const fileName = filePath.split(/[\\/]/).pop();
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
        const lineCount = editor.getModel().getLineCount();
        const restoredPosition = {
          lineNumber: Math.min(position.lineNumber, lineCount),
          column: Math.min(position.column, editor.getModel().getLineLength(Math.min(position.lineNumber, lineCount)) + 1)
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
    broomIcon.title = 'Code Refactoring';
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
    return Array.from(tabsContainer.children).indexOf(tab);
  };

  // Find drop position based on mouse coordinates
  const getDropPosition = (x, y) => {
    const tabs = Array.from(tabsContainer.querySelectorAll('.tab:not(.dragging)'));
    
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const rect = tab.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      
      if (x < midpoint) {
        return { index: i, side: 'left', tab };
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
    tabsContainer.querySelectorAll('.tab').forEach(tab => {
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
  tabsContainer.querySelectorAll('.tab').forEach(addTabListeners);

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

  observer.observe(tabsContainer, { childList: true });

  // Store observer reference for cleanup
  this.tabObserver = observer;
}

// Method to save tab order (already exists in your code, keeping for reference)
static saveTabOrder() {
  const tabOrder = this.getTabOrder();
  localStorage.setItem('editorTabOrder', JSON.stringify(tabOrder));
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
      ).join('<span class="context-path-separator">/</span>');

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
      html += `<i class="fa-solid fa-broom context-refactor-button toolbar-button" title="Code Refactoring" style="margin-left: auto; cursor: pointer;"></i>`;
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
    document.querySelectorAll('.file-tree-item').forEach(item => {
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
            folderItem.querySelector('.folder-icon')?.classList.add('expanded');
            const folderPath = folderItem.getAttribute('data-path');
            if (folderPath) {
              FileTreeState.expandedFolders.add(folderPath);
            }
          }
        }
        parent = parent.parentElement;
      }
      
      // Scroll the file item into view
      fileItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }


  // Helper method to determine insertion point
  static getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.tab:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
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
  const extension = filename.split('.').pop().toLowerCase();
  
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
      await window.electronAPI.writeFile(currentPath, content);
      this.markFileAsSaved(currentPath);
      
      // Update the content in tabs map to reflect saved content
      this.tabs.set(currentPath, content);
    } catch (error) {
      console.error('Error saving file:', error);
      // Optional: Show error dialog to user
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
        // Create undo stop before saving
        editor.pushUndoStop();
        
        await window.electronAPI.writeFile(filePath, currentContent);
        this.markFileAsSaved(filePath);
        this.tabs.set(filePath, currentContent);
        
        // Create undo stop after saving
        editor.pushUndoStop();
        
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
      const fileName = filePath.split(/[\\/]/).pop();
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
                const { filePath, content } = closedTab;

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
                const fileName = filePath.split(/[\\/]/).pop();
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
    
    // Create a save point in the undo stack before saving
    currentEditor.pushUndoStop();
    
    await window.electronAPI.writeFile(currentPath, content);
    
    // Mark as saved and update stored content
    this.markFileAsSaved(currentPath);
    this.tabs.set(currentPath, content);
    
    // Create another undo stop after saving to preserve undo history
    currentEditor.pushUndoStop();
    
  } catch (error) {
    console.error('Error saving file:', error);
    throw error;
  }
}

            // Fixed reopenLastClosedTab method
            static async reopenLastClosedTab() {
                if (this.closedTabsStack.length === 0) return;

                const closedTab = this.closedTabsStack.pop();
                const { filePath, content } = closedTab;

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
            'hpp': 'cpp'
        };
        const language = languageMap[extension] || 'plaintext';

        // Atualiza o modelo do Monaco Editor com o novo conteúdo e linguagem
        editor.getModel()?.dispose();
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

// Add CSS for drag and drop
const tabDragStyles = document.createElement('style');
tabDragStyles.textContent = `
  .tab.dragging {
    opacity: 0.5;
  }

  .tab {
    user-select: none;
    transition: opacity 0.2s ease;
  }
`;
document.head.appendChild(tabDragStyles);


// Atualizar o CSS para usar as variáveis de tema
const contextPathStyles = document.createElement('style');
contextPathStyles.textContent = `
  .context-path-container {
    padding: 6px 12px;
    font-size: 0.85em;
    color: var(--text-secondary);
    background-color: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    overflow: hidden;
    white-space: nowrap;
    font-family: var(--font-sans);
  }

  .context-path-container i {
    font-size: 0.9em;
    color: var(--icon-secondary);
  }

  .context-path-segment {
    color: var(--text-secondary);
    transition: color 0.2s ease;
  }

  .context-path-segment:hover {
    color: var(--text-primary);
  }

  .context-path-separator {
    color: var(--text-muted);
    margin: 0 2px;
    user-select: none;
  }

  .context-path-filename {
    color: var(--text-primary);
    font-weight: 500;
  }

  /* Esconder o container quando não há arquivos abertos */
  .context-path-container.empty {
    display: none;
  }

  /* Adicionar uma sutil animação de fade quando muda o arquivo */
  .context-path-container:not(.empty) {
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;
document.head.appendChild(contextPathStyles);

// Atualizar a função de inicialização do contexto
function initContextPath() {
  const editorContainer = document.getElementById('monaco-editor').parentElement;
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
  
  const editorContainer = document.getElementById('monaco-editor').parentElement;
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


  // Add save button click handler
  document.getElementById('saveFileBtn').addEventListener('click', () => {
    TabManager.saveCurrentFile();
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

// Enhanced Code Formatter Implementation
// Add this to your TabManager class or create a separate CodeFormatter class

class CodeFormatter {
  static async formatCode(code, filePath) {
    if (!code || !filePath) {
      throw new Error('Code and file path are required');
    }

    const fileExtension = this.getFileExtension(filePath);
    const formatter = this.getFormatterForExtension(fileExtension);

    if (!formatter) {
      throw new Error(`No formatter available for file type: ${fileExtension}`);
    }

    try {
      const formattedCode = await this.executeFormatter(formatter, code, fileExtension);
      return formattedCode;
    } catch (error) {
      console.error('Formatting error:', error);
      throw new Error(`Failed to refact code: ${error.message}`);
    }
  }

  static getFileExtension(filePath) {
    return filePath.split('.').pop().toLowerCase();
  }

  static getFormatterForExtension(extension) {
    const formatters = {
      'v': 'verible',      // Verilog
      'sv': 'verible',     // SystemVerilog  
      'vh': 'verible',     // Verilog Header
      'svh': 'verible',    // SystemVerilog Header
      'c': 'astyle',       // C
      'cpp': 'astyle',     // C++
      'cc': 'astyle',      // C++
      'cxx': 'astyle',     // C++
      'h': 'astyle',       // C Header
      'hpp': 'astyle',     // C++ Header
      'hxx': 'astyle',     // C++ Header
      'java': 'astyle',    // Java
      'cs': 'astyle',      // C#
      'js': 'astyle',      // JavaScript (basic formatting)
      'cmm': 'astyle',      // JavaScript (basic formatting)
    };

    return formatters[extension];
  }

  static async executeFormatter(formatter, code, extension) {
    switch (formatter) {
      case 'verible':
        return await this.formatWithVerible(code);
      case 'astyle':
        return await this.formatWithAstyle(code, extension);
      default:
        throw new Error(`Unknown formatter: ${formatter}`);
    }
  }

  static async formatWithVerible(code) {
    try {
      // Get the packages path
      const packagesPath = await window.electronAPI.joinPath('saphoComponents', 'Packages');
      const veriblePath = await window.electronAPI.joinPath(packagesPath, 'verible', 'verible-verilog-format.exe');
      
      // Create temporary file path
      const tempDir = await window.electronAPI.joinPath(packagesPath, 'temp');
      const tempFilePath = await window.electronAPI.joinPath(tempDir, `temp_${Date.now()}.v`);
      
      // Ensure temp directory exists
      await window.electronAPI.createDirectory(tempDir);
      
      // Write code to temporary file
      await window.electronAPI.writeFile(tempFilePath, code);
      
      // Execute verible formatter
      const command = `"${veriblePath}" --inplace "${tempFilePath}"`;
      const result = await window.electronAPI.execCommand(command);
      
      if (result.error && result.code !== 0) {
        // If inplace formatting failed, try standard output
        const stdCommand = `"${veriblePath}" "${tempFilePath}"`;
        const stdResult = await window.electronAPI.execCommand(stdCommand);
        
        if (stdResult.error) {
          throw new Error(`Verible formatting failed: ${stdResult.stderr || stdResult.error}`);
        }
        
        return stdResult.stdout || code;
      }
      
      // Read the formatted file
      const formattedCode = await window.electronAPI.readFile(tempFilePath);
      
      // Clean up temporary file
      try {
        await window.electronAPI.deleteFileOrDirectory(tempFilePath);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp file:', cleanupError);
      }
      
      return formattedCode;
      
    } catch (error) {
      console.error('Verible formatting error:', error);
      throw error;
    }
  }

  static async formatWithAstyle(code, extension) {
    try {
      // Get the packages path
      const packagesPath = await window.electronAPI.joinPath('saphoComponents', 'Packages');
      const astylePath = await window.electronAPI.joinPath(packagesPath, 'astyle', 'astyle.exe');
      
      // Create temporary file path
      const tempDir = await window.electronAPI.joinPath(packagesPath, 'temp');
      const tempFilePath = await window.electronAPI.joinPath(tempDir, `temp_${Date.now()}.${extension}`);
      
      // Ensure temp directory exists
      await window.electronAPI.createDirectory(tempDir);
      
      // Write code to temporary file
      await window.electronAPI.writeFile(tempFilePath, code);
      
      // Build astyle command with appropriate options
      const astyleOptions = this.getAstyleOptions(extension);
      const command = `"${astylePath}" ${astyleOptions} "${tempFilePath}"`;
      
      // Execute astyle formatter
      const result = await window.electronAPI.execCommand(command);
      
      if (result.error && result.code !== 0) {
        throw new Error(`Astyle formatting failed: ${result.stderr || result.error}`);
      }
      
      // Read the formatted file
      const formattedCode = await window.electronAPI.readFile(tempFilePath);
      
      // Clean up temporary files (astyle creates .orig backup)
      try {
        await window.electronAPI.deleteFileOrDirectory(tempFilePath);
        await window.electronAPI.deleteFileOrDirectory(tempFilePath + '.orig');
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp files:', cleanupError);
      }
      
      return formattedCode;
      
    } catch (error) {
      console.error('Astyle formatting error:', error);
      throw error;
    }
  }

  static getAstyleOptions(extension) {
    // Base options for all file types
    let options = [
      '--style=allman',        // Allman/BSD/ANSI style
      '--indent=spaces=4',     // 4-space indentation
      '--indent-switches',     // Indent switch cases
      '--indent-cases',        // Indent case statements
      '--indent-namespaces',   // Indent namespaces
      '--indent-labels',       // Indent labels
      '--pad-oper',           // Pad operators with spaces
      '--pad-comma',          // Pad commas with spaces
      '--pad-header',         // Pad headers
      '--unpad-paren',        // Remove padding around parentheses
      '--align-pointer=type', // Align pointers to type
      '--align-reference=type', // Align references to type
      '--break-closing-brackets', // Break closing brackets
      '--convert-tabs',       // Convert tabs to spaces
      '--max-code-length=100', // Maximum line length
      '--break-after-logical', // Break after logical operators
    ];
    
    // Language-specific options
    switch (extension) {
      case 'java':
        options.push('--mode=java');
        break;
      case 'cs':
        options.push('--mode=cs');
        break;
      case 'js':
        options.push('--mode=java'); // Use Java mode for basic JS formatting
        break;
      default:
        options.push('--mode=c'); // Default to C/C++ mode
        break;
    }
    
    return options.join(' ');
  }
}


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
            modal.querySelector('.confirm-btn.save').focus();
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

// Add this CSS to style the highlighted file
const highlightStyles = document.createElement('style');
highlightStyles.textContent = `
  .file-tree-item.active {
    border-left: 3px solid var(--accent-primary);
  }
  
  .file-tree-item.active span {
    font-weight: 600;
  }
`;
document.head.appendChild(highlightStyles);

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
        await window.electronAPI.setCurrentProject(currentProjectPath);
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
        fileTree.style.transition = 'opacity 0.3s ease';
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

function showCardNotification(message, type = 'info', duration = 3000) {
  // Crie um container para as notificações, se não existir
  let cardContainer = document.getElementById('card-notification-container');
  if (!cardContainer) {
    cardContainer = document.createElement('div');
    cardContainer.id = 'card-notification-container';
    cardContainer.style.position = 'fixed';
    cardContainer.style.bottom = '20px';
    cardContainer.style.left = '20px';
    cardContainer.style.maxWidth = '100%';
    cardContainer.style.width = '350px';
    cardContainer.style.zIndex = 'var(--z-max)';
    cardContainer.style.display = 'flex';
    cardContainer.style.flexDirection = 'column-reverse'; // Novas notificações aparecem embaixo
    cardContainer.style.gap = 'var(--space-3)';
    
    // Torna responsivo em telas pequenas
    const mediaQuery = `
      @media (max-width: 480px) {
        #card-notification-container {
          width: calc(100% - 40px) !important;
          left: 20px !important;
          bottom: 10px !important;
        }
      }
    `;
    const style = document.createElement('style');
    style.textContent = mediaQuery;
    document.head.appendChild(style);
    
    document.body.appendChild(cardContainer);
  }
  
  // Verificar se o FontAwesome está carregado, caso contrário, carregar
  if (!document.querySelector('link[href*="fontawesome"]')) {
    const fontAwesomeLink = document.createElement('link');
    fontAwesomeLink.rel = 'stylesheet';
    fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css';
    document.head.appendChild(fontAwesomeLink);
  }
  
  // Definir aparência e ícone com base no tipo
  let iconClass, accentColor, title;
  
  switch (type) {
    case 'error':
      iconClass = 'fa-bolt';
      accentColor = 'var(--error)';
      title = 'Error';
      break;
    case 'success':
      iconClass = 'fa-check-double';
      accentColor = 'var(--success)';
      title = 'Success';
      break;
    case 'warning':
      iconClass = 'fa-bell';
      accentColor = 'var(--warning)';
      title = 'Warning';
      break;
    default: // info
      iconClass = 'fa-info';
      accentColor = 'var(--info)';
      title = 'Information';
      break;
  }
  
  // Criar o cartão de notificação
  const card = document.createElement('div');
  card.style.backgroundColor = 'var(--bg-secondary)';
  card.style.color = 'var(--text-primary)';
  card.style.borderRadius = 'var(--radius-lg)';
  card.style.boxShadow = 'var(--shadow-lg)';
  card.style.overflow = 'hidden';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.opacity = '0';
  card.style.transform = 'translateY(20px) scale(0.95)';
  card.style.transition = 'var(--transition-normal)';
  
  // Conteúdo do cartão
  card.innerHTML = `
    <div style="display: flex; padding: var(--space-4); gap: var(--space-4); position: relative;">
      <div style="
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: var(--radius-full);
        background-color: ${accentColor};
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: var(--text-lg);
      ">
        <i class="fa-solid ${iconClass}"></i>
      </div>
      
      <div style="flex-grow: 1;">
        <div style="font-weight: var(--font-semibold); margin-bottom: var(--space-1); font-size: var(--text-base);">
          ${title}
        </div>
        <div style="font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-relaxed);">
          ${message}
        </div>
      </div>
      
      <div class="close-btn" style="
        position: absolute;
        top: var(--space-4);
        right: var(--space-4);
        cursor: pointer;
        width: 24px;
        height: 24px;
        border-radius: var(--radius-full);
        background-color: var(--bg-hover);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: var(--transition-fast);
      ">
        <i class="fa-solid fa-xmark" style="font-size: var(--text-sm);"></i>
      </div>
    </div>
    
    <div class="progress-container" style="
      width: 100%;
      height: 4px;
      background-color: var(--bg-hover);
      overflow: hidden;
    ">
      <div class="progress-bar" style="
        height: 100%;
        width: 100%;
        background-color: ${accentColor};
        transform-origin: left;
        transform: scaleX(1);
      "></div>
    </div>
  `;
  
  // Adicionar efeito hover ao botão fechar
  const closeBtn = card.querySelector('.close-btn');
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.backgroundColor = 'var(--bg-active)';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.backgroundColor = 'var(--bg-hover)';
  });
  
  // Anexar ao container
  cardContainer.appendChild(card);
  
  // Animação de entrada
  requestAnimationFrame(() => {
    card.style.opacity = '1';
    card.style.transform = 'translateY(0) scale(1)';
  });
  
  // Configurar barra de progresso
  const progressBar = card.querySelector('.progress-bar');
  progressBar.style.transition = `transform ${duration}ms linear`;
  
  // Iniciar a contagem regressiva
  setTimeout(() => {
    progressBar.style.transform = 'scaleX(0)';
  }, 10);
  
  // Configurar botão de fechar
  closeBtn.addEventListener('click', () => closeCard(card));
  
  // Fechar automaticamente após a duração
  const timeoutId = setTimeout(() => closeCard(card), duration);
  
  // Pausar o tempo quando passar o mouse por cima
  card.addEventListener('mouseenter', () => {
    progressBar.style.transitionProperty = 'none';
    clearTimeout(timeoutId);
  });
  
  // Continuar quando tirar o mouse
  card.addEventListener('mouseleave', () => {
    const remainingTime = duration * (parseFloat(getComputedStyle(progressBar).transform.split(', ')[0].split('(')[1]) || 0);
    if (remainingTime > 0) {
      progressBar.style.transition = `transform ${remainingTime}ms linear`;
      progressBar.style.transform = 'scaleX(0)';
      setTimeout(() => closeCard(card), remainingTime);
    } else {
      closeCard(card);
    }
  });
  
  // Função para fechar o cartão com animação
  function closeCard(element) {
    element.style.opacity = '0';
    element.style.transform = 'translateY(20px) scale(0.95)';
    
    setTimeout(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
        
        // Remover o container se não houver mais cartões
        if (cardContainer.children.length === 0) {
          cardContainer.remove();
        }
      }
    }, 300);
  }
  
  // Retornar um identificador que permite fechar o cartão programaticamente
  return {
    close: () => closeCard(card)
  };
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
    const extension = file.name.split('.').pop().toLowerCase();
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
      const extension = file.name.split('.').pop().toLowerCase();
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

const toggleFolder = () => {
  const isExpanded = !childContainer.classList.contains('hidden');
  childContainer.classList.toggle('hidden');
  folderToggle.classList.toggle('rotated');
  icon.classList.toggle('fa-folder');
  icon.classList.toggle('fa-folder-open');

  // Se quiser um efeito mais suave de altura (slide)
  if (!isExpanded) {
    childContainer.style.maxHeight = childContainer.scrollHeight + 'px';
  } else {
    childContainer.style.maxHeight = '0px';
  }

  FileTreeState.toggleFolder(filePath, !isExpanded);
};


// Função para monitorar mudanças na pasta com debounce
let watcherTimeout = null;
const REFRESH_DELAY = 100; // Delay em ms entre atualizações

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
let pollingInterval = null;

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

// Função para monitorar mudanças na pasta
async function setupFileWatcher() {
  if (!currentProjectPath) {
    console.warn('No project is currently open');
    return;
  }

  try {
    // Configurar watcher usando Electron
    await window.electronAPI.watchFolder(currentProjectPath, async (eventType, filename) => {
      // Atualizar a file tree mantendo o estado
      const result = await window.electronAPI.refreshFolder(currentProjectPath);
      if (result) {
        const fileTreeContent = document.querySelector('.file-tree-content');
        if (fileTreeContent) {
          fileTreeContent.innerHTML = '';
          renderFileTree(result.files, fileTreeContent);
        }
      }
    });
  } catch (error) {
    console.error('Error setting up file watcher:', error);
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
      'hpp': 'cpp'
  };
  const language = languageMap[extension] || 'plaintext';
  editor.getModel()?.dispose();
  editor.setModel(monaco.editor.createModel(content, language));

  // Atualizar o estado da aba
  const tab = document.querySelector(`.tab[data-path="${filePath}"]`);
  if (tab) {
      // Ativar a aba clicada
      TabManager.activateTab(filePath);  // Alteração: Passe diretamente o filePath aqui
  }
}

// Show modal when "New Project" button is clicked
newProjectBtn.addEventListener('click', () => {
  newProjectModal.classList.remove('hidden');  // Remove the "hidden" class to show the modal
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
    this.createStyles();
    this.setupEventListeners();
  }

  createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* File Search Container */
      .file-search-container {
        margin-top: var(--space-3);
        padding-top: var(--space-3);
        border-top: 1px solid var(--border-secondary);
      }

      /* Search Input Wrapper */
      .search-input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-lg);
        transition: var(--transition-normal);
        overflow: hidden;
      }

      .search-input-wrapper:focus-within {
        border-color: var(--border-focus);
        box-shadow: var(--shadow-focus);
        background: var(--bg-secondary);
      }

      .search-input-wrapper:hover:not(:focus-within) {
        border-color: var(--accent-muted);
        background: var(--bg-hover);
      }

      /* Search Icon */
      .search-icon {
        position: absolute;
        left: var(--space-3);
        color: var(--text-muted);
        font-size: var(--text-sm);
        pointer-events: none;
        z-index: var(--z-10);
        transition: var(--transition-fast);
      }

      .search-input-wrapper:focus-within .search-icon {
        color: var(--accent-primary);
      }

      /* Search Input */
      .search-input {
        flex: 1;
        padding: 4px 10px 4px 40px;
        background: transparent;
        border: none;
        outline: none;
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-family: var(--font-sans);
        line-height: var(--leading-normal);
      }

      .search-input::placeholder {
        color: var(--text-muted);
        font-weight: var(--font-normal);
      }

      .search-input:focus::placeholder {
        color: var(--text-disabled);
      }

      /* Clear Search Button */
      .clear-search-btn {
        position: absolute;
        right: var(--space-2);
        width: 24px;
        height: 24px;
        background: var(--bg-hover);
        border: none;
        border-radius: var(--radius-full);
        color: var(--text-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: scale(0.8);
        transition: var(--transition-fast);
        font-size: var(--text-xs);
      }

      .clear-search-btn:hover {
        background: var(--bg-active);
        color: var(--text-primary);
        transform: scale(1);
      }

      .clear-search-btn:active {
        transform: scale(0.9);
      }

      .search-input-wrapper.has-content .clear-search-btn {
        opacity: 1;
        transform: scale(1);
      }

      /* Search Results Info */
      .search-results-info {
        margin-top: var(--space-2);
        font-size: var(--text-xs);
        color: var(--text-muted);
        text-align: center;
        min-height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .search-results-info.active {
        color: var(--text-secondary);
      }

      /* File Tree Search States */
      .file-tree.searching {
        opacity: 0.9;
      }

      .file-tree-item.search-hidden {
        display: none !important;
      }

      .file-tree-item.search-match {
        background: var(--hover-overlay);
        border-radius: var(--radius-sm);
        animation: searchHighlight 0.3s ease-out;
      }

      .file-tree-item.search-match .file-item span {
        font-weight: var(--font-medium);
        color: var(--text-primary);
      }

      .search-highlight {
        background: var(--accent-primary);
        color: var(--bg-primary);
        padding: 1px 2px;
        border-radius: var(--radius-sm);
        font-weight: var(--font-semibold);
      }

      /* Search Animation */
      @keyframes searchHighlight {
        0% {
          background: var(--accent-focus);
          transform: scale(1.02);
        }
        100% {
          background: var(--hover-overlay);
          transform: scale(1);
        }
      }

      /* Loading State */
      .search-input-wrapper.searching .search-icon {
        animation: searchSpin 1s linear infinite;
      }

      @keyframes searchSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      /* Empty State */
      .search-empty-state {
        text-align: center;
        padding: var(--space-8) var(--space-4);
        color: var(--text-muted);
        font-size: var(--text-sm);
      }

      .search-empty-state i {
        font-size: var(--text-2xl);
        margin-bottom: var(--space-3);
        opacity: 0.5;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .search-input {
          padding: var(--space-2) var(--space-8) var(--space-2) var(--space-8);
          font-size: var(--text-xs);
        }
        
        .search-icon {
          left: var(--space-2);
        }
        
        .clear-search-btn {
          right: var(--space-1);
          width: 20px;
          height: 20px;
        }
      }

      /* Focus Management */
      .file-tree-container:focus-within .search-input-wrapper {
        border-color: var(--border-focus);
      }

      /* Accessibility */
      .search-input:focus {
        outline: 2px solid transparent;
      }

      .clear-search-btn:focus {
        outline: 2px solid var(--accent-primary);
        outline-offset: 2px;
      }

      /* High Contrast Support */
      @media (prefers-contrast: high) {
        .search-input-wrapper {
          border-width: 2px;
        }
        
        .search-highlight {
          outline: 1px solid var(--text-primary);
        }
      }

      /* Animation Preferences */
      @media (prefers-reduced-motion: reduce) {
        .search-input-wrapper,
        .clear-search-btn,
        .search-icon {
          transition: none;
        }
        
        .file-tree-item.search-match {
          animation: none;
        }
        
        .search-input-wrapper.searching .search-icon {
          animation: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    document.addEventListener('DOMContentLoaded', () => {
      this.searchInput = document.getElementById('file-search-input');
      this.clearButton = document.getElementById('clear-search');
      this.resultsCounter = document.getElementById('search-results-count');

      if (!this.searchInput || !this.clearButton || !this.resultsCounter) {
        console.warn('Search elements not found');
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
    const trimmedQuery = query.trim().toLowerCase();

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
                     (filePath && filePath.toLowerCase().includes(trimmedQuery));

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
      <div style="margin-top: var(--space-2); font-size: var(--text-xs); opacity: 0.7;">
        Try a different search term
      </div>
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

//PROJECTBUTTON ======================================================================================================================================================== ƒ

let currentProjectPath = null; // Store the current project path
let currentSpfPath = null;

// Adicione um listener para mudanças no estado do projeto
window.electronAPI.onProjectStateChange((event, { projectPath, spfPath }) => {
  currentProjectPath = projectPath;
  currentSpfPath = spfPath;
  console.log('Project state updated:', { currentProjectPath, currentSpfPath });
});

// Adicionar listener para mudanças no estado do projeto
window.electronAPI.onProjectStateChange((event, { projectPath, spfPath }) => {
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

// Função para criar processador
async function createProcessor(formData) {
  try {
    // Garantir que temos o caminho do projeto
    if (!currentProjectPath) {
      throw new Error('No project path available');
    }

    // Adicionar o caminho do projeto aos dados do formulário
    const processorData = {
      ...formData,
      projectLocation: currentProjectPath
    };

    const result = await window.electronAPI.createProcessor(processorData);
    return result;
  } catch (error) {
    console.error('Error creating processor:', error);
    throw error;
  }
}

document.getElementById('open-folder-button').addEventListener('click', async () => {
    if (currentProjectPath) {
        try {
            await window.electronAPI.openFolder(currentProjectPath);
        } catch (error) {
            console.error('Error opening folder:', error);
        }
    }
}); 

document.getElementById('open-hdl-button').addEventListener('click', async () => {
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
document.getElementById('openProjectBtn').addEventListener('click', async () => {
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

document.getElementById('openProjectBtn').insertAdjacentElement('afterend', projectInfoButton);

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
    showErrorDialog('Erro ao abrir o projeto', error.message);
  }
});

// Update project info button handler
projectInfoButton.addEventListener('click', async () => {
  try {
    if (!currentSpfPath) {
      showErrorDialog('Error', 'No project is currently open');
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
    showErrorDialog('Error', 'Failed to load project information: ' + error.message);
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
    }).format(date);
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
          if (Object.keys(fileStructure).length > 0) {
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
      structureContainer.innerHTML = fileStructure.map(item => createTreeItem(item)).join('');
    } catch (error) {
      console.error('Error rendering file structure:', error);
      structureContainer.innerHTML = `<div class="aurora-modal-empty-state">Error rendering files: ${error.message}</div>`;
    }
  };
  
  // Load system information
  if (window.electronAPI && window.electronAPI.getAppInfo) {
    window.electronAPI.getAppInfo().then((info) => {
      const osInfoElement = document.getElementById('aurora-os-info');
      const nodeVersionElement = document.getElementById('aurora-node-version');
      const electronVersionElement = document.getElementById('aurora-electron-version');
      
      if (osInfoElement) osInfoElement.textContent = info.osInfo || 'Unknown';
      if (nodeVersionElement) nodeVersionElement.textContent = info.nodeVersion || 'Unknown';
      if (electronVersionElement) electronVersionElement.textContent = info.electronVersion || 'Unknown';
    }).catch((error) => {
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
  
  modalContainer.querySelector('.aurora-modal-close').addEventListener('click', closeModal);
  modalContainer.querySelector('.aurora-modal-button').addEventListener('click', closeModal);
  
  modalContainer.querySelector('.aurora-modal').addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // Trigger entrance animation
  setTimeout(() => {
    modalBackdrop.classList.add('aurora-modal-fade-in');
    modalContainer.classList.add('aurora-modal-fade-in');
  }, 10);
}

// Update loadProject function to store the current project path
async function loadProject(spfPath) {
  try {
    const result = await window.electronAPI.openProject(spfPath);
    currentProjectPath = result.projectData.structure.basePath;

    console.log('Loading project from SPF:', spfPath);
    
    // Store both paths
    currentProjectPath = result.projectData.structure.basePath;
    currentSpfPath = spfPath; // This is the actual .spf file path

    updateProjectNameUI(result.projectData);
    await TabManager.closeAllTabs();
    
    console.log('Current SPF path:', currentSpfPath);
    console.log('Current project path:', currentProjectPath);

    // Enable the processor hub button
    updateProcessorHubButton(true);
    enableCompileButtons();
    refreshFileTree();
    
    // Check if folders exist
    const missingFolders = result.projectData.structure.folders.filter(folder => !folder.exists);
    if (missingFolders.length > 0) {
      const shouldRecreate = await showConfirmDialog(
        'Missing Folders',
        'Some project folders are missing. Would you like to recreate them?'
      );
      
      if (shouldRecreate) {
        const newResult = await window.electronAPI.createStructure(
          result.projectData.structure.basePath,
          spfPath
        );
        // Update file tree with recreated structure
        updateFileTree(newResult.files);
        await TabManager.closeAllTabs();
      } else {
        // Update file tree with current structure
        updateFileTree(result.files);
      }
    } else {
      // Update file tree with current structure
      updateFileTree(result.files);
    }
    addToRecentProjects(currentSpfPath);

  } catch (error) {
    //console.error('Error loading project:', error);
    showErrorDialog('Failed to load project', error.message);
  }
}

function showErrorDialog(title, message) {
  // Você pode usar um alert simples ou implementar um modal customizado
  alert(`${title}: ${message}`);
}

function enableCompileButtons() {
  const buttons = ['cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp', 'fractalcomp', 'settings', 'backupFolderBtn', 'projectInfo', 'saveFileBtn', 'settings-project'];
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
            const lines = text.split('\n').map(line => line.trimEnd());
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



//PROCESSADOR HUB ==========================================================================================================================================================

const processorHubButton = document.createElement('button');
processorHubButton.className = 'toolbar-button';
processorHubButton.id = 'processorHub';
processorHubButton.innerHTML = '<i class="fa-solid fa-star-of-life"></i> Processor Hub';
processorHubButton.disabled = true; // Disabled by default
document.querySelector('.toolbar').appendChild(processorHubButton);

function updateProcessorHubButton(enabled) {
  processorHubButton.disabled = !enabled;
}

function createProcessorHubModal() {
  const modal = document.createElement('div');
  modal.className = 'processor-hub-container'; // Adicionando classe para facilitar a seleção
  modal.innerHTML = `
  <div class="processor-hub-overlay"></div>
  <div class="processor-hub-modal">
    <h2><i class="fa-solid fa-star-of-life"></i> Create Processor Project</h2>
    <form class="processor-hub-form" id="processorHubForm">
      <div class="form-group">
        <label for="processorName">Processor Name</label>
        <input type="text" id="processorName" name="processorName" required value="procTest_00">
      </div>

      <div class="form-group">
      <label for="nBits">Number of Bits <span class="tooltip" style="color: red;" title="Number of Bits must equal Nb Mantissa + Nb Exponent + 1">ℹ</span></label>

        <input type="number" id="nBits" required min="1" value="23">
      </div>
      <div class="form-group floating-point-options">
        <label for="nbMantissa">Number of Mantissa</label>
        <input type="number" id="nbMantissa" min="1" value="16">
      </div>
      <div class="form-group floating-point-options">
        <label for="nbExponent">Number of Exponent</label>
        <input type="number" id="nbExponent" min="1" value="6">
      </div>
      <div class="form-group">
        <label for="dataStackSize">Data Stack Size</label>
        <input type="number" id="dataStackSize" required min="1" value="5">
      </div>
      <div class="form-group">
        <label for="instructionStackSize">Instruction Stack Size</label>
        <input type="number" id="instructionStackSize" required min="1" value="5">
      </div>
      <div class="form-group">
        <label for="inputPorts">Number of Input Ports</label>
        <input type="number" id="inputPorts" required min="0" value="1">
      </div>
      <div class="form-group">
        <label for="outputPorts">Number of Output Ports</label>
        <input type="number" id="outputPorts" required min="0" value="1">
      </div>
      <div class="form-group">
        <label for="pipeln">Pipeline Level <span class="tooltip" style="color: red;" title="Pipeline level must be one of the predefined options">ℹ</span></label>
        <select id="pipeln" required>
          <option value="3" selected>3</option>
          <option value="4">4</option>
          <option value="5">5</option>
          <option value="6">6</option>
          <option value="7">7</option>
          <option value="8">8</option>
        </select>
      </div>
      <div class="form-group">
        <label for="gain">Gain <span class="tooltip" style="color: red;" title="Gain must be a power of 2">ℹ</span></label>
        <input type="number" id="gain" required step="any" value="128">
      </div>
      <div class="button-group">
        <button type="button" class="cancel-button" id="cancelProcessorHub">Cancel</button>
        <button type="submit" class="generate-button" id="generateProcessor" disabled>
          <i class="fas fa-cog"></i> Generate
        </button>
      </div>
    </form>
  </div>
`;
  return modal;
}

processorHubButton.addEventListener('click', () => {
  const modal = createProcessorHubModal();
  document.body.appendChild(modal);

  const form = document.getElementById('processorHubForm');
  const generateButton = document.getElementById('generateProcessor');
  const floatingPointOptions = document.querySelectorAll('.floating-point-options');
  const nBitsInput = document.getElementById('nBits');
  const nbMantissaInput = document.getElementById('nbMantissa');
  const nbExponentInput = document.getElementById('nbExponent');
  const gainInput = document.getElementById('gain');
  const processorNameInput = document.getElementById('processorName');

  // Verificar se o campo de nome foi encontrado
  if (!processorNameInput) {
      console.error('Processor name input field not found!');
  } else {
      console.log('Processor name input field found:', processorNameInput.value);
  }

  // Helper function to check if a number is a power of 2
  function isPowerOfTwo(value) {
      return value > 0 && (value & (value - 1)) === 0;
  }

  // Real-time validation for custom rules
  function validateCustomRules() {
      const nBits = parseInt(nBitsInput.value) || 0;
      const nbMantissa = parseInt(nbMantissaInput.value) || 0;
      const nbExponent = parseInt(nbExponentInput.value) || 0;
      const gain = parseInt(gainInput.value) || 0;

      const isNBitsValid = nBits === nbMantissa + nbExponent + 1;
      const isGainValid = isPowerOfTwo(gain);

      // Apply custom validation
      nBitsInput.setCustomValidity(isNBitsValid ? '' : 'Number of Bits must equal Nb Mantissa + Nb Exponent + 1');
      gainInput.setCustomValidity(isGainValid ? '' : 'Gain must be a power of 2');

      // Update the generate button's state
      generateButton.disabled = !form.checkValidity();
  }

  // Attach real-time validation to relevant inputs
  [nBitsInput, nbMantissaInput, nbExponentInput, gainInput].forEach(input => {
      input.addEventListener('input', validateCustomRules);
  });

  // Handle form submission
  form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Primeiro, verificar se temos um caminho de projeto válido
      if (!currentProjectPath) {
          console.error('No project path available');
          return;
      }

      // Capturar o valor do nome do processador DIRETAMENTE do elemento no DOM
      const processorNameElement = document.querySelector('#processorName');
      
      // Verificar se o elemento existe
      if (!processorNameElement) {
          console.error('Processor name element not found in DOM');
          return;
      }
      
      const processorName = processorNameElement.value;
      
      // Log para debug
      console.log('DOM element found:', processorNameElement);
      console.log('Processor name value:', processorName);
      
      // Validar que o nome do processador não está vazio
      if (!processorName || processorName.trim() === '') {
          console.error('Processor name is required');
          return;
      }

      // Mostrar estado de carregamento
      const originalButtonText = generateButton.innerHTML;
      generateButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
      generateButton.disabled = true;

      const formData = {
          projectLocation: currentProjectPath,
          processorName: processorName,
          nBits: parseInt(nBitsInput.value),
          nbMantissa: parseInt(nbMantissaInput.value),
          nbExponent: parseInt(nbExponentInput.value),
          dataStackSize: parseInt(document.getElementById('dataStackSize').value),
          instructionStackSize: parseInt(document.getElementById('instructionStackSize').value),
          inputPorts: parseInt(document.getElementById('inputPorts').value),
          outputPorts: parseInt(document.getElementById('outputPorts').value),
          pipeln: parseInt(document.getElementById('pipeln').value),
          gain: parseInt(gainInput.value),
      };

      // Log para debug dos dados completos
      console.log('Form data being sent:', formData);

      try {
          // Chamar o processo principal para criar o projeto do processador
          const result = await window.electronAPI.createProcessorProject(formData);

          if (result && result.success) {
              // Fechar modal
              modal.remove();

              // Atualizar árvore de arquivos
              await refreshFileTree();
          } else {
              throw new Error('Failed to create processor project - no success response received');
          }
      } catch (error) {
          console.error('Error creating processor project:', error);
          
          // Resetar estado do botão
          generateButton.innerHTML = originalButtonText;
          generateButton.disabled = false;
          
          // Manter modal aberto para que o usuário possa tentar novamente
          return;
      }
  });

  // Manipular botão de cancelar
  document.getElementById('cancelProcessorHub').addEventListener('click', () => {
      modal.remove();
  });

  // Manipular clique fora do modal
  modal.querySelector('.processor-hub-overlay').addEventListener('click', () => {
      modal.remove();
  });

  // Realizar validação inicial
  validateCustomRules();
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
      <img src="./assets/icons/icon_flare.svg" 
           alt="AI Toggle"
           class="ai-toggle-icon"
           onclick="toggleAIAssistant()">
      <h3 class="ai-assistant-title">AI Assistant</h3>
      <div class="ai-provider-section">
        <img id="ai-provider-icon" 
             src="./assets/icons/chatgpt.svg"
             alt="Provider Icon" 
             class="ai-provider-icon">
        <select id="ai-provider-select" class="ai-provider-select">
          <option value="chatgpt">ChatGPT</option>
          <option value="claude">Claude</option>
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
      deepseek: 'https://www.deepseek.com/'
    };
    
    const iconMap = {
      chatgpt: './assets/icons/chatgpt.svg',
      claude: './assets/icons/claude.svg',
      deepseek: './assets/icons/deepseek.svg'
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
    startWidth = parseInt(document.defaultView.getComputedStyle(container).width, 10);
    
    // Adicionar listeners no document
    document.addEventListener('mousemove', handleResize, { passive: false });
    document.addEventListener('mouseup', stopResize, { once: true });
    document.addEventListener('mouseleave', stopResize, { once: true });
    
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
  module.exports = { toggleAIAssistant, initAIAssistant };
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
    startWidth = parseInt(window.getComputedStyle(aiAssistantContainer).width, 10);

    // Desativa o pointer no webview (porque ele "bloqueia" mousemove/mouseup)
    aiAssistantContainer.querySelector('webview').style.pointerEvents = 'none';

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
      aiAssistantContainer.querySelector('webview').style.pointerEvents = 'auto';
      document.body.style.cursor = '';
    }
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}


//WINDOW.ONLOAD ======================================================================================================================================================== ƒ
window.onload = () => {
  initMonaco();
  initAIAssistant();

  // Add AI Assistant button to toolbar
  const toolbar = document.querySelector('.toolbar');
  const aiButton = document.createElement('aiButton');

  aiButton.className = 'toolbar-button button-highlight rainbow btn';
  aiButton.innerHTML = '<img src="./assets/icons/icon_flare.svg" alt="AI Toggle" style="width: 22px; height: 22px; filter: brightness(2.0); transition: filter 0.3s;">';
  aiButton.id = 'aiAssistant';
  aiButton.addEventListener('click', toggleAIAssistant);
  toolbar.appendChild(aiButton);
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

  document.getElementById('saveFileBtn').addEventListener('click', () => TabManager.saveCurrentFile());

};

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

// VERILOG ========================================================================================================================================================
// Get the compile button
const compileButton = document.getElementById('vericomp');
const compileButtoncmm = document.getElementById('cmmcomp');
const compileButtonasm = document.getElementById('asmcomp');

// Function to check if current tab is a .cmm file
function isActiveCmmFile() {
    return TabManager.activeTab && TabManager.activeTab.toLowerCase().endsWith('.cmm');
}

// Function to get processor name from the form
function getProcessorName() {
    const processorNameInput = document.getElementById('processorName');
    return processorNameInput ? processorNameInput.value : 'procTest_00';
}


// Observe tab changes
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        }
    });
});

// Start observing tab changes
document.querySelectorAll('.tab').forEach(tab => {
    observer.observe(tab, {
        attributes: true
    });
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
    // Check if we're in project-oriented mode by checking the toggle button
    const toggleButton = document.getElementById('toggle-ui');
    this.isProjectOriented = toggleButton && toggleButton.classList.contains('active');

    // Get current project info to get the correct project path
    const projectInfo = await window.electronAPI.getCurrentProject();
    const currentProjectPath = projectInfo.projectPath || this.projectPath;
    
    if (!currentProjectPath) {
      throw new Error('No current project path available for loading configuration');
    }

    // Load processor configuration with the correct project path
    const configFilePath = await window.electronAPI.joinPath(currentProjectPath, 'processorConfig.json');
    const config = await window.electronAPI.loadConfigFromPath(configFilePath);
    this.config = config;
    console.log("Processor config loaded:", config);

    // Load project configuration if in project-oriented mode
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
      // First ensure the saphoComponents directory exists
      const saphoComponentsDir = await window.electronAPI.joinPath('saphoComponents');
      await window.electronAPI.mkdir(saphoComponentsDir);
      
      // Then ensure the Temp directory exists
      const tempBaseDir = await window.electronAPI.joinPath('saphoComponents', 'Temp');
      await window.electronAPI.mkdir(tempBaseDir);
      
      // Finally ensure the processor-specific temp directory exists
      const tempProcessorDir = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
      await window.electronAPI.mkdir(tempProcessorDir);
      
      return tempProcessorDir;
    } catch (error) {
      console.error("Failed to ensure directories:", error);
      throw error;
    }
  }

    // Fix 1: Get selected CMM file consistently
async getSelectedCmmFile(processor) {
  let selectedCmmFile = null;
  
  if (this.config && this.config.selectedCmmFile) {
    selectedCmmFile = this.config.selectedCmmFile;
  } else if (processor.cmmFile) {
    selectedCmmFile = processor.cmmFile;
  } else {
    throw new Error('No CMM file selected. Please select a CMM file to compile.');
  }
  
  return selectedCmmFile;
}

// Fix 2: Get testbench file name correctly
async getTestbenchInfo(processor, cmmBaseName) {
  let tbModule, tbFile;
  
  if (this.config.testbenchFile && this.config.testbenchFile !== 'Standard') {
    // User selected custom testbench
    tbFile = this.config.testbenchFile;
    tbModule = tbFile.replace(/\.v$/i, '');
  } else {
    // Use standard testbench (same name as CMM)
    tbModule = `${cmmBaseName}_tb`;
    tbFile = `${tbModule}.v`;
  }
  
  return { tbModule, tbFile };
}

async cmmCompilation(processor) {
  const { name } = processor;
  this.terminalManager.appendToTerminal('tcmm', `Starting CMM compilation for ${name}...`);
  
  try {
    // Get the selected CMM file from user selection or configuration
    let selectedCmmFile = null;

    // Try to get from configuration first
    if (this.config.selectedCmmFile) {
      selectedCmmFile = this.config.selectedCmmFile;
    } else if (processor.cmmFile) {
      selectedCmmFile = processor.cmmFile;
    } else {
      throw new Error('No CMM file selected. Please select a CMM file to compile.');
    }

    // Extract base name without extension for generated files
    const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
    
    const macrosPath = await window.electronAPI.joinPath('saphoComponents', 'Macros');
    const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
    const cmmCompPath = await window.electronAPI.joinPath('saphoComponents', 'bin', 'cmmcomp.exe');
    const projectPath = await window.electronAPI.joinPath(this.projectPath, name);
    const softwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Software');
    const asmPath = await window.electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);
 
    await TabManager.saveAllFiles();

    // Start compilation status indicator
    statusUpdater.startCompilation('cmm');

    // Build command with selected CMM file: CMMComp.exe %CMM_FILE% %PROC_DIR% %MAC_DIR% %TMP_PRO%
    const cmd = `"${cmmCompPath}" ${cmmBaseName} "${projectPath}" "${macrosPath}" "${tempPath}"`;
    this.terminalManager.appendToTerminal('tcmm', `Executing command: ${cmd}`);
    
    const result = await window.electronAPI.execCommand(cmd);
    await refreshFileTree();
    
    // Show compiler output
    if (result.stdout) {
      this.terminalManager.appendToTerminal('tcmm', result.stdout, 'stdout');
    }
    if (result.stderr) {
      this.terminalManager.appendToTerminal('tcmm', result.stderr, 'stderr');
    }

    // Verify exit code
    if (result.code !== 0) {
      statusUpdater.compilationError('cmm', `CMM compilation failed with code ${result.code}`);
      throw new Error(`CMM compilation failed with code ${result.code}`);
    }

    this.terminalManager.appendToTerminal('tcmm', 'CMM compilation completed successfully.', 'success');
    statusUpdater.compilationSuccess('cmm');
    return asmPath;
  } catch (error) {
    this.terminalManager.appendToTerminal('tcmm', `Error: ${error.message}`, 'error');
    statusUpdater.compilationError('cmm', error.message);
    throw error;
  }
}
  
  async asmCompilation(processor, asmPath) {
    const { name, clk, numClocks } = processor;
    
    try {
      // Get all required paths
      const projectPath = await window.electronAPI.joinPath(this.projectPath, name);
      const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
      const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
      const appCompPath = await window.electronAPI.joinPath('saphoComponents', 'bin', 'appcomp.exe');
      const asmCompPath = await window.electronAPI.joinPath('saphoComponents', 'bin', 'asmcomp.exe');
      const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
      let   tbMod = this.config.testbenchFile.replace(/\.v$/i, '');
   
 
     // Get the selected CMM file from configuration
    let selectedCmmFile = null;
    
    // Try to get from processor object itself (fallback)
    if (!selectedCmmFile && processor.cmmFile) {
      selectedCmmFile = processor.cmmFile;
      this.terminalManager.appendToTerminal('tcmm', `Using CMM file from processor config: ${selectedCmmFile}`);
    }
    
    // Verify the CMM file exists before proceeding
    const softwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Software');  
    const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
    // Extract filename without extension for ASM output
        const asmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');

    const asmPath = await window.electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);

    
      statusUpdater.startCompilation('asm');

      await TabManager.saveAllFiles();

      // First run APP (Assembler Pre-Processor) as per the batch file
      // APP.exe %ASM_FILE% %TMP_PRO%
      let cmd = `"${appCompPath}" "${asmPath}" "${tempPath}"`;

      this.terminalManager.appendToTerminal('tasm', `Starting ASM Preprocessor for ${name}...`);
      this.terminalManager.appendToTerminal('tasm', `Executing command: ${cmd}`);
      
      const appResult = await window.electronAPI.execCommand(cmd);
      
      if (appResult.stdout) this.terminalManager.appendToTerminal('tasm', appResult.stdout, 'stdout');
      if (appResult.stderr) this.terminalManager.appendToTerminal('tasm', appResult.stderr, 'stderr');

      if (appResult.code !== 0) {
        statusUpdater.compilationError('asm', `ASM Preprocessor failed with code ${appResult.code}`);
        throw new Error(`ASM Preprocessor failed with code ${appResult.code}`);
      } 
      
      // Then run the ASM compiler as per the batch file
      // ASM.exe %ASM_FILE% %PROC_DIR% %HDL_DIR% %TMP_PRO% %FRE_CLK% %NUM_CLK% 0
      // The last parameter is project mode (0 or 1)
      const projectParam = this.isProjectOriented ? "1" : "0";
      cmd = `"${asmCompPath}" "${asmPath}" "${projectPath}" "${hdlPath}" "${tempPath}" ${clk || 0} ${numClocks || 0} ${projectParam}`;

      this.terminalManager.appendToTerminal('tasm', 'ASM Preprocessor completed successfully.', 'success');
      this.terminalManager.appendToTerminal('tasm', `Starting ASM compilation for ${asmBaseName}...`);
      this.terminalManager.appendToTerminal('tasm', `Executing command: ${cmd}`);
      
      const asmResult = await window.electronAPI.execCommand(cmd);
      await refreshFileTree();
      
      if (asmResult.stdout) this.terminalManager.appendToTerminal('tasm', asmResult.stdout, 'stdout');
      if (asmResult.stderr) this.terminalManager.appendToTerminal('tasm', asmResult.stderr, 'stderr');

      if (asmResult.code !== 0) {
        statusUpdater.compilationError('asm', `ASM compilation failed with code ${asmResult.code}`);
        throw new Error(`ASM compilation failed with code ${asmResult.code}`);
      }

      // Copy the testbench file if we're not in project-oriented mode
      if (!this.isProjectOriented) {
      const simulationPath = await window.electronAPI.joinPath(this.projectPath, name, 'Simulation');
      const testbenchDestination = await window.electronAPI.joinPath(tempPath, `${tbMod}.v`);
      const testbenchSource = await window.electronAPI.joinPath(simulationPath, `${tbMod}.v`);

      await window.electronAPI.copyFile(testbenchSource, testbenchDestination);
    }
      
      this.terminalManager.appendToTerminal('tasm', 'ASM compilation completed successfully.','success');
      statusUpdater.compilationSuccess('asm');
    } catch (error) {
      this.terminalManager.appendToTerminal('tasm', `Error: ${error.message}`, 'error');
      statusUpdater.compilationError('asm', error.message);
      throw error;
    }
  }



// Fix 3: Updated iverilogCompilation method
async iverilogCompilation(processor) {
  if (this.isProjectOriented) {
    return this.iverilogProjectCompilation();
  }
  
  const { name } = processor;
  this.terminalManager.appendToTerminal('tveri', `Starting Icarus Verilog compilation for ${name}...`);
  statusUpdater.startCompilation('verilog');
  
  try {
    const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
    const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
    const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
    const simulationPath = await window.electronAPI.joinPath(this.projectPath, name, 'Simulation');
    const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'iverilog.exe');
    
    // Get selected CMM file and extract base name
    const selectedCmmFile = await this.getSelectedCmmFile(processor);
    const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
    
    // Get testbench info
    const { tbModule, tbFile } = await this.getTestbenchInfo(processor, cmmBaseName);
    
    // Get flags from config
    const flags = this.config.iverilogFlags ? this.config.iverilogFlags.join(' ') : '';
    
    // Build list of verilog files to compile
    const verilogFiles = ['addr_dec.v', 'instr_dec.v', 'processor.v', 'core.v', 'ula.v'];
    const verilogFilesString = verilogFiles.join(' ');

    await TabManager.saveAllFiles();
    
    // Build iverilog command
    // Output file should be named after CMM base name, top module is testbench module
    const outputFile = await window.electronAPI.joinPath(tempPath, cmmBaseName);
    const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}.v`);
    const testbenchFile = await window.electronAPI.joinPath(simulationPath, tbFile);
    
    const cmd = `cd "${hdlPath}" && "${iveriCompPath}" ${flags} -s ${tbModule} -o "${outputFile}" "${testbenchFile}" "${hardwareFile}" ${verilogFilesString}`;
    
    this.terminalManager.appendToTerminal('tveri', `Executing Icarus Verilog compilation:\n${cmd}`);
    
    const result = await window.electronAPI.execCommand(cmd);
    
    if (result.stdout) {
      this.terminalManager.appendToTerminal('tveri', result.stdout, 'stdout');
    }
    if (result.stderr) {
      this.terminalManager.appendToTerminal('tveri', result.stderr, 'stderr');
    }
    
    if (result.code !== 0) {
      statusUpdater.compilationError('verilog', `Icarus Verilog compilation failed with code ${result.code}`);
      throw new Error(`Icarus Verilog compilation failed with code ${result.code}`);
    }
    
    // Copy .mif files (always named after CMM base name)
    await window.electronAPI.copyFile(
      await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_data.mif`),
      await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_data.mif`)
    );

    await window.electronAPI.copyFile(
      await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_inst.mif`),
      await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_inst.mif`)
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

async iverilogProjectCompilation() {
  this.terminalManager.appendToTerminal('tveri', `Starting Icarus Verilog verification for project...`);
  statusUpdater.startCompilation('verilog');
  
  try {
    if (!this.projectConfig) {
      throw new Error("Project configuration not loaded");
    }
    
    const tempBaseDir = await window.electronAPI.joinPath('saphoComponents', 'Temp');
    const hdlDir = await window.electronAPI.joinPath('saphoComponents', 'HDL');
    const topLevelDir = await window.electronAPI.joinPath(this.projectPath, 'TopLevel');
    const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog' ,'bin', 'iverilog.exe');

    // Get processors from project configuration
    const processors = this.projectConfig.processors || [];
    if (processors.length === 0) {
      throw new Error("No processors defined in project configuration");
    }
    
    // Get the testbench file - handle standard case
    let testbenchFile = this.projectConfig.testbenchFile;
    let topModuleName;
    
    if (!testbenchFile || testbenchFile === 'Standard') {
      // Use first processor name as testbench name with _tb suffix
      const firstProcessor = processors[0];
      testbenchFile = `${firstProcessor.type}_tb.v`;
      topModuleName = `${firstProcessor.type}_tb`;
    } else {
      topModuleName = testbenchFile.replace('.v', '');
    }
    
    // Get the TopLevel file - handle standard case
    let topLevelFile = this.projectConfig.topLevelFile;
    
    if (!topLevelFile || topLevelFile === 'Standard') {
      // Use first processor name as top level name
      const firstProcessor = processors[0];
      topLevelFile = `${firstProcessor.type}.v`;
    }
    
    // Build list of HDL files
    const hdlFiles = await window.electronAPI.readDir(hdlDir);
    let hdlVerilogFiles = "";
    for (const file of hdlFiles) {
      if (file.endsWith('.v')) {
        const hdlFilePath = await window.electronAPI.joinPath(hdlDir, file);
        hdlVerilogFiles += `"${hdlFilePath}" `;
      }
    }
    
    // Build list of TopLevel files (EXCLUDING the testbench file to avoid duplication)
    const topLevelFiles = await window.electronAPI.readDir(topLevelDir);  
    let topLevelVerilogFiles = "";
    for (const file of topLevelFiles) {
      if (file.endsWith('.v') && file !== testbenchFile) { // Skip testbench file here
        const topLevelFilePath = await window.electronAPI.joinPath(topLevelDir, file);
        topLevelVerilogFiles += `"${topLevelFilePath}" `;
      }
    }
    
    // Build list of processor files
    let processorVerilogFiles = "";
    for (const processor of processors) {
      const procName = processor.type;
      const procPath = await window.electronAPI.joinPath(this.projectPath, procName, 'Hardware', `${procName}.v`);
      processorVerilogFiles += `"${procPath}" `;
    }
    
    // Get flags
    const flags = this.projectConfig.iverilogFlags || "";
    
    await TabManager.saveAllFiles();

    // Build the iverilog command for project verification
    const projectName = this.projectPath.split(/[\/\\]/).pop();
    
    // Resolve output path
    const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, `${projectName}`);
    
    // Build testbench file path
    const testbenchFilePath = await window.electronAPI.joinPath(topLevelDir, testbenchFile);
    
    const cmd = `cd "${tempBaseDir}" && "${iveriCompPath}" ${flags} -s ${topModuleName} -o "${outputFilePath}" "${testbenchFilePath}" ${hdlVerilogFiles} ${processorVerilogFiles} ${topLevelVerilogFiles}`;
    
    this.terminalManager.appendToTerminal('tveri', `Executing Icarus Verilog verification:\n${cmd}`);
    
    const result = await window.electronAPI.execCommand(cmd);
    
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

// Fix 1: Get selected CMM file consistently
async getSelectedCmmFile(processor) {
  let selectedCmmFile = null;
  
  if (this.config && this.config.selectedCmmFile) {
    selectedCmmFile = this.config.selectedCmmFile;
  } else if (processor.cmmFile) {
    selectedCmmFile = processor.cmmFile;
  } else {
    throw new Error('No CMM file selected. Please select a CMM file to compile.');
  }
  
  return selectedCmmFile;
}

// Fix 2: Get testbench file name correctly
async getTestbenchInfo(processor, cmmBaseName) {
  let tbModule, tbFile;
  
  if (this.config.testbenchFile && this.config.testbenchFile !== 'Standard') {
    // User selected custom testbench
    tbFile = this.config.testbenchFile;
    tbModule = tbFile.replace(/\.v$/i, '');
  } else {
    // Use standard testbench (same name as CMM)
    tbModule = `${cmmBaseName}_tb`;
    tbFile = `${tbModule}.v`;
  }
  
  return { tbModule, tbFile };
}

// Fix 3: Updated iverilogCompilation method
async iverilogCompilation(processor) {
  if (this.isProjectOriented) {
    return this.iverilogProjectCompilation();
  }
  
  const { name } = processor;
  this.terminalManager.appendToTerminal('tveri', `Starting Icarus Verilog compilation for ${name}...`);
  statusUpdater.startCompilation('verilog');
  
  try {
    const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
    const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
    const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
    const simulationPath = await window.electronAPI.joinPath(this.projectPath, name, 'Simulation');
    const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'iverilog.exe');
    
    // Get selected CMM file and extract base name
    const selectedCmmFile = await this.getSelectedCmmFile(processor);
    const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
    
    // Get testbench info
    const { tbModule, tbFile } = await this.getTestbenchInfo(processor, cmmBaseName);
    
    // Get flags from config
    const flags = this.config.iverilogFlags ? this.config.iverilogFlags.join(' ') : '';
    
    // Build list of verilog files to compile
    const verilogFiles = ['addr_dec.v', 'instr_dec.v', 'processor.v', 'core.v', 'ula.v'];
    const verilogFilesString = verilogFiles.join(' ');

    await TabManager.saveAllFiles();
    
    // Build iverilog command
    // Output file should be named after CMM base name, top module is testbench module
    const outputFile = await window.electronAPI.joinPath(tempPath, cmmBaseName);
    const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}.v`);
    const testbenchFile = await window.electronAPI.joinPath(simulationPath, tbFile);
    
    const cmd = `cd "${hdlPath}" && "${iveriCompPath}" ${flags} -s ${cmmBaseName} -o "${outputFile}" "${hardwareFile}" ${verilogFilesString}`;
    
    this.terminalManager.appendToTerminal('tveri', `Executing Icarus Verilog compilation:\n${cmd}`);
    
    const result = await window.electronAPI.execCommand(cmd);
    
    if (result.stdout) {
      this.terminalManager.appendToTerminal('tveri', result.stdout, 'stdout');
    }
    if (result.stderr) {
      this.terminalManager.appendToTerminal('tveri', result.stderr, 'stderr');
    }
    
    if (result.code !== 0) {
      statusUpdater.compilationError('verilog', `Icarus Verilog compilation failed with code ${result.code}`);
      throw new Error(`Icarus Verilog compilation failed with code ${result.code}`);
    }
    
    // Copy .mif files (always named after CMM base name)
    await window.electronAPI.copyFile(
      await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_data.mif`),
      await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_data.mif`)
    );

    await window.electronAPI.copyFile(
      await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_inst.mif`),
      await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_inst.mif`)
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
// Fix 4: Updated runGtkWave method
// Fix 4: Updated runGtkWave method - Cleaned version with VVP management
async runGtkWave(processor) {
  if (this.isProjectOriented) {
    checkCancellation();
    return this.runProjectGtkWave();
  }
  
  const { name } = processor;
  this.terminalManager.appendToTerminal('twave', `Starting GTKWave for ${name}...`);
  statusUpdater.startCompilation('wave');
  
  try {
    const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
    const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
    const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
    const simulationPath = await window.electronAPI.joinPath(this.projectPath, name, 'Simulation');
    const binPath = await window.electronAPI.joinPath('saphoComponents', 'bin');
    const scriptsPath = await window.electronAPI.joinPath('saphoComponents', 'Scripts');
    const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog','bin','iverilog.exe');
    const vvpCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog','bin','vvp.exe');
    const gtkwCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog','gtkwave','bin','gtkwave.exe');
    
    // Get selected CMM file and extract base name
    const selectedCmmFile = await this.getSelectedCmmFile(processor);
    const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
    
    // Get testbench info
    const { tbModule, tbFile } = await this.getTestbenchInfo(processor, cmmBaseName);

    // Create tcl_infos.txt file inside tempPath
    const tclFilePath = await window.electronAPI.joinPath(tempPath, 'tcl_infos.txt');
    this.terminalManager.appendToTerminal('twave', `Creating tcl_infos.txt in ${tempPath}...`);
    const tclContent = `${tempPath}\n${binPath}\n`;
    await window.electronAPI.writeFile(tclFilePath, tclContent);

    await TabManager.saveAllFiles();

    // List of .v files to compile
    const verilogFiles = ['addr_dec.v', 'instr_dec.v', 'processor.v', 'core.v', 'ula.v'];
    const verilogFilesString = verilogFiles.join(' ');

    // Build paths
    const outputFile = await window.electronAPI.joinPath(tempPath, cmmBaseName);
    const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}.v`);
    const testbenchFile = await window.electronAPI.joinPath(simulationPath, tbFile);

    // 1) Compile with iverilog (testbench + hardware)
    const iverilogCmd = `cd "${hdlPath}" && "${iveriCompPath}" -s ${tbModule} -o "${outputFile}" "${testbenchFile}" "${hardwareFile}" ${verilogFilesString}`;

    this.terminalManager.appendToTerminal('twave', `Compiling with Icarus Verilog and testbench:\n${iverilogCmd}`);
    const iverilogResult = await window.electronAPI.execCommand(iverilogCmd);
    
    if (iverilogResult.stdout) this.terminalManager.appendToTerminal('twave', iverilogResult.stdout, 'stdout');
    if (iverilogResult.stderr) this.terminalManager.appendToTerminal('twave', iverilogResult.stderr, 'stderr');

    if (iverilogResult.code !== 0) {
      statusUpdater.compilationError('wave', `Icarus Verilog compilation failed with code ${iverilogResult.code}`);
      throw new Error(`Icarus Verilog compilation failed with code ${iverilogResult.code}`);
    }

    // 2) Copy .mif files to tempPath
    const dataMemSource = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_data.mif`);
    const dataMemDest = await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_data.mif`);
    await window.electronAPI.copyFile(dataMemSource, dataMemDest);

    const instMemSource = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_inst.mif`);
    const instMemDest = await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_inst.mif`);
    await window.electronAPI.copyFile(instMemSource, instMemDest);

    // 3) Prepare VCD file path (will be created by VVP)
    const vcdPath = await window.electronAPI.joinPath(tempPath, `${tbModule}.vcd`);

    // 4) Launch GTKWave first with empty/non-existent VCD file
    this.terminalManager.appendToTerminal('twave', 'Launching GTKWave for real-time VCD viewing...');
    
    // Determine GTKWave command based on configuration
    const useStandardGtkw = !processor.gtkwFile || processor.gtkwFile === 'standard';
    let gtkwCmd;

    if (useStandardGtkw) {
      const scriptPath = await window.electronAPI.joinPath(scriptsPath, 'gtk_proc_init.tcl');
      gtkwCmd = `cd "${tempPath}" && "${gtkwCompPath}" --rcvar "hide_sst on" --dark "${vcdPath}" --script="${scriptPath}"`;
    } else {
      const gtkwPath = await window.electronAPI.joinPath(simulationPath, processor.gtkwFile);
      const posScript = await window.electronAPI.joinPath(scriptsPath, 'pos_gtkw.tcl');
      gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --dark "${vcdPath}" "${gtkwPath}" --script="${posScript}"`;
    }

    this.terminalManager.appendToTerminal('twave', `Launching GTKWave command:\n${gtkwCmd}`);
    
    // Launch GTKWave asynchronously (don't wait for it to finish)
    window.electronAPI.execCommand(gtkwCmd).catch(error => {
      console.warn('GTKWave launch warning:', error);
      // Don't throw here as GTKWave might exit normally when user closes it
    });

    // Give GTKWave a moment to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 5) Run VVP to generate VCD (while GTKWave is already open)
    this.terminalManager.appendToTerminal('twave', 'Running VVP simulation to generate VCD file...');
    this.terminalManager.appendToTerminal('twave', 'GTKWave is now open - use File->Reload to see simulation progress!', 'info');
    
    const progressPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name, 'progress.txt');
    await window.electronAPI.deleteFileOrDirectory(progressPath);

    // Show VVP progress
    await showVVPProgress(String(name));

    // Configure listener for VVP stdout/stderr streaming
    const outputListener = (event, payload) => {
      if (payload.type === 'stdout') {
        this.terminalManager.appendToTerminal('twave', payload.data, 'stdout');
      } else if (payload.type === 'stderr') {
        this.terminalManager.appendToTerminal('twave', payload.data, 'stderr');
      } else if (payload.type === 'pid') {
        console.log(`VVP process started with PID: ${payload.pid}`);
      }
    };

    // Add output listener
    window.electronAPI.onCommandOutputStream(outputListener);

    try {
      // VVP Command - run the compiled file to generate VCD
      const vvpCmd = `cd "${tempPath}" && "${vvpCompPath}" "${cmmBaseName}" -fst -v`;
      
      this.terminalManager.appendToTerminal('twave', `Running VVP command:\n${vvpCmd}`);
      
      // Use the new managed VVP command
      const vvpResult = await window.electronAPI.runVvpCommand(vvpCmd, tempPath);
      
      checkCancellation();

      // Check if VVP failed
      if (vvpResult.code !== 0) {
        hideVVPProgress();
        const errorMsg = vvpResult.stderr || vvpResult.error || `VVP simulation failed with code ${vvpResult.code}`;
        throw new Error(errorMsg);
      }

      this.terminalManager.appendToTerminal('twave', 'VVP simulation completed successfully.', 'success');
      this.terminalManager.appendToTerminal('twave', 'VCD file generation complete - reload GTKWave to see final results!', 'warning');
      
    } catch (error) {
      if (error.message === 'Compilation canceled by user') {
        this.terminalManager.appendToTerminal('twave', 'VVP simulation canceled by user.', 'warning');
      } else {
        // Log more detailed error information
        console.error('VVP Error Details:', error);
        const errorMsg = error.error || error.stderr || error.message || 'Unknown VVP error';
        this.terminalManager.appendToTerminal('twave', `VVP Error: ${errorMsg}`, 'error');
        throw new Error(errorMsg);
      }
    } finally {
      // Remove output listener
      window.electronAPI.removeCommandOutputListener(outputListener);
      hideVVPProgress();
    }

    statusUpdater.compilationSuccess('wave');
    
  } catch (error) {
    this.terminalManager.appendToTerminal('twave', `Error: ${error.message}`, 'error');
    statusUpdater.compilationError('wave', error.message);
    throw error;
  }
}

async runProjectGtkWave() {
  this.terminalManager.appendToTerminal('twave', `Starting GTKWave for project...`);
  statusUpdater.startCompilation('wave');

  try {
    if (!this.projectConfig) {
      throw new Error("Project configuration not loaded");
    }

    // 1) Build all necessary directories
    const tempBaseDir = await window.electronAPI.joinPath('saphoComponents', 'Temp');
    const hdlDir      = await window.electronAPI.joinPath('saphoComponents', 'HDL');
    const binDir      = await window.electronAPI.joinPath('saphoComponents', 'bin');
    const scriptsPath = await window.electronAPI.joinPath('saphoComponents', 'Scripts');
    const topLevelDir = await window.electronAPI.joinPath(this.projectPath, 'TopLevel');
    const iveriCompPath = await window.electronAPI.joinPath(
      'saphoComponents', 'Packages', 'iverilog', 'bin', 'iverilog.exe'
    );
    const vvpCompPath = await window.electronAPI.joinPath(
      'saphoComponents', 'Packages', 'iverilog', 'bin', 'vvp.exe'
    );
    const gtkwCompPath = await window.electronAPI.joinPath(
      'saphoComponents', 'Packages', 'iverilog', 'gtkwave', 'bin', 'gtkwave.exe'
    );

    // 2) Get processors and testbench from project
    const processors = this.projectConfig.processors || [];
    if (processors.length === 0) {
      throw new Error("No processors defined in project configuration");
    }

    // Handle standard testbench file
    let testbenchFile = this.projectConfig.testbenchFile;
    let tbModule;
    
    if (!testbenchFile || testbenchFile === 'Standard') {
      // Use first processor name as testbench name with _tb suffix
      const firstProcessor = processors[0];
      testbenchFile = `${firstProcessor.type}_tb.v`;
      tbModule = `${firstProcessor.type}_tb`;
    } else {
      tbModule = testbenchFile.replace(/\.v$/i, '');
    }

    const gtkwaveFile = this.projectConfig.gtkwaveFile; // can be "Standard" or custom name

    // 3) Compile with Icarus Verilog (all .v files)
    // 3.1) HDL files
    const hdlFiles = await window.electronAPI.readDir(hdlDir);
    let hdlVerilogFiles = "";
    for (const file of hdlFiles) {
      if (file.endsWith('.v')) {
        const path = await window.electronAPI.joinPath(hdlDir, file);
        hdlVerilogFiles += `"${path}" `;
      }
    }

    // 3.2) TopLevel files (EXCLUINDO o arquivo de testbench para evitar duplicação)
    const topLevelFiles = await window.electronAPI.readDir(topLevelDir);
    let topLevelVerilogFiles = "";
    for (const file of topLevelFiles) {
      if (file.endsWith('.v') && file !== testbenchFile) { // Excluir o testbench
        const path = await window.electronAPI.joinPath(topLevelDir, file);
        topLevelVerilogFiles += `"${path}" `;
      }
    }

    // 3.3) Processor files and create temporary folders
    let processorVerilogFiles = "";
    for (const processor of processors) {
      const procName = processor.type;
      const procPath = await window.electronAPI.joinPath(
        this.projectPath, procName, 'Hardware', `${procName}.v`
      );
      processorVerilogFiles += `"${procPath}" `;

      // Ensure temporary directories for each processor exist
      await this.ensureDirectories(procName);
    }

    const flags = this.projectConfig.iverilogFlags || "";

    await TabManager.saveAllFiles();

    // 3.4) Build iverilog command
    const projectName    = this.projectPath.split(/[\/\\]/).pop();
    const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, projectName);

    // Build testbench file path
    const testbenchFilePath = await window.electronAPI.joinPath(topLevelDir, testbenchFile);

    const iverilogCmd =
      `cd "${tempBaseDir}" && `
      + `"${iveriCompPath}" ${flags} -s ${tbModule} -o "${outputFilePath}" `
      + `"${testbenchFilePath}" ${hdlVerilogFiles}${processorVerilogFiles}${topLevelVerilogFiles}`;

    this.terminalManager.appendToTerminal('twave', `Compiling with Icarus Verilog for project:\n${iverilogCmd}`);
    const iverilogResult = await window.electronAPI.execCommand(iverilogCmd);

    // Log iverilog stdout/stderr
    if (iverilogResult.stdout) this.terminalManager.appendToTerminal('twave', iverilogResult.stdout, 'stdout');
    if (iverilogResult.stderr) this.terminalManager.appendToTerminal('twave', iverilogResult.stderr, 'stderr');

    if (iverilogResult.code !== 0) {
      statusUpdater.compilationError('wave', `Icarus Verilog compilation failed with code ${iverilogResult.code}`);
      throw new Error(`Icarus Verilog compilation failed with code ${iverilogResult.code}`);
    }

    // 4) Copy .mif files and possible PC files to tempBaseDir
    for (const processor of processors) {
      const procName     = processor.type;
      const hardwarePath = await window.electronAPI.joinPath(this.projectPath, procName, 'Hardware');

      const dataMemSource = await window.electronAPI.joinPath(hardwarePath, `${procName}_data.mif`);
      const dataMemDest   = await window.electronAPI.joinPath(tempBaseDir, `${procName}_data.mif`);
      await window.electronAPI.copyFile(dataMemSource, dataMemDest);

      const instMemSource = await window.electronAPI.joinPath(hardwarePath, `${procName}_inst.mif`);
      const instMemDest   = await window.electronAPI.joinPath(tempBaseDir, `${procName}_inst.mif`);
      await window.electronAPI.copyFile(instMemSource, instMemDest);

      // PC memory (optional)
      const pcMemPath = await window.electronAPI.joinPath(
        'saphoComponents', 'Temp', procName, `pc_${procName}_mem.txt`
      );
      const pcMemDest = await window.electronAPI.joinPath(tempBaseDir, `pc_${procName}_mem.txt`);
      try {
        await window.electronAPI.copyFile(pcMemPath, pcMemDest);
      } catch {
        this.terminalManager.appendToTerminal(
          'twave',
          `Warning: Could not copy PC memory file for ${procName}. This may be expected.`,
          'warning'
        );
      }
    }

    // 5) Copy any .txt files from TopLevel
    for (const file of topLevelFiles) {
      if (file.endsWith('.txt')) {
        const txtSource = await window.electronAPI.joinPath(topLevelDir, file);
        const txtDest   = await window.electronAPI.joinPath(tempBaseDir, file);
        await window.electronAPI.copyFile(txtSource, txtDest);
      }
    }

    // 6) Generate tcl_infos.txt in tempBaseDir for the project
    const tclFilePath = await window.electronAPI.joinPath(tempBaseDir, 'tcl_infos.txt');
    let instanceList      = "";
    let processorTypeList = "";
    for (const proc of processors) {
      instanceList += `${proc.instance} `;
      processorTypeList += `${proc.type} `;
    }
    const tclContent =
      `${instanceList.trim()}\n`
      + `${processorTypeList.trim()}\n`
      + `${tempBaseDir}\n`
      + `${binDir}\n`;

    this.terminalManager.appendToTerminal('twave', `Creating tcl_infos.txt for project GTKWave.`);
    await window.electronAPI.writeFile(tclFilePath, tclContent);

    // 7) Prepare VCD file path and launch GTKWave first
    const vcdPath = await window.electronAPI.joinPath(tempBaseDir, `${tbModule}.vcd`);
    
    this.terminalManager.appendToTerminal('twave', 'Launching GTKWave for real-time VCD viewing...');
    
    await window.electronAPI.deleteFileOrDirectory(vcdPath);

    // Build GTKWave command (can be standard or custom)
    let gtkwCmd;
    if (gtkwaveFile && gtkwaveFile !== "Standard") {
      // Custom
      const gtkwPath     = await window.electronAPI.joinPath(topLevelDir, gtkwaveFile);
      const posScriptPath= await window.electronAPI.joinPath(scriptsPath, 'pos_gtkw.tcl');
      gtkwCmd =
        `cd "${tempBaseDir}" && `
        + `"${gtkwCompPath}" --rcvar "hide_sst on" --dark "${vcdPath}" "${gtkwPath}" --script="${posScriptPath}"`;
    } else {
      // Standard for project - no additional gtkwave file
      const initScriptPath = await window.electronAPI.joinPath(scriptsPath, 'gtk_proj_init.tcl');
      gtkwCmd =
        `cd "${tempBaseDir}" && `
        + `"${gtkwCompPath}" --rcvar "hide_sst on" --dark "${vcdPath}" --script="${initScriptPath}"`;
    }

    this.terminalManager.appendToTerminal('twave', `Launching GTKWave command:\n${gtkwCmd}`);
    
    // Launch GTKWave asynchronously (don't wait for it to finish)
    window.electronAPI.execCommand(gtkwCmd).catch(error => {
      console.warn('GTKWave launch warning:', error);
      // Don't throw here as GTKWave might exit normally when user closes it
    });

    // Give GTKWave a moment to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 8) Run VVP to generate the .vcd (while GTKWave is already open)
    this.terminalManager.appendToTerminal('twave', 'Running VVP simulation for project...');
    this.terminalManager.appendToTerminal('twave', 'GTKWave is now open - use File->Reload to see simulation progress!', 'info');
    
    // Fix the VVP progress call - pass a string instead of undefined
    const projectName2 = this.projectPath.split(/[\/\\]/).pop() || 'project';
    await showVVPProgress(projectName2);

    const vvpCmd = `cd "${tempBaseDir}" && "${vvpCompPath}" "${projectName}" -fst -v`;
    this.terminalManager.appendToTerminal('twave', `Executing command: ${vvpCmd}`);

    // 8.1) Configure named listener BEFORE calling execCommandStream
    let isVvpRunning = true;
    let vvpProcessPid = null;
    const outputListener = (event, payload) => {
      // payload = { type: 'stdout'|'stderr', data: string, pid?: number }
      if (!isVvpRunning) return;
      
      // Capture VVP process PID if available
      if (payload.pid && !vvpProcessPid) {
        vvpProcessPid = payload.pid;
        // Set global VVP PID for cancellation
        if (typeof window !== 'undefined' && window.setCurrentVvpPid) {
          window.setCurrentVvpPid(vvpProcessPid);
        }
        console.log(`VVP process started with PID: ${vvpProcessPid}`);
      }
      
      if (payload.type === 'stdout') {
        this.terminalManager.appendToTerminal('twave', payload.data, 'stdout');
      } else if (payload.type === 'stderr') {
        // Generally VVP writes everything to stdout, but in case stderr is used:
        this.terminalManager.appendToTerminal('twave', payload.data, 'stderr');
      }
    };

    window.electronAPI.onCommandOutputStream(outputListener);

    let vvpResult;
    try {
      // Set VVP running flag
      if (typeof window !== 'undefined' && window.setVvpRunning) {
        window.setVvpRunning(true);
      }
      
      // Execution (and wait for final output to get {code, stdout, stderr})
      vvpResult = await window.electronAPI.execCommandStream(vvpCmd);
      isVvpRunning = false;
      
      // Clear VVP running state
      if (typeof window !== 'undefined' && window.setVvpRunning) {
        window.setVvpRunning(false);
        window.setCurrentVvpPid(null);
      }
  
      // If there's remaining stdout, parse it (generally, execCommandStream sends everything at once at the end).
      if (vvpResult.stdout) {
        this.terminalManager.appendToTerminal('twave', vvpResult.stdout, 'stdout');
      }
      if (vvpResult.stderr) {
        this.terminalManager.appendToTerminal('twave', vvpResult.stderr, 'stderr');
      }
  
      // Check for cancellation before checking result code
      checkCancellation();
  
      if (vvpResult.code !== 0) {
        // If VVP fails, hide progress bar and throw error
        hideVVPProgress();
        throw new Error(`VVP simulation failed with code ${vvpResult.code}`);
      }
  
      // If we got here, simulation was successful: finish progress bar
  
    } catch (err) {
      isVvpRunning = false;
      
      // Clear VVP running state on error
      if (typeof window !== 'undefined' && window.setVvpRunning) {
        window.setVvpRunning(false);
        window.setCurrentVvpPid(null);
      }
      
      // If it's a cancellation, kill the VVP process
      if (err.message === 'Compilation canceled by user' && vvpProcessPid) {
        try {
          await window.electronAPI.killProcess(vvpProcessPid);
          this.terminalManager.appendToTerminal('twave', `VVP process (PID: ${vvpProcessPid}) terminated due to cancellation.`, 'warning');
        } catch (killError) {
          console.error('Error killing VVP process:', killError);
          // Fallback: try killing by process name
          try {
            await window.electronAPI.killProcessByName('vvp.exe');
            this.terminalManager.appendToTerminal('twave', 'VVP process terminated by name due to cancellation.', 'warning');
          } catch (killByNameError) {
            console.error('Error killing VVP process by name:', killByNameError);
          }
        }
      }
      
      throw err;
    } finally {
      // Remove listener ALWAYS, both on success and error
      window.electronAPI.removeCommandOutputListener(outputListener);
    }
    
    // Check for cancellation after VVP completion
    checkCancellation();
    hideVVPProgress();

    this.terminalManager.appendToTerminal('twave', 'VVP simulation completed successfully.', 'success');
    this.terminalManager.appendToTerminal('twave', 'VCD file generation complete - reload GTKWave to see final results!', 'warning');
    statusUpdater.compilationSuccess('wave');

  } catch (error) {
    this.terminalManager.appendToTerminal('twave', `Error: ${error.message}`, 'error');
    statusUpdater.compilationError('wave', error.message);
    throw error;
  }
}


// Add this method to your class for launching fractal visualizer
async launchFractalVisualizerAsync(processorName, palette = 'grayscale') {
  try {
    const outputFilePath = await window.electronAPI.joinPath(
      this.projectPath, 
      processorName, 
      'Simulation', 
      'output_0.txt'
    );
    
    const fancyFractalPath = await window.electronAPI.joinPath(
      'saphoComponents', 
      'Packages', 
      'FFPGA',
      'fancyFractal.exe'
    );
    
    // Limpar arquivo anterior
    await window.electronAPI.deleteFileOrDirectory(outputFilePath);
    
    // Verificar se executável existe
    const executableExists = await window.electronAPI.pathExists(fancyFractalPath);
    if (!executableExists) {
      throw new Error(`Visualizador não encontrado em: ${fancyFractalPath}`);
    }
    
    // Comando com paleta
    const command = `"${fancyFractalPath}" "${outputFilePath}" --width 128 --height 128 --palette rainbow`;
    
    this.terminalManager.appendToTerminal('tcmm', `Iniciando visualizador de fractal (${palette})...`);
    this.terminalManager.appendToTerminal('tcmm', `Comando: ${command}`);
    
    // Executar comando assíncrono
    window.electronAPI.execCommand(command).then(result => {
      if (result.code === 0) {
        this.terminalManager.appendToTerminal('tcmm', `Visualizador concluído com sucesso`);
      } else {
        this.terminalManager.appendToTerminal('tcmm', `Visualizador finalizou com código: ${result.code}`, 'warning');
      }
    }).catch(error => {
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

// Modified compileAll method with fractal visualization option
async compileAll(withFractal = false, palette = 'fire') {
  try {
    startCompilation();
    await this.loadConfig();
    
    if (withFractal) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    // Function to switch between terminal tabs
    function switchTerminal(targetId) {
      // Hide all terminal content sections
      const terminalContents = document.querySelectorAll('.terminal-content');
      terminalContents.forEach(content => content.classList.add('hidden'));

      // Remove the 'active' class from all tabs
      const allTabs = document.querySelectorAll('.tab');
      allTabs.forEach(tab => tab.classList.remove('active'));

      // Show the selected terminal content
      const targetContent = document.getElementById(targetId);
      targetContent.classList.remove('hidden');

      // Mark the corresponding tab as active
      const activeTab = document.querySelector(`.tab[data-terminal="${targetId.replace('terminal-', '')}"]`);
      if (activeTab) {
        activeTab.classList.add('active');
      }
    }
    
    startCompilation();
    // Load configurations
    await this.loadConfig();
    
    // Different compilation flow based on mode
    if (this.isProjectOriented) {
      // Project-oriented mode: compile all processors, then run project verilog and GTKWave
      if (this.projectConfig && this.projectConfig.processors) {
        // Track processed processor types to avoid duplicates
        const processedTypes = new Set();
        
        // Compile each unique processor type
        for (const processor of this.projectConfig.processors) {
          checkCancellation();
          // Skip if we've already processed this processor type
          if (processedTypes.has(processor.type)) {
            this.terminalManager.appendToTerminal('tcmm', `Skipping duplicate processor type: ${processor.type}`);
            continue;
          }
          
          // Add to processed set
          processedTypes.add(processor.type);
          
          try {
            // Create processor object with correct structure for compilation functions
            const processorObj = {
              name: processor.type,
              type: processor.type,
              instance: processor.instance
            };
            checkCancellation();
            // First compile CMM
            this.terminalManager.appendToTerminal('tcmm', `Processing ${processor.type}...`);
            await this.ensureDirectories(processor.type);
            const asmPath = await this.cmmCompilation(processorObj);
            checkCancellation();
            // Then compile ASM - pass 1 as the project parameter
            await this.asmCompilation(processorObj, asmPath);
            
          } catch (error) {
            this.terminalManager.appendToTerminal('tcmm', `Error processing processor ${processor.type}: ${error.message}`, 'error');
            // Continue with next processor rather than stopping entire compilation
          }
        }
      }
      
      switchTerminal('terminal-tveri');
      checkCancellation();
      // Run project-level iverilog compilation
      await this.iverilogProjectCompilation();

      switchTerminal('terminal-twave');
      checkCancellation();
      // Run project-level GTKWave
      await this.runProjectGtkWave();
      
    } else {
      // Processor-oriented mode: run full pipeline for active processor only
      const activeProcessor = this.config.processors.find(p => p.isActive === true);
      if (!activeProcessor) {
        throw new Error("No active processor found. Please set one processor as active.");
      }
      
      const processor = activeProcessor;
      
      // Ensure temp directory for the active processor
      await this.ensureDirectories(processor.name);
      checkCancellation();
      // CMM compilation
      const asmPath = await this.cmmCompilation(processor);
      checkCancellation();
      // ASM compilation
      await this.asmCompilation(processor, asmPath);
      
      checkCancellation();
      // Verilog compilation
      await this.iverilogCompilation(processor);
      checkCancellation();
      // Run GTKWave
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


// Global functions to handle button clicks (put these outside your class)

function setCompilerInstance(instance) {
  compilerInstance = instance;
}

// Fractal compilation handler
async function handleFractalCompilation() {
  if (!compilerInstance) {
    console.error('Instância do compilador não definida');
    return;
  }
  
  if (!compilerInstance.isCompiling) {
    try {
      console.log('Iniciando compilação com fractal...');
      await compilerInstance.loadConfig();
      
      // Perguntar ao usuário qual paleta usar (opcional)
      const palette = 'fire'; // ou permitir seleção: prompt("Escolha a paleta (grayscale, fire, ocean, rainbow):", "fire");
      
      // Lançar visualizadores com paleta específica
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await compilerInstance.compileAll(true);
    } catch (error) {
      console.error('Erro na compilação com fractal:', error);
      if (compilerInstance.terminalManager) {
        compilerInstance.terminalManager.appendToTerminal('tcmm', `Erro: ${error.message}`, 'error');
      }
    }
  }
}

// Regular compilation handler
async function handleRegularCompilation() {
  if (!compilerInstance) {
    console.error('Compiler instance not set');
    return;
  }
  
  if (!compilerInstance.isCompiling) {
    try {
      console.log('Starting regular compilation...');
      await compilerInstance.compileAll();
    } catch (error) {
      console.error('Error in regular compilation process:', error);
      if (compilerInstance.terminalManager) {
        compilerInstance.terminalManager.appendToTerminal('tcmm', `Error starting compilation: ${error.message}`, 'error');
      }
    }
  }
}

function setupCompilationButtons() {
  // Remove existing listeners to prevent duplicates
  const fractalButton = document.getElementById('fractalcomp');
  const compileAllButton = document.getElementById('allcomp');
  
  if (fractalButton) {
    // Clone button to remove all existing event listeners
    const newFractalButton = fractalButton.cloneNode(true);
    fractalButton.parentNode.replaceChild(newFractalButton, fractalButton);
    newFractalButton.addEventListener('click', handleFractalCompilation);
  }
  
  if (compileAllButton) {
    // Clone button to remove all existing event listeners
    const newCompileButton = compileAllButton.cloneNode(true);
    compileAllButton.parentNode.replaceChild(newCompileButton, compileAllButton);
    newCompileButton.addEventListener('click', handleRegularCompilation);
  }
}


// Functions to use in your renderer.js
function showVVPProgress(name) {

  return vvpProgressManager.show(name);
}

function hideVVPProgress(delay = 5000) {
  setTimeout(() => {
    vvpProgressManager.hide();
  }, delay);
}

document.getElementById('fractalcomp').addEventListener('click', async () => {
  // Check if processor is configured
  if (!isProcessorConfigured()) {
    showCardNotification('Please configure a processor first before compilation.', 'warning', 4000);
    return;
  }
  
  if (!currentProjectPath) {
    console.error('No project opened');
    return;
  }
  
  // Set compilation flags
  isCompilationRunning = true;
  compilationCanceled = false;
  
  try {
    const compiler = new CompilationModule(currentProjectPath);
    await compiler.loadConfig(); // Load config first
    
    // Launch fractal visualizers first
    await compiler.launchFractalVisualizersForProject();
    
    // Small delay to ensure visualizers are started
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Then start compilation with fractal flag
    const success = await compiler.compileAll(true); // Pass true for withFractal
    
    if (!compilationCanceled && success) {
      console.log('Fractal compilation completed successfully');
    }
  } catch (error) {
    if (!compilationCanceled) {
      console.error('Fractal compilation error:', error);
      showCardNotification('Fractal compilation failed. Check terminal for details.', 'error', 4000);
    }
  } finally {
    // Reset compilation flags
    isCompilationRunning = false;
    compilationCanceled = false;
  }
});


// Updated All Compilation Handler
document.getElementById('allcomp').addEventListener('click', async () => {
  // Check if processor is configured
  if (!isProcessorConfigured()) {
    showCardNotification('Please configure a processor first before compilation.', 'warning', 4000);
    return;
  }
  
  if (!currentProjectPath) {
    console.error('No project opened');
    return;
  }
  
  // Set compilation flags
  isCompilationRunning = true;
  compilationCanceled = false;
  
  try {
    const compiler = new CompilationModule(currentProjectPath);
    setupCompilationButtons(currentProjectPath);
    setCompilerInstance(currentProjectPath);
    const success = await compiler.compileAll();
    
    if (!compilationCanceled && success) {
      console.log('All compilations completed successfully', 'success');
    }
  } catch (error) {
    if (!compilationCanceled) {
      console.error('Compilation error:', error);
      showCardNotification('Compilation failed. Check terminal for details.', 'error', 4000);
    }
  } finally {
    // Reset compilation flags
    isCompilationRunning = false;
    compilationCanceled = false;
  }
});

// Enhanced compilation button state management
function setCompilationButtonsState(disabled) {
  const buttons = [
    'cmmcomp',
    'asmcomp', 
    'vericomp',
    'wavecomp',
    'allcomp'
  ];
  
  buttons.forEach(buttonId => {
    const button = document.getElementById(buttonId);
    if (button) {
      button.disabled = disabled;
      
      // Add visual feedback with cursor and opacity
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

// Robust compilation state management
function startCompilation() {
  isCompilationRunning = true;
  compilationCanceled = false;
  setCompilationButtonsState(true);
  
  // Ensure terminal manager is available
  if (!globalTerminalManager) {
    initializeGlobalTerminalManager();
  }
}

function endCompilation() {
  isCompilationRunning = false;
  compilationCanceled = false;
  setCompilationButtonsState(false);
}

// Global flag to track compilation status
let isCompilationRunning = false;
let compilationCanceled = false;

// Enhanced processor configuration check
function isProcessorConfigured() {
  const processorElement = document.getElementById('processorNameID');
  if (!processorElement) {
    return false;
  }
  
  const processorText = processorElement.textContent || processorElement.innerText;
  return !processorText.includes('No Processor Configured');
}

// Adicione este event listener no seu código frontend (renderer)
document.getElementById('cancel-everything').addEventListener('click', async () => {
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
    showCardNotification('Error occurred while trying to cancel the process.', 'error', 3000);
  }
});

// Helper functions to manage VVP process state
window.setCurrentVvpPid = function(pid) {
  currentVvpPid = pid;
  console.log(`Current VVP PID set to: ${pid}`);
};

window.setVvpRunning = function(running) {
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
      await window.electronAPI.killProcess(currentVvpPid);
      console.log('VVP process killed successfully');
      
      hideVvpSpinner();
      
      isVvpRunning = false;
      currentVvpPid = null;
      
      // Also try killing by name as backup
      try {
        await window.electronAPI.killProcessByName('vvp.exe');
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
        await window.electronAPI.killProcessByName('vvp.exe');
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

// Enhanced checkCancellation function with terminal error display
function checkCancellation() {
  if (compilationCanceled) {
    // Display cancellation in current active terminal before throwing error
    if (globalTerminalManager) {
      const terminals = ['tcmm', 'tasm', 'tveri', 'twave'];
      terminals.forEach(terminalId => {
        globalTerminalManager.appendToTerminal(terminalId, 'Compilation interrupted by user cancellation.', 'warning');
      });
    }
    throw new Error('Compilation canceled by user');
  }
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
          settingsModal.showModal();       // para <dialog>
        } else {
          settingsModal.classList.add('open');  // ou remova .hidden / exiba via CSS
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


// Updated Compilation Button Manager
class CompilationButtonManager {
  constructor() {
    this.compiler = null;
    this.initializeCompiler();
    this.setupEventListeners();
  }

  initializeCompiler() {
    if (!currentProjectPath) {
      console.log('No project opened');
      return;
    }
    this.compiler = new CompilationModule(currentProjectPath);
    // FIXED: Pass the compiler instance, not the path
    setCompilerInstance(this.compiler);
    setupCompilationButtons();
  }

  setupEventListeners() {
    // Setup other event listeners if needed
  }


  async setupEventListeners() {
    // CMM Compilation
    document.getElementById('cmmcomp').addEventListener('click', async () => {
      try {
        // Check if processor is configured
        if (!isProcessorConfigured()) {
          showCardNotification('Please configure a processor first before CMM compilation.', 'warning', 4000);
          return;
        }
        startCompilation();
        
        // Set compilation flags
        isCompilationRunning = true;
        compilationCanceled = false;
        
        if (!this.compiler) this.initializeCompiler();
        
        await this.compiler.loadConfig();
        
        // Check if canceled before proceeding
        if (compilationCanceled) return;
        
        // Get the active processor instead of the first one
        const activeProcessor = this.compiler.config.processors.find(p => p.isActive === true);
        if (!activeProcessor) {
          throw new Error("No active processor found. Please set isActive: true for one processor.");
        }
        
        const processor = activeProcessor;
        await this.compiler.ensureDirectories(processor.name);
        
        // Check if canceled before proceeding
        if (compilationCanceled) return;
        
        const asmPath = await this.compiler.cmmCompilation(processor);
        
        // Check if canceled before completing
        if (!compilationCanceled) {
          // Update file tree after compilation
          await refreshFileTree();
        }
      } catch (error) {
        if (!compilationCanceled) {
          console.error('CMM compilation error:', error);
          showCardNotification('CMM compilation failed. Check terminal for details.', 'error', 4000);
          endCompilation();
        }
      } finally {
        // Reset compilation flags
        isCompilationRunning = false;
        compilationCanceled = false;
         endCompilation();
      }
    });

    // ASM Compilation
    document.getElementById('asmcomp').addEventListener('click', async () => {
      try {
        // Check if processor is configured
        if (!isProcessorConfigured()) {
          showCardNotification('Please configure a processor first before ASM compilation.', 'warning', 4000);
          return;
        }
        startCompilation();
        
        // Set compilation flags
        isCompilationRunning = true;
        compilationCanceled = false;
        
        if (!this.compiler) this.initializeCompiler();
        
        await this.compiler.loadConfig();
        
        // Check if canceled before proceeding
        if (compilationCanceled) return;
        
        // Get the active processor instead of the first one
        const activeProcessor = this.compiler.config.processors.find(p => p.isActive === true);
        if (!activeProcessor) {
          throw new Error("No active processor found. Please set isActive: true for one processor.");
        }
        
        const processor = activeProcessor;
        
        // Find the most recent .asm file
        const softwarePath = await window.electronAPI.joinPath(currentProjectPath, processor.name, 'Software');
        const files = await window.electronAPI.readDir(softwarePath);
        const asmFile = files.find(file => file.endsWith('.asm'));
        
        if (!asmFile) {
          throw new Error('No .asm file found. Please compile CMM first.');
        }

        // Check if canceled before proceeding
        if (compilationCanceled) return;

        const asmPath = await window.electronAPI.joinPath(softwarePath, asmFile);
        await this.compiler.asmCompilation(processor, asmPath);
        
        // Check if canceled before completing
        if (!compilationCanceled) {
          // Update file tree after compilation
          await refreshFileTree();
        }
      } catch (error) {
        if (!compilationCanceled) {
          console.error('ASM compilation error:', error);
          showCardNotification('ASM compilation failed. Check terminal for details.', 'error', 4000);
          endCompilation();
        }
      } finally {
        // Reset compilation flags
        isCompilationRunning = false;
        compilationCanceled = false;
        endCompilation();
      }
    });

    // Verilog Compilation
    document.getElementById('vericomp').addEventListener('click', async () => {
      try {
        // Check if processor is configured
        if (!isProcessorConfigured()) {
          showCardNotification('Please configure a processor first before Verilog compilation.', 'warning', 4000);
          return;
        }
        
        startCompilation();

        // Set compilation flags
        isCompilationRunning = true;
        compilationCanceled = false;
        
        if (!this.compiler) this.initializeCompiler();
        
        await this.compiler.loadConfig();
        
        // Check if canceled before proceeding
        if (compilationCanceled) return;
        
        // Get the active processor instead of the first one
        const activeProcessor = this.compiler.config.processors.find(p => p.isActive === true);
        if (!activeProcessor) {
          throw new Error("No active processor found. Please set isActive: true for one processor.");
        }
        
        const processor = activeProcessor;
        
        // Check if canceled before proceeding
        if (compilationCanceled) return;
        
        await this.compiler.iverilogCompilation(processor);
        
        // Check if canceled before completing
        if (!compilationCanceled) {
          // Update file tree after compilation
          await refreshFileTree();
        }
      } catch (error) {
        if (!compilationCanceled) {
          console.error('Verilog compilation error:', error);
          showCardNotification('Verilog compilation failed. Check terminal for details.', 'error', 4000);
          endCompilation();
        }
      } finally {
        // Reset compilation flags
        isCompilationRunning = false;
        compilationCanceled = false;
        endCompilation();
      }
    });

    // Simulation Compilation
    document.getElementById('wavecomp').addEventListener('click', async () => {
      try {
        // Check if processor is configured
        if (!isProcessorConfigured()) {
          showCardNotification('Please configure a processor first before running GTKWave.', 'warning', 4000);
          return;
        }
        startCompilation();
        // Set compilation flags
        isCompilationRunning = true;
        compilationCanceled = false;
        
        if (!this.compiler) this.initializeCompiler();
        
        await this.compiler.loadConfig();
        
        // Check if canceled before proceeding
        if (compilationCanceled) return;
        
        // Get the active processor instead of the first one
        const activeProcessor = this.compiler.config.processors.find(p => p.isActive === true);
        if (!activeProcessor) {
          throw new Error("No active processor found. Please set isActive: true for one processor.");
        }
        
        const processor = activeProcessor;
        
        // Check if canceled before proceeding
        if (compilationCanceled) return;
        
        await this.compiler.runGtkWave(processor);
        
        // Check if canceled before completing
        if (!compilationCanceled) {
          // Update file tree after compilation
          await refreshFileTree();
        }
      } catch (error) {
        if (!compilationCanceled) {
          console.error('GTKWave execution error:', error);
          showCardNotification('GTKWave execution failed. Check terminal for details.', 'error', 4000);
          endCompilation();
        }
      } finally {
        // Reset compilation flags
        isCompilationRunning = false;
        compilationCanceled = false;
        endCompilation();
      }
    });
  }
}


// Inicializa o gerenciador quando a janela carregar
window.addEventListener('load', () => {
  const compilationManager = new CompilationButtonManager();
});

//TERMINAL      ======================================================================================================================================================== ƒ

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
    
    if (!TerminalManager.clearButtonInitialized) {
      this.setupClearButton();
      TerminalManager.clearButtonInitialized = true;
    }

    this.activeFilter = null; // 'error', 'warning', 'tips', or null
    this.setupFilterButtons()
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
        
        // Scroll to bottom when switching tabs
        this.scrollToBottom(terminalId);
      });
    });
  }

  setupFilterButtons() {
    const errorBtn = document.getElementById('filter-error');
    const warningBtn = document.getElementById('filter-warning');
    const successBtn = document.getElementById('filter-success');
    const tipsBtn = document.getElementById('filter-tip');
    
    if (!errorBtn || !warningBtn || !successBtn || !tipsBtn) return;

    const filterButtons = [errorBtn, warningBtn, successBtn, tipsBtn];
    
    errorBtn.addEventListener('click', () => this.toggleFilter('error', errorBtn, filterButtons));
    warningBtn.addEventListener('click', () => this.toggleFilter('warning', warningBtn, filterButtons));
    successBtn.addEventListener('click', () => this.toggleFilter('success', successBtn, filterButtons))
    tipsBtn.addEventListener('click', () => this.toggleFilter('tips', tipsBtn, filterButtons));
  }

  toggleFilter(filterType, clickedBtn, allButtons) {
    // If clicking the same filter, turn it off
    if (this.activeFilter === filterType) {
      this.activeFilter = null;
      clickedBtn.classList.remove('active');
    } else {
      // Set new filter
      this.activeFilter = filterType;
      
      // Update button states
      allButtons.forEach(btn => btn.classList.remove('active'));
      clickedBtn.classList.add('active');
    }
    
    // Apply filter to all terminals
    this.applyFilterToAllTerminals();
  }

  applyFilterToAllTerminals() {
    Object.keys(this.terminals).forEach(terminalId => {
      this.applyFilter(terminalId);
    });
  }


  applyFilter(terminalId) {
    const terminal = this.terminals[terminalId];
    if (!terminal) return;

    const logEntries = terminal.querySelectorAll('.log-entry');
    
    logEntries.forEach(entry => {
      if (this.activeFilter === null) {
        // Show all entries
        entry.classList.remove('filtered-out');
      } else {
        // Show only entries matching the active filter
        if (entry.classList.contains(this.activeFilter)) {
          entry.classList.remove('filtered-out');
        } else {
          entry.classList.add('filtered-out');
        }
      }
    });
  }

  appendToTerminal(terminalId, content, type = 'info') {
    const terminal = this.terminals[terminalId];
    if (!terminal) return;
  
    const logEntry = document.createElement('div');
    logEntry.classList.add('log-entry', type);
  
    // Auto-detect message type based on content
    const messageType = this.detectMessageType(content);
    if (messageType) {
      logEntry.classList.add(messageType);
    }

    const timestamp = new Date().toLocaleString('pt-BR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  
    const timestampSpan = document.createElement('span');
    timestampSpan.classList.add('timestamp');
    timestampSpan.textContent = `[${timestamp}]`;
    logEntry.appendChild(timestampSpan);
  
    // Process content (existing code)
    if (typeof content === 'string') {
      const contentWrapper = document.createElement('div');
      contentWrapper.style.marginTop = '0.5rem';
      
      if (content.toLowerCase().includes('compilação concluída') || 
          content.toLowerCase().includes('compilation successful')) {
        logEntry.classList.add('success');
      }
      
      const lines = content.split('\n');
      contentWrapper.innerHTML = lines
        .map(line => line.replace(/\s/g, '&nbsp;'))
        .join('<br>');
      
      logEntry.appendChild(contentWrapper);
    } 
    else if (content.stdout || content.stderr) {
      if (content.stdout?.trim()) {
        const stdoutDiv = document.createElement('div');
        stdoutDiv.classList.add('stdout');
        stdoutDiv.innerHTML = this.formatOutput(content.stdout);
        logEntry.appendChild(stdoutDiv);
      }
      
      if (content.stderr?.trim()) {
        const stderrDiv = document.createElement('div');
        stderrDiv.classList.add('stderr');
        stderrDiv.innerHTML = this.formatOutput(content.stderr);
        logEntry.appendChild(stderrDiv);
        // stderr is usually an error
        logEntry.classList.add('error');
      }
    }
  
    terminal.appendChild(logEntry);

    // Apply current filter to new entry
    this.applyFilter(terminalId);
    this.scrollToBottom(terminalId);
  }

  detectMessageType(content) {
    const contentStr = typeof content === 'string' ? content.toLowerCase() : 
                      (content.stdout + ' ' + content.stderr).toLowerCase();
    
    // Error patterns
    if (contentStr.includes('error') || 
        contentStr.includes('failed') || 
        contentStr.includes('exception') ||
        contentStr.includes('fatal') ||
        contentStr.includes('critical')) {
      return 'error';
    }
    
    // Warning patterns
    if (contentStr.includes('warning') || 
        contentStr.includes('warn') || 
        contentStr.includes('caution') ||
        contentStr.includes('deprecated')) {
      return 'warning';
    }
    
    // Tips patterns
    if (contentStr.includes('tip') || 
        contentStr.includes('hint') || 
        contentStr.includes('suggestion') ||
        contentStr.includes('note') ||
        contentStr.includes('info') ||
        contentStr.includes('help')) {
      return 'tips';
    }
    
    return null;
  }

  scrollToBottom(terminalId) {
    const terminal = this.terminals[terminalId];
    if (terminal) {
      terminal.scrollTop = terminal.scrollHeight;
    }
  }

  updateLastLine(terminalId, content, type = 'info') {
    const terminal = this.terminals[terminalId];
    if (terminal && terminal.lastChild) {
      const lastLine = terminal.lastChild;
      lastLine.innerHTML = content;
      lastLine.className = `terminal-line ${type}`;
    } else if (terminal) {
      this.appendToTerminal(terminalId, content, type);
    }
  }

// Fixed updateLastLine method
updateLastLine(terminalId, content, type = 'info') {
  const terminal = this.terminals[terminalId];
  if (terminal && terminal.lastChild) {
    // Update the last line with new content
    const lastLine = terminal.lastChild;
    lastLine.innerHTML = content;
    lastLine.className = `terminal-line ${type}`;
  } else if (terminal) {
    // If no last child exists, append new content
    this.appendToTerminal(terminalId, content, type);
  }
}
  // Add this to your TerminalManager class

setupGoDownButton() {
  const goDownButton = document.getElementById('godown-terminal');
  const goUpButton   = document.getElementById('goup-terminal');

  if (!goDownButton && !goUpButton) return;

  let isScrolling = false;
  let animationFrameId = null;
  const STEP = 200; // pixels por frame

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

      // calcula nova posição
      const maxScroll = terminal.scrollHeight - terminal.clientHeight;
      let next = terminal.scrollTop + direction;
      next = Math.max(0, Math.min(next, maxScroll));
      terminal.scrollTop = next;

      // continua enquanto não chegar ao fim/início
      if ((direction > 0 && next < maxScroll) || (direction < 0 && next > 0)) {
        animationFrameId = requestAnimationFrame(scrollLoop);
      } else {
        stopScrolling();
      }
    };

    animationFrameId = requestAnimationFrame(scrollLoop);
  };

  const stopScrolling = () => {
    cancelAnimationFrame(animationFrameId);
    isScrolling = false;
  };

  // mapeia eventos de mouse/touch
  if (goDownButton) {
    goDownButton.addEventListener('mousedown', e => startScrolling(+STEP, e));
    goDownButton.addEventListener('touchstart', e => startScrolling(+STEP, e), { passive: false });
  }
  if (goUpButton) {
    goUpButton.addEventListener('mousedown', e => startScrolling(-STEP, e));
    goUpButton.addEventListener('touchstart', e => startScrolling(-STEP, e), { passive: false });
  }

  // término do scroll
  document.addEventListener('mouseup',   stopScrolling);
  document.addEventListener('touchend',  stopScrolling);
  document.addEventListener('mouseleave', stopScrolling);
  document.addEventListener('touchcancel',stopScrolling);
}



  setupClearButton() {
  const clearButton = document.getElementById('clear-terminal');
  
  // Remova quaisquer event listeners anteriores para evitar duplicação
  clearButton.removeEventListener('click', this.handleClearClick);
  clearButton.removeEventListener('contextmenu', this.handleClearContextMenu);
  
  // Defina as funções de manipulação de eventos como propriedades da classe
  this.handleClearClick = (event) => {
    if (event.button === 0) { // Botão esquerdo
      const icon = clearButton.querySelector('i');
      if (icon.classList.contains('fa-trash-can')) {
        // Limpa apenas o terminal ativo
        const activeTab = document.querySelector('.terminal-tabs .tab.active');
        if (activeTab) {
          const terminalId = activeTab.getAttribute('data-terminal');
          this.clearTerminal(terminalId);
        }
      } else if (icon.classList.contains('fa-dumpster')) {
        // Limpa todos os terminais
        this.clearAllTerminals();
      }
    }
  };

  this.handleClearContextMenu = (event) => {
    event.preventDefault();
    console.log("Botão direito detectado!");

    if (event.button === 2) { 
      setTimeout(() => {
        this.changeClearIcon(clearButton);
      }, 50); // Pequeno atraso para garantir a renderização
    }
  };

  // Adicione os event listeners
  clearButton.addEventListener('click', this.handleClearClick);
  clearButton.addEventListener('contextmenu', this.handleClearContextMenu);
}
  

  setupAutoScroll() {
    // Observa mudanças no conteúdo do terminal
    const config = { childList: true, subtree: true };
    
    Object.entries(this.terminals).forEach(([id, terminal]) => {
      const observer = new MutationObserver(() => this.scrollToBottom(id));
      if (terminal) {
        observer.observe(terminal, config);
      }
    });
  }

  scrollToBottom(terminalId) {
    const terminal = this.terminals[terminalId];
    if (!terminal) return;

    // Força o scroll para o final do terminal
    requestAnimationFrame(() => {
      terminal.scrollTop = terminal.scrollHeight;
      
      // Dupla verificação para garantir o scroll
      setTimeout(() => {
        terminal.scrollTop = terminal.scrollHeight;
      }, 100);
    });
  }

  appendToTerminal(terminalId, content, type = 'info') {
    const terminal = this.terminals[terminalId];
    if (!terminal) return;
  
    const logEntry = document.createElement('div');
    logEntry.classList.add('log-entry', type);
  
    const timestamp = new Date().toLocaleString('pt-BR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  
    const timestampSpan = document.createElement('span');
    timestampSpan.classList.add('timestamp');
    timestampSpan.textContent = `[${timestamp}]`;
    logEntry.appendChild(timestampSpan);
  
    // Processa o conteúdo
    if (typeof content === 'string') {
      const contentWrapper = document.createElement('div');
      contentWrapper.style.marginTop = '0.5rem';
      
      if (content.toLowerCase().includes('compilação concluída') || 
          content.toLowerCase().includes('compilation successful')) {
        logEntry.classList.add('success');
      }
      
      const lines = content.split('\n');
      contentWrapper.innerHTML = lines
        .map(line => line.replace(/\s/g, '&nbsp;'))
        .join('<br>');
      
      logEntry.appendChild(contentWrapper);
    } 
    else if (content.stdout || content.stderr) {
      if (content.stdout?.trim()) {
        const stdoutDiv = document.createElement('div');
        stdoutDiv.classList.add('stdout');
        stdoutDiv.innerHTML = this.formatOutput(content.stdout);
        logEntry.appendChild(stdoutDiv);
      }
      
      if (content.stderr?.trim()) {
        const stderrDiv = document.createElement('div');
        stderrDiv.classList.add('stderr');
        stderrDiv.innerHTML = this.formatOutput(content.stderr);
        logEntry.appendChild(stderrDiv);
      }
    }
  
    terminal.appendChild(logEntry);

    // Garante que o scroll aconteça após o conteúdo ser realmente adicionado
    this.scrollToBottom(terminalId);

    // Adiciona um observer para garantir que qualquer mudança futura também faça scroll
    const observer = new MutationObserver(() => this.scrollToBottom(terminalId));
    observer.observe(terminal, { childList: true, subtree: true });
  }


  formatOutput(text) {
    return text
      .split('\n')
      .map(line => {
        // Preserva a indentação usando espaços não-quebráveis
        const indent = line.match(/^\s*/)[0].length;
        const indentSpaces = '&nbsp;'.repeat(indent);
        return indentSpaces + line.trim();
      })
      .join('<br>');
  }

   clearTerminal(terminalId) {
    const terminal = this.terminals[terminalId];
    if (terminal) {
      terminal.innerHTML = '';
    }
  }

  // Override clearAllTerminals to reset filter
  clearAllTerminals() {
    Object.keys(this.terminals).forEach(terminalId => {
      this.clearTerminal(terminalId);
    });
  }
  
  changeClearIcon(clearButton) {
    const icon = clearButton.querySelector('i');
    if (icon.classList.contains('fa-trash-can')) {
      icon.classList.remove('fa-trash-can');
      icon.classList.add('fa-dumpster');
      clearButton.setAttribute('title', 'Clear All Terminals'); // Altera o título
    } else {
      icon.classList.remove('fa-dumpster');
      icon.classList.add('fa-trash-can');
      clearButton.setAttribute('title', 'Clear Terminal'); // Restaura o título original
    }
  }
}

document.getElementById("backupFolderBtn").addEventListener("click", async () => {
  if (!currentProjectPath) {
    alert("Nenhum projeto aberto para backup.");
    return;
  }
  const result = await window.electronAPI.createBackup(currentProjectPath);

  alert(result.message); // Exibe o resultado do backup

  refreshFileTree(); // Atualiza a árvore de arquivos
});


// Modal Interaction Functions
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
      modal.classList.add('active');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
      modal.classList.remove('active');
  }
}

// Event Listeners for Configuration Modal
document.getElementById('closeModal')?.addEventListener('click', () => closeModal('modalConfig'));
document.getElementById('cancelConfig')?.addEventListener('click', () => closeModal('modalConfig'));

// Event Listeners for Bug Report Modal
document.getElementById('open-bug-report')?.addEventListener('click', () => openModal('bug-report-modal'));
document.getElementById('close-bug-report')?.addEventListener('click', () => closeModal('bug-report-modal'));

//TESTE         ======================================================================================================================================================== ƒ
document.addEventListener('DOMContentLoaded', () => {
  // Get sidebar elements
  const browseWebItem = document.querySelector('.sidebar-menu li[title="Browse the web"]');
  const githubDesktopItem = document.querySelector('.sidebar-menu li[title="Open GitHub Desktop"]');
  const shutdownItem = document.querySelector('.sidebar-menu li[title="Shut down the application"]');
  
  // Browse the web - Open nipscern.com in default browser
  browseWebItem.addEventListener('click', () => {
    window.electronAPI.openBrowser();
  });
  
  // Open GitHub Desktop
  githubDesktopItem.addEventListener('click', () => {
    window.electronAPI.openGithubDesktop();
  });
  
  // Shut down the application
  shutdownItem.addEventListener('click', () => {
    window.electronAPI.quitApp();
  });
  
  // Add hover effect for better user feedback
  const sidebarItems = document.querySelectorAll('.sidebar-menu li');
  sidebarItems.forEach(item => {
    item.addEventListener('mouseenter', () => {
      item.style.backgroundColor = '#444';
    });
    item.addEventListener('mouseleave', () => {
      item.style.backgroundColor = '';
    });
  });
});
// CORREÇÃO: Event handler do botão PRISM com debugging melhorado
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
        prismButton.innerHTML = '<img src="./assets/icons/prismv2.svg" style="height: inherit; width: 35px; flex-shrink: 0;"> PRISM (Recompile)';
      }
    } else {
      prismButton.classList.remove('active');
      if (!isCompiling) {
        prismButton.innerHTML = '<img src="./assets/icons/prismv2.svg" style="height: inherit; width: 35px; flex-shrink: 0;"> PRISM';
      }
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
  
  // PRISM button click handler
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
      console.log('Starting PRISM compilation...');
      
      // Update button appearance
      prismButton.disabled = true;
      prismButton.style.cursor = 'not-allowed';
      prismButton.innerHTML = '<img src="./assets/icons/prismv2.svg" style="height: inherit; width: 35px; flex-shrink: 0;"> Starting...';
      
      let isPrismOpen = false;
      
      // Check if PRISM window is already open
      try {
        if (window.electronAPI && window.electronAPI.checkPrismWindowOpen) {
          isPrismOpen = await window.electronAPI.checkPrismWindowOpen();
          console.log('PRISM window open status:', isPrismOpen);
        }
      } catch (error) {
        console.warn('Error checking PRISM window status:', error);
        isPrismOpen = false;
      }
      
      let result;
      
      if (isPrismOpen) {
        // Recompile for existing window
        prismButton.innerHTML = '<img src="./assets/icons/prismv2.svg" style="height: inherit; width: 35px; flex-shrink: 0;"> Recompiling...';
        console.log('Recompiling for existing PRISM window...');
        
        if (window.electronAPI.prismRecompile) {
          result = await window.electronAPI.prismRecompile();
        } else {
          console.warn('prismRecompile not available, using regular compile');
          result = await window.electronAPI.prismCompile();
        }
      } else {
        // First time compilation or window was closed
        prismButton.innerHTML = '<img src="./assets/icons/prismv2.svg" style="height: inherit; width: 35px; flex-shrink: 0;"> Compiling...';
        console.log('Starting PRISM compilation for new window...');
        
        // Try openPrismCompile first, fallback to regular compile
        if (window.electronAPI.openPrismCompile) {
          console.log('Using openPrismCompile...');
          result = await window.electronAPI.openPrismCompile();
        } else if (window.electronAPI.prismCompile) {
          console.log('Using prismCompile...');
          result = await window.electronAPI.prismCompile();
        } else {
          throw new Error('No PRISM compilation methods available');
        }
      }
      
      console.log('PRISM compilation result:', result);
      
      if (result && result.success) {
        console.log('✅ PRISM compilation successful:', result.message);
        
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
        }, 2000); // Increased delay to 2 seconds
        
      } else {
        const errorMessage = result ? result.message : 'Unknown error occurred';
        console.error('❌ PRISM compilation failed:', errorMessage);
        
        // Show error in terminal if available
        if (window.terminalManager) {
          window.terminalManager.appendToTerminal('tprism', `Compilation failed: ${errorMessage}`, 'error');
        }
        
        // Show error dialog
        if (window.electronAPI && window.electronAPI.showErrorDialog) {
          window.electronAPI.showErrorDialog('PRISM Compilation Failed', errorMessage);
        } else {
          alert(`PRISM Compilation Failed: ${errorMessage}`);
        }
      }
      
    } catch (error) {
      console.error('❌ PRISM compilation error:', error);
      
      // Show error in terminal if available
      if (window.terminalManager) {
        window.terminalManager.appendToTerminal('tprism', `Compilation error: ${error.message}`, 'error');
      }
      
      // Show error dialog
      if (window.electronAPI && window.electronAPI.showErrorDialog) {
        window.electronAPI.showErrorDialog('PRISM Error', error.message);
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
        const isPrismOpen = await window.electronAPI.checkPrismWindowOpen();
        console.log('Final PRISM window status:', isPrismOpen);
        updatePrismButton(isPrismOpen);
      } catch (error) {
        console.error('Error checking PRISM window status in finally:', error);
        // Default button text
        prismButton.innerHTML = '<img src="./assets/icons/prismv2.svg" style="width: 35px; height: inherit; flex-shrink: 0;"> PRISM';
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
      // CORREÇÃO: Substitua 'your-toggle-element' pelo ID real do seu elemento toggle
      const toggleElement = document.getElementById('toggle-ui') || 
                           document.querySelector('.toggle-switch') ||
                           document.querySelector('[data-toggle]');
      
      let isActive = false;
      
      if (toggleElement) {
        // Verificar diferentes tipos de toggle
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
        event.data.terminal, 
        event.data.message, 
        event.data.logType
      );
    }
  }
});

// VVPProgressManager class - Add this to your renderer.js
class VVPProgressManager {
  constructor() {
    this.overlay = null;
    this.progressFill = null;
    this.progressPercentage = null;
    this.elapsedTimeElement = null;
    this.eventsCountElement = null;
    this.isVisible = false;
    this.isReading = false;
    this.progressPath = null;
    this.startTime = null;
    this.currentProgress = 0;
    this.targetProgress = 0;
    this.animationFrame = null;
    this.readInterval = null;
    this.eventsCount = 0;
    
    // Smooth interpolation settings
    this.interpolationSpeed = 0.05; // Lower = smoother
    this.readIntervalMs = 1500; // Read file every 250ms
  }

  async show(name) {
    if (this.isVisible) return;
    
    try {
      // Get progress file path
      this.progressPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name, 'progress.txt');
      
      // Create overlay if it doesn't exist
      if (!this.overlay) {
        this.createOverlay();
      }
      
      // Reset progress
      this.currentProgress = 0;
      this.targetProgress = 0;
      this.startTime = Date.now();
      this.eventsCount = 0;
      
      // Show overlay
      this.overlay.classList.add('vvp-progress-visible');
      this.isVisible = true;
      
      // Start reading progress file
      this.startProgressReading();
      
      // Start animation loop
      this.startAnimationLoop();
      
      // Start time counter
      this.startTimeCounter();
      
    } catch (error) {
      console.error('Error showing VVP progress:', error);
    }
  }

  hide() {
    if (!this.isVisible) return;
    
    this.isVisible = false;
    this.isReading = false;
    
    // Clear intervals and animation
    if (this.readInterval) {
      clearInterval(this.readInterval);
      this.readInterval = null;
    }
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    // Hide overlay
    if (this.overlay) {
      this.overlay.classList.remove('vvp-progress-visible');
    }
  }

  // Function to delete the progress.txt file before compilation
  async deleteProgressFile(name) {
    try {
      const progressPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name, 'progress.txt');
      const fileExists = await window.electronAPI.fileExists(progressPath);
      
      if (fileExists) {
        await window.electronAPI.deleteFile(progressPath);
        console.log(`Progress file deleted: ${progressPath}`);
        return true;
      } else {
        console.log(`Progress file does not exist: ${progressPath}`);
        return false;
      }
    } catch (error) {
      console.error('Error deleting progress file:', error);
      return false;
    }
  }

  createOverlay() {
    // Create overlay HTML
    const overlayHTML = `
      <div class="vvp-progress-overlay">
        <div class="vvp-progress-info">
          <div class="vvp-progress-icon">
            <div class="vvp-spinner"></div>
          </div>
          <span class="vvp-progress-text">
            VVP Simulation in Progress
          </span>
          
          <div class="vvp-progress-bar-wrapper">
            <div class="vvp-progress-bar">
              <div class="vvp-progress-fill" id="vvp-progress-fill"></div>
              <div class="vvp-progress-glow"></div>
            </div>
            <div class="vvp-progress-percentage" id="vvp-progress-percentage">0%</div>
          </div>
          
          <div class="vvp-progress-stats">
            <div class="vvp-stat">
              <span class="vvp-stat-label"><i class="fa-solid fa-clock"></i> Time</span>
              <span class="vvp-stat-value" id="vvp-elapsed-time">0s</span>
            </div>
            <div class="vvp-stat">
            <span class="vvp-stat-label"><i class="fa-solid fa-arrow-rotate-right"></i> Events</span>
             <span class="vvp-stat-value" id="vvp-events-count">0</span>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Find the TWAVE terminal and add the overlay after it
    const twaveTerminal = document.getElementById('terminal-twave');
    if (twaveTerminal) {
      twaveTerminal.insertAdjacentHTML('afterend', overlayHTML);
    } else {
      // Fallback: add to body if terminal not found
      document.body.insertAdjacentHTML('beforeend', overlayHTML);
    }
    
    // Get references
    this.overlay = document.querySelector('.vvp-progress-overlay');
    this.progressFill = document.getElementById('vvp-progress-fill');
    this.progressPercentage = document.getElementById('vvp-progress-percentage');
    this.elapsedTimeElement = document.getElementById('vvp-elapsed-time');
    this.eventsCountElement = document.getElementById('vvp-events-count');
  }

  async startProgressReading() {
    this.isReading = true;
    
    const readProgress = async () => {
      if (!this.isReading || !this.progressPath) return;
      
      try {
        const fileExists = await window.electronAPI.fileExists(this.progressPath);
        console.log(`File exists check: ${this.progressPath} - ${fileExists ? 'EXISTS' : 'NOT FOUND'}`);
        
        if (fileExists) {
          const content = await window.electronAPI.readFile(this.progressPath);
          console.log('Raw file content:', JSON.stringify(content));
          
          // Split by lines and get the last non-empty line (latest progress)
          const lines = content.split('\n').filter(line => line.trim() !== '');
          console.log('Progress lines found:', lines);
          
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1].trim();
            const progress = parseInt(lastLine);
            
            console.log(`Latest progress line: "${lastLine}" -> Parsed: ${progress}`);
            
            if (!isNaN(progress) && progress >= 0 && progress <= 100) {
              console.log(`Progress updated from ${this.targetProgress}% to ${progress}%`);
              this.targetProgress = progress;
              
              // Calculate simulated events count based on progress
              // This simulates the number of simulation events processed
              // Formula: progress * 10 + random variation (0-50) to make it look realistic
              this.eventsCount = Math.floor(progress * 10 + Math.random() * 50);
              if (this.eventsCountElement) {
                this.eventsCountElement.textContent = this.eventsCount.toLocaleString();
              }

              // Stop reading and timing when compilation reaches 100%
              if (progress >= 100) {
                console.log('Compilation completed (100%), stopping progress monitoring');
                this.isReading = false;
                if (this.readInterval) {
                  clearInterval(this.readInterval);
                  this.readInterval = null;
                }
              }
            } else {
              console.warn(`Invalid progress value: "${lastLine}" -> ${progress}`);
            }
          } else {
            console.log('No progress lines found in file');
          }
        } else {
          console.log('Progress file does not exist yet');
        }
      } catch (error) {
        console.error('Error reading progress file:', error);
      }
    };
    
    // Read immediately
    await readProgress();
    
    // Set up interval
    this.readInterval = setInterval(readProgress, this.readIntervalMs);
  }

  startAnimationLoop() {
    const animate = () => {
      if (!this.isVisible) return;
      
      // Smooth interpolation
      const diff = this.targetProgress - this.currentProgress;
      if (Math.abs(diff) > 0.1) {
        this.currentProgress += diff * this.interpolationSpeed;
        console.log(`Animating progress: ${this.currentProgress.toFixed(1)}% -> target: ${this.targetProgress}%`);
      } else {
        this.currentProgress = this.targetProgress;
      }
      
      // Update UI
      const roundedProgress = Math.round(this.currentProgress * 10) / 10;
      
      if (this.progressFill) {
        this.progressFill.style.width = `${roundedProgress}%`;
      }
      
      if (this.progressPercentage) {
        this.progressPercentage.textContent = `${Math.round(roundedProgress)}%`;
      }
      
      // Continue animation
      this.animationFrame = requestAnimationFrame(animate);
    };
    
    animate();
  }

  startTimeCounter() {
    const updateTime = () => {
      if (!this.isVisible || !this.startTime) return;
      
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      
      const timeString = minutes > 0 
        ? `${minutes}m ${seconds}s`
        : `${seconds}s`;
      
      if (this.elapsedTimeElement) {
        this.elapsedTimeElement.textContent = timeString;
      }
      
      // Stop timer when compilation is complete (100%)
      if (this.isVisible && this.targetProgress < 100) {
        setTimeout(updateTime, 1000);
      }
    };
    
    updateTime();
  }
}

// Create singleton instance
const vvpProgressManager = new VVPProgressManager();

