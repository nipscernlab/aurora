/**
 * compilation_flow.js — handlers dos botoes Verilog / Wave / PRISM /
 * C± / ASM / Full Build.
 *
 * Filosofia (post-2026-05):
 *
 *   "Lazy do ponto de vista do usuario": cada botao e self-contained.
 *   O usuario nao precisa lembrar a ordem dos cliques nem rodar
 *   Compile antes de Wave / PRISM. Aceitamos re-trabalho (eager
 *   re-compile a cada click) em troca de "tudo funciona".
 *
 *   Cada botao expande pra mesma sequencia base:
 *
 *     Verilog =        cmm + asm + iverilog(-tnull, top)
 *     PRISM   = Verilog                                   + yosys
 *     Wave    =        cmm + asm + iverilog(-o vvp, tb)   + vvp + gtkwave
 *
 *   Loops cmm+asm sao sobre projectConfig.processors (no-op natural
 *   pra projetos verilog puro — array vazio = loop vazio). Nao ha
 *   branches `if (hasProcessor)` no pipeline.
 *
 * Pra entender o lado do CompilationModule (iverilogCompile,
 * runGtkWave, e as 8 fases _wave*), ver compilation_module.js.
 */

import { CompilationModule } from './compilation_module.js';
import { toForwardSlashes } from '../utils/path_utils.js';
import { TabManager } from '../tabs/tab_manager.js';

// =====================================================================
// Cancellation
// =====================================================================

let compilationCanceled = false;

function checkCancellation() {
    if (compilationCanceled) {
        throw new Error('Compilation canceled by user');
    }
}

// Expoe pro CompilationModule consultar entre fases.
if (typeof window !== 'undefined') {
    window.checkCancellation = checkCancellation;
}

// =====================================================================
// Terminal switching
// =====================================================================

// Per-step → terminals que aquele step escreve. Drives o clear
// targetado no startCompilation: rodar so Wave nao apaga o tcmm do
// CMM rodado antes. Manter em sync com os branches de runSingleStep.
const STEP_TERMINALS = Object.freeze({
    cmm:     ['tcmm'],
    asm:     ['tasm'],
    verilog: ['tveri'],
    wave:    ['twave'],
    prism:   ['tveri'],
});
const ALL_TERMINALS = Object.freeze(['tcmm', 'tasm', 'tveri', 'twave']);

// Map per-step → terminal pra mensagens de erro fatal.
const ERROR_TERMINAL = Object.freeze({
    cmm:     'tcmm',
    asm:     'tasm',
    verilog: 'tveri',
    wave:    'twave',
    prism:   'tveri',
});

