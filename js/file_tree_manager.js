// file_tree_manager.js

import { TabManager } from './tab_manager.js';

const treeStyle = document.createElement('style');
treeStyle.textContent = `
    .tree-delete-btn {
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease-in-out;
        padding: 4px 8px;
        color: #ff4444;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .file-item:hover .tree-delete-btn {
        opacity: 1;
        pointer-events: auto;
    }

    .tree-delete-btn:hover {
        color: #ff0000;
        transform: scale(1.1);
    }

    /* --- Novo CSS para a Seta --- */
    .folder-toggle-icon {
        margin-right: 12px;
        width: 12px;
        text-align: center;
        font-size: 10px;
        color: #888;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1); /* Animação suave */
        display: inline-block;
    }

    /* Estado colapsado: aponta para a direita (-90 graus) */
    .folder-toggle-icon.collapsed {
        transform: rotate(-90deg);
    }
`;
document.head.appendChild(treeStyle);

// --- Tree View State (Standard vs. Hierarchical) ---
const TreeViewState = {
    isHierarchical: false,
    hierarchyData: null,
    isToggleEnabled: false,
    compilationModule: null,

    setHierarchical(value) {
        this.isHierarchical = value;
        this.updateToggleButton();
    },

    setCompilationModule(module) {
        this.compilationModule = module;
    },

    updateToggleButton() {
        const toggleButton = document.getElementById('alternate-tree-toggle');
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
        const toggleButton = document.getElementById('alternate-tree-toggle');
        if (!toggleButton) return;
        toggleButton.classList.remove('disabled');
        toggleButton.disabled = false;
        this.isToggleEnabled = true;
    },

    disableToggle() {
        const toggleButton = document.getElementById('alternate-tree-toggle');
        if (!toggleButton) return;
        toggleButton.classList.add('disabled');
        toggleButton.disabled = true;
        toggleButton.title = 'Compile Verilog to generate hierarchy';
        this.isToggleEnabled = false;
    }
};

// --- Standard File Tree State ---
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

