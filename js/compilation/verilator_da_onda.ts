/**
 * verilator_da_onda.ts: o Verilator no botao Wave e no Fast Sim.
 *
 * Saiu do compilation_module.js. Wave: o build com o testbench instrumentado,
 * mais um `.vlt` que expoe os monitores e traduz o pedido de sinais em regras
 * de escopo; depois a simulacao na pasta do projeto. Fast Sim: o mesmo
 * testbench sem dump e sem trace, so a velocidade, e o caminho cocotb quando
 * o testbench e Python.
 *
 * Paralelo ao Icarus, com outra toolchain:
 *
 *   iverilog:  fonte -> .vvp -> vvp (interpretador)  -> FST
 *   verilator: fonte -> C++ -> g++ -> .exe nativo     -> FST
 *
 * O executavel do Verilator costuma ser de 10 a 100 vezes mais rapido que o
 * vvp em testbench longo, ao custo de um lint mais estrito e de depender do
 * g++. A escolha e do usuario (simulator_preference.ts; o padrao e o Icarus).
 *
 * O preparo do Wave (instrumentar o testbench e resolver a selecao) e o
 * preparo_da_onda.ts; o cocotb e o cocotb_da_onda.ts.
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { statusUpdater } from '../ui/status_updater.js';
import { buildVerilatorBuildSpec, buildVerilatorRunSpec } from './builders/index.js';
import { foiCancelada } from './cancelamento.js';
import * as CommandSpec from './command_spec.js';
import { isPythonFile } from './compilation_helpers.js';
import { nomesDeDumpEsperados } from './dump_guard.js';
import { copiarDadosDoTestbench, exigirDumpGravavel } from './arquivos_da_simulacao.js';
import { consumirProgresso, avisarSeNaBateria, vigiarTamanhoDoDump, type TerminalDaSimulacao } from './durante_a_simulacao.js';
import { stageProcessorMemoryFiles, type TerminalManager } from './processor_compiler.js';
import { runSpec, runSpecStreamed } from './spec_runner.js';
import { prepararWave } from './preparo_da_onda.js';
import { validarCocotb, anunciarCocotb, rodarCocotb } from './cocotb_da_onda.js';
import { resolveWaveToolchain, resolveVerilatorTools } from './wave_toolchain.js';
import { commentOutDumpCalls } from '../wave/testbench_instrumenter.js';
import {
    verilatorTraceRules, defaultScopeRules, rulesFromDumpvars, contarEscopos, type EscopoDaArvore,
} from '../wave/verilator_trace_rules.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** A configuracao ja validada (CompilationModule._buildConfigShape). */
export interface ConfigDaSimulacao {
    topLevelFile: string | null;
    testbenchFile: string | null;
    synthesizableFiles: string[];
}

/** Os binarios do Verilator e a Temp do projeto. */
export interface FerramentasDoVerilator {
    tempBaseDir: string;
    perlExe: string;
    verilatorScript: string;
    mingwBin: string;
    usrBin: string;
}

/** O que o preparo do Wave devolve (CompilationModule._prepareWaveBuildInputs). */
interface PreparoDoWave {
    instrumentedTbPath: string;
    fileSet: Set<string>;
    decision?: {
        source?: string;
        hierarchyTree?: EscopoDaArvore | null;
        signalsToDump?: string[];
    } | null;
}

/** O que o Verilator le do CompilationModule. */
export interface ContextoDoVerilator {
    projectPath: string;
    componentsPath: string | null;
    projectConfig?: { processors?: unknown[] } | null;
    terminalManager: TerminalManager & TerminalDaSimulacao;
    initializeComponentsPath(): Promise<unknown>;
    validateForWave(): ConfigDaSimulacao;
    loadConfigUnsafe(): ConfigDaSimulacao;
    _waveDeriveSimTopModule(config: ConfigDaSimulacao): string;
    _validatedWaveSelection?: string[] | null;
}

// Filosofia de warnings: deixar passar o que indica bug ou oportunidade de
// melhoria, e silenciar so o que e mecanico ou convencao do SAPHO:
//   - TIMESCALEMOD: 50+ avisos, um por modulo; a correcao e mecanica
//     (`timescale em cada .v) e a primeira leva afoga o resto.
//   - DECLFILENAME: o SAPHO usa "proc_*.v contem module Proc*" por convencao.
//   - STMTDLY: o --timing ja trata #delay; o aviso e redundante.
//   - fatal: alguns avisos viram erro no Verilator; ficam como aviso para o
//     build seguir.
// O resto aparece (WIDTHTRUNC/EXPAND, COMBDLY, INITIALDLY, PINMISSING,
// UNOPTFLAT, UNUSEDSIGNAL/PARAM): sao reais, e o iverilog os escondia.
const AVISOS_DO_VERILATOR = ['-Wno-fatal', '-Wno-TIMESCALEMOD', '-Wno-DECLFILENAME', '-Wno-STMTDLY'];

