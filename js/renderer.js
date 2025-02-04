let editor;
let openFiles = new Map();
let activeFile = null;
let compiling = false;
let terminal = null;
let aiAssistantVisible = false;
let aiAssistantContainer = null;
let currentProvider = 'chatgpt'; // or 'claude'


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
    const modalHtml = `
      <div class="modal-overlay">
        <div class="modal-content">
          <h2 class="modal-title">Simulation Config</h2>
          
          <div class="modal-section">
            <h3 class="section-title">Testbench Files</h3>
            <div class="checkbox-list">
              ${this.tbFiles.map(file => `
                <label class="checkbox-item">
                  <input type="checkbox" name="tb" value="${file}" ${this.standardSimulation ? 'disabled' : ''}>
                  <span>${file}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="modal-section">
            <h3 class="section-title">GTKWave Files</h3>
            <div class="checkbox-list">
              ${this.gtkwFiles.map(file => `
                <label class="checkbox-item">
                  <input type="checkbox" name="gtkw" value="${file}" ${this.standardSimulation ? 'disabled' : ''}>
                  <span>${file}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="modal-section">
            <label class="checkbox-item">
              <input type="checkbox" name="standard" ${this.selectedTb || this.selectedGtkw ? 'disabled' : ''}>
              <span>Standard Simulation</span>
            </label>
          </div>

          <div class="modal-footer">
            <button class="btn-cancel">Cancel</button>
            <button class="btn-save" disabled>Save</button>
          </div>
        </div>
      </div>
    `;

    this.modal = document.createElement('div');
    this.modal.innerHTML = modalHtml;
    document.body.appendChild(this.modal);

    this.setupEventListeners(resolve);
  }

  setupEventListeners(resolve) {
    const tbCheckboxes = this.modal.querySelectorAll('input[name="tb"]');
    const gtkwCheckboxes = this.modal.querySelectorAll('input[name="gtkw"]');
    const standardCheckbox = this.modal.querySelector('input[name="standard"]');
    const saveButton = this.modal.querySelector('.btn-save');
    const cancelButton = this.modal.querySelector('.btn-cancel');

    // Handle testbench selection
    tbCheckboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        tbCheckboxes.forEach(other => {
          if (other !== e.target) other.checked = false;
        });
        this.selectedTb = e.target.checked ? e.target.value : '';
        this.updateSaveButton(saveButton);
        standardCheckbox.disabled = this.selectedTb || this.selectedGtkw;
      });
    });

    // Handle gtkw selection
    gtkwCheckboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        gtkwCheckboxes.forEach(other => {
          if (other !== e.target) other.checked = false;
        });
        this.selectedGtkw = e.target.checked ? e.target.value : '';
        this.updateSaveButton(saveButton);
        standardCheckbox.disabled = this.selectedTb || this.selectedGtkw;
      });
    });

    // Handle standard simulation
    standardCheckbox.addEventListener('change', (e) => {
      this.standardSimulation = e.target.checked;
      tbCheckboxes.forEach(cb => {
        cb.disabled = this.standardSimulation;
        cb.checked = false;
      });
      gtkwCheckboxes.forEach(cb => {
        cb.disabled = this.standardSimulation;
        cb.checked = false;
      });
      this.selectedTb = '';
      this.selectedGtkw = '';
      this.updateSaveButton(saveButton);
    });

    // Handle save
    saveButton.addEventListener('click', () => {
      const result = {
        standardSimulation: this.standardSimulation,
        selectedTb: this.selectedTb,
        selectedGtkw: this.selectedGtkw
      };
      this.closeModal();
      resolve(result);
    });

    // Handle cancel
    cancelButton.addEventListener('click', () => {
      this.closeModal();
      resolve(null);
    });
  }

  updateSaveButton(saveButton) {
    const isValid = this.standardSimulation || (this.selectedTb && this.selectedGtkw);
    saveButton.disabled = !isValid;
  }

  closeModal() {
    document.body.removeChild(this.modal);
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
  static editors = new Map(); // Store editor instances for each file
  static activeEditor = null;
  static editorContainer = null;

  static initialize() {
    // Get or create the container for all editor instances
    this.editorContainer = document.getElementById('monaco-editor');
    if (!this.editorContainer) {
      console.error('Editor container not found');
      return;
    }

    // Ensure the container has the correct styles
    this.editorContainer.style.position = 'relative';
    this.editorContainer.style.height = '100%';
    this.editorContainer.style.width = '100%';
  }

  static createEditorInstance(filePath) {
    if (!this.editorContainer) {
      this.initialize();
    }

    // Create a new div for this editor instance
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

    // Create new Monaco editor instance
    const editor = monaco.editor.create(editorDiv, {
      theme: 'vs-dark',
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

    // Add cursor position listener
    editor.onDidChangeCursorPosition((e) => {
      if (editor === this.activeEditor) {
        const position = editor.getPosition();
        const statusElement = document.getElementById('editorStatus');
        if (statusElement) {
          statusElement.textContent = `Line ${position.lineNumber}, Column ${position.column}`;
        }
      }
    });

    // Store the editor instance and its container
    this.editors.set(filePath, {
      editor: editor,
      container: editorDiv
    });

    return editor;
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
      'cmm': 'c',
      'asm': 'asm',
      'v': 'verilog'
    };
    return languageMap[extension] || 'plaintext';
  }

  static setActiveEditor(filePath) {
    // Hide all editors
    this.editors.forEach(({editor, container}) => {
      container.style.display = 'none';
    });

    // Get or create editor for this file
    let editorData = this.editors.get(filePath);
    if (!editorData) {
      const newEditor = this.createEditorInstance(filePath);
      editorData = this.editors.get(filePath);
    }

    // Show and focus the active editor
    editorData.container.style.display = 'block';
    this.activeEditor = editorData.editor;
    this.activeEditor.focus();
    this.activeEditor.layout();

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
      editorData.container.remove();
      this.editors.delete(filePath);
    }
  }
}

