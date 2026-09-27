/**
 * abrir_onda.ts: a ultima etapa do botao Wave e da onda do PRISM, abrir o
 * visualizador.
 *
 * Saiu do compilation_module.js. GTKWave ou Surfer, e o Surfer numa aba do
 * editor ou na janela nativa, conforme as preferencias. Cada caminho tem uma
 * queda: a aba que nao abre cai para a janela, e a janela do Surfer que nao
 * abre cai para o GTKWave, para o botao Wave nunca ficar sem visualizador.
 *
 * Aqui tambem mora o ouvinte do "salvar" de dentro da aba do Surfer, que
 * registra o estado gravado como o layout ativo do testbench.
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { buildGtkwaveSpec } from './builders/index.js';
import { applyResolved } from './command_overrides.js';
import { basenameOfPath } from './compilation_helpers.js';
import type { TerminalManager } from './processor_compiler.js';
import { resolveWaveToolchain } from './wave_toolchain.js';
import { montarLayoutDaOndaDoPrism, type SinalDoMonitor } from '../wave/prism_wave_layout.js';
import { getSurferMultiWindow } from '../wave/surfer_window_preference.js';
import { getSurferInTab } from '../wave/surfer_tab_preference.js';
import { getSurferMode, getViewer } from '../wave/viewer_preference.js';
import { WaveStore } from '../wave/wave_state_store.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** O `e?.message || e` de sempre: mensagem vazia cai no proprio valor. */
const motivoDe = (e: unknown): unknown => (e as { message?: string } | null)?.message || e;

/** Os binarios e a pasta de trabalho, como resolveWaveToolchain os devolve. */
export interface FerramentasDaOnda {
    gtkwaveBin: string;
    surferBin: string;
    tempBaseDir: string;
}

/** O que a abertura le do CompilationModule. */
export interface ContextoDaOnda {
    projectPath: string;
    componentsPath: string | null;
    projectConfig?: { testbenchFile?: string } | null;
    terminalManager: Pick<TerminalManager, 'appendToTerminal'>;
    /** Os tradutores que o layout automatico acabou de gerar, para a aba levar. */
    _surferTabMappings?: Array<{ name: string; content: string }>;
    initializeComponentsPath(): Promise<unknown>;
}

export interface OpcoesDoSurfer {
    /** A onda nao e de um testbench (a do PRISM): nada de salvar estado. */
    semEstado?: boolean;
}

// ─── Estado salvo dentro da aba do Surfer ───────────────────────────────────
// tabId → { projectPath, tbKey, name }. Preenchido a cada abertura de aba;
// quando o main avisa que um POST de estado foi gravado, este ouvinte registra
// o arquivo no WaveStore como o layout ATIVO daquele testbench, e o próximo
// Wave já abre com ele.
//
// O ouvinte é único e mora no import do módulo, e não numa instância: a aba do
// Surfer sobrevive a recompilações (o tabId é estável por onda), então um
// ouvinte por instância acumularia um por compilação e o mesmo salvamento
// seria registrado várias vezes. O aviso vai para o terminal da instância mais
// recente, que é a que a janela mostra.
const surferTabSaveCtx = new Map<string, { projectPath: string; tbKey: string; name: string }>();
const terminalDaUltima = () => window._latestCompilationModule?.terminalManager;
if (typeof window !== 'undefined' && electronAPI.onSurferTabStateSaved) {
    electronAPI.onSurferTabStateSaved(async ({ tabId, path: savedPath }) => {
        const ctx = surferTabSaveCtx.get(tabId);
        if (!ctx) return;
        try {
            await WaveStore.update(ctx.projectPath, ctx.tbKey, (cfg) => {
                const files = Array.isArray(cfg.surferFiles) ? cfg.surferFiles : [];
                let entry = files.find((f) => f?.path === savedPath);
                if (!entry) {
                    entry = { name: ctx.name, path: savedPath, isActive: false };
                    files.push(entry);
                }
                for (const f of files) f.isActive = (f === entry);
                cfg.surferFiles = files;
            });
            terminalDaUltima()?.appendToTerminal?.('twave', tr('terminal.wave.surferTabStateSaved'), 'success');
        } catch (e) {
            // O arquivo ESTA salvo; o que falhou foi anotá-lo no projeto. Dizer
            // as duas coisas evita a pessoa salvar de novo achando que perdeu.
            const motivo = motivoDe(e);
            terminalDaUltima()?.appendToTerminal?.('twave',
                `Estado salvo em ${savedPath}, mas o registro no projeto falhou: ${motivo}`, 'error');
        }
    });
}

