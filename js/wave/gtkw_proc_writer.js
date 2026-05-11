/**
 * gtkw_proc_writer.js — Build a processor-aware .gtkw layout.
 *
 * Mirrors the styling rules of components/Scripts/gtk_proc_init.tcl
 * but emits them statically into the .gtkw, so no TCL post-processing
 * is needed. The big difference from the TCL version: this one
 * supports MULTIPLE processor instances. The TCL hardcodes patterns
 * like `proc.req_in_sim` (single processor named "proc"); here we
 * detect each instance and apply the same template to all of them.
 *
 * Detection
 * ---------
 * A processor instance is recognised by having a subtree shaped like
 *   <inst>.p_<procType>.core
 * inside the VCD. The instance is `<inst>` (e.g. `proc`, `proc1`, ...),
 * and the type is `<procType>` (e.g. `ProcDTW`).
 *
 * Per-processor layout
 * --------------------
 *   1. Comment "<procName> *********"
 *   2. Comment "I/O ****************"
 *      - req_in_sim_<N> + in_sim_<N> pairs, both Yellow, aliased
 *      - out_en_sim_<N> + out_sig_<N> pairs, both Yellow, aliased
 *   3. Comment "Instructions *******"
 *      - valr2: Decimal, Indigo, alias "Assembly"
 *      - linetabs: Signed Decimal, Violet, alias "C±"
 *   4. Comment "Variables **********"
 *      - me1_f_<func>_v_<var>_e_: Signed Decimal, Orange, "int <var> in <func>"
 *      - me2_f_<func>_v_<var>_e_: BitsToReal, Orange, "float <var> in <func>"
 *      - comp_me3_f_<func>_v_<var>_e_: Binary, Orange, "comp <var> in <func>"
 *      - arr_me1/me2/comp_me3 with numeric suffix: grouped arrays
 *   5. Comment "Flags **************"
 *      - Stack group (sp.pointeri, sp.fl_max, sp.fl_full, plus isp.*)
 *      - ULA group (delta_int, delta_float)
 *
 * Translation files (trad_opcode.txt, trad_cmm.txt, comp2gtkw.exe)
 * are NOT applied in this first pass — they need ^N declarations in
 * the header and TR_FTRANSLATED flag wiring per-signal, which is
 * fragile to get right without empirical iteration. Colors, formats,
 * groups, and aliases cover the main visual win; tradutores fica
 * como follow-up.
 */

// Color codes used after [color] directives.
const COLOR_NORMAL = 0;
// const COLOR_RED = 1;
const COLOR_ORANGE = 2;
const COLOR_YELLOW = 3;
// const COLOR_GREEN = 4;
// const COLOR_BLUE = 5;
const COLOR_INDIGO = 6;
const COLOR_VIOLET = 7;

// Trace-flag bits — subset of what GTKWave saves into the `@<hex>`
// line that prefixes a trace. See analyzer.h in the gtkwave source
// for the canonical list.
const TR_HEX           = 0x00000002;
const TR_DEC           = 0x00000004;
const TR_BIN           = 0x00000008;
const TR_RJUSTIFY      = 0x00000020;
const TR_BLANK         = 0x00000200;
const TR_SIGNED        = 0x00000400;
const TR_COLLAPSED     = 0x00001000;
const TR_FTRANSLATED   = 0x00002000;
const TR_PTRANSLATED   = 0x00004000;
const TR_REAL          = 0x00040000;
const TR_ANALOG_STEP   = 0x00008000;
const TR_CLOSED        = 0x00400000;
const TR_GRP_BEGIN     = 0x00800000;
const TR_GRP_END       = 0x01000000;

// Format presets — each value corresponds to a menu in GTKWave's
// Edit > Data Format submenu.
// Format presets — calibrados a partir de um .gtkw gerado pelo proprio
// GTKWave (save manual), nao por adivinhacao. Algumas combinacoes
// surpreendem:
//   - "Signed Decimal" no save NAO tem TR_DEC: e so TR_SIGNED. O
//     GTKWave default pra signed sem outro format-bit ja e decimal.
//   - "BitsToReal" no save NAO tem TR_REAL2BITS: e so TR_REAL.
//   - "Analog Step" e um modificador de display; combina com o
//     formato underlying (signed dec, hex, etc).
const FMT_BIN              = TR_RJUSTIFY | TR_BIN;                 // 0x28
const FMT_DEC              = TR_RJUSTIFY | TR_DEC;                 // 0x24
const FMT_SIGNED_DEC       = TR_RJUSTIFY | TR_SIGNED;              // 0x420
const FMT_REAL             = TR_RJUSTIFY | TR_REAL;                // 0x40020
const FMT_ANALOG_SIGNED    = TR_RJUSTIFY | TR_SIGNED | TR_ANALOG_STEP;  // 0x8420
const FMT_ANALOG_HEX       = TR_RJUSTIFY | TR_HEX | TR_ANALOG_STEP;     // 0x8022

