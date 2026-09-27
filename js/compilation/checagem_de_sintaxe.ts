/**
 * checagem_de_sintaxe.ts: as duas checagens de sintaxe pelo iverilog -tnull,
 * que elabora o design sem gerar .vvp.
 *
 * Saiu do compilation_module.js.
 *
 *   - checarVerilog, o botao Verilog (e o ASM e o PRISM): so as fontes
 *     sintetizaveis, com o topo do .spf, porque $dumpvars, $finish e atrasos
 *     do testbench so confundiriam um check de design; depois, a hierarquia
 *     do projeto pelo Yosys.
 *   - checarParaAWaveConfig, a porta da Wave Configuration: o design inteiro
 *     com o testbench cru, exatamente o que o usuario escreveu, para o seletor
 *     de sinais nao abrir sobre codigo que o iverilog nem le. Nunca lanca.
 */

import { electronAPI } from '../app/electron_api.js';
import { statusUpdater } from '../ui/status_updater.js';
import { buildIverilogCheckSpec } from './builders/index.js';
import { foiCancelada } from './cancelamento.js';
import * as CommandSpec from './command_spec.js';
import { isPythonFile, moduleStemFromPath } from './compilation_helpers.js';
import { ferramentasDoIcarus, rodarIverilog } from './icarus_da_onda.js';
import type { TerminalManager } from './processor_compiler.js';
import { runSpec } from './spec_runner.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** A configuracao ja validada (CompilationModule._buildConfigShape). */
interface ConfigDaChecagem {
    topLevelFile: string | null;
    testbenchFile: string | null;
    synthesizableFiles: string[];
}

/** O que as checagens leem do CompilationModule. */
export interface ContextoDaChecagem {
    projectPath: string;
    componentsPath: string | null;
    terminalManager: Pick<TerminalManager, 'appendToTerminal' | 'processExecutableOutput'>;
    initializeComponentsPath(): Promise<unknown>;
    validateForVerilog(): ConfigDaChecagem;
    generateProjectHierarchy(): Promise<boolean>;
}

/**
 * O botao Verilog. O -y components/HDL resolve os modulos que o design usa sem
 * listar (processor.v, addr_dec.v, instr_dec.v, ula.v, core.v, myFIFO.v).
 * Depois do sucesso, regenera a hierarquia para a arvore de modulos; o Wave
 * nao faz isso, porque o usuario ja passou por aqui para chegar num design valido.
 *
 * @throws o erro da etapa, ja escrito no TVERI (`jaNoTerminal`), a nao ser que
 *         o usuario tenha mandado parar
 */
export async function checarVerilog(ctx: ContextoDaChecagem): Promise<void> {
    const terminal = ctx.terminalManager;
    terminal.appendToTerminal('tveri', tr('terminal.veri.phaseCheck'), 'info');
    statusUpdater.startCompilation('verilog');

    try {
        const config = ctx.validateForVerilog();
        const topLevelFile = config.topLevelFile as string;

        // 'tips' e o selo azul: contexto do que vai compilar; o verde so no fim.
        terminal.appendToTerminal('tveri',
            tr('terminal.veri.topLevel', { name: topLevelFile.split(/[\\/]/).pop() }), 'tips');
        terminal.appendToTerminal('tveri',
            tr('terminal.veri.synthFiles', { count: config.synthesizableFiles.length }), 'info');

        const { iveriCompPath, hdlPath } = await ferramentasDoIcarus(ctx);

        // O nome do arquivo sem a extensao, qualquer que seja ela (.v, .sv).
        const topLevelModuleName = moduleStemFromPath(topLevelFile);

        const spec = buildIverilogCheckSpec({
            iveriCompPath,
            hdlPath,
            simTopModule: topLevelModuleName,
            sourceFiles: [...new Set(config.synthesizableFiles)],
            cwd: ctx.projectPath,
        });

        await rodarIverilog(terminal, spec, { phase: 'check' });

        terminal.appendToTerminal('tveri', tr('terminal.veri.checkSuccess'), 'success');
        statusUpdater.compilationSuccess('verilog');

        await ctx.generateProjectHierarchy();
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
 * A porta da Wave Configuration: nao adianta mostrar um seletor montado de uma
 * leitura por regex se o proprio iverilog nao le o design. Na falha, a saida do
 * iverilog fica no TVERI e o modal nao abre.
 *
 * @returns { success, message? }; nunca lanca
 */
export async function checarParaAWaveConfig(ctx: ContextoDaChecagem): Promise<{ success: boolean; message?: string }> {
    const terminal = ctx.terminalManager;
    if (!ctx.componentsPath) {
        await ctx.initializeComponentsPath();
    }
    try {
        const config = ctx.validateForVerilog();
        const componentsPath = ctx.componentsPath as string;

        const iveriCompPath = await electronAPI.joinPath(componentsPath, 'Packages', 'msys', 'mingw64', 'bin', 'iverilog.exe');
        if (!await electronAPI.fileExists(iveriCompPath)) {
            const msg = tr('error.toolchain.iverilogNotFound', { path: iveriCompPath });
            terminal.appendToTerminal('tveri', msg, 'error');
            return { success: false, message: msg };
        }

        const topLevelModuleName = moduleStemFromPath(config.topLevelFile as string);
        const testbenchFile = config.testbenchFile;
        const hasVerilogTestbench = !!testbenchFile && !isPythonFile(testbenchFile);
        const simTopModule = hasVerilogTestbench ? moduleStemFromPath(testbenchFile as string) : topLevelModuleName;

        // O design inteiro com o testbench cru, sem instrumentar.
        const fileSet = new Set(config.synthesizableFiles);
        if (hasVerilogTestbench) fileSet.add(testbenchFile as string);

        // Sem o -y components/HDL a checagem falha com "Unknown module type:
        // processor" em todo projeto com processador SAPHO.
        const hdlPath = await electronAPI.joinPath(componentsPath, 'HDL');

        const checkSpec = buildIverilogCheckSpec({
            iveriCompPath,
            hdlPath,
            simTopModule,
            sourceFiles: [...fileSet],
            cwd: ctx.projectPath,
        });

        terminal.appendToTerminal('tveri', tr('terminal.veri.bannerSyntaxWc'), 'info');
        terminal.appendToTerminal('tveri', tr('terminal.veri.simTop', { name: simTopModule }), 'info');
        // A linha de comando crua e ruido fora do verbose.
        terminal.appendToTerminal('tveri', CommandSpec.formatSpec(checkSpec), 'info', { internal: true });

        const result = await runSpec(checkSpec, { consumeEphemeral: true });
        terminal.processExecutableOutput('tveri', result);

        if (result.code !== 0) {
            terminal.appendToTerminal('tveri', tr('terminal.veri.bannerSyntaxFailed'), 'error');
            return {
                success: false,
                message: `Iverilog reported errors (exit ${result.code}). See terminal.`,
            };
        }

        terminal.appendToTerminal('tveri', tr('terminal.veri.bannerSyntaxPassed'), 'success');
        return { success: true };
    } catch (error) {
        const message = (error as { message?: string })?.message as string;
        terminal.appendToTerminal('tveri', tr('terminal.veri.syntaxError', { message }), 'error');
        return { success: false, message };
    }
}
