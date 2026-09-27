/**
 * layout_do_surfer.ts: qual layout o Surfer abre depois do passo Wave.
 *
 * Saiu do compilation_module.js. Duas fontes, nesta ordem:
 *
 *   1. o layout que o usuario marcou como ativo no WaveStore (um estado
 *      `.surf.ron` ou um arquivo de comandos `.sucl`);
 *   2. sem ele, um `.surf.ron` gerado pelo buildSurferLayout, o espelho
 *      declarativo do `.gtkw` automatico: a mesma selecao do picker e a mesma
 *      deteccao de processadores (secoes, cores, formatos, analogico), com os
 *      tradutores do YANC (opcode e linha de C+-) e os complexos decodificados.
 *
 * Sem nenhum dos dois o Surfer abre o dump cru. Nada aqui lanca: toda falha
 * vira dica no terminal Wave e o visualizador abre do mesmo jeito.
 */

import { electronAPI } from '../app/electron_api.js';
import type { TerminalManager } from './processor_compiler.js';
import { runSpecStreamed } from './spec_runner.js';
import { parseProjectSources } from './wave_signal_validator.js';
import { parseVcdHeaderFromContent } from '../wave/vcd_parser.js';
import { detectProcessors, resolveScopeModules } from '../wave/gtkw_proc_writer.js';
import { buildSurferLayout } from '../wave/surfer_layout_writer.js';
import { hasComplexSignals, ComplexVcdScanner, buildComplexMapping } from '../wave/complex_decode.js';
import { WaveStore } from '../wave/wave_state_store.js';

type Mapeamento = { name: string; content: string };

/** O que a resolucao le do CompilationModule. */
export interface ContextoDoLayout {
    projectPath: string;
    componentsPath: string | null;
    projectConfig?: Parameters<typeof parseProjectSources>[0]['projectConfig'] & { testbenchFile?: string | null };
    terminalManager: Pick<TerminalManager, 'appendToTerminal'>;
    /** A selecao que o passo Wave acabou de validar, quando houve uma. */
    _validatedWaveSelection?: string[] | null;
}

/**
 * O caminho do layout e os tradutores que a aba do Surfer precisa levar.
 *
 * Os tradutores vao a parte porque o cliente WASM da aba nao le a pasta de
 * mapeamentos do disco: eles seguem por HTTP local. Vem vazios quando o layout
 * nao foi gerado aqui, para a aba nao herdar os da corrida anterior.
 */
export interface LayoutDoSurfer {
    caminho: string | null;
    mapeamentos: Mapeamento[];
}

/**
 * Um prefixo curto e estavel por projeto (FNV-1a do caminho). Os mapeamentos
 * do Surfer moram numa pasta GLOBAL e plana, e sem ele dois projetos com o
 * mesmo topo de testbench se sobrescreviam.
 */
export function prefixoDoProjeto(projectPath: string | null | undefined): string {
    const s = String(projectPath || '');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0');
}

const nomeDoArquivo = (p: string): string => p.split(/[\\/]/).pop() as string;
const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/** A fonte 1: o layout ativo do usuario no WaveStore, se houver. */
async function layoutAtivoDoUsuario(ctx: ContextoDoLayout, tbKey: string): Promise<string | null> {
    if (!tbKey) return null;
    const state = await WaveStore.get(ctx.projectPath, tbKey);
    const files = state?.surferFiles;
    if (!Array.isArray(files) || files.length === 0) return null;
    const active = files.find((f) => f && f.isActive === true);
    if (!active || !active.path) return null;
    return active.path as string;
}

/**
 * Os tradutores do YANC de cada tipo de processador (Temp/<procType>/), e o
 * mais novo deles, para o aviso de dump velho. Tradutor ausente deixa aquela
 * trilha em decimal cru, nunca e fatal.
 */
async function lerTradutores(
    tempBaseDir: string, processadores: Array<{ procType?: string } | null | undefined>,
): Promise<{ tradByProcType: Record<string, { opcode: string | null; cmm: string | null }>; maisNovo: number }> {
    const tradByProcType: Record<string, { opcode: string | null; cmm: string | null }> = {};
    let maisNovo = 0;
    for (const p of processadores) {
        if (!p || !p.procType || tradByProcType[p.procType]) continue;
        const procDir = await electronAPI.joinPath(tempBaseDir, p.procType);
        const opPath = await electronAPI.joinPath(procDir, 'trad_opcode.txt');
        const cmPath = await electronAPI.joinPath(procDir, 'trad_cmm.txt');
        const opExists = await electronAPI.fileExists(opPath);
        const cmExists = await electronAPI.fileExists(cmPath);
        tradByProcType[p.procType] = {
            opcode: opExists ? await electronAPI.readFile(opPath) : null,
            cmm: cmExists ? await electronAPI.readFile(cmPath) : null,
        };
        for (const present of [opExists ? opPath : null, cmExists ? cmPath : null]) {
            if (!present) continue;
            try {
                const st = await electronAPI.getFileStats(present);
                if (st && (st.mtime as number) > maisNovo) maisNovo = st.mtime as number;
            } catch { /* sem stat -> ignora */ }
        }
    }
    return { tradByProcType, maisNovo };
}