/** V<top>.exe (mingw) ou V<top>; sem nenhum dos dois, erro com o caminho esperado. */
async function acharExecutavel(objDir: string, simTopModule: string): Promise<string> {
    const exePath = await electronAPI.joinPath(objDir, `V${simTopModule}.exe`);
    if (await electronAPI.fileExists(exePath)) return exePath;
    const fallback = await electronAPI.joinPath(objDir, `V${simTopModule}`);
    if (!await electronAPI.fileExists(fallback)) {
        throw new Error(tr('error.compilation.verilatorExeMissing', { path: exePath }));
    }
    return fallback;
}

/**
 * O `.vlt` do build do Wave: expoe os monitores de pilha e ULA (variaveis nao
 * publicas somem do $dumpvars em silencio sob o Verilator) e traz o pedido do
 * usuario como regras de escopo. O Verilator ignora os argumentos do
 * $dumpvars e gravaria a hierarquia publica inteira; o `.vlt` e o unico lugar
 * em que ele obedece, e a granularidade dele e o escopo. As mesmas tres
 * origens do Icarus: a selecao do picker (Wave Configuration ou .gtkw ativo),
 * os $dumpvars do proprio testbench, e o padrao $dumpvars(1, tb).
 *
 * @returns o caminho do `.vlt`, ou null quando nao deu para grava-lo (os
 *          monitores so ficam de fora do FST)
 */
async function gravarVltDaOnda(
    ctx: ContextoDoVerilator, tempBaseDir: string, prep: PreparoDoWave,
): Promise<string | null> {
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
        const decisao = prep.decision || {};
        const arvore = decisao.hierarchyTree;
        let regras: string[] = [];
        if (decisao.source === 'wc' || decisao.source === 'gtkw') {
            regras = verilatorTraceRules(arvore, decisao.signalsToDump as string[]);
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
            ctx.terminalManager.appendToTerminal('twave',
                tr('terminal.wave.verilatorScopeRules', { on: ligados, off: desligados }), 'info');
        }
        linhas.push('');
        await electronAPI.writeFile(vltPath, linhas.join('\n'));
        return vltPath;
    } catch (_e) {
        return null;
    }
}

/**
 * Compila o design pelo Verilator para o Wave: <tempBaseDir>/obj_dir_<top>/V<top>.exe.
 *
 * As fontes sao as mesmas que iriam para o Icarus (sintetizaveis + testbench
 * instrumentado + -y HDL), mais o `.vlt`. As flags moram no
 * buildVerilatorBuildSpec: --binary, --timing (os testbenches do SAPHO geram
 * o clock com #delay; sem ele o clk fica preso e a simulacao aborta com
 * DIDNOTCONVERGE), --trace-fst, -O3 no g++. O make que o Verilator dispara
 * vai ao TWAVE ao vivo, e o "[ 42%]" dele vira barra.
 *
 * @throws se o Verilator falhar ou o executavel nao aparecer
 */
export async function construirNoVerilator(
    ctx: ContextoDoVerilator, simTopModule: string, tempBaseDir: string,
    config: ConfigDaSimulacao, tools: FerramentasDoVerilator,
): Promise<{ exePath: string; objDir: string }> {
    const terminal = ctx.terminalManager;
    terminal.appendToTerminal('twave', tr('terminal.wave.buildingVerilator'), 'plain');

    const prep = await prepararWave(ctx, config, simTopModule, tempBaseDir);
    if (prep.instrumentedTbPath !== config.testbenchFile) {
        terminal.appendToTerminal('twave',
            tr('terminal.veri.autoInstrTb', { name: prep.instrumentedTbPath.split(/[\\/]/).pop() }), 'plain');
    }

    const hdlPath = await electronAPI.joinPath(ctx.componentsPath as string, 'SAPHO');
    const objDir = await electronAPI.joinPath(tempBaseDir, `obj_dir_${simTopModule}`);
    await electronAPI.mkdir(objDir);

    const buildSources = [...prep.fileSet];
    const vlt = await gravarVltDaOnda(ctx, tempBaseDir, prep);
    if (vlt) buildSources.push(vlt);

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
        extraWarnings: AVISOS_DO_VERILATOR,
    });
    terminal.appendToTerminal('twave', CommandSpec.formatSpec(verilatorSpec), 'info', { internal: true });

    let buildUnsub: (() => void) | null = null;
    if (typeof electronAPI.onExecSpecStream === 'function') {
        buildUnsub = electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                if (!line.trim()) continue;
                // O make conta em "[ 42%]": uma barra subindo diz o mesmo que as
                // dezenas de linhas, e diz melhor.
                if (consumirProgresso(terminal, 'twave', line, tr('terminal.wave.progressBuild'))) continue;
                terminal.appendToTerminal('twave', line, 'raw');
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
    return { exePath: await acharExecutavel(objDir, simTopModule), objDir };
}

