/**
 * compilation_module.js: toolchain orchestrator (renderer side).
 *
 * Expoe a classe CompilationModule, que e o "backend" dos botoes
 * disparados em compilation_flow.js. Cada metodo publico corresponde
 * a uma etapa da pipeline:
 *
 *   loadConfig()            le o .spf em this.projectConfig
 *   ensureDirectories(name) cria components/Temp/<name>
 *   cmmCompilation(proc)    cmmcomp.exe -> Software/<proc>.asm + cmm_log.txt
 *   asmCompilation(proc, ...)
 *                           appcomp + asmcomp -> Hardware/<proc>.v +
 *                           pc_<proc>_mem.txt + Simulation/<proc>_tb.v
 *   verilogSyntaxCheck()    iverilog -tnull (Verilog/PRISM/ASM) +
 *                           generateProjectHierarchy via Yosys.
 *   waveBuildVvp()          iverilog -o <sim>.vvp (Wave) com testbench
 *                           instrumentado + signal selection resolvida.
 *   runGtkWave()            8-fase pipeline _wave*, pre-compila vvp,
 *                           roda vvp, abre gtkwave (ver §9 de
 *                           ARCHITECTURE.md)
 *
 * Decisoes de design (post-2026-05):
 *
 *   1. Pipeline unico, sem branches "tem processador?". For-loops
 *      sobre processors[] sao no-op quando o array e vazio
 *      (projeto verilog puro). Branches estruturais foram
 *      removidos na fase 3.
 *
 *   2. .spf e a unica fonte de config. projectOriented.json e
 *      processorConfig.json (legado) foram consolidados no .spf.
 *      Defaults pra clk/numClocks/cmmFile estao hardcoded em
 *      precompileAllProcessors (compilation_flow.js).
 *
 *   3. synthesizableFiles[] (populado pelo file tree) ja inclui os
 *      .v dos processadores. -y components/HDL e sempre adicionado
 *      pra resolver a biblioteca SAPHO (processor.v, ula.v,
 *      myFIFO.v, etc) sem o usuario precisar listar.
 *
 *   4. runGtkWave esta dividido em 8 fases _wave*. Cada fase tem
 *      JSDoc com inputs/returns/throws/side-effects. Mudancas de
 *      comportamento da wave-flow pertencem dentro de uma fase. Ver
 *      ARCHITECTURE.md §9 pro racional.
 */
import { electronAPI } from '../app/electron_api.js';
import { applyResolved } from './command_overrides.js';
import { TabManager } from '../tabs/tab_manager.js';
import { TerminalManager } from '../terminal/terminal_module.js';
import { lerProgresso } from '../terminal/progress_line.js';
import { parseVcdHeaderFromContent } from '../wave/vcd_parser.js';
import { nomesDeDumpEsperados, NOMES_DE_DUMP_COCOTB, dumpEstaFresco } from './dump_guard.js';
import { SpfStore } from '../project/spf_store.js';
import { extractSignalRefs } from '../wave/gtkw_writer.js';
import { buildAuroraGtkw, detectProcessors, resolveScopeModules } from '../wave/gtkw_proc_writer.js';
import { buildSurferLayout } from '../wave/surfer_layout_writer.js';
import { hasComplexSignals, ComplexVcdScanner, buildComplexMapping } from '../wave/complex_decode.js';
import {
  instrumentTestbenchSource, commentOutDumpCalls,
} from '../wave/testbench_instrumenter.js';
import { WaveStore } from '../wave/wave_state_store.js';
import { getSimulator } from '../wave/simulator_preference.js';
import { getViewer } from '../wave/viewer_preference.js';
import { getSurferMultiWindow } from '../wave/surfer_window_preference.js';
import { getSurferInTab } from '../wave/surfer_tab_preference.js';
import {
    verilatorTraceRules, defaultScopeRules, rulesFromDumpvars, contarEscopos,
} from '../wave/verilator_trace_rules.js';
import { extractFopenReads } from '../wave/fopen_paths.js';
import { getActiveProcessorName } from '../project/active_processor.js';
import { statusUpdater } from '../ui/status_updater.js';
import { runSpec, runSpecStreamed } from './spec_runner.js';
import { parseYosysHierarchy } from './hierarchy_parser.js';
import { renderHierarchy, refreshHierarchyFocusHighlight } from './hierarchy_view.js';
import { resolveWaveToolchain, findWaveCandidateInDir, resolveVerilatorTools } from './wave_toolchain.js';
import {
  validateWaveSelection, resolveWaveSelection,
  resolveCocotbWaveSelection, parseProjectSources, buildHierarchyFromFiles,
} from './wave_signal_validator.js';
import {
  cmmCompilation, asmCompilation, stageProcessorMemoryFiles,
} from './processor_compiler.js';
import {
  buildIverilogCheckSpec, buildIverilogBuildSpec,
  buildVvpRunSpec,
  buildCocotbRunSpec,
  buildVerilatorBuildSpec, buildVerilatorRunSpec,
  buildVerilatorJsonSpec, buildVerilatorTbBuildSpec, buildVerilatorTbRunSpec,
  buildFst2VcdSpec, buildGtkwaveSpec,
  buildYosysHierarchySpec,
} from './builders/index.js';
import {
  parseVerilatorPorts,
  parseProcessorIO, generateVerilatorProcTb,
} from './verilator_tb.js';
import * as CommandSpec from './command_spec.js';
import {
  basenameOfPath, moduleStemFromPath, isPythonFile,
  decideCocotbDut,
  isVerilogLikeFile, assertPythonModuleName, safeNamePart,
} from './compilation_helpers.js';
import { COCOTB_RUNNER_SOURCE, COCOTB_TESTS_FAILED } from './cocotb_runner_source.js';

// ─── Estado salvo dentro da aba do Surfer ───────────────────────────────────
// tabId → { projectPath, tbKey, name }. Preenchido a cada abertura de aba;
// quando o main avisa que um POST de estado foi gravado, este ouvinte registra
// o arquivo no WaveStore como o layout ATIVO daquele testbench, e o próximo
// Wave já abre com ele.
//
// O ouvinte é único e mora no import do módulo, e não numa instância: a aba do
// Surfer sobrevive a recompilações (o tabId é estável por onda), então um
// ouvinte por instância acumularia um por compilação e o mesmo salvamento
// seria registrado várias vezes.
const surferTabSaveCtx = new Map();
if (typeof window !== 'undefined' && electronAPI.onSurferTabStateSaved) {
    electronAPI.onSurferTabStateSaved(async ({ tabId, path: savedPath }) => {
        const ctx = surferTabSaveCtx.get(tabId);
        if (!ctx) return;
        try {
            await WaveStore.update(ctx.projectPath, ctx.tbKey, (cfg) => {
                const files = Array.isArray(cfg.surferFiles) ? cfg.surferFiles : [];
                let entry = files.find((f) => f?.path === savedPath);
                if (!entry) {
                    entry = { name: ctx.name, path: savedPath, isActive: false };
                    files.push(entry);
                }
                for (const f of files) f.isActive = (f === entry);
                cfg.surferFiles = files;
            });
            window._latestCompilationModule?.terminalManager?.appendToTerminal(
                'twave', tr('terminal.wave.surferTabStateSaved'), 'success');
        } catch (e) {
            // O arquivo ESTA salvo; o que falhou foi anotá-lo no projeto. Dizer
            // as duas coisas evita a pessoa salvar de novo achando que perdeu.
            window._latestCompilationModule?.terminalManager?.appendToTerminal(
                'twave', `Estado salvo em ${savedPath}, mas o registro no projeto falhou: ${e?.message || e}`, 'error');
        }
    });
}

// i18n shim, falls back to the key path if i18n didn't boot yet.
const tr = (k, p) => (window.t ? window.t(k, p) : k);

class CompilationModule {
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.projectConfig = null;
        // Reuse the single global TerminalManager. CompilationModule is
        // reconstructed on every compile, and a fresh TerminalManager per
        // instance fragmented the shared terminal state (messageCounts,
        // currentSessionCards, updatableCards) across instances even though
        // they all drive the SAME terminal DOM. Per-compile reset is explicit
        // via clearTerminal(), so one long-lived owner is both correct and
        // leak-free. initializeGlobalTerminalManager() is a lazy singleton;
        // fall back to a local instance only outside the renderer.
        this.terminalManager = (typeof window !== 'undefined' && window.initializeGlobalTerminalManager)
            ? window.initializeGlobalTerminalManager()
            : new TerminalManager();
        this.hierarchyData = null;
        this.isHierarchicalView = false;
        this.gtkwaveProcess = null;
        this.hierarchyGenerated = false;
        this._hierarchyGenerationInProgress = false;
        this.componentsPath = null;
        this.initializeComponentsPath();

        // Pin this instance as "the latest", the file-tree view
        // controller's hierarchy renderer delegates to whatever
        // CompilationModule lives here. New compile click =
        // new instance = new pin = freshest data.
        if (typeof window !== 'undefined') {
            window._latestCompilationModule = this;

            // Highlight the open-in-editor file's row in the hierarchy tree
            // (parity with the verilog/standard trees). Wire ONCE on document
            // (the event doesn't bubble to window) and delegate to the latest
            // instance, CompilationModule is rebuilt per compile, so an
            // unguarded per-instance listener would stack one per compile.
            if (!window.__hierarchyFocusWired) {
                window.__hierarchyFocusWired = true;
                document.addEventListener('aurora:editing-file-changed', () => {
                    refreshHierarchyFocusHighlight();
                });
            }
        }
    }

    /**
     * A linha e um contador subindo? Entao ela move a barra e nao vai para o
     * terminal.
     *
     * Um so ponto de decisao para todos os caminhos de saida (Icarus,
     * Verilator, cocotb, teste de hardware). Antes cada um trazia o seu
     * reconhecedor, entao um formato novo precisava ser ensinado quatro vezes,
     * e na pratica era ensinado a um so: o resto continuava despejando uma
     * linha por atualizacao no terminal.
     *
     * @param {string} terminalId
     * @param {string} linha
     * @param {string} rotuloPadrao  o que a barra mostra quando a linha nao se nomeia
     * @returns {boolean} true quando a linha foi consumida pela barra
     */
    _consumirProgresso(terminalId, linha, rotuloPadrao) {
        const p = lerProgresso(linha, { rotuloPadrao });
        if (!p) return false;
        this.terminalManager.renderHardwareProgress?.(terminalId, {
            pct: p.pct,
            cyc: p.cyc,
            total: p.total,
            reads: p.reads,
            label: p.label,
            done: p.done,
        });
        return true;
    }

    /**
     * Um lembrete quando a simulacao comeca com o laptop na bateria.
     *
     * Na bateria o Windows corta o clock da CPU, e uma simulacao longa fica
     * visivelmente mais lenta; quem nao sabe disso conclui que a AURORA e
     * lenta. Uma linha de dica, no inicio, uma vez por corrida: sem alerta
     * modal e sem mexer no plano de energia do sistema, que e escolha do
     * dono da maquina. Num desktop o main responde false e nada aparece.
     */
    async _avisarSeNaBateria(terminalId) {
        try {
            if (typeof electronAPI.isOnBattery !== 'function') return;
            if (await electronAPI.isOnBattery()) {
                this.terminalManager.appendToTerminal(terminalId,
                    tr('terminal.wave.onBattery'), 'tips');
            }
        } catch (_e) { /* dica e cortesia */ }
    }

    /**
     * Vigia o tamanho do arquivo de onda enquanto a simulacao roda.
     *
     * Recebe os caminhos CANDIDATOS (o nome vem do $dumpfile do testbench, e
     * a extensao varia por simulador), adota o primeiro que aparecer no disco
     * e atualiza o pill do twave ate stop() ser chamado. Melhor esforco por
     * inteiro: falha de stat nao para o vigia nem a simulacao.
     *
     * @param {string[]} candidatos caminhos absolutos possiveis do dump
     * @returns {() => Promise<void>} stop: ultima leitura e marca 'done'
     */
    _vigiarTamanhoDoDump(candidatos) {
        let alvo = null;
        let vivo = true;
        const medir = async (final = false) => {
            try {
                if (!alvo) {
                    for (const c of candidatos) {
                        if (await electronAPI.fileExists(c)) { alvo = c; break; }
                    }
                    if (!alvo) return;
                }
                const st = await electronAPI.getFileStats(alvo);
                if (!vivo && !final) return; // stat resolveu depois do stop
                this.terminalManager.renderDumpSize?.('twave', {
                    name: alvo.split(/[\\/]/).pop(),
                    path: alvo,
                    bytes: st?.size ?? 0,
                    done: final,
                });
            } catch (_e) { /* dump ainda nao existe, ou sumiu no meio */ }
        };
        const timer = setInterval(() => { if (vivo) medir(false); }, 700);
        return async () => {
            vivo = false;
            clearInterval(timer);
            await medir(true);
        };
    }

    async initializeComponentsPath() {
        if (!this.componentsPath) {
            this.componentsPath = await electronAPI.getComponentsPath();
        }
    }


    async monitorGtkwaveProcess() {
        if (!this.gtkwaveProcess) return;

        const checkInterval = setInterval(async () => {
            try {
                const isRunning = await electronAPI.isProcessRunning(this.gtkwaveProcess);

                if (!isRunning) {
                    clearInterval(checkInterval);

                    if (this.isHierarchicalView) {
                        this.terminalManager.appendToTerminal('twave',
                            tr('terminal.wave.gtkwaveClosed'), 'info');

                        setTimeout(() => {
                            this.isHierarchicalView = false;
                            window.fileTreeViewController?.showFileMode?.();
                        }, 500);
                    }

                    this.gtkwaveProcess = null;
                    this.hierarchyGenerated = false;
                }
            } catch (error) {
                clearInterval(checkInterval);
                console.error('Error monitoring GTKWave process:', error);
            }
        }, 2000);
    }

async generateProjectHierarchy() {
    // Hierarchy generation runs whenever there's at least one synthesizable
    // file, Yosys can build a hierarchy from any user .v. The yosys
    // script below handles the no-files case implicitly (empty
    // read_verilog → yosys errors out, caught by the surrounding
    // try/catch).
        try {
            if (!this.projectConfig) throw new Error("Project configuration not loaded");

            const topLevelFilePath = this.projectConfig.topLevelFile;
            if (!topLevelFilePath) throw new Error("'topLevelFile' not found in .spf");

            const designTopModule = moduleStemFromPath(topLevelFilePath);
            const yosysPath = await electronAPI.joinPath(this.componentsPath, 'Packages', 'msys', 'mingw64', 'bin', 'yosys.exe');
            const tempBaseDir = await electronAPI.joinPath(this.componentsPath, 'Temp');

            // components/HDL/ tem a biblioteca SAPHO (myFIFO, processor,
            // core, ula, addr_dec, instr_dec, etc), modulos referenciados
            // pelo design do usuario mas nao listados em
            // synthesizableFiles. Sem incluir esses .v no read_verilog,
            // o yosys faz blackbox automatico mas nao cria entry em
            // modules[], entao parseYosysHierarchy os trata como
            // primitivos e eles somem da arvore (`hierarchy -libdir`
            // existe na doc mas nao funciona nessa versao bundled).
            //
            // `hierarchy -top` remove modulos nao alcancaveis depois,
            // entao incluir HDL/* todo nao polui o JSON final.
            const hdlPath = await electronAPI.joinPath(this.componentsPath, 'HDL');
            let hdlReadCmds = '';
            try {
                const hdlEntries = await electronAPI.listFilesInDirectory(hdlPath);
                if (Array.isArray(hdlEntries)) {
                    const hdlVerilogPaths = await Promise.all(
                        hdlEntries
                            .filter((n) => typeof n === 'string' && n.endsWith('.v') && !n.includes('_tb'))
                            .map((n) => electronAPI.joinPath(hdlPath, n)),
                    );
                    hdlReadCmds = hdlVerilogPaths
                        .map((p) => `read_verilog -sv "${p}"`)
                        .join('\n');
                }
            } catch (_e) {
                this.terminalManager.appendToTerminal(
                    'tveri',
                    tr('terminal.veri.hdlListWarn', { path: hdlPath }),
                    'warning',
                );
            }

            this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.hierarchyGen'));

            const synthesizableFiles = this.projectConfig.synthesizableFiles || [];
            const yosysScript = `
                ${hdlReadCmds}
                ${synthesizableFiles.map(file => `read_verilog -sv "${file.path}"`).join('\n')}
                hierarchy -top ${designTopModule}
                proc
                write_json "${tempBaseDir}\\project_hierarchy.json"
            `;

            const scriptPath = await electronAPI.joinPath(tempBaseDir, 'project_hierarchy_gen.ys');
            await electronAPI.writeFile(scriptPath, yosysScript);

            const hierSpec = buildYosysHierarchySpec({
                yosysPath,
                scriptPath,
                cwd: tempBaseDir,
            });
            const result = await runSpec(hierSpec, { consumeEphemeral: true });

            if (result.code !== 0) throw new Error(tr('error.compilation.yosysProjectFailed'));

            const jsonPath = await electronAPI.joinPath(tempBaseDir, 'project_hierarchy.json');
            const hierarchyJson = JSON.parse(await electronAPI.readFile(jsonPath, {
                encoding: 'utf8'
            }));

            this.hierarchyData = parseYosysHierarchy(hierarchyJson, designTopModule);
            window.fileTreeViewController?.setHierarchyData?.(this.hierarchyData);
            this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.hierarchySuccess'), 'success');
            return true;
        } catch (error) {
            this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.hierarchyError', { message: error.message }), 'warning');
            return false;
        }
    }

    // Thin delegator, the DOM render lives in hierarchy_view.js (A2 #2). Kept
    // as a method because file_tree_view_controller.js calls it on the instance.
    renderHierarchicalTree() {
        renderHierarchy(this.hierarchyData);
    }

async loadConfig() {
    try {
        const projectInfo = await electronAPI.getCurrentProject();
        const currentProjectPath = projectInfo.projectPath || this.projectPath;

        if (!currentProjectPath) {
            throw new Error('No current project path available for loading configuration');
        }

        // .spf, fonte canonica unica. projectOriented.json (legado) e
        // processorConfig.json (legado) foram consolidados no .spf.
        // Defaults pra cmm/asm (cmmFile=`${proc}.cmm`, clk=100,
        // numClocks=2000) sao hardcoded em precompileAllProcessors.
        const spfPath = projectInfo.spfPath;
        try {
            if (!spfPath) throw new Error('No spf path');
            this.projectConfig = await SpfStore.read(spfPath);
        } catch (error) {
            console.warn("Could not load .spf:", error);
            this.projectConfig = null;
        }
    } catch (error) {
        console.error("Failed to load configuration:", error);
        throw error;
    }
}

    async ensureDirectories(name) {
        try {
            const componentsDir = await electronAPI.joinPath('components');
            await electronAPI.mkdir(componentsDir);
            const tempBaseDir = await electronAPI.joinPath(this.componentsPath, 'Temp');
            await electronAPI.mkdir(tempBaseDir);
            const tempProcessorDir = await electronAPI.joinPath(this.componentsPath, 'Temp', name);
            await electronAPI.mkdir(tempProcessorDir);
            return tempProcessorDir;
        } catch (error) {
            console.error("Failed to ensure directories:", error);
            throw error;
        }
    }

    async cmmCompilation(processor) {
        return cmmCompilation(
            this._instanceDeps(), processor, this._chegueiInstrumentProc,
            (p) => { this.lastCompiledCmmPath = p; },
        );
    }

    async asmCompilation(processor, preamble = null) {
        return asmCompilation(this._instanceDeps(), processor, preamble);
    }


/**
 * Helper privado: monta a "shape canonica" do config:
 *   { topLevelFile, testbenchFile, synthesizableFiles }
 *, a partir de this.projectConfig. NAO valida nada e NAO joga.
 * Retorna null se projectConfig nao foi carregado.
 *
 * Usado pelos 3 validators publicos (validateForVerilog,
 * validateForWave, loadConfigUnsafe). Cada validator decide quais
 * campos sao obrigatorios.
 */
