// processor_compiler.ts: os passos de compilacao de um processador SAPHO
// (fonte → .asm → .v), pelo driver `yanc` (yanc v7.1).
//
// Extracted from compilation_module.js (A2 god-file decomposition #5, the last
// one). Sao dois passos, cada um no seu terminal: `yanc -S` compila o .cmm ou o
// .cpp no TCMM, e `yanc <proc>.asm` monta no TASM. O yanc acha o cmmcomp, o
// cppcomp e o asmcomp ao lado dele e repassa as mensagens sem mudanca. Tudo o
// que eles geram vai para a pasta de saida <proj>/<proc>/<proc>/
// (pastas_do_processador.ts); o fonte e os dados ficam em <proj>/<proc>/.
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
// Kept on `electronAPI` (live global) rather than the ../app/electron_api
// re-export so the module stays unit-testable with the repo's
// `globalThis.window = { electronAPI: fake }` pattern, migrating these globals
// belongs to A3, not this extraction.

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { statusUpdater } from '../ui/status_updater.js';
import { runSpec } from './spec_runner.js';
import { foiCancelada } from './cancelamento.js';
import { buildCmmSpec, buildAsmSpec, buildCppSpec } from './builders/index.js';
import * as CommandSpec from './command_spec.js';
import { moduleStemFromPath } from './compilation_helpers.js';
import { analisarVerilog, totaisDoVerilog } from './verilog_stats.js';
import {
    arquivosDaSaida, arquivosLidosPeloVerilog, nomesDosProcessadores, segmentosDaSaida, segmentosDoFonte,
} from './pastas_do_processador.js';
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

/** As pastas e o executavel de um passo do yanc para um processador. */
interface CaminhosDoPasso {
    /** components/bin/yanc.exe */
    yancPath: string;
    /** <proj>/<proc>, onde ficam o fonte e os dados */
    sourceDir: string;
    /** <proj>/<proc>/<proc>, onde o yanc escreve tudo o que gera */
    outputDir: string;
    /** <outputDir>/<base>.asm */
    asmPath: string;
}

async function caminhosDoPasso(deps: CompileDeps, name: string, baseName: string): Promise<CaminhosDoPasso> {
    const yancPath = await electronAPI.joinPath(deps.componentsPath, 'bin', 'yanc.exe');
    const sourceDir = await electronAPI.joinPath(deps.projectPath, ...segmentosDoFonte(name));
    const outputDir = await electronAPI.joinPath(deps.projectPath, ...segmentosDaSaida(name));
    const asmPath = await electronAPI.joinPath(outputDir, arquivosDaSaida(baseName).asm);
    return { yancPath, sourceDir, outputDir, asmPath };
}

/** O idioma do toggle da AURORA, que vira o --lang de toda chamada do yanc. */
function idiomaDoYanc(): 'pt' | 'en' {
    return (window.getYancLang?.() ?? 'pt') as 'pt' | 'en';
}

