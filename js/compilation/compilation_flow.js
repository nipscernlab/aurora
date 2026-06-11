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
 *   Loops cmm+asm sao sobre window.availableProcessors (no-op natural
 *   pra projetos verilog puro — array vazio = loop vazio). Nao ha
 *   branches `if (hasProcessor)` no pipeline.
 *
 * Pra entender o lado do CompilationModule (verilogSyntaxCheck,
 * waveBuildVvp, runGtkWave, e as 8 fases _wave*), ver compilation_module.js.
 */

import { CompilationModule } from './compilation_module.js';
import { toForwardSlashes } from '../utils/path_utils.js';
import { TabManager } from '../tabs/tab_manager.js';
import { getSimulator } from '../wave/simulator_preference.js';
import { switchTerminal } from '../terminal/terminal.js';

const tr = (k, p) => (window.t ? window.t(k, p) : k);

// =====================================================================
// Cancellation
// =====================================================================

let compilationCanceled = false;

const CANCELLED_TOKEN = Symbol.for('aurora.cancelled');

function makeCancellationError() {
    const err = new Error(tr('error.user.cancelled'));
    err[CANCELLED_TOKEN] = true;
    return err;
}

function isCancellationError(error) {
    return !!(error && error[CANCELLED_TOKEN]);
}

function checkCancellation() {
    if (compilationCanceled) {
        throw makeCancellationError();
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
    // C± roda cmm + asm em sequencia (gera .asm via cmmcomp, depois
    // <proc>.v via asmcomp). Limpa ambos os terminais.
    cmm:     ['tcmm', 'tasm'],
    // ASM-only: pula cmmcomp e roda apenas asmcomp + iverilog -tnull.
    // Esse passo existe para a Aurora Intelligence testar um .asm
    // otimizado a mao (com override em -i apontando pra _aurora_opt/)
    // sem regenerar o .asm a partir do .cmm. Limpa o terminal do asm
    // e o do iverilog.
    asm:     ['tasm', 'tveri'],
    verilog: ['tveri'],
    // Wave roda iverilog internamente, que loga em tveri (bannerSyntaxWc,
    // simTop, cmd echo, etc), entao tveri TAMBEM tem que ser limpo.
    // Sem isso, um erro vermelho deixado por um Verilog button anterior
    // (ex: "noTopLevel") fica visivel quando o usuario clica Wave — e
    // ele pode achar que o erro veio do Wave.
    wave:    ['twave', 'tveri'],
    prism:   ['tveri'],
    // Verilator processador CMM: loga no THTEST (Terminal Hardware Test) —
    // etapas de pipeline + barra de progresso ASCII inline da execucao.
    'verilator-proc': ['thtest'],
    // Fast Sim (Verilator headless, sem onda): mesmo terminal do Wave.
    'verilator-fast': ['twave'],
});
const ALL_TERMINALS = Object.freeze(['tcmm', 'tasm', 'tveri', 'twave']);

// Map per-step → terminal pra mensagens de erro fatal.
const ERROR_TERMINAL = Object.freeze({
    cmm:     'tcmm',
    asm:     'tasm',
    verilog: 'tveri',
    wave:    'twave',
    prism:   'tveri',
    'verilator-proc': 'thtest',
    'verilator-fast': 'twave',
});

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

// Step do run em andamento — usado por logFatalError pra reportar a
// falha ao status bar com o tipo certo. Os passos cmm/asm/verilog/prism
// ja chamam statusUpdater.compilationError por dentro; este fallback
// cobre os que nao tocam o updater (verilator top-level/proc, wave).
let activeRunStep = null;

function logFatalError(terminalId, error) {
    // User-triggered cancel is not a failure: render it as a friendly
    // info card (no "Erro Fatal:" prefix, no red error styling).
    if (isCancellationError(error)) {
        window.terminalManager?.appendToTerminal?.(
            terminalId,
            tr('compilation.cancelledByUser'),
            'tips',
        );
        return;
    }
    window.terminalManager?.appendToTerminal?.(
        terminalId, `Erro Fatal: ${error.message}`, 'error',
    );
    // No-op se um passo interno ja mostrou o erro (isCompiling vira false).
    window.statusUpdater?.compilationError?.(activeRunStep, error.message);
}

