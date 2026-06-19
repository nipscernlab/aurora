// processor_compiler.js — SAPHO processor compile steps (C±/.cmm → .asm → .v).
//
// Extracted from compilation_module.js (A2 god-file decomposition #5, the last
// one). These drive the per-processor toolchain: cmmcomp (.cmm → .asm), then
// appcomp + asmcomp (.asm → <proc>.v + pc_*_mem.txt + <base>_tb.v), plus the
// helpers that resolve which .cmm/testbench to use, instrument #TOAQUI, and
// stage processor memory files into Temp/.
//
// They are NOT pure — they run external .exe via runSpec, save editor buffers,
// drive the status bar, and stream to the terminal. Rather than capture instance
// state, each takes a `deps` bag { projectPath, componentsPath, projectConfig,
// terminalManager } (CompilationModule._instanceDeps()). CompilationModule keeps
// thin delegators for the public API (cmmCompilation / asmCompilation are called
// by compilation_flow.js) and for _stageProcessorMemoryFiles.
//
// TWO instance-field seams stay OWNED by CompilationModule:
//   - lastCompiledCmmPath: read by the terminal's "line N" click handler
//     (terminal_module.js) via the instance. cmmCompilation writes it BEFORE the
//     compile runs (so a click after a FAILED compile still resolves to the .cmm
//     that failed). To preserve that exact timing, the caller passes a
//     `setLastCompiledCmmPath` callback and cmmCompilation invokes it at the same
//     point — the field is written inside the class, not here.
//   - _chegueiInstrumentProc: set externally by compilation_flow.js to gate the
//     #TOAQUI instrumentation. Passed in as `chegueiInstrumentProc`.
//
// Kept on `window.electronAPI` (live global) rather than the ../app/electron_api
// re-export so the module stays unit-testable with the repo's
// `globalThis.window = { electronAPI: fake }` pattern — migrating these globals
// belongs to A3, not this extraction.

import { TabManager } from '../tabs/tab_manager.js';
import { statusUpdater } from '../ui/status_updater.js';
import { runSpec } from './spec_runner.js';
import { buildCmmSpec, buildAsmPreSpec, buildAsmSpec } from './builders/index.js';
import * as CommandSpec from './command_spec.js';
import { moduleStemFromPath, insertChegueiToaqui } from './compilation_helpers.js';

// i18n shim — falls back to the key path if i18n didn't boot yet.
const tr = (k, p) => (window.t ? window.t(k, p) : k);

