/**
 * =====================================================================================
 * Aurora IDE - Application Initializer
 * Orchestrates startup, mode switching, and state persistence
 * =====================================================================================
 */

import { showDialog } from './dialogManager.js';
import { projectManager } from './project_manager.js';
import { fileTreeManager, TreeViewState } from './file_tree_manager.js';

class AppInitializer {
    constructor() {
        this.currentMode = null; // 'processor', 'project', 'verilog'
        this.isSimulationEnabled = true;
        this.isInitialized = false;
        this.lastProjectPath = null;
        
        // Storage keys
        this.STORAGE_KEYS = {
            LAST_PROJECT: 'aurora-last-project-path',
            LAST_MODE: 'aurora-last-mode',
            SIMULATION_STATE: 'aurora_compile_sim_state'
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
            // 1. Setup mode switchers
            this.setupModeSwitchers();
            
            // 2. Setup simulation toggle
            this.setupSimulationToggle();
            
            // 3. Restore last session
            await this.restoreLastSession();
            
            // 4. Initialize button states
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
     * Setup simulation toggle (Compile & Simulate checkbox)
     */
    setupSimulationToggle() {
        const simToggle = document.getElementById('Verilog Mode');
        
        if (simToggle) {
            // Restore saved state
            const savedState = localStorage.getItem(this.STORAGE_KEYS.SIMULATION_STATE);
            if (savedState !== null) {
                simToggle.checked = (savedState === 'true');
                this.isSimulationEnabled = (savedState === 'true');
            } else {
                this.isSimulationEnabled = simToggle.checked;
            }
            
            // Listen for changes
            simToggle.addEventListener('change', async () => {
                this.isSimulationEnabled = simToggle.checked;
                localStorage.setItem(this.STORAGE_KEYS.SIMULATION_STATE, simToggle.checked);
                
                // Check if we're in Project Mode
                const projectModeRadio = document.getElementById('Project Mode');
                const isProjectMode = projectModeRadio && projectModeRadio.checked;
                
                if (isProjectMode) {
                    if (!simToggle.checked) {
                        // Simulation disabled → Switch to Verilog File Mode
                        console.log('🔄 Simulation disabled, switching to Verilog File Mode');
                        await this.switchToMode('verilog');
                    } else {
                        // Simulation enabled → Switch to standard Project Mode
                        console.log('🔄 Simulation enabled, switching to standard Project Mode');
                        await this.switchToMode('project');
                    }
                }
                
                // Update button states
                this.updateButtonStates();
            });
        }
    }

    /**
     * Restore last session (project + mode)
     */
    async restoreLastSession() {
        console.log('🔄 Attempting to restore last session...');
        
        const lastProjectPath = localStorage.getItem(this.STORAGE_KEYS.LAST_PROJECT);
        const lastMode = localStorage.getItem(this.STORAGE_KEYS.LAST_MODE) || 'processor';
        
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
            
            await showDialog({
                title: 'Error Restoring Session',
                message: `Could not restore your previous session: ${error.message}`,
                buttons: [{ label: 'OK', action: 'close', type: 'cancel' }]
            });
        }
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
            // Save the mode
            this.currentMode = mode;
            localStorage.setItem(this.STORAGE_KEYS.LAST_MODE, mode);
            
            // Activate UI
            this.activateModeUI(mode);
            
            // Load configuration based on mode
            if (mode === 'processor') {
                await this.loadProcessorConfiguration();
                this.switchToStandardFileTree();
                
            } else if (mode === 'project') {
                if (this.isSimulationEnabled) {
                    await this.loadProjectConfiguration();
                    this.switchToStandardFileTree();
                } else {
                    // Simulation disabled = Verilog Mode
                    await this.switchToMode('verilog');
                    return;
                }
                
            } else if (mode === 'verilog') {
                await this.loadProjectConfiguration();
                await this.switchToVerilogFileMode();
            }
            
            // Update button states
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
        const simToggle = document.getElementById('Verilog Mode');
        
        if (mode === 'processor') {
            if (processorModeRadio) processorModeRadio.checked = true;
            if (simToggle) simToggle.checked = true;
            
        } else if (mode === 'project') {
            if (projectModeRadio) projectModeRadio.checked = true;
            if (simToggle) simToggle.checked = true;
            
        } else if (mode === 'verilog') {
            if (projectModeRadio) projectModeRadio.checked = true;
            if (simToggle) simToggle.checked = false;
        }
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
        if (window.verilogModeManager && window.verilogModeManager.isVerilogModeActive) {
            window.verilogModeManager.deactivateVerilogMode();
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
        if (window.verilogModeManager) {
            await window.verilogModeManager.activateVerilogMode();
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
                
            } else if (this.currentMode === 'project' || this.currentMode === 'verilog') {
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
     * Update button states based on mode
     */
    updateButtonStates() {
        const buttons = {
            /*
            cmmcomp: document.getElementById('cmmcomp'),
            asmcomp: document.getElementById('asmcomp'),
            vericomp: document.getElementById('vericomp'),
            wavecomp: document.getElementById('wavecomp'),
            prismcomp: document.getElementById('prismcomp'),
            allcomp: document.getElementById('allcomp'),
            settings: document.getElementById('settings')
            */
        };
        
        if (this.currentMode === 'processor') {
            // Processor Mode - All buttons enabled
            Object.values(buttons).forEach(btn => {
                if (btn) {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                }
            });
            
        } else if (this.currentMode === 'project') {
            // Project Mode with Simulation - All buttons enabled
            Object.values(buttons).forEach(btn => {
                if (btn) {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                }
            });
            
        } else if (this.currentMode === 'verilog') {
            // Verilog Mode (Project without Simulation) - Only iverilog and prism
            const enabledButtons = ['vericomp', 'prismcomp', 'settings'];
            
            Object.entries(buttons).forEach(([key, btn]) => {
                if (btn) {
                    const shouldEnable = enabledButtons.includes(key);
                    btn.disabled = !shouldEnable;
                    btn.style.opacity = shouldEnable ? '1' : '0.5';
                    btn.style.cursor = shouldEnable ? 'pointer' : 'not-allowed';
                }
            });
        }
        
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
     * Get current mode
     */
    getCurrentMode() {
        return this.currentMode;
    }

    /**
     * Get simulation state
     */
    isSimulationActive() {
        return this.isSimulationEnabled;
    }
}

// Create and export singleton instance
const appInitializer = new AppInitializer();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => appInitializer.initialize());
} else {
    appInitializer.initialize();
}

export { appInitializer };