const FLAG_COMMENT_LINE = TR_BLANK;                                       // 0x200
const FLAG_GROUP_BEGIN  = TR_BLANK | TR_GRP_BEGIN | TR_CLOSED;            // 0xC00200
const FLAG_GROUP_END    = TR_BLANK | TR_GRP_END | TR_CLOSED | TR_COLLAPSED; // 0x1401200

const hex = (n) => n.toString(16);

/**
 * Scan VCD scopes and return processor instances found inside.
 *
 * @param {VcdScope[]} scopes
 * @returns {Array<{ instancePath: string, instanceName: string, procType: string, corePath: string }>}
 */
export function detectProcessors(scopes) {
    const found = new Map();
    for (const scope of scopes) {
        const parts = scope.path.split('.');
        for (let i = 2; i < parts.length; i++) {
            if (parts[i] === 'core' && parts[i - 1].startsWith('p_')) {
                const instPath = parts.slice(0, i - 1).join('.');
                if (!found.has(instPath)) {
                    found.set(instPath, {
                        instancePath: instPath,
                        instanceName: parts[i - 2],
                        procType: parts[i - 1].slice(2),
                        corePath: parts.slice(0, i + 1).join('.'),
                    });
                }
                break;
            }
        }
    }
    return [...found.values()];
}

// ---- internal helpers --------------------------------------------------

function getScope(scopes, path) {
    return scopes.find((s) => s.path === path) || null;
}

function listSignalsInScope(scopes, scopePath) {
    const scope = getScope(scopes, scopePath);
    if (!scope) return [];
    return scope.signals.map((s) => ({
        ...s,
        fullName: `${scope.path}.${s.name}`,
    }));
}

function findSignal(scopes, scopePath, name) {
    const scope = getScope(scopes, scopePath);
    if (!scope) return null;
    const sig = scope.signals.find((x) => x.name === name);
    if (!sig) return null;
    return { ...sig, fullName: `${scope.path}.${sig.name}` };
}

function rangeSuffix(sig) {
    return sig && sig.range ? `[${sig.range}]` : '';
}

function emitComment(lines, text) {
    lines.push(`@${hex(FLAG_COMMENT_LINE)}`);
    lines.push(`-${text}`);
}

function emitGroupBegin(lines, text) {
    lines.push(`@${hex(FLAG_GROUP_BEGIN)}`);
    lines.push(`-${text}`);
}

function emitGroupEnd(lines, text) {
    lines.push(`@${hex(FLAG_GROUP_END)}`);
    lines.push(`-${text}`);
}

/**
 * Emit one signal row with format + alias + color, optionally with a
 * file or process translation filter applied.
 *
 * Order baseado em um .gtkw salvo pelo proprio GTKWave:
 *   @<flags>
 *   [color] N
 *   ^N <path>                <- file filter, inline declaration+use
 *   ^^N <path>               <- proc filter, inline declaration+use
 *   +{alias} signal.path
 *
 * Filter IDs sao alocados via filterCounter (passado por referencia) —
 * cada novo `^N <path>` ou `^^N <path>` consome o proximo ID
 * sequencial. Declaração e uso acontecem na mesma linha; nao ha
 * "declarar no header + selecionar depois".
 *
 * @param {object} [opts]
 * @param {string} [opts.fileFilterPath]  caminho absoluto pro .txt
 *      de file filter (trad_opcode.txt, trad_cmm.txt). Acende
 *      TR_FTRANSLATED no flag e emite `^N <path>`.
 * @param {string} [opts.procFilterPath]  caminho absoluto pro .exe
 *      de process filter (comp2gtkw.exe). Acende TR_PTRANSLATED e
 *      emite `^^N <path>`.
 * @param {{file:number, proc:number}} [opts.counter]  contadores de
 *      IDs globais de file/proc filters; incrementados in-place.
 */