function switchTerminal(targetId) {
    document.querySelectorAll('.terminal-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(targetId)?.classList.remove('hidden');
    document.querySelector(`.tab[data-terminal="${targetId.replace('terminal-', '')}"]`)?.classList.add('active');
}

// =====================================================================
// Compilation lifecycle (start / end / cancel)
// =====================================================================

/**
 * @param {string[]} terminalsToClear
 *   IDs dos terminais a limpar antes da nova rodada. Use
 *   STEP_TERMINALS[step] pra botoes single-step, ALL_TERMINALS pra
 *   Full Build. Vazio = nao limpa nada (raro; sintoma de mapping
 *   faltando).
 */
function startCompilation(terminalsToClear) {
    compilationCanceled = false;
    const tm = window.initializeGlobalTerminalManager();
    if (tm && Array.isArray(terminalsToClear)) {
        for (const id of terminalsToClear) tm.clearTerminalImmediate?.(id);
    }
}

function endCompilation() {
    /* Hook reservado pra futuras acoes pos-build (notificacao, badge,
       etc). Hoje no-op — toolbar buttons ficam sempre habilitados. */
}

function logFatalError(terminalId, error) {
    window.terminalManager?.appendToTerminal?.(
        terminalId, `Erro Fatal: ${error.message}`, 'error',
    );
}

// =====================================================================
// Helpers de descoberta de processadores
// =====================================================================

/**
 * Resolve a qual processador um arquivo pertence olhando seu path:
 *   <projectPath>/<procName>/{Hardware|Software|Simulation}/<arquivo>
 * Devolve o objeto do processador (preservando casing original) ou null.
 *
 * Mirrors VerilogTreeManager._getProcessorForFile (replicado aqui pra
 * evitar acoplamento entre o pipeline de compilacao e o file tree).
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
    // Tolera entrada como string (.spf availableProcessors) ou objeto
    // com .name (projectOriented.json processors).
    const match = processors.find((p) => {
        const n = typeof p === 'string' ? p : p?.name;
        return n && n.toLowerCase() === procNameLower;
    });
    if (!match) return null;
    return typeof match === 'string' ? { name: match } : match;
}

/**
 * Coleta a lista canonica de processadores conhecidos do projeto,
 * mesclando projectOriented.json + .spf (window.availableProcessors).
 * As duas fontes podem estar fora de sincronia em projetos antigos —
 * combinamos pra cobrir os casos.
 */
function collectProcessors(compiler) {
    const seen = new Map();
    const sources = [
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
            if (!seen.has(key)) {
                seen.set(key, typeof p === 'string' ? { name: p } : p);
            }
        }
    }
    return [...seen.values()];
}

/**
 * Verifica se o cmmcomp ja gerou seus artefatos pra esse processador.
 * asmcomp depende deles — principalmente cmm_log.txt, lido em
 * yanc/ASM/Sources/eval.c:eval_init pra num_ins, prname, n_dat,
 * nubits, nbmant, nbexpo, itr_addr.
 *
 * Se aparecerem mais pre-condicoes (pc_<name>_mem.txt, trad_cmm.txt),
 * encadear com && no return.
 */
async function cmmArtifactsExist(compiler, procName) {
    const tempProc = await window.electronAPI.joinPath(
        compiler.componentsPath, 'Temp', procName,
    );
    const cmmLog = await window.electronAPI.joinPath(tempProc, 'cmm_log.txt');
    return await window.electronAPI.fileExists(cmmLog);
}

// =====================================================================
// Pre-flight comum: roda cmm + asm pra cada processador
// =====================================================================

// Defaults aplicados em cada processador antes de compilar. cmmFile
// segue a convencao fixa <procName>.cmm. clk/numClocks foram
// hardcoded quando o editor per-proc saiu (fase 4) — se voltar a
// precisar de customizacao, sai daqui pro projectOriented.json.
const PROC_DEFAULTS = Object.freeze({
    clk: 100,
    numClocks: 2000,
});

/**
 * Pre-flight comum aos botoes Verilog / Wave / PRISM: pra cada
 * processador conhecido, roda cmmCompilation + asmCompilation.
 * For-loop sobre array vazio (projeto sem processador) e no-op
 * natural — nao ha branch sobre "tem processador?".
 *
 * Pulamos processadores cuja convencao <proj>/<proc>/Software/<proc>.cmm
 * nao existe em disco (sem .cmm, cmmcomp falharia).
 *
 * @returns contagem de processadores efetivamente compilados.
 */
async function precompileAllProcessors(compiler, terminalId) {
    const procs = collectProcessors(compiler);
    if (procs.length === 0) return 0;

    // componentsPath e populado pelo construtor sem await (background
    // promise). Garante que resolveu antes do primeiro ensureDirectories
    // — que le this.componentsPath direto.
    await compiler.initializeComponentsPath();

    const tm = window.terminalManager;
    tm?.appendToTerminal?.(
        terminalId,
        `Info: pre-compiling ${procs.length} processor(s) (C± + ASM).`,
        'tips',
    );

    let compiled = 0;
    for (const proc of procs) {
        checkCancellation();
        const cmmFileName = `${proc.name}.cmm`;
        const cmmPath = await window.electronAPI.joinPath(
            window.currentProjectPath, proc.name, 'Software', cmmFileName,
        );
        if (!(await window.electronAPI.fileExists(cmmPath))) {
            tm?.appendToTerminal?.(
                terminalId,
                `Warning: no ${cmmFileName} at ${cmmPath} — skipping ${proc.name}.`,
                'warning',
            );
            continue;
        }

        const overrideProcessor = {
            ...proc,
            ...PROC_DEFAULTS,
            cmmFile: cmmFileName,
        };

        await compiler.ensureDirectories(proc.name);
        await compiler.cmmCompilation(overrideProcessor);
        await compiler.asmCompilation(overrideProcessor, 1);
        compiled++;
    }
    return compiled;
}