_buildConfigShape() {
    if (!this.projectConfig) return null;

    const synth = this.projectConfig.synthesizableFiles || [];
    const topEntry = this._pickSingleTop(synth, 'synthesizable');

    // testbenchFile (legacy single field) vence sobre testbenchFiles[]
    // (lista nova). Se nenhum, procura starred entry; ultimo recurso:
    // primeira entry valida.
    let foundTb = null;
    if (this.projectConfig.testbenchFile && this.projectConfig.testbenchFile.trim() !== '') {
        foundTb = this.projectConfig.testbenchFile;
    } else if (Array.isArray(this.projectConfig.testbenchFiles) && this.projectConfig.testbenchFiles.length > 0) {
        const tbs = this.projectConfig.testbenchFiles.filter((f) => f.path && f.path.trim() !== '');
        const starred = this._pickSingleTop(tbs, 'testbench');
        if (starred) {
            foundTb = starred.path;
        } else if (tbs.length > 0) {
            foundTb = tbs[0].path;
        }
    }

    return {
        topLevelFile:       topEntry ? topEntry.path : null,
        testbenchFile:      foundTb, // may be null
        synthesizableFiles: synth.map((f) => f.path),
    };
}

/**
 * Validacao pro botao Verilog / PRISM / Syntax Check: compile-check
 * do design sintetizavel. Exige projectConfig carregado, pelo menos
 * 1 synth file, e um top-level marcado (iverilog precisa do `-s <top>`).
 * Testbench e opcional (esses fluxos nao usam stimuli).
 *
 * Throws com mensagem amigavel em cada falha.
 */
validateForVerilog() {
    if (!this.projectConfig) {
        throw new Error('Project configuration not loaded');
    }
    if (!this.projectConfig.synthesizableFiles || this.projectConfig.synthesizableFiles.length === 0) {
        throw new Error(tr('error.config.noSynth'));
    }
    const shape = this._buildConfigShape();
    if (!shape.topLevelFile) {
        throw new Error(tr('error.config.noTopLevel'));
    }
    return shape;
}

/**
 * Validacao pro botao Wave: simulacao precisa de um testbench
 * (que vira o `-s` do iverilog e fornece os estimulos). synth files
 * e top-level sao OPCIONAIS, um tb standalone que define tudo
 * inline (incluindo o DUT) e valido.
 *
 * Throws so se projectConfig ausente ou sem testbench.
 */
validateForWave() {
    if (!this.projectConfig) {
        throw new Error('Project configuration not loaded');
    }
    const shape = this._buildConfigShape();
    if (!shape.testbenchFile) {
        throw new Error(tr('error.config.noTestbench'));
    }
    return shape;
}

/**
 * Re-entry helper pra fases internas que ja foram validadas upstream
 * (ex: _waveRunVvpSimulation so precisa consultar config.testbenchFile).
 * NAO valida design requirements, supoe que o caller publico ja jogou
 * pelos validators acima.
 *
 * Throws so se projectConfig nao foi carregado.
 */
loadConfigUnsafe() {
    if (!this.projectConfig) {
        throw new Error('Project configuration not loaded');
    }
    return this._buildConfigShape();
}

/**
 * Pick the file marked `isTopLevel` from a category list, warning if
 * multiple are marked.
 *
 * The set-top-level UI clears the flag from siblings before applying
 * it, so within a single Aurora session you can't end up with two
 * tops in the same category. But the .spf can be hand-edited,
 * migrated from older builds, or written by a buggy
 * version, and a silent "first match wins" turns those cases into
 * "I marked counter.v as top but the build keeps using oldcounter.v"
 * mysteries. Surface the conflict in tveri instead.
 *
 * @param {Array<{path:string, name?:string, isTopLevel?:boolean}>} files
 * @param {'synthesizable'|'testbench'} category , used in the warning text
 * @returns {object|undefined}  The picked file (first match), or undefined
 *      if none has isTopLevel.
 */
_pickSingleTop(files, category) {
    const tops = (files || []).filter((f) => f && f.isTopLevel === true);
    if (tops.length <= 1) return tops[0];
    const picked = tops[0];
    const ignored = tops.slice(1).map((f) => f.name || f.path?.split(/[\\/]/).pop() || '?').join(', ');
    const pickedName = picked.name || picked.path?.split(/[\\/]/).pop() || '?';
    this.terminalManager.appendToTerminal('tveri',
        tr('terminal.veri.multipleTops', { count: tops.length, category, picked: pickedName, ignored }),
        'warning');
    return picked;
}

/**
 * Read a VCD from disk, hand its scopes/signals + the user's picker
 * selection to the gtkw_writer module to build a save-file string,
 * and write the result. Returns true on a non-empty write, false if
 * there was nothing worth saving.
 *
 * The pure VCD walking lives in js/wave/vcd_parser.js and the .gtkw
 * formatting in js/wave/gtkw_writer.js, both unit-tested. This
 * method is the IO glue.
 */
/**
 * Bag de estado de instancia passado aos helpers extraidos
 * (wave_signal_validator.js e processor_compiler.js), eles tocam
 * WaveStore (projectPath), terminal, config e componentsPath sem
 * capturar `this`.
 */
_instanceDeps() {
    return {
        projectPath: this.projectPath,
        terminalManager: this.terminalManager,
        projectConfig: this.projectConfig,
        componentsPath: this.componentsPath,
    };
}

/**
 * Delega pra validateWaveSelection (wave_signal_validator.js). Mantido como
 * metodo da instancia porque js/wave/wave_config_manager.js chama
 * compiler._validateWaveSelection direto, API publica de fato.
 */
async _validateWaveSelection(rawSelected, filePaths, simTopModule, tbKey = null) {
    return validateWaveSelection(this._instanceDeps(), rawSelected, filePaths, simTopModule, tbKey);
}

/**
 * Run iverilog in `-tnull` mode with the testbench as the simulation
 * top, just to confirm the design (synth files + testbench together)
 * actually parses + elaborates. No `.vvp` is produced; nothing is
 * instrumented.
 *
 * Used by the Wave Configuration modal as a gate: there's no point
 * showing a hierarchy picker built from a regex parse if iverilog
 * itself can't read the design. On failure the iverilog output goes
 * to the `tveri` terminal (which we switch focus to) and the modal
 * stays closed, the user fixes their code before picking signals.
 *
 * Returns `{ success: boolean, message?: string }`. Never throws.
 */
async syntaxCheck() {
    if (!this.componentsPath) {
        await this.initializeComponentsPath();
    }
    try {
        const config = this.validateForVerilog();

        const iveriCompPath = await electronAPI.joinPath(
            this.componentsPath, 'Packages', 'msys', 'mingw64', 'bin', 'iverilog.exe',
        );
        if (!await electronAPI.fileExists(iveriCompPath)) {
            const msg = tr('error.toolchain.iverilogNotFound', { path: iveriCompPath });
            this.terminalManager.appendToTerminal('tveri', msg, 'error');
            return { success: false, message: msg };
        }

        const topLevelModuleName = moduleStemFromPath(config.topLevelFile);
        const hasVerilogTestbench = config.testbenchFile && !isPythonFile(config.testbenchFile);
        const simTopModule = hasVerilogTestbench
            ? moduleStemFromPath(config.testbenchFile)
            : topLevelModuleName;

        // Whole design: synth files + testbench (raw, no auto-instrumentation
        //, we want iverilog to evaluate exactly what the user wrote).
        const fileSet = new Set(config.synthesizableFiles);
        if (hasVerilogTestbench) fileSet.add(config.testbenchFile);

        // -y points iverilog at components/HDL pra resolver os modulos
        // da biblioteca SAPHO (processor.v, addr_dec.v, instr_dec.v,
        // ula.v, myFIFO.v, core.v) que o .v gerado pelo asmcomp
        // instancia. Sem isso o syntax check falha com "Unknown module
        // type: processor" em projetos que tem processadores SAPHO.
        // Mesmo padrao do verilogSyntaxCheck / waveBuildVvp.
        const hdlPath = await electronAPI.joinPath(this.componentsPath, 'HDL');

        const checkSpec = buildIverilogCheckSpec({
            iveriCompPath,
            hdlPath,
            simTopModule,
            sourceFiles: [...fileSet],
            cwd: this.projectPath,
        });

        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.bannerSyntaxWc'), 'info');
        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.simTop', { name: simTopModule }), 'info');
        // Linha de comando crua e ruido pra usuario nao-debug, esconde
        // quando verbose=off (mesmo padrao do cmm/asm).
        this.terminalManager.appendToTerminal('tveri', CommandSpec.formatSpec(checkSpec), 'info', { internal: true });

        const result = await runSpec(checkSpec, { consumeEphemeral: true });
        this.terminalManager.processExecutableOutput('tveri', result);

        if (result.code !== 0) {
            this.terminalManager.appendToTerminal('tveri',
                tr('terminal.veri.bannerSyntaxFailed'), 'error');
            return {
                success: false,
                message: `Iverilog reported errors (exit ${result.code}). See terminal.`,
            };
        }

        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.bannerSyntaxPassed'), 'success');
        return { success: true };

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.syntaxError', { message: error.message }), 'error');
        return { success: false, message: error.message };
    }
}

/**
 * Read the testbench, hand its content + the user's picker selection
 * to the testbench_instrumenter module to decide whether and how to
 * inject $dumpfile/$dumpvars, then write the result to Temp/. Returns
 * the path iverilog should compile against, either the original (if
 * the user already wrote dump plumbing, or the file is malformed) or
 * the new instrumented copy.
 *
 * Pure decision logic + string building lives in
 * js/wave/testbench_instrumenter.js (unit-tested). This method is
 * the IO glue.
 */
/**
 * Delega pra resolveWaveSelection (wave_signal_validator.js): resolve a
 * fonte do $dumpvars (.gtkw ativo > Wave Config > $dumpvars do tb > default)
 * e devolve { signalsToDump, overrideUserDumpvars, source, tbKey }.
 */
async _resolveWaveSelection({ config, simTopModule, filePaths }) {
    return resolveWaveSelection(this._instanceDeps(), { config, simTopModule, filePaths });
}

async instrumentTestbench(testbenchPath, tbModule, tempBaseDir, selectedSignals = [], overrideUserDumpvars = false, monitorScopes = []) {
    const originalContent = await electronAPI.readFile(testbenchPath, { encoding: 'utf8' });
    const result = instrumentTestbenchSource({
        originalContent,
        tbModule,
        selectedSignals,
        overrideUserDumpvars,
        monitorScopes,
    });
    if (!result.needsWrite) return { path: testbenchPath, reason: result.reason };

    const basename = testbenchPath.split(/[\\/]/).pop();
    const instrumentedPath = await electronAPI.joinPath(tempBaseDir, `instr_${basename}`);

    // Idempotencia de mtime: so escreve se o conteudo realmente mudou.
    // Importante pro path do Verilator, o make detecta mudanca via
    // mtime; se reescrevemos com mesmo conteudo a cada clique no Wave,
    // o make recompila tudo (5-15s desperdicados). Pro iverilog e
    // neutro (compile e fast anyway). Checamos existence antes de readFile
    // pra evitar o ENOENT spam que o IPC handler loga ate em try/catch.
    if (await electronAPI.fileExists(instrumentedPath)) {
        try {
            const existing = await electronAPI.readFile(instrumentedPath, { encoding: 'utf8' });
            if (existing === result.content) {
                return { path: instrumentedPath, reason: result.reason };
            }
        } catch (_e) { /* read falhou apos exists ok — race ou disco; segue e escreve */ }
    }

    await electronAPI.writeFile(instrumentedPath, result.content);
    return { path: instrumentedPath, reason: result.reason };
}

/**
 * Pre-flight do botao Wave compartilhado entre iverilog e verilator:
 * resolve a selecao de signals, instrumenta o testbench e monta o
 * conjunto de fontes (synth + tb instrumentado).
 *
 * Tudo que e independente do simulador esta aqui. As fases _waveBuild*
 * que vem depois so precisam saber o cmdline do seu simulador.
 *
 * Side-effects:
 *   - Escreve instr_<basename>.v em tempBaseDir (se instrumentacao for
 *     necessaria).
 *   - Atualiza this._validatedWaveSelection (consumido pelo .gtkw
 *     auto-generator em _waveResolveGtkwSaveFile).
 *   - Loga "Wave source: ..." em twave.
 *
 * Returns: { fileSet, instrumentedTbPath, decision }
 *   fileSet: Set<string> com synth files + tb instrumentado (uso direto
 *            pra montar a linha de comando do simulador).
 *   instrumentedTbPath: string (== config.testbenchFile se o tb tem
 *                       $dumpvars hand-written e o user nao customizou).
 *   decision: objeto retornado por _resolveWaveSelection.
 */
async _prepareWaveBuildInputs(config, simTopModule, tempBaseDir) {
    const filePaths = new Set(config.synthesizableFiles);
    if (config.testbenchFile) filePaths.add(config.testbenchFile);
    try {
        const hdlPath = await electronAPI.joinPath(this.componentsPath, 'HDL');
        const hdlEntries = await electronAPI.listFilesInDirectory(hdlPath);
        if (Array.isArray(hdlEntries)) {
            for (const name of hdlEntries) {
                if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                    filePaths.add(await electronAPI.joinPath(hdlPath, name));
                }
            }
        }
    } catch (_e) { /* HDL nao acessivel — segue sem */ }

    const decision = await this._resolveWaveSelection({
        config,
        simTopModule,
        filePaths: [...filePaths],
    });

    const { path: tbPath, reason } = await this.instrumentTestbench(
        config.testbenchFile,
        simTopModule,
        tempBaseDir,
        decision.signalsToDump,
        decision.overrideUserDumpvars,
        decision.monitorScopes || [],
    );

    this._validatedWaveSelection = reason === 'user-defined'
        ? []
        : decision.signalsToDump;

    const sourceLabel = {
        gtkw: tr('terminal.wave.sourceLabelGtkw', { count: decision.signalsToDump.length }),
        wc: tr('terminal.wave.sourceLabelWc', { count: decision.signalsToDump.length }),
        tb: tr('terminal.wave.sourceLabelTb'),
        default: tr('terminal.wave.sourceLabelDefault'),
    }[decision.source] || decision.source;
    this.terminalManager.appendToTerminal('twave',
        tr('terminal.wave.waveSource', { label: sourceLabel }), 'info');

    if (reason === 'override-user') {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.overrideUserDumpvars'), 'tips');
    }

    const fileSet = new Set(config.synthesizableFiles);
    fileSet.add(tbPath);

    // Os $fopen de leitura do testbench, conferidos ANTES de simular. Um
    // `define apontando para a pasta antiga do projeto fez um $fopen devolver
    // 0 e a simulacao rodar 90 segundos lendo entrada vazia, com o $fscanf
    // reclamando a cada ciclo; o simulador nao tem como avisar antes, a
    // AURORA tem. So caminhos que resolvem para literal entram (fopen_paths),
    // porque um aviso errado ensina a ignorar o certo. Aviso, nunca bloqueio:
    // o dono do testbench pode saber algo que nos nao sabemos.
    try {
        const fonteTb = await electronAPI.readFile(config.testbenchFile, { encoding: 'utf8' });
        for (const { path: alvo } of extractFopenReads(fonteTb)) {
            if (!(await electronAPI.fileExists(alvo))) {
                this.terminalManager.appendToTerminal('twave',
                    tr('terminal.wave.fopenMissing', { path: alvo }), 'warning');
            }
        }
    } catch (_e) { /* conferencia e cortesia; sem ela a simulacao segue igual */ }

    return { fileSet, instrumentedTbPath: tbPath, decision };
}

// ---------------------------------------------------------------------
// Iverilog shared helpers
// ---------------------------------------------------------------------

/**
 * Resolve os paths/binarios que ambos os fluxos iverilog (syntax-check
 * e wave-build) precisam:
 *   - tempBaseDir: components/Temp/ (criado se nao existe)
 *   - iveriCompPath: caminho absoluto pro iverilog.exe (throws se ausente)
 *   - hdlPath: components/HDL/ (search dir do -y, pra modulos tipo
 *     processor.v, myFIFO.v, etc.)
 *
 * Side-effect: mkdir tempBaseDir.
 */
async _resolveIverilogTools() {
    const tempBaseDir = await electronAPI.joinPath(this.componentsPath, 'Temp');
    const iveriCompPath = await electronAPI.joinPath(
        this.componentsPath, 'Packages', 'msys', 'mingw64', 'bin', 'iverilog.exe',
    );
    if (!await electronAPI.fileExists(iveriCompPath)) {
        throw new Error(tr('error.toolchain.iverilogNotFound', { path: iveriCompPath }));
    }
    await electronAPI.mkdir(tempBaseDir);
    const hdlPath = await electronAPI.joinPath(this.componentsPath, 'HDL');
    return { tempBaseDir, iveriCompPath, hdlPath };
}

/**
 * Spawna iverilog com a spec dada, faz streaming do output pro terminal
 * tveri, e joga se exit code != 0. `phase` controla as mensagens:
 *   'check' → "Check command:", "Verificando...", iverilogFailedCheck
 *   'build' → "Build command:", "Construindo VVP...", iverilogFailedBuild
 *
 * NAO loga sucesso, caller faz isso (cada fluxo tem mensagem diferente
 * de "Build successful" / "Check successful").
 */
async _runIverilogSpec(spec, { phase }) {
    const isBuild = phase === 'build';
    // Rotulo + linha de comando crua: ambos so em verbose/debug. O
    // rotulo ("Build command:" / "Check command:") precisa do
    // { internal: true } senao aparece sozinho no modo normal
    // enquanto o comando que ele rotula fica escondido.
    this.terminalManager.appendToTerminal('tveri',
        tr(isBuild ? 'terminal.veri.buildCmd' : 'terminal.veri.checkCmd'),
        'info', { internal: true });
    this.terminalManager.appendToTerminal('tveri', CommandSpec.formatSpec(spec), 'info', { internal: true });

    await TabManager.saveAllFiles();

    this.terminalManager.appendToTerminal('tveri',
        tr(isBuild ? 'terminal.veri.building' : 'terminal.veri.checking'),
        'info');

    const result = await runSpec(spec, { consumeEphemeral: true });
    this.terminalManager.processExecutableOutput('tveri', result);

    if (result.code !== 0) {
        throw new Error(tr(
            isBuild ? 'error.compilation.iverilogFailedBuild' : 'error.compilation.iverilogFailedCheck',
            { code: result.code },
        ));
    }
}

/**
 * Syntax-check do design Verilog via iverilog -tnull. Usado pelos
 * botoes Verilog, ASM (re-check pos-otimizacao do .asm) e PRISM
 * (que precisa da hierarquia regenerada pra Yosys consumir).
 *
 * NAO gera .vvp (iverilog -tnull pula code-gen) e NAO inclui o
 * testbench no source set (constructos nao-sintetizaveis como
 * $dumpvars/$finish/delays confundiriam o check puro).
 *
 * Apos sucesso, regenera a hierarquia (write_json via Yosys) pro
 * file tree mostrar a arvore de modulos atualizada.
 *
 * Substitui iverilogCompile({buildVvp:false}). Pareado com
 * waveBuildVvp(), que cuida do fluxo do botao Wave.
 */
async verilogSyntaxCheck() {
    this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.phaseCheck'), 'info');
    statusUpdater.startCompilation('verilog');

    try {
        const config = this.validateForVerilog();

        // 'tips' = blue/info badge. Contexto do que vai compilar (FYI),
        // nao success, o verde so aparece no checkSuccess no fim.
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.topLevel', { name: config.topLevelFile.split(/[\\/]/).pop() }), 'tips');
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.synthFiles', { count: config.synthesizableFiles.length }), 'info');

        const { iveriCompPath, hdlPath } = await this._resolveIverilogTools();

        const topLevelModuleName = config.topLevelFile.split(/[\\/]/).pop().replace(/\.v$/i, '');

        // Source set: so synth files. Testbench fica de fora, tem
        // $dumpvars/$finish/delays nao-sintetizaveis que so confundiriam
        // um check de design puro.
        const fileSet = new Set(config.synthesizableFiles);

        // -y tells iverilog to resolve any module referenced but not
        // listed in the source set by looking for `<moduleName>.v` in
        // these directories. components/HDL tem componentes do processador
        // SAPHO (processor.v, addr_dec.v, instr_dec.v, ula.v, core.v) e
        // componentes usados fora dele (myFIFO.v).
        const spec = buildIverilogCheckSpec({
            iveriCompPath,
            hdlPath,
            // -tnull pede pro iverilog elaborar mas pular code-gen, dando
            // parse + type-check sem produzir .vvp.
            simTopModule: topLevelModuleName,
            sourceFiles: [...fileSet],
            cwd: this.projectPath,
        });

        await this._runIverilogSpec(spec, { phase: 'check' });

        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.checkSuccess'), 'success');
        statusUpdater.compilationSuccess('verilog');

        // Hierarquia regenerada so no syntax-check (acao user-facing
        // "compile"). O Wave button (waveBuildVvp) nao toca hierarquia:
        // o user ja clicou Verilog antes pra chegar num design valido.
        await this.generateProjectHierarchy();

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.bannerFailed'), 'error');
        this.terminalManager.appendToTerminal('tveri', tr('terminal.common.error', { message: error.message }), 'error');
        statusUpdater.compilationError('verilog', error.message);
        error.jaNoTerminal = true;
        throw error;
    }
}

