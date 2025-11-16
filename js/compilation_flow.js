// compilation_flow.js

import { CompilationModule } from './compilation_module.js';
import { showVVPProgress, hideVVPProgress } from './terminal_module.js';

let isCompilationRunning = false;
let compilationCanceled = false;

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
    isCompilationRunning = true;
    compilationCanceled = false;
    setCompilationButtonsState(true);
    window.initializeGlobalTerminalManager();
}

function endCompilation() {
    isCompilationRunning = false;
    setCompilationButtonsState(false);
}

async function runProcessorPipeline(compiler) {
    const activeProcessor = compiler.config.processors.find(p => p.isActive === true);
    if (!activeProcessor) throw new Error("No active processor found.");
    
    await compiler.ensureDirectories(activeProcessor.name);
    
    switchTerminal('terminal-tcmm');
    checkCancellation();
    await compiler.cmmCompilation(activeProcessor);
    
    switchTerminal('terminal-tasm');
    checkCancellation();
    await compiler.asmCompilation(activeProcessor, 0);

    switchTerminal('terminal-tveri');
    checkCancellation();
    await compiler.iverilogCompilation(activeProcessor);

    switchTerminal('terminal-twave');
    checkCancellation();
    await compiler.runGtkWave(activeProcessor);
}

async function runProjectPipeline(compiler) {
    if (!compiler.projectConfig?.processors) throw new Error('No processors defined in projectoriented.json');

    switchTerminal('terminal-tcmm');
    for (const projectProcessor of compiler.projectConfig.processors) {
        checkCancellation();
        const processorConfig = compiler.config.processors.find(p => p.name === projectProcessor.type);
        if (!processorConfig) continue;

        await compiler.ensureDirectories(processorConfig.name);
        await compiler.cmmCompilation(processorConfig);
        await compiler.asmCompilation(processorConfig, 1);
    }
    
    switchTerminal('terminal-tveri');
    checkCancellation();
    await compiler.iverilogProjectCompilation();

    switchTerminal('terminal-twave');
    checkCancellation();
    await compiler.runProjectGtkWave();
}

class CompilationFlowManager {
        initialize() {
            document.getElementById('cmmcomp')?.addEventListener('click', () => this.runSingleStep('cmm'));
            document.getElementById('asmcomp')?.addEventListener('click', () => this.runSingleStep('asm'));
            document.getElementById('vericomp')?.addEventListener('click', () => this.runSingleStep('verilog'));
            document.getElementById('wavecomp')?.addEventListener('click', () => this.runSingleStep('wave'));
            document.getElementById('allcomp')?.addEventListener('click', () => this.runAll());
            document.getElementById('prismcomp')?.addEventListener('click', () => this.runSingleStep('prism'));
            document.getElementById('cancel-everything')?.addEventListener('click', this.cancelAll);
            
            // Setup mode change listeners
            this.setupModeListeners();
        }

    setupModeListeners() {
        const verilogModeRadio = document.getElementById('Verilog Mode');
        const processorModeRadio = document.getElementById('Processor Mode');
        const projectModeRadio = document.getElementById('Project Mode');
        const settingsBtn = document.getElementById('settings');
        
        const updateButtonStates = () => {
            const mode = this.getCurrentMode();
            
            // Button states
            const cmmBtn = document.getElementById('cmmcomp');
            const asmBtn = document.getElementById('asmcomp');
            const veriBtn = document.getElementById('vericomp');
            const waveBtn = document.getElementById('wavecomp');
            const prismBtn = document.getElementById('prismcomp');
            const allBtn = document.getElementById('allcomp');
            
            if (mode === 'verilog') {
                // Verilog Mode: only verilog and prism enabled
                if (cmmBtn) cmmBtn.disabled = true;
                if (asmBtn) asmBtn.disabled = true;
                if (veriBtn) veriBtn.disabled = false;
                if (waveBtn) waveBtn.disabled = true;
                if (prismBtn) prismBtn.disabled = false;
                if (allBtn) allBtn.disabled = true;
                if (settingsBtn) settingsBtn.disabled = true;
            } else {
                // Processor/Project modes: normal behavior
                const hasProcessor = this.isProcessorConfigured();
                if (cmmBtn) cmmBtn.disabled = !hasProcessor;
                if (asmBtn) asmBtn.disabled = !hasProcessor;
                if (veriBtn) veriBtn.disabled = !hasProcessor;
                if (waveBtn) waveBtn.disabled = !hasProcessor;
                if (prismBtn) prismBtn.disabled = !hasProcessor;
                if (allBtn) allBtn.disabled = !hasProcessor;
                if (settingsBtn) settingsBtn.disabled = false;
            }
        };
        
        verilogModeRadio?.addEventListener('change', updateButtonStates);
        processorModeRadio?.addEventListener('change', updateButtonStates);
        projectModeRadio?.addEventListener('change', updateButtonStates);
        
        // Initial update
        updateButtonStates();
    }

    isProcessorConfigured() {
        const el = document.getElementById('processorNameID');
        return el && !el.textContent.includes('No Processor Configured');
    }

    async runAll() {
        if (!this.isProcessorConfigured()) return alert('Please configure a processor first.');
        
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
    const verilogModeRadio = document.getElementById('Verilog Mode');
    const processorModeRadio = document.getElementById('Processor Mode');
    const projectModeRadio = document.getElementById('Project Mode');
    
    if (verilogModeRadio?.checked) return 'verilog';
    if (processorModeRadio?.checked) return 'processor';
    if (projectModeRadio?.checked) return 'project';
    
    return 'processor'; // Default fallback
}

    async runSingleStep(step) {
        const currentMode = this.getCurrentMode();
        
        // For Verilog Mode, only certain steps are valid
        if (currentMode === 'verilog') {
            if (!['verilog', 'prism'].includes(step)) {
                alert('This compilation step is not available in Verilog Mode.');
                return;
            }
        } else {
            // Processor/Project modes need processor configuration
            if (!this.isProcessorConfigured()) {
                return alert('Please configure a processor first.');
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
                const isProjectMode = currentMode === 'project';
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
        isCompilationRunning = false;
        window.electronAPI.cancelVvpProcess();
        setCompilationButtonsState(false);
        // Add user notification if needed
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