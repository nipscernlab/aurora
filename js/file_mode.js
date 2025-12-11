/**
 * =====================================================================================
 * Aurora IDE - Verilog Mode File Manager
 * Handles Verilog Mode file tree reading directly from projectOriented.json
 * =====================================================================================
 */

/* eslint-disable no-undef */
import { TabManager } from './tab_manager.js';

const pathUtils = {
    basename: (filePath) => {
        return filePath.split(/[\\/]/).pop();
    }
};

class VerilogModeManager {
    constructor() {
        // Configuration - Points to the main project config
        this.CONFIG_FILENAME = 'projectOriented.json';
        this.ALLOWED_EXTENSIONS = ['.v', '.sv', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg'];
        
        // State management
        this.verilogFiles = [];
        this.isVerilogModeActive = false;
        this.currentProjectPath = null;
        
        // DOM element cache
        this.elements = {};
        
        // Bind methods
        this.preventDefaults = this.preventDefaults.bind(this);
        this.handleDragEnter = this.handleDragEnter.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleTreeContextMenu = this.handleTreeContextMenu.bind(this);
        this.createNewFile = this.createNewFile.bind(this);
        this.deleteFile = this.deleteFile.bind(this);

        // Initialize
        this.init();
    }
    
    /**
     * Initialize the Verilog Mode Manager
     */
    async init() {
        try {
            // Wait for DOM to be fully ready
            if (document.readyState === 'loading') {
                await new Promise(resolve => {
                    document.addEventListener('DOMContentLoaded', resolve, { once: true });
                });
            }
            
            this.cacheElements();
            this.setupEventListeners();
            this.injectStyles();
            console.log('✅ Verilog Mode Manager initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Verilog Mode Manager:', error);
        }
    }

    setupHierarchyToggle() {
        const toggleButton = document.getElementById('alternate-tree-toggle');
        if (!toggleButton) return;
        
        // Only enable toggle after successful compilation logic is handled elsewhere
        if (typeof TreeViewState !== 'undefined') {
            TreeViewState.disableToggle();
        }
    }
    
    /**
     * Cache all DOM elements
     */
    cacheElements() {
        this.elements = {
            fileTree: document.getElementById('file-tree'),
            fileTreeContainer: document.querySelector('.file-tree-container'),
            openHdlButton: document.getElementById('open-hdl-button'),
            refreshButton: document.getElementById('refresh-button'),
            // References the Checkbox/Toggle 
            compileSimulateToggle: document.getElementById('Verilog Mode'),
            processorModeRadio: document.getElementById('Processor Mode'),
            projectModeRadio: document.getElementById('Project Mode')
        };
        
        console.log('📦 Cached elements:', {
            fileTree: !!this.elements.fileTree,
            compileSimulateToggle: !!this.elements.compileSimulateToggle
        });
    }
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Handle Compile & Simulate Toggle Logic
        // UNCHECKED (Off) = Verilog Mode Active (Compile Only)
        // CHECKED (On) = Simulation Enabled (Full Pipeline) -> Deactivate Verilog Mode UI
        if (this.elements.compileSimulateToggle) {
            // Check initial state
            if (!this.elements.compileSimulateToggle.checked) {
                this.activateVerilogMode();
            }

            this.elements.compileSimulateToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.deactivateVerilogMode();
                } else {
                    this.activateVerilogMode();
                }
            });
        }
        
        // Keep listeners for other modes
        if (this.elements.processorModeRadio) {
            this.elements.processorModeRadio.addEventListener('change', (e) => {
                if (e.target.checked) this.deactivateVerilogMode();
            });
        }
        
        if (this.elements.projectModeRadio) {
            this.elements.projectModeRadio.addEventListener('change', (e) => {
                if (e.target.checked) this.deactivateVerilogMode();
            });
        }

        if (this.elements.fileTree) {
            this.elements.fileTree.addEventListener('contextmenu', this.handleTreeContextMenu);
        }

        this.elements.openHdlButton?.addEventListener('click', () => {
            if (this.isVerilogModeActive) {
                this.handleImportClick();
            }
        });
        
        this.elements.refreshButton?.addEventListener('click', () => {
            if (this.isVerilogModeActive) {
                this.refreshVerilogTree();
            }
        });
        
        this.setupDragAndDrop();
    }

    /**
     * Setup drag and drop functionality
     */
    setupDragAndDrop() {
        const dropArea = this.elements.fileTree;
        if (!dropArea) return;
        
        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, this.preventDefaults, false);
            document.body.addEventListener(eventName, this.preventDefaults, false);
        });
        
        // Handle drag enter
        dropArea.addEventListener('dragenter', this.handleDragEnter, false);
        
        // Handle drag over
        dropArea.addEventListener('dragover', (e) => {
            if (this.isVerilogModeActive) {
                e.preventDefault();
                dropArea.classList.add('verilog-dragover');
            }
        }, false);
        
        // Handle drag leave
        dropArea.addEventListener('dragleave', this.handleDragLeave, false);
        
        // Handle drop
        dropArea.addEventListener('drop', this.handleDrop, false);
    }
    
    /**
     * Prevent default drag behaviors
     */
    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    /**
     * Handle drag enter
     */
    handleDragEnter() {
        if (this.isVerilogModeActive) {
            this.elements.fileTree.classList.add('verilog-dragover');
        }
    }
    
    /**
     * Handle drag leave
     */
    handleDragLeave(e) {
        if (this.isVerilogModeActive) {
            const rect = this.elements.fileTree.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX >= rect.right ||
                e.clientY < rect.top || e.clientY >= rect.bottom) {
                this.elements.fileTree.classList.remove('verilog-dragover');
            }
        }
    }
    
    /**
     * Handle file drop
     */
    async handleDrop(e) {
        this.elements.fileTree.classList.remove('verilog-dragover');
        
        if (!this.isVerilogModeActive) return;
        
        const droppedFiles = e.dataTransfer.files;
        
        if (!droppedFiles || droppedFiles.length === 0) {
            this.showNotification('No files dropped', 'warning', 2000);
            return;
        }
        
        const filesWithPath = [];
        
        for (let i = 0; i < droppedFiles.length; i++) {
            const file = droppedFiles[i];
            
            let filePath = window.electronAPI.getPathForFile(file);
            
            if (!filePath || filePath === '') {
                console.warn('Cannot get path for file:', file.name);
                this.showNotification(
                    `Cannot get path for "${file.name}". Try using Open HDL button.`, 
                    'warning', 
                    3000
                );
                continue;
            }
            
            filePath = filePath.replace(/\//g, '\\');
            
            const ext = this.getFileExtension(file.name);
            if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
                this.showNotification(
                    `"${file.name}" has unsupported extension. Only .v, .txt and images allowed.`,
                    'warning',
                    3000
                );
                continue;
            }
            
            try {
                const exists = await window.electronAPI.fileExists(filePath);
                
                if (!exists) {
                    this.showNotification(
                        `File does not exist: ${filePath}`, 
                        'warning', 
                        3000
                    );
                    continue;
                }
                
                filesWithPath.push({
                    name: file.name,
                    path: filePath,
                    isTopLevel: false,
                });
                
            } catch (error) {
                console.error(`Error validating file:`, error);
                this.showNotification(
                    `Error validating "${file.name}"`, 
                    'error', 
                    3000
                );
            }
        }
        
        if (filesWithPath.length > 0) {
            await this.importFiles(filesWithPath);
        }
    }
    
    /**
     * Handle import button click
     */
    async handleImportClick() {
        try {
            const filters = [
                { name: 'Verilog Files', extensions: ['v', 'sv'] },
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg'] },
                { name: 'All Files', extensions: ['*'] }
            ];
            
            const result = await window.electronAPI.selectFilesWithPath({
                title: 'Select Verilog Mode Files',
                filters: filters,
                properties: ['openFile', 'multiSelections']
            });
            
            if (!result.canceled && result.files.length > 0) {
                await this.importFiles(result.files);
            }
        } catch (error) {
            console.error('Error selecting files:', error);
            this.showNotification('Error selecting files', 'error', 3000);
        }
    }
    
    
    /**
     * Sort files: Top Level first, then alphabetically
     */
    sortFilesAlphabetically() {
        this.verilogFiles.sort((a, b) => {
            // Top Level files come first
            if (a.isTopLevel && !b.isTopLevel) return -1;
            if (!a.isTopLevel && b.isTopLevel) return 1;
            
            // Finally alphabetical
            return a.name.localeCompare(b.name);
        });
    }
    
    /**
     * Get file extension with dot
     */
    getFileExtension(fileName) {
        const parts = fileName.toLowerCase().split('.');
        return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
    }
    
    /**
     * Get file icon based on extension
     */
    getFileIcon(fileName) {
        const ext = this.getFileExtension(fileName);
        
        if (ext === '.v' || ext === '.sv') {
            return 'fa-solid fa-microchip';
        } else if (ext === '.txt') {
            return 'fa-solid fa-file-lines';
        } else if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg'].includes(ext)) {
            return 'fa-solid fa-image';
        }
        
        return 'fa-solid fa-file';
    }
    
    /**
     * Activate Verilog Mode
     */
   async activateVerilogMode() {
        if (this.isVerilogModeActive) {
            console.log('⚠️ Verilog Mode already active');
            return;
        }
        
        console.log('🚀 Activating Verilog Mode...');
        
        this.isVerilogModeActive = true;
        
        // Get current project path
        try {
            const projectData = await window.electronAPI.getCurrentProject();
            if (projectData && typeof projectData === 'object' && projectData.projectPath) {
                this.currentProjectPath = projectData.projectPath;
                window.currentProjectPath = projectData.projectPath;
            } else if (typeof projectData === 'string') {
                this.currentProjectPath = projectData;
                window.currentProjectPath = projectData;
            }
            
            console.log('📂 Project path:', this.currentProjectPath);
        } catch (error) {
            console.error('Error getting project path:', error);
        }
        
        // Load configuration
        await this.loadConfiguration();
        
        // Render Verilog tree
        this.renderVerilogTree();
        
        // Setup hierarchy toggle
        this.setupHierarchyToggle();
        
        console.log('✅ Verilog Mode activated with', this.verilogFiles.length, 'files');
    }
    
    /**
     * Deactivate Verilog Mode
     */
    deactivateVerilogMode() {
        if (!this.isVerilogModeActive) {
            return;
        }
        
        console.log('🛑 Deactivating Verilog Mode...');
        
        this.isVerilogModeActive = false;
        
        // Clear file tree
        const fileTree = this.elements.fileTree;
        if (fileTree) {
            fileTree.classList.remove('verilog-mode-active', 'verilog-empty', 'verilog-dragover');
            fileTree.innerHTML = '';
        }
        
        // Trigger standard file tree refresh
        document.dispatchEvent(new Event('refresh-file-tree'));
        
        console.log('✅ Verilog Mode deactivated - standard tree restored');
    }
    
    /**
     * Render Verilog Mode tree
     */
    renderVerilogTree() {
        const fileTree = this.elements.fileTree;
        if (!fileTree) {
            console.error('❌ File tree element not found');
            return;
        }
        
        console.log('🎨 Rendering Verilog tree with', this.verilogFiles.length, 'files');
        
        // Clear existing content
        fileTree.innerHTML = '';
        
        // Add Verilog Mode class
        fileTree.classList.add('verilog-mode-active');
        fileTree.classList.remove('verilog-empty');
        
        // If no files, show empty state
        if (this.verilogFiles.length === 0) {
            fileTree.classList.add('verilog-empty');
            const emptyState = document.createElement('div');
            emptyState.className = 'verilog-empty-state';
            emptyState.innerHTML = `
                <i class="fa-solid fa-folder-open verilog-empty-icon"></i>
                <div class="verilog-empty-text">
                    No synthesizable files<br>
                    <strong>Drag and drop .v files here</strong>
                </div>
            `;
            fileTree.appendChild(emptyState);
            console.log('📭 Empty state displayed');
            return;
        }
        
        // Render each file
        this.verilogFiles.forEach((file, index) => {
            const fileItem = this.createFileItem(file, index);
            fileTree.appendChild(fileItem);
        });
        
        console.log('✅ Rendered', this.verilogFiles.length, 'file items');
    }
    
    /**
     * Create file item element
     */
    createFileItem(file, index) {
        const fileItem = document.createElement('div');
        fileItem.className = 'verilog-file-item';
        fileItem.dataset.fileIndex = index;
        fileItem.dataset.filePath = file.path;
        
        // Add special classes for top level
        if (file.isTopLevel) {
            fileItem.classList.add('top-level-file');
        }
        
        const icon = this.getFileIcon(file.name);
        
        // Build badges HTML
        let badgesHtml = '';
        if (file.isTopLevel) {
            badgesHtml += '<span class="file-badge top-level-badge" title="Top Level Module"><i class="fa-solid fa-layer-group"></i></span>';
        }
        
        fileItem.innerHTML = `
            <div class="verilog-file-info">
                <i class="${icon} verilog-file-icon"></i>
                <div class="verilog-file-name" title="${file.path}">${file.name}</div>
                ${badgesHtml}
            </div>
            <div class="verilog-file-actions">
                <button class="verilog-icon-btn delete-btn" 
                        data-index="${index}"
                        title="Remove file">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        
        // Add click handler to open .v files in Monaco Editor
        fileItem.style.cursor = 'pointer';
            fileItem.addEventListener('click', async (e) => {
                // Don't open if clicking the delete button or context menu actions
                if (e.target.closest('.delete-btn')) return;

                try {
                    const content = await window.electronAPI.readFile(file.path);
                    TabManager.addTab(file.path, content);
                    console.log('📝 Opened file in editor:', file.name);
                } catch (error) {
                    console.error('Error opening file:', error);
                    this.showNotification(`Error opening file: ${file.name}`, 'error', 3000);
                }
            });
        
        // Add context menu handler
        fileItem.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showContextMenu(e, file, index);
        });
        
        // Add delete button handler
        const deleteBtn = fileItem.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.removeFile(index);
        });
        
        return fileItem;
    }
    
    /**
     * Show context menu for file
     */
    showContextMenu(event, file, index) {
        // Remove any existing context menu
        this.closeContextMenu();
        
        const menu = document.createElement('div');
        menu.className = 'verilog-context-menu';
        menu.id = 'verilog-context-menu';
        
        // Determine menu options
        const topLevelOption = file.isTopLevel
            ? { text: 'Remove Top Level', icon: 'fa-layer-group', action: 'remove-top-level' }
            : { text: 'Set as Top Level', icon: 'fa-layer-group', action: 'set-top-level', disabled: false }; // Allow switching top level
        

        menu.innerHTML = `
            <div class="context-menu-item ${topLevelOption.disabled ? 'disabled' : ''}" data-action="${topLevelOption.action}">
                <i class="fa-solid ${topLevelOption.icon}"></i>
                <span>${topLevelOption.text}</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item delete-item" data-action="delete">
                <i class="fa-solid fa-trash"></i>
                <span>Remove File</span>
            </div>
        `;
        
        // Position menu
        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';
        
        document.body.appendChild(menu);
        
        // Adjust position if menu goes off screen
        setTimeout(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                menu.style.left = (event.pageX - rect.width) + 'px';
            }
            if (rect.bottom > window.innerHeight) {
                menu.style.top = (event.pageY - rect.height) + 'px';
            }
            menu.classList.add('show');
        }, 10);
        
        // Handle menu item clicks
        menu.addEventListener('click', async (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item || item.classList.contains('disabled')) return;
            
            const action = item.getAttribute('data-action');
            await this.handleContextMenuAction(action, file, index);
            this.closeContextMenu();
        });
        
        // Close menu on outside click
        setTimeout(() => {
            document.addEventListener('click', this.closeContextMenu.bind(this), { once: true });
        }, 100);
    }
    async syncToProjectConfig() {
    try {
        let projectPath = this.currentProjectPath || window.currentProjectPath;
        
        if (!projectPath) {
            const projectData = await window.electronAPI.getCurrentProject();
            if (projectData && projectData.projectPath) {
                projectPath = projectData.projectPath;
            }
        }
        
        if (!projectPath) {
            console.error('❌ Project path not available for sync');
            return;
        }

        const configPath = await window.electronAPI.joinPath(projectPath, this.CONFIG_FILENAME);
        
        // Read existing config
        let currentConfig = {};
        try {
            if (await window.electronAPI.fileExists(configPath)) {
                const content = await window.electronAPI.readFile(configPath);
                currentConfig = JSON.parse(content);
            }
        } catch (err) {
            console.warn('Could not read existing config:', err);
        }

        // Map verilogFiles to synthesizableFiles format
        const synthesizableFiles = this.verilogFiles.map(file => ({
            name: file.name,
            path: file.path,
            isTopLevel: file.isTopLevel || false
        }));

        // Determine top level file
        const topFile = this.verilogFiles.find(f => f.isTopLevel);
        const topLevelPath = topFile ? topFile.path : "";

        // Update config
        currentConfig.synthesizableFiles = synthesizableFiles;
        currentConfig.topLevelFile = topLevelPath;

        // Ensure other arrays exist
        if (!currentConfig.testbenchFiles) currentConfig.testbenchFiles = [];
        if (!currentConfig.gtkwFiles) currentConfig.gtkwFiles = [];
        if (!currentConfig.processors) currentConfig.processors = [];

        // Write back
        await window.electronAPI.writeFile(configPath, JSON.stringify(currentConfig, null, 2));
        
        console.log('💾 Synced to projectOriented.json');
        
    } catch (error) {
        console.error('❌ Error syncing to project config:', error);
    }
}

   async handleTreeContextMenu(event) {
        event.preventDefault();

        if (!this.isVerilogModeActive) return;
        
        if (event.target.closest('.verilog-file-item')) return;
        if (event.target.closest('button')) return;
        
        this.closeCreateMenu();
        
        const menu = document.createElement('div');
        menu.className = 'verilog-create-menu';
        menu.id = 'verilog-create-menu';
        
        menu.innerHTML = `
            <div class="create-menu-item" data-action="create-file">
                <i class="fa-solid fa-file-code"></i>
                <span>New Verilog File (.v)</span>
            </div>
        `;
        
        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';
        
        document.body.appendChild(menu);
        
        setTimeout(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                menu.style.left = (event.pageX - rect.width) + 'px';
            }
            if (rect.bottom > window.innerHeight) {
                menu.style.top = (event.pageY - rect.height) + 'px';
            }
            menu.classList.add('show'); 
        }, 10);
        
        menu.addEventListener('click', async (e) => {
            const item = e.target.closest('.create-menu-item');
            if (!item) return;
            
            const action = item.getAttribute('data-action');
            if (action === 'create-file') {
                await this.createNewFile();
            }
            this.closeCreateMenu();
        });
        
        const closeOnClickOutside = (e) => {
            if (!e.target.closest('#verilog-create-menu')) {
                this.closeCreateMenu();
                document.removeEventListener('click', closeOnClickOutside);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeOnClickOutside);
        }, 100);
    }

  /**
 * Create new file with sync
 */
async createNewFile() {
    const fileName = await this.showFileNameDialog();
    
    if (!fileName) return;
    
    const invalidChars = /[<>:"/\\|?*]/;
    const nameWithoutExt = fileName.replace('.v', '');
    if (invalidChars.test(nameWithoutExt)) {
        this.showNotification('File name contains invalid characters', 'error', 3000);
        return;
    }
    
    try {
        const result = await window.electronAPI.showSaveDialog({
            title: 'Save New Verilog File',
            defaultPath: fileName,
            filters: [
                { name: 'Verilog Files', extensions: ['v'] }
            ],
            properties: ['createDirectory', 'showOverwriteConfirmation']
        });
        
        if (result.canceled || !result.filePath) return;
        
        const filePath = result.filePath;
        const finalPath = filePath.endsWith('.v') ? filePath : filePath + '.v';
        const finalFileName = this.basename(finalPath);
        
        await window.electronAPI.writeFile(finalPath, '// New Verilog file\n');
        
        const newFile = {
            name: finalFileName,
            path: finalPath,
            isTopLevel: false,
        };
        
        this.verilogFiles.push(newFile);
        this.sortFilesAlphabetically();
        await this.saveConfiguration();
        this.renderVerilogTree();
        
        this.showNotification(`Created "${finalFileName}" successfully`, 'success', 2000);
        
        try {
            const content = await window.electronAPI.readFile(finalPath);
            if (typeof TabManager !== 'undefined') {
                TabManager.addTab(finalPath, content);
            }
        } catch (error) {
            console.error('Error opening new file:', error);
        }
        
    } catch (error) {
        console.error('Error creating file:', error);
        this.showNotification('Error creating file', 'error', 3000);
    }
}

    /**
     * Show file name input dialog
     */
    showFileNameDialog() {
        return new Promise((resolve) => {
            const modalHTML = `
                <div class="file-name-modal" id="file-name-modal">
                    <div class="file-name-modal-content">
                        <div class="file-name-modal-header">
                            <div class="file-name-modal-icon">
                                <i class="fa-solid fa-file-code"></i>
                            </div>
                            <h3 class="file-name-modal-title">New Verilog File</h3>
                        </div>
                        <div class="file-name-modal-body">
                            <label for="new-file-name">File Name:</label>
                            <div class="file-name-input-wrapper">
                                <input 
                                    type="text" 
                                    id="new-file-name" 
                                    class="file-name-input" 
                                    placeholder="module_name"
                                />
                                <span class="file-extension">.v</span>
                            </div>
                        </div>
                        <div class="file-name-modal-actions">
                            <button class="file-name-btn cancel" data-action="cancel">Cancel</button>
                            <button class="file-name-btn create" data-action="create">Create</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            const modal = document.getElementById('file-name-modal');
            const input = document.getElementById('new-file-name');
            
            setTimeout(() => {
                input.focus();
                input.select();
            }, 100);
            
            const closeModal = (result) => {
                modal.classList.remove('show');
                setTimeout(() => {
                    modal.remove();
                    resolve(result);
                }, 200);
            };
            
            modal.addEventListener('click', (e) => {
                const action = e.target.getAttribute('data-action');
                if (action === 'cancel') {
                    closeModal(null);
                } else if (action === 'create') {
                    const fileName = input.value.trim();
                    if (fileName) {
                        closeModal(fileName + '.v');
                    }
                }
            });
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const fileName = input.value.trim();
                    if (fileName) {
                        closeModal(fileName + '.v');
                    }
                } else if (e.key === 'Escape') {
                    closeModal(null);
                }
            });
            
            setTimeout(() => modal.classList.add('show'), 10);
        });
    }


    /**
 * Delete file from disk and sync
 */