/**
 * Abre o GTKWave no dump, com o `.gtkw` quando ha um.
 *
 * O GTKWave sobe destacado pelo `launch-gtkwave-only`, fora do executor de
 * specs, mas o spec passa pelos overrides como qualquer passo, para que o que
 * a IA registrou para o `gtkwave` valha aqui tambem.
 *
 * @throws quando o main nao conseguiu lancar
 */
export async function lancarGtkwave(
    ctx: ContextoDaOnda, vcdFile: string, gtkwSaveFile: string | null, tools: FerramentasDaOnda,
): Promise<void> {
    ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.launching'), 'info');

    const baseSpec = buildGtkwaveSpec({
        gtkwaveBin: tools.gtkwaveBin,
        vcdFile,
        gtkwSaveFile: gtkwSaveFile || undefined,
        cwd: tools.tempBaseDir,
    });
    const resolved = await applyResolved(baseSpec, { consumeEphemeral: true });
    const finalSpec = resolved.appliedSpec;
    // O binario e os args do spec resolvido vao inteiros. Renderizar para
    // string e reparsear perdia as aspas de um caminho sem espaco, e o IPC
    // antigo recusava com "Invalid GTKWave command format". Os args ja sao
    // exatamente o que o spawn precisa ('--script=PATH' continua um token).
    const gtkwaveResult = await electronAPI.launchGtkwaveOnly({
        gtkwaveBin: finalSpec.binary,
        args: finalSpec.args,
        workingDir: tools.tempBaseDir,
    });
    if (!gtkwaveResult.success) {
        throw new Error(tr('error.compilation.gtkwaveFailed', { message: gtkwaveResult.message }));
    }
    ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.launched'), 'success');
}

/**
 * Abre o Surfer (surfer-aurora.exe, o fork do NIPS-CERN em
 * gitlab.com/nips-cern/surfer-aurora), na aba quando a preferencia manda e na
 * janela nativa quando nao, com o layout ativo quando ha um: um estado salvo
 * `.surf.ron` (via -s) ou um arquivo de comandos `.sucl` (via -c). Sem o
 * binario, cai para o GTKWave sem layout e diz no terminal o que faltou.
 */
export async function lancarSurfer(
    ctx: ContextoDaOnda, vcdFile: string, surferLayoutFile: string | null,
    tools: FerramentasDaOnda, opts: OpcoesDoSurfer = {},
): Promise<void> {
    ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.surferLaunching'), 'info');

    // Preferencia "Surfer em aba" (default): a onda abre dentro do editor, via
    // servidor headless + cliente WASM (main/ipc/surfer_tab.js). Se qualquer
    // ponta faltar (bundle web nao instalado, servidor nao sobe), cai para a
    // janela nativa logo abaixo, que e o caminho de sempre.
    if (getSurferInTab()) {
        if (await abrirAbaDoSurfer(ctx, vcdFile, surferLayoutFile, tools, opts)) return;
    }
    // O layout vai depois do VCD posicional. O VCD da linha de comando vence
    // o caminho gravado dentro de um estado, entao um .surf.ron registrado
    // continua valendo entre corridas (os itens se religam pelo nome).
    const args = [vcdFile];
    if (surferLayoutFile) {
        const flag = /\.sucl$/i.test(surferLayoutFile) ? '-c' : '-s';
        args.push(flag, surferLayoutFile);
    }
    const result = await electronAPI.launchSurfer({
        surferBin: tools.surferBin,
        args,
        workingDir: tools.tempBaseDir,
        // Preferencia do usuario (modal Wave Config): true = manter varias janelas
        // abertas (comparar simulacoes); false (default) = uma janela so (o main
        // fecha a anterior antes de abrir a nova).
        multiWindow: getSurferMultiWindow(),
    });
    if (!result.success) {
        ctx.terminalManager.appendToTerminal(
            'twave',
            `Surfer unavailable (${result.message}) — opening GTKWave instead. ` +
            'Drop surfer-aurora.exe in components/Packages/surfer/ to use Surfer.',
            'tips',
        );
        await lancarGtkwave(ctx, vcdFile, null, tools);
        return;
    }
    ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.surferLaunched'), 'success');
}

