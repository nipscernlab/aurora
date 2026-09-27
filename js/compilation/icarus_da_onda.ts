/**
 * icarus_da_onda.ts: o Icarus no botao Wave, e as duas pecas do iverilog que a
 * checagem de sintaxe tambem usa.
 *
 * Saiu do compilation_module.js. O build do .vvp (fontes sintetizaveis +
 * testbench instrumentado, -y components/HDL para a biblioteca do SAPHO) e a
 * simulacao pelo vvp na pasta do projeto.
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { statusUpdater } from '../ui/status_updater.js';
import { buildIverilogBuildSpec, buildVvpRunSpec } from './builders/index.js';
import { foiCancelada } from './cancelamento.js';
import * as CommandSpec from './command_spec.js';
import type { CommandSpec as SpecDeComando } from './command_spec.js';
import { nomesDeDumpEsperados } from './dump_guard.js';
import { copiarDadosDoTestbench, exigirDumpGravavel } from './arquivos_da_simulacao.js';
import { consumirProgresso, avisarSeNaBateria, vigiarTamanhoDoDump, type TerminalDaSimulacao } from './durante_a_simulacao.js';
import {
    anunciarFonteDaSelecao, arquivosDaBibliotecaHdl, instrumentarTestbench, type ContextoDoPreparo,
} from './preparo_da_onda.js';
import { stageProcessorMemoryFiles, type TerminalManager } from './processor_compiler.js';
import { runSpec, runSpecStreamed } from './spec_runner.js';
import { resolveWaveSelection } from './wave_signal_validator.js';
import { projectTempDir } from '../project/project_temp.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** A configuracao ja validada (CompilationModule._buildConfigShape). */
export interface ConfigDoIcarus {
    topLevelFile: string | null;
    testbenchFile: string | null;
    synthesizableFiles: string[];
}

/** O que o Icarus le do CompilationModule. */
export interface ContextoDoIcarus extends ContextoDoPreparo {
    projectConfig?: { processors?: unknown[] } | null;
    terminalManager: TerminalManager & TerminalDaSimulacao;
    validateForWave(): ConfigDoIcarus;
    loadConfigUnsafe(): ConfigDoIcarus;
}

/**
 * O que os dois fluxos do iverilog (checagem e build do Wave) precisam: a
 * Temp do projeto (criada aqui), o iverilog.exe do pacote e a pasta HDL do
 * -y, onde moram processor.v, myFIFO.v e os outros.
 *
 * @throws quando o iverilog nao esta no pacote, com o caminho que faltou
 */
export async function ferramentasDoIcarus(
    ctx: Pick<ContextoDoIcarus, 'projectPath' | 'componentsPath'>,
): Promise<{ tempBaseDir: string; iveriCompPath: string; hdlPath: string }> {
    const tempBaseDir = await projectTempDir(ctx.projectPath);
    const iveriCompPath = await electronAPI.joinPath(
        ctx.componentsPath as string, 'Packages', 'msys', 'mingw64', 'bin', 'iverilog.exe',
    );
    if (!await electronAPI.fileExists(iveriCompPath)) {
        throw new Error(tr('error.toolchain.iverilogNotFound', { path: iveriCompPath }));
    }
    await electronAPI.mkdir(tempBaseDir);
    const hdlPath = await electronAPI.joinPath(ctx.componentsPath as string, 'HDL');
    return { tempBaseDir, iveriCompPath, hdlPath };
}

/**
 * Roda o iverilog com o spec dado e manda a saida ao TVERI. `phase` escolhe as
 * mensagens ('check' para a checagem, 'build' para o .vvp). Nao anuncia o
 * sucesso, que cada fluxo diz do seu jeito.
 *
 * @throws quando o iverilog sai com erro
 */
export async function rodarIverilog(
    terminal: Pick<TerminalManager, 'appendToTerminal' | 'processExecutableOutput'>,
    spec: SpecDeComando, { phase }: { phase: 'check' | 'build' },
): Promise<void> {
    const isBuild = phase === 'build';
    // O rotulo e a linha de comando crua so aparecem no verbose: o rotulo vai
    // como interno tambem, senao ficaria sozinho no modo normal.
    terminal.appendToTerminal('tveri', tr(isBuild ? 'terminal.veri.buildCmd' : 'terminal.veri.checkCmd'),
        'info', { internal: true });
    terminal.appendToTerminal('tveri', CommandSpec.formatSpec(spec), 'info', { internal: true });

    await TabManager.saveAllFiles();

    terminal.appendToTerminal('tveri', tr(isBuild ? 'terminal.veri.building' : 'terminal.veri.checking'), 'info');

    const result = await runSpec(spec, { consumeEphemeral: true });
    terminal.processExecutableOutput('tveri', result);

    if (result.code !== 0) {
        throw new Error(tr(
            isBuild ? 'error.compilation.iverilogFailedBuild' : 'error.compilation.iverilogFailedCheck',
            { code: result.code },
        ));
    }
}