// =====================================================================
// Full Build pipeline (botao allcomp / command palette)
// =====================================================================

/**
 * Full Build: pre-compila todos os processadores e dispara
 * runGtkWave (que internamente faz iverilog + vvp + gtkwave).
 * Sem branches sobre presenca de processador.
 */
async function runProjectPipeline(compiler) {
    switchTerminal('terminal-tcmm');
    checkCancellation();
    await precompileAllProcessors(compiler, 'tcmm');

    switchTerminal('terminal-twave');
    checkCancellation();
    await compiler.runGtkWave();
}

// =====================================================================
// Per-step handlers (chamados de runSingleStep)
// =====================================================================

/**
 * Botao C±: compila o .cmm aberto no Monaco (ignorando "active
 * processor" — esse conceito saiu na fase 4). Se o arquivo em foco
 * nao for .cmm, no-op com mensagem.
 */
async function handleCmmStep() {
    const editingPath = TabManager.getEditingFilePath?.();
    if (!editingPath || !editingPath.toLowerCase().endsWith('.cmm')) {
        switchTerminal('terminal-tcmm');
        window.terminalManager?.appendToTerminal?.(
            'tcmm',
            'No .cmm file is open in the editor. Open a .cmm and try again.',
            'tips',
        );
        return;
    }

    startCompilation(STEP_TERMINALS.cmm);
    try {
        const compiler = new CompilationModule(window.currentProjectPath);
        await compiler.loadConfig();

        const procFromPath = findProcessorForPath(
            editingPath, window.currentProjectPath, collectProcessors(compiler),
        );
        if (!procFromPath) {
            throw new Error(
                `Cannot resolve a processor for "${editingPath}". ` +
                `The file must live in <project>/<processor>/{Software,Hardware,Simulation}/.`,
            );
        }

        const cmmFileName = editingPath.split(/[\\/]/).pop();
        const overrideProcessor = { ...procFromPath, cmmFile: cmmFileName };

        switchTerminal('terminal-tcmm');
        await compiler.ensureDirectories(overrideProcessor.name);
        await compiler.cmmCompilation(overrideProcessor);
    } catch (error) {
        console.error('Erro na etapa cmm:', error);
        logFatalError('tcmm', error);
    } finally {
        endCompilation();
    }
}

/**
 * Botao ASM: aceita .cmm OU .asm em foco. asmCompilation deriva o
 * .asm a partir do basename do "cmmFile" recebido — entao mesmo se
 * usuario abriu o .asm direto, montamos um cmmFile sintetico
 * "<base>.cmm" e o asmcomp acaba no .asm correto.
 *
 * Se cmm_log.txt nao existe pro processador, recompila o C± antes
 * (asmcomp depende dele — yanc/ASM/Sources/eval.c). Preamble explica
 * pro usuario na UI.
 */
