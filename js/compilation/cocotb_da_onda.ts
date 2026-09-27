/**
 * cocotb_da_onda.ts: o testbench Python pelo cocotb, no botao Wave e no Fast Sim.
 *
 * Saiu do compilation_module.js. Quem e o DUT, o Python do pacote e o cocotb
 * instalado nele, as fontes HDL, as memorias do processador, o runner, a
 * execucao e a adocao da onda. Os dois simuladores rodam no MESMO Python, o do
 * pacote mingw (components/Packages/msys/mingw64/bin/python.exe), cujo cocotb
 * traz os dois VPIs; o que muda de um para o outro e o SIM e os argumentos de
 * build.
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { statusUpdater } from '../ui/status_updater.js';
import { buildCocotbRunSpec } from './builders/index.js';
import { COCOTB_RUNNER_SOURCE, COCOTB_TESTS_FAILED } from './cocotb_runner_source.js';
import * as CommandSpec from './command_spec.js';
import {
    assertPythonModuleName, basenameOfPath, decideCocotbDut, isVerilogLikeFile, moduleStemFromPath, safeNamePart,
} from './compilation_helpers.js';
import { NOMES_DE_DUMP_COCOTB } from './dump_guard.js';
import { exigirDumpGravavel } from './arquivos_da_simulacao.js';
import { consumirProgresso, avisarSeNaBateria, vigiarTamanhoDoDump, type TerminalDaSimulacao } from './durante_a_simulacao.js';
import { stageProcessorMemoryFiles, type TerminalManager } from './processor_compiler.js';
import { runSpecStreamed } from './spec_runner.js';
import { buildHierarchyFromFiles, resolveCocotbWaveSelection } from './wave_signal_validator.js';
import { findWaveCandidateInDir, resolveVerilatorTools } from './wave_toolchain.js';
import { getSimulator } from '../wave/simulator_preference.js';
import { verilatorTraceRules, contarEscopos } from '../wave/verilator_trace_rules.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** A configuracao ja validada, no que o cocotb le. */
export interface ConfigDoCocotb {
    topLevelFile?: string | null;
    testbenchFile?: string | null;
    synthesizableFiles?: string[];
}

/** O DUT escolhido e os nomes que a corrida usa. */
export interface ContextoDoCocotb {
    hdlTopFile: string;
    hdlTopModule: string;
    testbenchFile: string;
    testModule: string;
    tbKey: string;
    toplevelSource: 'directive' | 'spf';
}

/** O que o cocotb le (e escreve) do CompilationModule. */
export interface ContextoDaCorrida {
    projectPath: string | null;
    componentsPath: string | null;
    projectConfig?: { processors?: unknown[] } | null;
    terminalManager: TerminalManager & TerminalDaSimulacao;
    /** A selecao validada: o layout automatico do .gtkw e do Surfer le daqui depois. */
    _validatedWaveSelection?: string[] | null;
}

/**
 * Quem e o DUT, e o motivo quando nao da. A regra e o decideCocotbDut
 * (compilation_helpers.ts); aqui fica a leitura do .py, que pode falhar (e ai a
 * diretiva simplesmente nao existe), e a traducao do motivo.
 *
 * @throws quando nao ha DUT, ou quando o nome do arquivo nao e modulo Python
 */
export async function validarCocotb(config: ConfigDoCocotb): Promise<ContextoDoCocotb> {
    let pySource = '';
    if (config.testbenchFile) {
        try {
            pySource = await electronAPI.readFile(config.testbenchFile, { encoding: 'utf8' });
        } catch { /* ilegivel aqui, cai no topo do .spf */ }
    }
    const dut = decideCocotbDut(config as { topLevelFile?: string; testbenchFile?: string }, pySource);
    if (!dut.ok) throw new Error(tr(`error.compilation.${dut.motivo}`));
    const testbenchFile = config.testbenchFile as string;
    return {
        hdlTopFile: dut.hdlTopFile,
        hdlTopModule: dut.hdlTopModule,
        testbenchFile,
        testModule: assertPythonModuleName(testbenchFile),
        tbKey: moduleStemFromPath(testbenchFile),
        toplevelSource: dut.toplevelSource,
    };
}