// --- Main Rendering and Refresh Logic ---
async function refreshFileTree() {
    try {
        const fileTree = document.getElementById('file-tree');
        if (!fileTree || TreeViewState.isHierarchical) {
            return;
        }

        if (!window.currentProjectPath) {
            console.warn('No project is currently open');
            return;
        }

        if (FileTreeState.isRefreshing) {
            return;
        }

        FileTreeState.isRefreshing = true;
        const refreshButton = document.getElementById('refresh-button');
        if (refreshButton) {
            refreshButton.style.pointerEvents = 'none';
            refreshButton.classList.add('spinning');
        }

        const result = await window.electronAPI.refreshFolder(window.currentProjectPath);

        if (result && result.files) {
            const expandedPaths = Array.from(FileTreeState.expandedFolders);
            fileTree.style.transition = 'opacity 0.2s ease';
            fileTree.style.opacity = '0';

            setTimeout(() => {
                fileTree.innerHTML = '';
                fileTree.classList.remove('hierarchy-view');
                renderFileTree(result.files, fileTree);
                
                expandedPaths.forEach(path => {
                    const folderItem = fileTree.querySelector(`.file-tree-item[data-path="${CSS.escape(path)}"]`);
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

function renderFileTree(files, container, level = 0) {
    if (!files || files.length === 0) {
        if (level === 0) {
            container.innerHTML = '<div class="empty-tree">No files found</div>';
        }
        return;
    }

    // --- NOVA LÓGICA DE FILTRAGEM (MANTIDA DA VERSÃO NOVA) ---
    const filteredFiles = files.filter(file => {
        if (file.type === 'directory') return true;
        
        const ignoredFiles = ['projectOriented.json', 'processorConfig.json', 'fileOriented.json'];
        
        return !file.name.startsWith('.') && 
               !ignoredFiles.includes(file.name) && 
               !file.name.endsWith('.spf');
    });

    // Ordenação (Diretórios primeiro, depois alfabético)
    filteredFiles.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
    });

filteredFiles.forEach(file => {
        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'file-tree-item';
        itemWrapper.setAttribute('data-path', file.path);

        const item = document.createElement('div');
        item.className = 'file-item';
        
        const indentSize = 15; 
        item.style.paddingLeft = `${level * indentSize + 10}px`;

        const contentWrapper = document.createElement('div');
        contentWrapper.style.display = 'flex';
        contentWrapper.style.alignItems = 'center';
        contentWrapper.style.flexGrow = '1';
        contentWrapper.style.overflow = 'hidden';

        // --- Adição da Seta (Caret) ---
        if (file.type === 'directory') {
            const toggleIcon = document.createElement('i');
            toggleIcon.className = 'fa-solid fa-caret-down folder-toggle-icon';
            
            // Se NÃO estiver expandido, adiciona classe para rotacionar (-90deg)
            if (!FileTreeState.isExpanded(file.path)) {
                toggleIcon.classList.add('collapsed');
            }
            contentWrapper.appendChild(toggleIcon);
        } else {
            // Espaçador invisível para arquivos alinharem com pastas (largura da seta + margem)
            const spacer = document.createElement('span');
            spacer.style.display = 'inline-block';
            spacer.style.minWidth = '18px'; 
            contentWrapper.appendChild(spacer);
        }

        const icon = document.createElement('i');
        icon.className = 'file-item-icon';
        if (file.type === 'directory') {
            const isExpanded = FileTreeState.isExpanded(file.path);
            icon.classList.add('fa-solid', isExpanded ? 'fa-folder-open' : 'fa-folder');
        } else {
            icon.className = TabManager.getFileIcon(file.name);
        }
        contentWrapper.appendChild(icon);

        const nameSpan = document.createElement('span');
        nameSpan.textContent = file.name;
        nameSpan.style.marginLeft = '8px';
        nameSpan.style.whiteSpace = 'nowrap';
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';
        contentWrapper.appendChild(nameSpan);

        item.appendChild(contentWrapper);

        const isProcessor = file.type === 'directory' && 
                            Array.isArray(window.availableProcessors) && 
                            window.availableProcessors.includes(file.name);

        if (isProcessor) {
            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'tree-delete-btn';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            deleteBtn.title = 'Delete Processor';
            
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof window.confirmAndDeleteProcessor === 'function') {
                    window.confirmAndDeleteProcessor(file.name);
                } else {
                    console.error("Função window.confirmAndDeleteProcessor não encontrada.");
                }
            });

            item.appendChild(deleteBtn);
        }

        item.addEventListener('click', async (e) => {
            if (file.type === 'directory') {
                const isExpanded = FileTreeState.isExpanded(file.path);
                FileTreeState.toggleFolder(file.path, !isExpanded);
                
                // --- Animação da Seta ao Clicar ---
                const toggleArrow = item.querySelector('.folder-toggle-icon');
                if (toggleArrow) {
                    toggleArrow.classList.toggle('collapsed');
                }

                const folderIcon = item.querySelector('.fa-folder, .fa-folder-open');
                if (folderIcon) {
                    folderIcon.classList.toggle('fa-folder');
                    folderIcon.classList.toggle('fa-folder-open');
                }
                
                let childContainer = itemWrapper.querySelector('.folder-content');
                if (!childContainer && !isExpanded && file.children) {
                    childContainer = document.createElement('div');
                    childContainer.className = 'folder-content';
                    renderFileTree(file.children, childContainer, level + 1);
                    itemWrapper.appendChild(childContainer);
                } else if (childContainer) {
                    childContainer.classList.toggle('hidden', isExpanded);
                }
            } else {
                try {
                    const content = await window.electronAPI.readFile(file.path);
                    TabManager.addTab(file.path, content);
                } catch (error) {
                    console.error('Error opening file:', error);
                }
            }
        });

        itemWrapper.appendChild(item);

        if (file.type === 'directory' && FileTreeState.isExpanded(file.path) && file.children) {
            const childContainer = document.createElement('div');
            childContainer.className = 'folder-content';
            renderFileTree(file.children, childContainer, level + 1);
            itemWrapper.appendChild(childContainer);
        }

        container.appendChild(itemWrapper);
    });
}

// --- File Tree Search ---
class FileTreeSearch {
    constructor() {
        this.searchInput = document.getElementById('file-search-input');
        this.clearButton = document.getElementById('clear-search');
        this.resultsCounter = document.getElementById('search-results-count');
        this.isSearchActive = false;
        this.debounceTimer = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        if (!this.searchInput) return;
        this.searchInput.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.clearSearch();
        });
        this.clearButton.addEventListener('click', () => this.clearSearch());
    }

    handleSearchInput(query) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.performSearch(query), 300);
    }

    performSearch(query) {
        const trimmedQuery = query.trim().toLowerCase();
        if (trimmedQuery === '') return this.clearSearch();

        this.isSearchActive = true;
        document.getElementById('file-tree')?.classList.add('searching');
        let matchCount = 0;
        const fileTreeItems = document.querySelectorAll('.file-tree-item');

        fileTreeItems.forEach(item => {
            const nameSpan = item.querySelector('.file-item span');
            const filePath = item.getAttribute('data-path');
            if (!nameSpan) return;

            const isMatch = nameSpan.textContent.toLowerCase().includes(trimmedQuery) || (filePath && filePath.toLowerCase().includes(trimmedQuery));
            item.classList.toggle('search-hidden', !isMatch);
            item.classList.toggle('search-match', isMatch);
            if (isMatch) {
                matchCount++;
                this.highlightMatchInText(nameSpan, trimmedQuery);
                this.showParentFolders(item);
            } else {
                this.removeHighlights(nameSpan);
            }
        });
        this.updateResultsCounter(matchCount, trimmedQuery);
    }

    showParentFolders(item) {
        let parent = item.parentElement;
        while (parent && parent.classList.contains('folder-content')) {
            const folderContainer = parent.parentElement;
            folderContainer?.classList.remove('search-hidden');
            if (parent.classList.contains('hidden')) {
                parent.classList.remove('hidden');
                const toggle = folderContainer.querySelector('.folder-toggle');
                toggle?.classList.add('rotated');
                const icon = folderContainer.querySelector('.file-item-icon.fa-folder');
                icon?.classList.replace('fa-folder', 'fa-folder-open');
            }
            parent = folderContainer.parentElement;
        }
    }
    
    highlightMatchInText(element, query) {
        const originalText = element.getAttribute('data-original-text') || element.textContent;
        element.setAttribute('data-original-text', originalText);
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        element.innerHTML = originalText.replace(regex, '<span class="search-highlight">$1</span>');
    }

    removeHighlights(element) {
        const originalText = element.getAttribute('data-original-text');
        if (originalText) {
            element.textContent = originalText;
            element.removeAttribute('data-original-text');
        }
    }
    
    updateResultsCounter(count, query) {
        this.resultsCounter.parentElement.classList.add('active');
        this.resultsCounter.textContent = count > 0 ? `${count} file${count > 1 ? 's' : ''} found` : `No results for "${query}"`;
    }

    clearSearch() {
        this.isSearchActive = false;
        this.searchInput.value = '';
        document.querySelectorAll('.file-tree-item').forEach(item => {
            item.classList.remove('search-hidden', 'search-match');
            const nameSpan = item.querySelector('.file-item span');
            if (nameSpan) this.removeHighlights(nameSpan);
        });
        document.getElementById('file-tree')?.classList.remove('searching');
        this.resultsCounter.parentElement.classList.remove('active');
    }
}