/**
 * Build do .vvp pro botao Wave: synth files + testbench instrumentado
 * → iverilog -o components/Temp/<tb>.vvp.
 *
 * Antes de spawnar o iverilog, faz a parte heavy do pipeline Wave:
 *   1. Resolve a selecao de signals (.gtkw ativo > Wave Config > tb com
 *      $dumpvars hand-written > default $dumpvars(1, tb)).
 *   2. Instrumenta o testbench (escreve cópia em
 *      components/Temp/instr_<tb>.v só com o $dumpfile/$dumpvars escolhido:
 *      sem hook de header-pass; o header sai do FST depois). O .v original
 *      NUNCA e tocado, Aurora escreve uma cópia em Temp/.
 *
 * Apos sucesso, NAO regenera hierarquia (essa e tarefa do botao Verilog).
 *
 * Substitui iverilogCompile({buildVvp:true}). Pareado com
 * verilogSyntaxCheck(), que cuida do botao Verilog.
 */
async waveBuildVvp() {
    this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.phaseBuild'), 'info');
    statusUpdater.startCompilation('verilog');

    try {
        const config = this.validateForWave();

        if (config.topLevelFile) {
            this.terminalManager.appendToTerminal('tveri',
                tr('terminal.veri.topLevel', { name: config.topLevelFile.split(/[\\/]/).pop() }), 'tips');
        }
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.testbench', { name: config.testbenchFile.split(/[\\/]/).pop() }), 'tips');
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.synthFiles', { count: config.synthesizableFiles.length }), 'info');

        const { tempBaseDir, iveriCompPath, hdlPath } = await this._resolveIverilogTools();

        const simTopModule = config.testbenchFile.split(/[\\/]/).pop().replace(/\.v$/i, '');
        const outputFile = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);

        // Source set: synth files; o tb instrumentado e adicionado abaixo.
        const fileSet = new Set(config.synthesizableFiles);

        // Reunir o conjunto de .v pra validacao de signals do picker:
        // synth + testbench + components/HDL/*.v (assim selecoes de
        // Stack/ULA/SAPHO nao sao descartadas como "stale").
        const filePaths = new Set(config.synthesizableFiles);
        filePaths.add(config.testbenchFile);
        try {
            const hdlEntries = await electronAPI.listFilesInDirectory(hdlPath);
            if (Array.isArray(hdlEntries)) {
                for (const name of hdlEntries) {
                    if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                        filePaths.add(await electronAPI.joinPath(hdlPath, name));
                    }
                }
            }
        } catch (_e) { /* HDL nao acessivel, segue sem */ }

        // Precedencia: .gtkw ativo > Wave Config customizado >
        // tb-com-dumpvars > default. Tambem registra o tb no WaveStore
        // na 1a visita.
        const decision = await this._resolveWaveSelection({
            config,
            simTopModule,
            filePaths: [...filePaths],
        });

        const { path: tbPath, reason } = await this.instrumentTestbench(
            config.testbenchFile,
            simTopModule,
            tempBaseDir,
            decision.signalsToDump,
            decision.overrideUserDumpvars,
            decision.monitorScopes || [],
        );
        fileSet.add(tbPath);

        // Quando o tb domina (`user-defined`), a selecao usada pelo
        // .gtkw auto-gerado fica vazia, buildAuroraGtkw cai no layout
        // completo do VCD. Pros outros casos, _validatedWaveSelection
        // = signals escolhidos, e o auto-gtkw filtra por eles.
        this._validatedWaveSelection = reason === 'user-defined'
            ? []
            : decision.signalsToDump;

        // Log diagnostico, mostra qual eixo ditou a selecao,
        // pra debuggar quando o user esperava outra coisa.
        const sourceLabel = {
            gtkw: tr('terminal.wave.sourceLabelGtkw', { count: decision.signalsToDump.length }),
            wc: tr('terminal.wave.sourceLabelWc', { count: decision.signalsToDump.length }),
            tb: tr('terminal.wave.sourceLabelTb'),
            default: tr('terminal.wave.sourceLabelDefault'),
        }[decision.source] || decision.source;
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.waveSource', { label: sourceLabel }), 'info');

        if (reason === 'override-user') {
            this.terminalManager.appendToTerminal('twave',
                tr('terminal.wave.overrideUserDumpvars'), 'tips');
        }
        if (tbPath !== config.testbenchFile) {
            this.terminalManager.appendToTerminal('tveri',
                tr('terminal.veri.autoInstrTb', { name: tbPath.split(/[\\/]/).pop() }), 'info');
        }

        // -y components/HDL pra resolver modulos referenciados mas nao
        // listados (processor.v, myFIFO.v, etc).
        const spec = buildIverilogBuildSpec({
            iveriCompPath,
            hdlPath,
            simTopModule,
            outputFile,
            sourceFiles: [...fileSet],
            cwd: this.projectPath,
        });

        await this._runIverilogSpec(spec, { phase: 'build' });

        // Defensive: iverilog exit 0 mas o -o pode ter falhado em escrever
        // (race com AV scanner, permission, etc).
        if (!await electronAPI.fileExists(outputFile)) {
            throw new Error(tr('error.compilation.vvpNotGenerated'));
        }

        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.buildSuccess'), 'success');
        statusUpdater.compilationSuccess('verilog');

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.bannerFailed'), 'error');
        this.terminalManager.appendToTerminal('tveri', tr('terminal.common.error', { message: error.message }), 'error');
        statusUpdater.compilationError('verilog', error.message);
        error.jaNoTerminal = true;
        throw error;
    }
}

/**
 * Wave button entrypoint. Orquestra o pipeline completo de .v sources
 * ate uma janela GTKWave rodando. Cada fase e um metodo privado com
 * contrato proprio; o orquestrador e curto pra deixar a *ordem das
 * fases* como unica coisa que um futuro leitor tem que entender aqui.
 *
 * Memory file staging (pc_*_mem.txt gerados pelo cmmcomp) acontece
 * dentro de _waveRunVvpSimulation, no-op natural em projetos sem
 * processador (nao ha subdir com .txt pra copiar).
 *
 * Pipeline (read top-to-bottom):
 *
 *   resolveWaveToolchain(componentsPath) → { tempBaseDir, gtkwaveBin, vvpBin, ... }
 *   _waveDeriveSimTopModule(config)  → testbench module name
 *   _waveBuildAndVerifyVvp()         → tempBaseDir/${simTop}.vvp on disk
 *   _waveRunVvpSimulation()          → tempBaseDir/<some>.vcd on disk
 *   _waveResolveVcdFile()            → absolute path to that .vcd
 *   _waveResolveGtkwSaveFile()       → .gtkw absolute path or null
 *   _waveLaunchGtkwave()             → GTKWave process, monitored
 *
 * If you need to change behaviour, change the phase that owns the
 * concern. The orchestrator only changes when you add / remove a
 * phase or reorder them.
 *
 * See ARCHITECTURE.md §9 for the broader rationale (why the dump is the
 * ground truth, how the dump/gtkw sources interact, etc.).
 */
async runGtkWave() {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.bannerSim'), 'info');

    try {
        // validateForWave exige testbench (sem ele, vvp nao tem o que
        // simular). Synth e top-level sao opcionais, um tb standalone
        // pode definir DUT inline. Esse validator substituiu o
        // validateConfig({requireTopLevel:false}) + check separado de
        // testbench que vivia aqui.
        const config = this.validateForWave();

        const tools = await resolveWaveToolchain(this.componentsPath);
        let simTopModule = this._waveDeriveSimTopModule(config);
        let vcdFile = null;
        // Ancora do teste de frescor la embaixo: qualquer dump legitimo desta
        // corrida tem mtime depois deste instante (folga em dumpEstaFresco).
        const inicioDaSimulacao = Date.now();

        if (isPythonFile(config.testbenchFile)) {
            const cocotbCtx = await this._waveValidateCocotbConfig(config);
            simTopModule = cocotbCtx.hdlTopModule;
            // Surface where the DUT came from: the .py directive (explicit), or
            // the .spf top-level fallback (warn so a forgotten directive doesn't
            // silently test the wrong module).
            if (cocotbCtx.toplevelSource === 'directive') {
                this.terminalManager.appendToTerminal('twave',
                    tr('terminal.wave.cocotbToplevelDirective', { module: cocotbCtx.hdlTopModule }), 'tips');
            } else {
                this.terminalManager.appendToTerminal('twave',
                    tr('terminal.wave.cocotbToplevelFallback', {
                        file: basenameOfPath(config.testbenchFile),
                        module: cocotbCtx.hdlTopModule,
                    }), 'warning');
            }
            this.terminalManager.appendToTerminal('twave', tr('terminal.wave.cocotbSimulator', {
                sim: getSimulator() === 'verilator' ? 'Verilator' : 'Icarus',
            }), 'tips');
            // The cocotb build + run doesn't go through the statusUpdater per
            // step, so without this the bar stays stuck on 'asm'. Reflect the
            // actual engine (verilator OR the iverilog/Verilog flow).
            statusUpdater.startCompilation(getSimulator() === 'verilator' ? 'verilator' : 'verilog');
            vcdFile = await this._waveRunCocotbSimulation(cocotbCtx, tools, config);
        } else {
            // Branch no simulador escolhido. iverilog e default; verilator e
            // opt-in via Wave Config (localStorage flag aurora.waveSimulator).
            // Ambos os caminhos convergem em _waveResolveVcdFile, o arquivo
            // de saida (.fst ou .vcd-com-FST) e descoberto la, sem branch.
            const simulator = getSimulator();
            let simDir = tools.tempBaseDir;
            if (simulator === 'verilator') {
                this.terminalManager.appendToTerminal('twave', tr('terminal.wave.verilatorSimulator'), 'tips');
                // O build do Verilator (verilation + g++, pesado) e a sim nao
                // passam pelo statusUpdater por step, entao a barra ficava presa
                // no ultimo step do pipeline ('asm'/Assembly). Marca 'verilator'
                // aqui pra a barra refletir a etapa real durante build + sim.
                statusUpdater.startCompilation('verilator');
                const vTools = await resolveVerilatorTools(this.componentsPath);
                const fullTools = { ...tools, ...vTools };
                const { exePath } = await this._waveBuildVerilator(simTopModule, tools.tempBaseDir, config, fullTools);
                simDir = await this._waveRunVerilatorSimulation(simTopModule, fullTools, exePath);
            } else {
                this.terminalManager.appendToTerminal('twave', tr('terminal.wave.iverilogSimulator'), 'tips');
                // Same as Verilator above: the iverilog build/run doesn't touch
                // the statusUpdater per step, so mark 'verilog' here or the bar
                // stays on 'asm' through the whole Wave.
                statusUpdater.startCompilation('verilog');
                await this._waveBuildAndVerifyVvp(simTopModule, tools.tempBaseDir);
                simDir = await this._waveRunVvpSimulation(simTopModule, tools);
            }
            // Scan the dir the simulation actually ran in, the dump lands
            // in the cwd (_waveSimCwd: the project folder).
            vcdFile = await this._waveResolveVcdFile(simTopModule, simDir);
        }
        // Defesa 2 (dump_guard.js): o dump tem de ser DESTA corrida. Sem
        // isto, um escritor que falhe sem exit code, ou um $dumpfile custom
        // adotado pelo resolver, abre a onda da rodada ANTERIOR como se fosse
        // nova, que foi exatamente o sintoma do laboratorio.
        await this._waveExigirDumpNovo(vcdFile, inicioDaSimulacao);
        // Unified header capture, ONE extraction for all four wave paths
        // (iverilog, Verilator, cocotb+iverilog, cocotb+Verilator). Replaces the
        // old per-flow two-pass: the non-cocotb flows used to run a throwaway
        // +AURORA_HEADER_ONLY simulation just to flush the VCD header, and the
        // cocotb flow converted the whole FST to text. Now the sim runs exactly
        // once (→ FST) and the header (scopes/signals for the picker + auto-gtkw)
        // is pulled straight from that FST. fst2vcd magic-detects the FST
        // regardless of the file extension; for a genuine text VCD it reports no
        // FST and we skip, the VCD is its own header source, parsed downstream.
        const headerVcd = vcdFile.replace(/\.(fst|vcd)$/i, '.header.vcd');
        await this._extractFstHeaderVcd(vcdFile, headerVcd, tools.fst2vcdBin, tools.tempBaseDir);
        // Branch on the user's viewer choice. Default 'gtkwave' → the existing
        // path is untouched for current users; 'surfer' opens Surfer with its
        // own active layout (.surf.ron/.sucl), and no .gtkw is generated for it.
        if (getViewer() === 'surfer') {
            const surferLayout = await this._waveResolveSurferSaveFile(simTopModule, vcdFile, tools.tempBaseDir);
            await this._waveLaunchSurfer(vcdFile, surferLayout, tools);
        } else {
            const gtkwSaveFile = await this._waveResolveGtkwSaveFile(simTopModule, vcdFile, tools.tempBaseDir);
            await this._waveLaunchGtkwave(vcdFile, gtkwSaveFile, tools);
        }
    } catch (error) {
        this.terminalManager.appendToTerminal('twave', tr('terminal.common.error', { message: error.message }), 'error');
        console.error(error);
        error.jaNoTerminal = true;
        throw error;
    }
}

// ---------------------------------------------------------------------
// Wave-flow phases, keep each method's contract block in sync with
// what it actually does. The orchestrator above documents the order;
// each phase below documents the local invariants. ARCHITECTURE.md §9
// has the cross-cutting principles (dump-as-truth, validation gates).
// ---------------------------------------------------------------------

/**
 * Derive the simulation-top module name (the `-s` value passed to
 * iverilog and the basename Aurora expects for the .vvp / .vcd / .gtkw
 * triplet).
 *
 * The testbench module is the simulation top when one exists; falling
 * back to the synthesizable top is for the rare "compile a single .v
 * with no testbench" flow (which the wave button rejects upstream
 * anyway, but the helper stays general).
 */
_waveDeriveSimTopModule(config) {
    if (config.testbenchFile) {
        return moduleStemFromPath(config.testbenchFile);
    }
    // Fallback inalcancavel pelo Wave (runGtkWave ja exige testbench),
    // mas o helper fica geral: se um dia for chamado sem tb, exige top.
    if (!config.topLevelFile) return null;
    return moduleStemFromPath(config.topLevelFile);
}

async _waveValidateCocotbConfig(config) {
    // Quem e o DUT, e o motivo quando nao da: a regra vive em
    // compilation_helpers.decideCocotbDut, com teste. Aqui fica a leitura do
    // arquivo (que pode falhar, e ai a diretiva simplesmente nao existe) e a
    // traducao do motivo. O modulo escolhido ainda precisa estar entre as
    // fontes compiladas por _collectCocotbSources, ou o simulador nao acha.
    let pySource = '';
    if (config.testbenchFile) {
        try {
            pySource = await electronAPI.readFile(config.testbenchFile, { encoding: 'utf8' });
        } catch { /* ilegivel aqui, cai no topo do .spf abaixo */ }
    }
    const dut = decideCocotbDut(config, pySource);
    if (!dut.ok) throw new Error(tr(`error.compilation.${dut.motivo}`));
    const { hdlTopFile, hdlTopModule, toplevelSource } = dut;

    return {
        hdlTopFile,
        hdlTopModule,
        testbenchFile: config.testbenchFile,
        testModule: assertPythonModuleName(config.testbenchFile),
        tbKey: moduleStemFromPath(config.testbenchFile),
        toplevelSource,
    };
}

async _writeCocotbRunnerScript(tempBaseDir) {
    const scriptPath = await electronAPI.joinPath(tempBaseDir, 'aurora_cocotb_runner.py');
    // Fonte unica com o teste: js/compilation/cocotb_runner_source.js.
    // Antes eram ~80 linhas de literais aqui dentro, impossiveis de testar;
    // agora tests/toolchain/pipeline.test.js executa exatamente estes bytes.
    const source = COCOTB_RUNNER_SOURCE;
    await electronAPI.writeFile(scriptPath, source);
    return scriptPath;
}

async _collectCocotbSources(config) {
    const fileSet = new Set();
    for (const path of config.synthesizableFiles || []) {
        if (isVerilogLikeFile(path)) fileSet.add(path);
    }
    if (config.topLevelFile && isVerilogLikeFile(config.topLevelFile)) {
        fileSet.add(config.topLevelFile);
    }

    try {
        const hdlPath = await electronAPI.joinPath(this.componentsPath, 'HDL');
        const hdlEntries = await electronAPI.listFilesInDirectory(hdlPath);
        if (Array.isArray(hdlEntries)) {
            for (const name of hdlEntries) {
                if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                    fileSet.add(await electronAPI.joinPath(hdlPath, name));
                }
            }
        }
    } catch (_e) { /* optional bundled HDL library */ }

    return [...fileSet];
}

async _stageProcessorMemoryFilesForCocotb(tempBaseDir, buildDir) {
    await this._stageProcessorMemoryFiles(tempBaseDir);
    let entries = [];
    try {
        entries = await electronAPI.listFilesInDirectory(tempBaseDir);
    } catch (_e) {
        return;
    }
    for (const name of entries || []) {
        if (typeof name !== 'string') continue;
        if (!name.startsWith('pc_') || !name.endsWith('_mem.txt')) continue;
        try {
            await electronAPI.copyFile(
                await electronAPI.joinPath(tempBaseDir, name),
                await electronAPI.joinPath(buildDir, name),
            );
        } catch (_copyErr) { /* best effort: simulator reports the missing file */ }
    }
}

/**
 * Delega pra resolveCocotbWaveSelection (wave_signal_validator.js). O helper
 * RETORNA a selecao validada; a escrita de `this._validatedWaveSelection`
 * (cache consumido pelos geradores de auto-gtkw/auto-surfer) fica AQUI, pra
 * o ciclo de vida do campo seguir todo dentro da classe.
 */
async _resolveCocotbWaveSelection(ctx, config, sources) {
    const validSignals = await resolveCocotbWaveSelection(this._instanceDeps(), ctx, config, sources);
    this._validatedWaveSelection = validSignals;
    return validSignals;
}

/**
 * Pull ONLY the VCD header (the $scope/$var hierarchy, up to $enddefinitions)
 * out of an FST, WITHOUT materializing the full text VCD. fst2vcd streams VCD
 * to stdout header-first; we accumulate stdout and, the instant we see
 * $enddefinitions, kill fst2vcd (killCurrentSpecProcess). So it iterates only the FST
 * geometry plus the first buffered block, never the whole multi-hundred-MB body.
 * The header alone is what _waveResolveGtkwSaveFile / _waveValidateUserGtkwAgainstVcd
 * parse to build the auto-gtkw and cross-check user .gtkw files; GTKWave then
 * opens the .fst directly. Returns true on success, false if the header could
 * not be captured (caller falls back to a full conversion).
 */
