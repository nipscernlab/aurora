let aiAssistantContainer = null;
let currentProvider = 'chatgpt';
let watcherTimeout = null;
let currentProjectPath = null; 
let currentSpfPath = null;
let globalTerminalManager = null;
let compilationCanceled = false;

import { EditorManager } from './monaco_editor.js';
import { initMonaco } from './monaco_editor.js';
import { RecentProjectsManager } from './recent_projects.js';
import { TabManager } from './tab_manager.js';

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
        // CRITICAL: Skip if hierarchy view is active
        const fileTree = document.getElementById('file-tree');
        if (!fileTree) return;
        
        if (TreeViewState.isHierarchical) {
            console.log('Skipping refresh - hierarchy view is active');
            return;
        }
        
        if (!currentProjectPath) {
            console.warn('No project is currently open');
            return;
        }

        // Prevent multiple simultaneous refreshes
        if (FileTreeState.isRefreshing) {
            return;
        }

        FileTreeState.isRefreshing = true;
        const refreshButton = document.getElementById('refresh-button');

        if (refreshButton) {
            refreshButton.style.pointerEvents = 'none';
            refreshButton.classList.add('spinning');
        }

        // Get fresh data from backend
        const result = await window.electronAPI.refreshFolder(currentProjectPath);

        if (result && result.files) {
            // Save current expanded state
            const expandedPaths = Array.from(FileTreeState.expandedFolders);
            
            // Apply fade-out transition
            fileTree.style.transition = 'opacity 0.2s ease';
            fileTree.style.opacity = '0';

            setTimeout(() => {
                // Clear and rebuild tree
                fileTree.innerHTML = '';
                fileTree.classList.remove('hierarchy-view'); // Ensure standard view
                
                // Render fresh tree
                renderFileTree(result.files, fileTree);
                
                // Restore expanded folders
                expandedPaths.forEach(path => {
                    const folderItem = fileTree.querySelector(
                        `.file-tree-item[data-path="${CSS.escape(path)}"]`
                    );
                    if (folderItem) {
                        const folderToggle = folderItem.querySelector('.folder-toggle');
                        const folderContent = folderItem.querySelector('.folder-content');
                        const icon = folderItem.querySelector('.file-item-icon');
                        
                        if (folderToggle && folderContent) {
                            folderContent.classList.remove('hidden');
                            folderToggle.classList.add('rotated');
                            if (icon) {
                                icon.classList.remove('fa-folder');
                                icon.classList.add('fa-folder-open');
                            }
                        }
                    }
                });
                
                // Fade back in
                fileTree.style.opacity = '1';
            }, 200);
        }

        if (refreshButton) {
            setTimeout(() => {
                refreshButton.style.pointerEvents = 'auto';
                refreshButton.classList.remove('spinning');
            }, 300);
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
    if (!Array.isArray(files)) {
        console.error('renderFileTree: files is not an array');
        return;
    }
    
    const filteredFiles = files.filter(file => {
        if (file.type === 'directory') return true;
        if (file.name === 'projectOriented.json') return false;
        if (file.name === 'processorConfig.json') return false;
        const extension = file.name.split('.').pop().toLowerCase();
        return extension !== 'spf';
    });

    // Sort: folders first, then files
    filteredFiles.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
    });

    filteredFiles.forEach(file => {
        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'file-tree-item';

        const item = document.createElement('div');
        item.className = 'file-item';
        item.style.paddingLeft = `${level * 20}px`;

        const icon = document.createElement('i');
        const filePath = file.path; // Use full path from file object

        if (file.type === 'directory') {
            itemWrapper.setAttribute('data-path', filePath);
            
            const folderToggle = document.createElement('i');
            folderToggle.className = 'fa-solid fa-caret-right folder-toggle';
            item.appendChild(folderToggle);

            icon.className = 'fas fa-folder file-item-icon';
            item.appendChild(icon);

            const childContainer = document.createElement('div');
            childContainer.className = 'folder-content hidden';

            const wasExpanded = FileTreeState.isExpanded(filePath);
            
            if (wasExpanded) {
                childContainer.classList.remove('hidden');
                folderToggle.classList.add('rotated');
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

                if (!isExpanded && file.children && file.children.length > 0) {
                    const visibleItems = childContainer.querySelectorAll('.file-tree-item');
                    visibleItems.forEach((item, index) => {
                        item.style.animation = 'none';
                        item.offsetHeight;
                        item.style.animation = `fadeInDown 0.3s ease forwards`;
                        item.style.animationDelay = `${index * 50}ms`;
                    });
                }
            };

            item.addEventListener('click', toggleFolder);

            // CRITICAL: Render children recursively
            if (file.children && Array.isArray(file.children)) {
                renderFileTree(file.children, childContainer, level + 1, filePath);
            }

            itemWrapper.appendChild(item);
            itemWrapper.appendChild(childContainer);
        } else {
            // File rendering
            const extension = file.name.split('.').pop().toLowerCase();
            if (extension === 'gtkw') {
                icon.className = 'fa-solid fa-file-waveform file-item-icon';
            }
            else if (extension === 'asm') {
                icon.className = 'fa-solid fa-file-lines';
            } else if (extension === 'v') {
                icon.className = 'fa-solid fa-file-pen file-item-icon';
            } else if (extension === 'txt') {
                icon.className = 'fa-solid fa-file-lines file-item-icon';
            } else if (extension === 'zip' || extension === '7z') {
                icon.className = 'fa-solid fa-file-zipper file-item-icon';
            } else if (file.name === 'house_report.json') {
                icon.className = 'fa-solid fa-file-export file-item-icon';
            } else if (extension === 'cmm') {
                icon.className = 'fa-solid fa-file-code'; 
            }
            else if (extension === 'mif') {
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

            item.appendChild(icon);
            itemWrapper.appendChild(item);
        }

        const name = document.createElement('span');
        name.textContent = file.name;
        item.appendChild(name);

        container.appendChild(itemWrapper);
    });
}