/**
 * De onde veio o DUT (a diretiva do .py, explicita, ou o topo do .spf, com
 * aviso para uma diretiva esquecida nao testar o modulo errado calada) e em
 * qual simulador. A barra de estado passa ao simulador de verdade, porque o
 * cocotb nao anda pelo statusUpdater passo a passo.
 */
export function anunciarCocotb(
    terminal: Pick<TerminalManager, 'appendToTerminal'>, config: ConfigDoCocotb, cocotbCtx: ContextoDoCocotb,
): void {
    if (cocotbCtx.toplevelSource === 'directive') {
        terminal.appendToTerminal('twave',
            tr('terminal.wave.cocotbToplevelDirective', { module: cocotbCtx.hdlTopModule }), 'tips');
    } else {
        terminal.appendToTerminal('twave',
            tr('terminal.wave.cocotbToplevelFallback', {
                file: basenameOfPath(config.testbenchFile as string),
                module: cocotbCtx.hdlTopModule,
            }), 'warning');
    }
    const verilator = getSimulator() === 'verilator';
    terminal.appendToTerminal('twave', tr('terminal.wave.cocotbSimulator', {
        sim: verilator ? 'Verilator' : 'Icarus',
    }), 'tips');
    statusUpdater.startCompilation(verilator ? 'verilator' : 'verilog');
}

/** O runner, uma fonte so com o teste (tests/toolchain/pipeline.test.js executa estes bytes). */
async function gravarRunner(tempBaseDir: string): Promise<string> {
    const scriptPath = await electronAPI.joinPath(tempBaseDir, 'aurora_cocotb_runner.py');
    await electronAPI.writeFile(scriptPath, COCOTB_RUNNER_SOURCE);
    return scriptPath;
}

/** As fontes Verilog do projeto e a biblioteca HDL do SAPHO (sem os testbenches dela). */
async function fontesDoCocotb(componentsPath: string, config: ConfigDoCocotb): Promise<string[]> {
    const fileSet = new Set<string>();
    for (const path of config.synthesizableFiles || []) {
        if (isVerilogLikeFile(path)) fileSet.add(path);
    }
    if (config.topLevelFile && isVerilogLikeFile(config.topLevelFile)) {
        fileSet.add(config.topLevelFile);
    }
    try {
        const hdlPath = await electronAPI.joinPath(componentsPath, 'HDL');
        const hdlEntries: unknown = await electronAPI.listFilesInDirectory(hdlPath);
        if (Array.isArray(hdlEntries)) {
            for (const name of hdlEntries) {
                if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                    fileSet.add(await electronAPI.joinPath(hdlPath, name));
                }
            }
        }
    } catch (_e) { /* biblioteca HDL opcional */ }
    return [...fileSet];
}

/** As memorias do processador (pc_*_mem.txt) vao para a pasta do build, onde o simulador procura. */
async function copiarMemorias(ctx: ContextoDaCorrida, tempBaseDir: string, buildDir: string): Promise<void> {
    await stageProcessorMemoryFiles(ctx, tempBaseDir);
    let entries: unknown[] = [];
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
        } catch (_copyErr) { /* melhor esforco: o simulador acusa o arquivo que faltar */ }
    }
}

interface PerfilDoCocotb {
    pythonPath: string;
    prependPath: string[];
    extraEnv: Record<string, string>;
    sim: 'verilator' | 'icarus';
    buildArgs: string[];
}

/**
 * A metade do cocotb que depende do simulador. O Python do pacote precisa do
 * PYTHONHOME no mingw64 e do bin dele no PATH (as DLLs dele e o
 * iverilog/verilator/g++ que ele chama).
 *
 * @param wave false (Fast Sim): sem --trace-fst, a simulacao so verifica os asserts
 */