/**
 * Anti-staleness: tradutor MAIS NOVO que o dump quer dizer que o usuario
 * recompilou o .cmm sem re-simular, e o decode casaria o dump VELHO com a
 * tabela NOVA, lixo crivel (pior que decimal cru). A margem de 2 s cobre a
 * ordem normal compilar e simular, em que o tradutor fica um pouco mais velho.
 */
async function avisarSeTradutorMaisNovo(ctx: ContextoDoLayout, vcdFile: string, maisNovo: number): Promise<void> {
    if (maisNovo <= 0) return;
    try {
        const fstStat = await electronAPI.getFileStats(vcdFile);
        if (fstStat && maisNovo > (fstStat.mtime as number) + 2000) {
            ctx.terminalManager.appendToTerminal('twave',
                'Surfer: os tradutores Assembly/C+- sao mais novos que o dump — recompilou sem re-simular? O decode pode estar desatualizado; re-simule para alinhar.', 'tips');
        }
    } catch { /* sem stat do FST -> pula o check */ }
}

/**
 * Resolve o layout que o Surfer carrega. Nunca lanca.
 */
export async function resolverLayoutDoSurfer(
    ctx: ContextoDoLayout, simTopModule: string, vcdFile: string, tempBaseDir: string,
): Promise<LayoutDoSurfer> {
    const tbKey = (ctx.projectConfig?.testbenchFile || '')
        .split(/[\\/]/).pop()!.replace(/\.[^.]+$/i, '');
    let mapeamentos: Mapeamento[] = [];

    const doUsuario = await layoutAtivoDoUsuario(ctx, tbKey);
    if (doUsuario) {
        ctx.terminalManager.appendToTerminal('twave', `Surfer layout: ${nomeDoArquivo(doUsuario)}`, 'info');
        return { caminho: doUsuario, mapeamentos };
    }

    const autoSurfer = await electronAPI.joinPath(tempBaseDir, `${simTopModule}.surf.ron`);
    let selected: string[];
    if (Array.isArray(ctx._validatedWaveSelection)) {
        selected = ctx._validatedWaveSelection;
    } else if (tbKey) {
        const tbState = await WaveStore.get(ctx.projectPath, tbKey);
        selected = Array.isArray(tbState?.waveSignals) ? tbState.waveSignals : [];
    } else {
        selected = [];
    }
    // Os escopos saem do cabecalho em texto (o irmao .header.vcd, porque o FST
    // binario nao se le como texto). Mesma guarda do .gtkw automatico.
    let parseSource = vcdFile;
    const headerSibling = vcdFile.replace(/\.(fst|vcd)$/i, '.header.vcd');
    if (await electronAPI.fileExists(headerSibling)) {
        parseSource = headerSibling;
    } else if (vcdFile.toLowerCase().endsWith('.fst')) {
        return { caminho: null, mapeamentos };
    }
    try {
        const vcdContent = await electronAPI.readFile(parseSource, { encoding: 'utf8' });
        const scopes = parseVcdHeaderFromContent(vcdContent);
        const modules = await parseProjectSources(ctx);

        const scopeModules = modules ? resolveScopeModules(scopes, modules) : null;
        const { tradByProcType, maisNovo } = await lerTradutores(tempBaseDir, detectProcessors(scopes, scopeModules));
        await avisarSeTradutorMaisNovo(ctx, vcdFile, maisNovo);

        const nsTag = prefixoDoProjeto(ctx.projectPath);

        // Complexos (comp_me3_/comp_arr_me3_): o Surfer nao tem o filtro de
        // processo externo do GTKWave, entao os valores distintos do dump sao
        // decodificados antes e viram um mapeamento. Projeto sem complexo nao
        // paga o fst2vcd do corpo inteiro.
        const complexMapping = hasComplexSignals(scopes)
            ? await mapeamentoDosComplexos(ctx, vcdFile, simTopModule, tempBaseDir, nsTag)
            : null;

        const { content, processorCount, mappings } = buildSurferLayout({
            vcdPath: vcdFile,
            scopes,
            tbModule: simTopModule,
            selectedSignals: selected.length > 0 ? selected : null,
            modules,
            tradByProcType,
            mappingNamespace: `${nsTag}_${simTopModule}`,
            complexMapping,
        });
        if (!content) return { caminho: null, mapeamentos };
        mapeamentos = Array.isArray(mappings) ? mappings : [];
        await electronAPI.writeFile(autoSurfer, content);
        // O Surfer le a pasta global de mapeamentos ao subir: os tradutores vao
        // para o disco agora, antes de lancar, para as trilhas abrirem decodificadas.
        if (Array.isArray(mappings) && mappings.length > 0) {
            const wr = await electronAPI.writeSurferMappings(mappings);
            // Tradutor que nao gravou (permissao, disco) deixa a trilha em
            // decimal cru; avisar e melhor que falhar mudo.
            if (wr && Array.isArray(wr.failed) && wr.failed.length > 0) {
                ctx.terminalManager.appendToTerminal('twave',
                    `Surfer: ${wr.failed.length} mapping translator(s) nao escritos — esses tracks abrem em decimal cru.`, 'tips');
            }
        }
        const procPart = processorCount > 0 ? plural(processorCount, 'processor', 'processors') : 'flat layout';
        const selPart = selected.length > 0 ? `, ${plural(selected.length, 'signal', 'signals')} from picker` : '';
        const decodePart = (Array.isArray(mappings) && mappings.length > 0)
            ? `, ${plural(mappings.length, 'decode map', 'decode maps')}`
            : '';
        ctx.terminalManager.appendToTerminal('twave',
            `Surfer layout auto-generated (${procPart}${selPart}${decodePart}).`, 'info');
        return { caminho: autoSurfer, mapeamentos };
    } catch (err) {
        ctx.terminalManager.appendToTerminal('twave',
            `Surfer auto-layout failed (${(err as { message?: string })?.message}) — opening raw VCD.`, 'tips');
        return { caminho: null, mapeamentos };
    }
}

