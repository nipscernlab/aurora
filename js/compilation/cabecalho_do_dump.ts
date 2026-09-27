/**
 * cabecalho_do_dump.ts: o cabecalho de texto de um FST, a hierarquia de
 * $scope/$var ate o $enddefinitions, sem converter o corpo do dump.
 *
 * Saiu do compilation_module.js. E o que o seletor de sinais e o .gtkw
 * automatico leem, nos quatro caminhos de onda (Icarus, Verilator e o cocotb
 * nos dois); o GTKWave abre o proprio FST. A simulacao roda uma vez so, e o
 * cabecalho sai do FST que ela gravou.
 */

import { electronAPI } from '../app/electron_api.js';
import { buildFst2VcdSpec } from './builders/index.js';
import type { CommandSpec } from './command_spec.js';
import type { TerminalManager } from './processor_compiler.js';
import { runSpec, runSpecStreamed } from './spec_runner.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

const ENDDEFS = /\$enddefinitions\s+\$end/;

/**
 * O caminho de sempre: o fst2vcd sem -o manda o VCD ao stdout, cabecalho
 * primeiro; no instante em que o $enddefinitions aparece, o fst2vcd e morto.
 * Ele percorre so a geometria do FST e o primeiro bloco, nunca o corpo de
 * centenas de megabytes.
 *
 * @returns o cabecalho, ou null quando ele nao apareceu
 */
async function cabecalhoPeloFluxo(fstPath: string, fst2vcdBin: string, cwd: string): Promise<string | null> {
    const onExecSpecStream = electronAPI.onExecSpecStream as NonNullable<typeof electronAPI.onExecSpecStream>;
    const killCurrentSpecProcess = electronAPI.killCurrentSpecProcess as NonNullable<typeof electronAPI.killCurrentSpecProcess>;
    const spec: CommandSpec = {
        step: 'fst2vcd',
        binary: fst2vcdBin,
        args: ['-f', fstPath],
        cwd,
        label: 'fst2vcd (header only — cancelled at $enddefinitions)',
    };
    let acc = '';
    let header: string | null = null;
    let killPromise: Promise<unknown> | null = null;
    const unsubscribe = onExecSpecStream((payload) => {
        if (header !== null || !payload || payload.type !== 'stdout' || !payload.data) return;
        acc += payload.data;
        const m = ENDDEFS.exec(acc);
        if (m) {
            header = `${acc.slice(0, m.index + m[0].length)}\n`;
            // Com a hierarquia inteira na mao, o fst2vcd para antes do corpo.
            // Kill do filho parqueado SO (nao o cancelVvpProcess, cuja
            // varredura por nome de vvp/gtkwave mataria o GTKWave que este
            // mesmo fluxo abre logo depois).
            killPromise = killCurrentSpecProcess();
        }
    });
    try {
        await runSpecStreamed(spec, { consumeEphemeral: true });
    } catch {
        // segue: o cabecalho pode ter chegado antes de o processo cair
    } finally {
        unsubscribe();
    }
    if (killPromise) { try { await killPromise; } catch { /* melhor esforco */ } }
    // A fronteira pode cair bem quando o processo fecha (um design pequeno que
    // saiu inteiro antes de um pedaco trazer o $enddefinitions): confere de novo.
    if (header === null) {
        const m = ENDDEFS.exec(acc);
        if (m) header = `${acc.slice(0, m.index + m[0].length)}\n`;
    }
    return header;
}

/**
 * Grava em `headerVcdPath` o cabecalho do FST.
 *
 * Sem fluxo ao vivo, ou quando o cabecalho nao apareceu, converte o dump
 * inteiro: correto, mas materializa o VCD de texto, e por isso avisa (a espera
 * pareceria travamento). Um dump que ja e VCD de texto nao passa na conferencia
 * de FST do fst2vcd, e o resultado e false: esse VCD e o proprio cabecalho.
 *
 * @returns true com o cabecalho gravado; false quando nao houve como capturar
 */
export async function extrairCabecalhoDoFst(
    terminal: Pick<TerminalManager, 'appendToTerminal'>,
    fstPath: string, headerVcdPath: string, fst2vcdBin: string, cwd: string,
): Promise<boolean> {
    if (typeof electronAPI.onExecSpecStream === 'function'
        && typeof electronAPI.killCurrentSpecProcess === 'function') {
        const header = await cabecalhoPeloFluxo(fstPath, fst2vcdBin, cwd);
        if (header && header.length > 0) {
            await electronAPI.writeFile(headerVcdPath, header);
            return true;
        }
    }

    terminal.appendToTerminal('twave', tr('terminal.wave.headerFallback'), 'tips');
    const result = await runSpec(
        buildFst2VcdSpec({ fst2vcdBin, inputFile: fstPath, outputFile: headerVcdPath, cwd }),
        { consumeEphemeral: true });
    if (result.code !== 0 && result.code !== null) return false;
    if (!await electronAPI.fileExists(headerVcdPath)) return false;
    // Uma saida limpa ainda pode deixar um arquivo VAZIO (FST corrompido,
    // entrada nao FST que saiu com codigo 0). Sem esta conferencia o resto do
    // fluxo leria zero escopos e geraria um .gtkw vazio sem aviso, e o usuario
    // culparia a propria simulacao.
    try {
        const stats = await electronAPI.getFileStats(headerVcdPath);
        if (!stats || stats.size === 0) return false;
    } catch { /* sem stat, o fileExists ja confirmou que ele existe */ }
    return true;
}
