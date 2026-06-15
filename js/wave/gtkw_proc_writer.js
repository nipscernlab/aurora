/**
 * gtkw_proc_writer.js — Build the default Aurora .gtkw layout.
 *
 * O arquivo resultante tem duas zonas:
 *
 *   1. **Top-level**: todos os sinais do VCD que NAO estao dentro de
 *      uma instancia de processador SAPHO. Lista flat com formato
 *      default (hex/bin pelo GTKWave). Sao os sinais "glue logic" do
 *      design — clk global, FIFOs no top, módulos auxiliares, etc.
 *
 *   2. **Per-processor sections**: pra cada instancia de processador
 *      SAPHO detectada, uma secao completa com cores/aliases/grupos.
 *      Suporta multiplos processadores no mesmo design.
 *
 * Deteccao de processador
 * -----------------------
 * Um scope conta como instancia de processador se contem
 * AMBOS `valr2` e `linetabs` (registers que o asmcomp emite no .v).
 * Quando existe sub-escopo `<inst>.p_<procType>.core`, procType e
 * corePath sao extraidos dele.
 *
 * Layout per-processador
 * ----------------------
 *   1. Banner "<procType> ****"
 *   2. clk / rst / itr (do core)
 *   3. "I/O ****************"
 *      - req_in_sim_<N> + in_sim_<N> pairs, Yellow, alias "req_in N" / "input N"
 *      - out_en_sim_<N> + out_sig_<N> pairs, Yellow, alias "out_en N" / "output N"
 *   4. "Instructions *******"
 *      - valr2: Decimal, Indigo, alias "Assembly", file filter trad_opcode.txt
 *      - linetabs: Signed Decimal, Violet, alias "C±", file filter trad_cmm.txt
 *   5. "Variables **********"
 *      - me1_f_<func>_v_<var>_e_: Signed Decimal, Orange, "int <var> in <func>"
 *      - me2_f_<func>_v_<var>_e_: BitsToReal, Orange, "float <var> in <func>"
 *      - comp_me3_f_<func>_v_<var>_e_: Binary, Orange, "comp <var> in <func>"
 *      - arr_me1/me2/comp_me3: grupos por array
 *   6. "Flags **************"
 *      - Stack group (sp.pointeri, sp.fl_max, sp.fl_full, isp.*)
 *      - ULA group (delta_int, delta_float)
 *
 * Compilado por `tsc` (npm run build:ts) num gtkw_proc_writer.js ao lado — é esse
 * .js que o runtime carrega; os imports usam a extensão `.js`.
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
const TR_HEX = 0x00000002;
const TR_DEC = 0x00000004;
const TR_BIN = 0x00000008;
const TR_RJUSTIFY = 0x00000020;
const TR_BLANK = 0x00000200;
const TR_SIGNED = 0x00000400;
const TR_COLLAPSED = 0x00001000;
const TR_FTRANSLATED = 0x00002000;
const TR_PTRANSLATED = 0x00004000;
const TR_REAL = 0x00040000;
const TR_ANALOG_STEP = 0x00008000;
const TR_CLOSED = 0x00400000;
const TR_GRP_BEGIN = 0x00800000;
const TR_GRP_END = 0x01000000;
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
const FMT_BIN = TR_RJUSTIFY | TR_BIN; // 0x28
const FMT_DEC = TR_RJUSTIFY | TR_DEC; // 0x24
const FMT_SIGNED_DEC = TR_RJUSTIFY | TR_SIGNED; // 0x420
const FMT_REAL = TR_RJUSTIFY | TR_REAL; // 0x40020
const FMT_ANALOG_SIGNED = TR_RJUSTIFY | TR_SIGNED | TR_ANALOG_STEP; // 0x8420
const FMT_ANALOG_HEX = TR_RJUSTIFY | TR_HEX | TR_ANALOG_STEP; // 0x8022
const FLAG_COMMENT_LINE = TR_BLANK; // 0x200
const FLAG_GROUP_BEGIN = TR_BLANK | TR_GRP_BEGIN | TR_CLOSED; // 0xC00200
const FLAG_GROUP_END = TR_BLANK | TR_GRP_END | TR_CLOSED | TR_COLLAPSED; // 0x1401200
const hex = (n) => n.toString(16);
/**
 * Scan VCD scopes and return processor instances found inside.
 *
 * Heuristica: um scope e instancia de processador SAPHO se contem
 * AMBOS `valr2` e `linetabs` (registradores caracteristicos do
 * processador, emitidos pelo asmcomp em hdl_vv_file).
 *
 * Extracao de procType + corePath, em ordem de preferencia:
 *   1. Pattern antigo SAPHO: existe sub-escopo
 *      `<instPath>.p_<procType>.core` em qualquer profundidade.
 *      procType vem do match, corePath aponta pra esse sub-escopo.
 *   2. Pattern atual SAPHO: o scope com valr2/linetabs ja e o core.
 *      O parent scope (wrapper) costuma ser `<procType>_inst` — strip
 *      o suffix `_inst` pra ter o procType. corePath = instancePath.
 *   3. Ultimo recurso: instanceName sem `_inst`. Se nem isso, usa
 *      tal qual.
 *
 * @param {VcdScope[]} scopes
 * @returns {Array<{ instancePath: string, instanceName: string, procType: string, corePath: string|null }>}
 */
