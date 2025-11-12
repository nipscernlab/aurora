// file_tree_manager.js

import { TabManager } from './tab_manager.js';

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
    if (!Array.isArray(files)) return;

    const filteredFiles = files.filter(file => {
        if (file.type === 'directory') return true;
        return !['projectOriented.json', 'processorConfig.json'].includes(file.name) && !file.name.endsWith('.spf');
    });

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
        const filePath = file.path;

        if (file.type === 'directory') {
            itemWrapper.setAttribute('data-path', filePath);
            const folderToggle = document.createElement('i');
            folderToggle.className = 'fa-solid fa-caret-right folder-toggle';
            item.appendChild(folderToggle);
            icon.className = 'fas fa-folder file-item-icon';
            item.appendChild(icon);

            const childContainer = document.createElement('div');
            childContainer.className = 'folder-content hidden';
            if (FileTreeState.isExpanded(filePath)) {
                childContainer.classList.remove('hidden');
                folderToggle.classList.add('rotated');
                icon.classList.replace('fa-folder', 'fa-folder-open');
            }

            item.addEventListener('click', () => {
                const isExpanded = childContainer.classList.toggle('hidden');
                folderToggle.classList.toggle('rotated');
                icon.classList.toggle('fa-folder');
                icon.classList.toggle('fa-folder-open');
                FileTreeState.toggleFolder(filePath, !isExpanded);
            });

            if (file.children && Array.isArray(file.children)) {
                renderFileTree(file.children, childContainer, level + 1);
            }
            itemWrapper.appendChild(item);
            itemWrapper.appendChild(childContainer);
        } else {
            icon.className = TabManager.getFileIcon(file.name);
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
    }

    initialize() {
        TreeViewState.disableToggle();
        TreeViewState.setHierarchical(false);
        this.fileSearch = new FileTreeSearch();

        document.getElementById('refresh-button')?.addEventListener('click', () => {
            if (!TreeViewState.isHierarchical) refreshFileTree();
        });
        
        window.electronAPI.onDirectoryChanged((dir, files) => {
            if (dir === this.directoryWatcher.currentWatchedDirectory && !TreeViewState.isHierarchical) {
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
    }

    refresh() {
        refreshFileTree();
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