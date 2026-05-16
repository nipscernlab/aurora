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

// --- Tree View State — façade over fileTreeViewController -------
//
// Pre-controller, TreeViewState owned isHierarchical / hierarchyData /
// isToggleEnabled / compilationModule and a copy lived in BOTH this
// file and tree_view_state_module.js (different objects, never in
// sync). Now it's a thin façade:
//
//   - isHierarchical, hierarchyData, isToggleEnabled  → getters that
//     read from the controller. No private fields here.
//   - setHierarchical / hierarchyData write           → route to the
//     controller's showHierarchyMode / showFileMode / setHierarchyData.
//   - enable/disableToggle                            → no-ops. The
//     controller enables the toggle automatically when hierarchyData
//     is set; disables when it's null. Lifecycle calls (e.g. on each
//     CompilationModule construction) used to re-disable the toggle
//     blindly — that's the bug class we just removed.
//   - setCompilationModule / compilationModule        → no-ops. The
//     controller's hierarchy renderer always reads from
//     window._latestCompilationModule (set in the constructor) so
//     callers don't need to track "the latest" themselves.
//
// New code should call window.fileTreeViewController directly. The
// façade exists so the dozens of legacy reads/writes don't all have
// to migrate at once — and so any future drift between TreeViewState
// and the controller is impossible by construction (there's no
// "TreeViewState" state to drift).
const TreeViewState = {
    get isHierarchical() {
        return window.fileTreeViewController?.isShowingHierarchy() ?? false;
    },
    set isHierarchical(value) {
        // Treat as a request to flip views; the controller is
        // idempotent against same-state writes.
        if (value) window.fileTreeViewController?.showHierarchyMode();
        else window.fileTreeViewController?.showFileMode();
    },

    get hierarchyData() {
        return window.fileTreeViewController?.getHierarchyData() ?? null;
    },
    set hierarchyData(data) {
        window.fileTreeViewController?.setHierarchyData(data);
    },

    get isToggleEnabled() {
        return !!window.fileTreeViewController?.getHierarchyData();
    },

    get compilationModule() {
        return window._latestCompilationModule ?? null;
    },

    setHierarchical(value) {
        this.isHierarchical = value;
    },

    setCompilationModule(_module) {
        // No-op: the controller resolves the latest CompilationModule
        // via window._latestCompilationModule, set by the constructor.
    },

    enableToggle() {
        // No-op: toggle enables automatically when hierarchyData
        // is set on the controller. Old code called this without
        // setting data first, which produced a useless enabled-but-
        // empty toggle.
    },

    disableToggle() {
        // No-op: same reasoning. If you actually want to disable the
        // toggle (because the data became invalid), set
        // hierarchyData = null instead.
    },
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

// --- Empty-state placeholder ---------------------------------------
//
// Two distinct emptyness states the user can land on:
//   1. No project open at all  →  click-to-create-project card.
//   2. Project open, zero processors  →  click-to-create-processor card.
//
// Both render directly into the standard view subcontainer of
// #file-tree. They are intentionally large, single tap targets — the
// previous "empty file tree with just the header" left the user
// looking at a blank pane with no obvious next step.

function buildEmptyStateCard(kind) {
    const tr = (k) => (window.t ? window.t(k) : k);
    const config = kind === 'no-project'
        ? {
            icon: 'ph ph-folder-plus',
            title: tr('fileTree.empty.noProjectTitle'),
            cta:   tr('fileTree.empty.noProjectCta'),
            onClick: () => {
                // The new-project modal is wired in index.html's inline
                // script via the trigger→modal map (newProjectBtn →
                // newProjectModal). Clicking the toolbar button keeps
                // every existing pre-condition (focus, store reset,
                // import-file priming) intact instead of forking a
                // second open path here.
                document.getElementById('newProjectBtn')?.click();
            },
        }
        : {
            icon: 'ph ph-cube',
            title: tr('fileTree.empty.noProcessorsTitle'),
            cta:   tr('fileTree.empty.noProcessorsCta'),
            onClick: () => {
                document.getElementById('processorHub')?.click();
            },
        };

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `tree-empty-state tree-empty-${kind}`;
    card.setAttribute('aria-label', config.title);
    card.innerHTML = `
        <span class="tree-empty-state-icon"><i class="${config.icon}" aria-hidden="true"></i></span>
        <span class="tree-empty-state-title">${escapeHtml(config.title)}</span>
        <span class="tree-empty-state-cta">${escapeHtml(config.cta)}</span>
    `;
    card.addEventListener('click', config.onClick);
    return card;
}

/**
 * Drop a full-replacement empty-state card into the standard view
 * container. Used for the "no project open" state — there are no
 * files to compete with, so the card owns the whole pane.
 */
function renderTreeEmptyState(kind) {
    const standardContainer = window.treeView?.getContainer('standard');
    if (!standardContainer) return;
    standardContainer.innerHTML = '';
    standardContainer.appendChild(buildEmptyStateCard(kind));
}

/**
 * Prepend (or remove) the "create your first processor" banner inside
 * the standard view container, based on the renderer's view of how
 * many processors exist. Idempotent: every refresh strips the old
 * banner and re-adds it only if still warranted.
 */
function syncNoProcessorsBanner() {
    const standardContainer = window.treeView?.getContainer('standard');
    if (!standardContainer) return;
    // Strip any prior banner so we never stack two on top of each
    // other across rapid refreshes.
    standardContainer.querySelectorAll('.tree-empty-state.tree-empty-no-processors')
        .forEach((el) => el.remove());

    // Only show the banner when a project is loaded AND it has no
    // processors yet. The no-project state already covers the empty
    // workspace case with its own full-replacement card.
    if (!window.currentProjectPath) return;
    const processors = Array.isArray(window.availableProcessors) ? window.availableProcessors : [];
    if (processors.length > 0) return;

    standardContainer.prepend(buildEmptyStateCard('no-processors'));
}

// Minimal escaper for the i18n strings we drop into innerHTML above.
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[ch]);
}

