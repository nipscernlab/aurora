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
import { comAjuda } from '../ui/help_link.js';
import { TabManager } from '../tabs/tab_manager.js';
import { TerminalManager } from '../terminal/terminal_module.js';
import { nomesDeDumpEsperados } from './dump_guard.js';
import { SpfStore } from '../project/spf_store.js';
import { ProjectStore } from '../project/project_store.js';
import { projectTempDir } from '../project/project_temp.js';
import {
  instrumentTestbenchSource,
} from '../wave/testbench_instrumenter.js';
import { getSimulator } from '../wave/simulator_preference.js';
import { getViewer } from '../wave/viewer_preference.js';
import { extractFopenReads } from '../wave/fopen_paths.js';
import { statusUpdater } from '../ui/status_updater.js';
import { runSpec, runSpecStreamed } from './spec_runner.js';
import { gerarHierarquiaDoProjeto } from './hierarquia_do_projeto.js';
import { lancarGtkwave, lancarSurfer, abrirOndaExterna as abrirOndaExternaNoVisualizador } from './abrir_onda.js';
import { resolverLayoutDoSurfer } from './layout_do_surfer.js';
import { resolverLayoutDoGtkwave } from './layout_do_gtkwave.js';
import { rodarTesteDeHardware } from './teste_de_hardware.js';
import { construirNoVerilator, simularNoVerilator, rodarFastSim } from './verilator_da_onda.js';
import { validarCocotb, anunciarCocotb, rodarCocotb } from './cocotb_da_onda.js';
import { consumirProgresso, avisarSeNaBateria, vigiarTamanhoDoDump } from './durante_a_simulacao.js';
import {
    copiarDadosDoTestbench, acharDumpDaSimulacao, exigirDumpGravavel, exigirDumpNovo,
} from './arquivos_da_simulacao.js';
import { renderHierarchy, refreshHierarchyFocusHighlight } from './hierarchy_view.js';
import { resolveWaveToolchain, resolveVerilatorTools } from './wave_toolchain.js';
import {
  validateWaveSelection, resolveWaveSelection,
} from './wave_signal_validator.js';
import {
  cmmCompilation, cppCompilation, asmCompilation, stageProcessorMemoryFiles,
} from './processor_compiler.js';
import {
  buildIverilogCheckSpec, buildIverilogBuildSpec,
  buildVvpRunSpec,
  buildFst2VcdSpec,
} from './builders/index.js';
import * as CommandSpec from './command_spec.js';
import {
  moduleStemFromPath, isPythonFile, escolherTestbench,
} from './compilation_helpers.js';

// i18n shim, falls back to the key path if i18n didn't boot yet.
const tr = (k, p) => (window.t ? window.t(k, p) : k);

/**
 * O usuario ja mandou parar?
 *
 * Depois de um Cancelar, a ferramenta que morreu ainda reporta a morte como
 * falha propria ("Verilator failed with exit code 1"), e cada catch daqui
 * carimbava isso no terminal em vermelho. Nao e um defeito do design: e o
 * kill. Quem pediu para parar recebia um cartao de erro dizendo que o
 * Verilator falhou, e ficava sem saber se quebrou alguma coisa.
 *
 * Mesma bandeira que o compilation_flow expoe pra barra de progresso se calar
 * (renderHardwareProgress), pelo mesmo motivo: e o rastro do que ja estava em
 * voo quando o kill chegou. Zera no inicio da proxima compilacao.
 */
const canceladoPeloUsuario = () =>
    (typeof window !== 'undefined' && !!window.isCompilationCanceled?.());

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
        this.componentsPath = null;
        this._componentsPathPronto = null;
        // Dispara agora e e esperado nas entradas publicas (ver o metodo).
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
     * Resolve a pasta de componentes, uma vez so, e devolve sempre a mesma
     * promessa.
     *
     * O construtor dispara isto SEM esperar, e por anos ninguem esperou no
     * caminho de quem so tem Verilog: a pre-compilacao dos processadores era
     * o unico ponto que aguardava, e ela desiste antes disso quando a lista
     * de processadores esta vazia. Com `componentsPath` ainda nulo, o
     * primeiro `joinPath` do fluxo estoura com "All arguments to join-path
     * must be strings", que nao diz nada a quem clicou.
     *
     * Guardar a promessa e o que torna barato esperar: quem chama de novo nao
     * dispara outro IPC, so pega a resposta que ja esta a caminho.
     */
    async initializeComponentsPath() {
        if (this.componentsPath) return this.componentsPath;
        if (!this._componentsPathPronto) {
            this._componentsPathPronto = electronAPI.getComponentsPath().then((caminho) => {
                this.componentsPath = caminho;
                return caminho;
            });
        }
        return this._componentsPathPronto;
    }