async _extractFstHeaderVcd(fstPath, headerVcdPath, fst2vcdBin, cwd) {
    // Fast path: stream fst2vcd (no -o → it emits the VCD to stdout) and kill it
    // the instant $enddefinitions appears, so it iterates only the FST geometry
    // plus the first buffered block, never the multi-hundred-MB body.
    if (typeof electronAPI.onExecSpecStream === 'function'
        && typeof electronAPI.killCurrentSpecProcess === 'function') {
        const spec = {
            step: 'fst2vcd',
            binary: fst2vcdBin,
            args: ['-f', fstPath],
            cwd,
            label: 'fst2vcd (header only — cancelled at $enddefinitions)',
        };
        const ENDDEFS = /\$enddefinitions\s+\$end/;
        let acc = '';
        let header = null;
        let killPromise = null;
        const unsubscribe = electronAPI.onExecSpecStream((payload) => {
            if (header !== null || !payload || payload.type !== 'stdout' || !payload.data) return;
            acc += payload.data;
            const m = ENDDEFS.exec(acc);
            if (m) {
                header = `${acc.slice(0, m.index + m[0].length)}\n`;
                // We have the whole hierarchy, stop fst2vcd before it streams the
                // body. Targeted kill of the parked child ONLY (NOT cancelVvpProcess,
                // whose by-name vvp/gtkwave sweep would race with and kill the
                // GTKWave this same wave flow launches moments later).
                killPromise = electronAPI.killCurrentSpecProcess();
            }
        });
        try {
            await runSpecStreamed(spec, { consumeEphemeral: true });
        } catch {
            // fall through, header may still have been captured before the throw
        } finally {
            unsubscribe();
        }
        // Ensure the kill fully settled before returning (defensive ordering).
        if (killPromise) { try { await killPromise; } catch { /* best-effort */ } }
        // The boundary can also land exactly as the process closes (tiny design
        // that fully emitted before a chunk carried $enddefinitions), re-check.
        if (header === null) {
            const m = ENDDEFS.exec(acc);
            if (m) header = `${acc.slice(0, m.index + m[0].length)}\n`;
        }
        if (header && header.length > 0) {
            await electronAPI.writeFile(headerVcdPath, header);
            return true;
        }
    }

    // Fallback: full fst2vcd conversion. Correct but materializes the whole text
    // VCD, only reached when streaming is unavailable or the header never
    // surfaced. A real sim FST converts fine; a non-FST input (e.g. a dump that
    // is already a text VCD) fails the magic check, so we return false and the
    // caller leaves that VCD to be parsed directly downstream. Surface it: the
    // fast path is the norm, so hitting this means a slower run the user should
    // know about (otherwise the wait looks like an unexplained hang).
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.headerFallback'), 'tips');
    const result = await runSpec(
        buildFst2VcdSpec({ fst2vcdBin, inputFile: fstPath, outputFile: headerVcdPath, cwd }),
        { consumeEphemeral: true });
    if (result.code !== 0 && result.code !== null) return false;
    if (!await electronAPI.fileExists(headerVcdPath)) return false;
    // Um exit limpo pode ainda deixar um arquivo VAZIO (FST corrompido, entrada
    // nao-FST que mesmo assim saiu com code 0). Sem este check o downstream
    // parsearia 0 scopes e geraria um auto-gtkw vazio SEM nenhum aviso, o
    // usuario veria o GTKWave abrir sem sinais e culparia a propria simulacao.
    // Trata vazio como falha de captura (caller cai no comportamento sem-gtkw).
    try {
        const stats = await electronAPI.getFileStats(headerVcdPath);
        if (!stats || stats.size === 0) return false;
    } catch { /* sem stat -> fileExists ja confirmou presenca; deixa passar */ }
    return true;
}

async _adoptCocotbWaveform(ctx, tools, buildDir) {
    // cocotb runs the sim with cwd = test_dir, which Aurora sets to the
    // PROJECT folder (the .spf dir, same uniform rule as _waveSimCwd), so
    // the dump can land there instead of in buildDir. Search the build dir
    // first, then the project folder, then the testbench's dir (legacy runs).
    const testDir = await electronAPI.dirname(ctx.testbenchFile);
    const candidate =
        await findWaveCandidateInDir(buildDir, ctx.hdlTopModule) ||
        (this.projectPath ? await findWaveCandidateInDir(this.projectPath, ctx.hdlTopModule) : null) ||
        await findWaveCandidateInDir(testDir, ctx.hdlTopModule);
    if (!candidate) {
        throw new Error(tr('error.compilation.cocotbNoWave', { path: buildDir }));
    }

    // Normalize the dump into the temp dir under the canonical name and hand it
    // back. GTKWave opens the FST directly; the VCD header is pulled from it by
    // the unified _extractFstHeaderVcd in runGtkWave, the SAME post-sim step
    // every wave path now uses. (A rare direct text-VCD dump is just copied
    // through; it is its own parseable header source.)
    const ext = /\.fst$/i.test(candidate) ? 'fst' : 'vcd';
    const target = await electronAPI.joinPath(tools.tempBaseDir, `${ctx.hdlTopModule}.${ext}`);
    if (candidate.toLowerCase() !== target.toLowerCase()) {
        await electronAPI.copyFile(candidate, target);
    }
    if (!await electronAPI.fileExists(target)) {
        throw new Error(tr('error.compilation.cocotbNoWave', { path: buildDir }));
    }
    this.terminalManager.appendToTerminal('twave',
        tr('terminal.wave.cocotbVcd', { name: basenameOfPath(target) }), 'info');
    return target;
}

/**
 * Resolve the simulator-specific half of the cocotb run.
 *
 * Both flows run on the ONE Python inside the unified mingw bundle
 * (components/Packages/msys/mingw64/bin/python.exe), whose cocotb carries
 * BOTH VPIs (libcocotbvpi_icarus.vpl + the static libcocotbvpi_verilator.a).
 * That Python needs PYTHONHOME at the bundle's mingw64 and its bin on PATH
 * (for its own DLLs + the iverilog/verilator/g++ it spawns). The only
 * per-simulator differences are SIM and the build args (-g2012 is Icarus-only).
 *
 * @param {boolean} [wave] default true. false (Fast Sim) = sem --trace-fst:
 *        a sim cocotb so verifica (asserts Python), sem gerar onda.
 */
async _resolveCocotbSimProfile(wave = true) {
    const vTools = await resolveVerilatorTools(this.componentsPath);
    const pythonPath = await electronAPI.joinPath(vTools.mingwBin, 'python.exe');
    if (!await electronAPI.fileExists(pythonPath)) {
        throw new Error(tr('error.compilation.cocotbPythonMissing'));
    }
    const status = await electronAPI.getPythonStatus();
    if (!status?.ok || !status.hasCocotb) {
        throw new Error(tr('error.compilation.cocotbPackageMissing', { path: pythonPath }));
    }
    // <bundle>/mingw64/bin → <bundle>/mingw64 (PYTHONHOME).
    const pythonHome = await electronAPI.dirname(vTools.mingwBin);
    const base = {
        pythonPath,
        prependPath: [vTools.mingwBin, vTools.usrBin],
        extraEnv: { PYTHONHOME: pythonHome },
    };
    // Verilator is stricter than Icarus: the SAPHO HDL (e.g. ula.v's float
    // normalization) trips warnings like UNOPTFLAT that Icarus tolerates.
    // Mirror the non-cocotb Verilator flow's -Wno set so warnings don't abort
    // the build (-Wno-fatal is the key one).
    const VERILATOR_BUILD = [
        '-Wno-fatal', '-Wno-TIMESCALEMOD', '-Wno-DECLFILENAME',
        '-Wno-STMTDLY', '-Wno-WIDTHTRUNC', '-Wno-WIDTHEXPAND',
        // Activate the YANC_SIM_VIS block in the generated <proc>.v so the
        // processor's mirrored variables/arrays (marked /* verilator public_flat */)
        // are visible in the waveform, same as the non-cocotb Verilator flow.
        // (Icarus gets this for free via the predefined __ICARUS__.)
        '+define+YANC_TRACE',
        // cocotb's runner builds the model with -Os (size). SAPHO sims are
        // embedded-processor and can run long, so optimize the C++ for speed
        // like the non-cocotb flow: -O3 + -march=native (safe because Aurora
        // builds and runs the binary on the SAME host, host == target, and never
        // redistributes it). The last -O on the g++ line wins, so this overrides
        // cocotb's -Os.
        '-CFLAGS', '-O3',
        '-CFLAGS', '-march=native',
        // Dump FST instead of VCD: cocotb forces --trace (VCD); --trace-fst
        // comes after it in the command, so it wins (VM_TRACE_FST=1) and cocotb's
        // verilator.cpp wrapper writes dump.fst. FST is ~10x smaller than the raw
        // VCD, so the trace I/O during the (long) sim is far cheaper, the main
        // reason cocotb was slower than the native flow. GTKWave opens the .fst
        // directly; the header for the auto-gtkw is pulled from it by the unified
        // _extractFstHeaderVcd in runGtkWave (no full-VCD conversion anymore).
        // No Fast Sim (wave=false) isto sai: sem trace nenhum, a sim so roda os
        // testes (asserts no Python), o ganho do cocotb headless.
        ...(wave ? ['--trace-fst'] : []),
    ];
    return getSimulator() === 'verilator'
        ? { ...base, sim: 'verilator', buildArgs: VERILATOR_BUILD }
        : { ...base, sim: 'icarus', buildArgs: ['-g2012'] };
}

async _waveRunCocotbSimulation(ctx, tools, config, opts = {}) {
    // wave=false (Fast Sim): roda os testes cocotb SEM onda, sem --trace-fst
    // no build, WAVES=0 no runner, e nao adota/abre waveform no fim.
    const wave = opts.wave !== false;
    await TabManager.saveAllFiles();
    await electronAPI.mkdir(tools.tempBaseDir);

    const profile = await this._resolveCocotbSimProfile(wave);

    const buildDir = await electronAPI.joinPath(
        tools.tempBaseDir,
        `cocotb_${safeNamePart(ctx.tbKey)}`,
    );
    await electronAPI.mkdir(buildDir);
    await this._stageProcessorMemoryFilesForCocotb(tools.tempBaseDir, buildDir);

    const sources = await this._collectCocotbSources(config);
    const selecao = await this._resolveCocotbWaveSelection(ctx, config, sources);
    // Sob Verilator a selecao do picker vira regras de escopo num .vlt, como
    // no fluxo nativo; aqui ele entra pelos argumentos de build, porque o
    // runner do cocotb recusa um .vlt na lista de fontes. Sem selecao o dump
    // fica como o cocotb faz nos dois simuladores: tudo a partir do topo.
    const buildArgs = [...profile.buildArgs];
    if (profile.sim === 'verilator' && wave && selecao.length > 0) {
        try {
            const arvore = await buildHierarchyFromFiles(sources, ctx.hdlTopModule);
            const regras = verilatorTraceRules(arvore, selecao);
            if (regras.length) {
                const vltPath = await electronAPI.joinPath(buildDir, 'aurora_scopes.vlt');
                await electronAPI.writeFile(vltPath, [
                    '`verilator_config',
                    '// Gerado pela AURORA a cada build: a selecao do picker por escopo.',
                    ...regras,
                    '',
                ].join('\n'));
                buildArgs.unshift(vltPath);
                const { ligados, desligados } = contarEscopos(arvore, regras);
                this.terminalManager.appendToTerminal('twave',
                    tr('terminal.wave.verilatorScopeRules', { on: ligados, off: desligados }), 'info');
            }
        } catch (_e) { /* sem o .vlt o dump sai inteiro, como antes */ }
    }
    const tbDir = await electronAPI.dirname(ctx.testbenchFile);
    const runnerScript = await this._writeCocotbRunnerScript(tools.tempBaseDir);
    const pythonPathSep = ';';
    const env = {
        AURORA_COCOTB_SOURCES_JSON: JSON.stringify(sources),
        AURORA_COCOTB_TOP: ctx.hdlTopModule,
        AURORA_COCOTB_TEST_MODULE: ctx.testModule,
        AURORA_COCOTB_BUILD_DIR: buildDir,
        // test_dir = cwd da SIMULACAO no runner do cocotb. Mesma regra
        // uniforme dos fluxos vvp/Verilator (_waveSimCwd): a pasta do
        // projeto (.spf) e a base de referencia, paths relativos do .py
        // e do HDL resolvem contra ela, e o dump cai la.
        AURORA_COCOTB_TEST_DIR: this.projectPath || tbDir,
        AURORA_COCOTB_PYTHONPATH: [tbDir, this.projectPath, buildDir].filter(Boolean).join(pythonPathSep),
        AURORA_COCOTB_BUILD_ARGS_JSON: JSON.stringify(buildArgs),
        AURORA_COCOTB_TEST_ARGS_JSON: JSON.stringify([]),
        SIM: profile.sim,
        TOPLEVEL_LANG: 'verilog',
        WAVES: wave ? '1' : '0',
        // Force UTF-8 stdio so cocotb's logs (and the user's prints/docstrings)
        // with non-ASCII, arrows, pt-BR accents, emoji, don't crash the bundle
        // Python's logging on the Windows cp1252 codepage (UnicodeEncodeError).
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        // Use cocotb's C-side clock (GpiClock) instead of the Python-coroutine
        // clock. cocotb's `Clock(..., impl="auto")` (the default) picks the
        // GpiClock only when COCOTB_TRUST_INERTIAL_WRITES is set; otherwise it
        // falls back to a Python coroutine that toggles the clock over the VPI on
        // every edge. Measured on teste345 (Verilator): identical outputs, and
        // ~12% faster on the full ~4.5ms sim / ~2.4x faster on short sims (the
        // Python clock's cost is mostly fixed startup). A free, verified win.
        COCOTB_TRUST_INERTIAL_WRITES: '1',
        ...profile.extraEnv,
    };

    const spec = buildCocotbRunSpec({
        pythonPath: profile.pythonPath,
        runnerScript,
        cwd: buildDir,
        env,
        prependPath: profile.prependPath,
    });

    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.runningCocotb', {
        sim: profile.sim === 'verilator' ? 'Verilator' : 'Icarus',
    }), 'info');
    await this._avisarSeNaBateria('twave');
    this.terminalManager.appendToTerminal('twave', CommandSpec.formatSpec(spec), 'info', { internal: true });

    // Um contador que sobe vira a barra, e nao uma linha por atualizacao. Os
    // formatos reconhecidos moram no progress_line.js, junto com a regra de
    // quando NAO engolir a linha; aqui so se decide o que fazer com o que ele
    // devolve. Ver _consumirProgresso.
    let unsubscribe = null;
    if (typeof electronAPI.onExecSpecStream === 'function') {
        unsubscribe = electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                if (!line.trim()) continue;
                if (this._consumirProgresso('twave', line, tr('terminal.wave.progress'))) continue;
                this.terminalManager.appendToTerminal('twave', line, 'raw');
            }
        });
    }

    // Mesma blindagem dos fluxos vvp/Verilator (defesa 1 de dump_guard.js).
    // So no modo wave: o Fast Sim (wave=false) nao escreve dump nenhum.
    if (wave) {
        await this._waveExigirDumpGravavel(this.projectPath || tbDir, NOMES_DE_DUMP_COCOTB);
    }

    let code;
    // O runner do cocotb sob Verilator escreve dump.fst no test_dir (a pasta
    // do projeto); sob Icarus o nome vem do runner tambem como dump.
    const pararVigia = this._vigiarTamanhoDoDump([
        await electronAPI.joinPath(this.projectPath || tbDir, 'dump.fst'),
        await electronAPI.joinPath(buildDir, 'dump.fst'),
        await electronAPI.joinPath(this.projectPath || tbDir, 'dump.vcd'),
    ]);
    try {
        const result = await runSpecStreamed(spec, { consumeEphemeral: true });
        code = result.code;
    } finally {
        if (unsubscribe) unsubscribe();
        await pararVigia();
    }
    // Two distinct outcomes, deliberately handled differently.
    //
    // COCOTB_TESTS_FAILED (2): the simulation itself ran to completion and the
    // dump exists, some @cocotb.test() asserted false. Aborting here would
    // deny the student the waveform at the exact moment it is most useful, so
    // report the failure loudly and CONTINUE to adopt/open the wave.
    //
    // Any other non-zero: infrastructure failure (build error, missing module,
    // interpreter crash). There is nothing to show; fail hard.
    //
    // Before this, ONLY `code !== 0` was checked and the runner exited 0 even
    // when tests failed, so a failing testbench was reported as a successful
    // simulation, the single verdict a testbench exists to produce, silently
    // discarded.
    if (code !== 0 && code !== COCOTB_TESTS_FAILED) {
        throw new Error(tr('error.compilation.cocotbFailed', { code }));
    }
    if (code === COCOTB_TESTS_FAILED) {
        this.terminalManager.appendToTerminal('twave', tr('terminal.wave.cocotbTestsFailed'), 'error');
        statusUpdater.compilationError('verilog', 'cocotb tests failed');
    }

    // Fast Sim nao tem onda pra adotar nem abrir, so o resultado dos testes.
    return wave ? this._adoptCocotbWaveform(ctx, tools, buildDir) : null;
}

/**
 * Build the .vvp via iverilog and confirm it landed at the expected
 * path. Always rebuilds, the instrumented testbench bakes the user's
 * $dumpvars selection in at iverilog time, so a previous .vvp would
 * lock in a previous selection.
 *
 * Inputs:  simTopModule, tempBaseDir
 * Returns: void (vvp file path is reconstructible from the inputs)
 * Throws:  if iverilog fails OR the expected .vvp isn't on disk
 * Side-effects: writes ${tempBaseDir}/${simTopModule}.vvp; logs to twave;
 *               also caches `this._validatedWaveSelection` as part of
 *               waveBuildVvp (the .gtkw resolver reads it).
 */
async _waveBuildAndVerifyVvp(simTopModule, tempBaseDir) {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.buildingVvp'), 'info');
    await this.waveBuildVvp();
    // waveBuildVvp ja verifica internamente que o .vvp existe (defesa
    // em profundidade); este check externo permite mensagem de erro
    // especifica do contexto Wave caso o path seja sintetizado errado.
    const vvpFile = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);
    if (!await electronAPI.fileExists(vvpFile)) {
        throw new Error(tr('error.compilation.vvpNotProduced', { path: vvpFile }));
    }
}

/**
 * Working directory for the simulation run (vvp / Verilator exe):
 * ALWAYS the project folder, the directory of the open .spf, the same
 * base the .spf's own relative file paths resolve against. One uniform
 * rule, no special cases: anything relative in the project (testbench
 * $readmemb/$fopen data, DUT memory files) resolves against the project
 * folder, and the dump lands there too. Generated SAPHO pc_*_mem.txt
 * are staged INTO this folder before the run (see the callers).
 *
 * Inputs:  tools (tempBaseDir, fallback only)
 * Returns: absolute dir to run the simulation in
 */
async _waveSimCwd(tools) {
    return this.projectPath || tools.tempBaseDir;
}

/**
 * Run vvp on the freshly-built .vvp. The cwd is _waveSimCwd (the
 * project folder); processor memory files and out-of-folder testbench
 * data files are staged into it first.
 *
 * Inputs:  simTopModule, tools (uses tempBaseDir + vvpBin)
 * Returns: the cwd the simulation ran in (dir to scan for the dump)
 * Throws:  if vvp exits non-zero
 * Side-effects: writes a .vcd under the returned dir; streams
 *               vvp's stdout/stderr to twave.
 */