/** Linha de servico do simulador que so interessa a quem depura o simulador. */
const ehRuidoDoSimulador = (line: string): boolean => {
    const t = (line || '').toLowerCase();
    return t.includes('fst info:') || t.includes('vcd info:')
        || t.includes('$finish called at') || t.includes('$stop called at');
};

/**
 * O relatorio do PROPRIO Verilator, prefixado com "- " ("Simulation Report",
 * "Verilator: walltime", "...Verilog $finish"): vai como 'plain', que so o modo
 * verbose mostra. Os $display do testbench, sem esse prefixo, vao como 'raw'.
 */
const ehRelatorioDoVerilator = (line: string): boolean => {
    const t = (line || '').trim();
    if (!t.startsWith('-')) return false;
    const low = t.toLowerCase();
    return low.includes('verilator') || low.includes('$finish') || low.includes('$stop')
        || low.replace(/\s/g, '').includes('simulationreport');
};

/**
 * Roda o executavel do Verilator uma vez, na pasta do projeto (a mesma regra
 * do vvp: $readmemb e $fopen relativos resolvem contra ela, e o dump cai la),
 * depois de copiar para la as memorias dos processadores e os dados do
 * testbench. Com --trace-fst o Verilator honra o nome do $dumpfile sem trocar
 * a extensao.
 *
 * @returns a pasta onde a simulacao rodou (onde procurar o dump)
 * @throws se o executavel sair com erro, ou antes, se o dump anterior estiver travado
 */
export async function simularNoVerilator(
    ctx: ContextoDoVerilator, simTopModule: string, tools: FerramentasDoVerilator, exePath: string,
): Promise<string> {
    const terminal = ctx.terminalManager;
    const config = ctx.loadConfigUnsafe();
    const simCwd = ctx.projectPath || tools.tempBaseDir;
    await stageProcessorMemoryFiles(ctx, tools.tempBaseDir, simCwd);
    if (config.testbenchFile) {
        await copiarDadosDoTestbench(terminal, simCwd, config.testbenchFile);
    }
    await exigirDumpGravavel(simCwd, nomesDeDumpEsperados(simTopModule));

    terminal.appendToTerminal('twave', tr('terminal.wave.runningVerilator'), 'plain');
    await avisarSeNaBateria(terminal, 'twave');

    let unsubscribe: (() => void) | null = null;
    if (typeof electronAPI.onExecSpecStream === 'function') {
        unsubscribe = electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                if (!line.trim()) continue;
                if (ehRuidoDoSimulador(line)) continue;
                if (consumirProgresso(terminal, 'twave', line, tr('terminal.wave.progress'))) continue;
                terminal.appendToTerminal('twave', line, ehRelatorioDoVerilator(line) ? 'plain' : 'raw');
            }
        });
    }
    let code;
    const pararVigia = vigiarTamanhoDoDump(terminal, [
        await electronAPI.joinPath(simCwd, `${simTopModule}.vcd`),
        await electronAPI.joinPath(simCwd, `${simTopModule}.fst`),
    ]);
    try {
        // O PATH leva o mingw64 e o usr/bin do pacote: o executavel linka contra
        // libstdc++-6.dll, libgcc e libwinpthread de la, e sem eles o Windows
        // aborta com STATUS_DLL_NOT_FOUND (exit 3221225781).
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

/**
 * O build do Fast Sim: o do Wave menos a instrumentacao do testbench e menos o
 * --trace-fst. O testbench vai cru, com os $dumpfile/$dumpvars comentados
 * (sem trace, qualquer dump seria peso morto ou erro de "tracing not
 * configured"). Pasta propria (obj_dir_fast_*) para nao colidir com o Wave.
 */
async function construirFastSim(
    ctx: ContextoDoVerilator, simTopModule: string, tempBaseDir: string,
    config: ConfigDaSimulacao, tools: FerramentasDoVerilator,
): Promise<string> {
    const terminal = ctx.terminalManager;
    terminal.appendToTerminal('twave', tr('terminal.wave.fastBuilding'), 'plain');

    const tbSrc = await electronAPI.readFile(config.testbenchFile as string, { encoding: 'utf8' });
    const fastTbPath = await electronAPI.joinPath(tempBaseDir, `fast_${simTopModule}.v`);
    await electronAPI.writeFile(fastTbPath, commentOutDumpCalls(tbSrc));
    const fileSet = new Set(config.synthesizableFiles);
    fileSet.add(fastTbPath);

    const hdlPath = await electronAPI.joinPath(ctx.componentsPath as string, 'SAPHO');
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
        sourceFiles: [...fileSet],
        cwd: tempBaseDir,
        extraWarnings: AVISOS_DO_VERILATOR,
        trace: false,
    });
    terminal.appendToTerminal('twave', CommandSpec.formatSpec(verilatorSpec), 'info', { internal: true });
    const result = await runSpec(verilatorSpec, { consumeEphemeral: true });
    terminal.processExecutableOutput('twave', result);
    if (result.code !== 0) {
        throw new Error(tr('error.compilation.verilatorFailed', { code: result.code }));
    }
    return acharExecutavel(objDir, simTopModule);
}