/**
 * Abre a onda numa aba do editor (cliente WASM do Surfer + servidor local).
 *
 * Os layouts vao inteiros: um `.sucl` pelos startup_commands e um `.surf.ron`
 * pelo load_state_from_url, o comando que o fork acrescentou ao cliente WASM
 * justamente para isso, e o layout curado abre na aba igual abre na janela.
 *
 * @returns true com a aba aberta; false manda usar a janela, com o motivo ja
 *          no terminal.
 */
export async function abrirAbaDoSurfer(
    ctx: ContextoDaOnda, vcdFile: string, surferLayoutFile: string | null,
    tools: FerramentasDaOnda, opts: OpcoesDoSurfer = {},
): Promise<boolean> {
    // A escolha das Configuracoes vem antes da disponibilidade: quem pediu a
    // janela nativa recebe a janela nativa, mesmo com o bundle web presente.
    if (getSurferMode() === 'window') {
        ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.surferWindowByChoice'), 'tips');
        return false;
    }
    const available = await electronAPI.surferTabAvailable?.();
    if (!available) {
        ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.surferTabNoBundle'), 'tips');
        return false;
    }

    const isSucl = !!surferLayoutFile && /\.sucl$/i.test(surferLayoutFile);

    // Um id estavel por onda: recompilar reusa a aba e o main troca o servidor.
    const tabId = 'wave:' + vcdFile;

    // Onde o "salvar" de dentro da aba grava: um arquivo fixo por testbench, na
    // mesma pasta do estado do Wave Config. Salvar de novo sobrescreve, que e o
    // que se espera de um salvar.
    //
    // A onda pode nao vir do passo Wave: a da simulacao do PRISM chega aqui
    // sem que nenhuma compilacao tenha rodado nesta sessao, e ai
    // `projectConfig` ainda e nulo. Sem testbench nao ha estado a salvar, que
    // e o mesmo caso do `semEstado`.
    const tbKey = (ctx.projectConfig?.testbenchFile || '')
        .split(/[\\/]/).pop()!.replace(/\.[^.]+$/i, '');
    let stateSavePath: string | null = null;
    if (tbKey && ctx.projectPath && !opts.semEstado) {
        const stateName = `${tbKey}.tab.surf.ron`;
        // A MESMA pasta do estado de onda, pela constante e nao pelo literal:
        // eram dois lugares dizendo a pasta de forma independente, e mover um
        // sem o outro deixaria o layout gravado numa pasta e registrado noutra.
        stateSavePath = await electronAPI.joinPath(ctx.projectPath, WaveStore.STATE_DIRNAME, stateName);
        surferTabSaveCtx.set(tabId, { projectPath: ctx.projectPath, tbKey, name: stateName });
    }

    const result = await electronAPI.surferTabServe({
        surferBin: tools.surferBin,
        waveFile: vcdFile,
        tabId,
        suclFile: isSucl ? surferLayoutFile : null,
        stateFile: !isSucl ? surferLayoutFile : null,
        mappings: ctx._surferTabMappings || [],
        stateSavePath,
    });
    if (!result?.success) {
        ctx.terminalManager.appendToTerminal('twave',
            `Surfer tab unavailable (${result?.message || 'unknown'}) — opening the window instead.`,
            'tips');
        return false;
    }

    TabManager.openSurferWave(vcdFile, result.pageUrl as string, tabId);
    ctx.terminalManager.appendToTerminal('twave', tr('terminal.wave.surferTabOpened'), 'success');
    return true;
}

