// wave_signal_validator.js: wave-selection resolution for the wave/sim flow.
//
// Extracted from compilation_module.js (A2 god-file decomposition #4). These
// functions decide WHICH signals end up in the $dumpvars / .gtkw / .surf layout:
// they read the per-testbench WaveStore, validate the saved picker selection
// against the freshly-parsed Verilog hierarchy, and pick the dump source
// (active .gtkw > Wave Config > hand-written $dumpvars > default).
//
// They are NOT pure, they touch the WaveStore, the terminal, and (for source
// parsing) the project config. Rather than capture instance state, each takes a
// `deps` bag: { projectPath, terminalManager, projectConfig, componentsPath }.
// CompilationModule keeps thin delegator methods (see _instanceDeps()) so every
// caller, including the external js/wave/wave_config_manager.js, which calls
// compiler._validateWaveSelection, is unchanged.
//
// IMPORTANT: the instance field `_validatedWaveSelection` (cache consumed by the
// auto-gtkw / auto-surfer generators) stays OWNED by CompilationModule.
// resolveCocotbWaveSelection RETURNS the validated selection; the delegator
// writes the field. That keeps the field's whole lifecycle (3 writes / 2 reads)
// inside the class even though this body moved out.
//
// Kept on `electronAPI` (live global) rather than the ../app/electron_api
// re-export so the module stays unit-testable with the repo's
// `globalThis.window = { electronAPI: fake }` pattern (same as WaveStore):
// migrating these globals belongs to A3, not this extraction.

import { electronAPI } from '../app/electron_api.js';
import { parseVerilogModules, buildHierarchyTree, deriveMonitorScopes } from '../wave/signal_parser.js';
import { getSimulator } from '../wave/simulator_preference.js';
import { validateSelection } from '../wave/selection_validator.js';
import { WaveStore } from '../wave/wave_state_store.js';
import { extractSignalRefs } from '../wave/gtkw_writer.js';
import { hasUserDumpCalls } from '../wave/testbench_instrumenter.js';
import { moduleStemFromPath, isVerilogLikeFile } from './compilation_helpers.js';

// i18n shim, falls back to the key path if i18n didn't boot yet.
const tr = (k, p) => (window.t ? window.t(k, p) : k);

/**
 * Filter the user's saved Wave Configuration selection against the
 * current parsed Verilog hierarchy and warn about stale entries.
 *
 * Why this exists: the picker stores selections by dotted path. If
 * the user later renames a signal (rst → rs) or removes an instance,
 * the saved entry dangles. Feeding it to the testbench instrumenter
 * makes iverilog produce `$dumpvars(0, tb_counter.rst)` against a
 * design that has no `rst`, and the build fails with a cryptic
 * "exit code 2". Pre-validating turns that into a readable warning
 * in tveri and lets the build proceed with the still-valid subset.
 *
 * Returns the pruned selection. On parse failure, falls back to the
 * raw selection, better to let iverilog produce a real error than
 * to silently strip the user's choice on a transient parse hiccup.
 *
 * @param {{ projectPath: string, terminalManager: object }} deps
 */
/**
 * Le e parseia `filePaths` e monta a arvore de hierarquia enraizada em
 * `topModule`; null quando o topo nao esta nos fontes. E a mesma arvore que
 * o validador usa, exposta para quem precisa dela sem a validacao (o fluxo
 * cocotb sob Verilator, que a traduz em regras de escopo).
 * @param {string[]} filePaths
 * @param {string} topModule
 */
export async function buildHierarchyFromFiles(filePaths, topModule) {
    const fileContents = await Promise.all(
        filePaths.map(async (path) => ({
            path,
            content: await electronAPI.readFile(path, { encoding: 'utf8' }),
        })),
    );
    const { modules } = parseVerilogModules(fileContents);
    return topModule && modules.has(topModule)
        ? buildHierarchyTree(modules, topModule)
        : null;
}

