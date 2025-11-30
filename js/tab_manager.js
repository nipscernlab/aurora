import { EditorManager } from './monaco_editor.js';

export class TabManager {
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
                arrayBuffer = Uint8Array.from(buffer)
                    .buffer;
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
                arrayBuffer = Uint8Array.from(buffer)
                    .buffer;
            }
            const blob = new Blob([arrayBuffer], {
                type: 'application/pdf'
            });
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

            // CRITICAL FIX: Check if this change was caused by our own save operation
            const hasUnsavedChanges = this.unsavedChanges.has(filePath);
            const editorContentChanged = currentEditorContent !== originalTabContent;

            // If editor content matches the new file content, this was likely our own save
            if (currentEditorContent === newFileContent) {
                // This was our own save operation - just update the stored content
                // DO NOT call updateTabWithExternalContent as it destroys undo history
                this.tabs.set(filePath, newFileContent);
                this.markFileAsSaved(filePath);
                return;
            }

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
        const currentContent = editor.getValue();

        // If content is the same, don't do anything to preserve undo history
        if (currentContent === newContent) {
            this.tabs.set(filePath, newContent);
            this.markFileAsSaved(filePath);
            return;
        }

        // Save current cursor position and scroll
        const position = editor.getPosition();
        const scrollTop = editor.getScrollTop();

        // CRITICAL: Use pushEditOperations instead of setValue to preserve undo history
        const model = editor.getModel();
        const fullRange = model.getFullModelRange();

        // Create an edit operation that can be undone
        const editOperation = {
            range: fullRange,
            text: newContent,
            forceMoveMarkers: true
        };

        // Apply the edit operation - this preserves undo history
        model.pushEditOperations([], [editOperation], () => null);

        // Restore cursor position if still valid
        try {
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
            editor.setPosition({
                lineNumber: 1,
                column: 1
            });
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
        const fileName = filePath.split(/[\\/]/)
            .pop();

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
            // Replace editor content with disk content - use the fixed method
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
        const fileName = filePath.split(/[\\/]/)
            .pop();
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
            return Array.from(tabsContainer.children)
                .indexOf(tab);
        };

        // Find drop position based on mouse coordinates
        const getDropPosition = (x, y) => {
            const tabs = Array.from(tabsContainer.querySelectorAll('.tab:not(.dragging)'));

            for (let i = 0; i < tabs.length; i++) {
                const tab = tabs[i];
                const rect = tab.getBoundingClientRect();
                const midpoint = rect.left + rect.width / 2;

                if (x < midpoint) {
                    return {
                        index: i,
                        side: 'left',
                        tab
                    };
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
            tabsContainer.querySelectorAll('.tab')
                .forEach(tab => {
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
        tabsContainer.querySelectorAll('.tab')
            .forEach(addTabListeners);

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

        observer.observe(tabsContainer, {
            childList: true
        });

        // Store observer reference for cleanup
        this.tabObserver = observer;
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
        html += `<img src="./assets/icons/aksnes.png" alt="Code Formatter" class="context-refactor-button toolbar-button" title="Code Formatter" style="margin-left: auto; width: 100px; cursor: pointer;"/>`;

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


    // Helper method to determine insertion point
    static getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.tab:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;

                if (offset < 0 && offset > closest.offset) {
                    return {
                        offset: offset,
                        element: child
                    };
                } else {
                    return closest;
                }
            }, {
                offset: Number.NEGATIVE_INFINITY
            })
            .element;
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
        const extension = filename.split('.')
            .pop()
            .toLowerCase();

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
        this.updateTabsContainerVisibility();
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

            const editor = EditorManager.getEditorForFile(filePath);
            if (!editor) continue;

            const currentContent = editor.getValue();

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
    // Initialize on script load
    static initialize() {
        this.initSortableTabs();
        this.restoreTabOrder();
        this.initFileChangeListeners();
        this.updateTabsContainerVisibility();

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

    if (!document.getElementById('context-path')) {
        initContextPath();
    }
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