async _waveRunVvpSimulation(simTopModule, tools) {
    // Re-entry: runGtkWave ja validou pra Wave upstream; aqui so
    // precisamos consultar config.testbenchFile. loadConfigUnsafe
    // pega o config sem re-validar (evita throws fantasmas no meio
    // da execucao).
    const config = this.loadConfigUnsafe();
    const simCwd = await this._waveSimCwd(tools);

    // SAPHO: o cmmcomp escreve os pc_<proc>_mem.txt em
    // <components>/Temp/<proc>/, e o .v gerado do processador os le por
    // $readmemb com nome RELATIVO (yanc/ASM/Sources/hdl.c), copia-los
    // pro cwd da simulacao. No-op em projeto sem processador.
    await this._stageProcessorMemoryFiles(tools.tempBaseDir, simCwd);

    // Arquivos de dado que o testbench le ($fopen/$readmem relativo):
    // o usuario espera resolucao relativa a pasta do TESTBENCH; se o tb
    // nao esta na pasta do projeto, copia cada arquivo pra ca. No-op
    // quando origem e destino coincidem (tb na pasta do projeto).
    if (config.testbenchFile) {
        await this._stageTestbenchDataFiles(simCwd, config.testbenchFile);
    }

    // Defesa 1 (dump_guard.js): dump da rodada anterior preso ou
    // somente-leitura aborta AGORA, nomeando o arquivo e a correcao, em vez
    // de gastar a simulacao para o vvp morrer com um "Unable to open"
    // perdido no meio da saida.
    await this._waveExigirDumpGravavel(simCwd, nomesDeDumpEsperados(simTopModule));

    const vvpFile = await electronAPI.joinPath(tools.tempBaseDir, `${simTopModule}.vvp`);

    // Single full simulation with vvp -fst → ${simTopModule}.vcd (FST binary
    // written under the $dumpfile name). No header-only pass anymore: the VCD
    // header is pulled from this FST by the unified _extractFstHeaderVcd in
    // runGtkWave. This also fixes the old hand-written-$dumpvars edge case,
    // where the +AURORA_HEADER_ONLY plusarg was a no-op and pass 1 ran the FULL
    // simulation twice.
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.runningVvp'), 'info');
    await this._avisarSeNaBateria('twave');

    // Stream sim output to twave live so $display lines from the
    // testbench show up as the simulation progresses. User $display
    // lines get tagged 'raw' (no card, always visible). Lines that
    // are clearly vvp/iverilog system noise, dump-format announce,
    // $finish location, etc., get tagged 'plain' so the verbose-off
    // filter hides them; the user only cares about those during
    // debugging.
    // Substring match (lowercased) is more robust than regex against
    // variations of vvp's bookkeeping output.
    const isVvpNoise = (line) => {
        const t = (line || '').toLowerCase();
        return (
            t.includes('fst info:')
            || t.includes('vcd info:')
            || t.includes('lxt info:') || t.includes('lxt2 info:')
            || t.includes('vzt info:')
            || t.includes('$finish called at')
            || t.includes('$stop called at')
        );
    };
    // Guard a ausencia de onExecSpecStream (degrada sem streaming ao vivo)
    //, consistente com os fluxos cocotb e Verilator, que ja checam.
    let unsubscribe = null;
    // Uma explicacao SO por corrida: o vvp repete "invalid file descriptor"
    // a cada ciclo de clock quando um $fopen falhou, e mil copias do erro nao
    // dizem mais que uma. A primeira dispara a dica com a causa e o que fazer.
    let avisouDescritor = false;
    if (typeof electronAPI.onExecSpecStream === 'function') {
        unsubscribe = electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            // Split so each line can be classified independently; chunks
            // from spawn can carry multiple newlines per data event.
            for (const line of payload.data.split(/\r?\n/)) {
                if (!line.trim()) continue;
                // Hard-drop toolchain bookkeeping lines (FST/VCD info,
                // $finish called at, …). They're useful only when
                // debugging the simulator itself, and the user has
                // electron-log + DevTools for that. Keeping them out
                // of twave entirely avoids the verbose-mode toggle
                // sync issue altogether.
                if (isVvpNoise(line)) continue;
                if (!avisouDescritor && /invalid file descriptor/i.test(line)) {
                    avisouDescritor = true;
                    this.terminalManager.appendToTerminal('twave',
                        tr('terminal.wave.invalidFd'), 'warning');
                }
                // Um `$display` de contador escrito pelo aluno no testbench
                // vira a barra em vez de mil linhas. Ver _consumirProgresso.
                if (this._consumirProgresso('twave', line, tr('terminal.wave.progress'))) continue;
                this.terminalManager.appendToTerminal('twave', line, 'raw');
            }
        });
    }
    let code;
    const pararVigia = this._vigiarTamanhoDoDump([
        await electronAPI.joinPath(simCwd, `${simTopModule}.vcd`),
        await electronAPI.joinPath(simCwd, `${simTopModule}.fst`),
    ]);
    try {
        const vvpRunSpec = buildVvpRunSpec({
            vvpBin: tools.vvpBin,
            vvpFile,
            cwd: simCwd,
        });
        const r = await runSpecStreamed(vvpRunSpec, { consumeEphemeral: true });
        code = r.code;
    } finally {
        if (unsubscribe) unsubscribe();
        await pararVigia();
    }
    if (code !== 0) {
        throw new Error(tr('error.compilation.vvpFailed', { code }));
    }
    return simCwd;
}

// ---------------------------------------------------------------------
// Verilator wave-flow phases. Paralelas a _waveBuildAndVerifyVvp /
// _waveRunVvpSimulation, mas com toolchain diferente:
//
//   iverilog: source -> .vvp -> vvp (interpretador)  → FST
//   verilator: source -> C++ -> g++ -> .exe nativo    → FST
//
// O .exe que sai do Verilator e tipicamente 10-100x mais rapido que vvp
// em testbenches longos, ao custo de stricter linting e dependencia
// adicional (verilator + g++). Escolha do simulador via
// js/wave/simulator_preference.js (default: iverilog).
// ---------------------------------------------------------------------

/**
 * Compila o design via Verilator. Produz um .exe nativo em
 * <tempBaseDir>/obj_dir_<simTop>/V<simTop>.exe.
 *
 * Reusa _prepareWaveBuildInputs pra resolver selecao + instrumentar
 * testbench, o conjunto de fontes que vai pro Verilator e o mesmo que
 * iria pro iverilog (synth + tb instrumentado + -y HDL).
 *
 * Flags Verilator:
 *   --binary       gera main + invoca make pra produzir o .exe
 *   --main         o main e gerado pelo Verilator (default eval-loop ate $finish)
 *   --trace-fst    instrumenta runtime pra FST (respeita $dumpvars/$dumpfile)
 *   -j 0           parallel build (numero de CPUs)
 *   -O0            zero optimization no Verilator (build rapido; runtime ainda
 *                  e nativo, entao bem mais rapido que vvp mesmo sem O3)
 *   -Wno-fatal     warnings nao param o build, iverilog e mais permissivo
 *                  que Verilator, entao testbenches que rodam em iverilog
 *                  costumam ter "issues" que Verilator marcaria como erro
 *   -Mdir <dir>    onde gerar os arquivos C++ e o Makefile
 *   --top-module   modulo top da simulacao (== nome do testbench)
 *   -y <hdl>       biblioteca de modulos (mesma logica do iverilog)
 *
 * Throws se Verilator falhar OU se o .exe nao for produzido.
 */
async _waveBuildVerilator(simTopModule, tempBaseDir, config, tools) {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.buildingVerilator'), 'plain');

    const prep = await this._prepareWaveBuildInputs(config, simTopModule, tempBaseDir);
    if (prep.instrumentedTbPath !== config.testbenchFile) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.veri.autoInstrTb', { name: prep.instrumentedTbPath.split(/[\\/]/).pop() }), 'plain');
    }

    const hdlPath = await electronAPI.joinPath(this.componentsPath, 'HDL');
    const objDir = await electronAPI.joinPath(tempBaseDir, `obj_dir_${simTopModule}`);
    await electronAPI.mkdir(objDir);

    // --timing (e nao --no-timing): testbenches SAPHO usam # delays pra
    // gerar clock e timing de IO. Sem isso, o clk fica preso em settling
    // loop e simulacao aborta com DIDNOTCONVERGE. Verilator 5.x suporta
    // --timing via -fcoroutines do g++.
    //
    // Otimizacoes (vs primeira versao -O0):
    //  - SEM `-O0`: deixa Verilator usar o default `--O3` (otimizacao do
    //    Verilog pra C++). Build ~2x mais lento, runtime ~5x mais rapido.
    //  - `--x-assign fast`: assume X = 0 (em vez de gerar codigo de
    //    tracking de X-state). Ganho substancial em design com regs
    //    inicializados implicitamente.
    //  - `--no-trace-top`: suprime APENAS o wrapper sintetico que o Verilator
    //    gera ACIMA do top module (o escopo $root/TOP artificial), NAO os
    //    sinais do proprio top module. O testbench (top) e seus sinais
    //    continuam tracados normalmente e aparecem no picker. Como o dump
    //    enraiza no top via $dumpvars(0/1, <tb>), o nivel sintetico nem entra,
    //    entao na pratica isto e quase um no-op (verificado: FST identico com e
    //    sem o flag). Mantido como limpeza barata do wrapper redundante.
    //  - `-CFLAGS '-O3 -fstrict-aliasing'`: g++ usa -O3 em vez do -Os
    //    default do Verilator (que otimiza tamanho, nao velocidade).
    //    Tecnica: g++ recebe -Os primeiro (do OPT_FAST) e -O3 depois (do
    //    CFLAGS), quando ha multiplas flags -O*, a ULTIMA vence.
    //    OPT_FAST=-O3 via env nao funciona porque o Makefile gerado usa
    //    `=` direto (nao `?=`), entao env nao sobrescreve.
    //    Build fica ~2x mais lento, runtime ~3-5x mais rapido, maior
    //    ganho isolado da otimizacao.
    //
    // Filosofia de warnings: deixar passar o que indica bug ou
    // oportunidade de melhoria. Silenciar so o que e mecanico/SAPHO
    // convention e nao agrega valor de revisao:
    //   - TIMESCALEMOD: floods 50+ warnings (1 por modulo); a fix e
    //     mecanica (`timescale 1ns/1ps em cada .v). Util saber, mas
    //     a primeira leva drowna o resto.
    //   - DECLFILENAME: SAPHO usa "proc_*.v contem module Proc*" como
    //     convencao; nao e bug.
    //   - STMTDLY: --timing ja trata #delay; aviso e redundante.
    //   - fatal: alguns "warnings" viram errors em Verilator; precisamos
    //     manter como warning pra Aurora seguir o build.
    //
    // Tudo o resto vem a tona, WIDTHTRUNC/EXPAND, COMBDLY, INITIALDLY,
    // PINMISSING, UNOPTFLAT, UNUSEDSIGNAL/PARAM, sao reais e iverilog
    // escondia. Vale revisar o codigo a partir deles.
    const verilatorWarnings = [
        '-Wno-fatal',
        '-Wno-TIMESCALEMOD',
        '-Wno-DECLFILENAME',
        '-Wno-STMTDLY',
    ];
    // Visibilidade de signals sob Verilator (YANC v4.3): o harness agora
    // compila sob Verilator via +define+YANC_TRACE (ver buildVerilatorBuildSpec).
    // O <proc>.v gerado espelha cada variavel/array do usuario, a PC->C±
    // line table, o opcode tap e os I/O ports em signals de sim-visibility
    // taggeados /* verilator public_flat */, entao essas variaveis curadas
    // aparecem no FST igual ao iverilog, e proc.valr10 resolve
    // hierarquicamente (por isso o strip workaround foi removido, o $finish
    // de fim-de-programa funciona).
    //
    // O que continua NAO-visivel sob Verilator: os CPU internals e wires de
    // plumbing (me1_f_global_v_..., raw `comp` halves, valr5, PC-delay
    // intermediates), o <proc>.v os cerca com /* verilator tracing_off */
    // (no-op pro iverilog). Sob Verilator a fence vence mesmo que o
    // $dumpvars do picker nomeie um deles; sob iverilog tudo e dumpavel.
    // Expor um signal cercado sob Verilator exigiria um .vlt per-proc do
    // lado do yanc.
    const buildSources = [...prep.fileSet];
    // Monitores (stack/ULA) sob Verilator: variaveis nao-publicas somem do
    // $dumpvars em silencio. Este .vlt marca exatamente as cinco variaveis de
    // monitoramento como public_flat_rd, por MODULO (vale para toda instancia
    // sp/isp/ula de qualquer processador) — o "per-proc do lado do yanc" do
    // comentario acima nunca foi necessario: regra por modulo resolve.
    try {
        const vltPath = await electronAPI.joinPath(tempBaseDir, 'aurora_monitors.vlt');
        const linhas = [
            '`verilator_config',
            '// Gerado pela AURORA a cada build: expoe os monitores de pilha e',
            '// ULA para o $dumpvars do testbench instrumentado.',
            'public_flat_rd -module "stack" -var "pointeri"',
            'public_flat_rd -module "stack" -var "fl_max"',
            'public_flat_rd -module "stack" -var "fl_full"',
            'public_flat_rd -module "ula" -var "delta_int"',
            'public_flat_rd -module "ula" -var "delta_float"',
        ];
        // O que o usuario pediu para gravar, como regras de escopo. O
        // Verilator ignora os argumentos do $dumpvars e gravaria a hierarquia
        // publica inteira; o .vlt e o unico lugar em que ele obedece, e a
        // granularidade dele e o escopo. As mesmas tres origens do Icarus:
        // a selecao do picker (Wave Configuration ou .gtkw ativo), os
        // $dumpvars do proprio testbench (o gerado pelo yanc cita sinal por
        // sinal), e o padrao $dumpvars(1, tb). Semantica provada em
        // 22/08/2026, ver verilator_trace_rules.js.
        const decisao = prep.decision || {};
        const arvore = decisao.hierarchyTree;
        let regras = [];
        if (decisao.source === 'wc' || decisao.source === 'gtkw') {
            regras = verilatorTraceRules(arvore, decisao.signalsToDump);
        } else if (decisao.source === 'tb') {
            const fonteTb = await electronAPI.readFile(prep.instrumentedTbPath, { encoding: 'utf8' });
            regras = rulesFromDumpvars(arvore, fonteTb);
        } else if (decisao.source === 'default') {
            regras = defaultScopeRules(arvore);
        }
        if (regras.length) {
            linhas.push('// O pedido do usuario por escopo: a ordem importa, a ultima regra vence.');
            linhas.push(...regras);
            const { ligados, desligados } = contarEscopos(arvore, regras);
            this.terminalManager.appendToTerminal('twave',
                tr('terminal.wave.verilatorScopeRules', { on: ligados, off: desligados }), 'info');
        }
        linhas.push('');
        await electronAPI.writeFile(vltPath, linhas.join('\n'));
        buildSources.push(vltPath);
    } catch (_e) { /* sem .vlt os monitores so ficam de fora do FST Verilator */ }
    // Builder monta tokens individuais (sem aspas, sem shell). Executor
    // em main faz spawn(perlExe, args, { shell:false }), cada token vai
    // direto pro child sem reparse. -CFLAGS aparece duas vezes (O3 +
    // fstrict-aliasing) porque o cmd-via-shell antigo perdia aspas; com
    // shell:false isso virou apenas convenção do Verilator (uma flag
    // por -CFLAGS), preservada no builder.
    const verilatorSpec = buildVerilatorBuildSpec({
        perlExe: tools.perlExe,
        verilatorScript: tools.verilatorScript,
        mingwBin: tools.mingwBin,
        usrBin: tools.usrBin,
        hdlPath,
        simTopModule,
        objDir,
        sourceFiles: buildSources,
        cwd: tempBaseDir,
        extraWarnings: verilatorWarnings,
    });

    this.terminalManager.appendToTerminal('twave', CommandSpec.formatSpec(verilatorSpec), 'info', { internal: true });

    // O3: stream the Verilator BUILD (previously a ~10–60s silent runSpec) so the
    // terminal shows progress instead of a frozen panel. Same wiring as the
    // run-step below: append lines live, unsubscribe when the build resolves.
    let buildUnsub = null;
    if (typeof electronAPI.onExecSpecStream === 'function') {
        buildUnsub = electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                if (!line.trim()) continue;
                // O make que o Verilator dispara conta em "[ 42%]". Uma barra
                // subindo diz o mesmo que as dezenas de linhas, e diz melhor.
                if (this._consumirProgresso('twave', line, tr('terminal.wave.progressBuild'))) continue;
                this.terminalManager.appendToTerminal('twave', line, 'raw');
            }
        });
    }
    let result;
    try {
        result = await runSpecStreamed(verilatorSpec, { consumeEphemeral: true });
    } finally {
        if (buildUnsub) buildUnsub();
    }
    if (result.code !== 0) {
        throw new Error(tr('error.compilation.verilatorFailed', { code: result.code }));
    }

    // Verilator nomeia o .exe como V<top>.exe (Windows mingw) ou V<top>.
    const exePath = await electronAPI.joinPath(objDir, `V${simTopModule}.exe`);
    if (!await electronAPI.fileExists(exePath)) {
        const fallback = await electronAPI.joinPath(objDir, `V${simTopModule}`);
        if (!await electronAPI.fileExists(fallback)) {
            throw new Error(tr('error.compilation.verilatorExeMissing', { path: exePath }));
        }
        return { exePath: fallback, objDir };
    }
    return { exePath, objDir };
}

/**
 * Roda o .exe do Verilator UMA vez (sim completa), escrevendo <simTop>.vcd
 * com FST binário (Verilator com --trace-fst honra o nome do $dumpfile sem
 * trocar a extensão). GTKWave abre esse arquivo direto (autodetecta FST). O
 * header do VCD (pro picker + auto-gtkw) é extraído desse FST pelo
 * _extractFstHeaderVcd unificado em runGtkWave, não há mais pass-1 de header.
 *
 * Cwd do .exe = tempBaseDir, pelos mesmos motivos do vvp ($readmemb
 * relativo, $fopen do testbench relativo).
 */
async _waveRunVerilatorSimulation(simTopModule, tools, exePath) {
    // Re-entry: runGtkWave ja validou; aqui so consultamos testbenchFile.
    // Mesmo contrato de cwd do vvp (_waveSimCwd): a pasta do projeto,
    // com os mesmos stagings (no-op quando nao ha nada a copiar).
    const config = this.loadConfigUnsafe();
    const simCwd = await this._waveSimCwd(tools);
    await this._stageProcessorMemoryFiles(tools.tempBaseDir, simCwd);
    if (config.testbenchFile) {
        await this._stageTestbenchDataFiles(simCwd, config.testbenchFile);
    }

    // Mesma blindagem do fluxo vvp (defesa 1 de dump_guard.js).
    await this._waveExigirDumpGravavel(simCwd, nomesDeDumpEsperados(simTopModule));

    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.runningVerilator'), 'plain');
    await this._avisarSeNaBateria('twave');

    // Full sim. Stream output pro twave live (igual vvp).
    const isVvpNoise = (line) => {
        const t = (line || '').toLowerCase();
        return (
            t.includes('fst info:')
            || t.includes('vcd info:')
            || t.includes('$finish called at')
            || t.includes('$stop called at')
        );
    };
    // Banner/relatorio do PROPRIO Verilator (prefixados "- ": "Simulation
    // Report", "Verilator: walltime/cpu", "...Verilog $finish") = toolchain
    // noise. Marca 'plain' (verbose-only) pra sumir com verbose off; os
    // $display do testbench (sem esse prefixo) seguem 'raw' (sempre visivel).
    const isVerilatorReport = (line) => {
        const t = (line || '').trim();
        if (!t.startsWith('-')) return false;
        const low = t.toLowerCase();
        return low.includes('verilator')
            || low.includes('$finish')
            || low.includes('$stop')
            || low.replace(/\s/g, '').includes('simulationreport');
    };

    let unsubscribe = null;
    if (typeof electronAPI.onExecSpecStream === 'function') {
        unsubscribe = electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                if (!line.trim()) continue;
                if (isVvpNoise(line)) continue;
                if (this._consumirProgresso('twave', line, tr('terminal.wave.progress'))) continue;
                this.terminalManager.appendToTerminal('twave', line, isVerilatorReport(line) ? 'plain' : 'raw');
            }
        });
    }
    let code;
    const pararVigia = this._vigiarTamanhoDoDump([
        await electronAPI.joinPath(simCwd, `${simTopModule}.vcd`),
        await electronAPI.joinPath(simCwd, `${simTopModule}.fst`),
    ]);
    try {
        // PATH precisa incluir bundle mingw64+usr bin: o .exe gerado pelo
        // Verilator linka dinamicamente contra libstdc++-6.dll / libgcc /
        // libwinpthread do bundle, e sem PATH o Windows aborta com
        // STATUS_DLL_NOT_FOUND (0xC0000135 → exit 3221225781). O builder
        // monta isso via prependPath; executor em main injeta no env.
        const verilatorRunSpec = buildVerilatorRunSpec({
            exePath,
            cwd: simCwd,
            mingwBin: tools.mingwBin,
            usrBin: tools.usrBin,
        });
        const r = await runSpecStreamed(verilatorRunSpec, { consumeEphemeral: true });
        code = r.code;
    } finally {
        if (unsubscribe) unsubscribe();
        await pararVigia();
    }
    if (code !== 0) {
        throw new Error(tr('error.compilation.verilatorRunFailed', { code }));
    }
    return simCwd;
}

