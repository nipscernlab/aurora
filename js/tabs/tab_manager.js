import { EditorManager } from '../editor/monaco_editor.js';
import { showCardNotification } from '../ui/notification.js';
import { tabViewers } from './tab_viewers.js';
import { tabDrag } from './tab_drag.js';
import { tabWatchers } from './tab_watchers.js';

export class TabManager {
    static tabs = new Map();
    static activeTab = null;
    static previewTab = null; // path of current preview (italic) tab, or null
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

    static updateTabsContainerVisibility() {
        const tabsContainer = document.getElementById('tabs-container');
        if (tabsContainer) {
            // If there are more than 0 tabs, display it, otherwise hide it.
            if (this.tabs.size > 0) {
                tabsContainer.style.display = 'flex';
            } else {
                tabsContainer.style.display = 'none';
            }
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
        //html += `<img src="./assets/icons/onirama_loader.gif" alt="Code Formatter" class="context-refactor-button toolbar-button" title="Code Formatter" style="margin-left: auto; width: 100px; cursor: pointer;"/>`;

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

    // getFileIcon — returns Phosphor classes (no FA dependency)
    static getFileIcon(filename) {
        const extension = filename.split('.').pop().toLowerCase();

        // Images
        if (this.imageExtensions.has(extension)) {
            return extension === 'svg' ? 'ph ph-file-svg' : 'ph ph-file-image';
        }

        if (extension === 'pdf') return 'ph ph-file-pdf';

        const iconMap = {
            // SAPHO/AURORA file types
            'cmm':       'ph ph-file-code',
            'asm':       'ph ph-file-code',
            'v':         'ph ph-file-code',
            'vh':        'ph ph-file-code',
            'sv':        'ph ph-file-code',
            'gtkw':      'ph ph-waveform',
            'vcd':       'ph ph-waveform',
            'mif':       'ph ph-database',
            'spf':       'ph ph-package',

            // JS/TS
            'js':   'ph ph-file-js',
            'jsx':  'ph ph-file-jsx',
            'ts':   'ph ph-file-ts',
            'tsx':  'ph ph-file-tsx',
            'mjs':  'ph ph-file-js',
            'vue':  'ph ph-file-vue',

            // Web
            'html': 'ph ph-file-html',
            'htm':  'ph ph-file-html',
            'css':  'ph ph-file-css',
            'scss': 'ph ph-file-css',
            'sass': 'ph ph-file-css',
            'less': 'ph ph-file-css',

            // Data
            'json': 'ph ph-brackets-curly',
            'xml':  'ph ph-file-code',
            'yaml': 'ph ph-file-code',
            'yml':  'ph ph-file-code',
            'toml': 'ph ph-file-code',

            // Docs
            'md':       'ph ph-file-md',
            'markdown': 'ph ph-file-md',
            'txt':      'ph ph-file-text',
            'rtf':      'ph ph-file-text',

            // Other languages
            'py':    'ph ph-file-py',
            'java':  'ph ph-file-code',
            'c':     'ph ph-file-c',
            'cpp':   'ph ph-file-cpp',
            'cc':    'ph ph-file-cpp',
            'cxx':   'ph ph-file-cpp',
            'h':     'ph ph-file-h',
            'hpp':   'ph ph-file-h',
            'cs':    'ph ph-file-c-sharp',
            'php':   'ph ph-file-code',
            'rb':    'ph ph-file-code',
            'go':    'ph ph-file-code',
            'rs':    'ph ph-file-rs',
            'swift': 'ph ph-file-code',
            'kt':    'ph ph-file-code',
            'scala': 'ph ph-file-code',

            // Shell
            'sh':   'ph ph-terminal',
            'bash': 'ph ph-terminal',
            'zsh':  'ph ph-terminal',
            'fish': 'ph ph-terminal',
            'ps1':  'ph ph-terminal',
            'bat':  'ph ph-terminal',
            'cmd':  'ph ph-terminal',

            // Config
            'ini':    'ph ph-gear',
            'conf':   'ph ph-gear',
            'config': 'ph ph-gear',
            'env':    'ph ph-gear',

            // Archive
            'zip': 'ph ph-file-zip',
            'rar': 'ph ph-file-zip',
            '7z':  'ph ph-file-zip',
            'tar': 'ph ph-file-zip',
            'gz':  'ph ph-file-zip',

            // Audio
            'mp3':  'ph ph-file-audio',
            'wav':  'ph ph-file-audio',
            'flac': 'ph ph-file-audio',
            'ogg':  'ph ph-file-audio',

            // Video
            'mp4': 'ph ph-file-video',
            'avi': 'ph ph-file-video',
            'mkv': 'ph ph-file-video',
            'mov': 'ph ph-file-video',

            // Office
            'doc':  'ph ph-file-doc',
            'docx': 'ph ph-file-doc',
            'xls':  'ph ph-file-xls',
            'xlsx': 'ph ph-file-xls',
            'ppt':  'ph ph-file-ppt',
            'pptx': 'ph ph-file-ppt'
        };

        return iconMap[extension] || 'ph ph-file';
    }

    // Promote preview tab to permanent (remove italic, keep tab)
    static promotePreviewToPermanent(filePath) {
        if (this.previewTab !== filePath) return;
        this.previewTab = null;
        const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
        if (tab) tab.classList.remove('preview');
    }

    // Enhanced addTab method with binary file support
    // options: { preview: false }  — preview=true opens as italic preview tab (VS Code style)
    static addTab(filePath, content = null, options = {}) {
        const isPreview = options.preview === true;

        // Check if tab already exists
        if (this.tabs.has(filePath)) {
            // If file is currently a preview tab and we want permanent, promote it
            if (this.previewTab === filePath && !isPreview) {
                this.promotePreviewToPermanent(filePath);
            }
            this.activateTab(filePath);
            return;
        }

        // If opening as preview, silently close the existing preview tab first
        if (isPreview && this.previewTab && this.previewTab !== filePath) {
            this._closePreviewSilently(this.previewTab);
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

        // Mark as preview if needed
        if (isPreview) {
            tab.classList.add('preview');
            this.previewTab = filePath;
        }

        // Add event listeners
        tab.addEventListener('click', () => {
            // Clicking a preview tab permanently promotes it
            if (this.previewTab === filePath) {
                this.promotePreviewToPermanent(filePath);
            }
            this.activateTab(filePath);
        });
        tab.addEventListener('dblclick', () => {
            // Double-click always promotes preview to permanent
            this.promotePreviewToPermanent(filePath);
            this.activateTab(filePath);
        });
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
                // Pass content through to the model factory so the registry
                // can seed the shared model on first acquire. This avoids the
                // old `setValue` after-create call, which would reset the
                // model and silently wipe edits made by other panes that
                // already attached to it.
                const editor = EditorManager.createEditorInstance(filePath, content || '');

                // Setup change listener
                this.setupContentChangeListener(filePath, editor);
                this.activateTab(filePath);
            } catch (error) {
                console.error('Error creating editor:', error);
                this.closeTab(filePath);
            }
        }
        this.updateTabsContainerVisibility();
        this.initSortableTabs();
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
    // Resolve "the file the user is currently editing" — main pane uses
    // TabManager.activeTab, splits override with their own focused file.
    // Falls back to the main active tab if no split is focused.
    static getEditingFilePath() {
        const split = window.SplitEditorManager;
        if (split && typeof split.getFocusedFile === 'function') {
            const focused = split.getFocusedFile();
            if (focused) return focused;
        }
        return this.activeTab;
    }

    // Comprehensive save method. Reads from the shared model rather than
    // a specific editor, so saving works the same whether the user typed
    // in the main pane or in a split.
    static async saveCurrentFile() {
        const currentPath = this.getEditingFilePath();
        if (!currentPath) return;
        if (this.isBinaryFile(currentPath)) return;

        try {
            const model = window.SharedModelRegistry?.getModel?.(currentPath)
                ?? EditorManager.getEditorForFile(currentPath)?.getModel();
            if (!model) return;

            const content = model.getValue();

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

            const model = window.SharedModelRegistry?.getModel?.(filePath)
                ?? EditorManager.getEditorForFile(filePath)?.getModel();
            if (!model) continue;

            const currentContent = model.getValue();

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

    // Silently close preview tab without dialogs
    static _closePreviewSilently(filePath) {
        if (!this.tabs.has(filePath)) return;
        // Remove from UI
        const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
        if (tab) tab.remove();
        // Cleanup editor
        if (!this.isBinaryFile(filePath)) {
            EditorManager.closeEditor(filePath);
        }
        this.tabs.delete(filePath);
        this.unsavedChanges.delete(filePath);
        this.editorStates.delete(filePath);
        this.stopWatchingFile(filePath);
        this.previewTab = null;
        this.updateTabsContainerVisibility();
        // If this was the active tab, show overlay or activate another
        if (this.activeTab === filePath) {
            const remaining = Array.from(this.tabs.keys());
            if (remaining.length > 0) {
                this.activateTab(remaining[remaining.length - 1]);
            } else {
                this.activeTab = null;
                this.showOverlay();
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
                // Auto-promote preview tab to permanent the moment user starts typing
                if (this.previewTab === filePath) {
                    this.promotePreviewToPermanent(filePath);
                }
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
            if (this.previewTab === filePath) this.previewTab = null;
            this.updateTabsContainerVisibility();

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
        const currentPath = filePath || this.getEditingFilePath();
        if (!currentPath) return;

        // Don't save binary files
        if (this.isBinaryFile(currentPath)) return;

        try {
            const model = window.SharedModelRegistry?.getModel?.(currentPath)
                ?? EditorManager.getEditorForFile(currentPath)?.getModel();
            if (!model) {
                throw new Error('Editor model not found for file');
            }

            const content = model.getValue();

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
    // Whenever a Monaco editor (main or split) gets keyboard focus, it
    // dispatches `aurora-editor-focused` with the file path it's showing.
    // We use that to keep the tab UI in sync with where the cursor really
    // lives — the user shouldn't have to click the tab manually after
    // tabbing through panes or focusing a split via the keyboard.
    static _bindEditorFocusActivation() {
        if (this._editorFocusBound) return;
        this._editorFocusBound = true;
        document.addEventListener('aurora-editor-focused', (e) => {
            const detail = e.detail || {};
            const { filePath, paneIndex } = detail;
            if (!filePath) return;

            if (paneIndex === 0) {
                // Main pane — promote preview if needed and activate.
                if (this.activeTab !== filePath) {
                    if (this.previewTab === filePath) {
                        this.promotePreviewToPermanent(filePath);
                    }
                    this.activateTab(filePath);
                }
            }
            // Split panes are handled inside SplitEditorManager so they can
            // reach into their own pane's tab bar without going through us.
        });
    }

    // Initialize on script load
    static initialize() {
        this.initSortableTabs();
        this.restoreTabOrder();
        this.initFileChangeListeners();
        this.updateTabsContainerVisibility();
        this._bindEditorFocusActivation();

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

// Install all mixins. Methods reference `this`, which resolves to TabManager
// when called as TabManager.foo(...). Order doesn't matter — none of the
// mixins shadow each other or the core class methods.
Object.assign(TabManager, tabViewers, tabDrag, tabWatchers);

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

    // if (!document.getElementById('context-path')) {
    //     initContextPath();  // temporarily disabled — context-path bar hidden
    // }
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
