// processor_compiler.ts: SAPHO processor compile steps (C±/.cmm → .asm → .v).
//
// Extracted from compilation_module.js (A2 god-file decomposition #5, the last
// one). These drive the per-processor toolchain: cmmcomp (.cmm → .asm), then
// appcomp + asmcomp (.asm → <proc>.v + pc_*_mem.txt + <base>_tb.v), plus the
// helpers that resolve which .cmm/testbench to use and stage processor memory
// files into Temp/.
//
// They are NOT pure, they run external .exe via runSpec, save editor buffers,
// drive the status bar, and stream to the terminal. Rather than capture instance
// state, each takes a `deps` bag { projectPath, componentsPath, projectConfig,
// terminalManager } (CompilationModule._instanceDeps()). CompilationModule keeps
// thin delegators for the public API (cmmCompilation / asmCompilation are called
// by compilation_flow.js) and for _stageProcessorMemoryFiles.
//
// ONE instance-field seam stays OWNED by CompilationModule:
//   - lastCompiledCmmPath: read by the terminal's "line N" click handler
//     (terminal_module.js) via the instance. cmmCompilation writes it BEFORE the
//     compile runs (so a click after a FAILED compile still resolves to the .cmm
//     that failed). To preserve that exact timing, the caller passes a
//     `setLastCompiledCmmPath` callback and cmmCompilation invokes it at the same
//     point, the field is written inside the class, not here.
//
// The Verilator button used to need a #TOAQUI in the .cmm (so the <proc>.v
// would grow a `cheguei` pin) and inserted one into the user's source. It no
// longer does: the harness reads the program counter and stops at @fim
// (verilator_tb.ts), so nothing here touches the source or the opcode set.
//
// Kept on `electronAPI` (live global) rather than the ../app/electron_api
// re-export so the module stays unit-testable with the repo's
// `globalThis.window = { electronAPI: fake }` pattern, migrating these globals
// belongs to A3, not this extraction.

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { statusUpdater } from '../ui/status_updater.js';
import { runSpec } from './spec_runner.js';
import { foiCancelada } from './cancelamento.js';
import {
    buildCmmSpec, buildAsmPreSpec, buildAsmSpec,
    buildCppPpSpec, buildCppSpec,
} from './builders/index.js';
import * as CommandSpec from './command_spec.js';
import { moduleStemFromPath } from './compilation_helpers.js';
import { analisarVerilog, totaisDoVerilog } from './verilog_stats.js';
import { projectTempDir } from '../project/project_temp.js';
import {
    resolveProcessorSource,
    stripSourceExtension,
    type EntradaDeProcessador,
} from './processor_source.js';

/**
 * O terminal, visto daqui: so os metodos que estes passos chamam. E estrutural
 * de proposito, o terminalManager real (terminal_module.js) tem muito mais
 * superficie e nao e tipado.
 */
export interface TerminalManager {
    clearTerminal(id: string): Promise<void> | void;
    appendToTerminal(id: string, texto: string, tipo?: string, opcoes?: { internal?: boolean }): void;
    processExecutableOutput(id: string, resultado: unknown): void;
}

/** A sacola que CompilationModule._instanceDeps() monta. */
export interface CompileDeps {
    projectPath: string;
    componentsPath: string;
    terminalManager: TerminalManager;
    projectConfig?: { processors?: unknown[] } | null;
}

/** Entrada do .spf mais o que o fluxo injeta por cima antes de compilar. */
export interface ProcessorEntry extends EntradaDeProcessador {
    clk?: number | string;
    numClocks?: number | string;
    showArrays?: boolean;
    testbenchFile?: string | null;
}

/**
 * O erro que sobe daqui depois de ja ter sido escrito no terminal. A bandeira
 * evita que quem o pegou o imprima de novo; ver compilation_flow.js.
 */
type ErroDeCompilacao = Error & { jaNoTerminal?: boolean };

