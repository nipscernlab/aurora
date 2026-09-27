/**
 * preparo_da_onda.ts: o que o botao Wave faz antes de qualquer simulador.
 *
 * Saiu do compilation_module.js. Resolve quem manda no $dumpvars (o .gtkw
 * ativo, a Wave Configuration, o $dumpvars do proprio testbench ou o padrao;
 * a regra e o resolveWaveSelection), instrumenta uma copia do testbench na
 * Temp com o $dumpfile/$dumpvars escolhido (o .v do usuario nunca e tocado),
 * avisa do testbench que nunca termina e confere os $fopen de leitura.
 */

import { electronAPI } from '../app/electron_api.js';
import type { TerminalManager } from './processor_compiler.js';
import { resolveWaveSelection, type DecisaoDaOnda } from './wave_signal_validator.js';
import { extractFopenReads } from '../wave/fopen_paths.js';
import { instrumentTestbenchSource } from '../wave/testbench_instrumenter.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

type Terminal = Pick<TerminalManager, 'appendToTerminal'>;

/** O que o preparo le (e escreve) do CompilationModule. */
export interface ContextoDoPreparo {
    projectPath: string;
    componentsPath: string | null;
    terminalManager: Terminal;
    /** A selecao que o layout automatico do .gtkw e do Surfer le depois. */
    _validatedWaveSelection?: string[] | null;
    /** O aviso de testbench sem fim sai uma vez por compilacao. */
    _avisouSemFinish?: boolean;
}

/** A configuracao ja validada, no que o preparo le. */
export interface ConfigDoPreparo {
    testbenchFile: string | null;
    synthesizableFiles: string[];
}

/**
 * Os .v da biblioteca HDL do SAPHO, sem os testbenches dela. Entram na
 * validacao da selecao para que sinais de pilha, ULA e SAPHO nao sejam
 * descartados como velhos. Pasta que nao se deixa listar fica de fora.
 */
export async function arquivosDaBibliotecaHdl(hdlPath: string): Promise<string[]> {
    const caminhos: string[] = [];
    try {
        const hdlEntries: unknown = await electronAPI.listFilesInDirectory(hdlPath);
        if (Array.isArray(hdlEntries)) {
            for (const name of hdlEntries) {
                if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                    caminhos.push(await electronAPI.joinPath(hdlPath, name));
                }
            }
        }
    } catch (_e) { /* HDL nao acessivel, segue sem */ }
    return caminhos;
}

/** A linha "Wave source: ..." do TWAVE: qual eixo ditou a selecao. */
export function anunciarFonteDaSelecao(terminal: Terminal, decision: DecisaoDaOnda): void {
    const rotulos: Record<string, string> = {
        gtkw: tr('terminal.wave.sourceLabelGtkw', { count: decision.signalsToDump.length }),
        wc: tr('terminal.wave.sourceLabelWc', { count: decision.signalsToDump.length }),
        tb: tr('terminal.wave.sourceLabelTb'),
        default: tr('terminal.wave.sourceLabelDefault'),
    };
    const sourceLabel = rotulos[decision.source] || decision.source;
    terminal.appendToTerminal('twave', tr('terminal.wave.waveSource', { label: sourceLabel }), 'info');
}

/**
 * Avisa, uma vez por compilacao, que o testbench nao manda a simulacao parar.
 *
 * Nao ha timeout no caminho de simulacao: o vvp e o binario do Verilator rodam
 * sem limite de tempo, entao um testbench com clock livre e sem $finish roda
 * ate a pessoa apertar Cancelar. Quem esta aprendendo le isso como "a AURORA
 * travou" e mata o processo, e o dump sai truncado ou nem existe. So avisa
 * quando as DUAS coisas valem (mayRunForever no instrumentador); testbench que
 * termina sozinho nao recebe nada, senao o aviso viraria ruido.
 */
function avisarSeNaoTermina(ctx: ContextoDoPreparo, testbenchPath: string, mayRunForever: boolean): void {
    if (!mayRunForever || ctx._avisouSemFinish) return;
    ctx._avisouSemFinish = true;
    const file = String(testbenchPath || '').split(/[\\/]/).pop();
    ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.noFinish', { file }), 'warning');
}

/**
 * Le o testbench, decide pelo testbench_instrumenter se e como injetar o
 * $dumpfile/$dumpvars, e escreve o resultado em Temp/instr_<nome>. Devolve o
 * caminho que o simulador compila: o original (o usuario ja escreveu o dump,
 * ou o arquivo esta malformado) ou a copia instrumentada.
 */
