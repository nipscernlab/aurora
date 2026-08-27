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
import {
    extractNamedGenerates, declaredParams, overriddenParams, evaluateCondition, resolveParamValue,
} from './generate_blocks.js';

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
    /**
     * Parâmetros que a instanciação sobrescreve, como TEXTO: pode ser um
     * inteiro ou o nome de um parâmetro de quem instancia (`.CAL(CAL)`), e
     * quem resolve isso é a hierarquia, que conhece os dois escopos.
     */
    params?: Map<string, string>;
}

/**
 * Um ramo NOMEADO de `generate if`, já com o que ele declara dentro.
 *
 * Vive fora de `signals`/`instances` porque ele SÓ existe quando a condição
 * é verdadeira: quem constrói a hierarquia resolve isso com os parâmetros da
 * instância e só então decide se o escopo entra. Ver generate_blocks.ts.
 */
export interface ConditionalScope {
    label: string;
    condition: string;
    negated: boolean;
    signals: VerilogSignal[];
    instances: ModuleInstance[];
}

/** Everything the parser knows about one module. */
export interface ModuleInfo {
    file: string;
    signals: VerilogSignal[];
    instances: ModuleInstance[];
    /** Valores padrão dos parâmetros declarados, só os que são inteiros. */
    params: Map<string, number>;
    /** Ramos nomeados de `generate if`, resolvidos na hierarquia. */
    conditionals: ConditionalScope[];
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
    /**
     * Escopo que veio de um `generate if` nomeado, e não de uma instanciação.
     *
     * Marcado porque os dois simuladores discordam sobre ele: o Icarus resolve
     * uma referência hierárquica que atravessa esse escopo, e o Verilator não
     * (medido em 23/08/2026 com o 5.048, que responde "Known scopes under
     * ...isp_blk: <no instances found>" mesmo com a condição verdadeira).
     * Quem monta espelho precisa saber disso antes de escrever o testbench.
     */
    fromGenerate?: boolean;
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
function extractModules(stripped: string): Array<{ name: string; body: string; paramHeader: string }> {
    const out: Array<{ name: string; body: string; paramHeader: string }> = [];
    const re = /\bmodule\s+([A-Za-z_][\w$]*)\s*(?:#\s*\(([\s\S]*?)\)\s*)?(?:\(([\s\S]*?)\))?\s*;([\s\S]*?)\bendmodule\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
        const [, name, paramHeader, portHeader, bodyRaw] = m;
        // Treat the header port list as part of the body for signal
        // extraction, ANSI-style declarations live there. Wrap each
        // port entry as semi-terminated so the same kind regex works.
        const headerLines = expandPortHeader(portHeader);
        out.push({ name, body: headerLines + '\n' + bodyRaw, paramHeader: paramHeader || '' });
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
    // Os `#(...)` originais, na ordem, para casar com os `#()` que o
    // stripParamLists deixa: é de lá que sai o `.CAL(1)` que decide se um
    // escopo condicional existe.
    const listas = [...String(body || '').matchAll(/#\s*\(/g)].map((m) => {
        const abre = m.index! + m[0].length - 1;
        let nivel = 0;
        for (let i = abre; i < body.length; i++) {
            if (body[i] === '(') nivel++;
            else if (body[i] === ')') { nivel--; if (nivel === 0) return body.slice(abre + 1, i); }
        }
        return '';
    });
    let usadas = 0;
    const paramsPorInstancia = new Map<string, Map<string, string>>();
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
        // Toda `#()` que o stripParamLists deixou corresponde, em ordem, a uma
        // lista original; consumimos uma aqui mesmo quando a instância é
        // descartada abaixo, senão o pareamento sai do lugar.
        const temParams = /#\s*\(\)/.test(m[0]);
        const listaCrua = temParams ? (listas[usadas++] ?? '') : '';
        if (!knownModuleNames.has(typeName)) continue;
        if (RESERVED_KEYWORDS.has(typeName)) continue;
        if (RESERVED_KEYWORDS.has(instName)) continue;
        if (listaCrua && !paramsPorInstancia.has(instName)) {
            paramsPorInstancia.set(instName, overriddenParams(listaCrua));
        }
        // Dedup: blocos `ifdef/`else duplicados podem gerar a mesma
        // instance duas vezes apos stripDirectives. Manter o primeiro
        // match e o suficiente, a hierarquia logica e a mesma.
        if (!seen.has(instName)) seen.set(instName, typeName);
    }
    return [...seen.entries()].map(([instanceName, moduleType]) => ({
        instanceName,
        moduleType,
        params: paramsPorInstancia.get(instanceName),
    }));
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
            const semDiretivas = stripDirectives(block.body);
            const cleanBody = stripConditionalGenerates(semDiretivas);
            // Os ramos nomeados saem do corpo ANTES do strip: eles continuam
            // fora de `signals`/`instances` (o strip garante isso), e entram
            // na hierarquia só quando a condição resolver verdadeira.
            const conditionals = extractNamedGenerates(semDiretivas).map((ramo) => ({
                label: ramo.label,
                condition: ramo.condition,
                negated: ramo.negated,
                signals: extractSignals(ramo.body),
                instances: extractInstances(ramo.body, knownModuleNames),
            }));
            modules.set(block.name, {
                file: path,
                signals: extractSignals(cleanBody),
                instances: extractInstances(cleanBody, knownModuleNames),
                params: declaredParams(block.paramHeader, cleanBody),
                conditionals,
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
        overrides: Map<string, number>,
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
        // Os parâmetros que valem AQUI: o padrão declarado do módulo, com o
        // que a instanciação sobrescreveu por cima. É isso que faz `.CAL(1)`
        // no `<proc>.v` chegar ao `generate if (CAL)` lá dentro do core,
        // atravessando o repasse `.CAL(CAL)` que o processor.v faz no meio.
        const efetivos = new Map(info.params ?? []);
        for (const [k, v] of overrides) efetivos.set(k, v);

        const filhoDe = (inst: ModuleInstance, sob: string) => {
            const resolvidos = new Map<string, number>();
            for (const [nome, texto] of inst.params ?? []) {
                const v = resolveParamValue(texto, efetivos);
                if (v !== undefined) resolvidos.set(nome, v);
            }
            return visit(inst.moduleType, inst.instanceName, sob, nextAncestors, resolvidos);
        };

        const children = info.instances.map((inst) => filhoDe(inst, scopePath));

        // Escopos condicionais: entram só quando a condição resolve VERDADEIRA
        // com os parâmetros efetivos. Indecidível fica de fora, que é o
        // comportamento de sempre e o lado seguro: um escopo a menos custa um
        // monitor ausente, um escopo a mais custa uma elaboração que falha.
        for (const cond of info.conditionals ?? []) {
            if (evaluateCondition(cond.condition, efetivos, cond.negated) !== true) continue;
            const condPath = `${scopePath}.${cond.label}`;
            children.push({
                name: cond.label,
                instanceName: cond.label,
                scopePath: condPath,
                signals: cond.signals,
                children: cond.instances.map((inst) => filhoDe(inst, condPath)),
                fromGenerate: true,
            });
        }

        return { name: moduleType, instanceName, scopePath, signals: info.signals, children };
    };

    return visit(topModuleName, null, null, new Set(), new Map<string, number>());
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
 * fabricados: uma referencia a escopo inexistente e erro de ELABORACAO no
 * Icarus, e foi o que derrubou a primeira tentativa.
 *
 * O isp entrou em 23/08/2026, quando o parser aprendeu a ler generate
 * nomeado (generate_blocks.ts). Ele e diferente dos outros dois de DUAS
 * formas, e a segunda custou um build quebrado no mesmo dia:
 *
 *   1. vive em `core.instr_fetch.isp_blk.isp`, dois niveis abaixo, e SO
 *      existe quando CAL e diferente de zero, ou seja, quando o programa C+-
 *      usa funcao. Por isso a busca e pela arvore de fato, e nao por um
 *      caminho montado a mao.
 *   2. o caminho ATRAVESSA um escopo de generate, e os dois simuladores
 *      discordam sobre isso. O Icarus resolve e elabora; o Verilator 5.048
 *      recusa com "Known scopes under ...isp_blk: <no instances found>",
 *      mesmo com a condicao verdadeira e o escopo do generate existindo.
 *      Medido em 23/08/2026 com um design minimo, nos dois simuladores.
 *
 * Dai o parametro `simulator`: sob Verilator, monitor cujo caminho passa por
 * generate fica de fora. Emiti-lo assim mesmo nao da forma de onda incompleta,
 * da BUILD QUEBRADO, que e' o pior desfecho possivel para quem so queria
 * simular.
 */
export function deriveMonitorScopes(
    tree: HierarchyNode | null | undefined,
    opts: { simulator?: string } = {},
): MonitorMirror[] {
    if (!tree) return [];
    // Sob Verilator, caminho que atravessa generate nao elabora. Ver o
    // cabecalho: a medida esta la, com os dois simuladores.
    const permiteGenerate = opts.simulator !== 'verilator';
    const out: MonitorMirror[] = [];
    const WANTED: Record<string, string[]> = {
        sp: ['pointeri', 'fl_max', 'fl_full'],
        isp: ['pointeri', 'fl_max', 'fl_full'],
        ula: ['delta_int', 'delta_float'],
    };
    const rootPrefix = tree.scopePath + '.';
    const relativo = (caminho: string) =>
        (caminho.startsWith(rootPrefix) ? caminho.slice(rootPrefix.length) : caminho);

    /** Anota os monitores de um no' que e' sp, isp ou ula. */
    const anotar = (node: HierarchyNode, corePathRel: string, viaGenerate: boolean): void => {
        if (viaGenerate && !permiteGenerate) return;
        const inst = node.instanceName;
        if (!inst) return;
        const wanted = WANTED[inst];
        if (!wanted) return;
        const declared = new Set((node.signals || []).map((s) => s.name));
        // O caminho relativo ao core carrega os escopos do meio (o
        // `instr_fetch.isp_blk` do isp), porque e' o caminho REAL que o
        // espelho vai referenciar.
        const dentroDoCore = relativo(node.scopePath).slice(corePathRel.length + 1);
        for (const v of wanted) {
            if (!declared.has(v)) continue;
            out.push({
                ref: corePathRel + '.' + dentroDoCore + '.' + v,
                mirror: monitorMirrorName(corePathRel, inst, v),
                kind: v.startsWith('delta') ? 'real' : (v === 'fl_full' ? 'reg' : 'integer'),
            });
        }
    };

    const walk = (node: HierarchyNode | null | undefined): void => {
        if (!node) return;
        if (node.name === 'core') {
            const corePathRel = relativo(node.scopePath);
            // Desce a subarvore inteira do core: sp e ula sao filhos diretos,
            // o isp esta dois niveis abaixo, dentro do generate nomeado.
            const descer = (n: HierarchyNode, viaGenerate: boolean): void => {
                const marcado = viaGenerate || !!n.fromGenerate;
                anotar(n, corePathRel, marcado);
                for (const c of n.children || []) descer(c, marcado);
            };
            for (const c of node.children || []) descer(c, false);
            return; // dentro do core nao ha outro core
        }
        for (const child of node.children || []) walk(child);
    };
    walk(tree);
    return out;
}