/**
 * Mapeia cada scope do VCD pro nome do module Verilog correspondente.
 *
 * Algoritmo: desce a hierarquia a partir do root (testbench top, cujo
 * instanceName conventionalmente coincide com o moduleName) lookando
 * `instances[]` de cada module parseado pra resolver o tipo de cada
 * sub-instance.
 *
 * Saida: Map<scope.path, moduleName | null>. null quando a resolucao
 * falha (root nao bate, instance nao listada no parent, etc).
 *
 * @param {VcdScope[]} scopes
 * @param {Map<string, {signals, instances}>} modules  output do
 *   `parseVerilogModules` (signal_parser.js)
 * @returns {Map<string, string|null>}
 */
export function resolveScopeModules(scopes, modules) {
    const cache = new Map();
    if (!modules || modules.size === 0 || !Array.isArray(scopes)) {
        return cache;
    }
    const resolve = (scopePath) => {
        if (cache.has(scopePath))
            return cache.get(scopePath) ?? null;
        const parts = scopePath.split('.');
        if (parts.length === 1) {
            const root = parts[0];
            const m = modules.has(root) ? root : null;
            cache.set(scopePath, m);
            return m;
        }
        const parentPath = parts.slice(0, -1).join('.');
        const childInst = parts[parts.length - 1];
        const parentMod = resolve(parentPath);
        if (!parentMod) {
            cache.set(scopePath, null);
            return null;
        }
        const info = modules.get(parentMod);
        if (!info) {
            cache.set(scopePath, null);
            return null;
        }
        const inst = info.instances.find((x) => x.instanceName === childInst);
        const result = inst ? inst.moduleType : null;
        cache.set(scopePath, result);
        return result;
    };
    for (const scope of scopes)
        resolve(scope.path);
    return cache;
}
/**
 * Constroi um Set de full signal paths (scope.path + '.' + name) que
 * sao declarados `signed` no source. Usado em `emitTopLevelSection`
 * pra escolher entre FMT_DEC e FMT_SIGNED_DEC.
 *
 * @param {VcdScope[]} scopes
 * @param {Map<string, {signals, instances}>} modules  output do
 *   `parseVerilogModules` (signal_parser.js)
 * @param {Map<string, string|null>} [scopeModules]  cache opcional
 *   de `resolveScopeModules`. Quando passado, evita rebuild.
 * @returns {Set<string>}
 */
