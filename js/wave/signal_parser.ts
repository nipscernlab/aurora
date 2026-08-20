/**
 * signal_parser.ts: Lightweight Verilog parser for the Wave
 * Configuration picker.
 *
 * Why not Yosys?
 *   - Aurora's existing hierarchy generation only feeds Yosys the
 *     synthesizable files; the testbench is excluded, so signals
 *     declared in it never make it into the JSON.
 *   - Yosys also optimises away unused nets, so a "wire foo;" the
 *     user wants to trace might disappear from the JSON.
 *   - The picker needs the user-declared signal list before any
 *     simulation runs, so we can't pull the names from a VCD either.
 *
 * Why a regex parser?
 *   - The picker only needs *names* of signals + module instantiations,
 *     not types/expressions/timing. A real parser would be overkill.
 *   - Aurora's domain is small-to-medium FPGA designs; macros and
 *     `ifdef branches are rare. When they do break us, the user can
 *     still hand-craft a .gtkw via Project Settings, we degrade
 *     gracefully, not catastrophically.
 *
 * Compilado por `tsc` (npm run build:ts) num signal_parser.js ao lado, é esse
 * .js que o runtime carrega; os imports usam a extensão `.js`.
 *
 * Limitations (acceptable for Phase 2):
 *   - No preprocessor: `define / `ifdef are NOT expanded.
 *   - Generate-block instantiations are skipped (we only catch direct
 *     instances at module scope).
 *   - SystemVerilog typedefs / packages / interfaces: not supported.
 */

/** A single declared signal/port pulled from a module body. */
export interface VerilogSignal {
    name: string;
    /** Primary kind keyword (input/output/reg/wire/...), by priority. */
    kind: string;
    isSigned: boolean;
    /** Bit range text without brackets (e.g. "31:0"), or null if scalar. */
    range: string | null;
}

/** A direct module instantiation found at module scope. */
export interface ModuleInstance {
    instanceName: string;
    moduleType: string;
}

/** Everything the parser knows about one module. */
export interface ModuleInfo {
    file: string;
    signals: VerilogSignal[];
    instances: ModuleInstance[];
}

/** A soft parse error, collected, never thrown. */
export interface ParseError {
    file: string;
    message: string;
}

/** Result of {@link parseVerilogModules}. */
export interface ParseResult {
    modules: Map<string, ModuleInfo>;
    errors: ParseError[];
}

/** One node of the design hierarchy from {@link buildHierarchyTree}. */
export interface HierarchyNode {
    name: string;
    instanceName: string | null;
    scopePath: string;
    signals: VerilogSignal[];
    children: HierarchyNode[];
}

/** Input file pair fed to {@link parseVerilogModules}. */
export interface VerilogFile {
    path: string;
    content: string;
}

// Tipos de declaracao de signal que queremos capturar. Note: `real`,
// `integer`, `time` sao tipos non-synth mas aparecem no source gerado
// pelo asmcomp pra variaveis C± float (real), int (integer/reg), etc.
// Sem isso o Wave Config picker nao mostra variaveis `real` (= C±
// float), o $dumpvars nao inclui, e o VCD/.gtkw ficam sem.
const KIND_TOKENS = ['input', 'output', 'inout', 'wire', 'reg', 'logic',
    'signed', 'tri', 'tri0', 'tri1', 'wand', 'wor',
    'real', 'integer', 'time'];
const KIND_RE_SOURCE = `(?:${KIND_TOKENS.join('|')})`;
const PRIMARY_KIND_PRIORITY: Record<string, number> = {
    input: 4, output: 4, inout: 4,
    reg: 3, logic: 3, real: 3, integer: 3, time: 3,
    wire: 2, tri: 2, tri0: 2, tri1: 2, wand: 2, wor: 2,
    signed: 1,
};

