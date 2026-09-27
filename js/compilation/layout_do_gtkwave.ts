/**
 * layout_do_gtkwave.ts: qual `.gtkw` o GTKWave abre depois do passo Wave.
 *
 * Saiu do compilation_module.js. Duas fontes, nesta ordem:
 *
 *   1. o `.gtkw` que o usuario marcou como ativo no WaveStore (pelo seletor da
 *      barra), conferido contra o dump para avisar de sinal que sumiu; volta
 *      intocado;
 *   2. sem ele, um gerado pelo buildAuroraGtkw: a secao do topo com o que nao e
 *      de processador e uma secao SAPHO completa (cores, apelidos, grupos) por
 *      processador detectado, filtrado pela selecao do picker quando ha uma.
 *
 * Sem nenhum dos dois, o GTKWave abre sem layout. Nada aqui lanca; a
 * precedencia esta explicada no ARCHITECTURE.md, secao 9.
 */

import { electronAPI } from '../app/electron_api.js';
import type { TerminalManager } from './processor_compiler.js';
import { parseProjectSources } from './wave_signal_validator.js';
import { extractSignalRefs } from '../wave/gtkw_writer.js';
import { buildAuroraGtkw, detectProcessors } from '../wave/gtkw_proc_writer.js';
import { getSimulator } from '../wave/simulator_preference.js';
import { parseVcdHeaderFromContent, type VcdScope } from '../wave/vcd_parser.js';
import { WaveStore } from '../wave/wave_state_store.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

type Terminal = Pick<TerminalManager, 'appendToTerminal'>;

/** O que a resolucao le do CompilationModule. */
export interface ContextoDoGtkw {
    projectPath: string;
    componentsPath: string | null;
    projectConfig?: { testbenchFile?: string | null } | null;
    terminalManager: Terminal;
    /** A selecao que o passo Wave acabou de validar, quando houve uma. */
    _validatedWaveSelection?: string[] | null;
}

const nomeDoArquivo = (p: string): string => p.split(/[\\/]/).pop() as string;
const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/** Os cinco primeiros entre aspas, e quantos mais. */
function amostra(lista: string[]): { preview: string; more: string } {
    return {
        preview: lista.slice(0, 5).map((s) => `"${s}"`).join(', '),
        more: lista.length > 5 ? ` (+${lista.length - 5} more)` : '',
    };
}

/** Os caminhos `escopo.sinal` que o cabecalho do dump traz. */
function sinaisNoDump(scopes: VcdScope[]): Set<string> {
    const inVcd = new Set<string>();
    for (const sc of scopes) {
        for (const sig of sc.signals) inVcd.add(`${sc.path}.${sig.name}`);
    }
    return inVcd;
}

/**
 * O cabecalho de texto do dump: o irmao `.header.vcd` quando existe (o FST
 * binario nao se le como texto), o proprio `.vcd` na falta dele. null para um
 * `.fst` sem cabecalho.
 */
async function fonteDoCabecalho(vcdFile: string): Promise<string | null> {
    const headerSibling = vcdFile.replace(/\.(fst|vcd)$/i, '.header.vcd');
    if (await electronAPI.fileExists(headerSibling)) return headerSibling;
    if (vcdFile.toLowerCase().endsWith('.fst')) return null;
    return vcdFile;
}

/**
 * Confere o `.gtkw` do usuario contra o dump: todo caminho citado nele tem de
 * existir no cabecalho, senao o GTKWave mostra um traco vazio sem avisar.
 * Melhor esforco: nao da para conferir sem cabecalho de texto, e falha de
 * leitura vira um aviso so.
 */
export async function conferirGtkwDoUsuario(terminal: Terminal, gtkwPath: string, vcdPath: string): Promise<void> {
    let parseSource: string | null = vcdPath;
    if (vcdPath) {
        parseSource = await fonteDoCabecalho(vcdPath);
        if (!parseSource) return;
    }
    try {
        const gtkwContent = await electronAPI.readFile(gtkwPath, { encoding: 'utf8' });
        const referenced = extractSignalRefs(gtkwContent);
        if (referenced.length === 0) return;
        const vcdContent = await electronAPI.readFile(parseSource as string, { encoding: 'utf8' });
        const inVcd = sinaisNoDump(parseVcdHeaderFromContent(vcdContent));
        const missing = referenced.filter((s) => !inVcd.has(s));
        if (missing.length === 0) return;
        const { preview, more } = amostra(missing);
        const fileName = nomeDoArquivo(gtkwPath);
        const msg = missing.length === 1
            ? tr('terminal.wave.gtkwStaleVcdOne', { preview, file: fileName })
            : tr('terminal.wave.gtkwStaleVcdMany', { count: missing.length, file: fileName, preview, more });
        terminal.appendToTerminal('twave', msg, 'warning');
    } catch (refErr) {
        terminal.appendToTerminal('twave',
            tr('terminal.wave.gtkwPreValidateFailed', {
                file: nomeDoArquivo(gtkwPath), message: (refErr as { message?: string })?.message,
            }),
            'warning');
    }
}

/**
 * A ultima defesa da selecao do picker: sinal selecionado que nao chegou ao
 * dump (testbench que gravou um subconjunto, sinal renomeado entre compilar e
 * simular) vira aviso; o `.gtkw` e escrito do mesmo jeito.
 *
 * Sob o Verilator, os monitores do processador (pilha e ULA, dentro do
 * `.core`) ficam fora do trace, e nao chegam: isso e esperado, e vira uma dica
 * por processador em vez da lista de sinais.
 */