/** Fast Sim, testbench Verilog: Verilator sem trace, sem onda. */
async function fastSimVerilog(ctx: ContextoDoVerilator, config: ConfigDaSimulacao): Promise<void> {
    const tools = await resolveWaveToolchain(ctx.componentsPath as string, ctx.projectPath);
    const simTopModule = ctx._waveDeriveSimTopModule(config);

    statusUpdater.startCompilation('verilator');
    const vTools = await resolveVerilatorTools(ctx.componentsPath as string);
    const fullTools = { ...tools, ...vTools };

    const exePath = await construirFastSim(ctx, simTopModule, tools.tempBaseDir, config, fullTools);
    await simularNoVerilator(ctx, simTopModule, fullTools, exePath);

    ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.fastDone', { name: simTopModule }), 'success');
}

/**
 * Fast Sim, testbench Python: os testes do cocotb SEM onda (WAVES=0, sem
 * --trace-fst), no simulador que a preferencia escolher. Espelha o cocotb do
 * Wave menos a adocao e a abertura da onda.
 */
async function fastSimCocotb(ctx: ContextoDoVerilator, config: ConfigDaSimulacao): Promise<void> {
    const tools = await resolveWaveToolchain(ctx.componentsPath as string, ctx.projectPath);
    const cocotbCtx = await validarCocotb(config);
    anunciarCocotb(ctx.terminalManager, config, cocotbCtx);
    await rodarCocotb(ctx, cocotbCtx, tools, config, { wave: false });
    ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.fastDone', { name: cocotbCtx.hdlTopModule }), 'success');
}

/**
 * O botao Fast Sim: o testbench do Wave sem gerar onda e sem abrir
 * visualizador, so a velocidade. Testbench .py vai pelo cocotb; .v, pelo
 * Verilator sem trace.
 *
 * @throws o erro da etapa, ja escrito no terminal (`jaNoTerminal`), a nao ser
 *         que o usuario tenha mandado parar
 */
export async function rodarFastSim(ctx: ContextoDoVerilator): Promise<void> {
    ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.fastBanner'), 'info');
    try {
        // Os mesmos dois motivos do runGtkWave: a pasta de componentes precisa
        // estar resolvida, e o editor salvo antes da primeira leitura.
        await ctx.initializeComponentsPath();
        await TabManager.saveAllFiles();
        const config = ctx.validateForWave();
        if (isPythonFile(config.testbenchFile as string)) {
            await fastSimCocotb(ctx, config);
        } else {
            await fastSimVerilog(ctx, config);
        }
    } catch (error) {
        const erro = error as Error & { jaNoTerminal?: boolean };
        if (!foiCancelada()) {
            ctx.terminalManager.appendToTerminal('twave', tr('terminal.common.error', { message: erro.message }), 'error');
            erro.jaNoTerminal = true;
        }
        console.error(error);
        throw error;
    }
}