// Add this function to display files from fileOriented.json
async function renderFileModeTree() {
  const fileTree = document.getElementById('file-tree');
  if (!fileTree) return;
  
  try {
    const projectPath = window.currentProjectPath;
    if (!projectPath) return;
    
    const fileModeConfigPath = await window.electronAPI.joinPath(projectPath, 'fileOriented.json');
    const configExists = await window.electronAPI.fileExists(fileModeConfigPath);
    
    if (!configExists) return;
    
    const configContent = await window.electronAPI.readFile(fileModeConfigPath);
    const config = JSON.parse(configContent);
    
    if (!config.synthesizableFiles || config.synthesizableFiles.length === 0) return;
    
    fileTree.innerHTML = '';
    fileTree.classList.add('file-mode-view');
    
    const container = document.createElement('div');
    container.className = 'file-mode-list';
    container.style.cssText = `
      padding: var(--space-4);
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    `;
    
    const sortedFiles = config.synthesizableFiles.sort((a, b) => {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      return a.name.localeCompare(b.name);
    });
    
    sortedFiles.forEach(file => {
      const fileItem = document.createElement('div');
      fileItem.className = 'file-mode-item';
      fileItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3);
        background: var(--bg-tertiary);
        border: 1px solid ${file.starred ? 'var(--accent-primary)' : 'var(--border-primary)'};
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--transition-fast);
      `;
      
      fileItem.addEventListener('mouseenter', () => {
        fileItem.style.background = 'var(--bg-quaternary)';
        fileItem.style.borderColor = 'var(--accent-secondary)';
      });
      
      fileItem.addEventListener('mouseleave', () => {
        fileItem.style.background = 'var(--bg-tertiary)';
        fileItem.style.borderColor = file.starred ? 'var(--accent-primary)' : 'var(--border-primary)';
      });
      
      const icon = document.createElement('i');
      icon.className = TabManager.getFileIcon(file.name);
      icon.style.color = file.starred ? 'var(--accent-primary)' : 'var(--icon-primary)';
      
      const nameSpan = document.createElement('span');
      nameSpan.textContent = file.name;
      nameSpan.style.cssText = `
        flex: 1;
        font-size: var(--text-sm);
        color: var(--text-primary);
        font-weight: ${file.starred ? 'var(--font-semibold)' : 'var(--font-normal)'};
      `;
      
      if (file.starred) {
        const badge = document.createElement('span');
        badge.innerHTML = '<i class="fa-solid fa-star-of-life"></i>';
        badge.style.cssText = `
          color: var(--accent-primary);
          font-size: var(--text-xs);
        `;
        fileItem.appendChild(icon);
        fileItem.appendChild(nameSpan);
        fileItem.appendChild(badge);
      } else {
        fileItem.appendChild(icon);
        fileItem.appendChild(nameSpan);
      }
      
      fileItem.addEventListener('click', async () => {
        try {
          const content = await window.electronAPI.readFile(file.path);
          TabManager.addTab(file.path, content);
        } catch (error) {
          console.error('Error opening file:', error);
        }
      });
      
      container.appendChild(fileItem);
    });
    
    fileTree.appendChild(container);
    
  } catch (error) {
    console.error('Error rendering file mode tree:', error);
  }
}

// Export for use
window.renderFileModeTree = renderFileModeTree;

// Update the refreshFileTree function to check for File Mode
const originalRefreshFileTree = refreshFileTree;
refreshFileTree = async function() {
  try {
    const projectPath = window.currentProjectPath;
    if (!projectPath) return originalRefreshFileTree();
    
    const fileModeConfigPath = await window.electronAPI.joinPath(projectPath, 'fileOriented.json');
    const fileModeExists = await window.electronAPI.fileExists(fileModeConfigPath);
    
    if (fileModeExists) {
      await renderFileModeTree();
    } else {
      await originalRefreshFileTree();
    }
  } catch (error) {
    console.error('Error in refreshFileTree:', error);
  }
};

function forceFileTreeUpdate() {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree) return;
    
    // Remover classe hierarchy se estiver presente
    fileTree.classList.remove('hierarchy-view');
    
    // Forçar refresh
    refreshFileTree();
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
if (window.electronAPI && window.electronAPI.onFileTreeRefreshed) {
        window.electronAPI.onFileTreeRefreshed((data) => {
            console.log('Recebeu atualização da file tree:', data);
            
            // Verificar se não está em modo hierárquico
            const fileTree = document.getElementById('file-tree');
            if (fileTree && !fileTree.classList.contains('hierarchy-view')) {
                // Atualizar a árvore com os novos dados
                updateFileTreeSafely(data.files);
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

// Global state manager for tree views
const TreeViewState = {
    isHierarchical: false,
    hierarchyData: null,
    standardTreeHTML: null,
    isToggleEnabled: false,
    compilationModule: null, // Store reference to compilation module
    
    setHierarchical(value) {
        this.isHierarchical = value;
        this.updateToggleButton();
    },
    
    setCompilationModule(module) {
        this.compilationModule = module;
    },
    
    updateToggleButton() {
        const toggleButton = document.getElementById('hierarchy-tree-toggle');
        if (!toggleButton) return;
        
        const icon = toggleButton.querySelector('i');
        const text = toggleButton.querySelector('.toggle-text');
        
        if (this.isHierarchical) {
            icon.className = 'fa-solid fa-list-ul';
            text.textContent = 'Standard';
            toggleButton.classList.add('active');
            toggleButton.title = 'Switch to standard file tree';
        } else {
            icon.className = 'fa-solid fa-sitemap';
            text.textContent = 'Hierarchical';
            toggleButton.classList.remove('active');
            toggleButton.title = 'Switch to hierarchical module view';
        }
    },
    
    enableToggle() {
        const toggleButton = document.getElementById('hierarchy-tree-toggle');
        if (!toggleButton) return;
        
        toggleButton.classList.remove('disabled');
        toggleButton.disabled = false;
        this.isToggleEnabled = true;
    },
    
    disableToggle() {
        const toggleButton = document.getElementById('hierarchy-tree-toggle');
        if (!toggleButton) return;
        
        toggleButton.classList.add('disabled');
        toggleButton.disabled = true;
        toggleButton.title = 'Compile Verilog to generate hierarchy';
        this.isToggleEnabled = false;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Initialize tree view state FIRST
    TreeViewState.disableToggle();
    TreeViewState.setHierarchical(false);
    
    // Setup refresh button
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            if (!TreeViewState.isHierarchical) {
                refreshFileTree();
            } else {
                console.log('Refresh disabled in hierarchy view');
            }
        });
    }
    
    // Initialize compilation module
    if (typeof CompilationModule !== 'undefined') {
        const compilationModule = new CompilationModule(window.currentProjectPath || projectPath);
        compilationModule.setupHierarchyToggle();
        window.compilationModule = compilationModule;
        console.log('Compilation module initialized with hierarchy support');
    }
    
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

    // In DirectoryWatcher.updateFileTreeFromFiles method, add this check:
// Localizar esta função dentro da classe DirectoryWatcher e substituir por:
// In DirectoryWatcher class, update this method:
updateFileTreeFromFiles(files) {
    try {
        // CRITICAL: Don't update if hierarchy view is active
        if (TreeViewState.isHierarchical) {
            console.log('Skipping file tree update - hierarchy view active');
            return;
        }
        
        updateFileTreeSafely(files);
        
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

function addToRecentProjects(spfPath) {
  if (window.recentProjectsManager && spfPath) {
    window.recentProjectsManager.addProject(spfPath);
  }
}

//PROJECTBUTTON ======================================================================================================================================================== ƒ

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
      const hdlDir = await window.electronAPI.joinProjectPath('saphoComponents', 'HDL');
      try {
          await window.electronAPI.openFolder(hdlDir);
      } catch (error) {
          console.error('Error opening HDL folder:', error);
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

function updateFileTreeSafely(files) {
    try {
        // CRITICAL: Don't update if hierarchy view is active
        if (TreeViewState.isHierarchical) {
            console.log('Skipping update - hierarchy view active');
            return;
        }
        
        const fileTree = document.getElementById('file-tree');
        if (!fileTree) return;
        
        // Don't interrupt user interactions
        if (FileTreeState.isRefreshing) {
            console.log('Skipping update - refresh in progress');
            return;
        }
        
        // Validate that files is a proper nested structure
        if (!Array.isArray(files)) {
            console.error('Invalid files structure - not an array');
            return;
        }
        
        // Save state before update
        const expandedPaths = Array.from(FileTreeState.expandedFolders);
        
        // Clear and rebuild
        fileTree.innerHTML = '';
        fileTree.classList.remove('hierarchy-view');
        
        // Render with proper nested structure
        renderFileTree(files, fileTree, 0, '');
        
        // Restore expanded state
        expandedPaths.forEach(path => {
            const folderItem = fileTree.querySelector(
                `.file-tree-item[data-path="${CSS.escape(path)}"]`
            );
            if (folderItem) {
                const content = folderItem.querySelector('.folder-content');
                const toggle = folderItem.querySelector('.folder-toggle');
                const icon = folderItem.querySelector('.file-item-icon');
                
                if (content && toggle) {
                    content.classList.remove('hidden');
                    toggle.classList.add('rotated');
                    if (icon) {
                        icon.classList.remove('fa-folder');
                        icon.classList.add('fa-folder-open');
                    }
                }
            }
        });
        
        console.log('File tree updated successfully');
        
    } catch (error) {
        console.error('Error in updateFileTreeSafely:', error);
    }
}

// Function to update file tree (MODIFICADA)
function updateFileTree(files) {
    console.log('updateFileTree called with files:', files);
    updateFileTreeSafely(files);
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
     const recentProjectsManager = new RecentProjectsManager(loadProject);
    TabManager.initialize();

    // ADD THIS LINE:
    FileTreeManager.initialize();

    // If you need to access the manager from other places (like old code),
    // you can attach it to the window object.
    window.recentProjectsManager = recentProjectsManager;
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


document.addEventListener('DOMContentLoaded', () => {
    const refreshButton = document.getElementById('refresh-button');

    if (refreshButton) {
        refreshButton.addEventListener('click', async () => {
            // Add spinning animation
            refreshButton.classList.add('spinning');

            // Disable the button temporarily
            refreshButton.style.pointerEvents = 'none';

            

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
        this.hierarchyData = null;
        this.isHierarchicalView = false;
        this.gtkwaveProcess = null;
        this.hierarchyGenerated = false;
        this.setupHierarchyToggle(); 
        this._hierarchyGenerationInProgress = false;

}

    // Extract file path and line number from Yosys source attribute
static extractFileInfoFromSource(sourceAttr) {
    if (!sourceAttr) return null;
    
    // Format: "C:\\path\\to\\file.v:startLine.startCol-endLine.endCol"
    const match = sourceAttr.match(/^(.+\.v):(\d+)\.\d+(?:-\d+\.\d+)?$/);
    if (!match) return null;
    
    return {
        filePath: match[1],
        lineNumber: parseInt(match[2], 10)
    };
}

// Open file in Monaco Editor and navigate to specific line
static async openModuleFile(filePath, lineNumber = null) {
    try {
        // Check if file exists
        const fileExists = await window.electronAPI.fileExists(filePath);
        if (!fileExists) {
            this.terminalManager.appendToTerminal('tveri', 
                `File not found: ${filePath}`, 'error');
            return;
        }

        // Read file content
        const content = await window.electronAPI.readFile(filePath, { encoding: 'utf8' });
        
        // Add tab or activate existing tab
        TabManager.addTab(filePath, content);
        
        // Navigate to specific line if provided
        if (lineNumber) {
            setTimeout(() => {
                const editor = EditorManager.getEditorForFile(filePath);
                if (editor) {
                    this.goToLineInEditor(editor, lineNumber);
                }
            }, 100); // Small delay to ensure editor is ready
        }
        
    } catch (error) {
        console.error('Error opening module file:', error);
        this.terminalManager.appendToTerminal('tveri', 
            `Failed to open file: ${error.message}`, 'error');
    }
}

// Navigate to specific line in editor with selection
static goToLineInEditor(editor, lineNumber) {
    if (!editor) return;
    
    const model = editor.getModel();
    if (!model) return;
    
    const totalLines = model.getLineCount();
    const targetLine = Math.max(1, Math.min(lineNumber, totalLines));
    
    // Set cursor position
    editor.setPosition({
        lineNumber: targetLine,
        column: 1
    });
    
    // Reveal line in center of viewport
    editor.revealLineInCenter(targetLine);
    
    // Focus the editor
    editor.focus();
    
    // Select the entire line for visibility
    editor.setSelection({
        startLineNumber: targetLine,
        startColumn: 1,
        endLineNumber: targetLine,
        endColumn: model.getLineMaxColumn(targetLine)
    });
}


async monitorGtkwaveProcess() {
    if (!this.gtkwaveProcess) return;

    const checkInterval = setInterval(async () => {
        try {
            const isRunning = await window.electronAPI.isProcessRunning(this.gtkwaveProcess);
            
            if (!isRunning) {
                clearInterval(checkInterval);
                
                if (this.isHierarchicalView) {
                    this.terminalManager.appendToTerminal('twave', 
                        'GTKWave closed - restoring standard file tree...', 'info');
                    
                    setTimeout(() => {
                        this.restoreStandardTreeState();
                        if (typeof refreshFileTree === 'function') {
                            refreshFileTree();
                        }
                    }, 500);
                }
                
                this.gtkwaveProcess = null;
                this.hierarchyGenerated = false;
            }
        } catch (error) {
            clearInterval(checkInterval);
            console.error('Error monitoring GTKWave process:', error);
        }
    }, 2000); // Check every 2 seconds
}

    async generateProcessorHierarchy(processor) {
        try {
            const yosysPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'PRISM', 'yosys', 'yosys.exe');
            const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', processor.name);
            const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
            const hardwarePath = await window.electronAPI.joinPath(this.projectPath, processor.name, 'Hardware');
            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const designTopModule = selectedCmmFile.replace(/\.cmm$/i, '');

            this.terminalManager.appendToTerminal('tveri', 'Generating module hierarchy with Yosys...');

            const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
            const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${designTopModule}.v`);

            const yosysScript = `
                ${verilogFiles.map(f => `read_verilog -sv "${hdlPath}\\${f}"`).join('\n')}
                read_verilog -sv "${hardwareFile}"
                hierarchy -top ${designTopModule}
                proc
                write_json "${tempPath}\\hierarchy.json"
            `;

            const scriptPath = await window.electronAPI.joinPath(tempPath, 'hierarchy_gen.ys');
            await window.electronAPI.writeFile(scriptPath, yosysScript);

            const yosysCmd = `cd "${tempPath}" && "${yosysPath}" -s "${scriptPath}"`;
            const result = await window.electronAPI.execCommand(yosysCmd);

            if (result.code !== 0) {
                throw new Error(`Yosys hierarchy generation failed.`);
            }

            const jsonPath = await window.electronAPI.joinPath(tempPath, 'hierarchy.json');
            const jsonContent = await window.electronAPI.readFile(jsonPath, { encoding: 'utf8' });
            const hierarchyJson = JSON.parse(jsonContent);

            this.hierarchyData = this.parseYosysHierarchy(hierarchyJson, designTopModule);
            this.terminalManager.appendToTerminal('tveri', 'Module hierarchy generated successfully', 'success');
            this.enableHierarchyToggle();
            return true;
        } catch (error) {
            this.terminalManager.appendToTerminal('tveri', `Hierarchy generation error: ${error.message}`, 'warning');
            return false;
        }
    }

    async generateProjectHierarchy() {
        try {
            if (!this.projectConfig) throw new Error("Project configuration not loaded");

            const topLevelFilePath = this.projectConfig.topLevelFile;
            if (!topLevelFilePath) throw new Error("'topLevelFile' not found in projectOriented.json");
            
            const designTopModule = topLevelFilePath.split(/[\\\/]/).pop().replace(/\.v$/i, '');
            const yosysPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'PRISM', 'yosys', 'yosys.exe');
            const tempBaseDir = await window.electronAPI.joinPath('saphoComponents', 'Temp');
            
            this.terminalManager.appendToTerminal('tveri', 'Generating project hierarchy with Yosys...');

            const synthesizableFiles = this.projectConfig.synthesizableFiles || [];
            const yosysScript = `
                ${synthesizableFiles.map(file => `read_verilog -sv "${file.path}"`).join('\n')}
                hierarchy -top ${designTopModule}
                proc
                write_json "${tempBaseDir}\\project_hierarchy.json"
            `;

            const scriptPath = await window.electronAPI.joinPath(tempBaseDir, 'project_hierarchy_gen.ys');
            await window.electronAPI.writeFile(scriptPath, yosysScript);

            const yosysCmd = `cd "${tempBaseDir}" && "${yosysPath}" -s "${scriptPath}"`;
            const result = await window.electronAPI.execCommand(yosysCmd);

            if (result.code !== 0) throw new Error(`Yosys project hierarchy generation failed.`);
            
            const jsonPath = await window.electronAPI.joinPath(tempBaseDir, 'project_hierarchy.json');
            const hierarchyJson = JSON.parse(await window.electronAPI.readFile(jsonPath, { encoding: 'utf8' }));
            
            this.hierarchyData = this.parseYosysHierarchy(hierarchyJson, designTopModule);
            this.terminalManager.appendToTerminal('tveri', 'Project hierarchy generated successfully', 'success');
            return true;
        } catch (error) {
            this.terminalManager.appendToTerminal('tveri', `Project hierarchy generation error: ${error.message}`, 'warning');
            return false;
        }
    }

    // --- INÍCIO DO BLOCO CORRIGIDO ---

    parseYosysIdentifier(yosysName) {
        let cleanName = yosysName;
        let filePath = null;
        const pathRegex = /([a-zA-Z]:\\[^:]+\.v)|(\/[^:]+\.v)/;
        const match = yosysName.match(pathRegex);
        if (match) filePath = match[1] || match[2] || null;
        if (filePath) cleanName = cleanName.split(filePath)[0];
        if (cleanName.startsWith('$paramod')) {
            const parts = cleanName.split('\\');
            if (parts.length >= 2) cleanName = parts[1];
        }
        cleanName = cleanName.replace(/\$[a-f0-9]{32,}/g, '').replace(/^\$[0-9]+\$/g, '').replace(/[\\\$]+$/, '').replace(/^[\\\$]+/, '');
        if (!cleanName.trim()) cleanName = yosysName.split('\\').pop() || 'unknown';
        return { cleanName, filePath };
    }

    /**
     * VERSÃO CORRETA: Analisa o JSON em uma árvore aninhada profunda, distinguindo
     * entre a definição de um módulo e suas instâncias.
     */
    parseYosysHierarchy(jsonData, topLevelModule) {
    const modules = jsonData.modules || {};
    const memo = new Map();

    // Enhanced primitive detection - Yosys/Verilog built-in primitives
    const PRIMITIVE_PATTERNS = [
        /^\$_/,              // $_DFF_, $_AND_, etc.
        /^\$paramod\$_/,     // Parameterized primitives
        /^\$lut/i,           // LUT primitives
        /^\$(and|or|xor|not|buf|mux|add|sub|mul|div|mod|pow|eq|ne|lt|le|gt|ge)/i, // Arithmetic/logic ops
        /^\$(dff|dffe|adff|adffe|sdff|sdffe|dlatch|dlatchsr)/i, // Flip-flops and latches
        /^\$(mem|memrd|memwr)/i, // Memory primitives
        /^\$(assert|assume|cover|check)/i, // Verification primitives
        /^\$reduce_/i,       // Reduction operators
        /^\$logic_/i,        // Logic operators
        /^\$shift/i,         // Shift operators
    ];

    const isPrimitive = (moduleName) => {
        // Check if it's a known primitive pattern
        const cleanName = this.parseYosysIdentifier(moduleName).cleanName;
        
        // If it matches any primitive pattern, it's a primitive
        if (PRIMITIVE_PATTERNS.some(pattern => pattern.test(cleanName))) {
            return true;
        }
        
        // If module doesn't exist in modules list, it's likely a primitive
        if (!modules[moduleName]) {
            return true;
        }
        
        const moduleData = modules[moduleName];
        
        // Check if module has attributes.src (user modules have source files)
        // Primitives typically don't have source file references
        if (!moduleData.attributes || !moduleData.attributes.src) {
            // However, allow modules without src if they have cells (submodules)
            const hasCells = moduleData.cells && Object.keys(moduleData.cells).length > 0;
            return !hasCells; // If no cells and no src, it's likely a primitive
        }
        
        return false;
    };

    const buildDefinitionTree = (moduleName) => {
        if (memo.has(moduleName)) return memo.get(moduleName);

        // Filter out primitives
        if (isPrimitive(moduleName)) {
            return null;
        }

        const moduleData = modules[moduleName];
        const { cleanName, filePath } = this.parseYosysIdentifier(moduleName);

        if (!moduleData) return null;

        // Extract file info from attributes
        let sourceFilePath = filePath;
        let sourceLineNumber = null;
        
        if (moduleData.attributes && moduleData.attributes.src) {
            const fileInfo = this.constructor.extractFileInfoFromSource(moduleData.attributes.src);
            if (fileInfo) {
                sourceFilePath = fileInfo.filePath;
                sourceLineNumber = fileInfo.lineNumber;
            }
        }

        const definitionNode = {
            name: cleanName,
            filePath: sourceFilePath,
            lineNumber: sourceLineNumber,
            children: []
        };
        
        memo.set(moduleName, definitionNode);

        const cells = moduleData.cells || {};
        for (const [cellName, cellData] of Object.entries(cells)) {
            // Recursively build tree, filtering primitives
            const subModuleDefinition = buildDefinitionTree(cellData.type);

            // Only add if it's not a primitive
            if (subModuleDefinition) {
                const instanceNode = {
                    instanceName: this.parseYosysIdentifier(cellName).cleanName,
                    type: 'instance',
                    moduleDefinition: subModuleDefinition
                };
                definitionNode.children.push(instanceNode);
            }
        }
        
        return definitionNode;
    };
    
    const originalTopLevelName = Object.keys(modules).find(key => 
        this.parseYosysIdentifier(key).cleanName === topLevelModule
    );

    if (!originalTopLevelName) {
        console.error(`Top module "${topLevelModule}" not found.`);
        return { name: topLevelModule, filePath: null, lineNumber: null, children: [] };
    }

    const hierarchyTree = buildDefinitionTree(originalTopLevelName);
    
    // Log statistics for debugging
    console.log(`Hierarchy built: ${memo.size} user modules found`);
    
    return hierarchyTree;
}


    /**
     * VERSÃO CORRETA: Renderiza a árvore com base na nova estrutura de dados.
     */
   renderHierarchicalTree() {
    const fileTreeElement = document.getElementById('file-tree');
    if (!fileTreeElement || !this.hierarchyData) return;

    fileTreeElement.innerHTML = '';
    fileTreeElement.classList.add('hierarchy-view');
    
    const container = document.createElement('div');
    container.className = 'hierarchy-container';

    // The top module is treated as a special instance of itself
    const topLevelInstance = {
        instanceName: this.hierarchyData.name,
        type: 'instance',
        moduleDefinition: this.hierarchyData
    };

    const topItem = this.createHierarchyItem(topLevelInstance, 'top-level', 'fa-solid fa-microchip', true);
    
    // CRITICAL: Set data-type attribute for CSS targeting
    topItem.setAttribute('data-type', 'top-level');
    
    container.appendChild(topItem);
    
    // Build recursive tree starting from top definition
    this.buildHierarchyTree(topItem, this.hierarchyData);
    
    fileTreeElement.appendChild(container);
}
    
    /**
     * VERSÃO CORRETA E SEGURA: Constrói a árvore visual e usa ordenação robusta.
     */
   buildHierarchyTree(parentItem, moduleDefinition) {
    if (!moduleDefinition.children || moduleDefinition.children.length === 0) {
        return;
    }

    const childrenContainer = parentItem.querySelector('.hierarchy-children');
    if (!childrenContainer) return;

    const sortedInstances = [...moduleDefinition.children].sort((a, b) => {
        const nameA = a?.instanceName || '';
        const nameB = b?.instanceName || '';
        return nameA.localeCompare(nameB);
    });

    for (const instanceNode of sortedInstances) {
        const childItem = this.createHierarchyItem(instanceNode, 'module', 'fa-solid fa-cube');
        
        // Set data-type for styling
        childItem.setAttribute('data-type', 'module');
        
        childrenContainer.appendChild(childItem);
        
        // Recurse using the definition inside the instance
        this.buildHierarchyTree(childItem, instanceNode.moduleDefinition);
    }
}
    /**
     * VERSÃO CORRETA: Cria o item visual, mostrando "instanceName (moduleType)".
     */
  createHierarchyItem(instanceNode, type, icon, isExpanded = false) {
    const itemContainer = document.createElement('div');
    itemContainer.className = 'hierarchy-item';

    const moduleDef = instanceNode.moduleDefinition;
    
    // Store file information in data attributes
    if (moduleDef.filePath) {
        itemContainer.setAttribute('data-filepath', moduleDef.filePath);
        if (moduleDef.lineNumber) {
            itemContainer.setAttribute('data-linenumber', moduleDef.lineNumber);
        }
    }

    const itemElement = document.createElement('div');
    itemElement.className = 'hierarchy-item-content';
    
    const hasChildren = moduleDef.children && moduleDef.children.length > 0;

    if (hasChildren) {
        const toggle = document.createElement('span');
        toggle.className = `hierarchy-toggle ${isExpanded ? 'expanded' : ''}`;
        toggle.innerHTML = '<i class="fa-solid fa-caret-right"></i>';
        toggle.addEventListener('click', e => { 
            e.stopPropagation(); 
            this.toggleHierarchyItem(itemContainer); 
        });
        itemElement.appendChild(toggle);
    } else {
        itemElement.appendChild(document.createElement('span')).className = 'hierarchy-spacer';
    }

    itemElement.appendChild(document.createElement('span')).className = 'hierarchy-icon';
    itemElement.querySelector('.hierarchy-icon').innerHTML = `<i class="${icon}"></i>`;

    const label = document.createElement('span');
    label.className = 'hierarchy-label';
    label.textContent = instanceNode.instanceName === moduleDef.name 
        ? moduleDef.name 
        : `${instanceNode.instanceName} (${moduleDef.name})`;
    itemElement.appendChild(label);

    itemContainer.appendChild(itemElement);
    itemContainer.appendChild(document.createElement('div')).className = 
        `hierarchy-children ${isExpanded ? 'expanded' : 'collapsed'}`;

    // Add click handler to open file with filename-only tooltip
    if (moduleDef.filePath) {
        itemElement.style.cursor = 'pointer';
        
        // Extract just the filename for the tooltip
        const fileName = moduleDef.filePath.split(/[\\/]/).pop();
        itemElement.title = `Click to open ${fileName}`;
        
        itemElement.addEventListener('click', async (e) => {
            // Don't trigger if clicking on toggle
            if (e.target.closest('.hierarchy-toggle')) return;
            
            const filePath = itemContainer.getAttribute('data-filepath');
            const lineNumber = itemContainer.getAttribute('data-linenumber');
            
            if (filePath) {
                await this.constructor.openModuleFile(
                    filePath, 
                    lineNumber ? parseInt(lineNumber, 10) : null
                );
            }
        });
    }
    
    return itemContainer;
}

    toggleHierarchyItem(itemElement) {
        const toggle = itemElement.querySelector('.hierarchy-toggle');
        const children = itemElement.querySelector('.hierarchy-children');
        if (!toggle || !children) return;

        const isExpanded = children.classList.contains('expanded');
        children.classList.toggle('expanded', !isExpanded);
        children.classList.toggle('collapsed', isExpanded);
        toggle.classList.toggle('expanded', !isExpanded);
    }

    // --- FIM DO BLOCO CORRIGIDO ---


    // ... (resto das suas funções como loadConfig, iverilogCompilation, etc.)
    // Elas não precisam ser alteradas.
    // Omiti o resto das suas funções para manter a resposta focada no problema,
    // mas elas devem permanecer no seu arquivo.


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
            const macrosPath = await window.electronAPI.joinPath('saphoComponents', 'Macros');

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

            cmd = `"${asmCompPath}" "${asmPath}" "${projectPath}" "${hdlPath}" "${macrosPath}" "${tempPath}" ${clk || 0} ${numClocks || 0} ${projectParam}`;
            this.terminalManager.appendToTerminal('tasm', `Executing ASM Compiler: ${cmd}`);

            const asmResult = await window.electronAPI.execCommand(cmd);

            this.terminalManager.processExecutableOutput('tasm', asmResult);
            

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
    this.terminalManager.appendToTerminal('tveri', 'Starting Icarus Verilog verification for project...');
    statusUpdater.startCompilation('verilog');

    try {
        if (!this.projectConfig) {
            throw new Error("Project configuration not loaded");
        }

        const tempBaseDir = await window.electronAPI.joinPath('saphoComponents', 'Temp');
        const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'iverilog.exe');
        const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');

        const testbenchFile = this.projectConfig.testbenchFile;
        if (!testbenchFile) {
            throw new Error("No testbench file specified");
        }

        const tbFileName = testbenchFile.split(/[\/\\]/).pop();
        const tbModule = tbFileName.replace(/\.v$/i, '');

        const synthesizableFiles = this.projectConfig.synthesizableFiles || [];
        if (!synthesizableFiles.length) {
            throw new Error("No synthesizable files defined");
        }

        const synthesizableFilePaths = synthesizableFiles.map(f => `"${f.path}"`).join(' ');
        const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
        const verilogFilesString = verilogFiles.map(f => `"${hdlPath}\\${f}"`).join(' ');
        const flags = this.projectConfig.iverilogFlags || "";

        await TabManager.saveAllFiles();

        const projectName = this.projectPath.split(/[\/\\]/).pop();
        const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, `${projectName}.vvp`);

        const cmd = `cd "${tempBaseDir}" && "${iveriCompPath}" ${flags} -s ${tbModule} -o "${outputFilePath}" ${synthesizableFilePaths} ${verilogFilesString} "${testbenchFile}"`;
        this.terminalManager.appendToTerminal('tveri', `Executing: ${cmd}`);

        const result = await window.electronAPI.execCommand(cmd);
        this.terminalManager.processExecutableOutput('tveri', result);

        if (result.code !== 0) {
            statusUpdater.compilationError('verilog', `Icarus Verilog failed with code ${result.code}`);
            throw new Error(`Icarus Verilog verification failed`);
        }

        // FIXED: Use 'proc' instead of 'processor'
        const procList = this.projectConfig.processors || [];
        for (const proc of procList) {
            const tempProcDir = await window.electronAPI.joinPath(tempBaseDir, proc.type);
            const tbFile = await window.electronAPI.joinPath(tempProcDir, `${proc.type}_tb.v`);
            const destDir = await window.electronAPI.joinPath(this.projectPath, proc.type, 'Simulation');
            const destFile = await window.electronAPI.joinPath(destDir, `${proc.type}_tb.v`);
            
            try {
                const tbExists = await window.electronAPI.fileExists(tbFile);
                if (tbExists) {
                    await window.electronAPI.copyFile(tbFile, destFile);
                    this.terminalManager.appendToTerminal('tveri', 
                        `Copied testbench for ${proc.type} to Simulation folder`);
                    // FIXED: Use 'proc' instead of 'processor'
                    await this.generateHierarchyAfterCompilation(proc);
                }
            } catch (copyError) {
                this.terminalManager.appendToTerminal('tveri', 
                    `Warning: Could not copy testbench for ${proc.type}: ${copyError.message}`, 'warning');
            }
        }

        this.terminalManager.appendToTerminal('tveri', 'Sucesso: project verification completed', 'success');
        statusUpdater.compilationSuccess('verilog');

        await this.generateProjectHierarchy();
        await this.switchToHierarchicalView();

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', `Error: ${error.message}`, 'error');
        statusUpdater.compilationError('verilog', error.message);
        throw error;
    }
}


   setupHierarchyToggle() {
    const toggleButton = document.getElementById('hierarchy-tree-toggle');
    if (!toggleButton) {
        console.warn('Hierarchy toggle button not found');
        return;
    }

    // Store reference to this module in TreeViewState
    TreeViewState.setCompilationModule(this);
    
    // Start disabled
    TreeViewState.disableToggle();
    
    toggleButton.addEventListener('click', () => {
        if (toggleButton.disabled || toggleButton.dataset.switching === 'true') {
            console.log('Toggle disabled or switching in progress');
            return;
        }
        
        // Check if hierarchy data exists when trying to switch to hierarchical
        if (!TreeViewState.isHierarchical && !this.hierarchyData) {
            console.warn('Cannot switch to hierarchical view - no data');
            this.terminalManager.appendToTerminal('tveri', 
                'Please compile Verilog first to generate hierarchy', 'warning');
            return;
        }

        toggleButton.dataset.switching = 'true';

        try {
            if (TreeViewState.isHierarchical) {
                this.switchToStandardView();
            } else {
                this.switchToHierarchicalView();
            }
        } catch (error) {
            console.error('Error toggling hierarchy view:', error);
            this.terminalManager.appendToTerminal('tveri', 
                `Error switching view: ${error.message}`, 'error');
        } finally {
            setTimeout(() => {
                toggleButton.dataset.switching = 'false';
            }, 300);
        }
    });
}