export async function instrumentarTestbench(
    ctx: ContextoDoPreparo, testbenchPath: string, tbModule: string, tempBaseDir: string,
    selectedSignals: string[] = [], overrideUserDumpvars = false,
    monitorScopes: DecisaoDaOnda['monitorScopes'] = [],
): Promise<{ path: string; reason: string }> {
    const originalContent = await electronAPI.readFile(testbenchPath, { encoding: 'utf8' });
    const result = instrumentTestbenchSource({
        originalContent,
        tbModule,
        selectedSignals,
        overrideUserDumpvars,
        monitorScopes,
    });
    avisarSeNaoTermina(ctx, testbenchPath, result.mayRunForever);
    if (!result.needsWrite) return { path: testbenchPath, reason: result.reason };

    const basename = testbenchPath.split(/[\\/]/).pop();
    const instrumentedPath = await electronAPI.joinPath(tempBaseDir, `instr_${basename}`);

    // So escreve se o conteudo mudou. O make do Verilator decide pelo mtime:
    // reescrever o mesmo conteudo a cada Wave faria ele recompilar tudo (5 a
    // 15 s jogados fora). A existencia vem antes da leitura para nao encher o
    // log do main de ENOENT.
    if (await electronAPI.fileExists(instrumentedPath)) {
        try {
            const existing = await electronAPI.readFile(instrumentedPath, { encoding: 'utf8' });
            if (existing === result.content) {
                return { path: instrumentedPath, reason: result.reason };
            }
        } catch (_e) { /* a leitura falhou depois de existir: corrida ou disco; escreve */ }
    }

    await electronAPI.writeFile(instrumentedPath, result.content);
    return { path: instrumentedPath, reason: result.reason };
}

/**
 * Os $fopen de leitura do testbench, conferidos ANTES de simular. Um `define
 * apontando para a pasta antiga do projeto fez um $fopen devolver 0 e a
 * simulacao rodar 90 segundos lendo entrada vazia; o simulador nao tem como
 * avisar antes, a AURORA tem. So caminhos que resolvem para literal entram
 * (fopen_paths.ts), porque um aviso errado ensina a ignorar o certo. Aviso,
 * nunca bloqueio: o dono do testbench pode saber algo que nos nao sabemos.
 */
async function conferirFopenDeLeitura(terminal: Terminal, testbenchPath: string): Promise<void> {
    try {
        const fonteTb = await electronAPI.readFile(testbenchPath, { encoding: 'utf8' });
        for (const { path: alvo } of extractFopenReads(fonteTb)) {
            if (!(await electronAPI.fileExists(alvo))) {
                terminal.appendToTerminal('twave', tr('terminal.wave.fopenMissing', { path: alvo }), 'warning');
            }
        }
    } catch (_e) { /* conferencia e cortesia; sem ela a simulacao segue igual */ }
}

/**
 * O preparo inteiro: resolve a selecao, instrumenta o testbench e monta o
 * conjunto de fontes (sintetizaveis + testbench instrumentado), que e o que o
 * simulador compila. Guarda na instancia a selecao usada (vazia quando o
 * testbench manda no dump, e o .gtkw automatico mostra tudo).
 */
export async function prepararWave(
    ctx: ContextoDoPreparo, config: ConfigDoPreparo, simTopModule: string, tempBaseDir: string,
): Promise<{ fileSet: Set<string>; instrumentedTbPath: string; decision: DecisaoDaOnda }> {
    const testbenchFile = config.testbenchFile as string;
    const filePaths = new Set(config.synthesizableFiles);
    if (config.testbenchFile) filePaths.add(config.testbenchFile);
    try {
        const hdlPath = await electronAPI.joinPath(ctx.componentsPath as string, 'HDL');
        for (const p of await arquivosDaBibliotecaHdl(hdlPath)) filePaths.add(p);
    } catch (_e) { /* HDL nao acessivel, segue sem */ }

    const decision = await resolveWaveSelection(ctx, {
        config: config as ConfigDoPreparo & { testbenchFile: string },
        simTopModule,
        filePaths: [...filePaths],
    });

    const { path: tbPath, reason } = await instrumentarTestbench(
        ctx, testbenchFile, simTopModule, tempBaseDir,
        decision.signalsToDump, decision.overrideUserDumpvars, decision.monitorScopes || [],
    );

    ctx._validatedWaveSelection = reason === 'user-defined' ? [] : decision.signalsToDump;
    anunciarFonteDaSelecao(ctx.terminalManager, decision);
    if (reason === 'override-user') {
        ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.overrideUserDumpvars'), 'tips');
    }

    const fileSet = new Set(config.synthesizableFiles);
    fileSet.add(tbPath);
    await conferirFopenDeLeitura(ctx.terminalManager, testbenchFile);
    return { fileSet, instrumentedTbPath: tbPath, decision };
}