/** Normaliza o `unknown` do catch sem mudar o que corre em execucao. */
function comoErro(e: unknown): ErroDeCompilacao {
    return (e instanceof Error ? e : new Error(String(e))) as ErroDeCompilacao;
}

// i18n shim, falls back to the key path if i18n didn't boot yet.
const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

// O usuario ja mandou parar? Depois de um Cancelar, o .exe morto reporta a
// morte como falha propria ("code 1") e o catch carimbava isso em vermelho no
// terminal. Nao e defeito do programa, e o kill. A bandeira e a do
// cancelamento.ts; ver o gemeo em compilation_module.js.
const canceladoPeloUsuario = foiCancelada;

/**
 * O nome do fonte que este processador compila, como o fluxo o declarou.
 *
 * Continua exigindo que alguem tenha declarado: quem chama monta a entrada
 * com o arquivo dentro (compilation_flow.js), e um processador que chega aqui
 * sem fonte nenhum e erro de configuracao, nao um caso a adivinhar. O que
 * mudou e de onde a resposta vem: processor_source.ts, que tambem entende o
 * campo novo `sourceFile` e deriva a linguagem. Para uma entrada com
 * `cmmFile`, que e tudo o que existe hoje, a string e a mesma de antes.
 */
export async function getSelectedSourceFile(processor: ProcessorEntry): Promise<string> {
    if (!processor.sourceFile && !processor.cmmFile) {
        throw new Error(tr('error.config.noCmm'));
    }
    return resolveProcessorSource(processor).sourceFile;
}

/**
 * Resolve qual testbench o asmCompilation vai copiar pra
 * <proj>/<proc>/Simulation/. Duas formas:
 *
 *   - processor.testbenchFile e um path absoluto → usa direto
 *     (testbench custom, salvo no .spf).
 *   - caso contrario → convencao "<cmmBase>_tb.v" dentro de
 *     <proj>/<proc>/Simulation/ (testbench auto-gerado pelo
 *     asmcomp).
 *
 */
export async function getTestbenchInfo(
    deps: Pick<CompileDeps, 'projectPath'>,
    processor: ProcessorEntry,
    cmmBaseName: string,
): Promise<{ tbModule: string, tbFile: string }> {
    let tbModule: string, tbFile: string;
    const testbenchFilePath = processor.testbenchFile;

    if (testbenchFilePath && testbenchFilePath !== 'standard') {
        tbFile = testbenchFilePath;
        const tbFileName = testbenchFilePath.split(/[\\\\/]/).pop() ?? '';
        tbModule = moduleStemFromPath(tbFileName);
    } else {
        tbModule = `${cmmBaseName}_tb`;
        const simulationPath = await electronAPI.joinPath(deps.projectPath, processor.name, 'Simulation');
        tbFile = await electronAPI.joinPath(simulationPath, `${tbModule}.v`);
    }

    return {
        tbModule,
        tbFile
    };
}

/**
 * Compila o .cmm do processador via cmmcomp.exe → <proj>/<proc>/Software/<base>.asm.
 *
 * @param setLastCompiledCmmPath  cacheia o .cmm corrente na instancia (lido pelo terminal)
 * @returns asmPath
 */