function avisarDaSelecaoQueNaoVeio(terminal: Terminal, selected: string[], scopes: VcdScope[]): void {
    const inVcd = sinaisNoDump(scopes);
    const dropped = selected.filter((s) => !inVcd.has(s));
    if (dropped.length === 0) return;
    const procs = getSimulator() === 'verilator' ? detectProcessors(scopes) : [];
    const affectedProcs = new Map<string, true>(); // preserva a ordem
    const others: string[] = [];
    for (const s of dropped) {
        const proc = /\.core\./.test(s) && procs.find((p) => s.startsWith(`${p.instancePath}.`));
        if (proc) {
            affectedProcs.set(proc.procType || proc.instanceName, true);
        } else {
            others.push(s);
        }
    }
    for (const procName of affectedProcs.keys()) {
        terminal.appendToTerminal('twave', tr('terminal.wave.verilatorNoProcSignals', { proc: procName }), 'tips');
    }
    if (others.length > 0) {
        const { preview, more } = amostra(others);
        const msg = others.length === 1
            ? tr('terminal.wave.staleVcdSignalOne', { preview })
            : tr('terminal.wave.staleVcdSignalMany', { count: others.length, preview, more });
        terminal.appendToTerminal('twave', msg, 'warning');
    }
}

/**
 * Resolve o `.gtkw` que o GTKWave abre. Nunca lanca.
 *
 * @returns o caminho absoluto, ou null para o GTKWave abrir sem layout
 */
export async function resolverLayoutDoGtkwave(
    ctx: ContextoDoGtkw, simTopModule: string, vcdFile: string, tempBaseDir: string,
): Promise<string | null> {
    const terminal = ctx.terminalManager;
    // Cada testbench tem a sua lista de .gtkw no WaveStore.
    const tbKey = (ctx.projectConfig?.testbenchFile || '')
        .split(/[\\/]/).pop()!.replace(/\.[^.]+$/i, '');
    if (tbKey) {
        const state = await WaveStore.get(ctx.projectPath, tbKey);
        const files = state?.gtkwFiles;
        if (Array.isArray(files) && files.length > 0) {
            const gtkwFile = files.find((f) => f && f.isActive === true);
            if (gtkwFile) {
                const userGtkw = gtkwFile.path as string;
                terminal.appendToTerminal('twave',
                    tr('terminal.wave.usingGtkwFile', { name: nomeDoArquivo(userGtkw) }), 'info');
                await conferirGtkwDoUsuario(terminal, userGtkw, vcdFile);
                return userGtkw;
            }
        }
    }

    const autoGtkw = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.gtkw`);
    // A selecao ja validada no passo de instrumentacao; na falta dela (chamada
    // sem esse passo), a que o WaveStore guarda.
    let selected: string[];
    if (Array.isArray(ctx._validatedWaveSelection)) {
        selected = ctx._validatedWaveSelection;
    } else if (tbKey) {
        const tbState = await WaveStore.get(ctx.projectPath, tbKey);
        selected = Array.isArray(tbState?.waveSignals) ? tbState.waveSignals : [];
    } else {
        selected = [];
    }
    const parseSource = await fonteDoCabecalho(vcdFile);
    if (!parseSource) {
        terminal.appendToTerminal('twave',
            tr('terminal.wave.autoGtkwError', { message: 'no parseable header (.header.vcd missing); GTKWave opens .fst without auto-gtkw' }),
            'tips');
        return null;
    }
    try {
        const vcdContent = await electronAPI.readFile(parseSource, { encoding: 'utf8' });
        const scopes = parseVcdHeaderFromContent(vcdContent);
        const binDir = await electronAPI.joinPath(ctx.componentsPath as string, 'bin');

        if (selected.length > 0) avisarDaSelecaoQueNaoVeio(terminal, selected, scopes);

        // As fontes Verilog do projeto dao as declaracoes `signed` (o formato
        // de cada barramento) e o modulo de cada escopo (o procType certo, a
        // pasta Temp/<procType>/ onde o compilador escreveu os tradutores).
        // Falha vira null, e o construtor cai nas heuristicas pelo nome.
        const modules = await parseProjectSources({
            projectConfig: ctx.projectConfig as Parameters<typeof parseProjectSources>[0]['projectConfig'],
            componentsPath: ctx.componentsPath,
            terminalManager: terminal,
        });

        const result = buildAuroraGtkw({
            vcdPath: vcdFile,
            gtkwPath: autoGtkw,
            scopes,
            tbModule: simTopModule,
            tempBaseDir,
            binDir,
            selectedSignals: selected.length > 0 ? selected : null,
            modules,
        });
        if (!result.content) return null;

        await electronAPI.writeFile(autoGtkw, result.content);
        const procPart = result.processorCount > 0
            ? plural(result.processorCount, 'processor', 'processors')
            : 'flat layout';
        const selPart = selected.length > 0 ? `, ${plural(selected.length, 'signal', 'signals')} from picker` : '';
        terminal.appendToTerminal('twave',
            tr('terminal.wave.autoGtkwLayout', { detail: `${procPart}${selPart}` }), 'info');
        return autoGtkw;
    } catch (err) {
        terminal.appendToTerminal('twave',
            tr('terminal.wave.autoGtkwError', { message: (err as { message?: string })?.message }), 'warning');
        return null;
    }
}
