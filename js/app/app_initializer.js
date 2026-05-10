/**
 * =====================================================================================
 * Aurora IDE - Application Initializer
 * Orchestrates startup, mode switching, and state persistence
 * =====================================================================================
 */

import { showDialog } from '../ui/dialog_manager.js';
import { projectManager } from '../project/project_manager.js';
import { fileTreeManager, TreeViewState } from '../tree/file_tree_manager.js';

class AppInitializer {
    constructor() {
        // Two modes now: 'processor' for the legacy single-processor PRISM
        // workflow, 'project' for everything else (with or without
        // processors — the pipeline auto-decides by checking
        // projectConfig.processors). The old 'verilog' value is migrated
        // on restore for backward-compat with stored localStorage.
        this.currentMode = null;
        this.isInitialized = false;
        this.lastProjectPath = null;

        this.STORAGE_KEYS = {
            LAST_PROJECT: 'aurora-last-project-path',
            LAST_MODE: 'aurora-last-mode',
        };
    }

    /**
     * Initialize the entire application
     */
    async initialize() {
        if (this.isInitialized) {
            console.warn('⚠️ AppInitializer already initialized');
            return;
        }

        console.log('🚀 Initializing Aurora IDE...');

        try {
            this.setupModeSwitchers();
            await this.restoreLastSession();
            this.updateButtonStates();

            this.isInitialized = true;
            console.log('✅ Aurora IDE initialized successfully');

        } catch (error) {
            console.error('❌ Failed to initialize Aurora IDE:', error);
            await showDialog({
                title: 'Initialization Error',
                message: `Failed to initialize the application: ${error.message}`,
                buttons: [{ label: 'OK', action: 'close', type: 'cancel' }]
            });
        }
    }

    /**
     * Setup mode radio button listeners
     */
    setupModeSwitchers() {
        const processorModeRadio = document.getElementById('Processor Mode');
        const projectModeRadio = document.getElementById('Project Mode');
        
        if (processorModeRadio) {
            processorModeRadio.addEventListener('change', () => {
                if (processorModeRadio.checked) {
                    this.switchToMode('processor');
                }
            });
        }
        
        if (projectModeRadio) {
            projectModeRadio.addEventListener('change', () => {
                if (projectModeRadio.checked) {
                    this.switchToMode('project');
                }
            });
        }
    }

    /**
     * Restore last session (project + mode)
     */
    async restoreLastSession() {
        console.log('🔄 Attempting to restore last session...');

        const lastProjectPath = localStorage.getItem(this.STORAGE_KEYS.LAST_PROJECT);
        // Backward-compat: the old 'verilog' value (Project Mode + sim
        // OFF) collapses into 'project'. The pipeline now auto-decides
        // verilog-only vs full-simulation based on processor count.
        const rawLastMode = localStorage.getItem(this.STORAGE_KEYS.LAST_MODE) || 'processor';
        const lastMode = rawLastMode === 'verilog' ? 'project' : rawLastMode;
        
        if (!lastProjectPath) {
            console.log('ℹ️ No previous project found');
            this.currentMode = lastMode;
            this.activateModeUI(lastMode);
            return;
        }
        
        try {
            // Check if project file exists
            const exists = await window.electronAPI.fileExists(lastProjectPath);
            
            if (!exists) {
                console.warn('⚠️ Last project file not found');
                localStorage.removeItem(this.STORAGE_KEYS.LAST_PROJECT);
                this._resetProjectNameLabel();

                await showDialog({
                    title: 'Project Not Found',
                    message: 'The previously opened project could not be found.',
                    buttons: [{ label: 'OK', action: 'close', type: 'cancel' }]
                });

                this.currentMode = lastMode;
                this.activateModeUI(lastMode);
                return;
            }
            
            // Load the project
            console.log(`📂 Loading last project: ${lastProjectPath}`);
            await projectManager.loadProject(lastProjectPath);
            this.lastProjectPath = lastProjectPath;
            
            // Switch to last mode
            await this.switchToMode(lastMode);
            
            console.log('✅ Session restored successfully');
            
        } catch (error) {
            console.error('❌ Failed to restore session:', error);
            localStorage.removeItem(this.STORAGE_KEYS.LAST_PROJECT);
            this._resetProjectNameLabel();

            await showDialog({
                title: 'Error Restoring Session',
                message: `Could not restore your previous session: ${error.message}`,
                buttons: [{ label: 'OK', action: 'close', type: 'cancel' }]
            });
        }
    }

