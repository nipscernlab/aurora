// compilation_flow.js

import { CompilationModule } from './compilation_module.js';
import { showDialog } from './dialogManager.js';

let compilationCanceled = false;

// Helper to check the Simulation Toggle State (ID: Verilog Mode)
// Checked = Compile & Simulate
// Unchecked = Compile Only (and conceptually activates Verilog Mode in your UI logic)
function isSimulationEnabled() {
    const toggle = document.getElementById('Verilog Mode');
    return toggle ? toggle.checked : false;
}

function checkCancellation() {
    if (compilationCanceled) {
        throw new Error('Compilation canceled by user');
    }
}

function switchTerminal(targetId) {
    document.querySelectorAll('.terminal-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(targetId)?.classList.remove('hidden');
    document.querySelector(`.tab[data-terminal="${targetId.replace('terminal-', '')}"]`)?.classList.add('active');
}

function setCompilationButtonsState(disabled) {
    const buttons = ['cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp', 'fractalcomp'];
    buttons.forEach(id => {
        const button = document.getElementById(id);
        if (button) {
            button.disabled = disabled;
            button.style.cursor = disabled ? 'not-allowed' : 'pointer';
            button.style.opacity = disabled ? '0.6' : '1';
        }
    });
}

function startCompilation() {
    compilationCanceled = false;
    setCompilationButtonsState(true);
    window.initializeGlobalTerminalManager();
}

function endCompilation() {
    setCompilationButtonsState(false);
}

// ----------------------------------------------------------------------
// PIPELINES (Updated to respect Toggle State)
// ----------------------------------------------------------------------

async function runProcessorPipeline(compiler) {
    const activeProcessor = compiler.config.processors.find(p => p.isActive === true);
    if (!activeProcessor) throw new Error("No active processor found.");
    
    await compiler.ensureDirectories(activeProcessor.name);
    
    // 1. CMM Compilation
    switchTerminal('terminal-tcmm');
    checkCancellation();
    await compiler.cmmCompilation(activeProcessor);
    
    // 2. ASM Compilation
    switchTerminal('terminal-tasm');
    checkCancellation();
    await compiler.asmCompilation(activeProcessor, 0);

    // CHECK: Should we simulate?
    if (!isSimulationEnabled()) {
        compiler.terminalManager.appendToTerminal('tasm', 'Simulation skipped (Compile Only).', 'info');
        return; // Stop here
    }

    // 3. Verilog Simulation/Verification
    switchTerminal('terminal-tveri');
    checkCancellation();
    await compiler.iverilogCompilation(activeProcessor);

    // 4. Waveform Visualization
    switchTerminal('terminal-twave');
    checkCancellation();
    await compiler.runGtkWave(activeProcessor);

            await compiler.iverilogCompilation(activeProcessor);
}

async function runProjectPipeline(compiler) {
    if (!compiler.projectConfig?.processors) throw new Error('No processors defined in projectoriented.json');

    switchTerminal('terminal-tcmm');
    
    // 1. Compile all processors (CMM + ASM)
    for (const projectProcessor of compiler.projectConfig.processors) {
        checkCancellation();
        const processorConfig = compiler.config.processors.find(p => p.name === projectProcessor.type);
        if (!processorConfig) continue;

        await compiler.ensureDirectories(processorConfig.name);
        await compiler.cmmCompilation(processorConfig);
        await compiler.asmCompilation(processorConfig, 1);
    }
    
    // CHECK: Should we simulate?
    if (!isSimulationEnabled()) {
        compiler.terminalManager.appendToTerminal('tasm', 'Project Simulation skipped (Compile Only).', 'info');
        return; // Stop here
    }
    
    // 2. Project Verification
    switchTerminal('terminal-tveri');
    checkCancellation();
    await compiler.iverilogProjectCompilation();

    // 3. Project Waveform
    switchTerminal('terminal-twave');
    checkCancellation();
    await compiler.runProjectGtkWave();
}

// ----------------------------------------------------------------------
// MANAGER CLASS
// ----------------------------------------------------------------------

class CompilationFlowManager {
    initialize() {
        document.getElementById('cmmcomp')?.addEventListener('click', () => this.runSingleStep('cmm'));
        document.getElementById('asmcomp')?.addEventListener('click', () => this.runSingleStep('asm'));
        document.getElementById('vericomp')?.addEventListener('click', () => this.runSingleStep('verilog'));
        document.getElementById('wavecomp')?.addEventListener('click', () => this.runSingleStep('wave'));
        document.getElementById('allcomp')?.addEventListener('click', () => this.runAll());
        document.getElementById('prismcomp')?.addEventListener('click', () => this.runSingleStep('prism'));
        document.getElementById('cancel-everything')?.addEventListener('click', this.cancelAll);
        
        // --- PERSISTENCE LOGIC START ---
        // Restore the toggle state from localStorage
        const toggle = document.getElementById('Verilog Mode');
        const savedState = localStorage.getItem('aurora_compile_sim_state');

        if (toggle) {
            if (savedState !== null) {
                // 'true' string -> true boolean
                toggle.checked = (savedState === 'true');
            } else {
                // Default default if nothing saved (e.g., true/Simulate ON)
                toggle.checked = true;
            }

            // Manually trigger change event so UI/CSS (hiding sections) updates immediately
            toggle.dispatchEvent(new Event('change'));

            // Save state whenever user changes it
            toggle.addEventListener('change', (e) => {
                localStorage.setItem('aurora_compile_sim_state', e.target.checked);
                // Also update button states when toggling
                this.updateButtonStates();
            });
        }
        // --- PERSISTENCE LOGIC END ---

        // Setup mode change listeners
        this.setupModeListeners();
    }

    setupModeListeners() {
        // We listen to radio buttons to update UI states, 
        // but the persistence of the toggle is handled in initialize()
        const processorModeRadio = document.getElementById('Processor Mode');
        const projectModeRadio = document.getElementById('Project Mode');
        
        // If user clicks Processor Mode, we might want to ensure buttons reflect the toggle
        processorModeRadio?.addEventListener('change', () => this.updateButtonStates());
        projectModeRadio?.addEventListener('change', () => this.updateButtonStates());
        
        // Initial update
        this.updateButtonStates();
    }

    // Extracted logic to allow calling from multiple places
    updateButtonStates() {
        const mode = this.getCurrentMode();
        const settingsBtn = document.getElementById('settings');
        
        // Button states
        const cmmBtn = document.getElementById('cmmcomp');
        const asmBtn = document.getElementById('asmcomp');
        const veriBtn = document.getElementById('vericomp');
        const waveBtn = document.getElementById('wavecomp');
        const prismBtn = document.getElementById('prismcomp');
        const allBtn = document.getElementById('allcomp');
        
        // In Verilog Mode (Toggle Unchecked), compilation flow buttons are restricted
        if (mode === 'verilog') {
            if (cmmBtn) cmmBtn.disabled = true;
            if (asmBtn) asmBtn.disabled = true;
            if (veriBtn) veriBtn.disabled = false;
            if (waveBtn) waveBtn.disabled = true;
            if (prismBtn) prismBtn.disabled = false;
            if (allBtn) allBtn.disabled = true;
        } else {
            // Processor/Project modes: normal behavior based on processor config
            const hasProcessor = this.isProcessorConfigured();
            if (cmmBtn) cmmBtn.disabled = !hasProcessor;
            if (asmBtn) asmBtn.disabled = !hasProcessor;
            
            // If Sim toggle is OFF, we might want to disable specific sim buttons individually
            // or let them run partial pipelines. For now, we keep them enabled if processor exists,
            // but the pipeline will skip steps if run via "Run All".
            if (veriBtn) veriBtn.disabled = !hasProcessor;
            if (waveBtn) waveBtn.disabled = !hasProcessor;
            
            if (prismBtn) prismBtn.disabled = !hasProcessor;
            if (allBtn) allBtn.disabled = !hasProcessor;
        }
    }

    isProcessorConfigured() {
        const el = document.getElementById('processorNameID');
        return el && !el.textContent.includes('No Processor Configured');
    }

    async runPrismForCurrentMode() {
        const currentMode = this.getCurrentMode();
        const compiler = new CompilationModule(window.currentProjectPath);
        
        try {
            if (currentMode === 'verilog') {
                await compiler.prismVerilogModeCompilation();
            } else if (currentMode === 'processor') {
                await compiler.loadConfig();
                const activeProcessor = compiler.config.processors.find(p => p.isActive === true);
                if (!activeProcessor) throw new Error('No active processor found');
                await compiler.prismProcessorCompilation(activeProcessor);
            } else if (currentMode === 'project') {
                await compiler.loadConfig();
                await compiler.prismProjectCompilation();
            }
        } catch (error) {
            console.error('PRISM compilation error:', error);
            throw error;
        }
    }

    async runAll() {
        if (!this.isProcessorConfigured()) {
            await showDialog({
                title: 'Configuration Required',
                message: 'Please configure a processor first.',
                buttons: [
                    { label: 'OK', type: 'cancel', action: 'close' }
                ]
            });
            return;
        }
        
        startCompilation();
        try {
            const compiler = new CompilationModule(window.currentProjectPath);
            await compiler.loadConfig();
            
            const isProjectMode = document.getElementById('toggle-ui')?.classList.contains('active');
            if (isProjectMode) {
                await runProjectPipeline(compiler);
            } else {
                await runProcessorPipeline(compiler);
            }
        } catch (error) {
            console.error('Compilation error:', error);
        } finally {
            endCompilation();
        }
    }

    getCurrentMode() {
        const verilogModeToggle = document.getElementById('Verilog Mode');
        const projectModeRadio = document.getElementById('Project Mode');
        
        // Based on previous instructions:
        // Toggle Unchecked (False) -> Verilog Mode Active
        // Toggle Checked (True) -> Simulation Enabled -> Processor/Project Mode Active
        
        if (verilogModeToggle && !verilogModeToggle.checked) {
            return 'verilog';
        }
        
        if (projectModeRadio?.checked) return 'project';
        return 'processor'; // Default fallback
    }

    async runSingleStep(step) {
        const currentMode = this.getCurrentMode();
        
        // For Verilog Mode, only certain steps are valid
        if (currentMode === 'verilog') {
            if (!['verilog', 'prism'].includes(step)) {
                await showDialog({
                    title: 'Action Not Available',
                    message: 'This compilation step is not available in Verilog Mode (Compile & Simulate is disabled).',
                    buttons: [
                        { label: 'OK', type: 'cancel', action: 'close' }
                    ]
                });
                return;
            }
        } else {
            // Processor/Project modes need processor configuration
            if (!this.isProcessorConfigured()) {
                await showDialog({
                    title: 'Configuration Required',
                    message: 'Please configure a processor first.',
                    buttons: [
                        { label: 'OK', type: 'cancel', action: 'close' }
                    ]
                });
                return;
            }
        }

        startCompilation();
        try {
            const compiler = new CompilationModule(window.currentProjectPath);
            
            if (currentMode === 'verilog') {
                // Verilog Mode specific compilation
                switch(step) {
                    case 'verilog':
                        switchTerminal('terminal-tveri');
                        await compiler.iverilogVerilogModeCompilation();
                        break;
                    case 'prism':
                        switchTerminal('terminal-tveri');
                        await compiler.prismVerilogModeCompilation();
                        break;
                }
            } else {
                // Existing processor/project mode logic
                await compiler.loadConfig();
                const isProjectMode = document.getElementById('toggle-ui')?.classList.contains('active'); // Safer check for project mode
                const activeProcessor = compiler.config.processors.find(p => p.isActive === true);

                switch(step) {
                    case 'cmm':
                        switchTerminal('terminal-tcmm');
                        await compiler.cmmCompilation(activeProcessor);
                        break;
                    case 'asm':
                        switchTerminal('terminal-tasm');
                        await compiler.asmCompilation(activeProcessor, isProjectMode ? 1 : 0);
                        break;
                    case 'verilog':
                        switchTerminal('terminal-tveri');
                        isProjectMode ? 
                            await compiler.iverilogProjectCompilation() : 
                            await compiler.iverilogCompilation(activeProcessor);
                        break;
                    case 'wave':
                        switchTerminal('terminal-twave');
                        isProjectMode ? 
                            await compiler.runProjectGtkWave() : 
                            await compiler.runGtkWave(activeProcessor);
                        break;
                    case 'prism':
                        switchTerminal('terminal-tveri');
                        await this.runPrismForCurrentMode();
                        break;
                }
            }
        } catch (error) {
            console.error(`${step} compilation error:`, error);
        } finally {
            endCompilation();
        }
    }

    cancelAll() {
        compilationCanceled = true;
        window.electronAPI.cancelVvpProcess();
        setCompilationButtonsState(false);
    }

    initializePrismButton() {
        const prismButton = document.getElementById('prismcomp');
        if (!prismButton) return;

        prismButton.addEventListener('click', async () => {
            if (prismButton.disabled) return;
            
            prismButton.disabled = true;
            const originalHTML = prismButton.innerHTML;
            prismButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Compiling...</span>';
            
            try {
                const paths = await this.acquirePrismPaths();
                const result = await window.electronAPI.prismCompileWithPaths(paths);
                
                if (result.success) {
                    this.showNotification('PRISM window opened successfully', 'success', 3000);
                } else {
                    throw new Error(result.message || 'PRISM compilation failed');
                }
            } catch (error) {
                console.error('PRISM compilation error:', error);
                this.showNotification(`PRISM error: ${error.message}`, 'error', 4000);
            } finally {
                prismButton.disabled = false;
                prismButton.innerHTML = originalHTML;
            }
        });
    }

    showNotification(message, type, duration) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type, duration);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    async acquirePrismPaths() {
        const projectPath = window.currentProjectPath;
        if (!projectPath) throw new Error('No project path available.');
        
        const componentsPath = await window.electronAPI.getComponentsPath();
        
        return {
            projectPath,
            componentsPath: componentsPath,
            hdlPath: await window.electronAPI.joinPath(componentsPath, 'HDL'),
            tempPath: await window.electronAPI.joinPath(componentsPath, 'Temp', 'PRISM'),
            yosysPath: await window.electronAPI.joinPath(componentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe'),
            netlistsvgPath: await window.electronAPI.joinPath(componentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe'),
            processorConfigPath: await window.electronAPI.joinPath(projectPath, 'processorConfig.json'),
            projectOrientedConfigPath: await window.electronAPI.joinPath(projectPath, 'projectOriented.json'),
            topLevelPath: await window.electronAPI.joinPath(projectPath, 'TopLevel')
        };
    }
}

const compilationFlowManager = new CompilationFlowManager();
export { compilationFlowManager };