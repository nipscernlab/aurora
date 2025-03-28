let editor;
let openFiles = new Map();
let activeFile = null;
let compiling = false;
let terminal = null;
let aiAssistantVisible = false;
let aiAssistantContainer = null;
let currentProvider = 'chatgpt'; // or 'claude'
let editorInstance;

class SimulationModal {
  constructor() {
    this.modal = null;
    this.tbFiles = [];
    this.gtkwFiles = [];
    this.selectedTb = '';
    this.selectedGtkw = '';
    this.standardSimulation = false;
  }

  async show(hardwarePath) {
    // Read directory contents
    const files = await window.electronAPI.readDir(hardwarePath);
    this.tbFiles = files.filter(file => file.endsWith('_tb.v'));
    this.gtkwFiles = files.filter(file => file.endsWith('.gtkw'));

    return new Promise((resolve) => {
      this.createModal(resolve);
    });
  }

  createModal(resolve) {
    // Como a compilação será sempre padrão, resolvemos imediatamente
    resolve({
      standardSimulation: true,
      selectedTb: '',    // ou outro valor padrão, se necessário
      selectedGtkw: ''   // ou outro valor padrão, se necessário
    });
  }

}

// SHOW DIALOG =====================================================================================================================
function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <div class="confirm-dialog">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="dialog-buttons">
          <button id="cancelButton">Cancel</button>
          <button id="confirmButton">Save</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    dialog.showModal();

    const confirmButton = dialog.querySelector('#confirmButton');
    const cancelButton = dialog.querySelector('#cancelButton');

    confirmButton.onclick = () => {
      dialog.close();
      dialog.remove();
      resolve(true);
    };

    cancelButton.onclick = () => {
      dialog.close();
      dialog.remove();
      resolve(false);
    };
  });
}

//MONACO EDITOR ========================================================================================================================================================
class EditorManager {
  static editors = new Map();
  static activeEditor = null;
  static editorContainer = null;
  static currentTheme = 'cmm-dark'; // tema padrão

