// compilation_flow.js

import { CompilationModule } from './compilation_module.js';
import { toForwardSlashes } from '../utils/path_utils.js';
import { TabManager } from '../tabs/tab_manager.js';

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

// Per-step → terminals the step actually writes to. Drives the
// targeted clear in startCompilation so unrelated terminals (e.g.
// the tcmm output from a previous CMM run) survive when the user
// runs only Wave or only PRISM. Keep in sync with the step branches
// in runSingleStep below.
const STEP_TERMINALS = Object.freeze({
    cmm:     ['tcmm'],
    asm:     ['tasm'],
    verilog: ['tveri'],
    wave:    ['twave'],
    prism:   ['tveri'],
});
const ALL_TERMINALS = Object.freeze(['tcmm', 'tasm', 'tveri', 'twave']);

/**
 * @param {string[]} [terminalsToClear]
 *   IDs of terminals to wipe before logging the new run. Pass
 *   STEP_TERMINALS[step] for a single-step button, ALL_TERMINALS for
 *   Full Build / Run All. Undefined leaves all terminals intact —
 *   should rarely happen; surface as a missing-mapping if it does.
 */
function startCompilation(terminalsToClear) {
    compilationCanceled = false;
    setCompilationButtonsState(true);
    const tm = window.initializeGlobalTerminalManager();
    if (tm && Array.isArray(terminalsToClear)) {
        for (const id of terminalsToClear) tm.clearTerminalImmediate?.(id);
    }
}

function endCompilation() {
    setCompilationButtonsState(false);
}

// ----------------------------------------------------------------------
// PIPELINES (Updated to respect Toggle State)
// ----------------------------------------------------------------------

// FASE 2: runProcessorPipeline (Processor Mode full build) removida —
// runAll agora chama so runProjectPipeline.
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

    // 2. Verilog. iverilogProjectCompilation dispatches internally:
    //    no processors → the standalone path (no processor HDL, just
    //    user sources + library), with processors → the full project
    //    path. Don't re-do the dispatch here.
    switchTerminal('terminal-tveri');
    checkCancellation();
    await compiler.iverilogProjectCompilation();

    // 3. Waveform — runProjectGtkWave dispatches the same way.
    switchTerminal('terminal-twave');
    checkCancellation();
    await compiler.runProjectGtkWave();
}

/**
 * Dado um path de arquivo e a lista de processadores configurados,
 * descobre a qual processador o arquivo pertence procurando o padrao
 *   <projectPath>/<procName>/{Hardware|Software|Simulation}/<arquivo>
 * Devolve o objeto do processador (com casing original) ou null.
 *
 * Mesmo padrao que VerilogTreeManager._getProcessorForFile, replicado
 * aqui pra evitar acoplamento entre o pipeline de compilacao e o file
 * tree manager.
 */
function findProcessorForPath(filePath, projectPath, processors) {
    if (!filePath || !projectPath || !Array.isArray(processors)) return null;
    const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
    const fp = norm(filePath);
    const pp = norm(projectPath);
    if (!fp.startsWith(pp)) return null;
    const rel = fp.slice(pp.length).replace(/^\/+/, '');
    const segs = rel.split('/');
    if (segs.length < 3) return null;
    const sub = segs[1];
    if (sub !== 'hardware' && sub !== 'software' && sub !== 'simulation') return null;
    const procNameLower = segs[0];
    // Tolera entradas como string (projectOriented.json) ou objeto com
    // .name (processorConfig.json). Devolve sempre um objeto pra que
    // o caller possa fazer { ...processor, cmmFile: ... }.
    const match = processors.find((p) => {
        const n = typeof p === 'string' ? p : p?.name;
        return n && n.toLowerCase() === procNameLower;
    });
    if (!match) return null;
    return typeof match === 'string' ? { name: match } : match;
}

