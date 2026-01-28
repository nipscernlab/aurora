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

// Make checkCancellation globally accessible for CompilationModule
if (typeof window !== 'undefined') {
    window.checkCancellation = checkCancellation;
}

function switchTerminal(targetId) {
    document.querySelectorAll('.terminal-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(targetId)?.classList.remove('hidden');
    document.querySelector(`.tab[data-terminal="${targetId.replace('terminal-', '')}"]`)?.classList.add('active');
}

function setCompilationButtonsState(disabled) {
    /*
    const buttons = ['cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp', 'fractalcomp'];
    buttons.forEach(id => {
        const button = document.getElementById(id);
        if (button) {
            button.disabled = disabled;
            button.style.cursor = disabled ? 'not-allowed' : 'pointer';
            button.style.opacity = disabled ? '0.6' : '1';
        }
    }); */
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
    
    // Button states
    const cmmBtn = document.getElementById('cmmcomp');
    const asmBtn = document.getElementById('asmcomp');
    const veriBtn = document.getElementById('vericomp');
    const waveBtn = document.getElementById('wavecomp');
    const prismBtn = document.getElementById('prismcomp');
    const allBtn = document.getElementById('allcomp');
    
    // In Verilog Mode, compilation flow buttons are restricted
    if (mode === 'verilog') {
        /*
        if (cmmBtn) cmmBtn.disabled = true;
        if (asmBtn) asmBtn.disabled = true;
        if (veriBtn) veriBtn.disabled = false;
        if (waveBtn) waveBtn.disabled = true;
        if (prismBtn) prismBtn.disabled = false;
        if (allBtn) allBtn.disabled = true;
        */
    } else {
        // Processor/Project modes
        const hasProcessor = this.isProcessorConfigured();
        
        // CMM and ASM always need processor
        if (cmmBtn) cmmBtn.disabled = !hasProcessor;
        if (asmBtn) asmBtn.disabled = !hasProcessor;
        
        // In Project Mode, Verilog and Wave can work without processors IF project has files
        // In Processor Mode, they need a processor
        if (mode === 'project') {
            // Project Mode: Enable Verilog/Wave/PRISM even without processors
            // (they'll fail gracefully if files aren't configured)
            if (veriBtn) veriBtn.disabled = false;
            if (waveBtn) waveBtn.disabled = false;
            if (prismBtn) prismBtn.disabled = false;
        } else {
            // Processor Mode: Need processor
            if (veriBtn) veriBtn.disabled = !hasProcessor;
            if (waveBtn) waveBtn.disabled = !hasProcessor;
            if (prismBtn) prismBtn.disabled = !hasProcessor;
        }
        
        // Run All always needs processor (full pipeline)
        if (allBtn) allBtn.disabled = !hasProcessor;
    }
}

hasValidProjectConfig() {
    try {
        const toggleButton = document.getElementById('toggle-ui');
        const isProjectMode = toggleButton && toggleButton.classList.contains('active');
        
        if (!isProjectMode) return false;
        
        // Check if we have minimum required files for compilation
        // This could be enhanced to actually check projectOriented.json
        return true;
    } catch {
        return false;
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
    startCompilation();
    try {
        const compiler = new CompilationModule(window.currentProjectPath);
        await compiler.loadConfig();
        
        const isProjectMode = document.getElementById('toggle-ui')?.classList.contains('active');
        const hasProcessors = compiler.config?.processors?.length > 0;
        
        // Run All requires processors
        if (!hasProcessors) {
            await showDialog({
                title: 'Configuration Required',
                message: 'Full Build (Run All) requires at least one configured processor. Use individual compilation steps for processor-less projects.',
                buttons: [
                    { label: 'OK', type: 'cancel', action: 'close' }
                ]
            });
            endCompilation();
            return;
        }
        
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
    // Check radio buttons for mode
    const verilogModeToggle = document.getElementById('Verilog Mode');
    const processorModeRadio = document.getElementById('Processor Mode');
    const projectModeRadio = document.getElementById('Project Mode');
    
    // Priority: Check which radio is actually checked
    if (projectModeRadio?.checked) {
        console.log('🎯 Current mode detected: PROJECT');
        return 'project';
    }
    
    if (processorModeRadio?.checked) {
        console.log('🎯 Current mode detected: PROCESSOR');
        return 'processor';
    }
    
    // Verilog Mode: Toggle unchecked means Verilog Mode is active
    if (verilogModeToggle && !verilogModeToggle.checked) {
        console.log('🎯 Current mode detected: VERILOG');
        return 'verilog';
    }
    
    // Default fallback
    console.log('⚠️ No mode detected, defaulting to PROCESSOR');
    return 'processor';
}

async runSingleStep(step) {
        // 1. Tratamento Especial para PRISM (Mantendo sua lógica nova que funciona)
        if (step === 'prism') {
            console.log("🚀 Trigger PRISM acionado via Command Palette");
            startCompilation(); // Atualiza UI para estado "compilando"
            
            try {
                const projectPath = window.currentProjectPath || await window.electronAPI.dirname(window.currentOpenProjectPath);
                if (!projectPath) throw new Error("Abra um projeto primeiro.");

                const rawComponentsPath = await window.electronAPI.getComponentsPath();
                const normalizePath = (p) => p.replace(/\\/g, '/');
                
                const compilationPaths = {
                    projectPath: normalizePath(projectPath),
                    componentsPath: normalizePath(rawComponentsPath),
                    hdlPath: normalizePath(await window.electronAPI.joinPath(rawComponentsPath, 'HDL')),
                    tempPath: normalizePath(await window.electronAPI.joinPath(rawComponentsPath, 'Temp', 'PRISM')),
                    yosysPath: normalizePath(await window.electronAPI.joinPath(rawComponentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe')),
                    netlistsvgPath: normalizePath(await window.electronAPI.joinPath(rawComponentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe')),
                    processorConfigPath: normalizePath(await window.electronAPI.joinPath(projectPath, 'processorConfig.json')),
                    projectOrientedConfigPath: normalizePath(await window.electronAPI.joinPath(projectPath, 'projectOriented.json')),
                    topLevelPath: normalizePath(await window.electronAPI.joinPath(projectPath, 'TopLevel'))
                };

                const result = await window.electronAPI.prismCompileWithPaths(compilationPaths);
                if (!result.success) throw new Error(result.message);
                
                console.log("✅ Trigger PRISM concluído com sucesso");
            } catch (error) {
                console.error("Erro no trigger PRISM:", error);
                if(window.terminalManager) window.terminalManager.appendToTerminal('tveri', `Erro PRISM: ${error.message}`, 'error');
            } finally {
                endCompilation(); // Restaura UI
            }
            return;
        }

        // 2. Tratamento para CMM, ASM, Verilog, Wave (A parte que estava faltando)
        startCompilation();
        try {
            const compiler = new CompilationModule(window.currentProjectPath);
            await compiler.loadConfig();
            
            // Precisamos do processador ativo para estas etapas
            const activeProcessor = compiler.config.processors.find(p => p.isActive === true);
            if (!activeProcessor) {
                throw new Error("Nenhum processador ativo configurado. Selecione um processador no Processor Hub.");
            }

            switch (step) {
                case 'cmm':
                    switchTerminal('terminal-tcmm');
                    await compiler.ensureDirectories(activeProcessor.name);
                    await compiler.cmmCompilation(activeProcessor);
                    break;
                
                case 'asm':
                    switchTerminal('terminal-tasm');
                    // O segundo argumento '0' indica modo processador (padrão) vs projeto
                    await compiler.asmCompilation(activeProcessor, 0); 
                    break;
                
                case 'verilog':
                    switchTerminal('terminal-tveri');
                    await compiler.iverilogCompilation(activeProcessor);
                    break;
                
                case 'wave':
                    switchTerminal('terminal-twave');
                    await compiler.runGtkWave(activeProcessor);
                    break;
                    
                default:
                    console.warn(`Passo desconhecido: ${step}`);
            }
        } catch (error) {
            console.error(`Erro na etapa ${step}:`, error);
            // Tenta logar no terminal apropriado se possível
            const termMap = { 'cmm': 'tcmm', 'asm': 'tasm', 'verilog': 'tveri', 'wave': 'twave' };
            if (window.terminalManager) {
                window.terminalManager.appendToTerminal(termMap[step] || 'tcmm', `Erro Fatal: ${error.message}`, 'error');
            }
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
        
        // Ensure we get the absolute path from the API
        const rawComponentsPath = await window.electronAPI.getComponentsPath();
        
        // Normalize slashes immediately to avoid issues downstream
        const componentsPath = normalizePath(rawComponentsPath);
        const projectPathNorm = normalizePath(projectPath);

        return {
            projectPath: projectPathNorm,
            componentsPath: componentsPath,
            // Construct ABSOLUTE paths for all resources
            hdlPath: normalizePath(await window.electronAPI.joinPath(rawComponentsPath, 'HDL')),
            tempPath: normalizePath(await window.electronAPI.joinPath(rawComponentsPath, 'Temp', 'PRISM')),
            yosysPath: normalizePath(await window.electronAPI.joinPath(rawComponentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe')),
            netlistsvgPath: normalizePath(await window.electronAPI.joinPath(rawComponentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe')),
            // Project specific paths
            processorConfigPath: normalizePath(await window.electronAPI.joinPath(projectPath, 'processorConfig.json')),
            projectOrientedConfigPath: normalizePath(await window.electronAPI.joinPath(projectPath, 'projectOriented.json')),
            topLevelPath: normalizePath(await window.electronAPI.joinPath(projectPath, 'TopLevel'))
        };
    }
}

function normalizePath(pathStr) {
    return pathStr.replace(/\\/g, '/');
}

const compilationFlowManager = new CompilationFlowManager();
export { compilationFlowManager, checkCancellation };