export async function cmmCompilation(
    deps: CompileDeps,
    processor: ProcessorEntry,
    setLastCompiledCmmPath: (caminho: string) => void,
): Promise<string> {
    const { name, showArrays } = processor;
    await deps.terminalManager.clearTerminal('tcmm');

    deps.terminalManager.appendToTerminal('tcmm', tr('terminal.cmm.starting', { name }));

    try {
        const selectedCmmFile = await getSelectedSourceFile(processor);
        const cmmBaseName = stripSourceExtension(selectedCmmFile);

        // 1. Caminhos
        const macrosPath = await electronAPI.joinPath(deps.componentsPath, 'Macros');

        // A pasta temporaria do processador: <projeto>/.aurora/Temp/{name}
        // (ver project_temp.js: por projeto, para duas janelas nao se pisarem).
        const tempPath = await electronAPI.joinPath(await projectTempDir(deps.projectPath), name);

        // Cria a pasta se nao existir; o { recursive: true } do backend cria
        // .aurora, Temp e {name} de uma vez.
        await electronAPI.createDirectory(tempPath);

        const cmmCompPath = await electronAPI.joinPath(deps.componentsPath, 'bin', 'cmmcomp.exe');
        const projectPath = await electronAPI.joinPath(deps.projectPath, name);
        const softwarePath = await electronAPI.joinPath(deps.projectPath, name, 'Software');
        const asmPath = await electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);

        await TabManager.saveAllFiles();

        statusUpdater.startCompilation('cmm');

        // yanc v4 usa named options (CMMComp/Sources/args.c):
        //   -i input  -n name  -p proc-dir  -m macros-dir  -t temp-dir  [-A]
        // -pt / -en vem do toggle de locale (UI + compiler unified) e vai
        // PRIMEIRO: parse_lang_flag() consome essa flag e a remove de argv
        // antes do cli_parse() ler o resto. Explicito pra que a UI mande,
        // ignorando qualquer env var preexistente do shell.
        //
        // -A / --array liga o showArrays do .spf (campo per-processador):
        // dump de arrays no waveform. Era -P no yanc v3.
        const lang = (window.getYancLang?.() ?? 'pt') as 'pt' | 'en';
        const cmmSpec = buildCmmSpec({
            cmmCompPath,
            inputFile: selectedCmmFile,
            baseName: cmmBaseName,
            projectPath,
            macrosPath,
            tempPath,
            processorName: name,
            lang,
            showArrays: !!showArrays,
        });

        // Track which .cmm this run is compiling so the terminal's
        // "line N" click handler can resolve the file even when verbose
        // is off (the cmmcomp.exe echo is hidden in that mode, so DOM
        // scraping would find nothing).
        setLastCompiledCmmPath(await electronAPI.joinPath(softwarePath, selectedCmmFile));

        // internal:true marca como 'plain', entao o filtro de
        // verbose esconde a linha de comando quando verbose=off.
        // Continua util pra debug verbose mas nao polui o
        // terminal padrao.
        deps.terminalManager.appendToTerminal('tcmm', tr('terminal.common.executing', { cmd: CommandSpec.formatSpec(cmmSpec) }), 'info', { internal: true });

        const result = await runSpec(cmmSpec, { consumeEphemeral: true });
        deps.terminalManager.processExecutableOutput('tcmm', result);

        if (result.code !== 0) {
            statusUpdater.compilationError('cmm', `CMM compilation failed with code ${result.code}`);
            throw new Error(tr('error.compilation.cmmFailed', { code: result.code }));
        }
        statusUpdater.compilationSuccess('cmm');
        return asmPath;
    } catch (e) {
        const error = comoErro(e);
        if (!canceladoPeloUsuario()) {
            deps.terminalManager.appendToTerminal('tcmm', tr('terminal.common.error', { message: error.message }), 'error');
            error.jaNoTerminal = true;
        }
        statusUpdater.compilationError('cmm', error.message);
        throw error;
    }
}

/**
 * Compila o .cpp do processador via cpppp.exe + cppcomp.exe ->
 * <proj>/<proc>/Software/<base>.asm. Irmao do cmmCompilation: mesmo terminal,
 * mesmo .asm de saida, mesmo contrato de erro. Do asmCompilation em diante o
 * pipeline nao sabe qual das duas linguagens passou por aqui.
 *
 * Dois passos em vez de um. O cpppp resolve #include/#define e escreve um
 * pp.cpp na Temp; o cppcomp compila ESSE pp.cpp. E por isso que as linhas que
 * o cppcomp reporta sao as do arquivo expandido, e nao as do fonte da pessoa,
 * e e por isso que o terminal avisa quando o fonte tem #include: sem o aviso,
 * um "line 812" num arquivo de 40 linhas nao faz sentido nenhum.
 *
 * @param setLastCompiledCmmPath  cacheia o fonte corrente na instancia (lido pelo terminal)
 * @returns asmPath
 */
