/**
 * teste_de_hardware.ts: o botao de teste de hardware, o processador ativo
 * rodando no Verilator. A saida vai para o terminal THTEST.
 *
 * Saiu do compilation_module.js. Roda o top-level que o compilador C+- gera
 * (<proc>.v) com a fiacao previsivel do processador SAPHO. O compilation_flow
 * ja rodou cmm e asm antes, entao <proc>.v e .mif estao frescos:
 *
 *   1. --json-only no <proc>.v     -> portas (clk/rst/in/out/req_in/out_en[/itr])
 *   2. o bloco YANC_SIM_VIS do <proc>.v -> fiacao input_<N>.txt <-> req_in
 *                                      one-hot, output_<N>.txt <-> out_en one-hot
 *   3. o harness C++ (decimal com sinal, pulso de rst, itr=0 se existir)
 *   4. --cc --exe --build          -> V<proc>.exe
 *   5. roda numClocks no <proc>/Simulation/ (os mesmos arquivos do Icarus)
 *
 * Diferente do botao top-level generico, nao ha templates nem diretivas
 * `# @gate`: a fiacao vem do proprio <proc>.v. Toda falha de etapa sobe como
 * erro com a mensagem pronta.
 */

import { electronAPI } from '../app/electron_api.js';
import { buildVerilatorJsonSpec, buildVerilatorTbBuildSpec, buildVerilatorTbRunSpec } from './builders/index.js';
import * as CommandSpec from './command_spec.js';
import type { TerminalManager } from './processor_compiler.js';
import { runSpec, runSpecStreamed } from './spec_runner.js';
import { parseVerilatorPorts, parseProcessorIO, generateVerilatorProcTb } from './verilator_tb.js';
import { resolveVerilatorTools } from './wave_toolchain.js';
import { getActiveProcessorName } from '../project/active_processor.js';
import { projectTempDir } from '../project/project_temp.js';
import { lerProgresso } from '../terminal/progress_line.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

const T = 'thtest';

type EntradaDoSpf = string | { name?: string; numClocks?: number } | null | undefined;

/** O terminal, visto daqui. */
export interface TerminalDoTeste extends Pick<TerminalManager, 'appendToTerminal' | 'processExecutableOutput'> {
    processStreamedLine(id: string, linha: string): void;
    renderHardwareProgress?(id: string, p: {
        pct: number; cyc: number | null; total: number | null; reads: number | null; label: string; done?: boolean;
    }): void;
    appendFolderLink?(id: string, mensagem: string, pasta: string, tipo?: string): void;
}

/** O que o teste le do CompilationModule. */
export interface ContextoDoTeste {
    projectPath: string;
    componentsPath: string | null;
    projectConfig?: { processors?: unknown } | null;
    terminalManager: TerminalDoTeste;
    initializeComponentsPath(): Promise<unknown>;
}

/**
 * O processador do botao: o PROCESSADOR ATIVO da barra de status (o .cmm em
 * foco no editor cruzado com a lista do projeto), a mesma fonte do gate do
 * botao (botoes_da_barra.ts). null quando nao ha ativo; o botao ja estaria
 * desabilitado, e quem chama pela API recebe a mensagem clara.
 */
export function processadorAlvo(
    projectConfig: ContextoDoTeste['projectConfig'],
): { name: string; numClocks?: number } | null {
    const activeName = getActiveProcessorName() || null;
    if (!activeName) return null;
    const lista: EntradaDoSpf[] = Array.isArray(projectConfig?.processors) ? projectConfig.processors : [];
    const procs = lista
        .map((p) => (typeof p === 'string' ? { name: p } : p))
        .filter((p): p is { name: string; numClocks?: number } => !!p && !!p.name);
    return procs.find((p) => p.name === activeName) || null;
}

/**
 * Endereco do laco de parada (@fim), lido da linha `@fim <n>` do app_log.txt
 * que o appcomp escreve na Temp. E a MESMA fonte que o asmcomp usa para cravar
 * o $finish do _tb.v do Icarus (labels.c: label "fim" chama sim_set_fim), entao
 * os dois fluxos param no mesmo endereco. null sem o arquivo ou sem a linha.
 */
export async function enderecoDoFim(tempBaseDir: string, procName: string): Promise<number | null> {
    try {
        const logPath = await electronAPI.joinPath(tempBaseDir, procName, 'app_log.txt');
        const text = await electronAPI.readFile(logPath, { encoding: 'utf8' });
        const m = /^@fim\s+(\d+)\s*$/m.exec(String(text || ''));
        if (m) return Number(m[1]);
    } catch (_e) { /* sem arquivo: sem fim conhecido */ }
    return null;
}

