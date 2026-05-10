// compilation_flow.js

import { CompilationModule } from './compilation_module.js';
import { showDialog } from '../ui/dialog_manager.js';
import { toForwardSlashes } from '../utils/path_utils.js';

let compilationCanceled = false;

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

function setCompilationButtonsState(_disabled) {
    // Botões de compilação ficam sempre habilitados; o gating de comportamento
    // acontece em modo (Verilog/Processor/Project) — ver setCompilationModeButtons.
}

function startCompilation() {
    compilationCanceled = false;
    setCompilationButtonsState(true);
    const tm = window.initializeGlobalTerminalManager();
    // Fresh slate for every compile so the user isn't reading mixed
    // logs from a previous run when looking for errors. Synchronous
    // wipe (clearAllTerminalsImmediate) — the async fade-clear used
    // by the manual "Clear" button would race against the first
    // appendToTerminal of the new run and erase its initial lines.
    tm?.clearAllTerminalsImmediate?.();
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

    // 3. Verilog Simulation/Verification
    switchTerminal('terminal-tveri');
    checkCancellation();
    await compiler.iverilogCompilation(activeProcessor);

    // 4. Waveform Visualization
    switchTerminal('terminal-twave');
    checkCancellation();
    await compiler.runGtkWave(activeProcessor);
}

async function runProjectPipeline(compiler) {
    const processors = compiler.projectConfig?.processors ?? [];

    // 1. If processors are configured, compile each (CMM + ASM). With no
    //    processors this stage is a no-op — the project becomes a pure
    //    Verilog flow (the old "Verilog Mode") without any per-mode
    //    branching elsewhere.
    if (processors.length > 0) {
        switchTerminal('terminal-tcmm');
        for (const projectProcessor of processors) {
            checkCancellation();
            const processorConfig = compiler.config.processors.find(p => p.name === projectProcessor.type);
            if (!processorConfig) continue;

            await compiler.ensureDirectories(processorConfig.name);
            await compiler.cmmCompilation(processorConfig);
            await compiler.asmCompilation(processorConfig, 1);
        }
    }

    // 2. Verilog. The compiler picks the iverilog vs iverilog-only path
    //    internally based on whether processors are present.
    switchTerminal('terminal-tveri');
    checkCancellation();
    if (processors.length > 0) {
        await compiler.iverilogProjectCompilation();
    } else {
        await compiler.iverilogVerilogOnlyCompilation();
    }

    // 3. Waveform
    switchTerminal('terminal-twave');
    checkCancellation();
    if (processors.length > 0) {
        await compiler.runProjectGtkWave();
    } else {
        await compiler.runVerilogOnlyGtkWave();
    }
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

        // The "Compile & Simulate" checkbox (and its localStorage key
        // aurora_compile_sim_state) was removed when Verilog Mode merged
        // into Project Mode. The pipeline now decides simulate-or-not
        // from projectConfig.processors directly.

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
    // All compilation buttons stay enabled in both modes; per-step
    // gating happens inside runSingleStep / pipelines, which decide
    // what to actually do based on processor count.
    for (const id of ['cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp']) {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = false;
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

        const mode = this.getCurrentMode();

        if (mode === 'processor') {
            const hasProcessors = compiler.config?.processors?.length > 0;
            if (!hasProcessors) {
                await showDialog({
                    title: 'Configuration Required',
                    message: 'Run All in Processor Mode requires at least one configured processor.',
                    buttons: [{ label: 'OK', type: 'cancel', action: 'close' }],
                });
                endCompilation();
                return;
            }
            await runProcessorPipeline(compiler);
        } else {
            // Project Mode — pipeline auto-decides between full and
            // verilog-only depending on whether processors are configured.
            await runProjectPipeline(compiler);
        }
    } catch (error) {
        console.error('Compilation error:', error);
    } finally {
        endCompilation();
    }
}

/**
 * IDE mode for compilation routing — `'processor'` or `'project'`.
 * Delegates to AppInitializer when available; falls back to reading the
 * radios for the early-startup window before initialize() runs.
 */
