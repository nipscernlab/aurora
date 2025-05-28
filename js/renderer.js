let editor;
let openFiles = new Map();
let activeFile = null;
let compiling = false;
let terminal = null;
let aiAssistantVisible = false;
let aiAssistantContainer = null;
let currentProvider = 'chatgpt'; // or 'claude'
let editorInstance;

// SHOW DIALOG =====================================================================================================================
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


//MONACO EDITOR ========================================================================================================================================================
// Enhanced EditorManager with improved theme management
class EditorManager {
  static editors = new Map();
  static activeEditor = null;
  static editorContainer = null;
  static currentTheme = 'cmm-dark';

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

  static createEditorInstance(filePath) {
    if (!this.editorContainer) {
      this.initialize();
    }

    const editorDiv = document.createElement('div');
    editorDiv.className = 'editor-instance';
    editorDiv.id = `editor-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
    editorDiv.style.position = 'absolute';
    editorDiv.style.top = '0';
    editorDiv.style.left = '0';
    editorDiv.style.right = '0';
    editorDiv.style.bottom = '0';
    editorDiv.style.display = 'none';

    this.editorContainer.appendChild(editorDiv);

    const editor = monaco.editor.create(editorDiv, {
      theme: this.currentTheme,
      language: this.getLanguageFromPath(filePath),
      automaticLayout: true,
      minimap: { 
        enabled: true,
        scale: 1,
        showSlider: 'mouseover'
      },
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
      fontLigatures: true,
      scrollBeyondLastLine: true,
      renderWhitespace: 'selection',
      mouseWheelZoom: true,
      padding: { top: 16, bottom: 16 },
      cursorStyle: 'line',
      cursorWidth: 2,
      cursorBlinking: 'smooth',
      renderLineHighlight: 'gutter',
      lineNumbers: 'on',
      lineNumbersMinChars: 4,
      glyphMargin: false,
      folding: true,
      showFoldingControls: 'mouseover',
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true
      },
      smoothScrolling: true,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        useShadows: false,
        verticalHasArrows: false,
        horizontalHasArrows: false,
        verticalScrollbarSize: 12,
        horizontalScrollbarSize: 12,
        arrowSize: 0
      }
    });

    this.editors.set(filePath, {
      editor: editor,
      container: editorDiv
    });

    this.updateOverlayVisibility();
    return editor;
  }

  static toggleEditorReadOnly(isReadOnly) {
    this.editors.forEach(({ editor }) => {
      editor.updateOptions({ readOnly: isReadOnly });
      if (isReadOnly) {
        editor.blur();
      }
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
    this.editorContainer = document.getElementById('monaco-editor');
    if (!this.editorContainer) {
      console.error('Editor container not found');
      return;
    }
    this.editorContainer.style.position = 'relative';
    this.editorContainer.style.height = '100%';
    this.editorContainer.style.width = '100%';
    
    // Load saved theme preference
    const savedTheme = localStorage.getItem('editorTheme');
    const isDark = savedTheme ? savedTheme === 'dark' : true;
    this.setTheme(isDark);
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
    this.activeEditor.focus();
    this.activeEditor.layout();

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
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'operator', foreground: 'D4D4D4' },
        { token: 'delimiter', foreground: 'D4D4D4' }
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
        'scrollbarSlider.activeBackground': '#9d7fff60',
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
        { token: 'string', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
        { token: 'operator', foreground: '000000' },
        { token: 'delimiter', foreground: '000000' }
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
    
    // Initialize with saved theme
    const savedTheme = localStorage.getItem('editorTheme');
    const isDark = savedTheme ? savedTheme === 'dark' : true;
    EditorManager.currentTheme = isDark ? 'cmm-dark' : 'cmm-light';
    
    editorInstance = monaco.editor.create(document.getElementById('monaco-editor'), {
      theme: EditorManager.currentTheme,
      language: 'cmm',
      automaticLayout: true,
      minimap: { 
        enabled: true,
        scale: 1,
        showSlider: 'mouseover'
      },
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
      fontLigatures: true,
      scrollBeyondLastLine: true,
      renderWhitespace: 'selection',
      mouseWheelZoom: true,
      padding: { top: 16, bottom: 16 },
      cursorStyle: 'line',
      cursorWidth: 2,
      cursorBlinking: 'smooth',
      renderLineHighlight: 'gutter',
      lineNumbers: 'on',
      lineNumbersMinChars: 4,
      glyphMargin: false,
      folding: true,
      showFoldingControls: 'mouseover',
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true
      },
      smoothScrolling: true,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        useShadows: false,
        verticalHasArrows: false,
        horizontalHasArrows: false,
        verticalScrollbarSize: 12,
        horizontalScrollbarSize: 12,
        arrowSize: 0
      }
    });
    
    if (editorInstance) {
      editorInstance.onDidChangeCursorPosition(updateCursorPosition);
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
        [/#(PRNAME|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|NUGAIN|FFTSIZ|array|arrays|ITRAD)\b/, 'keyword.directive'],

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
        [/#(USEMAC|ENDMAC|INTERPOINT|PRNAME|DATYPE|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|NUGAIN|FFTSIZ)/, 'keyword.directive.cmm'],

        // StdLib functions
        [/\b(in|out|norm|pset|abs|sin|cos|sqrt|atan|sign|real|imag|fase)\b(?=\s*\()/, 'keyword.function.stdlib.cmm'],

        // StdLib functions
        [/\b(in|out|norm|pset|abs|sin|cos|sqrt|atan|sign|real|imag|fase)\b(?=\s*\()/, 'keyword.function.stdlib.cmm'],

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

// Initialize theme on DOM content loaded
document.addEventListener('DOMContentLoaded', () => {
  initializeTheme();
  
  const themeToggleBtn = document.getElementById('themeToggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }
});

function updateCursorPosition(e) {
  if (!editorInstance) {
    console.warn("Editor ainda não inicializado!");
    return;
  }
  
  const position = e.position;
  const statusElement = document.getElementById('editorStatus');
  
  if (statusElement && position) {
    statusElement.textContent = `Line ${position.lineNumber}, Column ${position.column}`;
  }
}
//TAB MANAGER ========================================================================================================================================================

class TabManager {
  static tabs = new Map(); // Store tab information
  static activeTab = null;
  static editorStates = new Map();
  static unsavedChanges = new Set(); // Track files with unsaved changes
  static closedTabsStack = [];

  // Add this method to close all tabs
static async closeAllTabs() {
  // Create a copy of the tabs keys to avoid modification during iteration
  const openTabs = Array.from(this.tabs.keys());
  
  // Close each tab
  for (const filePath of openTabs) {
    await this.closeTab(filePath);
  }
}

static async formatCurrentFile() {
  if (!this.activeTab) {
    console.warn('No active tab to format');
    return;
  }

  const filePath = this.activeTab;
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
      // Store cursor position and selection
      const position = editor.getPosition();
      const selection = editor.getSelection();
      
      // Update editor content
      editor.setValue(formattedCode);
      
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
      showCardNotification('Code formatted successfully', 'success');
    } else {
      showCardNotification('Code is already properly formatted', 'info');
    }
    
  } catch (error) {
    console.error('Code formatting failed:', error);
    showCardNotification(`Formatting failed: ${error.message}`, 'error');
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
    broomIcon.title = 'Format code';
  }
}

   // New method to make tabs sortable
   static initSortableTabs() {
    const tabContainer = document.getElementById('tabs-container');
    if (!tabContainer) return;

    let draggedTab = null;

    tabContainer.addEventListener('dragstart', (e) => {
      if (e.target.classList.contains('tab')) {
        draggedTab = e.target;
        e.dataTransfer.setData('text/plain', ''); // Required for Firefox
        e.target.classList.add('dragging');
      }
    });

    

    tabContainer.addEventListener('dragend', (e) => {
      if (draggedTab) {
        draggedTab.classList.remove('dragging');
        draggedTab = null;
      }
    });

    tabContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      const afterElement = this.getDragAfterElement(tabContainer, e.clientY);
      
      if (afterElement == null) {
        tabContainer.appendChild(draggedTab);
      } else {
        tabContainer.insertBefore(draggedTab, afterElement);
      }
    });
  }

  
  
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

  // Add formatting button (broom icon)
  html += `<i class="fa-solid fa-broom context-refactor-button toolbar-button" title="Format code" style="margin-left: auto; cursor: pointer;"></i>`;

  contextContainer.innerHTML = html;

  // Add click listener for formatting
  const broomIcon = contextContainer.querySelector('.context-refactor-button');
  if (broomIcon) {
    broomIcon.addEventListener('click', async () => {
      await TabManager.formatCurrentFile();
    });
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

 // Utility method to get file icon
 static getFileIcon(filename) {
  const extension = filename.split('.').pop().toLowerCase();
  const iconMap = {
    'js': 'fab fa-js',
    'jsx': 'fab fa-react',
    'ts': 'fab fa-js',
    'tsx': 'fab fa-react',
    'html': 'fab fa-html5',
    'css': 'fab fa-css3',
    'json': 'fas fa-code',
    'md': 'fab fa-markdown',
    'py': 'fab fa-python',
    'c': 'fas fa-code',
    'cpp': 'fas fa-code',
    'h': 'fas fa-code',
    'hpp': 'fas fa-code'
  };
  return iconMap[extension] || 'fas fa-file-code';
}


    // Improved tab addition method
    static addTab(filePath, content) {
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
  
      tab.innerHTML = `
        <i class="${this.getFileIcon(filePath.split('\\').pop())}"></i>
        <span class="tab-name">${filePath.split('\\').pop()}</span>
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
  
      // Store original content
      this.tabs.set(filePath, content);
  
      try {
        // Create editor and set content
        const editor = EditorManager.createEditorInstance(filePath);
        editor.setValue(content);
  
        // Setup change listener
        this.setupContentChangeListener(filePath, editor);
  
        this.activateTab(filePath);
      } catch (error) {
        console.error('Error creating editor:', error);
        this.closeTab(filePath);
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
  
// Modify the activateTab method to include highlighting
static activateTab(filePath) {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => tab.classList.remove('active'));

  const activeTab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
  if (activeTab) {
    activeTab.classList.add('active');
    this.activeTab = filePath;

    // Atualizar o caminho de contexto
    this.updateContextPath(filePath);

    // Highlight the file in the tree
    this.highlightFileInTree(filePath);

    // Activate corresponding editor
    const editor = EditorManager.setActiveEditor(filePath);
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

  static async saveAllFiles() {
    for (const [filePath, originalContent] of this.tabs.entries()) {
      const editor = EditorManager.getEditorForFile(filePath);
      if (!editor) continue;
  
      const currentContent = editor.getValue();
      
      // Só salva se tiver sido modificado
      if (currentContent !== originalContent) {
        try {
          await window.electronAPI.writeFile(filePath, currentContent);
          this.markFileAsSaved(filePath);
          this.tabs.set(filePath, currentContent);
        } catch (error) {
          console.error(`Erro ao salvar o arquivo ${filePath}:`, error);
          // Você pode adicionar uma notificação visual aqui
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

            // Fixed closeTab method
            static async closeTab(filePath) {
                // Prevent multiple simultaneous closes
                if (this.isClosingTab) return;
                this.isClosingTab = true;

                try {
                    // Check if file has unsaved changes
                    if (this.unsavedChanges.has(filePath)) {
                        const fileName = filePath.split(/[\\/]/).pop();
                        const result = await showUnsavedChangesDialog(fileName);
                        
                        switch (result) {
                            case 'save':
                                try {
                                    await this.saveFile(filePath);
                                } catch (error) {
                                    console.error('Failed to save file:', error);
                                    // Continue with closing even if save failed
                                }
                                break;
                            case 'dont-save':
                                // Continue with closing
                                break;
                            case 'cancel':
                            default:
                                return; // Don't close the tab
                        }
                    }

                    // Add to closed tabs stack for reopening
                    const currentContent = this.tabs.get(filePath);
                    this.closedTabsStack.push({
                        filePath: filePath,
                        content: currentContent,
                        timestamp: Date.now()
                    });

                    // Keep only last 10 closed tabs
                    if (this.closedTabsStack.length > 10) {
                        this.closedTabsStack.shift();
                    }

                    // Remove tab from UI
                    const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
                    if (tab) {
                        tab.remove();
                    }

                    // Clean up editor and data
                    EditorManager.closeEditor(filePath);
                    this.tabs.delete(filePath);
                    this.unsavedChanges.delete(filePath);
                    this.editorStates.delete(filePath);

                    // Handle active tab switching
                    if (this.activeTab === filePath) {
                        this.highlightFileInTree(null);
                        const remainingTabs = Array.from(this.tabs.keys());
                        
                        if (remainingTabs.length > 0) {
                            // Activate the last tab in the list
                            this.activateTab(remainingTabs[remainingTabs.length - 1]);
                        } else {
                            // No tabs left
                            this.activeTab = null;
                            this.updateContextPath(null);
                            
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
        
// Enhanced saveFile method
            // Enhanced saveFile method
            static async saveFile(filePath = null) {
                const currentPath = filePath || this.activeTab;
                if (!currentPath) return;

                try {
                    const currentEditor = EditorManager.getEditorForFile(currentPath);
                    if (!currentEditor) {
                        throw new Error('Editor not found for file');
                    }

                    const content = currentEditor.getValue();
                    await window.electronAPI.writeFile(currentPath, content);
                    
                    // Mark as saved and update stored content
                    this.markFileAsSaved(currentPath);
                    this.tabs.set(currentPath, content);
                    
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

window.onload = () => {
  require(['vs/editor/editor.main'], function() {
    EditorManager.initialize();
  });
};

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
      throw new Error(`Failed to format code: ${error.message}`);
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

//FILETREE ============================================================================================================================================================
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


//PROJECT BUTTON ==========================================================================================================================================================

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
  const buttons = ['cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'allcomp', 'settings', 'backupFolderBtn', 'projectInfo', 'saveFileBtn', 'settings-project'];
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

        <input type="number" id="nBits" required min="1" value="32">
      </div>
      <div class="form-group floating-point-options">
        <label for="nbMantissa">Nb Mantissa</label>
        <input type="number" id="nbMantissa" min="1" value="23">
      </div>
      <div class="form-group floating-point-options">
        <label for="nbExponent">Nb Exponent</label>
        <input type="number" id="nbExponent" min="1" value="8">
      </div>
      <div class="form-group">
        <label for="dataStackSize">Data Stack Size</label>
        <input type="number" id="dataStackSize" required min="1" value="10">
      </div>
      <div class="form-group">
        <label for="instructionStackSize">Instruction Stack Size</label>
        <input type="number" id="instructionStackSize" required min="1" value="10">
      </div>
      <div class="form-group">
        <label for="inputPorts">Number of Input Ports</label>
        <input type="number" id="inputPorts" required min="0" value="2">
      </div>
      <div class="form-group">
        <label for="outputPorts">Number of Output Ports</label>
        <input type="number" id="outputPorts" required min="0" value="2">
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

// BUTTONS ==============================================================================================================================================================

const explorerHeader = document.querySelector('.explorer-header') || document.createElement('div');
explorerHeader.className = 'explorer-header';
explorerHeader.innerHTML = `
  <div class="explorer-title">
    <span>Explorer</span>
  </div>
  <i class="fas fa-folder toolbar-icon" id="openExplorerFolder" title="Open in File Explorer"></i>
`;

// Adicionar ícones na toolbar
// Event listener para abrir o site no navegador padrão
const websiteLink = document.getElementById('websiteLink');
if (websiteLink) {
    websiteLink.addEventListener('click', () => {
        window.electronAPI.openExternal('https://nipscern.com'); // Abra o navegador padrão
    });
}

// Event listener para abrir o explorador de arquivos
document.getElementById('openExplorerFolder')?.addEventListener('click', async () => {
    const currentPath = await window.electronAPI.getCurrentFolder();
    if (currentPath) {
        await window.electronAPI.openInExplorer(currentPath);
    }
});

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
      /* Backdrop */
      .ai-assistant-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.1);
        z-index: var(--z-40);
        opacity: 0;
        visibility: hidden;
        transition: all var(--transition-normal);
      }
      
      .ai-assistant-backdrop.open {
        opacity: 1;
        visibility: visible;
      }

      /* Main Container */
      .ai-assistant-container {
        position: fixed;
        top: 0;
        right: 0;
        transform: translateX(100%);
        width: 480px;
        height: 100vh;
        background: var(--bg-primary);
        border-left: 1px solid var(--border-primary);
        overflow: hidden;
        z-index: 99999;
        transition: transform var(--transition-normal);
        box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        min-width: 320px;
        max-width: 80vw;
      }
      
      .ai-assistant-container.open {
        transform: translateX(0);
      }

      /* Header */
      .ai-assistant-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-4);
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-primary);
        backdrop-filter: blur(12px);
        position: relative;
      }
      
      .ai-assistant-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: var(--gradient-primary);
        opacity: 0.6;
      }

      .ai-assistant-title {
        font-family: var(--font-sans);
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
        margin: 0;
      }

      .ai-header-left {
        display: flex;
        align-items: center;
        gap: var(--space-3);
      }

      .ai-toggle-icon {
        width: 24px;
        height: 24px;
        cursor: pointer;
        transition: all var(--transition-fast);
        filter: brightness(1.2);
        border-radius: var(--radius-md);
        padding: var(--space-1);
      }
      
      .ai-toggle-icon:hover {
        background: var(--hover-overlay);
        transform: scale(1.05);
      }

      /* Provider Selection */
      .ai-provider-section {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        background: var(--bg-tertiary);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-secondary);
      }

      .ai-provider-icon {
        width: 20px;
        height: 20px;
        transition: all var(--transition-normal);
        border-radius: var(--radius-sm);
      }

      .ai-provider-select {
        appearance: none;
        background: transparent;
        color: var(--text-primary);
        border: none;
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        cursor: pointer;
        outline: none;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
      }
      
      .ai-provider-select:hover {
        background: var(--hover-overlay);
      }
      
      .ai-provider-select:focus {
        background: var(--bg-hover);
        box-shadow: var(--shadow-focus);
      }

      /* Close Button */
      .ai-assistant-close {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-secondary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--transition-fast);
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }
      
      .ai-assistant-close:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
        transform: scale(1.05);
      }
      
      .ai-assistant-close:active {
        transform: scale(0.95);
        background: var(--bg-active);
      }

      /* Content Area */
      .ai-assistant-content {
        flex: 1;
        position: relative;
        background: var(--bg-primary);
        overflow: hidden;
      }

      .ai-assistant-webview {
        width: 100%;
        height: 100%;
        border: none;
        background: var(--bg-primary);
      }

      /* Loading State */
      .ai-loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--bg-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: var(--space-4);
        transition: all var(--transition-normal);
        z-index: var(--z-10);
      }

      .ai-loading-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid var(--border-primary);
        border-top: 3px solid var(--accent-primary);
        border-radius: var(--radius-full);
        animation: ai-spin 1s linear infinite;
      }

      .ai-loading-text {
        color: var(--text-secondary);
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }

      @keyframes ai-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      /* Resize Handle */
      .ai-resize-handle {
        position: absolute;
        top: 0;
        left: 0;
        width: 6px;
        height: 100%;
        cursor: ew-resize;
        background: transparent;
        transition: background-color var(--transition-fast);
        z-index: var(--z-10);
      }

      .ai-resize-handle:hover {
        background: var(--accent-primary);
        opacity: 0.5;
      }

      /* Responsive Design */
      @media (max-width: 640px) {
        .ai-assistant-container {
          width: 95vw;
          height: 90vh;
          border-radius: var(--radius-lg);
        }
        
        .ai-assistant-header {
          padding: var(--space-3);
        }
        
        .ai-header-left {
          gap: var(--space-2);
        }
        
        .ai-assistant-title {
          font-size: var(--text-base);
        }
      }

      /* Animation improvements */
      .ai-assistant-container,
      .ai-assistant-backdrop {
        will-change: opacity, transform, visibility;
      }
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


//WINDOW.ONLOAD ===========================================================================================================================================================
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


//COMP ========================================================================================================================================================
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

      // Load processor configuration
      const config = await window.electronAPI.loadConfig();
      this.config = config;
      console.log("Processor config loaded:", config);

      // Load project configuration if in project-oriented mode
      if (this.isProjectOriented) {
        const projectConfigPath = await window.electronAPI.joinPath(this.projectPath, 'projectOriented.json');
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

  async cmmCompilation(processor) {
    const { name } = processor;
    this.terminalManager.appendToTerminal('tcmm', `Starting CMM compilation for ${name}...`);
    
    try {
      // Create paths exactly as in the batch files
      const projectPath = await window.electronAPI.joinPath(this.projectPath, name);
      const cmmPath = await window.electronAPI.joinPath(this.projectPath, name, 'Software', `${name}.cmm`);
      const softwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Software');
      const asmPath = await window.electronAPI.joinPath(softwarePath, `${name}.asm`);
      const macrosPath = await window.electronAPI.joinPath('saphoComponents', 'Macros');
      const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
      const cmmCompPath = await window.electronAPI.joinPath('saphoComponents', 'bin', 'cmmcomp.exe');

      await TabManager.saveAllFiles();

      // Start compilation status indicator
      statusUpdater.startCompilation('cmm');

      // Build command as in the bat file: CMMComp.exe %PROC% %PROC_DIR% %MAC_DIR% %TMP_PRO%
      const cmd = `"${cmmCompPath}" ${name} "${projectPath}" "${macrosPath}" "${tempPath}"`;
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
      this.terminalManager.appendToTerminal('tasm', `Starting ASM compilation for ${name}...`);
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
        const testbenchSource = await window.electronAPI.joinPath(tempPath, `${name}_tb.v`);
        const testbenchDestination = await window.electronAPI.joinPath(simulationPath, `${name}_tb.v`);
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

  async iverilogCompilation(processor) {
    // If we're in project-oriented mode, run the project-oriented compilation
    if (this.isProjectOriented) {
      return this.iverilogProjectCompilation();
    }
    
    // Otherwise, run the standard processor-oriented compilation
    const { name } = processor;
    this.terminalManager.appendToTerminal('tveri', `Starting Icarus Verilog compilation for ${name}...`);
    statusUpdater.startCompilation('verilog');
    
    try {
      const appPath = await window.electronAPI.getAppPath();
      const basePath = await window.electronAPI.joinPath(appPath, '..', '..');
      const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
      const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
      const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
      const simulationPath = await window.electronAPI.joinPath(this.projectPath, name, 'Simulation');
      const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog' ,'bin', 'iverilog.exe');

      // Get the flags from config
      const flags = this.config.iverilogFlags ? this.config.iverilogFlags.join(' ') : '';
      
      // Build the list of verilog files to compile
      const verilogFiles = [
        'addr_dec.v', 'instr_dec.v', 'processor.v', 'core.v', 'ula.v'
      ];

      await TabManager.saveAllFiles();
      
      // Build the iverilog command as in the batch file
      // %IVERILOG% -s %TB_MOD% -o %TMP_PRO%\%PROC%.vvp %SIMU_DIR%\%TB_MOD%.v %UPROC%.v addr_dec.v instr_dec.v processor.v core.v ula.v
      const verilogFilesString = verilogFiles.map(file => `${file}`).join(' ');
      
      const cmd = `cd "${hdlPath}" && "${iveriCompPath}" ${flags} -s ${name} -o "${await window.electronAPI.joinPath(tempPath, name)}" "${await window.electronAPI.joinPath(hardwarePath, `${name}.v`)}" ${verilogFilesString}`;
      
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
      
      // Copy memory files to temp directory as in the batch file
      await window.electronAPI.copyFile(
        await window.electronAPI.joinPath(hardwarePath, `${name}_data.mif`),
        await window.electronAPI.joinPath(tempPath, `${name}_data.mif`)
      );
      
      await window.electronAPI.copyFile(
        await window.electronAPI.joinPath(hardwarePath, `${name}_inst.mif`),
        await window.electronAPI.joinPath(tempPath, `${name}_inst.mif`)
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
    const topLevelDir = await window.electronAPI.joinPath(this.projectPath, 'Top Level');
    const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog' ,'bin', 'iverilog.exe');

    // Get processors from project configuration
    const processors = this.projectConfig.processors || [];
    if (processors.length === 0) {
      throw new Error("No processors defined in project configuration");
    }
    
    // Get the testbench file
    const testbenchFile = this.projectConfig.testbenchFile;
    if (!testbenchFile) {
      throw new Error("No testbench file specified in project configuration");
    }
    
    // Get the top level file
    const topLevelFile = this.projectConfig.topLevelFile;
    
    // Build list of HDL files
    const hdlFiles = await window.electronAPI.readDir(hdlDir);
    let hdlVerilogFiles = "";
    for (const file of hdlFiles) {
      if (file.endsWith('.v')) {
        const hdlFilePath = await window.electronAPI.joinPath(hdlDir, file);
        hdlVerilogFiles += `"${hdlFilePath}" `;
      }
    }
    
    // Build list of TopLevel files
    const topLevelFiles = await window.electronAPI.readDir(topLevelDir);  
    let topLevelVerilogFiles = "";
    for (const file of topLevelFiles) {
      if (file.endsWith('.v')) {
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
    let topModuleName = testbenchFile.replace('.v', '');
    
    if (topLevelFile && topLevelFile !== "Standard") {
      topModuleName = topLevelFile.replace('.v', '');
    }
    
    // Resolve output path
    const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, `${projectName}`);
    
    const cmd = `cd "${tempBaseDir}" && "${iveriCompPath}" ${flags} -s ${topModuleName} -o "${outputFilePath}" ${hdlVerilogFiles} ${processorVerilogFiles} ${topLevelVerilogFiles}`;
    
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

async runGtkWave(processor) {
  // If we're in project-oriented mode, run the project GTKWave
  if (this.isProjectOriented) {
    checkCancellation();
    return this.runProjectGtkWave();
  }
  
  // Otherwise, run the standard processor GTKWave
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
    const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog' ,'bin', 'iverilog.exe');
    const vvpCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog' ,'bin', 'vvp.exe');
    const gtkwCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'gtkwave' ,'bin', 'gtkwave.exe');

    // Create tcl_infos.txt
    const tclFilePath = await window.electronAPI.joinPath(tempPath, 'tcl_infos.txt');
    this.terminalManager.appendToTerminal('twave', `Creating tcl_infos.txt in ${tempPath}...`);
    
    // Create file content
    const tclContent = `${tempPath}\n${binPath}\n`;
    
    // Write the file
    await window.electronAPI.writeFile(tclFilePath, tclContent);
    
    // Check for custom testbench file from config
          // Check for testbench files as in the bat
      let tbFile = this.config.testbenchFile;
       let tbMod;
    if (this.config.testbenchFile && this.config.testbenchFile !== 'standard') {
      // User-specified testbench
      const simulationFiles = await window.electronAPI.readDir(simulationPath);
      if (simulationFiles.includes(this.config.testbenchFile)) {
        tbMod = this.config.testbenchFile.replace(/\.v$/i, '');
      } else {
        this.terminalManager.appendToTerminal(
          'tveri',
          `Warning: Specified testbench ${this.config.testbenchFile} not found in Simulation. Falling back to standard.`,
          'warning'
        );
        tbMod = `${name}_tb`;
      }
    } else {
      // Standard testbench: name_tb.v
      tbMod = `${name}_tb`;
    }
    
    await TabManager.saveAllFiles();
    
    // Build the list of verilog files to compile - simply use file names here
    const verilogFiles = [
      'addr_dec.v', 'instr_dec.v', 'processor.v', 'core.v', 'ula.v'
    ];
    
    // Just use the file names without paths since we're changing directory
    const verilogFilesString = verilogFiles.map(file => `${file}`).join(' ');
    
    // Resolve all paths before building the command
    const outputFile = await window.electronAPI.joinPath(tempPath, name);
    const procFile = await window.electronAPI.joinPath(hardwarePath, `${name}.v`);
    
    // 1. First compile with iverilog including testbench
    const iverilogCmd = `cd "${hdlPath}" && "${iveriCompPath}" -s ${tbMod} -o "${outputFile}" "${await window.electronAPI.joinPath(simulationPath, `${tbMod}.v`)}" "${procFile}" ${verilogFilesString}`;
    
    this.terminalManager.appendToTerminal('twave', `Compiling with Icarus Verilog and testbench:\n${iverilogCmd}`);
    
    const iverilogResult = await window.electronAPI.execCommand(iverilogCmd);
    
    if (iverilogResult.stdout) {
      this.terminalManager.appendToTerminal('twave', iverilogResult.stdout, 'stdout');
    }
    if (iverilogResult.stderr) {
      this.terminalManager.appendToTerminal('twave', iverilogResult.stderr, 'stderr');
    }
    
    if (iverilogResult.code !== 0) {
      statusUpdater.compilationError('wave', `Icarus Verilog compilation failed with code ${iverilogResult.code}`);
      throw new Error(`Icarus Verilog compilation failed with code ${iverilogResult.code}`);
    }
    
    // 2. Copy required memory files to the temp directory
    const dataMemSource = await window.electronAPI.joinPath(hardwarePath, `${name}_data.mif`);
    const dataMemDest = await window.electronAPI.joinPath(tempPath, `${name}_data.mif`);
    await window.electronAPI.copyFile(dataMemSource, dataMemDest);
    
    const instMemSource = await window.electronAPI.joinPath(hardwarePath, `${name}_inst.mif`);
    const instMemDest = await window.electronAPI.joinPath(tempPath, `${name}_inst.mif`);
    await window.electronAPI.copyFile(instMemSource, instMemDest);
    
    // 3. Run VVP simulation to generate the VCD file
    this.terminalManager.appendToTerminal('twave', 'Running VVP simulation to generate VCD file...');
    showVvpSpinner();
    const vvpCmd = `cd "${tempPath}" && "${vvpCompPath}" "${name}" -fst`;
    this.terminalManager.appendToTerminal('twave', `Executing command: ${vvpCmd}`);
    
    const vvpResult = await window.electronAPI.execCommand(vvpCmd);
    
    if (vvpResult.stdout) {
      this.terminalManager.appendToTerminal('twave', vvpResult.stdout, 'stdout');
      hideVvpSpinner();
    }
    if (vvpResult.stderr) {
      this.terminalManager.appendToTerminal('twave', vvpResult.stderr, 'stderr');
      hideVvpSpinner();
    }
    
    if (vvpResult.code !== 0) {
      statusUpdater.compilationError('wave', `VVP simulation failed with code ${vvpResult.code}`);
      hideVvpSpinner();
      throw new Error(`VVP simulation failed with code ${vvpResult.code}`);
    }
    
    // 4. Launch GTKWave with the generated VCD file
    let gtkwCmd;
    // Check for custom GTKWave file from config
    const useStandardGtkw = !processor.gtkwFile || processor.gtkwFile === "standard";
    
    if (useStandardGtkw) {
      // Use standard simulation (script-based)
      const scriptPath = await window.electronAPI.joinPath(scriptsPath, 'gtk_proc_init.tcl');
      const vcdPath = await window.electronAPI.joinPath(tempPath, `${tbMod}.vcd`);
      
      gtkwCmd = `cd "${tempPath}" && "${gtkwCompPath}" --rcvar "hide_sst on" --dark "${vcdPath}" --script="${scriptPath}"`;
    } else {
      // Use custom gtkw file
      const gtkwPath = await window.electronAPI.joinPath(simulationPath, processor.gtkwFile);
      const vcdPath = await window.electronAPI.joinPath(tempPath, `${tbMod}.vcd`);
      const posScriptPath = await window.electronAPI.joinPath(scriptsPath, 'pos_gtkw.tcl');
      
      gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --dark "${vcdPath}" "${gtkwPath}" --script="${posScriptPath}"`;
    }
    
    this.terminalManager.appendToTerminal('twave', `Executing GTKWave command:\n${gtkwCmd}`);
    
    const gtkwResult = await window.electronAPI.execCommand(gtkwCmd);
    
    if (gtkwResult.stdout) {
      this.terminalManager.appendToTerminal('twave', gtkwResult.stdout, 'stdout');
    }
    if (gtkwResult.stderr) {
      this.terminalManager.appendToTerminal('twave', gtkwResult.stderr, 'stderr');
    }
    
    if (gtkwResult.code !== 0) {
      statusUpdater.compilationError('wave', `GTKWave execution failed with code ${gtkwResult.code}`);
      throw new Error(`GTKWave execution failed with code ${gtkwResult.code}`);
    }
    
    this.terminalManager.appendToTerminal('twave', 'GTKWave completed successfully.', 'success');
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
    
    const tempBaseDir = await window.electronAPI.joinPath('saphoComponents', 'Temp');
    const hdlDir = await window.electronAPI.joinPath('saphoComponents', 'HDL');
    const binDir = await window.electronAPI.joinPath('saphoComponents', 'bin');
    const scriptsPath = await window.electronAPI.joinPath('saphoComponents', 'Scripts');
    const topLevelDir = await window.electronAPI.joinPath(this.projectPath, 'Top Level');
    const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog' ,'bin', 'iverilog.exe');
    const vvpCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog' ,'bin', 'vvp.exe');
    const gtkwCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'gtkwave' ,'bin', 'gtkwave.exe');

    // Get processors from project configuration
    const processors = this.projectConfig.processors || [];
    if (processors.length === 0) {
      throw new Error("No processors defined in project configuration");
    }
    
    // Get testbench and gtkwave file info
    const testbenchFile = this.projectConfig.testbenchFile;
    if (!testbenchFile) {
      throw new Error("No testbench file specified in project configuration");
    }
    
    const tbModule = testbenchFile.replace('.v', '');
    const gtkwaveFile = this.projectConfig.gtkwaveFile;
    
    // 1. First, compile with iverilog including all files
    
    // Build list of HDL files - properly resolve paths
    const hdlFiles = await window.electronAPI.readDir(hdlDir);
    let hdlVerilogFiles = "";
    for (const file of hdlFiles) {
      if (file.endsWith('.v')) {
        const hdlFilePath = await window.electronAPI.joinPath(hdlDir, file);
        hdlVerilogFiles += `"${hdlFilePath}" `;
      }
    }
    
    // Build list of TopLevel files - properly resolve paths
    const topLevelFiles = await window.electronAPI.readDir(topLevelDir);  
    let topLevelVerilogFiles = "";
    for (const file of topLevelFiles) {
      if (file.endsWith('.v')) {
        const topLevelFilePath = await window.electronAPI.joinPath(topLevelDir, file);
        topLevelVerilogFiles += `"${topLevelFilePath}" `;
      }
    }
    
    // Build list of processor files - properly resolve paths
    let processorVerilogFiles = "";
    for (const processor of processors) {
      const procName = processor.type;
      const procPath = await window.electronAPI.joinPath(this.projectPath, procName, 'Hardware', `${procName}.v`);
      processorVerilogFiles += `"${procPath}" `;
      
      // Ensure processor temp dir exists
      await this.ensureDirectories(procName);
    }
    
    // Get flags
    const flags = this.projectConfig.iverilogFlags || "";
    
    await TabManager.saveAllFiles();
    
    // Run Iverilog compile with testbench
    const projectName = this.projectPath.split(/[\/\\]/).pop();
    const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, projectName);
    
    const iverilogCmd = `cd "${tempBaseDir}" && "${iveriCompPath}" ${flags} -s ${tbModule} -o "${outputFilePath}" ${hdlVerilogFiles} ${processorVerilogFiles} ${topLevelVerilogFiles}`;
    
    this.terminalManager.appendToTerminal('twave', `Compiling with Icarus Verilog for project:\n${iverilogCmd}`);
    
    const iverilogResult = await window.electronAPI.execCommand(iverilogCmd);
    
    if (iverilogResult.stdout) {
      this.terminalManager.appendToTerminal('twave', iverilogResult.stdout, 'stdout');
    }
    if (iverilogResult.stderr) {
      this.terminalManager.appendToTerminal('twave', iverilogResult.stderr, 'stderr');
    }
    
    if (iverilogResult.code !== 0) {
      statusUpdater.compilationError('wave', `Icarus Verilog compilation failed with code ${iverilogResult.code}`);
      throw new Error(`Icarus Verilog compilation failed with code ${iverilogResult.code}`);
    }
    
    // 2. Copy memory files for each processor to temp directory
    for (const processor of processors) {
      const procName = processor.type;
      const hardwarePath = await window.electronAPI.joinPath(this.projectPath, procName, 'Hardware');
      
      // Copy data memory file - resolve paths properly
      const dataMemSource = await window.electronAPI.joinPath(hardwarePath, `${procName}_data.mif`);
      const dataMemDest = await window.electronAPI.joinPath(tempBaseDir, `${procName}_data.mif`);
      await window.electronAPI.copyFile(dataMemSource, dataMemDest);
      
      // Copy instruction memory file - resolve paths properly
      const instMemSource = await window.electronAPI.joinPath(hardwarePath, `${procName}_inst.mif`);
      const instMemDest = await window.electronAPI.joinPath(tempBaseDir, `${procName}_inst.mif`);
      await window.electronAPI.copyFile(instMemSource, instMemDest);
      
      // Copy PC memory file if it exists in temp processor directory
      const pcMemPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', procName, `pc_${procName}_mem.txt`);
      const pcMemDest = await window.electronAPI.joinPath(tempBaseDir, `pc_${procName}_mem.txt`);
      try {
        await window.electronAPI.copyFile(pcMemPath, pcMemDest);
      } catch (error) {
        this.terminalManager.appendToTerminal('twave', `Warning: Could not copy PC memory file for ${procName}. This may be expected.`, 'warning');
      }
    }
    
    // Copy any text files from TopLevel to temp directory
    for (const file of topLevelFiles) {
      if (file.endsWith('.txt')) {
        const txtSource = await window.electronAPI.joinPath(topLevelDir, file);
        const txtDest = await window.electronAPI.joinPath(tempBaseDir, file);
        await window.electronAPI.copyFile(txtSource, txtDest);
      }
    }
    
    // 3. Write tcl_infos.txt for project
    const tclFilePath = await window.electronAPI.joinPath(tempBaseDir, 'tcl_infos.txt');
    
    // Create the instance list and processor type list
    let instanceList = "";
    let processorTypeList = "";
    
    for (const proc of processors) {
      instanceList += `${proc.instance} `;
      processorTypeList += `${proc.type} `;
    }
    
    // Create file content
    const tclContent = `${instanceList.trim()}\n${processorTypeList.trim()}\n${tempBaseDir}\n${binDir}\n`;
    
    // Write the file
    await window.electronAPI.writeFile(tclFilePath, tclContent);
    
    this.terminalManager.appendToTerminal('twave', `tcl_infos.txt created for project GTKWave.`);
    
    // 4. Run VVP simulation to generate the VCD file
    this.terminalManager.appendToTerminal('twave', 'Running VVP simulation for project...');
    const vvpCmd = `cd "${tempBaseDir}" && "${vvpCompPath}" "${projectName}" -fst`;
    this.terminalManager.appendToTerminal('twave', `Executing command: ${vvpCmd}`);
    
    this.terminalManager.appendToTerminal('twave', 'VVP simulation in progress. Wait patiently!', 'warning');
      try {
      showVvpSpinner();

      const vvpResult = await window.electronAPI.execCommand(vvpCmd);
       
      this.terminalManager.appendToTerminal('twave', 'VVP simulation completed', 'success');
      
      if (vvpResult.stdout) {
        this.terminalManager.appendToTerminal('twave', vvpResult.stdout, 'stdout');
      }
      if (vvpResult.stderr) {
        this.terminalManager.appendToTerminal('twave', vvpResult.stderr, 'stderr');
      }
      
      if (vvpResult.code !== 0) {
        statusUpdater.compilationError('wave', `VVP simulation failed with code ${vvpResult.code}`);
        throw new Error(`VVP simulation failed with code ${vvpResult.code}`);
      }
    } catch (error) {
      throw error;
    }
    hideVvpSpinner();

    // 5. Launch GTKWave - resolve paths properly and include working directory
    let gtkwCmd;
    
    if (gtkwaveFile && gtkwaveFile !== "Standard") {
      // Use custom gtkw file
      const gtkwPath = await window.electronAPI.joinPath(topLevelDir, gtkwaveFile);
      const posScriptPath = await window.electronAPI.joinPath(scriptsPath, 'pos_gtkw.tcl');
      gtkwCmd = `cd "${tempBaseDir}" && "${gtkwCompPath}" --rcvar "hide_sst on" --dark "${gtkwPath}" --script="${posScriptPath}"`;
    } else {
      // Use standard project init script
      const vcdPath = await window.electronAPI.joinPath(tempBaseDir, `${tbModule}.vcd`);
      const initScriptPath = await window.electronAPI.joinPath(scriptsPath, 'gtk_proj_init.tcl');
      gtkwCmd = `cd "${tempBaseDir}" && "${gtkwCompPath}" --rcvar "hide_sst on" --dark "${vcdPath}" --script="${initScriptPath}"`;
    }
    
    statusUpdater.startCompilation('wave');

    this.terminalManager.appendToTerminal('twave', `Executing GTKWave command:\n${gtkwCmd}`);
    
    const gtkwResult = await window.electronAPI.execCommand(gtkwCmd);
    
    if (gtkwResult.stdout) {
      this.terminalManager.appendToTerminal('twave', gtkwResult.stdout, 'stdout');
    }
    if (gtkwResult.stderr) {
      this.terminalManager.appendToTerminal('twave', gtkwResult.stderr, 'stderr');
    }
     
    if (gtkwResult.code !== 0) {
      statusUpdater.compilationError('wave', `GTKWave execution failed with code ${gtkwResult.code}`);
      throw new Error(`GTKWave execution failed with code ${gtkwResult.code}`);
    }
    
    this.terminalManager.appendToTerminal('twave', 'Project GTKWave completed successfully.', 'success');
    statusUpdater.compilationSuccess('wave');
    
  } catch (error) {
    this.terminalManager.appendToTerminal('twave', `Error: ${error.message}`, 'error');
    statusUpdater.compilationError('wave', error.message);
    throw error;
  }
}

 async compileAll() {
  try {
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



document.getElementById('pause-everything').addEventListener('click', () => {
  if (isCompilationRunning) {
    // Cancel the compilation
    cancelCompilation();
  } else {
    // No compilation running, show info message
    showCardNotification('No compilation process is currently running.', 'info', 3000);
  }
});

// Enhanced cancelCompilation function with multi-terminal error display
function cancelCompilation() {
  if (isCompilationRunning) {
    compilationCanceled = true;
    isCompilationRunning = false;
    
    // Force enable buttons immediately on cancellation
    setCompilationButtonsState(false);
    
    // Display cancellation message in all terminals
    const terminals = ['tcmm', 'tasm', 'tveri', 'twave'];
    terminals.forEach(terminalId => {
      if (globalTerminalManager) {
        globalTerminalManager.appendToTerminal(terminalId, 'Compilation process canceled by user.', 'error');
      }
    });
    
    showCardNotification('Compilation process has been canceled by user.', 'error', 4000);
    console.log('Compilation canceled by user');
    
    // Call endCompilation to ensure proper cleanup
    endCompilation();
  } else {
    showCardNotification('No compilation process is currently running.', 'info', 3000);
  }
}

// Enhanced checkCancellation function with terminal error display
function checkCancellation() {
  if (compilationCanceled) {
    // Display cancellation in current active terminal before throwing error
    if (globalTerminalManager) {
      const terminals = ['tcmm', 'tasm', 'tveri', 'twave'];
      terminals.forEach(terminalId => {
        globalTerminalManager.appendToTerminal(terminalId, 'Compilation interrupted by user cancellation.', 'error');
      });
    }
    throw new Error('Compilation canceled by user');
  }
}

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
      console.error('No project opened');
      return;
    }
    this.compiler = new CompilationModule(currentProjectPath);
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

//TERMINAL =============================================================================================================================================================

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
    
    if (!TerminalManager.clearButtonInitialized) {
      this.setupClearButton();
      TerminalManager.clearButtonInitialized = true;
    }
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

  appendToTerminal(terminalId, message, type = 'info') {
    const terminal = this.terminals[terminalId];
    if (terminal) {
      const line = document.createElement('div');
      line.className = `terminal-line ${type}`;
      line.innerHTML = message;
      terminal.appendChild(line);
      this.scrollToBottom(terminalId);
    }
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

//TESTE ========================================================================================================================================================
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

// Elementos do modal de confirmação
const confirmDeleteModal = document.getElementById('confirmDeleteModal');
const confirmDeleteBtn = document.getElementById('confirmDelete');
const cancelDeleteBtn = document.getElementById('cancelDelete');
const deleteTempBtn = document.getElementById('deleteTempFolder');

// Handler para o botão de deletar
deleteTempBtn.addEventListener('click', () => {
  confirmDeleteModal.classList.add('show');
});

// Handler para cancelar a deleção
cancelDeleteBtn.addEventListener('click', () => {
  confirmDeleteModal.classList.remove('show');
});

// Handler para confirmar a deleção
confirmDeleteBtn.addEventListener('click', async () => {
  try {
    const basePath = await window.electronAPI.joinPath(appPath, '..', '..');
    const tempPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'Temp');
    await window.electronAPI.deleteFolder(tempPath);
    
    // Fechar o modal de confirmação
    confirmDeleteModal.classList.remove('show');
    
    // Opcional: Mostrar mensagem de sucesso
    // Você pode usar sua própria função de notificação aqui
  } catch (error) {
    console.error('Error deleting temp folder:', error);
    // Opcional: Mostrar mensagem de erro
  }
});


// Selecionando o ícone de jornal
const newsIcon = document.querySelector('.fa-newspaper');

// Função para abrir o menu lateral
function openNewsSidebar() {
    // Verifica se o menu já existe
    let newsSidebar = document.querySelector('.news-sidebar');
    if (!newsSidebar) {
        // Cria o container do menu lateral
        newsSidebar = document.createElement('div');
        newsSidebar.classList.add('news-sidebar');
        newsSidebar.innerHTML = `
    <webview src="../html/news.html" class="news-webview" nodeintegration></webview>
`;
        document.body.appendChild(newsSidebar);

        // Animação para aparecer o menu lateral
        setTimeout(() => {
            newsSidebar.classList.add('active');
        }, 10);

        // Fecha o menu ao clicar fora dele
        window.addEventListener('click', (event) => {
            if (!newsSidebar.contains(event.target) && !newsIcon.contains(event.target)) {
                newsSidebar.classList.remove('active');
                setTimeout(() => {
                    newsSidebar.remove();
                }, 300);
            }
        });
    }
}

// Evento de clique no ícone de jornal
newsIcon.addEventListener('click', openNewsSidebar);


async function refactorCode(code) {
  try {
    return await window.electronAPI.refactorCode(code);
  } catch (err) {
    console.error('Erro ao refatorar código:', err);
    return code; // Fallback para código original
  }
}
// renderer.js
// --- CONFIG CLEARS ---

// 1. Clear only processorConfig.json
async function clearProcessorConfig() {
  try {
    const processorConfigPath = await window.electronAPI.joinPath(
      'saphoComponents',
      'Scripts',
      'processorConfig.json'
    );

    const defaultProcessorConfig = {
      processors: [],
      iverilogFlags: [],
      cmmCompFlags: [],
      asmCompFlags: [],
      testbenchFile: "standard",
      gtkwFile: "standard"
    };

    await window.electronAPI.writeFile(
      processorConfigPath,
      JSON.stringify(defaultProcessorConfig, null, 2)
    );
    console.log('processorConfig.json was reset to defaults');
  } catch (err) {
    console.error('Error clearing processorConfig.json:', err);
  }
}

// 2. Clear only projectOriented.json
async function clearProjectConfig(projectPath) {
  try {
    const projectConfigPath = await window.electronAPI.joinPath(
      projectPath,
      'projectOriented.json'
    );

    const defaultProjectOriented = {
      topLevelFile: "Standard",
      testbenchFile: "Standard",
      gtkwaveFile: "Standard",
      processors: [],
      iverilogFlags: ""
    };

    await window.electronAPI.writeFile(
      projectConfigPath,
      JSON.stringify(defaultProjectOriented, null, 2)
    );
    console.log('projectOriented.json was reset to defaults');
  } catch (err) {
    console.error('Error clearing projectOriented.json:', err);
  }
}

// --- WIRING UP THE BUTTON ---

document.getElementById('clearAll')
  .addEventListener('click', async () => {
    const fanBtn = document.getElementById('toggle-ui');

    // Replace this with however you know "fan" is on/off
    const fanIsActive = fanBtn.classList.contains('active');

    if (fanIsActive) {
      // Fan is ON ⇒ clear the project config
      await clearProjectConfig(window.currentProjectPath);
    } else {
      // Fan is OFF ⇒ clear the processor config
      await clearProcessorConfig();
    }
  });

  // Mostrar spinner quando VVP iniciar
function showVvpSpinner() {
    document.getElementById('vvp-spinner').classList.add('active');
}

// Esconder spinner quando VVP terminar
function hideVvpSpinner() {
    document.getElementById('vvp-spinner').classList.remove('active');
}