/**
 * Confirm + delete a processor by name. Wired to the trash button in
 * processor folders inside the standard file tree (see renderFileTree
 * below — `deleteBtn.addEventListener('click', ...)`). Previously the
 * button referenced `window.confirmAndDeleteProcessor` which was never
 * defined — clicking it printed an error in the console and did
 * nothing. This exposes the function for the first time, with a
 * proper confirm dialog and a refresh that gives the user immediate
 * "the processor is gone" feedback.
 *
 * After a successful delete, ProcessorsUpdated fires from main and the
 * file tree's `onProcessorsUpdated` subscriber picks it up — which
 * also runs the empty-state check, so deleting the last processor
 * automatically flips the tree into the "click to create processor"
 * empty card.
 */
async function confirmAndDeleteProcessor(processorName) {
    const tr = (k, p) => (window.t ? window.t(k, p) : k);
    let userChoice = 'confirm';
    try {
        const { showDialog } = await import('../ui/dialog_manager.js');
        userChoice = await showDialog({
            title: tr('dialog.deleteProcessor.title'),
            message: tr('dialog.deleteProcessor.message', { name: processorName }),
            buttons: [
                { label: tr('dialog.common.cancel'),         action: 'cancel',  type: 'cancel' },
                { label: tr('dialog.deleteProcessor.confirm'), action: 'confirm', type: 'danger' },
            ],
            variant: 'danger',
        });
    } catch (err) {
        // dialog_manager failed to load — fall back to a native confirm
        // so the user can still proceed. They're not stuck.
        console.warn('confirmAndDeleteProcessor: dialog_manager unavailable', err);
        userChoice = window.confirm(`Delete processor "${processorName}"?`) ? 'confirm' : 'cancel';
    }
    if (userChoice !== 'confirm') return;

    try {
        await window.electronAPI?.deleteProcessor?.(processorName);
        // onProcessorsUpdated → ProjectStore subscribers will refresh
        // the tree. Belt-and-braces: kick a refresh ourselves in case
        // the IPC handler can't reach this window.
        if (typeof window.refreshFileTree === 'function') {
            window.refreshFileTree();
        } else if (window.fileTreeManager?.refresh) {
            window.fileTreeManager.refresh();
        }
    } catch (err) {
        console.error('confirmAndDeleteProcessor failed:', err);
    }
}

if (typeof window !== 'undefined') {
    window.confirmAndDeleteProcessor = confirmAndDeleteProcessor;
    window.renderTreeEmptyState = renderTreeEmptyState;
    window.syncNoProcessorsBanner = syncNoProcessorsBanner;
}