// =====================================================================
// Botao "Fast Sim", Verilator headless (sem onda)
// =====================================================================
//
// Roda o MESMO testbench do botao Wave via Verilator binario, mas sem
// gerar waveform e sem abrir o GTKWave, so a velocidade. Mantem --timing
// (o testbench original dirige o clock por #delay) e tira --trace-fst. O
// custo de I/O do dump (a maior fatia da sim) some. Verilator-only: o
// botao so habilita com o toggle de simulador em Verilator.
//
// Diferente do fluxo Wave, NAO instrumenta o tb: usa o source cru com os
// $dumpfile/$dumpvars comentados (sem trace, qualquer dump seria peso
// morto, ou erro de "tracing not configured").

/**
 * Monta o source set do Fast Sim: synth files + testbench do usuario com os
 * $dumpfile/$dumpvars NEUTRALIZADOS (commentOutDumpCalls). Escreve
 * fast_<tb>.v em tempBaseDir. O -y HDL vai pelo builder, igual ao Wave.
 *
 * @returns {Promise<{ fileSet:Set<string>, fastTbPath:string }>}
 */
async _prepareFastSimInputs(config, simTopModule, tempBaseDir) {
    const tbSrc = await electronAPI.readFile(config.testbenchFile, { encoding: 'utf8' });
    const fastTbPath = await electronAPI.joinPath(tempBaseDir, `fast_${simTopModule}.v`);
    await electronAPI.writeFile(fastTbPath, commentOutDumpCalls(tbSrc));
    const fileSet = new Set(config.synthesizableFiles);
    fileSet.add(fastTbPath);
    return { fileSet, fastTbPath };
}

/**
 * Build do Fast Sim. Identico ao _waveBuildVerilator menos (a) NAO
 * instrumenta o tb (usa _prepareFastSimInputs) e (b) passa trace:false ao
 * builder (sem --trace-fst). Mantem --timing, -O3, warnings e -y HDL.
 * objDir proprio (obj_dir_fast_*) pra nao colidir com o build do Wave.
 *
 * @returns {Promise<string>} path do V<top>.exe
 */
async _fastSimBuildVerilator(simTopModule, tempBaseDir, config, tools) {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.fastBuilding'), 'plain');

    const prep = await this._prepareFastSimInputs(config, simTopModule, tempBaseDir);
    const hdlPath = await electronAPI.joinPath(this.componentsPath, 'HDL');
    const objDir = await electronAPI.joinPath(tempBaseDir, `obj_dir_fast_${simTopModule}`);
    await electronAPI.mkdir(objDir);

    const verilatorSpec = buildVerilatorBuildSpec({
        perlExe: tools.perlExe,
        verilatorScript: tools.verilatorScript,
        mingwBin: tools.mingwBin,
        usrBin: tools.usrBin,
        hdlPath,
        simTopModule,
        objDir,
        sourceFiles: [...prep.fileSet],
        cwd: tempBaseDir,
        extraWarnings: ['-Wno-fatal', '-Wno-TIMESCALEMOD', '-Wno-DECLFILENAME', '-Wno-STMTDLY'],
        trace: false,
    });

    this.terminalManager.appendToTerminal('twave', CommandSpec.formatSpec(verilatorSpec), 'info', { internal: true });
    const result = await runSpec(verilatorSpec, { consumeEphemeral: true });
    this.terminalManager.processExecutableOutput('twave', result);
    if (result.code !== 0) {
        throw new Error(tr('error.compilation.verilatorFailed', { code: result.code }));
    }

    let exePath = await electronAPI.joinPath(objDir, `V${simTopModule}.exe`);
    if (!await electronAPI.fileExists(exePath)) {
        const fallback = await electronAPI.joinPath(objDir, `V${simTopModule}`);
        if (!await electronAPI.fileExists(fallback)) {
            throw new Error(tr('error.compilation.verilatorExeMissing', { path: exePath }));
        }
        exePath = fallback;
    }
    return exePath;
}

/**
 * Pipeline do Fast Sim. Build sem trace -> roda o .exe (reusa
 * _waveRunVerilatorSimulation, que ja faz staging de memoria/data files,
 * streama os $display e trata o PATH das DLLs do bundle). Fim: sem header,
 * sem .gtkw, sem GTKWave.
 */
async runFastSim() {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.fastBanner'), 'info');
    try {
        const config = this.validateForWave();
        // Duas naturezas de testbench, dois caminhos, ambos SEM onda:
        //  - .py  -> cocotb headless (testes Python, qualquer engine);
        //  - .v   -> Verilator binario sem trace.
        if (isPythonFile(config.testbenchFile)) {
            await this._runFastCocotb(config);
        } else {
            await this._runFastVerilator(config);
        }
    } catch (error) {
        this.terminalManager.appendToTerminal('twave', tr('terminal.common.error', { message: error.message }), 'error');
        console.error(error);
        error.jaNoTerminal = true;
        throw error;
    }
}

/** Fast Sim, caminho Verilog: Verilator binario sem trace (sem onda). */
async _runFastVerilator(config) {
    const tools = await resolveWaveToolchain(this.componentsPath);
    const simTopModule = this._waveDeriveSimTopModule(config);

    statusUpdater.startCompilation('verilator');
    const vTools = await resolveVerilatorTools(this.componentsPath);
    const fullTools = { ...tools, ...vTools };

    const exePath = await this._fastSimBuildVerilator(simTopModule, tools.tempBaseDir, config, fullTools);
    await this._waveRunVerilatorSimulation(simTopModule, fullTools, exePath);

    this.terminalManager.appendToTerminal('twave',
        tr('terminal.wave.fastDone', { name: simTopModule }), 'success');
}

/**
 * Fast Sim, caminho cocotb (.py): roda os testes Python SEM gerar onda
 * (WAVES=0, sem --trace-fst) e sem adotar/abrir waveform. Respeita o toggle
 * de simulador, cocotb roda em iverilog OU Verilator. Espelha a branch
 * cocotb do runGtkWave, menos o pos-processamento de onda.
 */
async _runFastCocotb(config) {
    const tools = await resolveWaveToolchain(this.componentsPath);
    const cocotbCtx = await this._waveValidateCocotbConfig(config);

    if (cocotbCtx.toplevelSource === 'directive') {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.cocotbToplevelDirective', { module: cocotbCtx.hdlTopModule }), 'tips');
    } else {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.cocotbToplevelFallback', {
                file: basenameOfPath(config.testbenchFile), module: cocotbCtx.hdlTopModule,
            }), 'warning');
    }
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.cocotbSimulator', {
        sim: getSimulator() === 'verilator' ? 'Verilator' : 'Icarus',
    }), 'tips');
    statusUpdater.startCompilation(getSimulator() === 'verilator' ? 'verilator' : 'verilog');

    await this._waveRunCocotbSimulation(cocotbCtx, tools, config, { wave: false });

    this.terminalManager.appendToTerminal('twave',
        tr('terminal.wave.fastDone', { name: cocotbCtx.hdlTopModule }), 'success');
}

// =====================================================================
// Botao "Verilator (processador CMM)"
// =====================================================================
//
// Roda o top-level gerado pelo compilador CMM (<proc>.v) com Verilator,
// usando a fiacao previsivel do processador SAPHO. Self-contained: o
// handler (compilation_flow) ja roda cmm+asm antes pra ter <proc>.v,
// <proc>_tb.v e .mif frescos.
//
//   1. --json-only no <proc>.v        -> portas (clk/rst/in/out/req_in/out_en[/itr])
//   2. parseia o <proc>_tb.v          -> fiacao input_<N>.txt <-> req_in one-hot,
//                                        output_<N>.txt <-> out_en one-hot
//   3. gera o harness C++ (decimal com sinal, rst pulso, itr=0 se existir)
//   4. --cc --exe --build             -> V<proc>.exe
//   5. roda numClocks fixos no <proc>/Simulation/ (mesmos arquivos do iverilog)
//
// O exe imprime no fim "N clocks simulados, M leitura(s) de entrada" no
// terminal twave. Diferente do botao top-level generico, NAO ha templates
// nem diretivas `# @gate`, a fiacao vem do tb.

/**
 * Resolve o processador-alvo do botao: o PROCESSADOR ATIVO mostrado na
 * status bar (o .cmm em foco no editor cruzado com a lista do projeto).
 * Fonte unica = getActiveProcessorName() (project/active_processor). Retorna
 * o objeto do processador (com numClocks) ou null se nao ha ativo, caso
 * em que o botao ja deveria estar desabilitado; o run() trata o null com
 * uma mensagem clara como rede de seguranca (ex: chamada via AuroraAPI).
 */
_resolveProcessorTarget() {
    const activeName = getActiveProcessorName() || null;
    if (!activeName) return null;
    const procs = (Array.isArray(this.projectConfig?.processors) ? this.projectConfig.processors : [])
        .map((p) => (typeof p === 'string' ? { name: p } : p))
        .filter((p) => p && p.name);
    return procs.find((p) => p.name === activeName) || null;
}

/**
 * Pipeline do harness Verilator do processador CMM. Throws com mensagem
 * clara em qualquer falha de etapa.
 */
async verilatorProcessorRun() {
    await this.initializeComponentsPath();
    if (!this.projectConfig) throw new Error(tr('error.config.notLoaded'));

    const proc = this._resolveProcessorTarget();
    if (!proc) throw new Error(tr('error.compilation.noActiveProcessor'));
    const procName = proc.name;
    const numClocks = Number.isFinite(proc.numClocks) ? proc.numClocks : 2000;

    const procDir = await electronAPI.joinPath(this.projectPath, procName);
    const procV = await electronAPI.joinPath(procDir, 'Hardware', `${procName}.v`);
    const simDir = await electronAPI.joinPath(procDir, 'Simulation');

    if (!await electronAPI.fileExists(procV)) {
        throw new Error(tr('error.compilation.procVMissing', { path: procV }));
    }

    const tools = await resolveVerilatorTools(this.componentsPath);
    const tempBaseDir = await electronAPI.joinPath(this.componentsPath, 'Temp');
    const hdlPath = await electronAPI.joinPath(this.componentsPath, 'HDL');
    const objDir = await electronAPI.joinPath(tempBaseDir, `obj_dir_proc_${procName}`);
    await electronAPI.mkdir(objDir);

    // Todo este fluxo loga no terminal THTEST (Hardware Test), etapas de
    // pipeline em alto nivel (info/success), ruido da toolchain
    // (verilator/perl/g++/make) so no modo verbose (plain), e a barra de
    // progresso ASCII inline da execucao. Ver renderHardwareProgress.
    const T = 'thtest';

    // ---- Inicio ----
    this.terminalManager.appendToTerminal(T, tr('terminal.htest.start', { name: procName, clocks: numClocks }), 'info');

    // ---- Passo 1: portas via --json-only ----
    this.terminalManager.appendToTerminal(T, tr('terminal.wave.procPorts', { name: procName }), 'info');
    const jsonSpec = buildVerilatorJsonSpec({
        perlExe: tools.perlExe, verilatorScript: tools.verilatorScript,
        mingwBin: tools.mingwBin, usrBin: tools.usrBin,
        hdlPath, topModule: procName, objDir,
        sourceFiles: [procV], cwd: tempBaseDir,
    });
    this.terminalManager.appendToTerminal(T, CommandSpec.formatSpec(jsonSpec), 'info', { internal: true });
    const jsonResult = await runSpec(jsonSpec, { consumeEphemeral: true });
    this.terminalManager.processExecutableOutput(T, jsonResult);
    if (jsonResult.code !== 0) throw new Error(tr('error.compilation.verilatorJsonFailed', { code: jsonResult.code }));
    const jsonPath = await electronAPI.joinPath(objDir, `V${procName}.tree.json`);
    if (!await electronAPI.fileExists(jsonPath)) {
        throw new Error(tr('error.compilation.verilatorJsonMissing', { path: jsonPath }));
    }
    const ports = parseVerilatorPorts(JSON.parse(await electronAPI.readFile(jsonPath, { encoding: 'utf8' })));

    // ---- Passo 2: fiacao de I/O lida do proprio <proc>.v (bloco YANC_SIM_VIS) ----
    const wiring = parseProcessorIO(await electronAPI.readFile(procV, { encoding: 'utf8' }));
    if (wiring.inputs.length === 0 && wiring.outputs.length === 0) {
        this.terminalManager.appendToTerminal(T, tr('terminal.wave.procNoPorts'), 'warning');
    }

    // ---- Passo 3: gera o harness C++ ----
    this.terminalManager.appendToTerminal(T, tr('terminal.htest.genCpp', { name: procName }), 'info');
    const gen = generateVerilatorProcTb({
        topModule: procName, ports,
        inputs: wiring.inputs, outputs: wiring.outputs,
        numClocks,
    });
    const cppPath = await electronAPI.joinPath(tempBaseDir, `tl_proc_${procName}.cpp`);
    await electronAPI.writeFile(cppPath, gen.source);

    this.terminalManager.appendToTerminal(T,
        tr('terminal.wave.procWiring', {
            inputs: wiring.inputs.map((p) => `${p.file}@req${p.reqValue}`).join(', ') || '—',
            outputs: wiring.outputs.map((p) => `${p.file}@en${p.enValue}`).join(', ') || '—',
            itr: gen.hasItr ? 'itr=0' : 'sem itr',
        }), 'info');

    // ---- Passo 4: build ----
    this.terminalManager.appendToTerminal(T, tr('terminal.wave.procBuilding', { name: procName }), 'info');
    const buildSpec = buildVerilatorTbBuildSpec({
        perlExe: tools.perlExe, verilatorScript: tools.verilatorScript,
        mingwBin: tools.mingwBin, usrBin: tools.usrBin,
        hdlPath, topModule: procName, objDir,
        sourceFiles: [procV, cppPath], cwd: tempBaseDir,
    });
    this.terminalManager.appendToTerminal(T, CommandSpec.formatSpec(buildSpec), 'info', { internal: true });
    const buildResult = await runSpec(buildSpec, { consumeEphemeral: true });
    this.terminalManager.processExecutableOutput(T, buildResult);
    if (buildResult.code !== 0) throw new Error(tr('error.compilation.verilatorTbBuildFailed', { code: buildResult.code }));

    let exePath = await electronAPI.joinPath(objDir, `V${procName}.exe`);
    if (!await electronAPI.fileExists(exePath)) {
        const fallback = await electronAPI.joinPath(objDir, `V${procName}`);
        if (!await electronAPI.fileExists(fallback)) {
            throw new Error(tr('error.compilation.verilatorExeMissing', { path: exePath }));
        }
        exePath = fallback;
    }

    // ---- Passo 5: roda numClocks no Simulation/ (streamed, com barra) ----
    this.terminalManager.appendToTerminal(T, tr('terminal.wave.procRunning', { name: procName, clocks: numClocks }), 'info');
    const runProcSpec = buildVerilatorTbRunSpec({
        exePath, cwd: simDir,
        mingwBin: tools.mingwBin, usrBin: tools.usrBin,
        cycles: numClocks,
    });
    this.terminalManager.appendToTerminal(T, CommandSpec.formatSpec(runProcSpec), 'info', { internal: true });

    // O harness imprime "@@AURORA_PROG <cyc> <nclk> <reads>" no stdout a cada
    // ~1% dos clocks (com fflush). Essas linhas movem a barra e NAO sao
    // ecoadas; o formato mora no progress_line.js, junto com os demais, e a
    // barra e alimentada pelo mesmo _consumirProgresso dos outros caminhos.
    // O @@AURORA_CHEGUEI <clock> nao e progresso e sim o fim: o pino `cheguei`
    // (#TOAQUI) encerrou a simulacao, e guardamos o clock para avisar o
    // usuario. Tambem e consumido; o resto do stdout vai como plain (so no
    // verbose).
    const CHEGUEI_RE = /^@@AURORA_CHEGUEI\s+(\d+)/;
    const execLabel = tr('terminal.htest.exec');
    let chegueiClock = null;
    let lastReads = null;
    let unsub = null;
    if (typeof electronAPI.onExecSpecStream === 'function') {
        unsub = electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                const p = lerProgresso(line, { rotuloPadrao: execLabel });
                if (p) {
                    // O total do harness manda; numClocks e a reserva para o
                    // caso de ele imprimir zero.
                    if (p.reads != null) lastReads = p.reads;
                    this.terminalManager.renderHardwareProgress?.(T, {
                        pct: p.pct, cyc: p.cyc, total: p.total || numClocks,
                        reads: p.reads, label: execLabel,
                    });
                    continue;
                }
                const ch = line.match(CHEGUEI_RE);
                if (ch) { chegueiClock = +ch[1]; continue; }
                if (!line.trim()) continue;
                this.terminalManager.processStreamedLine(T, line.trim());
            }
        });
    }
    let runCode;
    try {
        const r = await runSpecStreamed(runProcSpec, { consumeEphemeral: true });
        runCode = r.code;
    } finally {
        if (unsub) unsub();
    }
    if (runCode !== 0) throw new Error(tr('error.compilation.verilatorTbRunFailed', { code: runCode }));

    // Fecha a barra no clock REAL de parada: o teto (numClocks) num run
    // completo, ou o clock do `cheguei` se o programa terminou antes, assim
    // a barra para em "1224/2000", nao forca "2000/2000".
    const endCyc = chegueiClock != null ? chegueiClock : numClocks;
    const endPct = numClocks ? Math.min(100, Math.round((endCyc / numClocks) * 100)) : 100;
    this.terminalManager.renderHardwareProgress?.(T, {
        pct: endPct, cyc: endCyc, total: numClocks, reads: lastReads, label: execLabel, done: true,
    });

    // Encerrou pelo pino `cheguei` (programa terminou antes do teto de clocks).
    if (chegueiClock != null) {
        this.terminalManager.appendToTerminal(T,
            tr('terminal.htest.chegueiEnd', { clock: chegueiClock }), 'success');
    }

    // Mensagem final com o diretorio de saida como LINK: clicar abre a
    // view de pastas da file tree e revela essa pasta (aberta).
    const doneMsg = tr('terminal.wave.procDone', {
        dir: simDir,
        outputs: wiring.outputs.map((p) => p.file).join(', ') || '—',
    });
    if (this.terminalManager.appendFolderLink) {
        this.terminalManager.appendFolderLink(T, doneMsg, simDir, 'success');
    } else {
        this.terminalManager.appendToTerminal(T, doneMsg, 'success');
    }
}

/**
 * Varre subdirectorias de tempBaseDir procurando arquivos pc_*_mem.txt
 * (gerados pelo cmmcomp em cada Temp/<proc>/) e copia pro proprio
 * tempBaseDir. vvp roda com CWD=tempBaseDir e precisa achar esses
 * arquivos no $readmemb que o ProcDTW.v faz internamente.
 *
 * Tolerante a falha por subdir, se uma das pastas nao puder ser
 * lida, segue pra proxima. Tolerante a "subdir nao existe ou nao tem
 * arquivo de memoria", silencio.
 */
async _stageProcessorMemoryFiles(tempBaseDir, destDir = tempBaseDir) {
    return stageProcessorMemoryFiles(this._instanceDeps(), tempBaseDir, destDir);
}

/**
 * Varre o source do testbench atras de chamadas $fopen / $readmemb /
 * $readmemh com argumentos string literal. Pra cada arquivo
 * referenciado por path relativo (i.e. sem drive letter ou raiz
 * absoluta), tenta copia-lo de <dir-do-testbench>/<nome> pra
 * destDir/<nome>, o CWD onde a simulacao realmente procura
 * (a pasta do projeto, ver _waveSimCwd). Quando o testbench ja esta
 * na pasta do projeto, origem == destino e a copia e pulada.
 *
 * Suporta paths com subpastas (ex: $fopen("data/x.txt")) criando
 * dirs intermediarios em destDir.
 *
 * Tolerante a falhas: arquivo nao existe ou copia falha apenas
 * pula com warning silencioso. O proprio erro do vvp (com
 * mensagem clara apontando o $fopen falho) e mais informativo
 * que tentar adivinhar aqui.
 */