export async function getSelectedCmmFile(processor) {
    if (!processor.cmmFile) {
        throw new Error(tr('error.config.noCmm'));
    }
    return processor.cmmFile;
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
 * @param {{ projectPath: string }} deps
 */
export async function getTestbenchInfo(deps, processor, cmmBaseName) {
    let tbModule, tbFile;
    const testbenchFilePath = processor.testbenchFile;

    if (testbenchFilePath && testbenchFilePath !== 'standard') {
        tbFile = testbenchFilePath;
        const tbFileName = testbenchFilePath.split(/[\\\\/]/).pop();
        tbModule = moduleStemFromPath(tbFileName);
    } else {
        tbModule = `${cmmBaseName}_tb`;
        const simulationPath = await window.electronAPI.joinPath(deps.projectPath, processor.name, 'Simulation');
        tbFile = await window.electronAPI.joinPath(simulationPath, `${tbModule}.v`);
    }

    return {
        tbModule,
        tbFile
    };
}

/**
 * Garante que o .cmm tenha #TOAQUI antes do `}` de main() — sem isso o
 * pino `cheguei` nao vira porta do <proc>.v e o harness do botao Verilator
 * nao consegue detectar o fim do programa. Idempotente: se ja houver
 * #TOAQUI em qualquer lugar do arquivo, nao mexe. Roda DEPOIS do
 * saveAllFiles (sem corrida) e sincroniza o buffer do editor aberto pra
 * que um save manual posterior nao derrube a instrumentacao.
 *
 * @param {{ terminalManager: object }} deps
 * @param {string} softwarePath  <proj>/<proc>/Software
 * @param {string} cmmFile       nome do .cmm (ex: ProcDTW.cmm)
 */
export async function ensureChegueiToaqui(deps, softwarePath, cmmFile) {
    const cmmPath = await window.electronAPI.joinPath(softwarePath, cmmFile);
    let src;
    try {
        src = await window.electronAPI.readFile(cmmPath, { encoding: 'utf8' });
    } catch (_e) {
        return; // sem .cmm — o proprio cmmcomp vai reclamar adiante
    }

    if (/#TOAQUI\b/.test(src)) {
        deps.terminalManager.appendToTerminal('thtest',
            tr('terminal.htest.toaquiPresent', { file: cmmFile }), 'plain', { internal: true });
        return;
    }

    const out = insertChegueiToaqui(src);
    if (out === src) {
        deps.terminalManager.appendToTerminal('thtest',
            tr('terminal.htest.toaquiNoMain', { file: cmmFile }), 'warning');
        return;
    }

    await window.electronAPI.writeFile(cmmPath, out);
    // Mantem o editor em sincronia com o disco (se o .cmm estiver aberto),
    // pra que um Ctrl+S posterior nao reescreva sem o #TOAQUI.
    const model = window.SharedModelRegistry?.getModel?.(cmmPath)
        ?? window.EditorManager?.getEditorForFile?.(cmmPath)?.getModel?.();
    if (model && model.getValue() !== out) model.setValue(out);

    deps.terminalManager.appendToTerminal('thtest',
        tr('terminal.htest.toaquiAdded', { file: cmmFile }), 'info');
}

/**
 * Compila o .cmm do processador via cmmcomp.exe → <proj>/<proc>/Software/<base>.asm.
 *
 * @param {{ projectPath: string, componentsPath: string, terminalManager: object }} deps
 * @param {object} processor                  entrada do .spf (name, cmmFile, showArrays)
 * @param {string|null} chegueiInstrumentProc nome do proc a instrumentar com #TOAQUI (botao Verilator), ou null
 * @param {(path: string) => void} setLastCompiledCmmPath  cacheia o .cmm corrente na instancia (lido pelo terminal)
 * @returns {Promise<string>} asmPath
 */
export async function cmmCompilation(deps, processor, chegueiInstrumentProc, setLastCompiledCmmPath) {
    const { name, showArrays } = processor;
    await deps.terminalManager.clearTerminal('tcmm');

    deps.terminalManager.appendToTerminal('tcmm', tr('terminal.cmm.starting', { name }));

    try {
        const selectedCmmFile = await getSelectedCmmFile(processor);
        const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');

        // 1. Caminhos
        const macrosPath = await window.electronAPI.joinPath(deps.componentsPath, 'Macros');

        // Define o caminho da pasta temporária específica do processador: components/Temp/{name}
        const tempPath = await window.electronAPI.joinPath(deps.componentsPath, 'Temp', name);

        // 2. NOVA LÓGICA: Criar a pasta Temp/{name} se não existir
        // O parâmetro { recursive: true } no backend garante que cria a pasta 'Temp' e a subpasta '{name}'
        await window.electronAPI.createDirectory(tempPath);

        const cmmCompPath = await window.electronAPI.joinPath(deps.componentsPath, 'bin', 'cmmcomp.exe');
        const projectPath = await window.electronAPI.joinPath(deps.projectPath, name);
        const softwarePath = await window.electronAPI.joinPath(deps.projectPath, name, 'Software');
        const asmPath = await window.electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);

        await TabManager.saveAllFiles();

        // Botao Verilator: instrumenta o .cmm do processador-alvo com
        // #TOAQUI (pino `cheguei` no fim do programa) ANTES do cmmcomp.exe
        // ler o arquivo. Aqui — depois do saveAllFiles — pra que o save
        // nao sobrescreva a instrumentacao com o buffer do editor. Idem-
        // potente: pula se ja houver #TOAQUI em qualquer lugar.
        if (chegueiInstrumentProc === name) {
            await ensureChegueiToaqui(deps, softwarePath, selectedCmmFile);
        }

        statusUpdater.startCompilation('cmm');

        // yanc v4 usa named options (CMMComp/Sources/args.c):
        //   -i input  -n name  -p proc-dir  -m macros-dir  -t temp-dir  [-A]
        // -pt / -en vem do toggle de locale (UI + compiler unified) e vai
        // PRIMEIRO: parse_lang_flag() consome essa flag e a remove de argv
        // antes do cli_parse() ler o resto. Explicito pra que a UI mande,
        // ignorando qualquer env var preexistente do shell.
        //
        // -A / --array liga o showArrays do .spf (campo per-processador) —
        // dump de arrays no waveform. Era -P no yanc v3.
        const lang = window.getYancLang?.() ?? 'pt';
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
        setLastCompiledCmmPath(await window.electronAPI.joinPath(softwarePath, selectedCmmFile));

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
    } catch (error) {
        deps.terminalManager.appendToTerminal('tcmm', tr('terminal.common.error', { message: error.message }), 'error');
        statusUpdater.compilationError('cmm', error.message);
        throw error;
    }
}

/**
 * Compila o .asm via appcomp.exe (preprocess) + asmcomp.exe → <proc>.v +
 * pc_*_mem.txt; copia o testbench auto-gerado pra <proc>/Simulation/ quando
 * o processador usa o testbench "standard".
 *
 * @param {{ projectPath: string, componentsPath: string, terminalManager: object }} deps
 */