export async function validateWaveSelection(deps, rawSelected, filePaths, simTopModule, tbKey = null) {
    if (!Array.isArray(rawSelected) || rawSelected.length === 0) return [];
    try {
        const tree = await buildHierarchyFromFiles(filePaths, simTopModule);
        const { valid, dropped } = validateSelection(rawSelected, tree);
        if (dropped.length > 0) {
            const preview = dropped.slice(0, 5).map((s) => `"${s}"`).join(', ');
            const more = dropped.length > 5 ? ` (+${dropped.length - 5} more)` : '';
            const msg = dropped.length === 1
                ? tr('terminal.wave.staleSignalOne', { preview })
                : tr('terminal.wave.staleSignalMany', { count: dropped.length, preview, more });
            // Goes to twave, this is a Wave Configuration concern,
            // even though it's detected during the iverilog
            // instrumentation step (the wave button is the only flow
            // that triggers buildVvp; the plain Compile button never
            // hits this path).
            deps.terminalManager.appendToTerminal('twave', msg, 'warning');

            // Auto-prune the persisted selection so the warning fires
            // once, not on every compile. We can't tell the user to
            // "uncheck" a stale entry, the picker only shows signals
            // that exist in the parsed hierarchy, so a missing path
            // has no UI to remove it from. waveSignals agora vive
            // per-testbench no WaveStore; sem tbKey resolvido (caso
            // raro: topLevelFile sem testbenchFile) skip o write, o
            // run em si ja procede com `valid`.
            if (tbKey) {
                try {
                    await WaveStore.update(deps.projectPath, tbKey, (cfg) => {
                        cfg.waveSignals = valid;
                    });
                } catch (_persistErr) {
                    // Non-fatal: o run ja procede com `valid`.
                    // Proxima compilacao re-detecta e re-tenta.
                }
            }
        }
        return valid;
    } catch (err) {
        deps.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.preValidateFailed', { message: err.message }),
            'warning');
        return rawSelected;
    }
}

/**
 * Decide o que vai dentro do `$dumpvars` injetado e se devemos
 * sobrescrever um `$dumpvars` hand-written do usuario. Tres axes
 * agem em conjunto, com a precedencia (de maior a menor):
 *
 *   1. **.gtkw selecionado** (state.gtkwFiles ∩ isActive=true).
 *      Aurora le o arquivo, extrai signal refs com extractSignalRefs,
 *      valida contra a hierarquia do source atual e usa esse conjunto.
 *      Signals referenciados no .gtkw mas que sumiram do source geram
 *      twave warning + toast, o build segue sem eles.
 *   2. **Wave Configuration customizada** (state.wcCustomized=true).
 *      state.waveSignals dita o $dumpvars. Override do $dumpvars
 *      do usuario se houver, o WC e a fonte canonica nesse caso.
 *   3. **Testbench com $dumpvars hand-written na 1a visita**
 *      (state.hadOriginalDumpvars). NAO injetamos nada; o testbench
 *      domina o que vai pro VCD.
 *   4. **Default**: `$dumpvars(1, tbModule)`, signals so do scope
 *      do testbench, sem descer no DUT. Sem override.
 *
 * Side effects: registra o tb no WaveStore na 1a visita (snapshot
 * de hadOriginalDumpvars pra usar nas visitas futuras).
 *
 * @param {{ projectPath: string, terminalManager: object }} deps
 * @param {object} input
 * @param {object} input.config        .spf structure (precisa testbenchFile)
 * @param {string} input.simTopModule  nome do module top da simulacao
 * @param {string[]} input.filePaths   .v files pra parsear (synth + tb + HDL)
 * @returns {Promise<{
 *   signalsToDump: string[],
 *   overrideUserDumpvars: boolean,
 *   source: 'gtkw'|'wc'|'tb'|'default',
 *   tbKey: string,
 * }>}
 */