const RESERVED_KEYWORDS = new Set<string>([
    'always', 'assign', 'begin', 'case', 'casex', 'casez', 'else', 'end',
    'endcase', 'endfunction', 'endgenerate', 'endmodule', 'endspecify',
    'endtable', 'endtask', 'for', 'forever', 'function', 'generate',
    'genvar', 'if', 'initial', 'localparam', 'parameter', 'posedge',
    'negedge', 'repeat', 'specify', 'task', 'while', 'fork', 'join',
    'wait', 'release', 'force', 'deassign', 'disable',
    'event', 'module', 'macromodule', 'primitive',
    'endprimitive', 'defparam', 'pulldown', 'pullup', 'tran', 'tranif0',
    'tranif1', 'rtran', 'rtranif0', 'rtranif1',
    ...KIND_TOKENS,
]);

/**
 * Strip /* ... *\/ and // ... line comments. Verilog doesn't put module
 * bodies inside string literals, so a string-naive replace is fine.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Find each `module <name> ... endmodule` body. Both the optional
 * parameter list `#(...)` and the optional port list `(...)` are
 * supported; modules that omit one or both (e.g. `module tb;`) parse.
 */
function extractModules(stripped: string): Array<{ name: string; body: string }> {
    const out: Array<{ name: string; body: string }> = [];
    const re = /\bmodule\s+([A-Za-z_][\w$]*)\s*(?:#\s*\([\s\S]*?\)\s*)?(?:\(([\s\S]*?)\))?\s*;([\s\S]*?)\bendmodule\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
        const [, name, portHeader, bodyRaw] = m;
        // Treat the header port list as part of the body for signal
        // extraction, ANSI-style declarations live there. Wrap each
        // port entry as semi-terminated so the same kind regex works.
        const headerLines = expandPortHeader(portHeader);
        out.push({ name, body: headerLines + '\n' + bodyRaw });
    }
    return out;
}

/**
 * Em Verilog ANSI, `input a, b, c` declara TRÊS ports do mesmo kind:
 * a vírgula separa nomes, não declarações. Split simples por `,` deixa
 * `b` e `c` sem kind keyword e `extractSignals` ignora. Aqui propagamos
 * o último prefixo (kind + range) visto pras entradas seguintes que
 * não trazem o seu próprio.
 */
function expandPortHeader(portHeader: string | undefined): string {
    if (!portHeader) return '';
    const parts = portHeader.split(',').map((s) => s.trim()).filter(Boolean);
    const leadRe = new RegExp(`^((?:\\b${KIND_RE_SOURCE}\\b\\s+)+(?:\\[[^\\]]+\\]\\s*)?)`);
    let currentPrefix = '';
    return parts.map((p) => {
        const m = p.match(leadRe);
        if (m) {
            currentPrefix = m[1];
            return p + ';';
        }
        return currentPrefix + p + ';';
    }).join('\n');
}

/**
 * Pull signal declarations out of a module body. A declaration looks
 * like (whitespace-flexible):
 *
 *     <kind> [<kind> ...] [signed] [<range>] <name1>, <name2>, ... ;
 *
 * Multiple kind keywords are valid in Verilog: `input wire clk;`,
 * `output reg [3:0] q;`, etc. We capture the whole keyword run and
 * pick a primary by priority: direction (input/output/inout) wins over
 * net type (wire/reg/logic), and `signed` is always a modifier.
 */