async function initMonaco() {
    require(['vs/editor/editor.main'], function() {
        editor = monaco.editor.create(document.getElementById('monaco-editor'), {
            theme: 'vs-dark',
            language: 'c',
            automaticLayout: true,
            minimap: {
                enabled: true
            },
            fontSize: 14,
            fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            mouseWheelZoom: true,
            padding: {
                top: 10
            }
        });

         // Initialize tabs
         initTabs();

        // Add cursor position to status bar
        editor.onDidChangeCursorPosition((e) => {
            const position = editor.getPosition();
            document.getElementById('editorStatus').textContent =
                `Line ${position.lineNumber}, Column ${position.column}`;
        });


    });
}

//TAB MANAGER ========================================================================================================================================================

class TabManager {
  static tabs = new Map(); // Store tab information
  static activeTab = null;
  static editorStates = new Map();
  static unsavedChanges = new Set(); // Track files with unsaved changes

// Rename saveFile to saveCurrentFile for consistency
static async saveCurrentFile() {
  const currentPath = this.activeTab;
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

// Add these methods to mark files as modified/saved
static markFileAsModified(filePath) {
  if (!filePath) return;
  
  this.unsavedChanges.add(filePath);
  const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
  if (tab) {
    const closeButton = tab.querySelector('.close-tab');
    closeButton.innerHTML = '•';
    closeButton.style.color = '#ffd700'; // Gold color for unsaved changes
    closeButton.style.fontSize = '20px';
  }
}

static markFileAsSaved(filePath) {
  if (!filePath) return;
  
  this.unsavedChanges.delete(filePath);
  const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
  if (tab) {
    const closeButton = tab.querySelector('.close-tab');
    closeButton.innerHTML = '×';
    closeButton.style.color = ''; // Reset to default color
    closeButton.style.fontSize = ''; // Reset to default size
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

  static addTab(filePath, content) {
    // Ensure EditorManager is initialized
    if (!EditorManager.editorContainer) {
      EditorManager.initialize();
    }

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
    this.tabs.set(filePath, content);

    try {
      // Create editor and set content
      const editor = EditorManager.createEditorInstance(filePath);
      editor.setValue(content);

      // Setup change listener
      editor.onDidChangeModelContent(() => {
        this.markFileAsModified(filePath);
      });

      this.activateTab(filePath);
    } catch (error) {
      console.error('Error creating editor:', error);
      this.closeTab(filePath);
    }
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
  


// Modify your existing activateTab method
static activateTab(filePath) {
  // Save the state of the current tab before switching
  if (this.activeTab) {
      this.saveEditorState(this.activeTab);
  }

  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => tab.classList.remove('active'));

  const activeTab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
  if (activeTab) {
      activeTab.classList.add('active');
      this.activeTab = filePath;
      window.activeTab = this.activeTab;  // Salve no objeto global window

      // Update editor content
      this.updateEditorContent(filePath);
      
      // Restore the state of the new tab
      this.restoreEditorState(filePath);
  }
}


  static async closeTab(filePath) {
    if (this.unsavedChanges.has(filePath)) {
      const result = await showConfirmDialog(
        'Unsaved Changes',
        'This file has unsaved changes. Do you want to save before closing?'
      );
      
      if (result) {
        await this.saveCurrentFile();
      }
    }

    const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
    if (!tab) return;

    // Remove the tab element
    tab.remove();
    this.editorStates.delete(filePath);
    
    // Remove from our tabs map
    this.tabs.delete(filePath);
    this.unsavedChanges.delete(filePath);

    // If we're closing the active tab
    if (this.activeTab === filePath) {
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
          this.activateTab(remainingTabs[0]);
      } else {
          this.activeTab = null;
          if (editor) {
              editor.getModel()?.dispose();
              editor.setModel(monaco.editor.createModel('', 'plaintext'));
          }
      }
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

}

// Initialize tab container
function initTabs() {
  
  const editorContainer = document.getElementById('monaco-editor').parentElement;
  const tabsContainer = document.createElement('div');
  if (document.getElementById('editor-tabs')) return;

  tabsContainer.id = 'editor-tabs';
  editorContainer.insertBefore(tabsContainer, editorContainer.firstChild);
}

// Add this to your window.onload or initialization code
window.addEventListener('load', () => {
  initTabs();
});

window.onload = () => {
  require(['vs/editor/editor.main'], function() {
    EditorManager.initialize();
  });
};

// Update keyboard shortcuts initialization

  // Add save button click handler
  document.getElementById('saveFileBtn').addEventListener('click', () => {
    TabManager.saveCurrentFile();
  });

  // Add keyboard shortcut for save (Ctrl+Shift+S)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      TabManager.saveCurrentFile();
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



// Add this CSS for the refresh animation
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


// File handling
// Single openFile function
async function openFile(filePath) {
  if (!TabManager.tabs.has(filePath)) {
      try {
          const content = await window.electronAPI.readFile(filePath);
          await TabManager.addTab(filePath, content);
      } catch (error) {
          console.error('Error opening file:', error);
          alert(`Failed to open ${filePath}`);
      }
  } else {
      TabManager.activateTab(filePath); // Ativar a aba se já estiver aberta
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

// Função para criar novo projeto (no renderer.js)
async function createNewProject(projectName, projectLocation) {
  try {
    const projectPath = path.join(projectLocation, projectName);
    const spfPath = path.join(projectPath, `${projectName}.spf`);

    const result = await window.electronAPI.createProject(projectPath, spfPath);
    
    if (result.success) {
      currentProjectPath = projectPath;
      currentSpfPath = spfPath;

      updateProjectNameUI(result.projectData);

      console.log('Project created successfully');
      
      updateFileTree(result.files);
      updateProjectInfo(result.projectData.metadata);
      
      // Atualiza o nome do projeto na interface
      updateProjectNameUI(currentSpfPath);
    }

    return result;
  } catch (error) {
    console.error('Error creating project:', error);
    throw error;
  }
}

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

// Função para criar processador (no modal.js ou onde estiver a lógica do processador)
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

// Atualizar ao abrir um projeto existente
document.getElementById('openProjectBtn').addEventListener('click', async () => {
  try {
    const result = await window.electronAPI.showOpenDialog();
    
    if (!result.canceled && result.filePaths.length > 0) {
      currentProjectPath = result.filePaths[0];
      currentSpfPath = `${currentProjectPath}.spf`;

      await loadProject(currentProjectPath);
      
      // Atualiza o nome do projeto na interface
      updateProjectNameUI(currentSpfPath);
    }
  } catch (error) {
    console.error('Error opening project:', error);
  }
});

// Add this button to your HTML
const projectInfoButton = document.createElement('button');
projectInfoButton.className = 'toolbar-button';
projectInfoButton.innerHTML = `
  <i class="fa-solid fa-circle-info"></i>
  <span>Project Info</span>
`;


// Add it next to your openProjectBtn
document.getElementById('openProjectBtn').insertAdjacentElement('afterend', projectInfoButton);

// Add click handler for the info button
// Update project info button handler
projectInfoButton.addEventListener('click', async () => {
  try {
    if (!currentSpfPath) {
      showErrorDialog('Error', 'No project is currently open');
      return;
    }

    // Ensure we're using the .spf file path
    if (!currentSpfPath.endsWith('.spf')) {
      // If we somehow have the project directory, construct the .spf path
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
      } else {
        // Update file tree with current structure
        updateFileTree(result.files);
      }
    } else {
      // Update file tree with current structure
      updateFileTree(result.files);
    }

    // Update UI with project info
    updateProjectInfo(result.projectData.metadata);

  } catch (error) {
    //console.error('Error loading project:', error);
    showErrorDialog('Failed to load project', error.message);
  }
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

// Add the button to the toolbar (add this where other toolbar buttons are defined)
const processorHubButton = document.createElement('button');
processorHubButton.className = 'toolbar-button';
processorHubButton.innerHTML = '<i class="fas fa-microchip"></i> Processor Hub';
processorHubButton.title = 'Create New Processor Project';
processorHubButton.disabled = true; // Disabled by default
document.querySelector('.toolbar').appendChild(processorHubButton);

// Add this function to enable/disable the processor hub button
function updateProcessorHubButton(enabled) {
  processorHubButton.disabled = !enabled;
}


// Add the modal HTML function
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

// Add the event handlers
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
    // Modify the form submission handler in the processor hub
// Modify the form submission handler in the processor hub
// Update the form submission handler in the processor hub
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


// Modificar o HTML do Explorer
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
    webview.src = 'https://chat.openai.com'; // Default to ChatGPT
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
            'https://chat.openai.com' :
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

// Function to check if current tab is a .cmm file
function isActiveCmmFile() {
    return TabManager.activeTab && TabManager.activeTab.toLowerCase().endsWith('.cmm');
}

// Function to get processor name from the form
function getProcessorName() {
    const processorNameInput = document.getElementById('processorName');
    return processorNameInput ? processorNameInput.value : 'procTest_00';
}

// Function to generate test bench content
function generateTestBenchContent(processorName) {
    return `module ${processorName}_tb();
reg clk, rst;
initial begin
        $dumpfile("${processorName}_wave.vcd");
        $dumpvars(0, ${processorName}_tb);
        clk = 0;
        rst = 1;
    #20 rst = 0;
    #27000;
    $display("Fim");
    $finish;
end
always #10 clk = ~clk;
wire signed [22:0] ${processorName}_io_out;
wire ${processorName}_req_in;
wire [1:0] ${processorName}_out_en;
${processorName} ${processorName}(.clk(clk), .rst(rst),
          .io_in(16'd0), .io_out(${processorName}_io_out),
          .req_in(${processorName}_req_in), .out_en(${processorName}_out_en),
          .itr(1'b0));
endmodule`;
}

async function createTestBenchFile() {
  if (!TabManager.activeTab) return;

  const processorName = getProcessorName();
  const content = generateTestBenchContent(processorName);
  
  // Get the complete path of the current .cmm file
  const currentPath = TabManager.activeTab;
  console.log("Current .cmm file path:", currentPath);
  
  // Split the path and remove the filename
  const pathParts = currentPath.split('\\');
  pathParts.pop(); // Remove the filename (e.g., procTest_00.cmm)
  pathParts.pop(); // Remove the Software folder (e.g., procTest_00_S)
  
  // Construct the hardware path by going up another directory and appending the correct structure
  pathParts.pop(); // Go up one more directory (e.g., remove Software)
  const hardwarePath = `${pathParts.join('\\')}\\Hardware`;
  const testBenchPath = `${hardwarePath}\\${processorName}_tb.v`;

  console.log('Base directory:', pathParts.join('\\'));
  console.log('Hardware path:', hardwarePath);
  console.log('Creating test bench file at:', testBenchPath);

  try {
      // Ensure the hardware directory exists
      await window.electronAPI.createDirectory(hardwarePath);
      
      // Write the test bench file
      await window.electronAPI.writeFile(testBenchPath, content);
      
      console.log('Test bench file created successfully at:', testBenchPath);
      
       // Chamar função do terminal.js para executar os comandos do Icarus
       document.dispatchEvent(
        new CustomEvent('vericomp', {
            detail: {
                processorName,
                hardwarePath,
            },
        })
    );

  } catch (error) {
      console.error('Error creating test bench file:', error);
      console.error('Attempted path was:', testBenchPath);
  }
}

// Update button state based on active tab
function updateCompileButtonState() {
    const isCmmFile = isActiveCmmFile();
    compileButton.disabled = !isCmmFile;
    if (isCmmFile) {
        compileButton.style.opacity = "1";
        compileButton.style.cursor = "pointer";
    } else {
        compileButton.style.opacity = "0.5";
        compileButton.style.cursor = "not-allowed";
    }
}

// Event listeners
compileButton.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isActiveCmmFile()) {
        await createTestBenchFile();
    }
});

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
    const configPath = await window.electronAPI.joinPath('saphoComponents', 'Scripts', 'processorConfig.json');
    const data = await window.electronAPI.readFile(configPath);
    this.config = JSON.parse(data);
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
      const cmd = `"${cmmCompPath}" "${cmmPath}" "${asmPath}" "${macrosPath}" "${tempPath}"`;
      
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
      const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
      const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
      
      const asmCompPath = await window.electronAPI.joinPath('saphoComponents', 'bin', 'asmcomp.exe');
      const cmd = `"${asmCompPath}" "${asmPath}" "${hardwarePath}" "${hdlPath}" "${tempPath}" ${clk} ${numClocks}`;
      
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
      const testbenchSource = await window.electronAPI.joinPath(hardwarePath, `${name}_tb.v`);
      const testbenchDestination = await window.electronAPI.joinPath(tempPath, `${name}_tb.v`);
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
        const hdlPath = await window.electronAPI.joinPath(appPath, 'saphoComponents', 'HDL');
        const tempPath = await window.electronAPI.joinPath(appPath, 'saphoComponents', 'Temp', name);
        const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
        
        this.terminalManager.appendToTerminal('tveri', 'Copying required files...');
        
        // Copiar arquivos necessários
        await window.electronAPI.copyFile(
            await window.electronAPI.joinPath(hardwarePath, `${name}_data.mif`),
            await window.electronAPI.joinPath(tempPath, `${name}_data.mif`)
        );
        this.terminalManager.appendToTerminal('tveri', `Copied ${name}_data.mif`);
        
        await window.electronAPI.copyFile(
            await window.electronAPI.joinPath(hardwarePath, `${name}_inst.mif`),
            await window.electronAPI.joinPath(tempPath, `${name}_inst.mif`)
        );
        this.terminalManager.appendToTerminal('tveri', `Copied ${name}_inst.mif`);
        
        const flags = this.config.iverilogFlags.join(' ');
        
        // Definir arquivo de testbench
        let tbFile;
        if (simConfig.standardSimulation) {
            const expectedFileName = `${name}_tb.v`;
            const files = await window.electronAPI.readDir(hardwarePath);
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
            'int2float.v', 'proc_fl.v', 'float2int.v', 'addr_dec.v', 'core_fl.v', 'mem_instr.v',
            'prefetch.v', 'instr_dec.v', 'stack_pointer.v', 'ula.v', 'float2index.v', 'stack.v',
            'rel_addr.v', 'ula_fl.v', 'proc_fx.v', 'core_fx.v', 'ula_fx.v'
        ];
        
        const verilogFilesString = verilogFiles.map(file => `${file}`).join(' ');
        
        const cmd = `cd "${hdlPath}" && iverilog ${flags} -s ${name}_tb -o "${await window.electronAPI.joinPath(tempPath, name)}" "${await window.electronAPI.joinPath(hardwarePath, tbFile)}" "${await window.electronAPI.joinPath(hardwarePath, `${name}.v`)}" "${await window.electronAPI.joinPath(tempPath, 'mem_data_sim.v')}" "${await window.electronAPI.joinPath(tempPath, 'pc_sim.v')}" ${verilogFilesString}`;
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
        
        // Executar vvp
        this.terminalManager.appendToTerminal('tveri', 'Running VVP simulation...');
        const vvpCmd = `cd "${tempPath}" && vvp ${name}`;
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
        const tempPath = await window.electronAPI.joinPath(appPath, 'saphoComponents', 'Temp', name);
        const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
        
        // Copiar executáveis
        this.terminalManager.appendToTerminal('twave', 'Copying GTKWave executables...');
        const binPath = await window.electronAPI.joinPath(appPath, 'saphoComponents', 'bin');
        const executables = ['comp2gtkw.exe', 'f2i_gtkw.exe', 'float2gtkw.exe'];
        
        for (const exe of executables) {
            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(binPath, exe),
                await window.electronAPI.joinPath(tempPath, exe)
            );
            this.terminalManager.appendToTerminal('twave', `Copied ${exe}`);
        }
        
        let cmd;
        if (simConfig.standardSimulation) {
            const scriptsPath = await window.electronAPI.joinPath(appPath, 'saphoComponents', 'Scripts', 'gtkwave_init.tcl');
            const vcdPath = await window.electronAPI.joinPath(tempPath, `${name}_tb.vcd`);
            const tempNamePath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
            
            cmd = `cd /d "${tempNamePath}" && gtkwave "${vcdPath}" --script="${scriptsPath}"`;
        } else {
            const gtkwPath = await window.electronAPI.joinPath(hardwarePath, simConfig.selectedGtkw);
            const vcdPath = await window.electronAPI.joinPath(tempPath, `${name}_tb.vcd`);
            cmd = `gtkwave "${vcdPath}" "${gtkwPath}"`;
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


//TERMINAL =============================================================================================================================================================
class TerminalManager {
  constructor() {
    this.terminals = {
      tcmm: document.querySelector('#terminal-tcmm .terminal-body'),
      tasm: document.querySelector('#terminal-tasm .terminal-body'),
      tveri: document.querySelector('#terminal-tveri .terminal-body'),
      twave: document.querySelector('#terminal-twave .terminal-body'),
      tcmd: document.querySelector('#terminal-tcmd .terminal-body')
    };
    
    this.setupTerminalTabs();
    this.setupClearButton();
    this.setupAutoScroll();
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
  
    // Evento de clique com o botão esquerdo
    clearButton.addEventListener('click', (event) => {
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
    });
  
    // Evento de clique com o botão direito
    clearButton.addEventListener('contextmenu', (event) => {
      event.preventDefault(); // Evita o menu de contexto padrão
      if (event.button === 2) { // Botão direito
        this.changeClearIcon(clearButton);
      }
    });
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
console.log('AQUIII2', currentProjectPath);
  const result = await window.electronAPI.createBackup(currentProjectPath);

  alert(result.message); // Exibe o resultado do backup
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