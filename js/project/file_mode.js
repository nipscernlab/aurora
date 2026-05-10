/**
 * =====================================================================================
 * Aurora IDE - Verilog Mode File Manager
 * Handles Verilog Mode file tree reading directly from projectOriented.json
 * =====================================================================================
 */

import { TabManager } from '../tabs/tab_manager.js';
import { ProjectStore } from './project_store.js';
import { ProjectConfigStore } from './project_config_store.js';
import { toNativeSeparators } from '../utils/path_utils.js';

class VerilogTreeManager {
    constructor() {
        // Configuration - Points to the main project config
        this.CONFIG_FILENAME = 'projectOriented.json';
        // File tree drag-and-drop / Open HDL accept Verilog source and
        // header files only. .gtkw save files have a dedicated entry
        // point — the toolbar's gtkw picker (+ Add .gtkw file...) —
        // and don't belong in the same list as Verilog sources, so
        // dropping one here is rejected with the same notification a
        // .txt would get.
        this.ALLOWED_EXTENSIONS = ['.v', '.sv', '.vh'];
        this.handleCategoryToggle = this.handleCategoryToggle.bind(this);
        // State management. currentProjectPath is intentionally NOT cached
        // here anymore — it lives in ProjectStore (single source of truth).
        // Caching it on the manager was the root cause of files-disappearing
        // on close+reopen, since close didn't reset it and the early-return
        // branch in activateVerilogMode used the stale path.
        this.verilogFiles = [];
        this.isVerilogTreeActive = false;
        
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

        // Expose the init() promise so callers (app_initializer) can safely
        // await DOM-element caching before asking us to render. Without this,
        // a programmatic mode switch on cold start can race past cacheElements
        // and silently bail out in renderVerilogTree (no fileTree element).
        this.initPromise = this.init();
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

    /**
     * Cache all DOM elements
     */
    cacheElements() {
        this.elements = {
            fileTree: document.getElementById('file-tree'),
            fileTreeContainer: document.querySelector('.file-tree-container'),
            openHdlButton: document.getElementById('open-hdl-button'),
            refreshButton: document.getElementById('refresh-button'),
            processorModeRadio: document.getElementById('Processor Mode'),
            projectModeRadio: document.getElementById('Project Mode'),
        };

        console.log('📦 Cached elements:', { fileTree: !!this.elements.fileTree });
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // The verilog picker tree is the file tree for Project Mode (with
        // or without processors). Processor Mode keeps the standard
        // folder listing. There used to be a "Compile & Simulate" toggle
        // that gated this; with the toggle removed the rule simplifies to
        // "Project Mode → picker".
        const shouldShowVerilogTree = () => this.elements.projectModeRadio?.checked === true;

        const syncFromState = () => {
            if (shouldShowVerilogTree()) {
                this.activateVerilogMode();
            } else {
                this.deactivateVerilogMode();
            }
        };

        // Initial state on load
        syncFromState();

        if (this.elements.processorModeRadio) {
            this.elements.processorModeRadio.addEventListener('change', syncFromState);
        }

        if (this.elements.projectModeRadio) {
            this.elements.projectModeRadio.addEventListener('change', syncFromState);
        }

        // Programmatic radio/checkbox flips (e.g. session restore via
        // app_initializer.activateModeUI) do not fire a 'change' event, so
        // app_initializer dispatches this custom event after switching modes.
        document.addEventListener('mode-state-changed', syncFromState);

        // Project modal saves write projectOriented.json. The modal's own
        // saveConfiguration() already calls us when verilog mode is active,
        // but listening here catches any other path that updates the config
        // (CLI tools, future flows, etc.) so the picker never goes stale.
        document.addEventListener('project-config-saved', () => {
            if (this.isVerilogTreeActive) {
                this.refreshVerilogTree();
            }
        });

        if (this.elements.fileTree) {
            this.elements.fileTree.addEventListener('contextmenu', this.handleTreeContextMenu);

            // Delegated click handler for the verilog file rows.
            // Each row carries `data-file-path`; action buttons carry
            // `data-action`. This single listener replaces the previous
            // per-row addEventListener trio (open file / toggle / delete).
            // Looking up the file by path on every click means listeners
            // survive sorting and in-place updates — no closure-captured
            // stale index can mis-target a row.
            this.elements.fileTree.addEventListener('click', async (e) => {
                if (!this.isVerilogTreeActive) return;
                const row = e.target.closest('.verilog-file-item');
                if (!row) return;
                const path = row.dataset.filePath;
                if (!path) return;
                const file = this.verilogFiles.find((f) => f.path === path);
                if (!file) return;

                const actionBtn = e.target.closest('[data-action]');
                const action = actionBtn?.dataset.action;

                if (action === 'toggle-category') {
                    e.preventDefault(); e.stopPropagation();
                    await this._toggleCategoryByPath(path);
                    return;
                }
                if (action === 'delete') {
                    e.preventDefault(); e.stopPropagation();
                    await this._removeFileByPath(path);
                    return;
                }
                // Plain row click → open the file in a tab.
                try {
                    const content = await window.electronAPI.readFile(file.path);
                    TabManager.addTab(file.path, content);
                } catch (err) {
                    console.error('Error opening file:', err);
                    this.showNotification(`Error opening file: ${file.name}`, 'error', 3000);
                }
            });
        }

        this.elements.openHdlButton?.addEventListener('click', () => {
            if (this.isVerilogTreeActive) {
                this.handleImportClick();
            }
        });
        
        this.elements.refreshButton?.addEventListener('click', () => {
            if (this.isVerilogTreeActive) {
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
            if (this.isVerilogTreeActive) {
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
        if (this.isVerilogTreeActive) {
            this.elements.fileTree.classList.add('verilog-dragover');
        }
    }
    
    /**
     * Handle drag leave
     */
    handleDragLeave(e) {
        if (this.isVerilogTreeActive) {
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
        
        if (!this.isVerilogTreeActive) return;
        
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
            
            filePath = toNativeSeparators(filePath);
            
            const ext = this.getFileExtension(file.name);
            if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
                const hint = ext === '.gtkw'
                    ? ' Use the toolbar\'s .gtkw picker (+ Add .gtkw file...) instead.'
                    : '';
                this.showNotification(
                    `"${file.name}" was rejected — only Verilog (.v, .sv, .vh) source files belong in the tree.${hint}`,
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
                { name: 'Verilog Files', extensions: ['v', 'sv', 'vh'] },
                { name: 'All Files', extensions: ['*'] },
            ];

            const result = await window.electronAPI.selectFilesWithPath({
                title: 'Select Verilog Files',
                filters: filters,
                properties: ['openFile', 'multiSelections'],
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
        // Coalesce concurrent activations. Session-restore fires us from TWO
        // paths in the same tick (mode-state-changed via syncFromState AND
        // app_initializer.switchToVerilogFileMode). Without this guard, both
        // run loadConfiguration() in parallel — each does `verilogFiles = []`
        // then awaits, so call B's reset wipes call A's pushes mid-iteration
        // and the surviving entries end up duplicated in the picker.
        if (this._activatePromise) return this._activatePromise;

        this._activatePromise = (async () => {
            // Wait for cacheElements() to have run. Without this, an early
            // programmatic activation can land before init() resolves and
            // silently no-op in renderVerilogTree.
            if (this.initPromise) {
                try { await this.initPromise; } catch (_) { /* init logs its own errors */ }
            }

            if (this.isVerilogTreeActive) {
                // Already active but a new project may have been opened —
                // refresh the configuration and re-render rather than
                // returning a stale tree.
                await this.refreshVerilogTree();
                return;
            }

            console.log('🚀 Activating Verilog Mode...');

            // Discover the project path if loadProject hasn't run yet (rare
            // — happens on app startup when restoreLastSession is mid-flight).
            // Once known, push it into ProjectStore so every other consumer
            // sees the same value instead of caching a copy here.
            if (!ProjectStore.hasProject()) {
                try {
                    const projectData = await window.electronAPI.getCurrentProject();
                    const discoveredPath =
                        (projectData && typeof projectData === 'object' && projectData.projectPath) ||
                        (typeof projectData === 'string' ? projectData : null);
                    const discoveredSpf =
                        (projectData && typeof projectData === 'object' && projectData.spfPath) || null;
                    if (discoveredPath) {
                        ProjectStore.setProject(discoveredSpf, discoveredPath);
                    }
                } catch (error) {
                    console.error('Error getting project path:', error);
                }
            }

            // STILL no project after the discover attempt? Bail without
            // rendering. If we proceeded, loadConfiguration would early-
            // return on the missing path and renderVerilogTree would paint
            // an empty tree — exactly the "appears blank, then files
            // pop in" flash the user sees on app open. The next activate
            // call (project_manager.loadProject after setProject lands)
            // will run this body to completion.
            //
            // Critically, isVerilogTreeActive is NOT set to true here —
            // otherwise the next call would hit the early-return refresh
            // branch and skip the full activation we still need.
            if (!ProjectStore.hasProject()) {
                console.log('⏸ No project yet — deferring activation to next call');
                return;
            }

            this.isVerilogTreeActive = true;

            console.log('📂 Project path:', ProjectStore.getProjectPath());

            // Load configuration
            await this.loadConfiguration();

            // Switch the visible view to file mode AND render into the
            // verilog subcontainer in one call. Going through the
            // controller (rather than calling renderVerilogTree
            // directly) keeps its _activeView field in sync — which
            // drives the toggle button's label and click direction.
            window.fileTreeViewController?.showFileMode?.();

            console.log('✅ Verilog Mode activated with', this.verilogFiles.length, 'files');
        })();

        try {
            await this._activatePromise;
        } finally {
            this._activatePromise = null;
        }
    }

    /**
     * Reset all transient state. Called by close_project so reopening
     * triggers a clean activation against the new ProjectStore value
     * instead of the early-return branch with stale data.
     */
    reset() {
        this.isVerilogTreeActive = false;
        this.verilogFiles = [];
        // Tree DOM is already cleared by clearProjectInterface in
        // close_project.js; nothing to do here.
    }
    
    /**
     * Deactivate Verilog Mode
     */
    deactivateVerilogMode() {
        if (!this.isVerilogTreeActive) {
            return;
        }
        
        console.log('🛑 Deactivating Verilog Mode...');

        this.isVerilogTreeActive = false;

        // Switch the active view back to standard. Our verilog
        // subcontainer keeps its rows in DOM but is display:none — so
        // re-activating later is a single attribute change with the
        // existing rows already there. No wipe needed.
        window.treeView?.setActive('standard');

        // Trigger standard file tree refresh
        document.dispatchEvent(new Event('refresh-file-tree'));
        
        console.log('✅ Verilog Mode deactivated - standard tree restored');
    }
    
    /**
     * Render Verilog Mode tree into the dedicated `.tree-view-verilog`
     * subcontainer. CSS shows only the active subcontainer based on
     * `#file-tree[data-active-view]`, so the standard tree and
     * hierarchical view living in their own subcontainers can't
     * collide with us. See js/tree/tree_view.js for the rationale.
     *
     * KEY-BASED RECONCILER. Never `innerHTML = ''`. Compares
     * this.verilogFiles (keyed by path) against rows currently in
     * the verilog subcontainer:
     *   - rows whose path is gone → removed
     *   - rows still wanted → updated in place (badge, classes,
     *     toggle title) by _updateFileItem
     *   - paths with no row yet → created via _createFileItem and
     *     insertBefore'd into the right position (DOM treats
     *     insertBefore on an already-attached node as a move, so
     *     existing rows in the right slot are no-ops).
     *
     * Idempotent: same input twice = zero DOM mutations on the
     * second call.
     */
    renderVerilogTree() {
        // Render into the dedicated verilog subcontainer. The view's
        // active/visible state is owned by the file-tree view
        // controller — DON'T call setActive('verilog') here, that
        // would sync the DOM without telling the controller, leaving
        // the controller's _activeView stuck at its initial value.
        // External callers that want to BOTH render AND switch the
        // visible view should go through fileTreeViewController.
        // showFileMode() (which invokes this renderer via the
        // registered renderer hook).
        const container = window.treeView?.getContainer('verilog');
        if (!container) return;

        // Empty state branch — drop any data rows + show the placeholder.
        if (this.verilogFiles.length === 0) {
            container.querySelectorAll('.verilog-file-item').forEach((row) => row.remove());
            container.classList.add('verilog-empty');
            if (!container.querySelector('.verilog-empty-state')) {
                const emptyState = document.createElement('div');
                emptyState.className = 'verilog-empty-state';
                emptyState.innerHTML = `
                    <i class="fa-solid fa-folder-open verilog-empty-icon"></i>
                    <div class="verilog-empty-text">
                        No synthesizable files<br>
                        <strong>Drag and drop .v files here</strong>
                    </div>
                `;
                container.appendChild(emptyState);
            }
            return;
        }

        // Have data → ensure no placeholder remains.
        container.classList.remove('verilog-empty');
        container.querySelector('.verilog-empty-state')?.remove();

        // Index existing rows by path so we can match against the
        // desired list in one pass.
        const existingByPath = new Map();
        for (const row of container.querySelectorAll('.verilog-file-item')) {
            existingByPath.set(row.dataset.filePath, row);
        }

        // Pass 1 — for each desired file, place its row in the correct
        // sibling position. We track `prev` to know where the next row
        // should land. insertBefore handles "node already in parent" as
        // a move, so a no-op when ordering is already correct.
        let prev = null;
        for (const file of this.verilogFiles) {
            let row = existingByPath.get(file.path);
            if (row) {
                this._updateFileItem(row, file);
                existingByPath.delete(file.path);
            } else {
                row = this._createFileItem(file);
            }
            const targetSibling = prev ? prev.nextSibling : container.firstChild;
            if (row !== targetSibling) {
                container.insertBefore(row, targetSibling);
            }
            prev = row;
        }

        // Pass 2 — anything still in existingByPath wasn't claimed by
        // any desired file. Remove.
        for (const row of existingByPath.values()) row.remove();
    }

    /**
     * Update an existing row's mutable parts (category class, badge,
     * top-level highlight) without recreating it. The path-keyed
     * structural slot stays put — only the visual differentiators
     * change. Pure DOM mutation; no listeners need re-attaching
     * because the tree-level delegation in setupEventListeners
     * dispatches to the right handler based on data-file-path, not
     * stored index.
     */
    _updateFileItem(row, file) {
        const isTestbench = file.category === 'testbench';
        row.classList.toggle('synthesizable', !isTestbench);
        row.classList.toggle('testbench', isTestbench);
        row.classList.toggle('top-level-file', !!file.isTopLevel);

        const info = row.querySelector('.verilog-file-info');
        if (!info) return;

        // Filename — only touch DOM if it actually changed (e.g. rename
        // outside Aurora). Re-writing the textNode every render flickers
        // selection in some browsers.
        const nameEl = info.querySelector('.verilog-file-name');
        if (nameEl) {
            if (nameEl.textContent !== file.name) nameEl.textContent = file.name;
            const desiredTitle = file.path;
            if (nameEl.title !== desiredTitle) nameEl.title = desiredTitle;
        }

        // Badge: present iff isTopLevel; its label/class depends on category.
        let badge = info.querySelector('.file-badge');
        if (file.isTopLevel) {
            const desiredText = isTestbench ? 'Testbench' : 'Top Level';
            const desiredCls = `file-badge ${isTestbench ? 'testbench-badge' : 'top-level-badge'}`;
            if (!badge) {
                badge = document.createElement('span');
                info.appendChild(badge);
            }
            if (badge.className !== desiredCls) badge.className = desiredCls;
            if (badge.textContent !== desiredText) badge.textContent = desiredText;
        } else if (badge) {
            badge.remove();
        }

        // Toggle button: category class + tooltip.
        const toggleBtn = row.querySelector('.category-toggle');
        if (toggleBtn) {
            toggleBtn.classList.toggle('synthesizable', !isTestbench);
            toggleBtn.classList.toggle('testbench', isTestbench);
            const desiredTitle = isTestbench ? 'Category: Testbench' : 'Category: Synthesizable';
            if (toggleBtn.title !== desiredTitle) toggleBtn.title = desiredTitle;
        }
    }
    

/**
 * Build a file row's DOM with no per-row listeners attached.
 * All click / contextmenu handling is done by the single delegated
 * listener installed in setupEventListeners — that listener finds
 * the file by `data-file-path`, so reordering, sorting, or partial
 * updates don't need any listener bookkeeping.
 *
 * `_updateFileItem` mirrors this template's mutable parts so a row
 * created here can be re-used and updated without re-creating its
 * structural HTML.
 */
_createFileItem(file) {
    const fileItem = document.createElement('div');
    fileItem.className = 'verilog-file-item';
    fileItem.dataset.filePath = file.path;

    const isTestbench = file.category === 'testbench';
    fileItem.classList.add(isTestbench ? 'testbench' : 'synthesizable');
    if (file.isTopLevel) fileItem.classList.add('top-level-file');

    const icon = this.getFileIcon(file.name);
    const badgeHtml = file.isTopLevel
        ? (isTestbench
            ? '<span class="file-badge testbench-badge">Testbench</span>'
            : '<span class="file-badge top-level-badge">Top Level</span>')
        : '';
    const toggleTitle = isTestbench ? 'Category: Testbench' : 'Category: Synthesizable';
    const toggleClass = isTestbench ? 'testbench' : 'synthesizable';

    fileItem.innerHTML = `
        <div class="verilog-file-content">
            <div class="verilog-file-info">
                <i class="${icon} verilog-file-icon"></i>
                <div class="verilog-file-name" title="${file.path}">${file.name}</div>
                ${badgeHtml}
            </div>
            <div class="verilog-file-actions">
                <div class="category-toggle-wrapper">
                    <button class="category-toggle ${toggleClass}" data-action="toggle-category"
                         title="${toggleTitle}">
                        <span class="toggle-slider"></span>
                    </button>
                </div>
                <button class="verilog-icon-btn delete-btn" data-action="delete"
                        title="Remove file">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    `;
    return fileItem;
}

/**
 * Handle category toggle between Synthesizable and Testbench.
 * Path-keyed: caller passes the row's data-file-path, we look the
 * file up by reference. Index-based version retired — it broke under
 * sort because closures captured stale indices.
 */
async _toggleCategoryByPath(path) {
    const file = this.verilogFiles.find((f) => f.path === path);
    if (!file) return;
    const newCategory = file.category === 'testbench' ? 'synthesizable' : 'testbench';

    // Switching category invalidates the per-category top mark — a synth
    // top is not the same thing as a testbench top, even though they share
    // the underlying field.
    file.isTopLevel = false;
    file.category = newCategory;

    await this.saveConfiguration();
    this.renderVerilogTree();

    this.showNotification(
        `"${file.name}" category changed to ${newCategory}`,
        'info',
        2000,
    );
}

/**
 * Path-keyed delete. The reconciler's reorder/delete logic doesn't
 * care about indices either, so we just splice by path and re-render.
 */
async _removeFileByPath(path) {
    const idx = this.verilogFiles.findIndex((f) => f.path === path);
    if (idx < 0) return;
    return this.removeFile(idx);
}

/**
 * Legacy alias kept for callers (context menu actions still pass
 * indices). Wraps the path-based version for consistency.
 */
async handleCategoryToggle(index) {
    const file = this.verilogFiles[index];
    if (!file) return;
    return this._toggleCategoryByPath(file.path);
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
    
    // Single source of truth: `isTopLevel` means "top of its category".
    // The label and action just vary by category — the underlying flag is
    // the same.
    const isTopLevel = file.isTopLevel || false;
    const isSynthesizable = file.category !== 'testbench';
    const isTestbench = file.category === 'testbench';

    const topLevelOption = isSynthesizable ? (
        isTopLevel
            ? { text: 'Remove Top Level', action: 'remove-top-level', disabled: false, show: true }
            : { text: 'Set as Top Level', action: 'set-top-level', disabled: false, show: true }
    ) : { show: false };

    const testbenchOption = isTestbench ? (
        isTopLevel
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


   async handleTreeContextMenu(event) {
        if (!this.isVerilogTreeActive) return;

        // Right-click landed on a file row → per-row context menu (the
        // category/top-level/delete options). Per-row listeners are
        // gone since the render-reconciler refactor; this delegated
        // path replaces them. Look the file up by data-file-path —
        // index lookups are intentionally avoided (they break under
        // sort).
        const row = event.target.closest('.verilog-file-item');
        if (row) {
            event.preventDefault();
            event.stopPropagation();
            const path = row.dataset.filePath;
            const idx = this.verilogFiles.findIndex((f) => f.path === path);
            if (idx >= 0) this.showContextMenu(event, this.verilogFiles[idx], idx);
            return;
        }

        // Right-click in empty tree area → "create new file" menu below.
        event.preventDefault();
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
    try {
        const projectPath = ProjectStore.getProjectPath();
        const defaultPath = projectPath
            ? await window.electronAPI.joinPath(projectPath, 'untitled.v')
            : 'untitled.v';

        const result = await window.electronAPI.showSaveDialog({
            title: 'Save New Verilog File',
            defaultPath,
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
            // Clear the flag only within the same category. A synthesizable
            // top and a testbench top are independent — setting one shouldn't
            // wipe the other (the previous code did, which silently un-marked
            // your testbench every time you set a Top Level).
            this.verilogFiles.forEach(f => {
                if (f.category !== 'testbench') f.isTopLevel = false;
            });
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
            // Same as set-top-level but scoped to testbench files. The
            // unified field is `isTopLevel`; render code picks the right
            // badge label from the file's category.
            this.verilogFiles.forEach(f => {
                if (f.category === 'testbench') f.isTopLevel = false;
            });
            this.verilogFiles[index].isTopLevel = true;
            this.showNotification(`"${file.name}" marked as Testbench`, 'success', 2000);
            break;

        case 'remove-testbench':
            this.verilogFiles[index].isTopLevel = false;
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
            category: 'synthesizable',
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
        2000,
    );
}

  /**
 * Save configuration (keeps existing function name).
 *
 * Routes through ProjectConfigStore.update so our writes serialize
 * cleanly with the Project Settings modal's writes; field defaults
 * (gtkwFiles, processors, etc.) come from the store, so this manager
 * only mutates what it actually owns.
 */
async saveConfiguration() {
    try {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath) {
            console.error('Project path not available for sync');
            return;
        }

        // SNAPSHOT BEFORE AWAIT.
        //
        // ProjectConfigStore.update queues onto a per-project promise
        // chain, so the mutator below doesn't run until any earlier
        // update settles. Reading `this.verilogFiles` from inside the
        // mutator was a race: between the click and the mutator
        // firing, our own file watcher (file_tree_manager.js's
        // onDirectoryChanged) sees projectOriented.json change from
        // a previous write, fires refreshVerilogTree, which calls
        // loadConfiguration, which sets `this.verilogFiles = []` and
        // reloads from the OLD on-disk state — wiping the in-memory
        // category change the user just made. The mutator then writes
        // the now-rebuilt (still old-state) array back to disk, and
        // the testbench mark is silently lost.
        //
        // Building the patch synchronously here means the mutator is
        // pure assignment; whatever load/refresh runs in parallel
        // can't backdate the data we're about to persist.
        const buildEntry = (f) => ({
            name: f.name,
            path: f.path,
            isTopLevel: f.isTopLevel || false,
        });
        const synthFiles = this.verilogFiles
            .filter((f) => f.category !== 'testbench')
            .map(buildEntry);
        const tbFiles = this.verilogFiles
            .filter((f) => f.category === 'testbench')
            .map(buildEntry);
        const topFile = this.verilogFiles.find(
            (f) => f.isTopLevel && f.category !== 'testbench',
        );
        const tbTopFile = this.verilogFiles.find(
            (f) => f.isTopLevel && f.category === 'testbench',
        );
        const topPath = topFile ? topFile.path : '';
        const tbPath = tbTopFile ? tbTopFile.path : '';

        await ProjectConfigStore.update(projectPath, (cfg) => {
            cfg.synthesizableFiles = synthFiles;
            cfg.testbenchFiles = tbFiles;
            cfg.topLevelFile = topPath;
            cfg.testbenchFile = tbPath;
        });

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
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath) {
            console.error('Project path not available');
            return;
        }

        const configPath = await window.electronAPI.joinPath(projectPath, this.CONFIG_FILENAME);
        const configExists = await window.electronAPI.fileExists(configPath);

        // Build the new list LOCALLY first, only swap into `this.verilogFiles`
        // at the end. Two reasons:
        //   1. Atomicity for outside observers — saveConfiguration was racing
        //      against an in-progress load that briefly left verilogFiles=[].
        //   2. If load fails partway (read error, parse error), the previous
        //      in-memory state survives instead of being half-wiped.
        const nextFiles = [];

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
                                nextFiles.push({
                                    name: fileData.name,
                                    path: fileData.path,
                                    isTopLevel: fileData.isTopLevel || false,
                                    category: 'synthesizable',
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
                                // Backward-compat: an older codepath persisted
                                // the testbench-top mark as `isMarkedTestbench`.
                                // Treat both fields equivalently on read; the
                                // next save normalises to `isTopLevel` only.
                                const isTop = fileData.isTopLevel === true
                                    || fileData.isMarkedTestbench === true;
                                nextFiles.push({
                                    name: fileData.name,
                                    path: fileData.path,
                                    isTopLevel: isTop,
                                    category: 'testbench',
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

            console.log('Loaded', nextFiles.length, 'files from configuration');
        } else {
            console.log('projectOriented.json not found, starting with empty list');
        }

        this.verilogFiles = nextFiles;
        this.sortFilesAlphabetically();
    } catch (error) {
        console.error('Error loading configuration:', error);
    }
}
    /**
     * Refresh Verilog Mode tree
     */
    async refreshVerilogTree() {
        // Same coalescing pattern as activateVerilogMode: two refresh calls
        // arriving in the same tick (e.g. from project-config-saved + a tab
        // event) would each reset verilogFiles=[] and interleave pushes.
        //
        // No toast on completion: this method runs from four call sites,
        // only one of which is user-triggered (manual refresh button).
        // The other three (initial activation, project-config-saved,
        // filesystem watcher) all fire on app open or background events,
        // so a toast there is noise. The tree visually updating is
        // already the feedback for the manual case.
        if (this._refreshPromise) return this._refreshPromise;

        this._refreshPromise = (async () => {
            console.log('🔄 Refreshing Verilog Mode tree...');
            await this.loadConfiguration();
            this.renderVerilogTree();
        })();

        try {
            await this._refreshPromise;
        } finally {
            this._refreshPromise = null;
        }
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
const verilogTreeManager = new VerilogTreeManager();

// Make globally accessible
window.verilogTreeManager = verilogTreeManager;

// Export
export { VerilogTreeManager, verilogTreeManager };