getCurrentMode() {
    const fromInit = window.appInitializer?.getCurrentMode?.();
    if (fromInit === 'processor' || fromInit === 'project') return fromInit;

    const projectModeRadio = document.getElementById('Project Mode');
    const processorModeRadio = document.getElementById('Processor Mode');
    if (projectModeRadio?.checked) return 'project';
    if (processorModeRadio?.checked) return 'processor';
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

                const compilationPaths = {
                    projectPath: toForwardSlashes(projectPath),
                    componentsPath: toForwardSlashes(rawComponentsPath),
                    hdlPath: toForwardSlashes(await window.electronAPI.joinPath(rawComponentsPath, 'HDL')),
                    tempPath: toForwardSlashes(await window.electronAPI.joinPath(rawComponentsPath, 'Temp', 'PRISM')),
                    yosysPath: toForwardSlashes(await window.electronAPI.joinPath(rawComponentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe')),
                    netlistsvgPath: toForwardSlashes(await window.electronAPI.joinPath(rawComponentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe')),
                    processorConfigPath: toForwardSlashes(await window.electronAPI.joinPath(projectPath, 'processorConfig.json')),
                    projectOrientedConfigPath: toForwardSlashes(await window.electronAPI.joinPath(projectPath, 'projectOriented.json')),
                    topLevelPath: toForwardSlashes(await window.electronAPI.joinPath(projectPath, 'TopLevel')),
                    compilationMode: this.getCurrentMode()
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

        // 2. CMM, ASM, Verilog, Wave per-step buttons.
        startCompilation();
        try {
            const compiler = new CompilationModule(window.currentProjectPath);
            await compiler.loadConfig();
            const currentMode = this.getCurrentMode();

            // Project Mode: Verilog and Wave routes auto-pick between
            // the project-pipeline and verilog-only pipeline based on
            // whether processors are configured. CMM/ASM only make sense
            // when there are processors.
            if (currentMode === 'project') {
                const hasProcessors = (compiler.projectConfig?.processors?.length ?? 0) > 0;

                if (step === 'verilog') {
                    switchTerminal('terminal-tveri');
                    if (hasProcessors) await compiler.iverilogProjectCompilation();
                    else                await compiler.iverilogVerilogOnlyCompilation();
                    return;
                }
                if (step === 'wave') {
                    switchTerminal('terminal-twave');
                    if (hasProcessors) await compiler.runProjectGtkWave();
                    else                await compiler.runVerilogOnlyGtkWave();
                    return;
                }
                if ((step === 'cmm' || step === 'asm') && !hasProcessors) {
                    throw new Error('CMM/ASM require at least one configured processor in this project.');
                }
                // CMM/ASM with processors fall through to the processor flow below.
            }

            // Processor steps (Processor Mode, or CMM/ASM in Project Mode
            // with processors) need an active processor.
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
                    // 0 = processor mode, 1 = project mode (asmCompilation
                    // signature predates the merge; keep as-is for now).
                    await compiler.asmCompilation(activeProcessor, currentMode === 'project' ? 1 : 0);
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
        window.electronAPI.cancelVvpProcess()
            .catch(err => console.warn('cancelVvpProcess failed:', err?.message ?? err));
        setCompilationButtonsState(false);
    }

    initializePrismButton() {
        const prismButton = document.getElementById('prismcomp');
        if (!prismButton) return;

        prismButton.addEventListener('click', async () => {
            // Buttons are always enabled — compilation state is shown via terminal feedback only
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
        const componentsPath = toForwardSlashes(rawComponentsPath);
        const projectPathNorm = toForwardSlashes(projectPath);

        return {
            projectPath: projectPathNorm,
            componentsPath: componentsPath,
            // Construct ABSOLUTE paths for all resources
            hdlPath: toForwardSlashes(await window.electronAPI.joinPath(rawComponentsPath, 'HDL')),
            tempPath: toForwardSlashes(await window.electronAPI.joinPath(rawComponentsPath, 'Temp', 'PRISM')),
            yosysPath: toForwardSlashes(await window.electronAPI.joinPath(rawComponentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe')),
            netlistsvgPath: toForwardSlashes(await window.electronAPI.joinPath(rawComponentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe')),
            // Project specific paths
            processorConfigPath: toForwardSlashes(await window.electronAPI.joinPath(projectPath, 'processorConfig.json')),
            projectOrientedConfigPath: toForwardSlashes(await window.electronAPI.joinPath(projectPath, 'projectOriented.json')),
            topLevelPath: toForwardSlashes(await window.electronAPI.joinPath(projectPath, 'TopLevel')),
            compilationMode: this.getCurrentMode()
        };
    }
}

const compilationFlowManager = new CompilationFlowManager();
export { compilationFlowManager, checkCancellation };