switchToStandardView() {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree) return;
    
    // Fade out
    fileTree.style.transition = 'opacity 0.2s ease';
    fileTree.style.opacity = '0';
    
    setTimeout(() => {
        // Clear hierarchy
        fileTree.innerHTML = '';
        fileTree.classList.remove('hierarchy-view');
        
        // Update state BEFORE refresh
        TreeViewState.setHierarchical(false);
        
        // Trigger standard tree refresh
        refreshFileTree();
        
        // Fade in happens in refreshFileTree
        
        this.terminalManager.appendToTerminal('tveri', 
            'Switched to standard file tree', 'info');
    }, 200);
}

async generateHierarchyAfterCompilation(processor = null) {
    try {
        // Check if hierarchy already generated in this compilation cycle
        if (this._hierarchyGenerationInProgress) {
            console.log('Hierarchy generation already in progress, skipping duplicate call');
            return true;
        }
        
        this._hierarchyGenerationInProgress = true;
        let success = false;
        
        if (this.isProjectOriented) {
            success = await this.generateProjectHierarchy();
        } else if (processor) {
            success = await this.generateProcessorHierarchy(processor);
        }
        
        if (success) {
            this.hierarchyGenerated = true;
            TreeViewState.hierarchyData = this.hierarchyData;
            
            // Only enable toggle once
            if (!TreeViewState.isToggleEnabled) {
                TreeViewState.enableToggle();
                TreeViewState.isToggleEnabled = true;
            }
            
            // Auto-switch to hierarchical view
            await this.switchToHierarchicalView();
        }
        
        return success;
    } catch (error) {
        console.error('Error generating hierarchy:', error);
        return false;
    } finally {
        this._hierarchyGenerationInProgress = false;
    }
}


    // Updated iverilogCompilation method for processor mode
      async iverilogCompilation(processor) {
        if (this.isProjectOriented) {
            return this.iverilogProjectCompilation();
        }

        const { name } = processor;
        this.terminalManager.appendToTerminal('tveri', `Starting Icarus Verilog compilation for ${name}...`);
        statusUpdater.startCompilation('verilog');

        try {
            // ... (keep existing iverilog compilation code)
            const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
            const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
            const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
            const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'iverilog.exe');

            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
            const { tbModule, tbFile } = await this.getTestbenchInfo(processor, cmmBaseName);

            const flags = this.config.iverilogFlags ? this.config.iverilogFlags.join(' ') : '';
            const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
            const verilogFilesString = verilogFiles.map(f => `"${hdlPath}\\${f}"`).join(' ');

            await TabManager.saveAllFiles();

            const outputFile = await window.electronAPI.joinPath(tempPath, `${cmmBaseName}.vvp`);
            const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}.v`);

            const cmd = `"${iveriCompPath}" ${flags} -s ${tbModule} -o "${outputFile}" "${tbFile}" "${hardwareFile}" ${verilogFilesString}`;
            this.terminalManager.appendToTerminal('tveri', `Executing: ${cmd}`);

            const result = await window.electronAPI.execCommand(cmd);
            this.terminalManager.processExecutableOutput('tveri', result);

            if (result.code !== 0) {
                statusUpdater.compilationError('verilog', `Icarus Verilog failed with code ${result.code}`);
                throw new Error(`Icarus Verilog compilation failed`);
            }

            // Copy memory files
            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_data.mif`),
                await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_data.mif`)
            );
            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_inst.mif`),
                await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_inst.mif`)
            );

            this.terminalManager.appendToTerminal('tveri', 'Verilog compilation completed', 'success');
            statusUpdater.compilationSuccess('verilog');
            await this.generateHierarchyAfterCompilation(processor);
            // NEW: Generate hierarchy after successful compilation
        const hierarchyGenerated = await this.generateProcessorHierarchy(processor);
        if (hierarchyGenerated) {
            this.hierarchyGenerated = true;
            this.enableHierarchyToggle();
            await this.switchToHierarchicalView();
        }
                    

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
    }
  };

  window.electronAPI.onCommandOutputStream(outputListener);

  try {
    cardContent.push('Starting optimized VVP execution...');
    this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'running');

    const systemInfo = await window.electronAPI.getSystemPerformance();
    cardContent.push(`System: ${systemInfo.cpuCount} cores, ${systemInfo.totalMemory}GB RAM, ${systemInfo.freeMemory}GB free`);
    this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'running');
    
    // Enhanced VVP command without FST dumper for stability
    const enhancedCommand = command.replace(/\s*-fst\s*/g, ' ');
    const vvpResult = await window.electronAPI.execVvpOptimized(enhancedCommand, workingDir);
    
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

getCompilationMode() {
    const stored = localStorage.getItem('aurora-settings');
    if (stored) {
        const settings = JSON.parse(stored);
        return settings.parallelCompilation !== false; // Default to true
    }
    return true; // Default to parallel mode
}

/**
 * Wait for VCD file to be fully generated (100% progress)
 */
async waitForVcdCompletion(tempPath, maxWaitMs = 600000) {
    const progressFile = await window.electronAPI.joinPath(tempPath, 'progress.txt');
    const startTime = Date.now();
    
    this.terminalManager.appendToTerminal('twave', 
        'Waiting for VCD generation to complete...', 'info');
    
    return new Promise((resolve, reject) => {
        const checkProgress = async () => {
            try {
                // Check if we've exceeded max wait time
                if (Date.now() - startTime > maxWaitMs) {
                    reject(new Error('VCD generation timeout'));
                    return;
                }
                
                // Check if progress file exists
                const exists = await window.electronAPI.fileExists(progressFile);
                if (!exists) {
                    setTimeout(checkProgress, 500);
                    return;
                }
                
                // Read progress
                const content = await window.electronAPI.readFile(progressFile, { encoding: 'utf8' });
                const lines = content.trim().split('\n');
                const lastProgress = lines[lines.length - 1];
                const progress = parseInt(lastProgress, 10);
                
                if (progress >= 100) {
                    this.terminalManager.appendToTerminal('twave', 
                        'VCD generation complete (100%)', 'success');
                    resolve();
                } else {
                    setTimeout(checkProgress, 500);
                }
            } catch (error) {
                setTimeout(checkProgress, 500);
            }
        };
        
        checkProgress();
    });
}

/**
 * Launch GTKWave after VCD is complete
 */
async launchGtkwaveSequential(gtkwCmd, workingDir) {
    this.terminalManager.appendToTerminal('twave', 
        'Launching GTKWave with complete VCD file...', 'info');
    
    const gtkwaveOutputHandler = (event, payload) => {
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
    
    try {
        const result = await window.electronAPI.launchGtkwaveOnly({
            gtkwCmd: gtkwCmd,
            workingDir: workingDir
        });
        
        if (result.success) {
            this.gtkwaveProcess = result.gtkwavePid;
            this.terminalManager.appendToTerminal('twave', 
                'GTKWave launched successfully', 'success');
            this.monitorGtkwaveProcess();
            return result;
        } else {
            throw new Error(`Failed to launch GTKWave: ${result.message}`);
        }
    } finally {
        window.electronAPI.removeGtkwaveOutputListener(gtkwaveOutputHandler);
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
    
    const isParallelMode = this.getCompilationMode();
    
    let testbenchBackupInfo = null;
    let gtkwaveOutputHandler = null;

    try {
        // Setup paths
        const tempPath = await window.electronAPI.joinPath('saphoComponents', 'Temp', name);
        const hdlPath = await window.electronAPI.joinPath('saphoComponents', 'HDL');
        const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
        const simulationPath = await window.electronAPI.joinPath(this.projectPath, name, 'Simulation');
        const scriptsPath = await window.electronAPI.joinPath('saphoComponents', 'Scripts');
        const iveriCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'iverilog.exe');
        const vvpCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'bin', 'vvp.exe');
        const gtkwCompPath = await window.electronAPI.joinPath('saphoComponents', 'Packages', 'iverilog', 'gtkwave', 'bin', 'gtkwave.exe');
        const binPath = await window.electronAPI.joinPath('saphoComponents', 'bin');
        
        const selectedCmmFile = await this.getSelectedCmmFile(processor);
        const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
        const { tbModule, tbFile } = await this.getTestbenchInfo(processor, cmmBaseName);

        // Modify testbench if needed
        if (processor.testbenchFile && processor.testbenchFile !== 'standard') {
            const simuDelay = this.getSimulationDelay(processor);
            testbenchBackupInfo = await this.modifyTestbenchForSimulation(tbFile, tbModule, tempPath, simuDelay);
        }

        // Create TCL info file
        const tclFilePath = await window.electronAPI.joinPath(tempPath, 'tcl_infos.txt');
        const tclContent = `${tempPath}\n${binPath}\n`;
        await window.electronAPI.writeFile(tclFilePath, tclContent);

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
        await window.electronAPI.copyFile(
            await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_data.mif`),
            await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_data.mif`)
        );
        await window.electronAPI.copyFile(
            await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_inst.mif`),
            await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_inst.mif`)
        );

        // Setup VCD and commands
        const vcdPath = await window.electronAPI.joinPath(tempPath, `${tbModule}.vcd`);
        await window.electronAPI.deleteFileOrDirectory(vcdPath);

        const vvpCmd = `"${vvpCompPath}" "${cmmBaseName}.vvp"`;
        
        // Build GTKWave command
        const useStandardGtkw = !processor.gtkwFile || processor.gtkwFile === 'standard';
        let gtkwCmd;
        
        if (useStandardGtkw) {
            const scriptPath = await window.electronAPI.joinPath(scriptsPath, 'gtk_proc_init.tcl');
            gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --fastload --dark "${vcdPath}" --script=${scriptPath}`;
        } else {
            const gtkwPath = await window.electronAPI.joinPath(simulationPath, processor.gtkwFile);
            const posScript = await window.electronAPI.joinPath(scriptsPath, 'pos_gtkw.tcl');
            gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --fastload --dark "${gtkwPath}" --script=${posScript}`;
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
        await showVVPProgress(String(name));
        
        // Launch simulation based on mode
        const simulationMethod = isParallelMode ? 'launchParallelSimulation' : 'launchSerialSimulation';
        this.terminalManager.appendToTerminal('twave', 
            `Starting ${isParallelMode ? 'parallel' : 'serial'} simulation...`, 'info');

        const result = await window.electronAPI[simulationMethod]({
            vvpCmd: vvpCmd,
            gtkwCmd: gtkwCmd,
            vcdPath: vcdPath,
            workingDir: tempPath
        });

        hideVVPProgress();

        if (result.success) {
            this.gtkwaveProcess = result.gtkwavePid;
            this.terminalManager.appendToTerminal('twave', 
                `GTKWave launched successfully (${isParallelMode ? 'parallel' : 'serial'} mode)`, 'success');
            this.monitorGtkwaveProcess();
        } else {
            throw new Error(`Failed to launch simulation: ${result.message}`);
        }

        statusUpdater.compilationSuccess('wave');

    } catch (error) {
        hideVVPProgress();
        this.terminalManager.appendToTerminal('twave', `Error: ${error.message}`, 'error');
        statusUpdater.compilationError('wave', error.message);
        throw error;
        
    } finally {
        if (gtkwaveOutputHandler) {
            window.electronAPI.removeGtkwaveOutputListener(gtkwaveOutputHandler);
        }
        if (testbenchBackupInfo) {
            await window.electronAPI.restoreOriginalTestbench(testbenchBackupInfo.originalPath, testbenchBackupInfo.backupPath);
        }
    }
}

/**
 * Run project GTKWave with serial/parallel mode support
 */
/**
 * Run project GTKWave with serial/parallel mode support - FIXED
 */
async runProjectGtkWave() {
    this.terminalManager.appendToTerminal('twave', 'Starting GTKWave for project...');
    statusUpdater.startCompilation('wave');
    
    const isParallelMode = this.getCompilationMode();
    let testbenchBackupInfo = null;
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
        const binPath = await window.electronAPI.joinPath('saphoComponents', 'bin');

        const testbenchFile = this.projectConfig.testbenchFile;
        if (!testbenchFile) throw new Error("No testbench file specified");
        
        const testbenchFileName = testbenchFile.split(/[\/\\]/).pop();
        const tbModule = testbenchFileName.replace(/\.v$/i, '');
        
        // CRITICAL FIX: Copy testbench to temp directory for VVP execution
        const testbenchInTemp = await window.electronAPI.joinPath(tempBaseDir, testbenchFileName);
        await window.electronAPI.copyFile(testbenchFile, testbenchInTemp);
        this.terminalManager.appendToTerminal('twave', `Copied testbench to temp directory: ${testbenchFileName}`);
        
        const simuDelay = this.getSimulationDelay();
        
        // Modify testbench IN THE TEMP DIRECTORY
        testbenchBackupInfo = await this.modifyTestbenchForSimulation(
            testbenchInTemp, // Use the temp copy, not original
            tbModule, 
            tempBaseDir, 
            simuDelay
        );
        
        // Compile with Icarus Verilog (using temp testbench)
        const synthesizableFilePaths = (this.projectConfig.synthesizableFiles || [])
            .map(file => `"${file.path}"`)
            .join(' ');
        const verilogFilesString = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v']
            .map(f => `"${hdlPath}\\${f}"`)
            .join(' ');
        
        await TabManager.saveAllFiles();
        const projectName = this.projectPath.split(/[\/\\]/).pop();
        const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, `${projectName}.vvp`);
        
        // CRITICAL: Use testbench from temp directory
        const iverilogCmd = `cd "${tempBaseDir}" && "${iveriCompPath}" ${this.projectConfig.iverilogFlags || ""} -s ${tbModule} -o "${outputFilePath}" ${synthesizableFilePaths} ${verilogFilesString} "${testbenchInTemp}"`;
        
        const iverilogResult = await window.electronAPI.execCommand(iverilogCmd);
        this.terminalManager.processExecutableOutput('twave', iverilogResult);
        
        if (iverilogResult.code !== 0) {
            throw new Error('Icarus Verilog compilation failed');
        }

        // Copy necessary files for simulation
        this.terminalManager.appendToTerminal('twave', 'Copying necessary files for simulation...');
        const topLevelPath = await window.electronAPI.joinPath(this.projectPath, 'TopLevel');

        // Copy all necessary input data files from TopLevel (non-Verilog files)
this.terminalManager.appendToTerminal('twave', `Copying input data from: ${topLevelPath}`);
try {
    const topLevelFiles = await window.electronAPI.readDir(topLevelPath);
    
    // Filtra para copiar QUALQUER arquivo que NÃO seja .v ou .vh
    const dataFiles = topLevelFiles.filter(file => 
        !file.toLowerCase().endsWith('.v') && !file.toLowerCase().endsWith('.vh')
    );

    if (dataFiles.length === 0) {
        this.terminalManager.appendToTerminal('twave', 
            'No data files (non-Verilog) found in TopLevel to copy.', 'info');
    } else {
        for (const dataFile of dataFiles) {
            try {
                const srcPath = await window.electronAPI.joinPath(topLevelPath, dataFile);
                const destPath = await window.electronAPI.joinPath(tempBaseDir, dataFile);
                await window.electronAPI.copyFile(srcPath, destPath);
                this.terminalManager.appendToTerminal('twave', `Copied data file: ${dataFile}`, 'success');
            } catch (copyError) {
                this.terminalManager.appendToTerminal('twave', 
                    `Warning: Could not copy ${dataFile}: ${copyError.message}`, 'warning');
            }
        }
    }
} catch (readError) {
    this.terminalManager.appendToTerminal('twave', 
        `Warning: Could not read TopLevel directory: ${readError.message}`, 'warning');
}
        
        // Copy ALL .txt files from TopLevel (input data for testbench)
        try {
            const topLevelFiles = await window.electronAPI.readDir(topLevelPath);
            const txtFiles = topLevelFiles.filter(file => file.toLowerCase().endsWith('.txt'));
            
            for (const txtFile of txtFiles) {
                try {
                    const srcPath = await window.electronAPI.joinPath(topLevelPath, txtFile);
                    const destPath = await window.electronAPI.joinPath(tempBaseDir, txtFile);
                    await window.electronAPI.copyFile(srcPath, destPath);
                    this.terminalManager.appendToTerminal('twave', `Copied ${txtFile} from TopLevel`);
                } catch (error) {
                    this.terminalManager.appendToTerminal('twave', 
                        `Warning: Could not copy ${txtFile}: ${error.message}`, 'warning');
                }
            }
        } catch (error) {
            this.terminalManager.appendToTerminal('twave', 
                `Warning: Could not read TopLevel directory: ${error.message}`, 'warning');
        }

        // Copy processor files (.mif and pc_*_mem.txt)
        const procList = this.projectConfig.processors || [];
        for (const proc of procList) {
            try {
                // Copy _inst.mif
                const instMifSrc = await window.electronAPI.joinPath(
                    this.projectPath, proc.type, 'Hardware', `${proc.type}_inst.mif`
                );
                const instMifDest = await window.electronAPI.joinPath(tempBaseDir, `${proc.type}_inst.mif`);
                await window.electronAPI.copyFile(instMifSrc, instMifDest);
                
                // Copy _data.mif
                const dataMifSrc = await window.electronAPI.joinPath(
                    this.projectPath, proc.type, 'Hardware', `${proc.type}_data.mif`
                );
                const dataMifDest = await window.electronAPI.joinPath(tempBaseDir, `${proc.type}_data.mif`);
                await window.electronAPI.copyFile(dataMifSrc, dataMifDest);
                
                // Copy pc_*_mem.txt from processor temp directory
                const pcMemSrc = await window.electronAPI.joinPath(
                    tempBaseDir, proc.type, `pc_${proc.type}_mem.txt`
                );
                const pcMemDest = await window.electronAPI.joinPath(tempBaseDir, `pc_${proc.type}_mem.txt`);
                
                if (await window.electronAPI.fileExists(pcMemSrc)) {
                    await window.electronAPI.copyFile(pcMemSrc, pcMemDest);
                    this.terminalManager.appendToTerminal('twave', `Copied pc_${proc.type}_mem.txt`);
                }
            } catch (error) {
                this.terminalManager.appendToTerminal('twave', 
                    `Warning: Error copying files for ${proc.type}: ${error.message}`, 'warning');
            }
        }

        // Create TCL info file
        const instances = procList.map(p => p.instance).join(' ');
        const processors = procList.map(p => p.type).join(' ');
        const tclContent = `${instances}\n${processors}\n${tempBaseDir}\n${binPath}\n${scriptsPath}\n`;
        await window.electronAPI.writeFile(
            await window.electronAPI.joinPath(tempBaseDir, 'tcl_infos.txt'), 
            tclContent
        );

        // Copy fix.vcd script
        await window.electronAPI.copyFile(
            await window.electronAPI.joinPath(scriptsPath, 'fix.vcd'),
            await window.electronAPI.joinPath(tempBaseDir, 'fix.vcd')
        );

        // Setup VCD and commands
        const vcdPath = await window.electronAPI.joinPath(tempBaseDir, `${tbModule}.vcd`);
        await window.electronAPI.deleteFileOrDirectory(vcdPath);

        // CRITICAL: VVP command runs in tempBaseDir where all files are located
        const vvpCmd = `"${vvpCompPath}" "${projectName}.vvp"`;
        
        // Build GTKWave command
        const gtkwaveFile = this.projectConfig.gtkwaveFile;
        let gtkwCmd;
        if (gtkwaveFile && gtkwaveFile !== "Standard") {
            const posScript = await window.electronAPI.joinPath(scriptsPath, 'pos_gtkw.tcl');
            gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --fastload --dark "${gtkwaveFile}" --script=${posScript}`;
        } else {
            const initScript = await window.electronAPI.joinPath(scriptsPath, 'gtk_proj_init.tcl');
            gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --fastload --dark "${vcdPath}" --script=${initScript}`;
        }

        // Setup output handler
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
        await showVVPProgress(projectName);
        
        // Launch simulation
        const simulationMethod = isParallelMode ? 'launchParallelSimulation' : 'launchSerialSimulation';
        this.terminalManager.appendToTerminal('twave', 
            `Starting ${isParallelMode ? 'parallel' : 'serial'} simulation...`, 'info');

        const result = await window.electronAPI[simulationMethod]({
            vvpCmd: vvpCmd,
            gtkwCmd: gtkwCmd,
            vcdPath: vcdPath,
            workingDir: tempBaseDir // CRITICAL: Working directory must be tempBaseDir
        });

        hideVVPProgress();

        if (result.success) {
            this.gtkwaveProcess = result.gtkwavePid;
            this.terminalManager.appendToTerminal('twave',
                `GTKWave launched successfully (${isParallelMode ? 'parallel' : 'serial'} mode)`, 'success');
            this.monitorGtkwaveProcess();
        } else {
            throw new Error(`Failed to launch simulation: ${result.message}`);
        }

        statusUpdater.compilationSuccess('wave');

    } catch (error) {
        hideVVPProgress();
        this.terminalManager.appendToTerminal('twave', `Error: ${error.message}`, 'error');
        statusUpdater.compilationError('wave', error.message);
        throw error;
        
    } finally {
        if (gtkwaveOutputHandler) {
            window.electronAPI.removeGtkwaveOutputListener(gtkwaveOutputHandler);
        }
        // CRITICAL FIX: Don't restore original testbench since we modified the temp copy
        // The original testbench file remains unchanged
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
        let cleanName = moduleName;

        // Handle $paramod patterns
        if (cleanName.startsWith('$paramod')) {
            if (cleanName.includes('\\\\')) {
                const parts = cleanName.split('\\\\');
                if (parts.length >= 2) {
                    cleanName = parts[1];
                    if (cleanName.includes('\\')) {
                        cleanName = cleanName.split('\\')[0];
                    }
                }
            } else if (cleanName.includes('\\')) {
                const parts = cleanName.split('\\');
                if (parts.length >= 2) {
                    cleanName = parts[1];
                }
            }
        }

        // Remove hash patterns
        cleanName = cleanName.replace(/\$[a-f0-9]{40,}/g, '');
        cleanName = cleanName.replace(/\\[A-Z_]+=.*$/g, '');
        cleanName = cleanName.replace(/^[\\\$]+/, '');

        return cleanName;
    }

    // NEW: Store standard tree state before switching
    saveStandardTreeState() {
        const fileTree = document.getElementById('file-tree');
        if (fileTree) {
            this.standardTreeState = fileTree.innerHTML;
        }
    }

    // NEW: Restore standard tree state
  // Modify this method to properly restore the file tree
restoreStandardTreeState() {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree) return;
    
    this.isHierarchicalView = false;
    
    // Clear hierarchical view
    fileTree.innerHTML = '';
    
    // Trigger file tree refresh
    if (typeof refreshFileTree === 'function') {
        refreshFileTree();
    }
}

switchToHierarchicalView() {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree) {
        console.warn('File tree element not found');
        return;
    }
    
    // Check if hierarchy data exists
    if (!this.hierarchyData) {
        console.warn('No hierarchy data available');
        this.terminalManager.appendToTerminal('tveri', 
            'No hierarchy data available. Please compile Verilog first.', 'warning');
        return;
    }
    
    // Fade out
    fileTree.style.transition = 'opacity 0.2s ease';
    fileTree.style.opacity = '0';
    
    setTimeout(() => {
        // Clear and switch mode
        fileTree.innerHTML = '';
        fileTree.classList.add('hierarchy-view');
        
        // Render hierarchy
        this.renderHierarchicalTree();
        
        // Update state
        TreeViewState.setHierarchical(true);
        
        // Fade in
        fileTree.style.opacity = '1';
        
        this.terminalManager.appendToTerminal('tveri', 
            'Switched to hierarchical module view', 'info');
    }, 200);
}
// Modify this method to enable the toggle button
    enableHierarchyToggle() {
        // CORRIGIDO: Use o ID correto do HTML
        const toggleButton = document.getElementById('hierarchy-tree-toggle');
        if (!toggleButton) return;
        
        toggleButton.classList.remove('disabled');
        toggleButton.title = 'Alternar entre visão hierárquica e padrão';
        
        this.terminalManager.appendToTerminal('tveri', 
            'Hierarchical view is now available', 'success');
    }

    // NEW: Update toggle button state
      updateToggleButton(isHierarchical) {
        // CORRIGIDO: Use o ID correto do HTML
        const toggleButton = document.getElementById('hierarchy-tree-toggle');
        if (!toggleButton) return;

        const icon = toggleButton.querySelector('i');
        const text = toggleButton.querySelector('.toggle-text');
        
        if (isHierarchical) {
            // Mostrando visão hierárquica - o botão alterna para a padrão
            icon.className = 'fa-solid fa-list-ul';
            text.textContent = 'Standard';
            toggleButton.classList.add('active');
            toggleButton.title = 'Switch to the default file tree';
        } else {
            // Mostrando visão padrão - o botão alterna para a hierárquica
            icon.className = 'fa-solid fa-sitemap';
            text.textContent = 'Hierarchical';
            toggleButton.classList.remove('active');
            toggleButton.title = 'Switch to the hierarchical modules view';
        }
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
    if (window.compilationModule) {
        const compilationModule = new CompilationModule(projectPath);
compilationModule.setupHierarchyToggle();
        
        
    }
    console.log('Hierarchical tree system initialized with GTKWave monitoring');

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

// Initialize the system
document.addEventListener('DOMContentLoaded', () => {
    // Replace existing compilation module with extended version
    if (window.compilationModule) {
        const oldPath = window.compilationModule.projectPath;
        window.compilationModule = new CompilationModuleExtended(oldPath);
        window.compilationModule.setupHierarchyToggle();
    }
    
    console.log('Hierarchical tree system initialized');
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

        this.messageCounts = {};
        Object.keys(this.terminals).forEach(id => {
            this.messageCounts[id] = {
                error: 0,
                warning: 0,
                success: 0,
                tips: 0
            };
        });

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
        
        // Verbose mode - defaults to true (show all messages)
        this.verboseMode = this.loadVerboseMode();
        this.setupVerboseToggle();
        this.createCounterBadges();
        this.updateCounterDisplay();
    }

    // Load verbose mode from localStorage
    loadVerboseMode() {
        const saved = localStorage.getItem('terminal-verbose-mode');
        return saved !== null ? JSON.parse(saved) : true;
    }

      createCounterBadges() {
        const filterButtons = {
            error: document.getElementById('filter-error'),
            warning: document.getElementById('filter-warning'),
            success: document.getElementById('filter-success'),
            tips: document.getElementById('filter-tip')
        };

        Object.entries(filterButtons).forEach(([type, button]) => {
            if (button && !button.querySelector('.message-counter')) {
                const badge = document.createElement('span');
                badge.className = `message-counter counter-${type}`;
                badge.textContent = '0';
                badge.style.cssText = `
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    background: var(--${type === 'tips' ? 'info' : type});
                    color: white;
                    border-radius: 50%;
                    min-width: 18px;
                    height: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: bold;
                    padding: 2px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    transition: all 0.2s ease;
                    pointer-events: none;
                `;
                button.style.position = 'relative';
                button.appendChild(badge);
            }
        });
    }

    updateCounterDisplay() {
        const activeTab = document.querySelector('.terminal-tabs .tab.active');
        if (!activeTab) return;

        const terminalId = activeTab.getAttribute('data-terminal');
        const counts = this.messageCounts[terminalId] || { error: 0, warning: 0, success: 0, tips: 0 };

        const updateBadge = (type, count) => {
            // CORREÇÃO: Usa o ID correto 'filter-tip' quando o tipo for 'tips'.
            const buttonId = type === 'tips' ? 'filter-tip' : `filter-${type}`;
            const button = document.getElementById(buttonId);
            
            if (button) {
                const badge = button.querySelector('.message-counter');
                if (badge) {
                    const oldCount = parseInt(badge.textContent, 10) || 0;
                    badge.textContent = count;
                    badge.style.display = count > 0 ? 'flex' : 'none';
                    
                    // Aciona a animação de pulso apenas quando o contador aumenta.
                    if (count > oldCount) {
                        badge.classList.add('pulse');
                        setTimeout(() => {
                            badge.classList.remove('pulse');
                        }, 300); // A duração deve corresponder à animação CSS.
                    }
                }
            }
        };

        updateBadge('error', counts.error);
        updateBadge('warning', counts.warning);
        updateBadge('success', counts.success);
        updateBadge('tips', counts.tips);
    }

    incrementMessageCount(terminalId, type) {
        if (this.messageCounts[terminalId] && this.messageCounts[terminalId][type] !== undefined) {
            this.messageCounts[terminalId][type]++;
            this.updateCounterDisplay();
        }
    }

    resetMessageCounts(terminalId) {
        if (this.messageCounts[terminalId]) {
            this.messageCounts[terminalId] = {
                error: 0,
                warning: 0,
                success: 0,
                tips: 0
            };
            this.updateCounterDisplay();
        }
    }

    recountMessages(terminalId) {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        // Reset counts
        this.messageCounts[terminalId] = {
            error: 0,
            warning: 0,
            success: 0,
            tips: 0
        };

        // Count all visible messages
        const entries = terminal.querySelectorAll('.log-entry');
        entries.forEach(entry => {
            if (entry.classList.contains('error')) {
                this.messageCounts[terminalId].error++;
            } else if (entry.classList.contains('warning')) {
                this.messageCounts[terminalId].warning++;
            } else if (entry.classList.contains('success')) {
                this.messageCounts[terminalId].success++;
            } else if (entry.classList.contains('tips') || entry.classList.contains('info')) {
                this.messageCounts[terminalId].tips++;
            }
        });

        this.updateCounterDisplay();
    }


    // Save verbose mode to localStorage
    saveVerboseMode() {
        localStorage.setItem('terminal-verbose-mode', JSON.stringify(this.verboseMode));
    }

    // Setup verbose toggle event listener
    setupVerboseToggle() {
        const verboseToggle = document.getElementById('verbose-toggle');
        if (verboseToggle) {
            verboseToggle.checked = this.verboseMode;
            verboseToggle.addEventListener('change', (e) => {
                this.verboseMode = e.target.checked;
                this.saveVerboseMode();
                this.applyFilterToAllTerminals();
            });
        }
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
        
        const contentHTML = lines.map(line => `<div>${line}</div>`).join('');

        if (!card) {
            card = document.createElement('div');
            card.classList.add('log-entry', type);
            
            card.innerHTML = `
                <span class="timestamp">[${timestamp}]</span>
                <div class="message-content">
                    <div class="message-lines">${contentHTML}</div>
                </div>
            `;
            
            terminal.appendChild(card);
            this.updatableCards[terminalId][cardId] = card;

            // Increment counter for new message
            if (['error', 'warning', 'success', 'tips'].includes(type)) {
                this.incrementMessageCount(terminalId, type);
            }

            card.style.opacity = '0';
            requestAnimationFrame(() => {
                card.style.transition = 'opacity 0.3s ease';
                card.style.opacity = '1';
            });

        } else {
            const messageContainer = card.querySelector('.message-lines');
            if (messageContainer) {
                messageContainer.innerHTML = contentHTML;
            }
        }
        
        card.setAttribute('data-status', status);
        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
        return card;
    }

    processExecutableOutput(terminalId, result) {
        const terminal = this.terminals[terminalId];
        if (!terminal || (!result.stdout && !result.stderr)) {
            return;
        }

        this.resetSessionCards(terminalId);

        const output = (result.stdout || '') + (result.stderr || '');
        const lines = output.split('\n').filter(line => line.trim());

        if (lines.length === 0) return;

        lines.forEach(line => {
            const messageType = this.detectMessageType(line);

            if (messageType && messageType !== 'plain') {
                this.addToSessionCard(terminalId, line.trim(), messageType);
            } else if (this.verboseMode) {
                // Only show plain messages in verbose mode
                const timestamp = new Date().toLocaleString('pt-BR', { hour12: false });
                this.createLogEntry(terminal, line.trim(), 'plain', timestamp);
            }
        });

        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
    }

    processStreamedLine(terminalId, line) {
        const terminal = this.terminals[terminalId];
        if (!terminal || !line) return;

        const messageType = this.detectMessageType(line);

        if (messageType && messageType !== 'plain') {
            this.addToSessionCard(terminalId, line, messageType);
        } else if (this.verboseMode) {
            // Only show plain messages in verbose mode
            const timestamp = new Date().toLocaleString('pt-BR', { hour12: false });
            this.createLogEntry(terminal, line, 'plain', timestamp);
        }

        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
    }

    appendToTerminal(terminalId, content, type = 'info') {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;
        
        let text = (typeof content === 'string') ? content : (content.stdout || '') + (content.stderr || '');
        if (!text.trim()) return;
        
        const lines = text.split('\n').filter(line => line.trim());
        
        lines.forEach(line => {
            const detectedType = this.detectMessageType(line);
            
            // Show message if it's not plain or if verbose mode is enabled
            if (detectedType !== 'plain' || this.verboseMode) {
                const timestamp = new Date().toLocaleString('pt-BR', { hour12: false });
                this.createLogEntry(terminal, line.trim(), type, timestamp);
            }
        });

        this.applyFilter(terminalId);
        this.scrollToBottom(terminalId);
    }

    applyFilter(terminalId) {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        const cards = terminal.querySelectorAll('.log-entry');
        const hasActiveFilters = this.activeFilters.size > 0;

        cards.forEach(card => {
            // Check if this message contains clickable line numbers FIRST
            const hasLineLinks = card.querySelector('.line-link') !== null;
            
            // Always show messages that contain line links, regardless of verbose mode
            if (hasLineLinks) {
                card.style.display = '';
                return;
            }
            
            // Now check verbose mode for plain messages WITHOUT line links
            if (!this.verboseMode && card.classList.contains('plain')) {
                card.style.display = 'none';
                return;
            }

            if (!hasActiveFilters) {
                // If no filters are active and verbose allows it, show the card
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

    // ... rest of the methods remain the same ...
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

                // Update counters when switching tabs
                this.updateCounterDisplay();
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

        // Recreate badges after replacing buttons
        this.createCounterBadges();

        buttons.error.addEventListener('click', () => this.toggleFilter('error', buttons.error));
        buttons.warning.addEventListener('click', () => this.toggleFilter('warning', buttons.warning));
        buttons.tips.addEventListener('click', () => this.toggleFilter('tips', buttons.tips));
        buttons.success.addEventListener('click', () => this.toggleFilter('success', buttons.success));
    }

    toggleFilter(filterType, clickedBtn) {
        if (this.activeFilters.has(filterType)) {
            this.activeFilters.delete(filterType);
            clickedBtn.classList.remove('active');
        } else {
            this.activeFilters.add(filterType);
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

    detectMessageType(content) {
        const text = typeof content === 'string' ?
            content :
            (content.stdout || '') + ' ' + (content.stderr || '');

        if (text.includes('Atenção') || text.includes('Warning')) return 'warning';
        if (text.includes('Erro') || text.includes('ERROR')) return 'error';
        if (text.includes('Sucesso') || text.includes('Success')) return 'success';
        if (text.includes('Info') || text.includes('Tip')) return 'tips';
        if (text.includes('não está sendo usada') || text.includes('Economize memória')) return 'tips';
        if (text.includes('de sintaxe') || text.includes('cadê a função')) return 'error';

        return 'plain';
    }

    makeLineNumbersClickable(text) {
        return text.replace(/\b(?:linha|line)\s+(\d+)/gi, (match, lineNumber) => {
            return `<span title="Opa. Bão?" class="line-link" data-line="${lineNumber}" ` +
                `style="cursor: pointer; text-decoration: none; filter: brightness(1.4);">` +
                `${match}</span>`;
        });
    }

    addToSessionCard(terminalId, text, type) {
        const terminal = this.terminals[terminalId];
        if (!terminal) return;

        let card = this.currentSessionCards[terminalId][type];

        if (!card) {
            const timestamp = new Date().toLocaleString('pt-BR', { hour12: false });
            card = this.createGroupedCard(terminal, type, timestamp);
            this.currentSessionCards[terminalId][type] = card;
            
            // Increment counter for new grouped card
            if (['error', 'warning', 'success', 'tips'].includes(type)) {
                this.incrementMessageCount(terminalId, type);
            }
        }

        this.addMessageToCard(card, text, type);
    }

    createGroupedCard(terminal, type, timestamp) {
        const logEntry = document.createElement('div');
        logEntry.classList.add('log-entry', type);

        const timestampElement = document.createElement('span');
        timestampElement.classList.add('timestamp');
        timestampElement.textContent = `[${timestamp}]`;

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        const messagesContainer = document.createElement('div');
        messagesContainer.classList.add('messages-container');

        messageContent.appendChild(messagesContainer);
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

        return logEntry;
    }

    addMessageToCard(card, text, type) {
        const messagesContainer = card.querySelector('.messages-container');
        if (!messagesContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.classList.add('grouped-message');
        messageDiv.style.marginBottom = '0.25rem';

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
                    let cmmFilePath = null;

                    if (window.compilationManager?.getCurrentProcessor) {
                        const currentProcessor = window.compilationManager.getCurrentProcessor();
                        if (currentProcessor) {
                            try {
                                const selectedCmmFile = await window.compilationManager.getSelectedCmmFile(currentProcessor);
                                if (selectedCmmFile) {
                                    const projectPath = window.compilationManager.projectPath;
                                    const softwarePath = await window.electronAPI.joinPath(projectPath, currentProcessor.name, 'Software');
                                    cmmFilePath = await window.electronAPI.joinPath(softwarePath, selectedCmmFile);
                                }
                            } catch (error) {
                                console.log('Error getting CMM file from compilation manager:', error);
                            }
                        }
                    }

                    if (!cmmFilePath) {
                        const terminalContent = card.closest('.terminal-content');
                        if (terminalContent) {
                            const logEntries = terminalContent.querySelectorAll('.log-entry');

                            for (const entry of Array.from(logEntries).reverse()) {
                                const entryText = entry.textContent || '';

                                const cmmCompMatch = entryText.match(/cmmcomp\.exe["\s]+([^\s"]+\.cmm)\s+([^\s"]+)\s+"([^"]+)"/);
                                if (cmmCompMatch) {
                                    const cmmFileName = cmmCompMatch[1];
                                    const processorName = cmmCompMatch[2];
                                    const projectPath = cmmCompMatch[3];

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

                    const fileExists = await window.electronAPI.fileExists(cmmFilePath);
                    if (!fileExists) {
                        console.log(`CMM file does not exist: ${cmmFilePath}`);
                        return;
                    }

                    const isFileOpen = TabManager.tabs.has(cmmFilePath);

                    if (!isFileOpen) {
                        const content = await window.electronAPI.readFile(cmmFilePath, {
                            encoding: 'utf8'
                        });
                        TabManager.addTab(cmmFilePath, content);
                    } else {
                        TabManager.activateTab(cmmFilePath);
                    }

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

    goToLine(lineNumber) {
        const activeEditor = EditorManager.activeEditor;
        if (!activeEditor) {
            console.warn('No active editor found');
            return;
        }

        const model = activeEditor.getModel();
        if (!model) {
            console.warn('No model found in active editor');
            return;
        }

        const totalLines = model.getLineCount();
        const targetLine = Math.max(1, Math.min(lineNumber, totalLines));

        activeEditor.setPosition({
            lineNumber: targetLine,
            column: 1
        });

        activeEditor.revealLineInCenter(targetLine);
        activeEditor.focus();

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

        // Add click event listeners for line links in individual log entries
        logEntry.appendChild(timestampElement);
        logEntry.appendChild(messageContent);
        terminal.appendChild(logEntry);

        // Setup line link click handlers
        const lineLinks = messageContent.querySelectorAll('.line-link');
        lineLinks.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineNumber = parseInt(link.getAttribute('data-line'));
                console.log(`Clicked on line ${lineNumber}`);

                try {
                    let cmmFilePath = null;

                    if (window.compilationManager?.getCurrentProcessor) {
                        const currentProcessor = window.compilationManager.getCurrentProcessor();
                        if (currentProcessor) {
                            try {
                                const selectedCmmFile = await window.compilationManager.getSelectedCmmFile(currentProcessor);
                                if (selectedCmmFile) {
                                    const projectPath = window.compilationManager.projectPath;
                                    const softwarePath = await window.electronAPI.joinPath(projectPath, currentProcessor.name, 'Software');
                                    cmmFilePath = await window.electronAPI.joinPath(softwarePath, selectedCmmFile);
                                }
                            } catch (error) {
                                console.log('Error getting CMM file from compilation manager:', error);
                            }
                        }
                    }

                    if (!cmmFilePath) {
                        const terminalContent = logEntry.closest('.terminal-content');
                        if (terminalContent) {
                            const logEntries = terminalContent.querySelectorAll('.log-entry');

                            for (const entry of Array.from(logEntries).reverse()) {
                                const entryText = entry.textContent || '';

                                const cmmCompMatch = entryText.match(/cmmcomp\.exe["\s]+([^\s"]+\.cmm)\s+([^\s"]+)\s+"([^"]+)"/);
                                if (cmmCompMatch) {
                                    const cmmFileName = cmmCompMatch[1];
                                    const processorName = cmmCompMatch[2];
                                    const projectPath = cmmCompMatch[3];

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

                    const fileExists = await window.electronAPI.fileExists(cmmFilePath);
                    if (!fileExists) {
                        console.log(`CMM file does not exist: ${cmmFilePath}`);
                        return;
                    }

                    const isFileOpen = TabManager.tabs.has(cmmFilePath);

                    if (!isFileOpen) {
                        const content = await window.electronAPI.readFile(cmmFilePath, {
                            encoding: 'utf8'
                        });
                        TabManager.addTab(cmmFilePath, content);
                    } else {
                        TabManager.activateTab(cmmFilePath);
                    }

                    setTimeout(() => {
                        this.goToLine(lineNumber);
                    }, 100);

                } catch (error) {
                    console.error('Error opening CMM file and navigating to line:', error);
                }
            });
        });

        const messageType = type === 'info' ? 'tips' : type;
        if (['error', 'warning', 'success', 'tips'].includes(messageType)) {
            this.incrementMessageCount(terminal.closest('.terminal-content').id.replace('terminal-', ''), messageType);
        }

        logEntry.style.opacity = '0';
        logEntry.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            logEntry.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            logEntry.style.opacity = '1';
            logEntry.style.transform = 'translateY(0)';
        });
    }

    // ... rest of the existing methods remain unchanged ...
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
            if (!this.isVisible || this.isComplete) return;
            
            try {
                if (await window.electronAPI.fileExists(this.progressPath)) {
                    const content = await window.electronAPI.readFile(this.progressPath);
                    const lines = content.split('\n').filter(line => line.trim());
                    
                    if (lines.length > 0) {
                        const progress = parseInt(lines[lines.length - 1].trim(), 10);
                        
                        if (!isNaN(progress) && progress >= 0) {
                            this.targetProgress = Math.min(progress, 100);
                            
                            // CRITICAL: Stop reading when we hit 100%
                            if (this.targetProgress >= 100) {
                                clearInterval(this.readInterval);
                                this.readInterval = null;
                                // Let animation loop handle completion
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error reading progress file:', error);
                clearInterval(this.readInterval);
                this.readInterval = null;
            }
        };

        await readProgress();
        
        // Only set interval if not already at 100%
        if (this.targetProgress < 100 && !this.isComplete) {
            this.readInterval = setInterval(readProgress, this.readIntervalMs);
        }
    }

        startAnimationLoop() {
        const animate = () => {
            if (!this.isVisible || this.isComplete) return;
            
            const diff = this.targetProgress - this.currentProgress;
            
            if (Math.abs(diff) > 0.01) {
                this.currentProgress += diff * this.interpolationSpeed;
            } else if (this.targetProgress === 100) {
                this.currentProgress = 100;
            }
            
            this.updateUI();

            // CRITICAL: Only trigger completion when we reach 100% AND target is 100%
            if (this.currentProgress >= 99.9 && this.targetProgress >= 100 && !this.isComplete) {
                this.handleCompletion();
                return; // Stop animation loop
            }

            // Continue animation if not complete
            if (!this.isComplete) {
                this.animationFrame = requestAnimationFrame(animate);
            }
        };
        
        this.animationFrame = requestAnimationFrame(animate);
    }
    
    handleCompletion() {
        this.isComplete = true;
        this.currentProgress = 100;
        this.updateUI(); // Show 100%

        // Add completion visual feedback
        this.overlay.querySelector('.vvp-progress-info').classList.add('vvp-complete');
        
        // Stop auto-minimize and time counter
        clearTimeout(this.minimizeTimeout);
        clearInterval(this.timeUpdateInterval);
        
        // CRITICAL FIX: Wait for completion delay BEFORE hiding
        setTimeout(() => {
            this.hide();
        }, this.completionDelayMs);
    }


    startTimeCounter() {
        const formatElapsedTime = (seconds) => {
            const days = Math.floor(seconds / 86400); // 24 * 60 * 60
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            let timeString = '';

            if (days > 0) {
                timeString += `${days}d `;
                if (hours > 0) timeString += `${hours}h `;
                if (minutes > 0 && days < 2) timeString += `${minutes}m`; // limita detalhe em dias longos
            } 
            else if (hours > 0) {
                timeString += `${hours}h`;
                if (minutes > 0) timeString += `${minutes}m`;
            } 
            else if (minutes > 0) {
                timeString += `${minutes}m`;
                if (secs > 0) timeString += `${secs}s`;
            } 
            else {
                timeString += `${secs}s`;
            }

            return timeString.trim();
        };

        const update = () => {
            if (!this.isVisible) return;
            const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
            const timeString = formatElapsedTime(elapsedSeconds);

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
                    document.getElementById('settings')
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
