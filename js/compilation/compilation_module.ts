/**
 * compilation_module.ts: toolchain orchestrator (renderer side).
 *
 * Expoe a classe CompilationModule, que e o "backend" dos botoes
 * disparados em compilation_flow.ts. A instancia guarda o estado de uma
 * compilacao (a configuracao lida, o terminal, a selecao de sinais validada)
 * e cada passo mora num modulo proprio que a recebe como contexto:
 *
 *   loadConfig()            le o .spf em this.projectConfig
 *   ensureDirectories(name) cria a Temp do projeto e Temp/<name>
 *   cmmCompilation(proc)    processor_compiler.ts
 *   asmCompilation(proc, ...)
 *   verilogSyntaxCheck()    checagem_de_sintaxe.ts, e a hierarquia pelo
 *                           Yosys (hierarquia_do_projeto.ts)
 *   runGtkWave()            o botao Wave: o simulador (icarus_da_onda.ts,
 *                           verilator_da_onda.ts, cocotb_da_onda.ts), o dump
 *                           (arquivos_da_simulacao.ts, cabecalho_do_dump.ts),
 *                           o layout (layout_do_gtkwave.ts,
 *                           layout_do_surfer.ts) e o visualizador
 *                           (abrir_onda.ts). Ver §9 de ARCHITECTURE.md.
 *   runFastSim()            verilator_da_onda.ts
 *   verilatorProcessorRun() teste_de_hardware.ts
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
 *      .v dos processadores. -y components/SAPHO e sempre adicionado
 *      pra resolver a biblioteca SAPHO (processor.v, ula.v,
 *      myFIFO.v, etc) sem o usuario precisar listar.
 *
 *   4. runGtkWave so ordena as fases; o comportamento de cada uma mora
 *      no modulo dela. Ver ARCHITECTURE.md §9 pro racional.
 */
import { electronAPI } from '../app/electron_api.js';
import { comAjuda } from '../ui/help_link.js';
import { TabManager } from '../tabs/tab_manager.js';
import { TerminalManager } from '../terminal/terminal_module.js';
import { SpfStore, type SpfStructure } from '../project/spf_store.js';
import { ProjectStore } from '../project/project_store.js';
import { projectTempDir } from '../project/project_temp.js';
import { getSimulator } from '../wave/simulator_preference.js';
import { getViewer } from '../wave/viewer_preference.js';
import { statusUpdater } from '../ui/status_updater.js';
import { foiCancelada } from './cancelamento.js';
import { gerarHierarquiaDoProjeto } from './hierarquia_do_projeto.js';
import {
    lancarGtkwave, lancarSurfer, abrirOndaExterna as abrirOndaExternaNoVisualizador,
    type FerramentasDaOnda, type OpcoesDoSurfer,
} from './abrir_onda.js';
import { resolverLayoutDoSurfer } from './layout_do_surfer.js';
import { resolverLayoutDoGtkwave } from './layout_do_gtkwave.js';
import { rodarTesteDeHardware } from './teste_de_hardware.js';
import { checarVerilog, checarParaAWaveConfig } from './checagem_de_sintaxe.js';
import { construirNoVerilator, simularNoVerilator, rodarFastSim } from './verilator_da_onda.js';
import { validarCocotb, anunciarCocotb, rodarCocotb } from './cocotb_da_onda.js';
import { construirEConferirVvp, simularNoIcarus } from './icarus_da_onda.js';
import { acharDumpDaSimulacao, exigirDumpNovo } from './arquivos_da_simulacao.js';
import { extrairCabecalhoDoFst } from './cabecalho_do_dump.js';
import { renderHierarchy, refreshHierarchyFocusHighlight } from './hierarchy_view.js';
import type { NoDaHierarquia } from './hierarchy_parser.js';
import type { SinalDoMonitor } from '../wave/prism_wave_layout.js';
import type { EntradaDeProcessador } from './processor_source.js';
import { resolveWaveToolchain, resolveVerilatorTools } from './wave_toolchain.js';
import { validateWaveSelection } from './wave_signal_validator.js';
import {
  cmmCompilation, cppCompilation, asmCompilation,
} from './processor_compiler.js';
import {
  moduleStemFromPath, isPythonFile, escolherTestbench,
} from './compilation_helpers.js';