async function perfilDoCocotb(componentsPath: string, wave: boolean): Promise<PerfilDoCocotb> {
    const vTools = await resolveVerilatorTools(componentsPath);
    const pythonPath = await electronAPI.joinPath(vTools.mingwBin, 'python.exe');
    if (!await electronAPI.fileExists(pythonPath)) {
        throw new Error(tr('error.compilation.cocotbPythonMissing'));
    }
    const status = await electronAPI.getPythonStatus();
    if (!status?.ok || !status.hasCocotb) {
        throw new Error(tr('error.compilation.cocotbPackageMissing', { path: pythonPath }));
    }
    // <pacote>/mingw64/bin -> <pacote>/mingw64 (PYTHONHOME).
    const pythonHome = await electronAPI.dirname(vTools.mingwBin);
    const base = {
        pythonPath,
        prependPath: [vTools.mingwBin, vTools.usrBin],
        extraEnv: { PYTHONHOME: pythonHome },
    };
    // O Verilator e mais estrito que o Icarus: o HDL do SAPHO (a normalizacao
    // de ponto flutuante da ula.v, por exemplo) dispara avisos como UNOPTFLAT
    // que o Icarus tolera. O mesmo -Wno do fluxo sem cocotb, com o -Wno-fatal
    // como o que importa.
    const VERILATOR_BUILD = [
        '-Wno-fatal', '-Wno-TIMESCALEMOD', '-Wno-DECLFILENAME',
        '-Wno-STMTDLY', '-Wno-WIDTHTRUNC', '-Wno-WIDTHEXPAND',
        // Liga o bloco YANC_SIM_VIS do <proc>.v, para as variaveis espelhadas
        // do processador (/* verilator public_flat */) aparecerem na onda. O
        // Icarus ganha isso de graca pelo __ICARUS__ predefinido.
        '+define+YANC_TRACE',
        // O runner do cocotb compila o modelo com -Os (tamanho). As simulacoes
        // do SAPHO sao longas, entao o C++ vai com -O3 e -march=native, que e
        // seguro porque a AURORA compila e roda o binario na MESMA maquina e
        // nunca o distribui. O ultimo -O da linha do g++ vence o -Os.
        '-CFLAGS', '-O3',
        '-CFLAGS', '-march=native',
        // FST em vez de VCD: o cocotb forca --trace, e o --trace-fst depois
        // dele vence (VM_TRACE_FST=1); o wrapper do cocotb grava dump.fst,
        // umas dez vezes menor, e o I/O da simulacao longa fica muito mais
        // barato. No Fast Sim sai: sem trace nenhum, so os testes.
        ...(wave ? ['--trace-fst'] : []),
    ];
    return getSimulator() === 'verilator'
        ? { ...base, sim: 'verilator', buildArgs: VERILATOR_BUILD }
        : { ...base, sim: 'icarus', buildArgs: ['-g2012'] };
}

/**
 * O dump do cocotb, com o nome canonico, na Temp.
 *
 * O cocotb roda com cwd = test_dir, que a AURORA poe na pasta do projeto, entao
 * o dump pode cair la em vez da pasta do build. A busca vai no build, depois no
 * projeto, depois na pasta do testbench (corridas antigas).
 *
 * @throws quando nao ha dump em lugar nenhum
 */