export async function cppCompilation(
    deps: CompileDeps,
    processor: ProcessorEntry,
    setLastCompiledCmmPath: (caminho: string) => void,
): Promise<string> {
    const { name } = processor;
    await deps.terminalManager.clearTerminal('tcmm');

    deps.terminalManager.appendToTerminal('tcmm', tr('terminal.cpp.starting', { name }));

    try {
        const sourceFile = await getSelectedSourceFile(processor);
        const baseName = stripSourceExtension(sourceFile);

        // 1. Caminhos
        const tempPath = await electronAPI.joinPath(await projectTempDir(deps.projectPath), name);
        await electronAPI.createDirectory(tempPath);

        const cppPpPath = await electronAPI.joinPath(deps.componentsPath, 'bin', 'cpppp.exe');
        const cppCompPath = await electronAPI.joinPath(deps.componentsPath, 'bin', 'cppcomp.exe');
        // Header/ e o lado C++ do yanc (array, cmath, cstdint, vector...),
        // irmao do Macros/ que o cmmcomp e o asmcomp usam.
        const headerPath = await electronAPI.joinPath(deps.componentsPath, 'Header');
        const projectPath = await electronAPI.joinPath(deps.projectPath, name);
        const softwarePath = await electronAPI.joinPath(projectPath, 'Software');
        const sourcePath = await electronAPI.joinPath(softwarePath, sourceFile);
        const asmPath = await electronAPI.joinPath(softwarePath, `${baseName}.asm`);

        await TabManager.saveAllFiles();

        statusUpdater.startCompilation('cpp');

        // O mesmo seam do cmmCompilation, e ANTES de rodar: um clique no
        // terminal depois de uma compilacao que FALHOU tem que resolver para
        // o fonte que falhou. Aponta para o .cpp da pessoa, nao para o
        // pp.cpp: o pp.cpp ja vem no texto dos erros do cppcomp, e o que
        // falta ao terminal e justamente o arquivo de origem.
        setLastCompiledCmmPath(sourcePath);

        // O cppcomp nao tem parse_lang_flag: as mensagens do lado C++ saem so
        // em ingles. Dizer isso uma vez e melhor do que deixar a pessoa achar
        // que o toggle de idioma quebrou.
        deps.terminalManager.appendToTerminal('tcmm', tr('terminal.cpp.englishOnly'), 'tips');

        // 2. cpppp, o pre-processador
        deps.terminalManager.appendToTerminal('tcmm', tr('terminal.cpp.preprocessing'), 'info');
        const ppSpec = buildCppPpSpec({
            cppPpPath,
            inputFile: sourcePath,
            tempPath,
            headerPath,
            softwarePath,
            processorName: name,
        });
        deps.terminalManager.appendToTerminal('tcmm', tr('terminal.common.executing', { cmd: CommandSpec.formatSpec(ppSpec) }), 'info', { internal: true });
        const ppResult = await runSpec(ppSpec, { consumeEphemeral: true });
        deps.terminalManager.processExecutableOutput('tcmm', ppResult);

        if (ppResult.code !== 0) {
            statusUpdater.compilationError('cpp', `C++ preprocessing failed with code ${ppResult.code}`);
            throw new Error(tr('error.compilation.cppPpFailed', { code: ppResult.code }));
        }

        // Aviso de numeracao de linha, depois do cpppp ter corrido: se o
        // fonte tem #include, o que o cppcomp vai numerar e o expandido.
        // Leitura de cortesia, falhando nao atrapalha a compilacao.
        try {
            const fonte = await electronAPI.readFile(sourcePath, { encoding: 'utf8' });
            if (/^[ \t]*#\s*include\b/m.test(fonte)) {
                deps.terminalManager.appendToTerminal('tcmm', tr('terminal.cpp.includeWarning', { name: sourceFile }), 'warning');
            }
        } catch (_e) { /* o aviso e cortesia; a compilacao segue */ }

        // 3. cppcomp, que compila o pp.cpp no mesmo .asm do cmmcomp
        const cppSpec = buildCppSpec({
            cppCompPath,
            tempPath,
            projectPath,
            baseName,
            processorName: name,
        });
        deps.terminalManager.appendToTerminal('tcmm', tr('terminal.common.executing', { cmd: CommandSpec.formatSpec(cppSpec) }), 'info', { internal: true });
        const result = await runSpec(cppSpec, { consumeEphemeral: true });
        deps.terminalManager.processExecutableOutput('tcmm', result);

        if (result.code !== 0) {
            statusUpdater.compilationError('cpp', `C++ compilation failed with code ${result.code}`);
            throw new Error(tr('error.compilation.cppFailed', { code: result.code }));
        }
        statusUpdater.compilationSuccess('cpp');
        return asmPath;
    } catch (e) {
        const error = comoErro(e);
        if (!canceladoPeloUsuario()) {
            deps.terminalManager.appendToTerminal('tcmm', tr('terminal.common.error', { message: error.message }), 'error');
            error.jaNoTerminal = true;
        }
        statusUpdater.compilationError('cpp', error.message);
        throw error;
    }
}