/**
 * Resolve qual testbench o processador usa. Duas formas:
 *
 *   - processor.testbenchFile e um path absoluto → usa direto
 *     (testbench custom, salvo no .spf).
 *   - caso contrario → o "<base>_tb.v" que o yanc gera na pasta de saida
 *     <proj>/<proc>/<proc>/, pronto para rodar dali.
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
        const outputDir = await electronAPI.joinPath(deps.projectPath, ...segmentosDaSaida(processor.name));
        tbFile = await electronAPI.joinPath(outputDir, arquivosDaSaida(cmmBaseName).testbench);
    }

    return {
        tbModule,
        tbFile
    };
}

/**
 * Compila o .cmm do processador com `yanc -S`: <proj>/<proc>/<proc>.cmm →
 * <proj>/<proc>/<proc>/<proc>.asm, mais prog_log.txt, src_lines.txt e
 * pc_<proc>_mem.txt na mesma pasta.
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
        const { yancPath, sourceDir, outputDir, asmPath } = await caminhosDoPasso(deps, name, cmmBaseName);
        const sourcePath = await electronAPI.joinPath(sourceDir, selectedCmmFile);

        await TabManager.saveAllFiles();

        statusUpdater.startCompilation('cmm');

        // O --lang vem do toggle de locale (UI e compilador na mesma lingua),
        // explicito para que a UI mande e nao um YANC_LANG do shell.
        // --wave-arrays liga o showArrays do .spf (campo por processador):
        // cada elemento de vetor como sinal proprio na forma de onda.
        const cmmSpec = buildCmmSpec({
            yancPath,
            sourcePath,
            outputDir,
            sourceDir,
            processorName: name,
            lang: idiomaDoYanc(),
            showArrays: !!showArrays,
        });

        // Track which .cmm this run is compiling so the terminal's
        // "line N" click handler can resolve the file even when verbose
        // is off (the yanc echo is hidden in that mode, so DOM
        // scraping would find nothing).
        setLastCompiledCmmPath(sourcePath);

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
 * Compila o .cpp do processador com `yanc -S`, que chama o cppcomp:
 * <proj>/<proc>/<proc>.cpp → <proj>/<proc>/<proc>/<proc>.asm. Irmao do
 * cmmCompilation: mesmo terminal, mesmo .asm de saida, mesmo contrato de
 * erro. Do asmCompilation em diante o pipeline nao sabe qual das duas
 * linguagens passou por aqui.
 *
 * O cppcomp pre-processa o fonte em memoria, e as mensagens apontam para o
 * arquivo e a linha que a pessoa escreveu, inclusive dentro de um header:
 * `filtro.cpp:12`, `./coefs.hpp:3`, relativos a pasta do fonte, que e o cwd.
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
        const { yancPath, sourceDir, outputDir, asmPath } = await caminhosDoPasso(deps, name, baseName);
        const sourcePath = await electronAPI.joinPath(sourceDir, sourceFile);

        await TabManager.saveAllFiles();

        statusUpdater.startCompilation('cpp');

        // O mesmo seam do cmmCompilation, e ANTES de rodar: um clique no
        // terminal depois de uma compilacao que FALHOU tem que resolver para
        // o fonte que falhou.
        setLastCompiledCmmPath(sourcePath);

        // O cppcomp aceita o --lang como todo o yanc, mas as mensagens dele
        // continuam em ingles. Dizer isso uma vez e melhor do que deixar a
        // pessoa achar que o toggle de idioma quebrou; em ingles nao ha o
        // que avisar.
        const lang = idiomaDoYanc();
        if (lang !== 'en') {
            deps.terminalManager.appendToTerminal('tcmm', tr('terminal.cpp.englishOnly'), 'tips');
        }

        const cppSpec = buildCppSpec({
            yancPath,
            sourcePath,
            outputDir,
            sourceDir,
            processorName: name,
            lang,
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
 * Monta o .asm com `yanc <proc>.asm`, que chama o asmcomp (as duas passadas,
 * a do antigo appcomp inclusive). Tudo sai na pasta do .asm, a de saida:
 * <proc>.v, <proc>_inst.mif, <proc>_data.mif, <proc>_tb.v, app_log.txt e
 * trad_opcode.txt. O <proc>_tb.v ja fica pronto para rodar dali.
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
    // do botao ASM pra avisar quando o fonte foi recompilado por
    // falta do prog_log.txt. Antes do clear ela era apagada antes
    // do usuario ver.
    if (preamble) {
        deps.terminalManager.appendToTerminal('tasm', preamble, 'tips');
    }

    deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.starting', { name }));

    try {
        const selectedCmmFile = await getSelectedSourceFile(processor);
        const cmmBaseName = stripSourceExtension(selectedCmmFile);
        const { yancPath, outputDir, asmPath } = await caminhosDoPasso(deps, name, cmmBaseName);

        statusUpdater.startCompilation('asm');
        await TabManager.saveAllFiles();

        // -f/-c TEM que ser inteiros, o yanc rejeita valor nao-numerico
        // e sai com usage. O $finish e sempre emitido no _tb.v; os
        // projetos com varios processadores ignoram o _tb.v individual e
        // usam um top-level proprio.
        const freq = Number.parseInt(String(clk), 10) || 0;
        const clocks = Number.parseInt(String(numClocks), 10) || 0;
        const asmSpec = buildAsmSpec({
            yancPath,
            asmFile: asmPath,
            outputDir,
            freq,
            clocks,
            processorName: name,
            lang: idiomaDoYanc(),
        });
        deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.executingComp', { cmd: CommandSpec.formatSpec(asmSpec) }), 'info', { internal: true });

        const asmResult = await runSpec(asmSpec, { consumeEphemeral: true });

        deps.terminalManager.processExecutableOutput('tasm', asmResult);


        if (asmResult.code !== 0) {
            statusUpdater.compilationError('asm', `ASM compilation failed with code ${asmResult.code}`);
            throw new Error(tr('error.compilation.asmFailed', { code: asmResult.code }));
        }

        // O que o asmcomp acabou de gerar, lido do proprio arquivo: modulos,
        // portas e instancias do <proc>.v. E o resumo que o terminal mostra
        // do hardware gerado; sem ele a compilacao terminava sem dizer o que
        // tinha produzido. Leitura de cortesia: falhando, a compilacao ja
        // deu certo e segue.
        try {
            const nomeDoV = arquivosDaSaida(cmmBaseName).verilog;
            const hardwareVerilog = await electronAPI.joinPath(outputDir, nomeDoV);
            const fonte = await electronAPI.readFile(hardwareVerilog, { encoding: 'utf8' });
            const analise = analisarVerilog(fonte);
            const t = totaisDoVerilog(analise);
            const instancias = analise.modules
                .flatMap((m: { instances: Array<{ module: string, name: string }> }) =>
                    m.instances.map((i) => `${i.module} ${i.name}`))
                .join(', ');
            deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.verilogStats', {
                file: nomeDoV,
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
 * Copia, de cada processador do projeto, os arquivos que o Verilog gerado le
 * pelo nome puro (<proc>_inst.mif, <proc>_data.mif e pc_<proc>_mem.txt) da
 * pasta de saida dele para `destDir`, o diretorio de uma simulacao que nao
 * roda la: a do projeto, com o top-level e os varios processadores, ou a do
 * build do cocotb. Antes os .mif saiam com caminho absoluto e so os
 * pc_*_mem.txt precisavam da copia; desde o yanc v7.1 os tres precisam.
 *
 * No-op (silencioso) em projeto sem processador; warning claro quando ha
 * processador mas nenhum desses arquivos foi achado.
 *
 */