// O harness imprime "@@AURORA_PROG <cyc> <nclk> <reads>" a cada ~1% dos clocks;
// essas linhas movem a barra (progress_line.ts) e nao sao ecoadas. O
// @@AURORA_CHEGUEI <clock> e o fim: o PC chegou ao @fim e o harness encerrou.
const CHEGUEI_RE = /^@@AURORA_CHEGUEI\s+(\d+)/;
// @@AURORA_NOPC: a HDL embarcada e anterior ao `public_flat_rd` do PC (YANC <=
// v5.4); o harness nao enxerga o fim e roda o teto de clocks.
const NOPC_RE = /^@@AURORA_NOPC\b/;

/** Roda o teste de hardware do processador ativo. */
export async function rodarTesteDeHardware(ctx: ContextoDoTeste): Promise<void> {
    await ctx.initializeComponentsPath();
    if (!ctx.projectConfig) throw new Error(tr('error.config.notLoaded'));
    const terminal = ctx.terminalManager;
    const componentsPath = ctx.componentsPath as string;

    const proc = processadorAlvo(ctx.projectConfig);
    if (!proc) throw new Error(tr('error.compilation.noActiveProcessor'));
    const procName = proc.name;
    const numClocks = Number.isFinite(proc.numClocks) ? proc.numClocks as number : 2000;

    const procDir = await electronAPI.joinPath(ctx.projectPath, procName);
    const procV = await electronAPI.joinPath(procDir, 'Hardware', `${procName}.v`);
    const simDir = await electronAPI.joinPath(procDir, 'Simulation');

    if (!await electronAPI.fileExists(procV)) {
        throw new Error(tr('error.compilation.procVMissing', { path: procV }));
    }

    const tools = await resolveVerilatorTools(componentsPath);
    const tempBaseDir = await projectTempDir(ctx.projectPath);
    const hdlPath = await electronAPI.joinPath(componentsPath, 'SAPHO');
    const objDir = await electronAPI.joinPath(tempBaseDir, `obj_dir_proc_${procName}`);
    await electronAPI.mkdir(objDir);

    // Etapas em alto nivel como info/success; o ruido da toolchain (verilator,
    // perl, g++, make) so no modo verbose; a barra de progresso inline.
    terminal.appendToTerminal(T, tr('terminal.htest.start', { name: procName, clocks: numClocks }), 'info');

    // ---- Passo 1: portas via --json-only ----
    terminal.appendToTerminal(T, tr('terminal.wave.procPorts', { name: procName }), 'info');
    const jsonSpec = buildVerilatorJsonSpec({
        perlExe: tools.perlExe, verilatorScript: tools.verilatorScript,
        mingwBin: tools.mingwBin, usrBin: tools.usrBin,
        hdlPath, topModule: procName, objDir,
        sourceFiles: [procV], cwd: tempBaseDir,
    });
    terminal.appendToTerminal(T, CommandSpec.formatSpec(jsonSpec), 'info', { internal: true });
    const jsonResult = await runSpec(jsonSpec, { consumeEphemeral: true });
    terminal.processExecutableOutput(T, jsonResult);
    if (jsonResult.code !== 0) throw new Error(tr('error.compilation.verilatorJsonFailed', { code: jsonResult.code }));
    const jsonPath = await electronAPI.joinPath(objDir, `V${procName}.tree.json`);
    if (!await electronAPI.fileExists(jsonPath)) {
        throw new Error(tr('error.compilation.verilatorJsonMissing', { path: jsonPath }));
    }
    const ports = parseVerilatorPorts(JSON.parse(await electronAPI.readFile(jsonPath, { encoding: 'utf8' })));

    // ---- Passo 2: fiacao de I/O lida do proprio <proc>.v (bloco YANC_SIM_VIS) ----
    const wiring = parseProcessorIO(await electronAPI.readFile(procV, { encoding: 'utf8' }));
    if (wiring.inputs.length === 0 && wiring.outputs.length === 0) {
        terminal.appendToTerminal(T, tr('terminal.wave.procNoPorts'), 'warning');
    }

    // ---- Passo 3: gera o harness C++ ----
    // O harness le `valr10` (a cadeia de atraso do PC que o bloco YANC_SIM_VIS
    // declara public_flat) e para quando ela chega ao @fim. Sem o endereco,
    // roda o teto de clocks e avisa. Nenhum pino, nenhuma mudanca no hardware,
    // e o .cmm do usuario nao e tocado.
    const fimAddr = await enderecoDoFim(tempBaseDir, procName);
    if (fimAddr == null) {
        terminal.appendToTerminal(T, tr('terminal.htest.fimUnknown', { name: procName }), 'warning');
    }
    terminal.appendToTerminal(T, tr('terminal.htest.genCpp', { name: procName }), 'info');
    const gen = generateVerilatorProcTb({
        topModule: procName, ports,
        inputs: wiring.inputs, outputs: wiring.outputs,
        numClocks, fimAddr,
    });
    const cppPath = await electronAPI.joinPath(tempBaseDir, `tl_proc_${procName}.cpp`);
    await electronAPI.writeFile(cppPath, gen.source);

    terminal.appendToTerminal(T,
        tr('terminal.wave.procWiring', {
            inputs: wiring.inputs.map((p) => `${p.file}@req${p.reqValue}`).join(', ') || '—',
            outputs: wiring.outputs.map((p) => `${p.file}@en${p.enValue}`).join(', ') || '—',
            itr: gen.hasItr ? 'itr=0' : 'sem itr',
        }), 'info');

    // ---- Passo 4: build ----
    terminal.appendToTerminal(T, tr('terminal.wave.procBuilding', { name: procName }), 'info');
    const buildSpec = buildVerilatorTbBuildSpec({
        perlExe: tools.perlExe, verilatorScript: tools.verilatorScript,
        mingwBin: tools.mingwBin, usrBin: tools.usrBin,
        hdlPath, topModule: procName, objDir,
        sourceFiles: [procV, cppPath], cwd: tempBaseDir,
    });
    terminal.appendToTerminal(T, CommandSpec.formatSpec(buildSpec), 'info', { internal: true });
    const buildResult = await runSpec(buildSpec, { consumeEphemeral: true });
    terminal.processExecutableOutput(T, buildResult);
    if (buildResult.code !== 0) throw new Error(tr('error.compilation.verilatorTbBuildFailed', { code: buildResult.code }));

    let exePath = await electronAPI.joinPath(objDir, `V${procName}.exe`);
    if (!await electronAPI.fileExists(exePath)) {
        const fallback = await electronAPI.joinPath(objDir, `V${procName}`);
        if (!await electronAPI.fileExists(fallback)) {
            throw new Error(tr('error.compilation.verilatorExeMissing', { path: exePath }));
        }
        exePath = fallback;
    }

    // ---- Passo 5: roda numClocks no Simulation/ (em fluxo, com barra) ----
    terminal.appendToTerminal(T, tr('terminal.wave.procRunning', { name: procName, clocks: numClocks }), 'info');
    const runProcSpec = buildVerilatorTbRunSpec({
        exePath, cwd: simDir,
        mingwBin: tools.mingwBin, usrBin: tools.usrBin,
        cycles: numClocks,
    });
    terminal.appendToTerminal(T, CommandSpec.formatSpec(runProcSpec), 'info', { internal: true });

    let pcNotVisible = false;
    const execLabel = tr('terminal.htest.exec');
    let chegueiClock: number | null = null;
    let lastReads: number | null = null;
    let unsub: (() => void) | null = null;
    if (typeof electronAPI.onExecSpecStream === 'function') {
        unsub = electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                const p = lerProgresso(line, { rotuloPadrao: execLabel });
                if (p) {
                    // O total do harness manda; numClocks e a reserva para o
                    // caso de ele imprimir zero.
                    if (p.reads != null) lastReads = p.reads;
                    terminal.renderHardwareProgress?.(T, {
                        pct: p.pct, cyc: p.cyc, total: p.total || numClocks,
                        reads: p.reads, label: execLabel,
                    });
                    continue;
                }
                const ch = line.match(CHEGUEI_RE);
                if (ch) { chegueiClock = +ch[1]; continue; }
                if (NOPC_RE.test(line)) { pcNotVisible = true; continue; }
                if (!line.trim()) continue;
                terminal.processStreamedLine(T, line.trim());
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

    // A barra fecha no clock REAL de parada: o teto num run completo, ou o do
    // `cheguei` quando o programa terminou antes, e fica em "1224/2000" em vez
    // de forcar "2000/2000".
    const endCyc: number = chegueiClock != null ? chegueiClock : numClocks;
    const endPct = numClocks ? Math.min(100, Math.round((endCyc / numClocks) * 100)) : 100;
    terminal.renderHardwareProgress?.(T, {
        pct: endPct, cyc: endCyc, total: numClocks, reads: lastReads, label: execLabel, done: true,
    });

    if (pcNotVisible) {
        terminal.appendToTerminal(T, tr('terminal.htest.pcNotVisible', { name: procName }), 'warning');
    }
    if (chegueiClock != null) {
        terminal.appendToTerminal(T, tr('terminal.htest.chegueiEnd', { clock: chegueiClock }), 'success');
    }

    // A mensagem final leva a pasta de saida como LINK: clicar abre a vista de
    // pastas da arvore e revela essa pasta.
    const doneMsg = tr('terminal.wave.procDone', {
        dir: simDir,
        outputs: wiring.outputs.map((p) => p.file).join(', ') || '—',
    });
    if (terminal.appendFolderLink) {
        terminal.appendFolderLink(T, doneMsg, simDir, 'success');
    } else {
        terminal.appendToTerminal(T, doneMsg, 'success');
    }
}