function emitSignal(lines, sig, formatFlag, color, alias, opts = {}) {
    if (!sig) return;
    let flag = formatFlag;
    if (opts.fileFilterPath) flag |= TR_FTRANSLATED;
    if (opts.procFilterPath) flag |= TR_PTRANSLATED;
    lines.push(`@${hex(flag)}`);
    if (color !== COLOR_NORMAL) {
        lines.push(`[color] ${color}`);
    }
    if (opts.fileFilterPath) {
        const id = ++opts.counter.file;
        lines.push(`^${id} ${opts.fileFilterPath}`);
    }
    if (opts.procFilterPath) {
        const id = ++opts.counter.proc;
        lines.push(`^^${id} ${opts.procFilterPath}`);
    }
    const ref = `${sig.fullName}${rangeSuffix(sig)}`;
    if (alias) {
        lines.push(`+{${alias}} ${ref}`);
    } else {
        lines.push(ref);
    }
}

// ---- processor-specific section builders -------------------------------

function emitIoSection(lines, scopes, instancePath) {
    emitComment(lines, 'I/O ****************');

    const sigs = listSignalsInScope(scopes, instancePath);
    const reqIns  = sigs.filter((s) => /^req_in_sim_?\d+$/.test(s.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const inSims  = sigs.filter((s) => /^in_sim_?\d+$/.test(s.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const outEns  = sigs.filter((s) => /^out_en_sim_?\d+$/.test(s.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const outSigs = sigs.filter((s) => /^out_sig_?\d+$/.test(s.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const pairCount = Math.max(reqIns.length, inSims.length);
    for (let i = 0; i < pairCount; i++) {
        if (reqIns[i]) emitSignal(lines, reqIns[i], FMT_BIN, COLOR_YELLOW, `req_in ${i}`);
        if (inSims[i]) emitSignal(lines, inSims[i], FMT_SIGNED_DEC, COLOR_YELLOW, `input  ${i}`);
    }
    const outPairCount = Math.max(outEns.length, outSigs.length);
    for (let i = 0; i < outPairCount; i++) {
        if (outEns[i])  emitSignal(lines, outEns[i],  FMT_BIN, COLOR_YELLOW, `out_en ${i}`);
        if (outSigs[i]) emitSignal(lines, outSigs[i], FMT_SIGNED_DEC, COLOR_YELLOW, `output ${i}`);
    }
}

function emitInstructionsSection(lines, scopes, instancePath, paths, counter) {
    emitComment(lines, 'Instructions *******');
    const valr2 = findSignal(scopes, instancePath, 'valr2');
    if (valr2) {
        emitSignal(lines, valr2, FMT_DEC, COLOR_INDIGO, 'Assembly', {
            fileFilterPath: paths.tradOpcode,
            counter,
        });
    }
    const linetabs = findSignal(scopes, instancePath, 'linetabs');
    if (linetabs) {
        emitSignal(lines, linetabs, FMT_SIGNED_DEC, COLOR_VIOLET, 'C+-', {
            fileFilterPath: paths.tradCmm,
            counter,
        });
    }
}

// Pega variaveis com padrao "<prefix>_f_<func>_v_<var>_e_". Devolve a
// lista ordenada alfabeticamente, ja com funcao/variavel extraidos
// pra montar o alias.
function findTypedVars(scopes, instancePath, prefix) {
    const sigs = listSignalsInScope(scopes, instancePath);
    const out = [];
    for (const s of sigs) {
        if (!s.name.startsWith(prefix)) continue;
        const m = s.name.match(/^[^_]+_f_(.*?)_v_(.*?)_e_$/);
        if (!m) continue;
        const fn = m[1];
        const vr = m[2];
        const funcLabel = fn === 'global' ? 'global' : `${fn}()`;
        out.push({ sig: s, var: vr, func: funcLabel });
    }
    out.sort((a, b) => a.sig.name.localeCompare(b.sig.name));
    return out;
}

function emitTypedVars(lines, scopes, instancePath, paths, counter) {
    const ints   = findTypedVars(scopes, instancePath, 'me1_');
    const floats = findTypedVars(scopes, instancePath, 'me2_');
    const comps  = findTypedVars(scopes, instancePath, 'comp_me3_');

    for (const v of ints)   emitSignal(lines, v.sig, FMT_SIGNED_DEC, COLOR_ORANGE, `int ${v.var} in ${v.func}`);
    for (const v of floats) emitSignal(lines, v.sig, FMT_REAL,       COLOR_ORANGE, `float ${v.var} in ${v.func}`);
    for (const v of comps) {
        // comp2gtkw e o mesmo binario pra todos os comps, mas o
        // formato de save force inline declaration. Cada uso ganha
        // seu proprio ID (consumo do counter), exatamente como
        // GTKWave faria.
        emitSignal(lines, v.sig, FMT_BIN, COLOR_ORANGE, `comp ${v.var} in ${v.func}`, {
            procFilterPath: paths.comp2gtkw,
            counter,
        });
    }
}

// Arrays: nomes terminam com um sufixo numerico de 4 digitos. Agrupa
// por base (sem o sufixo) e cria um group GTKWave por base.
function emitArrayVars(lines, scopes, instancePath, prefix, fmt, typeLabel, procFilterPath, counter) {
    const sigs = listSignalsInScope(scopes, instancePath);
    const groups = new Map(); // baseName -> [{ sig, idx }]
    for (const s of sigs) {
        if (!s.name.startsWith(prefix)) continue;
        // Padrao: <base><NNNN> ou <base><NNNN>[bits]
        const m = s.name.match(/^(.*?)(\d{4})$/);
        if (!m) continue;
        const base = m[1];
        const idx = parseInt(m[2], 10);
        if (!groups.has(base)) groups.set(base, []);
        groups.get(base).push({ sig: s, idx });
    }
    for (const baseName of [...groups.keys()].sort()) {
        const items = groups.get(baseName).sort((a, b) => a.idx - b.idx);
        const m = baseName.match(/^[^_]+_f_(.*?)_v_(.*?)_e_/);
        const fn = m ? m[1] : '';
        const vr = m ? m[2] : baseName;
        const funcLabel = fn === 'global' ? 'global' : `${fn}()`;
        const groupLabel = `${typeLabel} ${vr} in ${funcLabel}`;
        emitGroupBegin(lines, groupLabel);
        let i = 0;
        for (const { sig } of items) {
            const opts = procFilterPath ? { procFilterPath, counter } : undefined;
            emitSignal(lines, sig, fmt, COLOR_ORANGE, `${vr} ${i}`, opts);
            i++;
        }
        emitGroupEnd(lines, groupLabel);
    }
}

function emitVariablesSection(lines, scopes, instancePath, paths, counter) {
    emitComment(lines, 'Variables **********');
    emitTypedVars(lines, scopes, instancePath, paths, counter);
    emitArrayVars(lines, scopes, instancePath, 'arr_me1_',      FMT_SIGNED_DEC, 'int',   null,             counter);
    emitArrayVars(lines, scopes, instancePath, 'arr_me2_',      FMT_REAL,       'float', null,             counter);
    emitArrayVars(lines, scopes, instancePath, 'comp_arr_me3_', FMT_BIN,        'comp',  paths.comp2gtkw,  counter);
}

function emitFlagsSection(lines, scopes, corePath) {
    emitComment(lines, 'Flags **************');

    // Stack: data stack (sp) + instruction stack (isp). Cada um tem
    // pointeri (analog step + signed dec), fl_max (decimal), fl_full
    // (binary). Flags conferidos contra .gtkw salvo pelo GTKWave.
    const stackEntries = [
        { path: `${corePath}.sp`,  name: 'pointeri', fmt: FMT_ANALOG_SIGNED, alias: 'Data Stack Pointer' },
        { path: `${corePath}.sp`,  name: 'fl_max',   fmt: FMT_DEC,           alias: 'Data Stack Max' },
        { path: `${corePath}.sp`,  name: 'fl_full',  fmt: FMT_BIN,           alias: 'Data Stack Overflow' },
        { path: `${corePath}.isp`, name: 'pointeri', fmt: FMT_ANALOG_SIGNED, alias: 'Inst Stack Pointer' },
        { path: `${corePath}.isp`, name: 'fl_max',   fmt: FMT_DEC,           alias: 'Inst Stack Max' },
        { path: `${corePath}.isp`, name: 'fl_full',  fmt: FMT_BIN,           alias: 'Inst Stack Overflow' },
    ];
    const stackResolved = stackEntries
        .map((e) => ({ ...e, sig: findSignal(scopes, e.path, e.name) }))
        .filter((e) => e.sig);
    if (stackResolved.length > 0) {
        emitGroupBegin(lines, 'Stack');
        for (const e of stackResolved) emitSignal(lines, e.sig, e.fmt, COLOR_NORMAL, e.alias);
        emitGroupEnd(lines, 'Stack');
    }

    // ULA: delta_int + delta_float renderizados como analog step + hex
    // (GTKWave default pra reals).
    const deltaInt = findSignal(scopes, `${corePath}.ula`, 'delta_int');
    const deltaFloat = findSignal(scopes, `${corePath}.ula`, 'delta_float');
    if (deltaInt || deltaFloat) {
        emitGroupBegin(lines, 'ULA');
        if (deltaInt)   emitSignal(lines, deltaInt,   FMT_ANALOG_HEX, COLOR_NORMAL, 'Rounding Error (int)');
        if (deltaFloat) emitSignal(lines, deltaFloat, FMT_ANALOG_HEX, COLOR_NORMAL, 'Rounding Error (float)');
        emitGroupEnd(lines, 'ULA');
    }
}

// ---- public entry point ------------------------------------------------

/**
 * @param {object} input
 * @param {string} input.vcdPath      used in [dumpfile]
 * @param {string} input.gtkwPath     used in [savefile]
 * @param {VcdScope[]} input.scopes   parsed VCD scope tree
 * @param {string} [input.tbModule]   testbench top scope. Kept in the
 *      signature for backward compatibility but unused — clk/rst/itr
 *      are now sourced from each processor's `core` scope.
 * @param {string} [input.tempBaseDir]  Temp/ root. Resolves translation
 *      files at <tempBaseDir>/<procType>/trad_opcode.txt and trad_cmm.txt.
 * @param {string} [input.binDir]     bin/ dir containing comp2gtkw.exe
 *      (process filter for comp_me3* vars and comp_arr_me3 arrays).
 * @returns {{ content: string|null, processorCount: number }}
 *      content: null when no processor instance is detected, so the
 *      caller can fall back to the simpler buildGtkwContent path.
 */
export function buildProcessorAwareGtkw({
    vcdPath,
    gtkwPath,
    scopes,
    // tbModule recebido pelo caller mas nao usado mais (clk/rst/itr
    // sao per-processador agora, do core de cada um).
    tempBaseDir = null,
    binDir = null,
}) {
    if (!Array.isArray(scopes) || scopes.length === 0) {
        return { content: null, processorCount: 0 };
    }
    const procs = detectProcessors(scopes);
    if (procs.length === 0) {
        return { content: null, processorCount: 0 };
    }

    // Header: GTKWave salva paths com BACKSLASH no Windows. Reusamos
    // as paths tal qual vieram (sem normalizar pra forward slash) pra
    // espelhar o formato canonico — verificado contra .gtkw salvo pelo
    // GTKWave em Windows.
    const lines = [
        '[*]',
        '[*] Generated by Aurora (processor-aware)',
        '[*]',
        `[dumpfile] "${vcdPath}"`,
        `[savefile] "${gtkwPath}"`,
        '[timestart] 0',
    ];

    // Contador global de filter IDs. file e proc filters tem
    // numeracoes independentes; cada novo `^N <path>` ou `^^N <path>`
    // inline consome o proximo ID.
    const counter = { file: 0, proc: 0 };

    // Resolve paths dos tradutores per-processador. trads ficam em
    // Temp/<procType>/ (procType e o nome da pasta/modulo, NAO o
    // instanceName que aparece no testbench).
    const resolveProcPaths = (proc) => {
        const paths = { tradOpcode: null, tradCmm: null, comp2gtkw: null };
        if (tempBaseDir) {
            const procTemp = tempBaseDir.replace(/[\\/]$/, '') + '\\' + proc.procType;
            paths.tradOpcode = `${procTemp}\\trad_opcode.txt`;
            paths.tradCmm = `${procTemp}\\trad_cmm.txt`;
        }
        if (binDir) {
            paths.comp2gtkw = binDir.replace(/[\\/]$/, '') + '\\comp2gtkw.exe';
        }
        return paths;
    };

    procs.forEach((proc) => {
        const paths = resolveProcPaths(proc);

        // Banner do processador. O TCL usa "###### <instanceName>" e
        // o GTKWave renderiza isso como uma linha de comentario no
        // painel de signals — espelhamos textualmente.
        emitComment(lines, `###### ${proc.instanceName}`);

        // clk/rst/itr do CORE deste processador (nao do testbench top).
        // Cada processador tem seu proprio clock domain, e o GTKWave
        // exibe os tres como sinais sem cor/formato especial logo
        // abaixo do banner do proc.
        const coreClk = findSignal(scopes, proc.corePath, 'clk');
        const coreRst = findSignal(scopes, proc.corePath, 'rst');
        const coreItr = findSignal(scopes, proc.corePath, 'itr');
        if (coreClk) emitSignal(lines, coreClk, FMT_BIN, COLOR_NORMAL, null);
        if (coreRst) emitSignal(lines, coreRst, FMT_BIN, COLOR_NORMAL, null);
        if (coreItr) emitSignal(lines, coreItr, FMT_BIN, COLOR_NORMAL, null);

        emitIoSection(lines, scopes, proc.instancePath);
        emitInstructionsSection(lines, scopes, proc.instancePath, paths, counter);
        emitVariablesSection(lines, scopes, proc.instancePath, paths, counter);
        emitFlagsSection(lines, scopes, proc.corePath);
    });

    return { content: lines.join('\n') + '\n', processorCount: procs.length };
}