export function buildSignedSet(scopes, modules, scopeModules) {
    if (!modules || modules.size === 0 || !Array.isArray(scopes)) {
        return new Set();
    }
    const map = scopeModules || resolveScopeModules(scopes, modules);
    const signedSet = new Set();
    for (const scope of scopes) {
        const mod = map.get(scope.path);
        if (!mod)
            continue;
        const info = modules.get(mod);
        if (!info)
            continue;
        for (const sig of scope.signals) {
            const decl = info.signals.find((s) => s.name === sig.name);
            if (decl && decl.isSigned) {
                signedSet.add(`${scope.path}.${sig.name}`);
            }
        }
    }
    return signedSet;
}
export function detectProcessors(scopes, scopeModules = null) {
    const found = [];
    const seenInst = new Set();
    for (const scope of scopes) {
        const sigs = scope.signals || [];
        const hasValr2 = sigs.some((s) => s.name === 'valr2');
        const hasLinetabs = sigs.some((s) => s.name === 'linetabs');
        if (!(hasValr2 && hasLinetabs))
            continue;
        if (seenInst.has(scope.path))
            continue;
        seenInst.add(scope.path);
        const parts = scope.path.split('.');
        const instanceName = parts[parts.length - 1];
        let procType = null;
        let corePath = null;
        // procType e corePath sao resolvidos SEPARADAMENTE:
        //
        // procType (= nome do module / pasta Temp/<procType>/ com trad
        // files), preferencia: scopeModules (resolvido pelo source) >
        // pattern `<inst>.p_<X>.core` no VCD > heuristica parent _inst
        // > fallback root _tb > instanceName.
        //
        // corePath (= scope onde clk/rst/itr e sp/ula vivem),
        // preferencia: `<inst>.p_<X>.core` no VCD se existir >
        // instancePath caso contrario. CRITICAL: mesmo quando procType
        // veio do source, corePath ainda deve preferir o sub-escopo
        // `.p_<X>.core` se ele existe — Stack/ULA groups so vivem la.
        let pCoreType = null;
        let pCorePath = null;
        for (const other of scopes) {
            if (!other.path.startsWith(scope.path + '.'))
                continue;
            const tail = other.path.slice(scope.path.length + 1);
            const m = tail.match(/^p_([^.]+)\.core(?:\.|$)/);
            if (m) {
                pCoreType = m[1];
                pCorePath = `${scope.path}.p_${m[1]}.core`;
                break;
            }
        }
        // (1) Preferido: moduleType resolvido pelo source. Bate com
        // Temp/<procType>/ onde cmmcomp escreve os trad files.
        if (scopeModules) {
            const mod = scopeModules.get(scope.path);
            if (mod)
                procType = mod;
        }
        // (2) Pattern SAPHO `<inst>.p_<X>.core` — procType extraido
        // do nome do scope intermediario.
        if (!procType && pCoreType) {
            procType = pCoreType;
        }
        // (3) Heuristica parent _inst (sem source). NAO bate quando o
        // wrapper tem nome diferente do core (e.g. wrapper ProcDTWv4
        // instanciando core ProcDTW).
        if (!procType && parts.length >= 2) {
            const parentName = parts[parts.length - 2];
            if (/_inst$/i.test(parentName)) {
                procType = parentName.replace(/_inst$/i, '');
            }
        }
        // (4) Fallback historico: testbench top chamado `<procType>_tb`.
        if (!procType) {
            const tbScope = parts[0];
            if (/_tb$/i.test(tbScope)) {
                procType = tbScope.replace(/_tb$/i, '');
            }
        }
        // corePath: prefere `p_<X>.core` se existir no VCD, senao
        // cai pro proprio instancePath. Pra cobrir caso o
        // $dumpvars do testbench nao tenha descido tao fundo, o
        // findCoreOrTb mais tarde tenta clk/rst no testbench top
        // como fallback final.
        corePath = pCorePath || scope.path;
        // (5) Last resort: o proprio instanceName, com strip `_inst`.
        if (!procType) {
            procType = instanceName.replace(/_inst$/i, '') || instanceName;
        }
        found.push({
            instancePath: scope.path,
            instanceName,
            procType,
            corePath,
        });
    }
    return found;
}
// ---- internal helpers --------------------------------------------------
function getScope(scopes, path) {
    return scopes.find((s) => s.path === path) || null;
}
function listSignalsInScope(scopes, scopePath) {
    const scope = getScope(scopes, scopePath);
    if (!scope)
        return [];
    return scope.signals.map((s) => ({
        ...s,
        fullName: `${scope.path}.${s.name}`,
    }));
}
function findSignal(scopes, scopePath, name) {
    const scope = getScope(scopes, scopePath);
    if (!scope)
        return null;
    const sig = scope.signals.find((x) => x.name === name);
    if (!sig)
        return null;
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
    if (!sig)
        return;
    // Filtro opcional: se opts.filter (Set de fullName) e fornecido,
    // pula sinais nao selecionados. Permite que o .gtkw mantenha
    // cores/aliases/grupos do template processor-aware mesmo quando o
    // usuario customizou a Wave Configuration (selecao subset do total).
    if (opts.filter && !opts.filter.has(sig.fullName))
        return;
    let flag = formatFlag;
    if (opts.fileFilterPath)
        flag |= TR_FTRANSLATED;
    if (opts.procFilterPath)
        flag |= TR_PTRANSLATED;
    lines.push(`@${hex(flag)}`);
    if (color !== COLOR_NORMAL) {
        lines.push(`[color] ${color}`);
    }
    if (opts.fileFilterPath) {
        const id = ++opts.counter.file;
        lines.push(`^${id} ${opts.fileFilterPath}`);
    }
    if (opts.procFilterPath) {
        // Process filter (executavel — comp2gtkw.exe traduz binario bruto
        // pro literal C±). Sintaxe `^>N <path>` — caret + maior-que.
        // NAO confundir com `^^N <path>` (que e outra coisa); o file
        // filter (table .txt como trad_opcode.txt) usa `^N <path>` com
        // uma caret so.
        const id = ++opts.counter.proc;
        lines.push(`^>${id} ${opts.procFilterPath}`);
    }
    const ref = `${sig.fullName}${rangeSuffix(sig)}`;
    if (alias) {
        lines.push(`+{${alias}} ${ref}`);
    }
    else {
        lines.push(ref);
    }
}
// ---- section builders --------------------------------------------------
/**
 * Emite a secao top-level: todos os sinais que NAO estao dentro de
 * uma instancia de processador.
 *
 * Format por sinal:
 *   - single-bit (sem range): FMT_BIN (`0` ou `1`)
 *   - multi-bit signed: FMT_SIGNED_DEC (declarado `reg signed [...]`
 *     ou `wire signed [...]` no source — detectado via signedSet)
 *   - multi-bit unsigned: FMT_DEC (qualquer outro barramento)
 *
 * Emite `@<flag>` so quando muda — flags persistem ate o proximo `@`
 * no .gtkw (GTKWave aplica em cascade).
 *
 * @param {string[]} processorInstancePaths  paths-raiz das instancias
 *   de processador (qualquer scope cujo path comeca com `<root>.` e
 *   "interno" e pulado aqui — sera emitido na secao do proc).
 * @param {Set<string>} [signedSet]  full-paths de sinais declarados
 *   `signed` no source. Opcional — sem ele todo multi-bit vira DEC.
 */