async _stageTestbenchDataFiles(destDir, testbenchPath) {
    if (!testbenchPath) return;
    let content;
    try {
        content = await electronAPI.readFile(testbenchPath, { encoding: 'utf8' });
    } catch (_e) {
        return;
    }

    // Coletar so arquivos que o testbench LE, sao os que precisam
    // ser stageados em tempBaseDir antes do vvp rodar. Arquivos
    // abertos pra ESCRITA (ex: um dump.txt via $fopen("...", "w"))
    // sao output do testbench e nao existem antes da simulacao;
    // stageamos quebraria com um warning falso "not found".
    //
    //   $readmemb / $readmemh       , sempre leitura → stage.
    //   $fopen sem 2o arg           , modo write-only (padrao Verilog
    //                                  2001 retorna mcd) → skip.
    //   $fopen com 2o arg "r"/"rb"  , leitura → stage.
    //   $fopen com qualquer outro
    //   modo ("w","a","wb",etc)     , write/append → skip.
    const filenames = new Set();
    // $readmemb / $readmemh, argumento entre aspas duplas.
    const reReadmem = /\$readmem[bh]\s*\(\s*"([^"]+)"/g;
    let m;
    while ((m = reReadmem.exec(content)) !== null) {
        filenames.add(m[1]);
    }
    // $fopen("file", "mode"), captura modo pra decidir se le ou
    // escreve. Sem 2o arg, e write-only por default (Verilog 2001
    // returns mcd), nao entra aqui, ent skip implicito.
    const reFopenWithMode = /\$fopen\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
    while ((m = reFopenWithMode.exec(content)) !== null) {
        const mode = m[2].toLowerCase();
        // Modos de leitura: "r", "rb", "r+", "rb+", "r+b". Conservador
        // mas cobre os casos comuns.
        if (mode === 'r' || mode === 'rb' || mode.startsWith('r+') || mode.startsWith('rb+')) {
            filenames.add(m[1]);
        }
    }
    if (filenames.size === 0) return;

    const tbDir = await electronAPI.dirname(testbenchPath);
    const failures = [];
    for (const fname of filenames) {
        // Skip absolute paths, usuario sabe o que quer (e o vvp
        // resolve corretamente desde o CWD).
        if (/^[a-zA-Z]:[\\/]/.test(fname) || fname.startsWith('/') || fname.startsWith('\\')) continue;
        const clean = fname.replace(/^\.[\\/]+/, '');
        const src = await electronAPI.joinPath(tbDir, clean);
        try {
            const exists = await electronAPI.fileExists(src);
            if (!exists) {
                failures.push({ name: fname, reason: 'not found in testbench folder' });
                continue;
            }
            const dst = await electronAPI.joinPath(destDir, clean);
            // Testbench na pasta do projeto: origem == destino, nada a copiar
            // (copiar um arquivo sobre ele mesmo pode trunca-lo no Windows).
            if (src.replace(/\//g, '\\').toLowerCase() === dst.replace(/\//g, '\\').toLowerCase()) {
                continue;
            }
            // Garante dirs intermediarios pra fname com subpasta.
            const dstDir = await electronAPI.dirname(dst);
            if (dstDir && dstDir !== destDir) {
                try { await electronAPI.mkdir(dstDir); } catch (_e) { /* exists ok */ }
            }
            await electronAPI.copyFile(src, dst);
        } catch (e) {
            failures.push({ name: fname, reason: e.message });
        }
    }

    // Success path is silent, copying testbench data files between
    // folders is internal plumbing. Failures still surface as warnings
    // because those *are* actionable (a missing data file means the
    // testbench will crash on $readmemh).
    for (const fail of failures) {
        this.terminalManager.appendToTerminal(
            'twave',
            tr('terminal.wave.couldNotStageTbFile', { name: fail.name, reason: fail.reason }),
            'warning',
        );
    }
}

/**
 * Find the .vcd that vvp just produced.
 *
 * Aurora's auto-instrumented testbench writes `${simTopModule}.vcd`,
 * which is the happy path. The recovery branch handles the
 * "user wrote $dumpfile with a different name" case: the dump lands in
 * the simulation cwd (`simDir`, the project folder; see _waveSimCwd),
 * so the file is in there under whatever name the user picked. We scan
 * for unambiguous .vcd files and adopt one if the choice is clear.
 *
 * Inputs:  simTopModule, simDir (the cwd the simulation ran in)
 * Returns: absolute path to the .vcd to use downstream
 * Throws:  if zero or multiple candidate .vcds (ambiguous);
 *          message names the candidates and offers two concrete fixes
 * Side-effects: logs to twave (success line, or warning when the
 *               adopted file's name differs from simTopModule.vcd)
 */
async _waveResolveVcdFile(simTopModule, simDir) {
    // Pass 2 (vvp -fst) produces ${simTopModule}.fst, that's what
    // GTKWave opens. Pass 1 left a partial .vcd alongside it for
    // _waveResolveGtkwSaveFile to parse the header from; that file
    // isn't returned here.
    // Success is silent, confirming the dump file exists is internal
    // plumbing. The user already saw "Simulation started"; the next
    // visible step is GTKWave opening. Failures still throw with a
    // detailed error below.
    const expectedFst = await electronAPI.joinPath(simDir, `${simTopModule}.fst`);
    if (await electronAPI.fileExists(expectedFst)) {
        return expectedFst;
    }
    // Legacy fallback: a full .vcd, in case someone runs vvp without
    // -fst (e.g. when investigating a problem with the two-pass flow).
    const expectedVcd = await electronAPI.joinPath(simDir, `${simTopModule}.vcd`);
    if (await electronAPI.fileExists(expectedVcd)) {
        return expectedVcd;
    }

    let candidates = [];
    try {
        const entries = await electronAPI.listFilesInDirectory(simDir);
        candidates = (entries || []).filter((name) => {
            const n = name.toLowerCase();
            return n.endsWith('.fst') || n.endsWith('.vcd');
        });
    } catch (_listErr) {
        candidates = [];
    }

    if (candidates.length === 1) {
        const adopted = await electronAPI.joinPath(simDir, candidates[0]);
        // The warning is the actionable bit, the user's $dumpfile()
        // picked a different name than expected. Keep it. The "found
        // the file" success line is suppressed (internal plumbing).
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.dumpfileMismatch', { name: candidates[0], expected: simTopModule }),
            'warning');
        return adopted;
    }

    const detail = candidates.length === 0
        ? `No .fst/.vcd was produced.`
        : `Multiple dump candidates were produced: ${candidates.join(', ')}.`;
    throw new Error(
        `Dump file was not generated as ${simTopModule}.fst.\n` +
        `${detail}\n` +
        `Aurora looks for a .fst (or .vcd) named after the testbench module.`,
    );
}

/**
 * Defesa 1 de dump_guard.js: cada nome em `nomes` que JA exista em `simDir`
 * precisa aceitar abertura em escrita, o mesmo acesso que o simulador vai
 * pedir ao sobrescrever. O veredito vem do IPC file:check-writable (um open
 * 'r+' que nao altera nada). Medido no Windows real: viewer prendendo o
 * arquivo devolve EBUSY; somente-leitura/politica devolve EPERM. Teste de
 * ESCRITA de proposito, nunca de delecao: o GTKWave aberto bloqueia deletar
 * mas nao sobrescrever, e um pre-delete acusaria erro num caso que simularia
 * normalmente.
 *
 * Inputs:  simDir (cwd da simulacao), nomes (basenames de dump esperados)
 * Throws:  quando um dump existente esta bloqueado para escrita; a mensagem
 *          separa EBUSY (feche o viewer) do resto (destrave o arquivo).
 *          Falha do proprio IPC nao bloqueia (fail-open): a defesa primaria
 *          continua sendo o exit code do simulador.
 */
async _waveExigirDumpGravavel(simDir, nomes) {
    if (typeof electronAPI.checkFileWritable !== 'function') return;
    for (const nome of nomes) {
        let veredito = null;
        try {
            const alvo = await electronAPI.joinPath(simDir, nome);
            veredito = await electronAPI.checkFileWritable(alvo);
        } catch (_) { continue; }
        if (!veredito || !veredito.exists || veredito.writable) continue;
        const chave = veredito.code === 'EBUSY'
            ? 'error.compilation.dumpLockedBusy'
            : 'error.compilation.dumpLockedDenied';
        throw new Error(tr(chave, { file: nome, code: veredito.code || '?' }));
    }
}

/**
 * Defesa 2 de dump_guard.js: o dump resolvido precisa ser DESTA corrida.
 * `inicioMs` vem de runGtkWave, capturado antes de qualquer build/sim; um
 * mtime anterior a ele (com a folga de dumpEstaFresco) significa que o
 * simulador NAO reescreveu o arquivo e o que esta ali e onda velha.
 *
 * Inputs:  vcdFile (path absoluto do dump resolvido), inicioMs (Date.now())
 * Throws:  quando o dump e de uma corrida anterior. Stat quebrado nao
 *          bloqueia (fail-open), mesmo racional da defesa 1.
 */
async _waveExigirDumpNovo(vcdFile, inicioMs) {
    let stats = null;
    try { stats = await electronAPI.getFileStats(vcdFile); } catch (_) { return; }
    if (dumpEstaFresco(stats ? stats.mtime : NaN, inicioMs)) return;
    throw new Error(tr('error.compilation.dumpStale', { file: basenameOfPath(vcdFile) }));
}

/**
 * Decide o .gtkw save-file que o GTKWave vai abrir. Duas sources, em
 * ordem de prioridade:
 *
 *   1. User-curated .gtkw (`gtkwFiles[].isActive === true`, marcado
 *      pelo dropdown do gtkw picker na toolbar). Cross-check contra
 *      o VCD pra avisar de paths stale. Retorna o path do usuario
 *      intocado.
 *   2. Auto-gerado pelo `buildAuroraGtkw`: secao "Top-level" com tudo
 *      que nao pertence a processador + uma secao SAPHO completa
 *      (cores/aliases/grupos) por processador detectado. Filtrado por
 *      `_validatedWaveSelection` (cache do Wave Config picker) quando
 *      ha selecao.
 *
 * Se ambas falharem (VCD invalido, etc.), retorna null e GTKWave abre
 * sem save-file.
 *
 * Inputs:  simTopModule, vcdFile, simDir
 * Returns: path absoluto pro .gtkw, ou null
 * Throws:  nunca (validation hiccups viram warnings)
 * Side-effects: pode escrever ${simDir}/${simTopModule}.gtkw;
 *               loga em twave.
 *
 * Ver ARCHITECTURE.md §9 pro racional de precedencia.
 */