/**
 * O build do .vvp do botao Wave: resolve a selecao, instrumenta o testbench e
 * compila tudo com -o Temp/<tb>.vvp. Nao regenera a hierarquia, que e tarefa
 * do botao Verilog.
 *
 * @throws o erro da etapa, ja escrito no TVERI (`jaNoTerminal`), a nao ser que
 *         o usuario tenha mandado parar
 */
export async function construirNoIcarus(ctx: ContextoDoIcarus): Promise<void> {
    const terminal = ctx.terminalManager;
    terminal.appendToTerminal('tveri', tr('terminal.veri.phaseBuild'), 'info');
    statusUpdater.startCompilation('verilog');

    try {
        const config = ctx.validateForWave();
        const testbenchFile = config.testbenchFile as string;

        if (config.topLevelFile) {
            terminal.appendToTerminal('tveri',
                tr('terminal.veri.topLevel', { name: config.topLevelFile.split(/[\\/]/).pop() }), 'tips');
        }
        terminal.appendToTerminal('tveri',
            tr('terminal.veri.testbench', { name: testbenchFile.split(/[\\/]/).pop() }), 'tips');
        terminal.appendToTerminal('tveri',
            tr('terminal.veri.synthFiles', { count: config.synthesizableFiles.length }), 'info');

        const { tempBaseDir, iveriCompPath, hdlPath } = await ferramentasDoIcarus(ctx);

        const simTopModule = (testbenchFile.split(/[\\/]/).pop() as string).replace(/\.v$/i, '');
        const outputFile = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);

        const fileSet = new Set(config.synthesizableFiles);

        // As fontes da validacao da selecao: sintetizaveis + testbench + a
        // biblioteca HDL, para selecoes de pilha, ULA e SAPHO nao cairem como velhas.
        const filePaths = new Set(config.synthesizableFiles);
        filePaths.add(testbenchFile);
        for (const p of await arquivosDaBibliotecaHdl(hdlPath)) filePaths.add(p);

        const decision = await resolveWaveSelection(ctx, {
            config: config as ConfigDoIcarus & { testbenchFile: string },
            simTopModule,
            filePaths: [...filePaths],
        });

        const { path: tbPath, reason } = await instrumentarTestbench(
            ctx, testbenchFile, simTopModule, tempBaseDir,
            decision.signalsToDump, decision.overrideUserDumpvars, decision.monitorScopes || [],
        );
        fileSet.add(tbPath);

        // Quando o testbench manda no dump, a selecao do .gtkw automatico fica
        // vazia e ele mostra o dump inteiro.
        ctx._validatedWaveSelection = reason === 'user-defined' ? [] : decision.signalsToDump;
        anunciarFonteDaSelecao(terminal, decision);
        if (reason === 'override-user') {
            terminal.appendToTerminal('twave', tr('terminal.wave.overrideUserDumpvars'), 'tips');
        }
        if (tbPath !== testbenchFile) {
            terminal.appendToTerminal('tveri',
                tr('terminal.veri.autoInstrTb', { name: tbPath.split(/[\\/]/).pop() }), 'info');
        }

        const spec = buildIverilogBuildSpec({
            iveriCompPath,
            hdlPath,
            simTopModule,
            outputFile,
            sourceFiles: [...fileSet],
            cwd: ctx.projectPath,
        });

        await rodarIverilog(terminal, spec, { phase: 'build' });

        // O iverilog pode sair bem sem ter escrito o -o (antivirus, permissao).
        if (!await electronAPI.fileExists(outputFile)) {
            throw new Error(tr('error.compilation.vvpNotGenerated'));
        }

        terminal.appendToTerminal('tveri', tr('terminal.veri.buildSuccess'), 'success');
        statusUpdater.compilationSuccess('verilog');
    } catch (error) {
        const erro = error as Error & { jaNoTerminal?: boolean };
        if (!foiCancelada()) {
            terminal.appendToTerminal('tveri', tr('terminal.veri.bannerFailed'), 'error');
            terminal.appendToTerminal('tveri', tr('terminal.common.error', { message: erro.message }), 'error');
            erro.jaNoTerminal = true;
        }
        statusUpdater.compilationError('verilog', erro.message);
        throw error;
    }
}