async function adotarOnda(
    ctx: ContextoDaCorrida, cocotbCtx: ContextoDoCocotb, tools: { tempBaseDir: string }, buildDir: string,
): Promise<string> {
    const testDir = await electronAPI.dirname(cocotbCtx.testbenchFile);
    const candidate =
        await findWaveCandidateInDir(buildDir, cocotbCtx.hdlTopModule) ||
        (ctx.projectPath ? await findWaveCandidateInDir(ctx.projectPath, cocotbCtx.hdlTopModule) : null) ||
        await findWaveCandidateInDir(testDir, cocotbCtx.hdlTopModule);
    if (!candidate) {
        throw new Error(tr('error.compilation.cocotbNoWave', { path: buildDir }));
    }
    // O GTKWave abre o FST direto; o cabecalho sai dele pelo mesmo passo de
    // todos os caminhos de onda, no runGtkWave. Um VCD de texto passa como esta.
    const ext = /\.fst$/i.test(candidate) ? 'fst' : 'vcd';
    const target = await electronAPI.joinPath(tools.tempBaseDir, `${cocotbCtx.hdlTopModule}.${ext}`);
    if (candidate.toLowerCase() !== target.toLowerCase()) {
        await electronAPI.copyFile(candidate, target);
    }
    if (!await electronAPI.fileExists(target)) {
        throw new Error(tr('error.compilation.cocotbNoWave', { path: buildDir }));
    }
    ctx.terminalManager.appendToTerminal('twave',
        tr('terminal.wave.cocotbVcd', { name: basenameOfPath(target) }), 'info');
    return target;
}

/**
 * Roda os testes do cocotb. No Wave, adota a onda e devolve o caminho dela; no
 * Fast Sim (`wave: false`: sem --trace-fst, WAVES=0), devolve null.
 *
 * Duas saidas diferentes de proposito. COCOTB_TESTS_FAILED (2): a simulacao
 * rodou inteira e o dump existe, algum @cocotb.test() falhou; parar ali tiraria
 * a onda do aluno justo quando ela mais ajuda, entao o fracasso e anunciado e a
 * onda abre. Qualquer outro codigo e falha de infraestrutura (build, modulo que
 * falta, interpretador que caiu), e nao ha o que mostrar.
 */