async function handleAsmStep() {
    const editingPath = TabManager.getEditingFilePath?.();
    const lower = (editingPath || '').toLowerCase();
    if (!editingPath || (!lower.endsWith('.cmm') && !lower.endsWith('.asm'))) {
        switchTerminal('terminal-tasm');
        window.terminalManager?.appendToTerminal?.(
            'tasm',
            'No .cmm or .asm file is open in the editor. Open one and try again.',
            'tips',
        );
        return;
    }

    startCompilation(STEP_TERMINALS.asm);
    try {
        const compiler = new CompilationModule(window.currentProjectPath);
        await compiler.loadConfig();

        const procFromPath = findProcessorForPath(
            editingPath, window.currentProjectPath, collectProcessors(compiler),
        );
        if (!procFromPath) {
            throw new Error(
                `Cannot resolve a processor for "${editingPath}". ` +
                `The file must live in <project>/<processor>/{Software,Hardware,Simulation}/.`,
            );
        }

        const baseName = editingPath.split(/[\\/]/).pop().replace(/\.(cmm|asm)$/i, '');
        const overrideProcessor = {
            ...procFromPath,
            ...PROC_DEFAULTS,
            cmmFile: `${baseName}.cmm`,
        };

        switchTerminal('terminal-tasm');
        await compiler.ensureDirectories(overrideProcessor.name);

        // asmcomp depende de cmm_log.txt — se faltar (usuario nunca rodou
        // C± antes, ou Temp/ foi limpo), recompila o cmm primeiro.
        let asmPreamble = null;
        if (!(await cmmArtifactsExist(compiler, overrideProcessor.name))) {
            await compiler.cmmCompilation(overrideProcessor);
            // Foco volta pro tasm depois do cmm pra que as mensagens
            // do asmCompilation cheguem no terminal que o usuario
            // clicou (cmmCompilation deixa foco em tcmm).
            switchTerminal('terminal-tasm');
            // Preamble vai como param do asmCompilation pra sobreviver
            // ao clearTerminal que ele faz logo no inicio.
            asmPreamble = 'Info: cmm_log.txt was missing — C± was recompiled first. See tcmm terminal for its output.';
        }

        // projectParam=1 — asmcomp NAO inclui o bloco "$finish quando
        // atinge @fim" no testbench gerado. Decisao: o usuario controla
        // parada via testbench externo ou parametros do iverilog/vvp.
        await compiler.asmCompilation(overrideProcessor, 1, asmPreamble);
    } catch (error) {
        console.error('Erro na etapa asm:', error);
        logFatalError('tasm', error);
    } finally {
        endCompilation();
    }
}

/**
 * Botao Verilog: cmm + asm pra cada processador → iverilog -tnull
 * com top-level (sem testbench, sem vvp). Helper precompileAllProcessors
 * e no-op em projetos sem processador.
 */
async function handleVerilogStep() {
    startCompilation(STEP_TERMINALS.verilog);
    try {
        const compiler = new CompilationModule(window.currentProjectPath);
        await compiler.loadConfig();
        await precompileAllProcessors(compiler, 'tveri');
        switchTerminal('terminal-tveri');
        await compiler.iverilogCompile();
    } catch (error) {
        console.error('Erro na etapa verilog:', error);
        logFatalError('tveri', error);
    } finally {
        endCompilation();
    }
}

/**
 * Botao Wave: cmm + asm pra cada processador → runGtkWave (que
 * internamente faz iverilog -o vvp com testbench, roda vvp, abre
 * gtkwave). runGtkWave e self-contained — pre-compila o vvp.
 */
async function handleWaveStep() {
    startCompilation(STEP_TERMINALS.wave);
    try {
        const compiler = new CompilationModule(window.currentProjectPath);
        await compiler.loadConfig();
        await precompileAllProcessors(compiler, 'twave');
        switchTerminal('terminal-twave');
        await compiler.runGtkWave();
    } catch (error) {
        console.error('Erro na etapa wave:', error);
        logFatalError('twave', error);
    } finally {
        endCompilation();
    }
}

/**
 * Botao PRISM: cmm + asm + iverilog -tnull (top-level) — i.e., faz
 * tudo que o botao Verilog faz — e depois invoca yosys via IPC pra
 * analise estrutural. PRISM e um superset do Verilog.
 */
