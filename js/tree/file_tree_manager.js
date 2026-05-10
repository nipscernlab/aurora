// file_tree_manager.js

import { TabManager } from '../tabs/tab_manager.js';

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

/* file-tree visuals are owned by css/tree/file_tree.css */`;
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
            icon.className = 'ph ph-list-bullets';
            text.textContent = 'Standard';
            toggleButton.classList.add('active');
            toggleButton.title = 'Switch to standard file tree';
        } else {
            icon.className = 'ph ph-tree-structure';
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

        // Don't overwrite the verilog file tree with the standard project tree
        if (fileTree.classList.contains('verilog-mode-active')) {
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
                // Re-check the verilog-mode guard inside the timeout.
                // Between this function's top-of-body check and now,
                // ~200ms + an await have passed, and activateVerilogMode
                // can have flipped the file-tree into verilog-picker
                // mode in the meantime. Without this re-check we'd
                // innerHTML='' the verilog rows we just rendered, then
                // populate the standard tree on top — the user sees
                // both tree styles stacked (10 entries instead of 5)
                // and the verilog row badges flicker out.
                if (fileTree.classList.contains('verilog-mode-active')) {
                    fileTree.style.opacity = '1';
                    return;
                }

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
                                icon.classList.remove('ph-folder', 'fa-folder');
                                icon.classList.add('ph-folder-open');
                            }
                        }
                    }
                });
                // Re-apply active file highlight after tree rebuild
                if (typeof TabManager !== 'undefined' && TabManager.activeTab) {
                    TabManager.highlightFileInTree(TabManager.activeTab);
                }
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

// 16 distinct color slots, one per processor in declaration order. With ≤16
// processors every processor gets a unique color (no hash collisions); with
// more than 16 the palette simply wraps. Order is taken from
// `window.availableProcessors`, which mirrors the .spf processor list, so the
// mapping is stable across reloads of the same project.
function processorColorSlot(name) {
    const list = Array.isArray(window.availableProcessors) ? window.availableProcessors : [];
    const idx = list.indexOf(name);
    if (idx >= 0) return idx % 16;
    // Fallback for an unknown name: keep colours deterministic via djb2 so
    // the tree never throws while the processor list is still loading.
    let hash = 5381;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 16;
}

function renderFileTree(files, container, level = 0, processor = null) {
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
        itemWrapper.style.setProperty('--depth', String(level));

        // Processor color propagation. At level 0 we detect a processor
        // folder by name; that name is then carried into every recursive
        // descent so all nested files/folders pick up the same color slot.
        let itemProcessor = processor;
        if (
            level === 0 &&
            file.type === 'directory' &&
            Array.isArray(window.availableProcessors) &&
            window.availableProcessors.includes(file.name)
        ) {
            itemProcessor = file.name;
        }
        if (itemProcessor) {
            itemWrapper.setAttribute('data-processor', itemProcessor);
            itemWrapper.style.setProperty(
                '--processor-color',
                `var(--proc-color-${processorColorSlot(itemProcessor)})`,
            );
        }

        const item = document.createElement('div');
        item.className = 'file-item';
        // VSCode-exact hierarchy: indent comes from CSS (--depth * 8px), no
        // inline padding-left here. Files and folders share the SAME starting
        // X coordinate at any given depth — chevron/spacer width is identical.

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'file-item-row';

        // Chevron (folders) or invisible spacer (files) — same width, so the
        // file name lines up with where the folder name starts inside its
        // parent. This is exactly how VSCode does it.
        if (file.type === 'directory') {
            const toggleIcon = document.createElement('i');
            toggleIcon.className = 'ph ph-caret-down folder-toggle-icon';
            if (!FileTreeState.isExpanded(file.path)) {
                toggleIcon.classList.add('collapsed');
            }
            contentWrapper.appendChild(toggleIcon);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'folder-toggle-spacer';
            contentWrapper.appendChild(spacer);
        }

        // Type/icon
        const icon = document.createElement('i');
        if (file.type === 'directory') {
            const isExpanded = FileTreeState.isExpanded(file.path);
            icon.className = `file-item-icon ph ${isExpanded ? 'ph-folder-open' : 'ph-folder'}`;
        } else {
            icon.className = `${TabManager.getFileIcon(file.name)} file-item-icon`;
            const ext = (file.name.split('.').pop() || '').toLowerCase();
            if (ext) itemWrapper.setAttribute('data-ext', ext);
        }
        contentWrapper.appendChild(icon);

        // Name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-item-name';
        nameSpan.textContent = file.name;
        contentWrapper.appendChild(nameSpan);

        item.appendChild(contentWrapper);

        const isProcessor = file.type === 'directory' && 
                            Array.isArray(window.availableProcessors) && 
                            window.availableProcessors.includes(file.name);

        if (isProcessor) {
            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'tree-delete-btn';
            deleteBtn.innerHTML = '<i class="ph ph-trash"></i>';
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

                const toggleArrow = item.querySelector('.folder-toggle-icon');
                if (toggleArrow) toggleArrow.classList.toggle('collapsed');

                const folderIcon = item.querySelector('.ph-folder, .ph-folder-open, .fa-folder, .fa-folder-open');
                if (folderIcon) {
                    folderIcon.classList.toggle('ph-folder');
                    folderIcon.classList.toggle('ph-folder-open');
                    // Legacy FA fallback support
                    folderIcon.classList.toggle('fa-folder');
                    folderIcon.classList.toggle('fa-folder-open');
                }

                let childContainer = itemWrapper.querySelector('.folder-content');
                if (!childContainer && !isExpanded && file.children) {
                    childContainer = document.createElement('div');
                    childContainer.className = 'folder-content';
                    renderFileTree(file.children, childContainer, level + 1, itemProcessor);
                    itemWrapper.appendChild(childContainer);
                } else if (childContainer) {
                    childContainer.classList.toggle('hidden', isExpanded);
                }
                return;
            }

            // Files: single click opens IMMEDIATELY as preview (italic tab) —
            // VS Code style. Dblclick promotes the same tab to permanent;
            // there is no need to defer the first click waiting for a
            // possible second one (that wait was the source of ~220ms of
            // perceived file-open lag).
            (async () => {
                try {
                    const content = await window.electronAPI.readFile(file.path);
                    const sem = window.SplitEditorManager;
                    if (sem && sem.focusedPane > 0) {
                        await sem.openInFocusedPane(file.path, content);
                    } else {
                        TabManager.addTab(file.path, content, { preview: true });
                    }
                } catch (error) {
                    console.error('Error opening file:', error);
                }
            })();
        });

        item.addEventListener('dblclick', async (e) => {
            if (file.type === 'directory') return;
            // The single click already opened (or activated) the tab as preview.
            // Just promote the existing tab to permanent — no second readFile.
            try {
                if (TabManager.tabs.has(file.path)) {
                    TabManager.promotePreviewToPermanent(file.path);
                    TabManager.activateTab(file.path);
                } else {
                    const content = await window.electronAPI.readFile(file.path);
                    TabManager.addTab(file.path, content, { preview: false });
                }
            } catch (error) {
                console.error('Error opening file (dblclick):', error);
            }
        });

        itemWrapper.appendChild(item);

        if (file.type === 'directory' && FileTreeState.isExpanded(file.path) && file.children) {
            const childContainer = document.createElement('div');
            childContainer.className = 'folder-content';
            renderFileTree(file.children, childContainer, level + 1, itemProcessor);
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
                const icon = folderContainer.querySelector('.file-item-icon.ph-folder, .file-item-icon.fa-folder');
                if (icon) {
                    icon.classList.replace('ph-folder', 'ph-folder-open');
                    icon.classList.replace('fa-folder', 'fa-folder-open');
                }
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
            if (TreeViewState.isHierarchical) return;
            const currentMode = this.getCurrentMode();
            if (currentMode === 'project') {
                // Project Mode uses the verilog picker tree.
                window.verilogTreeManager?.refreshVerilogTree();
            } else {
                this.refresh();
            }
        });

        // Hierarchy toggle button
        document.getElementById('alternate-tree-toggle')?.addEventListener('click', () => {
            this.toggleHierarchyView();
        });

        window.electronAPI.onDirectoryChanged((dir, files) => {
            if (dir !== this.directoryWatcher.currentWatchedDirectory) return;
            if (TreeViewState.isHierarchical) return;
            const currentMode = this.getCurrentMode();
            if (currentMode === 'project') {
                // Picker reads projectOriented.json, but processor creation
                // / deletion silently rewrites that file from
                // processor_oriented.js → the picker won't pick the change
                // up unless we re-load. Same trigger the manual refresh
                // button uses.
                window.verilogTreeManager?.refreshVerilogTree?.();
            } else {
                this.updateFileTree(files);
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
        // Wait a tick for DOM listeners (and AppInitializer) to settle.
        await new Promise(resolve => setTimeout(resolve, 100));

        const currentMode = this.getCurrentMode();
        console.log('🌳 Initializing tree for mode:', currentMode);

        if (currentMode === 'project') {
            if (window.verilogTreeManager) {
                await window.verilogTreeManager.activateVerilogMode();
            }
        } else {
            // Processor Mode → standard folder tree
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

        // Owner check — same invariant as refreshFileTree: don't
        // overwrite the verilog picker tree with the standard
        // project tree. The class on #file-tree is the lock.
        if (fileTree.classList.contains('verilog-mode-active')) return;

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
 * Get current mode — 'processor' or 'project'. Delegates to AppInitializer
 * when available; falls back to reading the radios for the early-startup
 * window before initialize() has run.
 */
getCurrentMode() {
    const fromInit = window.appInitializer?.getCurrentMode?.();
    if (fromInit === 'processor' || fromInit === 'project') return fromInit;

    const projectModeRadio = document.getElementById('Project Mode');
    const processorModeRadio = document.getElementById('Processor Mode');
    if (projectModeRadio?.checked) return 'project';
    if (processorModeRadio?.checked) return 'processor';
    return 'processor';
}

toggleHierarchyView() {
    const toggleButton = document.getElementById('alternate-tree-toggle');
    
    if (!toggleButton || toggleButton.disabled) {
        console.warn('⚠️ Toggle button is disabled');
        return;
    }
    
    const currentMode = this.getCurrentMode();
    console.log(`🔄 Toggling tree view. Mode: ${currentMode}, Is Hierarchical: ${TreeViewState.isHierarchical}`);
    
    if (currentMode === 'project') {
        // Project Mode: toggle picker tree ↔ hierarchical
        if (TreeViewState.isHierarchical) {
            console.log('📁 Switching to Verilog File Mode tree');
            TreeViewState.setHierarchical(false);
            if (window.verilogTreeManager) {
                window.verilogTreeManager.renderVerilogTree();
            }
        } else {
            if (!TreeViewState.hierarchyData) {
                console.warn('⚠️ No hierarchy data available. Compile Verilog first.');
                return;
            }
            console.log('🌲 Switching to Hierarchical tree');
            TreeViewState.setHierarchical(true);
            this.renderHierarchicalTreeFromData();
        }
    } else {
        // Processor Mode: toggle standard folder tree ↔ hierarchical
        if (TreeViewState.isHierarchical) {
            console.log('📂 Switching to Standard File Tree');
            TreeViewState.setHierarchical(false);
            this.refresh();
        } else {
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
        if (currentMode === 'project') {
            icon.className = 'ph ph-file-code';
            text.textContent = 'File Mode';
            toggleButton.title = 'Switch to Verilog File Mode';
        } else {
            icon.className = 'ph ph-folder-notch';
            text.textContent = 'File Tree';
            toggleButton.title = 'Switch to Standard File Tree';
        }
        toggleButton.classList.add('active');
    } else {
        icon.className = 'ph ph-tree-structure';
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

        // Owner check — same invariant as refreshFileTree /
        // renderStandardTree: don't overwrite the verilog picker
        // tree. The class on #file-tree is the single source of
        // truth for "who owns this DOM right now".
        if (fileTree.classList.contains('verilog-mode-active')) return;

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
                const icon = folderItem.querySelector('.file-item-icon.ph-folder, .file-item-icon.fa-folder');
                if (icon) {
                    icon.classList.replace('ph-folder', 'ph-folder-open');
                    icon.classList.replace('fa-folder', 'fa-folder-open');
                }
            }
        });
    }

    get watcher() {
        return this.directoryWatcher;
    }
}

const fileTreeManager = new FileTreeManager();
export { fileTreeManager, TreeViewState, FileTreeState };

window.refreshFileTree = refreshFileTree;