export async function rodarCocotb(
    ctx: ContextoDaCorrida, cocotbCtx: ContextoDoCocotb, tools: { tempBaseDir: string },
    config: ConfigDoCocotb, opts: { wave?: boolean } = {},
): Promise<string | null> {
    const terminal = ctx.terminalManager;
    const wave = opts.wave !== false;
    await TabManager.saveAllFiles();
    await electronAPI.mkdir(tools.tempBaseDir);

    const componentsPath = ctx.componentsPath as string;
    const profile = await perfilDoCocotb(componentsPath, wave);

    const buildDir = await electronAPI.joinPath(tools.tempBaseDir, `cocotb_${safeNamePart(cocotbCtx.tbKey)}`);
    await electronAPI.mkdir(buildDir);
    await copiarMemorias(ctx, tools.tempBaseDir, buildDir);

    const sources = await fontesDoCocotb(componentsPath, config);
    const selecao = await resolveCocotbWaveSelection(
        { projectPath: ctx.projectPath as string, terminalManager: terminal }, cocotbCtx, config, sources);
    ctx._validatedWaveSelection = selecao;
    // Sob Verilator a selecao do picker vira regras de escopo num .vlt, como no
    // fluxo nativo; aqui ele entra pelos argumentos de build, porque o runner do
    // cocotb recusa um .vlt na lista de fontes. Sem selecao o dump fica como o
    // cocotb faz nos dois simuladores: tudo a partir do topo.
    const buildArgs = [...profile.buildArgs];
    if (profile.sim === 'verilator' && wave && selecao.length > 0) {
        try {
            const arvore = await buildHierarchyFromFiles(sources, cocotbCtx.hdlTopModule);
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
                terminal.appendToTerminal('twave',
                    tr('terminal.wave.verilatorScopeRules', { on: ligados, off: desligados }), 'info');
            }
        } catch (_e) { /* sem o .vlt o dump sai inteiro, como antes */ }
    }
    const tbDir = await electronAPI.dirname(cocotbCtx.testbenchFile);
    const runnerScript = await gravarRunner(tools.tempBaseDir);
    const pastaDoTeste = ctx.projectPath || tbDir;
    const env = {
        AURORA_COCOTB_SOURCES_JSON: JSON.stringify(sources),
        AURORA_COCOTB_TOP: cocotbCtx.hdlTopModule,
        AURORA_COCOTB_TEST_MODULE: cocotbCtx.testModule,
        AURORA_COCOTB_BUILD_DIR: buildDir,
        // test_dir e o cwd da SIMULACAO no runner: a pasta do projeto, a mesma
        // regra dos fluxos vvp e Verilator. Os caminhos relativos do .py e do
        // HDL resolvem contra ela, e o dump cai la.
        AURORA_COCOTB_TEST_DIR: pastaDoTeste,
        AURORA_COCOTB_PYTHONPATH: [tbDir, ctx.projectPath, buildDir].filter(Boolean).join(';'),
        AURORA_COCOTB_BUILD_ARGS_JSON: JSON.stringify(buildArgs),
        AURORA_COCOTB_TEST_ARGS_JSON: JSON.stringify([]),
        SIM: profile.sim,
        TOPLEVEL_LANG: 'verilog',
        WAVES: wave ? '1' : '0',
        // UTF-8 no stdio, para o log do cocotb (e os prints e docstrings do
        // aluno) com acento, seta ou emoji nao derrubar o logging do Python no
        // codepage cp1252 do Windows.
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        // O clock do lado C do cocotb (GpiClock) em vez do de corrotina Python:
        // o `Clock(..., impl="auto")` so escolhe o GpiClock com esta variavel.
        // Medido no teste345 (Verilator): saida identica, cerca de 12% mais
        // rapido na simulacao inteira e 2,4 vezes nas curtas.
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

    terminal.appendToTerminal('twave', tr('terminal.wave.runningCocotb', {
        sim: profile.sim === 'verilator' ? 'Verilator' : 'Icarus',
    }), 'info');
    await avisarSeNaBateria(terminal, 'twave');
    terminal.appendToTerminal('twave', CommandSpec.formatSpec(spec), 'info', { internal: true });

    // A mesma defesa dos fluxos vvp e Verilator (dump_guard.ts), so no Wave: o
    // Fast Sim nao grava dump. Vem ANTES de ligar o ouvinte do fluxo: com a
    // recusa depois dele, o ouvinte ficava ligado e repetia no TWAVE toda
    // saida em fluxo que viesse depois.
    if (wave) {
        await exigirDumpGravavel(pastaDoTeste, NOMES_DE_DUMP_COCOTB);
    }

    let unsubscribe: (() => void) | null = null;
    if (typeof electronAPI.onExecSpecStream === 'function') {
        unsubscribe = electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                if (!line.trim()) continue;
                if (consumirProgresso(terminal, 'twave', line, tr('terminal.wave.progress'))) continue;
                terminal.appendToTerminal('twave', line, 'raw');
            }
        });
    }

    let code;
    // Sob Verilator o runner grava dump.fst no test_dir; sob Icarus o nome
    // tambem vem do runner, como dump.
    const pararVigia = vigiarTamanhoDoDump(terminal, [
        await electronAPI.joinPath(pastaDoTeste, 'dump.fst'),
        await electronAPI.joinPath(buildDir, 'dump.fst'),
        await electronAPI.joinPath(pastaDoTeste, 'dump.vcd'),
    ]);
    try {
        const result = await runSpecStreamed(spec, { consumeEphemeral: true });
        code = result.code;
    } finally {
        if (unsubscribe) unsubscribe();
        await pararVigia();
    }
    if (code !== 0 && code !== COCOTB_TESTS_FAILED) {
        throw new Error(tr('error.compilation.cocotbFailed', { code }));
    }
    if (code === COCOTB_TESTS_FAILED) {
        terminal.appendToTerminal('twave', tr('terminal.wave.cocotbTestsFailed'), 'error');
        statusUpdater.compilationError('verilog', 'cocotb tests failed');
    }
    return wave ? adotarOnda(ctx, cocotbCtx, tools, buildDir) : null;
}