async function handlePrismStep() {
    startCompilation(STEP_TERMINALS.prism);
    try {
        const projectPath = window.currentProjectPath
            || await window.electronAPI.dirname(window.currentOpenProjectPath);
        if (!projectPath) throw new Error('Abra um projeto primeiro.');

        const compiler = new CompilationModule(projectPath);
        await compiler.loadConfig();
        await precompileAllProcessors(compiler, 'tveri');
        switchTerminal('terminal-tveri');
        await compiler.iverilogCompile();

        const result = await window.electronAPI.prismCompileWithPaths(
            await buildPrismCompilationPaths(projectPath),
        );
        if (!result.success) throw new Error(result.message);
    } catch (error) {
        console.error('Erro no trigger PRISM:', error);
        logFatalError('tveri', error);
    } finally {
        endCompilation();
    }
}

/**
 * Monta o payload de paths que o IPC prism-compile-with-paths espera.
 * Todos absolutos, slashes normalizadas pra forward.
 */
async function buildPrismCompilationPaths(projectPath) {
    const rawComponentsPath = await window.electronAPI.getComponentsPath();
    const join = window.electronAPI.joinPath;
    return {
        projectPath:               toForwardSlashes(projectPath),
        componentsPath:            toForwardSlashes(rawComponentsPath),
        hdlPath:                   toForwardSlashes(await join(rawComponentsPath, 'HDL')),
        tempPath:                  toForwardSlashes(await join(rawComponentsPath, 'Temp', 'PRISM')),
        yosysPath:                 toForwardSlashes(await join(rawComponentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe')),
        netlistsvgPath:            toForwardSlashes(await join(rawComponentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe')),
        projectOrientedConfigPath: toForwardSlashes(await join(projectPath, 'projectOriented.json')),
        topLevelPath:              toForwardSlashes(await join(projectPath, 'TopLevel')),
    };
}

// =====================================================================
// Manager class — dispatcher publico
// =====================================================================

class CompilationFlowManager {
    initialize() {
        document.getElementById('cmmcomp')?.addEventListener('click', () => this.runSingleStep('cmm'));
        document.getElementById('asmcomp')?.addEventListener('click', () => this.runSingleStep('asm'));
        document.getElementById('vericomp')?.addEventListener('click', () => this.runSingleStep('verilog'));
        document.getElementById('wavecomp')?.addEventListener('click', () => this.runSingleStep('wave'));
        document.getElementById('prismcomp')?.addEventListener('click', () => this.runSingleStep('prism'));
        document.getElementById('allcomp')?.addEventListener('click', () => this.runAll());
        document.getElementById('cancel-everything')?.addEventListener('click', this.cancelAll);

        this.updateButtonStates();
    }

    /**
     * Todos os botoes ficam habilitados — o gating de comportamento
     * acontece dentro de cada handler (e.g. botao C± verifica se ha
     * .cmm aberto no Monaco). Mantida pra acoes pos-init que
     * eventualmente precisem reativar buttons (ex: cancel).
     */
    updateButtonStates() {
        for (const id of ['cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp']) {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = false;
        }
    }

    async runAll() {
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

    async runSingleStep(step) {
        switch (step) {
            case 'cmm':     return handleCmmStep();
            case 'asm':     return handleAsmStep();
            case 'verilog': return handleVerilogStep();
            case 'wave':    return handleWaveStep();
            case 'prism':   return handlePrismStep();
            default:
                console.warn(`Passo desconhecido: ${step}`);
                logFatalError(
                    ERROR_TERMINAL[step] || 'tcmm',
                    new Error(`Unknown compilation step: ${step}`),
                );
        }
    }

    cancelAll() {
        compilationCanceled = true;
        window.electronAPI.cancelVvpProcess()
            .catch(err => console.warn('cancelVvpProcess failed:', err?.message ?? err));
    }
}

const compilationFlowManager = new CompilationFlowManager();
export { compilationFlowManager, checkCancellation };
