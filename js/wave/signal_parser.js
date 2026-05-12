/**
 * signal_parser.js — Lightweight Verilog parser for the Wave
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
 *     still hand-craft a .gtkw via Project Settings — we degrade
 *     gracefully, not catastrophically.
 *
 * Output shape:
 *   {
 *     modules: Map<string, {
 *       file:       string,
 *       signals:    Array<{ name, kind, range }>,
 *       instances:  Array<{ instanceName, moduleType }>,
 *     }>,
 *     errors: Array<{ file, message }>,
 *   }
 *
 * Limitations (acceptable for Phase 2):
 *   - No preprocessor: `define / `ifdef are NOT expanded.
 *   - Generate-block instantiations are skipped (we only catch direct
 *     instances at module scope).
 *   - SystemVerilog typedefs / packages / interfaces: not supported.
 */

const KIND_TOKENS = ['input', 'output', 'inout', 'wire', 'reg', 'logic',
    'signed', 'tri', 'tri0', 'tri1', 'wand', 'wor'];
const KIND_RE_SOURCE = `(?:${KIND_TOKENS.join('|')})`;
const PRIMARY_KIND_PRIORITY = {
    input: 4, output: 4, inout: 4,
    reg: 3, logic: 3,
    wire: 2, tri: 2, tri0: 2, tri1: 2, wand: 2, wor: 2,
    signed: 1,
};

const RESERVED_KEYWORDS = new Set([
    'always', 'assign', 'begin', 'case', 'casex', 'casez', 'else', 'end',
    'endcase', 'endfunction', 'endgenerate', 'endmodule', 'endspecify',
    'endtable', 'endtask', 'for', 'forever', 'function', 'generate',
    'genvar', 'if', 'initial', 'localparam', 'parameter', 'posedge',
    'negedge', 'repeat', 'specify', 'task', 'while', 'fork', 'join',
    'wait', 'release', 'force', 'deassign', 'disable', 'integer',
    'real', 'time', 'event', 'module', 'macromodule', 'primitive',
    'endprimitive', 'defparam', 'pulldown', 'pullup', 'tran', 'tranif0',
    'tranif1', 'rtran', 'rtranif0', 'rtranif1',
    ...KIND_TOKENS,
]);

/**
 * Strip /* ... *\/ and // ... line comments. Verilog doesn't put module
 * bodies inside string literals, so a string-naive replace is fine.
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Find each `module <name> ... endmodule` body. Both the optional
 * parameter list `#(...)` and the optional port list `(...)` are
 * supported; modules that omit one or both (e.g. `module tb;`) parse.
 */
function extractModules(stripped) {
    const out = [];
    const re = /\bmodule\s+([A-Za-z_][\w$]*)\s*(?:#\s*\([\s\S]*?\)\s*)?(?:\(([\s\S]*?)\))?\s*;([\s\S]*?)\bendmodule\b/g;
    let m;
    while ((m = re.exec(stripped)) !== null) {
        const [, name, portHeader, bodyRaw] = m;
        // Treat the header port list as part of the body for signal
        // extraction — ANSI-style declarations live there. Wrap each
        // port entry as semi-terminated so the same kind regex works.
        const headerLines = portHeader
            ? portHeader.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s + ';').join('\n')
            : '';
        out.push({ name, body: headerLines + '\n' + bodyRaw });
    }
    return out;
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
function extractSignals(body) {
    const re = new RegExp(
        // 1: one or more space-separated kind keywords
        `((?:\\b${KIND_RE_SOURCE}\\b\\s+)+)` +
        // 2: optional [range]
        `(?:(\\[[^\\]]+\\])\\s*)?` +
        // 3: comma-separated names, lazy so we stop at the terminator
        `([A-Za-z_][\\w$,\\s]*?)` +
        // terminator: ; or = (init), but NOT ( — that's a function/task
        `\\s*(?=[;=])`,
        'g',
    );

    const collected = [];
    let m;
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

    // De-dup: uma port pode ser re-declarada no body (non-ANSI) — manter
    // uma entry, preferindo o kind de maior prioridade. Se qualquer
    // declaracao for `signed`, propaga.
    const dedup = new Map();
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
 * Find module instantiations in the body: `<typeName> [#(...)] <instName> ( ... );`.
 * The typeName must match a known module from the first pass, otherwise
 * we'd flag every function call and behavioural construct as an instance.
 */
function extractInstances(body, knownModuleNames) {
    const instances = [];
    const re = /\b([A-Za-z_][\w$]*)\s*(?:#\s*\([\s\S]*?\)\s*)?([A-Za-z_][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(body)) !== null) {
        const [, typeName, instName] = m;
        if (!knownModuleNames.has(typeName)) continue;
        if (RESERVED_KEYWORDS.has(typeName)) continue;
        if (RESERVED_KEYWORDS.has(instName)) continue;
        instances.push({ instanceName: instName, moduleType: typeName });
    }
    return instances;
}

/**
 * Parse a list of {path, content} files and return a module map plus
 * any soft errors. Soft errors don't abort.
 */
export function parseVerilogModules(files) {
    const modules = new Map();
    const errors = [];

    const stripped = files.map(({ path, content }) => ({ path, src: stripComments(content) }));

    // First pass: collect module names so the instance scan can
    // distinguish module instantiations from function calls.
    const knownModuleNames = new Set();
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
            modules.set(block.name, {
                file: path,
                signals: extractSignals(block.body),
                instances: extractInstances(block.body, knownModuleNames),
            });
        }
    }

    return { modules, errors };
}

/**
 * Build a tree rooted at `topModuleName`, descending through each
 * instantiation. Cycles (illegal in real Verilog) are broken by tracking
 * a visited set — depth-first stops re-entering a module already on the
 * current path.
 */
export function buildHierarchyTree(modules, topModuleName) {
    const visit = (moduleType, instanceName, parentPath, ancestors) => {
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