/**
 * Constroi o .vvp e confere que ele esta onde o Wave vai procurar. Sempre
 * reconstroi: o testbench instrumentado fixa a selecao no momento do
 * iverilog, e um .vvp antigo prenderia a selecao antiga.
 */
export async function construirEConferirVvp(ctx: ContextoDoIcarus, simTopModule: string, tempBaseDir: string): Promise<void> {
    ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.buildingVvp'), 'info');
    await construirNoIcarus(ctx);
    const vvpFile = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);
    if (!await electronAPI.fileExists(vvpFile)) {
        throw new Error(tr('error.compilation.vvpNotProduced', { path: vvpFile }));
    }
}

/**
 * Linha de servico do vvp (formato do dump, onde o $finish foi chamado), que
 * so interessa a quem depura o simulador: some do TWAVE.
 */
const ehRuidoDoVvp = (line: string): boolean => {
    const t = (line || '').toLowerCase();
    return t.includes('fst info:') || t.includes('vcd info:')
        || t.includes('lxt info:') || t.includes('lxt2 info:') || t.includes('vzt info:')
        || t.includes('$finish called at') || t.includes('$stop called at');
};

/**
 * Roda o vvp no .vvp recem-construido, na pasta do projeto, depois de copiar
 * para la as memorias dos processadores e os dados do testbench. Uma simulacao
 * so, com -fst; o cabecalho sai do FST depois, no runGtkWave.
 *
 * @returns a pasta onde a simulacao rodou (onde procurar o dump)
 * @throws se o vvp sair com erro, ou antes, se o dump anterior estiver travado
 */
export async function simularNoIcarus(
    ctx: ContextoDoIcarus, simTopModule: string, tools: { tempBaseDir: string; vvpBin: string },
): Promise<string> {
    const terminal = ctx.terminalManager;
    const config = ctx.loadConfigUnsafe();
    const simCwd = ctx.projectPath || tools.tempBaseDir;

    // O .v gerado do processador le os pc_<proc>_mem.txt por $readmemb com
    // nome RELATIVO; eles vao para a pasta da simulacao. Sem processador, nada.
    await stageProcessorMemoryFiles(ctx, tools.tempBaseDir, simCwd);
    if (config.testbenchFile) {
        await copiarDadosDoTestbench(terminal, simCwd, config.testbenchFile);
    }
    await exigirDumpGravavel(simCwd, nomesDeDumpEsperados(simTopModule));

    const vvpFile = await electronAPI.joinPath(tools.tempBaseDir, `${simTopModule}.vvp`);

    terminal.appendToTerminal('twave', tr('terminal.wave.runningVvp'), 'info');
    await avisarSeNaBateria(terminal, 'twave');

    let unsubscribe: (() => void) | null = null;
    // Uma explicacao SO por corrida: o vvp repete "invalid file descriptor" a
    // cada ciclo quando um $fopen falhou, e mil copias nao dizem mais que uma.
    let avisouDescritor = false;
    if (typeof electronAPI.onExecSpecStream === 'function') {
        unsubscribe = electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                if (!line.trim()) continue;
                if (ehRuidoDoVvp(line)) continue;
                if (!avisouDescritor && /invalid file descriptor/i.test(line)) {
                    avisouDescritor = true;
                    terminal.appendToTerminal('twave', tr('terminal.wave.invalidFd'), 'warning');
                }
                // Um $display de contador escrito pelo aluno vira a barra em vez de mil linhas.
                if (consumirProgresso(terminal, 'twave', line, tr('terminal.wave.progress'))) continue;
                terminal.appendToTerminal('twave', line, 'raw');
            }
        });
    }
    let code;
    const pararVigia = vigiarTamanhoDoDump(terminal, [
        await electronAPI.joinPath(simCwd, `${simTopModule}.vcd`),
        await electronAPI.joinPath(simCwd, `${simTopModule}.fst`),
    ]);
    try {
        const vvpRunSpec = buildVvpRunSpec({ vvpBin: tools.vvpBin, vvpFile, cwd: simCwd });
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
