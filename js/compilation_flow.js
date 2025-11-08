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
        document.getElementById('cancel-everything')?.addEventListener('click', this.cancelAll);
        
        this.initializePrismButton();
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

    async runSingleStep(step) {
        if (!this.isProcessorConfigured()) return alert('Please configure a processor first.');

        startCompilation();
        try {
            const compiler = new CompilationModule(window.currentProjectPath);
            await compiler.loadConfig();
            const isProjectMode = document.getElementById('toggle-ui')?.classList.contains('active');
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
                    isProjectMode ? await compiler.iverilogProjectCompilation() : await compiler.iverilogCompilation(activeProcessor);
                    break;
                case 'wave':
                    switchTerminal('terminal-twave');
                    isProjectMode ? await compiler.runProjectGtkWave() : await compiler.runGtkWave(activeProcessor);
                    break;
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
            prismButton.innerHTML = 'Compiling...';
            try {
                // Simplified PRISM logic
                const paths = await this.acquirePrismPaths();
                await window.electronAPI.prismCompileWithPaths(paths);
            } catch (error) {
                console.error('PRISM compilation error:', error);
            } finally {
                prismButton.disabled = false;
                prismButton.innerHTML = 'PRISM';
            }
        });
    }

    async acquirePrismPaths() {
        const projectPath = window.currentProjectPath;
        if (!projectPath) throw new Error('No project path available.');
        const sapho = (path) => window.electronAPI.joinPath('saphoComponents', path);
        
        return {
            projectPath,
            saphoComponentsPath: await sapho(''),
            hdlPath: await sapho('HDL'),
            tempPath: await sapho('Temp/PRISM'),
            yosysPath: await sapho('Packages/PRISM/yosys/yosys.exe'),
            netlistsvgPath: await sapho('Packages/PRISM/netlistsvg/netlistsvg.exe'),
            processorConfigPath: await window.electronAPI.joinPath(projectPath, 'processorConfig.json'),
            projectOrientedConfigPath: await window.electronAPI.joinPath(projectPath, 'projectOriented.json'),
            topLevelPath: await window.electronAPI.joinPath(projectPath, 'TopLevel')
        };
    }
}

const compilationFlowManager = new CompilationFlowManager();
export { compilationFlowManager };