// --- Directory Watcher ---
class DirectoryWatcher {
    constructor() {
        this.currentWatchedDirectory = null;
        this.isWatching = false;
    }

    async startWatching(directoryPath) {
        await this.stopWatching();
        if (!directoryPath) return;
        try {
            await window.electronAPI.watchDirectory(directoryPath);
            this.currentWatchedDirectory = directoryPath;
            this.isWatching = true;
        } catch (error) {
            console.error('Failed to start directory watching:', error);
        }
    }

    async stopWatching() {
        if (this.currentWatchedDirectory && this.isWatching) {
            try {
                await window.electronAPI.stopWatchingDirectory(this.currentWatchedDirectory);
                this.currentWatchedDirectory = null;
                this.isWatching = false;
            } catch (error) {
                console.error('Failed to stop directory watching:', error);
            }
        }
    }
}

// --- Public Manager Object ---
class FileTreeManager {
    constructor() {
        this.directoryWatcher = new DirectoryWatcher();
        this.fileSearch = null;
        this.currentStandardTree = null; // Cache for standard tree
    }

    initialize() {
        TreeViewState.disableToggle();
        TreeViewState.setHierarchical(false);
        this.fileSearch = new FileTreeSearch();

        document.getElementById('refresh-button')?.addEventListener('click', () => {
            const currentMode = this.getCurrentMode();
            if (currentMode === 'verilog' && !TreeViewState.isHierarchical) {
                // Refresh Verilog file mode tree
                window.verilogModeManager?.refreshVerilogTree();
            } else if (!TreeViewState.isHierarchical) {
                // Refresh standard file tree
                this.refresh();
            }
        });
        
        // Hierarchy toggle button
        document.getElementById('alternate-tree-toggle')?.addEventListener('click', () => {
            this.toggleHierarchyView();
        });
        
        window.electronAPI.onDirectoryChanged((dir, files) => {
            if (dir === this.directoryWatcher.currentWatchedDirectory && !TreeViewState.isHierarchical) {
                const currentMode = this.getCurrentMode();
                if (currentMode !== 'verilog') {
                    this.updateFileTree(files);
                }
            }
        });
        
        document.addEventListener('refresh-file-tree', () => this.refresh());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                this.fileSearch.searchInput.focus();
            }
        });

        // Initialize tree based on saved mode
        this.initializeTreeBasedOnMode();
    }

    async initializeTreeBasedOnMode() {
        // Wait a bit for DOM to be fully ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const savedMode = localStorage.getItem('aurora-ide-compilation-mode');
        const currentMode = this.getCurrentMode();
        const modeToUse = savedMode || currentMode;
        
        console.log('🌳 Initializing tree for mode:', modeToUse);
        
        if (modeToUse === 'Verilog Mode') {
            // Activate Verilog Mode tree
            if (window.verilogModeManager) {
                await window.verilogModeManager.activateVerilogMode();
            }
        } else {
            // Show standard file tree for Processor/Project modes
            this.refresh();
        }
    }

    refresh() {
        refreshFileTree();
    }

    renderStandardTree(files = this.files) {
        if (TreeViewState.isHierarchical || FileTreeState.isRefreshing || !Array.isArray(files)) return;

        const fileTree = document.getElementById('file-tree');
        if (!fileTree) return;

        // ... (resto da lógica de updateFileTree, mantendo a expansão de pastas)
        const expandedPaths = Array.from(FileTreeState.expandedFolders);
        fileTree.innerHTML = '';
        fileTree.classList.remove('hierarchy-view'); // Garante que a classe de hierarquia esteja removida
        renderFileTree(files, fileTree);
        refreshFileTree();

        expandedPaths.forEach(path => {
            // ... (lógica de re-expansão)
        });
    }
    