/**
 * A hierarquia de modulos pelo Yosys, depois da checagem de sintaxe. A geracao
 * mora em hierarquia_do_projeto.ts; aqui fica onde a arvore e guardada (o
 * renderHierarchicalTree le dela) e a entrega ao controlador da arvore.
 */
async generateProjectHierarchy() {
    return gerarHierarquiaDoProjeto(this._instanceDeps(), (arvore) => {
        this.hierarchyData = arvore;
        window.fileTreeViewController?.setHierarchyData?.(arvore);
    });
}

    // Thin delegator, the DOM render lives in hierarchy_view.js (A2 #2). Kept
    // as a method because file_tree_view_controller.js calls it on the instance.
    renderHierarchicalTree() {
        renderHierarchy(this.hierarchyData);
    }

async loadConfig() {
    try {
        // O projeto e o DESTA janela, lido do ProjectStore, que e o que a
        // interface mostra. O main so entra como reserva quando o store ainda
        // esta vazio (arranque com a restauracao de sessao em voo). Perguntar
        // ao main primeiro foi o que fez uma janela compilar com o testbench
        // da outra: a resposta dele e por janela, mas com reserva no ultimo
        // projeto aberto em qualquer lugar, e nessa reserva o `.spf` alheio
        // chegava aqui sem erro nenhum.
        let spfPath = ProjectStore.getSpfPath();
        let currentProjectPath = ProjectStore.getProjectPath() || this.projectPath;
        if (!spfPath) {
            const projectInfo = await electronAPI.getCurrentProject();
            spfPath = projectInfo.spfPath;
            currentProjectPath = projectInfo.projectPath || currentProjectPath;
        }

        if (!currentProjectPath) {
            throw new Error('No current project path available for loading configuration');
        }

        // .spf, fonte canonica unica. projectOriented.json (legado) e
        // processorConfig.json (legado) foram consolidados no .spf.
        // Defaults pra cmm/asm (cmmFile=`${proc}.cmm`, clk=100,
        // numClocks=2000) sao hardcoded em precompileAllProcessors.
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
            // Havia aqui um `mkdir(joinPath('components'))`: o canal join-path
            // resolve 'components' contra o diretorio de instalacao, que e o
            // lugar ANTIGO da toolchain (ela mora em %LOCALAPPDATA%\SAPHO desde
            // que passou a ser baixada; em dev caia em Documents\components). A
            // linha so criava uma pasta vazia fora do lugar a cada compilacao,
            // e o guarda de escrita do main passou a recusa-la. A pasta que
            // importa e a Temp do projeto, logo abaixo (project_temp.js).
            const tempBaseDir = await projectTempDir(this.projectPath);
            await electronAPI.mkdir(tempBaseDir);
            const tempProcessorDir = await electronAPI.joinPath(tempBaseDir, name);
            await electronAPI.mkdir(tempProcessorDir);
            return tempProcessorDir;
        } catch (error) {
            console.error("Failed to ensure directories:", error);
            throw error;
        }
    }

    async cmmCompilation(processor) {
        return cmmCompilation(
            this._instanceDeps(), processor,
            (p) => { this.lastCompiledCmmPath = p; },
        );
    }

    // O front end C++ (cpppp + cppcomp), irmao do cmmCompilation: mesmo seam
    // do lastCompiledCmmPath, que aponta para o .cpp da pessoa.
    async cppCompilation(processor) {
        return cppCompilation(
            this._instanceDeps(), processor,
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

    // A MESMA funcao que decide se o botao de onda acende
    // (compilation_helpers.escolherTestbench). Enquanto eram duas regras, um
    // projeto com o testbench so na forma de lista tinha o botao apagado e a
    // compilacao funcionando.
    const foundTb = escolherTestbench(this.projectConfig, (marcadas) => {
        const nome = (f) => f.name || f.path?.split(/[\\/]/).pop() || '?';
        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.multipleTops', {
            count: marcadas.length,
            category: 'testbench',
            picked: nome(marcadas[0]),
            ignored: marcadas.slice(1).map(nome).join(', '),
        }), 'warning');
    });

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
        throw comAjuda(new Error(tr('error.config.noTopLevel')), 'semTopLevelHelp');
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