export async function resolveWaveSelection(deps, { config, simTopModule, filePaths }) {
    const tbKey = moduleStemFromPath(config.testbenchFile);

    // 1a visita: snapshot do estado original do testbench. Idempotente
    //, re-chamadas nao mudam o flag.
    const tbContent = await electronAPI.readFile(config.testbenchFile, { encoding: 'utf8' });
    const hadOriginalDumpvars = hasUserDumpCalls(tbContent);
    await WaveStore.ensureRegistered(deps.projectPath, tbKey, {
        tbPath: config.testbenchFile,
        tbModule: tbKey,
        hadOriginalDumpvars,
    });
    const state = await WaveStore.read(deps.projectPath, tbKey);

    // Parse de source on-demand, so se precisarmos validar um conjunto
    // de signals (vem do .gtkw ou do WC).
    let cachedTree = null;
    // Monitores do processador (pilhas + erro da ULA): dumpados SEMPRE que a
    // AURORA controla o $dumpvars, independente da selecao do picker — sao a
    // telemetria de saude do processador e os grupos Stack/ULA do layout
    // automatico dependem deles. Fora do caso 'tb' (dump do proprio usuario),
    // em que nao mexemos.
    // O simulador escolhido entra na decisao: sob Verilator, monitor cujo
    // caminho atravessa um escopo de generate (o da pilha de instrucao) nao
    // elabora, e emiti-lo quebraria a build em vez de faltar um traco.
    const monitorScopes = async () => deriveMonitorScopes(await buildTree(), { simulator: getSimulator() });
    const buildTree = async () => {
        if (cachedTree !== null) return cachedTree;
        const contents = await Promise.all(
            filePaths.map(async (p) => ({
                path: p,
                content: await electronAPI.readFile(p, { encoding: 'utf8' }),
            })),
        );
        const { modules } = parseVerilogModules(contents);
        cachedTree = simTopModule && modules.has(simTopModule)
            ? buildHierarchyTree(modules, simTopModule)
            : null;
        return cachedTree;
    };

    // (d) .gtkw ativo vence, varredura do arquivo dita o $dumpvars.
    const activeGtkw = (state.gtkwFiles || []).find((f) => f && f.isActive === true);
    if (activeGtkw && activeGtkw.path) {
        try {
            const gtkwContent = await electronAPI.readFile(activeGtkw.path, { encoding: 'utf8' });
            const refs = extractSignalRefs(gtkwContent);
            if (refs.length > 0) {
                const tree = await buildTree();
                const { valid, dropped } = validateSelection(refs, tree);
                if (dropped.length > 0) {
                    const gtkwName = activeGtkw.path.split(/[\\/]/).pop();
                    const preview = dropped.slice(0, 5).map((s) => `"${s}"`).join(', ');
                    const more = dropped.length > 5 ? ` (+${dropped.length - 5} more)` : '';
                    const msg = dropped.length === 1
                        ? tr('terminal.wave.gtkwStaleSignalOne', { preview, file: gtkwName })
                        : tr('terminal.wave.gtkwStaleSignalMany', { count: dropped.length, file: gtkwName, preview, more });
                    deps.terminalManager.appendToTerminal('twave', msg, 'warning');
                    if (typeof window.showNotification === 'function') {
                        window.showNotification(msg, 'warning', 6000, 'Wave Selection');
                    }
                }
                return {
                    signalsToDump: valid,
                    overrideUserDumpvars: true,
                    source: 'gtkw',
                    tbKey,
                    monitorScopes: await monitorScopes(),
                    // A arvore vai junto: sob Verilator a selecao vira regras
                    // de escopo no .vlt (verilator_trace_rules), e o builder
                    // precisa dela sem reparsear as fontes.
                    hierarchyTree: tree,
                };
            }
        } catch (err) {
            deps.terminalManager.appendToTerminal('twave',
                tr('terminal.wave.gtkwReadError', { file: activeGtkw.path.split(/[\\/]/).pop(), message: err.message }),
                'warning');
        }
    }

    // (c) Wave Configuration customizada.
    if (state.wcCustomized
        && Array.isArray(state.waveSignals)
        && state.waveSignals.length > 0) {
        // Mesma validacao: signals podem ter sumido entre o save do WC
        // e este compile. validateWaveSelection ja faz isso e auto-prune.
        const valid = await validateWaveSelection(
            deps, state.waveSignals, filePaths, simTopModule, tbKey,
        );
        return {
            signalsToDump: valid,
            overrideUserDumpvars: true,
            source: 'wc',
            tbKey,
            monitorScopes: await monitorScopes(),
            hierarchyTree: await buildTree(),
        };
    }

    // (a) Testbench tem $dumpvars hand-written: nao instrumentamos.
    if (state.hadOriginalDumpvars) {
        return {
            signalsToDump: [],
            overrideUserDumpvars: false,
            source: 'tb',
            tbKey,
            // Sob Verilator os $dumpvars do proprio testbench sao lidos e
            // viram regras de escopo; a arvore e o que permite resolver cada
            // referencia.
            hierarchyTree: await buildTree(),
        };
    }

    // (default) $dumpvars(1, tbModule), signals do escopo do tb — mais os
    // monitores do processador, que moram fundo demais para o escopo raso.
    return {
        signalsToDump: [],
        overrideUserDumpvars: false,
        source: 'default',
        tbKey,
        monitorScopes: await monitorScopes(),
        hierarchyTree: await buildTree(),
    };
}