function extractSignals(body: string): VerilogSignal[] {
    const re = new RegExp(
        // 1: one or more space-separated kind keywords
        `((?:\\b${KIND_RE_SOURCE}\\b\\s+)+)` +
        // 2: optional [range]
        `(?:(\\[[^\\]]+\\])\\s*)?` +
        // 3: comma-separated names, lazy so we stop at the terminator
        `([A-Za-z_][\\w$,\\s]*?)` +
        // terminator: ; or = (init), but NOT (, that's a function/task
        `\\s*(?=[;=])`,
        'g',
    );

    const collected: VerilogSignal[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        const [, kindBlob, range, namesPart] = m;
        const kinds = kindBlob.trim().split(/\s+/);
        const primary = kinds.reduce((best, k) =>
            (PRIMARY_KIND_PRIORITY[k] ?? 0) > (PRIMARY_KIND_PRIORITY[best] ?? 0) ? k : best,
        kinds[0]);
        // `signed` e modificador independente do primary kind. Preserva
        // aparte porque consumers (e.g. .gtkw writer escolhendo entre
        // Decimal vs Signed Decimal) precisam disso, e o reduce acima
        // descarta o keyword.
        const isSigned = kinds.includes('signed');
        const names = namesPart.split(',').map((n) => n.trim()).filter(Boolean);
        for (const rawName of names) {
            const cleaned = rawName.replace(/=.*$/, '').trim();
            if (!/^[A-Za-z_][\w$]*$/.test(cleaned)) continue;
            collected.push({
                name: cleaned,
                kind: primary,
                isSigned,
                range: range ? range.slice(1, -1) : null,
            });
        }
    }

    // De-dup: uma port pode ser re-declarada no body (non-ANSI), manter
    // uma entry, preferindo o kind de maior prioridade. Se qualquer
    // declaracao for `signed`, propaga.
    const dedup = new Map<string, VerilogSignal>();
    for (const s of collected) {
        const prev = dedup.get(s.name);
        if (!prev || (PRIMARY_KIND_PRIORITY[s.kind] ?? 0) > (PRIMARY_KIND_PRIORITY[prev.kind] ?? 0)) {
            dedup.set(s.name, {
                ...s,
                isSigned: s.isSigned || (prev ? prev.isSigned : false),
            });
        } else if (s.isSigned && !prev.isSigned) {
            // Mesma prioridade mas esta declaracao tem signed que a anterior
            // nao tinha → atualiza so o flag.
            dedup.set(s.name, { ...prev, isSigned: true });
        }
    }
    return [...dedup.values()];
}

/**
 * Remove diretivas de pre-processador (`\`ifdef X`, `\`else`,
 * `\`endif`, `\`define`, etc) substituindo por whitespace. Sem isso,
 * a diretiva fica entre o typeName de uma instance parametrizada e
 * o instanceName subsequente, fazendo o regex de extractInstances
 * pular a instance.
 *
 * Estrategia conservadora: nao avalia condicionais, apenas remove
 * as diretivas e mantem TODOS os ramos. Vira "both branches active"
 * no source virtual, e dedup-amos instances depois por nome.
 */
