/**
 * =====================================================================================
 * Aurora IDE - Verilog Mode File Manager
 * Handles Verilog Mode file tree reading directly from projectOriented.json
 * =====================================================================================
 */

/* eslint-disable no-undef */
import { TabManager } from '../tabs/tab_manager.js';

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
        this.handleCategoryToggle = this.handleCategoryToggle.bind(this);
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
        this.closeContextMenu = this.closeContextMenu.bind(this); // ADD THIS LINE
        this.handleCategoryToggle = this.handleCategoryToggle.bind(this); // ADD THIS LINE
        
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
            // Styles live in css/tree/verilog_tree.css now — they used to be
            // injected at runtime via injectStyles(), which created two
            // problems: a third .confirm-modal definition that fought with
            // the canonical one, and a 600+ line CSS literal that couldn't
            // be edited without touching JS.
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
        // Render each file with toggle
    this.verilogFiles.forEach((file, index) => {
        const fileItem = this.createFileItem(file, index); // Changed
        fileTree.appendChild(fileItem);
    });

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
 * Enhanced createFileItem with two-state toggle and context menu
 */
createFileItem(file, index) {
    const fileItem = document.createElement('div');
    fileItem.className = 'verilog-file-item';
    fileItem.dataset.fileIndex = index;
    fileItem.dataset.filePath = file.path;
    
    const categoryClass = file.category === 'testbench' ? 'testbench' : 'synthesizable';
    fileItem.classList.add(categoryClass);
    
    if (file.isTopLevel) {
        fileItem.classList.add('top-level-file');
    }
    
    const icon = this.getFileIcon(file.name);
    const isTestbench = file.category === 'testbench';
    
    let badgesHtml = '';
    if (file.isTopLevel) {
        badgesHtml += '<span class="file-badge top-level-badge">Top Level</span>';
    }
    if (file.isMarkedTestbench) {
        badgesHtml += '<span class="file-badge testbench-badge">Testbench</span>';
    }
    
    fileItem.innerHTML = `
        <div class="verilog-file-content">
            <div class="verilog-file-info">
                <i class="${icon} verilog-file-icon"></i>
                <div class="verilog-file-name" title="${file.path}">${file.name}</div>
                ${badgesHtml}
            </div>
            <div class="verilog-file-actions">
                <div class="category-toggle-wrapper">
                    <button class="category-toggle ${categoryClass}" 
                         data-index="${index}"
                         title="${isTestbench ? 'Category: Testbench' : 'Category: Synthesizable'}">
                        <span class="toggle-slider"></span>
                    </button>
                </div>
                <button class="verilog-icon-btn delete-btn" 
                        data-index="${index}"
                        title="Remove file">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    `;
    
    const contentDiv = fileItem.querySelector('.verilog-file-content');
    const toggleButton = fileItem.querySelector('.category-toggle');
    const deleteBtn = fileItem.querySelector('.delete-btn');
    
    contentDiv.addEventListener('click', async (e) => {
        if (e.target.closest('.category-toggle-wrapper') || e.target.closest('.delete-btn')) {
            return;
        }
        
        try {
            const content = await window.electronAPI.readFile(file.path);
            TabManager.addTab(file.path, content);
        } catch (error) {
            console.error('Error opening file:', error);
            this.showNotification(`Error opening file: ${file.name}`, 'error', 3000);
        }
    });
    
    toggleButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.handleCategoryToggle(index);
    });
    
    fileItem.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(e, file, index);
    });
    
    deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.removeFile(index);
    });
    
    return fileItem;
}

/**
 * Handle category toggle between Synthesizable and Testbench
 */