/**
 * Resolve a selecao de signals pro fluxo cocotb (testbench Python). Le o
 * WaveStore do testbench e valida a selecao salva contra as fontes HDL.
 *
 * RETORNA o conjunto validado, NAO escreve `_validatedWaveSelection`. O
 * delegador em CompilationModule e quem persiste o campo (o ciclo de vida
 * do cache fica todo na classe).
 *
 * @param {{ projectPath: string, terminalManager: object }} deps
 */
export async function resolveCocotbWaveSelection(deps, ctx, config, sources) {
    await WaveStore.ensureRegistered(deps.projectPath, ctx.tbKey, {
        tbPath: ctx.testbenchFile,
        tbModule: ctx.testModule,
        hadOriginalDumpvars: false,
    });

    const state = await WaveStore.read(deps.projectPath, ctx.tbKey);
    const savedSignals = Array.isArray(state.waveSignals) ? state.waveSignals : [];
    const validSignals = savedSignals.length > 0
        ? await validateWaveSelection(deps, savedSignals, sources, ctx.hdlTopModule, ctx.tbKey)
        : [];

    if (validSignals.length > 0) {
        deps.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.waveSource', {
                label: tr('terminal.wave.sourceLabelWc', { count: validSignals.length }),
            }), 'info');
    }

    return validSignals;
}

/**
 * Le e parseia os arquivos verilog do projeto (synthesizableFiles +
 * testbenchFiles), devolvendo o `modules` map de
 * `parseVerilogModules`. Usado por `buildAuroraGtkw` pra:
 *   - extrair declaracoes `signed` (FMT_DEC vs FMT_SIGNED_DEC)
 *   - resolver scope.path → moduleType (procType correto)
 *
 * Best-effort: erros de I/O ou parse viram `null`, e buildAuroraGtkw
 * cai nas heuristicas baseadas em nome de scope.
 *
 * @param {{ projectConfig: object, componentsPath: string, terminalManager: object }} deps
 */
export async function parseProjectSources(deps) {
    try {
        const synthFiles = (deps.projectConfig?.synthesizableFiles ?? [])
            .map((f) => f && f.path).filter(Boolean);
        const tbFile = deps.projectConfig?.testbenchFile;
        const tbFiles = (deps.projectConfig?.testbenchFiles ?? [])
            .map((f) => f && f.path).filter(Boolean);
        const paths = new Set(
            [...synthFiles, ...(tbFile ? [tbFile] : []), ...tbFiles]
                .filter((p) => p && isVerilogLikeFile(p)),
        );

        // components/HDL/*.v, biblioteca SAPHO. Inclui pra que
        // buildSignedSet/resolveScopeModules conhecam modulos como
        // `core`, `ula`, `myFIFO`. Sem isso, sinais dentro de
        // <inst>.core.sp.pointeri ficam com moduleType=null e nao
        // recebem decoracao SAPHO no .gtkw.
        try {
            const hdlPath = await electronAPI.joinPath(deps.componentsPath, 'HDL');
            const hdlEntries = await electronAPI.listFilesInDirectory(hdlPath);
            if (Array.isArray(hdlEntries)) {
                for (const name of hdlEntries) {
                    if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                        paths.add(await electronAPI.joinPath(hdlPath, name));
                    }
                }
            }
        } catch (_e) { /* HDL nao acessivel, segue sem */ }

        if (paths.size === 0) return null;

        const files = [];
        for (const p of paths) {
            try {
                const content = await electronAPI.readFile(p, { encoding: 'utf8' });
                files.push({ path: p, content });
            } catch (_e) { /* arquivo sumiu — ignora */ }
        }
        if (files.length === 0) return null;

        const { modules } = parseVerilogModules(files);
        return modules;
    } catch (err) {
        deps.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.parseSourcesNote', { message: err.message }),
            'tips');
        return null;
    }
}