// i18n shim, falls back to the key path if i18n didn't boot yet.
const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** A forma que os validadores devolvem: os caminhos, sem o resto do .spf. */
export interface FormaDaConfiguracao {
    topLevelFile: string | null;
    testbenchFile: string | null;
    synthesizableFiles: string[];
}

type ArquivoDoSpf = { path: string; name?: string; isTopLevel?: boolean };

/**
 * O usuario ja mandou parar?
 *
 * Depois de um Cancelar, a ferramenta que morreu ainda reporta a morte como
 * falha propria ("Verilator failed with exit code 1"), e cada catch daqui
 * carimbava isso no terminal em vermelho. Nao e um defeito do design: e o
 * kill. Quem pediu para parar recebia um cartao de erro dizendo que o
 * Verilator falhou, e ficava sem saber se quebrou alguma coisa.
 *
 * A bandeira e a do cancelamento.ts, a mesma que a barra de progresso consulta
 * para se calar: e o rastro do que ja estava em voo quando o kill chegou. Zera
 * no inicio da proxima compilacao.
 */
const canceladoPeloUsuario = foiCancelada;

class CompilationModule {
    projectPath: string;
    /** O .spf lido por loadConfig; null ate la, ou quando ele nao se le. */
    projectConfig: SpfStructure | null = null;
    terminalManager: TerminalManager;
    /** A arvore de modulos da ultima checagem (o renderHierarchicalTree le daqui). */
    hierarchyData: NoDaHierarquia | null = null;
    componentsPath: string | null = null;
    _componentsPathPronto: Promise<string> | null = null;
    /** O fonte que o ultimo front end compilou; o clique em "linha N" do terminal abre ele. */
    lastCompiledCmmPath: string | null = null;
    /** A selecao de sinais que o Wave usou; os layouts automaticos leem daqui. */
    _validatedWaveSelection?: string[] | null;
    /** Os tradutores que o layout do Surfer gerou, para a aba levar. */
    _surferTabMappings?: Array<{ name: string; content: string }>;
    /** O aviso de testbench sem fim sai uma vez por compilacao. */
    _avisouSemFinish?: boolean;