  static initialize() {
    this.editorContainer = document.getElementById('monaco-editor');
    if (!this.editorContainer) {
      console.error('Editor container not found');
      return;
    }
    this.editorContainer.style.position = 'relative';
    this.editorContainer.style.height = '100%';
    this.editorContainer.style.width = '100%';
  }

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
      theme: this.currentTheme,  // Use o tema atual
      language: this.getLanguageFromPath(filePath),
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 14,
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      mouseWheelZoom: true,
      padding: { top: 10 }
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
  // Adicione método para atualizar o tema
  static setTheme(isDark) {
    this.currentTheme = isDark ? 'cmm-dark' : 'cmm-light';
    this.editors.forEach(({editor}) => {
      editor.updateOptions({ theme: this.currentTheme });
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

function setupASMLanguage() {
  monaco.languages.register({ id: 'asm' });

  monaco.languages.setMonarchTokensProvider('asm', {
    defaultToken: '',
    tokenPostfix: '.asm',

    // Diretivas específicas do ASM
    directives: [
      'PRNAME', 'NUBITS', 'NBMANT', 'NBEXPO', 'NDSTAC',
      'SDEPTH', 'NUIOIN', 'NUIOOU', 'DATYPE', 'NUGAIN',
      'FFTSIZ', 'array', 'arrays', 'ITRAD',
      'USEMAC', 'ENDMAC', 'INTERPOINT'
    ],

    // Instruções do ASM
    instructions: [
      'LOAD', 'PLD', 'SET', 'SETP', 'PUSH', 'JZ', 'JMP',
      'CALL', 'RETURN', 'SRF', 'IN', 'OUT', 'NEG', 'ADD',
      'SADD', 'MLT', 'SMLT', 'DIV', 'SDIV', 'MOD', 'SMOD',
      'AND', 'SAND', 'LAND', 'SLAND', 'OR', 'SOR', 'LOR',
      'SLOR', 'XOR', 'SXOR', 'INV', 'LINV', 'EQU', 'SEQU',
      'GRE', 'SGRE', 'LES', 'SLES', 'SHR', 'SSHR', 'SHL',
      'SSHL', 'SRS', 'SSRS', 'PSET', 'NORM', 'ABS', 'ILDI',
      'SIGN', 'LDI', 'ISRF'
    ],

    symbols: /[=><!~?:&|+\-*\/\^%]+/,

    tokenizer: {
      root: [
        // Diretivas com #
        [/#(PRNAME|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|DATYPE|NUGAIN|FFTSIZ|array|arrays|ITRAD|DIRNAM|USEMAC|ENDMAC|INTERPOINT)\b/, 'keyword.directive'],

        // Comentários
        [/\/\/.*$/, 'comment'],
        [/;.*$/, 'comment'],

        // Labels (identificadores seguidos de :)
        [/^\s*[.a-zA-Z_]\w*:/, 'type.identifier'],

        // Números (hex, decimal, binário)
        [/\b0x[0-9a-fA-F]+\b/, 'number.hex'],
        [/\b[0-9]+\b/, 'number'],
        [/\b[01]+b\b/, 'number.binary'],

        // Strings
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

        // Instruções
        [/\b([A-Z][A-Z0-9]*)\b/, {
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
      
      // Diretivas mantidas em roxo
      { token: 'keyword.directive', foreground: '#AF00DB', fontStyle: 'bold' },
      
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
        [/\b(in|out|norm|pset|abs|sqrt|atan|sign|real|imag|fase)\b(?=\s*\()/, 'keyword.function.stdlib.cmm'],

        // StdLib functions
        [/\b(in|out|norm|pset|abs|sqrt|atan|sign|real|imag|fase)\b(?=\s*\()/, 'keyword.function.stdlib.cmm'],

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

// Função para atualizar o tema do editor
function updateEditorTheme(isDark) {
  const theme = isDark ? 'cmm-dark' : 'cmm-light';
  EditorManager.editors.forEach(({editor}) => {
    editor.updateOptions({ theme: theme });
  });
}

// Modifique initMonaco para configurar os temas
async function initMonaco() {
  require(['vs/editor/editor.main'], function() {
    // Setup CMM language e temas
    setupCMMLanguage();
    setupASMLanguage();
    
    // Registrando os temas
    monaco.editor.defineTheme('cmm-dark', {
      // Configuração do tema escuro
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {}
    });
    
    monaco.editor.defineTheme('cmm-light', {
      // Configuração do tema claro
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {}
    });
    
    // Crie o editor inicial com o tema apropriado
    editorInstance = monaco.editor.create(document.getElementById('monaco-editor'), {
      theme: EditorManager.currentTheme,
      language: 'cmm',
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 14,
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      mouseWheelZoom: true,
      padding: { top: 10 }
    });
    
    // Configura o evento de mudança de posição do cursor
    if (editorInstance) {
      editorInstance.onDidChangeCursorPosition(updateCursorPosition);
    } else {
      console.error("Editor instance is null");
    }
  });
}

function updateCursorPosition(e) {
  // e é o evento com a nova posição
  if (!editorInstance) {
    console.warn("Editor ainda não inicializado!");
    return;
  }
  
  const position = e.position; // Usando a posição do evento
  const statusElement = document.getElementById('editorStatus');
  
  if (statusElement && position) {
    statusElement.textContent = `Line ${position.lineNumber}, Column ${position.column}`;
  }
}

// Variável para controlar o estado do tema
let isDarkTheme = true;

// Elemento do botão
const themeToggleBtn = document.getElementById('themeToggle');
const themeIcon = themeToggleBtn.querySelector('i');

// Função para alternar o tema
function toggleTheme() {
  isDarkTheme = !isDarkTheme;
  
  // Atualiza o ícone
  themeIcon.classList.remove(isDarkTheme ? 'fa-sun' : 'fa-moon');
  themeIcon.classList.add(isDarkTheme ? 'fa-moon' : 'fa-sun');
  
  // Atualiza o tema do editor
  EditorManager.setTheme(isDarkTheme);
  
  // Salva a preferência do usuário
  localStorage.setItem('editorTheme', isDarkTheme ? 'dark' : 'light');
}

// Adiciona o event listener ao botão
themeToggleBtn.addEventListener('click', toggleTheme);

// Carrega a preferência salva do tema ao iniciar
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('editorTheme');
  if (savedTheme) {
    isDarkTheme = savedTheme === 'dark';
    // Atualiza o ícone inicial
    themeIcon.classList.remove(isDarkTheme ? 'fa-sun' : 'fa-moon');
    themeIcon.classList.add(isDarkTheme ? 'fa-moon' : 'fa-sun');
    // Aplica o tema salvo
    EditorManager.setTheme(isDarkTheme);
  }
});
//TAB MANAGER ========================================================================================================================================================

class TabManager {
  static tabs = new Map(); // Store tab information
  static activeTab = null;
  static editorStates = new Map();
  static unsavedChanges = new Set(); // Track files with unsaved changes

  // Add this method to close all tabs
static async closeAllTabs() {
  // Create a copy of the tabs keys to avoid modification during iteration
  const openTabs = Array.from(this.tabs.keys());
  
  // Close each tab
  for (const filePath of openTabs) {
    await this.closeTab(filePath);
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

    // Remover a classe empty e adicionar o conteúdo
    contextContainer.className = 'context-path-container';

    // Separar o caminho em segmentos
    const segments = filePath.split(/[\\/]/);
    const fileName = segments.pop();

    // Criar o HTML para o caminho com ícone mais apropriado
    let html = '<i class="fas fa-folder-open"></i>';
    
    if (segments.length > 0) {
      html += segments.map(segment => 
        `<span class="context-path-segment">${segment}</span>`
      ).join('<span class="context-path-separator">/</span>');
      
      html += '<span class="context-path-separator">/</span>';
    }

    // Adicionar ícone específico para o tipo de arquivo
    const fileIcon = TabManager.getFileIcon(fileName);
    html += `<i class="${fileIcon}" style="color: var(--icon-primary)"></i>`;
    html += `<span class="context-path-filename">${fileName}</span>`;
    
    contextContainer.innerHTML = html;
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
  return iconMap[extension] || 'fas fa-file';
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
  
  // Improved tab closing with unsaved changes handling
  static async closeTab(filePath) {
    if (this.unsavedChanges.has(filePath)) {
      const result = await this.handleUnsavedChanges(filePath);
      if (!result) return; // User canceled
    }

    const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
    if (!tab) return;

    // Remove the tab element
    tab.remove();
    
    // Close the editor
    EditorManager.closeEditor(filePath);

    // Remove from our tabs map
    this.tabs.delete(filePath);
    this.unsavedChanges.delete(filePath);

    // If we're closing the active tab
    if (this.activeTab === filePath) {
      
      this.highlightFileInTree(null);
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        this.activateTab(remainingTabs[0]);
      } else {
        this.activeTab = null;
        this.updateContextPath(null);

        // Reset editor to empty state
        const mainEditor = EditorManager.activeEditor;
        if (mainEditor) {
          mainEditor.setValue('');
          mainEditor.updateOptions({ language: 'plaintext' });
        }
      }
    }
  }

  // Handling unsaved changes with dialog
  static async handleUnsavedChanges(filePath) {
    const fileName = filePath.split('\\').pop();
    const dialogResult = await showConfirmDialog(
      'Unsaved Changes',
      `Do you want to save the changes you made to ${fileName}?`,
      ['Save', "Don/'t Save", 'Cancel']
    );

    switch (dialogResult) {
      case 'Save':
        await this.saveCurrentFile();
        return true;
      case "Don't Save":
        this.unsavedChanges.delete(filePath);
        return true;
      case 'Cancel':
        return false;
    }
  }

// Add this method to save the current file
static async saveFile(filePath = null) {
  const currentPath = filePath || this.activeTab;
  if (!currentPath) return;

  try {
    const content = editor.getValue();
    await window.electronAPI.writeFile(currentPath, content);
    this.markFileAsSaved(currentPath);
    //writeToTerminal(`File saved: ${currentPath}`, 'success');
  } catch (error) {
    console.error('Error saving file:', error);
    //writeToTerminal(`Error saving file: ${error.message}`, 'error');
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

// Setup global save shortcut
document.addEventListener('keydown', async (e) => {
  // Ctrl+S (or Cmd+S on Mac)
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    await TabManager.saveCurrentFile();
  }
});

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
    background-color: rgba(30, 144, 255, 0.2);
    border-radius: 4px;
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
      // Mudar para selecionar apenas a div do file-tree
      const fileTree = document.getElementById('file-tree');
      if (fileTree) {
        fileTree.innerHTML = '';
        renderFileTree(result.files, fileTree);
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
`;
document.head.appendChild(style);


// Atualizar a função renderFileTree para usar o estado
function renderFileTree(files, container, level = 0, parentPath = '') {
  files.forEach(file => {
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'file-tree-item';

    const item = document.createElement('div');
    item.className = 'file-item';
    item.style.paddingLeft = `${level * 20}px`;

    const icon = document.createElement('i');
    const filePath = parentPath ? `${parentPath}/${file.name}` : file.name;

    if (file.type === 'directory') {
      const folderToggle = document.createElement('i');
      folderToggle.className = 'fas fa-chevron-right folder-toggle';
      item.appendChild(folderToggle);

      icon.className = 'fas fa-folder file-item-icon';

      const childContainer = document.createElement('div');
      childContainer.className = 'folder-content';
      
      // Verificar se a pasta estava expandida anteriormente
      const wasExpanded = FileTreeState.isExpanded(filePath);
      if (!wasExpanded) {
        childContainer.classList.add('hidden');
      } else {
        folderToggle.classList.remove('fa-chevron-right');
        folderToggle.classList.add('fa-chevron-down');
        icon.classList.remove('fa-folder');
        icon.classList.add('fa-folder-open');
      }

      const toggleFolder = () => {
        const isExpanded = !childContainer.classList.contains('hidden');
        childContainer.classList.toggle('hidden');
        folderToggle.classList.toggle('fa-chevron-right');
        folderToggle.classList.toggle('fa-chevron-down');
        icon.classList.toggle('fa-folder');
        icon.classList.toggle('fa-folder-open');
        
        // Armazenar o estado da pasta
        FileTreeState.toggleFolder(filePath, !isExpanded);
      };

      item.addEventListener('click', toggleFolder);

      if (file.children) {
        renderFileTree(file.children, childContainer, level + 1, filePath);
      }

      itemWrapper.appendChild(item);
      itemWrapper.appendChild(childContainer);
    } else {
      icon.className = TabManager.getFileIcon(file.name);
      // Adicionar o data-path ao wrapper do item
      itemWrapper.setAttribute('data-path', file.path);
      
      // Modificar o evento de clique para abrir o arquivo e destacá-lo
      item.addEventListener('click', async () => {
        try {
          const content = await window.electronAPI.readFile(file.path);
          TabManager.addTab(file.path, content);
          // O highlight será feito automaticamente pelo TabManager.activateTab
        } catch (error) {
          console.error('Error opening file:', error);
        }
      });
      item.addEventListener('click', () => openFile(file.path));
      itemWrapper.appendChild(item);
    }

    const name = document.createElement('span');
    name.textContent = file.name;

    item.appendChild(icon);
    item.appendChild(name);

    container.appendChild(itemWrapper);
  });
}

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
      const projectName = path.basename(currentProjectPath);
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
projectInfoButton.className = 'toolbar-button';
projectInfoButton.innerHTML = `
  <i class="fa-solid fa-circle-info"></i>
  <span>Project Info</span>
`;

document.getElementById('openProjectBtn').insertAdjacentElement('afterend', projectInfoButton);

// Adicione este listener para simular o clique no openProjectBtn
window.electronAPI.onSimulateOpenProject(async (result) => {
  try {
    // Simular EXATAMENTE o comportamento do openProjectBtn
    if (!result.canceled && result.filePaths.length > 0) {
      currentProjectPath = result.filePaths[0];
      currentSpfPath = `${currentProjectPath}.spf`;

      // Usar a mesma chamada que o botão usa
      await loadProject(currentSpfPath);
      
      // Atualiza o nome do projeto na interface
      updateProjectNameUI(currentSpfPath);
    }
  } catch (error) {
    console.error('Error opening project:', error);
    showErrorDialog('Error Opening Project', error.message);
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

// Function to show project info in a modal dialog
function showProjectInfoDialog(projectData) {
  const dialog = document.createElement('dialog');
  dialog.style.cssText = `
    padding: 20px;
    border-radius: 8px;
    border: 1px solid #ccc;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    max-width: 500px;
    background: var(--background-color, #fff);
    color: var(--text-color, #000);
  `;

  const metadata = projectData.metadata;
  const folderStatus = projectData.structure.folders
    .map(folder => `
      <div style="margin: 5px 0;">
        <span>${folder.path}</span>
        <span style="color: ${folder.exists ? '#4CAF50' : '#F44336'}">
          ${folder.exists ? '<i class="fa-solid fa-check" style="color: #4dff00;"></i>' : '<i class="fa-solid fa-x" style="color: #ff0000;"></i>'}
        </span>
      </div>
    `)
    .join('');

  dialog.innerHTML = `
    <div style="position: relative;">
      <h2 style="margin-top: 0;">Project Information</h2>
      <button id="closeDialog" style="
        position: absolute;
        top: 0;
        right: 0;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 20px;
      ">×</button>
      
      <div style="margin: 15px 0;">
        <h3>Project Details</h3>
        <p><strong>Name:</strong> ${metadata.projectName}</p>
        <p><strong>Created:</strong> ${new Date(metadata.createdAt).toLocaleString()}</p>
        <p><strong>Last Modified:</strong> ${new Date(metadata.lastModified).toLocaleString()}</p>
        <p><strong>Computer:</strong> ${metadata.computerName}</p>
        <p><strong>App Version:</strong> ${metadata.appVersion}</p>
      </div>

      <div style="margin: 15px 0;">
        <h3>Project Structure</h3>
        ${folderStatus}
      </div>
    </div>
  `;

  const closeButton = dialog.querySelector('#closeDialog');
  closeButton.onclick = () => dialog.close();

  // Close on click outside
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  document.body.appendChild(dialog);
  dialog.showModal();
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

  } catch (error) {
    //console.error('Error loading project:', error);
    showErrorDialog('Failed to load project', error.message);
  }
}

function showErrorDialog(title, message) {
  // Você pode usar um alert simples ou implementar um modal customizado
  alert(`${title}: ${message}`);
}



// Function to update file tree
function updateFileTree(files) {
  const fileTree = document.getElementById('file-tree');
  fileTree.innerHTML = '';
  renderFileTree(files, fileTree);

  // Add refresh animation
  fileTree.style.animation = 'refresh-fade 0.5s ease';
  setTimeout(() => {
    fileTree.style.animation = '';
  }, 500);
}

//PROCESSADOR HUB ==========================================================================================================================================================

const processorHubButton = document.createElement('button');
processorHubButton.className = 'toolbar-button';
processorHubButton.innerHTML = '<i class="fas fa-microchip"></i> Processor Hub';
processorHubButton.title = 'Create New Processor Project';
processorHubButton.disabled = true; // Disabled by default
document.querySelector('.toolbar').appendChild(processorHubButton);

function updateProcessorHubButton(enabled) {
  processorHubButton.disabled = !enabled;
}

function createProcessorHubModal() {
    const modal = document.createElement('div');
    modal.innerHTML = `
    <div class="processor-hub-overlay"></div>
    <div class="processor-hub-modal">
      <h2><i class="fas fa-microchip"></i> Create Processor Project</h2>
      <form class="processor-hub-form" id="processorHubForm">
        <div class="form-group">
          <label for="processorName">Processor Name</label>
          <input type="text" id="processorName" required value="procTest_00">
        </div>
        <div class="form-group">
          <label for="pointType">Point Type</label>
          <select id="pointType" required>
            <option value="fixed">Fixed Point</option>
            <option value="floating" selected>Floating Point</option>
          </select>
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
    const pointTypeSelect = document.getElementById('pointType');
    const floatingPointOptions = document.querySelectorAll('.floating-point-options');
    const nBitsInput = document.getElementById('nBits');
    const nbMantissaInput = document.getElementById('nbMantissa');
    const nbExponentInput = document.getElementById('nbExponent');
    const gainInput = document.getElementById('gain');

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

    // Initialize point type options visibility
    pointTypeSelect.addEventListener('change', () => {
        const isFloating = pointTypeSelect.value === 'floating';
        floatingPointOptions.forEach(option => {
            option.style.display = isFloating ? 'grid' : 'none';
            option.querySelector('input').required = isFloating;
        });
        validateCustomRules();
    });

    // Attach real-time validation to relevant inputs
    [nBitsInput, nbMantissaInput, nbExponentInput, gainInput].forEach(input => {
        input.addEventListener('input', validateCustomRules);
    });

    // Handle form submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // First check if we have a valid project path
  if (!currentProjectPath) {
      console.error('No project path available');
      //writeToTerminal('Please open a project first', 'error');
      return;
  }

  // Show loading state
  const generateButton = document.getElementById('generateProcessor');
  const originalButtonText = generateButton.innerHTML;
  generateButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
  generateButton.disabled = true;

  const formData = {
      projectLocation: currentProjectPath,
      processorName: document.getElementById('processorName').value,
      pointType: pointTypeSelect.value,
      nBits: parseInt(nBitsInput.value),
      nbMantissa: parseInt(nbMantissaInput.value),
      nbExponent: parseInt(nbExponentInput.value),
      dataStackSize: parseInt(document.getElementById('dataStackSize').value),
      instructionStackSize: parseInt(document.getElementById('instructionStackSize').value),
      inputPorts: parseInt(document.getElementById('inputPorts').value),
      outputPorts: parseInt(document.getElementById('outputPorts').value),
      gain: parseInt(gainInput.value),
  };

  try {
      // Call the main process to create the processor project
      const result = await window.electronAPI.createProcessorProject(formData);

      if (result && result.success) {
          // Close modal
          modal.remove();

          // Refresh file tree
          await refreshFileTree();

          // Show success message
          //writeToTerminal(`Processor project "${formData.processorName}" created successfully at: ${result.path}`, 'success');
      } else {
          throw new Error('Failed to create processor project - no success response received');
      }
  } catch (error) {
      console.error('Error creating processor project:', error);
      
      // Format error message
      const errorMessage = error.message || 'Unknown error occurred';
      //writeToTerminal(
        //`Failed to create processor project: ${error.message || 'Unknown error occurred'}`,
        //'error'
      //);      
      
      // Reset button state
      generateButton.innerHTML = originalButtonText;
      generateButton.disabled = false;
      
      // Keep modal open so user can try again
      return;
  }
});

    // Handle cancel button
    document.getElementById('cancelProcessorHub').addEventListener('click', () => {
        modal.remove();
    });

    // Handle click outside modal
    modal.querySelector('.processor-hub-overlay').addEventListener('click', () => {
        modal.remove();
    });

    // Perform initial validation
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

function initAIAssistant() {
  aiAssistantContainer = document.createElement('div');
  aiAssistantContainer.className = 'ai-assistant-container';

  const resizer = document.createElement('div');
  resizer.className = 'ai-resizer';

  // Create header with provider selection
  const header = document.createElement('div');
  header.className = 'ai-assistant-header';
  header.innerHTML = `
  <div style="display: flex; align-items: center; gap: 8px;">
    <span class="ai-assistant-title">AI Assistant</span>
    <select id="ai-provider-select" style="background: var(--background, #2d2d2d); color: var(--text-color, #ffffff); border: 1px solid var(--border-color, #404040); border-radius: 4px; padding: 2px;">
      <option value="chatgpt">ChatGPT</option>
      <option value="claude">Claude</option>
    </select>
  </div>
  <i class="fas fa-times ai-assistant-close"></i>
`;

  // Create webview container
  const webviewContainer = document.createElement('div');
  webviewContainer.className = 'ai-assistant-content';
  webviewContainer.style.padding = '0'; // Remove padding for webview

  // Create webview element
  const webview = document.createElement('webview');
  webview.style.width = '100%';
  webview.style.height = '100%';                                                       
  webview.src = 'https://chatgpt.com/?model=auto'; // Default to ChatGPT
  webview.nodeintegration = 'false';
  webviewContainer.appendChild(webview);

  // Append elements
  aiAssistantContainer.appendChild(resizer);
  aiAssistantContainer.appendChild(header);
  aiAssistantContainer.appendChild(webviewContainer);
  document.body.appendChild(aiAssistantContainer);

  // Add event listeners
  const closeButton = header.querySelector('.ai-assistant-close');
  closeButton.addEventListener('click', toggleAIAssistant);

  const providerSelect = header.querySelector('#ai-provider-select');
  providerSelect.addEventListener('change', (e) => {
      currentProvider = e.target.value;
      const url = currentProvider === 'chatgpt' ?
          'https://chatgpt.com/?model=auto' :
          'https://claude.ai';
      webview.src = url;
  });

  // Setup resizing
  setupAIAssistantResize(resizer);
}

// Add toggle function
function toggleAIAssistant() {
  aiAssistantVisible = !aiAssistantVisible;
  aiAssistantContainer.classList.toggle('visible');

  // Adjust editor layout if needed
  if (editor) {
      editor.layout();
  }
}

// Add resize functionality
function setupAIAssistantResize(resizer) {
  let startX, startWidth;

  function startResize(e) {
      startX = e.clientX;
      startWidth = parseInt(getComputedStyle(aiAssistantContainer).width, 10);
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', stopResize);
  }

  function resize(e) {
      const width = startWidth - (e.clientX - startX);
      aiAssistantContainer.style.width = `${width}px`;

      // Adjust editor layout
      if (editor) {
          editor.layout();
      }
  }

  function stopResize() {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResize);
  }

  resizer.addEventListener('mousedown', startResize);
}


//WINDOW.ONLOAD ===========================================================================================================================================================
window.onload = () => {
  initMonaco();
  initAIAssistant();

  // Add AI Assistant button to toolbar
  const toolbar = document.querySelector('.toolbar');
  const aiButton = document.createElement('button');

  aiButton.className = 'toolbar-icon rainbow btn';
  aiButton.innerHTML = '<i class="fas fa-robot"></i>';
  aiButton.title = 'Toggle AI Assistant';
  aiButton.addEventListener('click', toggleAIAssistant);
  toolbar.appendChild(aiButton);

  // Existing event listeners
  document.getElementById('openFolderBtn').addEventListener('click', async () => {
      const result = await window.electronAPI.openFolder();
      if (result) {
          const fileTree = document.getElementById('file-tree');
          fileTree.innerHTML = '';
          renderFileTree(result.files, fileTree);
      }
  });
    document.getElementById('saveFileBtn').addEventListener('click', () => TabManager.saveCurrentFile());

    // Add refresh button event listener
    const refreshButton = document.getElementById('refresh-button');
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
};


// WIPE OUT TERMINAL ========================================================================================================================================================
document.getElementById('clear-terminal').addEventListener('click', () => {
  // Identificar o terminal ativo
  const activeTerminal = document.querySelector('.terminal-content:not(.hidden)'); // Terminal ativo
  console.log("Limpar terminal1");

  if (activeTerminal) {
    const terminalId = activeTerminal.id; // Obtém o ID do terminal ativo

    if (terminalId === 'terminal-tcmm') {
      console.log("Limpar terminal2");
      // Substituir o conteúdo do terminal TCMM pelo estado inicial
      activeTerminal.innerHTML = `
        <div class="terminal-header">TCMM Terminal</div>
        <div class="terminal-body">Bem-vindo ao Terminal TCMM! Clean</div>
      `;
    } else if (terminalId === 'terminal-tasm') {
      console.log("Limpar terminal3");
      // Substituir o conteúdo do terminal TASM pelo estado inicial
      activeTerminal.innerHTML = `
        <div class="terminal-header">TASM Terminal</div>
        <div class="terminal-body">Bem-vindo ao Terminal TASM! Clean</div>
      `;
    }
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

// Update button state based on active tab
function updateCompileButtonState() {

    if (true) {
        compileButton.style.opacity = "1";
        compileButton.style.cursor = "pointer";
    } else {
        compileButton.style.opacity = "0.5";
        compileButton.style.cursor = "not-allowed";
        compileButtoncmm.style.opacity = "0.5";
        compileButtoncmm.style.cursor = "not-allowed";
        compileButtonasm.style.opacity = "0.5";
        compileButtonasm.style.cursor = "not-allowed";
    }
}


// Observe tab changes
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            updateCompileButtonState();
        }
    });
});

// Start observing tab changes
document.querySelectorAll('.tab').forEach(tab => {
    observer.observe(tab, {
        attributes: true
    });
});

// Initial button state
updateCompileButtonState();

// Listen for TabManager changes
document.addEventListener('TabManager.activeTabChanged', updateCompileButtonState);

// Update button state whenever a new tab is created or activated
const originalActivateTab = TabManager.activateTab;
TabManager.activateTab = function(filePath) {
    originalActivateTab.call(TabManager, filePath);
    updateCompileButtonState();
};

//VCD ========================================================================================================================================================
document.getElementById('wavecomp').addEventListener('click', async () => {
  // Chama o diálogo para selecionar arquivo
  const filePath = await window.electronAPI.openWaveDialog();

  if (filePath) {
    // Abre o GTKWave com o arquivo selecionado
    await window.electronAPI.openGTKWave(filePath);
  } else {
    console.log('Nenhum arquivo selecionado.');
  }
});

//COMP ========================================================================================================================================================
class CompilationModule {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.config = null;
    this.simConfig = null;
    this.terminalManager = new TerminalManager();

  }
  

async loadConfig() {
  try {
    const config = await window.electronAPI.loadConfig();
    this.config = config;
    console.log("Config carregada:", config);
  } catch (error) {
    console.error("Falha ao carregar a configuração:", error);
  }
}


  async ensureDirectories(name) {
    const tempDir = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
    await window.electronAPI.mkdir(tempDir);
  }

  async cmmCompilation(processor) {
    const { name } = processor;
    this.terminalManager.appendToTerminal('tcmm', `Starting CMM compilation for ${name}...`);
    
    try {
      const cmmPath = await window.electronAPI.joinPath(this.projectPath, name, 'Software', `${name}.cmm`);
      const softwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Software');
      const asmPath = await window.electronAPI.joinPath(softwarePath, `${name}.asm`);
      const macrosPath = await window.electronAPI.joinPath('saphoComponents', 'Macros');
      const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
      const cmmCompPath = await window.electronAPI.joinPath('saphoComponents', 'bin', 'cmmcomp.exe');
      const projectPath = await window.electronAPI.joinPath(currentProjectPath, name);

      const cmd = `"${cmmCompPath}" ${name} "${projectPath}" "${macrosPath}" "${tempPath}" `;
      
      this.terminalManager.appendToTerminal('tcmm', `Executing command: ${cmd}`);
      
      const result = await window.electronAPI.execCommand(cmd);

      await refreshFileTree();
      
      // Exibe a saída do compilador
      if (result.stdout) {
        this.terminalManager.appendToTerminal('tcmm', result.stdout, 'stdout');
      }
      if (result.stderr) {
        this.terminalManager.appendToTerminal('tcmm', result.stderr, 'stderr');
      }

      // Verifica o código de saída
      if (result.code !== 0) {
        throw new Error(`CMM compilation failed with code ${result.code}`);
      }

      this.terminalManager.appendToTerminal('tcmm', 'CMM compilation completed successfully.');
      return asmPath;
    } catch (error) {
      this.terminalManager.appendToTerminal('tcmm', `Error: ${error.message}`, 'error');
      throw error;
    }
  }
  
  async showSimulationConfig(processor) {
    const hardwarePath = await window.electronAPI.joinPath(this.projectPath, processor.name, 'Hardware');
    const modal = new SimulationModal();
    return await modal.show(hardwarePath);
  }


  async asmCompilation(processor, asmPath) {
    const { name, clk, numClocks } = processor;
    this.terminalManager.appendToTerminal('tasm', `Starting ASM compilation for ${name}...`);
    
    try {
      const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
      const simulationPath = await window.electronAPI.joinPath(this.projectPath, name, 'Simulation');
      const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
      const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
      const projectPath = await window.electronAPI.joinPath(currentProjectPath, name);

      const asmCompPath = await window.electronAPI.joinPath('saphoComponents', 'bin', 'asmcomp.exe');
      const cmd = `"${asmCompPath}" "${asmPath}" "${projectPath}" "${hdlPath}" "${tempPath}" ${clk} ${numClocks} 0`;
      
      this.terminalManager.appendToTerminal('tasm', `Executing command: ${cmd}`);
      
      const result = await window.electronAPI.execCommand(cmd);

      await refreshFileTree();
      
      if (result.stdout) {
        this.terminalManager.appendToTerminal('tasm', result.stdout, 'stdout');
      }
      if (result.stderr) {
        this.terminalManager.appendToTerminal('tasm', result.stderr, 'stderr');
      }

      if (result.code !== 0) {
        throw new Error(`ASM compilation failed with code ${result.code}`);
      }

      // Copia o testbench
      const testbenchSource = await window.electronAPI.joinPath(tempPath, `${name}_tb.v`);
      const testbenchDestination = await window.electronAPI.joinPath(simulationPath, `${name}_tb.v`);
      await window.electronAPI.copyFile(testbenchSource, testbenchDestination);
      
      this.terminalManager.appendToTerminal('tasm', 'ASM compilation completed successfully.');
    } catch (error) {
      this.terminalManager.appendToTerminal('tasm', `Error: ${error.message}`, 'error');
      throw error;
    }
  }

  async iverilogCompilation(processor, simConfig) {
    const { name } = processor;
    this.terminalManager.appendToTerminal('tveri', `Starting Icarus Verilog compilation for ${name}...`);
    
    try {
        const appPath = await window.electronAPI.getAppPath();
        const basePath = await window.electronAPI.joinPath(appPath); // Sobe duas pastas
        const hdlPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'HDL');
        const tempPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'Temp', name);
        const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
        const simulationPath = await window.electronAPI.joinPath(this.projectPath, name, 'Simulation');
        
        const flags = this.config.iverilogFlags.join(' ');
        
        // Definir arquivo de testbench
        let tbFile;
        if (simConfig.standardSimulation) {
            const expectedFileName = `${name}_tb.v`;
            const files = await window.electronAPI.readDir(simulationPath);
            tbFile = files.find(f => f === expectedFileName);
            if (!tbFile) {
                const fullPath = await window.electronAPI.joinPath(hardwarePath, expectedFileName);
                this.terminalManager.appendToTerminal('tveri', `Error: Testbench file not found at ${fullPath}`, 'error');
                throw new Error('Standard testbench file not found');
            }
        } else {
            tbFile = simConfig.selectedTb;
        }
        
        const verilogFiles = [
            'addr_dec.v', 'mem_instr.v', 'prefetch.v', 'instr_dec.v', 
            'stack_pointer.v', 'stack.v', 'rel_addr.v', 'processor.v', 'core.v', 'ula.v'
        ];
        
        const verilogFilesString = verilogFiles.map(file => `${file}`).join(' ');
        
        const cmd = `cd "${hdlPath}" && iverilog ${flags} -s ${name}_tb -o "${await window.electronAPI.joinPath(tempPath, name)}.vvp" "${await window.electronAPI.joinPath(simulationPath, tbFile)}" "${await window.electronAPI.joinPath(hardwarePath, `${name}.v`)}" "${await window.electronAPI.joinPath(tempPath, `mem_data_${name}.v`)}" "${await window.electronAPI.joinPath(tempPath, `pc_${name}.v`)}" ${verilogFilesString}`;
        
        console.log('Icarus Verilog Command:', cmd);

        this.terminalManager.appendToTerminal('tveri', `Executing Icarus Verilog compilation:\n${cmd}`);
        
        const result = await window.electronAPI.execCommand(cmd);
        
        if (result.stdout) {
            this.terminalManager.appendToTerminal('tveri', result.stdout, 'stdout');
        }
        if (result.stderr) {
            this.terminalManager.appendToTerminal('tveri', result.stderr, 'stderr');
        }
        
        if (result.code !== 0) {
            throw new Error(`Icarus Verilog compilation failed with code ${result.code}`);
        }

        this.terminalManager.appendToTerminal('tveri', `Copying ${name}_data.mif to ${tempPath}...`);
        await window.electronAPI.copyFile(
            await window.electronAPI.joinPath(hardwarePath, `${name}_data.mif`),
            await window.electronAPI.joinPath(tempPath, `${name}_data.mif`)
        );
        this.terminalManager.appendToTerminal('tveri', `Copied ${name}_data.mif successfully.`);
        
        this.terminalManager.appendToTerminal('tveri', `Copying ${name}_inst.mif to ${tempPath}...`);
        await window.electronAPI.copyFile(
            await window.electronAPI.joinPath(hardwarePath, `${name}_inst.mif`),
            await window.electronAPI.joinPath(tempPath, `${name}_inst.mif`)
        );
        this.terminalManager.appendToTerminal('tveri', `Copied ${name}_inst.mif successfully.`);        

        
        // Executar vvp
        this.terminalManager.appendToTerminal('tveri', 'Running VVP simulation...');
        const vvpCmd = `cd "${tempPath}" && vvp ${name}.vvp -fst`;
        this.terminalManager.appendToTerminal('tveri', `Executing command: ${vvpCmd}`);
        
        const vvpResult = await window.electronAPI.execCommand(vvpCmd);
        
        if (vvpResult.stdout) {
            this.terminalManager.appendToTerminal('tveri', vvpResult.stdout, 'stdout');
        }
        if (vvpResult.stderr) {
            this.terminalManager.appendToTerminal('tveri', vvpResult.stderr, 'stderr');
        }
        
        if (vvpResult.code !== 0) {
            throw new Error(`VVP simulation failed with code ${vvpResult.code}`);
        }
        
        this.terminalManager.appendToTerminal('tveri', 'Verilog compilation and simulation completed successfully.');

        await refreshFileTree();

        
        // Executar GTKWave
        await this.runGtkWave(processor, simConfig);

        
    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', `Error: ${error.message}`, 'error');
        throw error;
    }
}

async runGtkWave(processor, simConfig) {
    const { name } = processor;
    this.terminalManager.appendToTerminal('twave', `Starting GTKWave for ${name}...`);
    
    try {
        const appPath = await window.electronAPI.getAppPath();
        const basePath = await window.electronAPI.joinPath(appPath); // Sobe duas pastas
        const tempPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'Temp', name);
        const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
    
        const binPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'bin');

        const tclFilePath = await window.electronAPI.joinPath(tempPath, 'tcl_infos.txt');

        this.terminalManager.appendToTerminal('tveri', `Creating tcl_infos.txt in ${tempPath}...`);
        
        // Criar o conteúdo do arquivo
        const tclContent = `${tempPath}\n${binPath}\n`;
        
        // Escrever o arquivo
        await window.electronAPI.writeFile(tclFilePath, tclContent);
        
        this.terminalManager.appendToTerminal('tveri', `tcl_infos.txt created successfully in ${tempPath}.`);
              
        let cmd;
        if (simConfig.standardSimulation) {
            const basePath = await window.electronAPI.joinPath(appPath); // Sobe duas pastas
            const scriptsPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'Scripts', 'gtk_proc_init.tcl');
            const vcdPath = await window.electronAPI.joinPath(tempPath, `${name}_tb.vcd`);
            const tempNamePath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
            
            cmd = `cd /d "${tempNamePath}" && gtkwave  --rcvar "hide_sst on" --dark "${vcdPath}" --script="${scriptsPath}"`;
        } else {
            const gtkwPath = await window.electronAPI.joinPath(hardwarePath, simConfig.selectedGtkw);
            const vcdPath = await window.electronAPI.joinPath(tempPath, `${name}_tb.vcd`);
            cmd = `gtkwave --rcvar "hide_sst on" --dark "${vcdPath}" "${gtkwPath}"`;
        }
        
        this.terminalManager.appendToTerminal('twave', `Executing GTKWave command:\n${cmd}`);
        
        const result = await window.electronAPI.execCommand(cmd);
        
        if (result.stdout) {
            this.terminalManager.appendToTerminal('twave', result.stdout, 'stdout');
        }
        if (result.stderr) {
            this.terminalManager.appendToTerminal('twave', result.stderr, 'stderr');
        }
        
        if (result.code !== 0) {
            throw new Error(`GTKWave execution failed with code ${result.code}`);
        }
        
        this.terminalManager.appendToTerminal('twave', 'GTKWave completed successfully.');
        
    } catch (error) {
        this.terminalManager.appendToTerminal('twave', `Error: ${error.message}`, 'error');
        throw error;
    }
}

// Adicione estes métodos à classe CompilationModule ou ao window.electronAPI

// Método para garantir criação de diretórios
async ensureDirectories(name) {
  try {
    // Cria diretórios temporários
    const basePath = await window.electronAPI.getAppPath();
    const tempDir = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'Temp', name, 'PRISM');
    
    // Cria diretórios recursivamente
    await window.electronAPI.mkdir(tempDir, { recursive: true });
    
    // Cria outros diretórios necessários
    const hdlDir = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'HDL');
    await window.electronAPI.mkdir(hdlDir, { recursive: true });
    
    return tempDir;
  } catch (error) {
    console.error('Error ensuring directories:', error);
    throw error;
  }
}

// Método para listar arquivos
async listFiles(dirPath, filterFn = () => true) {
  try {
    const files = await window.electronAPI.readDir(dirPath);
    return files.filter(filterFn);
  } catch (error) {
    console.error('Error listing files:', error);
    return [];
  }
}

// Método para deletar arquivo
async deleteFile(filePath) {
  try {
    await window.electronAPI.unlink(filePath);
  } catch (error) {
    // Silencia erros de arquivo não encontrado
    if (error.code !== 'ENOENT') {
      console.error('Error deleting file:', error);
    }
  }
}

// Método para copiar arquivo
async copyFile(sourcePath, destPath) {
  try {
    await window.electronAPI.copyFile(sourcePath, destPath);
  } catch (error) {
    console.error('Error copying file:', error);
    throw error;
  }
}


async prismComp(processor, simConfig) {
  const { name } = processor;
  this.terminalManager.appendToTerminal('tprism', `Starting PRISM compilation for ${name}...`);
  
  try {
    // Definir caminhos
    const basePath = await window.electronAPI.getAppPath();
    const hdlPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'HDL');
    const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
    const scriptsPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'Scripts');
    const tempPath = await this.ensureDirectories(name);
    const fancyPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'bin', 'fancySVG.exe');
    const prismPath = await window.electronAPI.joinPath(tempPath);
    // Copiar arquivos necessários
    const procVFile = await window.electronAPI.joinPath(hardwarePath, `${name}.v`);
    const proc2rtlYsFile = await window.electronAPI.joinPath(scriptsPath, 'proc2rtl.ys');

    // Copiar arquivos para pasta HDL
    await this.copyFile(procVFile, await window.electronAPI.joinPath(hdlPath, `${name}.v`));
    this.terminalManager.appendToTerminal('tprism', `Copied ${name}.v to HDL directory successfully.`);

    await this.copyFile(proc2rtlYsFile, await window.electronAPI.joinPath(hdlPath, 'proc2rtl.ys'));
    this.terminalManager.appendToTerminal('tprism', 'Copied proc2rtl.ys to HDL directory successfully.');

    // Alterar o arquivo proc2rtl.ys
    const proc2rtlPath = await window.electronAPI.joinPath(hdlPath, 'proc2rtl.ys');
    let proc2rtlContent = await window.electronAPI.readFile(proc2rtlPath, 'utf8');
    proc2rtlContent = proc2rtlContent.replace(/@PROC@/g, name);
    await window.electronAPI.writeFile(proc2rtlPath, proc2rtlContent);
    this.terminalManager.appendToTerminal('tprism', 'Updated proc2rtl.ys with processor name.');

    // Executar Yosys
    const yosysCmd = `cd /d "${hdlPath}" && yosys -s proc2rtl.ys`;
    const yosysResult = await window.electronAPI.execCommand(yosysCmd);
    
    if (yosysResult.stderr) {
      this.terminalManager.appendToTerminal('tprism', yosysResult.stderr, 'stderr');
    }
    
    // Identificar arquivos JSON gerados
    const jsonFiles = await this.listFiles(hdlPath, file => file.endsWith('.json'));

    // Garantir que a pasta PRISM existe
    await window.electronAPI.mkdir(tempPath, { recursive: true });

    for (const jsonFile of jsonFiles) {
      try {
        const jsonPath = await window.electronAPI.joinPath(hdlPath, jsonFile);
        const svgPath = await window.electronAPI.joinPath(hdlPath, jsonFile.replace('.json', '.svg'));

        // Comando para gerar SVG
        const netlistCmd = `cd /d "${hdlPath}" && npx netlistsvg "${jsonFile}" -o "${jsonFile.replace('.json', '.svg')}"`;

        let netlistResult = { stderr: null }; 

        try {
          netlistResult = await window.electronAPI.execCommand(netlistCmd);
          console.log('netlistsvg output:', netlistResult);
        } catch (error) {
          console.error(`Error running netlistsvg for ${jsonFile}:`, error);
          this.terminalManager.appendToTerminal('tprism', `Error running netlistsvg for ${jsonFile}: ${error.message}`, 'error');
          continue;
        }

        if (netlistResult.stderr) {
          this.terminalManager.appendToTerminal('tprism', netlistResult.stderr, 'stderr');
        }

        // Copiar SVG para pasta PRISM
        const destSvgPath = await window.electronAPI.joinPath(tempPath, jsonFile.replace('.json', '.svg'));
        await this.copyFile(svgPath, destSvgPath);

        // Processar SVG com fancySVG
        const processSvgCmd = `${fancyPath} 1 "${name}" "${destSvgPath}" "${destSvgPath}" "${prismPath}"`;
        await window.electronAPI.execCommand(processSvgCmd);

        // Deletar arquivos temporários
        await this.deleteFile(jsonPath);
        await this.deleteFile(svgPath);

        this.terminalManager.appendToTerminal('tprism', `Processed ${jsonFile} successfully.`);
      } catch (fileError) {
        this.terminalManager.appendToTerminal('tprism', `Error processing ${jsonFile}: ${fileError.message}`, 'error');
      }
    }

    // Limpar arquivos restantes na pasta HDL
    await this.deleteFile(await window.electronAPI.joinPath(hdlPath, 'proc2rtl.ys'));
    await this.deleteFile(await window.electronAPI.joinPath(hdlPath, `${name}.v`));

    // Limpar todos os arquivos .json na pasta HDL
    const remainingJsonFiles = await this.listFiles(hdlPath, file => file.endsWith('.json'));
    for (const jsonFile of remainingJsonFiles) {
      await this.deleteFile(await window.electronAPI.joinPath(hdlPath, jsonFile));
    }

    this.terminalManager.appendToTerminal('tprism', 'PRISM compilation completed successfully.');

  } catch (error) {
    this.terminalManager.appendToTerminal('tprism', `Error during PRISM compilation: ${error.message}`, 'error');
    throw error;
  }
}

    // No método compileAll() da classe CompilationModule
    async compileAll() {
      try {
        await this.loadConfig();
        for (const processor of this.config.processors) {
          await this.ensureDirectories(processor.name);
          const asmPath = await this.cmmCompilation(processor);
          await this.asmCompilation(processor, asmPath);
          
          // Show simulation config modal and get configuration
          const simConfig = await this.showSimulationConfig(processor);
          if (!simConfig) {
            console.log('Compilation cancelled by user');
            return false;
          }
          
          // Pass simConfig to iverilogCompilation
          await this.iverilogCompilation(processor, simConfig);
          
          // Adicionar chamada para prismComp
          // await this.prismComp(processor, simConfig);
        }
        return true;
      } catch (error) {
        console.error('Compilation error:', error);
        return false;
      }
    }

}

document.getElementById('allcomp').addEventListener('click', async () => {
  if (!currentProjectPath) {
    console.error('No project opened');
    return;
  }
  const compiler = new CompilationModule(currentProjectPath);
  const success = await compiler.compileAll();
  if (success) {
    console.log('All compilations completed successfully');
  }
});

// Gerenciador para as compilações individuais
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
        if (!this.compiler) this.initializeCompiler();
        
        await this.compiler.loadConfig();
        const processor = this.compiler.config.processors[0]; // Assumindo primeiro processador
        await this.compiler.ensureDirectories(processor.name);
        const asmPath = await this.compiler.cmmCompilation(processor);
        
        // Atualiza a file tree após a compilação
        await refreshFileTree();
      } catch (error) {
        console.error('CMM compilation error:', error);
      }
    });

    // ASM Compilation
    document.getElementById('asmcomp').addEventListener('click', async () => {
      try {
        if (!this.compiler) this.initializeCompiler();
        
        await this.compiler.loadConfig();
        const processor = this.compiler.config.processors[0];
        
        // Encontrar o arquivo .asm mais recente
        const softwarePath = await window.electronAPI.joinPath(currentProjectPath, processor.name, 'Software');
        const files = await window.electronAPI.readDir(softwarePath);
        const asmFile = files.find(file => file.endsWith('.asm'));
        
        if (!asmFile) {
          throw new Error('No .asm file found. Please compile CMM first.');
        }

        const asmPath = await window.electronAPI.joinPath(softwarePath, asmFile);
        await this.compiler.asmCompilation(processor, asmPath);
        
        // Atualiza a file tree após a compilação
        await refreshFileTree();
      } catch (error) {
        console.error('ASM compilation error:', error);
      }
    });

    // Verilog Compilation
    document.getElementById('vericomp').addEventListener('click', async () => {
      try {
        if (!this.compiler) this.initializeCompiler();
        
        await this.compiler.loadConfig();
        const processor = this.compiler.config.processors[0];
        
        // Mostrar modal de configuração
        const simConfig = await this.compiler.showSimulationConfig(processor);
        if (!simConfig) {
          console.log('Verilog compilation cancelled by user');
          return;
        }

        await this.compiler.iverilogCompilation(processor, simConfig);
        
        // Atualiza a file tree após a compilação
        await refreshFileTree();
      } catch (error) {
        console.error('Verilog compilation error:', error);
      }
    });

    document.getElementById('prismcomp').addEventListener('click', async () => {
      try {
          if (!this.compiler) this.initializeCompiler();
          
          await this.compiler.loadConfig();
          const processor = this.compiler.config.processors[0]; // Assume o primeiro processador
          
          if (!processor || !processor.name) {
              throw new Error('Processor name is undefined.');
          }
  
          const appPath = await window.electronAPI.getAppPath();
          if (!appPath) {
              throw new Error('Failed to retrieve appPath.');
          }
  
          const basePath = await window.electronAPI.joinPath(appPath); 
          const tempPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'Temp', processor.name);
  
          const simConfig = await this.compiler.showSimulationConfig(processor);
          if (!simConfig) {
              console.log('PRISM compilation cancelled by user');
              return;
          }
  
          await this.compiler.prismComp(processor, simConfig);
          await refreshFileTree();
  
          // Obtém o caminho do arquivo SVG gerado
          const prismPath = await window.electronAPI.joinPath(tempPath, 'PRISM', `${processor.name}.svg`);
          console.log(prismPath);
          // Abre o PRISM Viewer passando o caminho do SVG
          window.electronAPI.openPrismWindow(prismPath);
  
          if (window.terminalManager) {
              window.terminalManager.appendToTerminal("tprism", "PRISM Viewer launched");
          }
      } catch (error) {
          console.error('PRISM compilation error:', error);
          window.electronAPI.showErrorMessage({
              title: 'PRISM Compilation Error',
              message: error.message || 'Failed to compile with PRISM'
          });
      }
  });
   

  }
}