/**
 * Verifica se os artefatos do cmmcomp ja foram gerados pra esse
 * processador. asmcomp depende deles (cmm_log.txt e onde ele le
 * num_ins, prname, n_dat, nubits, nbmant, nbexpo, itr_addr — ver
 * yanc/ASM/Sources/eval.c:eval_init).
 *
 * Por enquanto a unica condicao e a existencia de cmm_log.txt. Se
 * aparecerem mais (ex: pc_<name>_mem.txt, trad_cmm.txt), encadear
 * aqui com && no return.
 */
async function cmmArtifactsExist(compiler, procName) {
    const tempProc = await window.electronAPI.joinPath(
        compiler.componentsPath, 'Temp', procName,
    );
    const cmmLog = await window.electronAPI.joinPath(tempProc, 'cmm_log.txt');
    return await window.electronAPI.fileExists(cmmLog);
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

        this.updateButtonStates();
    }

    // FASE 2.5: setupModeListeners removido — escutava os radios de modo
    // que ja foram escondidos. hasValidProjectConfig + isProcessorConfigured
    // tambem deletados (orfaos).

    updateButtonStates() {
        // All compilation buttons stay enabled; per-step gating happens
        // inside runSingleStep / pipelines, which decide what to actually
        // do based on processor count.
        for (const id of ['cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp']) {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = false;
        }
    }

// FASE 2: runPrismForCurrentMode removida — era orfa e chamava
// CompilationModule.prismProjectCompilation() que nem existe (resto
// de uma refatoracao incompleta antiga). PRISM hoje passa pelo
// branch step==='prism' em runSingleStep que invoca diretamente o
// IPC prism-compile-with-paths.