    constructor(projectPath: string | null) {
        // Sem projeto so fora do fluxo normal (a onda avulsa pela API); os
        // passos que precisam dele caem na Temp dos componentes.
        this.projectPath = projectPath as string;
        // Reuse the single global TerminalManager. CompilationModule is
        // reconstructed on every compile, and a fresh TerminalManager per
        // instance fragmented the shared terminal state (messageCounts,
        // currentSessionCards, updatableCards) across instances even though
        // they all drive the SAME terminal DOM. Per-compile reset is explicit
        // via clearTerminal(), so one long-lived owner is both correct and
        // leak-free. initializeGlobalTerminalManager() is a lazy singleton;
        // fall back to a local instance only outside the renderer.
        this.terminalManager = (typeof window !== 'undefined' && window.initializeGlobalTerminalManager)
            ? window.initializeGlobalTerminalManager() as unknown as TerminalManager
            : new TerminalManager();
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
    async initializeComponentsPath(): Promise<string> {
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
async generateProjectHierarchy(): Promise<boolean> {
    return gerarHierarquiaDoProjeto(this._instanceDeps(), (arvore) => {
        this.hierarchyData = arvore;
        window.fileTreeViewController?.setHierarchyData?.(arvore);
    });
}

    // Thin delegator, the DOM render lives in hierarchy_view.js (A2 #2). Kept
    // as a method because file_tree_view_controller.js calls it on the instance.
    renderHierarchicalTree(): void {
        renderHierarchy(this.hierarchyData);
    }

async loadConfig(): Promise<void> {
    try {
        // O projeto e o DESTA janela, lido do ProjectStore, que e o que a
        // interface mostra. O main so entra como reserva quando o store ainda
        // esta vazio (arranque com a restauracao de sessao em voo). Perguntar
        // ao main primeiro foi o que fez uma janela compilar com o testbench
        // da outra: a resposta dele e por janela, mas com reserva no ultimo
        // projeto aberto em qualquer lugar, e nessa reserva o `.spf` alheio
        // chegava aqui sem erro nenhum.
        let spfPath: string | null | undefined = ProjectStore.getSpfPath();
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

    async ensureDirectories(name: string): Promise<string> {
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

    async cmmCompilation(processor: EntradaDeProcessador): Promise<string> {
        return cmmCompilation(
            this._instanceDeps(), processor,
            (p) => { this.lastCompiledCmmPath = p; },
        );
    }

    // O front end C++ (cpppp + cppcomp), irmao do cmmCompilation: mesmo seam
    // do lastCompiledCmmPath, que aponta para o .cpp da pessoa.
    async cppCompilation(processor: EntradaDeProcessador): Promise<string> {
        return cppCompilation(
            this._instanceDeps(), processor,
            (p) => { this.lastCompiledCmmPath = p; },
        );
    }

    async asmCompilation(processor: EntradaDeProcessador, preamble: string | null = null): Promise<void> {
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
_buildConfigShape(): FormaDaConfiguracao | null {
    if (!this.projectConfig) return null;

    const synth = (this.projectConfig.synthesizableFiles || []) as ArquivoDoSpf[];
    const topEntry = this._pickSingleTop(synth, 'synthesizable');

    // A MESMA funcao que decide se o botao de onda acende
    // (compilation_helpers.escolherTestbench). Enquanto eram duas regras, um
    // projeto com o testbench so na forma de lista tinha o botao apagado e a
    // compilacao funcionando.
    const foundTb = escolherTestbench(this.projectConfig as Parameters<typeof escolherTestbench>[0], (marcadas) => {
        const nome = (f: { name?: string; path?: string }) => f.name || f.path?.split(/[\\/]/).pop() || '?';
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
validateForVerilog(): FormaDaConfiguracao {
    if (!this.projectConfig) {
        throw new Error('Project configuration not loaded');
    }
    if (!this.projectConfig.synthesizableFiles || this.projectConfig.synthesizableFiles.length === 0) {
        throw new Error(tr('error.config.noSynth'));
    }
    const shape = this._buildConfigShape() as FormaDaConfiguracao;
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
validateForWave(): FormaDaConfiguracao {
    if (!this.projectConfig) {
        throw new Error('Project configuration not loaded');
    }
    const shape = this._buildConfigShape() as FormaDaConfiguracao;
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
loadConfigUnsafe(): FormaDaConfiguracao {
    if (!this.projectConfig) {
        throw new Error('Project configuration not loaded');
    }
    return this._buildConfigShape() as FormaDaConfiguracao;
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
 * @param category , used in the warning text
 * @returns  The picked file (first match), or undefined
 *      if none has isTopLevel.
 */
_pickSingleTop(files: ArquivoDoSpf[], category: 'synthesizable' | 'testbench'): ArquivoDoSpf | undefined {
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
        // Resolvido: toda entrada publica espera o initializeComponentsPath antes.
        componentsPath: this.componentsPath as string,
    };
}

/**
 * Delega pra validateWaveSelection (wave_signal_validator.js). Mantido como
 * metodo da instancia porque js/wave/wave_config_manager.js chama
 * compiler._validateWaveSelection direto, API publica de fato.
 */
async _validateWaveSelection(
    rawSelected: string[] | null | undefined, filePaths: string[], simTopModule: string, tbKey: string | null = null,
): Promise<string[]> {
    return validateWaveSelection(this._instanceDeps(), rawSelected, filePaths, simTopModule, tbKey);
}

/**
 * A porta da Wave Configuration (checagem_de_sintaxe.ts). O
 * wave_config_manager chama por aqui. Nunca lanca.
 */
async syntaxCheck(): Promise<{ success: boolean; message?: string }> {
    return checarParaAWaveConfig(this);
}

/**
 * O botao Verilog (checagem_de_sintaxe.ts). O compilation_flow chama por aqui.
 */
async verilogSyntaxCheck(): Promise<void> {
    return checarVerilog(this);
}

/**
 * Wave button entrypoint. Orquestra o pipeline completo das fontes ate o
 * visualizador aberto. Cada fase mora no seu modulo; o orquestrador e curto
 * pra deixar a *ordem das fases* como unica coisa que um futuro leitor tem
 * que entender aqui:
 *
 *   resolveWaveToolchain       os binarios e a Temp do projeto
 *   _waveDeriveSimTopModule    o topo da simulacao (o modulo do testbench)
 *   o simulador                cocotb, Verilator ou Icarus, que grava o dump
 *   acharDumpDaSimulacao       o dump na pasta onde a simulacao rodou
 *   exigirDumpNovo             o dump e desta corrida
 *   extrairCabecalhoDoFst      o cabecalho de texto, para o seletor e o layout
 *   o layout e o visualizador  GTKWave ou Surfer
 *
 * If you need to change behaviour, change the phase that owns the
 * concern. The orchestrator only changes when you add / remove a
 * phase or reorder them.
 *
 * See ARCHITECTURE.md §9 for the broader rationale (why the dump is the
 * ground truth, how the dump/gtkw sources interact, etc.).
 */
async runGtkWave(): Promise<void> {
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

        const tools = await resolveWaveToolchain(this.componentsPath as string, this.projectPath);
        let simTopModule = this._waveDeriveSimTopModule(config) as string;
        let vcdFile: string | null = null;
        // Ancora do teste de frescor la embaixo: qualquer dump legitimo desta
        // corrida tem mtime depois deste instante (folga em dumpEstaFresco).
        const inicioDaSimulacao = Date.now();

        if (isPythonFile(config.testbenchFile as string)) {
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
                const vTools = await resolveVerilatorTools(this.componentsPath as string);
                const fullTools = { ...tools, ...vTools };
                const { exePath } = await construirNoVerilator(this, simTopModule, tools.tempBaseDir, config, fullTools);
                simDir = await simularNoVerilator(this, simTopModule, fullTools, exePath);
            } else {
                this.terminalManager.appendToTerminal('twave', tr('terminal.wave.iverilogSimulator'), 'tips');
                // Same as Verilator above: the iverilog build/run doesn't touch
                // the statusUpdater per step, so mark 'verilog' here or the bar
                // stays on 'asm' through the whole Wave.
                statusUpdater.startCompilation('verilog');
                await construirEConferirVvp(this, simTopModule, tools.tempBaseDir);
                simDir = await simularNoIcarus(this, simTopModule, tools);
            }
            // Scan the dir the simulation actually ran in, the dump lands
            // in the cwd (_waveSimCwd: the project folder).
            vcdFile = await acharDumpDaSimulacao(this.terminalManager, simTopModule, simDir);
        }
        // Defesa 2 (dump_guard.js): o dump tem de ser DESTA corrida. Sem
        // isto, um escritor que falhe sem exit code, ou um $dumpfile custom
        // adotado pelo resolver, abre a onda da rodada ANTERIOR como se fosse
        // nova, que foi exatamente o sintoma do laboratorio.
        await exigirDumpNovo(vcdFile as string, inicioDaSimulacao);
        // Unified header capture, ONE extraction for all four wave paths
        // (iverilog, Verilator, cocotb+iverilog, cocotb+Verilator). Replaces the
        // old per-flow two-pass: the non-cocotb flows used to run a throwaway
        // +AURORA_HEADER_ONLY simulation just to flush the VCD header, and the
        // cocotb flow converted the whole FST to text. Now the sim runs exactly
        // once (→ FST) and the header (scopes/signals for the picker + auto-gtkw)
        // is pulled straight from that FST. fst2vcd magic-detects the FST
        // regardless of the file extension; for a genuine text VCD it reports no
        // FST and we skip, the VCD is its own header source, parsed downstream.
        const headerVcd = (vcdFile as string).replace(/\.(fst|vcd)$/i, '.header.vcd');
        await extrairCabecalhoDoFst(this.terminalManager, vcdFile as string, headerVcd, tools.fst2vcdBin, tools.tempBaseDir);
        // Branch on the user's viewer choice. Default 'gtkwave' → the existing
        // path is untouched for current users; 'surfer' opens Surfer with its
        // own active layout (.surf.ron/.sucl), and no .gtkw is generated for it.
        if (getViewer() === 'surfer') {
            const surferLayout = await this._waveResolveSurferSaveFile(simTopModule, vcdFile as string, tools.tempBaseDir);
            await this._waveLaunchSurfer(vcdFile as string, surferLayout, tools);
        } else {
            const gtkwSaveFile = await resolverLayoutDoGtkwave(this, simTopModule, vcdFile as string, tools.tempBaseDir);
            await this._waveLaunchGtkwave(vcdFile as string, gtkwSaveFile, tools);
        }
    } catch (error) {
        const erro = error as Error & { jaNoTerminal?: boolean };
        if (!canceladoPeloUsuario()) {
            this.terminalManager.appendToTerminal('twave', tr('terminal.common.error', { message: erro.message }), 'error');
            erro.jaNoTerminal = true;
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
_waveDeriveSimTopModule(config: Pick<FormaDaConfiguracao, 'testbenchFile' | 'topLevelFile'>): string {
    if (config.testbenchFile) {
        return moduleStemFromPath(config.testbenchFile);
    }
    // Fallback inalcancavel pelo Wave (runGtkWave ja exige testbench),
    // mas o helper fica geral: se um dia for chamado sem tb, exige top.
    if (!config.topLevelFile) return null as unknown as string;
    return moduleStemFromPath(config.topLevelFile);
}

/**
 * O botao Fast Sim (verilator_da_onda.ts). O compilation_flow e a AuroraAPI
 * chamam por aqui.
 */
async runFastSim(): Promise<void> {
    return rodarFastSim(this);
}

/**
 * O botao de teste de hardware: o processador ativo no Verilator, saida no
 * THTEST (teste_de_hardware.ts). O compilation_flow chama por aqui.
 */
async verilatorProcessorRun(): Promise<void> {
    return rodarTesteDeHardware(this);
}

/** Abre o GTKWave (abrir_onda.ts). */
async _waveLaunchGtkwave(vcdFile: string, gtkwSaveFile: string | null, tools: FerramentasDaOnda): Promise<void> {
    return lancarGtkwave(this, vcdFile, gtkwSaveFile, tools);
}

/**
 * Abre o Surfer, na aba ou na janela (abrir_onda.ts). Metodo da instancia
 * porque o wave_ns (openWaveform da API) chama por aqui.
 */
async _waveLaunchSurfer(
    vcdFile: string, surferLayoutFile: string | null, tools: FerramentasDaOnda, opts: OpcoesDoSurfer = {},
): Promise<void> {
    return lancarSurfer(this, vcdFile, surferLayoutFile, tools, opts);
}

/**
 * Abre a onda do PRISM (abrir_onda.ts). Metodo da instancia porque o
 * project_manager chama por aqui.
 */
async abrirOndaExterna(vcdFile: string, rotulo: string, sinais: SinalDoMonitor[] = []): Promise<void> {
    return abrirOndaExternaNoVisualizador(this, vcdFile, rotulo, sinais);
}

/**
 * O layout que o Surfer carrega (layout_do_surfer.ts). Os tradutores gerados
 * ficam na instancia porque a aba do Surfer os leva, e a abertura acontece
 * depois, noutro metodo.
 */
async _waveResolveSurferSaveFile(simTopModule: string, vcdFile: string, tempBaseDir: string): Promise<string | null> {
    const { caminho, mapeamentos } = await resolverLayoutDoSurfer(this, simTopModule, vcdFile, tempBaseDir);
    this._surferTabMappings = mapeamentos;
    return caminho;
}

}

export { CompilationModule };