// --- Main Rendering and Refresh Logic ---
//
// Standard tree renders into the dedicated `.tree-view-standard`
// subcontainer inside #file-tree. The other two views (verilog,
// hierarchy) live in their own subcontainers and can't conflict
// with this writer. CSS at css/tree/file_tree.css shows only the
// active subcontainer based on `[data-active-view]` on #file-tree.
// See js/tree/tree_view.js for the rationale.
async function refreshFileTree() {
    try {
        const tv = window.treeView;
        const standardContainer = tv?.getContainer('standard');
        if (!standardContainer || TreeViewState.isHierarchical) {
            return;
        }

        if (!window.currentProjectPath) {
            // Replace the otherwise-blank pane with the click-to-create
            // empty state so the user has an obvious next action. This
            // also covers the startup case where the user launched
            // Aurora without auto-restoring a project.
            renderTreeEmptyState('no-project');
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
            standardContainer.style.transition = 'opacity 0.2s ease';
            standardContainer.style.opacity = '0';

            setTimeout(() => {
                standardContainer.innerHTML = '';
                renderFileTree(result.files, standardContainer);
                // Banner sits ABOVE the file rows when the project has
                // zero processors — same UX hook as the no-project
                // empty card but inline with the user's actual workspace.
                syncNoProcessorsBanner();

                expandedPaths.forEach(path => {
                    const folderItem = standardContainer.querySelector(`.file-tree-item[data-path="${CSS.escape(path)}"]`);
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
                standardContainer.style.opacity = '1';
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
//
// Lookup case-insensitive: pareia com file_mode._getProcessorForFile e
// processor_list (dedup case-insensitive). Sem isso, um folder "Foo" no
// disco vs entry "foo" no .spf cairia no fallback hash e ganharia uma
// cor diferente da que a tree usa pra agrupar o processador.
function processorColorSlot(name) {
    const list = Array.isArray(window.availableProcessors) ? window.availableProcessors : [];
    const target = name.toLowerCase();
    const idx = list.findIndex((p) => typeof p === 'string' && p.toLowerCase() === target);
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

    // Filtra arquivos que nao devem aparecer na tree:
    //   - projectOriented.json — config legado (consolidada no .spf);
    //     projetos antigos podem ter o arquivo
    //   - processorConfig.json — config legado descontinuado
    //   - fileOriented.json — outro config historico
    //   - .* (dotfiles)
    //   - .spf (arquivo de projeto raiz)
    const filteredFiles = files.filter(file => {
        if (file.type === 'directory') return true;
        const ignoredFiles = ['projectOriented.json', 'processorConfig.json', 'fileOriented.json'];
        return !file.name.startsWith('.')
            && !ignoredFiles.includes(file.name)
            && !file.name.endsWith('.spf');
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
        // Match case-insensitive — Windows folders nao distinguem case e
        // o resto do pipeline (_getProcessorForFile, processor_list dedup)
        // ja trata assim.
        let itemProcessor = processor;
        if (
            level === 0 &&
            file.type === 'directory' &&
            Array.isArray(window.availableProcessors) &&
            window.availableProcessors.some((p) => typeof p === 'string' && p.toLowerCase() === file.name.toLowerCase())
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
                            window.availableProcessors.some((p) => typeof p === 'string' && p.toLowerCase() === file.name.toLowerCase());

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
            window.projectTreeManager?.refreshTree();
        });

        // Hierarchy toggle e owned por file_tree_view_controller.js —
        // um unico click listener instalado la cuida do flip file ↔
        // hierarchy. Nao re-attachar aqui; ja tivemos dois listeners
        // brigando no mesmo botao.

        window.electronAPI.onDirectoryChanged((dir, _files) => {
            if (dir !== this.directoryWatcher.currentWatchedDirectory) return;
            if (TreeViewState.isHierarchical) return;
            // Re-le o .spf pra pegar processor creation/
            // deletion que reescreve o arquivo.
            window.projectTreeManager?.refreshTree?.();
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

    /**
     * Primeira pintura da tree. Espera um tick pra DOM listeners +
     * AppInitializer assentarem, depois dispara o verilog picker.
     *
     * O nome "initializeTreeBasedOnMode" e historico (era um branch
     * sobre IDE mode). Modo unico hoje — chama activateTree
     * direto. A coalescencia em activateTree garante que isso
     * + projectManager.loadProject nao gerem duplo loadConfiguration.
     */
    async initializeTreeBasedOnMode() {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (window.projectTreeManager) {
            await window.projectTreeManager.activateTree();
        }
    }

    refresh() {
        refreshFileTree();
    }

    renderStandardTree(files = this.files) {
        if (TreeViewState.isHierarchical || FileTreeState.isRefreshing || !Array.isArray(files)) return;

        const standardContainer = window.treeView?.getContainer('standard');
        if (!standardContainer) return;

        // Per-view subcontainer — no lock check needed: the verilog
        // picker writes to a different DOM subtree, the hierarchy
        // view writes to a third. CSS handles which one is visible.
        const expandedPaths = Array.from(FileTreeState.expandedFolders);
        standardContainer.innerHTML = '';
        renderFileTree(files, standardContainer);
        syncNoProcessorsBanner();
        refreshFileTree();

        expandedPaths.forEach(path => {
            // ... (lógica de re-expansão)
        });
    }
    
toggleHierarchyView() {
    // Delegate to the file-tree view controller — it owns the
    // toggle button and the view-switch state. Kept this stub so
    // legacy callers (command palette, etc.) that still call
    // `fileTreeManager.toggleHierarchyView()` keep working.
    if (window.fileTreeViewController?.isShowingHierarchy?.()) {
        window.fileTreeViewController.showFileMode();
    } else {
        window.fileTreeViewController?.showHierarchyMode?.();
    }
}

    updateFileTree(files) {
        if (TreeViewState.isHierarchical || FileTreeState.isRefreshing || !Array.isArray(files)) return;

        const standardContainer = window.treeView?.getContainer('standard');
        if (!standardContainer) return;

        // Per-view subcontainer — see renderStandardTree.
        const expandedPaths = Array.from(FileTreeState.expandedFolders);
        standardContainer.innerHTML = '';
        renderFileTree(files, standardContainer);
        syncNoProcessorsBanner();
        refreshFileTree();

        expandedPaths.forEach(path => {
            const folderItem = standardContainer.querySelector(`.file-tree-item[data-path="${CSS.escape(path)}"]`);
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

// --- Empty-state wiring ---------------------------------------------
//
// Three signals can change which empty card (if any) belongs in the
// standard tree:
//
//   1. ProjectStore goes from "has project" to "no project" or vice
//      versa  →  swap between the no-project card and the live tree.
//   2. The main process broadcasts onProcessorsUpdated  →  re-evaluate
//      the no-processors banner (last processor deleted = banner
//      should reappear; first processor created = banner should
//      vanish).
//   3. App boot with no auto-restored project  →  render the
//      no-project card immediately instead of leaving a blank pane.
//
// All three converge on `renderTreeEmptyState('no-project')` or
// `syncNoProcessorsBanner()` — defined above in this file.
function bootstrapTreeEmptyStateWiring() {
    const onProjectChange = (snapshot) => {
        if (snapshot?.projectPath) {
            // Switched into a project — refresh the tree so files
            // populate. syncNoProcessorsBanner runs at the tail end
            // of refreshFileTree already.
            refreshFileTree();
        } else {
            renderTreeEmptyState('no-project');
        }
    };

    if (window.ProjectStore?.subscribe) {
        window.ProjectStore.subscribe(onProjectChange);
    }

    // onProcessorsUpdated fires from main on create/delete, and from
    // project:open when the .spf is read. Window may or may not have
    // the helper yet at boot time, so we re-check after a tick.
    const wireProcUpdates = () => {
        window.electronAPI?.onProcessorsUpdated?.(() => {
            // availableProcessors is set by file_mode.js's subscriber
            // earlier in the IPC sequence; the banner sync just reads
            // it from window. A microtask delay is enough for that.
            queueMicrotask(syncNoProcessorsBanner);
        });
    };
    if (window.electronAPI) wireProcUpdates();
    else window.addEventListener('aurora:ipc-ready', wireProcUpdates, { once: true });

    // Cold start with no project: paint the empty card immediately so
    // the user is never staring at a blank file-tree pane. Skipped
    // when a project auto-restore is in flight (signalled by the
    // localStorage key index.html's inline boot script reads) — in
    // that case the user briefly sees the "Loading…" header and the
    // ProjectStore subscriber above will refresh into the live tree
    // once the IPC roundtrip lands.
    let willAutoRestore = false;
    try { willAutoRestore = !!localStorage.getItem('aurora-last-project-path'); }
    catch (_) { /* localStorage unavailable, treat as no restore */ }

    if (!window.currentProjectPath && !willAutoRestore) {
        // Defer one tick so treeView has had a chance to mount its
        // subcontainers (initialize() runs on DOMContentLoaded).
        queueMicrotask(() => {
            if (!window.currentProjectPath) renderTreeEmptyState('no-project');
        });
    } else if (!window.currentProjectPath && willAutoRestore) {
        // Auto-restore safety net: if it never completes (e.g. the
        // stored .spf was moved), the user shouldn't be stuck on a
        // blank tree forever. After ~3s of no project, fall back to
        // the empty card so they can manually create/open a project.
        setTimeout(() => {
            if (!window.currentProjectPath) renderTreeEmptyState('no-project');
        }, 3000);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapTreeEmptyStateWiring, { once: true });
} else {
    bootstrapTreeEmptyStateWiring();
}