// Inicializa o gerenciador quando a janela carregar
window.addEventListener('load', () => {
  const compilationManager = new CompilationButtonManager();
});



//TERMINAL =============================================================================================================================================================
class TerminalManager {
  constructor() {
    this.terminals = {
      tcmm: document.querySelector('#terminal-tcmm .terminal-body'),
      tasm: document.querySelector('#terminal-tasm .terminal-body'),
      tveri: document.querySelector('#terminal-tveri .terminal-body'),
      twave: document.querySelector('#terminal-twave .terminal-body'),
      tcmd: document.querySelector('#terminal-tcmd .terminal-body'),
      tprism: document.querySelector('#terminal-tprism .terminal-body')
    };
    
    this.setupTerminalTabs();
    this.setupAutoScroll();

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
        
        // Rola para o final quando troca de aba
        this.scrollToBottom(terminalId);
      });
    });
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
    console.log('AQUIII1', currentProjectPath);
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
const { shell, app, exec } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const sidebarItems = sidebar.querySelectorAll('li');

  // Browser launch function
  const launchBrowser = () => {
    shell.openExternal('https://nipscern.com');
  };

  // Utility functions for loading overlays
  function createLoadingOverlay(iconClass, closeId) {
    const loadingIcon = document.createElement('div');
    loadingIcon.innerHTML = `
      <div class="loading-overlay">
        <i class="${iconClass}"></i>
        <button id="${closeId}" class="close-loading">✕</button>
      </div>
    `;
    document.body.appendChild(loadingIcon);
    
    document.getElementById(closeId).addEventListener('click', () => {
      loadingIcon.remove();
    });
  }

  // Shutdown Application function
  const shutdownApplication = () => {
    const shutdownOverlay = document.createElement('div');
    shutdownOverlay.innerHTML = `
      <div class="shutdown-overlay">
        <div class="shutdown-dialog">
          <h3>Shutting Down</h3>
          <div class="countdown">5</div>
          <div class="shutdown-actions">
            <button id="cancelShutdown">Cancel</button>
            <button id="confirmShutdown">Confirm</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(shutdownOverlay);

    const countdownEl = shutdownOverlay.querySelector('.countdown');
    const cancelButton = document.getElementById('cancelShutdown');
    const confirmButton = document.getElementById('confirmShutdown');
    let countdown = 5;
    let countdownInterval;

    const startCountdown = () => {
      countdownInterval = setInterval(() => {
        countdown--;
        countdownEl.textContent = countdown;
        
        if (countdown <= 0) {
          clearInterval(countdownInterval);
          app.quit();
        }
      }, 1000);
    };

    startCountdown();

    cancelButton.addEventListener('click', () => {
      clearInterval(countdownInterval);
      shutdownOverlay.remove();
    });

    confirmButton.addEventListener('click', () => {
      app.quit();
    });
  };

  // Open GitHub Desktop
  const openGitHubDesktop = () => {
    try {
      // Adjust the path based on your system
      exec('github-desktop', (error, stdout, stderr) => {
        if (error) {
          console.error(`Error opening GitHub Desktop: ${error}`);
          return;
        }
      });
    } catch (err) {
      console.error('Failed to launch GitHub Desktop', err);
    }
  };

  // Open Keyboard Shortcuts
  const openKeyboardShortcuts = () => {
    const infoBox = document.getElementById('infoBox');
    infoBox.classList.remove('hidden');

    const closeButton = infoBox.querySelector('.info-box-close');
    closeButton.addEventListener('click', () => {
      infoBox.classList.add('hidden');
    });
  };

  // Open Bug Report Modal
  const openBugReportModal = () => {
    const modal = document.getElementById('bug-report-modal');
    modal.classList.remove('hidden');
    
    const closeButton = modal.querySelector('.modal-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
    }
  };

  // Sidebar Item Click Handlers
  sidebarItems.forEach(item => {
    item.addEventListener('click', (event) => {
      const title = item.getAttribute('title');

      switch(title) {
        case 'Browse the web':
          launchBrowser();
          break;
        case 'Search for information':
          createLoadingOverlay('fa-solid fa-hourglass-half', 'closeSearchLoading');
          break;
        case 'View the Abstract Syntax Tree (AST)':
          createLoadingOverlay('fa-solid fa-hourglass-half', 'closeASTLoading');
          break;
        case 'Report a bug':
          openBugReportModal();
          break;
        case 'Open GitHub Desktop':
          openGitHubDesktop();
          break;
        case 'Keyboard shortcuts':
          openKeyboardShortcuts();
          break;
        case 'Project information':
          createLoadingOverlay('fa-solid fa-hourglass-half', 'closeProjectInfo');
          break;
        case 'Shut down the application':
          shutdownApplication();
          break;
      }
    });
  });

  // Toggle Sidebar Function
  function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");

    if (sidebar.style.left === "0px") {
      sidebar.style.left = "-60px";
    } else {
      sidebar.style.left = "0px";
    }
  }

  // Close Sidebar When Clicking Outside
  document.addEventListener("click", function (event) {
    const sidebar = document.getElementById("sidebar");
    const menuButton = document.getElementById("sidebarMenu");

    if (
      sidebar.style.left === "0px" &&
      !sidebar.contains(event.target) &&
      !menuButton.contains(event.target)
    ) {
      sidebar.style.left = "-60px";
    }
  });
});

// No seu renderer.js

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
    const basePath = await window.electronAPI.getBasePath(); // Assumindo que você tem uma função para pegar o basePath
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

// In your renderer process
document.getElementById('settingsButton').addEventListener('click', () => {
  ipcRenderer.send('open-settings');
});

//TOPLEVEL =======
// Get current project path from your app state
function getCurrentProjectPath() {
  // Adjust this based on how your app stores the current project path
  const projectState = remote.getGlobal('projectState');
  return projectState?.basePath;
}

// Create TopLevel folder and .v file
async function handleTopLevelCreation() {
  try {
    console.log('[TopLevel] Starting TopLevel creation process');
    
    const projectPath = getCurrentProjectPath();
    if (!projectPath) {
      console.error('[TopLevel] Error: No project currently open');
      alert('Please open a project first');
      return;
    }

    const topLevelPath = path.join(projectPath, 'TopLevel');
    console.log(`[TopLevel] Target path: ${topLevelPath}`);

    // Check if TopLevel exists, create if not
    if (!fs.existsSync(topLevelPath)) {
      console.log('[TopLevel] TopLevel folder does not exist, creating...');
      await fse.mkdir(topLevelPath);
      console.log('[TopLevel] Successfully created TopLevel folder');
    } else {
      console.log('[TopLevel] TopLevel folder already exists');
    }

    // Open save dialog for .v file
    console.log('[TopLevel] Opening file save dialog...');
    const { filePath } = await dialog.showSaveDialog({
      title: 'Create Verilog File',
      defaultPath: path.join(topLevelPath, 'new_file.v'),
      filters: [{ name: 'Verilog Files', extensions: ['v'] }],
      properties: ['createDirectory']
    });

    if (filePath) {
      console.log(`[TopLevel] User selected path: ${filePath}`);
      
      // Ensure file has .v extension
      const finalPath = path.extname(filePath) === '.v' ? filePath : `${filePath}.v`;
      
      console.log(`[TopLevel] Creating file at: ${finalPath}`);
      await fse.writeFile(finalPath, '// New Verilog file\n');
      console.log('[TopLevel] File created successfully');

      // Refresh file tree
      console.log('[TopLevel] Refreshing file tree...');
      ipcRenderer.send('refresh-file-tree');
    } else {
      console.log('[TopLevel] User canceled file creation');
    }
  } catch (error) {
    console.error('[TopLevel] Error during TopLevel creation:', error);
    alert(`Failed to create file: ${error.message}`);
  }
}

// Add event listener to the button
document.getElementById('create-toplevel-button').addEventListener('click', () => {
  console.log('[TopLevel] Create TopLevel button clicked');
  handleTopLevelCreation().catch(console.error);
});

// Optional: Change button style when TopLevel exists
async function updateButtonState() {
  const projectPath = getCurrentProjectPath();
  if (!projectPath) return;

  const topLevelPath = path.join(projectPath, 'TopLevel');
  const exists = await fse.pathExists(topLevelPath);
  const button = document.getElementById('create-toplevel-button');

  if (exists) {
    button.title = 'Create Verilog File in TopLevel';
    button.style.color = '#4CAF50'; // Green color when folder exists
  } else {
    button.title = 'Create TopLevel Folder and Verilog File';
    button.style.color = '';
  }
}

// Update button state when project changes
ipcRenderer.on('project-opened', updateButtonState);
ipcRenderer.on('refresh-file-tree', updateButtonState);

// Initial update
updateButtonState().catch(console.error);