async deleteFile(index) {
    if (!this.verilogFiles[index]) return;
    
    const file = this.verilogFiles[index];
    const fileName = file.name;
    
    const confirmed = await this.showDeleteConfirmDialog(fileName);
    
    if (!confirmed) return;
    
    try {
        await window.electronAPI.deleteFile(file.path);
        
        this.verilogFiles.splice(index, 1);
        await this.saveConfiguration();
        this.renderVerilogTree();
        
        this.showNotification(`Deleted "${fileName}" successfully`, 'success', 2000);
        
        if (typeof TabManager !== 'undefined' && TabManager.tabs && TabManager.tabs.has(file.path)) {
            TabManager.closeTab(file.path);
        }
        
    } catch (error) {
        console.error('Error deleting file:', error);
        
        if (error.code === 'ENOENT') {
            this.verilogFiles.splice(index, 1);
            await this.saveConfiguration();
            this.renderVerilogTree();
            this.showNotification(`File "${fileName}" was already deleted`, 'info', 2000);
        } else {
            this.showNotification(`Error deleting "${fileName}": ${error.message}`, 'error', 3000);
        }
    }
}

/**
 * Helper to extract basename
 */
basename(filePath) {
    return filePath.split(/[\\/]/).pop();
}
    /**
     * Show delete confirmation dialog
     */
   showDeleteConfirmDialog(fileName) {
    return new Promise((resolve) => {
        const modalHTML = `
            <div class="confirm-modal delete-confirm-modal" id="delete-confirm-modal">
                <div class="confirm-modal-content">
                    <div class="confirm-modal-header">
                        <div class="confirm-modal-icon delete-icon">⚠️</div>
                        <h3 class="confirm-modal-title">Delete File</h3>
                    </div>
                    <div class="confirm-modal-message">
                        Are you sure you want to delete "<strong>${fileName}</strong>"?<br>
                        <span style="color: var(--status-error); font-weight: 600;">This action cannot be undone.</span>
                    </div>
                    <div class="confirm-modal-actions">
                        <button class="confirm-btn cancel" data-action="cancel">Cancel</button>
                        <button class="confirm-btn delete" data-action="delete">Delete</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('delete-confirm-modal');
        
        const closeModal = (result) => {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 200);
        };
        
        modal.addEventListener('click', (e) => {
            const action = e.target.getAttribute('data-action');
            if (action === 'cancel') {
                closeModal(false);
            } else if (action === 'delete') {
                closeModal(true);
            }
        });
        
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', handleEscape);
                closeModal(false);
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        setTimeout(() => modal.classList.add('show'), 10);
    });
}

    /**
     * Close create menu
     */
    closeCreateMenu() {
        const existingMenu = document.getElementById('verilog-create-menu');
        if (existingMenu) {
            existingMenu.classList.remove('show');
            setTimeout(() => existingMenu.remove(), 200);
        }
    }
        
    /**
     * Handle context menu actions
     */
    async handleContextMenuAction(action, file, index) {
        switch (action) {
            case 'set-top-level':
                this.verilogFiles.forEach(f => f.isTopLevel = false);
                this.verilogFiles[index].isTopLevel = true;
                console.log('🎯 Set as Top Level:', file.name);
                this.showNotification(`"${file.name}" set as Top Level`, 'success', 2000);
                break;
                
            case 'remove-top-level':
                this.verilogFiles[index].isTopLevel = false;
                console.log('❌ Removed Top Level:', file.name);
                this.showNotification(`Removed Top Level from "${file.name}"`, 'success', 2000);
                break;
                
            case 'delete':
                await this.deleteFile(index);
                break;
        }
        if (action !== 'delete') {
            this.sortFilesAlphabetically();
            await this.saveConfiguration();
            this.renderVerilogTree();
        }
    }
    
    /**
     * Close context menu
     */
    closeContextMenu() {
        const existingMenu = document.getElementById('verilog-context-menu');
        if (existingMenu) {
            existingMenu.classList.remove('show');
            setTimeout(() => existingMenu.remove(), 200);
        }
    }
    
/**
 * Toggle file top level status with sync
 */
toggleFileStar(index, type) {
    let files = this.verilogFiles;
    let targetFile = files[index];
    
    if (!targetFile) return;
    
    // If marking as top level, unmark all others
    if (!targetFile.isTopLevel) {
        files.forEach(file => {
            if (file !== targetFile) {
                file.isTopLevel = false;
            }
        });
    }
    
    // Toggle top level status
    targetFile.isTopLevel = !targetFile.isTopLevel;
    
    // Update UI
    setTimeout(() => {
        this.updateFileList('synthesizable');
    }, 100);
    
    // Sync to projectOriented.json
    this.saveConfiguration();
    
    const action = targetFile.isTopLevel ? 'set as top level' : 'removed from top level';
    this.showNotification(`File "${targetFile.name}" ${action}`, 'success', 2000);
}

/**
 * Remove file with sync
 */
async removeFile(index, type) {
    if (!this.verilogFiles[index]) return;
    
    const fileName = this.verilogFiles[index].name;
    const fileItem = document.querySelector(`.verilog-file-item[data-file-index="${index}"]`);
    
    if (fileItem) {
        fileItem.classList.add('verilog-file-animate-out');
        
        setTimeout(async () => {
            this.verilogFiles.splice(index, 1);
            await this.saveConfiguration();
            this.renderVerilogTree();
            this.showNotification(`Removed "${fileName}"`, 'success', 2000);
        }, 300);
    } else {
        this.verilogFiles.splice(index, 1);
        await this.saveConfiguration();
        this.renderVerilogTree();
        this.showNotification(`Removed "${fileName}"`, 'success', 2000);
    }
}

/**
 * Import files with sync
 */
async importFiles(files, type) {
    const validFiles = [];
    const errors = [];
    
    for (let file of files) {
        if (!file.path || file.path === '') {
            errors.push(`"${file.name}" has no path information`);
            continue;
        }
        
        const ext = this.getFileExtension(file.name);
        
        if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
            errors.push(`"${file.name}" has unsupported extension ${ext}`);
            continue;
        }
        
        if (this.verilogFiles.some(f => f.path === file.path)) {
            errors.push(`"${file.name}" already exists`);
            continue;
        }
        
        validFiles.push({
            name: file.name,
            path: file.path,
            isTopLevel: false,
        });
    }
    
    if (errors.length > 0) {
        errors.forEach(error => {
            this.showNotification(error, 'warning', 2500);
        });
    }
    
    if (validFiles.length === 0) {
        if (errors.length === 0) {
            this.showNotification('No valid files to import', 'warning', 3000);
        }
        return;
    }
    
    this.verilogFiles.push(...validFiles);
    this.sortFilesAlphabetically();
    await this.saveConfiguration();
    this.renderVerilogTree();
    
    this.showNotification(
        `Successfully added ${validFiles.length} file(s)`, 
        'success', 
        2000
    );
}
    /**
     * Save configuration to projectOriented.json
     * Updates only synthesizableFiles and topLevelFile without affecting other sections
     */
async saveConfiguration() {
    try {
        let projectPath = this.currentProjectPath || window.currentProjectPath;
        
        if (!projectPath) {
            const projectData = await window.electronAPI.getCurrentProject();
            if (projectData && projectData.projectPath) {
                projectPath = projectData.projectPath;
            }
        }
        
        if (!projectPath) {
            console.error('❌ Project path not available. Cannot save configuration.');
            return;
        }

        const configPath = await window.electronAPI.joinPath(projectPath, this.CONFIG_FILENAME);
        
        // Read existing configuration to preserve other fields
        let currentConfig = {};
        try {
            if (await window.electronAPI.fileExists(configPath)) {
                const content = await window.electronAPI.readFile(configPath);
                currentConfig = JSON.parse(content);
            }
        } catch (err) {
            console.warn('Could not read existing config, creating new one.', err);
        }

        // Map internal verilogFiles to synthesizableFiles format
        const synthesizableFiles = this.verilogFiles.map(file => ({
            name: file.name,
            path: file.path,
            isTopLevel: file.isTopLevel || false
        }));

        // Determine top level file path
        const topFile = this.verilogFiles.find(f => f.isTopLevel);
        const topLevelPath = topFile ? topFile.path : "";

        // Update specific fields while preserving others
        currentConfig.synthesizableFiles = synthesizableFiles;
        currentConfig.topLevelFile = topLevelPath;

        // Ensure other required arrays exist
        if (!currentConfig.testbenchFiles) currentConfig.testbenchFiles = [];
        if (!currentConfig.gtkwFiles) currentConfig.gtkwFiles = [];
        if (!currentConfig.processors) currentConfig.processors = [];
        if (!currentConfig.iverilogFlags) currentConfig.iverilogFlags = '';
        if (!currentConfig.simuDelay) currentConfig.simuDelay = '200000';
        if (!currentConfig.showArraysInGtkwave) currentConfig.showArraysInGtkwave = 0;

        // Write back to file
        await window.electronAPI.writeFile(configPath, JSON.stringify(currentConfig, null, 2));
        
        console.log('💾 Verilog Mode configuration saved to projectOriented.json');
        
    } catch (error) {
        console.error('❌ Error saving Verilog Mode configuration:', error);
    }
}

    
/**
 * Load configuration from projectOriented.json
 */
async loadConfiguration() {
    try {
        this.verilogFiles = [];
        
        let projectPath = this.currentProjectPath || window.currentProjectPath;
        
        if (!projectPath) {
            const projectData = await window.electronAPI.getCurrentProject();
            if (projectData && projectData.projectPath) {
                projectPath = projectData.projectPath;
            }
        }
        
        if (!projectPath) {
            console.error('❌ Project path not available');
            return;
        }
        
        const configPath = await window.electronAPI.joinPath(projectPath, this.CONFIG_FILENAME);
        const configExists = await window.electronAPI.fileExists(configPath);
        
        if (configExists) {
            const configContent = await window.electronAPI.readFile(configPath);
            const configData = JSON.parse(configContent);
            
            console.log('📖 Loading configuration from:', configPath);
            
            if (configData.synthesizableFiles && Array.isArray(configData.synthesizableFiles)) {
                for (const fileData of configData.synthesizableFiles) {
                    if (fileData.path && fileData.name) {
                        try {
                            const exists = await window.electronAPI.fileExists(fileData.path);
                            
                            if (exists) {
                                this.verilogFiles.push({
                                    name: fileData.name,
                                    path: fileData.path,
                                    isTopLevel: fileData.isTopLevel || false,
                                });
                            } else {
                                console.warn(`⚠️ File no longer exists: ${fileData.path}`);
                            }
                        } catch (error) {
                            console.error(`❌ Error validating file ${fileData.path}:`, error);
                        }
                    }
                }
            }
            
            this.sortFilesAlphabetically();
            
            console.log('✅ Loaded', this.verilogFiles.length, 'files from configuration');
        } else {
            console.log('📁 projectOriented.json not found, starting with empty list');
        }
    } catch (error) {
        console.error('❌ Error loading Verilog Mode configuration:', error);
    }
}

    /**
     * Refresh Verilog Mode tree
     */
    async refreshVerilogTree() {
        console.log('🔄 Refreshing Verilog Mode tree...');
        await this.loadConfiguration();
        this.renderVerilogTree();
        this.showNotification('Verilog Mode refreshed', 'success', 2000);
    }
    
    /**
     * Inject styles
     */
    injectStyles() {
        const styleId = 'verilog-mode-styles';
        
        const oldStyle = document.getElementById(styleId);
        if (oldStyle) {
            oldStyle.remove();
        }
        
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* Verilog Mode Active State */
            .file-tree.verilog-mode-active {
                position: relative;
                min-height: 200px;
            }
            
            /* Drag Over State */
            .file-tree.verilog-dragover {
                background: var(--accent-subtle-bg);
                border: 2px dashed var(--accent-primary);
                border-radius: var(--radius-md);
            }
            
            .file-tree.verilog-dragover::after {
                content: 'Drop files here (.v, .txt, images)';
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: var(--text-lg);
                font-weight: var(--font-semibold);
                color: var(--accent-primary);
                background: var(--bg-primary);
                padding: var(--space-4) var(--space-6);
                border-radius: var(--radius-lg);
                box-shadow: var(--shadow-lg);
                pointer-events: none;
                z-index: 100;
            }
            
            /* Empty State */
            .verilog-empty-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: var(--space-12) var(--space-4);
                text-align: center;
                color: var(--text-tertiary);
                gap: var(--space-4);
                min-height: 300px;
            }
            
            .verilog-empty-icon {
                font-size: 4rem;
                opacity: 0.4;
                color: var(--accent-secondary);
            }
            
            .verilog-empty-text {
                font-size: var(--text-base);
                line-height: var(--leading-relaxed);
                max-width: 300px;
            }
            
            .verilog-empty-text strong {
                color: var(--text-primary);
                font-weight: var(--font-semibold);
            }
            
            /* File Item */
            .verilog-file-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: var(--space-3) var(--space-4);
                background: var(--bg-tertiary);
                border: 1px solid var(--border-primary);
                border-radius: var(--radius-md);
                margin-bottom: var(--space-2);
                transition: all var(--transition-fast);
                opacity: 0;
                transform: translateY(-10px);
                animation: verilogSlideIn var(--transition-normal) forwards;
            }
            
            .verilog-file-item:hover {
                background: var(--bg-quaternary);
                border-color: var(--accent-secondary);
                transform: translateX(4px);
            }
            
            .verilog-file-item.verilog-file-animate-out {
                animation: verilogSlideOut var(--transition-normal) forwards;
            }
            
            @keyframes verilogSlideIn {
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            @keyframes verilogSlideOut {
                to {
                    opacity: 0;
                    transform: translateX(-30px);
                    height: 0;
                    padding-top: 0;
                    padding-bottom: 0;
                    margin-bottom: 0;
                    border: none;
                }
            }
            
            .verilog-file-info {
                display: flex;
                align-items: center;
                gap: var(--space-3);
                flex: 1;
                min-width: 0;
            }
            
            .verilog-file-icon {
                font-size: var(--text-xl);
                color: var(--accent-secondary);
                min-width: 24px;
                transition: color var(--transition-fast);
            }
            
            .verilog-file-item:hover .verilog-file-icon {
                color: var(--accent-primary);
            }
            
            .verilog-file-name {
                font-size: var(--text-sm);
                font-weight: var(--font-medium);
                color: var(--text-primary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .verilog-file-actions {
                display: flex;
                gap: var(--space-2);
            }
            
            .verilog-icon-btn {
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: transparent;
                border: none;
                border-radius: var(--radius-sm);
                color: var(--text-secondary);
                cursor: pointer;
                transition: all var(--transition-fast);
            }
            
            .verilog-icon-btn:hover {
                background: var(--overlay-hover);
                color: var(--text-primary);
            }
            
            .verilog-icon-btn.delete-btn:hover {
                background: var(--status-error-bg);
                color: var(--status-error);
            }
            
            /* Context Menu */
            .verilog-context-menu {
                position: fixed;
                background: var(--bg-elevated);
                border: 1px solid var(--border-primary);
                border-radius: var(--radius-md);
                box-shadow: var(--shadow-xl);
                padding: var(--space-2);
                min-width: 180px;
                z-index: 10000;
                opacity: 0;
                transform: scale(0.95);
                transition: opacity var(--transition-fast), transform var(--transition-fast);
            }
            
            .verilog-context-menu.show {
                opacity: 1;
                transform: scale(1);
            }
            
            .context-menu-item {
                display: flex;
                align-items: center;
                gap: var(--space-3);
                padding: var(--space-3) var(--space-4);
                border-radius: var(--radius-sm);
                cursor: pointer;
                transition: all var(--transition-fast);
                color: var(--text-primary);
                font-size: var(--text-sm);
            }
            
            .context-menu-item:hover:not(.disabled) {
                background: var(--overlay-hover);
                color: var(--accent-primary);
            }
            
            .context-menu-item.disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }
            
            .context-menu-item i {
                width: 16px;
                font-size: var(--text-base);
            }
            
            /* File Badges */
            .file-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 2px 6px;
                border-radius: var(--radius-sm);
                font-size: var(--text-xs);
                font-weight: var(--font-semibold);
                margin-left: var(--space-2);
            }
            
            .top-level-badge {
                background: var(--accent-subtle-bg);
                color: var(--accent-primary);
                border: 1px solid var(--accent-subtle-border);
            }
            
            
            /* Special file item styles */
            .verilog-file-item.top-level-file {
                border-left: 3px solid var(--accent-primary);
                background: var(--accent-subtle-bg);
            }

            .verilog-create-menu {
                position: fixed;
                background: var(--bg-elevated);
                border: 1px solid var(--border-primary);
                border-radius: var(--radius-md);
                box-shadow: var(--shadow-xl);
                padding: var(--space-2);
                min-width: 200px;
                z-index: 10000;
                opacity: 0;
                transform: scale(0.95);
                transition: opacity var(--transition-fast), transform var(--transition-fast);
            }

            .verilog-create-menu.show {
                opacity: 1;
                transform: scale(1);
            }

            .create-menu-item {
                display: flex;
                align-items: center;
                gap: var(--space-3);
                padding: var(--space-3) var(--space-4);
                border-radius: var(--radius-sm);
                cursor: pointer;
                transition: all var(--transition-fast);
                color: var(--text-primary);
                font-size: var(--text-sm);
            }

            .create-menu-item:hover {
                background: var(--overlay-hover);
                color: var(--accent-primary);
            }

            .create-menu-item i {
                width: 16px;
                font-size: var(--text-base);
            }

            /* File Name Modal */
           .file-name-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                opacity: 0;
                transition: opacity var(--transition-normal);
            }

            .file-name-modal.show {
                opacity: 1;
            }

            .file-name-modal-content {
                background: var(--bg-elevated);
                border-radius: var(--radius-lg);
                box-shadow: var(--shadow-xl);
                min-width: 400px;
                max-width: 90%;
                transform: scale(0.9);
                transition: transform var(--transition-normal);
            }

            .file-name-modal.show .file-name-modal-content {
                transform: scale(1);
            }

            .file-name-modal-header {
                display: flex;
                align-items: center;
                gap: var(--space-3);
                padding: var(--space-6);
                border-bottom: 1px solid var(--border-primary);
            }

            .file-name-modal-icon {
                font-size: 24px;
                color: var(--accent-primary);
            }

            .file-name-modal-title {
                margin: 0;
                font-size: var(--text-xl);
                font-weight: var(--font-semibold);
                color: var(--text-primary);
            }

            .file-name-modal-body {
                padding: var(--space-6);
            }

            .file-name-modal-body label {
                display: block;
                margin-bottom: var(--space-2);
                font-size: var(--text-sm);
                font-weight: var(--font-medium);
                color: var(--text-secondary);
            }

            .file-name-input-wrapper {
                display: flex;
                align-items: center;
                background: var(--bg-tertiary);
                border: 1px solid var(--border-primary);
                border-radius: var(--radius-md);
                transition: all var(--transition-fast);
            }

            .file-name-input-wrapper:focus-within {
                border-color: var(--accent-primary);
                box-shadow: 0 0 0 3px var(--accent-subtle-bg);
            }

            .file-name-input {
                flex: 1;
                padding: var(--space-3);
                background: transparent;
                border: none;
                color: var(--text-primary);
                font-size: var(--text-base);
                font-family: 'JetBrains Mono', monospace;
                outline: none;
            }

            .file-extension {
                padding-right: var(--space-3);
                color: var(--text-tertiary);
                font-size: var(--text-base);
                font-family: 'JetBrains Mono', monospace;
                user-select: none;
            }

            .file-name-modal-actions {
                display: flex;
                gap: var(--space-3);
                padding: var(--space-6);
                border-top: 1px solid var(--border-primary);
                justify-content: flex-end;
            }

            .file-name-btn {
                padding: var(--space-2) var(--space-4);
                border: none;
                border-radius: var(--radius-md);
                font-size: var(--text-sm);
                font-weight: var(--font-medium);
                cursor: pointer;
                transition: all var(--transition-fast);
            }

            .file-name-btn.cancel {
                background: var(--bg-tertiary);
                color: var(--text-primary);
            }

            .file-name-btn.cancel:hover {
                background: var(--bg-quaternary);
            }

            .file-name-btn.create {
                background: var(--accent-primary);
                color: white;
            }

            .file-name-btn.create:hover {
                background: var(--accent-secondary);
            }

            /* Delete Confirm Modal */
            .delete-confirm-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 100000;
                opacity: 0;
                transition: opacity var(--transition-normal);
            }

            .delete-confirm-modal.show {
                opacity: 1;
            }

            .confirm-modal .delete-icon {
                color: var(--status-error);
                font-size: 32px;
            }

            .confirm-btn.delete {
                background: var(--status-error);
                color: white;
                font-weight: 600;
            }

            .confirm-btn.delete:hover {
                background: #dc2626;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(220, 38, 38, 0.4);
            }

            .confirm-btn.cancel {
                background: var(--bg-tertiary);
                color: var(--text-primary);
            }

            .confirm-btn.cancel:hover {
                background: var(--bg-quaternary);
            }
        `;
        
        document.head.appendChild(style);
        console.log('🎨 Styles injected');
    }
    
    /**
     * Show notification
     */
    showNotification(message, type = 'info', duration = 3000) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type, duration);
            return;
        }
        
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// Create and export single instance
const verilogModeManager = new VerilogModeManager();

// Make globally accessible
window.verilogModeManager = verilogModeManager;

// Export
export { VerilogModeManager, verilogModeManager };