function stripDirectives(body: string): string {
    return body.replace(/`(ifdef|ifndef|elsif|else|endif|define|undef|include|timescale|resetall|celldefine|endcelldefine|default_nettype|line|nounconnected_drive|unconnected_drive|protect|endprotect)\b[^\n]*/g, ' ');
}

/**
 * Remove blocos `generate if (...)` e `generate case (...)`:
 * elaboracao Verilog so instancia esses corpos quando a condicao e
 * verdade na compilacao. O signal_parser nao avalia parameters,
 * entao captura instancias condicionais como se sempre existissem.
 * Iverilog depois falha com "Unable to bind" quando $dumpvars
 * referencia paths que so seriam validos sob certo param value.
 *
 * Estrategia: stripar de `generate if/case` ate o `endgenerate`
 * mais proximo (non-greedy). Ignora aninhamento, raros na pratica;
 * pior caso e stripar um bloco interno maior. Generates SEM
 * condicao (e.g. `generate for (...) ...`) sao preservados porque
 * elaboram sempre.
 */
function stripConditionalGenerates(body: string): string {
    return body.replace(/\bgenerate\s+(?:if|case)\b[\s\S]*?\bendgenerate\b/g, ' ');
}

/**
 * Substitui blocos `#(...)` por `#()` no source (parens balanceados,
 * string-literal aware). Necessario porque a parameter list de
 * instanciacoes parametrizadas costuma ter parens aninhados (e.g.
 * `.IFILE("...")`, `[$clog2(N)-1:0]`). Regex non-greedy `\(.*?\)`
 * paraa no primeiro `)`, e o backtracking pode acabar emparelhando
 * typeName de uma instance com instanceName de OUTRA instance varias
 * linhas abaixo. Bug observado: ProcDTW.v com `processor#(.NUBITS(32),
 * ..., .IFILE("..."))` faz o regex casar `processor` + `dec_in` (que
 * eh instance do addr_dec, nao de processor).
 *
 * Stripping #(...) antes do regex elimina o ambiguity, fica
 * `processor#() p_ProcDTW(...)`, regex captura sem confusao.
 */
function stripParamLists(body: string): string {
    let result = '';
    let i = 0;
    while (i < body.length) {
        if (body[i] === '#' && body[i + 1] === '(') {
            result += '#()';
            i += 2;
            let depth = 1;
            while (i < body.length && depth > 0) {
                const c = body[i];
                if (c === '(') depth++;
                else if (c === ')') depth--;
                else if (c === '"') {
                    // String literal, pula ate fechar (com escape)
                    i++;
                    while (i < body.length && body[i] !== '"') {
                        if (body[i] === '\\' && i + 1 < body.length) i++;
                        i++;
                    }
                }
                i++;
            }
            // i ja avancou pra alem do `)` final do #(...).
        } else {
            result += body[i];
            i++;
        }
    }
    return result;
}

/**
 * Find module instantiations in the body: `<typeName> [#(...)] <instName> ( ... );`.
 * The typeName must match a known module from the first pass, otherwise
 * we'd flag every function call and behavioural construct as an instance.
 */
function extractInstances(body: string, knownModuleNames: Set<string>): ModuleInstance[] {
    const seen = new Map<string, string>();   // instanceName → moduleType, pra dedup
    // `body` ja vem stripado de diretivas e blocos generate-if (feito
    // em parseVerilogModules pra que signals/instances vejam a mesma
    // view). Aqui so resta stripar parameter lists com parens aninhados
    // (`#(...)` → `#()`) pra que o regex non-greedy nao confunda
    // instancias adjacentes.
    const stripped = stripParamLists(body);
    const re = /\b([A-Za-z_][\w$]*)\s*(?:#\s*\(\)\s*)?([A-Za-z_][\w$]*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
        const [, typeName, instName] = m;
        if (!knownModuleNames.has(typeName)) continue;
        if (RESERVED_KEYWORDS.has(typeName)) continue;
        if (RESERVED_KEYWORDS.has(instName)) continue;
        // Dedup: blocos `ifdef/`else duplicados podem gerar a mesma
        // instance duas vezes apos stripDirectives. Manter o primeiro
        // match e o suficiente, a hierarquia logica e a mesma.
        if (!seen.has(instName)) seen.set(instName, typeName);
    }
    return [...seen.entries()].map(([instanceName, moduleType]) => ({ instanceName, moduleType }));
}

/**
 * Parse a list of {path, content} files and return a module map plus
 * any soft errors. Soft errors don't abort.
 */
export function parseVerilogModules(files: VerilogFile[]): ParseResult {
    const modules = new Map<string, ModuleInfo>();
    const errors: ParseError[] = [];

    const stripped = files.map(({ path, content }) => ({ path, src: stripComments(content) }));

    // First pass: collect module names so the instance scan can
    // distinguish module instantiations from function calls.
    const knownModuleNames = new Set<string>();
    for (const { path, src } of stripped) {
        for (const block of extractModules(src)) {
            if (knownModuleNames.has(block.name)) {
                errors.push({ file: path, message: `Duplicate module name: ${block.name}` });
            }
            knownModuleNames.add(block.name);
        }
    }

    // Second pass: extract signals + instances per module.
    for (const { path, src } of stripped) {
        for (const block of extractModules(src)) {
            // Pre-strip body de constructos cuja elaboracao depende
            // de parameter values:
            //  - diretivas `ifdef → whitespace (mantem ambos os ramos
            //    se houver `else)
            //  - blocos `generate if/case` → whitespace (eliminados
            //    se a condicao falha em elaboracao). Tanto signals
            //    quanto instances declarados dentro sao tratados como
            //    "podem nao existir" e descartados aqui, melhor que
            //    iverilog falhar com "Unable to bind".
            const cleanBody = stripConditionalGenerates(stripDirectives(block.body));
            modules.set(block.name, {
                file: path,
                signals: extractSignals(cleanBody),
                instances: extractInstances(cleanBody, knownModuleNames),
            });
        }
    }

    return { modules, errors };
}

/**
 * Build a tree rooted at `topModuleName`, descending through each
 * instantiation. Cycles (illegal in real Verilog) are broken by tracking
 * a visited set, depth-first stops re-entering a module already on the
 * current path.
 */
export function buildHierarchyTree(modules: Map<string, ModuleInfo>, topModuleName: string): HierarchyNode {
    const visit = (
        moduleType: string,
        instanceName: string | null,
        parentPath: string | null,
        ancestors: Set<string>,
    ): HierarchyNode => {
        const info = modules.get(moduleType);
        const scopePath = parentPath
            ? `${parentPath}.${instanceName}`
            : instanceName ?? moduleType;
        if (!info) {
            return { name: moduleType, instanceName, scopePath, signals: [], children: [] };
        }
        if (ancestors.has(moduleType)) {
            return { name: moduleType, instanceName, scopePath, signals: info.signals, children: [] };
        }
        const nextAncestors = new Set(ancestors).add(moduleType);
        return {
            name: moduleType,
            instanceName,
            scopePath,
            signals: info.signals,
            children: info.instances.map((inst) =>
                visit(inst.moduleType, inst.instanceName, scopePath, nextAncestors),
            ),
        };
    };

    return visit(topModuleName, null, null, new Set());
}

/**
 * Achata a hierarquia na lista plana de caminhos pontuados que o `$dumpvars`
 * consome, `tb.dut.core.pc` e assim por diante.
 *
 * Isto vivia dentro do `aurora_api.js`, e o lugar dele é aqui: quem constrói a
 * árvore é o {@link buildHierarchyTree}, logo acima, e achatá-la é a operação
 * irmã. Enterrada lá, ela não tinha teste, e é a função que decide QUAIS sinais
 * a AURORA oferece para dumpar, errar nela não dá erro, dá forma de onda com o
 * sinal faltando, que o usuário só descobre olhando.
 *
 * Um nó sem `signals` ou sem `children` é normal e não é erro: um módulo pode
 * não declarar sinal nenhum, e uma folha não tem filhos. Recursão que assumisse
 * os dois campos presentes quebraria na primeira caixa-preta da hierarquia,
 * porque `buildHierarchyTree` devolve `signals: []` justamente para o módulo
 * cujo corpo ele não encontrou.
 */
export function flattenSignalPaths(node: HierarchyNode | null | undefined, out: string[] = []): string[] {
    if (!node) return out;
    for (const sig of (node.signals || [])) out.push(`${node.scopePath}.${sig.name}`);
    for (const child of (node.children || [])) flattenSignalPaths(child, out);
    return out;
}

/**
 * Escopos de monitoramento do processador SAPHO, derivados da arvore de
 * hierarquia DOS FONTES (pre-simulacao, entao sem ovo-e-galinha com o FST).
 *
 * O core (components/HDL/core.v) mantem, atras do guard YANC_SIM_VIS, os
 * flags das pilhas (sp/isp: pointeri, fl_max, fl_full) e os erros de
 * arredondamento da ULA (delta_int, delta_float). Eles existem em TODA
 * simulacao (Icarus liga o guard via __ICARUS__; o builder do Verilator passa
 * +define+YANC_TRACE), mas nunca chegavam ao dump: o $dumpvars da
 * instrumentacao cobria so a selecao do picker ou o escopo raso do tb, e o
 * layout automatico (grupos Stack/ULA do gtkw_proc_writer) ficava faminto.
 *
 * Devolve caminhos de ESCOPO ('tb.u_x.p_t.core.sp') para um
 * $dumpvars(1, ...) proprio, verificado sob Verilator 5.048 sem tags
 * public: instancia interna referida por caminho hierarquico e dumpada.
 *
 * @param tree arvore de buildHierarchyTree (raiz = modulo do testbench)
 * @returns escopos de monitor, [] sem processador na arvore
 */
/**
 * Nome deterministico do espelho de um monitor no escopo do testbench.
 * Compartilhado entre o instrumentador (que DECLARA o espelho) e os
 * escritores de layout (que o PROCURAM no dump): qualquer divergencia aqui
 * quebra o encontro em silencio, entao ha um unico dono do formato.
 * @param corePathRel caminho do core RELATIVO ao tb (sem o modulo raiz)
 */
export function monitorMirrorName(corePathRel: string, inst: string, varName: string): string {
    return `aurora_${inst}_${varName}__${corePathRel.replace(/[^A-Za-z0-9]/g, '_')}`;
}

export interface MonitorMirror {
    /** referencia hierarquica RELATIVA ao tb (ex: dut.u.p_x.core.sp.fl_max) */
    ref: string;
    /** nome da variavel-espelho declarada no proprio tb */
    mirror: string;
    /** tipo verilog da declaracao do espelho */
    kind: 'integer' | 'reg' | 'real';
}

/**
 * Monitores do processador SAPHO (pilha + erro da ULA) como ESPELHOS no
 * testbench, derivados da arvore de hierarquia DOS FONTES.
 *
 * Por que espelhos e nao $dumpvars profundos: sob Verilator --binary os
 * argumentos do $dumpvars sao ignorados e o trace cobre apenas a
 * hierarquia visivel (nao-inlineada) — variaveis internas nunca aparecem,
 * e tornar os modulos publicos arrasta junto o array mem das pilhas
 * (854 MB de FST no ensaio de 20/08). Um always @(*) no tb copiando cada
 * monitor para uma variavel local poe os cinco sinais no unico escopo que
 * os DOIS simuladores sempre rastreiam, por ~3 MB de FST.
 *
 * SOMENTE instancias e variaveis que o parser viu de fato, nunca nomes
 * fabricados: o isp vive num generate if (CAL) e uma referencia a escopo
 * inexistente e erro de ELABORACAO no Icarus. O parser pula generate
 * blocks, entao o isp fica de fora ate ele aprender a le-los.
 */
export function deriveMonitorScopes(tree: HierarchyNode | null | undefined): MonitorMirror[] {
    if (!tree) return [];
    const out: MonitorMirror[] = [];
    const WANTED: Record<string, string[]> = {
        sp: ['pointeri', 'fl_max', 'fl_full'],
        isp: ['pointeri', 'fl_max', 'fl_full'],
        ula: ['delta_int', 'delta_float'],
    };
    const rootPrefix = tree.scopePath + '.';
    const walk = (node: HierarchyNode | null | undefined): void => {
        if (!node) return;
        if (node.name === 'core') {
            const corePathRel = node.scopePath.startsWith(rootPrefix)
                ? node.scopePath.slice(rootPrefix.length)
                : node.scopePath;
            for (const child of node.children || []) {
                const inst = child?.instanceName;
                if (!inst) continue;
                const wanted = WANTED[inst];
                if (!wanted) continue;
                const declared = new Set((child.signals || []).map((s) => s.name));
                for (const v of wanted) {
                    if (!declared.has(v)) continue;
                    out.push({
                        ref: corePathRel + '.' + inst + '.' + v,
                        mirror: monitorMirrorName(corePathRel, inst, v),
                        kind: v.startsWith('delta') ? 'real' : (v === 'fl_full' ? 'reg' : 'integer'),
                    });
                }
            }
            return; // dentro do core nao ha outro core
        }
        for (const child of node.children || []) walk(child);
    };
    walk(tree);
    return out;
}