async handleCategoryToggle(index) {
    if (!this.verilogFiles[index]) return;
    
    const file = this.verilogFiles[index];
    const newCategory = file.category === 'testbench' ? 'synthesizable' : 'testbench';
    
    // When switching category, remove special marks
    if (newCategory === 'synthesizable') {
        file.isMarkedTestbench = false;
    } else if (newCategory === 'testbench') {
        file.isTopLevel = false;
    }
    
    file.category = newCategory;
    
    await this.saveConfiguration();
    this.renderVerilogTree();
    
    this.showNotification(
        `"${file.name}" category changed to ${newCategory}`, 
        'info', 
        2000
    );
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
 * Enhanced context menu
 */
showContextMenu(event, file, index) {
    this.closeContextMenu();
    
    const menu = document.createElement('div');
    menu.className = 'verilog-context-menu';
    menu.id = 'verilog-context-menu';
    
    const isTopLevel = file.isTopLevel || false;
    const isMarkedTestbench = file.isMarkedTestbench || false;
    const isSynthesizable = file.category !== 'testbench';
    const isTestbench = file.category === 'testbench';
    
    // Top Level option (only for synthesizable files)
    const topLevelOption = isSynthesizable ? (
        isTopLevel
            ? { text: 'Remove Top Level', action: 'remove-top-level', disabled: false, show: true }
            : { text: 'Set as Top Level', action: 'set-top-level', disabled: false, show: true }
    ) : { show: false };
    
    // Testbench mark option (only for testbench files)
    const testbenchOption = isTestbench ? (
        isMarkedTestbench
            ? { text: 'Unmark Testbench', action: 'remove-testbench', disabled: false, show: true }
            : { text: 'Mark as Testbench', action: 'set-testbench', disabled: false, show: true }
    ) : { show: false };
    
    let menuItems = '';
    
    if (topLevelOption.show) {
        menuItems += `
            <div class="context-menu-item" data-action="${topLevelOption.action}">
                <span>${topLevelOption.text}</span>
            </div>
        `;
    }
    
    if (testbenchOption.show) {
        menuItems += `
            <div class="context-menu-item" data-action="${testbenchOption.action}">
                <span>${testbenchOption.text}</span>
            </div>
        `;
    }
    
    if (menuItems) {
        menuItems += '<div class="context-menu-divider"></div>';
    }
    
    menu.innerHTML = `
        ${menuItems}
        <div class="context-menu-item delete-item" data-action="delete">
            <span>Remove File</span>
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
        const item = e.target.closest('.context-menu-item');
        if (!item || item.classList.contains('disabled')) return;
        
        const action = item.getAttribute('data-action');
        await this.handleContextMenuAction(action, file, index);
        this.closeContextMenu();
    });
    
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
     * Show delete confirmation dialog. Routes through the canonical
     * showDialog (window.AuroraUI.dialog) so the look matches every other
     * confirm in the IDE — used to be a hand-rolled modal with its own CSS.
     */
   showDeleteConfirmDialog(fileName) {
        const dialog = window.AuroraUI?.dialog;
        if (typeof dialog !== 'function') {
            // Defensive fallback if dialog_manager hasn't loaded yet.
            return Promise.resolve(window.confirm(`Delete "${fileName}"? This cannot be undone.`));
        }
        return dialog({
            title: 'Delete File',
            message: `Are you sure you want to delete "<strong>${fileName}</strong>"? This action cannot be undone.`,
            variant: 'warning',
            buttons: [
                { label: 'Cancel', action: 'cancel', type: 'cancel' },
                { label: 'Delete', action: 'delete', type: 'danger' },
            ],
        }).then(action => action === 'delete');
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
            if (file.category === 'testbench') {
                this.showNotification('Cannot set Top Level on Testbench file', 'warning', 3000);
                return;
            }
            // Remove Top Level from all files
            this.verilogFiles.forEach(f => f.isTopLevel = false);
            // Set this file as Top Level
            this.verilogFiles[index].isTopLevel = true;
            this.showNotification(`"${file.name}" set as Top Level`, 'success', 2000);
            break;
            
        case 'remove-top-level':
            this.verilogFiles[index].isTopLevel = false;
            this.showNotification(`Top Level removed from "${file.name}"`, 'success', 2000);
            break;
            
        case 'set-testbench':
            if (file.category !== 'testbench') {
                this.showNotification('File must have Testbench category', 'warning', 3000);
                return;
            }
            // Remove testbench mark from all files
            this.verilogFiles.forEach(f => f.isMarkedTestbench = false);
            // Mark this file as the testbench
            this.verilogFiles[index].isMarkedTestbench = true;
            this.showNotification(`"${file.name}" marked as Testbench`, 'success', 2000);
            break;
            
        case 'remove-testbench':
            this.verilogFiles[index].isMarkedTestbench = false;
            this.showNotification(`Testbench mark removed from "${file.name}"`, 'success', 2000);
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
 * Import files (keeps existing function name)
 */
async importFiles(files) {
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
            category: 'synthesizable'
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
 * Save configuration (keeps existing function name)
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
            console.error('Project path not available for sync');
            return;
        }

        const configPath = await window.electronAPI.joinPath(projectPath, this.CONFIG_FILENAME);
        
        let currentConfig = {};
        try {
            if (await window.electronAPI.fileExists(configPath)) {
                const content = await window.electronAPI.readFile(configPath);
                currentConfig = JSON.parse(content);
            }
        } catch (err) {
            console.warn('Could not read existing config:', err);
        }

        const synthesizableFiles = this.verilogFiles
            .filter(f => f.category !== 'testbench')
            .map(file => ({
                name: file.name,
                path: file.path,
                isTopLevel: file.isTopLevel || false
            }));

        const testbenchFiles = this.verilogFiles
            .filter(f => f.category === 'testbench')
            .map(file => ({
                name: file.name,
                path: file.path,
                isTopLevel: false
            }));

        const topFile = this.verilogFiles.find(f => f.isTopLevel && f.category !== 'testbench');
        const topLevelPath = topFile ? topFile.path : "";
        
        const testbenchFile = this.verilogFiles.find(f => f.category === 'testbench');
        const testbenchPath = testbenchFile ? testbenchFile.path : "";

        currentConfig.synthesizableFiles = synthesizableFiles;
        currentConfig.testbenchFiles = testbenchFiles;
        currentConfig.topLevelFile = topLevelPath;
        currentConfig.testbenchFile = testbenchPath;

        if (!currentConfig.gtkwFiles) currentConfig.gtkwFiles = [];
        if (!currentConfig.processors) currentConfig.processors = [];

        await window.electronAPI.writeFile(configPath, JSON.stringify(currentConfig, null, 2));
        
        console.log('Saved configuration with categories');
        
    } catch (error) {
        console.error('Error saving configuration:', error);
    }
}

   /**
 * Load configuration (keeps existing function name)
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
            console.error('Project path not available');
            return;
        }
        
        const configPath = await window.electronAPI.joinPath(projectPath, this.CONFIG_FILENAME);
        const configExists = await window.electronAPI.fileExists(configPath);
        
        if (configExists) {
            const configContent = await window.electronAPI.readFile(configPath);
            const configData = JSON.parse(configContent);
            
            console.log('Loading configuration from:', configPath);
            
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
                                    category: 'synthesizable'
                                });
                            } else {
                                console.warn(`File no longer exists: ${fileData.path}`);
                            }
                        } catch (error) {
                            console.error(`Error validating file ${fileData.path}:`, error);
                        }
                    }
                }
            }
            
            if (configData.testbenchFiles && Array.isArray(configData.testbenchFiles)) {
                for (const fileData of configData.testbenchFiles) {
                    if (fileData.path && fileData.name) {
                        try {
                            const exists = await window.electronAPI.fileExists(fileData.path);
                            
                            if (exists) {
                                this.verilogFiles.push({
                                    name: fileData.name,
                                    path: fileData.path,
                                    isTopLevel: false,
                                    category: 'testbench'
                                });
                            } else {
                                console.warn(`File no longer exists: ${fileData.path}`);
                            }
                        } catch (error) {
                            console.error(`Error validating file ${fileData.path}:`, error);
                        }
                    }
                }
            }
            
            this.sortFilesAlphabetically();
            
            console.log('Loaded', this.verilogFiles.length, 'files from configuration');
        } else {
            console.log('projectOriented.json not found, starting with empty list');
        }
    } catch (error) {
        console.error('Error loading configuration:', error);
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