// =====================================================================
// Helpers de descoberta de processadores
// =====================================================================

/**
 * Resolve a qual processador um arquivo pertence olhando seu path:
 *   <projectPath>/<procName>/{Hardware|Software|Simulation}/<arquivo>
 * Devolve o objeto do processador (preservando casing original) ou null.
 *
 * Mirrors ProjectTreeManager._getProcessorForFile (replicado aqui pra
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
    // Tolera entrada como string (window.availableProcessors) ou
    // objeto com .name (.spf structure.processors).
    const match = processors.find((p) => {
        const n = typeof p === 'string' ? p : p?.name;
        return n && n.toLowerCase() === procNameLower;
    });
    if (!match) return null;
    return typeof match === 'string' ? { name: match } : match;
}

/**
 * Coleta a lista canonica de processadores conhecidos do projeto.
 * Le de window.availableProcessors (semeado pelo project_manager a
 * partir do .spf structure.processors). compiler.projectConfig.
 * processors aponta pra mesma fonte — usamos so essa via pra evitar
 * duplicacao.
 */
function collectProcessors() {
    const list = Array.isArray(window.availableProcessors)
        ? window.availableProcessors
        : [];
    return list
        .map((p) => (typeof p === 'string' ? { name: p } : p))
        .filter((p) => p && p.name);
}

// =====================================================================
// Pre-flight comum: roda cmm + asm pra cada processador
// =====================================================================

// Fallback per-processador quando o .spf nao tem config explicita
// (entries antigas no schema string-only ou criadas antes do painel
// de config sair). O painel grava no .spf — leitura aqui defaultar
// pros mesmos valores que o painel mostra como placeholder garante
// que rodar sem abrir o painel comporta-se como antes.
const PROC_DEFAULTS = Object.freeze({
    clk: 100,
    numClocks: 2000,
    showArrays: false,
});

/**
 * Extrai a config per-processador armazenada na entry de
 * `structure.processors[i]`. Entries string-only (.spf antigo) e
 * entries sem campos retornam os defaults. clk/numClocks viram numero,
 * showArrays vira boolean.
 */