/**
 * Avisa, uma vez por simulacao, que o testbench nao manda a simulacao parar.
 *
 * Nao ha timeout em lugar nenhum do caminho de simulacao: o vvp e o binario
 * do Verilator sao spawnados sem limite de tempo, entao um testbench com
 * clock livre e sem $finish roda ate a pessoa apertar Cancelar. Quem esta
 * aprendendo le isso como "a AURORA travou" e mata o processo, e o dump sai
 * truncado ou nem existe.
 *
 * So avisa quando as DUAS coisas valem (ver mayRunForever no instrumentador):
 * ha gerador livre de eventos e nao ha $finish/$stop. Testbench que termina
 * sozinho nao recebe nada, senao o aviso viraria ruido de toda execucao.
 *
 * Vale para o iverilog e para o Verilator: o main gerado pelo Verilator
 * tambem roda o eval-loop ate o $finish.
 */
_avisarSeNaoTermina(testbenchPath, mayRunForever) {
    if (!mayRunForever || this._avisouSemFinish) return;
    this._avisouSemFinish = true;
    const file = String(testbenchPath || '').split(/[\\/]/).pop();
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.noFinish', { file }), 'warning');
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
    this._avisarSeNaoTermina(testbenchPath, result.mayRunForever);
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
    const tempBaseDir = await projectTempDir(this.projectPath);
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
        if (!canceladoPeloUsuario()) {
            this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.bannerFailed'), 'error');
            this.terminalManager.appendToTerminal('tveri', tr('terminal.common.error', { message: error.message }), 'error');
            error.jaNoTerminal = true;
        }
        statusUpdater.compilationError('verilog', error.message);
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
        if (!canceladoPeloUsuario()) {
            this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.bannerFailed'), 'error');
            this.terminalManager.appendToTerminal('tveri', tr('terminal.common.error', { message: error.message }), 'error');
            error.jaNoTerminal = true;
        }
        statusUpdater.compilationError('verilog', error.message);
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
    // A pasta de componentes tem que estar resolvida antes do primeiro
    // joinPath; o construtor a dispara sem esperar.
    await this.initializeComponentsPath();

    // Salva o que esta aberto no editor ANTES de qualquer leitura de disco.
    //
    // O testbench e lido cedo, duas vezes: uma para saber se ele ja tem
    // $dumpvars proprio e outra para instrumentar. O unico saveAllFiles do
    // caminho ficava la adiante, dentro de _runIverilogSpec, entao a copia
    // instrumentada nascia do arquivo COMO ESTAVA NO DISCO, sem a edicao que
    // a pessoa acabara de fazer. Sem o $dumpvars novo nao sai dump, e a
    // corrida morre em "nenhum .fst foi produzido" ou no guarda de dump
    // velho. O clique seguinte funcionava porque o clique anterior tinha,
    // enfim, salvado o arquivo: e o "clico de novo e ele roda" que os alunos
    // relatam.
    //
    // Um projeto com processador SAPHO nao via isso: a pre-compilacao do C±
    // salva tudo antes. Quem so tem Verilog pula essa etapa inteira
    // (compilation_flow.js recusa a lista vazia de processadores) e caia
    // direto no problema.
    await TabManager.saveAllFiles();

        // validateForWave exige testbench (sem ele, vvp nao tem o que
        // simular). Synth e top-level sao opcionais, um tb standalone
        // pode definir DUT inline. Esse validator substituiu o
        // validateConfig({requireTopLevel:false}) + check separado de
        // testbench que vivia aqui.
        const config = this.validateForWave();

        const tools = await resolveWaveToolchain(this.componentsPath, this.projectPath);
        let simTopModule = this._waveDeriveSimTopModule(config);
        let vcdFile = null;
        // Ancora do teste de frescor la embaixo: qualquer dump legitimo desta
        // corrida tem mtime depois deste instante (folga em dumpEstaFresco).
        const inicioDaSimulacao = Date.now();

        if (isPythonFile(config.testbenchFile)) {
            const cocotbCtx = await validarCocotb(config);
            simTopModule = cocotbCtx.hdlTopModule;
            anunciarCocotb(this.terminalManager, config, cocotbCtx);
            vcdFile = await rodarCocotb(this, cocotbCtx, tools, config);
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
                const { exePath } = await construirNoVerilator(this, simTopModule, tools.tempBaseDir, config, fullTools);
                simDir = await simularNoVerilator(this, simTopModule, fullTools, exePath);
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
            vcdFile = await acharDumpDaSimulacao(this.terminalManager, simTopModule, simDir);
        }
        // Defesa 2 (dump_guard.js): o dump tem de ser DESTA corrida. Sem
        // isto, um escritor que falhe sem exit code, ou um $dumpfile custom
        // adotado pelo resolver, abre a onda da rodada ANTERIOR como se fosse
        // nova, que foi exatamente o sintoma do laboratorio.
        await exigirDumpNovo(vcdFile, inicioDaSimulacao);
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
            const gtkwSaveFile = await resolverLayoutDoGtkwave(this, simTopModule, vcdFile, tools.tempBaseDir);
            await this._waveLaunchGtkwave(vcdFile, gtkwSaveFile, tools);
        }
    } catch (error) {
        if (!canceladoPeloUsuario()) {
            this.terminalManager.appendToTerminal('twave', tr('terminal.common.error', { message: error.message }), 'error');
            error.jaNoTerminal = true;
        }
        console.error(error);
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
        await copiarDadosDoTestbench(this.terminalManager, simCwd, config.testbenchFile);
    }

    // Defesa 1 (dump_guard.js): dump da rodada anterior preso ou
    // somente-leitura aborta AGORA, nomeando o arquivo e a correcao, em vez
    // de gastar a simulacao para o vvp morrer com um "Unable to open"
    // perdido no meio da saida.
    await exigirDumpGravavel(simCwd, nomesDeDumpEsperados(simTopModule));

    const vvpFile = await electronAPI.joinPath(tools.tempBaseDir, `${simTopModule}.vvp`);

    // Single full simulation with vvp -fst → ${simTopModule}.vcd (FST binary
    // written under the $dumpfile name). No header-only pass anymore: the VCD
    // header is pulled from this FST by the unified _extractFstHeaderVcd in
    // runGtkWave. This also fixes the old hand-written-$dumpvars edge case,
    // where the +AURORA_HEADER_ONLY plusarg was a no-op and pass 1 ran the FULL
    // simulation twice.
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.runningVvp'), 'info');
    await avisarSeNaBateria(this.terminalManager, 'twave');

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
                if (consumirProgresso(this.terminalManager, 'twave', line, tr('terminal.wave.progress'))) continue;
                this.terminalManager.appendToTerminal('twave', line, 'raw');
            }
        });
    }
    let code;
    const pararVigia = vigiarTamanhoDoDump(this.terminalManager, [
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

/**
 * O botao Fast Sim (verilator_da_onda.ts). O compilation_flow e a AuroraAPI
 * chamam por aqui.
 */
async runFastSim() {
    return rodarFastSim(this);
}

/**
 * O botao de teste de hardware: o processador ativo no Verilator, saida no
 * THTEST (teste_de_hardware.ts). O compilation_flow chama por aqui.
 */
async verilatorProcessorRun() {
    return rodarTesteDeHardware(this);
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

/** Abre o GTKWave (abrir_onda.ts). */
async _waveLaunchGtkwave(vcdFile, gtkwSaveFile, tools) {
    return lancarGtkwave(this, vcdFile, gtkwSaveFile, tools);
}

/**
 * Abre o Surfer, na aba ou na janela (abrir_onda.ts). Metodo da instancia
 * porque o wave_ns (openWaveform da API) chama por aqui.
 */
async _waveLaunchSurfer(vcdFile, surferLayoutFile, tools, opts = {}) {
    return lancarSurfer(this, vcdFile, surferLayoutFile, tools, opts);
}

/**
 * Abre a onda do PRISM (abrir_onda.ts). Metodo da instancia porque o
 * project_manager chama por aqui.
 */
async abrirOndaExterna(vcdFile, rotulo, sinais = []) {
    return abrirOndaExternaNoVisualizador(this, vcdFile, rotulo, sinais);
}

/**
 * O layout que o Surfer carrega (layout_do_surfer.ts). Os tradutores gerados
 * ficam na instancia porque a aba do Surfer os leva, e a abertura acontece
 * depois, noutro metodo.
 */
async _waveResolveSurferSaveFile(simTopModule, vcdFile, tempBaseDir) {
    const { caminho, mapeamentos } = await resolverLayoutDoSurfer(this, simTopModule, vcdFile, tempBaseDir);
    this._surferTabMappings = mapeamentos;
    return caminho;
}

    // (Removed the dead pre-PRISM hierarchy view, switchToStandardView,
    // generateHierarchyWithYosys, cleanModuleName, switchToHierarchicalView,
    // updateToggleButton, getModuleNumber. Zero callers (confirmed by an
    // adversarial pass); the live hierarchy is generateProjectHierarchy() +
    // FileTreeViewController, and cleanModuleName lives in main/ipc/prism.js.)


}

export { CompilationModule };