/**
 * Get current mode
 */
getCurrentMode() {
    // Check if appInitializer is available
    if (window.appInitializer && typeof window.appInitializer.getCurrentMode === 'function') {
        return window.appInitializer.getCurrentMode();
    }
    
    // Fallback: Manual detection
    const verilogModeRadio = document.getElementById('Verilog Mode');
    const processorModeRadio = document.getElementById('Processor Mode');
    const projectModeRadio = document.getElementById('Project Mode');
    
    // Check simulation toggle state
    const simToggle = document.getElementById('Verilog Mode');
    const isSimulationEnabled = simToggle ? simToggle.checked : true;
    
    if (projectModeRadio && projectModeRadio.checked && !isSimulationEnabled) {
        return 'verilog';
    }
    
    if (processorModeRadio && processorModeRadio.checked) return 'processor';
    if (projectModeRadio && projectModeRadio.checked) return 'project';
    
    return 'processor'; // Default fallback
}

toggleHierarchyView() {
    const toggleButton = document.getElementById('alternate-tree-toggle');
    
    if (!toggleButton || toggleButton.disabled) {
        console.warn('⚠️ Toggle button is disabled');
        return;
    }
    
    const currentMode = this.getCurrentMode();
    console.log(`🔄 Toggling tree view. Mode: ${currentMode}, Is Hierarchical: ${TreeViewState.isHierarchical}`);
    
    if (currentMode === 'verilog') {
        // Verilog Mode: Toggle between Verilog File Mode and Hierarchical
        if (TreeViewState.isHierarchical) {
            // Back to Verilog File Mode
            console.log('📁 Switching to Verilog File Mode tree');
            TreeViewState.setHierarchical(false);
            if (window.verilogModeManager) {
                window.verilogModeManager.renderVerilogTree();
            }
        } else {
            // To Hierarchical
            if (!TreeViewState.hierarchyData) {
                console.warn('⚠️ No hierarchy data available. Compile Verilog first.');
                return;
            }
            console.log('🌲 Switching to Hierarchical tree');
            TreeViewState.setHierarchical(true);
            this.renderHierarchicalTreeFromData();
        }
        
    } else {
        // Processor/Project Mode: Toggle between Standard and Hierarchical
        if (TreeViewState.isHierarchical) {
            // Back to Standard
            console.log('📂 Switching to Standard File Tree');
            TreeViewState.setHierarchical(false);
            this.refresh();
        } else {
            // To Hierarchical
            if (!TreeViewState.hierarchyData) {
                console.warn('⚠️ No hierarchy data. Compile Verilog first.');
                return;
            }
            console.log('🌲 Switching to Hierarchical tree');
            TreeViewState.setHierarchical(true);
            this.renderHierarchicalTreeFromData();
        }
    }
    
    // Update toggle button appearance
    this.updateToggleButtonAppearance();
}