/**
 * Compila o .asm via appcomp.exe (preprocess) + asmcomp.exe → <proc>.v +
 * pc_*_mem.txt; copia o testbench auto-gerado pra <proc>/Simulation/ quando
 * o processador usa o testbench "standard".
 *
 */
export async function asmCompilation(
    deps: CompileDeps,
    processor: ProcessorEntry,
    preamble: string | null = null,
): Promise<void> {
    const {
        name,
        clk,
        numClocks
    } = processor;
    await deps.terminalManager.clearTerminal('tasm');

    // Mensagem opcional logada APOS o clear, usada pelo handler
    // do botao ASM pra avisar quando o C+- foi recompilado por
    // falta de cmm_log.txt. Antes do clear ela era apagada antes
    // do usuario ver.
    if (preamble) {
        deps.terminalManager.appendToTerminal('tasm', preamble, 'tips');
    }

    deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.starting', { name }));

    try {
        const projectPath = await electronAPI.joinPath(deps.projectPath, name);
        const tempPath = await electronAPI.joinPath(await projectTempDir(deps.projectPath), name);
        const appCompPath = await electronAPI.joinPath(deps.componentsPath, 'bin', 'appcomp.exe');
        const asmCompPath = await electronAPI.joinPath(deps.componentsPath, 'bin', 'asmcomp.exe');
        const hdlPath = await electronAPI.joinPath(deps.componentsPath, 'HDL');
        const selectedCmmFile = await getSelectedSourceFile(processor);
        const cmmBaseName = stripSourceExtension(selectedCmmFile);
        const softwarePath = await electronAPI.joinPath(deps.projectPath, name, 'Software');
        const asmPath = await electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);
        const macrosPath = await electronAPI.joinPath(deps.componentsPath, 'Macros');

        const {
            tbFile
        } = await getTestbenchInfo(deps, processor, cmmBaseName);

        statusUpdater.startCompilation('asm');
        await TabManager.saveAllFiles();

        // -pt / -en vem do toggle de locale. Vai PRIMEIRO: parse_lang_flag()
        // consome a flag antes do cli_parse() ler as named options. Aplicado
        // igual em appcomp e asmcomp pra que stdout/stderr dos dois passos
        // saiam na mesma lingua.
        const lang = (window.getYancLang?.() ?? 'pt') as 'pt' | 'en';

        // appcomp: named options -i input  -t temp-dir (APP/Sources/args.c).
        const asmPreSpec = buildAsmPreSpec({
            appCompPath,
            asmFile: asmPath,
            tempPath,
            processorName: name,
            lang,
        });
        deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.executingPrep', { cmd: CommandSpec.formatSpec(asmPreSpec) }), 'info', { internal: true });
        const appResult = await runSpec(asmPreSpec, { consumeEphemeral: true });
        deps.terminalManager.processExecutableOutput('tasm', appResult);

        if (appResult.code !== 0) {
            statusUpdater.compilationError('asm', `ASM Preprocessor failed with code ${appResult.code}`);
            throw new Error(tr('error.compilation.asmPrepFailed', { code: appResult.code }));
        }

        // asmcomp v4: named options -i -p -d -m -t -f -c (ASM/Sources/args.c).
        // -f/-c TEM que ser inteiros, o yanc rejeita valor nao-numerico
        // e sai com usage. O -P (project mode = sem $finish no _tb.v) foi
        // removido no v4: o $finish agora e sempre emitido; multi-proc
        // workflows ignoram o _tb.v individual e usam um top-level proprio.
        const freq = Number.parseInt(String(clk), 10) || 0;
        const clocks = Number.parseInt(String(numClocks), 10) || 0;
        const asmSpec = buildAsmSpec({
            asmCompPath,
            asmFile: asmPath,
            projectPath,
            hdlPath,
            macrosPath,
            tempPath,
            freq,
            clocks,
            processorName: name,
            lang,
        });
        deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.executingComp', { cmd: CommandSpec.formatSpec(asmSpec) }), 'info', { internal: true });

        const asmResult = await runSpec(asmSpec, { consumeEphemeral: true });

        deps.terminalManager.processExecutableOutput('tasm', asmResult);


        if (asmResult.code !== 0) {
            statusUpdater.compilationError('asm', `ASM compilation failed with code ${asmResult.code}`);
            throw new Error(tr('error.compilation.asmFailed', { code: asmResult.code }));
        }

        // Copia o testbench auto-gerado (asmcomp escreve em tempPath)
        // pra <proc>/Simulation/<base>_tb.v sempre que o processador
        // usa o testbench "standard", i.e., nao tem um testbench
        // customizado configurado. O testbench auto-gerado e
        // per-processador (Simulation/<base>_tb.v), distinto do
        // testbench-top que o .spf aponta, entao nao
        // conflita com nada.
        const usesStandardTestbench =
            !processor.testbenchFile || processor.testbenchFile === 'standard';
        if (usesStandardTestbench) {
            const tbFileName = tbFile.split(/[\\\\/]/)
                .pop() ?? '';
            const sourceTestbench = await electronAPI.joinPath(tempPath, tbFileName);
            const destinationTestbench = tbFile;

            // Path-cheio so em verbose; o resumo "Testbench
            // atualizado" (tips) e o que aparece sem verbose.
            deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.copyingTb', { src: sourceTestbench, dst: destinationTestbench }), 'info', { internal: true });
            await electronAPI.copyFile(sourceTestbench, destinationTestbench);
            deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.tbUpdated'), 'tips');
        }

        // O que o asmcomp acabou de gerar, lido do proprio arquivo: modulos,
        // portas e instancias do <proc>.v. E o resumo que o terminal mostra
        // do hardware gerado; sem ele a compilacao terminava sem dizer o que
        // tinha produzido. Leitura de cortesia: falhando, a compilacao ja
        // deu certo e segue.
        try {
            const hardwareVerilog = await electronAPI.joinPath(projectPath, 'Hardware', `${name}.v`);
            const fonte = await electronAPI.readFile(hardwareVerilog, { encoding: 'utf8' });
            const analise = analisarVerilog(fonte);
            const t = totaisDoVerilog(analise);
            const instancias = analise.modules
                .flatMap((m: { instances: Array<{ module: string, name: string }> }) =>
                    m.instances.map((i) => `${i.module} ${i.name}`))
                .join(', ');
            deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.verilogStats', {
                file: `${name}.v`,
                modules: t.modules,
                ports: t.ports,
                inputs: t.inputs,
                outputs: t.outputs,
                instances: t.instances,
                instanceList: instancias || '-',
            }), 'tips');
        } catch (_e) { /* o resumo e cortesia; o .v foi gerado do mesmo jeito */ }

        statusUpdater.compilationSuccess('asm');
    } catch (e) {
        const error = comoErro(e);
        if (!canceladoPeloUsuario()) {
            deps.terminalManager.appendToTerminal('tasm', tr('terminal.common.error', { message: error.message }), 'error');
            error.jaNoTerminal = true;
        }
        statusUpdater.compilationError('asm', error.message);
        throw error;
    }
}