export async function asmCompilation(deps, processor, preamble = null) {
    const {
        name,
        clk,
        numClocks
    } = processor;
    await deps.terminalManager.clearTerminal('tasm');

    // Mensagem opcional logada APOS o clear — usada pelo handler
    // do botao ASM pra avisar quando o C+- foi recompilado por
    // falta de cmm_log.txt. Antes do clear ela era apagada antes
    // do usuario ver.
    if (preamble) {
        deps.terminalManager.appendToTerminal('tasm', preamble, 'tips');
    }

    deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.starting', { name }));

    try {
        const projectPath = await window.electronAPI.joinPath(deps.projectPath, name);
        const tempPath = await window.electronAPI.joinPath(deps.componentsPath, 'Temp', name);
        const appCompPath = await window.electronAPI.joinPath(deps.componentsPath, 'bin', 'appcomp.exe');
        const asmCompPath = await window.electronAPI.joinPath(deps.componentsPath, 'bin', 'asmcomp.exe');
        const hdlPath = await window.electronAPI.joinPath(deps.componentsPath, 'HDL');
        const selectedCmmFile = await getSelectedCmmFile(processor);
        const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
        const softwarePath = await window.electronAPI.joinPath(deps.projectPath, name, 'Software');
        const asmPath = await window.electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);
        const macrosPath = await window.electronAPI.joinPath(deps.componentsPath, 'Macros');

        const {
            tbFile
        } = await getTestbenchInfo(deps, processor, cmmBaseName);

        statusUpdater.startCompilation('asm');
        await TabManager.saveAllFiles();

        // -pt / -en vem do toggle de locale. Vai PRIMEIRO: parse_lang_flag()
        // consome a flag antes do cli_parse() ler as named options. Aplicado
        // igual em appcomp e asmcomp pra que stdout/stderr dos dois passos
        // saiam na mesma lingua.
        const lang = window.getYancLang?.() ?? 'pt';

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
        // -f/-c TEM que ser inteiros — o yanc rejeita valor nao-numerico
        // e sai com usage. O -P (project mode = sem $finish no _tb.v) foi
        // removido no v4: o $finish agora e sempre emitido; multi-proc
        // workflows ignoram o _tb.v individual e usam um top-level proprio.
        const freq = Number.parseInt(clk, 10) || 0;
        const clocks = Number.parseInt(numClocks, 10) || 0;
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
        // usa o testbench "standard" — i.e., nao tem um testbench
        // customizado configurado. O testbench auto-gerado e
        // per-processador (Simulation/<base>_tb.v), distinto do
        // testbench-top que o .spf aponta, entao nao
        // conflita com nada.
        const usesStandardTestbench =
            !processor.testbenchFile || processor.testbenchFile === 'standard';
        if (usesStandardTestbench) {
            const tbFileName = tbFile.split(/[\\\\/]/)
                .pop();
            const sourceTestbench = await window.electronAPI.joinPath(tempPath, tbFileName);
            const destinationTestbench = tbFile;

            // Path-cheio so em verbose; o resumo "Testbench
            // atualizado" (tips) e o que aparece sem verbose.
            deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.copyingTb', { src: sourceTestbench, dst: destinationTestbench }), 'info', { internal: true });
            await window.electronAPI.copyFile(sourceTestbench, destinationTestbench);
            deps.terminalManager.appendToTerminal('tasm', tr('terminal.asm.tbUpdated'), 'tips');
        }

        statusUpdater.compilationSuccess('asm');
    } catch (error) {
        deps.terminalManager.appendToTerminal('tasm', tr('terminal.common.error', { message: error.message }), 'error');
        statusUpdater.compilationError('asm', error.message);
        throw error;
    }
}

/**
 * Copia os pc_*_mem.txt (gerados por cmmcomp em Temp/<proc>/) pra raiz de
 * tempBaseDir — onde o $readmemb do <proc>.v procura (vvp roda com
 * CWD=tempBaseDir). No-op (silencioso) em projeto sem processador; warning
 * claro quando ha processador mas nenhum pc_*_mem.txt foi achado.
 *
 * @param {{ projectConfig: object, terminalManager: object }} deps
 */
export async function stageProcessorMemoryFiles(deps, tempBaseDir) {
    // Projeto sem processador no .spf nunca gera pc_*_mem.txt — o
    // $readmemb que consome esses arquivos so existe dentro do .v do
    // processador SAPHO. Pular o staging inteiro (incluindo o warning
    // "no pc_*_mem.txt found") nesse caso: procurar arquivos de memoria
    // de processador num design que nao tem processador so confunde.
    const procs = Array.isArray(deps.projectConfig?.processors)
        ? deps.projectConfig.processors.filter(
            (p) => p && (typeof p === 'string' ? p.trim() : p.name))
        : [];
    if (procs.length === 0) return;

    let entries;
    try {
        entries = await window.electronAPI.getFolderFiles(tempBaseDir);
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
    const failedSubdirs = [];
    for (const entry of entries) {
        if (!entry?.isDirectory) continue;
        const subDir = entry.path;
        let subFiles;
        try {
            subFiles = await window.electronAPI.listFilesInDirectory(subDir);
        } catch (_e) {
            failedSubdirs.push(subDir);
            continue;
        }
        if (!Array.isArray(subFiles)) continue;
        for (const fileName of subFiles) {
            if (typeof fileName !== 'string') continue;
            if (!fileName.startsWith('pc_') || !fileName.endsWith('_mem.txt')) continue;
            const src = await window.electronAPI.joinPath(subDir, fileName);
            const dst = await window.electronAPI.joinPath(tempBaseDir, fileName);
            try {
                await window.electronAPI.copyFile(src, dst);
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
