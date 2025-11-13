// file_mode.js

import { TabManager } from './tab_manager.js';
import { EditorManager } from './editor_manager.js';

/**
 * Manages file mode operations including drag & drop import,
 * file tree rendering, and JSON persistence for Verilog Mode.
 * Integrates with UIStateManager for mode switching.
 */
class FileModeManager {
    constructor() {
        this.isVerilogMode = false;
        this.importedFiles = [];
        this.fileModeJsonPath = null;
        this.dropZone = null;
        this.allowedExtensions = ['.v', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.svg'];
        this.fileTreeContainer = null;
    }

    /**
     * Initialize the file mode manager
     */
    initialize() {
        this.fileTreeContainer = document.getElementById('file-tree');
        this.setupDropZone();
        this.setupModeListener();
        console.log('FileModeManager initialized');
    }

    /**
     * Listen for mode changes from UIStateManager
     */
    setupModeListener() {
        // Listen for radio button changes
        const modeRadios = document.querySelectorAll('input[name="mode"]');
        
        modeRadios.forEach(radio => {
            radio.addEventListener('change', async (e) => {
                if (e.target.checked) {
                    await this.handleModeChange(e.target.value);
                }
            });
        });

        // Check initial mode on page load
        setTimeout(() => {
            const checkedRadio = document.querySelector('input[name="mode"]:checked');
            if (checkedRadio) {
                this.handleModeChange(checkedRadio.value);
            }
        }, 500);
    }

    /**
     * Handle mode changes
     */
    async handleModeChange(mode) {
        console.log(`FileModeManager: Mode changed to ${mode}`);
        
        if (mode === 'Verilog Mode') {
            await this.enterVerilogMode();
        } else {
            this.exitVerilogMode();
        }
    }

    /**
     * Setup drag and drop functionality for the file tree
     */
    setupDropZone() {
        this.dropZone = document.getElementById('file-tree');
        if (!this.dropZone) {
            console.error('File tree element not found');
            return;
        }

        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, this.preventDefaults, false);
            document.body.addEventListener(eventName, this.preventDefaults, false);
        });

        // Highlight drop zone when item is dragged over it
        ['dragenter', 'dragover'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => this.highlight(), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => this.unhighlight(), false);
        });

        // Handle dropped files
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e), false);
    }

    /**
     * Prevent default drag behaviors
     */
    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    /**
     * Highlight drop zone
     */
    highlight() {
        if (!this.isVerilogMode) return;
        this.dropZone.classList.add('drag-over');
    }

    /**
     * Remove highlight from drop zone
     */
    unhighlight() {
        this.dropZone.classList.remove('drag-over');
    }

    /**
     * Handle file drop
     */
    async handleDrop(e) {
        if (!this.isVerilogMode) return;

        const dt = e.dataTransfer;
        const files = [...dt.files];

        if (files.length === 0) return;

        const validFiles = files.filter(file => this.isValidFile(file));
        
        if (validFiles.length === 0) {
            this.showNotification('No valid files detected. Only .v, .txt, and image files are allowed.', 'warning');
            return;
        }

        for (const file of validFiles) {
            await this.importFile(file.path);
        }

        this.sortFiles();
        await this.saveToJson();
        this.renderFileTree();
    }

    /**
     * Check if file has valid extension
     */
    isValidFile(file) {
        const fileName = file.name.toLowerCase();
        return this.allowedExtensions.some(ext => fileName.endsWith(ext));
    }

    /**
     * Import a file to the file mode
     */
    async importFile(filePath) {
        // Check if file already exists
        const exists = this.importedFiles.some(f => f.fullPath === filePath);
        if (exists) {
            this.showNotification('File already imported', 'info');
            return;
        }

        // Extract file name and extension
        const fileName = filePath.split(/[/\\]/).pop();
        const extension = fileName.substring(fileName.lastIndexOf('.'));

        this.importedFiles.push({
            fullPath: filePath,
            name: fileName,
            extension: extension
        });

        this.showNotification(`Imported: ${fileName}`, 'success');
    }

    /**
     * Sort files alphabetically by name
     */
    sortFiles() {
        this.importedFiles.sort((a, b) => {
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
    }

    /**
     * Save imported files to fileMode.json
     */
    async saveToJson() {
        if (!window.currentProjectPath) {
            console.error('No project path available');
            return;
        }

        try {
            const fileModeJsonPath = await window.electronAPI.joinPath(
                window.currentProjectPath,
                'fileMode.json'
            );

            const data = {
                mode: 'verilog',
                lastModified: new Date().toISOString(),
                files: this.importedFiles
            };

            await window.electronAPI.writeFile(
                fileModeJsonPath,
                JSON.stringify(data, null, 2)
            );

            this.fileModeJsonPath = fileModeJsonPath;
            console.log('Saved fileMode.json successfully');
        } catch (error) {
            console.error('Error saving fileMode.json:', error);
            this.showNotification('Failed to save file list', 'error');
        }
    }

    /**
     * Load imported files from fileMode.json
     */
    async loadFromJson() {
        if (!window.currentProjectPath) {
            console.error('No project path available');
            this.importedFiles = [];
            return;
        }

        try {
            const fileModeJsonPath = await window.electronAPI.joinPath(
                window.currentProjectPath,
                'fileMode.json'
            );

            const exists = await window.electronAPI.fileExists(fileModeJsonPath);
            
            if (!exists) {
                console.log('fileMode.json not found, starting fresh');
                this.importedFiles = [];
                return;
            }

            const content = await window.electronAPI.readFile(fileModeJsonPath);
            const data = JSON.parse(content);

            if (data.files && Array.isArray(data.files)) {
                this.importedFiles = data.files;
                this.sortFiles();
                console.log(`Loaded ${this.importedFiles.length} files from fileMode.json`);
            } else {
                this.importedFiles = [];
            }

            this.fileModeJsonPath = fileModeJsonPath;
        } catch (error) {
            console.error('Error loading fileMode.json:', error);
            this.importedFiles = [];
        }
    }

    /**
     * Render the file tree for Verilog Mode
     */
    renderFileTree() {
        if (!this.dropZone) return;

        // Clear existing content
        this.dropZone.innerHTML = '';
        this.dropZone.classList.add('verilog-mode-tree');

        if (this.importedFiles.length === 0) {
            this.renderEmptyState();
            return;
        }

        // Render each file
        this.importedFiles.forEach((file, index) => {
            const item = this.createFileItem(file, index);
            this.dropZone.appendChild(item);
        });
    }

    /**
     * Render empty state with instructions
     */
    renderEmptyState() {
        const emptyState = document.createElement('div');
        emptyState.className = 'file-mode-empty-state';
        emptyState.innerHTML = `
            <i class="fa-solid fa-file-import"></i>
            <p>Drag & drop files here</p>
            <span>Supported: .v, .txt, images</span>
        `;
        this.dropZone.appendChild(emptyState);
    }

    /**
     * Create a file tree item element
     */
    createFileItem(file, index) {
        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'file-tree-item file-mode-item';
        itemWrapper.setAttribute('data-index', index);
        itemWrapper.setAttribute('data-path', file.fullPath);

        const item = document.createElement('div');
        item.className = 'file-item';

        // File icon
        const icon = document.createElement('i');
        icon.className = this.getFileIcon(file.extension);
        item.appendChild(icon);

        // File name
        const name = document.createElement('span');
        name.textContent = file.name;
        name.className = 'file-name';
        item.appendChild(name);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'file-mode-delete-btn';
        deleteBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        deleteBtn.title = 'Remove file';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeFile(index);
        });
        item.appendChild(deleteBtn);

        // Click handler for .v files to open in editor
        if (file.extension === '.v') {
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => this.openVerilogFile(file));
        } else {
            item.style.cursor = 'default';
        }

        itemWrapper.appendChild(item);
        return itemWrapper;
    }

    /**
     * Get appropriate icon for file type
     */
    getFileIcon(extension) {
        const iconMap = {
            '.v': 'fa-solid fa-microchip',
            '.txt': 'fa-solid fa-file-lines',
            '.png': 'fa-solid fa-file-image',
            '.jpg': 'fa-solid fa-file-image',
            '.jpeg': 'fa-solid fa-file-image',
            '.gif': 'fa-solid fa-file-image',
            '.svg': 'fa-solid fa-file-image'
        };
        return iconMap[extension] || 'fa-solid fa-file';
    }

    /**
     * Open Verilog file in Monaco Editor
     */
    async openVerilogFile(file) {
        try {
            const content = await window.electronAPI.readFile(file.fullPath);
            TabManager.addTab(file.fullPath, content);
        } catch (error) {
            console.error('Error opening file:', error);
            this.showNotification(`Failed to open ${file.name}`, 'error');
        }
    }

    /**
     * Remove file from imported files list
     */
    async removeFile(index) {
        const file = this.importedFiles[index];
        
        if (!file) return;

        // Close tab if file is open
        TabManager.closeTab(file.fullPath);

        // Remove from list
        this.importedFiles.splice(index, 1);

        // Save and re-render
        await this.saveToJson();
        this.renderFileTree();

        this.showNotification(`Removed: ${file.name}`, 'info');
    }

    /**
     * Enter Verilog Mode
     */
    async enterVerilogMode() {
        console.log('Entering Verilog Mode');
        this.isVerilogMode = true;
        
        // Load files from JSON
        await this.loadFromJson();
        
        // Render the tree
        this.renderFileTree();
        
        // Add visual indicators
        if (this.dropZone) {
            this.dropZone.classList.add('verilog-mode-active');
        }
        if (this.fileTreeContainer) {
            this.fileTreeContainer.classList.add('verilog-mode-active');
        }
    }

    /**
     * Exit Verilog Mode
     */
    exitVerilogMode() {
        console.log('Exiting Verilog Mode');
        this.isVerilogMode = false;
        
        // Remove visual indicators
        if (this.dropZone) {
            this.dropZone.classList.remove('verilog-mode-active', 'drag-over', 'verilog-mode-tree');
        }
        if (this.fileTreeContainer) {
            this.fileTreeContainer.classList.remove('verilog-mode-active');
        }
        
        // Clear the tree (it will be restored by fileTreeManager)
        if (this.dropZone) {
            this.dropZone.innerHTML = '';
        }
    }

    /**
     * Show notification to user
     */
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `file-mode-notification notification-${type}`;
        
        const icon = type === 'success' ? 'fa-check-circle' :
                     type === 'error' ? 'fa-exclamation-circle' :
                     type === 'warning' ? 'fa-exclamation-triangle' :
                     'fa-info-circle';
        
        notification.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <span>${message}</span>
        `;

        document.body.appendChild(notification);

        // Trigger animation
        setTimeout(() => notification.classList.add('show'), 10);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    /**
     * Clear all imported files
     */
    async clearAllFiles() {
        if (this.importedFiles.length === 0) return;

        const confirmed = confirm('Are you sure you want to remove all imported files?');
        if (!confirmed) return;

        // Close all tabs
        this.importedFiles.forEach(file => {
            TabManager.closeTab(file.fullPath);
        });

        this.importedFiles = [];
        await this.saveToJson();
        this.renderFileTree();
        
        this.showNotification('All files removed', 'info');
    }

    /**
     * Get current imported files
     */
    getImportedFiles() {
        return [...this.importedFiles];
    }

    /**
     * Check if currently in Verilog Mode
     */
    isInVerilogMode() {
        return this.isVerilogMode;
    }
}

// Create and export singleton instance
const fileModeManager = new FileModeManager();
export { fileModeManager };