    /**
     * Reset the file-tree project name label back to "No project open".
     * Called when an auto-load attempt fails so the synchronous "Loading…"
     * placeholder set in index.html doesn't get stuck on screen.
     */
    _resetProjectNameLabel() {
        const el = document.getElementById('current-spf-name');
        if (el) el.textContent = 'No project open';
    }

    /**
     * Switch to a specific mode
     */
    async switchToMode(mode) {
        console.log(`🔄 Switching to mode: ${mode}`);

        if (mode === this.currentMode) {
            console.log('ℹ️ Already in this mode');
            return;
        }

        try {
            this.currentMode = mode;
            localStorage.setItem(this.STORAGE_KEYS.LAST_MODE, mode);

            this.activateModeUI(mode);

            if (mode === 'processor') {
                await this.loadProcessorConfiguration();
                this.switchToStandardFileTree();
            } else if (mode === 'project') {
                // Project Mode is unified: the verilog picker tree is the
                // canonical view, and the pipeline auto-decides between
                // full-simulation (with processors) and verilog-only
                // (no processors) based on projectConfig.processors. The
                // old "Compile & Simulate" toggle is gone.
                await this.loadProjectConfiguration();
                await this.switchToVerilogFileMode();
            }

            this.updateButtonStates();

            console.log(`✅ Switched to ${mode} mode`);

        } catch (error) {
            console.error(`❌ Failed to switch to ${mode} mode:`, error);
            throw error;
        }
    }

    /**
     * Activate mode in UI (radio buttons)
     */
    activateModeUI(mode) {
        const processorModeRadio = document.getElementById('Processor Mode');
        const projectModeRadio = document.getElementById('Project Mode');

        if (mode === 'processor') {
            if (processorModeRadio) processorModeRadio.checked = true;
        } else if (mode === 'project') {
            if (projectModeRadio) projectModeRadio.checked = true;
        }

        // Programmatic .checked = ... does NOT fire a 'change' event, so any
        // listener that derives state from the toolbar radios (e.g. file_mode.js
        // deciding whether to show the synth/testbench picker) would miss the
        // session-restore transition. Broadcast explicitly.
        document.dispatchEvent(new CustomEvent('mode-state-changed', { detail: { mode } }));
    }

    /**
     * Load processor configuration
     */
    async loadProcessorConfiguration() {
        console.log('📋 Loading processor configuration...');
        
        try {
            const projectPath = window.currentProjectPath;
            if (!projectPath) return;
            
            const configPath = await window.electronAPI.joinPath(projectPath, 'processorConfig.json');
            const exists = await window.electronAPI.fileExists(configPath);
            
            if (exists) {
                const config = await window.electronAPI.loadConfigFromPath(configPath);
                console.log('✅ Processor config loaded:', config);
                
                // Update processor status UI
                this.updateProcessorStatus(config);
            }
            
        } catch (error) {
            console.error('❌ Failed to load processor configuration:', error);
        }
    }

    /**
     * Load project configuration
     */
    async loadProjectConfiguration() {
        console.log('📋 Loading project configuration...');
        
        try {
            const projectPath = window.currentProjectPath;
            if (!projectPath) return;
            
            const configPath = await window.electronAPI.joinPath(projectPath, 'projectOriented.json');
            const exists = await window.electronAPI.fileExists(configPath);
            
            if (exists) {
                const configContent = await window.electronAPI.readFile(configPath);
                const config = JSON.parse(configContent);
                console.log('✅ Project config loaded:', config);
                
                // Update project status UI
                this.updateProcessorStatus(config);
                
                return config;
            }
            
        } catch (error) {
            console.error('❌ Failed to load project configuration:', error);
        }
    }

    /**
     * Switch to standard file tree
     */
    switchToStandardFileTree() {
        console.log('🌲 Switching to standard file tree');
        
        if (TreeViewState.isHierarchical) {
            TreeViewState.setHierarchical(false);
        }
        
        // Deactivate Verilog Mode if active
        if (window.verilogTreeManager && window.verilogTreeManager.isVerilogTreeActive) {
            window.verilogTreeManager.deactivateVerilogMode();
        }
        
        // Refresh standard tree
        fileTreeManager.refresh();
    }