function emitTopLevelSection(lines, scopes, processorInstancePaths, filter, signedSet) {
    const isInsideProcessor = (scopePath) => processorInstancePaths.some((proc) => scopePath === proc || scopePath.startsWith(proc + '.'));
    const emitList = [];
    for (const scope of scopes) {
        if (isInsideProcessor(scope.path))
            continue;
        for (const sig of scope.signals) {
            const fullName = `${scope.path}.${sig.name}`;
            if (filter && !filter.has(fullName))
                continue;
            emitList.push({ fullName, range: sig.range ?? null });
        }
    }
    if (emitList.length === 0)
        return;
    const pickFlag = (sig) => {
        if (sig.range === null)
            return FMT_BIN;
        if (signedSet && signedSet.has(sig.fullName))
            return FMT_SIGNED_DEC;
        return FMT_DEC;
    };
    emitComment(lines, '###### Top-level');
    let lastFlag = null;
    for (const s of emitList) {
        const flag = pickFlag(s);
        if (flag !== lastFlag) {
            lines.push(`@${hex(flag)}`);
            lastFlag = flag;
        }
        lines.push(s.range ? `${s.fullName}[${s.range}]` : s.fullName);
    }
}
// ---- processor-specific section builders -------------------------------
function emitIoSection(lines, scopes, instancePath, filter) {
    emitComment(lines, 'I/O ****************');
    const sigs = listSignalsInScope(scopes, instancePath);
    const reqIns = sigs.filter((s) => /^req_in_sim_?\d+$/.test(s.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const inSims = sigs.filter((s) => /^in_sim_?\d+$/.test(s.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const outEns = sigs.filter((s) => /^out_en_sim_?\d+$/.test(s.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const outSigs = sigs.filter((s) => /^out_sig_?\d+$/.test(s.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    // Aliases gerados a partir da POSICAO no array sorted completo —
    // o filter (opcional) pula a emissao do sinal mas a numeracao
    // continua refletindo a hierarquia inteira, pra que "req_in 0"
    // seja sempre o mesmo signal independente de o usuario ter
    // marcado req_in 1 ou nao.
    const pairCount = Math.max(reqIns.length, inSims.length);
    for (let i = 0; i < pairCount; i++) {
        if (reqIns[i])
            emitSignal(lines, reqIns[i], FMT_BIN, COLOR_YELLOW, `req_in ${i}`, { filter });
        if (inSims[i])
            emitSignal(lines, inSims[i], FMT_SIGNED_DEC, COLOR_YELLOW, `input  ${i}`, { filter });
    }
    const outPairCount = Math.max(outEns.length, outSigs.length);
    for (let i = 0; i < outPairCount; i++) {
        if (outEns[i])
            emitSignal(lines, outEns[i], FMT_BIN, COLOR_YELLOW, `out_en ${i}`, { filter });
        if (outSigs[i])
            emitSignal(lines, outSigs[i], FMT_SIGNED_DEC, COLOR_YELLOW, `output ${i}`, { filter });
    }
}
function emitInstructionsSection(lines, scopes, instancePath, paths, counter, _filter) {
    // Os tracks de instrucao (Assembly/valr2 + C+-/linetabs) sao a assinatura
    // curada do SAPHO e sao SEMPRE emitidos quando os sinais existem — NAO
    // passam pelo filtro do picker (paridade com o Surfer: "sempre que ha
    // processadores eles aparecem"). Por isso `filter` e omitido do emitSignal.
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
        if (!s.name.startsWith(prefix))
            continue;
        // Captura funcao e variavel do padrao `<...>_f_<func>_v_<var>_e_`.
        // Sem ancora no inicio: o prefix filter ja garantiu a categoria,
        // e o prefix pode ter underscores (e.g. `comp_me3_`).
        const m = s.name.match(/_f_(.*?)_v_(.*?)_e_$/);
        if (!m)
            continue;
        const fn = m[1];
        const vr = m[2];
        const funcLabel = fn === 'global' ? 'global' : `${fn}()`;
        out.push({ sig: s, var: vr, func: funcLabel });
    }
    out.sort((a, b) => a.sig.name.localeCompare(b.sig.name));
    return out;
}
function emitTypedVars(lines, scopes, instancePath, paths, counter, filter) {
    const ints = findTypedVars(scopes, instancePath, 'me1_');
    const floats = findTypedVars(scopes, instancePath, 'me2_');
    const comps = findTypedVars(scopes, instancePath, 'comp_me3_');
    for (const v of ints)
        emitSignal(lines, v.sig, FMT_SIGNED_DEC, COLOR_ORANGE, `int ${v.var} in ${v.func}`, { filter });
    for (const v of floats)
        emitSignal(lines, v.sig, FMT_REAL, COLOR_ORANGE, `float ${v.var} in ${v.func}`, { filter });
    for (const v of comps) {
        emitSignal(lines, v.sig, FMT_BIN, COLOR_ORANGE, `comp ${v.var} in ${v.func}`, {
            procFilterPath: paths.comp2gtkw,
            counter,
            filter,
        });
    }
}
// Arrays: nomes terminam com um sufixo numerico de 4 digitos. Agrupa
// por base (sem o sufixo) e cria um group GTKWave por base.
function emitArrayVars(lines, scopes, instancePath, prefix, fmt, typeLabel, procFilterPath, counter, filter) {
    const sigs = listSignalsInScope(scopes, instancePath);
    const groups = new Map(); // baseName -> [{ sig, idx }]
    for (const s of sigs) {
        if (!s.name.startsWith(prefix))
            continue;
        // Padrao: <base><NNNN> ou <base><NNNN>[bits]
        const m = s.name.match(/^(.*?)(\d{4})$/);
        if (!m)
            continue;
        const base = m[1];
        const idx = parseInt(m[2], 10);
        const bucket = groups.get(base);
        if (bucket)
            bucket.push({ sig: s, idx });
        else
            groups.set(base, [{ sig: s, idx }]);
    }
    for (const baseName of [...groups.keys()].sort()) {
        const items = (groups.get(baseName) ?? []).sort((a, b) => a.idx - b.idx);
        // Sem ancora no inicio — mesmo motivo de findTypedVars.
        const m = baseName.match(/_f_(.*?)_v_(.*?)_e_/);
        const fn = m ? m[1] : '';
        const vr = m ? m[2] : baseName;
        const funcLabel = fn === 'global' ? 'global' : `${fn}()`;
        const groupLabel = `${typeLabel} ${vr} in ${funcLabel}`;
        emitGroupBegin(lines, groupLabel);
        let i = 0;
        for (const { sig } of items) {
            const opts = procFilterPath
                ? { procFilterPath, counter, filter }
                : { filter };
            emitSignal(lines, sig, fmt, COLOR_ORANGE, `${vr} ${i}`, opts);
            i++;
        }
        emitGroupEnd(lines, groupLabel);
    }
}
function emitVariablesSection(lines, scopes, instancePath, paths, counter, filter) {
    emitComment(lines, 'Variables **********');
    emitTypedVars(lines, scopes, instancePath, paths, counter, filter);
    emitArrayVars(lines, scopes, instancePath, 'arr_me1_', FMT_SIGNED_DEC, 'int', null, counter, filter);
    emitArrayVars(lines, scopes, instancePath, 'arr_me2_', FMT_REAL, 'float', null, counter, filter);
    emitArrayVars(lines, scopes, instancePath, 'comp_arr_me3_', FMT_BIN, 'comp', paths.comp2gtkw, counter, filter);
}
function emitFlagsSection(lines, scopes, corePath, filter) {
    // Sem corePath (caso comum quando o $dumpvars nao desceu ate o
    // p_<X>.core do processador) nao ha onde achar Stack/ULA.
    if (!corePath)
        return;
    // Resolve os sinais ANTES de emitir o comentario "Flags ***".
    // Stack: data stack (sp) + instruction stack (isp). Cada um tem
    // pointeri (analog step + signed dec), fl_max (decimal), fl_full
    // (binary). Flags conferidos contra .gtkw salvo pelo GTKWave.
    const stackEntries = [
        { path: `${corePath}.sp`, name: 'pointeri', fmt: FMT_ANALOG_SIGNED, alias: 'Data Stack Pointer' },
        { path: `${corePath}.sp`, name: 'fl_max', fmt: FMT_DEC, alias: 'Data Stack Max' },
        { path: `${corePath}.sp`, name: 'fl_full', fmt: FMT_BIN, alias: 'Data Stack Overflow' },
        { path: `${corePath}.isp`, name: 'pointeri', fmt: FMT_ANALOG_SIGNED, alias: 'Inst Stack Pointer' },
        { path: `${corePath}.isp`, name: 'fl_max', fmt: FMT_DEC, alias: 'Inst Stack Max' },
        { path: `${corePath}.isp`, name: 'fl_full', fmt: FMT_BIN, alias: 'Inst Stack Overflow' },
    ];
    const stackResolved = stackEntries
        .map((e) => ({ ...e, sig: findSignal(scopes, e.path, e.name) }))
        .filter((e) => e.sig);
    // ULA: delta_int + delta_float renderizados como analog step + hex
    // (GTKWave default pra reals).
    const deltaInt = findSignal(scopes, `${corePath}.ula`, 'delta_int');
    const deltaFloat = findSignal(scopes, `${corePath}.ula`, 'delta_float');
    // Nenhum sinal de Stack/ULA presente (ex: sob Verilator esses sinais
    // internos do processador ficam fenced fora do trace) — pula a secao
    // inteira, sem emitir o comentario "Flags ***" orfao.
    if (stackResolved.length === 0 && !deltaInt && !deltaFloat)
        return;
    emitComment(lines, 'Flags **************');
    if (stackResolved.length > 0) {
        emitGroupBegin(lines, 'Stack');
        for (const e of stackResolved)
            emitSignal(lines, e.sig, e.fmt, COLOR_NORMAL, e.alias, { filter });
        emitGroupEnd(lines, 'Stack');
    }
    if (deltaInt || deltaFloat) {
        emitGroupBegin(lines, 'ULA');
        if (deltaInt)
            emitSignal(lines, deltaInt, FMT_ANALOG_HEX, COLOR_NORMAL, 'Rounding Error (int)', { filter });
        if (deltaFloat)
            emitSignal(lines, deltaFloat, FMT_ANALOG_HEX, COLOR_NORMAL, 'Rounding Error (float)', { filter });
        emitGroupEnd(lines, 'ULA');
    }
}
// ---- alias map builder (shared with WC modal) --------------------------
/**
 * Constroi um Map<fullSignalPath, alias> aplicando as mesmas regras
 * que o gtkw writer usa. Permite que a Wave Configuration mostre os
 * mesmos labels amigaveis ("int cont in global", "Assembly",
 * "Data Stack Pointer") em vez dos nomes crus de hierarquia.
 *
 * Aceita scopes em qualquer fonte (VCD parser ou Verilog hierarchy
 * tree) — desde que cada scope tenha { path, signals: [{ name }] }
 * o helper produz o map.
 *
 * @param {Array<{ path: string, signals: Array<{ name: string }> }>} scopes
 * @returns {Map<string, string>}
 */
export function buildAliasMap(scopes) {
    const map = new Map();
    if (!Array.isArray(scopes) || scopes.length === 0)
        return map;
    const procs = detectProcessors(scopes);
    for (const proc of procs) {
        addProcessorAliases(map, scopes, proc);
    }
    return map;
}
function addProcessorAliases(map, scopes, proc) {
    const { instancePath, corePath } = proc;
    const sigs = listSignalsInScope(scopes, instancePath);
    // I/O — alias posicional dentro da lista sorted naturalmente.
    const byPattern = (re) => sigs.filter((s) => re.test(s.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const reqIns = byPattern(/^req_in_sim_?\d+$/);
    const inSims = byPattern(/^in_sim_?\d+$/);
    const outEns = byPattern(/^out_en_sim_?\d+$/);
    const outSigs = byPattern(/^out_sig_?\d+$/);
    reqIns.forEach((s, i) => map.set(s.fullName, `req_in ${i}`));
    inSims.forEach((s, i) => map.set(s.fullName, `input ${i}`));
    outEns.forEach((s, i) => map.set(s.fullName, `out_en ${i}`));
    outSigs.forEach((s, i) => map.set(s.fullName, `output ${i}`));
    // Instructions
    const valr2 = findSignal(scopes, instancePath, 'valr2');
    if (valr2)
        map.set(valr2.fullName, 'Assembly');
    const linetabs = findSignal(scopes, instancePath, 'linetabs');
    if (linetabs)
        map.set(linetabs.fullName, 'C+-');
    // Typed scalar vars: me1 (int), me2 (float), comp_me3 (comp).
    const aliasFromVarName = (s, label) => {
        // Sem ancora no inicio — prefix filter ja distinguiu o tipo,
        // e prefixos com underscore (comp_me3) nao batem em `[^_]+`.
        const m = s.name.match(/_f_(.*?)_v_(.*?)_e_$/);
        if (!m)
            return null;
        const fn = m[1];
        const vr = m[2];
        return `${label} ${vr} in ${fn === 'global' ? 'global' : `${fn}()`}`;
    };
    for (const s of sigs) {
        let alias = null;
        if (s.name.startsWith('me1_'))
            alias = aliasFromVarName(s, 'int');
        else if (s.name.startsWith('me2_'))
            alias = aliasFromVarName(s, 'float');
        else if (s.name.startsWith('comp_me3_'))
            alias = aliasFromVarName(s, 'comp');
        if (alias)
            map.set(s.fullName, alias);
    }
    // Array vars (arr_me1, arr_me2, comp_arr_me3): cada indice ganha
    // alias "<var> N" (0-based) dentro de seu base group.
    const arrayPrefixes = ['arr_me1_', 'arr_me2_', 'comp_arr_me3_'];
    for (const prefix of arrayPrefixes) {
        const groups = new Map();
        for (const s of sigs) {
            if (!s.name.startsWith(prefix))
                continue;
            const m = s.name.match(/^(.*?)(\d{4})$/);
            if (!m)
                continue;
            const base = m[1];
            const idx = parseInt(m[2], 10);
            const bucket = groups.get(base);
            if (bucket)
                bucket.push({ sig: s, idx });
            else
                groups.set(base, [{ sig: s, idx }]);
        }
        for (const items of groups.values()) {
            items.sort((a, b) => a.idx - b.idx);
            const baseName = items[0].sig.name.match(/^(.*?)\d{4}$/)?.[1] || '';
            const m = baseName.match(/_f_(.*?)_v_(.*?)_e_/);
            const vr = m ? m[2] : baseName;
            items.forEach((it, i) => map.set(it.sig.fullName, `${vr} ${i}`));
        }
    }
    // Flags: Stack (sp + isp) e ULA.
    const stackAliases = [
        { path: `${corePath}.sp`, name: 'pointeri', alias: 'Data Stack Pointer' },
        { path: `${corePath}.sp`, name: 'fl_max', alias: 'Data Stack Max' },
        { path: `${corePath}.sp`, name: 'fl_full', alias: 'Data Stack Overflow' },
        { path: `${corePath}.isp`, name: 'pointeri', alias: 'Inst Stack Pointer' },
        { path: `${corePath}.isp`, name: 'fl_max', alias: 'Inst Stack Max' },
        { path: `${corePath}.isp`, name: 'fl_full', alias: 'Inst Stack Overflow' },
    ];
    for (const e of stackAliases) {
        const s = findSignal(scopes, e.path, e.name);
        if (s)
            map.set(s.fullName, e.alias);
    }
    const dInt = findSignal(scopes, `${corePath}.ula`, 'delta_int');
    if (dInt)
        map.set(dInt.fullName, 'Rounding Error (int)');
    const dFloat = findSignal(scopes, `${corePath}.ula`, 'delta_float');
    if (dFloat)
        map.set(dFloat.fullName, 'Rounding Error (float)');
}
// ---- public entry point ------------------------------------------------
/**
 * Constroi o conteudo de um .gtkw a partir do VCD parseado: uma
 * secao "Top-level" listando tudo que nao pertence a nenhum
 * processador, seguida de uma secao completa (cores/aliases/grupos
 * SAPHO) pra cada processador detectado.
 *
 * @param {object} input
 * @param {string} input.vcdPath      usado em [dumpfile]
 * @param {string} input.gtkwPath     usado em [savefile]
 * @param {VcdScope[]} input.scopes   scope tree parseado do VCD
 * @param {string} [input.tbModule]   scope do testbench top. Kept na
 *      signature pra compat — clk/rst/itr vem do core de cada proc.
 * @param {string} [input.tempBaseDir]  raiz do Temp/. Resolve trad files
 *      em <tempBaseDir>/<procType>/trad_opcode.txt e trad_cmm.txt.
 * @param {string} [input.binDir]     dir do bin/ com comp2gtkw.exe
 *      (process filter pra comp_me3* vars e comp_arr_me3 arrays).
 * @param {string[]} [input.selectedSignals]  filter — quando setado,
 *      so emite sinais cujo full-path bate. Mantem decoracao
 *      (cor/alias) onde aplicavel.
 * @param {Map<string, {signals, instances}>} [input.modules]  output
 *      de `parseVerilogModules` (signal_parser). Quando passado, a
 *      gente resolve scope→moduleType pra descobrir o procType
 *      correto (igual ao nome da pasta Temp/<procType>/ que cmmcomp
 *      escreveu, onde estao os trad files) e ja constroi o
 *      signedSet a partir das declaracoes. Sem isso, cai nas
 *      heuristicas baseadas em nomes de scope.
 * @returns {{ content: string|null, processorCount: number }}
 *      content: null so quando scopes esta vazio (VCD invalido).
 *      Caso contrario sempre retorna o layout, mesmo sem processadores
 *      detectados (so a secao top-level).
 */
export function buildAuroraGtkw({ vcdPath, gtkwPath, scopes, tbModule = null, tempBaseDir = null, binDir = null, selectedSignals = null, modules = null, }) {
    // Filter opcional: lista de full-paths (strings). Quando setado,
    // o layout completo e percorrido — comentarios, grupos, cores,
    // tradutores — mas apenas sinais cujo path bate ficam emitidos.
    // Aliases continuam refletindo a hierarquia inteira (positions
    // estaveis) mesmo que parte dos sinais nao apareca.
    const filter = (Array.isArray(selectedSignals) && selectedSignals.length > 0)
        ? new Set(selectedSignals)
        : null;
    if (!Array.isArray(scopes) || scopes.length === 0) {
        return { content: null, processorCount: 0 };
    }
    // Resolve scope → moduleType uma vez, reusa em detectProcessors
    // (procType correto = nome da pasta Temp/<procType>/) e em
    // buildSignedSet (top-level Decimal vs Signed Decimal).
    const scopeModules = modules ? resolveScopeModules(scopes, modules) : null;
    const procs = detectProcessors(scopes, scopeModules);
    const signedSet = modules
        ? buildSignedSet(scopes, modules, scopeModules)
        : null;
    // Header: GTKWave salva paths com BACKSLASH no Windows. Reusamos
    // as paths tal qual vieram (sem normalizar pra forward slash) pra
    // espelhar o formato canonico — verificado contra .gtkw salvo pelo
    // GTKWave em Windows.
    const lines = [
        '[*]',
        '[*] Generated by Aurora',
        '[*]',
        `[dumpfile] "${vcdPath}"`,
        `[savefile] "${gtkwPath}"`,
        '[timestart] 0',
    ];
    // Top-level: tudo que nao esta dentro de um processador. Sempre
    // primeiro pra dar contexto antes das secoes internas.
    emitTopLevelSection(lines, scopes, procs.map((p) => p.instancePath), filter, signedSet);
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
    // Procura clk/rst/itr no CORE do processador primeiro (caso multi-
    // proc com domínio de clock proprio, como o exemplo canonico do
    // SAPHO). Se nao achar, cai pro escopo do testbench top (caso onde
    // o processador recebe o clk da fora). Retorna o primeiro achado
    // ou null.
    const findCoreOrTb = (corePath, name) => {
        return (corePath ? findSignal(scopes, corePath, name) : null)
            || (tbModule ? findSignal(scopes, tbModule, name) : null);
    };
    procs.forEach((proc) => {
        const paths = resolveProcPaths(proc);
        // Banner do processador: usa o instanceName pra distinguir
        // instancias diferentes do mesmo procType (designs multi-proc
        // costumam ter `proc1`, `proc2`, ou nomes proprios tipo
        // `DTWv4_inst`, `ZeroCross_inst`). procType continua sendo
        // usado pra resolver Temp/<procType>/trad_*.txt acima.
        emitComment(lines, `###### ${proc.instanceName}`);
        // clk/rst/itr do processador. Cada proc tem seu proprio par
        // logo abaixo do banner. Se o testbench compartilha esses
        // sinais entre varios processadores, eles aparecem repetidos
        // — comportamento aceitavel, deixa claro a qual proc cada
        // linha pertence.
        const procClk = findCoreOrTb(proc.corePath, 'clk');
        const procRst = findCoreOrTb(proc.corePath, 'rst');
        const procItr = findCoreOrTb(proc.corePath, 'itr');
        if (procClk)
            emitSignal(lines, procClk, FMT_BIN, COLOR_NORMAL, null, { filter });
        if (procRst)
            emitSignal(lines, procRst, FMT_BIN, COLOR_NORMAL, null, { filter });
        if (procItr)
            emitSignal(lines, procItr, FMT_BIN, COLOR_NORMAL, null, { filter });
        emitIoSection(lines, scopes, proc.instancePath, filter);
        emitInstructionsSection(lines, scopes, proc.instancePath, paths, counter, filter);
        emitVariablesSection(lines, scopes, proc.instancePath, paths, counter, filter);
        emitFlagsSection(lines, scopes, proc.corePath, filter);
    });
    return { content: lines.join('\n') + '\n', processorCount: procs.length };
}