export async function stageProcessorMemoryFiles(
    deps: Pick<CompileDeps, 'projectConfig' | 'terminalManager'>,
    projectPath: string,
    destDir: string,
): Promise<void> {
    // Projeto sem processador no .spf nao tem memoria de processador
    // nenhuma a copiar. Pular o staging inteiro (incluindo o warning) nesse
    // caso: procurar arquivos de memoria num design que nao tem
    // processador so confunde.
    const nomes = nomesDosProcessadores(deps.projectConfig?.processors);
    if (nomes.length === 0) return;

    const normal = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const mesmaPasta = (a: string, b: string): boolean => normal(a) === normal(b);

    let staged = 0;
    for (const nome of nomes) {
        const outputDir = await electronAPI.joinPath(projectPath, ...segmentosDaSaida(nome));
        // A simulacao do proprio <proc>_tb.v roda na pasta de saida: os
        // arquivos ja estao la, e copiar um arquivo sobre ele mesmo pode
        // trunca-lo no Windows.
        if (mesmaPasta(outputDir, destDir)) {
            staged++;
            continue;
        }
        for (const fileName of arquivosLidosPeloVerilog(nome)) {
            const src = await electronAPI.joinPath(outputDir, fileName);
            if (!await electronAPI.fileExists(src)) continue;
            const dst = await electronAPI.joinPath(destDir, fileName);
            try {
                await electronAPI.copyFile(src, dst);
                staged++;
            } catch (_e) {
                deps.terminalManager.appendToTerminal(
                    'twave',
                    tr('terminal.wave.copyMemFailed', { name: fileName, path: outputDir }),
                    'warning',
                );
            }
        }
    }

    if (staged === 0) {
        // Sem nenhum desses arquivos, o $readmemb e os .mif do .v do
        // processador vao falhar logo a seguir. Avisar claramente em vez de
        // deixar o erro do simulador ser a unica pista. O caminho de sucesso
        // e silencioso por design: copiar arquivos de memoria entre pastas e
        // plumbing interno, nao algo que o usuario precisa saber.
        deps.terminalManager.appendToTerminal(
            'twave',
            tr('terminal.wave.noMemFiles', { path: projectPath }),
            'warning',
        );
    }
}