/**
 * Copia os pc_*_mem.txt (gerados por cmmcomp em Temp/<proc>/) pra destDir:
 * o CWD da simulacao, onde o $readmemb do <proc>.v procura. O fluxo Wave
 * passa a pasta do projeto (regra uniforme: simulacao roda na pasta do
 * .spf); o cocotb usa o default (raiz de tempBaseDir) e re-copia pro
 * buildDir dele. No-op (silencioso) em projeto sem processador; warning
 * claro quando ha processador mas nenhum pc_*_mem.txt foi achado.
 *
 */
export async function stageProcessorMemoryFiles(
    deps: Pick<CompileDeps, 'projectConfig' | 'terminalManager'>,
    tempBaseDir: string,
    destDir: string = tempBaseDir,
): Promise<void> {
    // Projeto sem processador no .spf nunca gera pc_*_mem.txt, o
    // $readmemb que consome esses arquivos so existe dentro do .v do
    // processador SAPHO. Pular o staging inteiro (incluindo o warning
    // "no pc_*_mem.txt found") nesse caso: procurar arquivos de memoria
    // de processador num design que nao tem processador so confunde.
    const procs = Array.isArray(deps.projectConfig?.processors)
        ? deps.projectConfig.processors.filter(
            (p) => p && (typeof p === 'string' ? p.trim() : (p as { name?: string }).name))
        : [];
    if (procs.length === 0) return;

    let entries: unknown;
    try {
        entries = await electronAPI.getFolderFiles(tempBaseDir);
    } catch (_e) {
        deps.terminalManager.appendToTerminal(
            'twave',
            tr('terminal.wave.couldNotList', { path: tempBaseDir }),
            'warning',
        );
        return;
    }
    if (!Array.isArray(entries)) return;

    let staged = 0;
    const failedSubdirs: string[] = [];
    for (const entry of entries as Array<{ isDirectory?: boolean, path: string }>) {
        if (!entry?.isDirectory) continue;
        const subDir = entry.path;
        let subFiles: unknown;
        try {
            subFiles = await electronAPI.listFilesInDirectory(subDir);
        } catch (_e) {
            failedSubdirs.push(subDir);
            continue;
        }
        if (!Array.isArray(subFiles)) continue;
        for (const fileName of subFiles) {
            if (typeof fileName !== 'string') continue;
            if (!fileName.startsWith('pc_') || !fileName.endsWith('_mem.txt')) continue;
            const src = await electronAPI.joinPath(subDir, fileName);
            const dst = await electronAPI.joinPath(destDir, fileName);
            try {
                await electronAPI.copyFile(src, dst);
                staged++;
            } catch (_e) {
                deps.terminalManager.appendToTerminal(
                    'twave',
                    tr('terminal.wave.copyMemFailed', { name: fileName, path: subDir }),
                    'warning',
                );
            }
        }
    }

    if (staged === 0) {
        // Sem nenhum pc_*_mem.txt → o $readmemb do .v do processador
        // vai falhar logo a seguir. Avisar claramente em vez de deixar
        // o erro do vvp ser a unica pista. O caminho de sucesso e
        // silencioso por design: copiar arquivos de mem entre pastas
        // e plumbing interno, nao algo que o usuario precisa saber.
        deps.terminalManager.appendToTerminal(
            'twave',
            tr('terminal.wave.noMemFiles', { path: tempBaseDir }),
            'warning',
        );
    }
}