/**
 * O mapeamento dos complexos para o Surfer: o fst2vcd em fluxo sobre o FST,
 * os valores DISTINTOS dos sinais complexos, o decode canonico pelo
 * comp2gtkw.exe e um tradutor unico (padrao de bits para "re imi"). Melhor
 * esforco: qualquer falha devolve null e os complexos abrem em Binary cru.
 */
export async function mapeamentoDosComplexos(
    ctx: Pick<ContextoDoLayout, 'componentsPath' | 'terminalManager'>,
    fstPath: string, simTopModule: string, tempBaseDir: string, nsTag = '',
): Promise<Mapeamento | null> {
    try {
        if (typeof electronAPI.onExecSpecStream !== 'function') return null;
        const componentsPath = ctx.componentsPath as string;
        const fst2vcdBin = await electronAPI.joinPath(componentsPath, 'Packages', 'gtkwave-nipscern', 'fst2vcd.exe');
        const comp2gtkwExe = await electronAPI.joinPath(componentsPath, 'bin', 'comp2gtkw.exe');
        // Sem o decodificador ou o fst2vcd nao adianta varrer o FST inteiro: um
        // aviso, e os complexos em Binary cru, em vez de degradar calado (era
        // o buraco: a pessoa via binario cru no Surfer e nao sabia por que).
        if (!await electronAPI.fileExists(comp2gtkwExe)) {
            ctx.terminalManager.appendToTerminal('twave',
                'Surfer: comp2gtkw.exe nao encontrado em components/bin/ — numeros complexos abrem em Binary cru.', 'tips');
            return null;
        }
        if (!await electronAPI.fileExists(fst2vcdBin)) {
            ctx.terminalManager.appendToTerminal('twave',
                'Surfer: fst2vcd.exe nao encontrado — decode de complexos pulado (Binary cru).', 'tips');
            return null;
        }
        const scanner = new ComplexVcdScanner();
        let killed = false;
        const unsubscribe = electronAPI.onExecSpecStream((payload) => {
            if (!payload || payload.type !== 'stdout' || !payload.data) return;
            scanner.feed(payload.data);
            // No limite, o fst2vcd para cedo: kill do filho parqueado, e nao a
            // varredura por nome, que mataria o visualizador deste mesmo fluxo.
            if (!killed && scanner.wasCapped() && typeof electronAPI.killCurrentSpecProcess === 'function') {
                killed = true;
                electronAPI.killCurrentSpecProcess();
            }
        });
        try {
            await runSpecStreamed({
                step: 'fst2vcd',
                binary: fst2vcdBin,
                args: ['-f', fstPath],
                cwd: tempBaseDir,
                label: 'fst2vcd (complex decode — valores distintos)',
            }, { consumeEphemeral: true });
        } catch { /* melhor esforco: pode ter coletado antes de lancar */ }
        finally { unsubscribe(); }
        scanner.end();

        const values = scanner.distinctValues();
        if (values.length === 0) return null;
        const res = await electronAPI.decodeComplex({ exePath: comp2gtkwExe, values });
        if (!res || !res.success || !Array.isArray(res.decoded)) return null;
        const decodedByValue = new Map<string, string>();
        const n = Math.min(values.length, res.decoded.length);
        for (let i = 0; i < n; i++) decodedByValue.set(values[i], res.decoded[i]);
        const name = `aurora_cpx_${nsTag}_${simTopModule}`.replace(/[^A-Za-z0-9_]/g, '_');
        const mapping = buildComplexMapping(name, decodedByValue);
        if (mapping) {
            ctx.terminalManager.appendToTerminal('twave',
                `Surfer complex decode: ${decodedByValue.size} valor${decodedByValue.size === 1 ? '' : 'es'}${scanner.wasCapped() ? ' (limitado)' : ''}.`, 'info');
        }
        return mapping;
    } catch (err) {
        ctx.terminalManager.appendToTerminal('twave',
            `Surfer complex decode skipped (${(err as { message?: string })?.message}) — complexos em Binary.`, 'tips');
        return null;
    }
}