async runAll() {
    // FASE 2: branch de Processor Mode deletado. Botao Full Build ja
    // foi escondido na fase 1.5, mas runAll continua acessivel via
    // command palette antigo / atalhos externos. So roda o project
    // pipeline.
    startCompilation(ALL_TERMINALS);
    try {
        const compiler = new CompilationModule(window.currentProjectPath);
        await compiler.loadConfig();
        await runProjectPipeline(compiler);
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
    // FASE 1: lockado em 'project'. Ver comentario em
    // app_initializer.getCurrentMode().
    return 'project';
}

async runSingleStep(step) {
        // 1. Tratamento Especial para PRISM (Mantendo sua lógica nova que funciona)
        if (step === 'prism') {
            console.log("🚀 Trigger PRISM acionado via Command Palette");
            startCompilation(STEP_TERMINALS.prism); // Atualiza UI para estado "compilando"
            
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

        // 1.5. Botao C±: o usuario pediu pra que ele compile o .cmm que
        //      esta aberto no Monaco, ignorando o "active processor" do
        //      hub. Se o arquivo em foco no editor nao for .cmm, no-op
        //      (apenas uma dica no terminal — sem bagunçar o status
        //      updater nem limpar o terminal por nada).
        if (step === 'cmm') {
            const editingPath = TabManager.getEditingFilePath?.();
            if (!editingPath || !editingPath.toLowerCase().endsWith('.cmm')) {
                switchTerminal('terminal-tcmm');
                if (window.terminalManager?.appendToTerminal) {
                    window.terminalManager.appendToTerminal(
                        'tcmm',
                        'No .cmm file is open in the editor. Open a .cmm and try again.',
                        'tips',
                    );
                }
                return;
            }

            startCompilation(STEP_TERMINALS.cmm);
            try {
                const compiler = new CompilationModule(window.currentProjectPath);
                await compiler.loadConfig();

                // Em Project Mode os processadores podem estar listados em
                // projectOriented.json (compiler.projectConfig) ou nao
                // estar em nenhum dos dois JSONs (caso comum: o .spf lista
                // a pasta ProcDTW/ mas processorConfig.json esta vazio).
                // window.availableProcessors e a lista canonica vinda do
                // .spf — e e o que o file tree usa pra agrupar arquivos.
                // Combinamos as tres fontes pra cobrir qualquer setup.
                const allProcessors = [
                    ...(compiler.config?.processors || []),
                    ...(compiler.projectConfig?.processors || []),
                    ...(Array.isArray(window.availableProcessors) ? window.availableProcessors : []),
                ];
                const procFromPath = findProcessorForPath(
                    editingPath,
                    window.currentProjectPath,
                    allProcessors,
                );
                if (!procFromPath) {
                    throw new Error(
                        `Cannot resolve a processor for "${editingPath}". ` +
                        `The file must live in <project>/<processor>/{Software,Hardware,Simulation}/.`,
                    );
                }

                // getSelectedCmmFile prioriza this.config.selectedCmmFile sobre
                // processor.cmmFile — limpamos pra forcar o uso do override.
                if (compiler.config) compiler.config.selectedCmmFile = null;
                const cmmFileName = editingPath.split(/[\\/]/).pop();
                const overrideProcessor = { ...procFromPath, cmmFile: cmmFileName };

                switchTerminal('terminal-tcmm');
                await compiler.ensureDirectories(overrideProcessor.name);
                await compiler.cmmCompilation(overrideProcessor);
            } catch (error) {
                console.error('Erro na etapa cmm:', error);
                if (window.terminalManager?.appendToTerminal) {
                    window.terminalManager.appendToTerminal('tcmm', `Erro Fatal: ${error.message}`, 'error');
                }
            } finally {
                endCompilation();
            }
            return;
        }

        // 1.6. Botao ASM: mesmo padrao do C+- mas aceita tanto .cmm
        //      quanto .asm em foco. asmCompilation internamente deriva
        //      o caminho do .asm a partir do basename do "cmmFile" que
        //      recebe (e.g. cmmFile="ProcDTW.cmm" -> asm em
        //      <proc>/Software/ProcDTW.asm). Entao mesmo quando o
        //      usuario esta editando o .asm direto, montamos um
        //      cmmFile sintetico "<base>.cmm" e o asmcomp.exe acaba
        //      trabalhando no .asm correto de qualquer jeito.
        if (step === 'asm') {
            const editingPath = TabManager.getEditingFilePath?.();
            const lower = (editingPath || '').toLowerCase();
            const isCmm = lower.endsWith('.cmm');
            const isAsm = lower.endsWith('.asm');
            if (!editingPath || (!isCmm && !isAsm)) {
                switchTerminal('terminal-tasm');
                if (window.terminalManager?.appendToTerminal) {
                    window.terminalManager.appendToTerminal(
                        'tasm',
                        'No .cmm or .asm file is open in the editor. Open one and try again.',
                        'tips',
                    );
                }
                return;
            }

            startCompilation(STEP_TERMINALS.asm);
            try {
                const compiler = new CompilationModule(window.currentProjectPath);
                await compiler.loadConfig();

                const allProcessors = [
                    ...(compiler.config?.processors || []),
                    ...(compiler.projectConfig?.processors || []),
                    ...(Array.isArray(window.availableProcessors) ? window.availableProcessors : []),
                ];
                const procFromPath = findProcessorForPath(
                    editingPath,
                    window.currentProjectPath,
                    allProcessors,
                );
                if (!procFromPath) {
                    throw new Error(
                        `Cannot resolve a processor for "${editingPath}". ` +
                        `The file must live in <project>/<processor>/{Software,Hardware,Simulation}/.`,
                    );
                }

                if (compiler.config) compiler.config.selectedCmmFile = null;
                // asmCompilation espera "<base>.cmm" e remove .cmm pra
                // achar o .asm. Trocamos a extensao do arquivo aberto
                // pra cmm pra cobrir ambos os casos (cmm aberto: o nome
                // ja vem certo; asm aberto: trocamos .asm por .cmm).
                const baseName = editingPath.split(/[\\/]/).pop().replace(/\.(cmm|asm)$/i, '');
                // clk/numClocks hardcoded por enquanto. Sem isso, um
                // processor montado a partir do .spf (so name) cai em
                // 0/0 e o asmcomp gera um testbench inutil. Valores
                // escolhidos pelo usuario: 100 MHz, 2000 clocks.
                const overrideProcessor = {
                    ...procFromPath,
                    cmmFile: `${baseName}.cmm`,
                    clk: 100,
                    numClocks: 2000,
                };

                switchTerminal('terminal-tasm');
                await compiler.ensureDirectories(overrideProcessor.name);

                // asmcomp depende de artefatos que so o cmmcomp gera
                // (cmm_log.txt principalmente — lido em
                // yanc/ASM/Sources/eval.c). Se o usuario clica ASM sem
                // ter rodado C+- antes, ou se a pasta Temp foi limpa,
                // o asmcomp falha com "system cannot find the path".
                //
                // Pre-condicao: cmm_log.txt presente em
                // <components>/Temp/<proc>/. Se faltar, recompila o
                // cmm primeiro (logando uma dica no tasm pra o usuario
                // saber pra onde olhar). Pra adicionar mais
                // condicoes, encadear com && no return da funcao.
                const cmmArtifactsReady = await cmmArtifactsExist(
                    compiler,
                    overrideProcessor.name,
                );
                let asmPreamble = null;
                if (!cmmArtifactsReady) {
                    await compiler.cmmCompilation(overrideProcessor);
                    // Voltamos pro tasm depois do cmm pra que as
                    // mensagens do asmCompilation cheguem pro terminal
                    // que o usuario clicou (cmmCompilation deixa o
                    // foco em tcmm).
                    switchTerminal('terminal-tasm');
                    // Mensagem de explicacao vai como preamble do
                    // asmCompilation — caso contrario o clearTerminal
                    // que ele faz logo no inicio apagava ela. Prefixo
                    // "Info:" + tipo 'tips' garantem renderizacao em
                    // azul mesmo se um dos dois caminhos quebrar.
                    asmPreamble = 'Info: cmm_log.txt was missing — C± was recompiled first. See tcmm terminal for its output.';
                }

                // projectParam=1 -> asmcomp.exe NAO inclui o bloco
                // "$finish quando atinge @fim" no testbench gerado.
                // Decisao temporaria: o botao sempre usa 1, deixando
                // o usuario controlar a parada via testbench externo
                // ou via parametros do iverilog/vvp. A heuristica
                // "0 quando testbench standard, 1 quando custom"
                // ficou de lado por escolha do usuario.
                await compiler.asmCompilation(overrideProcessor, 1, asmPreamble);
            } catch (error) {
                console.error('Erro na etapa asm:', error);
                if (window.terminalManager?.appendToTerminal) {
                    window.terminalManager.appendToTerminal('tasm', `Erro Fatal: ${error.message}`, 'error');
                }
            } finally {
                endCompilation();
            }
            return;
        }

        // 1.7. Botao Wave: antes de mandar pro fluxo de simulacao,
        //      compila C+- + ASM (que ja incorpora o appcomp) para
        //      TODOS os processadores conhecidos do projeto. Sem essa
        //      pre-compilacao, o vvp falha com "$readmemb: Unable to
        //      open pc_<proc>_mem.txt" porque o cmmcomp nao gerou
        //      o arquivo, ou o asmcomp nao gerou o .vvp.
        //
        //      Lista de processadores combina as mesmas tres fontes
        //      dos botoes C+- e ASM (config + projectConfig + .spf).
        //      Convencao: o .cmm de cada processador chama-se
        //      <procName>.cmm e mora em <proj>/<procName>/Software/.
        //      Processadores sem esse arquivo sao pulados com warning.
        if (step === 'wave') {
            startCompilation(STEP_TERMINALS.wave);
            try {
                const compiler = new CompilationModule(window.currentProjectPath);
                await compiler.loadConfig();

                const seenProcs = new Map(); // name(lower) -> processor object
                const sources = [
                    compiler.config?.processors,
                    compiler.projectConfig?.processors,
                    (Array.isArray(window.availableProcessors) ? window.availableProcessors : [])
                        .map((n) => (typeof n === 'string' ? { name: n } : n)),
                ];
                for (const src of sources) {
                    if (!Array.isArray(src)) continue;
                    for (const p of src) {
                        const n = typeof p === 'string' ? p : p?.name;
                        if (!n) continue;
                        const key = n.toLowerCase();
                        if (!seenProcs.has(key)) {
                            seenProcs.set(key, typeof p === 'string' ? { name: p } : p);
                        }
                    }
                }

                if (seenProcs.size === 0) {
                    if (window.terminalManager?.appendToTerminal) {
                        window.terminalManager.appendToTerminal(
                            'twave',
                            'Warning: no processors found to pre-compile — skipping straight to simulation.',
                            'warning',
                        );
                    }
                } else {
                    if (window.terminalManager?.appendToTerminal) {
                        window.terminalManager.appendToTerminal(
                            'twave',
                            `Info: pre-compiling ${seenProcs.size} processor(s) (C± + ASM) before simulation.`,
                            'tips',
                        );
                    }
                    for (const proc of seenProcs.values()) {
                        const cmmFileName = `${proc.name}.cmm`;
                        const cmmPath = await window.electronAPI.joinPath(
                            window.currentProjectPath, proc.name, 'Software', cmmFileName,
                        );
                        const cmmExists = await window.electronAPI.fileExists(cmmPath);
                        if (!cmmExists) {
                            if (window.terminalManager?.appendToTerminal) {
                                window.terminalManager.appendToTerminal(
                                    'twave',
                                    `Warning: no ${cmmFileName} at ${cmmPath} — skipping ${proc.name}.`,
                                    'warning',
                                );
                            }
                            continue;
                        }

                        // Override igual ao usado pelos botoes C+- e
                        // ASM: garante cmmFile correto e parametros
                        // clk/numClocks razoaveis pra processadores que
                        // vem do .spf sem esses campos.
                        const overrideProcessor = {
                            ...proc,
                            cmmFile: cmmFileName,
                            clk: 100,
                            numClocks: 2000,
                        };
                        if (compiler.config) compiler.config.selectedCmmFile = null;

                        await compiler.ensureDirectories(proc.name);
                        await compiler.cmmCompilation(overrideProcessor);
                        await compiler.asmCompilation(overrideProcessor, 1);
                    }
                    // Volta o foco pro twave depois do cmm/asm
                    // (que mudaram o terminal ativo).
                    switchTerminal('terminal-twave');
                }

                // FASE 2: branch Processor Mode (runGtkWave(activeProcessor))
                // deletado. Project Mode e o unico modo.
                await compiler.runProjectGtkWave();
            } catch (error) {
                console.error('Erro na etapa wave:', error);
                if (window.terminalManager?.appendToTerminal) {
                    window.terminalManager.appendToTerminal('twave', `Erro Fatal: ${error.message}`, 'error');
                }
            } finally {
                endCompilation();
            }
            return;
        }

        // 2. Verilog per-step button. cmm/asm/wave sao tratados em
        //    early returns mais acima (usam o arquivo aberto no
        //    Monaco / pre-compilam todos os processadores). Aqui so
        //    restam Verilog e qualquer step desconhecido.
        //
        //    FASE 2: branch "Processor Mode com active processor" eliminado.
        //    iverilogProjectCompilation funciona com 0 ou N processadores
        //    (dispatcher interno por hasNoProcessors), entao virou o
        //    unico caminho.
        startCompilation(STEP_TERMINALS[step]);
        try {
            const compiler = new CompilationModule(window.currentProjectPath);
            await compiler.loadConfig();

            switch (step) {
                case 'verilog':
                    switchTerminal('terminal-tveri');
                    await compiler.iverilogProjectCompilation();
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