async _waveResolveGtkwSaveFile(simTopModule, vcdFile, tempBaseDir) {
    // Source 1: user-curated .gtkw, entrada com `isActive: true` na
    // lista per-testbench do WaveStore. Cada testbench tem sua propria
    // lista (gtkwFiles isolados por tb), entao a resolucao aqui depende
    // do `testbenchFile` corrente.
    const tbKey = (this.projectConfig.testbenchFile || '')
        .split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    if (tbKey) {
        const state = await WaveStore.get(this.projectPath, tbKey);
        const files = state?.gtkwFiles;
        if (Array.isArray(files) && files.length > 0) {
            const gtkwFile = files.find((f) => f && f.isActive === true);
            if (gtkwFile) {
                const userGtkw = gtkwFile.path;
                this.terminalManager.appendToTerminal('twave',
                    tr('terminal.wave.usingGtkwFile', { name: userGtkw.split(/[\\/]/).pop() }), 'info');
                await this._waveValidateUserGtkwAgainstVcd(userGtkw, vcdFile);
                return userGtkw;
            }
        }
    }

    // Source 2: auto-gerado. buildAuroraGtkw cobre o caso geral:
    // top-level flat + secoes por processador SAPHO detectado.
    const autoGtkw = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.gtkw`);
    // Preferencia: a selecao ja validada (escrita por _validateWaveSelection
    // durante o passo de instrumentacao). Senao, le do WaveStore, caso
    // onde o auto-gtkw e chamado sem o pipeline de instrumentacao
    // (defensivo; o flow normal sempre seta _validatedWaveSelection).
    let selected;
    if (Array.isArray(this._validatedWaveSelection)) {
        selected = this._validatedWaveSelection;
    } else if (tbKey) {
        const tbState = await WaveStore.get(this.projectPath, tbKey);
        selected = Array.isArray(tbState?.waveSignals) ? tbState.waveSignals : [];
    } else {
        selected = [];
    }
    // For the auto-gtkw we need to PARSE scopes from a text VCD.
    // vvp -fst (pass 2) overwrites the $dumpfile target with FST
    // binary even when the path ends in .vcd, so the pass-1 header
    // is stashed to a `.header.vcd` sibling by _waveRunVvpSimulation.
    // Prefer that header file when it exists.
    let parseSource = vcdFile;
    const headerSibling = vcdFile.replace(/\.(fst|vcd)$/i, '.header.vcd');
    if (await electronAPI.fileExists(headerSibling)) {
        parseSource = headerSibling;
    } else if (vcdFile.toLowerCase().endsWith('.fst')) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.autoGtkwError', { message: 'no parseable header (.header.vcd missing); GTKWave opens .fst without auto-gtkw' }),
            'tips');
        return null;
    }
    try {
        const vcdContent = await electronAPI.readFile(parseSource, { encoding: 'utf8' });
        const scopes = parseVcdHeaderFromContent(vcdContent);
        const binDir = await electronAPI.joinPath(this.componentsPath, 'bin');

        // Last-line-of-defense pra picker selection: avisa o usuario
        // sobre sinais selecionados que nao chegaram no VCD (testbench
        // dumpou subset, signal renomeado entre compile e wave, etc).
        // Aurora ainda escreve o .gtkw, gtkwave so mostra os que tem.
        if (selected.length > 0) {
            const inVcd = new Set();
            for (const sc of scopes) {
                for (const sig of sc.signals) inVcd.add(`${sc.path}.${sig.name}`);
            }
            const dropped = selected.filter((s) => !inVcd.has(s));
            if (dropped.length > 0) {
                // Sob Verilator os sinais internos de monitoramento do
                // processador (stack/ULA, dentro do `.core`) ficam fenced fora
                // do trace, entao sinais selecionados que vivem ali nao chegam
                // no VCD. Isso e ESPERADO (limitacao conhecida do Verilator,
                // nao um erro): em vez de listar cada sinal omitido, mostra uma
                // info amigavel por processador afetado. Os demais dropped
                // (renomeados, dump parcial, ...) seguem com o aviso generico.
                const procs = getSimulator() === 'verilator' ? detectProcessors(scopes) : [];
                const affectedProcs = new Map(); // nome do proc -> true (preserva ordem)
                const others = [];
                for (const s of dropped) {
                    const proc = /\.core\./.test(s)
                        && procs.find((p) => s.startsWith(`${p.instancePath}.`));
                    if (proc) {
                        affectedProcs.set(proc.procType || proc.instanceName, true);
                    } else {
                        others.push(s);
                    }
                }
                for (const procName of affectedProcs.keys()) {
                    this.terminalManager.appendToTerminal('twave',
                        tr('terminal.wave.verilatorNoProcSignals', { proc: procName }), 'tips');
                }
                if (others.length > 0) {
                    const preview = others.slice(0, 5).map((s) => `"${s}"`).join(', ');
                    const more = others.length > 5 ? ` (+${others.length - 5} more)` : '';
                    const msg = others.length === 1
                        ? tr('terminal.wave.staleVcdSignalOne', { preview })
                        : tr('terminal.wave.staleVcdSignalMany', { count: others.length, preview, more });
                    this.terminalManager.appendToTerminal('twave', msg, 'warning');
                }
            }
        }

        // Parseia o source verilog (synthesizableFiles + testbenchFiles)
        // pra extrair declaracoes (signed → format dos barramentos;
        // instances → resolve scope.path → moduleType pra ter o
        // procType correto = nome da pasta Temp/<procType>/ onde
        // cmmcomp escreveu trad files). Best-effort: falha vira null
        // (cai nas heuristicas baseadas em nome de scope).
        const modules = await this._parseProjectSources();

        const result = buildAuroraGtkw({
            vcdPath: vcdFile,
            gtkwPath: autoGtkw,
            scopes,
            tbModule: simTopModule,
            tempBaseDir,
            binDir,
            selectedSignals: selected.length > 0 ? selected : null,
            modules,
        });
        if (!result.content) return null;

        await electronAPI.writeFile(autoGtkw, result.content);
        const procPart = result.processorCount > 0
            ? `${result.processorCount} processor${result.processorCount === 1 ? '' : 's'}`
            : 'flat layout';
        const selPart = selected.length > 0
            ? `, ${selected.length} signal${selected.length === 1 ? '' : 's'} from picker`
            : '';
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.autoGtkwLayout', { detail: `${procPart}${selPart}` }), 'info');
        return autoGtkw;
    } catch (err) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.autoGtkwError', { message: err.message }), 'warning');
        return null;
    }
}

/**
 * Delega pra parseProjectSources (wave_signal_validator.js): le/parseia os
 * .v do projeto (+ HDL SAPHO) e devolve o `modules` map (ou null). Usado
 * pelos geradores de auto-gtkw/auto-surfer.
 */
async _parseProjectSources() {
    return parseProjectSources(this._instanceDeps());
}

/**
 * Cross-check a user-curated .gtkw against the VCD: every dotted path
 * the layout references must exist in the parsed scopes, otherwise
 * GTKWave shows an empty trace with no warning. Best-effort:
 * parse hiccups produce a single twave warning but don't block.
 *
 * Inputs:  gtkwPath (absolute), vcdPath (absolute)
 * Returns: void
 * Throws:  never
 * Side-effects: logs to twave (per-signal note when stale references found)
 */
async _waveValidateUserGtkwAgainstVcd(gtkwPath, vcdPath) {
    // Two-pass dump stashes the parseable header in `.header.vcd`
    // (because vvp -fst overwrites the original .vcd with FST binary).
    // Prefer that for the cross-check; skip silently if it isn't
    // available, GTKWave shows empty traces for stale signals,
    // same behaviour as before the hook existed.
    let parseSource = vcdPath;
    if (vcdPath) {
        const headerSibling = vcdPath.replace(/\.(fst|vcd)$/i, '.header.vcd');
        if (await electronAPI.fileExists(headerSibling)) {
            parseSource = headerSibling;
        } else if (vcdPath.toLowerCase().endsWith('.fst')) {
            return;
        }
    }
    try {
        const gtkwContent = await electronAPI.readFile(gtkwPath, { encoding: 'utf8' });
        const referenced = extractSignalRefs(gtkwContent);
        if (referenced.length === 0) return;
        const vcdContent = await electronAPI.readFile(parseSource, { encoding: 'utf8' });
        const scopes = parseVcdHeaderFromContent(vcdContent);
        const inVcd = new Set();
        for (const scope of scopes) {
            for (const sig of scope.signals) {
                inVcd.add(`${scope.path}.${sig.name}`);
            }
        }
        const missing = referenced.filter((s) => !inVcd.has(s));
        if (missing.length === 0) return;
        const preview = missing.slice(0, 5).map((s) => `"${s}"`).join(', ');
        const more = missing.length > 5 ? ` (+${missing.length - 5} more)` : '';
        const fileName = gtkwPath.split(/[\\/]/).pop();
        const msg = missing.length === 1
            ? tr('terminal.wave.gtkwStaleVcdOne', { preview, file: fileName })
            : tr('terminal.wave.gtkwStaleVcdMany', { count: missing.length, file: fileName, preview, more });
        this.terminalManager.appendToTerminal('twave', msg, 'warning');
    } catch (refErr) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.gtkwPreValidateFailed', { file: gtkwPath.split(/[\\/]/).pop(), message: refErr.message }),
            'warning');
    }
}

/**
 * Build the GTKWave command line and launch the process.
 *
 * gtkwave-nipscern fork (components/Packages/gtkwave-nipscern/):
 *   - `--dark`, Aurora's dark theme parity (signal panel + GTK chrome).
 *   - `--zoom-fit`, initial zoom-fit.
 *   - `--left-justify`, alinha nomes de sinais a esquerda.
 *   - `-a <gtkw>`, save-file (so quando aplicavel). SST ja vem removido
 *     da fork, entao --rcvar 'hide_sst on' nao e mais necessario.
 *
 * Inputs:  vcdFile (absolute), gtkwSaveFile (absolute or null), tools
 * Returns: void
 * Throws:  if launchGtkwaveOnly reports failure
 * Side-effects: spawns gtkwave.exe, stores PID on this.gtkwaveProcess,
 *               starts the lifecycle monitor.
 */
async _waveLaunchGtkwave(vcdFile, gtkwSaveFile, tools) {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.launching'), 'info');

    // gtkwave usa spawn detached (monitorado via launch-gtkwave-only)
    // em vez do executor padrao. Mesmo assim, passamos pelo runSpec-
    // -equivalente pra que overrides da AI funcionem: aplicamos override
    // a um base spec e renderizamos a linha de comando, o IPC velho
    // espera string. Override no spec de gtkwave fica em ../command_overrides.
    const baseSpec = buildGtkwaveSpec({
        gtkwaveBin: tools.gtkwaveBin,
        vcdFile,
        gtkwSaveFile: gtkwSaveFile || undefined,
        cwd: tools.tempBaseDir,
    });
    const resolved = await applyResolved(baseSpec, { consumeEphemeral: true });
    const finalSpec = resolved.appliedSpec;
    // Pass the resolved spec's binary + tokenized args straight through.
    // Rendering to a string and re-parsing dropped the quotes around a
    // space-free gtkwave path, so the old IPC rejected it as "Invalid
    // GTKWave command format". The args array is already exactly what
    // spawn needs (e.g. '--script=PATH' stays one token).
    const gtkwaveResult = await electronAPI.launchGtkwaveOnly({
        gtkwaveBin: finalSpec.binary,
        args: finalSpec.args,
        workingDir: tools.tempBaseDir,
    });
    if (!gtkwaveResult.success) {
        throw new Error(tr('error.compilation.gtkwaveFailed', { message: gtkwaveResult.message }));
    }
    this.gtkwaveProcess = gtkwaveResult.gtkwavePid;
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.launched'), 'success');
    this.monitorGtkwaveProcess();
}

/**
 * Launch the Surfer viewer (opt-in alternative to GTKWave).
 *
 * Surfer (https://surfer-project.org/) is a Rust/egui waveform viewer that
 * reads the same VCD/FST. Aurora treats it as an optional standalone
 * surfer-aurora.exe under components/Packages/surfer/ (the NIPS-CERN fork
 * build, gitlab.com/nips-cern/surfer-aurora). It opens as an external
 * window on the VCD, loading the active Surfer layout when one is set: a
 * .surf.ron saved state (via -s) or a .sucl command file (via -c). If the
 * binary is absent (the default, it isn't bundled yet) the launch reports a
 * clean not-found and we degrade to GTKWave, so the Wave button always
 * produces a viewer. The spawned process is tracked, torn down with the IDE.
 * (Auto-generating a curated .sucl from the picker selection is a follow-up;
 * the curated layout today is a user/AI-supplied .surf.ron/.sucl.)
 *
 * Inputs:  vcdFile (absolute), surferLayoutFile (.surf.ron/.sucl or null), tools
 * Returns: void
 * Side-effects: spawns surfer-aurora.exe (stored on this.surferProcess), or calls
 *               _waveLaunchGtkwave as a fallback.
 */
async _waveLaunchSurfer(vcdFile, surferLayoutFile, tools) {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.surferLaunching'), 'info');

    // Preferencia "Surfer em aba" (default): a onda abre dentro do editor, via
    // servidor headless + cliente WASM (main/ipc/surfer_tab.js). Se qualquer
    // ponta faltar (bundle web nao instalado, servidor nao sobe), cai para a
    // janela nativa logo abaixo, que e o caminho de sempre — o botao Wave
    // nunca fica sem resposta.
    if (getSurferInTab()) {
        const opened = await this._waveOpenSurferTab(vcdFile, surferLayoutFile, tools);
        if (opened) return;
    }
    // Load the active layout after the positional VCD: .surf.ron (saved
    // state) via -s, .sucl (command file) via -c. The CLI VCD takes
    // precedence over any path embedded in a state file, so a registered
    // .surf.ron stays portable across re-runs (items re-bind by name).
    const args = [vcdFile];
    if (surferLayoutFile) {
        const flag = /\.sucl$/i.test(surferLayoutFile) ? '-c' : '-s';
        args.push(flag, surferLayoutFile);
    }
    const result = await electronAPI.launchSurfer({
        surferBin: tools.surferBin,
        args,
        workingDir: tools.tempBaseDir,
        // Preferencia do usuario (modal Wave Config): true = manter varias janelas
        // abertas (comparar simulacoes); false (default) = uma janela so (o main
        // fecha a anterior antes de abrir a nova).
        multiWindow: getSurferMultiWindow(),
    });
    if (!result.success) {
        this.terminalManager.appendToTerminal(
            'twave',
            `Surfer unavailable (${result.message}) — opening GTKWave instead. ` +
            'Drop surfer-aurora.exe in components/Packages/surfer/ to use Surfer.',
            'tips',
        );
        await this._waveLaunchGtkwave(vcdFile, null, tools);
        return;
    }
    this.surferProcess = result.surferPid;
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.surferLaunched'), 'success');
}

/**
 * Open the wave as an editor tab (Surfer WASM client + local headless server).
 *
 * Returns true when the tab is up; false means "use the native window path",
 * with the reason already printed to the terminal. Layouts ride in whole:
 * a .sucl command file via startup_commands, and a .surf.ron saved state via
 * load_state_from_url — the command our fork added to the WASM client for
 * exactly this, so the curated layout (sections, colors, formats, analog)
 * loads in the tab the same as in the native window.
 *
 * Inputs: vcdFile (absolute), surferLayoutFile (.surf.ron/.sucl or null), tools
 * Returns: Promise<boolean>
 */
async _waveOpenSurferTab(vcdFile, surferLayoutFile, tools) {
    const available = await electronAPI.surferTabAvailable?.();
    if (!available) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.surferTabNoBundle'), 'tips');
        return false;
    }

    const isSucl = surferLayoutFile && /.sucl$/i.test(surferLayoutFile);

    // Um id estavel por onda: recompilar reusa a aba e o main troca o servidor.
    const tabId = 'wave:' + vcdFile;

    // Onde o "salvar" de dentro da aba grava: um arquivo fixo por testbench em
    // testbench/, o mesmo diretório do estado do Wave Config. Salvar de novo
    // sobrescreve, que é o que se espera de um salvar.
    const tbKey = (this.projectConfig.testbenchFile || '')
        .split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    let stateSavePath = null;
    if (tbKey && this.projectPath) {
        const stateName = `${tbKey}.tab.surf.ron`;
        stateSavePath = await electronAPI.joinPath(this.projectPath, 'testbench', stateName);
        surferTabSaveCtx.set(tabId, { projectPath: this.projectPath, tbKey, name: stateName });
    }

    const result = await electronAPI.surferTabServe({
        surferBin: tools.surferBin,
        waveFile: vcdFile,
        tabId,
        suclFile: isSucl ? surferLayoutFile : null,
        stateFile: !isSucl ? surferLayoutFile : null,
        mappings: this._surferTabMappings || [],
        stateSavePath,
    });
    if (!result?.success) {
        this.terminalManager.appendToTerminal('twave',
            `Surfer tab unavailable (${result?.message || 'unknown'}) — opening the window instead.`,
            'tips');
        return false;
    }

    TabManager.openSurferWave(vcdFile, result.pageUrl, tabId);
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.surferTabOpened'), 'success');
    return true;
}

/**
 * Resolve which Surfer layout file the Surfer viewer should load.
 *   Source 1 (user-curated): the surferFiles[] entry marked isActive in the
 *     WaveStore (a .surf.ron saved state or a .sucl command file).
 *   Source 2 (auto): when no user file is active, auto-generate a curated
 *     .surf.ron via buildSurferLayout, the declarative mirror of the .gtkw,
 *     reusing the SAME picker selection + processor detection as GTKWave
 *     (sections, colors, formats, analog, aliases). The Assembly/source-line
 *     value→text decode (trad_*.txt mapping translators) + complex decode are
 *     a tracked follow-up; those signals show raw values for now.
 * Returns null only when neither yields a layout → Surfer opens the raw VCD.
 *
 * Inputs: simTopModule, vcdFile, tempBaseDir.  Returns: path | null.  Throws: never.
 */
async _waveResolveSurferSaveFile(simTopModule, vcdFile, tempBaseDir) {
    const tbKey = (this.projectConfig.testbenchFile || '')
        .split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');

    // Layout do usuario nao passa pela geracao, entao nao ha mappings novos; o
    // fluxo da aba le este campo e nao pode herdar os da simulacao anterior.
    this._surferTabMappings = [];

    // Source 1: user-curated .surf.ron/.sucl (active entry).
    if (tbKey) {
        const state = await WaveStore.get(this.projectPath, tbKey);
        const files = state?.surferFiles;
        if (Array.isArray(files) && files.length > 0) {
            const active = files.find((f) => f && f.isActive === true);
            if (active && active.path) {
                this.terminalManager.appendToTerminal('twave',
                    `Surfer layout: ${active.path.split(/[\\/]/).pop()}`, 'info');
                return active.path;
            }
        }
    }

    // Source 2: auto-generated curated .surf.ron (declarative mirror of the
    // auto-.gtkw, same selection + processor sections/colors/formats/analog).
    const autoSurfer = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.surf.ron`);
    let selected;
    if (Array.isArray(this._validatedWaveSelection)) {
        selected = this._validatedWaveSelection;
    } else if (tbKey) {
        const tbState = await WaveStore.get(this.projectPath, tbKey);
        selected = Array.isArray(tbState?.waveSignals) ? tbState.waveSignals : [];
    } else {
        selected = [];
    }
    // Parse scopes from the text header (.header.vcd sibling preferred; the
    // FST binary isn't text-parseable). Same guard as the auto-.gtkw path.
    let parseSource = vcdFile;
    const headerSibling = vcdFile.replace(/\.(fst|vcd)$/i, '.header.vcd');
    if (await electronAPI.fileExists(headerSibling)) {
        parseSource = headerSibling;
    } else if (vcdFile.toLowerCase().endsWith('.fst')) {
        return null; // no parseable header → Surfer opens the raw VCD
    }
    try {
        const vcdContent = await electronAPI.readFile(parseSource, { encoding: 'utf8' });
        const scopes = parseVcdHeaderFromContent(vcdContent);
        const modules = await this._parseProjectSources();

        // Read the YANC trad files (Assembly opcode + source-line decode) per
        // processor type so buildSurferLayout can wire them as Surfer "mapping
        // translators". Same Temp/<procType>/ layout the GTKWave path resolves;
        // a missing file just leaves that track in raw decimal (never fatal).
        const scopeModules = modules ? resolveScopeModules(scopes, modules) : null;
        const tradByProcType = {};
        let newestTradMtime = 0; // p/ check de staleness (trad mais novo que o dump)
        for (const p of detectProcessors(scopes, scopeModules)) {
            if (!p || !p.procType || tradByProcType[p.procType]) continue;
            const procDir = await electronAPI.joinPath(tempBaseDir, p.procType);
            const opPath = await electronAPI.joinPath(procDir, 'trad_opcode.txt');
            const cmPath = await electronAPI.joinPath(procDir, 'trad_cmm.txt');
            const opExists = await electronAPI.fileExists(opPath);
            const cmExists = await electronAPI.fileExists(cmPath);
            tradByProcType[p.procType] = {
                opcode: opExists ? await electronAPI.readFile(opPath) : null,
                cmm: cmExists ? await electronAPI.readFile(cmPath) : null,
            };
            for (const present of [opExists ? opPath : null, cmExists ? cmPath : null]) {
                if (!present) continue;
                try { const st = await electronAPI.getFileStats(present); if (st && st.mtime > newestTradMtime) newestTradMtime = st.mtime; } catch { /* sem stat -> ignora */ }
            }
        }

        // Anti-staleness: se os tradutores sao MAIS NOVOS que o dump, o usuario
        // recompilou o .cmm sem re-simular -> o decode casaria o dump VELHO com a
        // tabela NOVA = lixo crivel (pior que decimal cru). Margem de 2s cobre a
        // ordem normal compile->simulate (trad fica levemente mais velho que o FST).
        if (newestTradMtime > 0) {
            try {
                const fstStat = await electronAPI.getFileStats(vcdFile);
                if (fstStat && newestTradMtime > fstStat.mtime + 2000) {
                    this.terminalManager.appendToTerminal('twave',
                        'Surfer: os tradutores Assembly/C+- sao mais novos que o dump — recompilou sem re-simular? O decode pode estar desatualizado; re-simule para alinhar.', 'tips');
                }
            } catch { /* sem stat do FST -> pula o check */ }
        }

        // Tag curto e estavel do projeto (FNV-1a do projectPath) pra NAMESPACING
        // dos mappings no dir GLOBAL flat do Surfer (%APPDATA%/.../mappings): dois
        // projetos abertos com o mesmo tb top nao se sobrescrevem mais.
        const nsTag = (() => {
            const s = String(this.projectPath || '');
            let h = 0x811c9dc5;
            for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
            return (h >>> 0).toString(16).padStart(8, '0');
        })();

        // Complex numbers (comp_me3_/comp_arr_me3_): Surfer has no external
        // process filter like GTKWave's, so pre-decode the distinct complex
        // values from the dump via comp2gtkw.exe and bake a mapping. Gated:
        // projects without complex signals pay nothing (no fst2vcd full stream).
        const complexMapping = hasComplexSignals(scopes)
            ? await this._buildSurferComplexMapping(vcdFile, simTopModule, tempBaseDir, nsTag)
            : null;

        const { content, processorCount, mappings } = buildSurferLayout({
            vcdPath: vcdFile,
            scopes,
            tbModule: simTopModule,
            selectedSignals: selected.length > 0 ? selected : null,
            modules,
            tradByProcType,
            mappingNamespace: `${nsTag}_${simTopModule}`,
            complexMapping,
        });
        if (!content) return null;
        // O fluxo da aba (WASM) nao le o config/mappings do disco: os decode
        // maps vao por HTTP local via load_mapping_translator_from_url (comando
        // nosso no fork). Guardados aqui porque este metodo so devolve o path.
        this._surferTabMappings = Array.isArray(mappings) ? mappings : [];
        await electronAPI.writeFile(autoSurfer, content);
        // Surfer scans its global config/mappings dir at startup; write the
        // decode maps now (before launch) so valr2/linetabs render decoded.
        if (Array.isArray(mappings) && mappings.length > 0) {
            const wr = await electronAPI.writeSurferMappings(mappings);
            // Visibilidade: se algum mapping nao foi escrito (permissao/IO), avisa:
            // esses tracks abrem em decimal cru em vez de falhar mudo.
            if (wr && Array.isArray(wr.failed) && wr.failed.length > 0) {
                this.terminalManager.appendToTerminal('twave',
                    `Surfer: ${wr.failed.length} mapping translator(s) nao escritos — esses tracks abrem em decimal cru.`, 'tips');
            }
        }
        const procPart = processorCount > 0
            ? `${processorCount} processor${processorCount === 1 ? '' : 's'}`
            : 'flat layout';
        const selPart = selected.length > 0
            ? `, ${selected.length} signal${selected.length === 1 ? '' : 's'} from picker`
            : '';
        const decodePart = (Array.isArray(mappings) && mappings.length > 0)
            ? `, ${mappings.length} decode map${mappings.length === 1 ? '' : 's'}`
            : '';
        this.terminalManager.appendToTerminal('twave',
            `Surfer layout auto-generated (${procPart}${selPart}${decodePart}).`, 'info');
        return autoSurfer;
    } catch (err) {
        this.terminalManager.appendToTerminal('twave',
            `Surfer auto-layout failed (${err.message}) — opening raw VCD.`, 'tips');
        return null;
    }
}

/**
 * Pre-pass de decode dos numeros complexos pro Surfer (comp_me3_/comp_arr_me3_).
 * O Surfer nao tem o process-filter externo do GTKWave, entao: stream do
 * fst2vcd sobre o FST → coleta os valores DISTINTOS dos sinais complexos →
 * decode canonico via comp2gtkw.exe → mapping translator compartilhado
 * (bitpattern → "re imi"). Best-effort: qualquer falha retorna null e os
 * complexos abrem em Binary cru. So e' chamado quando ha complexos no header
 * (gate em _waveResolveSurferSaveFile), entao projetos sem complexo nao pagam o
 * stream do corpo do FST.
 */
async _buildSurferComplexMapping(fstPath, simTopModule, tempBaseDir, nsTag = '') {
    try {
        if (typeof electronAPI.onExecSpecStream !== 'function') return null;
        const fst2vcdBin = await electronAPI.joinPath(
            this.componentsPath, 'Packages', 'gtkwave-nipscern', 'fst2vcd.exe');
        const comp2gtkwExe = await electronAPI.joinPath(this.componentsPath, 'bin', 'comp2gtkw.exe');
        // Pre-check: sem o decoder (comp2gtkw) ou o streamer (fst2vcd) nao adianta
        // varrer o FST inteiro, avisa UMA vez no terminal e cai pro fallback
        // (complexos em Binary cru) em vez de degradar SILENCIOSAMENTE. Esse era o
        // gap: o usuario abria o Surfer, via binario cru e nao sabia o porque.
        if (!await electronAPI.fileExists(comp2gtkwExe)) {
            this.terminalManager.appendToTerminal('twave',
                'Surfer: comp2gtkw.exe nao encontrado em components/bin/ — numeros complexos abrem em Binary cru.', 'tips');
            return null;
        }
        if (!await electronAPI.fileExists(fst2vcdBin)) {
            this.terminalManager.appendToTerminal('twave',
                'Surfer: fst2vcd.exe nao encontrado — decode de complexos pulado (Binary cru).', 'tips');
            return null;
        }
        const scanner = new ComplexVcdScanner();
        let killed = false;
        const unsubscribe = electronAPI.onExecSpecStream((payload) => {
            if (!payload || payload.type !== 'stdout' || !payload.data) return;
            scanner.feed(payload.data);
            // Cap atingido → para o fst2vcd cedo (kill ALVO do filho parqueado,
            // nao o sweep por-nome que mataria o viewer deste mesmo fluxo).
            if (!killed && scanner.wasCapped() && typeof electronAPI.killCurrentSpecProcess === 'function') {
                killed = true;
                electronAPI.killCurrentSpecProcess();
            }
        });
        try {
            await runSpecStreamed({
                step: 'fst2vcd',
                binary: fst2vcdBin,
                args: ['-f', fstPath],
                cwd: tempBaseDir,
                label: 'fst2vcd (complex decode — valores distintos)',
            }, { consumeEphemeral: true });
        } catch { /* best-effort — pode ter coletado antes do throw */ }
        finally { unsubscribe(); }
        scanner.end();

        const values = scanner.distinctValues();
        if (values.length === 0) return null;
        const res = await electronAPI.decodeComplex({ exePath: comp2gtkwExe, values });
        if (!res || !res.success || !Array.isArray(res.decoded)) return null;
        const decodedByValue = new Map();
        const n = Math.min(values.length, res.decoded.length);
        for (let i = 0; i < n; i++) decodedByValue.set(values[i], res.decoded[i]);
        const name = `aurora_cpx_${nsTag}_${simTopModule}`.replace(/[^A-Za-z0-9_]/g, '_');
        const mapping = buildComplexMapping(name, decodedByValue);
        if (mapping) {
            this.terminalManager.appendToTerminal('twave',
                `Surfer complex decode: ${decodedByValue.size} valor${decodedByValue.size === 1 ? '' : 'es'}${scanner.wasCapped() ? ' (limitado)' : ''}.`, 'info');
        }
        return mapping;
    } catch (err) {
        this.terminalManager.appendToTerminal('twave',
            `Surfer complex decode skipped (${err.message}) — complexos em Binary.`, 'tips');
        return null;
    }
}




    // (Removed the dead pre-PRISM hierarchy view, switchToStandardView,
    // generateHierarchyWithYosys, cleanModuleName, switchToHierarchicalView,
    // updateToggleButton, getModuleNumber. Zero callers (confirmed by an
    // adversarial pass); the live hierarchy is generateProjectHierarchy() +
    // FileTreeViewController, and cleanModuleName lives in main/ipc/prism.js.)


}

export { CompilationModule };