    /**
     * Switch to Verilog File Mode tree
     */
    async switchToVerilogFileMode() {
        console.log('🌲 Switching to Verilog File Mode tree');
        
        // Disable hierarchical view
        if (TreeViewState.isHierarchical) {
            TreeViewState.setHierarchical(false);
        }
        
        // Activate Verilog Mode Manager
        if (window.verilogTreeManager) {
            await window.verilogTreeManager.activateVerilogMode();
        } else {
            console.error('❌ VerilogModeManager not available');
        }
    }

    /**
     * Update processor status display
     */
    updateProcessorStatus(config) {
        const statusEl = document.getElementById('processorNameID');
        if (!statusEl) return;
        
        statusEl.style.opacity = '0';
        
        setTimeout(() => {
            if (this.currentMode === 'processor') {
                // Processor Mode
                if (config.processors && config.processors.length > 0) {
                    const activeProc = config.processors.find(p => p.isActive) || config.processors[0];
                    statusEl.innerHTML = `${activeProc.name} &nbsp;<i class="fa-solid fa-gear"></i> ${activeProc.cmmFile || 'N/A'}`;
                    statusEl.classList.add('has-processors');
                } else {
                    statusEl.innerHTML = `<i class="fa-solid fa-xmark" style="color: #FF3131"></i> No Processor Configured`;
                    statusEl.classList.remove('has-processors');
                }
                
            } else if (this.currentMode === 'project') {
                // Project Mode
                if (config.processors && config.processors.length > 0) {
                    const types = config.processors.map(p => p.type);
                    const unique = [...new Set(types)];
                    const testbench = config.testbenchFile || 'None';
                    statusEl.innerHTML = `${unique.join(' | ')}&nbsp;<i class="fa-solid fa-gear"></i> ${testbench}`;
                    statusEl.classList.add('has-processors');
                } else {
                    statusEl.innerHTML = `<i class="fa-solid fa-xmark" style="color: #FF3131"></i> No Configuration`;
                    statusEl.classList.remove('has-processors');
                }
            }
            
            statusEl.style.opacity = '1';
        }, 300);
    }

    /**
     * Update button states based on mode. Both modes leave every button
     * enabled today — the per-button gating that used to live here has
     * moved into the compilation flow itself, which auto-decides which
     * stages to run based on whether processors are configured.
     */
    updateButtonStates() {
        // Empty `buttons` map preserved for shape-compat with callers that
        // still invoke this; if button-level gating returns later, plumb
        // the IDs back in here.
        console.log(`✅ Button states updated for ${this.currentMode} mode`);
    }

    /**
     * Handle post-compilation tree switching
     */
    handlePostCompilation(success) {
        if (!success) return;
        
        // If Verilog was compiled successfully, enable hierarchy toggle
        if (TreeViewState.hierarchyData) {
            TreeViewState.enableToggle();
        }
    }

    /**
     * Save current project as last opened
     */
    saveCurrentProject(projectPath) {
        if (projectPath) {
            this.lastProjectPath = projectPath;
            localStorage.setItem(this.STORAGE_KEYS.LAST_PROJECT, projectPath);
        }
    }

    /**
     * Forget the last-opened project. Called from close_project.js so a
     * "Close Project" + restart doesn't auto-reopen what the user just
     * closed. Restoring on next launch happens via restoreLastSession,
     * which reads the same key — clearing here breaks that loop cleanly.
     */
    clearLastProject() {
        this.lastProjectPath = null;
        try {
            localStorage.removeItem(this.STORAGE_KEYS.LAST_PROJECT);
        } catch (_e) {
            /* localStorage failure is non-fatal */
        }
    }

    /**
     * Get current mode — 'processor' or 'project'.
     */
    getCurrentMode() {
        return this.currentMode;
    }
}

// Create and export singleton instance
const appInitializer = new AppInitializer();

// Globally exposed so non-module callers (and the file_tree_manager mode
// fallback that always-true-branch was relying on) can consult the same
// instance instead of re-deriving mode state from the DOM.
if (typeof window !== 'undefined') {
    window.appInitializer = appInitializer;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => appInitializer.initialize());
} else {
    appInitializer.initialize();
}

export { appInitializer };