/**
 * Update toggle button appearance based on current state and mode
 */
updateToggleButtonAppearance() {
    const toggleButton = document.getElementById('alternate-tree-toggle');
    if (!toggleButton) return;
    
    const icon = toggleButton.querySelector('i');
    const text = toggleButton.querySelector('.toggle-text');
    if (!icon || !text) return;
    
    const currentMode = this.getCurrentMode();
    
    if (TreeViewState.isHierarchical) {
        // Currently showing hierarchical view
        if (currentMode === 'verilog') {
            icon.className = 'fa-solid fa-file-code';
            text.textContent = 'File Mode';
            toggleButton.title = 'Switch to Verilog File Mode';
        } else {
            icon.className = 'fa-solid fa-folder-tree';
            text.textContent = 'File Tree';
            toggleButton.title = 'Switch to Standard File Tree';
        }
        toggleButton.classList.add('active');
    } else {
        // Currently showing standard/file mode view
        icon.className = 'fa-solid fa-sitemap';
        text.textContent = 'Hierarchical';
        toggleButton.title = 'Switch to Hierarchical Module View';
        toggleButton.classList.remove('active');
    }
}
/**
 * Render hierarchical tree from cached data
 */
renderHierarchicalTreeFromData() {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree || !TreeViewState.hierarchyData) {
        console.error('❌ Cannot render hierarchy: missing tree or data');
        return;
    }
    
    if (TreeViewState.compilationModule) {
        TreeViewState.compilationModule.renderHierarchicalTree();
    } else {
        console.error('❌ CompilationModule not set in TreeViewState');
    }
}

    updateFileTree(files) {
        if (TreeViewState.isHierarchical || FileTreeState.isRefreshing || !Array.isArray(files)) return;
        
        const fileTree = document.getElementById('file-tree');
        if (!fileTree) return;
        
        const expandedPaths = Array.from(FileTreeState.expandedFolders);
        fileTree.innerHTML = '';
        fileTree.classList.remove('hierarchy-view');
        renderFileTree(files, fileTree);
        refreshFileTree();
        
        expandedPaths.forEach(path => {
            const folderItem = fileTree.querySelector(`.file-tree-item[data-path="${CSS.escape(path)}"]`);
            if (folderItem) {
                folderItem.querySelector('.folder-content')?.classList.remove('hidden');
                folderItem.querySelector('.folder-toggle')?.classList.add('rotated');
                const icon = folderItem.querySelector('.file-item-icon.fa-folder');
                icon?.classList.replace('fa-folder', 'fa-folder-open');
            }
        });
    }

    get watcher() {
        return this.directoryWatcher;
    }
}

const fileTreeManager = new FileTreeManager();
export { fileTreeManager, TreeViewState };

window.refreshFileTree = refreshFileTree;