function readProcessorConfig(procEntry) {
    if (!procEntry || typeof procEntry === 'string') return { ...PROC_DEFAULTS };
    return {
        clk: Number.isFinite(procEntry.clk) ? procEntry.clk : PROC_DEFAULTS.clk,
        numClocks: Number.isFinite(procEntry.numClocks) ? procEntry.numClocks : PROC_DEFAULTS.numClocks,
        showArrays: !!procEntry.showArrays,
    };
}

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
    // Prioriza as entries completas do .spf (com clk/numClocks/showArrays
    // setados pelo painel de config) sobre window.availableProcessors,
    // que so guarda nomes. Cai pro collectProcessors() so se o
    // projectConfig do compiler nao tem entries — algo upstream estaria
    // errado, mas evita perder o pipeline.
    const fromSpf = Array.isArray(compiler.projectConfig?.processors)
        ? compiler.projectConfig.processors.filter((p) => p && (typeof p === 'string' ? p : p.name))
        : null;
    const procs = (fromSpf && fromSpf.length > 0 ? fromSpf : collectProcessors())
        .map((p) => (typeof p === 'string' ? { name: p } : p));
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
            ...readProcessorConfig(proc),
            cmmFile: cmmFileName,
        };

        await compiler.ensureDirectories(proc.name);
        await compiler.cmmCompilation(overrideProcessor);
        await compiler.asmCompilation(overrideProcessor);
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
 * Botao C±: roda o pipeline completo do processador a partir do .cmm
 * aberto no Monaco:
 *   1. cmmcomp.exe   -> Software/<base>.asm + cmm_log.txt
 *   2. asmcomp.exe   -> Hardware/<proc>.v + pc_<proc>_mem.txt +
 *                       Simulation/<proc>_tb.v
 *
 * Antes (pre-2026-05) este botao parava no passo 1. Foi unificado pra
 * deixar o fluxo "do .cmm ate o .v" num clique so — quem quer parar
 * no .asm usa o botao ASM (que tambem aceita .asm em foco).
 *
 * Se o arquivo em foco nao for .cmm, no-op com mensagem.
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

        // Prefere entries do .spf (clk/numClocks/showArrays setados pelo
        // painel de config). Fallback pra availableProcessors so se o
        // .spf nao tiver `processors` populado.
        const procsFromSpf = Array.isArray(compiler.projectConfig?.processors)
            ? compiler.projectConfig.processors
            : null;
        const procFromPath = findProcessorForPath(
            editingPath,
            window.currentProjectPath,
            (procsFromSpf && procsFromSpf.length > 0) ? procsFromSpf : collectProcessors(),
        );
        if (!procFromPath) {
            throw new Error(
                `Cannot resolve a processor for "${editingPath}". ` +
                `The file must live in <project>/<processor>/{Software,Hardware,Simulation}/.`,
            );
        }

        const cmmFileName = editingPath.split(/[\\/]/).pop();
        // clk/numClocks/showArrays vem do .spf via readProcessorConfig
        // (defaults aplicados pra entries sem config).
        const overrideProcessor = {
            ...procFromPath,
            ...readProcessorConfig(procFromPath),
            cmmFile: cmmFileName,
        };

        await compiler.ensureDirectories(overrideProcessor.name);

        // Passo 1 — C± (cmmcomp)
        switchTerminal('terminal-tcmm');
        await compiler.cmmCompilation(overrideProcessor);

        // Passo 2 — ASM (asmcomp). Foco vai pro tasm pra que o output
        // do asmcomp apareca no terminal certo.
        switchTerminal('terminal-tasm');
        await compiler.asmCompilation(overrideProcessor, null);
    } catch (error) {
        console.error('Erro na etapa cmm:', error);
        logFatalError('tcmm', error);
    } finally {
        endCompilation();
    }
}

/**
 * Variante de precompileAllProcessors que NAO chama cmmCompilation.
 * Usada pela Aurora Intelligence quando ela quer testar um .asm
 * otimizado a mao: o .cmm fica intacto e o .asm sandbox (apontado
 * via override de -i no step asm) e o input do asmcomp.
 *
 * Mantem o mesmo contrato de error/skip que precompileAllProcessors
 * pra que o resto do pipeline (iverilog/wave) funcione identico.
 */
async function precompileAsmOnly(compiler, terminalId) {
    const fromSpf = Array.isArray(compiler.projectConfig?.processors)
        ? compiler.projectConfig.processors.filter((p) => p && (typeof p === 'string' ? p : p.name))
        : null;
    const procs = (fromSpf && fromSpf.length > 0 ? fromSpf : collectProcessors())
        .map((p) => (typeof p === 'string' ? { name: p } : p));
    if (procs.length === 0) return 0;

    await compiler.initializeComponentsPath();

    const tm = window.terminalManager;
    tm?.appendToTerminal?.(
        terminalId,
        `Info: assembling ${procs.length} processor(s) without re-running cmmcomp.`,
        'tips',
    );

    let compiled = 0;
    for (const proc of procs) {
        checkCancellation();
        const cmmFileName = `${proc.name}.cmm`;
        const overrideProcessor = {
            ...proc,
            ...readProcessorConfig(proc),
            cmmFile: cmmFileName,
        };
        await compiler.ensureDirectories(proc.name);
        // NOTE: cmmCompilation deliberately skipped — the .asm on disk
        // (whether canonical or routed via an `asm.-i` override) is the
        // input to asmcomp.
        await compiler.asmCompilation(overrideProcessor);
        compiled++;
    }
    return compiled;
}

/**
 * Botao ASM (Aurora Intelligence): asmcomp + iverilog -tnull.
 * NAO roda cmmcomp — assim um .asm otimizado a mao sobrevive.
 * Pareado com `compile_step('asm')` do AuroraAPI; nao tem botao na
 * toolbar pra evitar pegadinha pro usuario final (e read-and-act-only
 * desde a IA).
 */