/**
 * Grava ao lado do .vcd o layout da onda do PRISM nos dois formatos, e devolve
 * os caminhos. Nunca lanca: sem layout a onda abre crua, com o motivo no
 * terminal.
 */
export async function layoutDaOndaDoPrism(
    ctx: ContextoDaOnda, vcdFile: string, modulo: string, sinais: SinalDoMonitor[],
): Promise<{ surfer: string | null; gtkw: string | null }> {
    const saida: { surfer: string | null; gtkw: string | null } = { surfer: null, gtkw: null };
    let layout;
    try {
        layout = montarLayoutDaOndaDoPrism({ modulo, vcdPath: vcdFile, sinais });
    } catch (e) {
        ctx.terminalManager.appendToTerminal('twave',
            `PRISM: could not build the wave layout (${motivoDe(e)}); opening the raw wave.`, 'tips');
        return saida;
    }
    if (!layout.quantidade) return saida;
    const semExtensao = vcdFile.replace(/\.vcd$/i, '');
    const gravar = async (caminho: string, conteudo: string | null, chave: 'surfer' | 'gtkw') => {
        if (!conteudo) return;
        try {
            await electronAPI.writeFile(caminho, conteudo);
            saida[chave] = caminho;
        } catch (e) {
            ctx.terminalManager.appendToTerminal('twave',
                `PRISM: could not write ${basenameOfPath(caminho)} (${motivoDe(e)}); opening the raw wave.`, 'tips');
        }
    };
    await gravar(`${semExtensao}.surf.ron`, layout.surfer, 'surfer');
    await gravar(`${semExtensao}.gtkw`, layout.gtkw, 'gtkw');
    return saida;
}

/**
 * Abre no visualizador um .vcd que NAO veio do passo Wave: hoje, o que a
 * simulacao do PRISM grava com os sinais do monitor. A partir do arquivo
 * pronto o caminho e o do botao Wave (GTKWave ou Surfer, aba ou janela). O
 * layout e o do proprio monitor (layoutDaOndaDoPrism). Nao ha testbench por
 * tras, e por isso a aba do Surfer abre sem o "salvar estado": um estado
 * salvo daqui nao e o do testbench e nao pode tomar o lugar dele.
 *
 * Nunca lanca: o erro vai para o terminal Wave.
 */
export async function abrirOndaExterna(
    ctx: ContextoDaOnda, vcdFile: string, rotulo: string, sinais: SinalDoMonitor[] = [],
): Promise<void> {
    try {
        await ctx.initializeComponentsPath();
        const tools = await resolveWaveToolchain(ctx.componentsPath as string, ctx.projectPath);
        ctx.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.prismWave', { module: rotulo || basenameOfPath(vcdFile) }), 'info');
        const layout = await layoutDaOndaDoPrism(ctx, vcdFile, rotulo, sinais);
        if (getViewer() === 'surfer') {
            await lancarSurfer(ctx, vcdFile, layout.surfer, tools, { semEstado: true });
        } else {
            await lancarGtkwave(ctx, vcdFile, layout.gtkw, tools);
        }
    } catch (error) {
        const message = (error as { message?: string } | null)?.message || String(error);
        ctx.terminalManager.appendToTerminal('twave', tr('terminal.common.error', { message }), 'error');
    }
}