async function handleAsmStep() {
    startCompilation(STEP_TERMINALS.asm);
    try {
        const compiler = new CompilationModule(window.currentProjectPath);
        await compiler.loadConfig();
        switchTerminal('terminal-tasm');
        await precompileAsmOnly(compiler, 'tasm');
        switchTerminal('terminal-tveri');
        await compiler.verilogSyntaxCheck();
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
        await compiler.verilogSyntaxCheck();
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
 * Botao Verilator (processador CMM): roda o top-level <proc>.v gerado
 * pelo compilador CMM com Verilator, usando a fiacao previsivel do
 * processador SAPHO (req_in/out_en one-hot, input_<N>.txt/output_<N>.txt
 * decimais, na pasta Simulation/ do processador). Pre-compila cmm+asm
 * pra ter <proc>.v/_tb.v/.mif frescos antes de dumpar/buildar/rodar.
 */
async function handleVerilatorProcStep() {
    startCompilation(STEP_TERMINALS['verilator-proc']);
    try {
        const compiler = new CompilationModule(window.currentProjectPath);
        await compiler.loadConfig();
        // Instrumenta o .cmm do processador ATIVO com #TOAQUI (pino `cheguei`
        // no fim do programa) — feito dentro do cmmCompilation, depois do
        // saveAllFiles. So o processador-alvo do botao e' tocado.
        compiler._chegueiInstrumentProc = window.statusBarManager?.getActiveProcessorName?.() || null;
        await precompileAllProcessors(compiler, 'tcmm');
        switchTerminal('terminal-thtest');
        // O precompile (cmm+asm) deixou a barra de status em "Assembly".
        // O build do Verilator (--json/--cc/--build/g++) e a execucao nao
        // passam pelo statusUpdater por step, entao sem isso a barra ficava
        // presa em "Assembly". Marca a etapa real aqui.
        window.statusUpdater?.startCompilation?.('verilator-proc');
        await compiler.verilatorProcessorRun();
    } catch (error) {
        console.error('Erro na etapa verilator (processador):', error);
        logFatalError('thtest', error);
    } finally {
        endCompilation();
    }
}

/**
 * Botao Fast Sim: roda o testbench do projeto via Verilator binario SEM
 * gerar onda nem abrir o GTKWave — so a velocidade. Verilator-only (o
 * botao so habilita com o toggle de simulador em Verilator). Pre-compila
 * cmm+asm caso o top-level instancie processadores SAPHO (no-op senao).
 */
async function handleFastSimStep() {
    startCompilation(STEP_TERMINALS['verilator-fast']);
    try {
        const compiler = new CompilationModule(window.currentProjectPath);
        await compiler.loadConfig();
        await precompileAllProcessors(compiler, 'twave');
        switchTerminal('terminal-twave');
        await compiler.runFastSim();
    } catch (error) {
        console.error('Erro na etapa fast sim:', error);
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
        if (!projectPath) throw new Error(tr('error.config.noProject'));

        const compiler = new CompilationModule(projectPath);
        await compiler.loadConfig();
        await precompileAllProcessors(compiler, 'tveri');
        switchTerminal('terminal-tveri');
        await compiler.verilogSyntaxCheck();

        // AI command overrides para a etapa prism-yosys: o spawn real
        // vive em main/ipc/prism.js, entao consultamos o store aqui e
        // anexamos ao payload. main aplica antes de spawn.
        const paths = await buildPrismCompilationPaths(projectPath);
        try {
            const { resolveOverride } = await import('./command_overrides.js');
            const resolved = await resolveOverride('prism-yosys', null);
            if (resolved && resolved.override) {
                paths.yosysOverride = resolved.override;
            }
        } catch (_e) { /* override resolver missing — pipeline ainda roda */ }

        const result = await window.electronAPI.prismCompileWithPaths(paths);
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
        yosysPath:                 toForwardSlashes(await join(rawComponentsPath, 'Packages', 'msys', 'mingw64', 'bin', 'yosys.exe')),
        spfPath:                   toForwardSlashes(window.currentSpfPath || ''),
        topLevelPath:              toForwardSlashes(await join(projectPath, 'TopLevel')),
    };
}

// =====================================================================
// Botão C±: gating por arquivo em evidência
// =====================================================================

/**
 * Habilita o botao C± so quando o arquivo em foco no Monaco e .cmm.
 * Chamado por listeners do evento `aurora:editing-file-changed` e por
 * `updateButtonStates` (apos runs / cancel / project load).
 *
 * Window-exposto pra que `enableCompileButtons` em project_manager.js
 * possa re-sincronizar depois de fazer o "habilita tudo" geral, sem
 * deixar o C± erroneamente habilitado quando nao ha .cmm em foco.
 */
function syncCmmcompEnabled() {
    const btn = document.getElementById('cmmcomp');
    if (!btn) return;
    const path = TabManager.getEditingFilePath?.();
    const isCmm = !!path && path.toLowerCase().endsWith('.cmm');
    btn.disabled = !isCmm;
    btn.style.cursor = isCmm ? 'pointer' : 'not-allowed';
}

if (typeof window !== 'undefined') {
    window.syncCmmcompEnabled = syncCmmcompEnabled;
}

// =====================================================================
// Gating por estado do design (.spf): top-level / testbench / processador
// =====================================================================

/**
 * Habilita/desabilita os botoes da toolbar conforme o que o .spf tem:
 *
 *   - top-level definido  → Verilog (synth), PRISM, Verilator (top-level)
 *   - processador no proj → Verilator (processador CMM)
 *   - testbench definido  → Wave, Wave Config, e a lista .gtkw (via seu
 *                            proprio manager)
 *
 * Le a mesma fonte de verdade que a status bar (SpfStore). Re-sincroniza
 * em aurora:spf-changed, open/close de projeto e criar/deletar processador.
 */
async function syncToolbarEnabledState() {
    const setEnabled = (id, on) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = !on;
        btn.style.cursor = on ? 'pointer' : 'not-allowed';
    };

    let hasTop = false;
    let hasTb = false;
    let isPyTb = false;
    const spfPath = window.currentSpfPath || window.ProjectStore?.getSpfPath?.();
    if (spfPath && window.SpfStore) {
        try {
            const s = await window.SpfStore.read(spfPath);
            hasTop = !!s.topLevelFile;
            hasTb = !!s.testbenchFile;
            // .py = testbench cocotb (Python). O Fast Sim e Verilator-binary e
            // compila o tb como Verilog, entao .py nao se aplica (vai pelo Wave).
            isPyTb = /\.py$/i.test(s.testbenchFile || '');
        } catch (_e) { /* sem projeto / leitura falhou → tudo desabilitado */ }
    }

    // O botao Verilator (processador) age sobre o PROCESSADOR ATIVO mostrado
    // na status bar (o .cmm em foco). Sem processador ativo → desabilitado.
    // Mesma fonte do alvo em _resolveProcessorTarget, entao gate e alvo nunca
    // divergem.
    const hasActiveProc = !!window.statusBarManager?.getActiveProcessorName?.();

    setEnabled('vericomp', hasTop);
    setEnabled('prismcomp', hasTop);
    setEnabled('verilatorproc', hasActiveProc);
    setEnabled('wavecomp', hasTb);
    // Fast Sim (headless, sem onda) tem dois caminhos:
    //  - testbench .v  -> Verilator binario, exige o toggle em Verilator
    //    (iverilog nao tem caminho binario headless);
    //  - testbench .py -> cocotb headless, roda em qualquer engine.
    // Re-sincronizado no evento aurora:wave-simulator-changed (initialize()).
    setEnabled('fastsim', hasTb && (isPyTb || getSimulator() === 'verilator'));
    // Cancelar a simulacao segue a MESMA regra do Wave: sem testbench
    // nao da pra iniciar uma simulacao, entao o botao de cancelar (par
    // visual do Wave, a direita dele na toolbar) fica desabilitado junto.
    setEnabled('cancel-everything', hasTb);
    setEnabled('waveConfigBtn', hasTb);
    // A lista .gtkw gerencia seu proprio disabled (gtkw_picker.refresh le
    // o testbench); so pedimos pra re-sincronizar.
    window.gtkwPickerManager?.refresh?.();
}

if (typeof window !== 'undefined') {
    window.syncToolbarEnabledState = syncToolbarEnabledState;
}

// =====================================================================
// Manager class — dispatcher publico
// =====================================================================

class CompilationFlowManager {
    initialize() {
        // Phase B: toolbar clicks go through window.AuroraAPI.compile so
        // they share the exact code path Aurora Intelligence drives via
        // function-calling. The optional `?.` guards the brief window
        // before initAuroraAPI() mounts the namespace; users can't click
        // a toolbar button that early, but it keeps the listener safe
        // against e2e setups that don't import the renderer entry.
        document.getElementById('cmmcomp')?.addEventListener('click',  () => window.AuroraAPI?.compile.compileStep('cmm'));
        document.getElementById('vericomp')?.addEventListener('click', () => window.AuroraAPI?.compile.compileStep('verilog'));
        document.getElementById('wavecomp')?.addEventListener('click', () => window.AuroraAPI?.compile.compileStep('wave'));
        document.getElementById('prismcomp')?.addEventListener('click',() => window.AuroraAPI?.compile.compileStep('prism'));
        document.getElementById('verilatorproc')?.addEventListener('click',() => window.AuroraAPI?.compile.compileStep('verilator-proc'));
        document.getElementById('fastsim')?.addEventListener('click',() => window.AuroraAPI?.compile.compileStep('verilator-fast'));
        document.getElementById('allcomp')?.addEventListener('click',  () => window.AuroraAPI?.compile.compileAll());
        document.getElementById('cancel-everything')?.addEventListener('click', () => window.AuroraAPI?.compile.cancel());

        // C± so faz sentido com .cmm em foco — atualiza disabled toda
        // vez que o arquivo em evidencia muda (TabManager.activateTab
        // / SplitEditorManager.setFocus disparam o evento). O botao
        // Verilator (processador) tambem depende do .cmm em foco (age sobre
        // o processador ativo), entao re-sincroniza junto.
        document.addEventListener('aurora:editing-file-changed', () => {
            syncCmmcompEnabled();
            syncToolbarEnabledState();
        });

        // Fast Sim e Verilator-only, entao seu disabled depende do toggle de
        // simulador — re-sincroniza quando o usuario (ou a IA) troca o engine.
        // O evento e dispatchado em window por simulator_toggle.js.
        window.addEventListener('aurora:wave-simulator-changed', () => {
            syncToolbarEnabledState();
        });

        // Gating por design: re-sincroniza quando o .spf muda (top-level/
        // testbench marcados, etc.), quando abre/fecha projeto, e quando
        // processadores sao criados/removidos.
        window.addEventListener('aurora:spf-changed', () => syncToolbarEnabledState());
        window.ProjectStore?.subscribe?.(() => syncToolbarEnabledState());
        window.electronAPI?.onProcessorCreated?.(() => syncToolbarEnabledState());
        window.electronAPI?.onProcessorsUpdated?.(() => syncToolbarEnabledState());

        this.updateButtonStates();
    }

    /**
     * Re-sincroniza os botoes apos um run/cancel. cmmcomp segue regra
     * propria (.cmm em foco); os demais seguem o estado do design
     * (top-level/testbench/processador) via syncToolbarEnabledState.
     * allcomp (Full Build) fica escondido no DOM — mantido habilitado.
     */
    updateButtonStates() {
        const allcomp = document.getElementById('allcomp');
        if (allcomp) allcomp.disabled = false;
        syncToolbarEnabledState();
        syncCmmcompEnabled();
    }

    async runAll() {
        startCompilation(ALL_TERMINALS);
        activeRunStep = 'all';
        window.statusUpdater?.beginRun?.('all');
        try {
            const compiler = new CompilationModule(window.currentProjectPath);
            await compiler.loadConfig();
            await runProjectPipeline(compiler);
        } catch (error) {
            console.error('Compilation error:', error);
            // Without this, a Cancel during Full Build leaves no card in
            // the terminal — the inner step that threw was past its own
            // try/catch by the time cancellation bubbled. Route through
            // logFatalError so cancellations render as the friendly
            // info card (and real errors as Erro Fatal).
            const activeId = document.querySelector('.tab.active')?.dataset?.terminal;
            logFatalError(activeId ? `terminal-${activeId}` : 'twave', error);
        } finally {
            window.statusUpdater?.endRun?.('all');
            activeRunStep = null;
            endCompilation();
        }
    }

    async runSingleStep(step) {
        // beginRun mantem a barra em "executando" durante todo o pipeline
        // do botao (varios passos), impedindo que um sucesso de passo
        // intermediario a reset pra "Iniciar Compilacao". endRun fecha.
        activeRunStep = step;
        window.statusUpdater?.beginRun?.(step);
        try {
            switch (step) {
                // 'verilator' (top-level harness) intencionalmente fora —
                // o botao foi removido da toolbar (commit 5121cc2) e
                // handleVerilatorStep nao existe mais. 'verilator-proc'
                // (Verilator no processador CMM) continua suportado.
                case 'cmm':       await handleCmmStep(); break;
                case 'asm':       await handleAsmStep(); break;
                case 'verilog':   await handleVerilogStep(); break;
                case 'wave':      await handleWaveStep(); break;
                case 'prism':     await handlePrismStep(); break;
                case 'verilator-proc': await handleVerilatorProcStep(); break;
                case 'verilator-fast': await handleFastSimStep(); break;
                default:
                    console.warn(`Passo desconhecido: ${step}`);
                    logFatalError(
                        ERROR_TERMINAL[step] || 'tcmm',
                        new Error(`Unknown compilation step: ${step}`),
                    );
            }
        } finally {
            // endRun e no-op se um passo ja reportou erro (runActive=false).
            window.statusUpdater?.endRun?.(step);
            activeRunStep = null;
        }
    }

    cancelAll() {
        const tm = window.terminalManager;
        const activeId = document.querySelector('.tab.active')?.dataset?.terminal;
        const activeTerminalId = activeId ? `terminal-${activeId}` : 'tcmm';

        // Already cancelling — surface the same "ack" message instead of
        // silently doing nothing on a second click. Without this, the user
        // clicks Cancel, nothing visible happens (the cancellation hasn't
        // propagated yet), they click again — and the second click looks
        // like a dead button.
        if (compilationCanceled) {
            tm?.appendToTerminal?.(
                activeTerminalId, tr('compilation.cancelInProgress'), 'tips',
            );
            return;
        }
        compilationCanceled = true;

        // Brief ack in the currently visible terminal so the user has
        // immediate visual confirmation the click took effect, even if
        // the killed process takes a moment to exit and surface the
        // "cancelled" card via logFatalError.
        tm?.appendToTerminal?.(
            activeTerminalId, tr('compilation.cancelRequested'), 'tips',
        );

        window.statusUpdater?.cancelRun?.();
        window.electronAPI.cancelVvpProcess()
            .then((result) => {
                // Main reports "no compilation process running" when the
                // user clicked Cancel while idle. Surface that as an info
                // card and reset the flag so a subsequent build doesn't
                // self-cancel immediately. (startCompilation also resets
                // the flag, but a stray `checkCancellation()` between
                // cancelAll and the next build would otherwise still throw.)
                if (result && result.success === false) {
                    compilationCanceled = false;
                    tm?.appendToTerminal?.(
                        activeTerminalId, tr('compilation.nothingToCancel'), 'tips',
                    );
                }
            })
            .catch(err => console.warn('cancelVvpProcess failed:', err?.message ?? err));
    }
}

const compilationFlowManager = new CompilationFlowManager();
export { compilationFlowManager, checkCancellation };
